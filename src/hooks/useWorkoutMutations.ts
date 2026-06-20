/**
 * 训练记录的增改删 + 计划训练联动 + 单组动作删除
 * v2: "结束训练"语义 + 自动持久化支持
 */
import React, { useCallback, useRef, useState } from 'react';
import { Exercise, Language, WorkoutSession } from '../../types';
import { db } from '../../services/db';
import { recordTombstone, removeTombstone } from '../../services/fitlogTombstones';
import { scheduleDebouncedFitlogPush } from '../../services/fitlogSyncScheduler';
import { useWorkoutContext } from '../contexts/WorkoutContext';
import { useScheduleContext } from '../contexts/ScheduleContext';
import { useUserSettingsContext } from '../contexts/UserSettingsContext';
import { useAuthContext } from '../contexts/AuthContext';
import { useUiOverlay } from '../contexts/UiOverlayContext';
import { useExercisePrefs } from '../contexts/ExercisePrefsContext';
import { ExerciseCategory } from '../constants/exercises';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';
export type ActiveTab = 'dashboard' | 'new' | 'plan' | 'assistant' | 'profile';

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

export interface UseWorkoutMutationsResult {
  saveStatus: SaveStatus;
  setSaveStatus: React.Dispatch<React.SetStateAction<SaveStatus>>;

  editingWorkoutId: string | null;
  setEditingWorkoutId: React.Dispatch<React.SetStateAction<string | null>>;

  hasUnsavedChanges: boolean;
  setHasUnsavedChanges: React.Dispatch<React.SetStateAction<boolean>>;

  planConfirmOpen: boolean;
  setPlanConfirmOpen: React.Dispatch<React.SetStateAction<boolean>>;

  /** 结束训练（标记 completed + 清空 + 跳转） */
  finishWorkout: () => Promise<void>;
  /** 带单位提示的结束确认 */
  handleFinishWithConfirmation: () => Promise<void>;

  handleEditWorkout: (
    workoutId: string,
    options?: { scrollToPicker?: boolean },
  ) => void;
  handleAddExerciseToPastWorkout: (workoutId: string) => void;
  handleNewWorkoutBack: () => Promise<void>;
  handleDeleteWorkout: (workoutId: string) => Promise<void>;
  handleDeleteExerciseRecord: (
    e: React.MouseEvent,
    workoutId: string,
    exerciseId: string,
    exerciseName: string,
    date: string,
  ) => Promise<void>;

  handleStartScheduledSession: (scheduleId: string) => void;
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
  ) => void;
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
  const authCtx = useAuthContext();
  const { confirm, toast, toastUndo } = useUiOverlay();
  const { resolveName } = useExercisePrefs();

  const lang = settingsCtx.lang;
  const unit = settingsCtx.unit;
  const isCn = lang === Language.CN;
  const user = authCtx.user;

  const { workouts, currentWorkout, setCurrentWorkout, deleteWorkout, refreshFromDb, finishWorkout: ctxFinishWorkout } =
    workoutCtx;

  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [editingWorkoutId, setEditingWorkoutId] = useState<string | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [planConfirmOpen, setPlanConfirmOpen] = useState(false);
  const [pendingScrollToPicker, setPendingScrollToPicker] = useState(false);

  const activeScheduleIdRef = useRef<string | null>(null);
  const markActiveSchedulePending = useRef(false);

  /**
   * 结束训练：校验 → 标记 completed → 写 DB → 清空 workbench → 跳转
   */
  const finishWorkout = useCallback(async () => {
    setSaveStatus('saving');
    setHasUnsavedChanges(false);

    try {
      if (!currentWorkout.exercises || currentWorkout.exercises.length === 0) {
        toast(isCn ? '请至少添加一个动作' : 'Please add at least one exercise', 'error');
        setSaveStatus('error');
        return;
      }

      const hasData = currentWorkout.exercises.some(ex => ex.sets && ex.sets.length > 0);
      if (!hasData) {
        toast(isCn ? '请至少记录一组数据' : 'Please log at least one set', 'error');
        setSaveStatus('error');
        return;
      }

      if (!user) {
        setSaveStatus('error');
        return;
      }

      const scheduleId = activeScheduleIdRef.current;
      // 构建最终 session，追加 schedule 信息
      const finalWorkout: WorkoutSession = {
        ...currentWorkout,
        userId: user.id,
        title: currentWorkout.title || `Workout ${new Date().toLocaleDateString()}`,
        date: currentWorkout.date || new Date().toISOString(),
        ...(scheduleId ? { fromSchedule: { scheduleId, faithful: true } } : {}),
      };

      await ctxFinishWorkout(finalWorkout);
      await reloadAfterSave();

      if (scheduleId) {
        markActiveSchedulePending.current = true;
      }

      setSaveStatus('saved');

      setTimeout(() => {
        setActiveTab('dashboard');
        setCurrentWorkout(workoutCtx.createNewWorkout());
        setEditingWorkoutId(null);
        setSaveStatus('idle');
      }, 1500);
    } catch (error) {
      console.error('[useWorkoutMutations] 结束训练失败:', error);
      setSaveStatus('error');
      toast(isCn ? '结束训练失败，请重试' : 'Failed to end workout, please try again', 'error');
    }
  }, [currentWorkout, isCn, reloadAfterSave, setActiveTab, setCurrentWorkout, toast, user, workoutCtx, ctxFinishWorkout]);

  const handleFinishWithConfirmation = useCallback(async () => {
    const unitText = unit === 'kg' ? '公斤(kg)' : '磅(lbs)';
    const ok = await confirm({
      message: isCn
        ? `确认结束当前训练吗？\n\n当前单位设置: ${unitText}\n\n训练将被标记为已完成并保存到历史记录。`
        : `Confirm ending this workout?\n\nCurrent unit: ${unitText}\n\nThe workout will be marked as completed and saved to history.`,
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
    // 新训练 + 有内容：提示（但数据已在 DB 中安全）
    if (hasContent && !editingWorkoutId) {
      const ok = await confirm({
        message: isCn
          ? '训练数据已自动保存。确定要返回吗？'
          : 'Workout data is auto-saved. Continue?',
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
    async (workoutId: string) => {
      const w = workouts.find(x => x.id === workoutId);
      if (!w) return;
      const dateLabel = new Date(w.date).toLocaleDateString(isCn ? 'zh-CN' : 'en-US');
      const ok = await confirm({
        message: isCn
          ? `确定要删除 ${dateLabel} 的整场训练吗？`
          : `Delete the entire workout from ${dateLabel}?`,
        danger: true,
        confirmLabel: isCn ? '删除' : 'Delete',
      });
      if (!ok) return;
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
      // 计划训练预填后立即落盘
      setTimeout(() => onPersist?.(), 50);
    },
    [isCn, onPersist, scheduleCtx.schedules, setActiveTab, setCurrentWorkout, workoutCtx],
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
      // 在历史训练中查找该动作最近一次出现，继承上次使用的配置和重量
      const resolvedTarget = resolveName(exerciseName);
      let lastExercise: Exercise | null = null;
      if (resolvedTarget) {
        for (const w of workouts) {
          for (const we of w.exercises) {
            if (resolveName(we.name) === resolvedTarget) {
              lastExercise = we;
              break;
            }
          }
          if (lastExercise) break;
        }
      }

      const lastSet =
        lastExercise?.sets && lastExercise.sets.length > 0
          ? lastExercise.sets[lastExercise.sets.length - 1]
          : null;

      setCurrentWorkout(p => {
        // 首次添加动作：如果没有 id，说明是全新的训练，先分配 id
        const needsId = !p.id;
        const workoutId = needsId ? Date.now().toString() : p.id;
        const base = needsId
          ? { ...p, id: workoutId, startTime: p.startTime || new Date().toISOString(), status: 'draft' as const }
          : p;
        return {
          ...base,
          exercises: [
            {
              id: `exercise_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
              name: exerciseName,
              category: ex.category || 'STRENGTH',
              sets: [
                {
                  id: Date.now().toString(),
                  weight: lastSet?.weight ?? 0,
                  reps: lastSet?.reps ?? 0,
                },
              ],
              exerciseTime,
              instanceConfig: lastExercise?.instanceConfig
                ? { ...lastExercise.instanceConfig }
                : {
                    enablePyramid: ex.exerciseConfig?.supportsPyramid || false,
                    pyramidMode: 'decreasing',
                    bodyweightMode: ex.exerciseConfig?.bodyweightType || 'none',
                    autoCalculateSubSets: false,
                  },
            } as Exercise,
            ...(base.exercises || []),
          ],
        };
      });

      // 添加动作后触发 persist
      setTimeout(() => onPersist?.(), 50);
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
    planConfirmOpen,
    setPlanConfirmOpen,
    finishWorkout,
    handleFinishWithConfirmation,
    handleEditWorkout,
    handleAddExerciseToPastWorkout,
    handleNewWorkoutBack,
    handleDeleteWorkout,
    handleDeleteExerciseRecord,
    handleStartScheduledSession,
    pendingScrollToPicker,
    setPendingScrollToPicker,
    activeScheduleIdRef,
    markActiveSchedulePending,
    addExerciseToWorkout,
  };
}