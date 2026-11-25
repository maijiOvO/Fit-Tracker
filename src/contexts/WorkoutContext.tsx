import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef, ReactNode } from 'react';
import { WorkoutSession } from '../../types';
import { db, dbWriteFailing } from '../../services/db';
import { clearLocalLoss, readLocalLoss, recordLocalWorkouts } from '../../services/localCensus';
import { scheduleDebouncedFitlogPush } from '../../services/fitlogSyncScheduler';
import { scheduleAutoBackup } from '../../services/fitlogAutoBackup';
import { FITLOG_SOLO_USER_ID } from '../../services/fitlogSolo';
import { lastUsedGym } from '../utils/gyms';
import { storage } from '../../services/appStorage';
import { undoJournal } from '../../services/undoJournal';
import { getDataEnv } from '../../services/appEnv';
import { ENV_SWITCHED_EVENT } from '../../services/fitlogRemoteSync';
import { createWorkbenchSaver, findInProgress, isStale, lastChangeMs, staleRows } from '../../services/workbenchPersist';
import { recordTombstone } from '../../services/fitlogTombstones';
import { hasUserInput, toRecorded } from '../utils/workbench';
import { useUserSettingsContext } from './UserSettingsContext';
import { Language } from '../../types';

/** 自动收尾的场里带计划的：App 听这个事件把计划标完成（WorkoutProvider 包在 ScheduleProvider 外面，拿不到计划） */
export const WORKOUTS_SETTLED_EVENT = 'fitlog:workouts-settled';
export interface SettledLink {
  scheduleId: string;
  workoutId: string;
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
  /** 工作台是空的时候，把库里最近一场进行中的训练接回来（启动时自动跑一次；冷启动接回之前就进了编辑的，退出编辑时再跑） */
  restoreInProgress: () => Promise<void>;
  /**
   * 工作台上此刻正在练的那场（有 id、有动作、不是编辑草稿、不在整份改写或结束写库中），没有就 null。
   * 换掉或改写工作台之前读它，不读渲染闭包里的 currentWorkout：接回、撤销可能在点按之后才落定（上架审查 C05 / C06）
   */
  getLiveWorkbench: () => WorkoutSession | null;
  /** 换工作台：先同步写 ref 再 setState，紧接着的 getLiveWorkbench / 自动落盘读到的就是新的这场 */
  replaceWorkbench: (next: WorkoutSession) => void;
  /** 启动读库、收尾、接回都落定了（读不出也算落定）。开练入口先等它，免得在接回之前把进行中的那场顶掉（C06） */
  whenHydrated: () => Promise<void>;
  /**
   * 整份改写本机（覆盖恢复 / 重置）时工作台这场跟着丢（2026-11-14 用户定，编辑旧训练的草稿也一样）：
   * 改写期间停掉自动落盘，成功后清空工作台；改写失败（已换回原样）照常放开，工作台原样留着。
   */
  discardWorkbenchWith: <T,>(overwrite: () => Promise<T>) => Promise<T>;
  /**
   * 撤销恢复 / 导入 / 重置时工作台这场留着（上架审查 C62，和 discardWorkbenchWith 对称）：停掉自动落盘，
   * 把工作台上能落盘的那场（有 id、有动作、不是编辑草稿）交给 overwrite 一起写进去；重载后照常接回来。
   * 改写失败照常放开。
   */
  keepWorkbenchWith: <T,>(overwrite: (live: WorkoutSession | undefined) => Promise<T>) => Promise<T>;
  /**
   * 工作台上这场要被换掉（复制为今天、从计划开始、继续另一场）：先按入册口径替它收尾，
   * 结束时刻取最后一次改动；没人动过的直接删掉。不清工作台，由调用方换上新的。编辑草稿不碰。
   */
  settleWorkbench: () => Promise<void>;
  /**
   * 收掉过期的未结束场（上架审查 C01–C03）：工作台那场闲置满 12 小时就收尾并清空工作台，库里其余过期的一起收。
   * 返回工作台这场是不是被收掉了（FAB「回到训练」据此改成开新的一场）。
   */
  settleStale: () => Promise<boolean>;
  /**
   * 启动时从本机库读训练：loading 读着、ready 读到了、error 读不出（上架审查 C14）。
   * 读不出时首页不能显示成全新用户的空状态（数据其实还在库里）；读着的时候也不闪「还没有训练记录」。
   */
  hydration: 'loading' | 'ready' | 'error';
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
  /** 这一份该不该自动落盘：有 id、有动作、不是编辑草稿、不在结束写库中、还在接它来的那个环境 */
  /** 整份改写进行中（见 discardWorkbenchWith）：这时落一次盘，会把被改写掉的那场写回新库、还不挂墓碑 */
  const frozenRef = useRef(false);
  /**
   * 正在结束写库的那场（上架审查 C94）：写库期间工作台照样能改，这时落一次盘会把刚写成的已结束记录整行盖回未结束。
   * 结束写库失败时放开；成功后等 replaceWorkbench 换上别的 id 才放开（继续这场 / 撤销把同一 id 放回工作台时照常落盘）
   */
  const finishingIdRef = useRef<string | null>(null);
  const shouldAutoPersist = (w: WorkoutSession) =>
    !frozenRef.current &&
    w.id !== finishingIdRef.current &&
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

  const replaceWorkbench = useCallback((next: WorkoutSession) => {
    if (next.id !== finishingIdRef.current) finishingIdRef.current = null;
    currentWorkoutRef.current = next;
    setCurrentWorkout(next);
  }, []);

  const [hydration, setHydration] = useState<'loading' | 'ready' | 'error'>('loading');
  const hydratedRef = useRef<{ promise: Promise<void>; resolve: () => void } | null>(null);
  if (!hydratedRef.current) {
    let resolve = () => {};
    const promise = new Promise<void>(r => (resolve = r));
    hydratedRef.current = { promise, resolve };
  }
  const whenHydrated = useCallback(() => hydratedRef.current!.promise, []);

  /** 读成了返回 true。失败只打日志不抛：结束训练存成功之后刷新失败，不能报成「结束训练失败」 */
  const refreshFromDb = useCallback(async (): Promise<boolean> => {
    try {
      const localWorkouts = await db.getAll<WorkoutSession>('workouts');
      setWorkouts(
        localWorkouts.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
      );
      return true;
    } catch (err) {
      console.error('[WorkoutContext] 刷新训练列表失败:', err);
      return false;
    }
  }, []);

  /** 工作台空着时接回进行中的那场。只接一次性的：已经有内容就不碰 */
  const restoreInProgress = useCallback(async () => {
    if ((currentWorkoutRef.current.exercises?.length ?? 0) > 0) return;
    try {
      const hit = findInProgress(await db.getAll<WorkoutSession>('workouts'), readActiveId());
      if (hit && (currentWorkoutRef.current.exercises?.length ?? 0) === 0) {
        const prev = currentWorkoutRef.current;
        // 接回来不算「动过」：库里已经是这个样子，接回本身不刷新 updatedAt
        saverRef.current!.adopt(hit);
        // 同步写 ref：接回落定之后紧接着的开练复查（getLiveWorkbench）要看得到这场；下面 rebaseSource 也读 ref
        replaceWorkbench(hit);
        // 接回落定前碰了屏、开着的那一步：接回是系统做的，不算用户这一步的改动（上架审查 C07）
        undoJournal.rebaseSource('currentWorkout', prev);
      }
    } catch (err) {
      console.error('[WorkoutContext] 接回进行中的训练失败:', err);
    }
  }, [replaceWorkbench]);

  const { lang } = useUserSettingsContext();
  const isCnRef = useRef(lang === Language.CN);
  isCnRef.current = lang === Language.CN;

  /**
   * 替一场没点结束的训练收尾：动过、有可入册的组就按入册口径写成结束的一场（结束时刻＝最后改动）；
   * 否则删行写墓碑。返回带计划的那条关联，没有就 null。只写库，不动工作台。
   */
  const settleOne = async (w: WorkoutSession, lastChange: number): Promise<SettledLink | null> => {
    const rec = hasUserInput(w.exercises) ? toRecorded(w, { isCn: isCnRef.current, scheduleId: w.fromSchedule?.scheduleId }) : null;
    if (!rec) {
      await db.delete('workouts', w.id);
      recordTombstone('workouts', w.id);
      return null;
    }
    const at = new Date(lastChange).toISOString();
    await db.save('workouts', { ...rec, status: 'completed', finishedAt: at, updatedAt: new Date().toISOString() });
    return rec.fromSchedule ? { scheduleId: rec.fromSchedule.scheduleId, workoutId: rec.id } : null;
  };

  /** 收尾写过库之后：刷新列表、推送、补备份（从不点结束的人也能等到首次备份引导），带计划的交给 App 标完成 */
  const afterSettle = async (links: SettledLink[]) => {
    await refreshFromDb();
    scheduleDebouncedFitlogPush();
    scheduleAutoBackup();
    if (links.length) window.dispatchEvent(new CustomEvent<SettledLink[]>(WORKOUTS_SETTLED_EVENT, { detail: links }));
  };

  /** 工作台上这场是正在练的（不是编辑草稿、不在整份改写中）：返回它，否则 null */
  const liveWorkbench = useCallback((): WorkoutSession | null => {
    const w = currentWorkoutRef.current;
    return shouldAutoPersist(w) ? w : null;
  }, []);

  const settleWorkbench = useCallback(async () => {
    const w = liveWorkbench();
    if (!w) return;
    try {
      const link = await settleOne(w, saverRef.current!.lastChange(w.id) ?? Date.now());
      await afterSettle(link ? [link] : []);
    } catch (err) {
      console.error('[WorkoutContext] 收尾被换下的训练失败:', err);
    }
  }, [refreshFromDb]);

  const settleStale = useCallback(async (): Promise<boolean> => {
    const links: SettledLink[] = [];
    let wrote = false;
    let benchSettled = false;
    try {
      const w = liveWorkbench();
      if (w) {
        const last = saverRef.current!.lastChange(w.id) ?? lastChangeMs(w);
        if (isStale(last)) {
          const link = await settleOne(w, last);
          if (link) links.push(link);
          const empty = createEmptyWorkout();
          currentWorkoutRef.current = empty;
          setCurrentWorkout(empty);
          wrote = benchSettled = true;
        }
      }
      const benchId = currentWorkoutRef.current.id;
      for (const row of staleRows(await db.getAll<WorkoutSession>('workouts'), benchId)) {
        const link = await settleOne(row, lastChangeMs(row));
        if (link) links.push(link);
        wrote = true;
      }
    } catch (err) {
      console.error('[WorkoutContext] 收尾过期的训练失败:', err);
    }
    if (wrote) await afterSettle(links);
    return benchSettled;
  }, [refreshFromDb]);

  // 启动：读库 → 收掉过期的未结束场 → 接回还在练的那场；读不出就是 error（首页显示「读不出本机数据」）
  useEffect(() => {
    void (async () => {
      const ok = await refreshFromDb();
      if (ok) {
        await settleStale();
        await restoreInProgress();
      }
      setHydration(ok ? 'ready' : 'error');
      // 读不出也要放行：否则所有开练入口一直等下去
      hydratedRef.current!.resolve();
    })();
  }, [refreshFromDb, settleStale, restoreInProgress]);

  // 之后任何一次读库失败（目标、计划、撤销日志……）也算：首页同样不能把读不出当成没数据
  useEffect(() => {
    const onReadFailed = () => setHydration('error');
    window.addEventListener('fitlog:db-read-failed', onReadFailed);
    return () => window.removeEventListener('fitlog:db-read-failed', onReadFailed);
  }, []);

  // 本机训练数的水位：读到了就记下；库被清空后恢复回来（覆盖恢复、自用版从 NAS 拉回）够数了就撤掉丢失标记（localCensus）
  useEffect(() => {
    if (hydration !== 'ready') return;
    recordLocalWorkouts(workouts.length);
    const loss = readLocalLoss();
    if (loss && workouts.length >= loss.expected) clearLocalLoss();
  }, [hydration, workouts]);

  // 回前台：进程活着时工作台那场也要会过期（C03），收掉之后工作台空了，库里若还有在练的照常接回
  useEffect(() => {
    const onVisible = () => {
      if (!document.hidden) void settleStale().then(restoreInProgress);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [settleStale, restoreInProgress]);

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
  // 写失败期间回到前台也补写一次：腾出空间后不用等下一次改动（saver 照原 updatedAt 重写没写成的那份，上架审查 C13）
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden || dbWriteFailing()) autoPersist();
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
    finishingIdRef.current = workout.id;
    try {
      await db.save('workouts', completed);
      // 刷新列表，确保 Timeline 立即反映
      await refreshFromDb();
      scheduleDebouncedFitlogPush();
      // 选过备份文件夹的话，写一份完整快照进去（卸载也不丢；没写成下次打开 / 回前台补，见 scheduleAutoBackup）
      scheduleAutoBackup();
    } catch (err) {
      console.error('[WorkoutContext] 结束训练保存失败:', err);
      finishingIdRef.current = null;
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

  const keepWorkbenchWith = useCallback(async <T,>(overwrite: (live: WorkoutSession | undefined) => Promise<T>): Promise<T> => {
    const w = currentWorkoutRef.current;
    const live = shouldAutoPersist(w) ? w : undefined;
    frozenRef.current = true;
    try {
      // 成功后不解冻：调用方紧接着整页重载，重载前那次落盘不该再写
      return await overwrite(live);
    } catch (err) {
      frozenRef.current = false;
      throw err;
    }
  }, []);

  const createNewWorkout = useCallback((): WorkoutSession => {
    const now = new Date().toISOString();
    // §12.11 场地默认沿用上一场：连着去同一个馆就永远不用碰那个控件。
    // workouts 已按 date 倒序，lastUsedGym 取第一条标过的；全空则不编。
    const gym = lastUsedGym(workouts);
    return {
      ...createEmptyWorkout(),
      id: Date.now().toString(),
      // date 和 startTime 取同一刻：createEmptyWorkout 自己另取一次 now，两者会差几毫秒
      date: now,
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
      getLiveWorkbench: liveWorkbench,
      replaceWorkbench,
      whenHydrated,
      discardWorkbenchWith,
      keepWorkbenchWith,
      settleWorkbench,
      settleStale,
      hydration,
    }),
    [workouts, currentWorkout, deleteWorkout, createNewWorkout, persistCurrentWorkout, finishWorkout, setDraftWorkoutId, saveEditedWorkout, refreshFromDb, restoreInProgress, liveWorkbench, replaceWorkbench, whenHydrated, discardWorkbenchWith, keepWorkbenchWith, settleWorkbench, settleStale, hydration],
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