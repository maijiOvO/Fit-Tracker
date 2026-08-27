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
  pullAndMergeFitlogRemote,
  pushFitlogRemoteSnapshot,
} from '../../services/fitlogRemoteSync';
import { useExercisePrefs } from '../contexts/ExercisePrefsContext';
import { useWorkoutContext } from '../contexts/WorkoutContext';
import { useGoalsContext } from '../contexts/GoalsContext';
import { useUserSettingsContext } from '../contexts/UserSettingsContext';
import { useAuthContext } from '../contexts/AuthContext';
import { useUiOverlay } from '../contexts/UiOverlayContext';

export type SyncStatus = 'idle' | 'syncing' | 'error';

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
          try {
            await pullAndMergeFitlogRemote();
          } catch (e) {
            console.warn('[fitlog] 启动时远端拉取失败，继续使用本地数据:', e);
          }
        }
        handleSnapshotApply(readPrefsFromLocalStorage());
        await loadLocalData(resolvedUserId);
      } catch (e) {
        console.error('[fitlog] 应用初始化失败:', e);
      }
    };
    void initApp();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      const mergedPrefs = await pullAndMergeFitlogRemote();
      handleSnapshotApply(mergedPrefs ?? readPrefsFromLocalStorage());
      await loadLocalData(resolvedUserId);
      await pushFitlogRemoteSnapshot();
      setSyncStatus('idle');
    } catch (e: any) {
      console.error('Sync Failure:', e?.message || e);
      setSyncStatus('error');
      // 403 / 409 是配置问题，不是网络问题。一律提示"检查 Tailscale"
      // 会把排查方向引到完全错误的地方，所以分开报。
      const lang = settingsCtx.lang;
      const message =
        e instanceof RemoteError && e.kind === 'forbidden-endpoint'
          ? translations.remoteForbiddenEndpoint[lang]
          : e instanceof RemoteError && e.kind === 'env-mismatch'
            ? translations.remoteEnvMismatch[lang]
            // 个人服务器在家庭 NAS 上，只有连着 Tailscale 才可达 —— 明确提示，避免误判成"服务器挂了"
            : translations.remoteUnreachable[lang];
      toast(String(message), 'error');
    } finally {
      syncLockRef.current = false;
    }
  }, [handleSnapshotApply, loadLocalData, resolvedUserId, settingsCtx.lang, toast]);

  // 兼容旧逻辑：markPrefsUpdated 不应缺失
  void markPrefsUpdated;

  return { syncStatus, setSyncStatus, performFullSync, loadLocalData };
}
