import type { WorkoutSession } from '../../types';

/** 忘了结束的场：隔天才点结束，算出来十几个小时，不显示 */
const MAX_MIN = 12 * 60;

/**
 * 一场练了多少分钟 —— 刊末页、时间线、CSV 三处同一口径（2026-10-27 批示：训练中不显示）。
 *
 * 优先 finishedAt − startTime；没有 finishedAt（Strong / Hevy 导入只给时长）时退回 `duration` 秒。
 * 不到 1 分（补记的场）、超过 12 小时（忘了结束）、结束早于开始（改过日期的脏数据）都返回 null：宁可不显示，不显示假数。
 */
export function sessionDurationMin(w: Pick<WorkoutSession, 'startTime' | 'finishedAt' | 'duration'>): number | null {
  let sec: number | null = null;
  if (w.startTime && w.finishedAt) {
    const a = Date.parse(w.startTime);
    const b = Date.parse(w.finishedAt);
    if (Number.isNaN(a) || Number.isNaN(b)) return null;
    sec = (b - a) / 1000;
  } else if (w.duration) {
    sec = w.duration;
  }
  if (sec === null) return null;
  // 截断不四舍五入：47 分 40 秒读作「47 分」，和计时器一致
  const min = Math.floor(sec / 60);
  if (min < 1 || min > MAX_MIN) return null;
  return min;
}
