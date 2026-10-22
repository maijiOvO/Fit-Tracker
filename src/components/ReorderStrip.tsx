/**
 * 动作卡排序的位置条（§12.7，2026-10-21）：长按刊头抬起后浮在屏上，每张卡一行、固定行距，
 * 被拖的那张跟着手指落在目标那一格，其余的按落定后的顺序排好——松手之前就看得到排完是什么样。
 * 纯展示：pointer-events: none，手势全在 useCardReorder 里（指针捕获在刊头热区上）。
 */
import React from 'react';
import { createPortal } from 'react-dom';
import { PITCH_PX, type ReorderStripState } from '../hooks/useCardReorder';

export function ReorderStrip({ strip, labels }: { strip: ReorderStripState | null; labels: string[] }) {
  if (!strip) return null;
  const { from, to, top, n } = strip;
  // 落定后的顺序：被拖的那张拿出来插到 to
  const order = Array.from({ length: n }, (_, i) => i).filter(i => i !== from);
  order.splice(to, 0, from);
  return createPortal(
    <div className="reorder-scrim" aria-hidden data-testid="reorder-strip">
      <ol className="reorder-strip" style={{ top: top - PITCH_PX / 2, ['--pitch' as string]: `${PITCH_PX}px` }}>
        {order.map((card, slot) => (
          <li key={card} className={card === from ? 'is-moving' : ''}>
            <span className="reorder-no">{slot + 1}</span>
            <span className="reorder-name">{labels[card] ?? ''}</span>
          </li>
        ))}
      </ol>
    </div>,
    document.body,
  );
}
