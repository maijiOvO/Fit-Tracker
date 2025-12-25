
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
}

export interface ExerciseDefinition {
  id: string;
  name: { en: string; cn: string };
  bodyPart: string; 
  tags: string[];
}

export interface WorkoutSession {
  id: string;
  userId: string;
  date: string;
  title: string;
  exercises: Exercise[];
  notes?: string;
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
