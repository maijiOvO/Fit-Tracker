import React, { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react';
import { WorkoutSession } from '../../types';
import { db } from '../../services/db';
import { scheduleDebouncedFitlogPush } from '../../services/fitlogSyncScheduler';
import { FITLOG_SOLO_USER_ID } from '../../services/fitlogSolo';
import { recordTombstone } from '../../services/fitlogTombstones';

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
    status: 'draft',
  };
}

interface WorkoutContextType {
  workouts: WorkoutSession[];
  currentWorkout: WorkoutSession;
  isLoading: boolean;
  /** 是否有未结束的 draft 训练（App 启动时 / Dashboard 使用） */
  hasDraft: boolean;

  addWorkout: (workout: WorkoutSession) => Promise<void>;
  updateWorkout: (workout: WorkoutSession) => Promise<void>;
  deleteWorkout: (id: string) => Promise<void>;

  setCurrentWorkout: React.Dispatch<React.SetStateAction<WorkoutSession>>;
  updateCurrentWorkout: (updates: Partial<WorkoutSession>) => void;
  createNewWorkout: () => WorkoutSession;

  /**
   * 把 currentWorkout 写入 IndexedDB（debounce 300ms）。
   * 调用方在所有修改 currentWorkout.sets / exercises 之后调用即可，
   * 内部会自动去重。
   */
  persistCurrentWorkout: () => void;

  /**
   * 立即刷新 currentWorkout 的最新数据（用于 App 启动后恢复 draft）。
   * 返回找到的 draft，若没有则返回 null。
   */
  tryResumeDraft: () => Promise<WorkoutSession | null>;

  /**
   * 结束当前训练：标记 status='completed'，写入 DB，清空 currentWorkout。
   * 只有调用方确认后才调用。
   */
  finishWorkout: (workout: WorkoutSession) => Promise<void>;

  syncWorkouts: () => Promise<void>;
  refreshFromDb: () => Promise<void>;
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
  const [hasDraft, setHasDraft] = useState(false);

  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPersistedIdRef = useRef<string | null>(null);
  // 持有最新 currentWorkout 的 ref，避免 debounce 闭包过期
  const currentWorkoutRef = useRef(currentWorkout);
  currentWorkoutRef.current = currentWorkout;

  const refreshFromDb = useCallback(async () => {
    const localWorkouts = await db.getAll<WorkoutSession>('workouts');
    const filtered =
      uid === FITLOG_SOLO_USER_ID || uid === 'u_guest'
        ? localWorkouts
        : localWorkouts.filter((w) => w.userId === uid);
    setWorkouts(
      filtered.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
    );
    // 检查是否有 draft；清理孤儿（只保留最新一条 draft）
    const drafts = filtered.filter(w => w.status === 'draft');
    if (drafts.length > 1) {
      // 有多条 draft：删掉旧的，只保留最新的
      const sorted = [...drafts].sort(
        (a, b) => new Date(b.updatedAt || b.date).getTime() - new Date(a.updatedAt || a.date).getTime()
      );
      for (let i = 1; i < sorted.length; i++) {
        void db.delete('workouts', sorted[i].id);
      }
      // 更新本地列表去掉已删除的
      const validIds = new Set([sorted[0].id]);
      setWorkouts(prev => prev.filter(w => w.status !== 'draft' || validIds.has(w.id)));
    }
    setHasDraft(drafts.length > 0);
    setIsLoading(false);
  }, [uid]);

  useEffect(() => {
    void refreshFromDb();
  }, [uid, refreshFromDb]);

  /** 内部真正落盘的方法 */
  const _doPersist = useCallback(async (w: WorkoutSession) => {
    if (!w.id) return;
    try {
      await db.save('workouts', { ...w, updatedAt: new Date().toISOString() });
      lastPersistedIdRef.current = w.id;
    } catch (err) {
      console.error('[WorkoutContext] 自动保存失败:', err);
    }
  }, []);

  /**
   * 对外暴露的 debounce 版持久化。
   * 在每次修改 sets / exercises 后调用。
   */
  /**
   * 立即持久化 currentWorkout 到 IndexedDB。
   * 去掉 debounce，避免用户切后台前数据还没落盘。
   */
  const persistCurrentWorkout = useCallback(() => {
    const w = currentWorkoutRef.current;
    if (!w.id || !w.exercises || w.exercises.length === 0) return;
    if (persistTimer.current) clearTimeout(persistTimer.current);
    // 立即落盘，IndexedDB 本地操作足够快且异步
    void _doPersist(w);
  }, [_doPersist]);

  const tryResumeDraft = useCallback(async (): Promise<WorkoutSession | null> => {
    try {
      const all = await db.getAll<WorkoutSession>('workouts');
      const drafts = all.filter(w => w.status === 'draft');
      if (drafts.length === 0) return null;
      // 取最近更新的 draft
      drafts.sort((a, b) => new Date(b.updatedAt || b.date).getTime() - new Date(a.updatedAt || a.date).getTime());
      const latest = drafts[0];
      setCurrentWorkout(latest);
      setHasDraft(true);
      return latest;
    } catch (err) {
      console.error('[WorkoutContext] 恢复草稿失败:', err);
      return null;
    }
  }, []);

  const finishWorkout = useCallback(async (workout: WorkoutSession) => {
    const completed: WorkoutSession = {
      ...workout,
      status: 'completed',
      endTime: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    try {
      await db.save('workouts', completed);
      setHasDraft(false);
      setWorkouts(prev => {
        const idx = prev.findIndex(w => w.id === completed.id);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = completed;
          return next;
        }
        return [completed, ...prev];
      });
      lastPersistedIdRef.current = null;
      scheduleDebouncedFitlogPush();
    } catch (err) {
      console.error('[WorkoutContext] 结束训练保存失败:', err);
      throw err;
    }
  }, []);

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
    recordTombstone('workouts', id);
    setWorkouts((prev) => prev.filter((w) => w.id !== id));
    if (currentWorkout.id === id) {
      setCurrentWorkout(createEmptyWorkout(uid));
      setHasDraft(false);
    }
    scheduleDebouncedFitlogPush();
  };

  const createNewWorkout = (): WorkoutSession => {
    const now = new Date().toISOString();
    return {
      ...createEmptyWorkout(uid),
      id: Date.now().toString(),
      startTime: now,
      createdAt: now,
      updatedAt: now,
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
        hasDraft,
        addWorkout,
        updateWorkout,
        deleteWorkout,
        setCurrentWorkout,
        updateCurrentWorkout,
        createNewWorkout,
        persistCurrentWorkout,
        tryResumeDraft,
        finishWorkout,
        syncWorkouts,
        refreshFromDb,
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