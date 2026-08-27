/**
 * 一键重置账户
 */
import React, { useCallback, useState } from 'react';
import { Goal, Language, Measurement, WeightEntry, WorkoutSession } from '../../types';
import { translations } from '../../translations';
import { db } from '../../services/db';
import { clearTombstones } from '../../services/fitlogTombstones';
import {
  isRemoteConfigured,
} from '../../services/fitlogRemote';
import { pushFitlogRemoteSnapshot } from '../../services/fitlogRemoteSync';
import { useAuthContext } from '../contexts/AuthContext';
import { useExercisePrefs } from '../contexts/ExercisePrefsContext';
import { useGoalsContext } from '../contexts/GoalsContext';
import { useUserSettingsContext } from '../contexts/UserSettingsContext';
import { useWorkoutContext } from '../contexts/WorkoutContext';
import { useUiOverlay } from '../contexts/UiOverlayContext';
import { storage } from '../../services/appStorage';

export interface UseResetAccountResult {
  showResetAccountModal: boolean;
  setShowResetAccountModal: React.Dispatch<React.SetStateAction<boolean>>;
  resetConfirmText: string;
  setResetConfirmText: React.Dispatch<React.SetStateAction<string>>;
  isResetting: boolean;
  handleResetAccount: () => Promise<void>;
}

export interface UseResetAccountParams {
  setActiveTab: (tab: 'dashboard' | 'new' | 'plan' | 'assistant' | 'profile') => void;
  setEditingWorkoutId: (id: string | null) => void;
}

export function useResetAccount({
  setActiveTab,
  setEditingWorkoutId,
}: UseResetAccountParams): UseResetAccountResult {
  const authCtx = useAuthContext();
  const workoutCtx = useWorkoutContext();
  const goalsCtx = useGoalsContext();
  const settingsCtx = useUserSettingsContext();
  const prefs = useExercisePrefs();
  const { toast } = useUiOverlay();

  const [showResetAccountModal, setShowResetAccountModal] = useState(false);
  const [resetConfirmText, setResetConfirmText] = useState('');
  const [isResetting, setIsResetting] = useState(false);

  const handleResetAccount = useCallback(async () => {
    const user = authCtx.user;
    if (!user) return;

    setIsResetting(true);
    const lang = settingsCtx.lang;

    try {
      console.log('开始重置本地数据...');

      const allWorkouts = await db.getAll<WorkoutSession>('workouts');
      for (const w of allWorkouts.filter(w => w.userId === user.id)) {
        await db.delete('workouts', w.id);
      }
      const allGoals = await db.getAll<Goal>('goals');
      for (const g of allGoals.filter(g => g.userId === user.id)) {
        await db.delete('goals', g.id);
      }
      const allWeights = await db.getAll<WeightEntry>('weightLogs');
      for (const w of allWeights.filter(w => w.userId === user.id)) {
        await db.delete('weightLogs', w.id);
      }
      const allMeasurements = await db.getAll<Measurement>('custom_metrics');
      for (const m of allMeasurements.filter(m => m.userId === user.id)) {
        await db.delete('custom_metrics', m.id);
      }

      console.log('清除本地存储...');
      storage.removeItem('fitlog_avatar_data_url');
      clearTombstones();

      console.log('重置内存状态...');
      await Promise.all([
        workoutCtx.refreshFromDb(),
        goalsCtx.refreshFromDb(),
        settingsCtx.reloadFromIndexedDb(),
      ]);

      prefs.resetAllPrefs();
      workoutCtx.setCurrentWorkout(workoutCtx.createNewWorkout());
      setEditingWorkoutId(null);

      if (isRemoteConfigured()) {
        try {
          await pushFitlogRemoteSnapshot();
        } catch (e) {
          console.warn('远端清空快照上传失败:', e);
        }
      }

      setShowResetAccountModal(false);
      setResetConfirmText('');
      toast(String(translations.resetSuccess[lang]), 'success');
      setActiveTab('dashboard');

      console.log('账户重置完成');
    } catch (error) {
      console.error('重置账户失败:', error);
      toast(String(translations.resetError[settingsCtx.lang]), 'error');
    } finally {
      setIsResetting(false);
    }
  }, [
    authCtx.user,
    goalsCtx,
    prefs,
    setActiveTab,
    setEditingWorkoutId,
    settingsCtx,
    toast,
    workoutCtx,
  ]);

  return {
    showResetAccountModal,
    setShowResetAccountModal,
    resetConfirmText,
    setResetConfirmText,
    isResetting,
    handleResetAccount,
  };
}
