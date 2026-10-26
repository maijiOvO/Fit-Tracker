/**
 * 首页体重卡的「30 天变化」：最新一次称重 − 30 天前那一刻最近的一次称重。
 *
 * 基线取「截止点之前最近的一次」，不是最早那条（旧版取最早：90 天前的 90 kg 被当成基线）。
 * 都在 30 天内就退到最早一条。入参顺序随意，排序在这里做。
 * 从 Dashboard 抽出来，好在 node 里直接测（scripts/logic-check.mjs）。
 */
import { KG_TO_LBS } from '../constants';

export interface WeighIn {
  date: string;
  weight: number;
}

export function weightBaseline<T extends WeighIn>(
  entries: readonly T[],
  now: number = Date.now(),
): { latest: T; baseline: T; count: number } | null {
  if (entries.length === 0) return null;
  const sorted = [...entries].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  const cutoff = now - 30 * 86400000;
  // sorted 是新→旧：第一条落在截止点之前的，就是「30 天前那一刻」最近的一次称重
  const baseline = sorted.find(e => new Date(e.date).getTime() <= cutoff) ?? sorted[sorted.length - 1];
  return { latest: sorted[0], baseline, count: sorted.length };
}

/**
 * 体重卡上那一行「+1.2 kg · 30天」（审查 A22）：
 *   - 最新一次称重已经是 30 天前的了：不显示（那不是「最近 30 天」的变化）
 *   - 基线就是最新那一条（只称过一次 / 30 天内只有这一次且更早的没有）：不显示
 *   - 都在 30 天内：跨度按实际天数标（「· 12天」），不硬写 30
 *   - 先按显示单位取到一位小数再定正负号：-0.04 不会显示成「-0.0」，取整后是 0 就写 0
 */
export function weightDelta<T extends WeighIn>(
  entries: readonly T[],
  unit: 'kg' | 'lbs',
  now: number = Date.now(),
): { text: string; days: number; up: boolean } | null {
  const s = weightBaseline(entries, now);
  if (!s || s.baseline === s.latest) return null;
  const DAY = 86400000;
  const latestAt = new Date(s.latest.date).getTime();
  if (now - latestAt > 30 * DAY) return null;
  const span = Math.round((latestAt - new Date(s.baseline.date).getTime()) / DAY);
  const d = (s.latest.weight - s.baseline.weight) * (unit === 'lbs' ? KG_TO_LBS : 1);
  const r = Math.round(d * 10) / 10;
  return {
    text: r > 0 ? `+${r}` : r < 0 ? `${r}` : '0',
    days: Math.max(1, Math.min(30, span)),
    up: r > 0,
  };
}
