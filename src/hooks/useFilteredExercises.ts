/**
 * 动作库派生数据 hook：最近练过的动作名 / 热力图
 * （「按动作」的纪录与逐场数据在 utils/liftHistory 的 buildLiftSummaries）
 * （旧全屏动作库的过滤 useFilteredExercises 随 LibraryModal 一起删了，选动作统一走 ExercisePickerSheet）
 */
import { useMemo } from 'react';
import { useWorkoutContext } from '../contexts/WorkoutContext';
import { useExercisePrefs } from '../contexts/ExercisePrefsContext';
import { buildHeatmapDays } from '../utils/heatmapDays';

/**
 * 与训练历史关联的派生数据：最近练过的动作名 + 热力图
 */
export function useExerciseStats() {
  const { workouts, currentWorkout } = useWorkoutContext();
  const { resolveName } = useExercisePrefs();

  const recentExerciseNames = useMemo(() => {
    const names: string[] = [];
    const seen = new Set<string>();
    const sorted = [...workouts].sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
    );
    for (const w of sorted) {
      for (const ex of w.exercises) {
        const n = resolveName(ex.name);
        const key = n.toLowerCase();
        if (n && !seen.has(key)) {
          seen.add(key);
          names.push(n);
          if (names.length >= 12) return names;
        }
      }
    }
    return names;
  }, [workouts, resolveName]);

  /** 训练日历热力图数据（规则见 utils/heatmapDays） */
  const heatmapData = useMemo(() => buildHeatmapDays(workouts, currentWorkout.id), [workouts, currentWorkout.id]);

  return { recentExerciseNames, heatmapData };
}
