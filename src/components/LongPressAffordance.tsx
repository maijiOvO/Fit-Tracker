import React from 'react';
import { LONGPRESS_DELAY_MS } from '../hooks/useLongPress';

interface Props {
  /** 是否正在按住 */
  active: boolean;
  /** 松手太早：只闪标签、不画进度线，把「这里要按住」教给用户 */
  hint?: boolean;
  /** 自解释标签：说明「按满会发生什么」，如「加子组」「删除」 */
  label: string;
  /** 提示态的文案，默认在 label 前加「按住」 */
  hintLabel?: string;
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
 * 第三种状态是 hint：轻点松手时只闪标签。
 * 没有它的话，轻点＝完全没反应，用户会判定按钮坏了（真实反馈过）。
 *
 * 用法：宿主元素加 `relative`，把本组件作为最后一个子元素。
 *
 * ⚠️ 进度线用 scaleX 而不是 width —— width 触发 layout，
 * scaleX 在合成器上，长按期间主线程被 React 占着也不会掉帧。
 */
export const LongPressAffordance: React.FC<Props> = ({
  active,
  hint = false,
  label,
  hintLabel,
  drawMs,
  placement = 'up',
}) => {
  if (!active && !hint) return null;
  const placementClass = placement === 'down' ? 'is-down' : 'is-up';
  return (
    <>
      {active && (
        <span
          aria-hidden
          className="longpress-line"
          style={{ animationDuration: `${drawMs}ms`, animationDelay: `${LONGPRESS_DELAY_MS}ms` }}
        />
      )}
      <span
        aria-hidden
        className={`longpress-label ${placementClass} ${hint && !active ? 'is-hint' : ''}`}
        style={active ? { animationDelay: `${LONGPRESS_DELAY_MS}ms` } : undefined}
      >
        {active ? label : (hintLabel ?? label)}
      </span>
    </>
  );
};

export default LongPressAffordance;
