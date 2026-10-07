/**
 * 训练记录的增改删 + 计划训练联动 + 单组动作删除
 * v3: 移除 draft/completed 分流，简化结束训练逻辑
 */
import React, { useCallback, useRef, useState } from 'react';
import { Exercise, Language, SetLog, WorkoutSession } from '../../types';
import { db } from '../../services/db';
import { recordTombstone, removeTombstone } from '../../services/fitlogTombstones';
import { scheduleDebouncedFitlogPush } from '../../services/fitlogSyncScheduler';
import { hasDoneSets, useWorkoutContext } from '../contexts/WorkoutContext';
import { useScheduleContext } from '../contexts/ScheduleContext';
import { useUserSettingsContext } from '../contexts/UserSettingsContext';
import { useUiOverlay } from '../contexts/UiOverlayContext';
import { useExercisePrefs } from '../contexts/ExercisePrefsContext';
import { ExerciseCategory } from '../constants/exercises';
import { detectPRs, sessionSummary, stampsInUnit, PRHit } from '../utils/prDetect';
import { KG_TO_LBS } from '../constants';
import { groupExercises, newGroupId, normalizeGroups, stripWorkbenchSet } from '../utils/workbench';
import { usesSignedLoad } from '../utils/load';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';
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
const RESUME_WINDOW_MS = 10 * 60 * 1000;

/**
 * 没选部位、也没手打标题时的兜底标题。
 *
 * 原先写死 `Workout ${new Date().toLocaleDateString()}`：中文模式下刊头是英文单词，
 * 而日期又跟着【浏览器】的 locale 走而不是 App 的语言设置 —— 两头都不对。
 * 现在词和日期都由 lang 决定。标题是存进库里的数据，之后不再随语言切换而变，
 * 这符合「记下来的就是当时那句」的直觉。
 */
function defaultWorkoutTitle(isCn: boolean, now: Date = new Date()): string {
  return isCn
    ? `训练 ${now.toLocaleDateString('zh-CN')}`
    : `Workout ${now.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })}`;
}

/**
 * 把一串既有的组铺成底稿行（§12.6）。
 *
 * 只抄数值字段，递减子组也照抄（和母组一样是上次的数据，跟着母组一起描实 / 丢弃）。
 * 力竭是当日事实，不继承。
 * 上次若本身是未收尾的草稿，先滤掉它的 ghost —— 别把底稿再抄成底稿。
 *
 * 添加单个动作（底稿预填）和整场复制共用这一份，两处的语义必须是同一套：
 * §12.6 说的就是「不发明新机制」。
 */
function toGhostSets(sets: SetLog[] | undefined, idPrefix: string): SetLog[] {
  return (sets ?? [])
    .filter(s => !s.ghost)
    .map((s, j) => ({
      id: `${idPrefix}_${j}`,
      weight: s.weight ?? 0,
      reps: s.reps ?? 0,
      ...(s.duration ? { duration: s.duration } : {}),
      ...(s.time ? { time: s.time, timeUnit: s.timeUnit } : {}),
      ...(s.distance ? { distance: s.distance, distanceUnit: s.distanceUnit } : {}),
      ...(s.subSets?.length
        ? {
            subSets: s.subSets.map((sub, k) => ({
              id: `${idPrefix}_${j}_sub${k}`,
              weight: sub.weight ?? 0,
              reps: sub.reps ?? 0,
            })),
          }
        : {}),
      ghost: true,
    }));
}

export interface UseWorkoutMutationsParams {
  setActiveTab: (tab: ActiveTab) => void;
  reloadAfterSave: () => Promise<void>;
  /** 返回当前的 previousTab（用于「返回」按钮回到来源页） */
  getPreviousTab: () => ActiveTab;
  /** 进入「编辑历史训练」时的副作用钩子（用于清理 Dashboard 上的 PR 高亮等） */
  onEnterEditWorkout?: () => void;
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
  volume: number;
  unitLabel: string;
  stamps: PRHit[];
  extraCount: number;
}

export interface UseWorkoutMutationsResult {
  saveStatus: SaveStatus;
  setSaveStatus: React.Dispatch<React.SetStateAction<SaveStatus>>;

  editingWorkoutId: string | null;
  setEditingWorkoutId: React.Dispatch<React.SetStateAction<string | null>>;

  hasUnsavedChanges: boolean;
  setHasUnsavedChanges: React.Dispatch<React.SetStateAction<boolean>>;


  /** 结束训练（标记 finishedAt + 清空 + 跳转） */
  finishWorkout: () => Promise<void>;
  /** 刊末页数据。§9：非 PR 日也必须有收尾，所以每次结束训练都会有值。 */
  colophon: ColophonState | null;
  dismissColophon: () => void;
  /** 带单位提示的结束确认 */
  handleFinishWithConfirmation: () => Promise<void>;

  handleEditWorkout: (
    workoutId: string,
    options?: { scrollToPicker?: boolean },
  ) => void;
  handleAddExerciseToPastWorkout: (workoutId: string) => void;
  handleNewWorkoutBack: () => Promise<void>;
  handleDeleteWorkout: (
    workoutId: string,
    options?: { skipConfirm?: boolean },
  ) => Promise<void>;
  /** §12.8 菜单项「并入上一场」：把这场的动作追加到紧邻的前一场，本场删除，可撤销 */
  handleMergeIntoPrevious: (workoutId: string) => Promise<void>;
  /** §12.8 菜单项「复制为今天的训练」：整场结构铺成底稿进工作台（§12.6 语义） */
  handleCopyWorkoutToToday: (workoutId: string) => Promise<void>;
  handleDeleteExerciseRecord: (
    e: React.MouseEvent,
    workoutId: string,
    exerciseId: string,
    exerciseName: string,
    date: string,
  ) => Promise<void>;

  handleStartScheduledSession: (scheduleId: string) => void | Promise<void>;

  /**
   * 开新训练前的防误结束拆场闸门（FAB / 案头两个入口共用）。
   * 10 分钟内刚结束过一场就先问「继续刚才的『XX』？」，
   * 选继续＝恢复那一场回工作台，选否＝执行 proceed() 走正常新建。
   */
  startWorkoutGuarded: (proceed: () => void) => Promise<void>;
  /** 进入 new tab 后是否滚到 ExercisePicker（用于"补加动作"快捷入口） */
  pendingScrollToPicker: boolean;
  setPendingScrollToPicker: React.Dispatch<React.SetStateAction<boolean>>;

  /** 给计划训练保存后回写日程状态使用，由调用方在 useEffect 中触发 */
  activeScheduleIdRef: React.MutableRefObject<string | null>;
  markActiveSchedulePending: React.MutableRefObject<boolean>;
  /** 「继续这场」接回来的训练 id：删光动作时不整场删 */
  resumedWorkoutIdsRef: React.MutableRefObject<Set<string>>;

  /** 放弃进行中的这场（一组都没做完时）：删掉 + 写墓碑 + 清空工作台 */
  discardCurrentWorkout: () => Promise<void>;
  /** 切换一张卡的练法（第 8 条）；undefined＝标准 */
  switchExerciseVariant: (exerciseId: string, variantId: string | undefined, name?: string) => void;
  /**
   * 添加动作到当前训练。opts.altGroup：加进这个交替组（交替组卡的「加一个动作」）——
   * 本场已经有这个动作的单独卡片就把那张并进来，已经在组里就不重复加。
   * opts.variantId：直接用这个做法（细分格里点的是某个做法的小卡）。
   */
  addExerciseToWorkout: (
    ex: { id: string; name: { en: string; cn: string }; category?: ExerciseCategory; exerciseConfig?: any },
    closeLibrary?: boolean,
    opts?: { altGroup?: string | null; variantId?: string },
  ) => string;
}

export function useWorkoutMutations({
  setActiveTab,
  reloadAfterSave,
  getPreviousTab,
  onEnterEditWorkout,
  onPersist,
}: UseWorkoutMutationsParams): UseWorkoutMutationsResult {
  const workoutCtx = useWorkoutContext();
  const scheduleCtx = useScheduleContext();
  const settingsCtx = useUserSettingsContext();
  const { confirm, toast, toastUndo } = useUiOverlay();
  const { resolveName, getActiveMetrics, liftKey, variantsOf, variantIdOf, signedLoadOf } = useExercisePrefs();

  const lang = settingsCtx.lang;
  const unit = settingsCtx.unit;
  const isCn = lang === Language.CN;

  const { workouts, currentWorkout, setCurrentWorkout, deleteWorkout, refreshFromDb, finishWorkout: ctxFinishWorkout } =
    workoutCtx;

  const [colophon, setColophon] = useState<ColophonState | null>(null);
  const dismissColophon = useCallback(() => setColophon(null), []);

  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [editingWorkoutId, setEditingWorkoutId] = useState<string | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [pendingScrollToPicker, setPendingScrollToPicker] = useState(false);

  const activeScheduleIdRef = useRef<string | null>(null);
  /**
   * 「继续这场」接回来的训练 id。它们里面有真正练过的组，删光动作时不能像新训练那样整场删掉
   * （App.tsx onDeleteExerciseFromSession）。resumeWorkout 会剥掉 finishedAt，数据上分不出来，只能记在这里。
   */
  const resumedWorkoutIdsRef = useRef<Set<string>>(new Set());
  const markActiveSchedulePending = useRef(false);

  /**
   * 放弃进行中的这场（一组都没做完时）：从库里删掉 + 写墓碑（防拉取复活），工作台清空。
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
      await refreshFromDb();
      scheduleDebouncedFitlogPush();
    } catch (err) {
      console.error('[useWorkoutMutations] 放弃训练失败:', err);
    }
  }, [currentWorkout.id, refreshFromDb, setActiveTab, setCurrentWorkout, workoutCtx]);

  /**
   * 结束训练：标记 finishedAt → 写 DB → 清空 workbench → 跳转
   */
  const finishWorkout = useCallback(async () => {
    setSaveStatus('saving');
    setHasUnsavedChanges(false);

    try {
      if (!currentWorkout.exercises || currentWorkout.exercises.length === 0) {
        setSaveStatus('idle');
        return;
      }

      /**
       * §12.6 红线：底稿永远不会静默变成数据。
       * 结束训练时剥掉所有仍是 ghost 的行；整动作只剩底稿的，连动作一起丢；
       * prefillFrom 只服务工作台眉批，也一并剥掉。
       * fromGhost 同理：它是工作台上的退回凭据，训练收尾后不该跟进历史。
       */
      const cleanedExercises = normalizeGroups(
        currentWorkout.exercises
          .map(ex => {
            const { prefillFrom: _pf, prefillGym: _pg, ...rest } = ex;
            return {
              ...rest,
              sets: ex.sets
                // 待做和跳过的都还是 ghost：一起丢（跳过＝这次没做）
                .filter(s => !s.ghost)
                .map(s => {
                  // fromGhost（已停写）、touched、seq 都是工作台上的标记，不跟进历史
                  const { fromGhost: _fg, touched: _t, ...set } = stripWorkbenchSet(s);
                  return set.subSets?.length
                    ? { ...set, subSets: set.subSets.map(({ touched: _st, ...sub }) => sub) }
                    : set;
                }),
            };
          })
          .filter(ex => ex.sets.length > 0),
      );

      if (cleanedExercises.length === 0) {
        setSaveStatus('idle');
        // 一组都没做完：没有可入册的东西。编辑旧训练时只提示；新训练问一句要不要放弃这场（不留空场在库里）
        if (editingWorkoutId) {
          toast(isCn ? '还没有做完任何一组' : 'No sets done yet', 'info');
          return;
        }
        const ok = await confirm({
          message: isCn ? '还没有做完任何一组。放弃这场训练？' : 'No sets done yet. Discard this workout?',
          confirmLabel: isCn ? '放弃' : 'Discard',
          cancelLabel: isCn ? '接着练' : 'Keep going',
          danger: true,
        });
        if (ok) await discardCurrentWorkout();
        return;
      }

      const scheduleId = activeScheduleIdRef.current;
      const finalWorkout: WorkoutSession = {
        ...currentWorkout,
        exercises: cleanedExercises,
        title: currentWorkout.title || defaultWorkoutTitle(isCn),
        date: currentWorkout.date || new Date().toISOString(),
        ...(scheduleId ? { fromSchedule: { scheduleId } } : {}),
      };

      // PR 判定必须在写库【之前】算：写完之后 workouts 里就含本场了，
      // 拿它当「历史」会把自己和自己比，永远不可能破纪录。
      const pr = detectPRs({
        session: finalWorkout,
        history: workouts.filter(w => w.id !== finalWorkout.id),
        editingWorkoutId,
        resolveName,
        keyOf: liftKey,
        getActiveMetrics,
        unitLabel: unit,
        isSigned: ex => usesSignedLoad(ex, signedLoadOf(ex.name)),
      });
      const summary = sessionSummary(finalWorkout);
      const volume = unit === 'lbs' ? summary.volumeKg * KG_TO_LBS : summary.volumeKg;

      await ctxFinishWorkout(finalWorkout);

      setColophon({
        // 期号＝第几场真正练过的训练（空场、本场自己不算）
        issueNo: workouts.filter(w => w.id !== finalWorkout.id && hasDoneSets(w)).length + 1,
        title: finalWorkout.title,
        dateISO: finalWorkout.date,
        exerciseCount: summary.exerciseCount,
        setCount: summary.setCount,
        volume,
        unitLabel: unit,
        stamps: stampsInUnit(pr.stamps, unit, KG_TO_LBS),
        extraCount: pr.extraCount,
      });

      if (scheduleId) {
        markActiveSchedulePending.current = true;
      }

      setSaveStatus('saved');

      setCurrentWorkout(workoutCtx.createNewWorkout());
      setActiveTab('dashboard');
      setEditingWorkoutId(null);
      setTimeout(() => {
        setSaveStatus('idle');
      }, 1200);
    } catch (error) {
      console.error('[useWorkoutMutations] 结束训练失败:', error);
      setSaveStatus('error');
      toast(isCn ? '结束训练失败，请重试' : 'Failed to end workout, please try again', 'error');
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
    confirm,
    discardCurrentWorkout,
  ]);

  const handleFinishWithConfirmation = useCallback(async () => {
    const unitText = isCn ? (unit === 'kg' ? '公斤(kg)' : '磅(lbs)') : unit === 'kg' ? 'kg' : 'lbs';
    /**
     * 改过数但没点完成的组（第 4 条）：改值不再顺手描实，这种行结束时照规矩丢弃 ——
     * 那是一次不可逆后果，所以要点出来，并把「取消」换成「返回补点」。
     * 没动过的底稿行静默丢弃，不提（那本来就是「没做」）。
     */
    const touchedCount = (currentWorkout.exercises ?? []).reduce(
      (n, ex) =>
        n +
        (ex.sets ?? []).filter(
          s => s.ghost && (Object.values(s.touched ?? {}).some(Boolean) || (s.subSets ?? []).some(sub => Object.values(sub.touched ?? {}).some(Boolean))),
        ).length,
      0,
    );
    const warn = touchedCount
      ? isCn
        ? `\n\n有 ${touchedCount} 组改过数但没点完成，结束后会丢弃。`
        : `\n\n${touchedCount} edited ${touchedCount === 1 ? 'set was' : 'sets were'} never marked done and will be discarded.`
      : '';
    const backLabel = touchedCount ? { cancelLabel: isCn ? '返回补点' : 'Go back' } : {};

    // 一组都没做完：直接问要不要放弃这场（不留空场在库里），别先问「确认结束」再说「底稿不入册」
    if (!editingWorkoutId && !hasDoneSets(currentWorkout)) {
      const ok = await confirm({
        message: (isCn ? '还没有做完任何一组。放弃这场训练？' : 'No sets done yet. Discard this workout?') + warn,
        confirmLabel: isCn ? '放弃' : 'Discard',
        cancelLabel: isCn ? '接着练' : 'Keep going',
        ...backLabel,
        danger: true,
      });
      if (ok) await discardCurrentWorkout();
      return;
    }

    const ok = await confirm({
      message: isCn
        ? `确认结束当前训练吗？\n\n当前单位设置: ${unitText}\n\n训练将被添加到历史记录。${warn}`
        : `Confirm ending this workout?\n\nCurrent unit: ${unitText}\n\nThe workout will be saved to history.${warn}`,
      confirmLabel: isCn ? '结束训练' : 'End Workout',
      ...backLabel,
    });
    if (ok) await finishWorkout();
  }, [confirm, currentWorkout, discardCurrentWorkout, editingWorkoutId, finishWorkout, isCn, unit]);

  const handleEditWorkout = useCallback(
    (workoutId: string, options?: { scrollToPicker?: boolean }) => {
      const workoutToEdit = workouts.find(w => w.id === workoutId);
      if (workoutToEdit) {
        setCurrentWorkout({ ...workoutToEdit });
        setEditingWorkoutId(workoutId);
        setActiveTab('new');
        onEnterEditWorkout?.();
        if (options?.scrollToPicker) {
          setPendingScrollToPicker(true);
        }
      }
    },
    [onEnterEditWorkout, setActiveTab, setCurrentWorkout, workouts],
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
    if (editingWorkoutId && hasUnsavedChanges) {
      const ok = await confirm({
        message: isCn
          ? '有未保存的修改，确定要返回吗？'
          : 'Unsaved edits will be lost. Continue?',
      });
      if (!ok) return;
    }
    const wasEditing = !!editingWorkoutId;
    if (wasEditing) setCurrentWorkout(workoutCtx.createNewWorkout());
    setEditingWorkoutId(null);
    const prev = getPreviousTab();
    setActiveTab(prev === 'new' ? 'dashboard' : prev);
    // 编辑旧训练顶掉了进行中的那场：退出编辑后把它接回来
    void workoutCtx.refreshFromDb().then(() => (wasEditing ? workoutCtx.restoreInProgress() : undefined));
  }, [
    confirm,
    currentWorkout,
    editingWorkoutId,
    getPreviousTab,
    hasUnsavedChanges,
    isCn,
    setActiveTab,
    setCurrentWorkout,
    workoutCtx,
  ]);

  const handleDeleteWorkout = useCallback(
    async (workoutId: string, options?: { skipConfirm?: boolean }) => {
      const w = workouts.find(x => x.id === workoutId);
      if (!w) return;
      const dateLabel = new Date(w.date).toLocaleDateString(isCn ? 'zh-CN' : 'en-US');
      /**
       * skipConfirm：时间线长按菜单走「先执行 + 撤销条」（§12.8），
       * 撤销就是那道保险，再弹确认框等于上两道锁。旧入口保持确认框不变。
       */
      if (!options?.skipConfirm) {
        const ok = await confirm({
          message: isCn
            ? `确定要删除 ${dateLabel} 的整场训练吗？`
            : `Delete the entire workout from ${dateLabel}?`,
          danger: true,
          confirmLabel: isCn ? '删除' : 'Delete',
        });
        if (!ok) return;
      }
      const snapshot = structuredClone(w);
      try {
        await deleteWorkout(workoutId);
        // 立刻写墓碑（workout-delete-no-tombstone），和「并入上一场」同一个理由：
        // 推送没落地时，下次启动的拉取会把这场原样合并回来。撤销时摘掉（下面 removeTombstone）。
        // deleteWorkout 里的推送是防抖的，这一行同步执行，赶得上同一次推送。
        recordTombstone('workouts', workoutId);
        toastUndo(isCn ? '已删除训练' : 'Workout deleted', async () => {
          await db.save('workouts', snapshot);
          removeTombstone('workouts', workoutId);
          await refreshFromDb();
          scheduleDebouncedFitlogPush();
        });
      } catch (err) {
        console.error('Delete workout failed:', err);
        toast(isCn ? '删除失败' : 'Delete failed', 'error');
      }
    },
    [confirm, deleteWorkout, isCn, refreshFromDb, toast, toastUndo, workouts],
  );

  /**
   * 并入上一场（§12.8 菜单项）—— 误结束拆场的事后补救。
   *
   * 把这场的动作整体追加到时间上紧邻的前一场，本场删除。
   * 合并后的那场从更早的 date 开始、到更晚的 finishedAt 结束，
   * 也就是「本来就该是的那一场」。
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
      const prev = workouts
        .filter(x => x.id !== workoutId && new Date(x.date).getTime() < new Date(w.date).getTime())
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0];
      if (!prev) {
        toast(isCn ? '前面没有训练可并入' : 'No earlier workout to merge into', 'info');
        return;
      }

      const prevSnapshot = structuredClone(prev);
      const selfSnapshot = structuredClone(w);
      /** 两场的收尾时间取更晚的那个：合并后的一场是到那一刻才结束的 */
      const laterOf = (a?: string, b?: string) => {
        if (!a) return b;
        if (!b) return a;
        return new Date(a).getTime() >= new Date(b).getTime() ? a : b;
      };

      try {
        const merged: WorkoutSession = {
          ...prev,
          exercises: [...(prev.exercises || []), ...(w.exercises || [])],
          ...(laterOf(prev.finishedAt, w.finishedAt)
            ? { finishedAt: laterOf(prev.finishedAt, w.finishedAt) }
            : {}),
          ...(laterOf(prev.endTime, w.endTime)
            ? { endTime: laterOf(prev.endTime, w.endTime) }
            : {}),
          updatedAt: new Date().toISOString(),
        };
        await db.save('workouts', merged);
        await db.delete('workouts', workoutId);
        recordTombstone('workouts', workoutId);
        await refreshFromDb();
        scheduleDebouncedFitlogPush();

        const intoName = prev.title || (isCn ? '未命名训练' : 'Untitled');
        toastUndo(
          isCn ? `已并入「${intoName}」` : `Merged into "${intoName}"`,
          async () => {
            await db.save('workouts', prevSnapshot);
            await db.save('workouts', selfSnapshot);
            removeTombstone('workouts', workoutId);
            await refreshFromDb();
            scheduleDebouncedFitlogPush();
          },
        );
      } catch (err) {
        console.error('Merge workout failed:', err);
        toast(isCn ? '并入失败' : 'Merge failed', 'error');
      }
    },
    [isCn, refreshFromDb, toast, toastUndo, workouts],
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
    async (workoutId: string) => {
      const src = workouts.find(x => x.id === workoutId);
      if (!src) return;

      const stamp = Date.now();
      // 交替组跟着复制，换新的组 id（同一个旧 id 映射到同一个新 id）
      const groupMap = new Map<string, string>();
      const regroup = (g?: string) => {
        if (!g) return undefined;
        if (!groupMap.has(g)) groupMap.set(g, newGroupId());
        return groupMap.get(g);
      };
      const exercises: Exercise[] = normalizeGroups((src.exercises || [])
        .map((ex, i) => ({
          id: `exercise_${stamp}_${i}`,
          name: ex.name,
          category: ex.category,
          ...(ex.bodyPart ? { bodyPart: ex.bodyPart } : {}),
          tags: ex.tags ?? [],
          sets: toGhostSets(ex.sets, `${stamp}_${i}`),
          ...(ex.variantId ? { variantId: ex.variantId, variantName: ex.variantName } : {}),
          exerciseTime: new Date().toISOString(),
          ...(src.date ? { prefillFrom: src.date } : {}),
          ...(ex.instanceConfig ? { instanceConfig: { ...ex.instanceConfig } } : {}),
          ...(ex.altGroup ? { altGroup: regroup(ex.altGroup) } : {}),
        }))
        // 来源里只剩底稿的动作（未收尾的草稿）没有可抄的事实，整个动作丢掉
        .filter(ex => ex.sets.length > 0));

      if (exercises.length === 0) {
        toast(isCn ? '这场没有可复制的组' : 'Nothing to copy from this workout', 'info');
        return;
      }

      // 工作台里还有没结束的一场时，复制会把它从工作台上顶掉 —— 这个没有撤销，先问一句。
      if ((currentWorkout.exercises?.length ?? 0) > 0) {
        const ok = await confirm({
          message: isCn
            ? '工作台里还有一场没结束的训练，复制会把它替换掉。\n\n（它已经存过，之后可以从时间线里接着编辑。）'
            : 'There is an unfinished workout on the bench; copying replaces it.\n\n(It is already saved — you can keep editing it from the timeline.)',
          confirmLabel: isCn ? '继续复制' : 'Copy anyway',
        });
        if (!ok) return;
      }

      activeScheduleIdRef.current = null;
      setCurrentWorkout({
        ...workoutCtx.createNewWorkout(),
        title: src.title || '',
        tags: src.tags ?? [],
        exercises,
      });
      setEditingWorkoutId(null);
      setActiveTab('new');
      toast(
        isCn ? '已铺成底稿——点组号照抄' : 'Copied as drafts — tap a set number to confirm',
        'info',
      );
    },
    [confirm, currentWorkout.exercises, isCn, setActiveTab, setCurrentWorkout, toast, workoutCtx, workouts],
  );

  const handleDeleteExerciseRecord = useCallback(
    async (
      e: React.MouseEvent,
      workoutId: string,
      exerciseId: string,
      exerciseName: string,
      date: string,
    ) => {
      e.stopPropagation();

      const ok = await confirm({
        message: isCn
          ? `确定要删除 ${exerciseName} 在 ${date} 的记录吗？\n\n仅删除该动作，同场其他动作不受影响。`
          : `Delete ${exerciseName} from ${date}?\n\nOther exercises in this session stay unchanged.`,
        danger: true,
        confirmLabel: isCn ? '删除' : 'Delete',
      });
      if (!ok) return;

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

        const snapshot = structuredClone(workout);
        const updatedExercises = workout.exercises.filter(ex => ex.id !== exerciseId);
        const deletedWholeWorkout = updatedExercises.length === 0;

        if (deletedWholeWorkout) {
          await db.delete('workouts', workoutId);
          recordTombstone('workouts', workoutId);
        } else {
          await db.save('workouts', {
            ...workout,
            exercises: updatedExercises,
            userId: workout.userId,
          });
        }
        await refreshFromDb();
        scheduleDebouncedFitlogPush();

        toastUndo(
          isCn ? `已删除 ${exerciseName}` : `Deleted ${exerciseName}`,
          async () => {
            await db.save('workouts', snapshot);
            if (deletedWholeWorkout) removeTombstone('workouts', workoutId);
            await refreshFromDb();
            scheduleDebouncedFitlogPush();
          },
        );
      } catch (error) {
        console.error('Error deleting exercise record:', error);
        toast(isCn ? '删除失败，请重试' : 'Delete failed, please try again', 'error');
      }
    },
    [confirm, isCn, refreshFromDb, toast, toastUndo],
  );

  const handleStartScheduledSession = useCallback(
    async (scheduleId: string) => {
      const target = scheduleCtx.schedules.find(s => s.id === scheduleId);
      if (!target) return;
      // 进行中的训练现在会一直留在工作台（不再按返回就清空），从计划开练会顶掉它：先问一句（同「复制为今天」）
      if (!editingWorkoutId && (currentWorkout.exercises?.length ?? 0) > 0) {
        const ok = await confirm({
          message: isCn
            ? '工作台里还有一场没结束的训练，从计划开始会把它替换掉。\n\n（它已经存过，之后可以从时间线里接着编辑。）'
            : 'There is an unfinished workout on the bench; starting the plan replaces it.\n\n(It is already saved — you can keep editing it from the timeline.)',
          confirmLabel: isCn ? '继续' : 'Continue',
        });
        if (!ok) return;
      }
      activeScheduleIdRef.current = scheduleId;
      const empty = workoutCtx.createNewWorkout();
      const prefilled: WorkoutSession = {
        ...empty,
        title: target.title || (isCn ? '计划训练' : 'Planned session'),
        tags: target.bodyParts ?? [],
        notes: target.notes || '',
        exercises: (target.exercises || []).map((ex, i) => ({
          id: `${Date.now()}_${i}`,
          name: ex.name,
          category: ex.category,
          bodyPart: ex.bodyPart,
          // 计划里的组是「打算做的」，不是做完的：一律待做（第 4 条），点组号才入册
          sets: Array.from({ length: Math.max(1, ex.targetSets ?? 1) }, (_, j) => ({
            id: `${Date.now()}_${i}_${j}`,
            weight: ex.targetWeight ?? 0,
            reps: ex.targetReps ?? 0,
            ghost: true,
          })),
          tags: ex.tags ?? [],
        })),
      };
      setCurrentWorkout(prefilled);
      setEditingWorkoutId(null);
      setActiveTab('new');
      // 立即落盘
      onPersist?.();
    },
    [confirm, currentWorkout.exercises, editingWorkoutId, isCn, onPersist, scheduleCtx.schedules, setActiveTab, setCurrentWorkout, workoutCtx],
  );

  /**
   * 恢复一场已结束的训练回到工作台：清掉 finishedAt / status，
   * 它就重新变成「正在进行中的那一场」—— 再结束一次会写回同一个 id，
   * 不会多出一条记录。
   */
  const resumeWorkout = useCallback(
    async (w: WorkoutSession) => {
      const { finishedAt: _fa, status: _st, ...rest } = w;
      const resumed: WorkoutSession = { ...rest, updatedAt: new Date().toISOString() };
      await db.save('workouts', resumed);
      resumedWorkoutIdsRef.current.add(resumed.id);
      await refreshFromDb();
      setCurrentWorkout(resumed);
      setEditingWorkoutId(null);
      // 计划关联跟着一起回来，否则续练完这场就丢了 fromSchedule
      activeScheduleIdRef.current = w.fromSchedule?.scheduleId ?? null;
      setActiveTab('new');
      scheduleDebouncedFitlogPush();
    },
    [refreshFromDb, setActiveTab, setCurrentWorkout],
  );

  const startWorkoutGuarded = useCallback(
    async (proceed: () => void) => {
      const cutoff = Date.now() - RESUME_WINDOW_MS;
      const recent = workouts
        .filter(w => w.finishedAt && new Date(w.finishedAt).getTime() >= cutoff)
        .sort(
          (a, b) => new Date(b.finishedAt!).getTime() - new Date(a.finishedAt!).getTime(),
        )[0];
      if (!recent) {
        proceed();
        return;
      }
      const minsAgo = Math.max(
        1,
        Math.round((Date.now() - new Date(recent.finishedAt!).getTime()) / 60000),
      );
      const name = recent.title || (isCn ? '未命名训练' : 'Untitled');
      const ok = await confirm({
        title: isCn ? '继续刚才那场？' : 'Resume last workout?',
        message: isCn
          ? `「${name}」在 ${minsAgo} 分钟前刚结束。\n\n如果刚才是误点了结束，选「继续这场」把它接回来——新加的动作会记在同一场里。`
          : `"${name}" ended ${minsAgo} min ago.\n\nIf you ended it by mistake, resume it — new exercises will go into the same session.`,
        confirmLabel: isCn ? '继续这场' : 'Resume',
        cancelLabel: isCn ? '新开一场' : 'Start new',
      });
      if (ok) await resumeWorkout(recent);
      else proceed();
    },
    [confirm, isCn, resumeWorkout, workouts],
  );

  /** 这个动作（某个做法）最近一次练过的那一条，连同那一场 */
  const findLast = useCallback(
    (exerciseName: string, variantId?: string | null, skipWorkoutId?: string) => {
      const target = resolveName(exerciseName);
      if (!target) return null;
      for (const w of workouts) {
        if (skipWorkoutId && w.id === skipWorkoutId) continue;
        for (const we of w.exercises) {
          if (resolveName(we.name) !== target) continue;
          if (variantId !== null && variantId !== undefined && (variantIdOf(we) || undefined) !== (variantId || undefined)) continue;
          if (!we.sets?.some(s => !s.ghost)) continue;
          return { ex: we, workout: w };
        }
      }
      return null;
    },
    [resolveName, variantIdOf, workouts],
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
    ): Exercise => {
      const stamp = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const ghostSets = last?.ex.sets?.length ? toGhostSets(last.ex.sets, stamp) : null;
      const vid = variant ? variant.id : last ? variantIdOf(last.ex) : undefined;
      const vname = variant
        ? variant.name || variantsOf(name).find(v => v.id === variant.id)?.name
        : last?.ex.variantName || (vid ? variantsOf(name).find(v => v.id === vid)?.name : undefined);
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
        instanceConfig: last?.ex.instanceConfig
          ? { ...last.ex.instanceConfig }
          : {
              // 递增递减组不再默认开启（旧逻辑把库里 supportsPyramid 当成了默认启用）
              enablePyramid: false,
              pyramidMode: 'decreasing',
              // 只保留负重/辅助两个有语义的标记；'bodyweight' 折叠为标准
              bodyweightMode:
                defConfig?.bodyweightType === 'weighted' || defConfig?.bodyweightType === 'assisted'
                  ? defConfig.bodyweightType
                  : 'none',
              autoCalculateSubSets: false,
            },
      } as Exercise;
    },
    [variantIdOf, variantsOf],
  );

  const addExerciseToWorkout = useCallback(
    (
      ex: {
        id: string;
        name: { en: string; cn: string };
        category?: ExerciseCategory;
        exerciseConfig?: any;
      },
      _closeLibrary = false,
      opts: { altGroup?: string | null; variantId?: string } = {},
    ) => {
      const exerciseTime =
        editingWorkoutId && currentWorkout.date
          ? currentWorkout.date
          : new Date().toISOString();

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
      const last = findLast(exerciseName, opts.variantId ?? null);
      const newEx = buildExercise(
        exerciseName,
        ex.category || 'STRENGTH',
        last,
        exerciseTime,
        ex.exerciseConfig,
        opts.variantId ? { id: opts.variantId } : undefined,
      );

      /**
       * 上次是在交替组里练的：同组的其他动作一起带进来（本场已有的并进来），按轮换排（用户定：底稿按干净的轮换重排）。
       * 从交替组「加一个动作」进来的不带 —— 那时是往一个现成的组里加。
       */
      const partners: Exercise[] = [];
      const joinIds: string[] = [];
      let gid: string | undefined = opts.altGroup ?? undefined;
      if (!gid && last?.ex.altGroup) {
        const lastGroup = last.ex.altGroup;
        const mates = last.workout.exercises.filter(e => e.altGroup === lastGroup && e !== last.ex);
        if (mates.length) {
          gid = newGroupId();
          for (const m of mates) {
            const mName = resolveName(m.name);
            const inSession = (currentWorkout.exercises ?? []).find(e => resolveName(e.name) === mName);
            if (inSession) {
              if (!inSession.altGroup) joinIds.push(inSession.id);
              continue;
            }
            partners.push(
              buildExercise(m.name, m.category, { ex: m, workout: last.workout }, exerciseTime, undefined, undefined),
            );
          }
        }
      }
      // 成员顺序照上次那一场（轮换的先后）
      const order = last?.ex.altGroup ? last.workout.exercises.filter(e => e.altGroup === last.ex.altGroup).map(e => resolveName(e.name)) : [];
      const fresh = [newEx, ...partners]
        .map(e => (gid ? { ...e, altGroup: gid } : e))
        .sort((a, b) => order.indexOf(resolveName(a.name)) - order.indexOf(resolveName(b.name)));

      setCurrentWorkout((p: WorkoutSession) => {
        // 首次添加动作：如果没有 id，说明是全新的训练，先分配 id
        const needsId = !p.id;
        const workoutId = needsId ? Date.now().toString() : p.id;
        const base = needsId
          ? { ...p, id: workoutId, startTime: p.startTime || new Date().toISOString() }
          : p;
        // 追加到末尾（训练内按添加顺序排列；配合弹层关闭后的定位高亮）；交替组成员由 normalize 挪到一起
        let list = normalizeGroups([...(base.exercises || []), ...fresh]);
        if (gid && joinIds.length) list = groupExercises(list, [...fresh.map(e => e.id), ...joinIds]);
        return { ...base, exercises: list };
      });

      // 添加动作后立即触发 persist
      onPersist?.();
      return newEx.id;
    },
    [buildExercise, currentWorkout.date, currentWorkout.exercises, editingWorkoutId, findLast, isCn, lang, onPersist, resolveName, setCurrentWorkout, toast],
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
        if ((variantIdOf(ex) || undefined) === (variantId || undefined)) return p;
        const variantName = variantId
          ? name || variantsOf(ex.name).find(v => v.id === variantId)?.name
          : undefined;
        const untouched = ex.sets.every(
          st => st.ghost && !Object.values(st.touched ?? {}).some(Boolean),
        );
        let sets = ex.sets;
        let prefillFrom: string | undefined = ex.prefillFrom;
        if (untouched) {
          const hit = findLast(ex.name, variantId ?? '', p.id);
          const stamp = Date.now();
          sets = hit
            ? toGhostSets(hit.ex.sets, `${stamp}`)
            : [{ id: `${stamp}`, weight: 0, reps: 0, ghost: true }];
          prefillFrom = hit?.workout.date;
        }
        const { variantId: _v, variantName: _n, prefillFrom: _pf, ...rest } = ex;
        const next: Exercise = {
          ...rest,
          ...(variantId ? { variantId, variantName } : {}),
          ...(prefillFrom ? { prefillFrom } : {}),
          sets,
        };
        const copy = [...exs];
        copy[idx] = next;
        return { ...p, exercises: copy };
      });
      onPersist?.();
    },
    [findLast, onPersist, setCurrentWorkout, variantIdOf, variantsOf],
  );

  return {
    discardCurrentWorkout,
    switchExerciseVariant,
    saveStatus,
    setSaveStatus,
    editingWorkoutId,
    setEditingWorkoutId,
    hasUnsavedChanges,
    setHasUnsavedChanges,
    finishWorkout,
    colophon,
    dismissColophon,
    handleFinishWithConfirmation,
    handleEditWorkout,
    handleAddExerciseToPastWorkout,
    handleNewWorkoutBack,
    handleDeleteWorkout,
    handleMergeIntoPrevious,
    handleCopyWorkoutToToday,
    handleDeleteExerciseRecord,
    handleStartScheduledSession,
    startWorkoutGuarded,
    pendingScrollToPicker,
    setPendingScrollToPicker,
    activeScheduleIdRef,
    markActiveSchedulePending,
    addExerciseToWorkout,
    resumedWorkoutIdsRef,
  };
}