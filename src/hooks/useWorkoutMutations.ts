/**
 * 训练记录的增改删 + 计划训练联动 + 单组动作删除
 * v3: 移除 draft/completed 分流，简化结束训练逻辑
 */
import React, { useCallback, useRef, useState } from 'react';
import { Exercise, Language, SetLog, WorkoutSession } from '../../types';
import { db } from '../../services/db';
import { recordTombstone, removeTombstone } from '../../services/fitlogTombstones';
import { scheduleDebouncedFitlogPush } from '../../services/fitlogSyncScheduler';
import { useWorkoutContext } from '../contexts/WorkoutContext';
import { useScheduleContext } from '../contexts/ScheduleContext';
import { useUserSettingsContext } from '../contexts/UserSettingsContext';
import { useUiOverlay } from '../contexts/UiOverlayContext';
import { useExercisePrefs } from '../contexts/ExercisePrefsContext';
import { ExerciseCategory } from '../constants/exercises';
import { detectPRs, sessionSummary, PRHit } from '../utils/prDetect';
import { KG_TO_LBS } from '../constants';

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
 * 只抄数值字段：力竭是当日事实、递减子组是结构性的（长按重建），都不继承。
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

  handleStartScheduledSession: (scheduleId: string) => void;

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

  /** 添加动作到当前训练 */
  addExerciseToWorkout: (
    ex: { id: string; name: { en: string; cn: string }; category?: ExerciseCategory; exerciseConfig?: any },
    closeLibrary?: boolean,
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
  const { resolveName, getActiveMetrics } = useExercisePrefs();

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
  const markActiveSchedulePending = useRef(false);

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
       */
      const cleanedExercises = currentWorkout.exercises
        .map(ex => {
          const { prefillFrom: _pf, prefillGym: _pg, ...rest } = ex;
          return { ...rest, sets: ex.sets.filter(s => !s.ghost) };
        })
        .filter(ex => ex.sets.length > 0);

      if (cleanedExercises.length === 0) {
        setSaveStatus('idle');
        toast(
          isCn
            ? '还没有描实任何一组——底稿不入册'
            : 'No sets confirmed yet — drafts are not saved',
          'info',
        );
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
        getActiveMetrics,
        unitLabel: unit,
      });
      const summary = sessionSummary(finalWorkout);
      const volume = unit === 'lbs' ? summary.volumeKg * KG_TO_LBS : summary.volumeKg;

      await ctxFinishWorkout(finalWorkout);

      setColophon({
        issueNo: workouts.length + 1,
        title: finalWorkout.title,
        dateISO: finalWorkout.date,
        exerciseCount: summary.exerciseCount,
        setCount: summary.setCount,
        volume,
        unitLabel: unit,
        stamps: pr.stamps,
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
    getActiveMetrics,
    unit,
  ]);

  const handleFinishWithConfirmation = useCallback(async () => {
    console.log('[DEBUG] handleFinishWithConfirmation 被调用');
    const unitText = isCn ? (unit === 'kg' ? '公斤(kg)' : '磅(lbs)') : unit === 'kg' ? 'kg' : 'lbs';
    const ok = await confirm({
      message: isCn
        ? `确认结束当前训练吗？\n\n当前单位设置: ${unitText}\n\n训练将被添加到历史记录。`
        : `Confirm ending this workout?\n\nCurrent unit: ${unitText}\n\nThe workout will be saved to history.`,
      confirmLabel: isCn ? '结束训练' : 'End Workout',
    });
    if (ok) await finishWorkout();
  }, [confirm, finishWorkout, isCn, unit]);

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
    const hasContent = (currentWorkout?.exercises?.length ?? 0) > 0;
    if (hasContent && !editingWorkoutId) {
      const ok = await confirm({
        message: isCn
          ? '训练数据已自动保存。确定要返回吗？'
          : 'Workout data is auto-saved. Continue back?',
      });
      if (!ok) return;
      setCurrentWorkout(workoutCtx.createNewWorkout());
    } else if (editingWorkoutId && hasUnsavedChanges) {
      const ok = await confirm({
        message: isCn
          ? '有未保存的修改，确定要返回吗？'
          : 'Unsaved edits will be lost. Continue?',
      });
      if (!ok) return;
      setCurrentWorkout(workoutCtx.createNewWorkout());
    }
    setEditingWorkoutId(null);
    const prev = getPreviousTab();
    setActiveTab(prev === 'new' ? 'dashboard' : prev);
    void workoutCtx.refreshFromDb();
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
      const exercises: Exercise[] = (src.exercises || [])
        .map((ex, i) => ({
          id: `exercise_${stamp}_${i}`,
          name: ex.name,
          category: ex.category,
          ...(ex.bodyPart ? { bodyPart: ex.bodyPart } : {}),
          tags: ex.tags ?? [],
          sets: toGhostSets(ex.sets, `${stamp}_${i}`),
          exerciseTime: new Date().toISOString(),
          ...(src.date ? { prefillFrom: src.date } : {}),
          ...(ex.instanceConfig ? { instanceConfig: { ...ex.instanceConfig } } : {}),
        }))
        // 来源里只剩底稿的动作（未收尾的草稿）没有可抄的事实，整个动作丢掉
        .filter(ex => ex.sets.length > 0);

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
    (scheduleId: string) => {
      const target = scheduleCtx.schedules.find(s => s.id === scheduleId);
      if (!target) return;
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
          sets: Array.from({ length: Math.max(1, ex.targetSets ?? 1) }, (_, j) => ({
            id: `${Date.now()}_${i}_${j}`,
            weight: ex.targetWeight ?? 0,
            reps: ex.targetReps ?? 0,
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
    [isCn, onPersist, scheduleCtx.schedules, setActiveTab, setCurrentWorkout, workoutCtx],
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

  const addExerciseToWorkout = useCallback(
    (
      ex: {
        id: string;
        name: { en: string; cn: string };
        category?: ExerciseCategory;
        exerciseConfig?: any;
      },
      _closeLibrary = false,
    ) => {
      const exerciseTime =
        editingWorkoutId && currentWorkout.date
          ? currentWorkout.date
          : new Date().toISOString();

      const exerciseName = ex.name[lang];
      // 在历史训练中查找该动作最近一次出现，继承上次使用的配置，
      // 并把上次的【每一组】铺成底稿（§12.6）。
      const resolvedTarget = resolveName(exerciseName);
      let lastExercise: Exercise | null = null;
      let lastExerciseDate: string | null = null;
      let lastExerciseGym: string | undefined;
      if (resolvedTarget) {
        for (const w of workouts) {
          for (const we of w.exercises) {
            if (resolveName(we.name) === resolvedTarget) {
              lastExercise = we;
              lastExerciseDate = w.date || null;
              lastExerciseGym = w.gym;
              break;
            }
          }
          if (lastExercise) break;
        }
      }

      /**
       * 底稿预填（§12.6）：上次的每一组以 ghost 行躺进来 ——
       * 点组号照抄、改哪格记哪格，没描实的结束时整行丢弃。
       * 旧行为是把上次末组的值直接写成【真实数据】，
       * 那等于替用户上报了他没做过的事，方向就是错的。
       *
       * 只抄数值字段：力竭是当日事实、递减子组是结构性的，都不继承。
       */
      const stamp = Date.now();
      const ghostSets = lastExercise?.sets?.length
        ? toGhostSets(lastExercise.sets, `${stamp}`)
        : null;

      const newExerciseId = `exercise_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      setCurrentWorkout((p: WorkoutSession) => {
        // 首次添加动作：如果没有 id，说明是全新的训练，先分配 id
        const needsId = !p.id;
        const workoutId = needsId ? Date.now().toString() : p.id;
        const base = needsId
          ? { ...p, id: workoutId, startTime: p.startTime || new Date().toISOString() }
          : p;
        return {
          ...base,
          // 追加到末尾（训练内按添加顺序排列；配合弹层关闭后的定位高亮）
          exercises: [
            ...(base.exercises || []),
            {
              id: newExerciseId,
              name: exerciseName,
              category: ex.category || 'STRENGTH',
              sets:
                ghostSets && ghostSets.length > 0
                  ? ghostSets
                  : [{ id: Date.now().toString(), weight: 0, reps: 0 }],
              ...(ghostSets && ghostSets.length > 0 && lastExerciseDate
                ? { prefillFrom: lastExerciseDate }
                : {}),
              // §12.11：记下底稿来源那一场的场地，**无条件记**。
              // 「跟本场是不是同一个馆」留到渲染时再判 —— 加完动作再回头改本场
              // 场地是常见操作，在这里定死会留下一条自相矛盾的眉批。
              ...(ghostSets && ghostSets.length > 0 && lastExerciseGym
                ? { prefillGym: lastExerciseGym }
                : {}),
              exerciseTime,
              instanceConfig: lastExercise?.instanceConfig
                ? { ...lastExercise.instanceConfig }
                : {
                    // 递增递减组不再默认开启（旧逻辑把库里 supportsPyramid 当成了默认启用）
                    enablePyramid: false,
                    pyramidMode: 'decreasing',
                    // 只保留负重/辅助两个有语义的标记；'bodyweight' 折叠为标准
                    bodyweightMode:
                      ex.exerciseConfig?.bodyweightType === 'weighted' ||
                      ex.exerciseConfig?.bodyweightType === 'assisted'
                        ? ex.exerciseConfig.bodyweightType
                        : 'none',
                    autoCalculateSubSets: false,
                  },
            } as Exercise,
          ],
        };
      });

      // 添加动作后立即触发 persist
      onPersist?.();
      return newExerciseId;
    },
    [currentWorkout.date, editingWorkoutId, lang, onPersist, resolveName, setCurrentWorkout, workouts],
  );

  return {
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
  };
}