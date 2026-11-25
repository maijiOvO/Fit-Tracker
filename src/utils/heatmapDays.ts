/**
 * 训练日历热力图的日数据（「我的」页 ActivityHeatmap 的输入）。
 *
 * ⚠️ 强度按【当日总组数】统计而不是场数（§6.5）：
 * 单人自用一天几乎只有 1 场，按场数分档会退化成一张二值图。
 * 场数仍然记着，只用于提示文案。
 */
import type { WorkoutSession } from '../../types';
import type { HeatmapDay } from '../components/ActivityHeatmap';
import { dayOfWeekIndex, localYmd } from './dateUtils';

/** 往回看多少天 */
const SPAN = 91;

/** 0 / 1-8 / 9-16 / 17-24 / 25+ —— 一档约等于两个动作的量 */
function levelOf(sets: number): number {
  if (sets <= 0) return 0;
  if (sets <= 8) return 1;
  if (sets <= 16) return 2;
  if (sets <= 24) return 3;
  return 4;
}

export type HeatmapCell = HeatmapDay & { level: number; isToday: boolean; future: boolean };

/**
 * 热力图的格子：从 SPAN 天前所在那一周的第一天（首选项「每周开始于」）排到今天所在那一周的最后一天。
 * 每格单独用 new Date(y, m, d + i) 算、只读年月日，比较只比日期键（审查 C24）：
 * 以前一个带时刻的游标 setDate 往前走，在午夜拨夏令时的时区（圣地亚哥、开罗）过了那天游标停在 01:00，
 * 和今天 00:00 一比，今天那格成了「未来」，一周首日那天整行没了。
 */
export function heatmapCells(days: HeatmapDay[], todayKey: string): HeatmapCell[] {
  const byDate = new Map<string, HeatmapDay>(days.map(d => [d.date, d]));
  const [ty, tm, td] = todayKey.split('-').map(Number);
  const back = SPAN - 1 + dayOfWeekIndex(new Date(ty, tm - 1, td - (SPAN - 1)));

  const out: HeatmapCell[] = [];
  for (let i = 0; ; i++) {
    const key = localYmd(new Date(ty, tm - 1, td - back + i));
    if (key > todayKey && out.length % 7 === 0) break;
    const hit = byDate.get(key);
    out.push({
      date: key,
      sets: hit?.sets ?? 0,
      sessions: hit?.sessions ?? 0,
      level: levelOf(hit?.sets ?? 0),
      isToday: key === todayKey,
      future: key > todayKey,
    });
  }
  return out;
}

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

  return Array.from(map.entries()).map(([date, v]) => ({ date, sets: v.sets, sessions: v.sessions }));
}
