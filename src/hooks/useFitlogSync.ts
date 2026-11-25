/**
 * 包含应用启动初始化（数据库 + 迁移 + 远端拉取）以及手动 fullSync 逻辑
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Language } from '../../types';
import { translations } from '../../translations';
import { db } from '../../services/db';
import { storage } from '../../services/appStorage';
import {
  isRemoteConfigured,
  migrateLocalData,
  migrateRecordsToSoloUserId,
  readPrefsFromLocalStorage,
  RemoteError,
} from '../../services/fitlogRemote';
import {
  currentSyncState,
  isLocalAuthoritative,
  isPushDirty,
  pullAndMergeFitlogRemoteDetailed,
  pushFitlogRemoteSnapshot,
  type SyncState,
} from '../../services/fitlogRemoteSync';
import { scheduleDebouncedFitlogPush } from '../../services/fitlogSyncScheduler';
import { resumeGymRenames } from '../../services/gymRename';
import { useExercisePrefs } from '../contexts/ExercisePrefsContext';
import { useWorkoutContext } from '../contexts/WorkoutContext';
import { useGoalsContext } from '../contexts/GoalsContext';
import { useUserSettingsContext } from '../contexts/UserSettingsContext';
import { useAvatar } from '../contexts/AvatarContext';
import { useUiOverlay } from '../contexts/UiOverlayContext';

export type SyncStatus = 'idle' | 'syncing' | 'error';

/** 拉取没拿到远端，推送因此被跳过（message 只给控制台，UI 按 reason 取文案） */
class PullFailedError extends Error {
  constructor(readonly reason: 'unreachable' | 'incompatible') {
    super(`pull failed (${reason}); push skipped`);
    this.name = 'PullFailedError';
  }
}

export interface UseFitlogSyncResult {
  syncStatus: SyncStatus;
  setSyncStatus: React.Dispatch<React.SetStateAction<SyncStatus>>;
  lastSyncedAt: number | null;
  /** 推送这一头的实况：有改动没推上去 / 最近一次推送失败 / 都推上去了（首选项「同步」一行，审查 B12） */
  pushState: SyncState;
  performFullSync: () => Promise<void>;
  loadLocalData: () => Promise<void>;
  /** 启动流程（迁移 → 续完馆改名 → 拉取合并 → 补字段 → 重读）走完；出错也算走完 */
  whenBooted: () => Promise<void>;
}

/**
 * 应用启动期的同步 / 加载逻辑
 */
export function useFitlogSync(): UseFitlogSyncResult {
  const { applyPrefsFromSnapshot } = useExercisePrefs();
  const workoutCtx = useWorkoutContext();
  const goalsCtx = useGoalsContext();
  const settingsCtx = useUserSettingsContext();
  const { setAvatarUrl } = useAvatar();
  const { reloadLangUnit } = settingsCtx;
  const { toast } = useUiOverlay();

  const [syncStatus, setSyncStatus] = useState<SyncStatus>('idle');
  /** 上一次完整同步成功的时刻（首选项「同步」一行显示「已同步 · N 分钟前」）；本次启动还没成功过＝null */
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [pushState, setPushState] = useState<SyncState>(() => currentSyncState().state);
  // 推送 / 拉取在服务层，状态经事件送过来；成功的那一刻就是「已同步」的时间（启动拉取成功也算，审查 B12）
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<{ state: SyncState; at: number | null }>).detail;
      setPushState(d.state);
      if (d.state === 'synced' && d.at) setLastSyncedAt(d.at);
    };
    window.addEventListener('fitlog:sync-state', on);
    return () => window.removeEventListener('fitlog:sync-state', on);
  }, []);
  const syncLockRef = useRef<boolean>(false);
  const didInitRef = useRef(false);
  const bootedRef = useRef<{ promise: Promise<void>; resolve: () => void } | null>(null);
  if (!bootedRef.current) {
    let resolve = () => {};
    const promise = new Promise<void>(r => (resolve = r));
    bootedRef.current = { promise, resolve };
  }
  const whenBooted = useCallback(() => bootedRef.current!.promise, []);

  const loadLocalData = useCallback(
    async () => {
      try {
        await Promise.all([
          workoutCtx.refreshFromDb(),
          goalsCtx.refreshFromDb(),
          settingsCtx.reloadFromIndexedDb(),
        ]);
        // 拉取 / 恢复进来的行里可能有过期没结束的场：照启动时一样收尾（上架审查 C01）
        await workoutCtx.settleStale();
      } catch (error) {
        console.error('加载本地数据失败:', error);
      }
    },
    [workoutCtx, goalsCtx, settingsCtx],
  );

  const handleSnapshotApply = useCallback(
    (p: ReturnType<typeof readPrefsFromLocalStorage>) => {
      applyPrefsFromSnapshot(p);
      if (p.lang) settingsCtx.setLang(p.lang as Language);
      if (p.unit) settingsCtx.setUnit(p.unit);
      settingsCtx.reloadAppPrefs();
      if (typeof p.avatarDataUrl === 'string' && p.avatarDataUrl) {
        setAvatarUrl(p.avatarDataUrl);
      }
    },
    [applyPrefsFromSnapshot, settingsCtx, setAvatarUrl],
  );

  // 应用初始化（仅一次）
  useEffect(() => {
    if (didInitRef.current) return;
    didInitRef.current = true;

    const initApp = async () => {
      try {
        await db.init();
        // 启动期有没有写过库：单机版没写过就不必重放首选项、重读三张表 —— 各 Provider 挂载时已经读过（审查 scale-perf#1）
        let wrote = await migrateRecordsToSoloUserId();
        // 上次馆改名写到一半被杀：续完（首选项和训练两半都会被下面重读）。失败就留着标记下次再续，不拖住启动
        try {
          if (await resumeGymRenames()) {
            wrote = true;
            scheduleDebouncedFitlogPush();
          }
        } catch (e) {
          console.error('[fitlog] 续完馆改名失败:', e);
        }
        const remote = isRemoteConfigured();
        if (remote) {
          if (isLocalAuthoritative()) {
            // 上次恢复 / 导入 / 重置之后还没推上去：先推本机这一份，不拉（拉了会把服务器上的旧数据合并回来，审查 A23）
            try {
              await pushFitlogRemoteSnapshot();
            } catch (e) {
              console.warn('[fitlog] 启动时补推失败，之后回到前台 / 联网再试:', e);
            }
          } else {
            try {
              await pullAndMergeFitlogRemoteDetailed();
            } catch (e) {
              console.warn('[fitlog] 启动时远端拉取失败，继续使用本地数据:', e);
            }
            // 上次有改动没推上去（推送失败、App 被杀）：补推。拉取失败的话推送前会再拉一次，不会盖掉服务器
            if (isPushDirty()) scheduleDebouncedFitlogPush(0);
          }
        }
        // 补字段只在启动时跑一次、单独兜住：出错也不拖住下面的重读（撤销 / 重做、改目标都走 loadLocalData）
        try {
          if (await migrateLocalData()) wrote = true;
        } catch (e) {
          console.error('[fitlog] 启动迁移失败:', e);
          wrote = true;
        }
        if (remote || wrote) {
          handleSnapshotApply(readPrefsFromLocalStorage());
          await loadLocalData();
        }
      } catch (e) {
        console.error('[fitlog] 应用初始化失败:', e);
      } finally {
        // 启动流程（拉取合并 → 应用 prefs → 重读本地库；单机版没写过库时后两步跳过）走完的标记，给 e2e 等「重开 App 落定了」用。
        // 不能拿「时间线卡片出来了」当信号：WorkoutContext 挂载时自己先从本地库读一遍，卡片比拉取合并早
        document.documentElement.dataset.fitlogBoot = 'done';
        bootedRef.current!.resolve();
      }
    };
    void initApp();
  }, []);

  /**
   * 回到前台 / 联网时补推没推上去的改动（审查 A26）；推送前补拉进来了东西，界面重读本地库。
   */
  useEffect(() => {
    const retry = () => {
      if (document.visibilityState === 'visible' && isRemoteConfigured() && isPushDirty()) scheduleDebouncedFitlogPush(0);
    };
    const onPulled = () => {
      handleSnapshotApply(readPrefsFromLocalStorage());
      void loadLocalData();
    };
    document.addEventListener('visibilitychange', retry);
    window.addEventListener('online', retry);
    // 全局撤销 / 重做写回了本机（useGlobalUndo）：同一条路重读，再按存储现状刷新语言 / 单位 / 头像 ——
    // 拉取的「缺字段不覆盖本机」管不到撤回第一次写入（键没了，界面还停在撤销前，上架审查 C80）
    const onLocalRestored = () => {
      onPulled();
      reloadLangUnit();
      setAvatarUrl(storage.getItem('fitlog_avatar_data_url') || undefined);
    };
    window.addEventListener('fitlog:pulled', onPulled);
    window.addEventListener('fitlog:local-restored', onLocalRestored);
    return () => {
      window.removeEventListener('fitlog:local-restored', onLocalRestored);
      document.removeEventListener('visibilitychange', retry);
      window.removeEventListener('online', retry);
      window.removeEventListener('fitlog:pulled', onPulled);
    };
  }, [handleSnapshotApply, loadLocalData, reloadLangUnit, setAvatarUrl]);

  const performFullSync = useCallback(async () => {
    if (!isRemoteConfigured()) {
      const lang = settingsCtx.lang;
      toast(
        lang === Language.CN
          ? '未配置个人服务器：在 .env.local 设置 VITE_API_URL 与 VITE_API_KEY'
          : 'No server configured: set VITE_API_URL and VITE_API_KEY in .env.local',
        'error',
      );
      return;
    }
    if (syncLockRef.current) return;
    syncLockRef.current = true;
    setSyncStatus('syncing');
    try {
      // 刚恢复 / 导入 / 重置过、还没推上去：只推不拉（同启动）
      if (isLocalAuthoritative()) {
        await pushFitlogRemoteSnapshot();
        setSyncStatus('idle');
        setLastSyncedAt(Date.now());
        return;
      }
      const pulled = await pullAndMergeFitlogRemoteDetailed();
      if (pulled.kind === 'locked') {
        // 启动时那次拉取还没完：这次什么都没拉，更不能推；它落定后数据自然会刷新
        setSyncStatus('idle');
        return;
      }
      // 拉取什么都没带来：本机没被改写，不必重读
      if (pulled.kind !== 'merged' || pulled.changed) {
        handleSnapshotApply(pulled.kind === 'merged' ? pulled.prefs : readPrefsFromLocalStorage());
        await loadLocalData();
      }
      if (pulled.kind === 'failed') {
        // 没读到远端就推送 = 拿本地盖掉一份没合并进来的远端（另一台设备的新记录就此丢失）
        throw new PullFailedError(pulled.reason);
      }
      await pushFitlogRemoteSnapshot();
      setSyncStatus('idle');
      setLastSyncedAt(Date.now());
    } catch (e: any) {
      console.error('Sync Failure:', e?.message || e);
      setSyncStatus('error');
      // 403 / 409 是配置问题，不是网络问题。一律提示"检查网络"
      // 会把排查方向引到完全错误的地方，所以分开报。
      const lang = settingsCtx.lang;
      const message =
        e instanceof RemoteError && e.kind === 'forbidden-endpoint'
          ? translations.remoteForbiddenEndpoint[lang]
          : e instanceof RemoteError && e.kind === 'env-mismatch'
            ? translations.remoteEnvMismatch[lang]
            : e instanceof PullFailedError && e.reason === 'incompatible'
              ? translations.remoteIncompatible[lang]
            // 其余都当网络问题：手机没网 / 信号差，或 NAS / 家里网络掉线
            : translations.remoteUnreachable[lang];
      toast(String(message), 'error');
    } finally {
      syncLockRef.current = false;
    }
  }, [handleSnapshotApply, loadLocalData, settingsCtx.lang, toast]);

  return { syncStatus, setSyncStatus, lastSyncedAt, pushState, performFullSync, loadLocalData, whenBooted };
}
