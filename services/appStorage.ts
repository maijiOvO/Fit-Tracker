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
import { undoJournal } from './undoJournal';

function k(key: string): string {
  return storagePrefix() + key;
}

/** 写失败只报一次：之后的写多半也会失败，没必要每次都弹 */
let warnedWriteFailure = false;

export const storage = {
  getItem(key: string): string | null {
    try {
      return localStorage.getItem(k(key));
    } catch {
      return null;
    }
  },

  setItem(key: string, value: string): void {
    undoJournal.recordKey(key, value);
    try {
      localStorage.setItem(k(key), value);
    } catch (err) {
      /* 配额满 / 隐私模式。原先静默吞掉：界面看着正常，重启后改动全没了（avatar-bloats-storage）。
         仍不抛（调用方都没准备接），但发一次事件，App 弹提示 */
      if (!warnedWriteFailure && typeof window !== 'undefined') {
        warnedWriteFailure = true;
        console.error('[storage] 写入失败:', key, err);
        window.dispatchEvent(new CustomEvent('fitlog:storage-write-failed', { detail: key }));
      }
    }
  },

  removeItem(key: string): void {
    undoJournal.recordKey(key, null);
    try {
      localStorage.removeItem(k(key));
    } catch {
      /* ignore */
    }
  },
};

/** 读 JSON 字串：空 / 解析失败给 fallback（'null' 解析出的 null 照样返回，和 JSON.parse 一致） */
export function parseJsonOr<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

undoJournal.setIo({
  getKey: key => storage.getItem(key),
  setKey: (key, value) => {
    try {
      if (value === null) localStorage.removeItem(k(key));
      else localStorage.setItem(k(key), value);
    } catch {
      /* ignore */
    }
  },
});
