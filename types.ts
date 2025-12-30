
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

export type GoalType = 'weight' | 'strength' | 'frequency';

export interface Goal {
  id: string;
  userId: string;
  type: GoalType;
  label: string;
  targetValue: number;
  currentValue: number;
  unit: string;
  deadline?: string;
}

export interface PRRecord {
  id: string;
  exerciseName: string;
  weight: number; 
  date: string;
}

export interface TranslationStrings {
  [key: string]: {
    en: string;
    cn: string;
  };
}
