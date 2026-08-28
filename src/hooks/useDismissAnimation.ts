/**
 * 把「挂载」与「打开」解耦 —— 规格 §6.6
 *
 * 现状是 13 个弹窗全写 `if (!open) return null`，元素直接从 DOM 消失，
 * 所以退场动画根本没有播放的机会。这个 hook 让元素在 open 变 false 之后
 * 多留 exitMs 毫秒，期间打上退场类。
 */
import { useEffect, useState } from 'react';

/**
 * 读 index.css 里的动效令牌，避免 JS 与 CSS 各写一份时长。
 * reduced-motion 会改写这些变量，运行时读能自动跟上。
 */
export function cssDuration(name: string, fallbackMs: number): number {
  if (typeof window === 'undefined') return fallbackMs;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  if (!raw) return fallbackMs;
  const n = parseFloat(raw);
  if (!Number.isFinite(n)) return fallbackMs;
  return raw.endsWith('ms') ? n : n * 1000;
}

interface DismissState {
  /** 是否还该留在 DOM 里 */
  mounted: boolean;
  /** 是否正在退场（用来挂退场类） */
  leaving: boolean;
}

export function useDismissAnimation(open: boolean, exitVar = '--dur-exit', fallbackMs = 180): DismissState {
  const [mounted, setMounted] = useState(open);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    if (open) {
      setMounted(true);
      setLeaving(false);
      return;
    }
    setLeaving(true);
    const t = window.setTimeout(() => {
      setMounted(false);
      setLeaving(false);
    }, cssDuration(exitVar, fallbackMs));
    return () => window.clearTimeout(t);
  }, [open, exitVar, fallbackMs]);

  return { mounted, leaving };
}
