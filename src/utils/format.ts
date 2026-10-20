/**
 * 格式化工具函数
 */
import { KG_TO_LBS } from '../constants';

/**
 * 格式化体重值
 */
export const formatWeight = (val: number, unit: 'kg' | 'lbs'): string => {
  const converted = unit === 'kg' ? val : val * KG_TO_LBS;
  return converted.toFixed(1);
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
 * 时分秒对象转换为秒
 */
export const hmsToSeconds = (h: number, m: number, s: number): number => {
  return h * 3600 + m * 60 + s;
};

/**
 * 格式化时间为 MM:SS 或 HH:MM:SS
 */
export const formatTime = (seconds: number): string => {
  const { h, m, s } = secondsToHMS(seconds);
  if (h > 0) {
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
};

/**
 * 英文单复数。中文不区分，所以调用方形如 `isCn ? '组' : plural(n, 'set')`,
 * 只在英文分支里用。缩写（ex. / sess.）本来就不变形，不要套这个。
 */
export const plural = (n: number, one: string, many: string = one + 's'): string =>
  (n === 1 ? one : many);
