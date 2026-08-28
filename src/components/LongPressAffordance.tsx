import React from 'react';
import { LONGPRESS_DELAY_MS } from '../hooks/useLongPress';

interface Props {
  /** 是否正在按住 */
  active: boolean;
  /** 自解释标签：说明「按满会发生什么」，如「加子组」「删除」 */
  label: string;
  /** 进度线画出时长（ms），由 useLongPress 给出 */
  drawMs: number;
  /** 标签浮出方向。默认往上，靠底边的元素用 'down' */
  placement?: 'up' | 'down';
}

/**
 * 长按的可见部分 —— 规格 §6.4。
 *
 * 两样东西：底边向右画出的 1.5px 朱砂线（进度），
 * 与浮出的标签（说明会发生什么）。
 *
 * 用法：宿主元素加 `relative`，把本组件作为最后一个子元素。
 *
 * ⚠️ 进度线用 scaleX 而不是 width —— width 触发 layout，
 * scaleX 在合成器上，长按期间主线程被 React 占着也不会掉帧。
 */
export const LongPressAffordance: React.FC<Props> = ({ active, label, drawMs, placement = 'up' }) => {
  if (!active) return null;
  return (
    <>
      <span
        aria-hidden
        className="longpress-line"
        style={{ animationDuration: `${drawMs}ms`, animationDelay: `${LONGPRESS_DELAY_MS}ms` }}
      />
      <span
        aria-hidden
        className={`longpress-label ${placement === 'down' ? 'is-down' : 'is-up'}`}
        style={{ animationDelay: `${LONGPRESS_DELAY_MS}ms` }}
      >
        {label}
      </span>
    </>
  );
};

export default LongPressAffordance;
