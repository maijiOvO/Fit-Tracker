/**
 * 日期时间工具函数
 */
import { Language } from '../../types';

// 获取月份天数
export const getDaysInMonth = (month: number, year: number): number => {
  return new Date(year, month + 1, 0).getDate();
};

// 获取月份第一天是星期几
export const getFirstDayOfMonth = (month: number, year: number): number => {
  return new Date(year, month, 1).getDay();
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

// 格式化日期为 YYYY-MM-DD
export const formatDate = (date: Date | string): string => {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toISOString().split('T')[0];
};

// 相对时间描述
export const getRelativeTime = (date: Date | string, lang: Language): string => {
  const d = typeof date === 'string' ? new Date(date) : date;
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  
  if (diffDays === 0) {
    return lang === Language.CN ? '今天' : 'Today';
  } else if (diffDays === 1) {
    return lang === Language.CN ? '昨天' : 'Yesterday';
  } else if (diffDays < 7) {
    return lang === Language.CN ? `${diffDays}天前` : `${diffDays} days ago`;
  } else if (diffDays < 30) {
    const weeks = Math.floor(diffDays / 7);
    return lang === Language.CN ? `${weeks}周前` : `${weeks} weeks ago`;
  } else {
    return d.toLocaleDateString(lang === Language.CN ? 'zh-CN' : 'en-US', { 
      month: 'short', 
      day: 'numeric' 
    });
  }
};

// 初始化日期时间选择器
export const initializeDateTimePicker = (currentTime?: string) => {
  const date = currentTime ? new Date(currentTime) : new Date();
  return {
    date,
    hour: date.getHours(),
    minute: date.getMinutes(),
    month: date.getMonth(),
    year: date.getFullYear()
  };
};
