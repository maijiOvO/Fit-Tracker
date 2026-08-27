/**
 * 按数据环境分区的 localStorage 门面。
 *
 * 为什么不直接用 localStorage：
 *   开发模式造的假数据以前和真实数据挤在同一批 key 里，只要 isDevMode()
 *   有一次判断错误，下一次 push 就会把假数据合并进真实快照（合并策略是
 *   "时间戳新的赢"，刚造的假数据必然覆盖真数据）。分区之后假数据物理上
 *   就不在真实 key 里，端点判断错了也污染不了。
 *
 * prod 环境不加前缀 —— 既有真实数据无需任何迁移。
 * dev 环境所有 key 前缀 `dev:`。
 *
 * ⚠️ services/appEnv.ts 里的开关本身必须用裸 localStorage，不能走这里。
 */
import { storagePrefix } from './appEnv';

function k(key: string): string {
  return storagePrefix() + key;
}

export const storage = {
  getItem(key: string): string | null {
    try {
      return localStorage.getItem(k(key));
    } catch {
      return null;
    }
  },

  setItem(key: string, value: string): void {
    try {
      localStorage.setItem(k(key), value);
    } catch {
      /* 配额满 / 隐私模式，与原先 localStorage 直接调用的容错行为一致 */
    }
  },

  removeItem(key: string): void {
    try {
      localStorage.removeItem(k(key));
    } catch {
      /* ignore */
    }
  },
};
