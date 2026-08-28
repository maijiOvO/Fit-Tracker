import React, { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react';
import { WorkoutSession } from '../../types';
import { db } from '../../services/db';
import { scheduleDebouncedFitlogPush } from '../../services/fitlogSyncScheduler';
import { FITLOG_SOLO_USER_ID } from '../../services/fitlogSolo';
import { lastUsedGym } from '../utils/gyms';

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

  // 持有最新 currentWorkout 的 ref，避免闭包过期
  const currentWorkoutRef = useRef(currentWorkout);
  currentWorkoutRef.current = currentWorkout;

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

  useEffect(() => {
    void refreshFromDb();
  }, [uid, refreshFromDb]);

  // ==================== visibilitychange：后台保活 ====================
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) {
        const w = currentWorkoutRef.current;
        if (w.id && w.exercises && w.exercises.length > 0) {
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
      if (w.id && w.exercises && w.exercises.length > 0) {
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
    if (!w.id || !w.exercises || w.exercises.length === 0) return;
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
    } catch (err) {
      console.error('[WorkoutContext] 结束训练保存失败:', err);
      throw err;
    }
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