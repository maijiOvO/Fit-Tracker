/**
 * 跨一次 reload 的提示：恢复 / 导入之后要重载页面让各个 context 重新水化，
 * 重载前弹的 toast 会被冲掉 —— 先存下来，新页面起来由 DataSafetyHost 弹出。
 */
import { storage } from '../../../services/appStorage';

const KEY = 'fitlog_flash';

/**
 * 整份改写本机之后那一句（恢复 / 导入 / 撤销导入 / 重置共用）：推上去了就只报成功；
 * 没推上去如实说「服务器还是旧的，联网后自动补推」——不说的话，人会以为另一端已经是新的了
 */
export function overwriteNote(pushed: 'pushed' | 'not-configured' | 'failed', isCn: boolean): string {
  if (pushed !== 'failed') return '';
  return isCn ? '（服务器暂时没连上，联网后会自动补推）' : ' (server unreachable — it will sync once online)';
}

/** 写回本机失败的那一句：自动换回去了才说「数据未改动」，没换回去如实说并指向「撤销上次导入」 */
export function overwriteFailedText(e: unknown, isCn: boolean, what: { cn: string; en: string }): string {
  const rolledBack = !(e && typeof e === 'object' && 'rolledBack' in e) || (e as { rolledBack: boolean }).rolledBack;
  return rolledBack
    ? isCn ? `${what.cn}失败，数据未改动` : `${what.en} failed, nothing changed`
    : isCn
      ? `${what.cn}失败，部分数据可能已改动——请在首选项里点「撤销上次导入」换回去`
      : `${what.en} failed and some data may have changed — use "Undo last import" in Preferences`;
}

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
