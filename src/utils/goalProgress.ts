/**
 * 目标页的进度（审查 D7）：目标值不再只能手抄 —— 力量、频率从训练记录现算，体重跟着体重记录走；
 * 进度按「起点 → 目标」算，减重（80 → 75）和增重同一个式子。全是纯函数。
 */
import type { Goal, WeightEntry, WorkoutSession } from '../../types';
import { KG_TO_LBS } from '../constants';
import { dayOfWeekIndex } from './dateUtils';
import { bestAsOf, latestGymView, type LiftSummary } from './liftHistory';

/**
 * 卡上显示的当前值和起点：力量目标绑了动作就取那个动作的最重一组、频率目标数本周练了几场，
 * 都从训练记录现算、不落库；体重的当前值由记体重时写回（useWeightLog），起点取建目标那一刻的体重。
 * 力量目标存的是动作的稳定键（LiftSummary.stableId），先过 canonical（并入、补建之后的旧键换成现在的），
 * 再在每个动作组出现过的全部键里找；找不到返回 missing —— 不再显示成 0 / 目标、再练也不动（审查 C30）。
 */
export function progressOf(
  g: Goal,
  lifts: LiftSummary[],
  workouts: WorkoutSession[],
  weightEntries: WeightEntry[],
  canonical: (key: string) => string,
): { current: number; start: number | null; missing?: true } {
  if (g.type === 'frequency') return { current: workoutsThisWeek(workouts), start: 0 };
  if (g.type === 'weight') return { current: g.currentValue, start: weightAtStart(weightEntries, g.startDate, g.unit) };
  const liftId = g.type === 'strength' ? g.autoUpdateRule?.exerciseName : undefined;
  if (!liftId) return { current: g.currentValue, start: 0 };
  const id = canonical(liftId);
  const whole = lifts.find(l => l.ids.includes(id) || l.ids.includes(liftId));
  if (!whole) return { current: 0, start: null, missing: true };
  // 按馆比的器械看最近练的那个馆（跨馆的重量不可比）
  const lift = latestGymView(whole);
  const inUnit = (kg: number) => (g.unit === 'lbs' ? kg * KG_TO_LBS : kg);
  return {
    current: inUnit(lift.best.weight?.value ?? 0),
    start: inUnit(bestAsOf(lift, 'weight', new Date(g.startDate).getTime()) ?? 0),
  };
}

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
