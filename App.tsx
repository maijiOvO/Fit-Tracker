import React, { useState, useEffect, useMemo, useRef } from 'react';
import CalendarHeatmap from 'react-calendar-heatmap';
import './heatmap.css'
import 'react-calendar-heatmap/dist/styles.css';
import { 
  Plus, Minus, History, BarChart2, LogOut, Trash2, PlusCircle, 
  Dumbbell, Calendar, Trophy, X, Activity, Zap,
  Target, RefreshCw, Search, Check, Cloud, Settings as SettingsIcon,
  Award, Eye, EyeOff, User as UserIcon, Tag as TagIcon, Mail, Lock, Flag,
  Edit2, CheckCircle, Send, ShieldAlert, Sparkles, AlertCircle, Coins,
  Key, ChevronRight, TrendingUp, Filter, PencilLine, Hash, Scale, ChevronDown, ChevronUp, Star,
  Layers, ArrowLeft, Globe, Ruler, Camera, Minimize2, Maximize2, GripHorizontal, StickyNote
} from 'lucide-react';
import { LocalNotifications } from '@capacitor/local-notifications';
import { Haptics } from '@capacitor/haptics'; 
import { Language, User, WorkoutSession, Exercise, ExerciseDefinition, Goal, GoalType, BodyweightMode, WeightEntry } from './types';
import { translations } from './translations';
import { db } from './services/db';
import { 
  supabase, syncWorkoutsToCloud, fetchWorkoutsFromCloud, 
  syncGoalsToCloud, fetchGoalsFromCloud, 
  syncWeightToCloud, fetchWeightFromCloud, 
  syncMeasurementsToCloud, fetchMeasurementsFromCloud,
  syncUserConfigsToCloud, fetchUserConfigsFromCloud // ✅ 新增这两个
} from './services/supabase';
import { XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ComposedChart, Area, Bar } from 'recharts';
// 简单的 "叮" 声 Base64
const BEEP_SOUND = 'data:audio/wav;base64,UklGRl9vT1BXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YU'; // (简略版，实际代码中我会给一个短促有效的提示音)
// 为了代码整洁，我们可以直接用一个简单的 Audio 对象
const beepAudio = new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3'); // 使用在线短提示音，或者你可以换成本地的
const KG_TO_LBS = 2.20462;
// 提示音效
const playTimerSound = () => {
  try {
    // 使用一个通用的短提示音链接，或者你可以换成你自己的
    const audio = new Audio('https://actions.google.com/sounds/v1/alarms/beep_short.ogg');
    audio.play();
  } catch (e) {
    console.error("Audio play failed", e);
  }
};
const BODY_PARTS = ['subChest', 'subShoulder', 'subBack', 'subArms', 'subLegs', 'subCore'];
const EQUIPMENT_TAGS = ['tagBarbell', 'tagDumbbell', 'tagMachine', 'tagCable', 'tagBodyweight', 'tagPyramid'];

const DEFAULT_EXERCISES: ExerciseDefinition[] = [
  // Chest
  { id: 'bp_barbell', name: { en: 'Barbell Bench Press', cn: '杠铃平板卧推' }, bodyPart: 'subChest', tags: ['tagBarbell'] },
  { id: 'bp_incline_barbell', name: { en: 'Incline Barbell Bench Press', cn: '杠铃上斜卧推' }, bodyPart: 'subChest', tags: ['tagBarbell'] },
  { id: 'bp_dumbbell', name: { en: 'Dumbbell Bench Press', cn: '哑铃平板卧推' }, bodyPart: 'subChest', tags: ['tagDumbbell'] },
  { id: 'bp_incline_dumbbell', name: { en: 'Incline Dumbbell Bench Press', cn: '哑铃上斜卧推' }, bodyPart: 'subChest', tags: ['tagDumbbell'] },
  { id: 'fly_cable', name: { en: 'Cable Fly', cn: '绳索夹胸' }, bodyPart: 'subChest', tags: ['tagCable'] },
  { id: 'press_machine_chest', name: { en: 'Machine Chest Press', cn: '器械推胸' }, bodyPart: 'subChest', tags: ['tagMachine'] },
  { id: 'chest_dip', name: { en: 'Chest Dip', cn: '胸部双杠臂屈伸' }, bodyPart: 'subChest', tags: ['tagBodyweight'] },
  { id: 'pushup', name: { en: 'Pushup', cn: '俯撑撑' }, bodyPart: 'subChest', tags: ['tagBodyweight'] },
  
  // Back
  { id: 'dl_barbell', name: { en: 'Deadlift', cn: '硬拉' }, bodyPart: 'subBack', tags: ['tagBarbell'] },
  { id: 'row_barbell', name: { en: 'Barbell Row', cn: '杠铃划船' }, bodyPart: 'subBack', tags: ['tagBarbell'] },
  { id: 'lat_pulldown', name: { en: 'Lat Pulldown', cn: '高位下拉' }, bodyPart: 'subBack', tags: ['tagMachine', 'tagCable'] },
  { id: 'row_seated_cable', name: { en: 'Seated Cable Row', cn: '坐姿划船' }, bodyPart: 'subBack', tags: ['tagCable'] },
  { id: 'pu_weighted', name: { en: 'Weighted Pull-up', cn: '加重引体向上' }, bodyPart: 'subBack', tags: ['tagBodyweight'] },
  { id: 'single_arm_db_row', name: { en: 'Single Arm Dumbbell Row', cn: '哑铃单臂划船' }, bodyPart: 'subBack', tags: ['tagDumbbell'] },
  { id: 'tbar_row', name: { en: 'T-Bar Row', cn: 'T杠划船' }, bodyPart: 'subBack', tags: ['tagBarbell', 'tagMachine'] },
  { id: 'hyperextension', name: { en: 'Hyperextension', cn: '山羊挺身' }, bodyPart: 'subBack', tags: ['tagBodyweight', 'tagMachine'] },
  
  // Shoulder
  { id: 'ohp_barbell', name: { en: 'Overhead Press', cn: '杠铃推举' }, bodyPart: 'subShoulder', tags: ['tagBarbell'] },
  { id: 'ohp_dumbbell', name: { en: 'Dumbbell Shoulder Press', cn: '哑铃推肩' }, bodyPart: 'subShoulder', tags: ['tagDumbbell'] },
  { id: 'lat_raise_dumbbell', name: { en: 'Dumbbell Lateral Raise', cn: '哑铃侧平举' }, bodyPart: 'subShoulder', tags: ['tagDumbbell'] },
  { id: 'face_pull_cable', name: { en: 'Cable Face Pull', cn: '绳索面拉' }, bodyPart: 'subShoulder', tags: ['tagCable'] },
  { id: 'press_machine_shoulder', name: { en: 'Machine Shoulder Press', cn: '器械推肩' }, bodyPart: 'subShoulder', tags: ['tagMachine'] },
  { id: 'arnold_press', name: { en: 'Arnold Press', cn: '阿诺德推举' }, bodyPart: 'subShoulder', tags: ['tagDumbbell'] },
  { id: 'front_raise_db', name: { en: 'Dumbbell Front Raise', cn: '哑铃前平举' }, bodyPart: 'subShoulder', tags: ['tagDumbbell'] },
  
  // Legs
  { id: 'sq_barbell', name: { en: 'Barbell Squat', cn: '深蹲' }, bodyPart: 'subLegs', tags: ['tagBarbell'] },
  { id: 'goblet_squat', name: { en: 'Goblet Squat', cn: '高杯深蹲' }, bodyPart: 'subLegs', tags: ['tagDumbbell'] },
  { id: 'leg_press', name: { en: 'Leg Press', cn: '倒蹬/腿举' }, bodyPart: 'subLegs', tags: ['tagMachine'] },
  { id: 'leg_extension', name: { en: 'Leg Extension', cn: '腿屈伸' }, bodyPart: 'subLegs', tags: ['tagMachine'] },
  { id: 'leg_curl', name: { en: 'Leg Curl', cn: '腿弯举' }, bodyPart: 'subLegs', tags: ['tagMachine'] },
  { id: 'calf_raise', name: { en: 'Calf Raise', cn: '提踵' }, bodyPart: 'subLegs', tags: ['tagMachine', 'tagBodyweight'] },
  { id: 'lunge_dumbbell', name: { en: 'Dumbbell Lunge', cn: '哑铃箭步蹲' }, bodyPart: 'subLegs', tags: ['tagDumbbell'] },
  { id: 'romanian_deadlift', name: { en: 'Romanian Deadlift', cn: '罗马尼亚硬拉' }, bodyPart: 'subLegs', tags: ['tagBarbell', 'tagDumbbell'] },
  
  // Arms
  { id: 'cu_barbell', name: { en: 'Barbell Curl', cn: '杠铃弯举' }, bodyPart: 'subArms', tags: ['tagBarbell'] },
  { id: 'cu_dumbbell', name: { en: 'Dumbbell Curl', cn: '哑铃弯举' }, bodyPart: 'subArms', tags: ['tagDumbbell'] },
  { id: 'cu_ hammer', name: { en: 'Hammer Curl', cn: '锤式弯举' }, bodyPart: 'subArms', tags: ['tagDumbbell'] },
  { id: 'tricep_pushdown', name: { en: 'Tricep Pushdown', cn: '肱三头肌下压' }, bodyPart: 'subArms', tags: ['tagCable'] },
  { id: 'skull_crusher', name: { en: 'Skull Crusher', cn: '哑卧臂屈伸' }, bodyPart: 'subArms', tags: ['tagBarbell', 'tagDumbbell'] },
  { id: 'preacher_curl', name: { en: 'Preacher Curl', cn: '牧师凳弯举' }, bodyPart: 'subArms', tags: ['tagBarbell', 'tagMachine'] },
  { id: 'overhead_extension_db', name: { en: 'Overhead Tricep Extension', cn: '颈后臂屈伸' }, bodyPart: 'subArms', tags: ['tagDumbbell'] },
  
  // Core
  { id: 'plank', name: { en: 'Plank', cn: '平板支撑' }, bodyPart: 'subCore', tags: ['tagBodyweight'] },
  { id: 'leg_raise', name: { en: 'Hanging Leg Raise', cn: '悬垂举腿' }, bodyPart: 'subCore', tags: ['tagBodyweight'] },
  { id: 'cable_crunch', name: { en: 'Cable Crunch', cn: '绳索卷腹' }, bodyPart: 'subCore', tags: ['tagCable'] },
  { id: 'russian_twist', name: { en: 'Russian Twist', cn: '俄罗斯转体' }, bodyPart: 'subCore', tags: ['tagBodyweight', 'tagDumbbell'] },
  { id: 'ab_wheel', name: { en: 'Ab Wheel Rollout', cn: '健腹轮' }, bodyPart: 'subCore', tags: ['tagBodyweight'] },
];

const App: React.FC = () => {
  const [lang, setLang] = useState<Language>(Language.CN);
  const [user, setUser] = useState<User | null>(null);
  
  // 修改 1: 在 activeTab 中添加 'profile'
  const [activeTab, setActiveTab] = useState<'dashboard' | 'new' | 'goals' | 'profile'>('dashboard');
  
  const [authMode, setAuthMode] = useState<'login' | 'register' | 'forgotPassword' | 'updatePassword'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'error'>('idle');
  
  const [workouts, setWorkouts] = useState<WorkoutSession[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [weightEntries, setWeightEntries] = useState<WeightEntry[]>([]);
  // 定义一个本地接口
  interface Measurement { id: string; userId: string; name: string; value: number; unit: string; date: string; }
  
  const [measurements, setMeasurements] = useState<Measurement[]>([]);

  // --- 新增：休息时间偏好记忆 ---
  // 格式: { "动作名称": 90 }
  const [restPreferences, setRestPreferences] = useState<Record<string, number>>({});
  // --- 新增：动作备注功能 ---
  // 格式: { "动作名称": "座椅高度4，宽握" }
  const [exerciseNotes, setExerciseNotes] = useState<Record<string, string>>({});
  const [noteModalData, setNoteModalData] = useState<{ name: string; note: string } | null>(null);

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
  // --- 新增：休息计时器逻辑 ---
  const [restSeconds, setRestSeconds] = useState(0);
  const [isResting, setIsResting] = useState(false);
// --- 修改后：悬浮窗状态与拖拽逻辑 (使用 Pointer Events) ---
  const [timerMinimized, setTimerMinimized] = useState(false);
  const [timerPos, setTimerPos] = useState({ x: 20, y: 100 });
  const [isDraggingState, setIsDraggingState] = useState(false);
// --- 修改后：智能识别点击和拖拽，带吸附功能 ---
  // 1. 增加 hasMoved 标记，用来区分点击和拖拽
  const draggingRef = useRef({ isDragging: false, hasMoved: false, startX: 0, startY: 0, initialRight: 0, initialBottom: 0 });

  const handlePointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    setIsDraggingState(true); // 用于 CSS transition

    draggingRef.current = {
      isDragging: true,
      hasMoved: false, // 重置移动标记
      startX: e.clientX,
      startY: e.clientY,
      initialRight: timerPos.x,
      initialBottom: timerPos.y
    };
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!draggingRef.current.isDragging) return;
    e.preventDefault();
    e.stopPropagation();

    const deltaX = draggingRef.current.startX - e.clientX;
    const deltaY = draggingRef.current.startY - e.clientY;

    // ⚡️ 核心防抖逻辑：只有移动超过 5px 才算真正的拖拽
    if (Math.abs(deltaX) < 5 && Math.abs(deltaY) < 5) return;
    
    // 一旦超过阈值，标记为“已移动”
    draggingRef.current.hasMoved = true;

    const screenW = window.innerWidth;
    const screenH = window.innerHeight;
    const elWidth = timerMinimized ? 64 : 320; 
    const elHeight = timerMinimized ? 64 : 200;
    const safeMargin = 20;

    let newX = draggingRef.current.initialRight + deltaX;
    let newY = draggingRef.current.initialBottom + deltaY;

    // 边界约束
    newX = Math.max(safeMargin, Math.min(newX, screenW - elWidth - safeMargin));
    newY = Math.max(30, Math.min(newY, screenH - elHeight - safeMargin));

    setTimerPos({ x: newX, y: newY });
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (!draggingRef.current.isDragging) return;
    
    draggingRef.current.isDragging = false;
    setIsDraggingState(false); // 恢复 CSS transition
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as Element).releasePointerCapture(e.pointerId);

    // 👆 判断：如果没移动过（或者移动极小），说明是“点击”
    if (!draggingRef.current.hasMoved && timerMinimized) {
      setTimerMinimized(false); // 点击动作：展开
      return; // 展开后不需要贴边逻辑，直接返回
    }

    // 🧲 否则是拖拽结束：执行收起状态下的自动贴边
    if (timerMinimized) {
      const screenW = window.innerWidth;
      const elWidth = 64;
      const safeMargin = 10;
      const isLeft = timerPos.x > (screenW / 2);

      if (isLeft) {
        setTimerPos(prev => ({ ...prev, x: screenW - elWidth - safeMargin }));
      } else {
        setTimerPos(prev => ({ ...prev, x: safeMargin }));
      }
    }
  };
// 计时器核心逻辑 (最终增强版：兼容 iOS/Android 原生震动)
  useEffect(() => {
    let interval: any = null;
    
    if (isResting && restSeconds > 0) {
      // 这里的逻辑保持不变
      interval = setInterval(() => {
        setRestSeconds((prev) => prev - 1);
      }, 1000);
    } else if (restSeconds === 0 && isResting) {
      // --- 时间到 ---
      setIsResting(false);

      // 定义一个 兼容性极强 的提示函数
      let playCount = 0;
      const playAlert = async () => {
        // 1. 播放声音 (Web Audio API)
        playTimerSound();
        
        // 2. 触发震动 (混合模式)
        try {
          // 尝试调用 Capacitor 原生震动 (iOS/Android App 均有效)
          await Haptics.vibrate({ duration: 500 });
        } catch (e) {
          // 如果在普通浏览器中，或者插件调用失败，回退到 Web API
          if (navigator.vibrate) navigator.vibrate(500);
        }
        
        playCount++;
        // 循环播放 4 次，间隔 1.2 秒
        if (playCount < 4) {
          setTimeout(playAlert, 1200);
        }
      };

      // 立即触发
      playAlert();
    }

    return () => clearInterval(interval);
  }, [isResting, restSeconds]);

  // 开始休息函数
// 开始休息函数 (增强版：后台通知)
// 开始休息函数 (修改版：支持双语通知)
  const startRest = async (seconds: number = 90) => {
    setRestSeconds(seconds);
    setIsResting(true);
    setTimerMinimized(false);

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
      await db.delete('custom_metrics', id);
      // 更新本地状态
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
// --- 新增：热力图数据计算 (防崩溃版) ---
  const heatmapData = useMemo(() => {
    // 如果没有数据，直接返回空数组，防止报错
    if (!workouts || workouts.length === 0) return [];

    const map = new Map<string, number>();
    
    workouts.forEach(w => {
      try {
        if (!w.date) return; // 如果没有日期，跳过
        const d = new Date(w.date);
        // 检查日期是否有效 (Invalid Date)
        if (isNaN(d.getTime())) return;
        
        const day = d.toISOString().split('T')[0];
        map.set(day, (map.get(day) || 0) + 1);
      } catch (e) {
        console.warn("Skipping invalid date:", w);
      }
    });
    
    return Array.from(map.entries()).map(([date, count]) => ({ date, count }));
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
  const [unit, setUnit] = useState<'kg' | 'lbs'>('kg');
  const [selectedPRProject, setSelectedPRProject] = useState<string | null>(null);
  const [showLibrary, setShowLibrary] = useState(false);
  const [showGoalModal, setShowGoalModal] = useState(false);
  // 修改 2: 移除了 showSettings 状态，因为设置将移入 Profile 页面
  const [searchQuery, setSearchQuery] = useState('');
  
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [customTags, setCustomTags] = useState<{id: string, name: string, category: 'bodyPart' | 'equipment'}[]>([]);
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

  const [customExercises, setCustomExercises] = useState<ExerciseDefinition[]>([]);
  const [exerciseOverrides, setExerciseOverrides] = useState<Record<string, Partial<ExerciseDefinition>>>({});
  const [tagRenameOverrides, setTagRenameOverrides] = useState<Record<string, string>>({});
  const [starredExercises, setStarredExercises] = useState<Record<string, number>>({});
  const [showAddExerciseModal, setShowAddExerciseModal] = useState(false);
  const [newExerciseName, setNewExerciseName] = useState('');
  const [newExerciseTags, setNewExerciseTags] = useState<string[]>([]);
  const [newExerciseBodyPart, setNewExerciseBodyPart] = useState<string>('subChest');

  const [isHistoryVisible, setIsHistoryVisible] = useState(false);

  const lastSelectionRef = useRef<string | null>(null);

  useEffect(() => {
    if (lastSelectionRef.current !== selectedPRProject) {
      setIsHistoryVisible(false);
      lastSelectionRef.current = selectedPRProject;
    }
  }, [selectedPRProject]);

  const [draggedTagId, setDraggedTagId] = useState<string | null>(null);
  const [draggedFromExId, setDraggedFromExId] = useState<string | null>(null);
  const [isDraggingOverSidebar, setIsDraggingOverSidebar] = useState(false);

  const [showWeightInput, setShowWeightInput] = useState(false);
  const [weightInputValue, setWeightInputValue] = useState('');
  const [editingWeightId, setEditingWeightId] = useState<string | null>(null);

  const formatWeight = (val: number): string => {
    const converted = unit === 'kg' ? val : val * KG_TO_LBS;
    return converted.toFixed(1);
  };
  const parseWeight = (val: number) => unit === 'kg' ? val : val / KG_TO_LBS;

  const [currentWorkout, setCurrentWorkout] = useState<Partial<WorkoutSession>>({ title: '', exercises: [], date: new Date().toISOString() });
  const [newGoal, setNewGoal] = useState<Partial<Goal>>({ type: 'weight', targetValue: 0, currentValue: 0, label: '' });

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

  const bestLifts = useMemo(() => {
    const liftsMap: Record<string, number> = {};
    workouts.forEach(session => session.exercises.forEach(ex => ex.sets.forEach(set => {
      const w = set.weight || 0;
      const normalizedName = resolveName(ex.name);
      if (!liftsMap[normalizedName] || w > liftsMap[normalizedName]) liftsMap[normalizedName] = w;
    })));

    return Object.entries(liftsMap)
      .map(([name, weight]) => ({ name, weight }))
      .sort((a, b) => {
        const starA = starredExercises[a.name] || 0;
        const starB = starredExercises[b.name] || 0;
        if (starA !== starB) return starB - starA;
        return a.name.localeCompare(b.name, lang === Language.CN ? 'zh-Hans-CN' : 'en');
      });
  }, [workouts, lang, exerciseOverrides, starredExercises]);

  const getChartDataFor = (target: string) => {
    if (target === '__WEIGHT__') {
      return weightEntries
        .map(entry => ({
          date: new Date(entry.date).toLocaleDateString(lang === Language.CN ? 'zh-CN' : 'en-US', { month: 'short', day: 'numeric' }),
          weight: Number(formatWeight(entry.weight)),
          timestamp: new Date(entry.date).getTime()
        }))
        .sort((a, b) => a.timestamp - b.timestamp);
    }
    const searchName = target.trim();
    return workouts
      .filter(w => w.exercises.some(ex => resolveName(ex.name).trim() === searchName))
      .map(w => {
        const ex = w.exercises.find(e => resolveName(e.name).trim() === searchName)!;
        const maxW = Math.max(...ex.sets.map(s => s.weight || 0));
        const sessionVolume = ex.sets.reduce((sum, set) => sum + (set.weight || 0) * (set.reps || 0), 0);
        return { 
          date: new Date(w.date).toLocaleDateString(lang === Language.CN ? 'zh-CN' : 'en-US', { month: 'short', day: 'numeric' }), 
          weight: Number(formatWeight(maxW)),
          volume: Number(formatWeight(sessionVolume)),
          timestamp: new Date(w.date).getTime() 
        };
      })
      .sort((a, b) => a.timestamp - b.timestamp);
  };

  const renderTrendChart = (target: string) => {
    const data = getChartDataFor(target);
    const isWeight = target === '__WEIGHT__';
    if (data.length === 0) return null;

    return (
      <div className="w-full h-[250px] mt-6 animate-in fade-in slide-in-from-top-2">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
            <defs>
              <linearGradient id={`grad-${target}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={isWeight ? '#818cf8' : '#3b82f6'} stopOpacity={0.3}/>
                <stop offset="95%" stopColor={isWeight ? '#818cf8' : '#3b82f6'} stopOpacity={0}/>
              </linearGradient>
            </defs>
            <XAxis dataKey="date" stroke="#475569" fontSize={10} tickMargin={15} minTickGap={40} tick={{ fill: '#94a3b8' }} axisLine={false} tickLine={false} />
            <YAxis yAxisId="left" stroke="#475569" fontSize={10} tick={{ fill: '#94a3b8' }} axisLine={false} tickLine={false} domain={['auto', 'auto']} />
            {!isWeight && <YAxis yAxisId="right" orientation="right" hide domain={['auto', 'auto']} />}
            <Tooltip 
              contentStyle={{ backgroundColor: '#0f172a', borderRadius: '16px', border: '1px solid #1e293b', padding: '12px' }} 
              itemStyle={{ fontWeight: '900', color: '#fff', fontSize: '12px' }}
              labelStyle={{ color: '#64748b', fontSize: '10px', marginBottom: '4px', textTransform: 'uppercase', fontWeight: 'bold' }}
              formatter={(val: number, name: string) => {
                const label = name === 'weight' ? (isWeight ? translations.currentWeight[lang] : translations.weight[lang]) : translations.trainingVolume[lang];
                return [val.toFixed(1), `${label} (${unit}${name === 'volume' ? '·reps' : ''})`];
              }}
            />
            {!isWeight && (
              <Bar 
                yAxisId="right"
                dataKey="volume" 
                fill="#3b82f6" 
                opacity={0.15}
                radius={[4, 4, 0, 0]}
                barSize={20}
                animationDuration={1500}
              />
            )}
            <Area 
              yAxisId="left"
              type="monotone" 
              dataKey="weight" 
              stroke={isWeight ? '#818cf8' : '#3b82f6'} 
              strokeWidth={4} 
              fillOpacity={1} 
              fill={`url(#grad-${target})`}
              animationDuration={1500}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    );
  };

  // ✅ 新增：渲染自定义指标的折线图
  const renderMetricChart = (metricName: string) => {
    // 1. 准备数据
    const data = measurements
      .filter(m => m.name === metricName)
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
      .map(m => ({
        date: new Date(m.date).toLocaleDateString(lang === Language.CN ? 'zh-CN' : 'en-US', { month: 'short', day: 'numeric' }),
        value: m.value,
        timestamp: new Date(m.date).getTime()
      }));

    if (data.length < 2) return <div className="text-xs text-slate-500 py-4 text-center">{lang === Language.CN ? '需至少两条记录生成趋势图' : 'Need 2+ entries for chart'}</div>;

    // 2. 渲染图表 (复用 Recharts 组件)
    return (
      <div className="w-full h-[150px] mt-4 animate-in fade-in">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 5, right: 5, left: -25, bottom: 0 }}>
            <defs>
              <linearGradient id={`grad-${metricName}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3}/>
                <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
              </linearGradient>
            </defs>
            <XAxis dataKey="date" stroke="#475569" fontSize={9} tickMargin={10} minTickGap={30} tick={{ fill: '#64748b' }} axisLine={false} tickLine={false} />
            <YAxis stroke="#475569" fontSize={9} tick={{ fill: '#64748b' }} axisLine={false} tickLine={false} domain={['auto', 'auto']} />
            <Tooltip 
              contentStyle={{ backgroundColor: '#0f172a', borderRadius: '12px', border: '1px solid #1e293b', padding: '8px' }} 
              itemStyle={{ fontWeight: 'bold', color: '#fff', fontSize: '12px' }}
              labelStyle={{ display: 'none' }}
              formatter={(val: number) => [val, metricName]}
            />
            <Area type="monotone" dataKey="value" stroke="#6366f1" strokeWidth={3} fillOpacity={1} fill={`url(#grad-${metricName})`} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    );
  };


  useEffect(() => {
    const initApp = async () => {
      await db.init();
      
      supabase.auth.onAuthStateChange(async (event, session) => {
        if (event === 'PASSWORD_RECOVERY') {
          setAuthMode('updatePassword');
        }

        if (session?.user) {
          const u = { id: session.user.id, username: session.user.user_metadata?.display_name || session.user.email?.split('@')[0] || 'User', email: session.user.email!, avatarUrl: session.user.user_metadata?.avatar_url };
          setUser(u);
          localStorage.setItem('fitlog_current_user', JSON.stringify(u));
          await performFullSync(u.id);
        }
      });

      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        const u = { id: session.user.id, username: session.user.user_metadata?.display_name || session.user.email?.split('@')[0] || 'User', email: session.user.email! };
        setUser(u);
        await performFullSync(u.id);
      } else {
        const savedUser = localStorage.getItem('fitlog_current_user');
        if (savedUser) {
          const u = JSON.parse(savedUser);
          setUser(u);
          await loadLocalData(u.id);
        }
      }
      const ls = (k: string) => localStorage.getItem(k);
      const savedCustomTags = ls('fitlog_custom_tags'); if (savedCustomTags) setCustomTags(JSON.parse(savedCustomTags));
      const savedCustomExercises = ls('fitlog_custom_exercises'); if (savedCustomExercises) setCustomExercises(JSON.parse(savedCustomExercises));
      const savedUnit = ls('fitlog_unit') as 'kg' | 'lbs'; if (savedUnit) setUnit(savedUnit);
      const savedLang = ls('fitlog_lang') as Language; if (savedLang) setLang(savedLang);
      const savedTagOverrides = ls('fitlog_tag_rename_overrides'); if (savedTagOverrides) setTagRenameOverrides(JSON.parse(savedTagOverrides));
      const savedExOverrides = ls('fitlog_exercise_overrides'); if (savedExOverrides) setExerciseOverrides(JSON.parse(savedExOverrides));
      const savedStarred = ls('fitlog_starred_exercises'); if (savedStarred) setStarredExercises(JSON.parse(savedStarred));
      await LocalNotifications.requestPermissions();
    };
    initApp();
  }, []);

  const loadLocalData = async (userId: string) => {
    const allW = await db.getAll<WorkoutSession>('workouts');
    const allG = await db.getAll<Goal>('goals');
    const allWeights = await db.getAll<WeightEntry>('weightLogs');

    const allMeasurements = await db.getAll<Measurement>('custom_metrics');
    const userW = allW.filter(w => w.userId === userId);
    const userG = allG.filter(g => g.userId === userId);
    const userWeights = allWeights.filter(w => w.userId === userId);

    setMeasurements(allMeasurements.filter(m => m.userId === userId));

    setWorkouts(userW.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()));
    setGoals(userG);
    setWeightEntries(userWeights.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()));
  };

  const performFullSync = async (currentUserId: string) => {
    if (currentUserId === 'u_guest') return;
    setSyncStatus('syncing');
    try {
      // --- 1. 同步四大核心数据表 ---
      // 同步训练记录 (Workouts)
      const rw = await fetchWorkoutsFromCloud();
      if (rw) for (const r of rw) await db.save('workouts', { id: r.id, userId: r.user_id, date: r.date, title: r.title, exercises: r.exercises, notes: r.notes });
      const lw = await db.getAll<WorkoutSession>('workouts');
      await syncWorkoutsToCloud(lw.filter(w => w.userId === currentUserId));

      // 同步体重记录 (Weight)
      const rWeight = await fetchWeightFromCloud();
      if (rWeight) for (const r of rWeight) await db.save('weightLogs', { id: r.id, userId: r.user_id, weight: r.weight, date: r.date, unit: r.unit });
      const lWeight = await db.getAll<WeightEntry>('weightLogs');
      await syncWeightToCloud(lWeight.filter(w => w.userId === currentUserId));

      // 同步身体指标 (Measurements)
      const rMeasures = await fetchMeasurementsFromCloud();
      if (rMeasures) for (const r of rMeasures) await db.save('custom_metrics', { id: r.id, userId: r.user_id, name: r.name, value: r.value, unit: r.unit, date: r.date });
      const lMeasures = await db.getAll<Measurement>('custom_metrics');
      await syncMeasurementsToCloud(lMeasures.filter(m => m.userId === currentUserId));

      // 同步目标记录 (Goals)
      const rg = await fetchGoalsFromCloud();
      if (rg) for (const r of rg) await db.save('goals', { id: r.id, userId: r.user_id, type: r.type, label: r.label, targetValue: r.target_value, currentValue: r.current_value, unit: r.unit });
      const lg = await db.getAll<Goal>('goals');
      await syncGoalsToCloud(lg.filter(g => g.userId === currentUserId));

      // --- ✅ 2. 新增：同步用户个性化配置 (备注、偏好、星标等) ---
      const remoteConfig = await fetchUserConfigsFromCloud();
      if (remoteConfig) {
        // 更新内存状态
        if (remoteConfig.exerciseNotes) setExerciseNotes(remoteConfig.exerciseNotes);
        if (remoteConfig.restPrefs) setRestPreferences(remoteConfig.restPrefs);
        if (remoteConfig.customTags) setCustomTags(remoteConfig.customTags);
        if (remoteConfig.starred) setStarredExercises(remoteConfig.starred);
        if (remoteConfig.customExercises) setCustomExercises(remoteConfig.customExercises);

        // 写入 localStorage 同步
        if (remoteConfig.exerciseNotes) localStorage.setItem('fitlog_exercise_notes', JSON.stringify(remoteConfig.exerciseNotes));
        if (remoteConfig.restPrefs) localStorage.setItem('fitlog_rest_prefs', JSON.stringify(remoteConfig.restPrefs));
        if (remoteConfig.customTags) localStorage.setItem('fitlog_custom_tags', JSON.stringify(remoteConfig.customTags));
        if (remoteConfig.starred) localStorage.setItem('fitlog_starred_exercises', JSON.stringify(remoteConfig.starred));
        if (remoteConfig.customExercises) localStorage.setItem('fitlog_custom_exercises', JSON.stringify(remoteConfig.customExercises));
      }
      
      // 反向同步：把本地当前的配置推到云端备份
      await syncUserConfigsToCloud({
        exerciseNotes,
        restPrefs: restPreferences,
        customTags,
        starred: starredExercises,
        customExercises
      });

      // --- 3. 重新加载本地 UI ---
      await loadLocalData(currentUserId);
      setSyncStatus('idle');
    } catch (e: any) {
      console.error("Sync Failure:", e.message);
      setSyncStatus('error');
    }
  };
  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault(); setIsLoading(true); setAuthError(null);
    try {
      const res = authMode === 'register' 
        ? await supabase.auth.signUp({ email, password, options: { emailRedirectTo: 'https://myronhub.com', data: { display_name: username } } }) 
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

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true); 
    setAuthError(null);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: 'https://myronhub.com', 
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
    setIsLoading(true);
    setAuthError(null);
    try {
      const { error } = await supabase.auth.updateUser({ password: password });
      if (error) throw error;
      
      alert(lang === Language.CN ? '密码修改成功，请重新登录' : 'Password updated successfully, please login');
      setPassword('');
      setAuthMode('login');
    } catch (err: any) {
      setAuthError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveWorkout = async () => {
    if (!currentWorkout.exercises?.length || !user) return;
    const session: WorkoutSession = { ...currentWorkout, id: currentWorkout.id || Date.now().toString(), userId: user.id, title: currentWorkout.title || `Workout ${new Date().toLocaleDateString()}`, date: currentWorkout.date || new Date().toISOString() } as WorkoutSession;
    await db.save('workouts', session);
    await loadLocalData(user.id); 
    setActiveTab('dashboard'); 
    setCurrentWorkout({ title: '', exercises: [], date: new Date().toISOString() });
    if (user.id !== 'u_guest') {
      try { await syncWorkoutsToCloud([session]); } catch (err) { console.warn("Sync failed"); }
    }
  };

  const handleEditWorkout = (workoutId: string) => {
    const workoutToEdit = workouts.find(w => w.id === workoutId);
    if (workoutToEdit) {
      setCurrentWorkout({ ...workoutToEdit });
      setActiveTab('new');
      setSelectedPRProject(null);
    }
  };

  const handleAddGoal = async () => {
    if (!newGoal.label || !newGoal.targetValue || !user) return;
    const goal: Goal = { id: Date.now().toString(), userId: user.id, type: newGoal.type as GoalType, label: newGoal.label!, targetValue: newGoal.targetValue!, currentValue: newGoal.currentValue || 0, unit: newGoal.type === 'weight' ? unit : (newGoal.type === 'strength' ? unit : 'times/week') };
    await db.save('goals', goal); 
    await loadLocalData(user.id);
    setShowGoalModal(false);
    if (user.id !== 'u_guest') {
       try { await syncGoalsToCloud([goal]); } catch (err) { console.warn("Sync failed"); }
    }
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
      // 1. 从数据库删除
      await db.delete('weightLogs', id);
      
      // 2. 更新界面状态
      setWeightEntries(prev => prev.filter(entry => entry.id !== id));
      
      // 3. 刷新本地数据以更新顶部大数字
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
      // 1. 上传图片到 Supabase Storage 'avatars' 桶
      const fileExt = file.name.split('.').pop();
      const fileName = `${user.id}-${Date.now()}.${fileExt}`;
      const filePath = `${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(filePath, file);

      if (uploadError) throw uploadError;

      // 2. 获取图片的公开访问链接
      const { data: { publicUrl } } = supabase.storage
        .from('avatars')
        .getPublicUrl(filePath);

      // 3. 更新用户的元数据 (user_metadata)
      const { error: updateError } = await supabase.auth.updateUser({
        data: { avatar_url: publicUrl }
      });

      if (updateError) throw updateError;

      // 4. 立即更新本地状态，让界面立刻变化
      const updatedUser = { ...user, avatarUrl: publicUrl };
      setUser(updatedUser);
      localStorage.setItem('fitlog_current_user', JSON.stringify(updatedUser));
      
    } catch (error: any) {
      alert('上传头像失败 (请检查Supabase Storage设置): ' + error.message);
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
      return next;
    });
  };

  const getTagName = (tid: string) => {
    if (tid === 'tagPyramid') return lang === Language.CN ? '递增/递减组' : 'Pyramid/Drop Set';
    return tagRenameOverrides[tid] || (customTags.find(ct => ct.id === tid)?.name) || (translations[tid]?.[lang] || tid);
  }

  const isBodyweightExercise = (name: string): boolean => {
    const allDef = [...DEFAULT_EXERCISES, ...customExercises];
    const def = allDef.find(d => d.name.en === name || d.name.cn === name || exerciseOverrides[d.id]?.name?.en === name || exerciseOverrides[d.id]?.name?.cn === name);
    if (!def) return false;
    const tags = exerciseOverrides[def.id]?.tags || def.tags;
    return tags.includes('tagBodyweight');
  };

  const isPyramidExercise = (name: string): boolean => {
    const allDef = [...DEFAULT_EXERCISES, ...customExercises];
    const def = allDef.find(d => d.name.en === name || d.name.cn === name || exerciseOverrides[d.id]?.name?.en === name || exerciseOverrides[d.id]?.name?.cn === name);
    if (!def) return false;
    const tags = exerciseOverrides[def.id]?.tags || def.tags;
    return tags.includes('tagPyramid');
  };

  const filteredExercises = useMemo(() => {
    const all = [...DEFAULT_EXERCISES, ...customExercises].map(ex => exerciseOverrides[ex.id] ? { ...ex, ...exerciseOverrides[ex.id] } : ex);
    return all.filter(ex => {
      const q = searchQuery.toLowerCase();
      const matchSearch = !searchQuery || ex.name[lang].toLowerCase().includes(q) || ex.tags.some(t => getTagName(t).toLowerCase().includes(q)) || getTagName(ex.bodyPart).toLowerCase().includes(q);
      const selParts = selectedTags.filter(t => BODY_PARTS.includes(t) || customTags.some(ct => ct.id === t && ct.category === 'bodyPart'));
      const selEquips = selectedTags.filter(t => EQUIPMENT_TAGS.includes(t) || customTags.some(ct => ct.id === t && ct.category === 'equipment'));
      const matchPart = selParts.length === 0 || selParts.includes(ex.bodyPart);
      const matchEquip = selEquips.length === 0 || ex.tags.some(t => selEquips.includes(t));
      return matchSearch && matchPart && matchEquip;
    });
  }, [searchQuery, selectedTags, lang, customTags, customExercises, exerciseOverrides, tagRenameOverrides]);

  const handleRenameTag = () => {
    if (!tagToRename || !newTagNameInput) return;
    const updatedOverrides = { ...tagRenameOverrides, [tagToRename.id]: newTagNameInput };
    setTagRenameOverrides(updatedOverrides);
    localStorage.setItem('fitlog_tag_rename_overrides', JSON.stringify(updatedOverrides));
    setShowRenameModal(false) ; setTagToRename(null); setNewTagNameInput('');
  };

  const handleRenameExercise = () => {
    if (!exerciseToRename || !newExerciseNameInput) return;
    setExerciseOverrides(prev => {
        const current = prev[exerciseToRename.id] || {};
        const next = { ...current, name: { ...((current.name as any) || {}), [lang]: newExerciseNameInput } };
        const updated = { ...prev, [exerciseToRename.id]: next };
        localStorage.setItem('fitlog_exercise_overrides', JSON.stringify(updated));
        return updated;
    });
    setShowRenameExerciseModal(false); setExerciseToRename(null); setNewExerciseNameInput('');
  };

  const handleDeleteTag = (tid: string) => {
    const updatedCustom = customTags.filter(ct => ct.id !== tid);
    setCustomTags(updatedCustom); localStorage.setItem('fitlog_custom_tags', JSON.stringify(updatedCustom));
    const updatedOverrides = { ...tagRenameOverrides }; delete updatedOverrides[tid];
    setTagRenameOverrides(updatedOverrides); localStorage.setItem('fitlog_tag_rename_overrides', JSON.stringify(updatedOverrides));
  };

  const handleDropOnExercise = (e: React.DragEvent, exId: string) => {
    e.preventDefault();
    const tagId = draggedTagId; if (!tagId || draggedFromExId) return;
    const isBodyPart = BODY_PARTS.includes(tagId) || customTags.some(ct => ct.id === tagId && ct.category === 'bodyPart');
    setExerciseOverrides(prev => {
        const current = prev[exId] || {}; const baseEx = [...DEFAULT_EXERCISES, ...customExercises].find(e => e.id === exId);
        if (!baseEx) return prev;
        let next: Partial<ExerciseDefinition>;
        if (isBodyPart) next = { ...current, bodyPart: tagId };
        else { const existingTags = current.tags || baseEx.tags; if (existingTags.includes(tagId)) return prev; next = { ...current, tags: [...existingTags, tagId] }; }
        const updated = { ...prev, [exId]: next }; localStorage.setItem('fitlog_exercise_overrides', JSON.stringify(updated));
        return updated;
    });
    setDraggedTagId(null);
  };

  const handleRemoveTagFromExercise = (exId: string, tagId: string) => {
    setExerciseOverrides(prev => {
        const current = prev[exId] || {}; const baseEx = [...DEFAULT_EXERCISES, ...customExercises].find(e => e.id === exId);
        if (!baseEx) return prev;
        const existingTags = current.tags || baseEx.tags; const next = { ...current, tags: existingTags.filter(t => t !== tagId) };
        const updated = { ...prev, [exId]: next }; localStorage.setItem('fitlog_exercise_overrides', JSON.stringify(updated));
        return updated;
    });
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

  const renderSetCapsule = (s: any, si: number) => (
    <div key={s.id} className="bg-slate-900/60 border border-slate-800/80 px-4 py-2 rounded-2xl flex flex-col gap-1 transition-all hover:border-blue-500/30">
      <div className="flex items-center gap-1.5">
        <span className="font-black text-slate-100 text-sm leading-none">{formatWeight(s.weight)}</span>
        <span className="text-[10px] text-slate-500 font-bold lowercase leading-none">{unit}</span>
        <span className="text-slate-600 mx-0.5 font-black leading-none">×</span>
        <span className="font-black text-slate-100 text-sm leading-none">{s.reps}</span>
      </div>
      {s.subSets && s.subSets.length > 0 && (
        <div className="flex flex-col gap-0.5 mt-1 border-t border-slate-800/50 pt-1">
          {s.subSets.map((ss: any, ssi: number) => (
            <div key={ssi} className="flex items-center gap-1 opacity-60">
              <span className="text-[9px] font-bold text-slate-300">{formatWeight(ss.weight)}</span>
              <span className="text-[8px] text-slate-500 lowercase">×</span>
              <span className="text-[9px] font-bold text-slate-300">{ss.reps}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );

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

      {/* 省略其他 Modal 代码 (AddTagModal, RenameModal等) 保持不变，为了篇幅只保留核心结构 */}
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
              <button onClick={() => { if (!newTagName) return; const t = { id: Date.now().toString(), name: newTagName, category: newTagCategory }; setCustomTags(p => { const u = [...p, t]; localStorage.setItem('fitlog_custom_tags', JSON.stringify(u)); return u; }); setShowAddTagModal(false); setNewTagName(''); }} className="w-full bg-blue-600 py-4 rounded-2xl font-black shadow-lg shadow-blue-600/20 active:scale-95 transition-all">{translations.confirm[lang]}</button>
           </div>
        </div>
      )}

      {showRenameModal && (
         <div className="fixed inset-0 z-[75] bg-slate-950/90 backdrop-blur-md flex items-center justify-center p-6 animate-in fade-in">
           <div className="bg-slate-900 border border-slate-800 w-full max-sm rounded-[2rem] p-8 space-y-6 shadow-2xl">
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
              <h2 className="text-xl font-black">{translations.editTags[lang]}</h2>
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
              <div className="flex justify-between items-center mb-2"><h2 className="text-2xl font-black">{translations.addCustomExercise[lang]}</h2><button onClick={() => setShowAddExerciseModal(false)} className="p-2 hover:bg-slate-800 rounded-full transition-colors"><X size={20}/></button></div>
              <div className="space-y-4">
                 <input className="w-full bg-slate-800 border border-slate-700 rounded-2xl py-4 px-6 outline-none focus:ring-2 focus:ring-blue-500 transition-all" value={newExerciseName} onChange={e => setNewExerciseName(e.target.value)} placeholder={translations.exerciseNamePlaceholder[lang]} />
                 <div className="space-y-3">
                   <h3 className="text-xs font-black text-slate-500 uppercase flex items-center gap-2"><Activity size={14} className="text-blue-500" />{translations.bodyPartHeader[lang]}</h3>
                   <div className="flex flex-wrap gap-2">{BODY_PARTS.map(id => (<button key={id} onClick={() => setNewExerciseBodyPart(id)} className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase transition-all ${newExerciseBodyPart === id ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-500 hover:bg-slate-700'}`}>{getTagName(id)}</button>))}</div>
                 </div>
                 <div className="space-y-3">
                   <h3 className="text-xs font-black text-slate-500 uppercase flex items-center gap-2"><Dumbbell size={14} className="text-indigo-500" />{translations.equipmentHeader[lang]}</h3>
                   <div className="flex flex-wrap gap-2">{EQUIPMENT_TAGS.map(id => (<button key={id} onClick={() => setNewExerciseTags(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id])} className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase transition-all ${newExerciseTags.includes(id) ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-500 hover:bg-slate-700'}`}>{getTagName(id)}</button>))}</div>
                 </div>
              </div>
              <button onClick={() => { if (!newExerciseName) return; const ex: ExerciseDefinition = { id: Date.now().toString(), name: { en: newExerciseName, cn: newExerciseName }, bodyPart: newExerciseBodyPart, tags: newExerciseTags }; setCustomExercises(p => { const u = [...p, ex]; localStorage.setItem('fitlog_custom_exercises', JSON.stringify(u)); return u; }); setShowAddExerciseModal(false); setNewExerciseName(''); setNewExerciseTags([]); }} className="w-full bg-blue-600 py-5 rounded-3xl font-black text-lg shadow-xl shadow-blue-600/20 active:scale-95 transition-all">{translations.confirm[lang]}</button>
           </div>
        </div>
      )}

      {showLibrary && (
         <div className="fixed inset-0 z-[60] bg-slate-950/95 backdrop-blur-3xl p-6 flex flex-col animate-in fade-in">
          <div className="flex justify-between items-center mb-6"><h2 className="text-3xl font-black tracking-tight flex items-center gap-3"><Dumbbell className="text-blue-500" size={32} />{translations.selectExercise[lang]}</h2><button onClick={() => setShowLibrary(false)} className="p-3 bg-slate-800/50 hover:bg-slate-800 rounded-full transition-all border border-slate-700/50"><X size={24} /></button></div>
          <div className="relative mb-8"><Search className="absolute left-6 top-1/2 -translate-y-1/2 text-slate-500" size={20} /><input className="w-full bg-slate-900 border border-slate-800 rounded-[2rem] py-5 pl-14 pr-8 text-lg font-medium outline-none focus:ring-4 focus:ring-blue-500/20 focus:border-blue-500/50 transition-all" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder={translations.searchPlaceholder[lang]} /></div>
          <div className="flex flex-1 overflow-hidden gap-4">
            <div onDragOver={(e) => { e.preventDefault(); setIsDraggingOverSidebar(true); }} onDragLeave={() => setIsDraggingOverSidebar(false)} onDrop={() => { if (draggedFromExId && draggedTagId) handleRemoveTagFromExercise(draggedFromExId, draggedTagId); setIsDraggingOverSidebar(false); setDraggedFromExId(null); setDraggedTagId(null); }} className={`w-1/3 lg:w-1/3 overflow-y-auto space-y-10 pr-4 border-r border-slate-800/50 custom-scrollbar transition-all ${isDraggingOverSidebar ? 'bg-red-500/10 border-r-red-500/50' : ''}`}>
              <button onClick={() => setSelectedTags([])} className={`w-full text-left px-4 py-3 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${selectedTags.length === 0 ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20' : 'text-slate-500 hover:bg-slate-800'}`}>{translations.allTags[lang]}</button>
              <div className="space-y-4">
                <div className="flex justify-between items-center px-2"><h3 className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] flex items-center gap-2"><Activity size={12} /> {translations.bodyPartHeader[lang]}</h3><button onClick={() => setIsEditingTags(!isEditingTags)} className="text-[10px] font-black uppercase text-blue-500 hover:text-blue-400">{isEditingTags ? translations.finishEdit[lang] : translations.editTags[lang]}</button></div>
                <div className="space-y-1.5">{BODY_PARTS.map(id => (<div key={id} className="relative group"><button draggable onDragStart={() => { setDraggedTagId(id); setDraggedFromExId(null); }} onClick={() => { if (isEditingTags) { setTagToRename({ id, name: getTagName(id) }); setNewTagNameInput(getTagName(id)); setShowRenameModal(true); } else { // 修改后：部位单选逻辑
                  setSelectedTags(p => {
                    // 先滤掉当前选中的所有部位标签（系统+自定义）
                    const withoutBodyParts = p.filter(tag => 
                      !BODY_PARTS.includes(tag) && 
                      !customTags.some(ct => ct.id === tag && ct.category === 'bodyPart')
                    );
                    // 如果点的是已选中的，则取消选择；如果点的是新的，则替换
                    return p.includes(id) ? withoutBodyParts : [...withoutBodyParts, id];}); } }} className={`w-full text-left px-4 py-3 rounded-xl text-xs font-bold transition-all ${selectedTags.includes(id) ? 'bg-blue-600 text-white shadow-md' : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'} ${isEditingTags ? 'pr-10' : ''}`}>{getTagName(id)}</button>{isEditingTags && <PencilLine size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />}</div>))}
                                      {customTags.filter(ct => ct.category === 'bodyPart').map(ct => (<div key={ct.id} className="relative group"><button draggable onDragStart={() => { setDraggedTagId(ct.id); setDraggedFromExId(null); }} onClick={() => { if (isEditingTags) { setTagToRename({ id: ct.id, name: getTagName(ct.id) }); setNewTagNameInput(getTagName(ct.id)); setShowRenameModal(true); } else { setSelectedTags(p => {
                      const withoutBodyParts = p.filter(tag => 
                        !BODY_PARTS.includes(tag) && 
                        !customTags.some(ct => ct.id === tag && ct.category === 'bodyPart')
                      );
                      return p.includes(ct.id) ? withoutBodyParts : [...withoutBodyParts, ct.id];}); } }} className={`w-full text-left px-4 py-3 rounded-xl text-xs font-bold transition-all ${selectedTags.includes(ct.id) ? 'bg-blue-600 text-white shadow-md' : 'text-slate-400 hover:bg-slate-800'} ${isEditingTags ? 'pr-14' : ''}`}>{getTagName(ct.id)}</button>{isEditingTags && (<div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1"><PencilLine size={14} className="text-slate-500" /><button onClick={(e) => { e.stopPropagation(); handleDeleteTag(ct.id); }} className="p-1 text-red-500 hover:bg-red-500/10 rounded-md"><Trash2 size={12} /></button></div>)}</div>))}
                </div>
              </div>
              <div className="space-y-4">
                <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] px-2 flex items-center gap-2"><Filter size={12} /> {translations.equipmentHeader[lang]}</h3>
                <div className="space-y-1.5">{EQUIPMENT_TAGS.map(id => (<div key={id} className="relative group"><button draggable onDragStart={() => { setDraggedTagId(id); setDraggedFromExId(null); }} onClick={() => { if (isEditingTags) { setTagToRename({ id, name: getTagName(id) }); setNewTagNameInput(getTagName(id)); setShowRenameModal(true); } else { setSelectedTags(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id]); } }} className={`w-full text-left px-4 py-3 rounded-xl text-xs font-bold transition-all ${selectedTags.includes(id) ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/20' : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'} ${isEditingTags ? 'pr-10' : ''}`}>{getTagName(id)}</button>{isEditingTags && <PencilLine size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />}</div>))}
                  {customTags.filter(ct => ct.category === 'equipment').map(ct => (<div key={ct.id} className="relative group"><button draggable onDragStart={() => { setDraggedTagId(ct.id); setDraggedFromExId(null); }} onClick={() => { if (isEditingTags) { setTagToRename({ id: ct.id, name: getTagName(ct.id) }); setNewTagNameInput(getTagName(ct.id)); setShowRenameModal(true); } else { setSelectedTags(p => p.includes(ct.id) ? p.filter(x => x !== ct.id) : [...p, ct.id]); } }} className={`w-full text-left px-4 py-3 rounded-xl text-xs font-bold transition-all ${selectedTags.includes(ct.id) ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-400 hover:bg-slate-800'} ${isEditingTags ? 'pr-14' : ''}`}>{getTagName(ct.id)}</button>{isEditingTags && (<div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1"><PencilLine size={14} className="text-slate-500" /><button onClick={(e) => { e.stopPropagation(); handleDeleteTag(ct.id); }} className="p-1 text-red-500 hover:bg-red-500/10 rounded-md"><Trash2 size={12} /></button></div>)}</div>))}
                </div>
              </div>
              <div className="pt-8 border-t border-slate-800 space-y-3"><button onClick={() => setShowAddTagModal(true)} className="w-full py-4 rounded-2xl text-[10px] font-black uppercase tracking-widest text-blue-400 hover:bg-blue-400/10 transition-all border border-blue-400/20 flex items-center justify-center gap-2"><PlusCircle size={16} /> {translations.addCustomTag[lang]}</button><button onClick={() => setShowAddExerciseModal(true)} className="w-full py-4 rounded-2xl text-[10px] font-black uppercase tracking-widest text-indigo-400 hover:bg-indigo-400/10 transition-all border border-indigo-400/20 flex items-center justify-center gap-2"><Zap size={16} /> {translations.addCustomExercise[lang]}</button></div>
            </div>
            <div className="flex-1 overflow-y-auto space-y-4 custom-scrollbar pr-2 pb-20">{filteredExercises.length === 0 ? (<div className="h-full flex flex-col items-center justify-center opacity-20 gap-4"><Search size={64} /><p className="font-black text-xl">{translations.noRecords[lang]}</p></div>) : (filteredExercises.map(ex => (<div key={ex.id} onDragOver={(e) => e.preventDefault()} onDrop={(e) => handleDropOnExercise(e, ex.id)} className="relative"><button onClick={() => { if (isEditingTags) { setExerciseToRename({ id: ex.id, name: ex.name[lang] }); setNewExerciseNameInput(ex.name[lang]); setShowRenameExerciseModal(true); return; } setCurrentWorkout(p => ({ ...p, exercises: [...(p.exercises || []), { id: Date.now().toString(), name: ex.name[lang], category: 'STRENGTH', sets: [{ id: Date.now().toString(), weight: 0, reps: 0, bodyweightMode: 'normal' }] }] })); setShowLibrary(false); }} className="w-full p-6 bg-slate-800/30 border border-slate-700/50 rounded-[1.5rem] text-left hover:bg-slate-800 hover:border-blue-500/50 transition-all group relative overflow-hidden"><div className="absolute right-0 top-0 w-32 h-32 bg-blue-600/5 rounded-full blur-3xl translate-x-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity"></div><div className="flex flex-col gap-3 relative z-10"><div className="flex justify-between items-center"><span className="font-black text-xl group-hover:text-blue-400 transition-colors">{ex.name[lang]}</span>{isEditingTags && <PencilLine size={18} className="text-slate-500" />}</div><div className="flex flex-wrap gap-2"><span draggable onDragStart={() => { setDraggedTagId(ex.bodyPart); setDraggedFromExId(ex.id); }} className="text-[10px] font-black uppercase bg-slate-800/80 px-3 py-1.5 rounded-xl text-slate-400 border border-slate-700/50 hover:bg-red-500/20 cursor-move transition-colors">{getTagName(ex.bodyPart)}</span>{ex.tags.map(t => (<span draggable onDragStart={() => { setDraggedTagId(t); setDraggedFromExId(ex.id); }} key={t} className="text-[10px] font-black uppercase bg-indigo-600/10 px-3 py-1.5 rounded-xl text-indigo-400 border border-indigo-500/20 hover:bg-red-500/20 cursor-move transition-colors">{getTagName(t)}</span>))}</div></div></button></div>)))}</div>
          </div>
        </div>
      )}

      {showGoalModal && (
        <div className="fixed inset-0 z-[70] bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-6 animate-in fade-in">
           <div className="bg-slate-900 border border-slate-800 w-full max-sm rounded-[2.5rem] p-8 space-y-6 shadow-2xl">
              <h2 className="text-2xl font-black">{translations.setGoal[lang]}</h2>
              <div className="space-y-4">
                 <div className="flex gap-2">{['weight', 'strength', 'frequency'].map(type => <button key={type} onClick={() => setNewGoal({...newGoal, type: type as GoalType})} className={`flex-1 py-3 rounded-2xl text-[10px] font-black uppercase transition-all ${newGoal.type === type ? 'bg-blue-600' : 'bg-slate-800'}`}>{translations[`goal${type.charAt(0).toUpperCase() + type.slice(1)}`][lang]}</button>)}</div>
                 <input className="w-full bg-slate-800 border border-slate-700 rounded-2xl py-4 px-6" value={newGoal.label} onChange={e => setNewGoal({...newGoal, label: e.target.value})} placeholder={translations.goalLabelPlaceholder[lang]} />
                 <div className="grid grid-cols-2 gap-4">
                    <input type="number" className="bg-slate-800 border border-slate-700 rounded-2xl py-4 px-6" placeholder={translations.current[lang]} value={newGoal.currentValue || ''} onChange={e => setNewGoal({...newGoal, currentValue: Number(e.target.value)})} />
                    <input type="number" className="bg-slate-800 border border-slate-700 rounded-2xl py-4 px-6" placeholder={translations.target[lang]} value={newGoal.targetValue || ''} onChange={e => setNewGoal({...newGoal, targetValue: Number(e.target.value)})} />
                 </div>
              </div>
              <button onClick={handleAddGoal} className="w-full bg-blue-600 py-5 rounded-2xl font-black">{translations.confirm[lang]}</button>
           </div>
        </div>
      )}

      {/* 顶部导航栏：包含 Logo、同步状态、快速单位切换 */}
      <header className="sticky top-0 z-40 bg-slate-900/80 backdrop-blur-xl border-b border-slate-800 px-6 pb-4 pt-14 md:pt-[calc(env(safe-area-inset-top)+1.5rem)] flex justify-between items-center">
        {/* 左侧：Logo 和 App 名称 */}
        <div className="flex items-center gap-3">
          <Dumbbell className="text-blue-500" />
          <h1 className="text-xl font-black tracking-tight">{translations.appTitle[lang]}</h1>
        </div>

        {/* 右侧：同步 Loading + 单位切换按钮 */}
        <div className="flex items-center gap-3">
          {/* 同步加载圈 */}
          {syncStatus === 'syncing' && <RefreshCw className="animate-spin text-blue-500" size={18} />}
          
          {/* ✅ 新增：快速切换单位按钮 */}
          <button 
            onClick={() => { 
              const n = unit === 'kg' ? 'lbs' : 'kg'; 
              setUnit(n); 
              localStorage.setItem('fitlog_unit', n); 
            }} 
            className="bg-slate-800 border border-slate-700/50 px-3 py-1.5 rounded-xl text-xs font-black uppercase text-blue-500 hover:bg-slate-700 hover:text-white transition-all active:scale-95 shadow-sm"
          >
            {unit}
          </button>
        </div>
      </header>

      {!user ? (
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

            {authError && <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-2xl text-red-500 text-xs font-black flex items-center gap-3 animate-in slide-in-from-top-2"><div className="p-1 bg-red-500 text-white rounded-full"><X size={12} strokeWidth={4} /></div>{authError}</div>}

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
          {activeTab === 'dashboard' && (<div className="space-y-6 animate-in fade-in">
            {workouts.length === 0 && weightEntries.length === 0 ? (
              <div className="flex flex-col items-center justify-center min-h-[60vh] text-center p-6 animate-in slide-in-from-bottom-10">
                <div className="bg-blue-600/10 p-10 rounded-full border border-blue-500/20 mb-8 animate-pulse shadow-2xl shadow-blue-500/10"><Trophy size={80} className="text-blue-500" /></div>
                <h2 className="text-3xl font-black mb-4 bg-gradient-to-r from-blue-400 to-indigo-400 bg-clip-text text-transparent">{translations.dashboardEmptyTitle[lang]}</h2>
                <p className="text-slate-400 max-w-sm font-medium leading-relaxed text-lg mb-10">{translations.dashboardEmptyDesc[lang]}</p>
                <div className="flex flex-col sm:flex-row gap-4">
                  <button onClick={() => setActiveTab('new')} className="group bg-blue-600 px-10 py-5 rounded-[2rem] font-black text-xl shadow-xl shadow-blue-600/30 active:scale-95 transition-all flex items-center gap-3"><PlusCircle size={24} className="group-hover:rotate-90 transition-transform" />{translations.newWorkout[lang]}</button>
                </div>
              </div>
            ) : (
              // 仪表盘内容省略，保持不变
              <div className="space-y-6">
                <div className="bg-gradient-to-br from-indigo-900/40 to-slate-800/40 rounded-[2.5rem] border border-indigo-500/20 p-8 shadow-xl">
                  <div className="flex justify-between items-center cursor-pointer" onClick={() => setSelectedPRProject(selectedPRProject === '__WEIGHT__' ? null : '__WEIGHT__')}>
                    <div className="flex flex-col">
                      <h3 className="text-xs font-black text-indigo-400 uppercase tracking-widest flex items-center gap-2 mb-2"><Scale size={16} /> {translations.currentWeight[lang]}</h3>
                      <div className="flex items-end">
                        <span className="text-4xl font-black text-white">{weightEntries.length > 0 ? formatWeight(weightEntries[0].weight) : '--'}</span>
                        <span className="text-slate-500 font-bold ml-2 uppercase text-sm mb-1">{unit}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <button onClick={(e) => { e.stopPropagation(); setEditingWeightId(null); setWeightInputValue(''); setShowWeightInput(true); }} className="p-3 bg-indigo-600 rounded-2xl hover:bg-indigo-500 transition-colors shadow-lg shadow-indigo-600/20 active:scale-90"><Plus size={20} /></button>
                      <div className="p-2 text-slate-500">
                        {selectedPRProject === '__WEIGHT__' ? <ChevronUp size={24} /> : <ChevronDown size={24} />}
                      </div>
                    </div>
                  </div>
                  {selectedPRProject === '__WEIGHT__' && (
                    <div className="border-t border-indigo-500/10 mt-6 pt-6">
                      <p className="text-[10px] text-indigo-400/60 font-black uppercase tracking-widest mb-4 flex items-center gap-2"><TrendingUp size={12} /> {translations.weightTrend[lang]}</p>
                      {renderTrendChart('__WEIGHT__')}
                      <div className="mt-8 space-y-4 max-h-[300px] overflow-y-auto custom-scrollbar pr-2 pt-2 border-t border-indigo-500/5">
                        <h4 className="text-[10px] text-slate-500 font-black uppercase tracking-widest flex items-center gap-2 mb-4 px-1">
                          <History size={12} /> {lang === Language.CN ? '历史体重记录' : 'Weight History'} ({weightEntries.length})
                        </h4>
                         {weightEntries.map(entry => (
                          <div key={entry.id} className="bg-slate-900/40 p-4 rounded-2xl border border-slate-800/50 flex justify-between items-center group">
                            <div className="flex items-center gap-3">
                              {/* 编辑按钮 */}
                              <button 
                                onClick={(e) => { e.stopPropagation(); triggerEditWeight(entry); }}
                                className="p-2 bg-indigo-500/10 text-indigo-400 rounded-xl hover:bg-indigo-500/20 transition-all active:scale-90"
                              >
                                <Edit2 size={12} />
                              </button>

                              {/* ✅ 新增：删除按钮 */}
                              <button 
                                onClick={(e) => handleDeleteWeightEntry(e, entry.id)}
                                className="p-2 bg-red-500/10 text-red-500 rounded-xl hover:bg-red-500/20 transition-all active:scale-90"
                              >
                                <Trash2 size={12} />
                              </button>

                              <div className="ml-1">
                                <span className="text-sm font-black text-white">{formatWeight(entry.weight)}</span>
                                <span className="text-[10px] text-slate-500 font-bold uppercase ml-1">{unit}</span>
                              </div>
                            </div>
                            <span className="text-[10px] text-slate-600 font-bold">
                              {new Date(entry.date).toLocaleDateString(lang === Language.CN ? 'zh-CN' : 'en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <div className="space-y-4">
                  <h3 className="text-xs font-black text-slate-500 uppercase flex items-center gap-2 px-2"><Trophy className="text-amber-500" size={16} /> {translations.prManagement[lang]}</h3>
                  {bestLifts.map(lift => {
                    const isExpanded = selectedPRProject === lift.name;
                    const isStarred = !!starredExercises[lift.name];
                    const historyExs = workouts
                      .flatMap(w => w.exercises.map(e => ({ ...e, date: w.date, workoutId: w.id })))
                      .filter(e => resolveName(e.name) === lift.name)
                      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

                    return (
                      <div key={lift.name} className={`bg-slate-800/40 rounded-[2.5rem] border border-slate-700/50 p-6 transition-all duration-300 hover:border-slate-600 shadow-lg ${isExpanded ? 'ring-2 ring-blue-500/20' : ''}`}>
                        <div className="flex justify-between items-center cursor-pointer" onClick={() => setSelectedPRProject(isExpanded ? null : lift.name)}>
                          <div className="flex items-center gap-4">
                            <button onClick={(e) => { e.stopPropagation(); toggleStarExercise(lift.name); }} className={`p-3 rounded-2xl transition-all ${isStarred ? 'bg-amber-500 text-white shadow-lg shadow-amber-500/20' : 'bg-slate-900 text-slate-600 hover:text-amber-500'}`}><Star size={20} fill={isStarred ? "currentColor" : "none"} /></button>
                            <span className="font-black text-slate-200">{lift.name}</span>
                          </div>
                          <div className="flex items-center gap-6">
                            <div className="text-right"><span className="block font-black text-white text-lg leading-none">{formatWeight(lift.weight)}</span><span className="text-[10px] font-bold text-slate-600 uppercase">{unit}</span></div>
                            <div className="text-slate-700">{isExpanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}</div>
                          </div>
                        </div>
                        {isExpanded && (
                          <div className="border-t border-slate-700/30 mt-6 pt-6 overflow-hidden animate-in slide-in-from-top-4">
                            <div className="mb-8">{renderTrendChart(lift.name)}</div>
                            {historyExs.length > 0 && (
                              <div className="space-y-4 mt-4 border-t border-slate-800 pt-8">
                                <button onClick={() => setIsHistoryVisible(!isHistoryVisible)} className="w-full flex items-center justify-between px-1 group"><h4 className="text-[10px] text-slate-500 font-black uppercase tracking-widest group-hover:text-blue-400 transition-colors">{translations.history[lang]} ({historyExs.length})</h4><div className={`p-2 rounded-xl bg-slate-900/50 text-slate-600 group-hover:text-blue-500 transition-all ${isHistoryVisible ? 'rotate-180 text-blue-500' : ''}`}><ChevronDown size={16} /></div></button>
                                {isHistoryVisible && (
                                  <div className="space-y-6 max-h-[500px] overflow-y-auto custom-scrollbar pr-2 pt-2 animate-in fade-in slide-in-from-top-2">
                                    {historyExs.map((ex, exIdx) => (
                                      <div key={`${ex.workoutId}-${ex.id}-${exIdx}`} className="space-y-4 pb-6 border-b border-slate-800/30 last:border-0 last:pb-0">
                                        <div className="flex justify-between items-center px-1">
                                          <div className="flex items-center gap-3">
                                            <button onClick={(e) => { e.stopPropagation(); handleEditWorkout(ex.workoutId); }} className="p-2 bg-blue-500/10 text-blue-500 rounded-xl hover:bg-blue-500/20 transition-all active:scale-90"><Edit2 size={14} /></button>
                                            <div className="flex items-center gap-2"><Calendar size={14} className="text-slate-600" /><span className="text-[11px] text-slate-400 font-bold">{new Date(ex.date).toLocaleDateString(lang === Language.CN ? 'zh-CN' : 'en-US', { year: 'numeric', month: 'short', day: 'numeric' })}</span></div>
                                          </div>
                                          <span className="text-[10px] font-black bg-slate-800/80 text-slate-500 px-3 py-1 rounded-full uppercase tracking-wider border border-slate-700/30">{ex.sets.length} {translations.setsCount[lang]}</span>
                                        </div>
                                        <div className="flex flex-wrap gap-2">{ex.sets.map((s: any, si: number) => renderSetCapsule(s, si))}</div>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )
          }</div>)}

          {/* 新增训练 保持不变 */}
          {activeTab === 'new' && (<div className="space-y-8 animate-in slide-in-from-bottom-5"><div className="bg-slate-800/40 p-8 rounded-[2.5rem] border border-slate-700/50"><input className="bg-transparent text-3xl font-black w-full outline-none" value={currentWorkout.title} onChange={e => setCurrentWorkout({...currentWorkout, title: e.target.value})} placeholder={translations.trainingTitlePlaceholder[lang]} /></div><div className="space-y-6">{currentWorkout.exercises?.map((ex, exIdx) => { 
            const isBodyweight = isBodyweightExercise(ex.name); 
            const isPyramid = isPyramidExercise(ex.name);

            return (<div key={ex.id} className="bg-slate-800/40 p-8 rounded-[2.5rem] border border-slate-700/50">

              <div className="flex flex-col gap-2 mb-6">
                <div className="flex justify-between items-start">
                  <div className="flex items-center gap-2">
                    <h3 className="text-xl font-black text-blue-400 leading-tight">{resolveName(ex.name)}</h3>
                    {/* 备注按钮 */}
                    <button 
                      onClick={() => setNoteModalData({ name: resolveName(ex.name), note: exerciseNotes[resolveName(ex.name)] || '' })}
                      className={`p-2 rounded-xl transition-all active:scale-90 ${exerciseNotes[resolveName(ex.name)] ? 'text-amber-400 bg-amber-400/10' : 'text-slate-600 hover:text-slate-400'}`}
                    >
                      <StickyNote size={18} />
                    </button>
                  </div>
                  {/* 删除动作按钮 */}
                  <button onClick={() => setCurrentWorkout({...currentWorkout, exercises: currentWorkout.exercises!.filter((_, i) => i !== exIdx)})} className="text-slate-600 hover:text-red-500 transition-colors p-1">
                    <Trash2 size={20} />
                  </button>
                </div>

                {/* 如果有备注，显示在这里 */}
                {exerciseNotes[resolveName(ex.name)] && (
                  <div 
                    onClick={() => setNoteModalData({ name: resolveName(ex.name), note: exerciseNotes[resolveName(ex.name)] || '' })}
                    className="self-start bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2 cursor-pointer hover:bg-amber-500/20 transition-colors"
                  >
                    <p className="text-xs text-amber-500/90 font-bold flex items-start gap-2">
                      <StickyNote size={12} className="mt-0.5 flex-shrink-0" />
                      {exerciseNotes[resolveName(ex.name)]}
                    </p>
                  </div>
                )}
              </div>
              
              {isBodyweight && (<div className="flex gap-2 mb-6 p-1 bg-slate-900 rounded-2xl border border-slate-800">
                {(['normal', 'weighted', 'assisted'] as BodyweightMode[]).map(mode => (<button key={mode} onClick={() => 
                  { const exs = [...currentWorkout.exercises!]; exs[exIdx].sets = exs[exIdx].sets.map(s => ({ ...s, bodyweightMode: mode }));
                   setCurrentWorkout({...currentWorkout, exercises: exs}); }} className={`flex-1 py-2 rounded-xl text-[9px] font-black uppercase transition-all 
                   ${ex.sets[0]?.bodyweightMode === mode ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-600'}`}>
                    {translations[`mode${mode.charAt(0).toUpperCase() + mode.slice(1)}` as keyof typeof translations][lang]}</button>))}</div>)}
                    <div className="grid grid-cols-4 gap-4 items-center px-4 mb-3 text-[10px] font-black uppercase text-slate-500 tracking-widest">
                      <span className="pl-2">{translations.sets[lang]}</span><span className="text-center">{translations.weight[lang]} ({unit})</span>
                      <span className="text-center">{translations.reps[lang]}</span><span className="text-right"></span></div><div className="space-y-4">
                        {ex.sets.map((set, setIdx) => (<div key={set.id} className="space-y-2">

              <div className="grid grid-cols-4 gap-4 items-center bg-slate-900 p-4 rounded-2xl border border-slate-800 transition-all focus-within:border-blue-500/50">
                <span className="text-blue-500 font-black pl-2">{setIdx + 1}</span>
                <input type="number" step="any" className="bg-transparent font-bold text-center outline-none text-white focus:text-blue-400 w-full" value={set.weight === 0 ? '' : (unit === 'kg' ? set.weight : parseFloat((set.weight * KG_TO_LBS).toFixed(2)))} placeholder="0" onChange={e => { const val = e.target.value === '' ? 0 : Number(e.target.value); const exs = [...currentWorkout.exercises!]; exs[exIdx].sets[setIdx].weight = parseWeight(val); setCurrentWorkout({...currentWorkout, exercises: exs}); }} />
                <input type="number" className="bg-transparent font-bold text-center outline-none text-white focus:text-blue-400" value={set.reps || ''} placeholder="0" onChange={e => { const val = e.target.value === '' ? 0 : Number(e.target.value); const exs = [...currentWorkout.exercises!]; exs[exIdx].sets[setIdx].reps = val; setCurrentWorkout({...currentWorkout, exercises: exs}); }} />
                <div className="flex justify-end gap-2 pr-2">
                  {isPyramid && (
                    <button onClick={() => {
                      const exs = [...currentWorkout.exercises!];
                      const s = exs[exIdx].sets[setIdx];
                      s.subSets = [...(s.subSets || []), { weight: s.weight, reps: s.reps }];
                      setCurrentWorkout({...currentWorkout, exercises: exs});
                    }} className="text-indigo-400 hover:text-indigo-300 transition-colors" 
                       title={lang === Language.CN ? "添加递减组" : "Add Drop Set"}>
                      <Layers size={18} />
                    </button>
                  )}
                  <button onClick={() => { const exs = [...currentWorkout.exercises!]; exs[exIdx].sets = exs[exIdx].sets.filter((_, i) => i !== setIdx); setCurrentWorkout({...currentWorkout, exercises: exs}); }} className="text-slate-600 hover:text-red-500"><Minus size={18} /></button>
                </div>
              </div>
              {isPyramid && set.subSets && set.subSets.map((sub, ssi) => (
                <div key={ssi} className="grid grid-cols-4 gap-4 items-center bg-slate-900/40 ml-8 p-3 rounded-xl border border-dashed border-slate-800 animate-in slide-in-from-left-2">
                  <span className="text-[10px] font-black text-slate-600 uppercase">
                    {lang === Language.CN ? '递减' : 'Sub'}
                  </span>
                  <input type="number" step="any" className="bg-transparent text-sm font-bold text-center outline-none text-slate-300 w-full" value={sub.weight === 0 ? '' : (unit === 'kg' ? sub.weight : parseFloat((sub.weight * KG_TO_LBS).toFixed(2)))} onChange={e => {
                    const val = e.target.value === '' ? 0 : Number(e.target.value);
                    const exs = [...currentWorkout.exercises!];
                    exs[exIdx].sets[setIdx].subSets![ssi].weight = parseWeight(val);
                    setCurrentWorkout({...currentWorkout, exercises: exs});
                  }} />
                  <input type="number" className="bg-transparent text-sm font-bold text-center outline-none text-slate-300" value={sub.reps || ''} onChange={e => {
                    const val = e.target.value === '' ? 0 : Number(e.target.value);
                    const exs = [...currentWorkout.exercises!];
                    exs[exIdx].sets[setIdx].subSets![ssi].reps = val;
                    setCurrentWorkout({...currentWorkout, exercises: exs});
                  }} />
                  <button onClick={() => {
                    const exs = [...currentWorkout.exercises!];
                    exs[exIdx].sets[setIdx].subSets = exs[exIdx].sets[setIdx].subSets!.filter((_, i) => i !== ssi);
                    setCurrentWorkout({...currentWorkout, exercises: exs});
                  }} className="flex justify-end pr-2 text-slate-700 hover:text-red-500">
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>))}</div>
            {/* 操作栏：添加组 & 休息计时 */}
                  <div className="flex gap-3 mt-4">
                    {/* 1. 添加组按钮 (逻辑保持不变，样式改为 flex-1) */}
                    <button 
                      onClick={() => { 
                        const exs = [...currentWorkout.exercises!]; 
                        const currentSets = exs[exIdx].sets; 
                        const lastSet = currentSets.length > 0 ? currentSets[currentSets.length - 1] : null; 
                        exs[exIdx].sets.push({ 
                          id: Date.now().toString(), 
                          weight: lastSet ? lastSet.weight : 0, 
                          reps: lastSet ? lastSet.reps : 0, 
                          bodyweightMode: lastSet ? lastSet.bodyweightMode : (isBodyweight ? 'normal' : undefined) 
                        }); 
                        setCurrentWorkout({...currentWorkout, exercises: exs}); 
                      }} 
                      className="flex-1 py-3 border border-dashed border-slate-700 rounded-xl text-slate-500 font-black flex items-center justify-center gap-2 hover:bg-slate-800/50 transition-colors"
                    >
                      <Plus size={16} /> {translations.addSet[lang]}
                    </button>
                    
                    {/* 2. 休息按钮 (新版：智能记忆) */}
                    <button 
                      onClick={() => openRestSettings(resolveName(ex.name))} 
                      className="px-5 py-3 bg-slate-800 border border-slate-700 rounded-xl text-indigo-400 font-black flex items-center justify-center gap-2 hover:bg-slate-700 active:scale-95 transition-all"
                    >
                      <History size={18} />
                      {/* 显示该动作上次设定的时间，如果没有则显示90s */}
                      <span className="text-xs">{getRestPref(resolveName(ex.name))}s</span>
                    </button>
                  </div>
                </div>); })}</div><div className="flex gap-4"><button onClick={() => setShowLibrary(true)} 
                className="flex-1 bg-slate-800/80 p-5 rounded-3xl font-black flex items-center justify-center gap-2 hover:bg-slate-800 transition-colors"><PlusCircle /> 
                {translations.addExercise[lang]}</button><button onClick={handleSaveWorkout} 
                className="flex-1 bg-blue-600 p-5 rounded-3xl font-black shadow-xl shadow-blue-600/30 flex items-center justify-center gap-2 hover:bg-blue-500 active:scale-95 transition-all">
                  <Check /> {translations.saveWorkout[lang]}</button></div></div>)}

          {/* 目标管理 保持不变 */}
          {activeTab === 'goals' && (<div className="space-y-6 animate-in slide-in-from-right"><div className="flex justify-between items-center"><div><h2 className="text-3xl font-black">{translations.goals[lang]}</h2><p className="text-slate-500">{translations.goalsSubtitle[lang]}</p></div><button onClick={() => setShowGoalModal(true)} className="p-4 bg-blue-600 rounded-2xl"><Plus size={24} /></button></div><div className="grid grid-cols-1 md:grid-cols-2 gap-6">{goals.map(g => (<div key={g.id} className="bg-slate-800/40 p-8 rounded-[2.5rem] border border-slate-700/50"><div className="flex justify-between items-start mb-4"><div><h4 className="font-black text-xl">{g.label}</h4><span className="text-[10px] text-blue-500 uppercase">{g.type}</span></div><button onClick={async () => { await db.delete('goals', g.id); setGoals(p => p.filter(x => x.id !== g.id)); }}><Trash2 size={16} className="text-slate-700" /></button></div><div className="flex justify-between items-end mb-2"><span className="text-2xl font-black">{g.currentValue} / {g.targetValue}</span><span className="text-slate-500 text-xs">{g.unit}</span></div><div className="h-2 bg-slate-900 rounded-full overflow-hidden"><div className="h-full bg-blue-600" style={{ width: `${Math.min(100, (g.currentValue / g.targetValue) * 100)}%` }}></div></div></div>))}</div></div>)}
          
          {/* 修改 4: 新增个人中心页面 (Profile) */}
          {activeTab === 'profile' && (
            <div className="space-y-6 animate-in slide-in-from-bottom-5">
              {/* Profile Header */}
              <div className="flex flex-col items-center justify-center py-10 relative overflow-hidden">
              <div className="absolute inset-0 bg-blue-600/5 rounded-full blur-3xl scale-150"></div>


              {/* 头像容器 - 点击触发文件选择 */}
              <div className="relative group cursor-pointer" onClick={() => fileInputRef.current?.click()}>
                {/* 隐藏的文件输入框 */}
                <input 
                  type="file" 
                  ref={fileInputRef} 
                  onChange={handleAvatarUpload} 
                  className="hidden" 
                  accept="image/*"
                />
                
                {/* 头像显示区 */}
                <div className="w-28 h-28 bg-gradient-to-br from-blue-600 to-indigo-600 rounded-full flex items-center justify-center shadow-2xl shadow-blue-500/30 mb-6 border-4 border-slate-900 overflow-hidden relative">
                   {user.avatarUrl ? (
                     <img src={user.avatarUrl} alt="Avatar" className="w-full h-full object-cover" />
                   ) : (
                     <span className="text-4xl font-black text-white">{user.username.charAt(0).toUpperCase()}</span>
                   )}
                   
                   {/* 悬停/点击时的遮罩效果 */}
                   <div className="absolute inset-0 bg-black/30 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                     <Camera className="text-white opacity-80" size={32} />
                   </div>
                </div>

                {/* 右下角的小相机图标装饰 */}
                <div className="absolute bottom-6 right-0 bg-blue-500 text-white p-2 rounded-full border-4 border-slate-900 shadow-lg">
                  <Camera size={16} />
                </div>
              </div>

              <h2 className="text-3xl font-black tracking-tight">{user.username}</h2>
              <p className="text-slate-500 font-medium mt-1">{user.email}</p>
              </div>
              {/* --- 新增：训练热力图 --- */}
              <div className="w-full bg-slate-800/20 border border-slate-700/30 rounded-[2rem] p-5">
                <div className="flex justify-between items-center mb-4 px-1">
                  <h3 className="text-xs font-black text-slate-500 uppercase tracking-widest flex items-center gap-2">
                    <Activity size={12} className="text-blue-500" />
                    {lang === Language.CN ? '训练活跃度' : 'Activity'}
                  </h3>
                  <span className="text-[10px] font-bold text-slate-600 bg-slate-800 px-2 py-1 rounded-lg">
                    {lang === Language.CN ? '近3个月' : 'Last 90 Days'}
                  </span>
                </div>
                
                <div className="w-full overflow-hidden">
                  <CalendarHeatmap
                    startDate={new Date(new Date().setDate(new Date().getDate() - 100))} // 显示过去100天
                    endDate={new Date()}
                    values={heatmapData}
                    classForValue={(value) => {
                      if (!value) return 'color-empty';
                      // 根据训练次数分级颜色 (1-4级)
                      return `color-scale-${Math.min(value.count, 4)}`;
                    }}
                    showWeekdayLabels={true} // 显示周一、周三等
                    weekdayLabels={lang === Language.CN ? ['日', '一', '二', '三', '四', '五', '六'] : undefined}
                    gutterSize={3} // 格子间距
                  />
                </div>
              </div>
              {/* --- 方案 A: 访客模式警告提示 --- */}
              {user.id === 'u_guest' && (
                <div className="mx-2 p-5 bg-amber-500/10 border border-amber-500/20 rounded-[2rem] flex items-start gap-4 animate-in slide-in-from-top-2">
                  <div className="p-3 bg-amber-500/20 text-amber-500 rounded-2xl flex-shrink-0">
                    <ShieldAlert size={24} />
                  </div>
                  <div className="flex flex-col gap-1">
                    <h4 className="text-sm font-black text-amber-500 uppercase tracking-wide">
                      {translations.guestWarningTitle[lang]}
                    </h4>
                    <p className="text-[11px] font-bold text-amber-200/70 leading-relaxed">
                      {translations.guestWarningDesc[lang]}
                    </p>
                    <button 
                      onClick={() => {
                        // 强制退出并跳到注册页面
                        supabase.auth.signOut();
                        setUser(null);
                        setAuthMode('register');
                        localStorage.removeItem('fitlog_current_user');
                      }}
                      className="mt-2 text-[10px] font-black text-white bg-amber-600/40 hover:bg-amber-600/60 px-3 py-1.5 rounded-lg self-start transition-colors"
                    >
                      {translations.createAccount[lang]}
                    </button>
                  </div>
                </div>
              )}
              {/* Stats Overview */}
              <div className="w-full">
                <div className="bg-slate-800/40 p-6 rounded-[2rem] border border-slate-700/50 flex flex-col items-center justify-center gap-2 w-full">
                  <span className="text-3xl font-black text-white">{workouts.length}</span>
                  <span className="text-[10px] font-black uppercase text-slate-500 tracking-widest">{lang === Language.CN ? '累计训练' : 'Workouts'}</span>
                </div>
              </div>
              {/* 行动按钮：记录体重 */}
              <button 
                onClick={() => setShowWeightInput(true)} 
                className="w-full bg-slate-800 border border-slate-700/50 p-5 rounded-[2rem] flex items-center justify-between group active:scale-95 transition-all shadow-lg"
              >
                <div className="flex items-center gap-4">
                  <div className="p-4 bg-indigo-500/20 text-indigo-400 rounded-2xl group-hover:bg-indigo-500 group-hover:text-white transition-colors">
                    <Scale size={24} />
                  </div>
                  <div className="text-left">
                    <h3 className="font-black text-xl text-white">{translations.logWeight[lang]}</h3>
                    <p className="text-xs text-slate-500 font-bold uppercase tracking-wider">{lang === Language.CN ? '记录当前数据' : 'Track Progress'}</p>
                  </div>
                </div>
                <div className="bg-slate-900 p-3 rounded-full text-slate-500 group-hover:text-indigo-400 transition-colors">
                  <Plus size={20} />
                </div>
              </button>
              {/* 自定义指标展示区 */}
              <div className="space-y-4">
                <div className="flex justify-between items-center px-2">
                   <h3 className="text-xs font-black text-slate-500 uppercase tracking-widest">{lang === Language.CN ? '身体数据 & 指标' : 'Body Metrics'}</h3>
                   <button onClick={() => setShowMeasureModal(true)} className="text-blue-500 text-xs font-black flex items-center gap-1 hover:text-blue-400">
                      <Plus size={14} /> {lang === Language.CN ? '添加' : 'Add'}
                   </button>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  {/* 循环渲染所有唯一的指标 */}
                  {/* 循环渲染所有唯一的指标 (可折叠版) */}
                  {latestMetrics.map(metric => {
                    const isExpanded = expandedMetric === metric.name;
                    
                    return (
                      <div 
                        key={metric.name} 
                        className={`bg-slate-800/40 border border-slate-700/50 rounded-[1.5rem] transition-all duration-300 overflow-hidden ${isExpanded ? 'col-span-2 ring-1 ring-indigo-500/30 bg-slate-800/60' : 'col-span-1 active:scale-95 hover:bg-slate-800/60 cursor-pointer'}`}
                        onClick={() => setExpandedMetric(isExpanded ? null : metric.name)}
                      >
                         <div className="p-4">
                           {/* 头部信息 */}
                           <div className="flex justify-between items-start mb-1">
                              <div className="flex items-center gap-2 overflow-hidden">
                                <Ruler size={14} className="text-indigo-500 flex-shrink-0" />
                                <span className="text-xs font-bold text-slate-400 truncate">{metric.name}</span>
                              </div>
                              {/* 展开/折叠指示箭头 */}
                              {isExpanded && <ChevronUp size={16} className="text-slate-500" />}
                           </div>
                           
                           {/* 数值显示 */}
                           <div className="flex items-baseline gap-1 mt-1">
                              <span className="text-2xl font-black text-white">{metric.value}</span>
                              <span className="text-[10px] font-bold text-slate-600 uppercase">{metric.unit}</span>
                           </div>
                           <p className="text-[9px] text-slate-600 mt-1">
                             {new Date(metric.date).toLocaleDateString(lang === Language.CN ? 'zh-CN' : 'en-US', { month: 'short', day: 'numeric' })}
                           </p>

                           {/* 展开后显示的内容：图表 + 操作按钮 */}
                           {/* 展开后显示的内容：图表 + 历史列表 + 操作按钮 */}
                           {isExpanded && (
                             <div className="mt-4 border-t border-slate-700/30 pt-4 cursor-default" onClick={(e) => e.stopPropagation()}>
                               
                               {/* 1. 图表区域 */}
                               <div className="mb-6">
                                 {renderMetricChart(metric.name)}
                               </div>

                               {/* 2. 历史记录列表 (新增) */}
                               <div className="mb-6 space-y-2 max-h-[200px] overflow-y-auto custom-scrollbar pr-1">
                                 <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-wider mb-3 flex items-center gap-2">
                                   <History size={10} /> {lang === Language.CN ? '历史记录' : 'History'}
                                 </h4>
                                 {measurements
                                   .filter(m => m.name === metric.name)
                                   .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
                                   .map((historyItem) => (
                                     <div key={historyItem.id} className="flex justify-between items-center bg-slate-900/30 p-3 rounded-xl border border-slate-700/30 group">
                                       <div className="flex items-center gap-3">
                                          <div className="flex flex-col">
                                            <span className="text-sm font-bold text-slate-200">{historyItem.value} <span className="text-[10px] text-slate-500 uppercase">{historyItem.unit}</span></span>
                                            <span className="text-[9px] text-slate-600">{new Date(historyItem.date).toLocaleDateString(lang === Language.CN ? 'zh-CN' : 'en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                                          </div>
                                       </div>
                                       
                                       {/* 操作按钮组 */}
                                       <div className="flex gap-2">
                                         <button 
                                           onClick={(e) => { e.stopPropagation(); triggerEditMeasurement(historyItem); }} 
                                           className="p-2 bg-indigo-500/10 text-indigo-400 rounded-lg hover:bg-indigo-500/20 active:scale-90 transition-all"
                                         >
                                           <Edit2 size={12} />
                                         </button>
                                         <button 
                                           onClick={(e) => handleDeleteMeasurement(e, historyItem.id)} 
                                           className="p-2 bg-red-500/10 text-red-500 rounded-lg hover:bg-red-500/20 active:scale-90 transition-all"
                                         >
                                           <Trash2 size={12} />
                                         </button>
                                       </div>
                                     </div>
                                   ))}
                               </div>
                               
                               {/* 3. 底部操作区：新增记录按钮 */}
                               <div className="flex justify-end pt-2 border-t border-slate-700/30">
                                 <button 
                                   onClick={() => { 
                                     setEditingMeasurementId(null); // 确保是新增模式
                                     setMeasureForm({ name: metric.name, value: '', unit: metric.unit }); 
                                     setShowMeasureModal(true); 
                                   }} 
                                   className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 rounded-2xl text-xs font-bold text-white shadow-lg shadow-indigo-600/20 active:scale-95 transition-all"
                                 >
                                   <Plus size={14} />
                                   {lang === Language.CN ? '记录新数据' : 'Add Entry'}
                                 </button>
                               </div>
                             </div>
                           )}
                         </div>
                      </div>
                    );
                  })}

                  {/* 这是一个“添加”卡片，当没有任何数据时显示，或者一直显示在最后 */}
                  <button onClick={() => setShowMeasureModal(true)} className="bg-slate-800/20 border-2 border-dashed border-slate-700/50 p-4 rounded-[1.5rem] flex flex-col items-center justify-center gap-2 hover:bg-slate-800/40 transition-all min-h-[100px]">
                     <div className="p-2 bg-slate-800 rounded-full text-slate-500">
                        <Plus size={16} />
                     </div>
                     <span className="text-[10px] font-bold text-slate-500">{lang === Language.CN ? '新指标' : 'New Metric'}</span>
                  </button>
                </div>
              </div>
              {/* Settings List */}
              <div className="bg-slate-800/30 border border-slate-700/30 rounded-[2.5rem] p-6 space-y-2">
                 {/* Language */}
                <button onClick={handleToggleLanguage} className="w-full p-4 flex justify-between items-center rounded-2xl hover:bg-slate-700/50 transition-colors">
                  <div className="flex items-center gap-4">
                    <div className="p-3 bg-blue-500/10 text-blue-500 rounded-xl"><Globe size={20} /></div>
                    <span className="font-bold text-slate-200">{translations.languageLabel[lang]}</span>
                  </div>
                  <span className="font-black text-slate-500 text-sm px-3 py-1 bg-slate-800 rounded-lg">{lang === Language.CN ? '中文' : 'EN'}</span>
                </button>
                 {/* Logout */}
                <button onClick={() => { supabase.auth.signOut(); setUser(null); localStorage.removeItem('fitlog_current_user'); setWorkouts([]); setGoals([]); setWeightEntries([]); }} className="w-full p-4 flex justify-between items-center rounded-2xl hover:bg-red-500/10 transition-colors group mt-4 border-t border-slate-700/50">
                   <div className="flex items-center gap-4">
                    <div className="p-3 bg-red-500/10 text-red-500 rounded-xl group-hover:bg-red-500 group-hover:text-white transition-colors"><LogOut size={20} /></div>
                    <span className="font-bold text-red-500 group-hover:text-red-400 transition-colors">{translations.logout[lang]}</span>
                  </div>
                  <ChevronRight size={18} className="text-slate-600" />
                </button>
              </div>
            </div>
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
      {/* --- 修改后：可拖拽悬浮休息计时器 (UI) --- */}
      {isResting && (
        <div 
          className={`fixed z-[100] touch-none cursor-move select-none ${isDraggingState ? 'transition-none' : 'transition-all duration-500 ease-out'}`}
          style={{ 
            right: `${timerPos.x}px`, 
            bottom: `${timerPos.y}px` 
          }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          // 添加 onPointerCancel 以防意外中断
          onPointerCancel={handlePointerUp}
        >
          {timerMinimized ? (
            /* 1. 最小化状态：极简圆球 (只显示时间) */
            <div className="bg-indigo-600 text-white w-16 h-16 rounded-full shadow-2xl flex items-center justify-center border-4 border-indigo-400/30 backdrop-blur-xl relative transition-transform active:scale-90">
              <span className="text-sm font-black tabular-nums tracking-tighter">
                {Math.floor(restSeconds / 60)}:{(restSeconds % 60).toString().padStart(2, '0')}
              </span>
              
              {/* 删除了之前的 Rest 文字、遮罩按钮和关闭按钮 */}
            </div>
          ) : (
            /* 2. 展开状态：完整面板 (保持不变) */
            <div className="bg-indigo-600 text-white p-4 rounded-[2rem] shadow-2xl shadow-indigo-600/40 w-80 border border-indigo-400/20 backdrop-blur-xl animate-in zoom-in-95 duration-200">
              
              {/* 顶部拖拽条 & 最小化 */}
              <div className="flex justify-between items-center mb-4 border-b border-white/10 pb-2">
                <div className="flex items-center gap-2 opacity-50">
                  <GripHorizontal size={16} />
                </div>
                <div className="flex gap-2">
                  <button 
                    onPointerDown={(e) => e.stopPropagation()} 
                    onClick={() => setTimerMinimized(true)} 
                    className="p-1 hover:bg-white/10 rounded-lg transition-colors cursor-pointer"
                  >
                    <Minimize2 size={16} />
                  </button>
                  <button 
                    onPointerDown={(e) => e.stopPropagation()} 
                    onClick={() => setIsResting(false)} 
                    className="p-1 hover:bg-white/10 rounded-lg transition-colors cursor-pointer"
                  >
                    <X size={16} />
                  </button>
                </div>
              </div>

              <div className="flex justify-between items-center">
                {/* 时间显示 */}
                <div className="flex items-center gap-3">
                  <div className="bg-white/20 p-2 rounded-full animate-pulse">
                    <History size={20} className="text-white" />
                  </div>
                  <span className="text-3xl font-black tabular-nums leading-none">
                    {Math.floor(restSeconds / 60)}:{(restSeconds % 60).toString().padStart(2, '0')}
                  </span>
                </div>

                {/* 控制按钮 */}
                <div className="flex items-center gap-1">
                  <button onPointerDown={(e) => e.stopPropagation()} onClick={() => adjustRestTime(-10)} className="w-8 h-8 flex items-center justify-center bg-black/20 hover:bg-black/30 rounded-full text-[10px] font-bold transition-colors cursor-pointer">-10</button>
                  <button onPointerDown={(e) => e.stopPropagation()} onClick={() => adjustRestTime(30)} className="w-8 h-8 flex items-center justify-center bg-black/20 hover:bg-black/30 rounded-full text-[10px] font-bold transition-colors cursor-pointer">+30</button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
      {user && (
        <nav className="fixed bottom-6 left-1/2 -translate-x-1/2 w-[90%] max-w-md bg-slate-950/90 backdrop-blur-3xl border border-white/10 p-2 flex justify-between items-center rounded-[2.5rem] z-50 shadow-2xl">
          
          {/* 1. 开始训练 (移到最左侧，保留蓝色圆圈风格，但缩小并对齐) */}
          <button 
            onClick={() => { setCurrentWorkout({ title: '', exercises: [], date: new Date().toISOString() }); setActiveTab('new'); }} 
            className="flex-1 flex flex-col items-center gap-1.5 py-2 rounded-3xl transition-all hover:bg-white/5 active:scale-95"
          >
            {/* 蓝色圆圈背景，大小适中 (p-2.5) */}
            <div className={`rounded-full p-2.5 shadow-lg shadow-blue-600/30 transition-all ${activeTab === 'new' ? 'bg-blue-500 text-white' : 'bg-blue-600 text-white'}`}>
              <Plus size={20} strokeWidth={3} />
            </div>
            {/* 文字标签，确保高度对齐 */}
            <span className={`text-[9px] font-black uppercase tracking-wide ${activeTab === 'new' ? 'text-blue-500' : 'text-slate-500'}`}>
              {lang === Language.CN ? '开始' : 'Start'}
            </span>
          </button>

          {/* 2. 首页 Dashboard */}
          <button onClick={() => setActiveTab('dashboard')} className={`flex-1 flex flex-col items-center gap-1.5 py-2 rounded-3xl transition-all ${activeTab === 'dashboard' ? 'text-blue-500' : 'text-slate-600 hover:text-slate-400'}`}>
            <div className="p-2.5"> {/* 添加透明容器占位，确保图标视觉中心对齐 */}
              <BarChart2 size={20} strokeWidth={2.5} />
            </div>
            <span className="text-[9px] font-black uppercase tracking-wide">{translations.dashboard[lang]}</span>
          </button>
          
          {/* 3. 训练目标 Goals */}
          <button onClick={() => setActiveTab('goals')} className={`flex-1 flex flex-col items-center gap-1.5 py-2 rounded-3xl transition-all ${activeTab === 'goals' ? 'text-blue-500' : 'text-slate-600 hover:text-slate-400'}`}>
            <div className="p-2.5">
              <Target size={20} strokeWidth={2.5} />
            </div>
            <span className="text-[9px] font-black uppercase tracking-wide">{translations.goals[lang]}</span>
          </button>
          
          {/* 4. 我的 Profile */}
          <button onClick={() => setActiveTab('profile')} className={`flex-1 flex flex-col items-center gap-1.5 py-2 rounded-3xl transition-all ${activeTab === 'profile' ? 'text-blue-500' : 'text-slate-600 hover:text-slate-400'}`}>
            <div className="p-2.5">
              <UserIcon size={20} strokeWidth={2.5} />
            </div>
            <span className="text-[9px] font-black uppercase tracking-wide">{lang === Language.CN ? '我的' : 'Profile'}</span>
          </button>

        </nav>
      )}
    </div>
  );
};

export default App;
