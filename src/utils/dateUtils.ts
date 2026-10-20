/**
 * 日期时间工具函数
 */
import { appPrefsNow } from '../../services/appPrefs';

/** 首选项「每周开始于」：0 = 周日，1 = 周一（默认） */
export const weekStartDay = (): 0 | 1 => (appPrefsNow().weekStart === 'sun' ? 0 : 1);

/** d 是它那一周的第几天（0 = 一周的第一天，按首选项） */
export const dayOfWeekIndex = (d: Date): number => (d.getDay() - weekStartDay() + 7) % 7;

/** 把「周日在前」的七个名字按首选项转成一周的顺序 */
export const rotateWeekdays = <T,>(sunFirst: readonly T[]): T[] => {
  const s = weekStartDay();
  return [...sunFirst.slice(s), ...sunFirst.slice(0, s)];
};

/**
 * 本地日期的 YYYY-MM-DD。按天归组一律用它，别用 toISOString().split('T')[0] ——
 * 那是 UTC 日期，多伦多晚上 8 点（冬令时 7 点）以后练的会归到第二天（heatmap-utc-day）。
 */
export const localYmd = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// 获取月份天数
export const getDaysInMonth = (month: number, year: number): number => {
  return new Date(year, month + 1, 0).getDate();
};

// 月历第一行要空几格（按首选项的周起始日）
export const getFirstDayOfMonth = (month: number, year: number): number => {
  return dayOfWeekIndex(new Date(year, month, 1));
};

// 判断是否是今天
export const isToday = (date: Date): boolean => {
  const today = new Date();
  return date.getDate() === today.getDate() && 
         date.getMonth() === today.getMonth() && 
         date.getFullYear() === today.getFullYear();
};

// 判断是否是同一天
export const isSameDay = (date1: Date, date2: Date): boolean => {
  return date1.getDate() === date2.getDate() && 
         date1.getMonth() === date2.getMonth() && 
         date1.getFullYear() === date2.getFullYear();
};

// 格式化训练时间
export const formatExerciseTime = (time: string, lang: string): { date: string; time: string } => {
  if (!time) return { date: '', time: '' };
  
  const date = new Date(time);
  
  if (lang === 'cn') {
    return {
      date: date.toLocaleDateString('zh-CN'),
      time: date.toLocaleTimeString('zh-CN', { 
        hour: '2-digit', 
        minute: '2-digit' 
      })
    };
  } else {
    return {
      date: date.toLocaleDateString('en-US'),
      time: date.toLocaleTimeString('en-US', { 
        hour: '2-digit', 
        minute: '2-digit' 
      })
    };
  }
};

// 秒数转时分秒对象
export const secondsToHMS = (totalSeconds: number): { h: number; m: number; s: number } => {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return { h, m, s };
};

// 时分秒对象转秒数
export const hmsToSeconds = (h: number, m: number, s: number): number => {
  return h * 3600 + m * 60 + s;
};

// 格式化秒数为 mm:ss 或 h:mm:ss
export const formatTime = (seconds: number): string => {
  if (seconds < 0) return '0:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m}:${s.toString().padStart(2, '0')}`;
};
