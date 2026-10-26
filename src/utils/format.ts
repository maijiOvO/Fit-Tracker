/**
 * 格式化工具函数
 */
import { KG_TO_LBS } from '../constants';

/** 两位补零 */
export const pad2 = (n: number) => String(n).padStart(2, '0');

/**
 * 格式化体重值
 */
export const formatWeight = (val: number, unit: 'kg' | 'lbs'): string => {
  const converted = unit === 'kg' ? val : val * KG_TO_LBS;
  return converted.toFixed(1);
};

/** 总容量：≥1000 显示 1.2t / 1.2k，否则取整带单位；0 显示「—」 */
export const formatVolume = (kg: number, unit: string): string => {
  const v = unit === 'lbs' ? kg * KG_TO_LBS : kg;
  if (v <= 0) return '—';
  if (v >= 1000) return `${(v / 1000).toFixed(1)}${unit === 'lbs' ? 'k' : 't'}`;
  return `${Math.round(v)}${unit}`;
};

/**
 * 解析体重值（转换为 kg）
 */
export const parseWeight = (val: number, unit: 'kg' | 'lbs'): number => {
  return unit === 'kg' ? val : val / KG_TO_LBS;
};

/**
 * 秒转换为时分秒对象
 */
export const secondsToHMS = (totalSeconds: number) => {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return { h, m, s };
};

/**
 * 英文单复数。中文不区分，所以调用方形如 `isCn ? '组' : plural(n, 'set')`,
 * 只在英文分支里用。缩写（ex. / sess.）本来就不变形，不要套这个。
 */
export const plural = (n: number, one: string, many: string = one + 's'): string =>
  (n === 1 ? one : many);
