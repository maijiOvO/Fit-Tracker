/**
 * App.tsx —— 顶层壳层
 *
 * 历史上这个文件曾承担了所有 UI 状态、模态框、副作用、数据迁移逻辑（3000+ 行）。
 * 现已被拆分到：
 *   - src/contexts/ExercisePrefsContext       动作偏好（标签 / 自定义动作 / 备注 / 维度 / 星标 / 覆盖）
 *   - src/hooks/useFitlogSync                 启动初始化 + 远端同步
 *   - src/hooks/useWorkoutMutations           训练增删改 + 计划训练联动
 *   - src/hooks/useWeightLog                  体重日志
 *   - src/hooks/useMeasurementLog             身体指标
 *   - src/hooks/useAvatarUpload               头像上传
 *   - src/hooks/useExportData                 数据导出
 *   - src/hooks/useResetAccount               一键重置账户
 *   - src/hooks/useFilteredExercises          动作库过滤 + 热力图
 *   - src/components/modals/*                 全部 Modal UI（14 个）
 *   - src/components/AppHeader                顶部导航
 *
 * 本文件只保留：Provider 装配、Tab 路由、跨 Tab 共享的 UI 胶水。
 */
import React, {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { ExerciseDefinition, Goal, Language } from './types';
import { translations } from './translations';
import { db } from './services/db';
import { isDevMode, isEnvLocked, isRemoteConfigured, readPrefsFromLocalStorage } from './services/fitlogRemote';
import { switchDataEnv } from './services/fitlogRemoteSync';
import { scheduleDebouncedFitlogPush } from './services/fitlogSyncScheduler';
import { recordTombstone } from './services/fitlogTombstones';
import { FITLOG_SOLO_USER_ID } from './services/fitlogSolo';

import {
  BODY_PARTS,
  DEFAULT_EXERCISES,
  EQUIPMENT_TAGS,
  ExerciseCategory,
} from './src/constants/exercises';
import { getLoadMode, LoadMode } from './src/utils/exerciseConfig';

import TabNavigation from './src/components/TabNavigation';
import { NewWorkoutTab } from './src/components/NewWorkoutTab';
import { DateTimePicker } from './src/components/DateTimePicker';
import { EditExerciseTagsModal } from './src/components/EditExerciseTagsModal';
import { AppHeader } from './src/components/AppHeader';
import {
  AddCustomExerciseModal,
  AddGoalModal,
  AddTagModal,
  DurationPickerModal,
  EditGoalModal,
  ExerciseDateTimePickerModal,
  LibraryModal,
  MeasurementModal,
  MetricSettingsModal,
  NoteModal,
  RenameModal,
  ResetAccountModal,
  TagManageModal,
  WeightInputModal,
} from './src/components/modals';

import {
  AuthProvider,
  ExercisePrefsProvider,
  GoalsProvider,
  ScheduleProvider,
  UiOverlayProvider,
  UserSettingsProvider,
  WorkoutProvider,
  useAuthContext,
  useExercisePrefs,
  useScheduleContext,
  useUiOverlay,
  useUserSettingsContext,
  useWorkoutContext,
} from './src/contexts';

import { useKeyboardScroll } from './src/hooks/useKeyboardScroll';
import { useTheme } from './src/hooks/useTheme';
import { useExerciseStats, useFilteredExercises } from './src/hooks/useFilteredExercises';
import { useFitlogSync } from './src/hooks/useFitlogSync';
import { useWorkoutMutations, type ActiveTab } from './src/hooks/useWorkoutMutations';
import { useWeightLog } from './src/hooks/useWeightLog';
import { useMeasurementLog } from './src/hooks/useMeasurementLog';
import { useAvatarUpload } from './src/hooks/useAvatarUpload';
import { useExportData } from './src/hooks/useExportData';
import { useResetAccount } from './src/hooks/useResetAccount';
import { storage } from './services/appStorage';
import { WorkoutColophon } from './src/components/WorkoutColophon';

// 懒加载 Tab 组件
const Dashboard = lazy(() => import('./src/components/Dashboard'));
const ProfileTab = lazy(() =>
  import('./src/components/ProfileTab').then(m => ({ default: m.default })),
);
const PlanTab = lazy(() =>
  import('./src/components/PlanTab').then(m => ({ default: m.default })),
);

interface AppWithAuthProps {
  /** 单机版固定传入 FITLOG_SOLO_USER_ID（保留接口便于测试） */
  userId?: string;
}

const TabSuspenseFallback: React.FC = () => (
  <div className="flex items-center justify-center min-h-[60vh]">
    <div className="animate-spin w-8 h-8 border-4 border-accent border-t-transparent rounded-full" />
  </div>
);

const AppWithAuth: React.FC<AppWithAuthProps> = props => {
  const lang = useUserSettingsContext().lang;
  return (
    <UiOverlayProvider lang={lang}>
      <ExercisePrefsProvider>
        <AppWithAuthShell {...props} />
      </ExercisePrefsProvider>
    </UiOverlayProvider>
  );
};

const AppWithAuthShell: React.FC<AppWithAuthProps> = ({ userId: propUserId }) => {
  const resolvedUserId = propUserId || FITLOG_SOLO_USER_ID;
  const { confirm, toast, toastUndo } = useUiOverlay();

  const authCtx = useAuthContext();
  const workoutCtx = useWorkoutContext();
  const scheduleCtx = useScheduleContext();
  const settingsCtx = useUserSettingsContext();
  const prefs = useExercisePrefs();

  const lang = settingsCtx.lang;
  const isCn = lang === Language.CN;
  const setLang = settingsCtx.setLang;
  const unit = settingsCtx.unit;
  const setUnit = settingsCtx.setUnit;
  const weightEntries = settingsCtx.weightEntries;
  const measurements = settingsCtx.measurements;

  const user = authCtx.user;

  const workouts = workoutCtx.workouts;
  const currentWorkout = workoutCtx.currentWorkout;
  const setCurrentWorkout = workoutCtx.setCurrentWorkout;

  // ============== 一级 UI 状态：Tab 切换 ==============
  const [activeTab, _setActiveTab] = useState<ActiveTab>('dashboard');
  const [previousTab, setPreviousTab] = useState<ActiveTab>('dashboard');
  const setActiveTab = useCallback((tab: ActiveTab) => {
    _setActiveTab(prev => {
      if (prev !== 'new' && tab === 'new') {
        setPreviousTab(prev);
      }
      return tab;
    });
  }, []);
  useKeyboardScroll(activeTab === 'new');

  // ============== 动作库筛选 UI 状态 ==============
  const [activeLibraryCategory, setActiveLibraryCategory] =
    useState<ExerciseCategory | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [isEditingTags, setIsEditingTags] = useState(false);
  const [showLibrary, setShowLibrary] = useState(false);
  const libraryPickCallbackRef = useRef<((ex: ExerciseDefinition) => void) | null>(null);
  const openLibraryForPicker = useCallback(
    (cb: (ex: ExerciseDefinition) => void) => {
      libraryPickCallbackRef.current = cb;
      setActiveLibraryCategory(null);
      setSelectedTags([]);
      setSearchQuery('');
      setShowLibrary(true);
    },
    [],
  );
  /** 训练页弹层头部入口：标签管理（只管标签词表，不再进全屏动作库） */
  const [showTagManage, setShowTagManage] = useState(false);

  // ============== 训练页「添加动作」弹层 ==============
  const [pickerSheetOpen, setPickerSheetOpen] = useState(false);
  /** §12.4：经由 FAB 印谱选了「制」的训练 id —— 进页不再问部位、聚焦标题 */
  const [partPrechosenId, setPartPrechosenId] = useState<string | null>(null);
  const [sheetSessionAdded, setSheetSessionAdded] = useState(0);
  const [flashExerciseId, setFlashExerciseId] = useState<string | null>(null);
  const lastAddedExerciseIdRef = useRef<string | null>(null);

  // ============== Library Modal —— 增加自定义动作 / 自定义标签 ==============
  const [showAddTagModal, setShowAddTagModal] = useState(false);
  const [newTagName, setNewTagName] = useState('');
  const [newTagCategory, setNewTagCategory] = useState<'bodyPart' | 'equipment'>(
    'bodyPart',
  );

  const [showRenameModal, setShowRenameModal] = useState(false);
  const [tagToRename, setTagToRename] = useState<{ id: string; name: string } | null>(
    null,
  );
  const [newTagNameInput, setNewTagNameInput] = useState('');

  const [showRenameExerciseModal, setShowRenameExerciseModal] = useState(false);
  const [exerciseToRename, setExerciseToRename] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [newExerciseNameInput, setNewExerciseNameInput] = useState('');

  const [showAddExerciseModal, setShowAddExerciseModal] = useState(false);
  const [newExerciseName, setNewExerciseName] = useState('');
  const [newExerciseTags, setNewExerciseTags] = useState<string[]>([]);
  const [newExerciseBodyPart, setNewExerciseBodyPart] = useState<string>('');
  const [newExerciseCategory, setNewExerciseCategory] =
    useState<ExerciseCategory>('STRENGTH');

  // ============== Dashboard PR 选择 / 图表偏好 ==============
  const [selectedPRProject, setSelectedPRProject] = useState<string | null>(null);
  const [chartMetricPreference, setChartMetricPreference] = useState<
    Record<string, string>
  >({});
  // ============== 动作维度 / 备注 弹窗 ==============
  const [showMetricModal, setShowMetricModal] = useState<{ name: string; exIdx?: number } | null>(null);
  const [noteModalData, setNoteModalData] = useState<{
    name: string;
    note: string;
  } | null>(null);

  // ============== 编辑动作标签 / 单组时长 / 单条动作时间 弹窗 ==============
  const [editExerciseTagsTarget, setEditExerciseTagsTarget] =
    useState<ExerciseDefinition | null>(null);
  const [showTimePicker, setShowTimePicker] = useState<{
    exIdx: number;
    setIdx: number;
  } | null>(null);
  const [showTimePickerModal, setShowTimePickerModal] = useState<{
    exerciseId?: string;
    currentTime?: string;
  } | null>(null);
  // ============== 编辑模式下训练日期选择 ==============
  const [showWorkoutDatePicker, setShowWorkoutDatePicker] = useState(false);

  // ============== 目标弹窗 ==============
  const [showGoalModal, setShowGoalModal] = useState(false);
  const [newGoal, setNewGoal] = useState<Partial<Goal>>({
    type: 'weight',
    targetValue: 0,
    currentValue: 0,
    label: '',
  });
  const [showEditGoalModal, setShowEditGoalModal] = useState(false);
  const [editingGoal, setEditingGoal] = useState<Goal | null>(null);

  // ============== 业务 hooks ==============
  const { syncStatus, setSyncStatus, performFullSync, loadLocalData } =
    useFitlogSync(resolvedUserId);

  const {
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
  } = useWorkoutMutations({
    setActiveTab,
    reloadAfterSave: () => loadLocalData(resolvedUserId),
    getPreviousTab: () => previousTab,
    onEnterEditWorkout: () => setSelectedPRProject(null),
    onPersist: () => workoutCtx.persistCurrentWorkout(),
  });

  const {
    showWeightInput,
    setShowWeightInput,
    weightInputValue,
    setWeightInputValue,
    editingWeightId,
    setEditingWeightId,
    handleLogWeight,
    handleDeleteWeightEntry,
    triggerEditWeight,
  } = useWeightLog(() => setSelectedPRProject('__WEIGHT__'));

  const {
    showMeasureModal,
    setShowMeasureModal,
    editingMeasurementId,
    setEditingMeasurementId,
    measureForm,
    setMeasureForm,
    expandedMetric,
    setExpandedMetric,
    latestMetrics,
    handleSaveMeasurement,
    handleDeleteMeasurement,
    triggerEditMeasurement,
    openAddMeasurementEntry,
  } = useMeasurementLog();

  const { fileInputRef, handleAvatarUpload } = useAvatarUpload();
  const handleExportData = useExportData(setSyncStatus);

  // ============== 数据环境切换（dev ⇄ prod，运行时，无需重启）==============
  // 本地存储已按环境分区（IndexedDB 分库 + localStorage 前缀），
  // 切换只是换一个命名空间；switchDataEnv 内部保证失败时回滚。
  const [devMode, setDevModeState] = useState(() => isDevMode());
  const envLocked = isEnvLocked();

  const handleToggleDevMode = useCallback(async () => {
    if (envLocked) return;
    const next = !devMode;
    setSyncStatus('syncing');
    try {
      await switchDataEnv(next ? 'dev' : 'prod');
      setDevModeState(next);

      const refreshedPrefs = readPrefsFromLocalStorage();
      prefs.applyPrefsFromSnapshot(refreshedPrefs);
      if (refreshedPrefs.lang) settingsCtx.setLang(refreshedPrefs.lang as Language);
      if (refreshedPrefs.unit) settingsCtx.setUnit(refreshedPrefs.unit);
      authCtx.setUser(
        authCtx.user
          ? { ...authCtx.user, avatarUrl: refreshedPrefs.avatarDataUrl ?? undefined }
          : authCtx.user,
      );
      await loadLocalData(resolvedUserId);
      toast(
        isCn
          ? (next ? '已切换到开发环境（state-dev）' : '已切换到用户环境（state）')
          : (next ? 'Switched to dev env (state-dev)' : 'Switched to user env (state)'),
        'info',
      );
    } catch (e) {
      // switchDataEnv 已回滚到原环境，UI 状态保持不变即可
      console.error('[fitlog] 切换数据环境失败:', e);
      setDevModeState(isDevMode());
      await loadLocalData(resolvedUserId);
      toast(
        isCn
          ? '切换失败，已回到原环境'
          : 'Switch failed, rolled back to the previous environment',
        'error',
      );
    } finally {
      setSyncStatus('idle');
    }
  }, [devMode, envLocked, isCn, toast, loadLocalData, resolvedUserId, prefs, settingsCtx, authCtx, setSyncStatus]);

  const {
    showResetAccountModal,
    setShowResetAccountModal,
    resetConfirmText,
    setResetConfirmText,
    isResetting,
    handleResetAccount,
  } = useResetAccount({ setActiveTab, setEditingWorkoutId });

  const filteredExercises = useFilteredExercises({
    searchQuery,
    selectedTags,
    activeLibraryCategory,
  });
  const { recentExerciseNames, heatmapData } = useExerciseStats();

  // ============== 「补加动作」：进入训练页后直接弹出添加动作弹层 ==============
  useEffect(() => {
    if (activeTab === 'new' && pendingScrollToPicker) {
      const timer = setTimeout(() => {
        setSheetSessionAdded(0);
        lastAddedExerciseIdRef.current = null;
        setPickerSheetOpen(true);
        setPendingScrollToPicker(false);
      }, 120);
      return () => clearTimeout(timer);
    }
  }, [activeTab, pendingScrollToPicker, setPendingScrollToPicker]);

  // ============== 训练保存后回写关联日程为 completed ==============
  useEffect(() => {
    if (!markActiveSchedulePending.current) return;
    const id = activeScheduleIdRef.current;
    if (!id) return;
    const target = scheduleCtx.schedules.find(s => s.id === id);
    if (!target) return;
    const lastWorkout = workouts[0];
    if (!lastWorkout) return;
    void scheduleCtx.updateSchedule({
      ...target,
      status: 'completed',
      linkedWorkoutId: lastWorkout.id,
      updatedAt: new Date().toISOString(),
    });
    activeScheduleIdRef.current = null;
    markActiveSchedulePending.current = false;
  }, [workouts, scheduleCtx, activeScheduleIdRef, markActiveSchedulePending]);

  // ============== 监听训练编辑：标记未保存 + 自动持久化 ==============
  useEffect(() => {
    if (currentWorkout?.exercises && currentWorkout.exercises.length > 0) {
      const hasAnyData = currentWorkout.exercises.some(
        ex =>
          ex.sets &&
          ex.sets.length > 0 &&
          // 底稿行（ghost）不算数据：一组都没描实的训练不该亮「未保存」（§12.6）
          ex.sets.some(
            set =>
              !set.ghost &&
              (set.weight || set.reps || set.distance || set.duration || set.score),
          ),
      );
      setHasUnsavedChanges(hasAnyData);
      // 任何 exercises 变化都触发 debounce persist
      workoutCtx.persistCurrentWorkout();
    } else {
      setHasUnsavedChanges(false);
    }
  }, [currentWorkout, setHasUnsavedChanges, workoutCtx]);

  // ============== 监听远端推送失败：通知用户 ==============
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      const message = typeof detail === 'string' ? detail : (detail?.message ?? '');
      const kind = typeof detail === 'string' ? 'unreachable' : detail?.kind;

      // 403 / 409 是配置问题（key 用错端点 / 环境标记写反），不是网络抖动，
      // 提示要直接指向该改的地方，而不是笼统的"同步失败"。
      if (kind === 'forbidden-endpoint') {
        toast(String(translations.remoteForbiddenEndpoint[lang]), 'error');
        return;
      }
      if (kind === 'env-mismatch') {
        toast(String(translations.remoteEnvMismatch[lang]), 'error');
        return;
      }
      toast(
        isCn
          ? `云端同步失败：${message}。数据仅保存在本地。`
          : `Sync failed: ${message}. Data saved locally only.`,
        'error',
      );
    };
    window.addEventListener('fitlog:push-failed', handler);
    return () => window.removeEventListener('fitlog:push-failed', handler);
  }, [isCn, lang, toast]);

  const dashboardActions = useMemo(
    () => ({
      onStartNewWorkout: () => {
        void startWorkoutGuarded(() => {
          setEditingWorkoutId(null);
          setActiveTab('new');
        });
      },
      onEditWorkout: handleEditWorkout,
      onAddExerciseToPastWorkout: handleAddExerciseToPastWorkout,
      onDeleteWorkout: handleDeleteWorkout,
      onMergeIntoPrevious: handleMergeIntoPrevious,
      onCopyWorkoutToToday: handleCopyWorkoutToToday,
      onDeleteExerciseRecord: handleDeleteExerciseRecord,
      onDeleteWeightEntry: handleDeleteWeightEntry,
      onLogWeight: () => {
        setEditingWeightId(null);
        setWeightInputValue('');
        setShowWeightInput(true);
      },
      onEditWeight: triggerEditWeight,
      onExportData: handleExportData,
    }),
    [
      handleEditWorkout,
      handleAddExerciseToPastWorkout,
      handleDeleteWorkout,
      handleMergeIntoPrevious,
      handleCopyWorkoutToToday,
      handleDeleteExerciseRecord,
      handleDeleteWeightEntry,
      triggerEditWeight,
      handleExportData,
      startWorkoutGuarded,
      setEditingWorkoutId,
      setActiveTab,
      setEditingWeightId,
      setWeightInputValue,
      setShowWeightInput,
    ],
  );

  const handleToggleLanguage = useCallback(() => {
    const nextLang = lang === Language.CN ? Language.EN : Language.CN;
    if (selectedPRProject && selectedPRProject !== '__WEIGHT__') {
      // 切换语言时把当前所选 PR 项目同步成另一语言的名字，保持高亮
      const allDef = [...DEFAULT_EXERCISES, ...prefs.customExercises];
      const def = allDef.find(d => {
        const over = prefs.exerciseOverrides[d.id];
        const nameInCurrentLang = over?.name?.[lang] || d.name[lang];
        return nameInCurrentLang === selectedPRProject;
      });
      if (def) {
        const nameInNextLang =
          prefs.exerciseOverrides[def.id]?.name?.[nextLang] || def.name[nextLang];
        setSelectedPRProject(nameInNextLang);
      }
    }
    setLang(nextLang);
    storage.setItem('fitlog_lang', nextLang);
  }, [lang, prefs.customExercises, prefs.exerciseOverrides, selectedPRProject, setLang]);

  const handleUnitToggle = useCallback(() => {
    const newUnit = unit === 'kg' ? 'lbs' : 'kg';
    setUnit(newUnit);
    storage.setItem('fitlog_unit', newUnit);
  }, [setUnit, unit]);

  // ============== 目标的增 / 改 ==============
  const handleAddGoal = useCallback(async () => {
    if (!newGoal.label || !newGoal.targetValue || !user) return;
    const now = new Date().toISOString();
    const goal: Goal = {
      id: Date.now().toString(),
      userId: user.id,
      type: newGoal.type!,
      category: newGoal.type as string,
      title: newGoal.label!,
      description: '',
      targetValue: newGoal.targetValue!,
      currentValue: newGoal.currentValue || 0,
      unit:
        newGoal.type === 'weight'
          ? unit
          : newGoal.type === 'strength'
            ? unit
            : 'times/week',
      startDate: now,
      targetDate: undefined,
      dataSource: 'manual',
      autoUpdateRule: undefined,
      progressHistory: [],
      isActive: true,
      createdAt: now,
      updatedAt: now,
      completedAt: undefined,
      label: newGoal.label!,
      deadline: undefined,
    };
    await db.save('goals', goal);
    await loadLocalData(resolvedUserId);
    setShowGoalModal(false);
    scheduleDebouncedFitlogPush();
  }, [loadLocalData, newGoal, resolvedUserId, unit, user]);

  const handleSaveEditedGoal = useCallback(async () => {
    if (!editingGoal || !user) return;
    const updatedGoal: Goal = {
      ...editingGoal,
      updatedAt: new Date().toISOString(),
    };
    await db.save('goals', updatedGoal);
    await loadLocalData(resolvedUserId);
    setShowEditGoalModal(false);
    scheduleDebouncedFitlogPush();
  }, [editingGoal, loadLocalData, resolvedUserId, user]);

  const handleCancelEditGoal = () => {
    setEditingGoal(null);
    setShowEditGoalModal(false);
  };

  // ============== 维度 Modal: 重置默认 ==============
  const handleResetMetricsToDefault = useCallback(async () => {
    if (!showMetricModal) return;
    const ok = await confirm({
      message: isCn
        ? `确定要重置「${showMetricModal.name}」的配置到默认状态吗？\n默认只记录重量和次数。`
        : `Reset "${showMetricModal.name}" to default settings?\nDefault tracks weight and reps only.`,
    });
    if (ok) prefs.resetMetricsToDefault(showMetricModal.name);
  }, [confirm, isCn, prefs, showMetricModal]);

  // ============== Time picker（单组时长） ==============
  const openTimePicker = (exIdx: number, setIdx: number, _currentSeconds: number) => {
    setShowTimePicker({ exIdx, setIdx });
  };

  const confirmTimePicker = (totalSeconds: number) => {
    if (!showTimePicker) {
      return;
    }
    const { exIdx, setIdx } = showTimePicker;
    if (
      !currentWorkout.exercises ||
      exIdx < 0 ||
      exIdx >= currentWorkout.exercises.length
    ) {
      setShowTimePicker(null);
      return;
    }
    const targetExercise = currentWorkout.exercises[exIdx];
    if (!targetExercise.sets || setIdx < 0 || setIdx >= targetExercise.sets.length) {
      setShowTimePicker(null);
      return;
    }
    const exs = [...currentWorkout.exercises];
    exs[exIdx] = {
      ...exs[exIdx],
      sets: exs[exIdx].sets.map((set, idx) =>
        // 在底稿行上确认时长也算一次编辑：整行描实（§12.6「改哪格记哪格」）
        idx === setIdx ? { ...set, duration: totalSeconds, ghost: undefined } : set,
      ),
    };
    setCurrentWorkout({ ...currentWorkout, exercises: exs });
    setShowTimePicker(null);
  };

  // 当前组初始秒数（供 DurationPickerModal）
  const initialDurationSeconds = (() => {
    if (!showTimePicker) return 0;
    const { exIdx, setIdx } = showTimePicker;
    return currentWorkout.exercises?.[exIdx]?.sets?.[setIdx]?.duration || 0;
  })();

  // ============== Library + AddCustomExercise: pick handler ==============
  const handlePickFromExercisePicker = useCallback(
    (ex: ExerciseDefinition) => {
      if (libraryPickCallbackRef.current) {
        libraryPickCallbackRef.current(ex);
        libraryPickCallbackRef.current = null;
        setShowLibrary(false);
        return;
      }
      addExerciseToWorkout(ex, false);
    },
    [addExerciseToWorkout],
  );

  // ============== 训练页弹层：pick / 开关 / 徽标数据 ==============
  const handlePickFromSheet = useCallback(
    (ex: ExerciseDefinition) => {
      lastAddedExerciseIdRef.current = addExerciseToWorkout(ex, false);
      setSheetSessionAdded(n => n + 1);
    },
    [addExerciseToWorkout],
  );

  const handlePickerSheetOpenChange = useCallback((open: boolean) => {
    if (open) {
      setSheetSessionAdded(0);
      lastAddedExerciseIdRef.current = null;
    } else if (lastAddedExerciseIdRef.current) {
      // 关闭后滚动定位到最新添加的动作卡
      setFlashExerciseId(lastAddedExerciseIdRef.current);
      lastAddedExerciseIdRef.current = null;
    }
    setPickerSheetOpen(open);
  }, []);

  const handleFlashDone = useCallback(() => setFlashExerciseId(null), []);

  /** 小写显示名 -> 当前训练中出现次数（弹层「已添加 ×N」徽标） */
  const sheetAddedCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const ex of currentWorkout.exercises ?? []) {
      const key = prefs.resolveName(ex.name).toLowerCase();
      counts[key] = (counts[key] || 0) + 1;
    }
    return counts;
  }, [currentWorkout.exercises, prefs.resolveName]);

  const openCreateCustomExerciseModal = useCallback(
    (prefilledName?: string) => {
      setNewExerciseName(prefilledName?.trim() || '');
      setNewExerciseBodyPart('');
      setNewExerciseTags([]);
      setNewExerciseCategory(activeLibraryCategory || 'STRENGTH');
      setShowAddExerciseModal(true);
    },
    [activeLibraryCategory],
  );

  // ============== 静音未使用 imports（保留以便未来扩展）==============
  void BODY_PARTS;
  void EQUIPMENT_TAGS;
  void translations;
  void recordTombstone;

  // =========================================================
  // Render
  // =========================================================
  return (
    <div className="min-h-screen bg-base text-primary font-sans selection:bg-accent/20">
      <WeightInputModal
        open={showWeightInput}
        lang={lang}
        unit={unit}
        weightInputValue={weightInputValue}
        setWeightInputValue={setWeightInputValue}
        editingWeightId={editingWeightId}
        onClose={() => {
          setShowWeightInput(false);
          setEditingWeightId(null);
          setWeightInputValue('');
        }}
        onSubmit={handleLogWeight}
      />

      <MeasurementModal
        open={showMeasureModal}
        lang={lang}
        editingMeasurementId={editingMeasurementId}
        measureForm={measureForm}
        setMeasureForm={setMeasureForm}
        onClose={() => setShowMeasureModal(false)}
        onSubmit={handleSaveMeasurement}
      />

      <ExerciseDateTimePickerModal
        open={!!showTimePickerModal}
        lang={lang}
        initialTime={showTimePickerModal?.currentTime}
        onClose={() => setShowTimePickerModal(null)}
        onConfirm={timeISO => {
          if (showTimePickerModal?.exerciseId && currentWorkout.exercises) {
            const exerciseId = showTimePickerModal.exerciseId;
            const exerciseIndex = currentWorkout.exercises.findIndex(
              ex => ex.id === exerciseId,
            );
            if (exerciseIndex !== -1) {
              const updatedExercises = [...currentWorkout.exercises];
              updatedExercises[exerciseIndex] = {
                ...updatedExercises[exerciseIndex],
                exerciseTime: timeISO,
              };
              setCurrentWorkout({
                ...currentWorkout,
                exercises: updatedExercises,
              });
            }
          }
          setShowTimePickerModal(null);
        }}
      />

      <AddTagModal
        open={showAddTagModal}
        lang={lang}
        newTagName={newTagName}
        setNewTagName={setNewTagName}
        newTagCategory={newTagCategory}
        setNewTagCategory={setNewTagCategory}
        onClose={() => setShowAddTagModal(false)}
        onConfirm={() => {
          if (!newTagName.trim()) return;
          const currentCat = activeLibraryCategory || 'STRENGTH';
          prefs.addCustomTag({
            id: `ct_${Date.now()}`,
            name: newTagName.trim(),
            category: newTagCategory,
            parentCategory: currentCat,
          });
          setShowAddTagModal(false);
          setNewTagName('');
        }}
      />

      <RenameModal
        open={showRenameModal}
        lang={lang}
        title={isCn ? '重命名标签' : 'Rename Tag'}
        placeholder={tagToRename?.name}
        value={newTagNameInput}
        setValue={setNewTagNameInput}
        onClose={() => setShowRenameModal(false)}
        onConfirm={() => {
          if (!tagToRename || !newTagNameInput) return;
          prefs.renameTag(tagToRename.id, newTagNameInput);
          setShowRenameModal(false);
          setTagToRename(null);
          setNewTagNameInput('');
        }}
      />

      <RenameModal
        open={showRenameExerciseModal}
        lang={lang}
        title={isCn ? '重命名动作' : 'Rename Exercise'}
        placeholder={exerciseToRename?.name}
        value={newExerciseNameInput}
        setValue={setNewExerciseNameInput}
        onClose={() => setShowRenameExerciseModal(false)}
        onConfirm={() => {
          if (!exerciseToRename || !newExerciseNameInput) return;
          prefs.renameExercise(exerciseToRename.id, newExerciseNameInput);
          setShowRenameExerciseModal(false);
          setExerciseToRename(null);
          setNewExerciseNameInput('');
        }}
      />

      <AddCustomExerciseModal
        open={showAddExerciseModal}
        lang={lang}
        newExerciseName={newExerciseName}
        setNewExerciseName={setNewExerciseName}
        newExerciseCategory={newExerciseCategory}
        setNewExerciseCategory={setNewExerciseCategory}
        newExerciseBodyPart={newExerciseBodyPart}
        setNewExerciseBodyPart={setNewExerciseBodyPart}
        newExerciseTags={newExerciseTags}
        setNewExerciseTags={setNewExerciseTags}
        customTags={prefs.customTags}
        getTagName={prefs.getTagName}
        onClose={() => setShowAddExerciseModal(false)}
        onConfirm={() => {
          if (!newExerciseName.trim()) return;
          const currentCat = newExerciseCategory;
          // 切类前先清理 customTag 的 parentCategory（保持原行为）
          const selectedTagIds = [...newExerciseTags, newExerciseBodyPart].filter(Boolean);
          prefs.setCustomTags(prevTags => {
            const next = prevTags.map(tag => {
              if (
                selectedTagIds.includes(tag.id) &&
                tag.parentCategory &&
                tag.parentCategory !== currentCat
              ) {
                return { ...tag, parentCategory: undefined };
              }
              return tag;
            });
            storage.setItem('fitlog_custom_tags', JSON.stringify(next));
            return next;
          });

          const ex: ExerciseDefinition = {
            id: Date.now().toString(),
            name: { en: newExerciseName.trim(), cn: newExerciseName.trim() },
            bodyPart: newExerciseBodyPart,
            tags: newExerciseTags,
            category: currentCat,
          };
          prefs.addCustomExercise(ex);

          if (!libraryPickCallbackRef.current) {
            const newId = addExerciseToWorkout(ex, false);
            if (pickerSheetOpen) {
              lastAddedExerciseIdRef.current = newId;
              setSheetSessionAdded(n => n + 1);
            }
          } else {
            libraryPickCallbackRef.current(ex);
            libraryPickCallbackRef.current = null;
            setShowLibrary(false);
          }
          setShowAddExerciseModal(false);
          setNewExerciseName('');
          setNewExerciseBodyPart('');
          setNewExerciseTags([]);
        }}
      />

      <EditExerciseTagsModal
        open={!!editExerciseTagsTarget}
        exercise={editExerciseTagsTarget}
        lang={lang}
        customTags={prefs.customTags}
        getTagName={prefs.getTagName}
        onClose={() => setEditExerciseTagsTarget(null)}
        onSave={(exerciseId, bodyPart, tags) => {
          prefs.saveExerciseTags(exerciseId, bodyPart, tags);
          setEditExerciseTagsTarget(null);
        }}
        onDelete={id => prefs.deleteLibraryExercise(id, { skipConfirm: true })}
      />

      <LibraryModal
        open={showLibrary}
        pickMode={!!libraryPickCallbackRef.current}
        lang={lang}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        activeLibraryCategory={activeLibraryCategory}
        setActiveLibraryCategory={setActiveLibraryCategory}
        selectedTags={selectedTags}
        setSelectedTags={setSelectedTags}
        filteredExercises={filteredExercises}
        customTags={prefs.customTags}
        starredExercises={prefs.starredExercises}
        recentExerciseNames={recentExerciseNames}
        getTagName={prefs.getTagName}
        resolveName={prefs.resolveName}
        isEditingTags={isEditingTags}
        onToggleEditingTags={() => setIsEditingTags(v => !v)}
        onClose={() => {
          libraryPickCallbackRef.current = null;
          setShowLibrary(false);
        }}
        onPickExercise={handlePickFromExercisePicker}
        onCreateCustomExercise={openCreateCustomExerciseModal}
        onCreateCustomTag={category => {
          setNewTagCategory(category);
          setNewTagName('');
          setShowAddTagModal(true);
        }}
        onEditExerciseTags={ex => setEditExerciseTagsTarget(ex)}
        onRenameTag={(id, name) => {
          setTagToRename({ id, name });
          setNewTagNameInput(name);
          setShowRenameModal(true);
        }}
        onDeleteTag={prefs.deleteTag}
        onRenameExercise={(id, name) => {
          setExerciseToRename({ id, name });
          setNewExerciseNameInput(name);
          setShowRenameExerciseModal(true);
        }}
        onDeleteLibraryExercise={id => prefs.deleteLibraryExercise(id)}
        onToggleStar={prefs.toggleStarExercise}
      />

      <TagManageModal
        open={showTagManage}
        lang={lang}
        onClose={() => setShowTagManage(false)}
        onRenameTag={(id, name) => {
          setTagToRename({ id, name });
          setNewTagNameInput(name);
          setShowRenameModal(true);
        }}
        onDeleteTag={prefs.deleteTag}
        onCreateCustomTag={category => {
          setNewTagCategory(category);
          setNewTagName('');
          setShowAddTagModal(true);
        }}
      />

      <AddGoalModal
        open={showGoalModal}
        lang={lang}
        newGoal={newGoal}
        setNewGoal={setNewGoal}
        onClose={() => setShowGoalModal(false)}
        onConfirm={handleAddGoal}
      />

      <EditGoalModal
        open={showEditGoalModal}
        lang={lang}
        editingGoal={editingGoal}
        setEditingGoal={setEditingGoal}
        onCancel={handleCancelEditGoal}
        onSave={handleSaveEditedGoal}
      />

      {activeTab !== 'new' && (
        <AppHeader
          lang={lang}
          unit={unit}
          syncStatus={syncStatus}
          syncDisabled={syncStatus === 'syncing' || !user || !isRemoteConfigured()}
          onSync={() => user && performFullSync()}
          onToggleUnit={handleUnitToggle}
        />
      )}

      <main
        className={`max-w-2xl mx-auto p-4 md:p-8 ${activeTab === 'new' ? 'pb-10' : ''}`}
        style={
          activeTab === 'new'
            ? undefined
            : { paddingBottom: 'calc(7rem + env(safe-area-inset-bottom))' }
        }
      >
        {activeTab === 'dashboard' && (
          <Suspense fallback={<TabSuspenseFallback />}>
            <Dashboard
              selectedPRProject={selectedPRProject}
              setSelectedPRProject={setSelectedPRProject}
              chartMetricPreference={chartMetricPreference}
              setChartMetricPreference={setChartMetricPreference}
              actions={dashboardActions}
            />
          </Suspense>
        )}

        {activeTab === 'new' && (
          <NewWorkoutTab
            lang={lang}
            unit={unit}
            currentWorkout={currentWorkout}
            setCurrentWorkout={setCurrentWorkout}
            editingWorkoutId={editingWorkoutId}
            hasUnsavedChanges={hasUnsavedChanges}
            saveStatus={saveStatus}
            previousTab={previousTab}
            exerciseNotes={prefs.exerciseNotes}
            resolveName={prefs.resolveName}
            getActiveMetrics={prefs.getActiveMetrics}
            onBack={handleNewWorkoutBack}
            onSave={handleFinishWithConfirmation}
            onToggleUnit={handleUnitToggle}
            pickerOpen={pickerSheetOpen}
            onPickerOpenChange={handlePickerSheetOpenChange}
            addedCounts={sheetAddedCounts}
            sessionAdded={sheetSessionAdded}
            onPickExercise={handlePickFromSheet}
            onCreateCustomExercise={openCreateCustomExerciseModal}
            onOpenTagManage={() => setShowTagManage(true)}
            onEditExerciseTags={ex => setEditExerciseTagsTarget(ex)}
            onRenameExercise={(id, name) => {
              setExerciseToRename({ id, name });
              setNewExerciseNameInput(name);
              setShowRenameExerciseModal(true);
            }}
            onDeleteLibraryExercise={id => prefs.deleteLibraryExercise(id)}
            flashExerciseId={flashExerciseId}
            onFlashDone={handleFlashDone}
            partPrechosenId={partPrechosenId}
            onOpenTimePicker={openTimePicker}
            onToggleNote={name =>
              setNoteModalData({ name, note: prefs.exerciseNotes[name] || '' })
            }
            onOpenMetricModal={(name, exIdx) => setShowMetricModal({ name, exIdx })}
            onChangeDate={() => setShowWorkoutDatePicker(true)}
            onDeleteExerciseFromSession={exIdx => {
              const snapshot = [...(currentWorkout.exercises ?? [])];
              const removed = snapshot[exIdx];
              const label = removed ? prefs.resolveName(removed.name) : '';
              setCurrentWorkout({
                ...currentWorkout,
                exercises: snapshot.filter((_, i) => i !== exIdx),
              });
              toastUndo(isCn ? `已移除 ${label}` : `Removed ${label}`, () =>
                setCurrentWorkout({ ...currentWorkout, exercises: snapshot }),
              );
            }}
          />
        )}

        {activeTab === 'plan' && (
          <Suspense fallback={<TabSuspenseFallback />}>
            <PlanTab
              lang={lang}
              unit={unit}
              onAddGoal={() => setShowGoalModal(true)}
              onEditGoal={goal => {
                setEditingGoal(goal);
                setShowEditGoalModal(true);
              }}
              customTags={prefs.customTags}
              onStartScheduledSession={handleStartScheduledSession}
              onOpenLibraryForPicker={openLibraryForPicker}
            />
          </Suspense>
        )}

        {activeTab === 'profile' && (
          <Suspense fallback={<TabSuspenseFallback />}>
            <ProfileTab
              user={user}
              workouts={workouts}
              measurements={measurements}
              lang={lang}
              heatmapData={heatmapData}
              latestMetrics={latestMetrics}
              expandedMetric={expandedMetric}
              fileInputRef={fileInputRef}
              onAvatarUpload={handleAvatarUpload}
              onToggleLanguage={handleToggleLanguage}
              onShowWeightInput={() => setShowWeightInput(true)}
              onShowMeasureModal={() => setShowMeasureModal(true)}
              onToggleMetric={name => setExpandedMetric(name)}
              onEditMeasurement={m => triggerEditMeasurement(m)}
              onDeleteMeasurement={(e, id) => handleDeleteMeasurement(e, id)}
              onAddMeasurementEntry={name => openAddMeasurementEntry(name)}
              setShowResetAccountModal={setShowResetAccountModal}
              devMode={devMode}
              onToggleDevMode={envLocked ? undefined : handleToggleDevMode}
            />
          </Suspense>
        )}
      </main>

      <NoteModal
        open={!!noteModalData}
        lang={lang}
        data={noteModalData}
        setData={setNoteModalData}
        onClose={() => setNoteModalData(null)}
        onSave={() => {
          if (!noteModalData) return;
          prefs.saveExerciseNote(noteModalData.name, noteModalData.note);
          setNoteModalData(null);
        }}
      />

      <MetricSettingsModal
        open={!!showMetricModal}
        exerciseName={showMetricModal?.name || null}
        lang={lang}
        getActiveMetrics={prefs.getActiveMetrics}
        toggleMetric={prefs.toggleMetric}
        onResetDefault={handleResetMetricsToDefault}
        onClose={() => setShowMetricModal(null)}
        loadMode={
          showMetricModal?.exIdx !== undefined && currentWorkout.exercises?.[showMetricModal.exIdx]
            ? getLoadMode(currentWorkout.exercises[showMetricModal.exIdx])
            : undefined
        }
        onChangeLoadMode={
          showMetricModal?.exIdx !== undefined
            ? (mode: LoadMode) => {
                const exIdx = showMetricModal.exIdx!;
                const exs = [...(currentWorkout.exercises ?? [])];
                const ex = exs[exIdx];
                if (!ex) return;
                exs[exIdx] = {
                  ...ex,
                  instanceConfig: {
                    enablePyramid: false,
                    pyramidMode: 'decreasing',
                    autoCalculateSubSets: false,
                    ...ex.instanceConfig,
                    bodyweightMode: mode,
                  },
                };
                setCurrentWorkout({ ...currentWorkout, exercises: exs });
              }
            : undefined
        }
      />

      <DurationPickerModal
        open={!!showTimePicker}
        lang={lang}
        initialSeconds={initialDurationSeconds}
        onClose={() => setShowTimePicker(null)}
        onConfirm={confirmTimePicker}
      />

      <ResetAccountModal
        open={showResetAccountModal}
        lang={lang}
        resetConfirmText={resetConfirmText}
        setResetConfirmText={setResetConfirmText}
        isResetting={isResetting}
        onClose={() => {
          setShowResetAccountModal(false);
          setResetConfirmText('');
        }}
        onConfirmRequested={() => {
          const confirmWord = isCn ? '重置' : 'RESET';
          if (resetConfirmText === confirmWord) {
            handleResetAccount();
          } else {
            toast(
              isCn ? '请输入"重置"确认' : 'Please type "RESET" to confirm',
              'error',
            );
          }
        }}
      />

      {/* ============== 训练日期选择器 ============== */}
      <DateTimePicker
        isOpen={showWorkoutDatePicker}
        lang={lang}
        initialDate={currentWorkout?.date ? new Date(currentWorkout.date) : new Date()}
        onClose={() => setShowWorkoutDatePicker(false)}
        onConfirm={(date) => {
          setCurrentWorkout({ ...currentWorkout, date: date.toISOString() });
          workoutCtx.persistCurrentWorkout();
          setShowWorkoutDatePicker(false);
        }}
      />

      {user && activeTab !== 'new' && (
        <TabNavigation
          activeTab={activeTab as 'dashboard' | 'new' | 'plan' | 'profile'}
          onTabChange={setActiveTab}
          lang={lang}
          onStartWorkout={() => {
            // 10 分钟内刚结束过一场就先问「是不是刚才那场」（防误结束拆场）
            void startWorkoutGuarded(() => {
              setCurrentWorkout(workoutCtx.createNewWorkout());
              setEditingWorkoutId(null);
              setActiveTab('new');
              // 进页后【不】自动弹添加动作弹层：空白页现在先问「今天练哪里」
              // （BodyPartPicker），选完即作为训练名称，再进正常的添加动作流程。
            });
          }}
          onStartWorkoutWithPart={(partKey, title) => {
            // §12.4 印谱扇开：一笔完成「开练 + 选部位」。
            // 部位印 → 标题已定，进页后 120ms 自动弹动作弹层（复用补加动作的机制）；
            // 「制」 → 不填名，进页聚焦标题（partPrechosenId 抑制页内印谱再问一遍）。
            void startWorkoutGuarded(() => {
              const w = { ...workoutCtx.createNewWorkout(), ...(title ? { title } : {}) };
              setCurrentWorkout(w);
              setEditingWorkoutId(null);
              if (partKey === 'other') setPartPrechosenId(w.id);
              setActiveTab('new');
              if (partKey !== 'other') setPendingScrollToPicker(true);
            });
          }}
        />
      )}

      {/* 刊末页 —— §9：非 PR 日也必须有收尾。90% 的训练不刷 PR，
          只为 PR 设计仪式是原方案最大的功能性空白。 */}
      <WorkoutColophon
        open={!!colophon}
        lang={lang}
        issueNo={colophon?.issueNo ?? 1}
        title={colophon?.title ?? ''}
        dateISO={colophon?.dateISO ?? new Date().toISOString()}
        exerciseCount={colophon?.exerciseCount ?? 0}
        setCount={colophon?.setCount ?? 0}
        volume={colophon?.volume ?? 0}
        unitLabel={colophon?.unitLabel ?? 'kg'}
        stamps={colophon?.stamps ?? []}
        extraCount={colophon?.extraCount ?? 0}
        onDone={dismissColophon}
      />
    </div>
  );
};

// 把 useTheme 挂在最外层，确保系统颜色方案监听始终活跃
const ThemeRoot: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  useTheme();
  return <>{children}</>;
};

const AppWithProviders: React.FC = () => (
  <ThemeRoot>
    <AuthProvider>
      <UserSettingsProvider userId={FITLOG_SOLO_USER_ID}>
        <WorkoutProvider userId={FITLOG_SOLO_USER_ID}>
          <GoalsProvider userId={FITLOG_SOLO_USER_ID}>
            <ScheduleProvider userId={FITLOG_SOLO_USER_ID}>
              <AppWithAuth />
            </ScheduleProvider>
          </GoalsProvider>
        </WorkoutProvider>
      </UserSettingsProvider>
    </AuthProvider>
  </ThemeRoot>
);

export default AppWithProviders;
