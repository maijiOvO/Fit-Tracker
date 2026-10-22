import React, { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react';
import { WorkoutSession } from '../../types';
import { db } from '../../services/db';
import { scheduleDebouncedFitlogPush } from '../../services/fitlogSyncScheduler';
import { scheduleAutoBackup } from '../../services/fitlogAutoBackup';
import { FITLOG_SOLO_USER_ID } from '../../services/fitlogSolo';
import { lastUsedGym } from '../utils/gyms';
import { storage } from '../../services/appStorage';

/** 「进行中」能接回来的时限：超过这么久没动过的未结束训练不再自动接回（早期没有 finishedAt 字段的旧记录也靠它挡掉） */
const IN_PROGRESS_MAX_AGE_MS = 12 * 60 * 60 * 1000;

/** 一场里有没有真正做完的组（全是底稿 / 跳过的不算数据） */
export function hasDoneSets(w: Pick<WorkoutSession, 'exercises'>): boolean {
  return (w.exercises ?? []).some(ex => (ex.sets ?? []).some(s => !s.ghost));
}

/** 工作台上那一场的 id（每次自动落盘时记下）：接回进行中的训练只认它，或者真是刚开的（见 findInProgress） */
const ACTIVE_WORKOUT_KEY = 'fitlog_active_workout';
const readActiveId = () => storage.getItem(ACTIVE_WORKOUT_KEY);
const markActive = (id: string) => {
  if (readActiveId() !== id) storage.setItem(ACTIVE_WORKOUT_KEY, id);
};

/**
 * 库里最近一场「进行中」的训练：没结束、有动作、12 小时内动过。
 * 练到一半按返回 / App 被系统回收 / 刷新之后，靠它把这场接回工作台（workbench-not-restored）。
 *
 * 只看 updatedAt 不够：早期没有 finishedAt 的旧记录，编辑 / 馆改名一下 updatedAt 就新了，会被当成进行中接回来
 * （2026-10-21 审查）。所以还得是工作台上落过盘的那一场（activeId；「继续这场」接回来的旧训练也走这条），
 * 或者开练时间本身就在 12 小时内（旧版本升级上来、还没记过 activeId 的那一场）。
 */
export function findInProgress(list: WorkoutSession[], activeId: string | null = null): WorkoutSession | null {
  const now = Date.now();
  const ts = (w: WorkoutSession) => new Date(w.updatedAt || w.startTime || w.date).getTime() || 0;
  const started = (w: WorkoutSession) => new Date(w.startTime || w.createdAt || w.date).getTime() || 0;
  return (
    list
      .filter(w => !w.finishedAt && w.status !== 'completed' && (w.exercises?.length ?? 0) > 0 && now - ts(w) < IN_PROGRESS_MAX_AGE_MS)
      .filter(w => w.id === activeId || now - started(w) < IN_PROGRESS_MAX_AGE_MS)
      .sort((a, b) => ts(b) - ts(a))[0] ?? null
  );
}

function createEmptyWorkout(userId: string): WorkoutSession {
  const now = new Date().toISOString();
  return {
    id: '',
    userId,
    title: '',
    date: now,
    exercises: [],
    notes: '',
    duration: 0,
    tags: [],
    createdAt: now,
    updatedAt: now,
  };
}

interface WorkoutContextType {
  workouts: WorkoutSession[];
  currentWorkout: WorkoutSession;
  isLoading: boolean;

  addWorkout: (workout: WorkoutSession) => Promise<void>;
  updateWorkout: (workout: WorkoutSession) => Promise<void>;
  deleteWorkout: (id: string) => Promise<void>;

  setCurrentWorkout: React.Dispatch<React.SetStateAction<WorkoutSession>>;
  updateCurrentWorkout: (updates: Partial<WorkoutSession>) => void;
  createNewWorkout: () => WorkoutSession;

  /**
   * 立即持久化 currentWorkout 到 IndexedDB。
   * 每次修改 exercises / sets 后调用，无 debounce。
   */
  persistCurrentWorkout: () => void;

  /**
   * 结束当前训练：标记 finishedAt + status='completed'，写入 DB，刷新列表。
   */
  finishWorkout: (workout: WorkoutSession) => Promise<void>;

  /**
   * 编辑旧训练时，工作台上那份是草稿（edit-history-cannot-discard）：
   * 设了 id 之后自动落盘 / 切后台 / pagehide 都不写它，只有 saveEditedWorkout 写库。传 null 解除。
   */
  setDraftWorkoutId: (id: string | null) => void;

  /** 保存编辑过的旧训练：只写库 + 推送，不动 finishedAt / status（不是「再结束一次」） */
  saveEditedWorkout: (workout: WorkoutSession) => Promise<void>;

  syncWorkouts: () => Promise<void>;
  refreshFromDb: () => Promise<void>;
  /** 工作台是空的时候，把库里最近一场进行中的训练接回来（启动时自动跑一次；退出编辑旧训练后再跑） */
  restoreInProgress: () => Promise<void>;
}

const WorkoutContext = createContext<WorkoutContextType | undefined>(undefined);

export const WorkoutProvider: React.FC<{ children: ReactNode; userId?: string }> = ({
  children,
  userId,
}) => {
  const uid = userId || FITLOG_SOLO_USER_ID;
  const [workouts, setWorkouts] = useState<WorkoutSession[]>([]);
  const [currentWorkout, setCurrentWorkout] = useState<WorkoutSession>(() => createEmptyWorkout(uid));
  const [isLoading, setIsLoading] = useState(true);

  // 持有最新 currentWorkout 的 ref，避免闭包过期
  const currentWorkoutRef = useRef(currentWorkout);
  currentWorkoutRef.current = currentWorkout;

  /** 工作台上那份是编辑草稿时的 id：自动落盘的三条路都认它（见 setDraftWorkoutId） */
  const draftIdRef = useRef<string | null>(null);
  const setDraftWorkoutId = useCallback((id: string | null) => {
    draftIdRef.current = id;
  }, []);
  /** 这一份该不该自动落盘：有 id、有动作、不是编辑草稿 */
  const shouldAutoPersist = (w: WorkoutSession) =>
    !!w.id && (w.exercises?.length ?? 0) > 0 && w.id !== draftIdRef.current;

  const refreshFromDb = useCallback(async () => {
    try {
      const localWorkouts = await db.getAll<WorkoutSession>('workouts');
      const filtered =
        uid === FITLOG_SOLO_USER_ID || uid === 'u_guest'
          ? localWorkouts
          : localWorkouts.filter((w) => w.userId === uid);
      setWorkouts(
        filtered.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
      );
    } catch (err) {
      console.error('[WorkoutContext] 刷新训练列表失败:', err);
    } finally {
      setIsLoading(false);
    }
  }, [uid]);

  /** 工作台空着时接回进行中的那场。只接一次性的：已经有内容就不碰 */
  const restoreInProgress = useCallback(async () => {
    if ((currentWorkoutRef.current.exercises?.length ?? 0) > 0) return;
    try {
      const hit = findInProgress(await db.getAll<WorkoutSession>('workouts'), readActiveId());
      if (hit && (currentWorkoutRef.current.exercises?.length ?? 0) === 0) setCurrentWorkout(hit);
    } catch (err) {
      console.error('[WorkoutContext] 接回进行中的训练失败:', err);
    }
  }, []);

  useEffect(() => {
    void refreshFromDb().then(restoreInProgress);
  }, [uid, refreshFromDb, restoreInProgress]);

  // ==================== visibilitychange：后台保活 ====================
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) {
        const w = currentWorkoutRef.current;
        if (shouldAutoPersist(w)) {
          markActive(w.id);
          // 同步落盘（fire-and-forget，页面隐藏时不阻塞）
          void db.save('workouts', { ...w, updatedAt: new Date().toISOString() });
        }
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);

  // ==================== pagehide 兼容：后端页面隐藏时强制落盘 ====================
  useEffect(() => {
    const handlePageHide = () => {
      const w = currentWorkoutRef.current;
      if (shouldAutoPersist(w)) {
        markActive(w.id);
        // pagehide 时同步落盘（使用 sendBeacon 类似的同步方式）
        const req = db.save('workouts', { ...w, updatedAt: new Date().toISOString() });
        // 不能 await，但至少发出请求
        void req;
      }
    };
    window.addEventListener('pagehide', handlePageHide);
    return () => window.removeEventListener('pagehide', handlePageHide);
  }, []);

  /**
   * 立即持久化 currentWorkout 到 IndexedDB（无 debounce）。
   */
  const persistCurrentWorkout = useCallback(() => {
    const w = currentWorkoutRef.current;
    if (!shouldAutoPersist(w)) return;
    markActive(w.id);
    void db.save('workouts', { ...w, updatedAt: new Date().toISOString() });
  }, []);

  const finishWorkout = useCallback(async (workout: WorkoutSession) => {
    const completed: WorkoutSession = {
      ...workout,
      status: 'completed',
      finishedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    try {
      await db.save('workouts', completed);
      // 刷新列表，确保 Timeline 立即反映
      await refreshFromDb();
      scheduleDebouncedFitlogPush();
      // 选过备份文件夹的话，5 秒后写一份完整快照进去（卸载也不丢）
      scheduleAutoBackup('workout-finished');
    } catch (err) {
      console.error('[WorkoutContext] 结束训练保存失败:', err);
      throw err;
    }
  }, [refreshFromDb]);

  const saveEditedWorkout = useCallback(async (workout: WorkoutSession) => {
    await db.save('workouts', { ...workout, updatedAt: new Date().toISOString() });
    await refreshFromDb();
    scheduleDebouncedFitlogPush();
  }, [refreshFromDb]);

  const addWorkout = async (workout: WorkoutSession) => {
    await db.upsert('workouts', workout);
    setWorkouts((prev) => [workout, ...prev]);
    scheduleDebouncedFitlogPush();
  };

  const updateWorkout = async (workout: WorkoutSession) => {
    await db.upsert('workouts', workout);
    setWorkouts((prev) => prev.map((w) => (w.id === workout.id ? workout : w)));
    if (currentWorkout.id === workout.id) setCurrentWorkout(workout);
    scheduleDebouncedFitlogPush();
  };

  const deleteWorkout = async (id: string) => {
    await db.delete('workouts', id);
    setWorkouts((prev) => prev.filter((w) => w.id !== id));
    if (currentWorkout.id === id) {
      setCurrentWorkout(createEmptyWorkout(uid));
    }
    scheduleDebouncedFitlogPush();
  };

  const createNewWorkout = (): WorkoutSession => {
    const now = new Date().toISOString();
    // §12.11 场地默认沿用上一场：连着去同一个馆就永远不用碰那个控件。
    // workouts 已按 date 倒序，lastUsedGym 取第一条标过的；全空则不编。
    const gym = lastUsedGym(workouts);
    return {
      ...createEmptyWorkout(uid),
      id: Date.now().toString(),
      startTime: now,
      createdAt: now,
      updatedAt: now,
      ...(gym ? { gym } : {}),
    };
  };

  const updateCurrentWorkout = (updates: Partial<WorkoutSession>) => {
    setCurrentWorkout((prev) => ({ ...prev, ...updates }));
  };

  const syncWorkouts = async () => {
    await refreshFromDb();
  };

  return (
    <WorkoutContext.Provider
      value={{
        workouts,
        currentWorkout,
        isLoading,
        addWorkout,
        updateWorkout,
        deleteWorkout,
        setCurrentWorkout,
        updateCurrentWorkout,
        createNewWorkout,
        persistCurrentWorkout,
        finishWorkout,
        setDraftWorkoutId,
        saveEditedWorkout,
        syncWorkouts,
        refreshFromDb,
        restoreInProgress,
      }}
    >
      {children}
    </WorkoutContext.Provider>
  );
};

export const useWorkoutContext = (): WorkoutContextType => {
  const context = useContext(WorkoutContext);
  if (!context) {
    throw new Error('useWorkoutContext must be used within WorkoutProvider');
  }
  return context;
};

export default WorkoutContext;