/**
 * useWorkout Hook - 训练相关状态和操作
 * 
 * 集中管理：
 * - 当前训练会话
 * - 训练历史
 * - 动作管理
 */
import { useState, useCallback } from 'react';
import { WorkoutSession, Exercise } from '../types';

interface UseWorkoutReturn {
  // 状态
  currentWorkout: WorkoutSession;
  workouts: WorkoutSession[];
  
  // 设置函数
  setCurrentWorkout: (workout: WorkoutSession) => void;
  setWorkouts: (workouts: WorkoutSession[]) => void;
  
  // 训练操作
  addExercise: (exercise: Exercise) => void;
  updateExercise: (index: number, exercise: Exercise) => void;
  removeExercise: (index: number) => void;
  resetCurrentWorkout: () => void;
  updateWorkoutDate: (date: string) => void;
  updateWorkoutTitle: (title: string) => void;
}

export const useWorkout = (initialWorkout?: WorkoutSession) => {
  const [currentWorkout, setCurrentWorkout] = useState<WorkoutSession>(
    initialWorkout || {
      id: '',
      userId: '',
      title: '',
      date: new Date().toISOString(),
      exercises: [],
      notes: ''
    }
  );
  const [workouts, setWorkouts] = useState<WorkoutSession[]>([]);

  // 添加动作
  const addExercise = useCallback((exercise: Exercise) => {
    setCurrentWorkout(prev => ({
      ...prev,
      exercises: [...(prev.exercises || []), exercise]
    }));
  }, []);

  // 更新动作
  const updateExercise = useCallback((index: number, exercise: Exercise) => {
    setCurrentWorkout(prev => {
      const newExercises = [...(prev.exercises || [])];
      if (index >= 0 && index < newExercises.length) {
        newExercises[index] = exercise;
      }
      return { ...prev, exercises: newExercises };
    });
  }, []);

  // 删除动作
  const removeExercise = useCallback((index: number) => {
    setCurrentWorkout(prev => ({
      ...prev,
      exercises: (prev.exercises || []).filter((_, i) => i !== index)
    }));
  }, []);

  // 重置当前训练
  const resetCurrentWorkout = useCallback(() => {
    setCurrentWorkout({
      id: '',
      userId: '',
      title: '',
      date: new Date().toISOString(),
      exercises: [],
      notes: ''
    });
  }, []);

  // 更新训练日期
  const updateWorkoutDate = useCallback((date: string) => {
    setCurrentWorkout(prev => ({ ...prev, date }));
  }, []);

  // 更新训练标题
  const updateWorkoutTitle = useCallback((title: string) => {
    setCurrentWorkout(prev => ({ ...prev, title }));
  }, []);

  return {
    // 状态
    currentWorkout,
    workouts,
    
    // 设置函数
    setCurrentWorkout,
    setWorkouts,
    
    // 训练操作
    addExercise,
    updateExercise,
    removeExercise,
    resetCurrentWorkout,
    updateWorkoutDate,
    updateWorkoutTitle,
  };
};

export default useWorkout;
