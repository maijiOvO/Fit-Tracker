import { useEffect, useState } from 'react';

/**
 * 软键盘占位高度（px）。
 *
 * 通过 visualViewport 计算键盘遮挡的高度，用于把底部弹层顶到键盘上沿：
 *   - WebView adjustResize（Capacitor 常见）：layout viewport 跟着缩，inset ≈ 0，无副作用
 *   - 浏览器 resizes-visual（移动端 Chrome 默认）：layout 不缩，inset = 被键盘盖住的高度
 */
export function useKeyboardInset(enabled: boolean): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    if (!enabled) {
      setInset(0);
      return;
    }
    const vv = window.visualViewport;
    if (!vv) return;

    const sync = () => {
      setInset(Math.max(0, window.innerHeight - vv.height - vv.offsetTop));
    };
    sync();
    vv.addEventListener('resize', sync);
    vv.addEventListener('scroll', sync);
    return () => {
      vv.removeEventListener('resize', sync);
      vv.removeEventListener('scroll', sync);
    };
  }, [enabled]);

  return enabled ? inset : 0;
}

export default useKeyboardInset;
