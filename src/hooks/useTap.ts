/**
 * 自判点击（utils/tap.ts 讲了为什么不等浏览器的 click）：抬手时位移小、没按到 maxMs 就执行 onTap。
 *
 * - 触屏在 touchend 上判：手指滑出浏览器的触摸容差后 pointer 事件会被 pointercancel 掐断，touch 事件不会。
 * - 鼠标按下就捕获指针：36px 的组号上，抬起时移出元素的那一下也收得回来。
 * - 浏览器随后补发的 click 一律不再执行（这一下已经判过了）；只有前面没有指针序列的 click（键盘、读屏）才执行。
 *
 * 和 useLongPress 摊在同一个元素上时，maxMs 传长按的总时长：按满了归长按，这里不再算点击。
 */
import { useRef } from 'react';
import type React from 'react';
import { judgeTap, noteTapSaved } from '../utils/tap';

/** 指针 / 触摸序列结束后这么久以内到的 click 算它带出来的那一次 */
const CLICK_AFTER_MS = 700;

export function useTap(onTap: () => void, maxMs: number) {
  const down = useRef<{ x: number; y: number; t: number } | null>(null);
  const lastSeqAt = useRef(-Infinity);

  const finish = (x: number, y: number) => {
    const d = down.current;
    down.current = null;
    lastSeqAt.current = performance.now();
    if (!d || judgeTap(x - d.x, y - d.y, performance.now() - d.t, maxMs) !== 'tap') return;
    noteTapSaved();
    onTap();
  };

  return {
    onPointerDown: (e: React.PointerEvent) => {
      if (!e.isPrimary || e.button > 0) return;
      down.current = { x: e.clientX, y: e.clientY, t: performance.now() };
      lastSeqAt.current = performance.now();
      if (e.pointerType === 'mouse') {
        try {
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        } catch {
          /* 捕获不了就退回「抬起时还在元素上才算」 */
        }
      }
    },
    onPointerUp: (e: React.PointerEvent) => {
      if (e.pointerType !== 'touch') finish(e.clientX, e.clientY);
    },
    onTouchEnd: (e: React.TouchEvent) => {
      const t = e.changedTouches[0];
      // 这个元素上还按着别的手指＝不是一次单指点击
      if (!t || e.targetTouches.length > 0) return;
      // 这一下由这里判：不要浏览器再补一次 click（判成点击后行可能已经重排，补发的 click 会落到别的控件上）
      if (e.cancelable) e.preventDefault();
      finish(t.clientX, t.clientY);
    },
    onTouchCancel: () => {
      down.current = null;
      lastSeqAt.current = performance.now();
    },
    onClick: () => {
      if (performance.now() - lastSeqAt.current < CLICK_AFTER_MS) return;
      onTap();
    },
  };
}
