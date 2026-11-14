import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef, ReactNode } from 'react';
import { WorkoutSession } from '../../types';
import { db } from '../../services/db';
import { scheduleDebouncedFitlogPush } from '../../services/fitlogSyncScheduler';
import { scheduleAutoBackup } from '../../services/fitlogAutoBackup';
import { FITLOG_SOLO_USER_ID } from '../../services/fitlogSolo';
import { lastUsedGym } from '../utils/gyms';
import { storage } from '../../services/appStorage';
import { undoJournal } from '../../services/undoJournal';
import { getDataEnv } from '../../services/appEnv';
import { ENV_SWITCHED_EVENT } from '../../services/fitlogRemoteSync';
import { createWorkbenchSaver, findInProgress } from '../../services/workbenchPersist';

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

function createEmptyWorkout(): WorkoutSession {
  const now = new Date().toISOString();
  return {
    id: '',
    userId: FITLOG_SOLO_USER_ID,
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

  deleteWorkout: (id: string) => Promise<void>;

  setCurrentWorkout: React.Dispatch<React.SetStateAction<WorkoutSession>>;
  createNewWorkout: () => WorkoutSession;

  /**
   * 立即持久化 currentWorkout 到 IndexedDB。
   * 每次修改 exercises / sets 后调用，无 debounce；内容没变（同一个对象）不重写、不刷新 updatedAt。
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

  refreshFromDb: () => Promise<void>;
  /** 工作台是空的时候，把库里最近一场进行中的训练接回来（启动时自动跑一次；退出编辑旧训练后再跑） */
  restoreInProgress: () => Promise<void>;
  /**
   * 整份改写本机（覆盖恢复 / 重置）时工作台这场跟着丢（2026-11-14 用户定，编辑旧训练的草稿也一样）：
   * 改写期间停掉自动落盘，成功后清空工作台；改写失败（已换回原样）照常放开，工作台原样留着。
   */
  discardWorkbenchWith: <T,>(overwrite: () => Promise<T>) => Promise<T>;
}

const WorkoutContext = createContext<WorkoutContextType | undefined>(undefined);

export const WorkoutProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [workouts, setWorkouts] = useState<WorkoutSession[]>([]);
  const [currentWorkout, setCurrentWorkout] = useState<WorkoutSession>(() => createEmptyWorkout());

  // 持有最新 currentWorkout 的 ref，避免闭包过期
  const currentWorkoutRef = useRef(currentWorkout);
  currentWorkoutRef.current = currentWorkout;

  // 全局撤销（services/undoJournal.ts）：工作台那一场是状态源 —— 编辑旧训练时它只在内存里，不落盘
  useEffect(
    () =>
      undoJournal.registerSource('currentWorkout', {
        get: () => currentWorkoutRef.current,
        set: v => {
          currentWorkoutRef.current = v as WorkoutSession;
          setCurrentWorkout(v as WorkoutSession);
        },
      }),
    [],
  );
  useEffect(() => {
    undoJournal.touched();
  }, [currentWorkout]);

  /** 工作台上那份是编辑草稿时的 id：自动落盘的三条路都认它（见 setDraftWorkoutId） */
  const draftIdRef = useRef<string | null>(null);
  const setDraftWorkoutId = useCallback((id: string | null) => {
    draftIdRef.current = id;
  }, []);
  /**
   * 工作台这一份是从哪个数据环境接来的。切换环境（dev ⇄ prod，只在未锁定的构建里）时 setDataEnv 一翻转，
   * db 就改开另一个库，这时再落盘会把开发环境那场测试训练写进真实库（审查 Em0）—— 环境对不上就不写，
   * 等 ENV_SWITCHED_EVENT 把工作台换成新环境那边的。
   */
  const envRef = useRef(getDataEnv());
  /** 这一份该不该自动落盘：有 id、有动作、不是编辑草稿、还在接它来的那个环境 */
  /** 整份改写进行中（见 discardWorkbenchWith）：这时落一次盘，会把被改写掉的那场写回新库、还不挂墓碑 */
  const frozenRef = useRef(false);
  const shouldAutoPersist = (w: WorkoutSession) =>
    !frozenRef.current &&
    !!w.id && (w.exercises?.length ?? 0) > 0 && w.id !== draftIdRef.current && envRef.current === getDataEnv();
  const saverRef = useRef<ReturnType<typeof createWorkbenchSaver> | null>(null);
  saverRef.current ??= createWorkbenchSaver(w => db.save('workouts', w));
  /**
   * 自动落盘的三条路（改动即存、切后台、pagehide）共用：类似 sendBeacon 的 fire-and-forget，不阻塞；
   * 内容没变就不写（见 createWorkbenchSaver）
   */
  const autoPersist = () => {
    const w = currentWorkoutRef.current;
    if (!shouldAutoPersist(w)) return;
    markActive(w.id);
    saverRef.current!.save(w);
  };

  const refreshFromDb = useCallback(async () => {
    try {
      const localWorkouts = await db.getAll<WorkoutSession>('workouts');
      setWorkouts(
        localWorkouts.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
      );
    } catch (err) {
      console.error('[WorkoutContext] 刷新训练列表失败:', err);
    }
  }, []);

  /** 工作台空着时接回进行中的那场。只接一次性的：已经有内容就不碰 */
  const restoreInProgress = useCallback(async () => {
    if ((currentWorkoutRef.current.exercises?.length ?? 0) > 0) return;
    try {
      const hit = findInProgress(await db.getAll<WorkoutSession>('workouts'), readActiveId());
      if (hit && (currentWorkoutRef.current.exercises?.length ?? 0) === 0) {
        // 接回来不算「动过」：库里已经是这个样子，接回本身不刷新 updatedAt
        saverRef.current!.adopt(hit);
        setCurrentWorkout(hit);
      }
    } catch (err) {
      console.error('[WorkoutContext] 接回进行中的训练失败:', err);
    }
  }, []);

  useEffect(() => {
    void refreshFromDb().then(restoreInProgress);
  }, [refreshFromDb, restoreInProgress]);

  // 切换数据环境之后：工作台换成新环境那边进行中的那场（没有就空着）。旧环境那场在切换前已落盘，留在旧库里
  useEffect(() => {
    const onSwitched = () => {
      envRef.current = getDataEnv();
      const empty = createEmptyWorkout();
      currentWorkoutRef.current = empty;
      setCurrentWorkout(empty);
      void restoreInProgress();
    };
    window.addEventListener(ENV_SWITCHED_EVENT, onSwitched);
    return () => window.removeEventListener(ENV_SWITCHED_EVENT, onSwitched);
  }, [restoreInProgress]);

  // ==================== visibilitychange：后台保活 ====================
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) autoPersist();
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);

  // ==================== pagehide 兼容：后端页面隐藏时强制落盘 ====================
  useEffect(() => {
    const handlePageHide = () => autoPersist();
    window.addEventListener('pagehide', handlePageHide);
    return () => window.removeEventListener('pagehide', handlePageHide);
  }, []);

  /** 立即持久化 currentWorkout 到 IndexedDB（无 debounce；内容没变不写） */
  const persistCurrentWorkout = useCallback(() => autoPersist(), []);

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
      // 选过备份文件夹的话，写一份完整快照进去（卸载也不丢；没写成下次打开 / 回前台补，见 scheduleAutoBackup）
      scheduleAutoBackup();
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

  const deleteWorkout = useCallback(async (id: string) => {
    await db.delete('workouts', id);
    setWorkouts((prev) => prev.filter((w) => w.id !== id));
    if (currentWorkout.id === id) {
      setCurrentWorkout(createEmptyWorkout());
    }
    scheduleDebouncedFitlogPush();
  }, [currentWorkout.id]);

  const discardWorkbenchWith = useCallback(async <T,>(overwrite: () => Promise<T>): Promise<T> => {
    frozenRef.current = true;
    // 先摘掉「工作台上那一场」的标记：重载后 restoreInProgress 不再按 id 认它；改写失败就放回去
    const activeId = readActiveId();
    storage.removeItem(ACTIVE_WORKOUT_KEY);
    let result: T;
    try {
      result = await overwrite();
    } catch (err) {
      frozenRef.current = false;
      if (activeId) storage.setItem(ACTIVE_WORKOUT_KEY, activeId);
      throw err;
    }
    // 成功后不解冻：三个调用方紧接着都整页重载，重载前 pagehide 那次落盘也不该写
    draftIdRef.current = null;
    const empty = createEmptyWorkout();
    currentWorkoutRef.current = empty;
    setCurrentWorkout(empty);
    return result;
  }, []);

  const createNewWorkout = useCallback((): WorkoutSession => {
    const now = new Date().toISOString();
    // §12.11 场地默认沿用上一场：连着去同一个馆就永远不用碰那个控件。
    // workouts 已按 date 倒序，lastUsedGym 取第一条标过的；全空则不编。
    const gym = lastUsedGym(workouts);
    return {
      ...createEmptyWorkout(),
      id: Date.now().toString(),
      startTime: now,
      createdAt: now,
      updatedAt: now,
      ...(gym ? { gym } : {}),
    };
  }, [workouts]);

  // 父级重渲染（设置变了）时消费方不跟着全量重渲染（审查 F4）；currentWorkout 一变照样换新的，这是本意
  const value = useMemo<WorkoutContextType>(
    () => ({
      workouts,
      currentWorkout,
      deleteWorkout,
      setCurrentWorkout,
      createNewWorkout,
      persistCurrentWorkout,
      finishWorkout,
      setDraftWorkoutId,
      saveEditedWorkout,
      refreshFromDb,
      restoreInProgress,
      discardWorkbenchWith,
    }),
    [workouts, currentWorkout, deleteWorkout, createNewWorkout, persistCurrentWorkout, finishWorkout, setDraftWorkoutId, saveEditedWorkout, refreshFromDb, restoreInProgress, discardWorkbenchWith],
  );

  return <WorkoutContext.Provider value={value}>{children}</WorkoutContext.Provider>;
};

export const useWorkoutContext = (): WorkoutContextType => {
  const context = useContext(WorkoutContext);
  if (!context) {
    throw new Error('useWorkoutContext must be used within WorkoutProvider');
  }
  return context;
};