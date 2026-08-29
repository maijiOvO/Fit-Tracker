/**
 * 全量数据格式化导出
 */
import { useCallback } from 'react';
import { Language } from '../../types';
import { translations } from '../../translations';
import { useAuthContext } from '../contexts/AuthContext';
import { useExercisePrefs } from '../contexts/ExercisePrefsContext';
import { useGoalsContext } from '../contexts/GoalsContext';
import { useUserSettingsContext } from '../contexts/UserSettingsContext';
import { useWorkoutContext } from '../contexts/WorkoutContext';
import { useUiOverlay } from '../contexts/UiOverlayContext';

export type ExportStatus = 'idle' | 'syncing' | 'error';

/**
 * @param setSyncStatus  借用顶部同步状态显示导出进度（保留原行为）
 */
export function useExportData(
  setSyncStatus: (status: ExportStatus) => void,
): () => Promise<void> {
  const authCtx = useAuthContext();
  const settingsCtx = useUserSettingsContext();
  const workoutCtx = useWorkoutContext();
  const goalsCtx = useGoalsContext();
  const prefs = useExercisePrefs();
  const { toast } = useUiOverlay();

  return useCallback(async () => {
    try {
      setSyncStatus('syncing');
      const user = authCtx.user;
      const lang = settingsCtx.lang;
      const isCn = lang === Language.CN;

      const exportPackage = {
        app: 'Fit Tracker',
        exportDate: new Date().toISOString(),
        user: {
          id: user?.id,
          email: user?.email,
          username: user?.username,
        },
        data: {
          workouts: workoutCtx.workouts,
          weightHistory: settingsCtx.weightEntries,
          goals: goalsCtx.goals,
          bodyMeasurements: settingsCtx.measurements,
        },
        settings: {
          unit: settingsCtx.unit,
          language: lang,
          exerciseNotes: prefs.exerciseNotes,
          customTags: prefs.customTags,
          customExercises: prefs.customExercises,
          starredExercises: prefs.starredExercises,
          metricConfigs: prefs.exerciseMetricConfigs,
        },
      };

      const jsonString = JSON.stringify(exportPackage, null, 2);
      const blob = new Blob([jsonString], { type: 'application/json' });
      const url = URL.createObjectURL(blob);

      const link = document.createElement('a');
      link.href = url;
      link.download = `FitTracker_Backup_${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      toast(String(translations.exportSuccess[lang]), 'success');
      setSyncStatus('idle');
      void isCn;
    } catch (error) {
      console.error('Export failed:', error);
      setSyncStatus('error');
    }
  }, [authCtx, goalsCtx, prefs, setSyncStatus, settingsCtx, toast, workoutCtx]);
}
