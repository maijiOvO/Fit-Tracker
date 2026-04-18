/**
 * 数据验证和清理工具函数
 */

import { WorkoutSession, WeightEntry, Exercise } from '../../types';

// 验证日期字符串格式 (YYYY-MM-DD)
export const isValidDateString = (dateStr: string): boolean => {
  return /^\d{4}-\d{2}-\d{2}$/.test(dateStr);
};

// 安全的日期解析
export const safeParseDate = (dateStr: string): Date | null => {
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return null;
    return date;
  } catch {
    return null;
  }
};

// 验证体重数据
export const validateWeightEntry = (entry: WeightEntry): boolean => {
  return (
    typeof entry.id === 'string' &&
    typeof entry.userId === 'string' &&
    typeof entry.weight === 'number' &&
    entry.weight > 0 &&
    entry.weight < 1000 &&
    typeof entry.date === 'string' &&
    isValidDateString(entry.date.split('T')[0])
  );
};

// 验证训练记录
export const validateWorkoutSession = (session: WorkoutSession): boolean => {
  if (!session || typeof session !== 'object') return false;
  if (typeof session.id !== 'string') return false;
  if (typeof session.userId !== 'string') return false;
  if (!Array.isArray(session.exercises)) return false;
  if (typeof session.date !== 'string') return false;
  
  // 验证每个动作
  for (const ex of session.exercises) {
    if (!validateExercise(ex)) return false;
  }
  
  return true;
};

// 验证动作记录
export const validateExercise = (ex: Exercise): boolean => {
  if (!ex || typeof ex !== 'object') return false;
  if (typeof ex.id !== 'string') return false;
  if (typeof ex.name !== 'string') return false;
  if (!Array.isArray(ex.sets)) return false;
  
  // 验证每组数据
  for (const set of ex.sets) {
    if (!validateSet(set)) return false;
  }
  
  return true;
};

// 验证单组数据
export const validateSet = (set: any): boolean => {
  if (!set || typeof set !== 'object') return false;
  if (typeof set.id !== 'string') return false;
  
  // 重量和次数应该是数字
  if (set.weight !== undefined && typeof set.weight !== 'number') return false;
  if (set.reps !== undefined && typeof set.reps !== 'number') return false;
  
  return true;
};

// 清理无效的训练记录
export const cleanWorkouts = (workouts: WorkoutSession[]): WorkoutSession[] => {
  return workouts.filter(w => {
    try {
      // 验证日期
      if (!w.date) return false;
      const dayString = w.date.split('T')[0];
      if (!isValidDateString(dayString)) return false;
      
      // 验证动作
      if (!Array.isArray(w.exercises)) return false;
      
      // 清理无效动作
      w.exercises = w.exercises.filter(ex => {
        if (!ex || typeof ex !== 'object') return false;
        if (!ex.id || !ex.name) return false;
        if (!Array.isArray(ex.sets)) return false;
        // 清理无效组
        ex.sets = ex.sets.filter(s => s && typeof s === 'object' && s.id);
        return ex.sets.length > 0 || !ex.id; // 保留无组的动作
      });
      
      return true;
    } catch {
      return false;
    }
  });
};

// 清理无效的体重记录
export const cleanWeightEntries = (entries: WeightEntry[]): WeightEntry[] => {
  return entries.filter(e => {
    try {
      if (!e.id || !e.userId) return false;
      if (typeof e.weight !== 'number' || e.weight <= 0) return false;
      if (!e.date) return false;
      return true;
    } catch {
      return false;
    }
  });
};

// 生成唯一 ID
export const generateId = (): string => {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
};

// 深拷贝对象
export const deepClone = <T>(obj: T): T => {
  return JSON.parse(JSON.stringify(obj));
};

// 合并数组（去重）
export const mergeUnique = <T>(arr1: T[], arr2: T[], key: keyof T): T[] => {
  const map = new Map();
  
  [...arr1, ...arr2].forEach(item => {
    const k = item[key];
    if (!map.has(k)) {
      map.set(k, item);
    }
  });
  
  return Array.from(map.values());
};
