import React, { useState, useEffect, useMemo, useRef, useCallback, Suspense, lazy } from 'react';
import CalendarHeatmap from 'react-calendar-heatmap';
import './heatmap.css'
import 'react-calendar-heatmap/dist/styles.css';

// 懒加载组件，减少首屏包体积
const Dashboard = lazy(() => import('./src/components/Dashboard').then(m => ({ default: m.default })));
const ProfileTab = lazy(() => import('./src/components/ProfileTab').then(m => ({ default: m.default })));
const PlanTab = lazy(() => import('./src/components/PlanTab').then(m => ({ default: m.default })));
const AssistantTab = lazy(() => import('./src/components/AssistantTab').then(m => ({ default: m.default })));
import { 
  Plus, Minus, History, BarChart2, LogOut, Trash2, PlusCircle, 
  Dumbbell, Calendar, Trophy, X, Activity, Zap,
  Target, RefreshCw, Search, Check, Cloud, Settings as SettingsIcon,
  Award, Eye, EyeOff, User as UserIcon, Tag as TagIcon, Mail, Lock, Flag,
  Edit2, CheckCircle, Send, ShieldAlert, Sparkles, AlertCircle, Coins,
  Key, ChevronRight, TrendingUp, Filter, PencilLine, Hash, Scale, ChevronDown, ChevronUp, Star,
  Layers, ArrowLeft, Globe, Ruler, Camera, Minimize2, Maximize2, GripHorizontal, StickyNote, Check as CheckIcon, Download, ChevronLeft
} from 'lucide-react';
import { LocalNotifications } from '@capacitor/local-notifications';
import { Haptics } from '@capacitor/haptics'; 
import { Language, User, WorkoutSession, Exercise, ExerciseDefinition, Goal, GoalType, BodyweightMode, WeightEntry, SubSetLog, PyramidCalculator, PyramidTemplate, Measurement, ScheduledWorkout, ScheduledExercise } from './types';
import { translations } from './translations';
import { db } from './services/db';
import { migrateRecordsToSoloUserId, readPrefsFromLocalStorage, markPrefsUpdated } from './services/fitlogRemote';
import { clearTombstones, recordTombstone } from './services/fitlogTombstones';
import { pullAndMergeFitlogRemote, pushFitlogRemoteSnapshot } from './services/fitlogRemoteSync';
import { isRemoteConfigured } from './services/fitlogRemote';
import { scheduleDebouncedFitlogPush } from './services/fitlogSyncScheduler';
import type { FitlogSyncedPrefs } from './services/fitlogSnapshotTypes';
import { KMH_TO_MPH, playTimerSound, KG_TO_LBS } from './src/constants';
import { BODY_PARTS, EQUIPMENT_TAGS, DEFAULT_EXERCISES, STANDARD_METRICS, ExerciseCategory } from './src/constants/exercises';
import { formatValue, getUnitTag, formatWeight, parseWeight, secondsToHMS, formatTime } from './src/utils/format';
import { RestTimer } from './src/components/RestTimer';
import TabNavigation from './src/components/TabNavigation';
import { SetCapsule } from './src/components/SetCapsule';
import { ExerciseCard } from './src/components/ExerciseCard';
import {
  AssistantProvider,
  AuthProvider,
  GoalsProvider,
  ScheduleProvider,
  UserSettingsProvider,
  WorkoutProvider,
  useAssistantContext,
  useAuthContext,
  useGoalsContext,
  useScheduleContext,
  useUserSettingsContext,
  useWorkoutContext,
} from './src/contexts';
import { useTheme } from './src/hooks/useTheme';
import { FITLOG_SOLO_USER_ID } from './services/fitlogSolo';

// AppWithAuth：单机用户，远端同步可选
interface AppWithAuthProps {
  /** 单机版固定传入 FITLOG_SOLO_USER_ID（保留接口便于测试） */
  userId?: string;
}

const AppWithAuth: React.FC<AppWithAuthProps> = ({ userId: propUserId }) => {
  const resolvedUserId = propUserId || FITLOG_SOLO_USER_ID;

  const authCtx = useAuthContext();
  const workoutCtx = useWorkoutContext();
  const goalsCtx = useGoalsContext();
  const scheduleCtx = useScheduleContext();
  const settingsCtx = useUserSettingsContext();

  const lang = settingsCtx.lang;
  const setLang = settingsCtx.setLang;
  const unit = settingsCtx.unit;
  const setUnit = settingsCtx.setUnit;
  const weightEntries = settingsCtx.weightEntries;
  const measurements = settingsCtx.measurements;

  const user = authCtx.user;
  const setUser = authCtx.setUser;

  // === Local UI State ===
  const [activeLibraryCategory, setActiveLibraryCategory] = useState<ExerciseCategory | null>(null);
  const [previousLibraryCategory, setPreviousLibraryCategory] = useState<ExerciseCategory | null>(null);
  const [activeTab, _setActiveTab] = useState<'dashboard' | 'new' | 'plan' | 'assistant' | 'profile'>('dashboard');
  const [previousTab, setPreviousTab] = useState<'dashboard' | 'new' | 'plan' | 'assistant' | 'profile'>('dashboard');
  const setActiveTab = useCallback((tab: 'dashboard' | 'new' | 'plan' | 'assistant' | 'profile') => {
    _setActiveTab(prev => {
      // 进入训练流程时，记下来源 Tab，方便「返回」按钮回到原位
      if (prev !== 'new' && tab === 'new') {
        setPreviousTab(prev);
      }
      return tab;
    });
  }, []);

  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'error'>('idle');

  const [uiBusy, setUiBusy] = useState(false);

  // === 训练计划：共享动作库选择回调 ===
  // 默认 null —— library 点击会按原行为加入 currentWorkout；
  // 一旦设置为函数，library 点击会改为调用该函数（用于从计划编辑器拉取动作）
  const libraryPickCallbackRef = useRef<((ex: ExerciseDefinition) => void) | null>(null);
  const openLibraryForPicker = useCallback((cb: (ex: ExerciseDefinition) => void) => {
    libraryPickCallbackRef.current = cb;
    setActiveLibraryCategory(null);
    setSelectedTags([]);
    setSearchQuery('');
    setShowLibrary(true);
  }, []);

  // 训练计划：保存训练时弹出"按计划/有调整/取消"确认
  const [planConfirmOpen, setPlanConfirmOpen] = useState(false);

  const workouts = workoutCtx.workouts;
  const currentWorkout = workoutCtx.currentWorkout;
  const setCurrentWorkout = workoutCtx.setCurrentWorkout;

  const goals = goalsCtx.goals;
  const [showTimePicker, setShowTimePicker] = useState<{ exIdx: number; setIdx: number } | null>(null);
  // 临时存储正在编辑的时分秒，方便在 Modal 里调整
  const [tempHMS, setTempHMS] = useState({ h: 0, m: 0, s: 0 });

  // 打开选择器并初始化数据
  const openTimePicker = (exIdx: number, setIdx: number, currentSeconds: number) => {
    setTempHMS(secondsToHMS(currentSeconds || 0));
    setShowTimePicker({ exIdx, setIdx });
  };

  // 在选择器中保存时间
  const confirmTimePicker = () => {
    if (!showTimePicker) return;
    
    const { exIdx, setIdx } = showTimePicker;
    const totalSeconds = tempHMS.h * 3600 + tempHMS.m * 60 + tempHMS.s;
    
    // ✅ 修复Bug #2: 安全检查 - 确保数据结构完整，防止数组越界
    if (!currentWorkout.exercises || 
        exIdx < 0 || 
        exIdx >= currentWorkout.exercises.length) {
      console.warn('Invalid exercise index:', exIdx, 'exercises length:', currentWorkout.exercises?.length);
      setShowTimePicker(null);
      return;
    }
    
    const targetExercise = currentWorkout.exercises[exIdx];
    if (!targetExercise.sets || 
        setIdx < 0 || 
        setIdx >= targetExercise.sets.length) {
      console.warn('Invalid set index:', setIdx, 'sets length:', targetExercise.sets?.length);
      setShowTimePicker(null);
      return;
    }
    
    // ✅ 修复Bug #2: 安全更新 - 使用不可变更新模式，避免直接修改数组
    const exs = [...currentWorkout.exercises];
    exs[exIdx] = {
      ...exs[exIdx],
      sets: exs[exIdx].sets.map((set, idx) => 
        idx === setIdx ? { ...set, duration: totalSeconds } : set
      )
    };
    
    setCurrentWorkout({ ...currentWorkout, exercises: exs });
    setShowTimePicker(null);
  };

  // --- 新增：休息时间偏好记忆 ---
  // 格式: { "动作名称": 90 }
  const [restPreferences, setRestPreferences] = useState<Record<string, number>>({});
  // --- 新增：动作备注功能 ---
  // 格式: { "动作名称": "座椅高度4，宽握" }
  const [exerciseNotes, setExerciseNotes] = useState<Record<string, string>>({});
  const [noteModalData, setNoteModalData] = useState<{ name: string; note: string } | null>(null);
  // --- 新增：动作维度自定义功能 ---
  // 格式: { "动作名称": ["reps", "distance", "custom_分数"] }
  const [exerciseMetricConfigs, setExerciseMetricConfigs] = useState<Record<string, string[]>>({});
  const [showMetricModal, setShowMetricModal] = useState<{ name: string } | null>(null);
  const [newCustomDimension, setNewCustomDimension] = useState('');

  // 加载配置
  useEffect(() => {
    const saved = localStorage.getItem('fitlog_metric_configs');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        
        // ✅ 修复Metrics Bug: 清理可能存在的数据污染
        const cleaned: Record<string, string[]> = {};
        let needsCleaning = false;
        
        Object.entries(parsed).forEach(([exerciseName, metrics]) => {
          if (Array.isArray(metrics)) {
            const cleanedMetrics = metrics
              .map(m => typeof m === 'string' ? m.trim() : String(m).trim())
              .filter(m => m.length > 0);
            
            // 检查是否有数据被清理
            const originalStr = JSON.stringify(metrics);
            const cleanedStr = JSON.stringify(cleanedMetrics);
            if (originalStr !== cleanedStr) {
              needsCleaning = true;
              console.log(`清理动作 "${exerciseName}" 的metrics数据:`, {
                原始: metrics,
                清理后: cleanedMetrics
              });
            }
            
            cleaned[exerciseName] = cleanedMetrics;
          }
        });
        
        // 如果数据被清理，重新保存到localStorage
        if (needsCleaning) {
          localStorage.setItem('fitlog_metric_configs', JSON.stringify(cleaned));
          console.log('Metrics配置数据已清理并重新保存');
        }
        
        setExerciseMetricConfigs(cleaned);
      } catch (e) {
        console.error('解析metrics配置失败:', e);
        // 如果解析失败，使用空配置
        setExerciseMetricConfigs({});
      }
    }
  }, []);

  // 获取某个动作应显示的维度（默认显示重量和次数）
  const getActiveMetrics = (name: string) => {
    return exerciseMetricConfigs[name] || ['weight', 'reps'];
  };

// ✅ 修正：确保 0 能被正确处理
  const secondsToHMS = (totalSeconds: number) => {
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    return { h, m, s };
  };

  // ✅ 更新时间数据的特定函数
  const updateDuration = (exIdx: number, setIdx: number, unit: 'h' | 'm' | 's', val: number) => {
    const exs = [...currentWorkout.exercises!];
    const currentTotal = exs[exIdx].sets[setIdx].duration || 0;
    const { h, m, s } = secondsToHMS(currentTotal);
    
    let newTotal = 0;
    if (unit === 'h') newTotal = val * 3600 + m * 60 + s;
    if (unit === 'm') newTotal = h * 3600 + val * 60 + s;
    if (unit === 's') newTotal = h * 3600 + m * 60 + val;

    exs[exIdx].sets[setIdx] = { ...exs[exIdx].sets[setIdx], duration: newTotal };
    setCurrentWorkout({ ...currentWorkout, exercises: exs });
  };

  // 切换维度开关
  const toggleMetric = (exerciseName: string, metricKey: string) => {
    const current = getActiveMetrics(exerciseName);
    
    // ✅ 修复Metrics Bug: 使用更安全的字符串匹配，只处理空格问题，保留大小写
    const normalizedCurrent = current.map(m => m.trim());
    const normalizedKey = metricKey.trim();
    
    const isCurrentlySelected = normalizedCurrent.includes(normalizedKey);

    let next;
    if (isCurrentlySelected) {
      // 移除：找到精确匹配的索引进行删除
      const indexToRemove = normalizedCurrent.indexOf(normalizedKey);
      next = current.filter((_, index) => index !== indexToRemove);
    } else {
      // 添加：使用原始metricKey
      next = [...current, metricKey];
    }
    
    // 至少保留一个维度
    if (next.length === 0) next = ['reps'];

    // ✅ 额外修复：清理存储的数据，确保没有空格污染
    const cleanNext = next.map(m => m.trim()).filter(m => m.length > 0);

    const updated = { ...exerciseMetricConfigs, [exerciseName]: cleanNext };
    setExerciseMetricConfigs(updated);
    localStorage.setItem('fitlog_metric_configs', JSON.stringify(updated));
    localStorage.setItem('fitlog_metrics_last_update', String(Date.now()));
    scheduleDebouncedFitlogPush();
  };

  // ✅ 新增：重置metrics配置到默认状态
  const resetMetricsToDefault = (exerciseName: string) => {
    const updated = { ...exerciseMetricConfigs };
    delete updated[exerciseName]; // 删除自定义配置，回到默认的['weight', 'reps']
    
    setExerciseMetricConfigs(updated);
    localStorage.setItem('fitlog_metric_configs', JSON.stringify(updated));
    
    localStorage.setItem('fitlog_metrics_last_update', String(Date.now()));
    scheduleDebouncedFitlogPush();
  };

  // 初始化加载备注
  useEffect(() => {
    const savedNotes = localStorage.getItem('fitlog_exercise_notes');
    if (savedNotes) {
      setExerciseNotes(JSON.parse(savedNotes));
    }
  }, []);

  // 保存备注
  const handleSaveNote = () => {
    if (!noteModalData) return;
    const newNotes = { ...exerciseNotes, [noteModalData.name]: noteModalData.note };
    
    // 如果内容为空，则删除该条记录
    if (!noteModalData.note.trim()) {
      delete newNotes[noteModalData.name];
    }

    setExerciseNotes(newNotes);
    localStorage.setItem('fitlog_exercise_notes', JSON.stringify(newNotes));
    markPrefsUpdated();
    scheduleDebouncedFitlogPush();
    setNoteModalData(null);
  };
  
  // 控制设置弹窗的状态
  const [restModalData, setRestModalData] = useState<{ name: string; time: number } | null>(null);

  // 初始化加载偏好
  useEffect(() => {
    const savedPrefs = localStorage.getItem('fitlog_rest_prefs');
    if (savedPrefs) {
      setRestPreferences(JSON.parse(savedPrefs));
    }
  }, []);

  // 获取某个动作的默认休息时间（有记录用记录，没记录默认90s）
  const getRestPref = (exerciseName: string) => {
    return restPreferences[exerciseName] || 90;
  };

  // 打开休息设置弹窗
  const openRestSettings = (exerciseName: string) => {
    const time = getRestPref(exerciseName);
    setRestModalData({ name: exerciseName, time });
  };

  // 确认开始休息（保存偏好 + 启动计时）
  const confirmStartRest = () => {
    if (!restModalData) return;
    
    // 1. 保存偏好到本地
    const newPrefs = { ...restPreferences, [restModalData.name]: restModalData.time };
    setRestPreferences(newPrefs);
    localStorage.setItem('fitlog_rest_prefs', JSON.stringify(newPrefs));
    markPrefsUpdated();

    // 2. 启动计时器
    startRest(restModalData.time);
    
    // 3. 关闭弹窗
    setRestModalData(null);
  };
  
  // --- 休息计时器状态 ---
  const [restSeconds, setRestSeconds] = useState(0);
  const [isResting, setIsResting] = useState(false);
  
  // --- 休息计时器倒计时逻辑 (在 App 层管理，避免组件卸载导致计时丢失) ---
  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;
    
    if (isResting && restSeconds > 0) {
      interval = setInterval(() => {
        setRestSeconds(prev => Math.max(0, prev - 1));
      }, 1000);
    }
    
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isResting, restSeconds]);
  
  // --- 开始休息函数 ---
// 开始休息函数 (增强版：后台通知)
// 开始休息函数 (修改版：支持双语通知)
  const startRest = async (seconds: number = 90) => {
    setRestSeconds(seconds);
    setIsResting(true);

    // 根据当前语言准备文案
    const notifTitle = lang === Language.CN ? "休息结束！💪" : "Rest Finished! 💪";
    const notifBody = lang === Language.CN ? "该开始下一组了，点击回到训练。" : "Time for the next set. Tap to return.";

    try {
      await LocalNotifications.cancel({ notifications: [{ id: 1001 }] });

      await LocalNotifications.schedule({
        notifications: [
          {
            title: notifTitle,
            body: notifBody,
            id: 1001,
            schedule: { at: new Date(Date.now() + seconds * 1000) },
            sound: undefined,
            smallIcon: "ic_stat_icon_config_sample",
            actionTypeId: "",
            extra: null
          }
        ]
      });
    } catch (e) {
      console.error("通知调度失败", e);
    }
  };
  // 调整时间
  const adjustRestTime = async (delta: number) => {
    setRestSeconds(prev => {
      const newTime = Math.max(0, prev + delta);
      
      // 根据当前语言准备文案
      const notifTitle = lang === Language.CN ? "休息结束！💪" : "Rest Finished! 💪";
      const notifBody = lang === Language.CN ? "该开始下一组了。" : "Time for the next set.";

      // 更新通知时间
      LocalNotifications.cancel({ notifications: [{ id: 1001 }] });
      if (newTime > 0) {
        LocalNotifications.schedule({
          notifications: [{
            title: notifTitle,
            body: notifBody,
            id: 1001,
            schedule: { at: new Date(Date.now() + newTime * 1000) }
          }]
        });
      }
      
      return newTime;
    });
  };
  // --- 新增结束 ---
  const [expandedMetric, setExpandedMetric] = useState<string | null>(null);
  // --- 新增：编辑状态和删除逻辑 ---
  const [editingMeasurementId, setEditingMeasurementId] = useState<string | null>(null);

  // 删除指标记录
  const handleDeleteMeasurement = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation(); // 防止折叠卡片
    // if (!window.confirm("确定删除这条记录?")) return; // 可选确认

    try {
      // 1. 从本地数据库删除
      await db.delete('custom_metrics', id);
      recordTombstone('customMetrics', id);
      await settingsCtx.reloadFromIndexedDb();
      scheduleDebouncedFitlogPush();
    } catch (err) {
      console.error(err);
    }
  };

  // 触发编辑模式
  const triggerEditMeasurement = (item: Measurement) => {
    setEditingMeasurementId(item.id);
    setMeasureForm({ name: item.name, value: item.value.toString(), unit: item.unit });
    setShowMeasureModal(true);
  };
  const [showMeasureModal, setShowMeasureModal] = useState(false);
  const [measureForm, setMeasureForm] = useState({ name: '', value: '', unit: 'cm' });

  // 计算每个指标的最新数据（用于在界面展示）
  const latestMetrics = useMemo(() => {
    const map = new Map<string, Measurement>();
    const sorted = [...measurements].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    sorted.forEach((m) => map.set(m.name, m));
    return Array.from(map.values()).map((m) => ({
      name: m.name,
      value: String(m.value),
      unit: m.unit,
      date: m.date,
    }));
  }, [measurements]);
// --- ✅ 修复Bug #6: 热力图数据计算 (完善异常处理版) ---
  const heatmapData = useMemo(() => {
    // 如果没有数据，直接返回空数组，防止报错
    if (!workouts || workouts.length === 0) return [];

    const map = new Map<string, number>();
    
    workouts.forEach((w, index) => {
      try {
        // ✅ 修复Bug #6: 更完善的数据验证
        if (!w || typeof w !== 'object') {
          console.warn(`Skipping invalid workout at index ${index}:`, w);
          return;
        }
        
        if (!w.date || typeof w.date !== 'string') {
          console.warn(`Skipping workout with invalid date at index ${index}:`, w);
          return;
        }
        
        // ✅ 修复Bug #6: 更严格的日期验证
        const d = new Date(w.date);
        
        // 检查日期是否有效 (Invalid Date)
        if (isNaN(d.getTime())) {
          console.warn(`Skipping workout with invalid date "${w.date}" at index ${index}`);
          return;
        }
        
        // ✅ 修复Bug #6: 检查日期是否在合理范围内（防止极端日期）
        const currentYear = new Date().getFullYear();
        const workoutYear = d.getFullYear();
        if (workoutYear < 1900 || workoutYear > currentYear + 10) {
          console.warn(`Skipping workout with unreasonable date "${w.date}" (year: ${workoutYear})`);
          return;
        }
        
        // ✅ 修复Bug #6: 安全的日期格式化
        let dayString: string;
        try {
          dayString = d.toISOString().split('T')[0];
        } catch (formatError) {
          console.warn(`Failed to format date "${w.date}":`, formatError);
          return;
        }
        
        // ✅ 修复Bug #6: 验证格式化后的日期字符串
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dayString)) {
          console.warn(`Invalid formatted date string "${dayString}" from "${w.date}"`);
          return;
        }
        
        map.set(dayString, (map.get(dayString) || 0) + 1);
      } catch (e) {
        console.warn(`Error processing workout at index ${index}:`, e, w);
      }
    });
    
    // ✅ 修复Bug #6: 验证最终结果
    const result = Array.from(map.entries()).map(([date, count]) => ({ date, count }));
    
    // 过滤掉任何可能的无效条目
    return result.filter(item => 
      item && 
      typeof item.date === 'string' && 
      typeof item.count === 'number' && 
      item.count > 0 &&
      /^\d{4}-\d{2}-\d{2}$/.test(item.date)
    );
  }, [workouts]);
// 保存指标函数 (升级版：支持编辑)
  const handleSaveMeasurement = async () => {
    if (!measureForm.name || !measureForm.value || !user) {
      alert("请填写完整信息");
      return;
    }
    
    try {
      setUiBusy(true);

      // 1. 确定日期：如果是编辑模式，保留原日期；如果是新增，用当前时间
      let dateToUse = new Date().toISOString();
      if (editingMeasurementId) {
        const existing = measurements.find(m => m.id === editingMeasurementId);
        if (existing) dateToUse = existing.date;
      }

      // 2. 构建数据对象
      const entry: Measurement = {
        id: editingMeasurementId || Date.now().toString(), // 有ID用ID，没ID生成新的
        userId: user.id,
        name: measureForm.name,
        value: parseFloat(measureForm.value.toString()), 
        unit: measureForm.unit,
        date: dateToUse
      };

      await db.save('custom_metrics', entry);
      await settingsCtx.reloadFromIndexedDb();
      scheduleDebouncedFitlogPush();

      setShowMeasureModal(false);
      // 重置表单和编辑ID
      setMeasureForm({ name: '', value: '', unit: measureForm.unit }); 
      setEditingMeasurementId(null);

    } catch (error: any) {
      alert("保存失败: " + error.message);
    } finally {
      setUiBusy(false);
    }
  };
  // unit now comes from Context (see line 62)
  const [selectedPRProject, setSelectedPRProject] = useState<string | null>(null);
  // ✅ 新增：控制历史记录中哪个维度正在画图 (格式: { "动作名称": "metricKey" })
  const [chartMetricPreference, setChartMetricPreference] = useState<Record<string, string>>({});

  const getChartMetric = (exerciseName: string) => {
    return chartMetricPreference[exerciseName] || getActiveMetrics(exerciseName)[0] || 'reps';
  };
  const [showLibrary, setShowLibrary] = useState(false);
  const [showGoalModal, setShowGoalModal] = useState(false);
  // 修改 2: 移除了 showSettings 状态，因为设置将移入 Profile 页面
  const [searchQuery, setSearchQuery] = useState('');
  
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
    const [customTags, setCustomTags] = useState<{id: string, name: string, category: 'bodyPart' | 'equipment', parentCategory?: ExerciseCategory}[]>(() => {
    try {
      const saved = localStorage.getItem('fitlog_custom_tags');
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  const [showAddTagModal, setShowAddTagModal] = useState(false);
  const [newTagName, setNewTagName] = useState('');
  const [newTagCategory, setNewTagCategory] = useState<'bodyPart' | 'equipment'>('bodyPart');

  const [isEditingTags, setIsEditingTags] = useState(false);
  const [showRenameModal, setShowRenameModal] = useState(false);
  const [tagToRename, setTagToRename] = useState<{ id: string, name: string } | null>(null);
  const [newTagNameInput, setNewTagNameInput] = useState('');

  const [showRenameExerciseModal, setShowRenameExerciseModal] = useState(false);
  const [exerciseToRename, setExerciseToRename] = useState<{ id: string, name: string } | null>(null);
  const [newExerciseNameInput, setNewExerciseNameInput] = useState('');

  // ✅ 问题4: 一键重置账户功能状态管理
  const [showResetAccountModal, setShowResetAccountModal] = useState(false);
  const [resetConfirmText, setResetConfirmText] = useState('');
  const [isResetting, setIsResetting] = useState(false);

  const [customExercises, setCustomExercises] = useState<ExerciseDefinition[]>(() => {
    try {
      const saved = localStorage.getItem('fitlog_custom_exercises');
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  const [exerciseOverrides, setExerciseOverrides] = useState<Record<string, Partial<ExerciseDefinition>>>({});
  const [tagRenameOverrides, setTagRenameOverrides] = useState<Record<string, string>>({});
  const [starredExercises, setStarredExercises] = useState<Record<string, number>>({});

  const applyPrefsFromSnapshot = (p: FitlogSyncedPrefs) => {
    setCustomTags(Array.isArray(p.customTags) ? p.customTags : []);
    setCustomExercises(Array.isArray(p.customExercises) ? p.customExercises : []);
    setExerciseNotes(p.exerciseNotes && typeof p.exerciseNotes === 'object' ? p.exerciseNotes : {});
    setRestPreferences(p.restPrefs && typeof p.restPrefs === 'object' ? p.restPrefs : {});
    setStarredExercises(
      p.starredExercises && typeof p.starredExercises === 'object' ? p.starredExercises : {},
    );
    setExerciseMetricConfigs(
      p.exerciseMetricConfigs && typeof p.exerciseMetricConfigs === 'object'
        ? p.exerciseMetricConfigs
        : {},
    );
    setTagRenameOverrides(
      p.tagRenameOverrides && typeof p.tagRenameOverrides === 'object' ? p.tagRenameOverrides : {},
    );
    setExerciseOverrides(
      p.exerciseOverrides && typeof p.exerciseOverrides === 'object' ? p.exerciseOverrides : {},
    );
    if (p.lang) setLang(p.lang as Language);
    if (p.unit) setUnit(p.unit);
    if (typeof p.avatarDataUrl === 'string' && p.avatarDataUrl) {
      setUser((prev) => (prev ? { ...prev, avatarUrl: p.avatarDataUrl! } : prev));
    }
  };

  const [showAddExerciseModal, setShowAddExerciseModal] = useState(false);
  const [newExerciseName, setNewExerciseName] = useState('');
  const [newExerciseTags, setNewExerciseTags] = useState<string[]>([]);
  const [newExerciseBodyPart, setNewExerciseBodyPart] = useState<string>('');

  const [isHistoryVisible, setIsHistoryVisible] = useState(false);

  const lastSelectionRef = useRef<string | null>(null);

  // ✅ 修复Bug #5: 添加同步锁，防止并发同步导致的竞态条件
  const syncLockRef = useRef<boolean>(false);

  // ✅ 修复Bug #5: 添加防抖同步，避免频繁的配置更新触发过多同步
  const debouncedSyncTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  

  // ✅ 修复Bug #5: 清理防抖定时器
  useEffect(() => {
    return () => {
      if (debouncedSyncTimeoutRef.current) {
        clearTimeout(debouncedSyncTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (lastSelectionRef.current !== selectedPRProject) {
      setIsHistoryVisible(false);
      lastSelectionRef.current = selectedPRProject;
    }
  }, [selectedPRProject]);

  const [draggedTagId, setDraggedTagId] = useState<string | null>(null);
  const [draggedFromExId, setDraggedFromExId] = useState<string | null>(null);
  const [isDraggingOverSidebar, setIsDraggingOverSidebar] = useState(false);

  // ✅ 修复Bug #4: 添加全局拖拽状态重置函数，确保状态一致性
  const resetDragState = () => {
    setDraggedTagId(null);
    setDraggedFromExId(null);
    setIsDraggingOverSidebar(false);
  };

  // ✅ 修复Bug #4: 添加全局拖拽事件监听器，处理异常情况
  useEffect(() => {
    const handleGlobalDragEnd = () => {
      resetDragState();
    };

    const handleGlobalMouseUp = () => {
      // 延迟重置，确保正常的drop事件先执行
      setTimeout(resetDragState, 100);
    };

    // 监听全局拖拽结束事件
    document.addEventListener('dragend', handleGlobalDragEnd);
    document.addEventListener('mouseup', handleGlobalMouseUp);
    
    // 监听页面失焦，防止用户拖拽到浏览器外部时状态不重置
    window.addEventListener('blur', resetDragState);

    return () => {
      document.removeEventListener('dragend', handleGlobalDragEnd);
      document.removeEventListener('mouseup', handleGlobalMouseUp);
      window.removeEventListener('blur', resetDragState);
    };
  }, []);

  // ✅ 新增：自定义训练时间相关状态
  const [showTimePickerModal, setShowTimePickerModal] = useState<{ exerciseId?: string, currentTime?: string } | null>(null);
  const [customExerciseTime, setCustomExerciseTime] = useState('');
  
  // ✅ 新增：自定义日期时间选择器状态
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [selectedHour, setSelectedHour] = useState(new Date().getHours());
  const [selectedMinute, setSelectedMinute] = useState(new Date().getMinutes());
  const [currentMonth, setCurrentMonth] = useState(new Date().getMonth());
  const [currentYear, setCurrentYear] = useState(new Date().getFullYear());

  // ✅ 新增：日期选择器辅助函数
  const getDaysInMonth = (month: number, year: number) => {
    return new Date(year, month + 1, 0).getDate();
  };

  const getFirstDayOfMonth = (month: number, year: number) => {
    return new Date(year, month, 1).getDay();
  };

  const isToday = (date: Date) => {
    const today = new Date();
    return date.getDate() === today.getDate() && 
           date.getMonth() === today.getMonth() && 
           date.getFullYear() === today.getFullYear();
  };

  const isSameDay = (date1: Date, date2: Date) => {
    return date1.getDate() === date2.getDate() && 
           date1.getMonth() === date2.getMonth() && 
           date1.getFullYear() === date2.getFullYear();
  };

  // 初始化时间选择器数据
  const initializeTimePicker = (currentTime?: string) => {
    const date = currentTime ? new Date(currentTime) : new Date();
    setSelectedDate(date);
    setSelectedHour(date.getHours());
    setSelectedMinute(date.getMinutes());
    setCurrentMonth(date.getMonth());
    setCurrentYear(date.getFullYear());
  };

  // ✅ 新增：时间格式化函数
  const formatExerciseTime = (time: string, lang: string) => {
    if (!time) return { date: '', time: '' };
    
    const date = new Date(time);
    
    if (lang === 'cn') {
      return {
        date: date.toLocaleDateString('zh-CN'),
        time: date.toLocaleTimeString('zh-CN', { 
          hour: '2-digit', 
          minute: '2-digit' 
        })
      };
    } else {
      return {
        date: date.toLocaleDateString('en-US'),
        time: date.toLocaleTimeString('en-US', { 
          hour: '2-digit', 
          minute: '2-digit' 
        })
      };
    }
  };

  // ✅ 新增：更新动作训练时间的函数
  const updateExerciseTime = async (workoutId: string, exerciseId: string, newTime: string) => {
    try {
      const allWorkouts = await db.getAll<WorkoutSession>('workouts');
      const workout = allWorkouts.find(w => w.id === workoutId);
      if (!workout) return;
      
      const exerciseIndex = workout.exercises.findIndex(ex => ex.id === exerciseId);
      if (exerciseIndex === -1) return;
      
      workout.exercises[exerciseIndex].exerciseTime = newTime;
      await db.save('workouts', workout);
      
      // 重新加载数据
      await loadLocalData(resolvedUserId);
      scheduleDebouncedFitlogPush();
      
      alert(
        lang === 'cn' 
          ? '训练时间已更新'
          : 'Exercise time updated'
      );
      
    } catch (error) {
      console.error('Error updating exercise time:', error);
      alert(
        lang === 'cn' 
          ? '更新失败，请重试'
          : 'Update failed, please try again'
      );
    }
  };

  const [showWeightInput, setShowWeightInput] = useState(false);
  const [weightInputValue, setWeightInputValue] = useState('');
  const [editingWeightId, setEditingWeightId] = useState<string | null>(null);

  const formatWeight = (val: number): string => {
    const converted = unit === 'kg' ? val : val * KG_TO_LBS;
    return converted.toFixed(1);
  };
  const parseWeight = (val: number) => unit === 'kg' ? val : val / KG_TO_LBS;

  // currentWorkout and setCurrentWorkout now come from WorkoutContext (see line 86-87)
  const [newGoal, setNewGoal] = useState<Partial<Goal>>({ type: 'weight', targetValue: 0, currentValue: 0, label: '' });
  // ✅ 新增：编辑目标相关状态
  const [editingGoal, setEditingGoal] = useState<Goal | null>(null);
  const [showEditGoalModal, setShowEditGoalModal] = useState(false);

  const resolveName = (storedName: string): string => {
    const allDef = [...DEFAULT_EXERCISES, ...customExercises];
    const def = allDef.find(d => {
      const over = exerciseOverrides[d.id];
      return d.name.en === storedName || 
             d.name.cn === storedName || 
             over?.name?.en === storedName || 
             over?.name?.cn === storedName;
    });

    if (def) {
      return exerciseOverrides[def.id]?.name?.[lang] || def.name[lang];
    }
    return storedName;
  };

  // ✅ 修复：bestLifts 使用原始名称 ex.name 作为稳定 key，解决切换语言后星标丢失问题
  const bestLifts = useMemo(() => {
    const liftsMap: Record<string, { weight: number; originalName: string }> = {};
    workouts.forEach((session) => (session.exercises ?? []).forEach((ex) => {
      const weights = (ex.sets ?? []).map((s) => s.weight || 0);
      const w = weights.length ? Math.max(...weights) : 0;
      const normalizedName = resolveName(ex.name);
      const originalName = ex.name; // ✅ 使用原始存储名称作为稳定 key
      if (!liftsMap[originalName] || w > liftsMap[originalName].weight) {
        liftsMap[originalName] = { weight: w, originalName };
      }
    }));

    return Object.entries(liftsMap)
      .map(([key, { weight }]) => ({ name: resolveName(key), key, weight }))
      .sort((a, b) => {
        const starA = starredExercises[a.key] || 0; // ✅ 使用稳定的 key
        const starB = starredExercises[b.key] || 0;
        if (starA !== starB) return starB - starA;
        return a.name.localeCompare(b.name, lang === Language.CN ? 'zh-Hans-CN' : 'en');
      });
  }, [workouts, lang, exerciseOverrides, starredExercises]);

  useEffect(() => {
    const initApp = async () => {
      try {
        await db.init();
        await migrateRecordsToSoloUserId();
        if (isRemoteConfigured()) {
          try {
            await pullAndMergeFitlogRemote();
          } catch (e) {
            console.warn('[fitlog] 启动时远端拉取失败，继续使用本地数据:', e);
          }
        }
        applyPrefsFromSnapshot(readPrefsFromLocalStorage());
        await loadLocalData(resolvedUserId);
        try {
          await LocalNotifications.requestPermissions();
        } catch {
          /* 浏览器环境无 Capacitor 通知 */
        }
      } catch (e) {
        console.error('[fitlog] 应用初始化失败:', e);
      }
    };
    void initApp();
  }, []);

  const loadLocalData = async (userId: string) => {
    if (!userId) return; // 防御逻辑：没 ID 不读库

    try {
      // 使用 Promise.all 并发读取，提高启动速度
      const [allW, allG, allWeights, allMeasurements] = await Promise.all([
        db.getAll<WorkoutSession>('workouts'),
        db.getAll<Goal>('goals'),
        db.getAll<WeightEntry>('weightLogs'),
        db.getAll<Measurement>('custom_metrics')
      ]);

      // 过滤当前用户的数据
      const userW = allW.filter(w => w.userId === userId);
      
      // ✅ 新增：数据迁移 - 为现有动作记录添加默认训练时间和配置
      let hasDataMigration = false;
      const migratedWorkouts = userW.map(workout => {
        let workoutChanged = false;
        const updatedExercises = workout.exercises.map(exercise => {
          let exerciseChanged = false;
          let updatedExercise = { ...exercise };
          
          // 迁移1：添加默认训练时间
          if (!exercise.exerciseTime) {
            updatedExercise.exerciseTime = new Date(workout.date).toISOString();
            exerciseChanged = true;
          }
          
          // 迁移2：添加默认instanceConfig
          if (!exercise.instanceConfig) {
            updatedExercise.instanceConfig = {
              enablePyramid: false,
              bodyweightMode: 'none',
              pyramidMode: 'decreasing',
              autoCalculateSubSets: false
            };
            exerciseChanged = true;
          }
          
          if (exerciseChanged) {
            workoutChanged = true;
            hasDataMigration = true;
            return updatedExercise;
          }
          return exercise;
        });
        
        if (workoutChanged) {
          return { ...workout, exercises: updatedExercises };
        }
        return workout;
      });
      
      // 如果有数据迁移，保存到数据库
      if (hasDataMigration) {
        console.log('执行数据迁移：为现有动作记录添加训练时间');
        for (const workout of migratedWorkouts) {
          if (workout !== userW.find(w => w.id === workout.id)) {
            await db.save('workouts', workout);
          }
        }
      }

      const userG = allG.filter(g => g.userId === userId);
      
      // ✅ 新增：Goal数据迁移 - 将旧格式的Goal升级到新格式
      let hasGoalMigration = false;
      const migratedGoals = userG.map(goal => {
        // 检查是否是旧格式的Goal（缺少必需字段）
        if (!goal.title || !goal.startDate || !goal.dataSource || !goal.progressHistory || goal.isActive === undefined) {
          hasGoalMigration = true;
          const now = new Date().toISOString();
          
          return {
            ...goal,
            // 基本信息
            title: goal.title || goal.label || 'Untitled Goal',
            description: goal.description || '',
            
            // 时间设置
            startDate: goal.startDate || goal.createdAt || now,
            targetDate: goal.targetDate || goal.deadline,
            
            // 数据源配置
            dataSource: goal.dataSource || 'manual',
            autoUpdateRule: goal.autoUpdateRule,
            
            // 进度追踪
            progressHistory: goal.progressHistory || [],
            
            // 设置选项
            isActive: goal.isActive !== undefined ? goal.isActive : true,
            
            // 元数据
            createdAt: goal.createdAt || now,
            updatedAt: goal.updatedAt || now,
            completedAt: goal.completedAt,
            
            // 确保category存在
            category: goal.category || goal.type,
            
            // 保持向后兼容字段
            label: goal.label || goal.title,
            deadline: goal.deadline || goal.targetDate
          } as Goal;
        }
        return goal;
      });
      
      // 如果有Goal迁移，保存到数据库
      if (hasGoalMigration) {
        console.log('执行Goal数据迁移：升级到新的Goal格式');
        for (const goal of migratedGoals) {
          if (goal !== userG.find(g => g.id === goal.id)) {
            await db.save('goals', goal);
          }
        }
      }
      const userWeights = allWeights.filter(w => w.userId === userId);
      const userMeasures = allMeasurements.filter(m => m.userId === userId);

      await workoutCtx.refreshFromDb();
      await goalsCtx.refreshFromDb();
      await settingsCtx.reloadFromIndexedDb();

      console.log(`本地数据加载完成: ${migratedWorkouts.length} 场训练${hasDataMigration ? ' (已执行数据迁移)' : ''}${hasGoalMigration ? ', Goal数据已迁移' : ''}`);
    } catch (error) {
      console.error("加载本地数据失败:", error);
    }
  };

  const performFullSync = async () => {
    if (!isRemoteConfigured()) {
      alert(
        lang === Language.CN
          ? '未配置个人服务器：请在 .env.local 设置 VITE_API_URL 与 VITE_API_KEY'
          : 'Set VITE_API_URL and VITE_API_KEY in .env.local.',
      );
      return;
    }
    if (syncLockRef.current) return;
    syncLockRef.current = true;
    setSyncStatus('syncing');
    try {
      const mergedPrefs = await pullAndMergeFitlogRemote();
      applyPrefsFromSnapshot(mergedPrefs ?? readPrefsFromLocalStorage());
      await loadLocalData(resolvedUserId);
      await pushFitlogRemoteSnapshot();
      setSyncStatus('idle');
    } catch (e: any) {
      console.error('Sync Failure:', e?.message || e);
      setSyncStatus('error');
    } finally {
      syncLockRef.current = false;
    }
  };

  // ✅ 修复问题7&8: 添加保存状态管理和单位确认功能
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [showSaveConfirmation, setShowSaveConfirmation] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  // ✅ 修复问题8: 带单位确认的保存函数
  const handleSaveWithConfirmation = () => {
    // 检查当前单位并显示确认对话框
    const unitText = unit === 'kg' ? '公斤(kg)' : '磅(lbs)';
    const confirmMessage = lang === Language.CN 
      ? `确认保存训练记录吗？\n\n当前单位设置: ${unitText}\n\n请确认所有重量数据都是以${unitText}为单位记录的。`
      : `Confirm saving workout?\n\nCurrent unit: ${unitText}\n\nPlease confirm all weight data is recorded in ${unitText}.`;
    
    if (confirm(confirmMessage)) {
      handleSaveWorkout();
    }
  };

  // 内部实际保存训练。faithful: 来自计划时的"是否完全按计划"标记；非计划训练保持 undefined
  const performSaveWorkout = async (faithful?: boolean) => {
    setSaveStatus('saving');
    setHasUnsavedChanges(false);

    try {
      if (!currentWorkout.exercises || currentWorkout.exercises.length === 0) {
        alert(lang === Language.CN ? "请至少添加一个动作" : "Please add at least one exercise");
        setSaveStatus('error');
        return;
      }

      const hasData = currentWorkout.exercises.some(ex => ex.sets && ex.sets.length > 0);
      if (!hasData) {
        alert(lang === Language.CN ? "请至少记录一组数据" : "Please log at least one set");
        setSaveStatus('error');
        return;
      }

      if (!currentWorkout.exercises?.length || !user) {
        setSaveStatus('error');
        return;
      }

      const scheduleId = activeScheduleIdRef.current;
      const session: WorkoutSession = {
        ...currentWorkout,
        id: currentWorkout.id || Date.now().toString(),
        userId: user.id,
        title: currentWorkout.title || `Workout ${new Date().toLocaleDateString()}`,
        date: currentWorkout.date || new Date().toISOString(),
        ...(scheduleId && typeof faithful === 'boolean'
          ? { fromSchedule: { scheduleId, faithful } }
          : {}),
      } as WorkoutSession;

      await db.save('workouts', session);
      await loadLocalData(resolvedUserId);

      if (scheduleId) {
        markActiveSchedulePending.current = true;
      }

      setSaveStatus('saved');

      setTimeout(() => {
        setActiveTab('dashboard');
        setCurrentWorkout(workoutCtx.createNewWorkout());
        setSaveStatus('idle');
      }, 2000);

      scheduleDebouncedFitlogPush();
    } catch (error) {
      console.error('Save workout failed:', error);
      setSaveStatus('error');
      alert(lang === Language.CN ? "保存失败，请重试" : "Save failed, please try again");
    }
  };

  const handleSaveWorkout = async () => {
    // 来自训练计划的训练：先弹"按计划/有调整/取消"确认，再走真正的保存
    if (activeScheduleIdRef.current) {
      setPlanConfirmOpen(true);
      return;
    }
    await performSaveWorkout();
  };

  // ✅ 修复问题7: 监听训练数据变化，标记未保存状态
  useEffect(() => {
    if (currentWorkout?.exercises && currentWorkout.exercises.length > 0) {
      const hasAnyData = currentWorkout.exercises.some(ex => 
        ex.sets && ex.sets.length > 0 && ex.sets.some(set => 
          set.weight || set.reps || set.distance || set.duration || set.score
        )
      );
      setHasUnsavedChanges(hasAnyData);
    } else {
      setHasUnsavedChanges(false);
    }
  }, [currentWorkout]);

  const handleEditWorkout = (workoutId: string) => {
    const workoutToEdit = workouts.find(w => w.id === workoutId);
    if (workoutToEdit) {
      setCurrentWorkout({ ...workoutToEdit });
      setActiveTab('new');
      setSelectedPRProject(null);
    }
  };
  
  // ✅ 修复历史记录删除Bug: 添加删除单个动作记录的函数
  const handleDeleteExerciseRecord = async (
    e: React.MouseEvent,
    workoutId: string, 
    exerciseId: string,
    exerciseName: string,
    date: string
  ) => {
    e.stopPropagation();
    
    // 确认对话框
    const confirmed = window.confirm(
      lang === Language.CN 
        ? `确定要删除 ${exerciseName} 在 ${date} 的记录吗？\n\n注意：这只会删除这个动作的记录，不会影响同一训练中的其他动作。`
        : `Are you sure you want to delete the ${exerciseName} record from ${date}?\n\nNote: This will only delete this exercise record, not affecting other exercises in the same workout.`
    );
    
    if (!confirmed) return;
    
    try {
      // 1. 获取训练记录
      const allWorkouts = await db.getAll<WorkoutSession>('workouts');
      const workout = allWorkouts.find(w => w.id === workoutId);
      
      if (!workout) {
        console.error('Workout not found:', workoutId);
        alert(lang === Language.CN ? '训练记录不存在' : 'Workout not found');
        return;
      }
      
      // 2. 移除指定动作（使用严格相等比较）
      const exerciseToDelete = workout.exercises.find(ex => ex.id === exerciseId);
      if (!exerciseToDelete) {
        console.error('Exercise not found in workout:', exerciseId);
        alert(lang === Language.CN ? '动作记录不存在' : 'Exercise not found');
        return;
      }
      
      const updatedExercises = workout.exercises.filter(ex => ex.id !== exerciseId);
      
      // 3. 如果训练为空，删除整个训练
      if (updatedExercises.length === 0) {
        await db.delete('workouts', workoutId);
        await workoutCtx.refreshFromDb();
      } else {
        // 4. 否则更新训练记录
        const updatedWorkout = {
          ...workout,
          exercises: updatedExercises,
          userId: workout.userId, // 确保 userId 存在
        };
        await db.save('workouts', updatedWorkout);
        console.log('Updated workout after removing exercise:', workoutId);

        await workoutCtx.refreshFromDb();
      }

      // 5. 同步到服务器
      scheduleDebouncedFitlogPush();

      // 6. 用户反馈
      alert(
        lang === Language.CN 
          ? `已删除 ${exerciseName} 的记录`
          : `Deleted ${exerciseName} record`
      );
      
    } catch (error) {
      console.error('Error deleting exercise record:', error);
      alert(
        lang === Language.CN 
          ? '删除失败，请重试'
          : 'Delete failed, please try again'
      );
    }
  };
  
  // --- 新增：删除训练记录逻辑 ---
  const handleDeleteWorkout = async (e: React.MouseEvent, workoutId: string) => {
    e.stopPropagation(); // 防止触发折叠

    const confirmText = lang === Language.CN ? '确定要删除这场训练记录吗？' : 'Delete this workout?';
    if (!window.confirm(confirmText)) return;

    try {
      await workoutCtx.deleteWorkout(workoutId);
      scheduleDebouncedFitlogPush();

    } catch (err: any) {
      console.error("Delete workout failed:", err);
      alert(lang === Language.CN ? '删除失败' : 'Delete failed');
    }
  };

  // ✅ 问题4: 一键重置账户功能 - 核心重置函数
  const handleResetAccount = async () => {
    if (!user) return;
    
    setIsResetting(true);
    
    try {
      console.log('开始重置本地数据...');

      // 1. 清除本地数据库
      const allWorkouts = await db.getAll<WorkoutSession>('workouts');
      const userWorkouts = allWorkouts.filter(w => w.userId === user.id);
      for (const workout of userWorkouts) {
        await db.delete('workouts', workout.id);
      }
      
      const allGoals = await db.getAll<Goal>('goals');
      const userGoals = allGoals.filter(g => g.userId === user.id);
      for (const goal of userGoals) {
        await db.delete('goals', goal.id);
      }
      
      const allWeights = await db.getAll<WeightEntry>('weightLogs');
      const userWeights = allWeights.filter(w => w.userId === user.id);
      for (const weight of userWeights) {
        await db.delete('weightLogs', weight.id);
      }
      
      const allMeasurements = await db.getAll<Measurement>('custom_metrics');
      const userMeasurements = allMeasurements.filter(m => m.userId === user.id);
      for (const measurement of userMeasurements) {
        await db.delete('custom_metrics', measurement.id);
      }
      
      // 3. 清除localStorage
      console.log('清除本地存储...');
      const localStorageKeys = [
        'fitlog_metric_configs',
        'fitlog_exercise_notes', 
        'fitlog_rest_prefs',
        'fitlog_starred_exercises',
        'fitlog_exercise_overrides',
        'fitlog_tag_rename_overrides',
        'fitlog_custom_tags',
        'fitlog_custom_exercises'
      ];
      
      localStorageKeys.forEach(key => {
        localStorage.removeItem(key);
      });
      localStorage.removeItem('fitlog_avatar_data_url');
      clearTombstones();

      // 重置内存状态
      console.log('重置内存状态...');
      await workoutCtx.refreshFromDb();
      await goalsCtx.refreshFromDb();
      await settingsCtx.reloadFromIndexedDb();
      setCustomTags([]);
      setCustomExercises([]);
      setExerciseNotes({});
      setRestPreferences({});
      setExerciseMetricConfigs({});
      setStarredExercises({});
      setExerciseOverrides({});
      setTagRenameOverrides({});
      setCurrentWorkout(workoutCtx.createNewWorkout());

      if (isRemoteConfigured()) {
        try {
          await pushFitlogRemoteSnapshot();
        } catch (e) {
          console.warn('远端清空快照上传失败:', e);
        }
      }

      // 5. 关闭重置对话框
      setShowResetAccountModal(false);
      setResetConfirmText('');
      
      // 6. 显示成功提示
      alert(translations.resetSuccess[lang]);
      
      // 7. 跳转到dashboard
      setActiveTab('dashboard');
      
      console.log('账户重置完成');
      
    } catch (error) {
      console.error('重置账户失败:', error);
      alert(translations.resetError[lang]);
    } finally {
      setIsResetting(false);
    }
  };

  // --- 新增：全量数据格式化导出 ---
  const handleExportData = async () => {
    try {
      setSyncStatus('syncing'); // 借用同步图标表示正在处理

      // 1. 收集所有数据
      const exportPackage = {
        app: "FitLog AI",
        exportDate: new Date().toISOString(),
        user: {
          id: user?.id,
          email: user?.email,
          username: user?.username
        },
        // 核心历史数据
        data: {
          workouts: workouts,
          weightHistory: weightEntries,
          goals: goals,
          bodyMeasurements: measurements
        },
        // 所有个性化配置 (从现有的状态或 localStorage 获取)
        settings: {
          unit: unit,
          language: lang,
          exerciseNotes: exerciseNotes,
          restPreferences: restPreferences,
          customTags: customTags,
          customExercises: customExercises,
          starredExercises: starredExercises,
          metricConfigs: exerciseMetricConfigs
        }
      };

      // 2. 转换为 JSON 字符串并创建下载链接
      const jsonString = JSON.stringify(exportPackage, null, 2);
      const blob = new Blob([jsonString], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      
      // 3. 触发浏览器下载
      const link = document.createElement('a');
      link.href = url;
      link.download = `FitLog_Backup_${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      alert(translations.exportSuccess[lang]);
      setSyncStatus('idle');
    } catch (error) {
      console.error("Export failed:", error);
      setSyncStatus('error');
    }
  };

  const handleAddGoal = async () => {
    if (!newGoal.label || !newGoal.targetValue || !user) return;
    
    const now = new Date().toISOString();
    const goal: Goal = { 
      id: Date.now().toString(), 
      userId: user.id, 
      type: newGoal.type as GoalType, 
      category: newGoal.type, // 使用type作为默认category
      
      // 基本信息
      title: newGoal.label!,
      description: '',
      
      // 目标设置
      targetValue: newGoal.targetValue!, 
      currentValue: newGoal.currentValue || 0, 
      unit: newGoal.type === 'weight' ? unit : (newGoal.type === 'strength' ? unit : 'times/week'),
      
      // 时间设置
      startDate: now,
      targetDate: undefined,
      
      // 数据源配置
      dataSource: 'manual',
      autoUpdateRule: undefined,
      
      // 进度追踪
      progressHistory: [],
      
      // 设置选项
      isActive: true,
      
      // 元数据
      createdAt: now,
      updatedAt: now,
      completedAt: undefined,
      
      // 兼容旧版本
      label: newGoal.label!, // 兼容旧版本
      deadline: undefined
    };
    
    await db.save('goals', goal);
    await loadLocalData(resolvedUserId);
    setShowGoalModal(false);
    scheduleDebouncedFitlogPush();
  };

  // ✅ 新增：编辑目标处理函数
  const handleEditGoal = (goal: Goal) => {
    setEditingGoal(goal);
    setShowEditGoalModal(true);
  };

  // 由「训练计划」启动一次具体的训练 —— 预填动作 + 跳到「新建训练」
  const activeScheduleIdRef = useRef<string | null>(null);
  const handleStartScheduledSession = useCallback((scheduleId: string) => {
    const target = scheduleCtx.schedules.find(s => s.id === scheduleId);
    if (!target) return;
    activeScheduleIdRef.current = scheduleId;
    const empty = workoutCtx.createNewWorkout();
    const prefilled: WorkoutSession = {
      ...empty,
      title: target.title || (lang === Language.CN ? '计划训练' : 'Planned session'),
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
    setActiveTab('new');
  }, [scheduleCtx.schedules, workoutCtx, lang, setCurrentWorkout, setActiveTab]);

  // 训练保存成功后，回写关联日程为 completed
  const markActiveSchedulePending = useRef(false);
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
  }, [workouts, scheduleCtx]);

  // ✅ 新增：保存编辑后的目标
  const handleSaveEditedGoal = async () => {
    if (!editingGoal || !user) return;
    
    const updatedGoal: Goal = {
      ...editingGoal,
      updatedAt: new Date().toISOString()
    };
    
    await db.save('goals', updatedGoal);
    await loadLocalData(resolvedUserId);
    setShowEditGoalModal(false);
    scheduleDebouncedFitlogPush();
  };

  // ✅ 新增：取消编辑目标
  const handleCancelEditGoal = () => {
    setEditingGoal(null);
    setShowEditGoalModal(false);
  };

  const handleLogWeight = async () => {
    if (!weightInputValue || !user) return;
    const w = Number(weightInputValue);
    let dateToUse = new Date().toISOString();
    if (editingWeightId) {
      const old = weightEntries.find(we => we.id === editingWeightId);
      if (old) dateToUse = old.date;
    }
    
    const entry: WeightEntry = {
      id: editingWeightId || Date.now().toString(),
      userId: user.id,
      weight: parseWeight(w),
      date: dateToUse,
      unit: unit
    };
    await db.save('weightLogs', entry);
    const weightKg = entry.weight;
    const isLatest =
      weightEntries.length === 0 ||
      new Date(dateToUse).getTime() >= new Date(weightEntries[0].date).getTime();
    if (isLatest) {
      const weightGoals = goals.filter((g) => g.type === 'weight');
      for (const g of weightGoals) {
        const updatedGoal = { ...g, currentValue: weightKg };
        await db.save('goals', updatedGoal);
      }
    }
    await loadLocalData(resolvedUserId);
    setEditingWeightId(null);
    setShowWeightInput(false);
    setSelectedPRProject('__WEIGHT__');
  };
  // --- 新增：删除体重记录函数 ---
  const handleDeleteWeightEntry = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation(); // 防止误触
    
    const confirmText = lang === Language.CN ? '确定要删除这条记录吗？' : 'Delete this entry?';
    if (!window.confirm(confirmText)) return;

    try {
      await settingsCtx.deleteWeightEntry(id);
      
    } catch (error) {
      console.error("Delete failed", error);
    }
  };
// --- 头像上传逻辑开始 ---
  const fileInputRef = useRef<HTMLInputElement>(null);

const handleAvatarUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !user) return;

    try {
      setUiBusy(true);
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = () => reject(new Error('read failed'));
        r.readAsDataURL(file);
      });
      localStorage.setItem('fitlog_avatar_data_url', dataUrl);
      const updatedUser = { ...user, avatarUrl: dataUrl };
      setUser(updatedUser);
      localStorage.setItem('fitlog_current_user', JSON.stringify(updatedUser));
      scheduleDebouncedFitlogPush();
    } catch (error: any) {
      console.error("Upload error:", error);
      alert('上传失败: ' + error.message);
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
      setUiBusy(false);
    }
  };
  // --- 头像上传逻辑结束 ---
  const triggerEditWeight = (entry: WeightEntry) => {
    setEditingWeightId(entry.id);
    const currentVal = unit === 'kg' ? entry.weight : entry.weight * KG_TO_LBS;
    setWeightInputValue(currentVal.toFixed(1).replace(/\.0$/, '')); 
    setShowWeightInput(true);
  };

  const toggleStarExercise = (name: string) => {
    setStarredExercises(prev => {
      const next = { ...prev };
      if (next[name]) delete next[name];
      else next[name] = Date.now();
      localStorage.setItem('fitlog_starred_exercises', JSON.stringify(next));
      localStorage.setItem('fitlog_starred_last_update', Date.now().toString());
      markPrefsUpdated();
      scheduleDebouncedFitlogPush();
      return next;
    });
  };

const getTagName = (tid: string) => {
    if (!tid) return '';
    const lowerId = tid.toLowerCase();
    
    // 检查重命名覆盖 (保持原始 ID 匹配)
    if (tagRenameOverrides[tid]) return tagRenameOverrides[tid];
    
    // 检查自定义标签
    const customTag = customTags.find(ct => ct.id === tid || ct.id.toLowerCase() === lowerId);
    if (customTag) return customTag.name;
    
    // ✅ 核心修复：从 translations 字典中进行不区分大小写的查找
    const systemKey = Object.keys(translations).find(k => k.toLowerCase() === lowerId);
    if (systemKey) {
      return (translations as any)[systemKey][lang];
    }

    // 如果是存粹的数字 ID 且找不到定义，返回空（隐藏它）
    if (/^\d{10,13}$/.test(tid)) return ''; 

    return tid; 
  };

  // ✅ 新增：基于配置的判断函数，替代基于标签的判断
  const getExerciseConfig = (exercise: Exercise) => {
    return exercise.instanceConfig || {
      enablePyramid: false,
      bodyweightMode: 'none',
      pyramidMode: 'decreasing',
      autoCalculateSubSets: false
    };
  };

  // ✅ 新增：确保Exercise有完整的instanceConfig
  const ensureExerciseConfig = (exercise: Exercise): Exercise => {
    if (!exercise.instanceConfig) {
      return {
        ...exercise,
        instanceConfig: {
          enablePyramid: false,
          bodyweightMode: 'none',
          pyramidMode: 'decreasing',
          autoCalculateSubSets: false
        }
      };
    }
    return exercise;
  };

  const isBodyweightMode = (exercise: Exercise): boolean => {
    const config = getExerciseConfig(exercise);
    return config.bodyweightMode !== 'none';
  };

  const isPyramidEnabled = (exercise: Exercise): boolean => {
    const config = getExerciseConfig(exercise);
    return config.enablePyramid;
  };

  // ✅ 新增：递增递减组管理函数
  const addSubSet = (exerciseIndex: number, setIndex: number, template?: Partial<SubSetLog>) => {
    const exercises = [...currentWorkout.exercises!];
    const set = exercises[exerciseIndex].sets[setIndex];
    
    if (!set.subSets) {
      set.subSets = [];
    }
    
    const newSubSet: SubSetLog = {
      id: Date.now().toString(),
      weight: template?.weight || set.weight * 0.9, // 默认减少10%
      reps: template?.reps || set.reps,
      restSeconds: template?.restSeconds || 15,
      note: template?.note || ''
    };
    
    set.subSets.push(newSubSet);
    setCurrentWorkout({ ...currentWorkout, exercises });
  };

  const updateSubSet = (
    exerciseIndex: number, 
    setIndex: number, 
    subSetIndex: number, 
    updates: Partial<SubSetLog>
  ) => {
    const exercises = [...currentWorkout.exercises!];
    const subSet = exercises[exerciseIndex].sets[setIndex].subSets![subSetIndex];
    
    exercises[exerciseIndex].sets[setIndex].subSets![subSetIndex] = {
      ...subSet,
      ...updates
    };
    
    setCurrentWorkout({ ...currentWorkout, exercises });
  };

  const removeSubSet = (exerciseIndex: number, setIndex: number, subSetIndex: number) => {
    const exercises = [...currentWorkout.exercises!];
    exercises[exerciseIndex].sets[setIndex].subSets = 
      exercises[exerciseIndex].sets[setIndex].subSets!.filter((_, i) => i !== subSetIndex);
    
    setCurrentWorkout({ ...currentWorkout, exercises });
  };

  // ✅ 新增：自动计算递增递减组
  const calculatePyramidSubSets = (config: PyramidCalculator): SubSetLog[] => {
    const subSets: SubSetLog[] = [];
    
    for (let i = 0; i < config.subSetCount; i++) {
      let weight = config.baseWeight;
      let reps = config.baseReps;
      
      switch (config.mode) {
        case 'decreasing':
          weight = config.baseWeight * (1 - (config.weightStep / 100) * (i + 1));
          break;
        case 'increasing':
          weight = config.baseWeight * (1 + (config.weightStep / 100) * (i + 1));
          break;
        case 'mixed':
          // 先增后减的金字塔模式
          const midPoint = Math.floor(config.subSetCount / 2);
          if (i < midPoint) {
            weight = config.baseWeight * (1 + (config.weightStep / 100) * (i + 1));
          } else {
            weight = config.baseWeight * (1 - (config.weightStep / 100) * (i - midPoint));
          }
          break;
      }
      
      // 次数策略
      switch (config.repsStrategy) {
        case 'increasing':
          reps = config.baseReps + i;
          break;
        case 'decreasing':
          reps = Math.max(1, config.baseReps - i);
          break;
        case 'failure':
          reps = i === config.subSetCount - 1 ? -1 : config.baseReps; // -1 表示力竭
          break;
        // 'constant' 保持不变
      }
      
      subSets.push({
        id: `subset_${Date.now()}_${i}`,
        weight: Math.round(weight * 2) / 2, // 四舍五入到0.5kg
        reps: reps,
        restSeconds: 15,
        note: ''
      });
    }
    
    return subSets;
  };

const filteredExercises = useMemo(() => {
    const allBase = [...DEFAULT_EXERCISES, ...customExercises];

    const all = allBase
      .map(ex => exerciseOverrides[ex.id] ? { ...ex, ...exerciseOverrides[ex.id] } : ex)
      // ✅ 新增：过滤掉被标记为隐藏的动作
      .filter(ex => !exerciseOverrides[ex.id]?.hidden)
      // "全部分类"模式（activeLibraryCategory === null）下不按分类过滤；
      // 否则只显示当前分类下的动作。
      .filter(ex =>
        activeLibraryCategory === null
          ? true
          : (ex.category || 'STRENGTH') === activeLibraryCategory,
      );

    return all.filter(ex => {
      const q = searchQuery.toLowerCase();
      
      // ✅ 修复Bug #3: 安全检查 - 确保name对象存在，防止空指针异常
      if (!ex.name || !ex.name[lang]) {
        console.warn('Exercise missing name:', ex);
        return false;
      }
      
      const matchSearch = !searchQuery || ex.name[lang].toLowerCase().includes(q);
      
      const selParts = selectedTags.filter(t => BODY_PARTS.some(bp => bp.toLowerCase() === t.toLowerCase()) || customTags.some(ct => ct.id === t && ct.category === 'bodyPart'));
      const selEquips = selectedTags.filter(t => EQUIPMENT_TAGS.some(et => et.toLowerCase() === t.toLowerCase()) || customTags.some(ct => ct.id === t && ct.category === 'equipment'));

      // ✅ 修复Bug #3: 安全的部位匹配 - 处理bodyPart可能为空的情况
      const matchPart = selParts.length === 0 || selParts.some(sp => {
        const bodyPart = ex.bodyPart || '';
        return sp.toLowerCase() === bodyPart.toLowerCase();
      });
      
      // ✅ 修复Bug #3: 安全的器材匹配 - 关键修复点，防止tags为undefined时崩溃
      const matchEquip = selEquips.length === 0 || 
        (ex.tags && Array.isArray(ex.tags) && ex.tags.some(t => 
          selEquips.some(se => se.toLowerCase() === (t || '').toLowerCase())
        ));

      return matchSearch && matchPart && matchEquip;
    });
  }, [searchQuery, selectedTags, lang, customTags, customExercises, exerciseOverrides, activeLibraryCategory]);

  const handleRenameTag = () => {
    if (!tagToRename || !newTagNameInput) return;
    const updatedOverrides = { ...tagRenameOverrides, [tagToRename.id]: newTagNameInput };
    setTagRenameOverrides(updatedOverrides);
    localStorage.setItem('fitlog_tag_rename_overrides', JSON.stringify(updatedOverrides));
    setShowRenameModal(false) ; setTagToRename(null); setNewTagNameInput('');
  };

  // ✅ 新增：从动作库中删除动作（支持系统默认和自定义）
  const handleDeleteLibraryExercise = async (e: React.MouseEvent, exId: string) => {
    e.stopPropagation(); // 防止触发点击添加动作
    
    const confirmText = lang === Language.CN ? '确定要从动作库中删除此动作吗？' : 'Delete this exercise from library?';
    if (!window.confirm(confirmText)) return;

    // 1. 如果是自定义动作，从自定义列表中删除
    setCustomExercises(prev => {
      const next = prev.filter(ex => ex.id !== exId);
      localStorage.setItem('fitlog_custom_exercises', JSON.stringify(next));
      return next;
    });

    // 2. 如果是系统动作（或为了保险起见），在覆盖设置中标记为隐藏
    setExerciseOverrides(prev => {
      const current = prev[exId] || {};
      const next = { ...current, hidden: true };
      const updated = { ...prev, [exId]: next };
      localStorage.setItem('fitlog_exercise_overrides', JSON.stringify(updated));
      return updated;
    });

    scheduleDebouncedFitlogPush();
  };

  const handleRenameExercise = async () => {
    if (!exerciseToRename || !newExerciseNameInput) return;

    // 1. 更新本地覆盖状态
    setExerciseOverrides(prev => {
      const current = prev[exerciseToRename.id] || {};
      const next = { 
        ...current, 
        name: { ...((current.name as any) || {}), [lang]: newExerciseNameInput } 
      };
      const updated = { ...prev, [exerciseToRename.id]: next };
      localStorage.setItem('fitlog_exercise_overrides', JSON.stringify(updated));
      return updated;
    });

    scheduleDebouncedFitlogPush();

    setShowRenameExerciseModal(false); 
    setExerciseToRename(null); 
    setNewExerciseNameInput('');
  };
  const handleDeleteTag = (tid: string) => {
    const updatedCustom = customTags.filter(ct => ct.id !== tid);
    setCustomTags(updatedCustom); localStorage.setItem('fitlog_custom_tags', JSON.stringify(updatedCustom));
    const updatedOverrides = { ...tagRenameOverrides }; delete updatedOverrides[tid];
    setTagRenameOverrides(updatedOverrides); localStorage.setItem('fitlog_tag_rename_overrides', JSON.stringify(updatedOverrides));
  };

  const handleDropOnExercise = (e: React.DragEvent, exId: string) => {
    e.preventDefault();
    const tagId = draggedTagId; 
    if (!tagId || draggedFromExId) {
      resetDragState(); // ✅ 修复Bug #4: 确保异常情况下也重置状态
      return;
    }
    
    const isBodyPart = BODY_PARTS.includes(tagId) || customTags.some(ct => ct.id === tagId && ct.category === 'bodyPart');
    setExerciseOverrides(prev => {
        const current = prev[exId] || {}; const baseEx = [...DEFAULT_EXERCISES, ...customExercises].find(e => e.id === exId);
        if (!baseEx) {
          resetDragState(); // ✅ 修复Bug #4: 找不到动作时重置状态
          return prev;
        }
        let next: Partial<ExerciseDefinition>;
        if (isBodyPart) next = { ...current, bodyPart: tagId };
        else { const existingTags = current.tags || baseEx.tags; if (existingTags.includes(tagId)) { resetDragState(); return prev; } next = { ...current, tags: [...existingTags, tagId] }; }
        const updated = { ...prev, [exId]: next }; localStorage.setItem('fitlog_exercise_overrides', JSON.stringify(updated));
        return updated;
    });
    resetDragState(); // ✅ 修复Bug #4: 成功完成拖拽后重置状态
  };

// ✅ 核心逻辑：从具体动作中移除标签
  const handleRemoveTagFromExercise = (exId: string, tagId: string) => {
    if (!exId || !tagId) return;

    setExerciseOverrides(prev => {
        const current = prev[exId] || {}; 
        const baseEx = [...DEFAULT_EXERCISES, ...customExercises].find(e => e.id === exId);
        if (!baseEx) return prev;

        // 获取当前的标签和部位（优先取覆盖值，没有则取原始值）
        const currentBodyPart = current.bodyPart !== undefined ? current.bodyPart : baseEx.bodyPart;
        const currentTags = current.tags || baseEx.tags;

        let next: Partial<ExerciseDefinition> = { ...current };

        // 1. 如果拖动的是当前动作绑定的"部位"，则将其清空（设为空字符串）
        if (currentBodyPart === tagId) {
          next.bodyPart = '';
        } 
        // 2. 如果拖动的是"标签列表"中的一项，则过滤掉它
        else {
          next.tags = currentTags.filter(t => t !== tagId);
        }

        const updated = { ...prev, [exId]: next }; 
        localStorage.setItem('fitlog_exercise_overrides', JSON.stringify(updated));
        return updated;
    });

    // ✅ 修复Bug #4: 使用统一的重置函数，确保状态一致性
    resetDragState();
  };

  const handleToggleLanguage = () => {
    const nextLang = lang === Language.CN ? Language.EN : Language.CN;
    if (selectedPRProject && selectedPRProject !== '__WEIGHT__') {
      const allDef = [...DEFAULT_EXERCISES, ...customExercises];
      const def = allDef.find(d => {
        const over = exerciseOverrides[d.id];
        const nameInCurrentLang = over?.name?.[lang] || d.name[lang];
        return nameInCurrentLang === selectedPRProject;
      });
      if (def) {
        const nameInNextLang = exerciseOverrides[def.id]?.name?.[nextLang] || def.name[nextLang];
        lastSelectionRef.current = nameInNextLang;
        setSelectedPRProject(nameInNextLang);
      }
    }
    setLang(nextLang);
    localStorage.setItem('fitlog_lang', nextLang);
    // showSettings has been removed
  };

  // ✅ 新增：处理单位系统切换及数值实时转换
  const handleUnitToggle = () => {
    const newUnit = unit === 'kg' ? 'lbs' : 'kg';
    
    // ✅ 修复双重转换Bug: 不修改currentWorkout中的存储数据，让formatWeight函数处理显示转换
    // 存储的数据应该保持原始单位（通常是KG），只在显示时进行转换
    
    // 更新单位状态并持久化
    setUnit(newUnit);
    localStorage.setItem('fitlog_unit', newUnit);
  };


  // ✅ 重构：使用 SetCapsule 组件替代内联代码
  const renderSetCapsule = (s: any, exerciseName: string, _exercise?: Exercise) => {
    const metrics = getActiveMetrics(exerciseName);
    return (
      <SetCapsule
        set={s}
        setIdx={0}
        activeMetrics={metrics}
        unit={unit}
        lang={lang}
        readOnly
        onUpdate={() => {}}
        onRemove={() => {}}
      />
    );
  };


  return (
    <div className="min-h-screen bg-base text-primary font-sans selection:bg-accent/20">
      
      {showWeightInput && (
        <div className="fixed inset-0 z-[70] bg-base/80 backdrop-blur-md flex items-center justify-center p-6 animate-in fade-in">
           <div className="bg-inset border border-divider w-full max-sm rounded-card p-8 space-y-6 shadow-2xl">
              <div className="flex justify-between items-center">
                <h2 className="text-2xl font-semibold">{editingWeightId ? (lang === Language.CN ? '编辑体重记录' : 'Edit Weight Entry') : translations.logWeight[lang]}</h2>
                <button onClick={() => { setShowWeightInput(false); setEditingWeightId(null); setWeightInputValue(''); }}><X size={20}/></button>
              </div>
              <div className="space-y-4">
                 <div className="relative group">
                    <Scale className="absolute left-6 top-1/2 -translate-y-1/2 text-secondary group-focus-within:text-accent" size={24} />
                    <input type="number" step="0.1" className="w-full bg-card border border-divider rounded-2xl py-6 pl-16 pr-20 text-2xl font-semibold outline-none focus:ring-2 focus:ring-blue-500" value={weightInputValue} onChange={e => setWeightInputValue(e.target.value)} placeholder="0.0" autoFocus />
                    <span className="absolute right-6 top-1/2 -translate-y-1/2 text-secondary font-semibold text-xl uppercase">{unit}</span>
                 </div>
              </div>
              <button onClick={handleLogWeight} className="w-full bg-accent py-5 rounded-2xl font-semibold text-lg shadow-xl shadow-blue-600/20 active:scale-95 transition-all">{translations.confirm[lang]}</button>
           </div>
        </div>
      )}
      {/* 新增：自定义指标录入弹窗 */}
      {showMeasureModal && (
        <div className="fixed inset-0 z-[70] bg-base/80 backdrop-blur-md flex items-center justify-center p-6 animate-in fade-in">
           <div className="bg-inset border border-divider w-full max-sm rounded-card p-8 space-y-6 shadow-2xl">
              <div className="flex justify-between items-center">
                <h2 className="text-2xl font-semibold">
                  {editingMeasurementId 
                    ? (lang === Language.CN ? '修改记录' : 'Edit Entry') 
                    : (lang === Language.CN ? '记录身体指标' : 'Track Metric')}
                </h2>
                <button onClick={() => setShowMeasureModal(false)}><X size={20}/></button>
              </div>
              <div className="space-y-4">
                 {/* 名称输入 */}
                 <div className="space-y-2">
                    <label className="text-xs font-bold text-secondary uppercase tracking-wider">{lang === Language.CN ? '指标名称 (如: 腰围)' : 'Metric Name (e.g. Waist)'}</label>
                    <input className="w-full bg-card border border-divider rounded-2xl py-4 px-6 outline-none focus:ring-2 focus:ring-blue-500" 
                      value={measureForm.name} 
                      onChange={e => setMeasureForm({...measureForm, name: e.target.value})} 
                      placeholder={lang === Language.CN ? '输入名称...' : 'Enter name...'} 
                    />
                 </div>
                 
                 {/* 数值与单位 */}
                 <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                        <label className="text-xs font-bold text-secondary uppercase tracking-wider">{lang === Language.CN ? '数值' : 'Value'}</label>
                        <input type="number" className="w-full bg-card border border-divider rounded-2xl py-4 px-6 outline-none focus:ring-2 focus:ring-blue-500" 
                          value={measureForm.value} 
                          onChange={e => setMeasureForm({...measureForm, value: e.target.value})} 
                          placeholder="0.0" 
                        />
                    </div>
                    <div className="space-y-2">
                        <label className="text-xs font-bold text-secondary uppercase tracking-wider">{lang === Language.CN ? '单位' : 'Unit'}</label>
                        <input className="w-full bg-card border border-divider rounded-2xl py-4 px-6 outline-none focus:ring-2 focus:ring-blue-500" 
                          value={measureForm.unit} 
                          onChange={e => setMeasureForm({...measureForm, unit: e.target.value})} 
                          placeholder="cm" 
                        />
                    </div>
                 </div>
              </div>
              <button onClick={handleSaveMeasurement} className="w-full bg-accent py-5 rounded-2xl font-semibold text-lg shadow-xl shadow-blue-600/20 active:scale-95 transition-all">{translations.confirm[lang]}</button>
           </div>
        </div>
      )}

      {/* ✅ 新增：自定义日期时间选择器弹窗 */}
      {showTimePickerModal && (
        <div className="fixed inset-0 z-[70] bg-base/80 backdrop-blur-md flex items-center justify-center p-6 animate-in fade-in">
           <div className="bg-inset border border-divider w-full max-w-md rounded-card p-8 space-y-6 shadow-2xl">
              <div className="flex justify-between items-center">
                <h2 className="text-2xl font-semibold">
                  {lang === 'cn' ? '设置训练时间' : 'Set Exercise Time'}
                </h2>
                <button onClick={() => setShowTimePickerModal(null)}>
                  <X size={20}/>
                </button>
              </div>
              
              {/* 日期选择器 */}
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-secondary uppercase tracking-wider">
                    {translations.selectDate[lang]}
                  </label>
                  
                  {/* 月份年份导航 */}
                  <div className="flex justify-between items-center mb-4">
                    <button 
                      onClick={() => {
                        if (currentMonth === 0) {
                          setCurrentMonth(11);
                          setCurrentYear(currentYear - 1);
                        } else {
                          setCurrentMonth(currentMonth - 1);
                        }
                      }}
                      className="p-2 hover:bg-card rounded-lg transition-colors"
                    >
                      <ChevronLeft size={20} className="text-secondary" />
                    </button>
                    
                    <div className="text-lg font-bold text-white">
                      {translations.monthNames[lang][currentMonth]} {currentYear}
                    </div>
                    
                    <button 
                      onClick={() => {
                        if (currentMonth === 11) {
                          setCurrentMonth(0);
                          setCurrentYear(currentYear + 1);
                        } else {
                          setCurrentMonth(currentMonth + 1);
                        }
                      }}
                      className="p-2 hover:bg-card rounded-lg transition-colors"
                    >
                      <ChevronRight size={20} className="text-secondary" />
                    </button>
                  </div>
                  
                  {/* 星期标题 */}
                  <div className="grid grid-cols-7 gap-1 mb-2">
                    {(translations.weekdayNames[lang] as string[]).map((day, idx) => (
                      <div key={idx} className="text-center text-xs font-bold text-secondary py-2">
                        {day}
                      </div>
                    ))}
                  </div>
                  
                  {/* 日期网格 */}
                  <div className="grid grid-cols-7 gap-1">
                    {/* 空白填充 */}
                    {Array.from({ length: getFirstDayOfMonth(currentMonth, currentYear) }).map((_, idx) => (
                      <div key={`empty-${idx}`} className="h-10"></div>
                    ))}
                    
                    {/* 日期按钮 */}
                    {Array.from({ length: getDaysInMonth(currentMonth, currentYear) }).map((_, idx) => {
                      const day = idx + 1;
                      const date = new Date(currentYear, currentMonth, day);
                      const isSelected = isSameDay(date, selectedDate);
                      const isTodayDate = isToday(date);
                      
                      return (
                        <button
                          key={day}
                          onClick={() => setSelectedDate(date)}
                          className={`h-10 rounded-lg text-sm font-bold transition-all ${
                            isSelected 
                              ? 'bg-accent text-white shadow-elevated shadow-blue-600/30' 
                              : isTodayDate
                                ? 'bg-inset text-accent border border-blue-500/30'
                                : 'hover:bg-card text-primary'
                          }`}
                        >
                          {day}
                        </button>
                      );
                    })}
                  </div>
                </div>
                
                {/* 快捷日期选项 */}
                <div className="flex gap-2">
                  <button 
                    onClick={() => {
                      const today = new Date();
                      setSelectedDate(today);
                      setCurrentMonth(today.getMonth());
                      setCurrentYear(today.getFullYear());
                    }}
                    className="flex-1 px-4 py-2 bg-card border border-divider rounded-xl text-sm font-bold hover:bg-card-hover transition-colors"
                  >
                    {translations.today[lang]}
                  </button>
                  <button 
                    onClick={() => {
                      const yesterday = new Date();
                      yesterday.setDate(yesterday.getDate() - 1);
                      setSelectedDate(yesterday);
                      setCurrentMonth(yesterday.getMonth());
                      setCurrentYear(yesterday.getFullYear());
                    }}
                    className="flex-1 px-4 py-2 bg-card border border-divider rounded-xl text-sm font-bold hover:bg-card-hover transition-colors"
                  >
                    {translations.yesterday[lang]}
                  </button>
                </div>
                
                {/* 时间选择器 */}
                <div className="space-y-2">
                  <label className="text-xs font-bold text-secondary uppercase tracking-wider">
                    {translations.selectTime[lang]}
                  </label>
                  
                  <div className="flex gap-4 items-center justify-center">
                    {/* 小时选择 */}
                    <div className="flex flex-col items-center space-y-2">
                      <button 
                        onClick={() => setSelectedHour((selectedHour + 1) % 24)}
                        className="p-2 hover:bg-card rounded-lg transition-colors"
                      >
                        <ChevronUp size={20} className="text-secondary" />
                      </button>
                      
                      <div className="bg-card border border-divider rounded-xl px-4 py-3 min-w-[60px] text-center">
                        <div className="text-2xl font-bold text-white">
                          {selectedHour.toString().padStart(2, '0')}
                        </div>
                        <div className="text-xs text-secondary font-bold">
                          {translations.hour[lang]}
                        </div>
                      </div>
                      
                      <button 
                        onClick={() => setSelectedHour(selectedHour === 0 ? 23 : selectedHour - 1)}
                        className="p-2 hover:bg-card rounded-lg transition-colors"
                      >
                        <ChevronDown size={20} className="text-secondary" />
                      </button>
                    </div>
                    
                    <div className="text-2xl font-bold text-secondary">:</div>
                    
                    {/* 分钟选择 */}
                    <div className="flex flex-col items-center space-y-2">
                      <button 
                        onClick={() => setSelectedMinute((selectedMinute + 5) % 60)}
                        className="p-2 hover:bg-card rounded-lg transition-colors"
                      >
                        <ChevronUp size={20} className="text-secondary" />
                      </button>
                      
                      <div className="bg-card border border-divider rounded-xl px-4 py-3 min-w-[60px] text-center">
                        <div className="text-2xl font-bold text-white">
                          {selectedMinute.toString().padStart(2, '0')}
                        </div>
                        <div className="text-xs text-secondary font-bold">
                          {translations.minute[lang]}
                        </div>
                      </div>
                      
                      <button 
                        onClick={() => setSelectedMinute(selectedMinute === 0 ? 55 : selectedMinute - 5)}
                        className="p-2 hover:bg-card rounded-lg transition-colors"
                      >
                        <ChevronDown size={20} className="text-secondary" />
                      </button>
                    </div>
                  </div>
                  
                  {/* 时间快捷选项 */}
                  <div className="grid grid-cols-3 gap-2 mt-4">
                    <button 
                      onClick={() => {
                        const now = new Date();
                        setSelectedHour(now.getHours());
                        setSelectedMinute(now.getMinutes());
                      }}
                      className="px-3 py-2 bg-card border border-divider rounded-lg text-xs font-bold hover:bg-card-hover transition-colors"
                    >
                      {lang === 'cn' ? '现在' : 'Now'}
                    </button>
                    <button 
                      onClick={() => {
                        setSelectedHour(8);
                        setSelectedMinute(0);
                      }}
                      className="px-3 py-2 bg-card border border-divider rounded-lg text-xs font-bold hover:bg-card-hover transition-colors"
                    >
                      {lang === 'cn' ? '早上8点' : '8:00 AM'}
                    </button>
                    <button 
                      onClick={() => {
                        setSelectedHour(18);
                        setSelectedMinute(0);
                      }}
                      className="px-3 py-2 bg-card border border-divider rounded-lg text-xs font-bold hover:bg-card-hover transition-colors"
                    >
                      {lang === 'cn' ? '晚上6点' : '6:00 PM'}
                    </button>
                  </div>
                </div>
                
                {/* 当前选择预览 */}
                <div className="bg-card/50 border border-divider rounded-xl p-4">
                  <div className="text-xs font-bold text-secondary mb-1">
                    {lang === 'cn' ? '选择的时间' : 'Selected Time'}
                  </div>
                  <div className="text-lg font-bold text-white">
                    {selectedDate.getFullYear()}/{(selectedDate.getMonth() + 1).toString().padStart(2, '0')}/{selectedDate.getDate().toString().padStart(2, '0')} {selectedHour.toString().padStart(2, '0')}:{selectedMinute.toString().padStart(2, '0')}
                  </div>
                </div>
              </div>
              
              <div className="flex gap-4">
                <button 
                  onClick={() => setShowTimePickerModal(null)} 
                  className="flex-1 bg-card py-4 rounded-2xl font-semibold text-secondary"
                >
                  {lang === 'cn' ? '取消' : 'Cancel'}
                </button>
                <button 
                  onClick={() => {
                    // 构建完整的日期时间
                    const finalDateTime = new Date(selectedDate);
                    finalDateTime.setHours(selectedHour, selectedMinute, 0, 0);
                    const timeISO = finalDateTime.toISOString();
                    
                    if (showTimePickerModal.exerciseId) {
                      // 编辑现有动作的时间
                      const exerciseId = showTimePickerModal.exerciseId;
                      
                      // 如果是当前训练中的动作
                      if (currentWorkout.exercises) {
                        const exerciseIndex = currentWorkout.exercises.findIndex(ex => ex.id === exerciseId);
                        if (exerciseIndex !== -1) {
                          const updatedExercises = [...currentWorkout.exercises];
                          updatedExercises[exerciseIndex] = {
                            ...updatedExercises[exerciseIndex],
                            exerciseTime: timeISO
                          };
                          setCurrentWorkout({
                            ...currentWorkout,
                            exercises: updatedExercises
                          });
                        }
                      }
                    }
                    
                    setShowTimePickerModal(null);
                  }} 
                  className="flex-1 bg-accent py-4 rounded-2xl font-semibold"
                >
                  {lang === 'cn' ? '确定' : 'Confirm'}
                </button>
              </div>
           </div>
        </div>
      )}

      {showAddTagModal && (
        <div className="fixed inset-0 z-[70] bg-base/80 backdrop-blur-md flex items-center justify-center p-6 animate-in fade-in">
           <div className="bg-inset border border-divider w-full max-sm rounded-card p-8 space-y-6 shadow-2xl">
              {/* ... content ... */}
               <div className="flex justify-between items-center mb-2">
                <h2 className="text-xl font-semibold">{translations.addCustomTag[lang]}</h2>
                <button onClick={() => setShowAddTagModal(false)}><X size={20}/></button>
              </div>
              <div className="flex gap-2 p-1 bg-card rounded-xl mb-4">
                {['bodyPart', 'equipment'].map(cat => (
                  <button key={cat} onClick={() => setNewTagCategory(cat as 'bodyPart' | 'equipment')} className={`flex-1 py-2 rounded-lg text-[10px] font-semibold uppercase transition-all ${newTagCategory === cat ? 'bg-accent text-white shadow-md' : 'text-secondary'}`}>{cat === 'bodyPart' ? translations.bodyPartHeader[lang] : translations.equipmentHeader[lang]}</button>
                ))}
              </div>
              <input className="w-full bg-card border border-divider rounded-2xl py-4 px-6 outline-none focus:ring-2 focus:ring-blue-500" value={newTagName} onChange={e => setNewTagName(e.target.value)} placeholder={translations.tagNamePlaceholder[lang]} />
              <button 
              onClick={async () => { 
                if (!newTagName) return; 

                // ✅ 构造支持多分类的标签对象
                const currentCat = activeLibraryCategory || 'STRENGTH';
                const newTagId = `ct_${Date.now()}`;
                const t = { 
                  id: newTagId, 
                  name: newTagName, 
                  category: newTagCategory, 
                  parentCategory: currentCat // 记录初始归属
                }; 
                
                // 立即写入本地存储
                const localTags = JSON.parse(localStorage.getItem('fitlog_custom_tags') || '[]');
                const updatedTags = [...localTags, t];
                localStorage.setItem('fitlog_custom_tags', JSON.stringify(updatedTags));
                markPrefsUpdated();

                setCustomTags(updatedTags); 
                setShowAddTagModal(false); 
                setNewTagName(''); 

                scheduleDebouncedFitlogPush();

              }} 
              className="..."
            >
              {translations.confirm[lang]}
            </button>
           </div>
        </div>
      )}

      {showRenameModal && (
         <div className="fixed inset-0 z-[75] bg-base/90 backdrop-blur-md flex items-center justify-center p-6 animate-in fade-in">
           <div className="bg-inset border border-divider w-full max-sm rounded-card p-8 space-y-6 shadow-2xl">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-semibold">{lang === Language.CN ? '重命名标签' : 'Rename Tag'}</h2>
                <button onClick={() => setShowRenameModal(false)} className="p-2 hover:bg-card rounded-full transition-colors">
                  <X size={20} className="text-secondary" />
                </button>
              </div>
              <h2 className="text-xl font-semibold">{translations.editTags[lang]}</h2>
              <input className="w-full bg-card border border-divider rounded-2xl py-4 px-6 outline-none focus:ring-2 focus:ring-blue-500" value={newTagNameInput} onChange={e => setNewTagNameInput(e.target.value)} placeholder={tagToRename?.name} />
              <div className="flex gap-4">
                <button onClick={() => setShowRenameModal(false)} className="flex-1 bg-card py-4 rounded-2xl font-semibold text-secondary">{lang === Language.CN ? '取消' : 'Cancel'}</button>
                <button onClick={handleRenameTag} className="flex-1 bg-accent py-4 rounded-2xl font-semibold">{translations.confirm[lang]}</button>
              </div>
           </div>
        </div>
      )}

       {showRenameExerciseModal && (
        <div className="fixed inset-0 z-[75] bg-base/90 backdrop-blur-md flex items-center justify-center p-6 animate-in fade-in">
           <div className="bg-inset border border-divider w-full max-sm rounded-card p-8 space-y-6 shadow-2xl">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-semibold">{lang === Language.CN ? '重命名动作' : 'Rename Exercise'}</h2>
                <button onClick={() => setShowRenameExerciseModal(false)} className="p-2 hover:bg-card rounded-full transition-colors">
                  <X size={20} className="text-secondary" />
                </button>
              </div>
              <input className="w-full bg-card border border-divider rounded-2xl py-4 px-6 outline-none focus:ring-2 focus:ring-blue-500" value={newExerciseNameInput} onChange={e => setNewExerciseNameInput(e.target.value)} placeholder={exerciseToRename?.name} />
              <div className="flex gap-4">
                <button onClick={() => setShowRenameExerciseModal(false)} className="flex-1 bg-card py-4 rounded-2xl font-semibold text-secondary">{lang === Language.CN ? '取消' : 'Cancel'}</button>
                <button onClick={handleRenameExercise} className="flex-1 bg-accent py-4 rounded-2xl font-semibold">{translations.confirm[lang]}</button>
              </div>
           </div>
        </div>
      )}

      {showAddExerciseModal && (
         <div className="fixed inset-0 z-[70] bg-base/80 backdrop-blur-md flex items-center justify-center p-6 animate-in fade-in">
           <div className="bg-inset border border-divider w-full max-md rounded-card p-8 space-y-6 shadow-2xl overflow-y-auto max-h-[90vh] custom-scrollbar">
              {/* 优化后的标题区域 */}
              <div className="flex justify-between items-center mb-4">
                <div className="flex items-center gap-3">
                  <div className="p-3 bg-accent-soft rounded-xl">
                    <Zap size={24} className="text-accent" />
                  </div>
                  <div>
                    <h2 className="text-xl font-semibold">{translations.addCustomExercise[lang]}</h2>
                    <p className="text-xs text-secondary font-bold">
                      {lang === Language.CN ? '创建专属动作' : 'Create Custom Exercise'}
                    </p>
                  </div>
                </div>
                <button 
                  onClick={() => setShowAddExerciseModal(false)} 
                  className="p-2 hover:bg-card rounded-full transition-colors"
                >
                  <X size={20} className="text-secondary" />
                </button>
              </div>
              {/* ✅ 找回丢失的动作名称输入框 */}
              <div className="space-y-2 mt-4">
                 <label className="text-[10px] font-semibold text-secondary  px-1">
                    {lang === Language.CN ? '动作名称' : 'Exercise Name'}
                 </label>
                 <input 
                   className="w-full bg-card border border-divider rounded-2xl py-4 px-6 text-white outline-none focus:ring-2 focus:ring-blue-500 transition-all" 
                   value={newExerciseName} 
                   onChange={e => setNewExerciseName(e.target.value)} 
                   placeholder={translations.exerciseNamePlaceholder[lang]} 
                   autoFocus
                 />
              </div>
              
              {/* --- 1. 训练部位区域 --- */}
              <div className="flex flex-wrap gap-2">
                  {[
                    // ✅ 核心修改：移除分类判断，让系统默认部位（胸肩背等）在所有分类下都可选
                    ...BODY_PARTS, 
                    // ✅ 核心修改：移除 parentCategory 过滤，显示所有已创建的自定义部位标签
                    ...customTags.filter(ct => ct.category === 'bodyPart').map(t => t.id)
                  ].map(id => (
                    <button 
                      key={id} 
                      onClick={() => setNewExerciseBodyPart(newExerciseBodyPart === id ? '' : id)} 
                      className={`px-4 py-2 rounded-xl text-[10px] font-semibold uppercase transition-all ${newExerciseBodyPart === id ? 'bg-accent text-white shadow-elevated' : 'bg-card text-secondary hover:bg-card-hover'}`}
                    >
                      {getTagName(id)}
                    </button>
                  ))}
                </div>

              {/* --- 2. 使用器材区域 --- */}
              <div className="flex flex-wrap gap-2">
                  {[
                    // ✅ 核心修改：让系统默认器材（杠铃、哑铃等）在所有分类下都可选
                    ...EQUIPMENT_TAGS, 
                    // ✅ 核心修改：移除 parentCategory 过滤，显示所有已创建的自定义器材标签（如"篮球"）
                    ...customTags.filter(ct => ct.category === 'equipment').map(t => t.id)
                  ].map(id => (
                    <button 
                      key={id} 
                      onClick={() => setNewExerciseTags(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id])} 
                      className={`px-4 py-2 rounded-xl text-[10px] font-semibold uppercase transition-all ${newExerciseTags.includes(id) ? 'bg-accent text-white shadow-elevated' : 'bg-card text-secondary hover:bg-card-hover'}`}
                    >
                      {getTagName(id)}
                    </button>
                  ))}
                </div>
              {/* ✅ 第四步：修改此处的"确定"按钮逻辑 */}
              <button 
                onClick={async () => { 
                  if (!newExerciseName) return; 
                  
                  const currentCat = activeLibraryCategory || 'STRENGTH';

                  // 1. 自动"学习"逻辑：如果选中的标签不属于当前分类，将其变为通用标签
                  const selectedTagIds = [...newExerciseTags, newExerciseBodyPart].filter(Boolean);
                  const updatedTags = customTags.map(tag => {
                    // 如果这个标签被选中了，且它原本只属于另一个分类
                    if (selectedTagIds.includes(tag.id) && tag.parentCategory && tag.parentCategory !== currentCat) {
                       // 将其 parentCategory 设为 null，意味着它现在是全部分类通用的"高级标签"
                       return { ...tag, parentCategory: undefined }; 
                    }
                    return tag;
                  });

                  // 2. 立即更新本地标签库
                  setCustomTags(updatedTags);
                  localStorage.setItem('fitlog_custom_tags', JSON.stringify(updatedTags));

                  // 3. 构造新动作对象
                  const ex: ExerciseDefinition = { 
                    id: Date.now().toString(), 
                    name: { en: newExerciseName, cn: newExerciseName }, 
                    bodyPart: newExerciseBodyPart, 
                    tags: newExerciseTags,
                    category: currentCat
                  }; 

                  // 4. 更新动作库状态 (新动作置顶)
                  const updatedExs = [ex, ...customExercises];
                  setCustomExercises(updatedExs); 
                  localStorage.setItem('fitlog_custom_exercises', JSON.stringify(updatedExs)); 

                  // 5. 自动将新动作加入当前训练课的最顶端
                  const exerciseTime = new Date().toISOString();
                  
                  setCurrentWorkout(p => ({
                    ...p,
                    exercises: [
                      { 
                        id: `exercise_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`, // 确保唯一ID
                        name: ex.name[lang], 
                        category: ex.category, 
                        sets: [{ id: Date.now().toString(), weight: 0, reps: 0 }],
                        exerciseTime: exerciseTime, // ✅ 新增：设置动作的训练时间
                        // ✅ 新增：默认实例配置，基于动作定义的建议
                        instanceConfig: {
                          enablePyramid: ex.exerciseConfig?.supportsPyramid || false,
                          pyramidMode: 'decreasing',
                          bodyweightMode: ex.exerciseConfig?.bodyweightType || 'none',
                          autoCalculateSubSets: false
                        }
                      },
                      ...(p.exercises || [])
                    ]
                  }));

                  // 6. 关闭弹窗并重置
                  setShowAddExerciseModal(false); 
                  setNewExerciseName('');
                  setNewExerciseTags([]);

                  scheduleDebouncedFitlogPush();
                }}
                className="w-full bg-accent py-5 rounded-3xl font-semibold text-lg shadow-xl shadow-blue-600/20 active:scale-95 transition-all mt-4"
              >
                {translations.confirm[lang]}
              </button>
           </div>
        </div>
      )}

      {showLibrary && (
         <div className="fixed inset-0 z-[100] bg-base/95 backdrop-blur-xl p-6 flex flex-col animate-in fade-in">
          <div className="flex justify-between items-center mb-6">
            
          {/* ✅ 优化后的动态标题 - 显示搜索范围 */}
          <div className="flex flex-col">
            <h2 className="text-2xl font-semibold tracking-tight flex items-center gap-3">
              {/* 根据分类显示对应的图标 */}
              {activeLibraryCategory === 'STRENGTH' && <Dumbbell className="text-accent" size={28} />}
              {activeLibraryCategory === 'CARDIO' && <Activity className="text-orange-500" size={28} />}
              {activeLibraryCategory === 'FREE' && <Zap className="text-accent" size={28} />}
              {!activeLibraryCategory && <Globe className="text-success" size={28} />}

              {/* 根据分类显示对应的文字 */}
              {activeLibraryCategory === 'STRENGTH' && translations.strengthTraining[lang]}
              {activeLibraryCategory === 'CARDIO' && translations.cardioTraining[lang]}
              {activeLibraryCategory === 'FREE' && translations.freeTraining[lang]}
              {!activeLibraryCategory && (lang === Language.CN ? '全部动作' : 'All Exercises')}
              
              {lang === Language.CN ? '动作库' : ' Library'}
            </h2>
            <p className="text-xs text-secondary font-bold mt-1">
              {activeLibraryCategory 
                ? (lang === Language.CN ? `在${activeLibraryCategory === 'STRENGTH' ? '力量训练' : activeLibraryCategory === 'CARDIO' ? '有氧训练' : '自由训练'}中搜索` : `Search in ${activeLibraryCategory === 'STRENGTH' ? 'Strength' : activeLibraryCategory === 'CARDIO' ? 'Cardio' : 'Free'} Training`)
                : (lang === Language.CN ? '搜索全部动作' : 'Search all exercises')
              }
            </p>
          </div>
          
          <div className="flex items-center gap-3">
            {/* 切换搜索范围按钮 - 优化后的切换逻辑 */}
            <button 
              onClick={() => {
                if (activeLibraryCategory === null) {
                  // 当前是全部分类，切换回之前的分类
                  if (previousLibraryCategory) {
                    setActiveLibraryCategory(previousLibraryCategory);
                  }
                } else {
                  // 当前是特定分类，记录当前分类并切换到全部分类
                  setPreviousLibraryCategory(activeLibraryCategory);
                  setActiveLibraryCategory(null);
                }
                setSearchQuery('');
                setSelectedTags([]);
              }}
              className="px-3 py-2 bg-card/50 border border-divider rounded-xl text-xs font-bold text-secondary hover:text-primary hover:bg-card-hover transition-all"
            >
              {activeLibraryCategory === null 
                ? (previousLibraryCategory 
                    ? (lang === Language.CN 
                        ? `回到${previousLibraryCategory === 'STRENGTH' ? '力量训练' : previousLibraryCategory === 'CARDIO' ? '有氧训练' : '自由训练'}` 
                        : `Back to ${previousLibraryCategory === 'STRENGTH' ? 'Strength' : previousLibraryCategory === 'CARDIO' ? 'Cardio' : 'Free'}`)
                    : (lang === Language.CN ? '全部分类' : 'All Categories'))
                : (lang === Language.CN ? '全部分类' : 'All Categories')
              }
            </button>
            
            {/* 管理模式按钮 */}
            <button 
              onClick={() => setIsEditingTags(!isEditingTags)}
              className={`px-3 py-2 border rounded-xl text-xs font-bold transition-all ${
                isEditingTags 
                  ? 'bg-amber-500/20 border-amber-500/50 text-amber-400' 
                  : 'bg-card/50 border-divider text-secondary hover:text-primary hover:bg-card-hover'
              }`}
            >
              {isEditingTags ? (lang === Language.CN ? '完成管理' : 'Done') : (lang === Language.CN ? '管理' : 'Manage')}
            </button>
            
            <button
              onClick={() => {
                libraryPickCallbackRef.current = null;
                setShowLibrary(false);
              }}
              className="p-3 bg-card/50 hover:bg-card rounded-full transition-all border border-divider"
            ><X size={24} /></button>
          </div>
          </div>
          
          {/* 优化后的搜索框 */}
          <div className="relative mb-6">
            <Search className="absolute left-5 top-1/2 -translate-y-1/2 text-secondary" size={18} />
            <input 
              className="w-full bg-inset border border-divider rounded-card py-4 pl-12 pr-8 text-base font-medium outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500/50 transition-all" 
              value={searchQuery} 
              onChange={e => setSearchQuery(e.target.value)} 
              placeholder={
                activeLibraryCategory 
                  ? (lang === Language.CN ? `在${activeLibraryCategory === 'STRENGTH' ? '力量训练' : activeLibraryCategory === 'CARDIO' ? '有氧训练' : '自由训练'}中搜索...` : `Search in ${activeLibraryCategory}...`)
                  : translations.searchPlaceholder[lang]
              }
            />
            {/* 搜索结果计数 */}
            {searchQuery && (
              <div className="absolute right-4 top-1/2 -translate-y-1/2 px-2 py-1 bg-accent/20 text-accent text-xs font-bold rounded-lg">
                {filteredExercises.length} {lang === Language.CN ? '个结果' : 'results'}
              </div>
            )}
          </div>
          
          <div className="flex flex-1 overflow-hidden gap-6">

            {/* ✅ 优化后的侧边栏 - 更清晰的视觉层次 */}
            <div 
              onDragOver={(e) => { 
                e.preventDefault(); 
                setIsDraggingOverSidebar(true); 
              }} 
              onDragLeave={() => setIsDraggingOverSidebar(false)} 
              onDrop={(e) => { 
                e.preventDefault();
                setIsDraggingOverSidebar(false);
                if (draggedFromExId && draggedTagId) {
                  handleRemoveTagFromExercise(draggedFromExId, draggedTagId);
                }
                resetDragState(); 
              }} 
              className={`w-1/4 overflow-y-auto space-y-6 pr-4 border-r border-divider/50 custom-scrollbar transition-all ${
                isDraggingOverSidebar ? 'bg-red-500/10 border-r-red-500/50 shadow-[inset_-10px_0_20px_-10px_rgba(239,68,68,0.2)]' : ''
              }`}
            >
              
              {/* 全部标签按钮 */}
              <button 
                onClick={() => setSelectedTags([])} 
                className={`w-full text-left px-4 py-3 rounded-xl text-xs font-semibold  transition-all ${
                  selectedTags.length === 0 ? 'bg-accent text-white shadow-elevated shadow-blue-600/20' : 'text-secondary hover:bg-card'
                }`}
              >
                {translations.allTags[lang]}
              </button>
              
              {/* 训练部位区域 */}
              <div className="space-y-3">
                <div className="flex justify-between items-center px-2">
                  <h3 className="text-[10px] font-semibold text-secondary uppercase tracking-[0.2em] flex items-center gap-2">
                    <Activity size={12} /> {translations.bodyPartHeader[lang]}
                  </h3>
                  {isEditingTags && (
                    <div className="text-[8px] font-bold text-amber-400 bg-amber-400/10 px-2 py-1 rounded-lg">
                      {lang === Language.CN ? '管理模式' : 'EDIT MODE'}
                    </div>
                  )}
                </div>
                <div className="space-y-1.5">
                  {BODY_PARTS.filter(id => {
                    // "全部分类"模式：展示所有系统部位（避免侧栏全空）
                    if (activeLibraryCategory === null) return true;
                    if (activeLibraryCategory === 'STRENGTH') return true;
                    const allExercisesInCategory = [...DEFAULT_EXERCISES, ...customExercises]
                      .filter(ex => (ex.category || 'STRENGTH') === activeLibraryCategory);
                    return allExercisesInCategory.some(ex => ex.bodyPart === id);
                  }).map(id => (
                    <div key={id} className="relative group">
                      <button 
                        draggable 
                        onDragStart={() => { setDraggedTagId(id); setDraggedFromExId(null); }} 
                        onClick={() => { 
                          if (isEditingTags) { 
                            setTagToRename({ id, name: getTagName(id) }); 
                            setNewTagNameInput(getTagName(id)); 
                            setShowRenameModal(true); 
                          } else { 
                            setSelectedTags(p => { 
                              const withoutBodyParts = p.filter(tag => !BODY_PARTS.includes(tag) && !customTags.some(ct => ct.id === tag && ct.category === 'bodyPart')); 
                              return p.includes(id) ? withoutBodyParts : [...withoutBodyParts, id]; 
                            }); 
                          } 
                        }} 
                        className={`w-full text-left px-4 py-3 rounded-xl text-xs font-bold transition-all flex items-center justify-between ${
                          selectedTags.includes(id) ? 'bg-accent text-white' : 'text-secondary hover:bg-card'
                        } ${isEditingTags ? 'hover:bg-amber-500/20' : ''}`}
                      >
                        <span>{getTagName(id)}</span>
                        {isEditingTags && <Edit2 size={12} className="text-amber-400" />}
                      </button>
                    </div>
                  ))}
                  
                  {/* 自定义部位标签：全部分类模式下展示全部，否则按 parentCategory 过滤 */}
                  {customTags
                    .filter(ct =>
                      ct.category === 'bodyPart' && (
                        activeLibraryCategory === null
                          || ct.parentCategory === activeLibraryCategory
                          || !ct.parentCategory
                      )
                    )
                    .map(ct => (
                      <div key={ct.id} className="relative group">
                        <button 
                          draggable 
                          onDragStart={() => { setDraggedTagId(ct.id); setDraggedFromExId(null); }} 
                          onClick={() => { 
                            if (isEditingTags) { 
                              setTagToRename({ id: ct.id, name: getTagName(ct.id) }); 
                              setNewTagNameInput(getTagName(ct.id)); 
                              setShowRenameModal(true); 
                            } else { 
                              setSelectedTags(p => { 
                                const withoutBodyParts = p.filter(tag => !BODY_PARTS.includes(tag) && !customTags.some(xt => xt.id === tag && xt.category === 'bodyPart')); 
                                return p.includes(ct.id) ? withoutBodyParts : [...withoutBodyParts, ct.id]; 
                              }); 
                            } 
                          }} 
                          className={`w-full text-left px-4 py-3 rounded-xl text-xs font-bold transition-all flex items-center justify-between ${
                            selectedTags.includes(ct.id) ? 'bg-accent text-white' : 'text-secondary hover:bg-card'
                          } ${isEditingTags ? 'hover:bg-amber-500/20' : ''}`}
                        >
                          <span>{getTagName(ct.id)}</span>
                          {isEditingTags && (
                            <div className="flex items-center gap-1">
                              <Edit2 size={12} className="text-amber-400" />
                              <button 
                                onClick={(e) => { e.stopPropagation(); handleDeleteTag(ct.id); }} 
                                className="p-1 text-red-500 hover:bg-red-500/10 rounded-md"
                              >
                                <Trash2 size={10} />
                              </button>
                            </div>
                          )}
                        </button>
                      </div>
                  ))}
                </div>
              </div>
              
              {/* 使用器材区域 */}
              <div className="space-y-3">
                <h3 className="text-[10px] font-semibold text-secondary uppercase tracking-[0.2em] px-2 flex items-center gap-2">
                  <Filter size={12} /> {translations.equipmentHeader[lang]}
                </h3>
                <div className="space-y-1.5">
                  {EQUIPMENT_TAGS.filter(id => {
                    // "全部分类"模式：展示所有器材标签
                    if (activeLibraryCategory === null) return true;
                    if (activeLibraryCategory === 'STRENGTH') {
                      return !['tagOutdoor', 'tagIndoor', 'tagBallGame', 'tagGym'].includes(id);
                    }
                    const allExercisesInCategory = [...DEFAULT_EXERCISES, ...customExercises]
                      .filter(ex => (ex.category || 'STRENGTH') === activeLibraryCategory);
                    return allExercisesInCategory.some(ex => ex.tags.includes(id));
                  }).map(id => (
                    <div key={id} className="relative group">
                      <button 
                        draggable 
                        onDragStart={() => { setDraggedTagId(id); setDraggedFromExId(null); }} 
                        onClick={() => { 
                          if (isEditingTags) { 
                            setTagToRename({ id, name: getTagName(id) }); 
                            setNewTagNameInput(getTagName(id)); 
                            setShowRenameModal(true); 
                          } else { 
                            setSelectedTags(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id]); 
                          } 
                        }} 
                        className={`w-full text-left px-4 py-3 rounded-xl text-xs font-bold transition-all flex items-center justify-between ${
                          selectedTags.includes(id) ? 'bg-accent text-white' : 'text-secondary hover:bg-card'
                        } ${isEditingTags ? 'hover:bg-amber-500/20' : ''}`}
                      >
                        <span>{getTagName(id)}</span>
                        {isEditingTags && <Edit2 size={12} className="text-amber-400" />}
                      </button>
                    </div>
                  ))}
                  
                  {/* 自定义器材标签：全部分类模式下展示全部，否则按 parentCategory 过滤 */}
                  {customTags
                    .filter(ct =>
                      ct.category === 'equipment' && (
                        activeLibraryCategory === null
                          || ct.parentCategory === activeLibraryCategory
                          || !ct.parentCategory
                      )
                    )
                    .map(ct => (
                      <div key={ct.id} className="relative group">
                        <button 
                          draggable 
                          onDragStart={() => { setDraggedTagId(ct.id); setDraggedFromExId(null); }} 
                          onClick={() => { 
                            if (isEditingTags) { 
                              setTagToRename({ id: ct.id, name: getTagName(ct.id) }); 
                              setNewTagNameInput(getTagName(ct.id)); 
                              setShowRenameModal(true); 
                            } else { 
                              setSelectedTags(p => p.includes(ct.id) ? p.filter(x => x !== ct.id) : [...p, ct.id]); 
                            } 
                          }} 
                          className={`w-full text-left px-4 py-3 rounded-xl text-xs font-bold transition-all flex items-center justify-between ${
                            selectedTags.includes(ct.id) ? 'bg-accent text-white' : 'text-secondary hover:bg-card'
                          } ${isEditingTags ? 'hover:bg-amber-500/20' : ''}`}
                        >
                          <span>{getTagName(ct.id)}</span>
                          {isEditingTags && (
                            <div className="flex items-center gap-1">
                              <Edit2 size={12} className="text-amber-400" />
                              <button 
                                onClick={(e) => { e.stopPropagation(); handleDeleteTag(ct.id); }} 
                                className="p-1 text-red-500 hover:bg-red-500/10 rounded-md"
                              >
                                <Trash2 size={10} />
                              </button>
                            </div>
                          )}
                        </button>
                      </div>
                  ))}
                </div>
              </div>
              
              {/* 底部操作区域 */}
              <div className="pt-6 border-t border-divider space-y-3">
                <button 
                  onClick={() => setShowAddTagModal(true)} 
                  className="w-full py-3 rounded-xl text-[10px] font-semibold  text-accent hover:bg-blue-400/10 transition-all border border-blue-400/20 flex items-center justify-center gap-2"
                >
                  <PlusCircle size={14} /> {translations.addCustomTag[lang]}
                </button>
                <button 
                  onClick={() => setShowAddExerciseModal(true)} 
                  className="w-full py-3 rounded-xl text-[10px] font-semibold  text-accent hover:bg-accent-soft transition-all border border-divider flex items-center justify-center gap-2"
                >
                  <Zap size={14} /> {translations.addCustomExercise[lang]}
                </button>
              </div>
            </div>

            {/* ✅ 优化后的动作列表区域 */}
            <div className="w-3/4 overflow-y-auto space-y-4 custom-scrollbar pr-2 pb-20">
              {/* 动作列表标题和计数 */}
              <div className="flex justify-between items-center px-2 pb-2 border-b border-divider/50">
                <h3 className="text-sm font-semibold text-primary flex items-center gap-2">
                  <Hash size={16} className="text-accent" />
                  {lang === Language.CN ? '动作列表' : 'Exercise List'}
                </h3>
                <span className="text-xs font-bold text-secondary bg-card/50 px-3 py-1 rounded-lg">
                  {filteredExercises.length} {lang === Language.CN ? '个动作' : 'exercises'}
                </span>
              </div>
              
              {filteredExercises.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center opacity-20 gap-4">
                  <Search size={64} />
                  <p className="font-semibold text-xl">{translations.noRecords[lang]}</p>
                </div>
              ) : (
                filteredExercises.map(ex => (
                  <div 
                    key={ex.id} 
                    onDragOver={(e) => e.preventDefault()} 
                    onDrop={(e) => handleDropOnExercise(e, ex.id)}
                    className="relative"
                  >
                    <button 
                      onClick={() => { 
                        if (isEditingTags) { 
                          setExerciseToRename({ id: ex.id, name: ex.name[lang] }); 
                          setNewExerciseNameInput(ex.name[lang]); 
                          setShowRenameExerciseModal(true); 
                          return; 
                        } 

                        // 当外部注册了选择回调（例如训练计划编辑器），优先走回调路径
                        if (libraryPickCallbackRef.current) {
                          libraryPickCallbackRef.current(ex);
                          libraryPickCallbackRef.current = null;
                          setShowLibrary(false);
                          return;
                        }
                        
                        const exerciseTime = new Date().toISOString();
                        
                        console.log('Adding exercise:', ex.name[lang]);
                        
                        setCurrentWorkout(p => { 
                          console.log('Previous exercises count:', p.exercises?.length || 0);
                          const newExercise = { 
                            id: `exercise_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                            name: ex.name[lang], 
                            category: ex.category || activeLibraryCategory || 'STRENGTH', 
                            sets: [{ id: Date.now().toString(), weight: 0, reps: 0 }],
                            exerciseTime: exerciseTime,
                            instanceConfig: {
                              enablePyramid: ex.exerciseConfig?.supportsPyramid || false,
                              pyramidMode: 'decreasing',
                              bodyweightMode: ex.exerciseConfig?.bodyweightType || 'none',
                              autoCalculateSubSets: false
                            }
                          };
                          const newExercises = [newExercise, ...(p.exercises || [])];
                          console.log('New exercises count:', newExercises.length);
                          return { ...p, exercises: newExercises };
                        }); 
                        setShowLibrary(false); 
                      }} 
                      data-testid="library-exercise-card"
                      className={`w-full p-5 bg-card border border-divider rounded-card text-left hover:bg-card hover:border-blue-500/50 transition-all group relative overflow-hidden ${
                        isEditingTags ? 'hover:border-amber-500/50' : ''
                      }`}
                    >
                      <div className="absolute right-0 top-0 w-24 h-24 bg-accent/5 rounded-full blur-2xl translate-x-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity"></div>
                      
                      <div className="flex flex-col gap-3 relative z-10">
                        <div className="flex justify-between items-center">
                          <span className={`font-semibold text-lg transition-colors ${
                            isEditingTags ? 'text-amber-400' : 'group-hover:text-accent text-white'
                          }`}>
                            {ex.name[lang]}
                          </span>
                          
                          {/* 操作按钮区域 */}
                          <div className="flex items-center gap-2">
                            {!isEditingTags && (
                              <div className="px-3 py-1 bg-accent/20 text-accent text-xs font-bold rounded-lg opacity-0 group-hover:opacity-100 transition-opacity">
                                {lang === Language.CN ? '添加' : 'Add'}
                              </div>
                            )}
                            
                            {isEditingTags && (
                              <div className="flex gap-2">
                                <div className="p-2 bg-amber-500/20 rounded-lg">
                                  <PencilLine size={16} className="text-amber-500" />
                                </div>
                                <button 
                                  onClick={(e) => handleDeleteLibraryExercise(e, ex.id)}
                                  className="p-2 bg-red-500/20 rounded-lg text-red-500 hover:bg-red-500/40 transition-colors"
                                >
                                  <Trash2 size={16} />
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                        
                        {/* 标签区域 */}
                        <div className="flex flex-wrap gap-2">
                          {ex.bodyPart && getTagName(ex.bodyPart) && (
                            <span 
                              draggable 
                              onDragStart={() => { setDraggedTagId(ex.bodyPart); setDraggedFromExId(ex.id); }} 
                              className="text-[10px] font-semibold uppercase bg-card/80 px-3 py-1.5 rounded-xl text-secondary border border-divider hover:bg-red-500/20 cursor-move transition-colors"
                            >
                              {getTagName(ex.bodyPart)}
                            </span>
                          )}
                          
                          {ex.tags && ex.tags.map(t => {
                            const name = getTagName(t);
                            if (!name) return null;
                            
                            return (
                              <span 
                                draggable 
                                key={t} 
                                onDragStart={() => { setDraggedTagId(t); setDraggedFromExId(ex.id); }} 
                                className="text-[10px] font-semibold uppercase bg-accent/10 px-3 py-1.5 rounded-xl text-accent border border-divider hover:bg-red-500/20 cursor-move transition-colors"
                              >
                                {name}
                              </span>
                            );
                          })}
                        </div>
                      </div>
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {showGoalModal && (
        <div className="fixed inset-0 z-[70] bg-base/80 backdrop-blur-md flex items-center justify-center p-6 animate-in fade-in">
           <div className="bg-inset border border-divider w-full max-sm rounded-card p-8 space-y-6 shadow-2xl">
              <div className="flex justify-between items-center">
                <h2 className="text-2xl font-semibold">{translations.setGoal[lang]}</h2>
                <button onClick={() => setShowGoalModal(false)} className="p-2 hover:bg-card rounded-full transition-colors">
                  <X size={20} className="text-secondary" />
                </button>
              </div>
              <div className="space-y-4">
                 <div className="flex gap-2">{['weight', 'strength', 'frequency'].map(type => <button key={type} onClick={() => setNewGoal({...newGoal, type: type as GoalType})} className={`flex-1 py-3 rounded-2xl text-[10px] font-semibold uppercase transition-all ${newGoal.type === type ? 'bg-accent' : 'bg-card'}`}>{translations[`goal${type.charAt(0).toUpperCase() + type.slice(1)}`][lang]}</button>)}</div>
                 <input className="w-full bg-card border border-divider rounded-2xl py-4 px-6" value={newGoal.label} onChange={e => setNewGoal({...newGoal, label: e.target.value})} placeholder={translations.goalLabelPlaceholder[lang]} />
                 <div className="grid grid-cols-2 gap-4">
                    <input type="number" className="bg-card border border-divider rounded-2xl py-4 px-6" placeholder={translations.current[lang]} value={newGoal.currentValue || ''} onChange={e => setNewGoal({...newGoal, currentValue: Number(e.target.value)})} />
                    <input type="number" className="bg-card border border-divider rounded-2xl py-4 px-6" placeholder={translations.target[lang]} value={newGoal.targetValue || ''} onChange={e => setNewGoal({...newGoal, targetValue: Number(e.target.value)})} />
                 </div>
              </div>
              <div className="flex gap-4">
                <button onClick={() => setShowGoalModal(false)} className="flex-1 bg-card py-4 rounded-2xl font-semibold text-secondary hover:bg-card-hover transition-colors">
                  {lang === Language.CN ? '取消' : 'Cancel'}
                </button>
                <button onClick={handleAddGoal} className="flex-[2] bg-accent py-4 rounded-2xl font-semibold text-white hover:opacity-90 transition-all shadow-elevated shadow-blue-600/30 active:scale-95">
                  {translations.confirm[lang]}
                </button>
              </div>
           </div>
        </div>
      )}

      {/* ✅ 新增：编辑目标模态框 */}
      {showEditGoalModal && editingGoal && (
        <div className="fixed inset-0 z-[70] bg-base/80 backdrop-blur-md flex items-center justify-center p-6 animate-in fade-in">
           <div className="bg-inset border border-divider w-full max-sm rounded-card p-8 space-y-6 shadow-2xl">
              <div className="flex justify-between items-center">
                <h2 className="text-2xl font-semibold">
                  {lang === Language.CN ? '编辑目标' : 'Edit Goal'}
                </h2>
                <button onClick={handleCancelEditGoal} className="p-2 hover:bg-card rounded-full transition-colors">
                  <X size={20} className="text-secondary" />
                </button>
              </div>
              <div className="space-y-4">
                 {/* 目标类型选择 */}
                 <div className="flex gap-2">
                   {['weight', 'strength', 'frequency'].map(type => (
                     <button 
                       key={type} 
                       onClick={() => setEditingGoal({...editingGoal, type: type as GoalType})} 
                       className={`flex-1 py-3 rounded-2xl text-[10px] font-semibold uppercase transition-all ${
                         editingGoal.type === type ? 'bg-accent' : 'bg-card'
                       }`}
                     >
                       {translations[`goal${type.charAt(0).toUpperCase() + type.slice(1)}`][lang]}
                     </button>
                   ))}
                 </div>
                 
                 {/* 目标标题 */}
                 <input 
                   className="w-full bg-card border border-divider rounded-2xl py-4 px-6" 
                   value={editingGoal.title || editingGoal.label || ''} 
                   onChange={e => setEditingGoal({...editingGoal, title: e.target.value, label: e.target.value})} 
                   placeholder={translations.goalLabelPlaceholder[lang]} 
                 />
                 
                 {/* 当前值和目标值 */}
                 <div className="grid grid-cols-2 gap-4">
                    <input 
                      type="number" 
                      className="bg-card border border-divider rounded-2xl py-4 px-6" 
                      placeholder={translations.current[lang]} 
                      value={editingGoal.currentValue || ''} 
                      onChange={e => setEditingGoal({...editingGoal, currentValue: Number(e.target.value)})} 
                    />
                    <input 
                      type="number" 
                      className="bg-card border border-divider rounded-2xl py-4 px-6" 
                      placeholder={translations.target[lang]} 
                      value={editingGoal.targetValue || ''} 
                      onChange={e => setEditingGoal({...editingGoal, targetValue: Number(e.target.value)})} 
                    />
                 </div>
                 
                 {/* 目标描述（可选） */}
                 <textarea 
                   className="w-full bg-card border border-divider rounded-2xl py-4 px-6 resize-none" 
                   rows={3}
                   value={editingGoal.description || ''} 
                   onChange={e => setEditingGoal({...editingGoal, description: e.target.value})} 
                   placeholder={lang === Language.CN ? '目标描述（可选）' : 'Goal description (optional)'} 
                 />
                 
                 {/* 目标状态 */}
                 <div className="flex items-center justify-between p-4 bg-card/50 rounded-2xl">
                   <span className="text-sm font-bold text-primary">
                     {lang === Language.CN ? '目标状态' : 'Goal Status'}
                   </span>
                   <button
                     onClick={() => setEditingGoal({...editingGoal, isActive: !editingGoal.isActive})}
                     className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                       editingGoal.isActive 
                         ? 'bg-green-600 text-white' 
                         : 'bg-inset text-secondary'
                     }`}
                   >
                     {editingGoal.isActive 
                       ? (lang === Language.CN ? '活跃' : 'Active')
                       : (lang === Language.CN ? '暂停' : 'Paused')
                     }
                   </button>
                 </div>
              </div>
              <div className="flex gap-4">
                <button onClick={handleCancelEditGoal} className="flex-1 bg-card py-4 rounded-2xl font-semibold text-secondary hover:bg-card-hover transition-colors">
                  {lang === Language.CN ? '取消' : 'Cancel'}
                </button>
                <button onClick={handleSaveEditedGoal} className="flex-[2] bg-accent py-4 rounded-2xl font-semibold text-white hover:opacity-90 transition-all shadow-elevated shadow-blue-600/30 active:scale-95">
                  {lang === Language.CN ? '保存更改' : 'Save Changes'}
                </button>
              </div>
           </div>
        </div>
      )}

      {/* 顶部导航栏 */}
      <header className="sticky top-0 z-40 bg-base/90 backdrop-blur-xl border-b border-divider px-6 pb-4 pt-14 md:pt-[calc(env(safe-area-inset-top)+1.5rem)] flex justify-between items-center">
        {/* 左侧：Logo */}
        <div className="flex items-center gap-3">
          <Dumbbell className="text-accent" />
          <h1 className="font-display text-lg font-semibold tracking-tight text-primary">{translations.appTitle[lang]}</h1>
        </div>

        {/* 右侧：同步按钮 + 单位切换 */}
        <div className="flex items-center gap-3">
          
          {/* 手动同步按钮 */}
          <button 
            onClick={() => user && performFullSync()}
            disabled={syncStatus === 'syncing' || !user || !isRemoteConfigured()}
            className={`p-2 rounded-xl border transition-all active:scale-90 ${
              syncStatus === 'error' ? 'bg-red-500/10 border-red-500/20' : 'bg-card border-divider'
            }`}
          >
            {syncStatus === 'syncing' ? (
              /* 正在同步：蓝色转圈 */
              <RefreshCw className="animate-spin text-accent" size={18} />
            ) : syncStatus === 'error' ? (
              /* 同步出错：红色感叹号 */
              <AlertCircle className="text-danger" size={18} />
            ) : (
              /* 数据最新/成功：绿色对号 (使用 CheckIcon) */
              <CheckIcon className="text-success" size={18} strokeWidth={2.5} />
            )}
          </button>
          
          {/* 单位切换按钮 */}
          <button 
            // ✅ 调用刚才写好的转换函数
            onClick={handleUnitToggle} 
            className="bg-card border border-divider px-3 py-1.5 rounded-xl text-xs font-semibold uppercase text-accent hover:bg-card-hover hover:text-primary transition-all active:scale-95 shadow-sm"
          >
            {unit}
          </button>
        </div>
      </header>

      <main
        className={`max-w-2xl mx-auto p-4 md:p-8 ${activeTab === 'new' ? 'pb-10' : ''}`}
        style={
          activeTab === 'new'
            ? undefined
            : { paddingBottom: 'calc(7rem + env(safe-area-inset-bottom))' }
        }
      >
          {activeTab === 'dashboard' && (
            <Suspense fallback={<div className="flex items-center justify-center min-h-[60vh]"><div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full" /></div>}>
            <Dashboard
              lang={lang}
              workouts={workouts}
              weightEntries={weightEntries}
              bestLifts={bestLifts}
              starredExercises={starredExercises}
              selectedPRProject={selectedPRProject}
              chartMetricPreference={chartMetricPreference}
              unit={unit}
              isHistoryVisible={isHistoryVisible}
              setSelectedPRProject={setSelectedPRProject}
              setChartMetricPreference={setChartMetricPreference}
              setIsHistoryVisible={setIsHistoryVisible}
              toggleStarExercise={toggleStarExercise}
              handleEditWorkout={handleEditWorkout}
              handleDeleteExerciseRecord={handleDeleteExerciseRecord}
              handleDeleteWeightEntry={handleDeleteWeightEntry}
              triggerEditWeight={triggerEditWeight}
              setShowWeightInput={setShowWeightInput}
              setEditingWeightId={setEditingWeightId}
              setWeightInputValue={setWeightInputValue}
              handleExportData={handleExportData}
              onStartNewWorkout={() => setActiveTab('new')}
              getActiveMetrics={getActiveMetrics}
              getChartMetric={getChartMetric}
              resolveName={resolveName}
              formatExerciseTime={formatExerciseTime}
              updateExerciseTime={updateExerciseTime}
              renderSetCapsule={renderSetCapsule}
            />
            </Suspense>
          )}

          {/* 新增训练 */}
          {activeTab === 'new' && (
            <div className="space-y-8 animate-in slide-in-from-bottom-5">
              {/* 训练流程顶部「← 返回」 */}
              <div className="flex items-center justify-between -mt-2">
                <button
                  type="button"
                  onClick={() => {
                    const hasContent = (currentWorkout?.exercises?.length ?? 0) > 0;
                    if (hasContent) {
                      const msg = lang === Language.CN
                        ? '当前训练尚未保存，确定要返回吗？'
                        : 'Unsaved workout will be lost. Continue?';
                      if (!window.confirm(msg)) return;
                      setCurrentWorkout(workoutCtx.createNewWorkout());
                    }
                    setActiveTab(previousTab === 'new' ? 'dashboard' : previousTab);
                  }}
                  className="inline-flex items-center gap-2 px-3 py-2 bg-card/60 border border-divider rounded-2xl text-sm font-bold text-primary hover:bg-card hover:text-primary active:scale-95 transition-all"
                  aria-label={lang === Language.CN ? '返回' : 'Back'}
                >
                  <ArrowLeft size={16} />
                  <span>{lang === Language.CN ? '返回' : 'Back'}</span>
                </button>
                <span className="text-xs font-bold text-secondary tracking-wider uppercase">
                  {lang === Language.CN ? '新建训练' : 'New Workout'}
                </span>
                <span className="w-16" aria-hidden />
              </div>

              <div className="bg-card p-8 rounded-card border border-divider">
                <input 
                  className="bg-transparent text-3xl font-semibold w-full outline-none" 
                  value={currentWorkout.title} 
                  onChange={e => setCurrentWorkout({...currentWorkout, title: e.target.value})} 
                  placeholder={translations.trainingTitlePlaceholder[lang]} 
                />
              </div>
              
              <div className="space-y-6">
            {currentWorkout.exercises?.map((ex, exIdx) => {
              const isBodyweight = isBodyweightMode(ex); 
              const isPyramid = isPyramidEnabled(ex);

              return (
                <ExerciseCard
                  key={ex.id}
                  exercise={ex}
                  exIdx={exIdx}
                  lang={lang}
                  unit={unit}
                  isBodyweight={isBodyweight}
                  isPyramid={isPyramid}
                  exerciseNotes={exerciseNotes}
                  getActiveMetrics={getActiveMetrics}
                  resolveName={resolveName}
                  onUpdateExercise={(idx, updates) => {
                    const exs = [...currentWorkout.exercises!];
                    exs[idx] = { ...exs[idx], ...updates };
                    setCurrentWorkout({...currentWorkout, exercises: exs});
                  }}
                  onDeleteExercise={(idx) => {
                    setCurrentWorkout({...currentWorkout, exercises: currentWorkout.exercises!.filter((_, i) => i !== idx)});
                  }}
                  onOpenTimePicker={(idx, setIdx, currentSeconds) => {
                    openTimePicker(idx, setIdx, currentSeconds);
                  }}
                  onToggleNote={(name) => {
                    setNoteModalData({ name, note: exerciseNotes[name] || '' });
                  }}
                  onOpenMetricModal={(name) => {
                    setShowMetricModal({ name });
                  }}
                  onSetUpdate={(exIdx, setIdx, updates) => {
                    const exs = [...currentWorkout.exercises!];
                    exs[exIdx].sets[setIdx] = { ...exs[exIdx].sets[setIdx], ...updates };
                    setCurrentWorkout({...currentWorkout, exercises: exs});
                  }}
                  onAddSet={(idx) => {
                    const exs = [...currentWorkout.exercises!];
                    const currentSets = exs[idx].sets;
                    const lastSet = currentSets.length > 0 ? currentSets[currentSets.length - 1] : null;
                    let newSet = lastSet 
                      ? { ...lastSet, id: Date.now().toString() }
                      : { id: Date.now().toString(), weight: 0, reps: 0 };
                    exs[idx].sets.push(newSet);
                    setCurrentWorkout({...currentWorkout, exercises: exs});
                  }}
                  onRemoveSet={(exIdx, setIdx) => {
                    const exs = [...currentWorkout.exercises!];
                    exs[exIdx].sets = exs[exIdx].sets.filter((_, i) => i !== setIdx);
                    setCurrentWorkout({...currentWorkout, exercises: exs});
                  }}
                  onOpenRestSettings={(name) => openRestSettings(name)}
                  getRestPref={getRestPref}
                />
              );
            })}
          </div>

                <div className="space-y-6 mt-10 pb-10">
            <div className="flex items-center gap-3 px-2">
              <div className="h-[1px] flex-1 bg-card"></div>
              <h3 className="text-[10px] font-semibold text-secondary uppercase tracking-[0.2em]">
                {translations.categorySelection[lang]}
              </h3>
              <div className="h-[1px] flex-1 bg-card"></div>
            </div>

            {/* ✅ 优化后的分类选择区域 - 分离关注点 */}
            <div className="space-y-4">
              {/* 快速搜索区域 */}
              <div className="bg-card border border-divider p-4 rounded-card">
                <div className="flex items-center gap-3 mb-3">
                  <Search className="text-secondary" size={20} />
                  <h4 className="text-sm font-semibold text-primary">
                    {lang === Language.CN ? '快速添加动作' : 'Quick Add Exercise'}
                  </h4>
                </div>
                <div className="relative">
                  <input 
                    className="w-full bg-inset border border-divider rounded-xl py-3 px-4 text-sm text-white outline-none focus:border-blue-500 transition-all"
                    placeholder={lang === Language.CN ? '搜索动作或点击下方浏览动作库...' : 'Search exercises or browse library below...'}
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                  />
                  <button 
                    onClick={() => {
                      // ✅ 优化：记录当前分类，支持"全部分类"按钮的切换功能
                      if (activeLibraryCategory !== null) {
                        setPreviousLibraryCategory(activeLibraryCategory);
                      }
                      setActiveLibraryCategory(null);
                      setSelectedTags([]);
                      setShowLibrary(true);
                    }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 px-3 py-1 bg-accent text-white text-xs font-bold rounded-lg hover:opacity-90 transition-colors"
                  >
                    {lang === Language.CN ? '浏览动作库' : 'Browse Library'}
                  </button>
                </div>
              </div>

              {/* 分类选择区域 */}
              <div className="flex flex-col gap-3">
                {[
                  { id: 'STRENGTH', label: translations.strengthTraining[lang], icon: <Dumbbell size={24} />, color: 'blue', desc: translations.strengthSub[lang] },
                  { id: 'CARDIO', label: translations.cardioTraining[lang], icon: <Activity size={24} />, color: 'orange', desc: translations.cardioSub[lang] },
                  { id: 'FREE', label: translations.freeTraining[lang], icon: <Zap size={24} />, color: 'purple', desc: translations.freeSub[lang] },
                ].map(cat => (
                  <button
                    key={cat.id}
                    onClick={() => {
                      // ✅ 优化：记录之前的分类状态，支持"全部分类"按钮的切换功能
                      if (activeLibraryCategory !== null && activeLibraryCategory !== cat.id) {
                        setPreviousLibraryCategory(activeLibraryCategory);
                      }
                      setActiveLibraryCategory(cat.id as ExerciseCategory);
                      setSearchQuery(''); 
                      setSelectedTags([]); 
                      setShowLibrary(true);
                    }}
                    className="group relative bg-card border border-divider p-4 rounded-card flex items-center gap-4 hover:bg-card/60 transition-all active:scale-[0.98] overflow-hidden w-full"
                  >
                    {/* 背景微光装饰 */}
                    <div className={`absolute -right-6 -top-6 w-24 h-24 bg-${cat.color}-500/5 blur-2xl rounded-full group-hover:bg-${cat.color}-500/10 transition-all`}></div>
                    
                    {/* 左侧图标 */}
                    <div className={`p-3 bg-inset rounded-xl text-${cat.color}-500 shadow-inner group-hover:scale-105 transition-transform relative z-10`}>
                      {cat.icon}
                    </div>

                    {/* 右侧文字 */}
                    <div className="flex flex-col items-start relative z-10 flex-1">
                      <span className="font-semibold text-base tracking-tight text-white">{cat.label}</span>
                      <span className="text-[9px] font-bold text-secondary uppercase tracking-wider">
                        {cat.desc}
                      </span>
                    </div>

                    {/* 右侧箭头装饰 */}
                    <ChevronRight className="text-tertiary group-hover:text-secondary transition-colors relative z-10" size={18} />
                  </button>
                ))}
              </div>
            </div>
            
            {/* ✅ 修复问题7&8: 改进的保存训练按钮 - 显示状态、单位确认、未保存提示 */}
            <div className="space-y-3 mt-6">
              {/* 单位提醒条 */}
              <div className="bg-card/50 border border-divider p-3 rounded-xl flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Scale size={16} className="text-secondary" />
                  <span className="text-sm text-secondary">
                    {lang === Language.CN ? '当前单位' : 'Current Unit'}: 
                  </span>
                  <span className="text-sm font-bold text-white">
                    {unit === 'kg' ? '公斤 (kg)' : '磅 (lbs)'}
                  </span>
                </div>
                {hasUnsavedChanges && (
                  <div className="flex items-center gap-1">
                    <div className="w-2 h-2 bg-orange-500 rounded-full animate-pulse"></div>
                    <span className="text-xs text-orange-400">
                      {lang === Language.CN ? '有未保存更改' : 'Unsaved changes'}
                    </span>
                  </div>
                )}
              </div>
              
              {/* 保存按钮 */}
              <button 
                onClick={handleSaveWithConfirmation}
                disabled={saveStatus === 'saving'}
                className={`w-full p-6 rounded-card font-semibold text-lg shadow-2xl flex items-center justify-center gap-3 transition-all mt-6 ${
                  saveStatus === 'saving' 
                    ? 'bg-tertiary/30 text-tertiary cursor-not-allowed' 
                    : saveStatus === 'saved'
                    ? 'bg-green-600 shadow-green-600/30'
                    : saveStatus === 'error'
                    ? 'bg-red-600 shadow-red-600/30'
                    : 'bg-accent shadow-blue-600/30 hover:opacity-90 active:scale-95'
                }`}
              >
                {saveStatus === 'saving' && (
                  <>
                    <div className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                    {lang === Language.CN ? '保存中...' : 'Saving...'}
                  </>
                )}
                {saveStatus === 'saved' && (
                  <>
                    <CheckIcon size={24} strokeWidth={3} />
                    {lang === Language.CN ? '保存成功！' : 'Saved Successfully!'}
                  </>
                )}
                {saveStatus === 'error' && (
                  <>
                    <X size={24} strokeWidth={3} />
                    {lang === Language.CN ? '保存失败' : 'Save Failed'}
                  </>
                )}
                {saveStatus === 'idle' && (
                  <>
                    <CheckIcon size={24} strokeWidth={3} />
                    {translations.saveWorkout[lang]}
                  </>
                )}
              </button>
            </div>
          </div>
                    
          </div>)}

          {/* 训练计划：日程 + 目标 */}
          {activeTab === 'plan' && (
            <Suspense fallback={<div className="flex items-center justify-center min-h-[60vh]"><div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full" /></div>}>
            <PlanTab
              lang={lang}
              unit={unit}
              onAddGoal={() => setShowGoalModal(true)}
              onEditGoal={handleEditGoal}
              customTags={customTags}
              onStartScheduledSession={handleStartScheduledSession}
              onOpenLibraryForPicker={openLibraryForPicker}
            />
            </Suspense>
          )}
          
          {/* 智能助手 */}
          {activeTab === 'assistant' && (
            <Suspense fallback={<div className="flex items-center justify-center min-h-[60vh]"><div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full" /></div>}>
              <AssistantTabContainer lang={lang} />
            </Suspense>
          )}

          {/* 个人中心页面 (Profile) */}
          {activeTab === 'profile' && (
            <Suspense fallback={<div className="flex items-center justify-center min-h-[60vh]"><div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full" /></div>}>
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
              onToggleMetric={(name) => setExpandedMetric(name)}
              onEditMeasurement={(m) => triggerEditMeasurement(m)}
              onDeleteMeasurement={(e, id) => handleDeleteMeasurement(e, id)}
              onAddMeasurementEntry={(name) => { 
                setEditingMeasurementId(null);
                setMeasureForm({ name: name, value: '', unit: '' }); 
                setShowMeasureModal(true); 
              }}
              setShowResetAccountModal={setShowResetAccountModal}
            />
            </Suspense>
          )}
        </main>

      {/* --- 新增：备注输入弹窗 --- */}
      {noteModalData && (
        <div className="fixed inset-0 z-[80] bg-base/80 backdrop-blur-sm flex items-center justify-center p-6 animate-in fade-in">
          <div className="bg-inset border border-divider w-full max-w-sm rounded-card p-8 shadow-2xl">
            <h3 className="text-center text-secondary font-bold mb-2 text-sm">{noteModalData.name}</h3>
            <h2 className="text-center text-2xl font-semibold text-white mb-6">
              {lang === Language.CN ? '动作备注' : 'Exercise Note'}
            </h2>
            
            <textarea
              className="w-full bg-base border border-divider rounded-2xl p-4 text-primary outline-none focus:border-blue-500 transition-colors min-h-[120px] resize-none mb-6"
              placeholder={lang === Language.CN ? '例如：座椅高度 4，宽握...' : 'E.g. Seat height 4, wide grip...'}
              value={noteModalData.note}
              onChange={e => setNoteModalData({...noteModalData, note: e.target.value})}
              autoFocus
            />

            <div className="flex gap-4">
              <button onClick={() => setNoteModalData(null)} className="flex-1 py-4 rounded-2xl bg-card text-secondary font-semibold hover:bg-card-hover transition-colors">{lang === Language.CN ? '取消' : 'Cancel'}</button>
              <button onClick={handleSaveNote} className="flex-[2] py-4 rounded-2xl bg-accent text-white font-semibold hover:opacity-90 transition-all shadow-elevated shadow-blue-600/30 active:scale-95">
                {translations.confirm[lang]}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* --- 新增：休息时间设置弹窗 --- */}
      {restModalData && (
        <div className="fixed inset-0 z-[80] bg-base/80 backdrop-blur-sm flex items-center justify-center p-6 animate-in fade-in">
          <div className="bg-inset border border-divider w-full max-w-sm rounded-card p-8 shadow-2xl">
            <h3 className="text-center text-secondary font-bold mb-2 text-sm">{restModalData.name}</h3>
            <h2 className="text-center text-3xl font-semibold text-white mb-8">
              {lang === Language.CN ? '休息时长' : 'Rest Duration'}
            </h2>

            {/* 时间显示与微调 */}
            <div className="flex items-center justify-between mb-8 bg-base rounded-3xl p-2 border border-divider">
              <button onClick={() => setRestModalData(p => p ? ({...p, time: Math.max(10, p.time - 10)}) : null)} className="w-14 h-14 bg-card rounded-full flex items-center justify-center text-primary font-semibold hover:bg-card-hover transition-colors active:scale-95"><Minus size={24} /></button>
              <div className="flex flex-col items-center">
                <span className="text-4xl font-semibold text-accent tabular-nums">{restModalData.time}</span>
                <span className="text-[10px] font-bold text-tertiary uppercase">SEC</span>
              </div>
              <button onClick={() => setRestModalData(p => p ? ({...p, time: p.time + 10}) : null)} className="w-14 h-14 bg-card rounded-full flex items-center justify-center text-primary font-semibold hover:bg-card-hover transition-colors active:scale-95"><Plus size={24} /></button>
            </div>

            {/* 快捷选项 */}
            <div className="grid grid-cols-4 gap-2 mb-8">
              {[30, 60, 90, 120].map(t => (
                <button 
                  key={t} 
                  onClick={() => setRestModalData(p => p ? ({...p, time: t}) : null)}
                  className={`py-2 rounded-xl text-xs font-semibold transition-all ${restModalData.time === t ? 'bg-accent text-white' : 'bg-card text-secondary hover:bg-card-hover'}`}
                >
                  {t}s
                </button>
              ))}
            </div>

            {/* 底部按钮 */}
            <div className="flex gap-4">
              <button onClick={() => setRestModalData(null)} className="flex-1 py-4 rounded-2xl bg-card text-secondary font-semibold hover:bg-card-hover transition-colors">{lang === Language.CN ? '取消' : 'Cancel'}</button>
              <button onClick={confirmStartRest} className="flex-[2] py-4 rounded-2xl bg-accent text-white font-semibold hover:opacity-90 transition-all shadow-elevated shadow-blue-600/30 active:scale-95 flex items-center justify-center gap-2">
                <History size={18} />
                {lang === Language.CN ? '开始计时' : 'Start Timer'}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* ✅ 在这里插入新的"维度设置弹窗"代码 */}
      {showMetricModal && (
        <div className="fixed inset-0 z-[80] bg-base/80 backdrop-blur-sm flex items-center justify-center p-6 animate-in fade-in">
          <div className="bg-inset border border-divider w-full max-w-sm rounded-card p-8 shadow-2xl overflow-y-auto max-h-[90vh] custom-scrollbar">
            <h2 className="text-xl font-semibold text-white mb-6 flex items-center gap-2">
              <SettingsIcon size={20} className="text-accent" />
              {translations.manageMetrics[lang]} - {showMetricModal.name}
            </h2>

            <p className="text-[10px] font-bold text-secondary  mb-4 px-1">
              {lang === Language.CN ? '选择要记录的维度' : 'Select metrics to track'}
            </p>

            <div className="space-y-3 mb-8">
              {/* 渲染内置和已有的自定义维度 */}
              {Array.from(new Set([...STANDARD_METRICS, ...getActiveMetrics(showMetricModal.name)])).map(m => (
                <button 
                  key={m}
                  onClick={() => toggleMetric(showMetricModal.name, m)}
                  className={`w-full p-4 rounded-2xl border flex justify-between items-center transition-all ${getActiveMetrics(showMetricModal.name).includes(m) ? 'bg-accent/10 border-blue-500/50 text-white' : 'bg-card/50 border-divider text-secondary'}`}
                >
                  <span className="font-bold uppercase text-xs">
                    {translations[m as keyof typeof translations]?.[lang] || m.replace('custom_', '')}
                  </span>
                  {getActiveMetrics(showMetricModal.name).includes(m) ? <CheckIcon size={16} className="text-accent" /> : <Plus size={16} />}
                </button>
              ))}
            </div>

            <p className="text-[10px] font-bold text-secondary  mb-4 px-1">
              {translations.addDimension[lang]}
            </p>

            {/* 添加新的自定义维度输入 */}
            <div className="flex gap-2 mb-8">
              <input 
                className="flex-1 bg-base border border-divider rounded-xl px-4 py-3 text-sm text-white outline-none focus:border-blue-500"
                placeholder={translations.dimensionPlaceholder[lang]}
                value={newCustomDimension}
                onChange={e => setNewCustomDimension(e.target.value)}
              />
              <button 
                onClick={() => {
                  if(!newCustomDimension) return;
                  toggleMetric(showMetricModal.name, `custom_${newCustomDimension}`);
                  setNewCustomDimension('');
                }}
                className="bg-card border border-divider p-2 px-4 rounded-xl text-accent font-bold text-xs active:scale-95 transition-all"
              >
                {lang === Language.CN ? '添加' : 'Add'}
              </button>
            </div>

            {/* ✅ 新增：重置和确认按钮组 */}
            <div className="flex gap-3">
              <button 
                onClick={() => {
                  if (confirm(lang === Language.CN ? 
                    `确定要重置"${showMetricModal?.name}"的配置到默认状态吗？\n默认只记录重量和次数。` : 
                    `Reset "${showMetricModal?.name}" to default settings?\nDefault tracks weight and reps only.`
                  )) {
                    resetMetricsToDefault(showMetricModal!.name);
                  }
                }}
                className="flex-1 py-4 rounded-2xl bg-card border border-divider text-secondary font-bold text-sm active:scale-95 transition-all hover:bg-card-hover"
              >
                {lang === Language.CN ? '重置默认' : 'Reset Default'}
              </button>
              
              <button 
                onClick={() => setShowMetricModal(null)} 
                className="flex-[2] py-4 rounded-2xl bg-accent text-white font-semibold shadow-xl shadow-blue-600/20 active:scale-95 transition-all"
              >
                {translations.confirm[lang]}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- ✅ 新增：移动端友好时间选择器 --- */}
      {showTimePicker && (
        <div className="fixed inset-0 z-[100] bg-base/90 backdrop-blur-md flex items-end sm:items-center justify-center animate-in fade-in slide-in-from-bottom-10">
          <div className="bg-inset border-t sm:border border-divider w-full max-w-md rounded-t-[3rem] sm:rounded-[3rem] p-8 shadow-2xl">
            <div className="flex justify-between items-center mb-8">
              <h2 className="text-xl font-semibold text-white">{lang === Language.CN ? '设置时长' : 'Set Duration'}</h2>
              <button onClick={() => setShowTimePicker(null)} className="p-2 text-secondary"><X size={24}/></button>
            </div>

            {/* 滚轮模拟选择区 */}
            <div className="flex justify-around items-center gap-4 mb-10">
              {[
                { label: lang === Language.CN ? '时' : 'Hour', key: 'h', max: 23 },
                { label: lang === Language.CN ? '分' : 'Min', key: 'm', max: 59 },
                { label: lang === Language.CN ? '秒' : 'Sec', key: 's', max: 59 }
              ].map((col) => (
                <div key={col.key} className="flex flex-col items-center gap-4 flex-1">
                  <button 
                    onClick={() => setTempHMS(p => ({...p, [col.key]: (p[col.key as keyof typeof p] + 1) > col.max ? 0 : p[col.key as keyof typeof p] + 1}))}
                    className="w-full py-4 bg-card rounded-2xl flex justify-center text-accent active:bg-blue-500 active:text-white transition-all"
                  >
                    <ChevronUp size={28} strokeWidth={3} />
                  </button>
                  
                  <div className="flex flex-col items-center">
                    <span className="text-4xl font-semibold text-white tabular-nums">
                      {tempHMS[col.key as keyof typeof tempHMS].toString().padStart(2, '0')}
                    </span>
                    <span className="text-[10px] font-bold text-tertiary  mt-1">{col.label}</span>
                  </div>

                  <button 
                    onClick={() => setTempHMS(p => ({...p, [col.key]: (p[col.key as keyof typeof p] - 1) < 0 ? col.max : p[col.key as keyof typeof p] - 1}))}
                    className="w-full py-4 bg-card rounded-2xl flex justify-center text-accent active:bg-blue-500 active:text-white transition-all"
                  >
                    <ChevronDown size={28} strokeWidth={3} />
                  </button>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <button onClick={() => setShowTimePicker(null)} className="py-5 rounded-card bg-card text-secondary font-semibold">{lang === Language.CN ? '取消' : 'Cancel'}</button>
              <button onClick={confirmTimePicker} className="py-5 rounded-card bg-accent text-white font-semibold shadow-xl shadow-blue-600/30">
                {translations.confirm[lang]}
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* ✅ 问题4: 重置账户确认对话框 */}
      {showResetAccountModal && (
        <div className="fixed inset-0 z-[100] bg-base/90 backdrop-blur-md flex items-center justify-center p-6 animate-in fade-in">
          <div className="bg-inset border border-divider w-full max-w-md rounded-card p-8 shadow-2xl">
            <div className="text-center mb-8">
              <div className="w-20 h-20 bg-red-500/10 rounded-full flex items-center justify-center mx-auto mb-6">
                <Trash2 size={32} className="text-red-500" />
              </div>
              <h2 className="text-2xl font-semibold text-white mb-4">
                {translations.resetAccountWarning[lang]}
              </h2>
              <p className="text-sm text-secondary leading-relaxed whitespace-pre-line">
                {translations.resetAccountDesc[lang]}
              </p>
            </div>

            <div className="space-y-6">
              <div>
                <label className="block text-xs font-bold text-secondary  mb-3">
                  {translations.resetConfirmText[lang]}
                </label>
                <input
                  type="text"
                  value={resetConfirmText}
                  onChange={(e) => setResetConfirmText(e.target.value)}
                  placeholder={translations.resetConfirmPlaceholder[lang]}
                  className="w-full bg-base border border-divider rounded-2xl px-4 py-4 text-white outline-none focus:border-red-500 transition-colors"
                  autoFocus
                />
              </div>

              <div className="flex gap-4">
                <button
                  onClick={() => {
                    setShowResetAccountModal(false);
                    setResetConfirmText('');
                  }}
                  className="flex-1 py-4 rounded-2xl bg-card text-secondary font-semibold hover:bg-card-hover transition-colors"
                  disabled={isResetting}
                >
                  {translations.resetCancel[lang]}
                </button>
                <button
                  onClick={() => {
                    const confirmWord = lang === Language.CN ? '重置' : 'RESET';
                    if (resetConfirmText === confirmWord) {
                      handleResetAccount();
                    } else {
                      alert(lang === Language.CN ? '请输入"重置"确认' : 'Please type "RESET" to confirm');
                    }
                  }}
                  disabled={isResetting || resetConfirmText !== (lang === Language.CN ? '重置' : 'RESET')}
                  className="flex-[2] py-4 rounded-2xl bg-red-600 text-white font-semibold hover:bg-red-500 transition-all shadow-elevated shadow-red-600/30 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {isResetting ? (
                    <>
                      <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                      {translations.resetInProgress[lang]}
                    </>
                  ) : (
                    translations.resetConfirm[lang]
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* --- 训练计划：保存训练时的"按计划/有调整/取消"确认 --- */}
      {planConfirmOpen && (
        <div className="fixed inset-0 z-[80] bg-base/80 backdrop-blur-md flex items-center justify-center p-6 animate-fade-in">
          <div className="bg-card border border-divider w-full max-w-sm rounded-card p-6 space-y-4 shadow-elevated">
            <div>
              <h2 className="font-display text-lg font-semibold text-primary">
                {translations.planConfirmTitle[lang]}
              </h2>
              <p className="text-xs text-secondary mt-1">
                {translations.planConfirmSubtitle[lang]}
              </p>
            </div>
            <div className="space-y-2">
              <button
                data-testid="plan-confirm-faithful"
                onClick={async () => {
                  setPlanConfirmOpen(false);
                  await performSaveWorkout(true);
                }}
                className="w-full py-3 rounded-control bg-accent text-white text-sm font-medium hover:opacity-90 active:scale-95 transition"
              >
                {translations.planFaithful[lang]}
              </button>
              <button
                data-testid="plan-confirm-modified"
                onClick={async () => {
                  setPlanConfirmOpen(false);
                  await performSaveWorkout(false);
                }}
                className="w-full py-3 rounded-control border border-divider text-primary text-sm font-medium hover:bg-card-hover active:scale-95 transition"
              >
                {translations.planModified[lang]}
              </button>
              <button
                data-testid="plan-confirm-cancel"
                onClick={() => {
                  setPlanConfirmOpen(false);
                  setSaveStatus('idle');
                }}
                className="w-full py-3 rounded-control text-tertiary text-sm hover:text-primary transition"
              >
                {translations.planNotDone[lang]}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- 可拖拽悬浮休息计时器：仅当训练流程已经有动作（图1）时显示 --- */}
      {activeTab === 'new' && (currentWorkout?.exercises?.length ?? 0) > 0 && (
      <RestTimer
        isResting={isResting}
        restSeconds={restSeconds}
        setRestSeconds={setRestSeconds}
        setIsResting={setIsResting}
        onAdjustTime={adjustRestTime}
      />
      )}
      {/* 底部导航栏：仅在一级页面显示，训练流程隐藏 */}
      {user && activeTab !== 'new' && (
        <TabNavigation
          activeTab={activeTab as 'dashboard' | 'new' | 'plan' | 'profile'}
          onTabChange={setActiveTab}
          lang={lang}
          onStartWorkout={() => {
            setCurrentWorkout(workoutCtx.createNewWorkout());
            setActiveTab('new');
          }}
        />
      )}
    </div>
  );
};

// === Context Providers Wrapper ===
// Mount the theme hook at the root so the system colorScheme listener is
// always alive — otherwise it only existed inside ProfileTab and never fired
// while the user was on other tabs.
// --- Assistant container (owns LLM round-trip + tool execution) ---
const AssistantTabContainer: React.FC<{ lang: Language }> = ({ lang }) => {
  const assistantCtx = useAssistantContext();
  // Lazy import inside file to avoid circular deps at module init
  const [AssistantRuntime, setAssistantRuntime] = React.useState<null | typeof import('./src/components/AssistantRuntime')>(null);
  React.useEffect(() => {
    void import('./src/components/AssistantRuntime').then(m => setAssistantRuntime(m));
  }, []);
  if (!AssistantRuntime) {
    return <div className="flex items-center justify-center min-h-[60vh]"><div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full" /></div>;
  }
  return <AssistantRuntime.default lang={lang} assistantCtx={assistantCtx} />;
};

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
              <AssistantProvider userId={FITLOG_SOLO_USER_ID}>
                <AppWithAuth />
              </AssistantProvider>
            </ScheduleProvider>
          </GoalsProvider>
        </WorkoutProvider>
      </UserSettingsProvider>
    </AuthProvider>
  </ThemeRoot>
);

export default AppWithProviders;
