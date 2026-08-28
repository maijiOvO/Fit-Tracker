/**
 * 长按拖动排序 —— §12.7
 *
 * 用在训练页的动作卡列表上：长按刊头行 500ms，这页稿纸「离桌」，
 * 拖到新位置插入；兄弟卡实时让位，靠近视口上下缘自动滚页。
 *
 * 三条铁律（都踩过对应的坑）：
 *  1. 热区保持 touch-action: pan-y —— 长按满之前手指移动超过容差就取消手势、
 *     把滚动还给浏览器（commit 3df41f6：热区 touch-none 会吃掉纵向滚动）。
 *     只有抬起成功【之后】才用非被动 touchmove 拦截页面滚动。
 *  2. pointercancel 必须完整复位（§12.3 粘滞布尔的教训）：清 timer、清位移，
 *     不能把半悬的卡片或吃掉下一次点按的状态留在后面。
 *  3. 位置计算统一放进 rAF：滚动与拖动共用一帧，避免 move 回调里的抖动。
 *
 * 自解释沿用全站长按语言：120ms 静默 + 进度线 + 标签（LongPressAffordance），
 * 短按闪一次「按住拖动排序」把手势教给用户。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type React from 'react';
import { LONGPRESS_DELAY_MS } from './useLongPress';
import { haptic, H } from '../utils/haptics';

/** 长按总时长。与全站默认一致（120 + 380）。 */
const HOLD_MS = 500;
/** 长按满之前移动超过它 = 用户想滚动，取消手势 */
const CANCEL_PX = 10;
/** 视口上下缘的自动滚动区高度 */
const EDGE_PX = 80;
/** 自动滚动的每帧最大速度（越贴边越快） */
const EDGE_SPEED = 9;
/** 量不到间距时的兜底（NewWorkoutTab 的 space-y-6 = 24px） */
const GAP_FALLBACK = 24;

export interface CardReorderHandle {
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
  onPointerCancel: (e: React.PointerEvent) => void;
  onContextMenu: (e: React.SyntheticEvent) => void;
}

interface Options {
  /** 当前列表长度 */
  count: number;
  /** 松手落定后回调：把 from 移到 to */
  onReorder: (from: number, to: number) => void;
  disabled?: boolean;
}

interface Result {
  /** 注册每张卡的外层元素 */
  itemRef: (i: number) => (el: HTMLElement | null) => void;
  /** 摊到第 i 张卡的拖动热区（刊头行）上 */
  handleProps: (i: number) => CardReorderHandle;
  pressingIdx: number | null;
  hintingIdx: number | null;
  draggingIdx: number | null;
  /** 进度线时长，直接喂 LongPressAffordance */
  drawMs: number;
}

export function useCardReorder({ count, onReorder, disabled = false }: Options): Result {
  const els = useRef<(HTMLElement | null)[]>([]);
  const [pressingIdx, setPressingIdx] = useState<number | null>(null);
  const [hintingIdx, setHintingIdx] = useState<number | null>(null);
  const [draggingIdx, setDraggingIdx] = useState<number | null>(null);

  const pressRef = useRef<{
    idx: number;
    pid: number;
    x0: number;
    y0: number;
    el: HTMLElement;
    timer: number;
  } | null>(null);
  const dragRef = useRef<{
    idx: number;
    pid: number;
    y0: number;
    scroll0: number;
    tops: number[];
    heights: number[];
    gap: number;
    shifts: number[];
    lastY: number;
    raf: number;
    settling: boolean;
  } | null>(null);
  const hintTimerRef = useRef<number | null>(null);

  const countRef = useRef(count);
  countRef.current = count;
  const onReorderRef = useRef(onReorder);
  onReorderRef.current = onReorder;

  /** 抬起之后才拦页面滚动 —— 长按满之前绝不碰滚动 */
  useEffect(() => {
    const block = (e: TouchEvent) => {
      if (dragRef.current && !dragRef.current.settling) e.preventDefault();
    };
    window.addEventListener('touchmove', block, { passive: false });
    return () => window.removeEventListener('touchmove', block);
  }, []);

  const clearTransforms = () => {
    for (const el of els.current) {
      if (el) {
        el.style.transition = '';
        el.style.transform = '';
      }
    }
  };

  const clearPress = useCallback(() => {
    if (pressRef.current) {
      window.clearTimeout(pressRef.current.timer);
      pressRef.current = null;
    }
    setPressingIdx(null);
  }, []);

  const tick = useCallback(() => {
    const d = dragRef.current;
    if (!d || d.settling) return;
    const n = countRef.current;

    // 边缘自动滚：越贴边越快
    const vh = window.innerHeight;
    if (d.lastY < EDGE_PX) window.scrollBy(0, -EDGE_SPEED * (1 - d.lastY / EDGE_PX));
    else if (d.lastY > vh - EDGE_PX)
      window.scrollBy(0, EDGE_SPEED * (1 - (vh - d.lastY) / EDGE_PX));

    // 卡片跟手 = 手指位移 + 滚动位移
    const dy = d.lastY - d.y0 + (window.scrollY - d.scroll0);
    const active = els.current[d.idx];
    if (active) active.style.transform = `translateY(${dy}px) scale(1.015)`;

    // 兄弟卡让位：被拖卡中心越过谁的原始中心，谁就移一格
    const origCenter = d.tops[d.idx] + d.heights[d.idx] / 2;
    const center = origCenter + dy;
    const step = d.heights[d.idx] + d.gap;
    for (let i = 0; i < n; i++) {
      if (i === d.idx) continue;
      const centerI = d.tops[i] + d.heights[i] / 2;
      let shift = 0;
      if (centerI > origCenter && center > centerI) shift = -step;
      if (centerI < origCenter && center < centerI) shift = step;
      if (shift !== d.shifts[i]) {
        d.shifts[i] = shift;
        const sib = els.current[i];
        if (sib) {
          sib.style.transition = 'transform var(--dur-base) var(--ease-paper)';
          sib.style.transform = shift ? `translateY(${shift}px)` : '';
        }
        haptic(H.tap); // 每次换位一记「点击感」
      }
    }
    d.raf = requestAnimationFrame(tick);
  }, []);

  const lift = useCallback(() => {
    const p = pressRef.current;
    if (!p) return;
    pressRef.current = null;
    setPressingIdx(null);

    const n = countRef.current;
    const items = els.current.slice(0, n);
    if (items.length < 2 || items.some(el => !el)) return;

    const rects = items.map(el => el!.getBoundingClientRect());
    const tops = rects.map(r => r.top + window.scrollY);
    const heights = rects.map(r => r.height);
    const gap =
      items.length > 1 ? Math.max(0, tops[1] - (tops[0] + heights[0])) : GAP_FALLBACK;

    dragRef.current = {
      idx: p.idx,
      pid: p.pid,
      y0: p.y0,
      scroll0: window.scrollY,
      tops,
      heights,
      gap,
      shifts: new Array(n).fill(0),
      lastY: p.y0,
      raf: 0,
      settling: false,
    };
    try {
      p.el.setPointerCapture(p.pid);
    } catch {
      /* 合成事件没有真指针 */
    }
    setDraggingIdx(p.idx);
    haptic(H.longpress);
    tick();
  }, [tick]);

  const settle = useCallback(() => {
    const d = dragRef.current;
    if (!d || d.settling) return;
    d.settling = true;
    cancelAnimationFrame(d.raf);

    const from = d.idx;
    const origCenter = d.tops[from] + d.heights[from] / 2;
    let down = 0;
    let up = 0;
    let targetDy = 0;
    for (let i = 0; i < countRef.current; i++) {
      if (i === from) continue;
      const centerI = d.tops[i] + d.heights[i] / 2;
      if (centerI > origCenter && d.shifts[i] < 0) {
        down++;
        targetDy += d.heights[i] + d.gap;
      }
      if (centerI < origCenter && d.shifts[i] > 0) {
        up++;
        targetDy -= d.heights[i] + d.gap;
      }
    }
    const to = from + down - up;

    const finish = () => {
      dragRef.current = null;
      setDraggingIdx(null);
      // 先改数据再清位移：React 18 同一批次里重排 DOM 与清 transform
      // 会在同一次绘制前生效，视觉上无缝接管
      if (to !== from) onReorderRef.current(from, to);
      clearTransforms();
      haptic(H.pick);
    };

    const active = els.current[from];
    if (active) {
      // 落定：滑进让出来的槽位（兄弟卡已经在那套位置上了）
      active.style.transition = 'transform var(--dur-base) var(--ease-paper)';
      active.style.transform = `translateY(${targetDy}px) scale(1)`;
      window.setTimeout(finish, 240);
    } else {
      finish();
    }
  }, []);

  const abort = useCallback(() => {
    const d = dragRef.current;
    if (!d) return;
    cancelAnimationFrame(d.raf);
    dragRef.current = null;
    setDraggingIdx(null);
    clearTransforms();
  }, []);

  // 卸载复位
  useEffect(
    () => () => {
      clearPress();
      abort();
      if (hintTimerRef.current !== null) window.clearTimeout(hintTimerRef.current);
    },
    [abort, clearPress],
  );

  const itemRef = useCallback(
    (i: number) => (el: HTMLElement | null) => {
      els.current[i] = el;
    },
    [],
  );

  const handleProps = useCallback(
    (i: number): CardReorderHandle => ({
      onPointerDown: e => {
        if (disabled || !e.isPrimary || dragRef.current || pressRef.current) return;
        // 刊头里的 ⋯ 菜单等控件自己响应，不参与拖动
        if ((e.target as HTMLElement).closest('button, input, a')) return;
        pressRef.current = {
          idx: i,
          pid: e.pointerId,
          x0: e.clientX,
          y0: e.clientY,
          el: e.currentTarget as HTMLElement,
          timer: window.setTimeout(lift, HOLD_MS),
        };
        setHintingIdx(null);
        setPressingIdx(i);
      },
      onPointerMove: e => {
        const p = pressRef.current;
        if (p && e.pointerId === p.pid) {
          // 长按满之前动了手指 = 想滚动：取消，pan-y 让浏览器自己接管
          if (Math.hypot(e.clientX - p.x0, e.clientY - p.y0) > CANCEL_PX) clearPress();
          return;
        }
        const d = dragRef.current;
        if (d && e.pointerId === d.pid && !d.settling) d.lastY = e.clientY;
      },
      onPointerUp: e => {
        const p = pressRef.current;
        if (p && e.pointerId === p.pid) {
          clearPress();
          // 有意的短按：闪一次自解释提示，把手势教给用户
          setHintingIdx(i);
          if (hintTimerRef.current !== null) window.clearTimeout(hintTimerRef.current);
          hintTimerRef.current = window.setTimeout(() => setHintingIdx(null), 1400);
          return;
        }
        const d = dragRef.current;
        if (d && e.pointerId === d.pid) settle();
      },
      onPointerCancel: e => {
        const p = pressRef.current;
        if (p && e.pointerId === p.pid) {
          clearPress();
          return;
        }
        const d = dragRef.current;
        if (d && e.pointerId === d.pid) abort();
      },
      onContextMenu: e => e.preventDefault(),
    }),
    [abort, clearPress, disabled, lift, settle],
  );

  return {
    itemRef,
    handleProps,
    pressingIdx,
    hintingIdx,
    draggingIdx,
    drawMs: HOLD_MS - LONGPRESS_DELAY_MS,
  };
}
