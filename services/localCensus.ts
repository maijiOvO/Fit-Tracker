/**
 * 本机训练数的水位和「本机数据不见了」的标记（上架审查 C12）。
 *
 * 单机版的训练只存在 WebView 的 IndexedDB 里。系统清理存储、数据损坏重建后，App 原来静默变成全新的空库，
 * 用户以为什么都没记过。判法：库是这次新建的（onupgradeneeded 的 oldVersion 为 0），而本机记着上次有 N 场训练。
 *
 * 水位存在 localStorage（经 storage 门面，按数据环境加前缀），不进撤销日志、不进同步快照：
 *   - WorkoutContext 水合成功后、services/fitlogBackup.overwriteLocal 整份改写成功后各记一次；
 *   - 新装没有水位、重置后是 0，都不报。卸载重装时 localStorage 一起没了，也不报（那是首页的「从备份恢复」）。
 * 测试或脚本要模拟「卸载」，必须先清 localStorage 再删库，顺序反了会被当成「库被清空」。
 */
import { storage } from './appStorage';

const COUNT_KEY = 'fitlog_local_workouts';
const LOSS_KEY = 'fitlog_local_loss';
export const LOCAL_LOSS_EVENT = 'fitlog:local-loss';

export interface LocalLoss {
  /** 不见了的场数（上次确认过的本机训练数） */
  expected: number;
  at: string;
}

const announce = () => {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(LOCAL_LOSS_EVENT));
};

export function recordLocalWorkouts(n: number): void {
  if (storage.getItem(COUNT_KEY) !== String(n)) storage.setItem(COUNT_KEY, String(n));
}

/** db.ts 开库时库是新建的：本机记着有训练就记下丢失标记 */
export function noteFreshDb(): void {
  const n = Number(storage.getItem(COUNT_KEY) || 0);
  if (!(n > 0)) return;
  storage.setItem(LOSS_KEY, JSON.stringify({ expected: n, at: new Date().toISOString() }));
  announce();
}

export function readLocalLoss(): LocalLoss | null {
  try {
    const v = JSON.parse(storage.getItem(LOSS_KEY) || 'null');
    return v && typeof v.expected === 'number' ? v : null;
  } catch {
    return null;
  }
}

export function clearLocalLoss(): void {
  if (storage.getItem(LOSS_KEY) === null) return;
  storage.removeItem(LOSS_KEY);
  announce();
}
