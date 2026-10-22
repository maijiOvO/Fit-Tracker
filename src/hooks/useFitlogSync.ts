/**
 * 包含应用启动初始化（数据库 + 迁移 + 远端拉取）以及手动 fullSync 逻辑
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Goal, Language, WorkoutSession } from '../../types';
import { translations } from '../../translations';
import { db } from '../../services/db';
import {
  isRemoteConfigured,
  markPrefsUpdated,
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
import { useExercisePrefs } from '../contexts/ExercisePrefsContext';
import { useWorkoutContext } from '../contexts/WorkoutContext';
import { useGoalsContext } from '../contexts/GoalsContext';
import { useUserSettingsContext } from '../contexts/UserSettingsContext';
import { useAuthContext } from '../contexts/AuthContext';
import { useUiOverlay } from '../contexts/UiOverlayContext';

export type SyncStatus = 'idle' | 'syncing' | 'error';

/** 拉取没拿到远端，推送因此被跳过（message 只给控制台，UI 按 reason 取文案） */
class PullFailedError extends Error {
  constructor(readonly reason: 'unreachable' | 'incompatible') {
    super(`pull failed (${reason}); push skipped`);
    this.name = 'PullFailedError';
  }
}

/**
 * 对本地训练 / 目标做一次性数据迁移，确保字段齐全
 */
async function migrateLocalData(userId: string): Promise<void> {
  if (!userId) return;

  const [allW, allG] = await Promise.all([
    db.getAll<WorkoutSession>('workouts'),
    db.getAll<Goal>('goals'),
  ]);

  // 训练记录迁移：补齐 exerciseTime / instanceConfig
  const userW = allW.filter(w => w.userId === userId);
  let hasDataMigration = false;
  const migratedWorkouts = userW.map(workout => {
    let workoutChanged = false;
    const updatedExercises = workout.exercises.map(exercise => {
      let exerciseChanged = false;
      const updatedExercise = { ...exercise };

      if (!exercise.exerciseTime) {
        updatedExercise.exerciseTime = new Date(workout.date).toISOString();
        exerciseChanged = true;
      }
      if (!exercise.instanceConfig) {
        updatedExercise.instanceConfig = {
          enablePyramid: false,
          bodyweightMode: 'none',
          pyramidMode: 'decreasing',
          autoCalculateSubSets: false,
        };
        exerciseChanged = true;
      }
      if (exerciseChanged) {
        workoutChanged = true;
        hasDataMigration = true;
        return updatedExercise;
      }
      return exercise;
    });

    if (workoutChanged) {
      return { ...workout, exercises: updatedExercises };
    }
    return workout;
  });

  if (hasDataMigration) {
    console.log('执行数据迁移：为现有动作记录添加训练时间');
    for (const workout of migratedWorkouts) {
      if (workout !== userW.find(w => w.id === workout.id)) {
        await db.save('workouts', workout);
      }
    }
  }

  // 目标记录迁移：补齐新版必需字段
  const userG = allG.filter(g => g.userId === userId);
  let hasGoalMigration = false;
  const migratedGoals = userG.map(goal => {
    const anyG = goal as any;
    if (
      !goal.title ||
      !goal.startDate ||
      !goal.dataSource ||
      !goal.progressHistory ||
      goal.isActive === undefined
    ) {
      hasGoalMigration = true;
      const now = new Date().toISOString();
      return {
        ...goal,
        title: goal.title || anyG.label || 'Untitled Goal',
        description: goal.description || '',
        startDate: goal.startDate || goal.createdAt || now,
        targetDate: goal.targetDate || anyG.deadline,
        dataSource: goal.dataSource || 'manual',
        autoUpdateRule: goal.autoUpdateRule,
        progressHistory: goal.progressHistory || [],
        isActive: goal.isActive !== undefined ? goal.isActive : true,
        createdAt: goal.createdAt || now,
        updatedAt: goal.updatedAt || now,
        completedAt: goal.completedAt,
        category: goal.category || goal.type,
        label: anyG.label || goal.title,
        deadline: anyG.deadline || goal.targetDate,
      } as Goal;
    }
    return goal;
  });

  if (hasGoalMigration) {
    console.log('执行Goal数据迁移：升级到新的Goal格式');
    for (const goal of migratedGoals) {
      if (goal !== userG.find(g => g.id === goal.id)) {
        await db.save('goals', goal);
      }
    }
  }
}

export interface UseFitlogSyncResult {
  syncStatus: SyncStatus;
  setSyncStatus: React.Dispatch<React.SetStateAction<SyncStatus>>;
  lastSyncedAt: number | null;
  /** 推送这一头的实况：有改动没推上去 / 最近一次推送失败 / 都推上去了（首选项「同步」一行，审查 B12） */
  pushState: SyncState;
  performFullSync: () => Promise<void>;
  loadLocalData: (userId: string) => Promise<void>;
}

/**
 * 应用启动期的同步 / 加载逻辑
 *
 * @param resolvedUserId  当前用户 ID（单机版固定为 FITLOG_SOLO_USER_ID）
 */
export function useFitlogSync(resolvedUserId: string): UseFitlogSyncResult {
  const { applyPrefsFromSnapshot } = useExercisePrefs();
  const workoutCtx = useWorkoutContext();
  const goalsCtx = useGoalsContext();
  const settingsCtx = useUserSettingsContext();
  const authCtx = useAuthContext();
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

  const loadLocalData = useCallback(
    async (userId: string) => {
      if (!userId) return;
      try {
        await migrateLocalData(userId);
        await Promise.all([
          workoutCtx.refreshFromDb(),
          goalsCtx.refreshFromDb(),
          settingsCtx.reloadFromIndexedDb(),
        ]);
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
        authCtx.setUser(
          authCtx.user
            ? { ...authCtx.user, avatarUrl: p.avatarDataUrl as string }
            : authCtx.user,
        );
      }
    },
    [applyPrefsFromSnapshot, settingsCtx, authCtx],
  );

  // 应用初始化（仅一次）
  useEffect(() => {
    if (didInitRef.current) return;
    didInitRef.current = true;

    const initApp = async () => {
      try {
        await db.init();
        await migrateRecordsToSoloUserId();
        if (isRemoteConfigured()) {
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
        handleSnapshotApply(readPrefsFromLocalStorage());
        await loadLocalData(resolvedUserId);
      } catch (e) {
        console.error('[fitlog] 应用初始化失败:', e);
      } finally {
        // 启动流程（拉取合并 → 应用 prefs → 重读本地库）走完的标记，给 e2e 等「重开 App 落定了」用。
        // 不能拿「时间线卡片出来了」当信号：WorkoutContext 挂载时自己先从本地库读一遍，卡片比拉取合并早
        document.documentElement.dataset.fitlogBoot = 'done';
      }
    };
    void initApp();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      void loadLocalData(resolvedUserId);
    };
    document.addEventListener('visibilitychange', retry);
    window.addEventListener('online', retry);
    window.addEventListener('fitlog:pulled', onPulled);
    return () => {
      document.removeEventListener('visibilitychange', retry);
      window.removeEventListener('online', retry);
      window.removeEventListener('fitlog:pulled', onPulled);
    };
  }, [handleSnapshotApply, loadLocalData, resolvedUserId]);

  const performFullSync = useCallback(async () => {
    if (!isRemoteConfigured()) {
      const lang = settingsCtx.lang;
      toast(
        lang === Language.CN
          ? '未配置个人服务器：请在 .env.local 设置 VITE_API_URL 与 VITE_API_KEY'
          : 'Set VITE_API_URL and VITE_API_KEY in .env.local.',
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
      handleSnapshotApply(pulled.kind === 'merged' ? pulled.prefs : readPrefsFromLocalStorage());
      await loadLocalData(resolvedUserId);
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
  }, [handleSnapshotApply, loadLocalData, resolvedUserId, settingsCtx.lang, toast]);

  // 兼容旧逻辑：markPrefsUpdated 不应缺失
  void markPrefsUpdated;

  return { syncStatus, setSyncStatus, lastSyncedAt, pushState, performFullSync, loadLocalData };
}
