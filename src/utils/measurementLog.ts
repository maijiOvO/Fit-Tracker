import { Measurement } from '../../types';
import { localYmd } from './dateUtils';

/**
 * 把一条记录挪到另一天（本地日期 `YYYY-MM-DD`），几点几分照原来的；还是同一天就原样返回。
 * 新记一条时 base 传现在：选今天＝现在，补记以前的＝那天的这个钟点（同一天记两条也分得出先后）。
 */
export function moveToLocalDay(baseIso: string, ymd: string): string {
  const base = new Date(baseIso);
  if (localYmd(base) === ymd) return baseIso;
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d, base.getHours(), base.getMinutes(), base.getSeconds(), base.getMilliseconds()).toISOString();
}

export interface MetricGlance {
  name: string;
  value: number;
  unit: string;
  date: string;
  /** 比上一条变了多少；只有一条、或上一条单位不同（没法相减）＝ null */
  delta: number | null;
}

/** 每个指标卡面上的那一条：按记录日期最新的（不是最后录入的 —— 补记一条以前的不会顶到卡面上） */
export function latestByMetric(measurements: Measurement[]): MetricGlance[] {
  // 先整体按日期排：卡片顺序＝各指标第一条记录的先后，组内自然也是从早到晚
  const byName = new Map<string, Measurement[]>();
  for (const m of [...measurements].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())) {
    byName.set(m.name, [...(byName.get(m.name) ?? []), m]);
  }
  return [...byName.values()].map(sorted => {
    const last = sorted[sorted.length - 1];
    const prev = sorted[sorted.length - 2];
    return {
      name: last.name,
      value: last.value,
      unit: last.unit,
      date: last.date,
      // 一位小数：录入就是一位小数，直接相减会出 0.30000000000000004
      delta: prev && prev.unit === last.unit ? Math.round((last.value - prev.value) * 10) / 10 : null,
    };
  });
}
