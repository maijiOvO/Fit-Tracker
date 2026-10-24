/**
 * 训练日历热力图的日数据（「我的」页 ActivityHeatmap 的输入）。
 *
 * ⚠️ 强度按【当日总组数】统计而不是场数（§6.5）：
 * 单人自用一天几乎只有 1 场，按场数分档会退化成一张二值图。
 * 场数仍然记着，只用于提示文案。
 */
import type { WorkoutSession } from '../../types';
import type { HeatmapDay } from '../components/ActivityHeatmap';
import { localYmd } from './dateUtils';

/** currentWorkoutId：还在练的那一场不算（审查 B10）：练到一半格子先亮了、连续周数先涨了，结束前一放弃又掉回去 */
export function buildHeatmapDays(workouts: WorkoutSession[], currentWorkoutId?: string): HeatmapDay[] {
  if (!workouts || workouts.length === 0) return [];

  const map = new Map<string, { sets: number; sessions: number }>();
  workouts.forEach((w, index) => {
    try {
      if (!w || typeof w !== 'object') return;
      if (w.id === currentWorkoutId && !w.finishedAt && w.status !== 'completed') return;
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
}
