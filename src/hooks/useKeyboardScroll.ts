import { useEffect } from 'react';

/**
 * 软键盘弹起时，将聚焦的 input/textarea 滚入可视区域（Capacitor / 移动浏览器）。
 * 只在格子会被键盘盖住（不在可视视口里、或贴着边）时才滚（2026-10-11）：
 * 以前不管在哪都往屏幕中间滚一下，手指底下的格子会挪位置。
 */
const EDGE_PX = 56;

function fullyVisible(el: Element): boolean {
  const r = el.getBoundingClientRect();
  const vv = window.visualViewport;
  const top = vv ? vv.offsetTop : 0;
  const bottom = top + (vv ? vv.height : window.innerHeight);
  return r.top >= top + EDGE_PX && r.bottom <= bottom - EDGE_PX;
}

export function useKeyboardScroll(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;

    const onFocusIn = (e: FocusEvent) => {
      const el = e.target;
      if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) {
        return;
      }
      window.setTimeout(() => {
        if (document.activeElement !== el || fullyVisible(el)) return;
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }, 320);
    };

    document.addEventListener('focusin', onFocusIn);
    return () => document.removeEventListener('focusin', onFocusIn);
  }, [enabled]);
}
