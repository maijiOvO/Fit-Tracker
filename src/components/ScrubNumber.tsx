/**
 * 能左右横划改值的数字 —— 全站「调一个数」的统一控件（2026-10-21 用户定：所有需要调整数值的地方都要支持横划）。
 *
 * 手感和组行的重量 / 次数格同一套（useValueScrub）：
 *   - 横向拖 → 按速度分档改值，慢拖一档、甩起来跳档；松手不弹键盘
 *   - 点一下 → 进输入框打字（聚焦即全选），回车 / 失焦保存
 * 外观是数字下一条虚线：和组行格子一样，「下面有虚线的数能拖」。
 *
 * 两种走法：
 *   - 定步长：steps 是每档的绝对步长（[0.1, 0.5, 1]），值按步长加减并收拾小数
 *   - stepFn：自己决定「往 dir 走 mult 下落在哪」（档位表、能挂的重量），steps 是倍数表
 *
 * 不负责单位换算：value / onCommit 都是显示值，调用方自己换回存储单位。
 */
import React, { useEffect, useRef, useState } from 'react';
import { useValueScrub } from '../hooks/useValueScrub';

export interface ScrubNumberProps {
  /** 当前显示值；null ＝ 还没填（显示占位，拖动从 0 / min 起） */
  value: number | null;
  /** 拖动每落一档、打字提交时调用；allowEmpty 时清空提交 null */
  onCommit: (next: number | null) => void;
  min?: number;
  max?: number;
  /** 定步长时每档的步长；给了 stepFn 时是倍数表。默认 [1, 2, 5, 10] */
  steps?: number[];
  stepFn?: (v: number, dir: 1 | -1, mult: number) => number;
  /** 显示保留几位小数（只影响显示，去掉末尾的 0） */
  decimals?: number;
  /** 补零位数（时长的 05） */
  pad?: number;
  inputMode?: 'decimal' | 'numeric';
  allowEmpty?: boolean;
  placeholder?: string;
  ariaLabel: string;
  testId?: string;
  className?: string;
  /** 跟在数字后面的单位等（不参与拖动的点击） */
  suffix?: React.ReactNode;
  disabled?: boolean;
  autoFocus?: boolean;
  enterKeyHint?: React.InputHTMLAttributes<HTMLInputElement>['enterKeyHint'];
  /** 输入框自己的样式（字号、对齐）；fill 时撑满容器（表单格子），否则按字数定宽 */
  inputClassName?: string;
  fill?: boolean;
  /** 打字时就实时提交（弹窗表单：先打字紧接着点「确定」，失焦提交会晚一步） */
  live?: boolean;
  /** 先于默认的「回车 = 收起」执行；preventDefault 掉就不收（时长：回车跳下一格） */
  onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>;
}

const fmtNum = (v: number, decimals: number, pad: number) => {
  const r = Math.round(v * 10 ** decimals) / 10 ** decimals;
  const s = String(r);
  return pad > 0 ? s.padStart(pad, '0') : s;
};

export function ScrubNumber({
  value,
  onCommit,
  min = 0,
  max = Infinity,
  steps = [1, 2, 5, 10],
  stepFn,
  decimals = 2,
  pad = 0,
  inputMode = 'decimal',
  allowEmpty = false,
  placeholder,
  ariaLabel,
  testId,
  className = '',
  suffix,
  disabled = false,
  autoFocus,
  enterKeyHint,
  inputClassName = '',
  fill = false,
  live = false,
  onKeyDown,
}: ScrubNumberProps) {
  const shown = value === null ? '' : fmtNum(value, decimals, pad);
  const [text, setText] = useState(shown);
  const editing = useRef(false);
  // 外面改了值（拖动、别处联动）且不在打字时，跟上
  useEffect(() => {
    if (!editing.current) setText(shown);
  }, [shown]);

  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  /**
   * 定宽，不跟着字数变（2026-10-21 用户报：12 ⇄ 12.5 来回切时框的左半边一直跳）：
   * 宽度＝整数位数 + 小数位预留（「.5」两格），数字左对齐、等宽数字 —— 整数位钉住不动，
   * 「.5」只在预留的位置出现 / 消失。和组行重量格「按整数位定位」是同一个办法（c96020b）。
   */
  const intDigits = Math.max(
    pad,
    value === null ? 1 : String(Math.trunc(Math.abs(value))).length + (value < 0 ? 1 : 0),
    value === null ? (placeholder ?? '').length - (decimals > 0 ? 2 : 0) : 0,
  );
  const fixedCh = Math.max(2, intDigits + (decimals > 0 ? 2 : 0)) + 0.4;
  const scrub = useValueScrub({
    value: value ?? Math.max(min, 0),
    onChange: next => {
      const v = clamp(Math.round(next * 10 ** decimals) / 10 ** decimals);
      setText(fmtNum(v, decimals, pad));
      onCommit(v);
    },
    min: Number.isFinite(min) ? min : -1e9,
    steps,
    stepFn: stepFn ? (v, d, m) => clamp(stepFn(v, d, m)) : undefined,
    // 定步长：网格就是最小一档，拖第一下先把不齐的值吸齐
    grid: stepFn ? undefined : steps[0],
    disabled,
  });

  const commitText = () => {
    editing.current = false;
    const t = text.trim().replace(',', '.');
    if (t === '') {
      if (allowEmpty) onCommit(null);
      else setText(shown);
      return;
    }
    const n = Number.parseFloat(t);
    if (!Number.isFinite(n)) {
      setText(shown);
      return;
    }
    const v = clamp(n);
    setText(fmtNum(v, decimals, pad));
    if (value === null || Math.abs(v - value) > 1e-9) onCommit(v);
  };

  return (
    <span
      className={`scrub-num${fill ? ' is-fill' : ''}${scrub.scrubbing ? ' is-scrubbing' : ''}${disabled ? ' is-disabled' : ''} ${className}`}
      {...scrub.handlers}
      data-testid={testId ? `${testId}-scrub` : undefined}
    >
      <input
        className={inputClassName}
        style={fill ? undefined : { width: `${fixedCh}ch` }}
        inputMode={inputMode}
        value={text}
        placeholder={placeholder}
        disabled={disabled}
        autoFocus={autoFocus}
        enterKeyHint={enterKeyHint}
        onChange={e => {
          editing.current = true;
          setText(e.target.value);
          if (!live) return;
          const t = e.target.value.trim().replace(',', '.');
          if (t === '') {
            if (allowEmpty) onCommit(null);
            return;
          }
          const n = Number.parseFloat(t);
          if (Number.isFinite(n) && n >= min && n <= max) onCommit(n);
        }}
        onFocus={e => {
          editing.current = true;
          const el = e.currentTarget;
          requestAnimationFrame(() => {
            if (document.activeElement === el) el.select();
          });
        }}
        onBlur={commitText}
        onKeyDown={e => {
          onKeyDown?.(e);
          if (e.key === 'Enter' && !e.defaultPrevented) (e.target as HTMLInputElement).blur();
        }}
        aria-label={ariaLabel}
        data-testid={testId}
      />
      {suffix}
    </span>
  );
}

/** 档位表上走：往 dir 走 mult 格（当前值不在表里时先落到那个方向最近的一格） */
export function listStepFn(list: number[]) {
  return (v: number, dir: 1 | -1, mult: number) => {
    let i = dir > 0 ? list.findIndex(x => x > v + 1e-9) : list.length - 1 - [...list].reverse().findIndex(x => x < v - 1e-9);
    if (dir > 0 && i < 0) return list[list.length - 1];
    if (dir < 0 && i >= list.length) return list[0];
    i = Math.max(0, Math.min(list.length - 1, i + (mult - 1) * dir));
    return list[i];
  };
}

export default ScrubNumber;
