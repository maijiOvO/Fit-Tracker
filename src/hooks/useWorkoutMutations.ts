/**
 * 训练记录的增改删 + 计划训练联动 + 单组动作删除
 * v3: 移除 draft/completed 分流，简化结束训练逻辑
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Exercise, Language, SetLog, WorkoutSession } from '../../types';
import { db } from '../../services/db';
import { recordTombstone } from '../../services/fitlogTombstones';
import { scheduleDebouncedFitlogPush } from '../../services/fitlogSyncScheduler';
import { useWorkoutContext } from '../contexts/WorkoutContext';
import { useScheduleContext } from '../contexts/ScheduleContext';
import { useUserSettingsContext } from '../contexts/UserSettingsContext';
import { useUiOverlay } from '../contexts/UiOverlayContext';
import { useExercisePrefs } from '../contexts/ExercisePrefsContext';
import { appPrefsNow } from '../../services/appPrefs';
import { ExerciseCategory } from '../constants/exercises';
import { detectPRs, sessionSummary, stampsInUnit, PRHit } from '../utils/prDetect';
import { KG_TO_LBS } from '../constants';
import { groupExercises, hasDoneSets, newGroupId, normalizeGroups, recordedExercises, recordTally, refillDraft, toRecorded, upToPointer } from '../utils/workbench';
import { rowEdited, toGhostSets } from '../utils/setValues';
import { useLoadRounder, roundPrefill } from './useLoadRounder';
import { plateUnitOf } from '../utils/plates';
import { useGymScopedPR } from './useLoadKind';
import { fromSignedKg, signedKg, usesSignedLoad } from '../utils/load';
import { findLastAltGroup, findLastIn, vsLastSession, type LastHit, type VsSet } from '../utils/prefillSource';
import { sessionDurationMin } from '../utils/sessionDuration';
import { cardSourceFor, switchedCardIdentity } from '../utils/liftIdentity';
import { isBackdated, redateLiveSession, sessionsBefore } from '../utils/sessionDate';
import { ENV_SWITCHED_EVENT } from '../../services/fitlogRemoteSync';
import { undoJournal } from '../../services/undoJournal';
import type { GymProfile } from '../utils/loadable';
import { planMergeIntoPrevious } from '../utils/sessionMerge';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';
/** 选好馆之后铺出新的一场（gyms：刚存的馆档案，context 还没刷新） */
export type StartMaker = (gym: string | undefined, gyms?: Record<string, GymProfile>) => WorkoutSession;
/** 开练前检查过的结果：replaces＝问过、用户同意顶掉的那场进行中训练的 id（startAtGym 复查时只放行它） */
export interface StartPlan {
  make: StartMaker;
  replaces: string | null;
}
export type ActiveTab = 'dashboard' | 'new' | 'plan' | 'profile';

/**
 * 结束训练后多久之内，再开新训练要先问一句「是不是刚才那场」。
 *
 * 起因是真事：8/26 有一场训练在误点结束 15 秒后重开，被拆成了两场，
 * 最后靠手工改库合回去。10 分钟是「组间休息 + 走到下一台器械」的上限，
 * 超过这个时间再开练，当作新的一场是合理默认。
 *
 * ⚠️ 这一条不违反 §12.5 通则 3（破坏性操作用先执行 + 撤销）——
 * 通则管的是【已经产生的东西被毁掉】，这里管的是【错误的数据被产生出来】：
 * 拆场之后两场各自都是「正常记录」，事后没有任何信号能自动认出它们本是一场。
 * 挡在产生之前，比事后给撤销便宜得多。
 */
export const RESUME_WINDOW_MS = 10 * 60 * 1000;


/** 键排好序、去掉 undefined 和 ghost:false 的 JSON：工作台改了又改回去时，对象的键序 / 显式 false 会变，内容没变 */
function stableJson(v: unknown): string {
  return JSON.stringify(v, (k, val) => {
    if (k === 'ghost' && !val) return undefined;
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      return Object.fromEntries(Object.keys(val).sort().map(key => [key, (val as Record<string, unknown>)[key]]));
    }
    return val;
  });
}

/** 编辑旧训练「改没改」的比较键：只看会进库的东西（recordedExercises） */
function editKey(w: WorkoutSession): string {
  return stableJson({
    title: w.title ?? '',
    date: w.date,
    gym: w.gym ?? null,
    notes: w.notes ?? '',
    tags: w.tags ?? [],
    exercises: recordedExercises(w.exercises),
  });
}

export interface UseWorkoutMutationsParams {
  setActiveTab: (tab: ActiveTab) => void;
  /** 返回当前的 previousTab（用于「返回」按钮回到来源页） */
  getPreviousTab: () => ActiveTab;
  /** 进入「编辑历史训练」时的副作用钩子；focusExerciseId：从纪录详情进来的，编辑页滚到这个动作 */
  onEnterEditWorkout?: (focusExerciseId?: string) => void;
  /** 触发 persist（由 App.tsx 注入，避免循环依赖） */
  onPersist?: () => void;
}

/** 刊末页要显示的东西。结束训练时一次算好，避免组件里再摸一遍数据。 */
export interface ColophonState {
  issueNo: number;
  title: string;
  dateISO: string;
  exerciseCount: number;
  setCount: number;
  /** 练了多少分钟；补记 / 忘了结束的场算不出就不显示（sessionDurationMin） */
  durationMin: number | null;
  volume: number;
  unitLabel: string;
  stamps: PRHit[];
  extraCount: number;
  /** 没破纪录时的「比上次」：每个动作这场与上一场的最好一组（带符号 kg，显示时再换单位）；破了纪录就是空的 */
  vsLast: { name: string; signed: boolean; now: VsSet; last: VsSet }[];
}

export interface UseWorkoutMutationsResult {
  saveStatus: SaveStatus;

  editingWorkoutId: string | null;
  setEditingWorkoutId: React.Dispatch<React.SetStateAction<string | null>>;

  /** 编辑旧训练时，草稿和进来时的原样不一样（只在编辑态为 true；新训练每一下都已自动保存） */
  hasUnsavedChanges: boolean;

  /** 刊末页数据。§9：非 PR 日也必须有收尾，所以每次结束训练都会有值。 */
  colophon: ColophonState | null;
  dismissColophon: () => void;
  /**
   * 结束训练。askFirst=false：训练页的「确认结束」已经是二次确认，不再弹框；
   * 首页「进行中 → 结束」那条路（askFirst 默认 true）仍问一句。一组都没做完时两条路都问「放弃？」。
   */
  handleFinishWithConfirmation: (askFirst?: boolean) => Promise<void>;
  /** 训练页顶栏改这场的日期时间：旧训练只改 date；训练中的场挪到那个时刻＝补录（见 redateLiveSession） */
  changeWorkoutDate: (date: Date) => void;

  handleEditWorkout: (
    workoutId: string,
    options?: { scrollToPicker?: boolean; focusExerciseId?: string },
  ) => void;
  handleAddExerciseToPastWorkout: (workoutId: string) => void;
  handleNewWorkoutBack: () => Promise<void>;
  handleDeleteWorkout: (workoutId: string) => Promise<void>;
  /** §12.8 菜单项「并入上一场」：把这场的动作追加到紧邻的前一场，本场删除，可撤销 */
  handleMergeIntoPrevious: (workoutId: string) => Promise<void>;
  /**
   * §12.8 菜单项「复制为今天的训练」：整场结构铺成底稿进工作台（§12.6 语义）。
   * 只做检查和确认，返回「选好馆之后怎么铺这一场」和同意顶掉的那场；App 交给 startAtGym（先选馆，审查 A12）。null＝不开。
   */
  handleCopyWorkoutToToday: (workoutId: string) => Promise<StartPlan | null>;
  handleDeleteExerciseRecord: (e: React.MouseEvent, workoutId: string, exerciseId: string) => Promise<void>;

  /** 从计划开练：同上，返回选好馆之后怎么铺这一场（App 交给 startAtGym）；null＝不开 */
  handleStartScheduledSession: (scheduleId: string) => Promise<StartPlan | null>;

  /**
   * 开新训练前的防误结束拆场闸门（FAB / 案头两个入口共用）。
   * 10 分钟内刚结束过一场就先问「继续刚才的『XX』？」，
   * 选继续＝恢复那一场回工作台，选否＝执行 proceed() 走正常新建。
   */
  startWorkoutGuarded: (proceed: () => void) => Promise<void>;
  /** 把一场已结束的训练接回工作台（时间线「继续这场」） */
  resumeWorkout: (w: WorkoutSession) => Promise<void>;
  /** 进入 new tab 后是否滚到 ExercisePicker（用于"补加动作"快捷入口） */
  pendingScrollToPicker: boolean;
  setPendingScrollToPicker: React.Dispatch<React.SetStateAction<boolean>>;

  /** 给计划训练保存后回写日程状态使用，由调用方在 useEffect 中触发 */
  activeScheduleIdRef: React.MutableRefObject<string | null>;
  /** 刚结束的那场按计划练的：哪条计划、哪场训练（App 的 effect 把计划标成完成后清掉） */
  pendingScheduleCompletion: React.MutableRefObject<{ scheduleId: string; workoutId: string } | null>;
  /** 「继续这场」接回来的训练 id：删光动作时不整场删 */
  resumedWorkoutIdsRef: React.MutableRefObject<Set<string>>;
  /** 切换一张卡的练法（第 8 条）；undefined＝标准 */
  switchExerciseVariant: (exerciseId: string, variantId: string | undefined, name?: string) => void;
  /**
   * 添加动作到当前训练。opts.altGroup：加进这个交替组（交替组卡的「加一个动作」）——
   * 本场已经有这个动作的单独卡片就把那张并进来，已经在组里就不重复加。
   * opts.variantId：直接用这个做法（细分格里点的是某个做法的小卡）。
   */
  addExerciseToWorkout: (
    ex: { id: string; name: { en: string; cn: string }; category?: ExerciseCategory; exerciseConfig?: any },
    opts?: { altGroup?: string | null; variantId?: string; altFrom?: LastHit; replaceIds?: string[]; onCreated?: (ids: string[], partnerNames: string[]) => void },
  ) => string;
}

export function useWorkoutMutations({
  setActiveTab,
  getPreviousTab,
  onEnterEditWorkout,
  onPersist,
}: UseWorkoutMutationsParams): UseWorkoutMutationsResult {
  const workoutCtx = useWorkoutContext();
  const scheduleCtx = useScheduleContext();
  const settingsCtx = useUserSettingsContext();
  const { confirm, choose, toast } = useUiOverlay();
  const { resolveName, getActiveMetrics, liftKey, variantsOf, variantIdOf, mergeAliasOf, signedLoadOf, seedMetricsIfUnset, findExerciseDef } = useExercisePrefs();
  /** 「杠铃片」馆档案：底稿按今天的馆和单位就近取整（docs/design-plates.md §3） */
  const rounderFor = useLoadRounder();
  const gymScoped = useGymScopedPR();

  const lang = settingsCtx.lang;
  const unit = settingsCtx.unit;
  const isCn = lang === Language.CN;

  const { workouts, currentWorkout, setCurrentWorkout, deleteWorkout, refreshFromDb, finishWorkout: ctxFinishWorkout } =
    workoutCtx;
  /** 今天这一场记的馆：底稿 / 换做法按它的档案取整 */
  const gymNow = currentWorkout.gym;

  const [colophon, setColophon] = useState<ColophonState | null>(null);
  const dismissColophon = useCallback(() => setColophon(null), []);

  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [editingWorkoutId, setEditingWorkoutId] = useState<string | null>(null);
  const [pendingScrollToPicker, setPendingScrollToPicker] = useState(false);

  const activeScheduleIdRef = useRef<string | null>(null);
  /**
   * 「继续这场」接回来的训练 id。它们里面有真正练过的组，删光动作时不能像新训练那样整场删掉
   * （App.tsx onDeleteExerciseFromSession）。resumeWorkout 会剥掉 finishedAt，数据上分不出来，只能记在这里。
   */
  const resumedWorkoutIdsRef = useRef<Set<string>>(new Set());
  const pendingScheduleCompletion = useRef<{ scheduleId: string; workoutId: string } | null>(null);

  /**
   * 删掉的这场训练完成过计划：计划退回「计划中」（审查 A21：原来计划还标着完成、指着一场不存在的训练）。
   * relinkTo：这场是并进了别的训练（并入上一场），计划改指那一场、照旧算完成。返回撤销用的还原。
   */
  const unlinkPlanOf = useCallback(
    (workoutId: string, relinkTo?: string): (() => void) | null => {
      const hits = scheduleCtx.schedules.filter(s => s.linkedWorkoutId === workoutId);
      if (!hits.length) return null;
      const stamp = new Date().toISOString();
      for (const s of hits) {
        void scheduleCtx.updateSchedule(
          relinkTo
            ? { ...s, linkedWorkoutId: relinkTo, updatedAt: stamp }
            : { ...s, status: 'planned', linkedWorkoutId: undefined, updatedAt: stamp },
        );
      }
      return () => {
        const again = new Date().toISOString();
        for (const s of hits) void scheduleCtx.updateSchedule({ ...s, updatedAt: again });
      };
    },
    [scheduleCtx],
  );

  /**
   * 编辑旧训练：进来时那场的原样（存的是比较键）。工作台上改的是一份深拷贝的草稿，
   * 库里只在「保存修改」时写（edit-history-cannot-discard）；返回时「放弃修改」就是什么都不写。
   * 深拷贝是因为工作台有些改动仍是原地写对象（set-update-mutates-shared-objects），浅拷贝会连 workouts 里的原场次一起改掉。
   */
  const editOriginalRef = useRef<{ id: string; key: string } | null>(null);

  // 全局撤销：「在编辑哪一场」跟工作台那一场一起撤（services/undoJournal.ts）。
  // 只撤工作台、不撤这个，会把进行中的那场当成编辑草稿去「保存修改」。
  // stash 一起撤：撤回「进编辑 / 保存修改」时，退出编辑要放回的那场也回到当时的样子
  type EditMode = { id: string | null; original: { id: string; key: string } | null; stash: WorkoutSession | null };
  /**
   * 进编辑时被换下工作台的那场进行中训练（上架审查 gap-r3-1#1）：退出编辑时同步放回。
   * 原来先放一场空训练、再异步整表读库接回，空档里点开练会把它顶掉
   */
  const benchStashRef = useRef<WorkoutSession | null>(null);
  const editModeRef = useRef<EditMode>({ id: null, original: null, stash: null });
  if (editModeRef.current.id !== editingWorkoutId)
    editModeRef.current = { id: editingWorkoutId, original: editOriginalRef.current, stash: benchStashRef.current };
  useEffect(
    () =>
      undoJournal.registerSource('editMode', {
        get: () => editModeRef.current,
        set: v => {
          const m = v as EditMode;
          editModeRef.current = m;
          editOriginalRef.current = m.original;
          benchStashRef.current = m.stash;
          workoutCtx.setDraftWorkoutId(m.id);
          setEditingWorkoutId(m.id);
        },
      }),
    [],
  );

  // 草稿 id 交给 WorkoutContext，自动落盘的几条路（改动即存、切后台、pagehide）都跳过它。
  // handleEditWorkout 里也同步设一次：等这个 effect 跑之前，App 的自动落盘 effect 可能先跑。
  useEffect(() => {
    workoutCtx.setDraftWorkoutId(editingWorkoutId);
    if (!editingWorkoutId) editOriginalRef.current = null;
  }, [editingWorkoutId, workoutCtx]);

  const hasUnsavedChanges = useMemo(() => {
    const orig = editOriginalRef.current;
    if (!editingWorkoutId || !orig || orig.id !== currentWorkout.id) return false;
    return editKey(currentWorkout) !== orig.key;
  }, [currentWorkout, editingWorkoutId]);

  /** 离开编辑态（保存完 / 放弃）：进来前在练的那场同步放回工作台，回到进来前的页面 */
  const exitEditing = useCallback(() => {
    const stash = benchStashRef.current;
    benchStashRef.current = null;
    workoutCtx.setDraftWorkoutId(null);
    editOriginalRef.current = null;
    setEditingWorkoutId(null);
    const prev = getPreviousTab();
    setActiveTab(prev === 'new' ? 'dashboard' : prev);
    if (stash) {
      workoutCtx.replaceWorkbench(stash);
      // 编辑期间它可能已经闲置过期（库里那份已被收尾）：照回前台的口径再判一次，过期就收掉、不放回在练
      void workoutCtx.settleStale().then(() => workoutCtx.refreshFromDb());
      return;
    }
    // 冷启动接回之前就进了编辑：没有换下来的那场，照旧从库里接回
    workoutCtx.replaceWorkbench(workoutCtx.createNewWorkout());
    void workoutCtx.refreshFromDb().then(() => workoutCtx.restoreInProgress());
  }, [getPreviousTab, setActiveTab, workoutCtx]);

  /**
   * 切换数据环境（只在未锁定的构建里）时 WorkoutContext 把工作台换成新环境那边的场；编辑态得一起放掉，
   * 否则顶栏还写「编辑训练」，结束时会把新环境那场当成旧训练去「保存修改」（审查 Em0）
   */
  const { setDraftWorkoutId } = workoutCtx;
  useEffect(() => {
    const onSwitched = () => {
      setDraftWorkoutId(null);
      editOriginalRef.current = null;
      // 换下来的那场属于旧环境，退出编辑时不能放回新环境的工作台
      benchStashRef.current = null;
      setEditingWorkoutId(null);
    };
    window.addEventListener(ENV_SWITCHED_EVENT, onSwitched);
    return () => window.removeEventListener(ENV_SWITCHED_EVENT, onSwitched);
  }, [setDraftWorkoutId]);

  const changeWorkoutDate = useCallback(
    (date: Date) => {
      setCurrentWorkout(p => (editingWorkoutId ? { ...p, date: date.toISOString() } : redateLiveSession(p, date)));
      onPersist?.();
    },
    [editingWorkoutId, onPersist, setCurrentWorkout],
  );

  /**
   * 放弃进行中的这场：从库里删掉 + 写墓碑（防拉取复活），工作台清空。
   * 不留「N 动作 0 组」的空场在时间线里（workbench-not-restored 的连带后果）。
   */
  const discardCurrentWorkout = useCallback(async () => {
    const id = currentWorkout.id;
    setCurrentWorkout(workoutCtx.createNewWorkout());
    setEditingWorkoutId(null);
    activeScheduleIdRef.current = null;
    setActiveTab('dashboard');
    if (!id) return;
    try {
      await db.delete('workouts', id);
      recordTombstone('workouts', id);
      // 「继续这场」接回来的那场可能已挂在计划上（同 handleDeleteWorkout）；新开的场没挂，这里是空操作
      unlinkPlanOf(id);
      await refreshFromDb();
      scheduleDebouncedFitlogPush();
    } catch (err) {
      console.error('[useWorkoutMutations] 放弃训练失败:', err);
    }
  }, [currentWorkout.id, refreshFromDb, setActiveTab, setCurrentWorkout, unlinkPlanOf, workoutCtx]);

  /** 结束时卡上一个有数的组都没有：问一句再放弃（「放弃训练」在确认弹窗的例外名单里） */
  const confirmDiscard = useCallback(async () => {
    const ok = await confirm({
      message: isCn ? '还没有填数的组。放弃这场训练？' : 'No sets logged yet. Discard this workout?',
      confirmLabel: isCn ? '放弃' : 'Discard',
      cancelLabel: isCn ? '接着练' : 'Keep going',
      danger: true,
    });
    if (ok) await discardCurrentWorkout();
  }, [confirm, discardCurrentWorkout, isCn]);

  /**
   * 结束训练：标记 finishedAt → 写 DB → 清空 workbench → 跳转
   */
  /** upTo＝只存到指针：指针下面填了数、没点组号的组不入册（结束前用户选的，见 handleFinishWithConfirmation） */
  const finishWorkout = useCallback(async (upTo = false) => {
    setSaveStatus('saving');

    try {
      if (!currentWorkout.exercises || currentWorkout.exercises.length === 0) {
        setSaveStatus('idle');
        return;
      }

      const src = upTo ? { ...currentWorkout, exercises: upToPointer(currentWorkout.exercises) } : currentWorkout;
      const cleanedExercises = recordedExercises(src.exercises);

      if (cleanedExercises.length === 0) {
        setSaveStatus('idle');
        // 卡上一组有数的都没有：没有可入册的东西。编辑旧训练时只提示；新训练问一句要不要放弃这场（不留空场在库里）
        if (editingWorkoutId) {
          toast(isCn ? '没有组可保存；删整场请去时间线' : 'No sets left to save — delete the whole workout from the timeline', 'info');
          return;
        }
        await confirmDiscard();
        return;
      }

      // 编辑旧训练＝保存修改：只写库，finishedAt / status / 期号都不动，不出刊末页，也不挂计划
      // （edit-history-end-semantics：原先这里会把 finishedAt 改成现在，接着「继续刚才那场」就指向这场旧训练）
      if (editingWorkoutId) {
        await workoutCtx.saveEditedWorkout({ ...currentWorkout, exercises: cleanedExercises });
        setSaveStatus('idle');
        toast(isCn ? '已保存' : 'Saved', 'success');
        exitEditing();
        return;
      }

      // 计划关联：开练时记在这场上的 fromSchedule 为准（App 被回收后接回来的也认得），ref 兜旧数据
      const scheduleId = currentWorkout.fromSchedule?.scheduleId ?? activeScheduleIdRef.current;
      // 和自动收尾（WorkoutContext.settle*）同一个口径；上面已经判过有可入册的组
      const finalWorkout = toRecorded(src, { isCn, scheduleId })!;

      // PR 判定必须在写库【之前】算：写完之后 workouts 里就含本场了，
      // 拿它当「历史」会把自己和自己比，永远不可能破纪录。
      // 只和这场日期之前的比（补录到过去的场不能和它之后练的比），和按动作历史逐场判纪录同一口径
      const earlier = sessionsBefore(workouts, finalWorkout);
      const pr = detectPRs({
        session: finalWorkout,
        history: earlier,
        editingWorkoutId,
        resolveName,
        keyOf: liftKey,
        getActiveMetrics,
        unitLabel: unit,
        isSigned: ex => usesSignedLoad(ex, signedLoadOf(ex)),
        gymScoped,
      });
      // 「比上次」（D6）：上一场按底稿的口径找（同做法，器械本馆优先），在写库之前找，免得找到这场自己
      const isSignedEx = (ex: Exercise) => usesSignedLoad(ex, signedLoadOf(ex));
      const vsLast = pr.stamps.length
        ? []
        : vsLastSession(
            finalWorkout.exercises,
            ex =>
              findLastIn(earlier, resolveName, variantIdOf, ex.name, variantIdOf(ex) ?? '', finalWorkout.id,
                finalWorkout.gym && gymScoped(ex) ? finalWorkout.gym : undefined),
            isSignedEx,
          ).map(r => {
            const ex = finalWorkout.exercises.find(e => e.id === r.exId)!;
            return { name: resolveName(ex.name), signed: isSignedEx(ex), now: r.now, last: r.last };
          });
      const summary = sessionSummary(finalWorkout);
      const volume = unit === 'lbs' ? summary.volumeKg * KG_TO_LBS : summary.volumeKg;
      // ctxFinishWorkout 才写 finishedAt；刊末页要的就是「到现在为止」，口径和时间线一致（补录的场没有 startTime，不显示）
      const durationMin = sessionDurationMin({ ...finalWorkout, finishedAt: new Date().toISOString() });

      await ctxFinishWorkout(finalWorkout);

      setColophon({
        // 期号＝这场之前有几场真正练过的训练 + 1（空场不算；补录的场按日期排进去）
        issueNo: earlier.filter(hasDoneSets).length + 1,
        title: finalWorkout.title,
        dateISO: finalWorkout.date,
        exerciseCount: summary.exerciseCount,
        setCount: summary.setCount,
        durationMin,
        volume,
        unitLabel: unit,
        stamps: stampsInUnit(pr.stamps, unit, KG_TO_LBS),
        extraCount: pr.extraCount,
        vsLast,
      });

      // 回写要的是刚结束的这一场（plan-session-leaks-schedule-id：原来拿 workouts[0]，可能是别的场），
      // 计划关联在这里就交出去：哪怕回写时计划已被删，也不会挂到下一场上
      if (scheduleId) {
        pendingScheduleCompletion.current = { scheduleId, workoutId: finalWorkout.id };
      }
      activeScheduleIdRef.current = null;

      setSaveStatus('saved');

      // 换上别的 id 才放开结束写库期间的落盘闸（WorkoutContext finishingIdRef，上架审查 C94）
      workoutCtx.replaceWorkbench(workoutCtx.createNewWorkout());
      setActiveTab('dashboard');
      setEditingWorkoutId(null);
      setTimeout(() => {
        setSaveStatus('idle');
      }, 1200);
    } catch (error) {
      console.error('[useWorkoutMutations] 结束训练失败:', error);
      setSaveStatus('error');
      toast(isCn ? '结束训练失败' : 'Failed to end workout', 'error');
    }
  }, [
    currentWorkout,
    isCn,
    setActiveTab,
    setCurrentWorkout,
    toast,
    workoutCtx,
    ctxFinishWorkout,
    workouts,
    editingWorkoutId,
    resolveName,
    liftKey,
    getActiveMetrics,
    unit,
    signedLoadOf,
    variantIdOf,
    gymScoped,
    confirmDiscard,
    exitEditing,
  ]);

  const handleFinishWithConfirmation = useCallback(async (askFirst = true) => {
    // 卡上有数的组全部入册，不论点没点过组号（2026-11 用户定，recordedExercises）；指针没到底时先问存全部还是存到指针（见下）。

    // 编辑旧训练：「保存修改」不用确认
    if (editingWorkoutId) {
      if (!hasUnsavedChanges) return;
      await finishWorkout();
      return;
    }

    // 卡上一个有数的组都没有：直接问要不要放弃这场（不留空场在库里）
    if (recordedExercises(currentWorkout.exercises).length === 0) {
      await confirmDiscard();
      return;
    }

    /**
     * 指针没到底：有填了数、没点组号的组（上架审查 C20，2026-11-24 用户定）。规则照旧「录入了就算练了」，
     * 但结束前问一句：全部保存，还是只存到指针。指针到底（没有这种组）照旧，不问。
     * 这一问替掉首页「结束这场训练？」那一问（它也有「接着练」），不叠两个弹窗。
     */
    const { sets, below } = recordTally(currentWorkout.exercises);
    if (below > 0) {
      const done = sets - below;
      const pick = await choose({
        title: isCn ? `还有 ${below} 组在指针下面` : `${below} set${below > 1 ? 's' : ''} below the bookmark`,
        message: isCn ? '这些组填了数、还没点组号。' : "They have numbers but weren't tapped done.",
        choices: [
          { key: 'all', label: isCn ? `全部保存（${sets} 组）` : `Save all (${sets})`, testId: 'finish-save-all' },
          ...(done > 0 ? [{ key: 'pointer', label: isCn ? `只存到指针（${done} 组）` : `Save up to bookmark (${done})`, testId: 'finish-save-to-pointer' }] : []),
        ],
        cancelLabel: isCn ? '接着练' : 'Keep going',
      });
      if (!pick) return;
      await finishWorkout(pick === 'pointer');
      return;
    }

    if (askFirst) {
      const ok = await confirm({
        // 2026-10-11：去掉「当前单位设置」「将被添加到历史记录」两行 —— 都是常识，每场都读一遍是噪音
        message: isCn ? '结束这场训练？' : 'End this workout?',
        confirmLabel: isCn ? '结束训练' : 'End workout',
      });
      if (!ok) return;
    }
    await finishWorkout();
  }, [choose, confirm, confirmDiscard, currentWorkout.exercises, editingWorkoutId, finishWorkout, hasUnsavedChanges, isCn]);

  const handleEditWorkout = useCallback(
    (workoutId: string, options?: { scrollToPicker?: boolean; focusExerciseId?: string }) => {
      const workoutToEdit = workouts.find(w => w.id === workoutId);
      if (workoutToEdit) {
        // 工作台上还有进行中的一场：记下来，退出编辑时同步放回（exitEditing）；说一声，别让人以为丢了。
        // 已经在编辑另一场时不换：放回的仍是最初换下来的那场
        if (!editingWorkoutId) benchStashRef.current = workoutCtx.getLiveWorkbench();
        if (!editingWorkoutId && hasDoneSets(currentWorkout)) {
          toast(isCn ? '进行中的训练已暂存，退出编辑后接回' : 'Your workout in progress is saved; it comes back after editing', 'info');
        }
        // 先设草稿 id 再换工作台：App 的自动落盘 effect 不能先把这份写回库
        workoutCtx.setDraftWorkoutId(workoutId);
        editOriginalRef.current = { id: workoutId, key: editKey(workoutToEdit) };
        workoutCtx.replaceWorkbench(structuredClone(workoutToEdit));
        setEditingWorkoutId(workoutId);
        setActiveTab('new');
        onEnterEditWorkout?.(options?.focusExerciseId);
        if (options?.scrollToPicker) {
          setPendingScrollToPicker(true);
        }
      }
    },
    [currentWorkout, editingWorkoutId, isCn, onEnterEditWorkout, setActiveTab, toast, workoutCtx, workouts],
  );

  const handleAddExerciseToPastWorkout = useCallback(
    (workoutId: string) => {
      handleEditWorkout(workoutId, { scrollToPicker: true });
    },
    [handleEditWorkout],
  );

  const handleNewWorkoutBack = useCallback(async () => {
    // 进行中的训练按返回＝只离开页面，工作台原样留着（workbench-not-restored）：
    // 想翻一眼时间线 / PR 是常事，回来点「回到训练」接着练。不再问「确定要返回吗」。
    if (!editingWorkoutId) {
      const prev = getPreviousTab();
      setActiveTab(prev === 'new' ? 'dashboard' : prev);
      void workoutCtx.refreshFromDb();
      return;
    }
    // 编辑旧训练：草稿从没写过库，返回＝放弃。真有改动才问一句
    if (hasUnsavedChanges) {
      const ok = await confirm({
        message: isCn ? '放弃这次的修改？' : 'Discard your changes?',
        confirmLabel: isCn ? '放弃修改' : 'Discard',
        cancelLabel: isCn ? '继续编辑' : 'Keep editing',
        danger: true,
      });
      if (!ok) return;
    }
    exitEditing();
  }, [confirm, editingWorkoutId, exitEditing, getPreviousTab, hasUnsavedChanges, isCn, setActiveTab, workoutCtx]);

  const handleDeleteWorkout = useCallback(
    async (workoutId: string) => {
      const w = workouts.find(x => x.id === workoutId);
      if (!w) return;
      const dateLabel = new Date(w.date).toLocaleDateString(isCn ? 'zh-CN' : 'en-US');
      // 删整场训练一律先确认（2026-10-25 用户定：有了全局撤销，只有删训练、清空账户留确认框；
      // 时间线长按菜单原来跳过确认、靠撤销条兜底，撤销条拆掉了）
      const ok = await confirm({
        message: isCn
          ? `删除 ${dateLabel} 的整场训练？`
          : `Delete the entire workout from ${dateLabel}?`,
        danger: true,
        confirmLabel: isCn ? '删除' : 'Delete',
      });
      if (!ok) return;
      try {
        await deleteWorkout(workoutId);
        // 立刻写墓碑（workout-delete-no-tombstone），和「并入上一场」同一个理由：
        // 推送没落地时，下次启动的拉取会把这场原样合并回来。全局撤销会把墓碑一起撤掉（它也进撤销日志）。
        // deleteWorkout 里的推送是防抖的，这一行同步执行，赶得上同一次推送。
        recordTombstone('workouts', workoutId);
        unlinkPlanOf(workoutId);
      } catch (err) {
        console.error('Delete workout failed:', err);
        toast(isCn ? '删除失败' : 'Delete failed', 'error');
      }
    },
    [confirm, deleteWorkout, isCn, toast, unlinkPlanOf, workouts],
  );

  /**
   * 并入上一场（§12.8 菜单项）—— 误结束拆场的事后补救。
   *
   * 把这场的动作追加到时间上紧邻的前一场，本场删除（挑目标、拼结果见 utils/sessionMerge）。
   * 合并后的那场从更早的 date 开始、到更晚的 finishedAt 结束，
   * 也就是「本来就该是的那一场」。前一场就是工作台上正在练的那场时，动作插在它第一张待做卡前面，
   * 合并结果放上工作台：只改库的话，工作台下一次落盘会整行盖回去，被并那场已删、墓碑已写，组就永久丢了（上架审查 C04）。
   *
   * ⚠️ 这里【立刻】写 tombstone，和 §12.5 通则 3「撤销窗口期内不写」相反，
   * 是因为两者的失败模式正好反过来：删除若没同步出去，最坏是「没删成」；
   * 合并若没同步出去，远端会把被并掉的那场原样推回来 —— 拆场复活，
   * 而且动作已经在前一场里了，变成整场重复。撤销时再把 tombstone 摘掉。
   */
  const handleMergeIntoPrevious = useCallback(
    async (workoutId: string) => {
      const w = workouts.find(x => x.id === workoutId);
      if (!w) return;
      const plan = planMergeIntoPrevious(workouts, w, workoutCtx.getLiveWorkbench());
      if (!plan) {
        toast(isCn ? '前面没有训练可并入' : 'No earlier workout to merge into', 'info');
        return;
      }
      try {
        // 先写合并后的那行，再换工作台：换上之后的自动落盘写的也是合并后的样子
        await db.save('workouts', plan.merged);
        if (plan.live) workoutCtx.replaceWorkbench(plan.merged);
        await db.delete('workouts', workoutId);
        recordTombstone('workouts', workoutId);
        unlinkPlanOf(workoutId, plan.into.id);
        await refreshFromDb();
        scheduleDebouncedFitlogPush();

        // 并到了哪一场在时间线上看不出来：说一声（点错了用顶栏的全局撤销）
        const intoName = plan.into.title || (isCn ? '未命名训练' : 'Untitled workout');
        toast(isCn ? `已并入「${intoName}」` : `Merged into "${intoName}"`, 'info');
      } catch (err) {
        console.error('Merge workout failed:', err);
        toast(isCn ? '并入失败' : 'Merge failed', 'error');
      }
    },
    [isCn, refreshFromDb, toast, unlinkPlanOf, workoutCtx, workouts],
  );

  /**
   * 这个动作（某个做法）最近一次练过的那一条，连同那一场。
   * preferGym：先找这个馆的，没有再退回任意馆（design-plates.md「换馆重量」A）。
   */
  const findLast = useCallback(
    (exerciseName: string, variantId?: string | null, skipWorkoutId?: string, preferGym?: string, before?: string) =>
      findLastIn(workouts, resolveName, variantIdOf, exerciseName, variantId, skipWorkoutId, preferGym, before),
    [resolveName, variantIdOf, workouts],
  );
  /** 本馆优先只给器械类（配重片 / 挂片）：真重量的器材抄最近一次，哪个馆都一样（审查 A11） */
  const preferGymFor = useCallback(
    (name: string, variantId: string | undefined, gym: string | undefined) =>
      gym && gymScoped({ id: '', name, category: 'STRENGTH', sets: [], ...(variantId ? { variantId } : {}) } as Exercise) ? gym : undefined,
    [gymScoped],
  );
  /**
   * 新卡的名字、做法和底稿来源（utils/liftIdentity.cardSourceFor）：计划里存的旧名是并入别名时卡名换成目标现名、
   * 做法显式写上；上一次的做法已经删了就按标准铺、抄标准的上一次。
   */
  const pickSource = useCallback(
    (name: string, variantId: string | undefined, skipWorkoutId?: string, preferGym?: string, before?: string) =>
      cardSourceFor({
        name,
        variantId,
        aliasOf: mergeAliasOf,
        resolveName,
        live: vid => variantsOf(name).some(v => v.id === vid),
        findLast: vid => findLast(name, vid, skipWorkoutId, preferGym, before),
        variantIdOf,
      }),
    [findLast, mergeAliasOf, resolveName, variantIdOf, variantsOf],
  );

  /** 按一条历史铺一张新卡（底稿 §12.6）；没练过就是一行空的待做 */
  const buildExercise = useCallback(
    (
      name: string,
      category: string,
      last: { ex: Exercise; workout: WorkoutSession } | null,
      exerciseTime: string,
      defConfig?: any,
      variant?: { id: string; name?: string },
      /** 按哪个馆取整（默认今天这一场的馆）；gyms：刚存的馆档案（选馆开练那一刻 context 还没刷新） */
      gym: string | undefined = gymNow,
      gyms?: Record<string, GymProfile>,
    ): Exercise => {
      const stamp = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      // 只抄开着的记录项：关掉的次数 / 重量不再藏在底稿里入册（上架审查 gap-2#2）
      const rawGhosts = last?.ex.sets?.length ? toGhostSets(last.ex.sets, stamp, getActiveMetrics(name)) : null;
      const vid = variant ? variant.id : last ? variantIdOf(last.ex) : undefined;
      const vname = variant
        ? variant.name || variantsOf(name).find(v => v.id === variant.id)?.name
        : last?.ex.variantName || (vid ? variantsOf(name).find(v => v.id === vid)?.name : undefined);
      // 只抄号（旧记录上的递增递减配置不再往下带，见 types.Exercise.instanceConfig）
      const instanceConfig = last?.ex.instanceConfig
        ? { bodyweightMode: last.ex.instanceConfig.bodyweightMode }
        : {
            // 只保留负重/辅助两个有语义的标记；'bodyweight' 折叠为标准
            bodyweightMode:
              defConfig?.bodyweightType === 'weighted' || defConfig?.bodyweightType === 'assisted'
                ? defConfig.bodyweightType
                : 'none',
          };
      // 「杠铃片」：底稿按今天的馆和单位就近取整，记下上一次的原值当参考（递减档一起）
      const ghostSets = rawGhosts
        ? roundPrefill(
            rawGhosts,
            { id: '', name, category, sets: rawGhosts, instanceConfig, ...(vid ? { variantId: vid } : {}) } as Exercise,
            rounderFor({ id: '', name, category, sets: rawGhosts, instanceConfig, ...(vid ? { variantId: vid } : {}) } as Exercise, gym, undefined, gyms),
          )
        : null;
      return {
        id: `exercise_${stamp}`,
        name,
        category: category || 'STRENGTH',
        // 做法沿用上次：底稿就是从那次抄的，两者必须是同一种做法
        ...(vid ? { variantId: vid, ...(vname ? { variantName: vname } : {}) } : {}),
        sets:
          ghostSets && ghostSets.length > 0
            ? ghostSets
            : // 没练过的新动作：第一行空着、从待做开始（第 4 条），点组号才算做完
              [{ id: `${stamp}_0`, weight: 0, reps: 0, ghost: true }],
        ...(ghostSets && ghostSets.length > 0 && last?.workout.date ? { prefillFrom: last.workout.date } : {}),
        // §12.11：记下底稿来源那一场的场地，**无条件记**。
        ...(ghostSets && ghostSets.length > 0 && last?.workout.gym ? { prefillGym: last.workout.gym } : {}),
        exerciseTime,
        instanceConfig,
      } as Exercise;
    },
    [variantIdOf, variantsOf, rounderFor, gymNow],
  );

  /**
   * 复制为今天的训练（§12.8 菜单项）—— 「上次那套，再来一遍」。
   *
   * 不发明新机制：动作与组数结构照抄，但每一组都以底稿铺下去
   * （§12.6 的 ghost + prefillFrom 全套语义），出处指向来源那一场。
   * 于是照抄仍是一组一击（点组号描实），而没描实的组结束训练时整行丢弃 ——
   * 复制永远不会替用户上报他没做的事。
   */
  const handleCopyWorkoutToToday = useCallback(
    async (workoutId: string): Promise<StartPlan | null> => {
      const src = workouts.find(x => x.id === workoutId);
      if (!src) return null;
      if (!(src.exercises ?? []).some(ex => (ex.sets ?? []).some(s => !s.ghost))) {
        toast(isCn ? '这场没有可复制的组' : 'Nothing to copy from this workout', 'info');
        return null;
      }

      // 工作台里还有没结束的一场时，复制会把它从工作台上顶掉 —— 这个没有撤销，先问一句。
      // 先等启动接回落定、读工作台此刻的样子：渲染闭包里可能还是接回之前的空场（上架审查 C06）
      await workoutCtx.whenHydrated();
      const live = workoutCtx.getLiveWorkbench();
      if (live) {
        const ok = await confirm({
          message: isCn
            ? '有一场训练还没结束，复制会先替它结束，记进时间线。'
            : 'A workout is still unfinished; copying will end it first and put it on the timeline.',
          confirmLabel: isCn ? '继续复制' : 'Copy anyway',
        });
        if (!ok) return null;
      }

      // 和 FAB 一样先选馆（App 的 startAtGym），选好再按那个馆取整铺底稿
      const make: StartMaker = (gym, gyms) => {
        const stamp = Date.now();
        // 交替组跟着复制，换新的组 id（同一个旧 id 映射到同一个新 id）
        const groupMap = new Map<string, string>();
        const regroup = (g?: string) => {
          if (!g) return undefined;
          if (!groupMap.has(g)) groupMap.set(g, newGroupId());
          return groupMap.get(g);
        };
        const base = workoutCtx.createNewWorkout();
        const targetGym = gym ?? base.gym;
        const exercises: Exercise[] = normalizeGroups((src.exercises || [])
          .map((ex, i) => {
            // 和新卡同一个口径（utils/liftIdentity.cardSourceFor）：旧名是并入别名就换成目标现名、做法写明；
            // 做法已经删了就回到标准，底稿改抄标准的上一次；标准没练过就留着复制来的组，标「确认一下重量」
            const alias = mergeAliasOf(ex.name);
            const name = alias ? resolveName(ex.name) : ex.name;
            const vid = variantIdOf(ex);
            const live = !!vid && variantsOf(ex.name).some(v => v.id === vid);
            const std = vid && !live ? findLast(ex.name, '') : null;
            const copied = toGhostSets(ex.sets, `${stamp}_${i}`, getActiveMetrics(ex.name));
            const from = std ? std.workout : src;
            return {
              id: `exercise_${stamp}_${i}`,
              name,
              category: ex.category,
              ...(ex.bodyPart ? { bodyPart: ex.bodyPart } : {}),
              tags: ex.tags ?? [],
              sets: std
                ? toGhostSets(std.ex.sets, `${stamp}_${i}`, getActiveMetrics(ex.name))
                : vid && !live
                  ? copied.map(st => ({ ...st, checkWeight: true }))
                  : copied,
              ...(live ? { variantId: vid, variantName: ex.variantName || variantsOf(ex.name).find(v => v.id === vid)?.name } : {}),
              exerciseTime: new Date().toISOString(),
              ...(from.date ? { prefillFrom: from.date } : {}),
              // 来源那一场的馆：和今天不是一个馆时眉批写明（「换馆重量」A）
              ...(from.date && from.gym ? { prefillGym: from.gym } : {}),
              ...(ex.instanceConfig ? { instanceConfig: { bodyweightMode: ex.instanceConfig.bodyweightMode } } : {}),
              ...(ex.altGroup ? { altGroup: regroup(ex.altGroup) } : {}),
            };
          })
          .map(e => ({ ...e, sets: roundPrefill(e.sets, e as Exercise, rounderFor(e as Exercise, targetGym, undefined, gyms)) }))
          // 来源里只剩底稿的动作（未收尾的草稿）没有可抄的事实，整个动作丢掉
          .filter(ex => ex.sets.length > 0));
        return {
          ...base,
          ...(targetGym ? { gym: targetGym } : {}),
          title: src.title || '',
          tags: src.tags ?? [],
          exercises,
        };
      };
      return { make, replaces: live?.id ?? null };
    },
    [confirm, findLast, getActiveMetrics, isCn, mergeAliasOf, resolveName, rounderFor, toast, variantIdOf, variantsOf, workoutCtx, workouts],
  );

  const handleDeleteExerciseRecord = useCallback(
    async (e: React.MouseEvent, workoutId: string, exerciseId: string) => {
      e.stopPropagation();
      // 不确认：点错了用顶栏的全局撤销（2026-10-25）。删的是最后一个动作＝删整场，走 handleDeleteWorkout 先确认（审查 D10）

      try {
        const allWorkouts = await db.getAll<WorkoutSession>('workouts');
        const workout = allWorkouts.find(w => w.id === workoutId);
        if (!workout) {
          toast(isCn ? '训练记录不存在' : 'Workout not found', 'error');
          return;
        }
        const exerciseToDelete = workout.exercises.find(ex => ex.id === exerciseId);
        if (!exerciseToDelete) {
          toast(isCn ? '动作记录不存在' : 'Exercise not found', 'error');
          return;
        }

        const updatedExercises = workout.exercises.filter(ex => ex.id !== exerciseId);
        if (updatedExercises.length === 0) {
          await handleDeleteWorkout(workoutId);
          return;
        }
        await db.save('workouts', {
          ...workout,
          exercises: updatedExercises,
          userId: workout.userId,
        });
        await refreshFromDb();
        scheduleDebouncedFitlogPush();
      } catch (error) {
        console.error('Error deleting exercise record:', error);
        toast(isCn ? '删除失败' : 'Delete failed', 'error');
      }
    },
    [handleDeleteWorkout, isCn, refreshFromDb, toast],
  );

  const handleStartScheduledSession = useCallback(
    async (scheduleId: string): Promise<StartPlan | null> => {
      const target = scheduleCtx.schedules.find(s => s.id === scheduleId);
      if (!target) return null;
      // 进行中的训练现在会一直留在工作台（不再按返回就清空），从计划开练会顶掉它：先问一句（同「复制为今天」）
      await workoutCtx.whenHydrated();
      const live = workoutCtx.getLiveWorkbench();
      if (live) {
        const ok = await confirm({
          message: isCn
            ? '有一场训练还没结束，从计划开始会先替它结束，记进时间线。'
            : 'A workout is still unfinished; starting the plan will end it first and put it on the timeline.',
          confirmLabel: isCn ? '继续' : 'Continue',
        });
        if (!ok) return null;
      }
      /**
       * 和 FAB 一样先选馆（App 的 startAtGym），选好再铺（审查 A12）。每个动作和手动添加走同一条路（buildExercise）：
       * 上一次的底稿、动作设置里的自重类型、有氧第一次加的默认记录项、上次交替做的照样排成交替组；
       * 计划写了的才盖上去（组数、次数、目标重量），没写的就是上一次的样子。
       * fromSchedule 开练时就记在这场上：App 被回收、接回来再结束，计划照样标完成。
       */
      const make: StartMaker = (gym, gyms) => {
        const empty = workoutCtx.createNewWorkout();
        const g = gym ?? empty.gym;
        const now = new Date().toISOString();
        const inheritAlt = appPrefsNow().inheritAltGroup;
        const built = (target.exercises || []).map((pe, i) => {
          const def = findExerciseDef(pe.name);
          const category = pe.category || def?.category || 'STRENGTH';
          const src = pickSource(pe.name, undefined, undefined, preferGymFor(pe.name, undefined, g));
          const last = src.last;
          if (category === 'CARDIO' && !last) seedMetricsIfUnset(pe.name, appPrefsNow().cardioMetrics);
          // 和上面 seed 的是同一份：没练过的有氧按首选项的有氧默认记录（seed 写进状态要等下一次渲染）
          const metrics = category === 'CARDIO' && !last ? appPrefsNow().cardioMetrics : getActiveMetrics(pe.name);
          const ex = buildExercise(src.name, category, last, now, def?.exerciseConfig, src.variantId ? { id: src.variantId } : undefined, g, gyms);
          const r = rounderFor(ex, g, undefined, gyms);
          // 计划里的目标重量也按这个馆就近取整；记一份 plan 参考（标「计划 x」，切单位从它重算，不会越换越漂）
          const planWeight = (kg: number): Partial<SetLog> =>
            r
              ? {
                  weight: Math.abs(r.snapKg(kg)),
                  plateUnit: r.unit,
                  prefillRef: { kg, unit: plateUnitOf({ weight: kg }, r.unit), plan: true },
                  draftAuto: true,
                }
              : { weight: kg };
          const n = pe.targetSets && pe.targetSets > 0 ? pe.targetSets : ex.sets.length;
          // 计划里的组是「打算做的」，不是做完的：一律待做（第 4 条）；有数的结束时照样入册（willRecord），不做的删掉
          const sets = Array.from({ length: n }, (_, j): SetLog => {
            const src = ex.sets[Math.min(j, ex.sets.length - 1)];
            const id = `${ex.id}_p${j}`;
            let row: SetLog = {
              ...src,
              id,
              ghost: true,
              ...(src.subSets?.length ? { subSets: src.subSets.map((sub, k) => ({ ...sub, id: `${id}_sub${k}` })) } : {}),
            };
            // 只写这个动作记着的项：有氧 / 计时动作不记次数，计划里的「次数 10」原来藏进组里入册，出「0 → 10 次」的假 PB（上架审查 gap-5#1）
            if (pe.targetReps && pe.targetReps > 0 && metrics.includes('reps')) row = { ...row, reps: pe.targetReps };
            if (pe.targetWeight && pe.targetWeight > 0 && metrics.includes('weight')) row = { ...row, ...planWeight(pe.targetWeight) };
            return row;
          });
          return {
            ex: {
              ...ex,
              id: `${ex.id}_${i}`,
              ...(pe.bodyPart ? { bodyPart: pe.bodyPart } : {}),
              tags: pe.tags ?? [],
              sets,
            } as Exercise,
            // 交替关系看最近一次交替做的那场（同 addExerciseToWorkout）
            group: (() => {
              const alt = inheritAlt ? (last?.ex.altGroup ? last : findLastAltGroup(workouts, resolveName, pe.name)) : null;
              return alt ? `${alt.workout.id}|${alt.ex.altGroup}` : undefined;
            })(),
          };
        });
        // 上次交替做的几个动作这次计划里都有：照样排成交替组（只有一个的不成组）；首选项「连带交替搭档」关着就不排
        const count = new Map<string, number>();
        for (const b of built) if (b.group) count.set(b.group, (count.get(b.group) ?? 0) + 1);
        const ids = new Map<string, string>();
        const exercises = built.map(b => {
          if (!b.group || (count.get(b.group) ?? 0) < 2) return b.ex;
          if (!ids.has(b.group)) ids.set(b.group, newGroupId());
          return { ...b.ex, altGroup: ids.get(b.group) };
        });
        return {
          ...empty,
          ...(g ? { gym: g } : {}),
          title: target.title || (isCn ? '计划训练' : 'Planned session'),
          tags: target.bodyParts ?? [],
          notes: target.notes || '',
          fromSchedule: { scheduleId },
          exercises: normalizeGroups(exercises),
        };
      };
      return { make, replaces: live?.id ?? null };
    },
    [buildExercise, confirm, findExerciseDef, isCn, pickSource, preferGymFor, resolveName, rounderFor, scheduleCtx.schedules, seedMetricsIfUnset, workoutCtx, workouts],
  );

  /**
   * 恢复一场已结束的训练回到工作台：清掉 finishedAt / status，
   * 它就重新变成「正在进行中的那一场」—— 再结束一次会写回同一个 id，
   * 不会多出一条记录。
   */
  const resumeWorkout = useCallback(
    async (w: WorkoutSession) => {
      // 工作台上还有正在练的另一场：先替它收尾，别让它被顶下工作台后没人管（上架审查 C05）。
      // 读工作台此刻的样子，不读渲染闭包：点按之后接回 / 撤销可能才落定
      if (workoutCtx.getLiveWorkbench()?.id !== w.id) await workoutCtx.settleWorkbench();
      const { finishedAt: _fa, status: _st, ...rest } = w;
      const resumed: WorkoutSession = { ...rest, updatedAt: new Date().toISOString() };
      await db.save('workouts', resumed);
      resumedWorkoutIdsRef.current.add(resumed.id);
      await refreshFromDb();
      workoutCtx.replaceWorkbench(resumed);
      setEditingWorkoutId(null);
      // 计划关联跟着一起回来，否则续练完这场就丢了 fromSchedule
      activeScheduleIdRef.current = w.fromSchedule?.scheduleId ?? null;
      setActiveTab('new');
      scheduleDebouncedFitlogPush();
    },
    [refreshFromDb, setActiveTab, workoutCtx],
  );

  /**
   * 开新一场（2026-10-11 用户定）：**不再**问「继续刚才那场？」。结束本身已经有一道确认，两道叠着，
   * 每场都多一次点 + 一个弹窗。误点结束的补救挪到时间线：刚结束 10 分钟内长按那张卡有「继续这场」。
   */
  const startWorkoutGuarded = useCallback(async (proceed: () => void) => {
    // 新开的一场和任何计划都无关（plan-session-leaks-schedule-id）
    activeScheduleIdRef.current = null;
    proceed();
  }, []);

  const addExerciseToWorkout = useCallback(
    (
      ex: {
        id: string;
        name: { en: string; cn: string };
        category?: ExerciseCategory;
        exerciseConfig?: any;
      },
      opts: {
        altGroup?: string | null;
        variantId?: string;
        /** 选动作列表里点的某种搭配：按这一场带搭档，不看最近一次 */
        altFrom?: LastHit;
        /** 这次要顶掉的卡（弹层里刚加的，点另一种搭配时）：和新卡同一次写入，且不算「本场已有」 */
        replaceIds?: string[];
        /** 真的新建了卡片才回调：本次建出的全部 id（含连带进来的交替搭档）+ 搭档名（给「已连带加入，撤销」用） */
        onCreated?: (ids: string[], partnerNames: string[]) => void;
      } = {},
    ) => {
      // 旧训练和补录的场：动作时间落在那一场的时刻上，不是现在
      const pastSession = !!editingWorkoutId || isBackdated(currentWorkout);
      const exerciseTime = pastSession ? currentWorkout.date : new Date().toISOString();

      const exerciseName = ex.name[lang];
      const resolvedTarget = resolveName(exerciseName);
      const already = (currentWorkout.exercises ?? []).filter(e => resolveName(e.name) === resolvedTarget);

      // 加进交替组：已经在组里 → 不重复加；本场已有单独卡片 → 并进来；否则新加一张进组
      if (opts.altGroup) {
        const gid = opts.altGroup;
        if (already.some(e => e.altGroup === gid)) {
          toast(isCn ? `「${resolvedTarget}」已经在这个交替组里了` : `"${resolvedTarget}" is already in the group`, 'info');
          return already.find(e => e.altGroup === gid)!.id;
        }
        const single = already.find(e => !e.altGroup);
        if (single) {
          setCurrentWorkout((p: WorkoutSession) => {
            const list = p.exercises ?? [];
            const members = list.filter(e => e.altGroup === gid).map(e => e.id);
            return { ...p, exercises: groupExercises(list, [...members, single.id]) };
          });
          onPersist?.();
          return single.id;
        }
      }

      /**
       * 底稿预填（§12.6）：上次的每一组以 ghost 行躺进来 —— 点组号照抄、改哪格记哪格，没描实的结束时整行丢弃。
       * 指定了做法就找这个做法上次的那几组（重量不通用，不借别的做法的数）。
       */
      // 跳过今天这一场自己：工作台上的这场也存在 workouts 里，不能把今天刚做的抄成今天的底稿
      // 同一个馆的上一次优先（器械的数各馆不通用）；本馆没练过才抄别的馆的，眉批写明在哪个馆
      // 给旧训练补加动作、补录的场：只抄那一场之前练的（之后的数那天还没有）
      const before = pastSession ? currentWorkout.date : undefined;
      const src = pickSource(
        exerciseName,
        opts.variantId,
        currentWorkout.id || undefined,
        preferGymFor(exerciseName, opts.variantId, currentWorkout.gym),
        before,
      );
      /**
       * 有氧动作第一次加进来（没配置过记录项、哪个做法都没记过）：按首选项「有氧默认记录」定记录项。
       * 记过的不动 —— 划船机被当器械记成 65×12 的那种必须保持重量 × 次数（审查 cardio-default-metrics）。
       * 记过之后的几个口子各自落定：改类型（saveExerciseAttrs）、改有氧默认（pinCardioMetrics）、导入（mergeImportSeeds）。
       */
      if (ex.category === 'CARDIO' && !findLast(exerciseName, null, currentWorkout.id || undefined, undefined, before)) {
        seedMetricsIfUnset(exerciseName, appPrefsNow().cardioMetrics);
      }
      const newEx = buildExercise(
        src.name,
        ex.category || 'STRENGTH',
        src.last,
        exerciseTime,
        ex.exerciseConfig,
        src.variantId ? { id: src.variantId } : undefined,
      );

      /**
       * 上次是在交替组里练的：同组的其他动作一起带进来（本场已有的并进来），按轮换排（用户定：底稿按干净的轮换重排）。
       * 从交替组「加一个动作」进来的不带 —— 那时是往一个现成的组里加。弹层头部「连带交替搭档」关着也不带（只加这一张）。
       */
      const partners: Exercise[] = [];
      const joinIds: string[] = [];
      let gid: string | undefined = opts.altGroup ?? undefined;
      // 搭档关系看最近一次交替做的那场，不一定是上一次（上一次单练了也能把搭档找回来，2026-11-02 用户指出）；
      // 必须和选动作列表的第 0 种搭配同一个口径，否则行下面列出来的会和点行带的重复
      const altHit = gid
        ? null
        : opts.altFrom ?? (appPrefsNow().inheritAltGroup ? findLastAltGroup(workouts, resolveName, exerciseName, currentWorkout.id || undefined, before) : null);
      const replaced = new Set(opts.replaceIds);
      if (altHit) {
        const mates = altHit.workout.exercises.filter(e => e.altGroup === altHit.ex.altGroup && e !== altHit.ex);
        if (mates.length) {
          gid = newGroupId();
          for (const m of mates) {
            const mName = resolveName(m.name);
            const inSession = (currentWorkout.exercises ?? []).find(e => !replaced.has(e.id) && resolveName(e.name) === mName);
            if (inSession) {
              if (!inSession.altGroup) joinIds.push(inSession.id);
              continue;
            }
            // 搭档的底稿抄它自己最近一次的数（交替那场可能已经是几周前）；没有更近的就抄交替那场
            const mSrc = pickSource(m.name, undefined, currentWorkout.id || undefined, preferGymFor(mName, undefined, currentWorkout.gym), before);
            partners.push(buildExercise(mSrc.name, m.category, mSrc.last ?? { ex: m, workout: altHit.workout }, exerciseTime, undefined, mSrc.variantId ? { id: mSrc.variantId } : undefined));
          }
        }
      }
      // 成员顺序照交替那一场（轮换的先后）
      const order = altHit ? altHit.workout.exercises.filter(e => e.altGroup === altHit.ex.altGroup).map(e => resolveName(e.name)) : [];
      const fresh = [newEx, ...partners]
        .map(e => (gid ? { ...e, altGroup: gid } : e))
        .sort((a, b) => order.indexOf(resolveName(a.name)) - order.indexOf(resolveName(b.name)));

      opts.onCreated?.(fresh.map(e => e.id), partners.map(p => resolveName(p.name)));
      setCurrentWorkout((p: WorkoutSession) => {
        // 首次添加动作：如果没有 id，说明是全新的训练，先分配 id
        const needsId = !p.id;
        const workoutId = needsId ? Date.now().toString() : p.id;
        const base = needsId
          ? { ...p, id: workoutId, startTime: p.startTime || new Date().toISOString() }
          : p;
        // 追加到末尾（训练内按添加顺序排列；配合弹层关闭后的定位高亮）；交替组成员由 normalize 挪到一起
        let list = normalizeGroups([...(base.exercises || []).filter(e => !replaced.has(e.id)), ...fresh]);
        if (gid && joinIds.length) list = groupExercises(list, [...fresh.map(e => e.id), ...joinIds]);
        return { ...base, exercises: list };
      });

      // 添加动作后立即触发 persist
      onPersist?.();
      return newEx.id;
    },
    [buildExercise, currentWorkout.date, currentWorkout.exercises, currentWorkout.gym, currentWorkout.id, editingWorkoutId, findLast, isCn, lang, onPersist, pickSource, preferGymFor, resolveName, seedMetricsIfUnset, setCurrentWorkout, toast, workouts],
  );

  /**
   * 切换一张卡的做法（变体第一层）。variantId 为 undefined＝标准。
   * 这张卡还全是底稿（一组都没做完、也没改过）时，底稿换成这个做法上次的那几组；
   * 这个做法从没练过 → 一行空的待做，不借别的做法的数（重量不通用）。
   * 已经有做完 / 改过的组：只换标签，不动组。
   */
  const switchExerciseVariant = useCallback(
    (exerciseId: string, variantId: string | undefined, name?: string) => {
      setCurrentWorkout((p: WorkoutSession) => {
        const exs = p.exercises ?? [];
        const idx = exs.findIndex(e => e.id === exerciseId);
        if (idx < 0) return p;
        const ex = exs[idx];
        // 卡名是并入别名：名字一并换成目标现名，不然选「标准」也会被别名认回并入的做法（审查 gap-2#1①）
        const cardName = switchedCardIdentity(ex, variantId, mergeAliasOf, resolveName).name;
        if ((variantIdOf(ex) || undefined) === (variantId || undefined)) {
          if (cardName === ex.name) return p;
          const copy = [...exs];
          copy[idx] = { ...ex, name: cardName, ...(variantId ? { variantId } : {}) };
          return { ...p, exercises: copy };
        }
        const variantName = variantId
          ? name || variantsOf(ex.name).find(v => v.id === variantId)?.name
          : undefined;
        /**
         * 2026-10-18（馆档案）：做完的、改过的组不动；没动过的底稿按新做法上一次的组重填（做法可能换了器材：
         * 杠铃 → 哑铃，原来的数没法用）。新做法没练过：全是底稿 → 一行空的待做（不借别的做法的数，原规则）；
         * 已经有做完 / 改过的 → 剩下的底稿留着，按新做法的器材取整。
         * 卡上有做完 / 改过的行时组数不变（上架审查 C43：原来把新做法上次多出来的组接在后面，结束时作为有数的底稿入册）。
         * 「改过」含速度 / 自定义项、点了力竭（setValues.rowEdited）。
         */
        const kept = ex.sets.filter(st => !st.ghost || rowEdited(st));
        const nextEx = { ...ex, name: cardName, ...(variantId ? { variantId } : { variantId: undefined }) } as Exercise;
        const r = rounderFor(nextEx, p.gym);
        let sets = ex.sets;
        let prefillFrom: string | undefined = ex.prefillFrom;
        let prefillGym: string | undefined = ex.prefillGym;
        const hit = findLast(
          ex.name,
          variantId ?? '',
          p.id,
          preferGymFor(ex.name, variantId, p.gym),
          editingWorkoutId || isBackdated(p) ? p.date : undefined,
        );
        const stamp = Date.now();
        if (hit) {
          // 做完 / 改过的组留在原来的位置（审查 A6：原来全挪到最前面），其余位置换成新做法上一次同位置的那组（refillDraft）
          const fill = roundPrefill(toGhostSets(hit.ex.sets, `${stamp}`, getActiveMetrics(ex.name)), nextEx, r);
          sets = refillDraft(ex.sets, fill);
          if (!sets.length) sets = [{ id: `${stamp}`, weight: 0, reps: 0, ghost: true }];
          prefillFrom = hit.workout.date;
          prefillGym = hit.workout.gym;
        } else if (!kept.length) {
          sets = [{ id: `${stamp}`, weight: 0, reps: 0, ghost: true }];
          prefillFrom = undefined;
          prefillGym = undefined;
        } else if (r) {
          sets = ex.sets.map(st => {
            if (!st.ghost || rowEdited(st)) return st;
            const snapOne = <T extends { weight: number; bodyweightMode?: SetLog['bodyweightMode'] }>(x: T, parent?: SetLog): T => {
              const kg = signedKg(x, nextEx, parent);
              const v = r.snapKg(kg);
              return r.signed ? { ...x, ...fromSignedKg(v) } : { ...x, weight: Math.max(0, v) };
            };
            // 旧做法的「上次」对新器材没有参考意义（杠铃的 60 不是哑铃的 60）：去掉，标「换了做法，确认一下重量」
            const { prefillRef: _pr, ...base } = snapOne(st);
            return {
              ...base,
              draftAuto: false,
              checkWeight: true,
              ...(st.subSets?.length
                ? { subSets: st.subSets.map(sub => { const { prefillRef: _spr, ...b } = snapOne(sub, st); return { ...b, draftAuto: false }; }) }
                : {}),
            };
          });
        }
        const { variantId: _v, variantName: _n, prefillFrom: _pf, prefillGym: _pg, ...rest } = ex;
        const next: Exercise = {
          ...rest,
          name: cardName,
          ...(variantId ? { variantId, variantName } : {}),
          ...(prefillFrom ? { prefillFrom } : {}),
          ...(prefillFrom && prefillGym ? { prefillGym } : {}),
          sets,
        };
        const copy = [...exs];
        copy[idx] = next;
        return { ...p, exercises: copy };
      });
      onPersist?.();
    },
    [editingWorkoutId, findLast, mergeAliasOf, onPersist, preferGymFor, resolveName, rounderFor, setCurrentWorkout, variantIdOf, variantsOf],
  );

  return {
    switchExerciseVariant,
    saveStatus,
    editingWorkoutId,
    setEditingWorkoutId,
    hasUnsavedChanges,
    colophon,
    dismissColophon,
    handleFinishWithConfirmation,
    changeWorkoutDate,
    handleEditWorkout,
    handleAddExerciseToPastWorkout,
    handleNewWorkoutBack,
    handleDeleteWorkout,
    handleMergeIntoPrevious,
    handleCopyWorkoutToToday,
    handleDeleteExerciseRecord,
    handleStartScheduledSession,
    startWorkoutGuarded,
    resumeWorkout,
    pendingScrollToPicker,
    setPendingScrollToPicker,
    activeScheduleIdRef,
    pendingScheduleCompletion,
    addExerciseToWorkout,
    resumedWorkoutIdsRef,
  };
}