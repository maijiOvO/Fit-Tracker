/**
 * 格式化工具函数
 */
import { KG_TO_LBS, KMH_TO_MPH } from '../constants';

/**
 * 格式化数值（根据类型和单位系统）
 */
export const formatValue = (val: number, type: string, currentUnitSystem: 'kg' | 'lbs'): string => {
  if (val === undefined || val === null) return '0.00';
  
  let result = val;
  let unitLabel = '';

  switch (type) {
    case 'weight':
      result = currentUnitSystem === 'kg' ? val : val * KG_TO_LBS;
      unitLabel = currentUnitSystem.toUpperCase();
      break;
    case 'distance':
      if (currentUnitSystem === 'kg') {
        if (val >= 1000) {
          result = val / 1000;
          unitLabel = 'km';
        } else {
          unitLabel = 'm';
        }
      } else {
        unitLabel = 'm';
      }
      break;
    case 'speed':
      result = currentUnitSystem === 'kg' ? val : val * KMH_TO_MPH;
      unitLabel = currentUnitSystem === 'kg' ? 'km/h' : 'mph';
      break;
    case 'duration':
      const h = Math.floor(val / 3600);
      const m = Math.floor((val % 3600) / 60);
      const s = val % 60;
      return h > 0 ? `${h}h ${m}m ${s}s` : `${m}m ${s}s`;
    default:
      unitLabel = type.replace('custom_', '');
  }

  return `${result.toFixed(2)} ${unitLabel}`;
};

/**
 * 获取单位标签
 */
export const getUnitTag = (type: string, currentUnitSystem: 'kg' | 'lbs'): string => {
  switch (type) {
    case 'weight': return currentUnitSystem === 'kg' ? 'kg' : 'lbs';
    case 'distance': return currentUnitSystem === 'kg' ? 'm/km' : 'm';
    case 'speed': return currentUnitSystem === 'kg' ? 'km/h' : 'mph';
    case 'duration': return 'h:m:s';
    default: return '';
  }
};

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
