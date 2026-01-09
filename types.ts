
export enum Language {
  EN = 'en',
  CN = 'cn'
}

export interface User {
  id: string;
  username: string;
  email: string;
  avatarUrl?: string;
}

export type BodyweightMode = 'normal' | 'weighted' | 'assisted';
export type ExerciseCategory = 'STRENGTH' | 'CARDIO' | 'FREE' | 'OTHER';

export interface SetLog {
  id: string;
  weight: number; 
  reps: number;
  time?: number; 
  timeUnit?: 's' | 'm' | 'h';
  distance?: number;
  distanceUnit?: 'km' | 'm';
  bodyweightMode?: BodyweightMode;
  
  // ✅ 增强：递增递减组子组数据
  subSets?: SubSetLog[];
}

// ✅ 新增：子组数据结构
export interface SubSetLog {
  id: string;
  weight: number;    // 独立的重量设置
  reps: number;      // 独立的次数设置
  restSeconds?: number; // 子组间休息时间（可选）
  note?: string;     // 子组备注（可选）
}

export interface Exercise {
  id: string;
  name: string;
  category: string; 
  bodyPart?: string; 
  sets: SetLog[];
  tags?: string[];
  // ✅ 新增：动作的具体训练时间
  exerciseTime?: string; // ISO 8601 格式
  // ✅ 新增：动作持续时间（可选）
  duration?: number; // 秒数
  
  // ✅ 增强：动作实例的特殊配置（用户可自定义）
  instanceConfig?: {
    enablePyramid: boolean;       // 本次训练是否启用递增递减组
    pyramidMode?: 'increasing' | 'decreasing' | 'mixed'; // 递增递减模式
    bodyweightMode: 'none' | 'bodyweight' | 'assisted' | 'weighted'; // 本次训练的自重模式
    autoCalculateSubSets?: boolean; // 是否自动计算子组重量/次数
  };
}

export interface ExerciseDefinition {
  id: string;
  name: {
    en: string;
    cn: string;
  };
  bodyPart: string;
  tags: string[];
  // ✅ 新增这一行，允许存储分类信息
  category?: ExerciseCategory;
  
  // ✅ 增强：动作特殊属性配置
  exerciseConfig?: {
    supportsPyramid: boolean;     // 是否支持递增递减组
    pyramidModes?: ('increasing' | 'decreasing' | 'mixed')[]; // 支持的递增递减模式
    bodyweightType: 'none' | 'bodyweight' | 'assisted' | 'weighted'; // 自重类型
    defaultBodyweightMode?: BodyweightMode; // 默认自重模式
    maxSubSets?: number; // 最大子组数量限制
  };
}

export interface WorkoutSession {
  id: string;
  userId: string;
  date: string;
  title: string;
  exercises: Exercise[];
  notes?: string;
  // ✅ 新增：训练开始和结束时间
  startTime?: string;
  endTime?: string;
}

export interface WeightEntry {
  id: string;
  userId: string;
  weight: number;
  date: string;
  unit: 'kg' | 'lbs';
}

export type GoalType = 'weight' | 'strength' | 'frequency' | 'bodyMetrics' | 'custom';

export interface Goal {
  id: string;
  userId: string;
  type: GoalType;
  category: string; // 'weightLoss', 'benchPress', 'weeklyWorkouts', etc.
  
  // 基本信息
  title: string;
  description?: string;
  
  // 目标设置
  targetValue: number;
  currentValue: number;
  unit: string;
  
  // 时间设置
  startDate: string;
  targetDate?: string;
  
  // 数据源配置
  dataSource: 'auto' | 'manual';
  autoUpdateRule?: {
    sourceType: 'workouts' | 'weightLogs' | 'measurements';
    calculation: 'max' | 'latest' | 'average' | 'count';
    exerciseName?: string; // 用于力量目标
  };
  
  // 进度追踪
  progressHistory: Array<{
    date: string;
    value: number;
    note?: string;
  }>;
  
  // 设置选项
  isActive: boolean;
  
  // 元数据
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  
  // 兼容旧版本
  label?: string; // 兼容旧版本
  deadline?: string; // 兼容旧版本
}

// 目标推荐接口
export interface GoalRecommendation {
  type: GoalType;
  category: string;
  title: string;
  description: string;
  currentValue: number;
  recommendedTarget: number;
  unit: string;
  reasoning: string;
  confidence: number; // 0-1, 推荐置信度
}

export interface PRRecord {
  id: string;
  exerciseName: string;
  weight: number; 
  date: string;
}

export interface TranslationStrings {
  [key: string]: {
    en: string | string[];
    cn: string | string[];
  };
}

// ✅ 新增：递增递减组相关类型定义
export interface PyramidCalculator {
  mode: 'increasing' | 'decreasing' | 'mixed';
  baseWeight: number;
  baseReps: number;
  subSetCount: number;
  weightStep: number; // 重量变化幅度（百分比）
  repsStrategy: 'constant' | 'increasing' | 'decreasing' | 'failure';
}

export interface PyramidTemplate {
  id: string;
  name: {
    en: string;
    cn: string;
  };
  description: {
    en: string;
    cn: string;
  };
  config: PyramidCalculator;
  category: 'strength' | 'endurance' | 'power' | 'mixed';
}

export interface PyramidSetStats {
  totalVolume: number; // 总训练量
  peakWeight: number; // 峰值重量
  totalReps: number; // 总次数
  averageRest: number; // 平均休息时间
  difficultyScore: number; // 难度评分
  completionRate: number; // 完成率
}
