/**
 * 日期时间工具函数
 */
import { appPrefsNow } from '../../services/appPrefs';

const formatters = new Map<string, Intl.DateTimeFormat>();
/**
 * 按 (语言, 选项) 缓存的日期格式化器：toLocaleDateString 每调一次现建一个，时间线两千场光建格式化器就要一百多毫秒（审查 scale-perf#1）。
 * opts 的键序当缓存键的一部分，同一处调用写法固定就能命中
 */
export function dateFormat(locale: string, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale}|${JSON.stringify(opts)}`;
  let f = formatters.get(key);
  if (!f) formatters.set(key, (f = new Intl.DateTimeFormat(locale, opts)));
  return f;
}

/** 首选项「每周开始于」：0 = 周日，1 = 周一（默认） */
const weekStartDay = (): 0 | 1 => (appPrefsNow().weekStart === 'sun' ? 0 : 1);

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

/**
 * 日期选择器「确定」的值：晚于 now 的夹到 now（这里只回答「什么时候练的」，不能是未来，审查 C25）；
 * 夹完和初值同一分钟就是没改，返回 null —— 原样确定不该走补录、截掉秒、亮「已修改」（审查 C26）。
 */
export function resolvePickedDate(initial: Date, picked: Date, now: Date): Date | null {
  const v = picked.getTime() > now.getTime() ? new Date(now.getTime()) : picked;
  const same =
    isSameDay(v, initial) && v.getHours() === initial.getHours() && v.getMinutes() === initial.getMinutes();
  return same ? null : v;
}

/** 时间选择器的分钟按 5 分钟的格子走：不在格子上的先吸到格子（3 往下是 0，不是 -2，审查 B13 / C27） */
export const stepMinute = (m: number, dir: 1 | -1): number =>
  dir > 0 ? (Math.floor(m / 5) * 5 + 5) % 60 : (Math.ceil(m / 5) * 5 + 55) % 60;

/** 到下一个本地零点还有多少毫秒。用 new Date(y, m, d + 1) 而不是 +24h：夏令时那天一天不是 24 小时、零点也可能不存在 */
export const msToNextLocalMidnight = (now: Date): number =>
  new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime() - now.getTime();

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
const isSameDay =(date1: Date, date2: Date): boolean => {
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
