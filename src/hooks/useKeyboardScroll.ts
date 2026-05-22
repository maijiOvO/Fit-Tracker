import { useEffect } from 'react';

/**
 * 软键盘弹起时，将聚焦的 input/textarea 滚入可视区域（Capacitor / 移动浏览器）。
 */
export function useKeyboardScroll(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;

    const onFocusIn = (e: FocusEvent) => {
      const el = e.target;
      if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) {
        return;
      }
      window.setTimeout(() => {
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }, 320);
    };

    document.addEventListener('focusin', onFocusIn);
    return () => document.removeEventListener('focusin', onFocusIn);
  }, [enabled]);
}
