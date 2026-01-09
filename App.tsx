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
import { XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ComposedChart, Area, Bar } from 'recharts';
// 简单的 "叮" 声 Base64
const BEEP_SOUND = 'data:audio/wav;base64,UklGRl9vT1BXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YU'; // (简略版，实际代码中我会给一个短促有效的提示音)
// 为了代码整洁，我们可以直接用一个简单的 Audio 对象
const beepAudio = new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3'); // 使用在线短提示音，或者你可以换成本地的
const KG_TO_LBS = 2.20462;
const KMH_TO_MPH = 0.621371;



const formatValue = (val: number, type: string, currentUnitSystem: 'kg' | 'lbs') => {
  if (val === undefined || val === null) return '0.00';
  
  let result = val;
  let unitLabel = '';

  switch (type) {
    case 'weight':
      result = currentUnitSystem === 'kg' ? val : val * KG_TO_LBS;
      unitLabel = currentUnitSystem.toUpperCase();
      break;
    case 'distance':
      // 公制支持 m/km 自动切换
      if (currentUnitSystem === 'kg') {
        if (val >= 1000) {
          result = val / 1000;
          unitLabel = 'km';
        } else {
          unitLabel = 'm';
        }
      } else {
        unitLabel = 'm'; // 英制按用户要求保留 m
      }
      break;
    case 'speed':
      result = currentUnitSystem === 'kg' ? val : val * KMH_TO_MPH;
      unitLabel = currentUnitSystem === 'kg' ? 'km/h' : 'mph';
      break;
    case 'duration':
      const h = Math.floor(val / 3600);
      const m = Math.floor((val % 3600) / 60);
      const s = val % 60;
      return h > 0 ? `${h}h ${m}m ${s}s` : `${m}m ${s}s`;
    default:
      unitLabel = type.replace('custom_', '');
  }

  return `${result.toFixed(2)} ${unitLabel}`;
};

// ✅ 新增：专门获取单位文本，用于表头显示
  const getUnitTag = (type: string, currentUnitSystem: 'kg' | 'lbs') => {
    switch (type) {
      case 'weight': return currentUnitSystem === 'kg' ? 'kg' : 'lbs';
      case 'distance': return currentUnitSystem === 'kg' ? 'm/km' : 'm';
      case 'speed': return currentUnitSystem === 'kg' ? 'km/h' : 'mph';
      case 'duration': return 'h:m:s';
      default: return ''; // 自定义维度由用户自行命名，通常不带预设单位
    }
  };
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
type ExerciseCategory = 'STRENGTH' | 'CARDIO' | 'FREE' | 'OTHER';

const BODY_PARTS = ['subChest', 'subShoulder', 'subBack', 'subArms', 'subLegs', 'subCore'];
const EQUIPMENT_TAGS = [
  'tagBarbell', 'tagDumbbell', 'tagMachine', 'tagCable', 
  'tagBodyweight', 'tagOutdoor', 'tagIndoor', 'tagBallGame', 'tagGym'
];

const DEFAULT_EXERCISES: ExerciseDefinition[] = [
  // Chest
  { id: 'bp_barbell', name: { en: 'Barbell Bench Press', cn: '杠铃平板卧推' }, bodyPart: 'subChest', tags: ['tagBarbell'], category: 'STRENGTH', exerciseConfig: { supportsPyramid: true, bodyweightType: 'none', pyramidModes: ['increasing', 'decreasing', 'mixed'] } },
  { id: 'bp_incline_barbell', name: { en: 'Incline Barbell Bench Press', cn: '杠铃上斜卧推' }, bodyPart: 'subChest', tags: ['tagBarbell'], category: 'STRENGTH', exerciseConfig: { supportsPyramid: true, bodyweightType: 'none', pyramidModes: ['increasing', 'decreasing'] } },
  { id: 'bp_dumbbell', name: { en: 'Dumbbell Bench Press', cn: '哑铃平板卧推' }, bodyPart: 'subChest', tags: ['tagDumbbell'], category: 'STRENGTH'  },
  { id: 'bp_incline_dumbbell', name: { en: 'Incline Dumbbell Bench Press', cn: '哑铃上斜卧推' }, bodyPart: 'subChest', tags: ['tagDumbbell'], category: 'STRENGTH'  },
  { id: 'fly_cable', name: { en: 'Cable Fly', cn: '绳索夹胸' }, bodyPart: 'subChest', tags: ['tagCable'], category: 'STRENGTH'  },
  { id: 'press_machine_chest', name: { en: 'Machine Chest Press', cn: '器械推胸' }, bodyPart: 'subChest', tags: ['tagMachine'], category: 'STRENGTH'  },
  { id: 'chest_dip', name: { en: 'Chest Dip', cn: '胸部双杠臂屈伸' }, bodyPart: 'subChest', tags: ['tagBodyweight'], category: 'STRENGTH', exerciseConfig: { supportsPyramid: true, bodyweightType: 'bodyweight', pyramidModes: ['decreasing', 'mixed'] } },
  { id: 'pushup', name: { en: 'Push-ups', cn: '俯卧撑' }, bodyPart: 'subChest', tags: ['tagBodyweight'], category: 'STRENGTH', exerciseConfig: { supportsPyramid: true, bodyweightType: 'bodyweight', pyramidModes: ['decreasing', 'increasing'] } },
  
  // Back
  { id: 'dl_barbell', name: { en: 'Deadlift', cn: '硬拉' }, bodyPart: 'subBack', tags: ['tagBarbell'], category: 'STRENGTH'  },
  { id: 'row_barbell', name: { en: 'Barbell Row', cn: '杠铃划船' }, bodyPart: 'subBack', tags: ['tagBarbell'], category: 'STRENGTH'  },
  { id: 'lat_pulldown', name: { en: 'Lat Pulldown', cn: '高位下拉' }, bodyPart: 'subBack', tags: ['tagMachine', 'tagCable'], category: 'STRENGTH'  },
  { id: 'row_seated_cable', name: { en: 'Seated Cable Row', cn: '坐姿划船' }, bodyPart: 'subBack', tags: ['tagCable'], category: 'STRENGTH'  },
  { id: 'pu_weighted', name: { en: 'Weighted Pull-up', cn: '加重引体向上' }, bodyPart: 'subBack', tags: ['tagBodyweight'], category: 'STRENGTH', exerciseConfig: { supportsPyramid: true, bodyweightType: 'weighted', pyramidModes: ['decreasing', 'mixed'] } },
  { id: 'single_arm_db_row', name: { en: 'Single Arm Dumbbell Row', cn: '哑铃单臂划船' }, bodyPart: 'subBack', tags: ['tagDumbbell'], category: 'STRENGTH'  },
  { id: 'tbar_row', name: { en: 'T-Bar Row', cn: 'T杠划船' }, bodyPart: 'subBack', tags: ['tagBarbell', 'tagMachine'], category: 'STRENGTH'  },
  { id: 'hyperextension', name: { en: 'Hyperextension', cn: '山羊挺身' }, bodyPart: 'subBack', tags: ['tagBodyweight', 'tagMachine'], category: 'STRENGTH'  },
  
  // Shoulder
  { id: 'ohp_barbell', name: { en: 'Overhead Press', cn: '杠铃推举' }, bodyPart: 'subShoulder', tags: ['tagBarbell'], category: 'STRENGTH'  },
  { id: 'ohp_dumbbell', name: { en: 'Dumbbell Shoulder Press', cn: '哑铃推肩' }, bodyPart: 'subShoulder', tags: ['tagDumbbell'], category: 'STRENGTH'  },
  { id: 'lat_raise_dumbbell', name: { en: 'Dumbbell Lateral Raise', cn: '哑铃侧平举' }, bodyPart: 'subShoulder', tags: ['tagDumbbell'], category: 'STRENGTH'  },
  { id: 'face_pull_cable', name: { en: 'Cable Face Pull', cn: '绳索面拉' }, bodyPart: 'subShoulder', tags: ['tagCable'], category: 'STRENGTH'  },
  { id: 'press_machine_shoulder', name: { en: 'Machine Shoulder Press', cn: '器械推肩' }, bodyPart: 'subShoulder', tags: ['tagMachine'], category: 'STRENGTH'  },
  { id: 'arnold_press', name: { en: 'Arnold Press', cn: '阿诺德推举' }, bodyPart: 'subShoulder', tags: ['tagDumbbell'], category: 'STRENGTH'  },
  { id: 'front_raise_db', name: { en: 'Dumbbell Front Raise', cn: '哑铃前平举' }, bodyPart: 'subShoulder', tags: ['tagDumbbell'], category: 'STRENGTH'  },
  
  // Legs
  { id: 'sq_barbell', name: { en: 'Barbell Squat', cn: '深蹲' }, bodyPart: 'subLegs', tags: ['tagBarbell'], category: 'STRENGTH', exerciseConfig: { supportsPyramid: true, bodyweightType: 'none', pyramidModes: ['increasing', 'decreasing', 'mixed'] } },
  { id: 'goblet_squat', name: { en: 'Goblet Squat', cn: '高杯深蹲' }, bodyPart: 'subLegs', tags: ['tagDumbbell'], category: 'STRENGTH'  },
  { id: 'leg_press', name: { en: 'Leg Press', cn: '倒蹬/腿举' }, bodyPart: 'subLegs', tags: ['tagMachine'], category: 'STRENGTH'  },
  { id: 'leg_extension', name: { en: 'Leg Extension', cn: '腿屈伸' }, bodyPart: 'subLegs', tags: ['tagMachine'], category: 'STRENGTH'  },
  { id: 'leg_curl', name: { en: 'Leg Curl', cn: '腿弯举' }, bodyPart: 'subLegs', tags: ['tagMachine'], category: 'STRENGTH'  },
  { id: 'calf_raise', name: { en: 'Calf Raise', cn: '提踵' }, bodyPart: 'subLegs', tags: ['tagMachine', 'tagBodyweight'], category: 'STRENGTH'  },
  { id: 'lunge_dumbbell', name: { en: 'Dumbbell Lunge', cn: '哑铃箭步蹲' }, bodyPart: 'subLegs', tags: ['tagDumbbell'], category: 'STRENGTH'  },
  { id: 'romanian_deadlift', name: { en: 'Romanian Deadlift', cn: '罗马尼亚硬拉' }, bodyPart: 'subLegs', tags: ['tagBarbell', 'tagDumbbell'], category: 'STRENGTH'  },
  
  // Arms
  { id: 'cu_barbell', name: { en: 'Barbell Curl', cn: '杠铃弯举' }, bodyPart: 'subArms', tags: ['tagBarbell'], category: 'STRENGTH'  },
  { id: 'cu_dumbbell', name: { en: 'Dumbbell Curl', cn: '哑铃弯举' }, bodyPart: 'subArms', tags: ['tagDumbbell'], category: 'STRENGTH'  },
  { id: 'cu_ hammer', name: { en: 'Hammer Curl', cn: '锤式弯举' }, bodyPart: 'subArms', tags: ['tagDumbbell'], category: 'STRENGTH'  },
  { id: 'tricep_pushdown', name: { en: 'Tricep Pushdown', cn: '肱三头肌下压' }, bodyPart: 'subArms', tags: ['tagCable'], category: 'STRENGTH'  },
  { id: 'skull_crusher', name: { en: 'Skull Crusher', cn: '哑卧臂屈伸' }, bodyPart: 'subArms', tags: ['tagBarbell', 'tagDumbbell'], category: 'STRENGTH'  },
  { id: 'preacher_curl', name: { en: 'Preacher Curl', cn: '牧师凳弯举' }, bodyPart: 'subArms', tags: ['tagBarbell', 'tagMachine'], category: 'STRENGTH'  },
  { id: 'overhead_extension_db', name: { en: 'Overhead Tricep Extension', cn: '颈后臂屈伸' }, bodyPart: 'subArms', tags: ['tagDumbbell'], category: 'STRENGTH'  },
  
  // Core
  { id: 'plank', name: { en: 'Plank', cn: '平板支撑' }, bodyPart: 'subCore', tags: ['tagBodyweight'], category: 'STRENGTH'  },
  { id: 'leg_raise', name: { en: 'Hanging Leg Raise', cn: '悬垂举腿' }, bodyPart: 'subCore', tags: ['tagBodyweight'], category: 'STRENGTH'  },
  { id: 'cable_crunch', name: { en: 'Cable Crunch', cn: '绳索卷腹' }, bodyPart: 'subCore', tags: ['tagCable'], category: 'STRENGTH'  },
  { id: 'russian_twist', name: { en: 'Russian Twist', cn: '俄罗斯转体' }, bodyPart: 'subCore', tags: ['tagBodyweight', 'tagDumbbell'], category: 'STRENGTH'  },
  { id: 'ab_wheel', name: { en: 'Ab Wheel Rollout', cn: '健腹轮' }, bodyPart: 'subCore', tags: ['tagBodyweight'], category: 'STRENGTH'  },

    // --- 有氧训练 (CARDIO) ---
  { id: 'run_out', name: { en: 'Outdoor Running', cn: '室外跑步' }, bodyPart: 'subLegs', tags: ['tagOutdoor'], category: 'CARDIO' },
  { id: 'run_tread', name: { en: 'Treadmill', cn: '跑步机' }, bodyPart: 'subLegs', tags: ['tagIndoor', 'tagGym'], category: 'CARDIO' },
  { id: 'bike_out', name: { en: 'Outdoor Cycling', cn: '室外骑行' }, bodyPart: 'subLegs', tags: ['tagOutdoor'], category: 'CARDIO' },
  { id: 'bike_stat', name: { en: 'Stationary Bike', cn: '动感单车' }, bodyPart: 'subLegs', tags: ['tagIndoor', 'tagGym'], category: 'CARDIO' },
  { id: 'swim', name: { en: 'Swimming', cn: '游泳' }, bodyPart: 'subFullBody', tags: ['tagIndoor', 'tagOutdoor'], category: 'CARDIO' },
  { id: 'rower', name: { en: 'Rowing Machine', cn: '划船机' }, bodyPart: 'subBack', tags: ['tagMachine', 'tagGym'], category: 'CARDIO' },
  { id: 'stair', name: { en: 'Stair Climber', cn: '登山机' }, bodyPart: 'subLegs', tags: ['tagMachine', 'tagGym'], category: 'CARDIO' },
  { id: 'rope', name: { en: 'Jump Rope', cn: '跳绳' }, bodyPart: 'subFullBody', tags: ['tagBodyweight'], category: 'CARDIO' },

  // --- 自由训练 (FREE) ---
  { id: 'ball_basket', name: { en: 'Basketball', cn: '篮球' }, bodyPart: 'subFullBody', tags: ['tagBallGame', 'tagOutdoor'], category: 'FREE' },
  { id: 'ball_soccer', name: { en: 'Soccer', cn: '足球' }, bodyPart: 'subFullBody', tags: ['tagBallGame', 'tagOutdoor'], category: 'FREE' },
  { id: 'ball_badm', name: { en: 'Badminton', cn: '羽毛球' }, bodyPart: 'subFullBody', tags: ['tagBallGame', 'tagIndoor'], category: 'FREE' },
  { id: 'ball_tennis', name: { en: 'Tennis', cn: '网球' }, bodyPart: 'subFullBody', tags: ['tagBallGame', 'tagOutdoor'], category: 'FREE' },
  { id: 'yoga_flow', name: { en: 'Yoga', cn: '瑜伽' }, bodyPart: 'subFullBody', tags: ['tagBodyweight', 'tagIndoor'], category: 'FREE' },
  { id: 'stretch_all', name: { en: 'Stretching', cn: '拉伸' }, bodyPart: 'subFullBody', tags: ['tagBodyweight'], category: 'FREE' },
  { id: 'hiit_session', name: { en: 'HIIT', cn: '高强度间歇训练' }, bodyPart: 'subFullBody', tags: ['tagBodyweight', 'tagIndoor'], category: 'FREE' },
];

const App: React.FC = () => {
  const [activeLibraryCategory, setActiveLibraryCategory] = useState<ExerciseCategory | null>(null);
  // ✅ 新增：记录用户之前选择的分类，用于"全部分类"按钮的切换功能
  const [previousLibraryCategory, setPreviousLibraryCategory] = useState<ExerciseCategory | null>(null);
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
  const [isUpdateSuccess, setIsUpdateSuccess] = useState(false); // ✅ 新增：控制显示成功画面
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'error'>('idle');
  
  const [workouts, setWorkouts] = useState<WorkoutSession[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [weightEntries, setWeightEntries] = useState<WeightEntry[]>([]);
  // 定义一个本地接口
  interface Measurement { id: string; userId: string; name: string; value: number; unit: string; date: string; }
  
  const [measurements, setMeasurements] = useState<Measurement[]>([]);

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
  // 默认内置维度
  const STANDARD_METRICS = ['weight', 'reps', 'distance', 'duration', 'speed'];
  
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
    let timeoutIds: NodeJS.Timeout[] = []; // ✅ 修复Bug #1: 存储所有setTimeout ID
    
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
        // ✅ 修复Bug #1: 检查组件是否仍然处于休息状态，避免组件卸载后继续执行
        if (playCount === 0 && !isResting) return;
        
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
          const timeoutId = setTimeout(playAlert, 1200);
          timeoutIds.push(timeoutId); // ✅ 修复Bug #1: 记录timeout ID用于清理
        }
      };

      // 立即触发
      playAlert();
    }

    // ✅ 修复Bug #1: 清理函数 - 清理所有定时器，防止内存泄漏
    return () => {
      if (interval) clearInterval(interval);
      timeoutIds.forEach(id => clearTimeout(id)); // 清理所有setTimeout
    };
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
  // ✅ 修复单位显示不一致Bug: 从localStorage同步读取初始值，避免异步加载导致的不一致
  const [unit, setUnit] = useState<'kg' | 'lbs'>(() => {
    const savedUnit = localStorage.getItem('fitlog_unit') as 'kg' | 'lbs';
    return savedUnit || 'kg';
  });
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

  const getChartDataFor = (target: string, metricKey?: string) => {
    if (target === '__WEIGHT__') {
       // ... 体重逻辑保持不变 ...
       return weightEntries.map(entry => ({
         date: new Date(entry.date).toLocaleDateString(lang === Language.CN ? 'zh-CN' : 'en-US', { month: 'short', day: 'numeric' }),
         val: Number((unit === 'kg' ? entry.weight : entry.weight * KG_TO_LBS).toFixed(2)),
         timestamp: new Date(entry.date).getTime()
       })).sort((a, b) => a.timestamp - b.timestamp);
    }

    const searchName = target.trim();
    const key = metricKey || getChartMetric(searchName);

    return workouts
      .filter(w => w.exercises.some(ex => resolveName(ex.name).trim() === searchName))
      .map(w => {
        const ex = w.exercises.find(e => resolveName(e.name).trim() === searchName)!;
        
        // 提取该维度在本次训练中的最大值 (Max Effort)
        const values = ex.sets.map(s => {
          const v = (s as any)[key] || 0;
          // ✅ 核心转换逻辑
          if (key === 'weight' && unit === 'lbs') return v * 2.20462;
          if (key === 'speed' && unit === 'lbs') return v * 0.621371; // mph
          // 距离 m -> km 在 formatValue 里处理显示，图表内部建议保持原始数值(m)以保证精度
          return v;
        });

        const maxVal = Math.max(...values);
        return { 
          date: new Date(w.date).toLocaleDateString(lang === Language.CN ? 'zh-CN' : 'en-US', { month: 'short', day: 'numeric' }), 
          val: Number(maxVal.toFixed(2)),
          timestamp: new Date(w.date).getTime() 
        };
      })
      .sort((a, b) => a.timestamp - b.timestamp);
  };

  const renderTrendChart = (target: string, metricKey?: string) => {
    // ✅ 关键：在调用 getChartDataFor 时把这个 key 传进去
    const data = getChartDataFor(target, metricKey); 
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
              formatter={(value: number) => [value.toFixed(2), metricKey || 'Value']}
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
              dataKey="val"  // 👈 必须叫 val，因为 getChartDataFor 返回的是 val
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
// ✅ 优化版：身体指标折线图 (与训练图表风格完全统一)
  const renderMetricChart = (metricName: string) => {
    // 1. 提取并清洗数据
    const data = measurements
      .filter(m => m.name === metricName)
      .map(m => ({
        date: new Date(m.date).toLocaleDateString(lang === Language.CN ? 'zh-CN' : 'en-US', { month: 'short', day: 'numeric' }),
        val: Number(m.value.toFixed(2)), // ✅ 统一使用 val 键
        unit: m.unit,
        timestamp: new Date(m.date).getTime()
      }))
      .sort((a, b) => a.timestamp - b.timestamp);

    if (data.length === 0) return null;

    return (
      <div className="w-full h-[180px] mt-4 animate-in fade-in slide-in-from-top-2">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
            <defs>
              <linearGradient id={`grad-metric-${metricName}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3}/>
                <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
              </linearGradient>
            </defs>
            <XAxis dataKey="date" stroke="#475569" fontSize={10} tickMargin={15} minTickGap={40} tick={{ fill: '#94a3b8' }} axisLine={false} tickLine={false} />
            <YAxis stroke="#475569" fontSize={10} tick={{ fill: '#94a3b8' }} axisLine={false} tickLine={false} domain={['auto', 'auto']} />
            
            <Tooltip 
              contentStyle={{ backgroundColor: '#0f172a', borderRadius: '16px', border: '1px solid #1e293b', padding: '12px' }} 
              itemStyle={{ fontWeight: '900', color: '#fff', fontSize: '12px' }}
              labelStyle={{ display: 'none' }}
              formatter={(value: number) => [value.toFixed(2), metricName]}
            />

            <Area 
              type="monotone" 
              dataKey="val" // ✅ 与 renderTrendChart 保持一致
              stroke="#6366f1" // 身体指标使用紫色调，与训练的蓝色调区分
              strokeWidth={4} 
              fillOpacity={1} 
              fill={`url(#grad-metric-${metricName})`}
              animationDuration={1500}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    );
  };
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

          // B. 初始化“最终版本”变量（默认先用本地的）
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
            if (remoteConfig.starred) finalStarred = remoteConfig.starred;
            
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
          
          // F. ✅ 最终一步：将这个“终极合并版”配置上传回云端，实现多端对齐
          await syncUserConfigsToCloud({
            exerciseNotes: finalNotes,
            restPrefs: finalRest,
            customTags: finalTags,
            starred: finalStarred,
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
      lang === 'cn' 
        ? `确定要删除 ${exerciseName} 在 ${date} 的记录吗？\n\n注意：这只会删除这个动作的记录，不会影响同一训练中的其他动作。`
        : `Are you sure you want to delete the ${exerciseName} record from ${date}?\n\nNote: This will only delete this exercise record, not affecting other exercises in the same workout.`
    );
    
    if (!confirmed) return;
    
    try {
      // 1. 获取训练记录
      const allWorkouts = await db.getAll<WorkoutSession>('workouts');
      const workout = allWorkouts.find(w => w.id === workoutId);
      if (!workout) {
        console.warn('Workout not found:', workoutId);
        return;
      }
      
      // 2. 移除指定动作
      const updatedExercises = workout.exercises.filter(ex => ex.id !== exerciseId);
      
      // 3. 如果训练为空，删除整个训练
      if (updatedExercises.length === 0) {
        await db.delete('workouts', workoutId);
        console.log('Deleted entire workout (was empty after removing exercise)');
      } else {
        // 4. 否则更新训练记录
        const updatedWorkout = { ...workout, exercises: updatedExercises };
        await db.save('workouts', updatedWorkout);
        console.log('Updated workout after removing exercise');
      }
      
      // 5. 重新加载数据
      await loadLocalData(user?.id || 'u_guest');
      
      // 6. 同步到云端
      if (user && user.id !== 'u_guest') {
        performFullSync(user.id);
      }
      
      // 7. 用户反馈
      alert(
        lang === 'cn' 
          ? `已删除 ${exerciseName} 的记录`
          : `Deleted ${exerciseName} record`
      );
      
    } catch (error) {
      console.error('Error deleting exercise record:', error);
      alert(
        lang === 'cn' 
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

        // 1. 如果拖动的是当前动作绑定的“部位”，则将其清空（设为空字符串）
        if (currentBodyPart === tagId) {
          next.bodyPart = '';
        } 
        // 2. 如果拖动的是“标签列表”中的一项，则过滤掉它
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

  const renderSetCapsule = (s: any, exerciseName: string, exercise?: Exercise) => {
    // 这里的逻辑是根据动作名称获取它开启了哪些维度
    const metrics = getActiveMetrics(exerciseName);
    
    // ✅ 新增：获取动作配置信息用于显示特殊标识
    const config = exercise ? getExerciseConfig(exercise) : null;
    const isPyramid = config?.enablePyramid || false;
    const bodyweightMode = config?.bodyweightMode || 'none';
    
    return (
      <div className="bg-slate-900/60 border border-slate-800/80 px-4 py-2 rounded-2xl transition-all hover:border-blue-500/30">
        {/* ✅ 新增：显示配置标识 */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {/* 显示训练数据 */}
          {metrics.map(m => (
            <div key={m} className="flex items-center gap-1">
              <span className="text-[10px] text-slate-500 font-bold uppercase">
                {translations[m as keyof typeof translations]?.[lang] || m.replace('custom_', '')}:
              </span>
              {/* 使用我们之前定义的 formatValue 来显示带单位的值 */}
              <span className="font-black text-slate-100 text-sm">{formatValue(s[m], m, unit)}</span>
            </div>
          ))}
          
          {/* ✅ 新增：显示特殊配置标识 */}
          <div className="flex items-center gap-1 ml-2">
            {/* 递增递减组标识 */}
            {isPyramid && (
              <div className="flex items-center gap-1 px-2 py-1 bg-orange-500/20 text-orange-400 rounded-lg border border-orange-500/30">
                <Layers size={10} />
                <span className="text-[8px] font-black uppercase">
                  {lang === Language.CN ? '递增递减' : 'Pyramid'}
                </span>
              </div>
            )}
            
            {/* 自重模式标识 */}
            {bodyweightMode !== 'none' && (
              <div className={`flex items-center gap-1 px-2 py-1 rounded-lg border text-[8px] font-black uppercase ${
                bodyweightMode === 'bodyweight' ? 'bg-green-500/20 text-green-400 border-green-500/30' :
                bodyweightMode === 'weighted' ? 'bg-blue-500/20 text-blue-400 border-blue-500/30' :
                bodyweightMode === 'assisted' ? 'bg-purple-500/20 text-purple-400 border-purple-500/30' :
                'bg-slate-500/20 text-slate-400 border-slate-500/30'
              }`}>
                {bodyweightMode === 'bodyweight' && <><UserIcon size={10} /><span>{lang === Language.CN ? '自重' : 'BW'}</span></>}
                {bodyweightMode === 'weighted' && <><Plus size={10} /><span>{lang === Language.CN ? '负重' : '+W'}</span></>}
                {bodyweightMode === 'assisted' && <><Minus size={10} /><span>{lang === Language.CN ? '辅助' : 'AST'}</span></>}
              </div>
            )}
            
            {/* 递增递减组子组显示 */}
            {isPyramid && s.subSets && s.subSets.length > 0 && (
              <div className="flex items-center gap-1 px-2 py-1 bg-indigo-500/20 text-indigo-400 rounded-lg border border-indigo-500/30">
                <Hash size={10} />
                <span className="text-[8px] font-black">
                  {s.subSets.length} {lang === Language.CN ? '子组' : 'Sub'}
                </span>
              </div>
            )}
          </div>
        </div>
        
        {/* ✅ 新增：递增递减组子组详细信息展示 */}
        {isPyramid && s.subSets && s.subSets.length > 0 && (
          <div className="mt-2 pt-2 border-t border-slate-700/50">
            <div className="flex flex-wrap gap-1">
              {s.subSets.map((subSet: SubSetLog, idx: number) => (
                <div key={subSet.id || idx} className="flex items-center gap-1 px-2 py-1 bg-slate-800/60 rounded-lg border border-slate-700/50">
                  <span className="text-[8px] text-slate-500 font-bold">{idx + 1}:</span>
                  <span className="text-[8px] text-slate-300 font-bold">
                    {subSet.weight > 0 && `${subSet.weight}${unit === 'kg' ? 'kg' : 'lbs'}`}
                    {subSet.weight > 0 && subSet.reps > 0 && ' × '}
                    {subSet.reps > 0 && `${subSet.reps}${lang === Language.CN ? '次' : 'r'}`}
                  </span>
                  {subSet.note && (
                    <div className="flex items-center gap-1">
                      <StickyNote size={8} className="text-slate-500" />
                      <span className="text-[7px] text-slate-500 max-w-[60px] truncate" title={subSet.note}>
                        {subSet.note}
                      </span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
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
                    // ✅ 核心修改：移除 parentCategory 过滤，显示所有已创建的自定义器材标签（如“篮球”）
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
              {/* ✅ 第四步：修改此处的“确定”按钮逻辑 */}
              <button 
                onClick={async () => { 
                  if (!newExerciseName) return; 
                  
                  const currentCat = activeLibraryCategory || 'STRENGTH';

                  // 1. 自动“学习”逻辑：如果选中的标签不属于当前分类，将其变为通用标签
                  const selectedTagIds = [...newExerciseTags, newExerciseBodyPart].filter(Boolean);
                  const updatedTags = customTags.map(tag => {
                    // 如果这个标签被选中了，且它原本只属于另一个分类
                    if (selectedTagIds.includes(tag.id) && tag.parentCategory && tag.parentCategory !== currentCat) {
                       // 将其 parentCategory 设为 null，意味着它现在是全部分类通用的“高级标签”
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
              className={`w-80 overflow-y-auto space-y-6 pr-4 border-r border-slate-800/50 custom-scrollbar transition-all ${
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
            <div className="flex-1 overflow-y-auto space-y-4 custom-scrollbar pr-2 pb-20">
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
                        
                        setCurrentWorkout(p => ({ 
                          ...p, 
                          exercises: [
                            { 
                              id: `exercise_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                              name: ex.name[lang], 
                              category: ex.category || activeLibraryCategory || 'STRENGTH', 
                              sets: [{ id: Date.now().toString(), weight: 0, reps: 0 }],
                              exerciseTime: exerciseTime,
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
                          <div className="border-t border-slate-700/30 mt-6 pt-6 animate-in fade-in duration-200">

                          {/* ✅ 新增：图表维度切换按钮组 */}
                        <div className="flex flex-wrap gap-2 mb-4 px-2">
                          {getActiveMetrics(lift.name).map(m => (
                            <button
                              key={m}
                              onClick={() => setChartMetricPreference({...chartMetricPreference, [lift.name]: m})}
                              className={`px-3 py-1.5 rounded-xl text-[10px] font-black uppercase transition-all ${
                                getChartMetric(lift.name) === m 
                                  ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20' 
                                  : 'bg-slate-900 text-slate-500 border border-slate-800'
                              }`}
                            >
                              {translations[m as keyof typeof translations]?.[lang] || m.replace('custom_', '')}
                            </button>
                          ))}
                        </div>

                        <div className="mb-8">
                          {/* 传递当前选中的维度给图表 */}
                          {renderTrendChart(lift.name, getChartMetric(lift.name))}
                        </div>

                            {historyExs.length > 0 && (
                              <div className="space-y-4 mt-4 border-t border-slate-800 pt-8">
                                <button onClick={() => setIsHistoryVisible(!isHistoryVisible)} className="w-full flex items-center justify-between px-1 group"><h4 className="text-[10px] text-slate-500 font-black uppercase tracking-widest group-hover:text-blue-400 transition-colors">{translations.history[lang]} ({historyExs.length})</h4><div className={`p-2 rounded-xl bg-slate-900/50 text-slate-600 group-hover:text-blue-500 transition-all ${isHistoryVisible ? 'rotate-180 text-blue-500' : ''}`}><ChevronDown size={16} /></div></button>
                                {isHistoryVisible && (
                                  <div className="space-y-6 max-h-[500px] overflow-y-auto custom-scrollbar pr-2 pt-2 animate-in fade-in slide-in-from-top-2">
                                    {historyExs.map((ex, exIdx) => (
                                      <div key={`${ex.workoutId}-${ex.id}-${exIdx}`} className="space-y-4 pb-6 border-b border-slate-800/30 last:border-0 last:pb-0">
                                        <div className="flex justify-between items-center px-1">
                                          <div className="flex items-center gap-3">
                                            <button onClick={(e) => { e.stopPropagation(); handleEditWorkout(ex.workoutId); }} 
                                            className="p-2 bg-blue-500/10 text-blue-500 rounded-xl hover:bg-blue-500/20 transition-all active:scale-90"><Edit2 size={14} /></button>
                                            
                                            {/* ✅ 修复历史记录删除Bug: 修改删除按钮，删除单个动作记录而不是整个训练 */}
                                            <button 
                                              onClick={(e) => handleDeleteExerciseRecord(
                                                e, 
                                                ex.workoutId, 
                                                ex.id, 
                                                resolveName(ex.name), 
                                                ex.date
                                              )}
                                              className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                                              title={lang === 'cn' ? '删除这个动作记录' : 'Delete this exercise record'}
                                            >
                                              <Trash2 size={16} />
                                            </button>
                                            
                                            <div className="flex items-center gap-2">
                                              <Calendar size={14} className="text-slate-600" />
                                              <span className="text-[11px] text-slate-400 font-bold">
                                                {new Date(ex.date).toLocaleDateString(lang === Language.CN ? 'zh-CN' : 'en-US', { year: 'numeric', month: 'short', day: 'numeric' })}
                                              </span>
                                            </div>
                                            
                                            {/* ✅ 新增：显示和编辑动作的具体训练时间 */}
                                            {ex.exerciseTime && (
                                              <button
                                                onClick={async (e) => {
                                                  e.stopPropagation();
                                                  const newTime = prompt(
                                                    lang === 'cn' ? '请输入新的训练时间 (格式: YYYY-MM-DDTHH:MM)' : 'Enter new exercise time (format: YYYY-MM-DDTHH:MM)',
                                                    new Date(ex.exerciseTime).toISOString().slice(0, 16)
                                                  );
                                                  if (newTime) {
                                                    const timeISO = new Date(newTime).toISOString();
                                                    await updateExerciseTime(ex.workoutId, ex.id, timeISO);
                                                  }
                                                }}
                                                className="px-2 py-1 bg-slate-700/50 border border-slate-600/50 rounded-lg text-xs font-bold text-slate-300 hover:bg-slate-600/50 transition-colors"
                                                title={lang === 'cn' ? '点击编辑训练时间' : 'Click to edit exercise time'}
                                              >
                                                {formatExerciseTime(ex.exerciseTime, lang === 'cn' ? 'cn' : 'en').time}
                                              </button>
                                            )}
                                          </div>
                                          <span className="text-[10px] font-black bg-slate-800/80 text-slate-500 px-3 py-1 rounded-full uppercase tracking-wider border border-slate-700/30">{ex.sets.length} {translations.setsCount[lang]}</span>
                                        </div>
                                        <div className="flex flex-wrap gap-2">{ex.sets.map((s: any) => renderSetCapsule(s, ex.name, ex))}</div>
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

                  {/* --- ✅ 新增：底部导出区域 --- */}
                <div className="mt-12 mb-12 px-2 pb-20">
                  <div className="bg-slate-800/30 border border-slate-700/30 rounded-[2.5rem] p-8 text-center space-y-6">
                    <div className="flex justify-center">
                      <div className="p-4 bg-indigo-500/10 text-indigo-500 rounded-full">
                        <Cloud size={32} />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <h4 className="text-lg font-black text-white">{translations.exportData[lang]}</h4>
                      <p className="text-xs text-slate-500 leading-relaxed max-w-[240px] mx-auto">
                        {translations.exportDesc[lang]}
                      </p>
                    </div>
                    <button 
                      onClick={handleExportData}
                      className="w-full bg-slate-800 hover:bg-slate-700 text-slate-200 py-4 rounded-2xl font-black border border-slate-700 transition-all active:scale-95 flex items-center justify-center gap-3"
                    >
                      <Download size={20} className="text-blue-500" />
                      {lang === Language.CN ? '立即导出备份' : 'Download JSON'}
                    </button>
                    <p className="text-[9px] text-slate-600 font-bold uppercase tracking-widest">
                      Your data is yours. Always.
                    </p>
                  </div>
                </div>
                </div>
              </div>
            )
          }</div>)}

          {/* 新增训练 保持不变 */}
          {activeTab === 'new' && (<div className="space-y-8 animate-in slide-in-from-bottom-5"><div className="bg-slate-800/40 p-8 rounded-[2.5rem] border border-slate-700/50">
          <input className="bg-transparent text-3xl font-black w-full outline-none" value={currentWorkout.title} onChange={e => setCurrentWorkout({...currentWorkout, title: e.target.value})} 
          placeholder={translations.trainingTitlePlaceholder[lang]} /></div><div className="space-y-6">{currentWorkout.exercises?.map((ex, exIdx) => { 
            const isBodyweight = isBodyweightMode(ex); 
            const isPyramid = isPyramidEnabled(ex);

            return (<div key={ex.id} className="bg-slate-800/40 p-8 rounded-[2.5rem] border border-slate-700/50">

              <div className="flex flex-col gap-2 mb-6">
                <div className="flex justify-between items-start">
                  <div className="flex items-center gap-2">
                    <h3 className="text-xl font-black text-blue-400 leading-tight">{resolveName(ex.name)}</h3>
                    
                    {/* ✅ 新增：显示和编辑训练时间 */}
                    {ex.exerciseTime && (
                      <button
                        onClick={() => {
                          const timeForInput = new Date(ex.exerciseTime).toISOString().slice(0, 16);
                          setCustomExerciseTime(timeForInput);
                          initializeTimePicker(ex.exerciseTime);
                          setShowTimePickerModal({ exerciseId: ex.id, currentTime: ex.exerciseTime });
                        }}
                        className="px-3 py-1 bg-slate-700/50 border border-slate-600/50 rounded-lg text-xs font-bold text-slate-300 hover:bg-slate-600/50 transition-colors flex items-center gap-1"
                        title={lang === 'cn' ? '点击编辑训练时间' : 'Click to edit exercise time'}
                      >
                        <Calendar size={12} />
                        {formatExerciseTime(ex.exerciseTime, lang === 'cn' ? 'cn' : 'en').time}
                      </button>
                    )}
                    
                    {/* 备注按钮 */}
                    <button 
                      onClick={() => setNoteModalData({ name: resolveName(ex.name), note: exerciseNotes[resolveName(ex.name)] || '' })}
                      className={`p-2 rounded-xl transition-all active:scale-90 ${exerciseNotes[resolveName(ex.name)] ? 'text-amber-400 bg-amber-400/10' : 'text-slate-600 hover:text-slate-400'}`}
                    >
                      <StickyNote size={18} />
                    </button>
                  </div>

                    <button 
                      onClick={() => setShowMetricModal({ name: resolveName(ex.name) })}
                      className="p-2 rounded-xl text-slate-600 hover:text-blue-400 bg-slate-800/50 active:scale-90 transition-all"
                    >
                      <SettingsIcon size={18} />
                    </button>
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
              
              {/* ✅ 新增：动作配置区域 */}
              <div className="flex gap-2 mb-6">
                {/* 自重模式配置 */}
                <div className="flex gap-2 p-1 bg-slate-900 rounded-2xl border border-slate-800">
                  {(['none', 'bodyweight', 'assisted', 'weighted'] as const).map(mode => (
                    <button 
                      key={mode} 
                      onClick={() => {
                        const exs = [...currentWorkout.exercises!];
                        exs[exIdx].instanceConfig = {
                          ...exs[exIdx].instanceConfig,
                          bodyweightMode: mode
                        };
                        // 更新所有组的bodyweightMode
                        if (mode === 'bodyweight' || mode === 'assisted' || mode === 'weighted') {
                          exs[exIdx].sets = exs[exIdx].sets.map(s => ({ ...s, bodyweightMode: 'normal' }));
                        } else {
                          exs[exIdx].sets = exs[exIdx].sets.map(s => {
                            const { bodyweightMode, ...rest } = s;
                            return rest;
                          });
                        }
                        setCurrentWorkout({...currentWorkout, exercises: exs});
                      }} 
                      className={`px-3 py-2 rounded-xl text-[9px] font-black uppercase transition-all 
                        ${getExerciseConfig(ex).bodyweightMode === mode ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-600 hover:text-slate-400'}`}
                    >
                      {mode === 'none' ? (lang === Language.CN ? '器械' : 'Weight') :
                       mode === 'bodyweight' ? (lang === Language.CN ? '自重' : 'Bodyweight') :
                       mode === 'assisted' ? (lang === Language.CN ? '辅助' : 'Assisted') :
                       (lang === Language.CN ? '负重' : 'Weighted')}
                    </button>
                  ))}
                </div>

                {/* 递增递减组配置 */}
                <button 
                  onClick={() => {
                    const exs = [...currentWorkout.exercises!];
                    const currentConfig = getExerciseConfig(ex);
                    exs[exIdx].instanceConfig = {
                      ...exs[exIdx].instanceConfig,
                      enablePyramid: !currentConfig.enablePyramid
                    };
                    setCurrentWorkout({...currentWorkout, exercises: exs});
                  }}
                  className={`px-3 py-2 rounded-xl text-[9px] font-black uppercase transition-all border
                    ${isPyramid ? 'bg-purple-600 text-white border-purple-500' : 'bg-slate-900 text-slate-600 border-slate-700 hover:text-slate-400'}`}
                >
                  {lang === Language.CN ? '递增递减组' : 'Pyramid Sets'}
                </button>
              </div>

              {/* 自重模式细分选择（仅在自重相关模式下显示） */}
              {isBodyweight && (<div className="flex gap-2 mb-6 p-1 bg-slate-900 rounded-2xl border border-slate-800">
                {(['normal', 'weighted', 'assisted'] as BodyweightMode[]).map(mode => (<button key={mode} onClick={() => 
                  { const exs = [...currentWorkout.exercises!]; exs[exIdx].sets = exs[exIdx].sets.map(s => ({ ...s, bodyweightMode: mode }));
                   setCurrentWorkout({...currentWorkout, exercises: exs}); }} className={`flex-1 py-2 rounded-xl text-[9px] font-black uppercase transition-all 
                   ${ex.sets[0]?.bodyweightMode === mode ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-600'}`}>
                    {translations[`mode${mode.charAt(0).toUpperCase() + mode.slice(1)}` as keyof typeof translations][lang]}</button>))}</div>)}

              {/* --- 动态表头 (增加单位显示) --- */}
                <div 
                  className="grid gap-2 items-center px-4 mb-3 text-[10px] font-black uppercase text-slate-500 tracking-widest mt-4"
                  style={{ 
                    gridTemplateColumns: `35px repeat(${getActiveMetrics(resolveName(ex.name)).length}, 1fr) 35px` 
                  }}
                >
                  <span className="pl-1">#</span>
                  {getActiveMetrics(resolveName(ex.name)).map(m => (
                    <div key={m} className="flex flex-col items-center leading-tight">
                      <span>{translations[m as keyof typeof translations]?.[lang] || m.replace('custom_', '')}</span>
                      {/* ✅ 新增：单位小字显示 */}
                      <span className="text-[7px] opacity-40 lowercase">{getUnitTag(m, unit)}</span>
                    </div>
                  ))}
                  <span></span>
                </div>

                {/* --- 2. 动态输入行 (修正后的核心循环) --- */}
                <div className="space-y-4">
                  {ex.sets.map((set, setIdx) => {
                    const activeMetrics = getActiveMetrics(resolveName(ex.name));
                    return (
                      <div key={set.id} className="space-y-2">
                        {/* 主输入行 */}
                        <div 
                          className="grid gap-2 items-center bg-slate-900 p-4 rounded-2xl border border-slate-800 transition-all focus-within:border-blue-500/50 relative"
                          style={{ 
                            gridTemplateColumns: `35px repeat(${activeMetrics.length}, 1fr) 35px` 
                          }}
                        >
                          <span className="text-blue-500 font-black text-xs">{setIdx + 1}</span>

                          {activeMetrics.map(m => {
                            // 特殊处理：时长 (H:M:S)
                            // 特殊处理：时长 (H:M:S) 
                            if (m === 'duration') {
                              const { h, m: mins, s } = secondsToHMS(set.duration || 0);
                              return (
                                <div key={m} className="flex items-center justify-center gap-1">
                                  {activeMetrics.map(m => {
                                    // 情况 1：如果是“时长”维度，渲染大按钮触发 TimePicker
                                    if (m === 'duration') {
                                      const hms = secondsToHMS(set.duration || 0);
                                      return (
                                        <button 
                                          key={m}
                                          type="button"
                                          onClick={() => openTimePicker(exIdx, setIdx, set.duration || 0)}
                                          className="mx-auto bg-slate-800/80 hover:bg-slate-700 border border-slate-700/50 px-3 py-2 rounded-xl flex items-center gap-1.5 transition-all active:scale-95 group"
                                        >
                                          <div className="flex items-baseline gap-0.5">
                                            <span className="text-sm font-black text-blue-400 tabular-nums">{hms.h.toString().padStart(2, '0')}</span>
                                            <span className="text-[8px] font-bold text-slate-600">h</span>
                                          </div>
                                          <span className="text-slate-700 font-bold">:</span>
                                          <div className="flex items-baseline gap-0.5">
                                            <span className="text-sm font-black text-blue-400 tabular-nums">{hms.m.toString().padStart(2, '0')}</span>
                                            <span className="text-[8px] font-bold text-slate-600">m</span>
                                          </div>
                                          <span className="text-slate-700 font-bold">:</span>
                                          <div className="flex items-baseline gap-0.5">
                                            <span className="text-sm font-black text-blue-400 tabular-nums">{hms.s.toString().padStart(2, '0')}</span>
                                            <span className="text-[8px] font-bold text-slate-600">s</span>
                                          </div>
                                        </button>
                                      );
                                    }

                                    // 情况 2：如果是其他维度（重量、次数等），渲染数字输入框
                                    return (
                                      <input 
                                        key={m}
                                        type="number"
                                        className="bg-transparent font-bold text-center outline-none text-white focus:text-blue-400 w-full text-sm"
                                        placeholder="0"
                                        value={
                                          set[m as keyof typeof set] === 0 || set[m as keyof typeof set] === undefined 
                                            ? '' 
                                            : (() => {
                                                const rawValue = Number(set[m as keyof typeof set]);
                                                // ✅ 修复双重转换Bug: 重量使用formatWeight函数，其他维度直接显示
                                                if (m === 'weight') {
                                                  // 使用现有的formatWeight函数，它已经处理了单位转换
                                                  return parseFloat(formatWeight(rawValue)).toFixed(2).replace(/\.?0+$/, '');
                                                } else if (m === 'speed' && unit === 'lbs') {
                                                  return (rawValue * KMH_TO_MPH).toFixed(2).replace(/\.?0+$/, '');
                                                } else {
                                                  return rawValue.toFixed(2).replace(/\.?0+$/, '');
                                                }
                                              })()
                                        }
                                        onChange={e => {
                                          const inputValue = e.target.value === '' ? 0 : Number(e.target.value);
                                          // ✅ 修复双重转换Bug: 重量使用parseWeight函数，其他维度直接保存
                                          let storageValue = inputValue;
                                          if (m === 'weight') {
                                            // 使用现有的parseWeight函数，它已经处理了单位转换
                                            storageValue = parseWeight(inputValue);
                                          } else if (m === 'speed' && unit === 'lbs') {
                                            storageValue = inputValue / KMH_TO_MPH;
                                          }
                                          
                                          const exs = [...currentWorkout.exercises!];
                                          exs[exIdx].sets[setIdx] = { ...exs[exIdx].sets[setIdx], [m]: storageValue };
                                          setCurrentWorkout({...currentWorkout, exercises: exs});
                                        }}
                                      />
                                    );
                                  })}
                                </div>
                              );
                            }
                            // 默认数字输入 (重量、次数、距离等)
                            // 默认数字输入 (重量、次数、距离、得分等)
                            return (
                              <input 
                                key={m}
                                type="number"
                                className="bg-transparent font-bold text-center outline-none text-white focus:text-blue-400 w-full text-sm"
                                placeholder="0"
                                // ✅ 修复双重转换Bug: 统一使用现有的转换函数
                                value={
                                  set[m as keyof typeof set] === 0 || set[m as keyof typeof set] === undefined 
                                    ? '' 
                                    : (() => {
                                        const rawValue = Number(set[m as keyof typeof set]);
                                        // 重量使用formatWeight函数，其他维度根据需要转换
                                        if (m === 'weight') {
                                          return parseFloat(formatWeight(rawValue)).toFixed(2).replace(/\.?0+$/, '');
                                        } else if (m === 'speed' && unit === 'lbs') {
                                          return (rawValue * KMH_TO_MPH).toFixed(2).replace(/\.?0+$/, '');
                                        } else {
                                          return rawValue.toFixed(2).replace(/\.?0+$/, '');
                                        }
                                      })()
                                }
                                onChange={e => {
                                  const inputValue = e.target.value === '' ? 0 : Number(e.target.value);
                                  // 重量使用parseWeight函数，其他维度根据需要转换
                                  let storageValue = inputValue;
                                  if (m === 'weight') {
                                    storageValue = parseWeight(inputValue);
                                  } else if (m === 'speed' && unit === 'lbs') {
                                    storageValue = inputValue / KMH_TO_MPH;
                                  }
                                  
                                  const exs = [...currentWorkout.exercises!];
                                  exs[exIdx].sets[setIdx] = { ...exs[exIdx].sets[setIdx], [m]: storageValue };
                                  setCurrentWorkout({...currentWorkout, exercises: exs});
                                }}
                              />
                            );
                          })}

                          <div className="flex justify-end gap-2 pr-1">
                            {isPyramid && (
                              <button onClick={() => {
                                addSubSet(exIdx, setIdx);
                              }} className="text-indigo-400 hover:text-indigo-300" title={lang === Language.CN ? '添加子组' : 'Add Sub Set'}>
                                <Layers size={16} />
                              </button>
                            )}
                            <button onClick={() => { const exs = [...currentWorkout.exercises!]; exs[exIdx].sets = exs[exIdx].sets.filter((_, i) => i !== setIdx); setCurrentWorkout({...currentWorkout, exercises: exs}); }} className="text-slate-700 hover:text-red-500">
                              <Minus size={16} />
                            </button>
                          </div>
                        </div>

                        {/* ✅ 递减组子行 (现在正确嵌套在 ex.sets.map 内部了) */}
                        {isPyramid && set.subSets && set.subSets.map((sub, ssi) => (
                          <div key={ssi} className="grid grid-cols-4 gap-4 items-center bg-slate-900/40 ml-8 p-3 rounded-xl border border-dashed border-slate-800 animate-in slide-in-from-left-2">
                            <span className="text-[10px] font-black text-slate-600 uppercase">
                              {lang === Language.CN ? '递减' : 'Sub'}
                            </span>
                            <input type="number" step="any" className="bg-transparent text-sm font-bold text-center outline-none text-slate-300 w-full" value={sub.weight === 0 ? '' : parseFloat(formatWeight(sub.weight)).toFixed(2).replace(/\.?0+$/, '')} onChange={e => {
                              const val = e.target.value === '' ? 0 : Number(e.target.value);
                              updateSubSet(exIdx, setIdx, ssi, { weight: parseWeight(val) });
                            }} />
                            <input type="number" className="bg-transparent text-sm font-bold text-center outline-none text-slate-300" value={sub.reps || ''} onChange={e => {
                              const val = e.target.value === '' ? 0 : Number(e.target.value);
                              updateSubSet(exIdx, setIdx, ssi, { reps: val });
                            }} />
                            <button onClick={() => {
                              removeSubSet(exIdx, setIdx, ssi);
                            }} className="flex justify-end pr-2 text-slate-700 hover:text-red-500" title={lang === Language.CN ? '删除子组' : 'Remove Sub Set'}>
                              <X size={14} />
                            </button>
                          </div>
                        ))}
                      </div>
                    );
                  })}
                </div>

            {/* 操作栏：添加组 & 休息计时 */}
                  <div className="flex gap-3 mt-4">
                    {/* 1. 添加组按钮 (逻辑升级：全维度自动继承) */}
                    <button 
                      onClick={() => { 
                        const exs = [...currentWorkout.exercises!]; 
                        const currentSets = exs[exIdx].sets; 
                        const lastSet = currentSets.length > 0 ? currentSets[currentSets.length - 1] : null; 
                        
                        let newSet;
                        if (lastSet) {
                          // ✅ 核心修复：直接展开(Spread)上一组对象，继承包括重量、次数、距离、时长、分数等所有维度
                          // 然后覆盖掉 id，确保唯一性
                          newSet = { 
                            ...lastSet, 
                            id: Date.now().toString() 
                          };
                        } else {
                          // 如果是第一组，则初始化默认值
                          newSet = { 
                            id: Date.now().toString(), 
                            weight: 0, 
                            reps: 0
                          };
                        }

                        exs[exIdx].sets.push(newSet); 
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
                </div>); })}</div>

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

          {/* 目标管理 保持不变 */}
          {activeTab === 'goals' && (<div className="space-y-6 animate-in slide-in-from-right"><div className="flex justify-between items-center"><div><h2 className="text-3xl font-black">{translations.goals[lang]}</h2><p className="text-slate-500">{translations.goalsSubtitle[lang]}</p></div><button onClick={() => setShowGoalModal(true)} className="p-4 bg-blue-600 rounded-2xl"><Plus size={24} /></button></div><div className="grid grid-cols-1 md:grid-cols-2 gap-6">{goals.map(g => (<div key={g.id} className="bg-slate-800/40 p-8 rounded-[2.5rem] border border-slate-700/50"><div className="flex justify-between items-start mb-4"><div><h4 className="font-black text-xl">{g.title || g.label || 'Untitled Goal'}</h4><span className="text-[10px] text-blue-500 uppercase">{g.type}</span></div><button onClick={async () => { await db.delete('goals', g.id); setGoals(p => p.filter(x => x.id !== g.id)); }}><Trash2 size={16} className="text-slate-700" /></button></div><div className="flex justify-between items-end mb-2"><span className="text-2xl font-black">{g.currentValue} / {g.targetValue}</span><span className="text-slate-500 text-xs">{g.unit}</span></div><div className="h-2 bg-slate-900 rounded-full overflow-hidden"><div className="h-full bg-blue-600" style={{ width: `${Math.min(100, (g.currentValue / g.targetValue) * 100)}%` }}></div></div></div>))}</div></div>)}
          
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
                
                <div className="w-full pt-8 pb-4"> 
                  <CalendarHeatmap
                    startDate={new Date(new Date().setDate(new Date().getDate() - 100))}
                    endDate={new Date()}
                    values={heatmapData}
                    classForValue={(value) => {
                      if (!value || value.count === 0) return 'color-empty';
                      return `color-scale-${Math.min(value.count, 4)}`;
                    }}
                    showMonthLabels={true}
                    transformMonthLabels={(month) => {
                      const months = {
                        'Jan': { cn: '1月', en: 'Jan' },
                        'Feb': { cn: '2月', en: 'Feb' },
                        'Mar': { cn: '3月', en: 'Mar' },
                        'Apr': { cn: '4月', en: 'Apr' },
                        'May': { cn: '5月', en: 'May' },
                        'Jun': { cn: '6月', en: 'Jun' },
                        'Jul': { cn: '7月', en: 'Jul' },
                        'Aug': { cn: '8月', en: 'Aug' },
                        'Sep': { cn: '9月', en: 'Sep' },
                        'Oct': { cn: '10月', en: 'Oct' },
                        'Nov': { cn: '11月', en: 'Nov' },
                        'Dec': { cn: '12月', en: 'Dec' }
                      };
                      return months[month as keyof typeof months]?.[lang === Language.CN ? 'cn' : 'en'] || month;
                    }}
                    showWeekdayLabels={true}
                    weekdayLabels={
                      lang === Language.CN 
                        ? ['', '一', '', '三', '', '五', ''] 
                        : ['', 'Mon', '', 'Wed', '', 'Fri', '']
                    }
                    gutterSize={4}
                    // ✅ 添加交互：点击显示具体的日期和次数
                    onClick={value => {
                      if (!value) return;
                      alert(`${value.date}: ${value.count} ${lang === Language.CN ? '场训练' : 'Workouts'}`);
                    }}
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

                {/* ✅ 问题4: 重置账户按钮 */}
                <button 
                  onClick={() => setShowResetAccountModal(true)} 
                  className="w-full p-4 flex justify-between items-center rounded-2xl hover:bg-red-500/10 transition-colors group border-t border-slate-700/50"
                >
                  <div className="flex items-center gap-4">
                    <div className="p-3 bg-red-500/10 text-red-500 rounded-xl group-hover:bg-red-500 group-hover:text-white transition-colors">
                      <Trash2 size={20} />
                    </div>
                    <span className="font-bold text-red-500 group-hover:text-red-400 transition-colors">
                      {translations.resetAccount[lang]}
                    </span>
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
      {/* ✅ 在这里插入新的“维度设置弹窗”代码 */}
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
      {(user && authMode !== 'updatePassword') && (
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
