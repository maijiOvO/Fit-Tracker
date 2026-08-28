/**
 * font-display: optional 的冷启动守卫。
 *
 * §3 给正文字体选了 optional：零布局抖动，代价是「没赶上约 100ms 的阻塞窗口
 * 就整页用回退字体、且本次会话永不替换」。规格原本赌的是本地自托管字体
 * 几乎必赢 —— 2026-08-28 真机实测输过一次：**安装新 APK 后的首次冷启动**
 * （WebView 缓存全空 + 装完立即拉起、I/O 正忙），三张正文字体全部错过窗口，
 * 整个 App 一整个会话都是系统字。此后每次 App 更新都会复现。
 *
 * 守卫逻辑：等 document.fonts.ready 后用「拉丁字宽差」探测 DOM 是否真的
 * 用上了字体（canvas 不受 font-display 约束，探不出来；DOM 才是真相）。
 * 没用上 → 本会话一次性 location.reload() —— 此刻字体已进缓存，重载必赢。
 *
 * 三道闸防误伤：
 *  1. sessionStorage 一次性标记，绝不循环重载；
 *  2. 用户已有输入（pointerdown / keydown）就放弃 —— 宁可字体不对也不吞操作；
 *  3. 只在启动后 6 秒内生效，超时放弃。
 */

const FLAG = 'fitlog_font_retry';
const DEADLINE_MS = 6000;

/** DOM 层探测：Noto Sans SC 的拉丁与数字字宽和系统回退不同 */
function bodyFontApplied(): boolean {
  const mk = (family: string) => {
    const s = document.createElement('span');
    s.style.cssText =
      'position:absolute;visibility:hidden;white-space:pre;font-size:32px;font-family:' + family;
    s.textContent = 'FitLog 0123456789 Wijk';
    document.body.appendChild(s);
    const w = s.getBoundingClientRect().width;
    s.remove();
    return w;
  };
  return Math.abs(mk("'Noto Sans SC'") - mk('system-ui')) > 0.5;
}

export function installFontGuard(): void {
  if (typeof document === 'undefined' || !('fonts' in document)) return;
  try {
    if (sessionStorage.getItem(FLAG)) return;
  } catch {
    return; // 存不了一次性标记就不冒重载循环的险
  }

  const startedAt = performance.now();
  let userTouched = false;
  const markTouched = () => {
    userTouched = true;
  };
  window.addEventListener('pointerdown', markTouched, { once: true, capture: true });
  window.addEventListener('keydown', markTouched, { once: true, capture: true });

  void document.fonts.ready.then(() => {
    // ready 不代表用上了 —— optional 错过窗口时字体照样会加载完，只是 DOM 不换
    if (userTouched) return;
    if (performance.now() - startedAt > DEADLINE_MS) return;
    if (bodyFontApplied()) return;
    try {
      sessionStorage.setItem(FLAG, '1');
    } catch {
      return;
    }
    console.warn('[fitlog] 正文字体错过 optional 窗口（多半是更新后首启），重载一次挽回');
    location.reload();
  });
}
