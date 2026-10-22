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

import { Exercise, ExerciseDefinition, Goal, Language, type WorkoutSession } from './types';
import type { GymProfile } from './src/utils/loadable';
import { translations } from './translations';
import { db } from './services/db';
import { isDevMode, isEnvLocked, isRemoteConfigured, readPrefsFromLocalStorage } from './services/fitlogRemote';
import { switchDataEnv } from './services/fitlogRemoteSync';
import { scheduleDebouncedFitlogPush } from './services/fitlogSyncScheduler';
import { recordTombstone, removeTombstone } from './services/fitlogTombstones';
import { FITLOG_SOLO_USER_ID } from './services/fitlogSolo';

import {
  BODY_PARTS,
  DEFAULT_EXERCISES,
  ExerciseCategory,
} from './src/constants/exercises';
import { attrsPatch, regionsPatch, type Resistance } from './src/utils/exerciseAttrs';
import { applySetUpdate, normalizeGroups } from './src/utils/workbench';
import { listGyms } from './src/utils/gyms';
import { mergeOverride } from './src/utils/exerciseOverride';
import { usesSignedLoad } from './src/utils/load';
import { prSetsOf } from './src/utils/prRecords';
import type { PRPool } from './src/components/ExerciseCard';

import TabNavigation from './src/components/TabNavigation';
import { bodyPartTagFor } from './src/components/BodyPartPicker';
import { NewWorkoutTab } from './src/components/NewWorkoutTab';
import { DateTimePicker } from './src/components/DateTimePicker';
import { ExerciseAttrsModal } from './src/components/ExerciseAttrsModal';
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
import type { NoteModalData } from './src/components/modals/NoteModal';
import { appPrefsNow, gymSavePatch, keyedPatch } from './services/appPrefs';

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
import { DataSafetyHost } from './src/components/data/DataSafetyHost';
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
        {/* 自动备份、重装恢复、CSV 导入的弹窗与后台时机 */}
        <DataSafetyHost />
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
  // 这一场开练时选的部位：给「添加动作」当默认栏。放 ref：打开弹层的回调是稳定的（[] 依赖），直接读会拿到旧闭包
  const sessionFocusPartRef = useRef<string | null>(null);
  sessionFocusPartRef.current = currentWorkout?.focusPart ?? null;
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
  /** 新动作的器材与阻力（resistance 不写 = 跟器材默认） */
  const [newExerciseEquip, setNewExerciseEquip] = useState<{ equipment: string; resistance?: Resistance }>({ equipment: '' });
  /** 新动作的细分（第 3 条）；'' = 未细分 */
  const [newExerciseRegions, setNewExerciseRegions] = useState<string[]>([]);
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
  const [noteModalData, setNoteModalData] = useState<NoteModalData | null>(null);

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
  const { syncStatus, setSyncStatus, lastSyncedAt, pushState, performFullSync, loadLocalData } =
    useFitlogSync(resolvedUserId);
  /** 导出 / 导入在忙：自己一个状态，不再借同步的（原来导出时首选项那一行会显示「同步中」，审查 B12） */
  const [dataBusy, setDataBusy] = useState<'idle' | 'syncing' | 'error'>('idle');

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
    handleCopyWorkoutToToday: prepareCopyToToday,
    handleDeleteExerciseRecord,
    handleStartScheduledSession: prepareScheduledSession,
    startWorkoutGuarded,
    resumeWorkout,
    pendingScrollToPicker,
    setPendingScrollToPicker,
    pendingScheduleCompletion,
    addExerciseToWorkout,
    switchExerciseVariant,
    resumedWorkoutIdsRef,
    activeScheduleIdRef,
  } = useWorkoutMutations({
    setActiveTab,
    reloadAfterSave: () => loadLocalData(resolvedUserId),
    getPreviousTab: () => previousTab,
    onEnterEditWorkout: () => setSelectedPRProject(null),
    onPersist: () => workoutCtx.persistCurrentWorkout(),
  });

  /**
   * 开练先选馆（2026-10-21 用户定）：点开练先弹「这场在哪个馆练」，选了 / 新建了馆才真正开这一场，
   * 一个馆都没有就直接是「新的馆」表单。关掉＝这次不开练。
   * gymStart 是选好馆之后要跑的那一下；switchGym 在下面才拿到，经 ref 读（这里的闭包在点击时才执行）。
   * make 拿到选的馆：计划开练、复制为今天按这个馆铺底稿（FAB 新建的空场不用）。
   */
  const [gymStart, setGymStart] = useState<((gym: string | undefined, gyms?: Record<string, GymProfile>) => void) | null>(null);
  const switchGymRef = useRef<((w: WorkoutSession, gym: string | undefined, gyms?: Record<string, GymProfile>) => WorkoutSession) | null>(null);
  const startAtGym = useCallback(
    (make: (gym: string | undefined, gyms?: Record<string, GymProfile>) => WorkoutSession, after?: (w: WorkoutSession) => void) =>
      setGymStart(() => (gym: string | undefined, gyms?: Record<string, GymProfile>) => {
        void startWorkoutGuarded(() => {
          const base = make(gym, gyms);
          // 按这个馆的片子切单位（设过档案的馆）；底稿已经按这个馆铺好了，同一个馆不会重挑
          const w = gym && switchGymRef.current ? switchGymRef.current(base, gym, gyms) : base;
          setCurrentWorkout(w);
          setEditingWorkoutId(null);
          setActiveTab('new');
          after?.(w);
        });
      }),
    [startWorkoutGuarded, setCurrentWorkout, setEditingWorkoutId, setActiveTab],
  );

  /** 复制为今天 / 从计划开练：先检查、确认，再和 FAB 一样先选馆（审查 A12） */
  const handleCopyWorkoutToToday = useCallback(
    async (workoutId: string) => {
      const make = await prepareCopyToToday(workoutId);
      if (!make) return;
      startAtGym(make, () =>
        toast(isCn ? '已按这场填好参考——点组号照抄' : 'Filled in as reference — tap a set number to confirm', 'info'),
      );
    },
    [isCn, prepareCopyToToday, startAtGym, toast],
  );
  const handleStartScheduledSession = useCallback(
    async (scheduleId: string) => {
      const make = await prepareScheduledSession(scheduleId);
      if (!make) return;
      // 计划关联同时记在 ref（旧口径）和这一场的 fromSchedule 上（make 里写的）
      startAtGym(make, () => {
        activeScheduleIdRef.current = scheduleId;
      });
    },
    [activeScheduleIdRef, prepareScheduledSession, startAtGym],
  );

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
    closeMeasureModal,
  } = useMeasurementLog();

  const { fileInputRef, handleAvatarUpload } = useAvatarUpload();
  const handleExportData = useExportData(setDataBusy);
  const handleImportData = useImportData(setDataBusy);

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
        // FAB 印谱那条路留下部位；「补加动作」等其他入口没有 → 退回这一场开练时选的部位
        setPickerFocusPart(pendingFocusPartRef.current ?? sessionFocusPartRef.current);
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
      // message 是服务端／网络的原始诊断（英文或 HTTP 文本、整串 URL）：只进控制台，不贴给人看（审查 C）
      if (message) console.warn('[fitlog] push failed:', message);
      toast(
        isCn
          ? '云端同步失败，改动先存在本机，联网后会自动补推'
          : 'Sync failed — changes are kept on this device and will sync once online',
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
        // 和 FAB 同一条路：先选馆，再新建一个带 id / startTime 的对象，别复用上一个 currentWorkout
        startAtGym(() => workoutCtx.createNewWorkout());
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
      startAtGym,
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
  switchGymRef.current = switchGym;
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
    const cardio = prefs.findExerciseDef(showMetricModal.name)?.category === 'CARDIO';
    const ok = await confirm({
      message: isCn
        ? `重置「${showMetricModal.name}」的配置？${cardio ? '默认按首选项里的有氧默认记录。' : '默认只记重量和次数。'}`
        : `Reset "${showMetricModal.name}" to default settings?\n${cardio ? 'Default follows your cardio defaults in Preferences.' : 'Default tracks weight and reps only.'}`,
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
    // 改值只改值（第 4 条）：待做行上确认时长只记 touched，不描实。
    // 走和重量 / 次数同一条改值路径：后面没动过、原值一样的待做组跟着变（审查 A5）
    const set = targetExercise.sets[setIdx];
    setCurrentWorkout({
      ...currentWorkout,
      exercises: applySetUpdate(currentWorkout.exercises, { exId: targetExercise.id, setId: String(set.id) }, {
        duration: totalSeconds,
        ...(set.ghost ? { touched: { ...(set.touched ?? {}), duration: true } } : {}),
      }),
    });
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
   * 「杠铃片」§1 训练中实时标 PB：每个项目（同一练法，prefs.liftKey）以前做完的每一组（带上那场的馆）。
   * 比法在 utils/prRecords（和结束训练的 PB 牌、历史纪录点同一份）：底稿行不算、本场不算（按 id 排除）。
   */
  const gymScopedPR = useGymScopedPR();
  const isSignedEx = useCallback((e: Exercise) => usesSignedLoad(e, prefs.signedLoadOf(e.name)), [prefs.signedLoadOf]);
  const prHistoryByLift = useMemo(() => {
    const out = new Map<string, { ex: Exercise; gym?: string }[]>();
    for (const w of workouts) {
      if (w.id === currentWorkout.id) continue;
      for (const e of w.exercises ?? []) {
        const key = prefs.liftKey(e).trim();
        if (!out.has(key)) out.set(key, []);
        out.get(key)!.push({ ex: e, gym: w.gym });
      }
    }
    return out;
    // 只依赖 liftKey：依赖整个 prefs 会让改备注 / 换杠这类无关偏好也触发全历史重算
  }, [workouts, currentWorkout.id, prefs.liftKey]);
  const prPoolFor = useCallback(
    (ex: Exercise): PRPool => {
      const signed = isSignedEx(ex);
      const past = prHistoryByLift.get(prefs.liftKey(ex).trim()) ?? [];
      return {
        rule: {
          tracksWeight: prefs.getActiveMetrics(prefs.resolveName(ex.name)).includes('weight'),
          signed,
          machine: gymScopedPR(ex),
        },
        history: past.flatMap(p => prSetsOf(p.ex, p.gym, signed)),
        gym: currentWorkout.gym,
      };
    },
    [prHistoryByLift, isSignedEx, prefs.liftKey, prefs.getActiveMetrics, prefs.resolveName, gymScopedPR, currentWorkout.gym],
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
      // 没指定部位（底部「添加动作」、练到一半再加）→ 停在这一场开练时选的部位
      setPickerFocusPart(focusPart ?? sessionFocusPartRef.current);
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

  /** preset：弹层眼下停的部位 / 有氧栏，新动作照它预填（审查 A16：原来一律清空成力量、无部位） */
  const openCreateCustomExerciseModal = useCallback(
    (prefilledName?: string, onCreated?: (ex: ExerciseDefinition) => void, preset?: { bodyPart?: string; category?: string }) => {
      createdExerciseTargetRef.current = onCreated ?? null;
      setNewExerciseName(prefilledName?.trim() || '');
      setNewExerciseBodyPart(preset?.bodyPart ?? '');
      setNewExerciseEquip({ equipment: '' });
      setNewExerciseRegions([]);
      const cat = preset?.category;
      setNewExerciseCategory(cat === 'CARDIO' || cat === 'FREE' || cat === 'OTHER' ? cat : 'STRENGTH');
      setShowAddExerciseModal(true);
    },
    [],
  );

  /** 计划编辑器里的选动作弹层：弹窗和训练页弹层共用，新建动作改加进计划 */
  const planPickerHost = useMemo<PlanPickerHost>(
    () => ({
      onCreateCustomExercise: (prefilledName, onCreated, preset) => openCreateCustomExerciseModal(prefilledName, onCreated, preset),
      onEditExerciseTags: ex => setEditExerciseTagsTarget(ex),
      onDeleteExercise: id => prefs.deleteLibraryExercise(id),
      onOpenNote: name => setNoteModalData({ name, note: prefs.exerciseNotes[name] || '' }),
      onOpenMetrics: name => setShowMetricModal({ name }),
    }),
    [openCreateCustomExerciseModal, prefs],
  );

  // ============== 静音未使用 imports（保留以便未来扩展）==============
  void BODY_PARTS;
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
        onClose={closeMeasureModal}
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
        newExerciseEquip={newExerciseEquip}
        setNewExerciseEquip={setNewExerciseEquip}
        newExerciseRegions={newExerciseRegions}
        setNewExerciseRegions={setNewExerciseRegions}
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
          const selectedTagIds = [newExerciseEquip.equipment, newExerciseBodyPart].filter(Boolean);
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
            ...attrsPatch(newExerciseEquip.equipment, newExerciseEquip.resistance),
            category: currentCat,
            ...(newExerciseRegions.length ? regionsPatch(newExerciseRegions) : {}),
          };
          prefs.addCustomExercise(ex);
          // 有氧：记录项按首选项「有氧默认记录」先定好（不然交给计划的、动作库里看的都还是重量 × 次数）
          if (currentCat === 'CARDIO') prefs.seedMetricsIfUnset(ex.name.cn, appPrefsNow().cardioMetrics);

          deliverCreatedExercise(ex);
          setShowAddExerciseModal(false);
          setNewExerciseName('');
          setNewExerciseBodyPart('');
          setNewExerciseEquip({ equipment: '' });
          setNewExerciseRegions([]);
        }}
      />

      <ExerciseAttrsModal
        open={!!editExerciseTagsTarget}
        exercise={editExerciseTagsTarget}
        lang={lang}
        onClose={() => setEditExerciseTagsTarget(null)}
        onSave={(exerciseId, v) => {
          prefs.saveExerciseAttrs(exerciseId, v);
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
            onCreateCustomExercise={(name, preset) => openCreateCustomExerciseModal(name, undefined, preset)}
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
            prPoolFor={prPoolFor}
            onOpenExerciseTime={exId => {
              const ex = currentWorkout.exercises?.find(e => e.id === exId);
              setShowTimePickerModal({ exerciseId: exId, currentTime: ex?.exerciseTime });
            }}
            onToggleNote={(name, gymKey) =>
              setNoteModalData({
                name,
                note: prefs.exerciseNotes[name] || '',
                // 标了馆的训练：多一栏本馆备注（「换馆重量」B）
                ...(gymKey && currentWorkout.gym
                  ? { gym: currentWorkout.gym, gymKey, gymNote: settingsCtx.appPrefs.gymNotes[gymKey] ?? '' }
                  : {}),
              })
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
              // 全是底稿的单击即删、不给撤销（2026-10-18 用户定：删了加回来就行）。
              // 已经做完过组的给撤销：误点一下丢的是真练过的数，加回来也找不回（审查 A2）
              const removed = (currentWorkout.exercises ?? [])[exIdx];
              if (removed && removed.sets.some(st => !st.ghost)) {
                toastUndo(
                  isCn ? `已删除「${prefs.resolveName(removed.name)}」` : `Deleted "${prefs.resolveName(removed.name)}"`,
                  () => {
                    if (dropWhole) removeTombstone('workouts', workoutId);
                    setCurrentWorkout(w => {
                      const list = [...(w.exercises ?? [])];
                      list.splice(Math.min(exIdx, list.length), 0, removed);
                      // 整场被删掉、工作台还空着：换回原来的 id（墓碑已摘），落盘时写回那一场
                      return { ...w, ...(dropWhole && !(w.exercises ?? []).length ? { id: workoutId } : {}), exercises: normalizeGroups(list) };
                    });
                  },
                  { undoLabel: isCn ? '撤销' : 'Undo', durationMs: 6000 },
                );
              }
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
              onShowMeasureModal={() => openAddMeasurementEntry()}
              onToggleMetric={name => setExpandedMetric(name)}
              onEditMeasurement={m => triggerEditMeasurement(m)}
              onDeleteMeasurement={(e, id) => handleDeleteMeasurement(e, id)}
              onAddMeasurementEntry={name => openAddMeasurementEntry(name)}
              setShowResetAccountModal={setShowResetAccountModal}
              devMode={devMode}
              onToggleDevMode={envLocked ? undefined : handleToggleDevMode}
              syncStatus={syncStatus}
              lastSyncedAt={lastSyncedAt}
              pushState={pushState}
              dataBusy={dataBusy === 'syncing'}
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
            onCreateCustomExercise={(name, preset) => planPickerHost.onCreateCustomExercise(name, () => {}, preset)}
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
          if (noteModalData.gymKey) {
            const g = (noteModalData.gymNote ?? '').trim() ? noteModalData.gymNote! : '';
            if (g !== (settingsCtx.appPrefs.gymNotes[noteModalData.gymKey] ?? '')) {
              settingsCtx.changeAppPrefs(keyedPatch('gymNotes', noteModalData.gymKey, g));
            }
          }
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
            ? [metricModalDef.bodyPart, metricModalDef.equipment ?? '']
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
        open={showGymPicker || !!gymStart}
        startMode={!!gymStart}
        lang={lang}
        options={gymOptions}
        current={gymStart ? undefined : currentWorkout?.gym}
        onClose={() => {
          setShowGymPicker(false);
          setGymStart(null);
        }}
        onPick={gym => {
          if (gymStart) {
            gymStart(gym);
            return;
          }
          // 编辑旧训练时只改那场的馆，不切全局单位（改历史标签不该把各设备的显示单位都翻掉）
          setCurrentWorkout(switchGym(currentWorkout, gym, undefined, { keepUnit: !!editingWorkoutId }));
          // 落盘读的是 ref（渲染时才更新）：等这次改动渲染完再写
          window.setTimeout(() => workoutCtx.persistCurrentWorkout(), 0);
        }}
        profiles={settingsCtx.appPrefs.gyms}
        unit={unit}
        onSaveProfile={(name, profile, isNew, renamedFrom) => {
          // 在存储里的原表上改（保留改名墓碑）；改名时这个馆每台器械的设置一起挪到新名字
          settingsCtx.changeAppPrefs(gymSavePatch(name, profile, renamedFrom));
          // 给 switchGym 用的洗过的馆表（context 还没刷新）
          const gyms = { ...settingsCtx.appPrefs.gyms, [name]: profile };
          if (renamedFrom) {
            delete gyms[renamedFrom];
            // 历史训练上的馆名一起改：按馆找底稿、按馆比纪录都认馆名，不改就和新名字对不上
            // 直接写库、不走 updateWorkout：那个会拿库里的旧副本顶掉工作台上进行中的那场（审查 A3）。
            // 工作台上那场（进行中的或编辑草稿）由下面 switchGym 换名字，进行中的那场随它落盘
            const stamp = new Date().toISOString();
            const hits = workouts.filter(w => w.gym === renamedFrom);
            const liveId = !editingWorkoutId ? currentWorkout?.id : undefined;
            void Promise.all(
              hits.filter(w => w.id !== liveId).map(w => db.save('workouts', { ...w, gym: name, updatedAt: stamp })),
            )
              .then(() => workoutCtx.refreshFromDb())
              .then(() => scheduleDebouncedFitlogPush())
              .catch(err => console.error('Rename gym on workouts failed:', err));
            // 底稿眉批「在 X」记的也是馆名
            const renamePrefill = (w: WorkoutSession): WorkoutSession => ({
              ...w,
              exercises: (w.exercises ?? []).map(e => (e.prefillGym === renamedFrom ? { ...e, prefillGym: name } : e)),
            });
            if ((currentWorkout.exercises ?? []).some(e => e.prefillGym === renamedFrom)) {
              setCurrentWorkout(w => renamePrefill(w));
            }
            toast(
              isCn
                ? `已改名为「${name}」${hits.length ? `，${hits.length} 场训练一起改了` : ''}`
                : `Renamed to "${name}"${hits.length ? ` — ${hits.length} workouts updated` : ''}`,
              'success',
            );
          }
          // 开练前选馆：新建或改完哪个馆，就在这个馆开这一场（存完弹层会关，不开就等于白选了）。
          // gyms 是刚存的，context 还没刷新
          if (gymStart) {
            gymStart(name, gyms);
            if (!renamedFrom) toast(isCn ? `已存「${name}」，这场按它算` : `Saved "${name}" — this workout uses it`, 'success');
            return;
          }
          // 新的馆＝这场就用它；改的是今天这个馆＝没做完的组按新档案重新取整。别的馆只存档案，不动今天这场
          const today = isNew || currentWorkout?.gym === name || (!!renamedFrom && currentWorkout?.gym === renamedFrom);
          if (today) {
            // 今天这场在被改名的馆：先换成新名字再交给 switchGym（同一个馆，不按「换馆」重挑底稿，只按新档案重新取整）
            const base = renamedFrom && currentWorkout.gym === renamedFrom ? { ...currentWorkout, gym: name } : currentWorkout;
            setCurrentWorkout(switchGym(
              renamedFrom ? { ...base, exercises: (base.exercises ?? []).map(e => (e.prefillGym === renamedFrom ? { ...e, prefillGym: name } : e)) } : base,
              name, gyms, { keepUnit: !!editingWorkoutId },
            ));
            window.setTimeout(() => workoutCtx.persistCurrentWorkout(), 0);
          }
          if (renamedFrom) return;
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
            // 先选馆再开练（startAtGym）。进页后【不】自动弹添加动作弹层：空白页现在先问「今天练哪里」
            // （BodyPartPicker），选完即作为训练名称，再进正常的添加动作流程。
            startAtGym(() => workoutCtx.createNewWorkout());
          }}
          onStartWorkoutWithPart={(partKey, title) => {
            if (inProgress) {
              setActiveTab('new');
              return;
            }
            // §12.4 印谱扇开：一笔完成「开练 + 选部位」。
            // 部位印 → 标题已定，进页后 120ms 自动弹动作弹层（复用补加动作的机制）；
            // 「制」 → 不填名，进页聚焦标题（partPrechosenId 抑制页内印谱再问一遍）。
            // 同样先选馆，选好再开
            const focus = partKey !== 'other' ? bodyPartTagFor(partKey) : null;
            startAtGym(
              () => ({ ...workoutCtx.createNewWorkout(), ...(title ? { title } : {}), ...(focus ? { focusPart: focus } : {}) }),
              w => {
                if (partKey === 'other') setPartPrechosenId(w.id);
                if (partKey !== 'other') {
                  // 选的是「胸」印 → 弹层打开时直接停在胸部那一栏
                  pendingFocusPartRef.current = bodyPartTagFor(partKey);
                  setPendingScrollToPicker(true);
                }
              },
            );
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
