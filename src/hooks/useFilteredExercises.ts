/**
 * 动作库派生数据 hook：最近练过的动作名 / 热力图
 * （「按动作」的纪录与逐场数据在 utils/liftHistory 的 buildLiftSummaries）
 * （旧全屏动作库的过滤 useFilteredExercises 随 LibraryModal 一起删了，选动作统一走 ExercisePickerSheet）
 */
import { useMemo } from 'react';
import { useWorkoutContext } from '../contexts/WorkoutContext';
import { useExercisePrefs } from '../contexts/ExercisePrefsContext';
import { localYmd } from '../utils/dateUtils';

/**
 * 与训练历史关联的派生数据：最近练过的动作名 + 热力图
 */
export function useExerciseStats() {
  const { workouts } = useWorkoutContext();
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

  /**
   * 训练日历热力图数据。
   *
   * ⚠️ 强度按【当日总组数】统计而不是场数（§6.5）：
   * 单人自用一天几乎只有 1 场，按场数分档会退化成一张二值图。
   * 场数仍然记着，只用于提示文案。
   */
  const heatmapData = useMemo(() => {
    if (!workouts || workouts.length === 0) return [];

    const map = new Map<string, { sets: number; sessions: number }>();
    workouts.forEach((w, index) => {
      try {
        if (!w || typeof w !== 'object') return;
        if (!w.date || typeof w.date !== 'string') return;
        const d = new Date(w.date);
        if (isNaN(d.getTime())) return;
        const currentYear = new Date().getFullYear();
        const workoutYear = d.getFullYear();
        if (workoutYear < 1900 || workoutYear > currentYear + 10) return;

        // 按本地日期归日（和 ActivityHeatmap 的网格同一个函数），不是 UTC 日期
        const dayString = localYmd(d);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dayString)) return;

        const sets = (w.exercises || []).reduce(
          (n: number, ex: any) =>
            n + (ex?.sets?.filter((s: any) => !s.ghost).length || 0),
          0,
        );
        // 一组都没做完的空场（放弃的、还在进行中的）不算一场
        if (sets === 0) return;
        const prev = map.get(dayString) || { sets: 0, sessions: 0 };
        map.set(dayString, { sets: prev.sets + sets, sessions: prev.sessions + 1 });
      } catch (e) {
        console.warn(`Error processing workout at index ${index}:`, e, w);
      }
    });

    return Array.from(map.entries())
      .map(([date, v]) => ({ date, sets: v.sets, sessions: v.sessions }))
      .filter(item => item.sessions > 0 && /^\d{4}-\d{2}-\d{2}$/.test(item.date));
  }, [workouts]);

  return { recentExerciseNames, heatmapData };
}
