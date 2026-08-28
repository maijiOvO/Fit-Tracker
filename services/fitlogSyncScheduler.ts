import { pushFitlogRemoteSnapshot } from './fitlogRemoteSync';
import { isRemoteConfigured, RemoteError } from './fitlogRemote';

let t: ReturnType<typeof setTimeout> | undefined;

/** 远端推送失败时通过 DOM 事件通知 UI，比改所有 call site 更干净 */
function notifyPushFailed(err: unknown): void {
  const detail = err instanceof Error ? err.message : String(err ?? '');
  const kind = err instanceof RemoteError ? err.kind : 'unreachable';
  console.warn('[fitlog] background push failed:', err);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('fitlog:push-failed', { detail: { message: detail, kind } }),
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
    // 403（key 用错端点）/ 409（环境标记不符）是配置错误，重试永远不会成功，
    // 而且每次重试都是一次注定被拒的写入 —— 立刻失败并报给用户。
    if (err instanceof RemoteError && (err.kind === 'forbidden-endpoint' || err.kind === 'env-mismatch')) {
      notifyPushFailed(err);
      return;
    }
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

/**
 * 取消尚未触发的防抖推送。
 *
 * 切换数据环境前必须调用：否则「旧环境的本地数据 + 新环境的端点」
 * 会在切换的瞬间被这个定时器推上去 —— 这正是原来交叉污染的窗口。
 */
export function cancelPendingFitlogPush(): void {
  if (t) {
    clearTimeout(t);
    t = undefined;
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
