import { pushFitlogRemoteSnapshot } from './fitlogRemoteSync';
import { isRemoteConfigured } from './fitlogRemote';

let t: ReturnType<typeof setTimeout> | undefined;

/** 远端写入防抖；未配置 API 时为 no-op */
export function scheduleDebouncedFitlogPush(delayMs = 1800): void {
  if (!isRemoteConfigured()) return;
  if (t) clearTimeout(t);
  t = setTimeout(() => {
    t = undefined;
    pushFitlogRemoteSnapshot().catch((err) =>
      console.warn('[fitlog] background push failed:', err),
    );
  }, delayMs);
}
