/**
 * 底部弹层整张下拉关闭（审查 F5 / D17）。约束见 _memory/fitlog/sheet-swipe-close-touch.md：
 *
 * - 手指走原生 touchmove { passive: false }，4px 内下结论、要接管就立刻 preventDefault；
 *   pointer 事件会被浏览器的滚动判定 pointercancel 掉，React 的 onTouchMove 是被动的拦不住。
 * - 不给面板加 touch-action:none，否则内容区滚不动。
 * - 往下拉且内容区已在顶上才接管；滚到一半往下拉＝往回滚，交给浏览器；往上推、横划不管。
 * - 拖过之后松手补发的 click 吞一次，并且 400ms 作废，免得吃掉下一次正常点击。
 * - pointer 那一路只收鼠标（桌面调试从抓手拖），包括 pointerup：它比 touchend 先到，会抢掉收尾。
 *
 * Modal 的 sheet 入场动画是 fill-mode both，动画值压过内联 transform——接管时把内联 animation 关掉，
 * 关闭时自己划出去（不再交给 anim-panel-out，那会先跳回原位再淡出）。
 */
import { useEffect, useRef } from 'react';
import type React from 'react';

/** 松手时拖过这么多就关 */
const CLOSE_PX = 110;
/** 超过这么多才下结论。要小于浏览器自己的触摸容差（Android Chrome 约 15px），抢在它前面 */
const DECIDE_PX = 4;

export function useSheetSwipeClose(
  sheetRef: React.RefObject<HTMLElement | null>,
  scrollRef: React.RefObject<HTMLElement | null>,
  enabled: boolean,
  onClose: () => void,
) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const dragRef = useRef<{ startY: number; y: number } | null>(null);

  const begin = (el: HTMLElement, y: number) => {
    dragRef.current = { startY: y, y: 0 };
    el.style.animation = 'none';
    el.style.transition = 'none';
  };
  const follow = (el: HTMLElement, y: number) => {
    const d = dragRef.current;
    if (!d) return;
    d.y = Math.max(0, y - d.startY);
    el.style.transform = `translateY(${d.y}px)`;
  };
  const end = () => {
    const el = sheetRef.current;
    const d = dragRef.current;
    dragRef.current = null;
    if (!el || !d) return;
    if (d.y > CLOSE_PX) {
      el.style.transition = 'transform var(--dur-exit) var(--ease-leave), opacity var(--dur-exit) var(--ease-leave)';
      el.style.transform = 'translateY(100%)';
      el.style.opacity = '0';
      closeRef.current();
    } else {
      el.style.transition = 'transform var(--dur-exit) var(--ease-paper)';
      el.style.transform = '';
    }
  };
  const endRef = useRef(end);
  endRef.current = end;

  useEffect(() => {
    const el = sheetRef.current;
    if (!enabled || !el) return;
    let t: { x0: number; y0: number; mode: 'undecided' | 'drag' | 'pass' } | null = null;
    let swallowClick = false;
    let swallowTimer: number | undefined;

    const onStart = (e: TouchEvent) => {
      swallowClick = false;
      t = e.touches.length === 1 ? { x0: e.touches[0].clientX, y0: e.touches[0].clientY, mode: 'undecided' } : null;
    };
    const onMove = (e: TouchEvent) => {
      if (!t || t.mode === 'pass') return;
      if (e.touches.length !== 1) {
        if (t.mode === 'drag') endRef.current();
        t = null;
        return;
      }
      const dx = e.touches[0].clientX - t.x0;
      const dy = e.touches[0].clientY - t.y0;
      if (t.mode === 'undecided') {
        if (Math.abs(dx) < DECIDE_PX && Math.abs(dy) < DECIDE_PX) return;
        const atTop = (scrollRef.current?.scrollTop ?? 0) <= 0;
        if (dy > 0 && Math.abs(dy) > Math.abs(dx) && atTop) {
          t.mode = 'drag';
          // 从这一刻起的位移才算，免得一接管就跳 4px
          begin(el, e.touches[0].clientY);
          // 输入框里起手往下拉：先收键盘，否则面板在键盘上面被拖着走
          (document.activeElement as HTMLElement | null)?.blur?.();
        } else {
          t.mode = 'pass';
          return;
        }
      }
      e.preventDefault();
      follow(el, e.touches[0].clientY);
    };
    const onEnd = () => {
      if (t?.mode === 'drag') {
        if ((dragRef.current?.y ?? 0) > DECIDE_PX) {
          swallowClick = true;
          window.clearTimeout(swallowTimer);
          swallowTimer = window.setTimeout(() => (swallowClick = false), 400);
        }
        endRef.current();
      }
      t = null;
    };
    const onClickCapture = (e: MouseEvent) => {
      if (!swallowClick) return;
      swallowClick = false;
      e.stopPropagation();
      e.preventDefault();
    };

    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd);
    el.addEventListener('touchcancel', onEnd);
    el.addEventListener('click', onClickCapture, true);
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
      el.removeEventListener('click', onClickCapture, true);
      window.clearTimeout(swallowTimer);
    };
  }, [enabled, sheetRef, scrollRef]);

  // 鼠标：只从抓手拖（桌面调试用）
  const mouseHandlers = {
    onPointerDown: (e: React.PointerEvent) => {
      const el = sheetRef.current;
      if (!enabled || e.pointerType !== 'mouse' || !el) return;
      begin(el, e.clientY);
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    },
    onPointerMove: (e: React.PointerEvent) => {
      const el = sheetRef.current;
      if (e.pointerType === 'mouse' && el) follow(el, e.clientY);
    },
    onPointerUp: (e: React.PointerEvent) => {
      if (e.pointerType === 'mouse') end();
    },
    onPointerCancel: (e: React.PointerEvent) => {
      if (e.pointerType === 'mouse') end();
    },
  };
  return mouseHandlers;
}
