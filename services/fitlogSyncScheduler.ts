import { pushFitlogRemoteSnapshot } from './fitlogRemoteSync';
import { isRemoteConfigured } from './fitlogRemote';

let t: ReturnType<typeof setTimeout> | undefined;

/** 远端推送失败时通过 DOM 事件通知 UI，比改所有 call site 更干净 */
function notifyPushFailed(err: unknown): void {
  const detail = err instanceof Error ? err.message : String(err ?? '未知错误');
  console.warn('[fitlog] background push failed:', err);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('fitlog:push-failed', { detail }),
    );
  }
}

/**
 * 带重试的 push：指数退避，最多 3 次。
 * 解决网络抖动导致单次失败后数据永久丢失的问题。
 */
async function pushWithRetry(attempt = 1): Promise<void> {
  try {
    await pushFitlogRemoteSnapshot();
  } catch (err) {
    if (attempt >= 3) {
      notifyPushFailed(err);
      return;
    }
    const backoff = Math.min(1000 * 2 ** (attempt - 1), 4000);
    console.warn(`[fitlog] push 失败 (第${attempt}次)，${backoff}ms 后重试...`);
    await new Promise(r => setTimeout(r, backoff));
    return pushWithRetry(attempt + 1);
  }
}

/** 远端写入防抖；未配置 API 时为 no-op */
export function scheduleDebouncedFitlogPush(delayMs = 800): void {
  if (!isRemoteConfigured()) return;
  if (t) clearTimeout(t);
  t = setTimeout(() => {
    t = undefined;
    pushWithRetry();
  }, delayMs);
}
