/**
 * 「按动作」历史的显示换算：存储单位 → 显示单位、指标名、一组的写法。
 * 列表 / 详情 / 趋势图共用，数字长相要一致。
 */
import { Language } from '../../types';
import { translations } from '../../translations';
import { KG_TO_LBS } from '../constants';
import { distToDisplay, metricUnitLabel } from './exerciseConfig';
import { pad2 } from './format';
import { E1RM, type SetRef } from './liftHistory';

/** 数值智能去零：80 而不是 80.00；最多一位小数（§6.5） */
export function trimNum(v: number): string {
  return String(Math.round(v * 10) / 10);
}

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

/** 已经换成显示单位的数怎么写：时长写成时:分:秒，其余最多一位小数 */
export function formatShown(metric: string, v: number): string {
  return metric === 'duration' ? clockOf(v) : trimNum(v);
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
