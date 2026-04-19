import React, { useState, useEffect, useMemo, useRef, Suspense, lazy } from 'react';
import CalendarHeatmap from 'react-calendar-heatmap';
import './heatmap.css'
import 'react-calendar-heatmap/dist/styles.css';

// 懒加载组件，减少首屏包体积
const Dashboard = lazy(() => import('./src/components/Dashboard').then(m => ({ default: m.default })));
const ProfileTab = lazy(() => import('./src/components/ProfileTab').then(m => ({ default: m.default })));
const GoalsTab = lazy(() => import('./src/components/GoalsTab').then(m => ({ default: m.default })));
const LazyCharts = lazy(() => import('./src/components/LazyCharts').then(m => ({ default: m.default })));
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
import { Language, User, WorkoutSession, Exercise, ExerciseDefinition, Goal, GoalType, BodyweightMode, WeightEntry, SubSetLog, PyramidCalculator, PyramidTemplate } from './types';
import { translations } from './translations';
import { db } from './services/db';
import { 
  supabase, syncWorkoutsToCloud, fetchWorkoutsFromCloud, 
  syncGoalsToCloud, fetchGoalsFromCloud, 
  syncWeightToCloud, fetchWeightFromCloud, 
  syncMeasurementsToCloud, fetchMeasurementsFromCloud,
  syncUserConfigsToCloud, fetchUserConfigsFromCloud, deleteWorkoutFromCloud, 
  deleteWeightFromCloud, deleteMeasurementFromCloud, SUPABASE_URL
} from './services/supabase';
import { KMH_TO_MPH, playTimerSound } from './src/constants';
import { BODY_PARTS, EQUIPMENT_TAGS, DEFAULT_EXERCISES, STANDARD_METRICS, ExerciseCategory } from './src/constants/exercises';
import { formatValue, getUnitTag, formatWeight, parseWeight, secondsToHMS, formatTime } from './src/utils/format';
import { RestTimer } from './src/components/RestTimer';
import TabNavigation from './src/components/TabNavigation';
import { SetCapsule } from './src/components/SetCapsule';
import { ExerciseCard } from './src/components/ExerciseCard';
import { useAuth, useWorkout, useUserSettings } from './src/hooks';
import { useAuthContext, useWorkoutContext, useGoalsContext, useUserSettingsContext } from './src/contexts';

// AppWithAuth receives userId from wrapper and provides Context values to App
interface AppWithAuthProps {
  userId?: string;
  onUserIdChange: (id: string | undefined) => void;
}

const AppWithAuth: React.FC<AppWithAuthProps> = ({ userId, onUserIdChange }) => {
  // === Context Hooks ===
  const authCtx = useAuthContext();
  const workoutCtx = useWorkoutContext();
  const goalsCtx = useGoalsContext();
  const settingsCtx = useUserSettingsContext();
  
  // Sync userId with parent when auth changes
  useEffect(() => {
    if (authCtx.user && authCtx.user.id !== userId) {
      onUserIdChange(authCtx.user.id);
    }
  }, [authCtx.user]);
  
  // === State from Context (with fallbacks for standalone mode) ===
  const lang = settingsCtx?.lang || Language.CN;
  const setLang = settingsCtx?.setLang || (() => {});
  const unit = settingsCtx?.unit || 'kg';
  const setUnit = settingsCtx?.setUnit || (() => {});
  const weightEntries = settingsCtx?.weightEntries || [];
  const measurements = settingsCtx?.measurements || [];
  
  // Auth state from Context
  const user = authCtx?.user || null;
  const authMode = authCtx?.authMode || 'login';
  const setAuthMode = authCtx?.setAuthMode || (() => {});
  const email = authCtx?.email || '';
  const setEmail = authCtx?.setEmail || (() => {});
  const password = authCtx?.password || '';
  const setPassword = authCtx?.setPassword || (() => {});
  const username = authCtx?.username || '';
  const setUsername = authCtx?.setUsername || (() => {});
  const showPassword = authCtx?.showPassword || false;
  const setShowPassword = authCtx?.setShowPassword || (() => {});
  const authError = authCtx?.authError || null;
  const setAuthError = authCtx?.setAuthError || (() => {});
  const isLoading = authCtx?.isLoading || false;
  const setIsLoading = authCtx?.setIsLoading || (() => {});
  const isUpdateSuccess = authCtx?.isUpdateSuccess || false;
  
  // === Local UI State ===
  const [activeLibraryCategory, setActiveLibraryCategory] = useState<ExerciseCategory | null>(null);
  const [previousLibraryCategory, setPreviousLibraryCategory] = useState<ExerciseCategory | null>(null);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'new' | 'goals' | 'profile'>('dashboard');
  
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'error'>('idle');
  
  // Workout state from Context
  const workouts = workoutCtx?.workouts || [];
  const currentWorkout = workoutCtx?.currentWorkout || null;
  const setCurrentWorkout = workoutCtx?.setCurrentWorkout || (() => {});
  
  // Goals state from Context
  const goals = goalsCtx?.goals || [];
  // weightEntries and measurements now come from Context (see line 60-61)
  // 定义一个本地接口 (用于本地状态类型)
  interface Measurement { id: string; userId: string; name: string; value: number; unit: string; date: string; }
  
  // measurements now comes from Context (see line 61)

  // --- ✅ 新增：时间选择器专用状态 ---
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
  const isRecoveryMode = useRef(false);

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
    
    // 添加调试日志帮助定位问题
    console.log('Toggle Metric Debug:', {
      exerciseName,
      metricKey,
      current,
      normalizedCurrent,
      normalizedKey,
      isCurrentlySelected,
      willRemove: isCurrentlySelected
    });
    
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

    console.log('Toggle Result:', { before: current, after: cleanNext });

    const updated = { ...exerciseMetricConfigs, [exerciseName]: cleanNext };
    setExerciseMetricConfigs(updated);
    localStorage.setItem('fitlog_metric_configs', JSON.stringify(updated));
    
    // ✅ 修复Metrics重置Bug: 标记本地metrics配置为最新，避免被云端数据覆盖
    const metricsTimestamp = Date.now();
    localStorage.setItem('fitlog_metrics_last_update', metricsTimestamp.toString());
    
    // ✅ 修复Bug #5: 使用防抖同步，避免频繁操作触发过多同步请求
    if (user && user.id !== 'u_guest') {
      debouncedPerformSync(user.id);
    }
  };

  // ✅ 新增：重置metrics配置到默认状态
  const resetMetricsToDefault = (exerciseName: string) => {
    const updated = { ...exerciseMetricConfigs };
    delete updated[exerciseName]; // 删除自定义配置，回到默认的['weight', 'reps']
    
    setExerciseMetricConfigs(updated);
    localStorage.setItem('fitlog_metric_configs', JSON.stringify(updated));
    
    console.log(`已重置 "${exerciseName}" 的metrics配置到默认状态`);
    
    // 同步到云端
    if (user && user.id !== 'u_guest') {
      debouncedPerformSync(user.id);
    }
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
      
      // 2. 从云端删除（如果用户已登录且不是访客）
      if (user && user.id !== 'u_guest') {
        try {
          await deleteMeasurementFromCloud(id);
        } catch (cloudError) {
          console.warn('云端删除失败，但本地删除成功:', cloudError);
          // 本地删除成功，云端删除失败时不阻止操作
          // 下次同步时会处理这种不一致情况
        }
      }
      
      // 3. 更新本地状态
      const all = await db.getAll<Measurement>('custom_metrics');
      if (user) setMeasurements(all.filter(m => m.userId === user.id));
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
    // 按时间排序，确保最后存入的是最新的
    const sorted = [...measurements].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    sorted.forEach(m => map.set(m.name, m));
    return Array.from(map.values());
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
      setIsLoading(true);

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
      
      const all = await db.getAll<Measurement>('custom_metrics');
      setMeasurements(all.filter(m => m.userId === user.id));
      
      setShowMeasureModal(false);
      // 重置表单和编辑ID
      setMeasureForm({ name: '', value: '', unit: measureForm.unit }); 
      setEditingMeasurementId(null);

    } catch (error: any) {
      alert("保存失败: " + error.message);
    } finally {
      setIsLoading(false);
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
  
  const debouncedPerformSync = (userId: string, delay: number = 2000) => {
    // 清除之前的防抖定时器
    if (debouncedSyncTimeoutRef.current) {
      clearTimeout(debouncedSyncTimeoutRef.current);
    }
    
    // 设置新的防抖定时器
    debouncedSyncTimeoutRef.current = setTimeout(() => {
      performFullSync(userId);
    }, delay);
  };

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
      await loadLocalData(user?.id || 'u_guest');
      
      // 同步到云端
      if (user && user.id !== 'u_guest') {
        performFullSync(user.id);
      }
      
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
    workouts.forEach(session => session.exercises.forEach(ex => {
      const w = Math.max(...(ex.sets.map(s => s.weight || 0)));
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

  // 图表数据处理已移到 LazyCharts 组件
  // 只要用户 ID 确定或发生变化，就强制刷新本地所有训练记录和指标
  useEffect(() => {
    if (user && user.id) {
      console.log("检测到用户已就绪，正在加载数据...", user.id);
      loadLocalData(user.id);
    }
  }, [user?.id]); // 关键依赖：user.id

  useEffect(() => {
    const initApp = async () => {
      await db.init();
      
      supabase.auth.onAuthStateChange(async (event, session) => {
        // 1. 检测到密码恢复事件
        if (event === 'PASSWORD_RECOVERY') {
          isRecoveryMode.current = true; // ✅ 更新 Ref
          setAuthMode('updatePassword');
          setIsUpdateSuccess(false);
          return;
        }

        // 2. 正常登录逻辑
        if (session?.user) {
          // ✅ 使用 Ref 进行判断，这里能拿到最新的 true
          if (isRecoveryMode.current) return; 

          // 下面是原有的正常登录逻辑
          const u = { 
            id: session.user.id, 
            username: session.user.user_metadata?.display_name || session.user.email?.split('@')[0] || 'User', 
            email: session.user.email!,
            avatarUrl: session.user.user_metadata?.avatar_url 
          };
          setUser(u);
          localStorage.setItem('fitlog_current_user', JSON.stringify(u));
          await performFullSync(u.id);
        }
      });

      const { data: { session } } = await supabase.auth.getSession();
      const savedUser = localStorage.getItem('fitlog_current_user');
      const localUserData = savedUser ? JSON.parse(savedUser) : null;

      if (session?.user) {
        // ✅ 这里的路径也要去掉 .png，保持一致
        const { data: { publicUrl: fixedAvatarUrl } } = supabase.storage
          .from('avatars')
          .getPublicUrl(session.user.id);
        
        const u = { 
          id: session.user.id, 
          username: session.user.user_metadata?.display_name || session.user.email?.split('@')[0] || 'User', 
          email: session.user.email!,
          avatarUrl: (localUserData && localUserData.id === session.user.id) 
            ? localUserData.avatarUrl 
            : (session.user.user_metadata?.avatar_url || fixedAvatarUrl)
        };
        setUser(u);
        localStorage.setItem('fitlog_current_user', JSON.stringify(u));
        await performFullSync(u.id);
      }
      const ls = (k: string) => localStorage.getItem(k);
      const savedCustomTags = ls('fitlog_custom_tags'); if (savedCustomTags) setCustomTags(JSON.parse(savedCustomTags));
      const savedCustomExercises = ls('fitlog_custom_exercises'); if (savedCustomExercises) setCustomExercises(JSON.parse(savedCustomExercises));
      const savedUnit = ls('fitlog_unit') as 'kg' | 'lbs'; 
      if (savedUnit) setUnit(savedUnit);
      const savedLang = ls('fitlog_lang') as Language; if (savedLang) setLang(savedLang);
      const savedTagOverrides = ls('fitlog_tag_rename_overrides'); if (savedTagOverrides) setTagRenameOverrides(JSON.parse(savedTagOverrides));
      const savedExOverrides = ls('fitlog_exercise_overrides'); if (savedExOverrides) setExerciseOverrides(JSON.parse(savedExOverrides));
      const savedStarred = ls('fitlog_starred_exercises'); if (savedStarred) setStarredExercises(JSON.parse(savedStarred));
      await LocalNotifications.requestPermissions();
    };
    initApp();
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

      // ✅ 关键：使用解构赋值 [...array] 确保 React 检测到引用变化，触发重绘
      setWorkouts([...migratedWorkouts].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()));
      setGoals([...migratedGoals]);
      setWeightEntries([...userWeights].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()));
      setMeasurements([...userMeasures]);

      console.log(`本地数据加载完成: ${migratedWorkouts.length} 场训练${hasDataMigration ? ' (已执行数据迁移)' : ''}${hasGoalMigration ? ', Goal数据已迁移' : ''}`);
    } catch (error) {
      console.error("加载本地数据失败:", error);
    }
  };

const performFullSync = async (currentUserId: string) => {
    if (currentUserId === 'u_guest') return;
    
    // ✅ 修复Bug #5: 检查同步锁，防止并发同步
    if (syncLockRef.current) {
      console.log('同步已在进行中，跳过此次请求');
      return;
    }
    
    // ✅ 修复Bug #5: 获取同步锁
    syncLockRef.current = true;
    setSyncStatus('syncing');
    try {
      await Promise.all([
        // 1. 同步训练记录 (Workouts)
        (async () => {
          const rw = await fetchWorkoutsFromCloud();
          if (rw) for (const r of rw) await db.save('workouts', { id: r.id, userId: r.user_id, date: r.date, title: r.title, exercises: r.exercises, notes: r.notes });
          const lw = await db.getAll<WorkoutSession>('workouts');
          await syncWorkoutsToCloud(lw.filter(w => w.userId === currentUserId));
        })(),

        // 2. 同步体重 (Weight) - ✅ 改进：智能合并策略
        (async () => {
          const rWeight = await fetchWeightFromCloud();
          const lWeight = await db.getAll<WeightEntry>('weightLogs');
          const localUserWeight = lWeight.filter(w => w.userId === currentUserId);
          
          // 智能合并：只添加本地不存在的云端数据
          if (rWeight) {
            for (const r of rWeight) {
              const existsLocally = localUserWeight.find(l => l.id === r.id);
              if (!existsLocally) {
                // 只有本地不存在的记录才从云端添加
                await db.save('weightLogs', { 
                  id: r.id, 
                  userId: r.user_id, 
                  weight: r.weight, 
                  date: r.date, 
                  unit: r.unit 
                });
              }
            }
          }
          
          // 上传本地数据到云端（保持原有逻辑）
          await syncWeightToCloud(localUserWeight);
        })(),

        // 3. 同步身体指标 (Measurements) - ✅ 改进：智能合并策略
        (async () => {
          const rMeasures = await fetchMeasurementsFromCloud();
          const lMeasures = await db.getAll<Measurement>('custom_metrics');
          const localUserMeasures = lMeasures.filter(m => m.userId === currentUserId);
          
          // 智能合并：只添加本地不存在的云端数据
          if (rMeasures) {
            for (const r of rMeasures) {
              const existsLocally = localUserMeasures.find(l => l.id === r.id);
              if (!existsLocally) {
                // 只有本地不存在的记录才从云端添加
                await db.save('custom_metrics', { 
                  id: r.id, 
                  userId: r.user_id, 
                  name: r.name, 
                  value: r.value, 
                  unit: r.unit, 
                  date: r.date 
                });
              }
            }
          }
          
          // 上传本地数据到云端（保持原有逻辑）
          await syncMeasurementsToCloud(localUserMeasures);
        })(),

        // 4. 同步训练目标 (Goals)
        (async () => {
          const rg = await fetchGoalsFromCloud();
          if (rg) {
            for (const r of rg) {
              const now = new Date().toISOString();
              // ✅ 修复：创建完整的Goal对象以符合新接口
              const goal: Goal = {
                id: r.id,
                userId: r.user_id,
                type: r.type,
                category: r.type, // 使用type作为默认category
                
                // 基本信息
                title: r.label || r.title || 'Untitled Goal',
                description: r.description || '',
                
                // 目标设置
                targetValue: r.target_value,
                currentValue: r.current_value,
                unit: r.unit,
                
                // 时间设置
                startDate: r.start_date || now,
                targetDate: r.target_date,
                
                // 数据源配置
                dataSource: r.data_source || 'manual',
                autoUpdateRule: r.auto_update_rule,
                
                // 进度追踪
                progressHistory: r.progress_history || [],
                
                // 设置选项
                isActive: r.is_active !== undefined ? r.is_active : true,
                
                // 元数据
                createdAt: r.created_at || now,
                updatedAt: r.updated_at || now,
                completedAt: r.completed_at,
                
                // 兼容旧版本
                label: r.label, // 保持向后兼容
                deadline: r.deadline
              };
              await db.save('goals', goal);
            }
          }
          const lg = await db.getAll<Goal>('goals');
          await syncGoalsToCloud(lg.filter(g => g.userId === currentUserId));
        })(),

        // 5. 同步个性化配置 (备注、偏好、自定义动作/标签、维度设置)
        (async () => {
          const remoteConfig = await fetchUserConfigsFromCloud();
          
          // A. 先读取当前本地最真实的数据作为基准
          const localTags = JSON.parse(localStorage.getItem('fitlog_custom_tags') || '[]');
          const localExs = JSON.parse(localStorage.getItem('fitlog_custom_exercises') || '[]');
          const localNotes = JSON.parse(localStorage.getItem('fitlog_exercise_notes') || '{}');
          const localRest = JSON.parse(localStorage.getItem('fitlog_rest_prefs') || '{}');
          const localStarred = JSON.parse(localStorage.getItem('fitlog_starred_exercises') || '{}');
          const localMetricConfigs = JSON.parse(localStorage.getItem('fitlog_metric_configs') || '{}');

          // B. 初始化"最终版本"变量（默认先用本地的）
          let finalTags = localTags;
          let finalExs = localExs;
          let finalNotes = localNotes;
          let finalRest = localRest;
          let finalStarred = localStarred;
          let finalMetricConfigs = localMetricConfigs;

          // C. 如果云端有数据，进行合并/覆盖
          if (remoteConfig) {
            if (remoteConfig.customTags?.length > 0) finalTags = remoteConfig.customTags;
            if (remoteConfig.customExercises?.length > 0) finalExs = remoteConfig.customExercises;
            if (remoteConfig.exerciseNotes) finalNotes = remoteConfig.exerciseNotes;
            if (remoteConfig.restPrefs) finalRest = remoteConfig.restPrefs;
            
            // ✅ 修复星标数据同步Bug: 使用时间戳智能合并，避免覆盖用户最新操作
            const localStarredTimestamp = parseInt(localStorage.getItem('fitlog_starred_last_update') || '0');
            const remoteStarredTimestamp = remoteConfig.starredTimestamp || 0;
            
            if (remoteConfig.starred && Object.keys(remoteConfig.starred).length > 0) {
              if (remoteStarredTimestamp > localStarredTimestamp) {
                // 云端数据更新，使用云端数据
                finalStarred = remoteConfig.starred;
                console.log('使用云端星标数据（更新）');
              } else {
                console.log('保留本地星标数据（更新）');
                // 保持本地配置不变
              }
            }
            
            // ✅ 修复Metrics重置Bug: 智能合并metrics配置，避免覆盖用户最新操作
            if (remoteConfig.metricConfigs) {
              const localMetricsTimestamp = parseInt(localStorage.getItem('fitlog_metrics_last_update') || '0');
              const remoteMetricsTimestamp = remoteConfig.metricsTimestamp || 0;
              
              // 只有当云端数据更新时才覆盖本地配置
              if (remoteMetricsTimestamp > localMetricsTimestamp) {
                finalMetricConfigs = remoteConfig.metricConfigs;
                console.log('使用云端metrics配置（更新）');
              } else {
                console.log('保留本地metrics配置（更新）');
                // 保持本地配置不变
              }
            }

            // D. 同步更新 React 内存状态
            setCustomTags(finalTags);
            setCustomExercises(finalExs);
            setExerciseNotes(finalNotes);
            setRestPreferences(finalRest);
            setStarredExercises(finalStarred);
            setExerciseMetricConfigs(finalMetricConfigs);

            // E. 同步写入本地持久化存储
            localStorage.setItem('fitlog_custom_tags', JSON.stringify(finalTags));
            localStorage.setItem('fitlog_custom_exercises', JSON.stringify(finalExs));
            localStorage.setItem('fitlog_exercise_notes', JSON.stringify(finalNotes));
            localStorage.setItem('fitlog_rest_prefs', JSON.stringify(finalRest));
            localStorage.setItem('fitlog_starred_exercises', JSON.stringify(finalStarred));
            localStorage.setItem('fitlog_metric_configs', JSON.stringify(finalMetricConfigs));
          }
          
          // F. ✅ 最终一步：将这个"终极合并版"配置上传回云端，实现多端对齐
          await syncUserConfigsToCloud({
            exerciseNotes: finalNotes,
            restPrefs: finalRest,
            customTags: finalTags,
            starred: finalStarred,
            starredTimestamp: parseInt(localStorage.getItem('fitlog_starred_last_update') || Date.now().toString()),
            customExercises: finalExs,
            metricConfigs: finalMetricConfigs,
            metricsTimestamp: parseInt(localStorage.getItem('fitlog_metrics_last_update') || Date.now().toString())
          });
        })()
      ]);

      await loadLocalData(currentUserId);
      setSyncStatus('idle');
    } catch (e: any) {
      console.error("Sync Failure:", e.message);
      setSyncStatus('error');
    } finally {
      // ✅ 修复Bug #5: 无论成功失败，都要释放同步锁
      syncLockRef.current = false;
    }
  };
  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault(); setIsLoading(true); setAuthError(null);
    try {
      const res = authMode === 'register' 
        ? await supabase.auth.signUp({ email, password, options: { emailRedirectTo: 'https://fit.myronhub.com', data: { display_name: username } } }) 
        : await supabase.auth.signInWithPassword({ email, password });
      
      if (res.error) throw res.error;
      if (res.data.user) {
        const u = { id: res.data.user.id, username: res.data.user.user_metadata?.display_name || email.split('@')[0], email, avatarUrl: res.data.user.user_metadata?.avatar_url };
        setUser(u); 
        localStorage.setItem('fitlog_current_user', JSON.stringify(u)); 
        await performFullSync(u.id);
      }
    } catch (err: any) { setAuthError(err.message); } finally { setIsLoading(false); }
  };

// 处理忘记密码（发送重置邮件）
  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true); 
    setAuthError(null);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        // ✅ 必须改为你的正式域名，这样邮件里的链接才是对的
        redirectTo: 'https://fit.myronhub.com', 
      });
      if (error) throw error;
      
      alert(lang === Language.CN ? '重置邮件已发送，请检查邮箱！' : 'Reset email sent, please check your inbox!');
      setAuthMode('login');
    } catch (err: any) {
      setAuthError(err.message);
    } finally {
      setIsLoading(false);
    }
  };


const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();

    // 1. 基础验证
    if (!password || password.length < 6) {
      setAuthError(lang === Language.CN ? '密码至少需要6位' : 'Password min 6 chars');
      return;
    }

    setIsLoading(true);
    setAuthError(null);

    try {
      // 2. 执行更新
      const { error } = await supabase.auth.updateUser({ password: password });
      if (error) throw error;

      // 3. 成功逻辑：只更新 UI，不进行跳转或登出
      setIsUpdateSuccess(true); 
      setPassword(''); 
      
      // 注意：这里不要重置 isLoading(false)，
      // 这里的逻辑是：如果成功，isUpdateSuccess 为 true 会直接替换掉整个 Form 表单，
      // 所以 loading 状态自然消失。
      // 但为了保险（如下面的 finally），我们还是会处理它。

    } catch (err: any) {
      setAuthError(err.message);
    } finally {
      // ✅ 强制停止转圈：无论成功失败，必须执行
      setIsLoading(false);
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

  const handleSaveWorkout = async () => {
    // ✅ 修复问题7: 添加保存状态反馈
    setSaveStatus('saving');
    setHasUnsavedChanges(false);
    
    try {
      // ✅ 新增校验：如果一个动作都没有，或者所有动作都没有填组数，就不保存
      if (!currentWorkout.exercises || currentWorkout.exercises.length === 0) {
        alert(lang === Language.CN ? "请至少添加一个动作" : "Please add at least one exercise");
        setSaveStatus('error');
        return;
      }

      // 检查是否所有动作都有至少一组数据 (可选)
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
      
      const session: WorkoutSession = { 
        ...currentWorkout, 
        id: currentWorkout.id || Date.now().toString(), 
        userId: user.id, 
        title: currentWorkout.title || `Workout ${new Date().toLocaleDateString()}`, 
        date: currentWorkout.date || new Date().toISOString() 
      } as WorkoutSession;
      
      await db.save('workouts', session);
      await loadLocalData(user.id); 
      
      // ✅ 修复问题7: 显示保存成功状态
      setSaveStatus('saved');
      
      // 2秒后自动跳转到dashboard
      setTimeout(() => {
        setActiveTab('dashboard'); 
        setCurrentWorkout({ title: '', exercises: [], date: new Date().toISOString() });
        setSaveStatus('idle');
      }, 2000);
      
      if (user.id !== 'u_guest') {
        try { 
          await syncWorkoutsToCloud([session]); 
        } catch (err) { 
          console.warn("Sync failed"); 
        }
      }
    } catch (error) {
      console.error('Save workout failed:', error);
      setSaveStatus('error');
      alert(lang === Language.CN ? "保存失败，请重试" : "Save failed, please try again");
    }
  };

  // ✅ 修复问题7: 监听训练数据变化，标记未保存状态
  useEffect(() => {
    if (currentWorkout.exercises && currentWorkout.exercises.length > 0) {
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
        console.log('Deleted entire workout (was empty after removing exercise)');
        
        // 直接更新内存状态
        setWorkouts(prev => prev.filter(w => w.id !== workoutId));
      } else {
        // 4. 否则更新训练记录
        const updatedWorkout = { 
          ...workout, 
          exercises: updatedExercises,
          userId: workout.userId // 确保 userId 存在
        };
        await db.save('workouts', updatedWorkout);
        console.log('Updated workout after removing exercise:', workoutId);
        
        // 直接更新内存状态
        setWorkouts(prev => prev.map(w => 
          w.id === workoutId ? updatedWorkout : w
        ));
      }
      
      // 5. 同步到云端
      if (user && user.id !== 'u_guest') {
        performFullSync(user.id);
      }
      
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
      // 1. 从本地数据库删除
      await db.delete('workouts', workoutId);
      
      // 2. 更新内存状态 (这会自动触发热力图和统计数字更新)
      setWorkouts(prev => prev.filter(w => w.id !== workoutId));

      // 3. 同步到云端
      if (user && user.id !== 'u_guest') {
        await deleteWorkoutFromCloud(workoutId);
      }

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
      console.log('开始重置账户数据...');
      
      // 1. 清除云端数据 (如果不是访客用户)
      if (user.id !== 'u_guest') {
        console.log('清除云端数据...');
        
        // 删除云端训练记录
        const cloudWorkouts = workouts.filter(w => w.userId === user.id);
        for (const workout of cloudWorkouts) {
          try {
            await deleteWorkoutFromCloud(workout.id);
          } catch (e) {
            console.warn('删除云端训练记录失败:', workout.id, e);
          }
        }
        
        // 清除云端其他数据 (通过同步空数据实现)
        try {
          await syncGoalsToCloud([]);
          await syncWeightToCloud([]);
          await syncMeasurementsToCloud([]);
          await syncUserConfigsToCloud({
            customTags: [],
            customExercises: [],
            exerciseNotes: {},
            restPrefs: {},
            starredExercises: {},
            metricConfigs: {},
            exerciseOverrides: {},
            tagRenameOverrides: {}
          });
        } catch (e) {
          console.warn('清除云端配置数据失败:', e);
        }
      }
      
      // 2. 清除本地数据库
      console.log('清除本地数据库...');
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
      
      // 4. 重置内存状态到初始值
      console.log('重置内存状态...');
      setWorkouts([]);
      setGoals([]);
      setWeightEntries([]);
      setMeasurements([]);
      setCustomTags([]);
      setCustomExercises([]);
      setExerciseNotes({});
      setRestPreferences({});
      setExerciseMetricConfigs({});
      setStarredExercises({});
      setExerciseOverrides({});
      setTagRenameOverrides({});
      setCurrentWorkout({ title: '', exercises: [], date: new Date().toISOString() });
      
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
    await loadLocalData(user.id);
    setShowGoalModal(false);
    if (user.id !== 'u_guest') {
       try { await syncGoalsToCloud([goal]); } catch (err) { console.warn("Sync failed"); }
    }
  };

  // ✅ 新增：编辑目标处理函数
  const handleEditGoal = (goal: Goal) => {
    setEditingGoal(goal);
    setShowEditGoalModal(true);
  };

  // ✅ 新增：保存编辑后的目标
  const handleSaveEditedGoal = async () => {
    if (!editingGoal || !user) return;
    
    const updatedGoal: Goal = {
      ...editingGoal,
      updatedAt: new Date().toISOString()
    };
    
    await db.save('goals', updatedGoal);
    await loadLocalData(user.id);
    setShowEditGoalModal(false);
    if (user.id !== 'u_guest') {
       try { await syncGoalsToCloud([updatedGoal]); } catch (err) { console.warn("Sync failed"); }
    }
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
    const isLatest = weightEntries.length === 0 || new Date(dateToUse).getTime() >= new Date(weightEntries[0].date).getTime();
    if (isLatest) {
      const weightGoals = goals.filter(g => g.type === 'weight');
      for (const g of weightGoals) {
        const updatedGoal = { ...g, currentValue: w };
        await db.save('goals', updatedGoal);
      }
    }
    await loadLocalData(user.id);
    setWeightInputValue('');
    setEditingWeightId(null);
    setShowWeightInput(false);
    setSelectedPRProject('__WEIGHT__');
  };
  // --- 新增：删除体重记录函数 ---
  const handleDeleteWeightEntry = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation(); // 防止误触
    
    // 确认弹窗
    //const confirmText = lang === Language.CN ? '确定要删除这条记录吗？' : 'Delete this entry?';
    //if (!window.confirm(confirmText)) return;

    try {
      // 1. 从本地数据库删除
      await db.delete('weightLogs', id);
      
      // 2. 从云端删除（如果用户已登录且不是访客）
      if (user && user.id !== 'u_guest') {
        try {
          await deleteWeightFromCloud(id);
        } catch (cloudError) {
          console.warn('云端删除失败，但本地删除成功:', cloudError);
          // 本地删除成功，云端删除失败时不阻止操作
          // 下次同步时会处理这种不一致情况
        }
      }
      
      // 3. 更新界面状态
      setWeightEntries(prev => prev.filter(entry => entry.id !== id));
      
      // 4. 刷新本地数据以更新顶部大数字
      if (user) loadLocalData(user.id);
      
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
      setIsLoading(true);

      // 1. ✅ 路径纯净化：直接用用户 ID，不加 .png 或 .jpg
      const filePath = `${user.id}`; 

      // 2. ✅ 执行上传：强制开启 upsert 覆盖模式
      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(filePath, file, {
          upsert: true,
          contentType: file.type // 确保文件类型正确
        });

      if (uploadError) throw uploadError;

      // 3. ✅ 使用官方方法获取纯净 URL，再手动加上时间戳防止缓存
      const { data: { publicUrl: rawUrl } } = supabase.storage
        .from('avatars')
        .getPublicUrl(filePath);
      
      const publicUrlWithCacheBuster = `${rawUrl}?v=${Date.now()}`;

      // 4. 立即更新本地状态
      const updatedUser = { ...user, avatarUrl: publicUrlWithCacheBuster };
      setUser(updatedUser);
      localStorage.setItem('fitlog_current_user', JSON.stringify(updatedUser));

      // 5. 后台静默更新数据库元数据
      supabase.auth.updateUser({
        data: { avatar_url: publicUrlWithCacheBuster }
      });

    } catch (error: any) {
      console.error("Upload error:", error);
      alert('上传失败: ' + error.message);
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
      setIsLoading(false);
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
      // ✅ 修复：记录星标更新时间戳，用于智能合并
      localStorage.setItem('fitlog_starred_last_update', Date.now().toString());
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
    const categoryToFilter = activeLibraryCategory || 'STRENGTH';
    
    const all = allBase
      .map(ex => exerciseOverrides[ex.id] ? { ...ex, ...exerciseOverrides[ex.id] } : ex)
      // ✅ 新增：过滤掉被标记为隐藏的动作
      .filter(ex => !exerciseOverrides[ex.id]?.hidden) 
      .filter(ex => (ex.category || 'STRENGTH') === categoryToFilter);

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

    // ✅ 修复Bug #5: 删除动作是重要操作，使用立即同步
    if (user && user.id !== 'u_guest') {
      performFullSync(user.id);
    }
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

    // 2. ✅ 关键：如果是正式用户，立刻触发同步，确保云端名称也更新
    // ✅ 修复Bug #5: 重命名动作是重要操作，使用立即同步
    if (user && user.id !== 'u_guest') {
      // 我们通过 performFullSync 将更新后的 exerciseOverrides (包含在 user_configs 中) 上传
      performFullSync(user.id);
    }

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
  const renderSetCapsule = (s: any, exerciseName: string, exercise?: Exercise) => {
    const metrics = getActiveMetrics(exerciseName);
    
    return (
      <SetCapsule
        set={s}
        exerciseName={exerciseName}
        exercise={exercise}
        metrics={metrics}
        unit={unit}
        lang={lang}
      />
    );
  };


  return (
    <div className="min-h-screen pb-32 bg-slate-900 text-slate-100 font-sans selection:bg-blue-500/30">
      
      {showWeightInput && (
        <div className="fixed inset-0 z-[70] bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-6 animate-in fade-in">
           <div className="bg-slate-900 border border-slate-800 w-full max-sm rounded-[2.5rem] p-8 space-y-6 shadow-2xl">
              <div className="flex justify-between items-center">
                <h2 className="text-2xl font-black">{editingWeightId ? (lang === Language.CN ? '编辑体重记录' : 'Edit Weight Entry') : translations.logWeight[lang]}</h2>
                <button onClick={() => { setShowWeightInput(false); setEditingWeightId(null); setWeightInputValue(''); }}><X size={20}/></button>
              </div>
              <div className="space-y-4">
                 <div className="relative group">
                    <Scale className="absolute left-6 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-blue-500" size={24} />
                    <input type="number" step="0.1" className="w-full bg-slate-800 border border-slate-700 rounded-2xl py-6 pl-16 pr-20 text-2xl font-black outline-none focus:ring-2 focus:ring-blue-500" value={weightInputValue} onChange={e => setWeightInputValue(e.target.value)} placeholder="0.0" autoFocus />
                    <span className="absolute right-6 top-1/2 -translate-y-1/2 text-slate-500 font-black text-xl uppercase">{unit}</span>
                 </div>
              </div>
              <button onClick={handleLogWeight} className="w-full bg-blue-600 py-5 rounded-2xl font-black text-lg shadow-xl shadow-blue-600/20 active:scale-95 transition-all">{translations.confirm[lang]}</button>
           </div>
        </div>
      )}
      {/* 新增：自定义指标录入弹窗 */}
      {showMeasureModal && (
        <div className="fixed inset-0 z-[70] bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-6 animate-in fade-in">
           <div className="bg-slate-900 border border-slate-800 w-full max-sm rounded-[2.5rem] p-8 space-y-6 shadow-2xl">
              <div className="flex justify-between items-center">
                <h2 className="text-2xl font-black">
                  {editingMeasurementId 
                    ? (lang === Language.CN ? '修改记录' : 'Edit Entry') 
                    : (lang === Language.CN ? '记录身体指标' : 'Track Metric')}
                </h2>
                <button onClick={() => setShowMeasureModal(false)}><X size={20}/></button>
              </div>
              <div className="space-y-4">
                 {/* 名称输入 */}
                 <div className="space-y-2">
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">{lang === Language.CN ? '指标名称 (如: 腰围)' : 'Metric Name (e.g. Waist)'}</label>
                    <input className="w-full bg-slate-800 border border-slate-700 rounded-2xl py-4 px-6 outline-none focus:ring-2 focus:ring-blue-500" 
                      value={measureForm.name} 
                      onChange={e => setMeasureForm({...measureForm, name: e.target.value})} 
                      placeholder={lang === Language.CN ? '输入名称...' : 'Enter name...'} 
                    />
                 </div>
                 
                 {/* 数值与单位 */}
                 <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">{lang === Language.CN ? '数值' : 'Value'}</label>
                        <input type="number" className="w-full bg-slate-800 border border-slate-700 rounded-2xl py-4 px-6 outline-none focus:ring-2 focus:ring-blue-500" 
                          value={measureForm.value} 
                          onChange={e => setMeasureForm({...measureForm, value: e.target.value})} 
                          placeholder="0.0" 
                        />
                    </div>
                    <div className="space-y-2">
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">{lang === Language.CN ? '单位' : 'Unit'}</label>
                        <input className="w-full bg-slate-800 border border-slate-700 rounded-2xl py-4 px-6 outline-none focus:ring-2 focus:ring-blue-500" 
                          value={measureForm.unit} 
                          onChange={e => setMeasureForm({...measureForm, unit: e.target.value})} 
                          placeholder="cm" 
                        />
                    </div>
                 </div>
              </div>
              <button onClick={handleSaveMeasurement} className="w-full bg-blue-600 py-5 rounded-2xl font-black text-lg shadow-xl shadow-blue-600/20 active:scale-95 transition-all">{translations.confirm[lang]}</button>
           </div>
        </div>
      )}

      {/* ✅ 新增：自定义日期时间选择器弹窗 */}
      {showTimePickerModal && (
        <div className="fixed inset-0 z-[70] bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-6 animate-in fade-in">
           <div className="bg-slate-900 border border-slate-800 w-full max-w-md rounded-[2.5rem] p-8 space-y-6 shadow-2xl">
              <div className="flex justify-between items-center">
                <h2 className="text-2xl font-black">
                  {lang === 'cn' ? '设置训练时间' : 'Set Exercise Time'}
                </h2>
                <button onClick={() => setShowTimePickerModal(null)}>
                  <X size={20}/>
                </button>
              </div>
              
              {/* 日期选择器 */}
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">
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
                      className="p-2 hover:bg-slate-800 rounded-lg transition-colors"
                    >
                      <ChevronLeft size={20} className="text-slate-400" />
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
                      className="p-2 hover:bg-slate-800 rounded-lg transition-colors"
                    >
                      <ChevronRight size={20} className="text-slate-400" />
                    </button>
                  </div>
                  
                  {/* 星期标题 */}
                  <div className="grid grid-cols-7 gap-1 mb-2">
                    {translations.weekdayNames[lang].map((day, idx) => (
                      <div key={idx} className="text-center text-xs font-bold text-slate-500 py-2">
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
                              ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/30' 
                              : isTodayDate
                                ? 'bg-slate-700 text-blue-400 border border-blue-500/30'
                                : 'hover:bg-slate-800 text-slate-300'
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
                    className="flex-1 px-4 py-2 bg-slate-800 border border-slate-700 rounded-xl text-sm font-bold hover:bg-slate-700 transition-colors"
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
                    className="flex-1 px-4 py-2 bg-slate-800 border border-slate-700 rounded-xl text-sm font-bold hover:bg-slate-700 transition-colors"
                  >
                    {translations.yesterday[lang]}
                  </button>
                </div>
                
                {/* 时间选择器 */}
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                    {translations.selectTime[lang]}
                  </label>
                  
                  <div className="flex gap-4 items-center justify-center">
                    {/* 小时选择 */}
                    <div className="flex flex-col items-center space-y-2">
                      <button 
                        onClick={() => setSelectedHour((selectedHour + 1) % 24)}
                        className="p-2 hover:bg-slate-800 rounded-lg transition-colors"
                      >
                        <ChevronUp size={20} className="text-slate-400" />
                      </button>
                      
                      <div className="bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 min-w-[60px] text-center">
                        <div className="text-2xl font-bold text-white">
                          {selectedHour.toString().padStart(2, '0')}
                        </div>
                        <div className="text-xs text-slate-500 font-bold">
                          {translations.hour[lang]}
                        </div>
                      </div>
                      
                      <button 
                        onClick={() => setSelectedHour(selectedHour === 0 ? 23 : selectedHour - 1)}
                        className="p-2 hover:bg-slate-800 rounded-lg transition-colors"
                      >
                        <ChevronDown size={20} className="text-slate-400" />
                      </button>
                    </div>
                    
                    <div className="text-2xl font-bold text-slate-500">:</div>
                    
                    {/* 分钟选择 */}
                    <div className="flex flex-col items-center space-y-2">
                      <button 
                        onClick={() => setSelectedMinute((selectedMinute + 5) % 60)}
                        className="p-2 hover:bg-slate-800 rounded-lg transition-colors"
                      >
                        <ChevronUp size={20} className="text-slate-400" />
                      </button>
                      
                      <div className="bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 min-w-[60px] text-center">
                        <div className="text-2xl font-bold text-white">
                          {selectedMinute.toString().padStart(2, '0')}
                        </div>
                        <div className="text-xs text-slate-500 font-bold">
                          {translations.minute[lang]}
                        </div>
                      </div>
                      
                      <button 
                        onClick={() => setSelectedMinute(selectedMinute === 0 ? 55 : selectedMinute - 5)}
                        className="p-2 hover:bg-slate-800 rounded-lg transition-colors"
                      >
                        <ChevronDown size={20} className="text-slate-400" />
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
                      className="px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-xs font-bold hover:bg-slate-700 transition-colors"
                    >
                      {lang === 'cn' ? '现在' : 'Now'}
                    </button>
                    <button 
                      onClick={() => {
                        setSelectedHour(8);
                        setSelectedMinute(0);
                      }}
                      className="px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-xs font-bold hover:bg-slate-700 transition-colors"
                    >
                      {lang === 'cn' ? '早上8点' : '8:00 AM'}
                    </button>
                    <button 
                      onClick={() => {
                        setSelectedHour(18);
                        setSelectedMinute(0);
                      }}
                      className="px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-xs font-bold hover:bg-slate-700 transition-colors"
                    >
                      {lang === 'cn' ? '晚上6点' : '6:00 PM'}
                    </button>
                  </div>
                </div>
                
                {/* 当前选择预览 */}
                <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4">
                  <div className="text-xs font-bold text-slate-500 mb-1">
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
                  className="flex-1 bg-slate-800 py-4 rounded-2xl font-black text-slate-400"
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
                  className="flex-1 bg-blue-600 py-4 rounded-2xl font-black"
                >
                  {lang === 'cn' ? '确定' : 'Confirm'}
                </button>
              </div>
           </div>
        </div>
      )}

      {showAddTagModal && (
        <div className="fixed inset-0 z-[70] bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-6 animate-in fade-in">
           <div className="bg-slate-900 border border-slate-800 w-full max-sm rounded-[2rem] p-8 space-y-6 shadow-2xl">
              {/* ... content ... */}
               <div className="flex justify-between items-center mb-2">
                <h2 className="text-xl font-black">{translations.addCustomTag[lang]}</h2>
                <button onClick={() => setShowAddTagModal(false)}><X size={20}/></button>
              </div>
              <div className="flex gap-2 p-1 bg-slate-800 rounded-xl mb-4">
                {['bodyPart', 'equipment'].map(cat => (
                  <button key={cat} onClick={() => setNewTagCategory(cat as 'bodyPart' | 'equipment')} className={`flex-1 py-2 rounded-lg text-[10px] font-black uppercase transition-all ${newTagCategory === cat ? 'bg-blue-600 text-white shadow-md' : 'text-slate-500'}`}>{cat === 'bodyPart' ? translations.bodyPartHeader[lang] : translations.equipmentHeader[lang]}</button>
                ))}
              </div>
              <input className="w-full bg-slate-800 border border-slate-700 rounded-2xl py-4 px-6 outline-none focus:ring-2 focus:ring-blue-500" value={newTagName} onChange={e => setNewTagName(e.target.value)} placeholder={translations.tagNamePlaceholder[lang]} />
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

                // 更新状态
                setCustomTags(updatedTags); 
                setShowAddTagModal(false); 
                setNewTagName(''); 

                // ✅ 发起后台同步，但不阻断 UI
                if (user && user.id !== 'u_guest') {
                  syncUserConfigsToCloud({
                    exerciseNotes,
                    restPrefs: restPreferences,
                    customTags: updatedTags, // 直接传最新的
                    starred: starredExercises,
                    customExercises
                  });
                }
              }} 
              className="..."
            >
              {translations.confirm[lang]}
            </button>
           </div>
        </div>
      )}

      {showRenameModal && (
         <div className="fixed inset-0 z-[75] bg-slate-950/90 backdrop-blur-md flex items-center justify-center p-6 animate-in fade-in">
           <div className="bg-slate-900 border border-slate-800 w-full max-sm rounded-[2rem] p-8 space-y-6 shadow-2xl">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-black">{lang === Language.CN ? '重命名标签' : 'Rename Tag'}</h2>
                <button onClick={() => setShowRenameModal(false)} className="p-2 hover:bg-slate-800 rounded-full transition-colors">
                  <X size={20} className="text-slate-400" />
                </button>
              </div>
              <h2 className="text-xl font-black">{translations.editTags[lang]}</h2>
              <input className="w-full bg-slate-800 border border-slate-700 rounded-2xl py-4 px-6 outline-none focus:ring-2 focus:ring-blue-500" value={newTagNameInput} onChange={e => setNewTagNameInput(e.target.value)} placeholder={tagToRename?.name} />
              <div className="flex gap-4">
                <button onClick={() => setShowRenameModal(false)} className="flex-1 bg-slate-800 py-4 rounded-2xl font-black text-slate-400">{lang === Language.CN ? '取消' : 'Cancel'}</button>
                <button onClick={handleRenameTag} className="flex-1 bg-blue-600 py-4 rounded-2xl font-black">{translations.confirm[lang]}</button>
              </div>
           </div>
        </div>
      )}

       {showRenameExerciseModal && (
        <div className="fixed inset-0 z-[75] bg-slate-950/90 backdrop-blur-md flex items-center justify-center p-6 animate-in fade-in">
           <div className="bg-slate-900 border border-slate-800 w-full max-sm rounded-[2rem] p-8 space-y-6 shadow-2xl">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-black">{lang === Language.CN ? '重命名动作' : 'Rename Exercise'}</h2>
                <button onClick={() => setShowRenameExerciseModal(false)} className="p-2 hover:bg-slate-800 rounded-full transition-colors">
                  <X size={20} className="text-slate-400" />
                </button>
              </div>
              <input className="w-full bg-slate-800 border border-slate-700 rounded-2xl py-4 px-6 outline-none focus:ring-2 focus:ring-blue-500" value={newExerciseNameInput} onChange={e => setNewExerciseNameInput(e.target.value)} placeholder={exerciseToRename?.name} />
              <div className="flex gap-4">
                <button onClick={() => setShowRenameExerciseModal(false)} className="flex-1 bg-slate-800 py-4 rounded-2xl font-black text-slate-400">{lang === Language.CN ? '取消' : 'Cancel'}</button>
                <button onClick={handleRenameExercise} className="flex-1 bg-blue-600 py-4 rounded-2xl font-black">{translations.confirm[lang]}</button>
              </div>
           </div>
        </div>
      )}

      {showAddExerciseModal && (
         <div className="fixed inset-0 z-[70] bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-6 animate-in fade-in">
           <div className="bg-slate-900 border border-slate-800 w-full max-md rounded-[2.5rem] p-8 space-y-6 shadow-2xl overflow-y-auto max-h-[90vh] custom-scrollbar">
              {/* 优化后的标题区域 */}
              <div className="flex justify-between items-center mb-4">
                <div className="flex items-center gap-3">
                  <div className="p-3 bg-indigo-500/20 rounded-xl">
                    <Zap size={24} className="text-indigo-400" />
                  </div>
                  <div>
                    <h2 className="text-xl font-black">{translations.addCustomExercise[lang]}</h2>
                    <p className="text-xs text-slate-500 font-bold">
                      {lang === Language.CN ? '创建专属动作' : 'Create Custom Exercise'}
                    </p>
                  </div>
                </div>
                <button 
                  onClick={() => setShowAddExerciseModal(false)} 
                  className="p-2 hover:bg-slate-800 rounded-full transition-colors"
                >
                  <X size={20} className="text-slate-400" />
                </button>
              </div>
              {/* ✅ 找回丢失的动作名称输入框 */}
              <div className="space-y-2 mt-4">
                 <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest px-1">
                    {lang === Language.CN ? '动作名称' : 'Exercise Name'}
                 </label>
                 <input 
                   className="w-full bg-slate-800 border border-slate-700 rounded-2xl py-4 px-6 text-white outline-none focus:ring-2 focus:ring-blue-500 transition-all" 
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
                      className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase transition-all ${newExerciseBodyPart === id ? 'bg-blue-600 text-white shadow-lg' : 'bg-slate-800 text-slate-500 hover:bg-slate-700'}`}
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
                      className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase transition-all ${newExerciseTags.includes(id) ? 'bg-indigo-600 text-white shadow-lg' : 'bg-slate-800 text-slate-500 hover:bg-slate-700'}`}
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

                  // ✅ 修复Bug #5: 创建新动作是重要操作，使用立即同步
                  if (user && user.id !== 'u_guest') {
                    performFullSync(user.id);
                  }
                }}
                className="w-full bg-blue-600 py-5 rounded-3xl font-black text-lg shadow-xl shadow-blue-600/20 active:scale-95 transition-all mt-4"
              >
                {translations.confirm[lang]}
              </button>
           </div>
        </div>
      )}

      {showLibrary && (
         <div className="fixed inset-0 z-[60] bg-slate-950/95 backdrop-blur-3xl p-6 flex flex-col animate-in fade-in">
          <div className="flex justify-between items-center mb-6">
            
          {/* ✅ 优化后的动态标题 - 显示搜索范围 */}
          <div className="flex flex-col">
            <h2 className="text-2xl font-black tracking-tight flex items-center gap-3">
              {/* 根据分类显示对应的图标 */}
              {activeLibraryCategory === 'STRENGTH' && <Dumbbell className="text-blue-500" size={28} />}
              {activeLibraryCategory === 'CARDIO' && <Activity className="text-orange-500" size={28} />}
              {activeLibraryCategory === 'FREE' && <Zap className="text-purple-500" size={28} />}
              {!activeLibraryCategory && <Globe className="text-emerald-500" size={28} />}

              {/* 根据分类显示对应的文字 */}
              {activeLibraryCategory === 'STRENGTH' && translations.strengthTraining[lang]}
              {activeLibraryCategory === 'CARDIO' && translations.cardioTraining[lang]}
              {activeLibraryCategory === 'FREE' && translations.freeTraining[lang]}
              {!activeLibraryCategory && (lang === Language.CN ? '全部动作' : 'All Exercises')}
              
              {lang === Language.CN ? '动作库' : ' Library'}
            </h2>
            <p className="text-xs text-slate-500 font-bold mt-1">
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
              className="px-3 py-2 bg-slate-800/50 border border-slate-700/50 rounded-xl text-xs font-bold text-slate-400 hover:text-white hover:bg-slate-700 transition-all"
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
                  : 'bg-slate-800/50 border-slate-700/50 text-slate-400 hover:text-white hover:bg-slate-700'
              }`}
            >
              {isEditingTags ? (lang === Language.CN ? '完成管理' : 'Done') : (lang === Language.CN ? '管理' : 'Manage')}
            </button>
            
            <button onClick={() => setShowLibrary(false)} className="p-3 bg-slate-800/50 hover:bg-slate-800 rounded-full transition-all border border-slate-700/50"><X size={24} /></button>
          </div>
          </div>
          
          {/* 优化后的搜索框 */}
          <div className="relative mb-6">
            <Search className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
            <input 
              className="w-full bg-slate-900 border border-slate-800 rounded-[1.5rem] py-4 pl-12 pr-8 text-base font-medium outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500/50 transition-all" 
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
              <div className="absolute right-4 top-1/2 -translate-y-1/2 px-2 py-1 bg-blue-600/20 text-blue-400 text-xs font-bold rounded-lg">
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
              className={`w-1/4 overflow-y-auto space-y-6 pr-4 border-r border-slate-800/50 custom-scrollbar transition-all ${
                isDraggingOverSidebar ? 'bg-red-500/10 border-r-red-500/50 shadow-[inset_-10px_0_20px_-10px_rgba(239,68,68,0.2)]' : ''
              }`}
            >
              
              {/* 全部标签按钮 */}
              <button 
                onClick={() => setSelectedTags([])} 
                className={`w-full text-left px-4 py-3 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${
                  selectedTags.length === 0 ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20' : 'text-slate-500 hover:bg-slate-800'
                }`}
              >
                {translations.allTags[lang]}
              </button>
              
              {/* 训练部位区域 */}
              <div className="space-y-3">
                <div className="flex justify-between items-center px-2">
                  <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] flex items-center gap-2">
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
                          selectedTags.includes(id) ? 'bg-blue-600 text-white' : 'text-slate-400 hover:bg-slate-800'
                        } ${isEditingTags ? 'hover:bg-amber-500/20' : ''}`}
                      >
                        <span>{getTagName(id)}</span>
                        {isEditingTags && <Edit2 size={12} className="text-amber-400" />}
                      </button>
                    </div>
                  ))}
                  
                  {/* 自定义部位标签 */}
                  {customTags
                    .filter(ct => ct.category === 'bodyPart' && (ct.parentCategory === activeLibraryCategory || !ct.parentCategory))
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
                            selectedTags.includes(ct.id) ? 'bg-blue-600 text-white' : 'text-slate-400 hover:bg-slate-800'
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
                <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] px-2 flex items-center gap-2">
                  <Filter size={12} /> {translations.equipmentHeader[lang]}
                </h3>
                <div className="space-y-1.5">
                  {EQUIPMENT_TAGS.filter(id => {
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
                          selectedTags.includes(id) ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:bg-slate-800'
                        } ${isEditingTags ? 'hover:bg-amber-500/20' : ''}`}
                      >
                        <span>{getTagName(id)}</span>
                        {isEditingTags && <Edit2 size={12} className="text-amber-400" />}
                      </button>
                    </div>
                  ))}
                  
                  {/* 自定义器材标签 */}
                  {customTags
                    .filter(ct => ct.category === 'equipment' && (ct.parentCategory === activeLibraryCategory || !ct.parentCategory))
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
                            selectedTags.includes(ct.id) ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:bg-slate-800'
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
              <div className="pt-6 border-t border-slate-800 space-y-3">
                <button 
                  onClick={() => setShowAddTagModal(true)} 
                  className="w-full py-3 rounded-xl text-[10px] font-black uppercase tracking-widest text-blue-400 hover:bg-blue-400/10 transition-all border border-blue-400/20 flex items-center justify-center gap-2"
                >
                  <PlusCircle size={14} /> {translations.addCustomTag[lang]}
                </button>
                <button 
                  onClick={() => setShowAddExerciseModal(true)} 
                  className="w-full py-3 rounded-xl text-[10px] font-black uppercase tracking-widest text-indigo-400 hover:bg-indigo-400/10 transition-all border border-indigo-400/20 flex items-center justify-center gap-2"
                >
                  <Zap size={14} /> {translations.addCustomExercise[lang]}
                </button>
              </div>
            </div>

            {/* ✅ 优化后的动作列表区域 */}
            <div className="w-3/4 overflow-y-auto space-y-4 custom-scrollbar pr-2 pb-20">
              {/* 动作列表标题和计数 */}
              <div className="flex justify-between items-center px-2 pb-2 border-b border-slate-800/50">
                <h3 className="text-sm font-black text-slate-300 flex items-center gap-2">
                  <Hash size={16} className="text-blue-500" />
                  {lang === Language.CN ? '动作列表' : 'Exercise List'}
                </h3>
                <span className="text-xs font-bold text-slate-500 bg-slate-800/50 px-3 py-1 rounded-lg">
                  {filteredExercises.length} {lang === Language.CN ? '个动作' : 'exercises'}
                </span>
              </div>
              
              {filteredExercises.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center opacity-20 gap-4">
                  <Search size={64} />
                  <p className="font-black text-xl">{translations.noRecords[lang]}</p>
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
                      className={`w-full p-5 bg-slate-800/30 border border-slate-700/50 rounded-[1.5rem] text-left hover:bg-slate-800 hover:border-blue-500/50 transition-all group relative overflow-hidden ${
                        isEditingTags ? 'hover:border-amber-500/50' : ''
                      }`}
                    >
                      <div className="absolute right-0 top-0 w-24 h-24 bg-blue-600/5 rounded-full blur-2xl translate-x-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity"></div>
                      
                      <div className="flex flex-col gap-3 relative z-10">
                        <div className="flex justify-between items-center">
                          <span className={`font-black text-lg transition-colors ${
                            isEditingTags ? 'text-amber-400' : 'group-hover:text-blue-400 text-white'
                          }`}>
                            {ex.name[lang]}
                          </span>
                          
                          {/* 操作按钮区域 */}
                          <div className="flex items-center gap-2">
                            {!isEditingTags && (
                              <div className="px-3 py-1 bg-blue-600/20 text-blue-400 text-xs font-bold rounded-lg opacity-0 group-hover:opacity-100 transition-opacity">
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
                              className="text-[10px] font-black uppercase bg-slate-800/80 px-3 py-1.5 rounded-xl text-slate-400 border border-slate-700/50 hover:bg-red-500/20 cursor-move transition-colors"
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
                                className="text-[10px] font-black uppercase bg-indigo-600/10 px-3 py-1.5 rounded-xl text-indigo-400 border border-indigo-500/20 hover:bg-red-500/20 cursor-move transition-colors"
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
        <div className="fixed inset-0 z-[70] bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-6 animate-in fade-in">
           <div className="bg-slate-900 border border-slate-800 w-full max-sm rounded-[2.5rem] p-8 space-y-6 shadow-2xl">
              <div className="flex justify-between items-center">
                <h2 className="text-2xl font-black">{translations.setGoal[lang]}</h2>
                <button onClick={() => setShowGoalModal(false)} className="p-2 hover:bg-slate-800 rounded-full transition-colors">
                  <X size={20} className="text-slate-400" />
                </button>
              </div>
              <div className="space-y-4">
                 <div className="flex gap-2">{['weight', 'strength', 'frequency'].map(type => <button key={type} onClick={() => setNewGoal({...newGoal, type: type as GoalType})} className={`flex-1 py-3 rounded-2xl text-[10px] font-black uppercase transition-all ${newGoal.type === type ? 'bg-blue-600' : 'bg-slate-800'}`}>{translations[`goal${type.charAt(0).toUpperCase() + type.slice(1)}`][lang]}</button>)}</div>
                 <input className="w-full bg-slate-800 border border-slate-700 rounded-2xl py-4 px-6" value={newGoal.label} onChange={e => setNewGoal({...newGoal, label: e.target.value})} placeholder={translations.goalLabelPlaceholder[lang]} />
                 <div className="grid grid-cols-2 gap-4">
                    <input type="number" className="bg-slate-800 border border-slate-700 rounded-2xl py-4 px-6" placeholder={translations.current[lang]} value={newGoal.currentValue || ''} onChange={e => setNewGoal({...newGoal, currentValue: Number(e.target.value)})} />
                    <input type="number" className="bg-slate-800 border border-slate-700 rounded-2xl py-4 px-6" placeholder={translations.target[lang]} value={newGoal.targetValue || ''} onChange={e => setNewGoal({...newGoal, targetValue: Number(e.target.value)})} />
                 </div>
              </div>
              <div className="flex gap-4">
                <button onClick={() => setShowGoalModal(false)} className="flex-1 bg-slate-800 py-4 rounded-2xl font-black text-slate-400 hover:bg-slate-700 transition-colors">
                  {lang === Language.CN ? '取消' : 'Cancel'}
                </button>
                <button onClick={handleAddGoal} className="flex-[2] bg-blue-600 py-4 rounded-2xl font-black text-white hover:bg-blue-500 transition-all shadow-lg shadow-blue-600/30 active:scale-95">
                  {translations.confirm[lang]}
                </button>
              </div>
           </div>
        </div>
      )}

      {/* ✅ 新增：编辑目标模态框 */}
      {showEditGoalModal && editingGoal && (
        <div className="fixed inset-0 z-[70] bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-6 animate-in fade-in">
           <div className="bg-slate-900 border border-slate-800 w-full max-sm rounded-[2.5rem] p-8 space-y-6 shadow-2xl">
              <div className="flex justify-between items-center">
                <h2 className="text-2xl font-black">
                  {lang === Language.CN ? '编辑目标' : 'Edit Goal'}
                </h2>
                <button onClick={handleCancelEditGoal} className="p-2 hover:bg-slate-800 rounded-full transition-colors">
                  <X size={20} className="text-slate-400" />
                </button>
              </div>
              <div className="space-y-4">
                 {/* 目标类型选择 */}
                 <div className="flex gap-2">
                   {['weight', 'strength', 'frequency'].map(type => (
                     <button 
                       key={type} 
                       onClick={() => setEditingGoal({...editingGoal, type: type as GoalType})} 
                       className={`flex-1 py-3 rounded-2xl text-[10px] font-black uppercase transition-all ${
                         editingGoal.type === type ? 'bg-blue-600' : 'bg-slate-800'
                       }`}
                     >
                       {translations[`goal${type.charAt(0).toUpperCase() + type.slice(1)}`][lang]}
                     </button>
                   ))}
                 </div>
                 
                 {/* 目标标题 */}
                 <input 
                   className="w-full bg-slate-800 border border-slate-700 rounded-2xl py-4 px-6" 
                   value={editingGoal.title || editingGoal.label || ''} 
                   onChange={e => setEditingGoal({...editingGoal, title: e.target.value, label: e.target.value})} 
                   placeholder={translations.goalLabelPlaceholder[lang]} 
                 />
                 
                 {/* 当前值和目标值 */}
                 <div className="grid grid-cols-2 gap-4">
                    <input 
                      type="number" 
                      className="bg-slate-800 border border-slate-700 rounded-2xl py-4 px-6" 
                      placeholder={translations.current[lang]} 
                      value={editingGoal.currentValue || ''} 
                      onChange={e => setEditingGoal({...editingGoal, currentValue: Number(e.target.value)})} 
                    />
                    <input 
                      type="number" 
                      className="bg-slate-800 border border-slate-700 rounded-2xl py-4 px-6" 
                      placeholder={translations.target[lang]} 
                      value={editingGoal.targetValue || ''} 
                      onChange={e => setEditingGoal({...editingGoal, targetValue: Number(e.target.value)})} 
                    />
                 </div>
                 
                 {/* 目标描述（可选） */}
                 <textarea 
                   className="w-full bg-slate-800 border border-slate-700 rounded-2xl py-4 px-6 resize-none" 
                   rows={3}
                   value={editingGoal.description || ''} 
                   onChange={e => setEditingGoal({...editingGoal, description: e.target.value})} 
                   placeholder={lang === Language.CN ? '目标描述（可选）' : 'Goal description (optional)'} 
                 />
                 
                 {/* 目标状态 */}
                 <div className="flex items-center justify-between p-4 bg-slate-800/50 rounded-2xl">
                   <span className="text-sm font-bold text-slate-300">
                     {lang === Language.CN ? '目标状态' : 'Goal Status'}
                   </span>
                   <button
                     onClick={() => setEditingGoal({...editingGoal, isActive: !editingGoal.isActive})}
                     className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                       editingGoal.isActive 
                         ? 'bg-green-600 text-white' 
                         : 'bg-slate-700 text-slate-400'
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
                <button onClick={handleCancelEditGoal} className="flex-1 bg-slate-800 py-4 rounded-2xl font-black text-slate-400 hover:bg-slate-700 transition-colors">
                  {lang === Language.CN ? '取消' : 'Cancel'}
                </button>
                <button onClick={handleSaveEditedGoal} className="flex-[2] bg-blue-600 py-4 rounded-2xl font-black text-white hover:bg-blue-500 transition-all shadow-lg shadow-blue-600/30 active:scale-95">
                  {lang === Language.CN ? '保存更改' : 'Save Changes'}
                </button>
              </div>
           </div>
        </div>
      )}

      {/* 顶部导航栏 */}
      <header className="sticky top-0 z-40 bg-slate-900/80 backdrop-blur-xl border-b border-slate-800 px-6 pb-4 pt-14 md:pt-[calc(env(safe-area-inset-top)+1.5rem)] flex justify-between items-center">
        {/* 左侧：Logo */}
        <div className="flex items-center gap-3">
          <Dumbbell className="text-blue-500" />
          <h1 className="text-xl font-black tracking-tight">{translations.appTitle[lang]}</h1>
        </div>

        {/* 右侧：同步按钮 + 单位切换 */}
        <div className="flex items-center gap-3">
          
          {/* 手动同步按钮 */}
          <button 
            onClick={() => user && performFullSync(user.id)}
            disabled={syncStatus === 'syncing' || !user || user.id === 'u_guest'}
            className={`p-2 rounded-xl border transition-all active:scale-90 ${
              syncStatus === 'error' ? 'bg-red-500/10 border-red-500/20' : 'bg-slate-800 border-slate-700/50'
            }`}
          >
            {syncStatus === 'syncing' ? (
              /* 正在同步：蓝色转圈 */
              <RefreshCw className="animate-spin text-blue-500" size={18} />
            ) : syncStatus === 'error' ? (
              /* 同步出错：红色感叹号 */
              <AlertCircle className="text-red-500" size={18} />
            ) : (
              /* 数据最新/成功：绿色对号 (使用 CheckIcon) */
              <CheckIcon className="text-green-500" size={18} strokeWidth={4} />
            )}
          </button>
          
          {/* 单位切换按钮 */}
          <button 
            // ✅ 调用刚才写好的转换函数
            onClick={handleUnitToggle} 
            className="bg-slate-800 border border-slate-700/50 px-3 py-1.5 rounded-xl text-xs font-black uppercase text-blue-500 hover:bg-slate-700 hover:text-white transition-all active:scale-95 shadow-sm"
          >
            {unit}
          </button>
        </div>
      </header>

      {(!user || authMode === 'updatePassword') ? (
        <div className="min-h-screen flex items-center justify-center p-6 bg-[#0f172a]">
          <div className="w-full max-w-md bg-slate-800/30 backdrop-blur-2xl rounded-[3rem] p-10 border border-slate-700/50 shadow-2xl relative overflow-hidden">
            <div className="absolute top-0 right-0 w-32 h-32 bg-blue-600/10 rounded-full -translate-y-1/2 translate-x-1/2 blur-2xl"></div>
            
            <div className="flex flex-col items-center mb-8">
              <div className="bg-blue-600/20 p-5 rounded-3xl mb-6 shadow-inner"><Dumbbell className="w-12 h-12 text-blue-500" /></div>
              <h1 className="text-4xl font-black text-white tracking-tight">{translations.appTitle[lang]}</h1>
              <p className="text-slate-400 mt-2 font-medium">
                {authMode === 'login' && translations.loginWelcome[lang]}
                {authMode === 'register' && translations.registerWelcome[lang]}
                {authMode === 'forgotPassword' && (lang === Language.CN ? '找回密码' : 'Reset Password')}
                {authMode === 'updatePassword' && (lang === Language.CN ? '设置新密码' : 'Set New Password')}
              </p>
            </div>

            {isUpdateSuccess ? (
              /* ✅ 情况 A：修改成功 - 显示大对勾界面 */
              <div className="flex flex-col items-center text-center py-4 space-y-6 animate-in fade-in zoom-in-95">
                <div className="bg-green-500/20 p-6 rounded-full border-4 border-green-500/30 animate-bounce">
                  <Check className="text-green-500 w-12 h-12" strokeWidth={4} />
                </div>
                <div className="space-y-2">
                  <h2 className="text-xl font-black text-white">
                    {lang === Language.CN ? '密码修改成功！' : 'Success!'}
                  </h2>
                  <p className="text-sm text-slate-400 font-medium leading-relaxed px-2">
                    {lang === Language.CN 
                      ? '您的密码已更新。请关闭此页面，返回您的健身助手 App 或浏览器重新登录。' 
                      : 'Password updated. Please close this page and go back to your App to login.'}
                  </p>
                </div>
                <button 
                  onClick={async () => { 
                    // 清理逻辑
                    try { await supabase.auth.signOut(); } catch(e) {}
                    setUser(null);
                    localStorage.removeItem('fitlog_current_user');
                    
                    // ✅ 重置 Ref 和状态
                    isRecoveryMode.current = false; 
                    setIsUpdateSuccess(false); 
                    setAuthMode('login');
                  }}
                  className="w-full bg-slate-800 ..." // ... 保持原有样式
                >
                  {lang === Language.CN ? '前往登录' : 'Go to Login'}
                </button>
              </div>
            ) : (
              /* ❌ 情况 B：正常表单 - 显示输入框和错误提示 */
              <>
                {authError && (
                  <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-2xl text-red-500 text-xs font-black flex items-center gap-3 animate-in slide-in-from-top-2">
                    <div className="p-1 bg-red-500 text-white rounded-full"><X size={12} strokeWidth={4} /></div>
                    {authError}
                  </div>
                )}

                <form onSubmit={
                  authMode === 'forgotPassword' ? handleResetPassword : 
                  authMode === 'updatePassword' ? handleUpdatePassword : 
                  handleAuth
                } className="space-y-4">
                  
                  {authMode === 'register' && (
                    <div className="relative group animate-in fade-in slide-in-from-bottom-2">
                      <UserIcon className="absolute left-6 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-blue-500 transition-colors" size={20} />
                      <input type="text" value={username} onChange={e => setUsername(e.target.value)} placeholder={translations.username[lang]} className="w-full bg-slate-900 border border-slate-700 rounded-2xl py-4 pl-14 pr-6 text-white outline-none focus:ring-2 focus:ring-blue-500 transition-all" required />
                    </div>
                  )}
                  
                  {authMode !== 'updatePassword' && (
                    <div className="relative group animate-in fade-in slide-in-from-bottom-2">
                      <Mail className="absolute left-6 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-blue-500 transition-colors" size={20} />
                      <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder={translations.email[lang]} className="w-full bg-slate-900 border border-slate-700 rounded-2xl py-4 pl-14 pr-6 text-white outline-none focus:ring-2 focus:ring-blue-500 transition-all" required />
                    </div>
                  )}

                  {authMode !== 'forgotPassword' && (
                    <div className="relative group animate-in fade-in slide-in-from-bottom-2">
                      <Lock className="absolute left-6 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-blue-500 transition-colors" size={20} />
                      <input type={showPassword ? "text" : "password"} value={password} onChange={e => setPassword(e.target.value)} placeholder={authMode === 'updatePassword' ? (lang === Language.CN ? '输入新密码' : 'New Password') : translations.password[lang]} className="w-full bg-slate-900 border border-slate-700 rounded-2xl py-4 pl-14 pr-16 text-white outline-none focus:ring-2 focus:ring-blue-500 transition-all" required />
                      <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-6 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white transition-colors">{showPassword ? <EyeOff size={20} /> : <Eye size={20} />}</button>
                    </div>
                  )}

                  {authMode === 'login' && (
                    <div className="flex justify-end">
                      <button type="button" onClick={() => setAuthMode('forgotPassword')} className="text-xs text-slate-500 hover:text-blue-400 font-bold transition-colors">
                        {lang === Language.CN ? '忘记密码？' : 'Forgot Password?'}
                      </button>
                    </div>
                  )}

                  <button type="submit" disabled={isLoading} className="w-full bg-blue-600 hover:bg-blue-500 text-white py-5 rounded-3xl font-black text-lg flex items-center justify-center gap-3 shadow-xl shadow-blue-600/20 active:scale-95 transition-all">
                    {isLoading ? <RefreshCw className="animate-spin" /> : (
                      authMode === 'register' ? translations.createAccount[lang] : 
                      authMode === 'login' ? translations.login[lang] :
                      authMode === 'forgotPassword' ? (lang === Language.CN ? '发送重置链接' : 'Send Reset Link') :
                      (lang === Language.CN ? '更新密码' : 'Update Password')
                    )}
                  </button>
                </form>
              </>
            )}

            {/* --- 替换结束，紧接着应该是 1456 行左右的底部切换链接 div --- */}

            <div className="flex flex-col gap-4 mt-8">
              {authMode === 'login' && (
                <button onClick={() => setAuthMode('register')} className="text-slate-500 text-xs font-bold hover:text-blue-400 transition-colors text-center">{translations.noAccount[lang]} <span className="text-blue-500">{translations.createAccount[lang]}</span></button>
              )}
              {authMode === 'register' && (
                <button onClick={() => setAuthMode('login')} className="text-slate-500 text-xs font-bold hover:text-blue-400 transition-colors text-center">{translations.hasAccount[lang]} <span className="text-blue-500">{translations.login[lang]}</span></button>
              )}
              {authMode === 'forgotPassword' && (
                <button onClick={() => setAuthMode('login')} className="text-slate-500 text-xs font-bold hover:text-white transition-colors text-center flex items-center justify-center gap-2">
                  <ArrowLeft size={14} /> {lang === Language.CN ? '返回登录' : 'Back to Login'}
                </button>
              )}
            </div>

            {authMode !== 'updatePassword' && (
              <>
                <div className="flex items-center my-6"><div className="flex-1 h-[1px] bg-slate-800"></div><span className="px-4 text-[10px] font-black uppercase text-slate-700 tracking-widest">{translations.orSeparator[lang]}</span><div className="flex-1 h-[1px] bg-slate-800"></div></div>
                <button onClick={async () => { const u = {id: 'u_guest', username: 'Guest', email: 'guest@fitlog.ai'}; setUser(u); localStorage.setItem('fitlog_current_user', JSON.stringify(u)); await loadLocalData('u_guest'); }} className="w-full bg-slate-800/50 text-slate-300 py-4 rounded-3xl font-bold flex items-center justify-center gap-2 hover:bg-slate-700 transition-all active:scale-90"><Zap size={18} className="text-amber-400" /> {translations.quickLogin[lang]}</button>
              </>
            )}
          </div>
        </div>
      ) : (
        <main className="max-w-2xl mx-auto p-4 md:p-8">
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
              <div className="bg-slate-800/40 p-8 rounded-[2.5rem] border border-slate-700/50">
                <input 
                  className="bg-transparent text-3xl font-black w-full outline-none" 
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
              <div className="h-[1px] flex-1 bg-slate-800"></div>
              <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em]">
                {translations.categorySelection[lang]}
              </h3>
              <div className="h-[1px] flex-1 bg-slate-800"></div>
            </div>

            {/* ✅ 优化后的分类选择区域 - 分离关注点 */}
            <div className="space-y-4">
              {/* 快速搜索区域 */}
              <div className="bg-slate-800/30 border border-slate-700/50 p-4 rounded-[2rem]">
                <div className="flex items-center gap-3 mb-3">
                  <Search className="text-slate-500" size={20} />
                  <h4 className="text-sm font-black text-slate-300">
                    {lang === Language.CN ? '快速添加动作' : 'Quick Add Exercise'}
                  </h4>
                </div>
                <div className="relative">
                  <input 
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl py-3 px-4 text-sm text-white outline-none focus:border-blue-500 transition-all"
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
                    className="absolute right-2 top-1/2 -translate-y-1/2 px-3 py-1 bg-blue-600 text-white text-xs font-bold rounded-lg hover:bg-blue-500 transition-colors"
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
                    className="group relative bg-slate-800/30 border border-slate-700/50 p-4 rounded-[1.5rem] flex items-center gap-4 hover:bg-slate-800/60 transition-all active:scale-[0.98] overflow-hidden w-full"
                  >
                    {/* 背景微光装饰 */}
                    <div className={`absolute -right-6 -top-6 w-24 h-24 bg-${cat.color}-500/5 blur-2xl rounded-full group-hover:bg-${cat.color}-500/10 transition-all`}></div>
                    
                    {/* 左侧图标 */}
                    <div className={`p-3 bg-slate-900 rounded-xl text-${cat.color}-500 shadow-inner group-hover:scale-105 transition-transform relative z-10`}>
                      {cat.icon}
                    </div>

                    {/* 右侧文字 */}
                    <div className="flex flex-col items-start relative z-10 flex-1">
                      <span className="font-black text-base tracking-tight text-white">{cat.label}</span>
                      <span className="text-[9px] font-bold text-slate-500 uppercase tracking-wider">
                        {cat.desc}
                      </span>
                    </div>

                    {/* 右侧箭头装饰 */}
                    <ChevronRight className="text-slate-600 group-hover:text-slate-400 transition-colors relative z-10" size={18} />
                  </button>
                ))}
              </div>
            </div>
            
            {/* ✅ 修复问题7&8: 改进的保存训练按钮 - 显示状态、单位确认、未保存提示 */}
            <div className="space-y-3 mt-6">
              {/* 单位提醒条 */}
              <div className="bg-slate-800/50 border border-slate-700/50 p-3 rounded-xl flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Scale size={16} className="text-slate-400" />
                  <span className="text-sm text-slate-400">
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
                className={`w-full p-6 rounded-[2rem] font-black text-lg shadow-2xl flex items-center justify-center gap-3 transition-all mt-6 ${
                  saveStatus === 'saving' 
                    ? 'bg-slate-600 cursor-not-allowed' 
                    : saveStatus === 'saved'
                    ? 'bg-green-600 shadow-green-600/30'
                    : saveStatus === 'error'
                    ? 'bg-red-600 shadow-red-600/30'
                    : 'bg-blue-600 shadow-blue-600/30 hover:bg-blue-500 active:scale-95'
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

          {/* 目标管理 - 使用 GoalsTab 组件 */}
          {activeTab === 'goals' && (
            <Suspense fallback={<div className="flex items-center justify-center min-h-[60vh]"><div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full" /></div>}>
            <GoalsTab
              goals={goals}
              setGoals={setGoals}
              lang={lang}
              onAddGoal={() => setShowGoalModal(true)}
              onEditGoal={handleEditGoal}
            />
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
              onLogout={() => { 
                supabase.auth.signOut(); 
                setUser(null); 
                localStorage.removeItem('fitlog_current_user'); 
                setWorkouts([]); 
                setGoals([]); 
                setWeightEntries([]); 
              }}
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
              onCreateAccount={() => {
                supabase.auth.signOut();
                setUser(null);
                setAuthMode('register');
                localStorage.removeItem('fitlog_current_user');
              }}
            />
            </Suspense>
          )}
        </main>
      )}

      {/* --- 新增：备注输入弹窗 --- */}
      {noteModalData && (
        <div className="fixed inset-0 z-[80] bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-6 animate-in fade-in">
          <div className="bg-slate-900 border border-slate-800 w-full max-w-sm rounded-[2.5rem] p-8 shadow-2xl">
            <h3 className="text-center text-slate-400 font-bold mb-2 text-sm">{noteModalData.name}</h3>
            <h2 className="text-center text-2xl font-black text-white mb-6">
              {lang === Language.CN ? '动作备注' : 'Exercise Note'}
            </h2>
            
            <textarea
              className="w-full bg-slate-950 border border-slate-700 rounded-2xl p-4 text-slate-200 outline-none focus:border-blue-500 transition-colors min-h-[120px] resize-none mb-6"
              placeholder={lang === Language.CN ? '例如：座椅高度 4，宽握...' : 'E.g. Seat height 4, wide grip...'}
              value={noteModalData.note}
              onChange={e => setNoteModalData({...noteModalData, note: e.target.value})}
              autoFocus
            />

            <div className="flex gap-4">
              <button onClick={() => setNoteModalData(null)} className="flex-1 py-4 rounded-2xl bg-slate-800 text-slate-400 font-black hover:bg-slate-700 transition-colors">{lang === Language.CN ? '取消' : 'Cancel'}</button>
              <button onClick={handleSaveNote} className="flex-[2] py-4 rounded-2xl bg-blue-600 text-white font-black hover:bg-blue-500 transition-all shadow-lg shadow-blue-600/30 active:scale-95">
                {translations.confirm[lang]}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* --- 新增：休息时间设置弹窗 --- */}
      {restModalData && (
        <div className="fixed inset-0 z-[80] bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-6 animate-in fade-in">
          <div className="bg-slate-900 border border-slate-800 w-full max-w-sm rounded-[2.5rem] p-8 shadow-2xl">
            <h3 className="text-center text-slate-400 font-bold mb-2 text-sm">{restModalData.name}</h3>
            <h2 className="text-center text-3xl font-black text-white mb-8">
              {lang === Language.CN ? '休息时长' : 'Rest Duration'}
            </h2>

            {/* 时间显示与微调 */}
            <div className="flex items-center justify-between mb-8 bg-slate-950 rounded-3xl p-2 border border-slate-800">
              <button onClick={() => setRestModalData(p => p ? ({...p, time: Math.max(10, p.time - 10)}) : null)} className="w-14 h-14 bg-slate-800 rounded-full flex items-center justify-center text-slate-300 font-black hover:bg-slate-700 transition-colors active:scale-95"><Minus size={24} /></button>
              <div className="flex flex-col items-center">
                <span className="text-4xl font-black text-blue-500 tabular-nums">{restModalData.time}</span>
                <span className="text-[10px] font-bold text-slate-600 uppercase">SEC</span>
              </div>
              <button onClick={() => setRestModalData(p => p ? ({...p, time: p.time + 10}) : null)} className="w-14 h-14 bg-slate-800 rounded-full flex items-center justify-center text-slate-300 font-black hover:bg-slate-700 transition-colors active:scale-95"><Plus size={24} /></button>
            </div>

            {/* 快捷选项 */}
            <div className="grid grid-cols-4 gap-2 mb-8">
              {[30, 60, 90, 120].map(t => (
                <button 
                  key={t} 
                  onClick={() => setRestModalData(p => p ? ({...p, time: t}) : null)}
                  className={`py-2 rounded-xl text-xs font-black transition-all ${restModalData.time === t ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-500 hover:bg-slate-700'}`}
                >
                  {t}s
                </button>
              ))}
            </div>

            {/* 底部按钮 */}
            <div className="flex gap-4">
              <button onClick={() => setRestModalData(null)} className="flex-1 py-4 rounded-2xl bg-slate-800 text-slate-400 font-black hover:bg-slate-700 transition-colors">{lang === Language.CN ? '取消' : 'Cancel'}</button>
              <button onClick={confirmStartRest} className="flex-[2] py-4 rounded-2xl bg-blue-600 text-white font-black hover:bg-blue-500 transition-all shadow-lg shadow-blue-600/30 active:scale-95 flex items-center justify-center gap-2">
                <History size={18} />
                {lang === Language.CN ? '开始计时' : 'Start Timer'}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* ✅ 在这里插入新的"维度设置弹窗"代码 */}
      {showMetricModal && (
        <div className="fixed inset-0 z-[80] bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-6 animate-in fade-in">
          <div className="bg-slate-900 border border-slate-800 w-full max-w-sm rounded-[2.5rem] p-8 shadow-2xl overflow-y-auto max-h-[90vh] custom-scrollbar">
            <h2 className="text-xl font-black text-white mb-6 flex items-center gap-2">
              <SettingsIcon size={20} className="text-blue-500" />
              {translations.manageMetrics[lang]} - {showMetricModal.name}
            </h2>

            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-4 px-1">
              {lang === Language.CN ? '选择要记录的维度' : 'Select metrics to track'}
            </p>

            <div className="space-y-3 mb-8">
              {/* 渲染内置和已有的自定义维度 */}
              {Array.from(new Set([...STANDARD_METRICS, ...getActiveMetrics(showMetricModal.name)])).map(m => (
                <button 
                  key={m}
                  onClick={() => toggleMetric(showMetricModal.name, m)}
                  className={`w-full p-4 rounded-2xl border flex justify-between items-center transition-all ${getActiveMetrics(showMetricModal.name).includes(m) ? 'bg-blue-600/10 border-blue-500/50 text-white' : 'bg-slate-800/50 border-slate-700 text-slate-500'}`}
                >
                  <span className="font-bold uppercase text-xs">
                    {translations[m as keyof typeof translations]?.[lang] || m.replace('custom_', '')}
                  </span>
                  {getActiveMetrics(showMetricModal.name).includes(m) ? <CheckIcon size={16} className="text-blue-500" /> : <Plus size={16} />}
                </button>
              ))}
            </div>

            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-4 px-1">
              {translations.addDimension[lang]}
            </p>

            {/* 添加新的自定义维度输入 */}
            <div className="flex gap-2 mb-8">
              <input 
                className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-sm text-white outline-none focus:border-blue-500"
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
                className="bg-slate-800 border border-slate-700 p-2 px-4 rounded-xl text-blue-500 font-bold text-xs active:scale-95 transition-all"
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
                className="flex-1 py-4 rounded-2xl bg-slate-800 border border-slate-700 text-slate-400 font-bold text-sm active:scale-95 transition-all hover:bg-slate-700"
              >
                {lang === Language.CN ? '重置默认' : 'Reset Default'}
              </button>
              
              <button 
                onClick={() => setShowMetricModal(null)} 
                className="flex-[2] py-4 rounded-2xl bg-blue-600 text-white font-black shadow-xl shadow-blue-600/20 active:scale-95 transition-all"
              >
                {translations.confirm[lang]}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- ✅ 新增：移动端友好时间选择器 --- */}
      {showTimePicker && (
        <div className="fixed inset-0 z-[100] bg-slate-950/90 backdrop-blur-md flex items-end sm:items-center justify-center animate-in fade-in slide-in-from-bottom-10">
          <div className="bg-slate-900 border-t sm:border border-slate-800 w-full max-w-md rounded-t-[3rem] sm:rounded-[3rem] p-8 shadow-2xl">
            <div className="flex justify-between items-center mb-8">
              <h2 className="text-xl font-black text-white">{lang === Language.CN ? '设置时长' : 'Set Duration'}</h2>
              <button onClick={() => setShowTimePicker(null)} className="p-2 text-slate-500"><X size={24}/></button>
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
                    className="w-full py-4 bg-slate-800 rounded-2xl flex justify-center text-blue-500 active:bg-blue-500 active:text-white transition-all"
                  >
                    <ChevronUp size={28} strokeWidth={3} />
                  </button>
                  
                  <div className="flex flex-col items-center">
                    <span className="text-4xl font-black text-white tabular-nums">
                      {tempHMS[col.key as keyof typeof tempHMS].toString().padStart(2, '0')}
                    </span>
                    <span className="text-[10px] font-bold text-slate-600 uppercase tracking-widest mt-1">{col.label}</span>
                  </div>

                  <button 
                    onClick={() => setTempHMS(p => ({...p, [col.key]: (p[col.key as keyof typeof p] - 1) < 0 ? col.max : p[col.key as keyof typeof p] - 1}))}
                    className="w-full py-4 bg-slate-800 rounded-2xl flex justify-center text-blue-500 active:bg-blue-500 active:text-white transition-all"
                  >
                    <ChevronDown size={28} strokeWidth={3} />
                  </button>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <button onClick={() => setShowTimePicker(null)} className="py-5 rounded-[2rem] bg-slate-800 text-slate-400 font-black">{lang === Language.CN ? '取消' : 'Cancel'}</button>
              <button onClick={confirmTimePicker} className="py-5 rounded-[2rem] bg-blue-600 text-white font-black shadow-xl shadow-blue-600/30">
                {translations.confirm[lang]}
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* ✅ 问题4: 重置账户确认对话框 */}
      {showResetAccountModal && (
        <div className="fixed inset-0 z-[100] bg-slate-950/90 backdrop-blur-md flex items-center justify-center p-6 animate-in fade-in">
          <div className="bg-slate-900 border border-slate-800 w-full max-w-md rounded-[2.5rem] p-8 shadow-2xl">
            <div className="text-center mb-8">
              <div className="w-20 h-20 bg-red-500/10 rounded-full flex items-center justify-center mx-auto mb-6">
                <Trash2 size={32} className="text-red-500" />
              </div>
              <h2 className="text-2xl font-black text-white mb-4">
                {translations.resetAccountWarning[lang]}
              </h2>
              <p className="text-sm text-slate-400 leading-relaxed whitespace-pre-line">
                {translations.resetAccountDesc[lang]}
              </p>
            </div>

            <div className="space-y-6">
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-3">
                  {translations.resetConfirmText[lang]}
                </label>
                <input
                  type="text"
                  value={resetConfirmText}
                  onChange={(e) => setResetConfirmText(e.target.value)}
                  placeholder={translations.resetConfirmPlaceholder[lang]}
                  className="w-full bg-slate-950 border border-slate-700 rounded-2xl px-4 py-4 text-white outline-none focus:border-red-500 transition-colors"
                  autoFocus
                />
              </div>

              <div className="flex gap-4">
                <button
                  onClick={() => {
                    setShowResetAccountModal(false);
                    setResetConfirmText('');
                  }}
                  className="flex-1 py-4 rounded-2xl bg-slate-800 text-slate-400 font-black hover:bg-slate-700 transition-colors"
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
                  className="flex-[2] py-4 rounded-2xl bg-red-600 text-white font-black hover:bg-red-500 transition-all shadow-lg shadow-red-600/30 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
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

      {/* --- 可拖拽悬浮休息计时器（仅在添加运动界面显示） --- */}
      {activeTab === 'new' && (
      <RestTimer
        isResting={isResting}
        restSeconds={restSeconds}
        setRestSeconds={setRestSeconds}
        setIsResting={setIsResting}
        onAdjustTime={adjustRestTime}
      />
      )}
      {(user && authMode !== 'updatePassword') && (
        <TabNavigation
          activeTab={activeTab as 'dashboard' | 'new' | 'goals' | 'profile'}
          onTabChange={setActiveTab}
          lang={lang}
          onStartWorkout={() => {
            setCurrentWorkout({ title: '', exercises: [], date: new Date().toISOString() });
            setActiveTab('new');
          }}
        />
      )}
    </div>
  );
};

// === Context Providers Wrapper ===
const AppWithProviders: React.FC = () => {
  const [userId, setUserId] = useState<string | undefined>(undefined);
  
  return (
    <AuthProvider>
      <UserSettingsProvider userId={userId}>
        <WorkoutProvider userId={userId}>
          <GoalsProvider userId={userId}>
            <AppWithAuth userId={userId} onUserIdChange={setUserId} />
          </GoalsProvider>
        </WorkoutProvider>
      </UserSettingsProvider>
    </AuthProvider>
  );
};

export default AppWithProviders;
