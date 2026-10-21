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

import { Exercise, ExerciseDefinition, Goal, Language } from './types';
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
import { normalizeGroups } from './src/utils/workbench';
import { listGyms } from './src/utils/gyms';
import { mergeOverride } from './src/utils/exerciseOverride';
import { signedKg } from './src/utils/load';

import TabNavigation from './src/components/TabNavigation';
import { bodyPartTagFor } from './src/components/BodyPartPicker';
import { NewWorkoutTab } from './src/components/NewWorkoutTab';
import { DateTimePicker } from './src/components/DateTimePicker';
import { EditExerciseTagsModal } from './src/components/EditExerciseTagsModal';
import type { PlanPickerHost } from './src/components/ScheduleEditorModal';
import { AppHeader } from './src/components/AppHeader';
import {
  AddCustomExerciseModal,
  AddGoalModal,
  DurationPickerModal,
  EditGoalModal,
  ExerciseDateTimePickerModal,
  GymPickerModal,
  MeasurementModal,
  MetricSettingsModal,
  NoteModal,
  RenameModal,
  ResetAccountModal,
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
import { useExerciseStats } from './src/hooks/useFilteredExercises';
import { useFitlogSync } from './src/hooks/useFitlogSync';
import { useWorkoutMutations, type ActiveTab } from './src/hooks/useWorkoutMutations';
import { useWeightLog } from './src/hooks/useWeightLog';
import { useMeasurementLog } from './src/hooks/useMeasurementLog';
import { useAvatarUpload } from './src/hooks/useAvatarUpload';
import { useExportData } from './src/hooks/useExportData';
import { useImportData } from './src/hooks/useImportData';
import FirstRunNotice from './src/components/FirstRunNotice';
import { useResetAccount } from './src/hooks/useResetAccount';
import { useGymSwitch } from './src/hooks/useGymSwitch';
import { useGymScopedPR } from './src/hooks/useLoadKind';
import { storage } from './services/appStorage';
import { WorkoutColophon } from './src/components/WorkoutColophon';
import { createPortal } from 'react-dom';

const NO_ADDED_COUNTS: Record<string, number> = {};
const LibrarySheet = lazy(() =>
  import('./src/components/ExercisePickerSheet').then(m => ({ default: m.ExercisePickerSheet })),
);

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
        {/* 只在 solo 发行版渲染；自用版里这个组件直接返回 null */}
        <FirstRunNotice />
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
  const unit = settingsCtx.unit;
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

  /**
   * 新建动作弹窗建好的动作交给谁：null＝加进当前训练；计划编辑器的选动作弹层打开它时放自己的回调（加进计划）。
   */
  const createdExerciseTargetRef = useRef<((ex: ExerciseDefinition) => void) | null>(null);
  /** 训练页弹层头部入口：标签管理（只管标签词表，不再进全屏动作库） */

  // ============== 训练页「添加动作」弹层 ==============
  /** 首选项「动作库与标签 ›」打开的那一个：只管动作库，一打开就是整理态 */
  const [librarySheetOpen, setLibrarySheetOpen] = useState(false);
  /** 第一次打开才挂（懒加载），之后留着，关的时候才有退场动画 */
  const [libraryMounted, setLibraryMounted] = useState(false);
  useEffect(() => {
    if (librarySheetOpen) setLibraryMounted(true);
  }, [librarySheetOpen]);
  const [pickerSheetOpen, setPickerSheetOpen] = useState(false);
  /** 这次打开弹层要停在的部位栏（选了部位印才有；其余入口一律 null = 沿用筛选记忆） */
  const [pickerFocusPart, setPickerFocusPart] = useState<string | null>(null);
  /** 这次弹层是从交替组「加一个动作」打开的：选的动作加进这个组 */
  const [pickerTargetGroup, setPickerTargetGroup] = useState<string | null>(null);
  /** FAB 印谱开练时先存在这里，等进页后 pendingScrollToPicker 那一拍打开弹层时再交出去 */
  const pendingFocusPartRef = useRef<string | null>(null);
  /** §12.4：经由 FAB 印谱选了「制」的训练 id —— 进页不再问部位、聚焦标题 */
  const [partPrechosenId, setPartPrechosenId] = useState<string | null>(null);
  const [sheetSessionAdded, setSheetSessionAdded] = useState(0);
  const [flashExerciseId, setFlashExerciseId] = useState<string | null>(null);
  const lastAddedExerciseIdRef = useRef<string | null>(null);


  const [showRenameExerciseModal, setShowRenameExerciseModal] = useState(false);
  const [exerciseToRename, setExerciseToRename] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [newExerciseNameInput, setNewExerciseNameInput] = useState('');

  const [showAddExerciseModal, setShowAddExerciseModal] = useState(false);
  const [newExerciseName, setNewExerciseName] = useState('');
  const [newExerciseTags, setNewExerciseTags] = useState<string[]>([]);
  /** 新动作的细分（第 3 条）；'' = 未细分 */
  const [newExerciseRegion, setNewExerciseRegion] = useState('');
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
  // 「动作设置」里的名称 / 部位器械：库里有这个动作才能改（合并覆盖层后的定义，显示的是现在的标签）
  const metricModalDef = useMemo(() => {
    const def = showMetricModal?.name ? prefs.findExerciseDef(showMetricModal.name) : undefined;
    return def ? mergeOverride(def, prefs.exerciseOverrides[def.id]) : undefined;
  }, [showMetricModal?.name, prefs]);
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
  /** §12.11 场地选择器。候选从历史训练现算（最近用过的排最前），不落 prefs。 */
  const [showGymPicker, setShowGymPicker] = useState(false);
  const gymOptions = useMemo(() => listGyms(workouts), [workouts]);

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
  const { syncStatus, setSyncStatus, lastSyncedAt, performFullSync, loadLocalData } =
    useFitlogSync(resolvedUserId);

  const {
    saveStatus,
    editingWorkoutId,
    setEditingWorkoutId,
    hasUnsavedChanges,
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
    resumeWorkout,
    pendingScrollToPicker,
    setPendingScrollToPicker,
    pendingScheduleCompletion,
    addExerciseToWorkout,
    switchExerciseVariant,
    resumedWorkoutIdsRef,
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
  const handleImportData = useImportData(setSyncStatus);

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
      settingsCtx.reloadAppPrefs();
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

  const { heatmapData } = useExerciseStats();

  // ============== 「补加动作」：进入训练页后直接弹出添加动作弹层 ==============
  useEffect(() => {
    if (activeTab === 'new' && pendingScrollToPicker) {
      const timer = setTimeout(() => {
        setSheetSessionAdded(0);
        lastAddedExerciseIdRef.current = null;
        // 只有 FAB 印谱那条路会留下部位；「补加动作」等其他入口拿到的是 null
        setPickerFocusPart(pendingFocusPartRef.current);
        pendingFocusPartRef.current = null;
        setPickerSheetOpen(true);
        setPendingScrollToPicker(false);
      }, 120);
      return () => clearTimeout(timer);
    }
  }, [activeTab, pendingScrollToPicker, setPendingScrollToPicker]);

  // ============== 训练保存后回写关联日程为 completed ==============
  useEffect(() => {
    const pending = pendingScheduleCompletion.current;
    if (!pending) return;
    pendingScheduleCompletion.current = null;
    const target = scheduleCtx.schedules.find(s => s.id === pending.scheduleId);
    if (!target) return;
    void scheduleCtx.updateSchedule({
      ...target,
      status: 'completed',
      linkedWorkoutId: pending.workoutId,
      updatedAt: new Date().toISOString(),
    });
  }, [workouts, scheduleCtx, pendingScheduleCompletion]);

  // ============== 工作台一变就落盘（编辑旧训练的草稿除外，persistCurrentWorkout 自己认） ==============
  useEffect(() => {
    if (currentWorkout?.exercises && currentWorkout.exercises.length > 0) {
      workoutCtx.persistCurrentWorkout();
    }
  }, [currentWorkout, workoutCtx]);

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
      if (kind === 'env-guard') {
        toast(String(translations.remoteEnvGuard[lang]), 'error');
        return;
      }
      // message 是服务端／网络的原始诊断（英文或 HTTP 文本）。空的时候别留个孤零零的冒号。
      const tail = message ? (isCn ? `：${message}` : `: ${message}`) : '';
      toast(
        isCn
          ? `云端同步失败${tail}。数据仅保存在本地。`
          : `Sync failed${tail}. Data saved locally only.`,
        'error',
      );
    };
    window.addEventListener('fitlog:push-failed', handler);
    return () => window.removeEventListener('fitlog:push-failed', handler);
  }, [isCn, lang, toast]);

  // 本机存储写满（appStorage.setItem 失败）：设置改动会在重启后丢，要让人知道
  useEffect(() => {
    const handler = () =>
      toast(
        isCn ? '本机存储已满，刚才的设置改动可能没存住' : 'Device storage is full — recent setting changes may not be saved',
        'error',
      );
    window.addEventListener('fitlog:storage-write-failed', handler);
    return () => window.removeEventListener('fitlog:storage-write-failed', handler);
  }, [isCn, toast]);

  /** 工作台里有一场进行中的训练（不是在编辑旧训练）：FAB 变「回到训练」，首页顶上一行「进行中」 */
  const inProgress = !editingWorkoutId && !!currentWorkout.id && (currentWorkout.exercises?.length ?? 0) > 0;

  const dashboardActions = useMemo(
    () => ({
      onResumeWorkout: () => setActiveTab('new'),
      onEndInProgress: () => void handleFinishWithConfirmation(),
      onStartNewWorkout: () => {
        if (inProgress) {
          setActiveTab('new');
          return;
        }
        void startWorkoutGuarded(() => {
          // 和 FAB 同一条路：新建一个带 id / startTime 的对象，别复用上一个 currentWorkout
          setCurrentWorkout(workoutCtx.createNewWorkout());
          setEditingWorkoutId(null);
          setActiveTab('new');
        });
      },
      onResumeFinishedWorkout: (id: string) => {
        const w = workouts.find(x => x.id === id);
        if (w) void resumeWorkout(w);
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
      onImportData: handleImportData,
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
      handleImportData,
      startWorkoutGuarded,
      resumeWorkout,
      workouts,
      setCurrentWorkout,
      workoutCtx,
      setEditingWorkoutId,
      setActiveTab,
      inProgress,
      handleFinishWithConfirmation,
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
    settingsCtx.changeLang(nextLang);
  }, [lang, prefs.customExercises, prefs.exerciseOverrides, selectedPRProject, settingsCtx]);

  // 手动切单位 / 换馆：工作台上没做完的组按新单位 / 新馆的片子重新取整（同步回来的单位不走这里）
  const { switchUnit, switchGym } = useGymSwitch();
  const handleUnitToggle = useCallback(() => {
    switchUnit(unit === 'kg' ? 'lbs' : 'kg');
  }, [switchUnit, unit]);

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
        // 改值只改值（第 4 条）：待做行上确认时长只记 touched，不描实
        idx === setIdx
          ? {
              ...set,
              duration: totalSeconds,
              ...(set.ghost ? { touched: { ...(set.touched ?? {}), duration: true } } : {}),
            }
          : set,
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

  /** C2：这张卡的底稿抄自哪一场、那次做了哪几组（prefillFrom 原来只写不读） */
  const lastSessionFor = useCallback(
    (ex: { name: string; prefillFrom?: string }) => {
      if (!ex.prefillFrom) return null;
      const name = prefs.resolveName(ex.name);
      const w = workouts.find(x => x.date === ex.prefillFrom && x.exercises?.some(e => prefs.resolveName(e.name) === name));
      const we = w?.exercises.find(e => prefs.resolveName(e.name) === name);
      if (!w || !we) return null;
      return { date: w.date, sets: (we.sets ?? []).filter(s => !s.ghost) };
    },
    [prefs, workouts],
  );

  /**
   * 「杠铃片」§1 训练中实时标 PB：每个项目（同一练法，prefs.liftKey）历史上单组最重的带符号 kg。
   * 口径照 detectPRs：底稿行不算、本场不算（按 id 排除）。
   */
  // 器械类（配重片、挂片式）的纪录只在同一个馆里比：键带上馆名（口径同 detectPRs.gymScoped）
  const gymScopedPR = useGymScopedPR();
  const prKeyOf = useCallback(
    (e: Exercise, gym: string | undefined) => {
      const k = prefs.liftKey(e).trim();
      return gymScopedPR(e) ? `${k}\u0000${gym ?? ''}` : k;
    },
    [gymScopedPR, prefs.liftKey],
  );
  const bestKgByLift = useMemo(() => {
    const m = new Map<string, number>();
    for (const w of workouts) {
      if (w.id === currentWorkout.id) continue;
      for (const e of w.exercises ?? []) {
        const key = prKeyOf(e, w.gym);
        for (const st of e.sets ?? []) {
          if (st.ghost) continue;
          const v = signedKg(st, e);
          if (!m.has(key) || v > (m.get(key) as number)) m.set(key, v);
        }
      }
    }
    return m;
    // 只依赖 liftKey：依赖整个 prefs 会让改备注 / 换杠这类无关偏好也触发全历史重算
  }, [workouts, currentWorkout.id, prKeyOf]);
  const bestKgFor = useCallback(
    (ex: Exercise) => bestKgByLift.get(prKeyOf(ex, currentWorkout.gym)) ?? null,
    [bestKgByLift, prKeyOf, currentWorkout.gym],
  );

  // ============== 训练页弹层：pick / 开关 / 徽标数据 ==============
  /** 本次打开弹层里每次点选建出的卡片 id（按「动作::做法」分组、后进先出）：再点一下＝取消这次添加 */
  const sheetPicksRef = useRef<Map<string, string[][]>>(new Map());
  const handlePickFromSheet = useCallback(
    (ex: ExerciseDefinition, variantId?: string): boolean => {
      const key = variantId ? `${ex.id}::${variantId}` : ex.id;
      const stack = sheetPicksRef.current.get(key) ?? [];
      const prev = stack.pop();
      if (prev) {
        // B2（2026-10-11）：本次打开里加过的再点一下＝取消（原来是再加一份、没撤销）；真要两份，卡上「添加组」
        const ids = new Set(prev);
        setCurrentWorkout(w => ({ ...w, exercises: normalizeGroups((w.exercises ?? []).filter(e => !ids.has(e.id))) }));
        sheetPicksRef.current.set(key, stack);
        setSheetSessionAdded(n => Math.max(0, n - 1));
        if (lastAddedExerciseIdRef.current && ids.has(lastAddedExerciseIdRef.current)) lastAddedExerciseIdRef.current = null;
        return false;
      }
      let created: string[] = [];
      lastAddedExerciseIdRef.current = addExerciseToWorkout(ex, false, {
        altGroup: pickerTargetGroup,
        variantId,
        onCreated: (ids, partnerNames) => {
          created = ids;
          if (partnerNames.length) {
            // 上次是交替做的：搭档连带进来了，说一声并给撤销（只撤搭档，这个动作留着）
            const partnerIds = ids.slice(1);
            toastUndo(
              isCn ? `已连带加入 ${partnerNames.join('、')}（上次交替做的）` : `Also added ${partnerNames.join(', ')} (alternated last time)`,
              () => {
                const drop = new Set(partnerIds);
                setCurrentWorkout(w => ({ ...w, exercises: normalizeGroups((w.exercises ?? []).filter(e => !drop.has(e.id))) }));
              },
              { undoLabel: isCn ? '撤销' : 'Undo', durationMs: 6000 },
            );
          }
        },
      });
      if (created.length) {
        stack.push(created);
        sheetPicksRef.current.set(key, stack);
        setSheetSessionAdded(n => n + 1);
      }
      return true;
    },
    [addExerciseToWorkout, isCn, pickerTargetGroup, setCurrentWorkout, toastUndo],
  );

  const handlePickerSheetOpenChange = useCallback((open: boolean, focusPart?: string | null, targetGroup?: string | null) => {
    if (open) {
      setPickerFocusPart(focusPart ?? null);
      setPickerTargetGroup(targetGroup ?? null);
      setSheetSessionAdded(0);
      sheetPicksRef.current = new Map();
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
      // 做法小卡按「动作::做法」认
      const vid = prefs.variantIdOf(ex);
      if (vid) counts[`${key}::${vid}`] = (counts[`${key}::${vid}`] || 0) + 1;
    }
    return counts;
  }, [currentWorkout.exercises, prefs.resolveName, prefs.variantIdOf]);

  /** 弹层头部「加到 内收 ⇄ 外展」 */
  const pickerTargetLabel = useMemo(() => {
    if (!pickerTargetGroup) return null;
    const names = (currentWorkout.exercises ?? [])
      .filter(e => e.altGroup === pickerTargetGroup)
      .map(e => prefs.resolveName(e.name));
    return names.length ? names.join(' ⇄ ') : null;
  }, [currentWorkout.exercises, pickerTargetGroup, prefs.resolveName]);

  /** 新建 / 恢复出来的动作：交给计划编辑器（它打开的弹窗），否则加进当前训练 */
  const deliverCreatedExercise = (ex: ExerciseDefinition) => {
    const target = createdExerciseTargetRef.current;
    createdExerciseTargetRef.current = null;
    if (target) {
      target(ex);
      return;
    }
    const newId = addExerciseToWorkout(ex, false);
    if (pickerSheetOpen) {
      lastAddedExerciseIdRef.current = newId;
      setSheetSessionAdded(n => n + 1);
    }
  };

  const openCreateCustomExerciseModal = useCallback(
    (prefilledName?: string, onCreated?: (ex: ExerciseDefinition) => void) => {
      createdExerciseTargetRef.current = onCreated ?? null;
      setNewExerciseName(prefilledName?.trim() || '');
      setNewExerciseBodyPart('');
      setNewExerciseTags([]);
      setNewExerciseRegion('');
      setNewExerciseCategory('STRENGTH');
      setShowAddExerciseModal(true);
    },
    [],
  );

  /** 计划编辑器里的选动作弹层：弹窗和训练页弹层共用，新建动作改加进计划 */
  const planPickerHost = useMemo<PlanPickerHost>(
    () => ({
      onCreateCustomExercise: (prefilledName, onCreated) => openCreateCustomExerciseModal(prefilledName, onCreated),
      onEditExerciseTags: ex => setEditExerciseTagsTarget(ex),
      onDeleteExercise: id => prefs.deleteLibraryExercise(id),
      onOpenNote: name => setNoteModalData({ name, note: prefs.exerciseNotes[name] || '' }),
      onOpenMetrics: name => setShowMetricModal({ name }),
    }),
    [openCreateCustomExerciseModal, prefs],
  );

  // ============== 静音未使用 imports（保留以便未来扩展）==============
  void BODY_PARTS;
  void EQUIPMENT_TAGS;
  void translations;

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
          // 重名会被拒（toast 说明），弹窗留着让人改
          if (!prefs.renameExercise(exerciseToRename.id, newExerciseNameInput)) return;
          // 从「动作设置」里改的：设置弹窗还开着，标题换成新名（旧名照样解析得到，这里只是显示）
          if (showMetricModal) setShowMetricModal({ ...showMetricModal, name: newExerciseNameInput.trim() });
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
        newExerciseRegion={newExerciseRegion}
        setNewExerciseRegion={setNewExerciseRegion}
        customTags={prefs.customTags}
        getTagName={prefs.getTagName}
        addsTo={createdExerciseTargetRef.current ? 'plan' : 'workout'}
        onClose={() => {
          createdExerciseTargetRef.current = null;
          setShowAddExerciseModal(false);
        }}
        onConfirm={() => {
          if (!newExerciseName.trim()) return;
          // 与库里动作的现名 / 曾用名重名就拒绝（第 7 条同一条规矩），弹窗留着改
          const clash = prefs.findExerciseDef(newExerciseName.trim());
          // 撞上的是删掉（隐藏）的动作：把它恢复出来接着用，历史、PR 都还挂在它身上（hidden-builtin-name-locked）
          if (clash && prefs.exerciseOverrides[clash.id]?.hidden) {
            prefs.restoreLibraryExercise(clash.id);
            const restored = mergeOverride(clash, { ...prefs.exerciseOverrides[clash.id], hidden: false });
            deliverCreatedExercise(restored);
            setShowAddExerciseModal(false);
            setNewExerciseName('');
            return;
          }
          if (clash) {
            const clashName = prefs.resolveName(newExerciseName.trim());
            toast(
              isCn
                ? clashName === newExerciseName.trim()
                  ? `已经有「${clashName}」了`
                  : `「${newExerciseName.trim()}」是「${clashName}」以前的名字`
                : `"${newExerciseName.trim()}" is already taken`,
              'error',
            );
            return;
          }
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
            ...(newExerciseRegion ? { region: newExerciseRegion } : {}),
          };
          prefs.addCustomExercise(ex);

          deliverCreatedExercise(ex);
          setShowAddExerciseModal(false);
          setNewExerciseName('');
          setNewExerciseBodyPart('');
          setNewExerciseTags([]);
          setNewExerciseRegion('');
        }}
      />

      <EditExerciseTagsModal
        open={!!editExerciseTagsTarget}
        exercise={editExerciseTagsTarget}
        lang={lang}
        customTags={prefs.customTags}
        getTagName={prefs.getTagName}
        onClose={() => setEditExerciseTagsTarget(null)}
        onSave={(exerciseId, bodyPart, tags, region, category) => {
          prefs.saveExerciseTags(exerciseId, bodyPart, tags, region, category);
          setEditExerciseTagsTarget(null);
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
            pickerFocusPart={pickerFocusPart}
            pickerTargetLabel={pickerTargetLabel}
            addedCounts={sheetAddedCounts}
            sessionAdded={sheetSessionAdded}
            onPickExercise={handlePickFromSheet}
            onCreateCustomExercise={openCreateCustomExerciseModal}
            onEditExerciseTags={ex => setEditExerciseTagsTarget(ex)}
            onRenameExercise={(id, name) => {
              setExerciseToRename({ id, name });
              setNewExerciseNameInput(name);
              setShowRenameExerciseModal(true);
            }}
            onDeleteLibraryExercise={id => prefs.deleteLibraryExercise(id)}
            onSwitchVariant={switchExerciseVariant}
            flashExerciseId={flashExerciseId}
            onFlashDone={handleFlashDone}
            partPrechosenId={partPrechosenId}
            onOpenTimePicker={openTimePicker}
            lastSessionFor={lastSessionFor}
            bestKgFor={bestKgFor}
            onOpenExerciseTime={exId => {
              const ex = currentWorkout.exercises?.find(e => e.id === exId);
              setShowTimePickerModal({ exerciseId: exId, currentTime: ex?.exerciseTime });
            }}
            onToggleNote={name =>
              setNoteModalData({ name, note: prefs.exerciseNotes[name] || '' })
            }
            onOpenMetricModal={(name, exIdx) => setShowMetricModal({ name, exIdx })}
            onChangeDate={() => setShowWorkoutDatePicker(true)}
            onChangeGym={() => setShowGymPicker(true)}
            onDeleteExerciseFromSession={exIdx => {
              const remaining = (currentWorkout.exercises ?? []).filter((_, i) => i !== exIdx);
              /**
               * 新训练删光动作 = 这场不存在了（remove-last-exercise-not-persisted）。
               * 自动落盘以「有动作」为前提，删光后既不写也不删，库里会留下删之前那一版，
               * 时间线多出一场没练过的训练。这里直接从库里删掉并写墓碑（防拉取复活）。
               * 编辑旧训练时不这么做：那是在改历史，静默删整场太重，保持原样（库里不变）。
               * 「继续这场」接回来的也不这么做（用户定）：里面有真正练过的组，删光多半是误操作。
               */
              const workoutId = currentWorkout.id;
              const dropWhole =
                remaining.length === 0 &&
                !editingWorkoutId &&
                !!workoutId &&
                !resumedWorkoutIdsRef.current.has(workoutId);
              // 删的是交替组成员：组里只剩一个就拆掉（normalize）。
              // 删光且整场删掉了：工作台换一个新 id —— 旧 id 已写墓碑，「删了加回来」接着练的话，
              // 同一个 id 会在下次同步时被墓碑连库带云一起抹掉（撤销条去掉后这是正常路径，2026-10-18 审查）
              setCurrentWorkout({
                ...currentWorkout,
                ...(dropWhole ? { id: workoutCtx.createNewWorkout().id } : {}),
                exercises: normalizeGroups(remaining),
              });
              if (dropWhole) {
                recordTombstone('workouts', workoutId);
                void db
                  .delete('workouts', workoutId)
                  .then(() => workoutCtx.refreshFromDb())
                  .then(() => scheduleDebouncedFitlogPush())
                  .catch(err => console.error('Drop emptied workout failed:', err));
              }
              // 单击即删，不给撤销（2026-10-18 用户定：删了加回来就行）
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
              planPickerHost={planPickerHost}
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
              syncStatus={syncStatus}
              lastSyncedAt={lastSyncedAt}
              onSync={syncStatus === 'syncing' || !user || !isRemoteConfigured() ? undefined : () => void performFullSync()}
              onExportData={handleExportData}
              onImportData={handleImportData}
              onOpenLibrary={() => setLibrarySheetOpen(true)}
            />
          </Suspense>
        )}
      </main>

      {libraryMounted && createPortal(
        <Suspense fallback={null}>
          <LibrarySheet
            open={librarySheetOpen}
            libraryOnly
            onClose={() => setLibrarySheetOpen(false)}
            addedCounts={NO_ADDED_COUNTS}
            sessionAdded={0}
            onPickExercise={() => false}
            onCreateCustomExercise={name => planPickerHost.onCreateCustomExercise(name, () => {})}
            onEditExerciseTags={planPickerHost.onEditExerciseTags}
            onDeleteExercise={planPickerHost.onDeleteExercise}
            onOpenNote={planPickerHost.onOpenNote}
            onOpenMetrics={planPickerHost.onOpenMetrics}
          />
        </Suspense>,
        document.body,
      )}

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
        signedLoad={showMetricModal?.name ? prefs.signedLoadOf(showMetricModal.name) : false}
        onChangeSignedLoad={
          showMetricModal?.name && prefs.findExerciseDef(showMetricModal.name)
            ? (on: boolean) => prefs.setSignedLoad(showMetricModal.name, on)
            : undefined
        }
        onRename={
          metricModalDef
            ? () => {
                const name = prefs.resolveName(showMetricModal!.name);
                setExerciseToRename({ id: metricModalDef.id, name });
                setNewExerciseNameInput(name);
                setShowRenameExerciseModal(true);
              }
            : undefined
        }
        onEditTags={metricModalDef ? () => setEditExerciseTagsTarget(metricModalDef) : undefined}
        tagSummary={
          metricModalDef
            ? [metricModalDef.bodyPart, ...(metricModalDef.tags ?? [])]
                .filter(Boolean)
                .map(t => prefs.getTagName(t))
                .filter(Boolean)
                .join(' · ')
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

      {/* ============== 场地选择器（§12.11）============== */}
      <GymPickerModal
        open={showGymPicker}
        lang={lang}
        options={gymOptions}
        current={currentWorkout?.gym}
        onClose={() => setShowGymPicker(false)}
        onPick={gym => {
          // 编辑旧训练时只改那场的馆，不切全局单位（改历史标签不该把各设备的显示单位都翻掉）
          setCurrentWorkout(switchGym(currentWorkout, gym, undefined, { keepUnit: !!editingWorkoutId }));
          // 落盘读的是 ref（渲染时才更新）：等这次改动渲染完再写
          window.setTimeout(() => workoutCtx.persistCurrentWorkout(), 0);
        }}
        profiles={settingsCtx.appPrefs.gyms}
        unit={unit}
        onSaveProfile={(name, profile, isNew) => {
          const gyms = { ...settingsCtx.appPrefs.gyms, [name]: profile };
          settingsCtx.changeAppPrefs({ gyms });
          // 新的馆＝这场就用它；改的是今天这个馆＝没做完的组按新档案重新取整。别的馆只存档案，不动今天这场
          const today = isNew || currentWorkout?.gym === name;
          if (today) {
            setCurrentWorkout(switchGym(currentWorkout, name, gyms, { keepUnit: !!editingWorkoutId }));
            window.setTimeout(() => workoutCtx.persistCurrentWorkout(), 0);
          }
          toast(
            isCn
              ? isNew
                ? `已存「${name}」，这场训练按它算`
                : today
                  ? `「${name}」改好了：没做完的组按新档案重新取整`
                  : `「${name}」改好了（今天不在这个馆，不影响这场）`
              : isNew
                ? `Saved "${name}" — this workout uses it`
                : today
                  ? `"${name}" updated — unfinished sets re-rounded`
                  : `"${name}" updated (not today's gym)`,
            'success',
          );
        }}
      />

      {user && activeTab !== 'new' && (
        <TabNavigation
          activeTab={activeTab as 'dashboard' | 'new' | 'plan' | 'profile'}
          onTabChange={setActiveTab}
          lang={lang}
          resume={inProgress}
          onStartWorkout={() => {
            // 有进行中的训练：FAB 就是「回到训练」（workbench-not-restored）
            if (inProgress) {
              setActiveTab('new');
              return;
            }
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
            if (inProgress) {
              setActiveTab('new');
              return;
            }
            // §12.4 印谱扇开：一笔完成「开练 + 选部位」。
            // 部位印 → 标题已定，进页后 120ms 自动弹动作弹层（复用补加动作的机制）；
            // 「制」 → 不填名，进页聚焦标题（partPrechosenId 抑制页内印谱再问一遍）。
            void startWorkoutGuarded(() => {
              const w = { ...workoutCtx.createNewWorkout(), ...(title ? { title } : {}) };
              setCurrentWorkout(w);
              setEditingWorkoutId(null);
              if (partKey === 'other') setPartPrechosenId(w.id);
              setActiveTab('new');
              if (partKey !== 'other') {
                // 选的是「胸」印 → 弹层打开时直接停在胸部那一栏
                pendingFocusPartRef.current = bodyPartTagFor(partKey);
                setPendingScrollToPicker(true);
              }
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
