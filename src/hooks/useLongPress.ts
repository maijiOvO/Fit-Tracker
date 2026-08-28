/**
 * 长按手势 —— 规格 §6.4
 *
 * 两处共用：长按组号加递减子组、长按弹层动作行开管理菜单。
 * 外加 §6.6 的「删除组必须长按才真删」。
 *
 * 原则（不得违反）：
 *   - 高频动作绝不藏进长按。「添加组」「添加动作」始终是可见按钮。
 *   - 长按必须自我解释：进度线开始画的同时，旁边浮出标签说明会发生什么。
 *     手势保持零常驻 UI 成本，但按住即自解释；半路松手那一闪，
 *     正好把手势教给用户。（实测：不加标签时连设计者本人都不记得这手势干嘛的。）
 */
import type React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { haptic, H } from '../utils/haptics';

/** 前 120ms 什么都不出，否则每次普通点按都闪一下。 */
export const LONGPRESS_DELAY_MS = 120;
/** 进度线画出的时长。总时长 = 120 + 380 = 500ms。 */
export const LONGPRESS_DRAW_MS = 380;
const TOTAL_MS = LONGPRESS_DELAY_MS + LONGPRESS_DRAW_MS;

/** 手指抖动不取消，移出这个距离（＝开始滚动了）才取消。 */
const CANCEL_DISTANCE_PX = 10;

interface Options {
  /** 达成后要做的事 */
  onLongPress: () => void;
  /** 总时长，默认 500ms。§6.6 的删除确认用 400ms（120 + 280）。 */
  durationMs?: number;
  disabled?: boolean;
}

interface Result {
  /** 摊到目标元素上的事件处理器 */
  handlers: {
    onPointerDown: (e: React.PointerEvent) => void;
    onPointerUp: () => void;
    onPointerLeave: () => void;
    onPointerCancel: () => void;
    onPointerMove: (e: React.PointerEvent) => void;
    onContextMenu: (e: React.SyntheticEvent) => void;
  };
  /** 是否正在按住 —— 用来渲染进度线与自解释标签 */
  pressing: boolean;
  /** 进度线该画多久（ms），直接喂给 animation-duration */
  drawMs: number;
}

export function useLongPress({ onLongPress, durationMs = TOTAL_MS, disabled = false }: Options): Result {
  const [pressing, setPressing] = useState(false);
  const timerRef = useRef<number | null>(null);
  const originRef = useRef<{ x: number; y: number } | null>(null);
  const cbRef = useRef(onLongPress);
  cbRef.current = onLongPress;

  const cancel = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    originRef.current = null;
    setPressing(false);
  }, []);

  // 组件卸载时别把定时器留在后面
  useEffect(() => cancel, [cancel]);

  const start = useCallback(
    (e: React.PointerEvent) => {
      if (disabled) return;
      cancel();
      originRef.current = { x: e.clientX, y: e.clientY };
      setPressing(true);
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        originRef.current = null;
        setPressing(false);
        // §5.7 第 1 条：先发震动再动状态。马达机械启动天然落后，
        // 而这里的语义时刻就是「达成」这一帧。
        haptic(H.longpress);
        cbRef.current();
      }, durationMs);
    },
    [cancel, disabled, durationMs],
  );

  const move = useCallback(
    (e: React.PointerEvent) => {
      const o = originRef.current;
      if (!o) return;
      if (Math.hypot(e.clientX - o.x, e.clientY - o.y) > CANCEL_DISTANCE_PX) cancel();
    },
    [cancel],
  );

  return {
    handlers: {
      onPointerDown: start,
      onPointerUp: cancel,
      onPointerLeave: cancel,
      onPointerCancel: cancel,
      onPointerMove: move,
      onContextMenu: (e) => e.preventDefault(),
    },
    pressing,
    drawMs: durationMs - LONGPRESS_DELAY_MS,
  };
}
