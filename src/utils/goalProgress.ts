/**
 * 目标页的进度（审查 D7）：目标值不再只能手抄 —— 力量、频率从训练记录现算，体重跟着体重记录走；
 * 进度按「起点 → 目标」算，减重（80 → 75）和增重同一个式子。全是纯函数。
 */
import type { WeightEntry, WorkoutSession } from '../../types';
import { KG_TO_LBS } from '../constants';
import { dayOfWeekIndex } from './dateUtils';

/** 从起点走到目标走了几成（0–1）。起点不明、或起点就是目标时返回 null（不画进度条） */
export function goalProgress(current: number, start: number | null, target: number): number | null {
  if (start == null || target === start) return null;
  return Math.min(1, Math.max(0, (current - start) / (target - start)));
}

/** 体重目标的起点：建目标那一刻之前最近的一次体重；之前没记过就取之后最早的一次。按目标自己的单位 */
export function weightAtStart(entries: WeightEntry[], startIso: string, unit: string): number | null {
  const start = new Date(startIso).getTime();
  let before: WeightEntry | null = null;
  let after: WeightEntry | null = null;
  for (const e of entries) {
    const t = new Date(e.date).getTime();
    if (t <= start) {
      if (!before || t > new Date(before.date).getTime()) before = e;
    } else if (!after || t < new Date(after.date).getTime()) {
      after = e;
    }
  }
  const hit = before ?? after;
  if (!hit) return null;
  return unit === 'lbs' ? hit.weight * KG_TO_LBS : hit.weight;
}

/** 本周（按首选项的周起始日）练了几场 */
export function workoutsThisWeek(workouts: Pick<WorkoutSession, 'date'>[], now = new Date()): number {
  const weekStart = new Date(now);
  weekStart.setHours(0, 0, 0, 0);
  weekStart.setDate(weekStart.getDate() - dayOfWeekIndex(now));
  const from = weekStart.getTime();
  return workouts.filter(w => {
    const t = new Date(w.date).getTime();
    return t >= from && t <= now.getTime();
  }).length;
}
