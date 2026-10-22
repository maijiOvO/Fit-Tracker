/**
 * 长按拖动排序 —— §12.7
 *
 * 用在训练页的动作卡列表上：长按刊头行 500ms 抬起，屏上浮出一条「位置条」——
 * 每张卡（交替组整张算一张）一行、固定行距，手指上下挪一行就换一个位置，松手落定。
 *
 * 为什么不再拖卡本身（2026-10-21 用户定）：原来按「被拖卡的中心越过谁的原始中心」换位，
 * 交替组那种很高的卡要拖过大半屏才换得动一格。现在目标位置只看手指离位置条顶的距离：
 * 一行 PITCH_PX，跟卡多高无关；位置条把 N 个位置画出来，拖到哪一格一眼看得到。
 *
 * 三条铁律（都踩过对应的坑）：
 *  1. 热区保持 touch-action: pan-y —— 长按满之前手指移动超过容差就取消手势、
 *     把滚动还给浏览器（commit 3df41f6：热区 touch-none 会吃掉纵向滚动）。
 *     只有抬起成功【之后】才用非被动 touchmove 拦截页面滚动。
 *  2. pointercancel 必须完整复位（§12.3 粘滞布尔的教训）：清 timer、清状态，
 *     不能把半悬的位置条或吃掉下一次点按的状态留在后面。
 *  3. 指针捕获在热区上：位置条本身 pointer-events: none，move / up 照旧落回热区。
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
/** 位置条的行距：手指挪这么多换一个位置 */
export const PITCH_PX = 40;
/** 位置条离视口上下缘至少留这么多 */
const EDGE_PX = 16;

/** 第 0 行中心在 top 处、行距 pitch 时，手指 y 对应的位置（夹在 0…n-1） */
export function slotAt(y: number, top: number, n: number, pitch = PITCH_PX): number {
  return Math.max(0, Math.min(n - 1, Math.round((y - top) / pitch)));
}

/**
 * 抬起时第 0 行中心放哪：被拖那张卡的那一行正好在手指下；整条放不下时往视口里推
 *（推过之后手指不在那一行上，第一下挪动会就近落到手指下那一格——位置条整个都看得见更要紧）。
 */
export function stripTopFor(y: number, idx: number, n: number, vh: number, pitch = PITCH_PX): number {
  const top = y - idx * pitch;
  const min = EDGE_PX + pitch / 2;
  const max = vh - EDGE_PX - pitch / 2 - (n - 1) * pitch;
  return max < min ? min : Math.max(min, Math.min(max, top));
}

export interface CardReorderHandle {
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
  onPointerCancel: (e: React.PointerEvent) => void;
  onContextMenu: (e: React.SyntheticEvent) => void;
}

/** 正在拖：位置条画法要的全部 */
export interface ReorderStripState {
  from: number;
  to: number;
  /** 第 0 行中心离视口顶多远（px） */
  top: number;
  n: number;
}

interface Options {
  /** 当前列表长度 */
  count: number;
  /** 松手落定后回调：把 from 移到 to */
  onReorder: (from: number, to: number) => void;
  disabled?: boolean;
}

interface Result {
  /** 注册每张卡的外层元素（落定后把挪过的那张卷进视口） */
  itemRef: (i: number) => (el: HTMLElement | null) => void;
  /** 摊到第 i 张卡的拖动热区（刊头行）上 */
  handleProps: (i: number) => CardReorderHandle;
  pressingIdx: number | null;
  hintingIdx: number | null;
  draggingIdx: number | null;
  /** 拖动中的位置条；没在拖时 null */
  strip: ReorderStripState | null;
  /** 进度线时长，直接喂 LongPressAffordance */
  drawMs: number;
}

export function useCardReorder({ count, onReorder, disabled = false }: Options): Result {
  const els = useRef<(HTMLElement | null)[]>([]);
  const [pressingIdx, setPressingIdx] = useState<number | null>(null);
  const [hintingIdx, setHintingIdx] = useState<number | null>(null);
  const [strip, setStrip] = useState<ReorderStripState | null>(null);

  const pressRef = useRef<{
    idx: number;
    pid: number;
    x0: number;
    y0: number;
    el: HTMLElement;
    timer: number;
  } | null>(null);
  const dragRef = useRef<{ pid: number; from: number; to: number; top: number; n: number } | null>(null);
  const hintTimerRef = useRef<number | null>(null);

  const countRef = useRef(count);
  countRef.current = count;
  const onReorderRef = useRef(onReorder);
  onReorderRef.current = onReorder;

  /** 抬起之后才拦页面滚动 —— 长按满之前绝不碰滚动 */
  useEffect(() => {
    const block = (e: TouchEvent) => {
      if (dragRef.current) e.preventDefault();
    };
    window.addEventListener('touchmove', block, { passive: false });
    return () => window.removeEventListener('touchmove', block);
  }, []);

  const clearPress = useCallback(() => {
    if (pressRef.current) {
      window.clearTimeout(pressRef.current.timer);
      pressRef.current = null;
    }
    setPressingIdx(null);
  }, []);

  const lift = useCallback(() => {
    const p = pressRef.current;
    if (!p) return;
    pressRef.current = null;
    setPressingIdx(null);

    const n = countRef.current;
    if (n < 2) return;
    const top = stripTopFor(p.y0, p.idx, n, window.innerHeight);
    dragRef.current = { pid: p.pid, from: p.idx, to: p.idx, top, n };
    try {
      p.el.setPointerCapture(p.pid);
    } catch {
      /* 合成事件没有真指针 */
    }
    setStrip({ from: p.idx, to: p.idx, top, n });
    haptic(H.longpress);
  }, []);

  const moveTo = useCallback((y: number) => {
    const d = dragRef.current;
    if (!d) return;
    const to = slotAt(y, d.top, d.n);
    if (to === d.to) return;
    d.to = to;
    setStrip({ from: d.from, to, top: d.top, n: d.n });
    haptic(H.tap); // 每换一格一记「点击感」
  }, []);

  const settle = useCallback(() => {
    const d = dragRef.current;
    if (!d) return;
    dragRef.current = null;
    setStrip(null);
    const { from, to } = d;
    if (to !== from) {
      onReorderRef.current(from, to);
      // 等重排渲染完，把挪过去的那张卷进视口（不然拖到最后一格，人还停在原来那屏）
      requestAnimationFrame(() =>
        requestAnimationFrame(() => els.current[to]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })),
      );
    }
    haptic(H.pick);
  }, []);

  const abort = useCallback(() => {
    if (!dragRef.current) return;
    dragRef.current = null;
    setStrip(null);
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
        if (d && e.pointerId === d.pid) moveTo(e.clientY);
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
    [abort, clearPress, disabled, lift, moveTo, settle],
  );

  return {
    itemRef,
    handleProps,
    pressingIdx,
    hintingIdx,
    draggingIdx: strip ? strip.from : null,
    strip,
    drawMs: HOLD_MS - LONGPRESS_DELAY_MS,
  };
}
