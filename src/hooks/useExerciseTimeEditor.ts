/**
 * 动作训练时间编辑（历史训练写回）
 */
import { useCallback } from 'react';
import { Language, WorkoutSession } from '../../types';
import { db } from '../../services/db';
import { scheduleDebouncedFitlogPush } from '../../services/fitlogSyncScheduler';
import { useUiOverlay } from '../contexts/UiOverlayContext';
import { useUserSettingsContext } from '../contexts/UserSettingsContext';
import { useWorkoutContext } from '../contexts/WorkoutContext';

export interface UseExerciseTimeEditorResult {
  updateExerciseTime: (
    workoutId: string,
    exerciseId: string,
    newTime: string,
  ) => Promise<void>;
}

export function useExerciseTimeEditor(): UseExerciseTimeEditorResult {
  const { lang } = useUserSettingsContext();
  const workoutCtx = useWorkoutContext();
  const { toast } = useUiOverlay();

  const isCn = lang === Language.CN;

  const updateExerciseTime = useCallback(
    async (workoutId: string, exerciseId: string, newTime: string) => {
      try {
        const allWorkouts = await db.getAll<WorkoutSession>('workouts');
        const workout = allWorkouts.find(w => w.id === workoutId);
        if (!workout) return;

        const exerciseIndex = workout.exercises.findIndex(ex => ex.id === exerciseId);
        if (exerciseIndex === -1) return;

        workout.exercises[exerciseIndex].exerciseTime = newTime;
        await db.save('workouts', workout);

        await workoutCtx.refreshFromDb();
        scheduleDebouncedFitlogPush();
        toast(isCn ? '训练时间已更新' : 'Exercise time updated', 'success');
      } catch (error) {
        console.error('Error updating exercise time:', error);
        toast(isCn ? '更新失败，请重试' : 'Update failed, please try again', 'error');
      }
    },
    [isCn, toast, workoutCtx],
  );

  return { updateExerciseTime };
}
