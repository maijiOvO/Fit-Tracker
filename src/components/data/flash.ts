/**
 * 跨一次 reload 的提示：恢复 / 导入之后要重载页面让各个 context 重新水化，
 * 重载前弹的 toast 会被冲掉 —— 先存下来，新页面起来由 DataSafetyHost 弹出。
 */
import { storage } from '../../../services/appStorage';

const KEY = 'fitlog_flash';

export function setFlash(message: string, variant: 'success' | 'error' | 'info'): void {
  storage.setItem(KEY, JSON.stringify({ message, variant }));
}

export function takeFlash(): { message: string; variant: 'success' | 'error' | 'info' } | null {
  const raw = storage.getItem(KEY);
  if (!raw) return null;
  storage.removeItem(KEY);
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
