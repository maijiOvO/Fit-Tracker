/**
 * 首页体重卡的「30 天变化」：最新一次称重 − 30 天前那一刻最近的一次称重。
 *
 * 基线取「截止点之前最近的一次」，不是最早那条（旧版取最早：90 天前的 90 kg 被当成基线）。
 * 都在 30 天内就退到最早一条。入参顺序随意，排序在这里做。
 * 从 Dashboard 抽出来，好在 node 里直接测（scripts/logic-check.mjs）。
 */
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
