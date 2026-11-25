/**
 * 「按动作」历史的显示换算：存储单位 → 显示单位、指标名、一组的写法。
 * 列表 / 详情 / 趋势图共用，数字长相要一致。
 */
import { Language, type SetLog } from '../../types';
import { translations } from '../../translations';
import { KG_TO_LBS } from '../constants';
import { distToDisplay, metricUnitLabel } from './exerciseConfig';
import { pad2 } from './format';
import { E1RM, type ChartRange, type SetRef } from './liftHistory';

/** 图表时间范围的四档与分段按钮文案（首页体重图 / 力量史同一套） */
export const CHART_RANGES: ChartRange[] = ['3m', '6m', '1y', 'all'];
export const rangeLabel = (r: ChartRange, isCn: boolean) =>
  ({ '3m': isCn ? '3月' : '3M', '6m': isCn ? '6月' : '6M', '1y': isCn ? '1年' : '1Y', all: isCn ? '全部' : 'All' })[r];

/** 数值智能去零：80 而不是 80.00；默认最多一位小数（§6.5） */
export function trimNum(v: number, digits = 1): string {
  const p = 10 ** digits;
  return String(Math.round(v * p) / p);
}

/** 距离 / 速度留两位（0.05 km 不能写成 0.1，同只读历史 SetCapsule），其余一位（审查 gap-5#9） */
const digitsOf = (metric: string) => (metric === 'distance' || metric === 'speed' ? 2 : 1);

const isLoadMetric = (metric: string) => metric === 'weight' || metric === E1RM;

/** 存储单位 → 显示单位的数 */
export function toDisplay(metric: string, v: number, unit: 'kg' | 'lbs'): number {
  if (isLoadMetric(metric)) return unit === 'lbs' ? v * KG_TO_LBS : v;
  return distToDisplay(metric, v);
}

export function metricLabel(metric: string, lang: Language): string {
  const isCn = lang === Language.CN;
  if (metric === E1RM) return isCn ? '估算 1RM' : 'Est. 1RM';
  const t = translations[metric as keyof typeof translations] as Record<string, string> | undefined;
  return t?.[lang] || metric.replace('custom_', '');
}

/**
 * 指标的单位后缀：重量类跟重量单位；距离 / 速度跟首选项的距离单位（审查 B9：原来有氧的历史不写单位）；
 * 时长写成时:分:秒，不带后缀；其余（次数、自定义）不写
 */
export function metricUnit(metric: string, unit: 'kg' | 'lbs'): string {
  if (isLoadMetric(metric)) return unit;
  if (metric === 'distance' || metric === 'speed') return metricUnitLabel(metric, unit, false);
  return '';
}

/** 秒 → 1:05:30 / 25:00（时长指标的显示） */
function clockOf(sec: number): string {
  const t = Math.max(0, Math.round(sec));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  return h > 0 ? `${h}:${pad2(m)}:${pad2(s)}` : `${m}:${pad2(s)}`;
}

/** 已经换成显示单位的数怎么写：时长写成时:分:秒，距离 / 速度最多两位小数，其余一位 */
export function formatShown(metric: string, v: number): string {
  return metric === 'duration' ? clockOf(v) : trimNum(v, digitsOf(metric));
}

/** 显示单位的数按写出来的精度取整：先取整再相减，100.0172 lbs 和 100 lbs 写出来一样，差就是 0（审查 C83「+0 lbs」） */
export function roundShown(metric: string, v: number): number {
  return metric === 'duration' ? Math.round(v) : Number(trimNum(v, digitsOf(metric)));
}

/** 存储单位的一个指标值 → 显示（换单位 + 写法） */
export function formatMetric(metric: string, v: number, unit: 'kg' | 'lbs'): string {
  return formatShown(metric, toDisplay(metric, v, unit));
}

/**
 * 负荷的写法。带号的动作：+10 / −20 / 自重；普通动作：90。
 */
export function formatLoad(kg: number, unit: 'kg' | 'lbs', signed: boolean, isCn: boolean): string {
  const v = trimNum(unit === 'lbs' ? kg * KG_TO_LBS : kg);
  if (!signed) return v;
  if (Number(v) === 0) return isCn ? '自重' : 'BW';
  return kg > 0 ? `+${v}` : `−${v.replace('-', '')}`;
}

/** 一组：90×3。没有次数就只写重量 */
export function formatSet(set: SetRef, unit: 'kg' | 'lbs', signed: boolean, isCn: boolean): string {
  const load = formatLoad(set.kg, unit, signed, isCn);
  return set.reps > 0 ? `${load}×${set.reps}` : load;
}

/**
 * 一组里重量、次数以外的记录项：时长、距离、速度、自定义项（带名字），没值的不写（审查 gap-5#6：有氧的「上次」原来写成 0×0）。
 * 「30:00 5 km」
 */
function metricsTail(set: SetLog, metrics: string[], unit: 'kg' | 'lbs', lang: Language): string {
  return metrics
    .filter(m => m !== 'weight' && m !== 'reps')
    .flatMap(m => {
      const v = Number((set as unknown as Record<string, unknown>)[m]) || 0;
      if (!v) return [];
      if (m === 'duration') return [formatMetric(m, v, unit)];
      if (m === 'distance' || m === 'speed') return [`${formatMetric(m, v, unit)} ${metricUnit(m, unit)}`];
      return [`${metricLabel(m, lang)} ${trimNum(v)}`];
    })
    .join(' ');
}

/**
 * 卡头「上次」的一组：记录项里有重量才写重量（load 是调用方写好的，递减档已用 → 连上），有次数才写 ×次，其余项接 metricsTail。
 * 「100×5」「30:00 5 km」「30 1:00」
 */
export function lastSetLine(load: string, set: SetLog, metrics: string[], unit: 'kg' | 'lbs', lang: Language): string {
  const head = `${metrics.includes('weight') ? load : ''}${metrics.includes('reps') ? `×${Number(set.reps) || 0}` : ''}`;
  return [head, metricsTail(set, metrics, unit, lang)].filter(Boolean).join(' ');
}

/** 10-14；不是今年的带上年份 */
export function shortDate(ts: number, isCn: boolean): string {
  const d = new Date(ts);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  if (isCn) {
    const md = `${d.getMonth() + 1}月${d.getDate()}日`;
    return sameYear ? md : `${d.getFullYear()}年${md}`;
  }
  return d.toLocaleDateString('en-US', sameYear
    ? { month: 'short', day: 'numeric' }
    : { year: 'numeric', month: 'short', day: 'numeric' });
}

/** 按馆看器械时的馆名；没标馆的旧训练归在一起 */
export const gymLabel = (gym: string | undefined, isCn: boolean) => gym || (isCn ? '未标馆' : 'No gym');

/** 上次练是多久之前：今天 / 昨天 / 5 天前 / 3 周前 / 2 个月前 */
export function agoLabel(ts: number, isCn: boolean, now = Date.now()): string {
  const startOf = (t: number) => {
    const d = new Date(t);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  };
  const days = Math.round((startOf(now) - startOf(ts)) / 86400000);
  if (days <= 0) return isCn ? '今天' : 'today';
  if (days === 1) return isCn ? '昨天' : 'yesterday';
  if (days < 14) return isCn ? `${days} 天前` : `${days}d ago`;
  if (days < 60) {
    const w = Math.round(days / 7);
    return isCn ? `${w} 周前` : `${w}w ago`;
  }
  if (days < 365) {
    const m = Math.round(days / 30);
    return isCn ? `${m} 个月前` : `${m}mo ago`;
  }
  const y = Math.floor(days / 365);
  return isCn ? `${y} 年前` : `${y}y ago`;
}
