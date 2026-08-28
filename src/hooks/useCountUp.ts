/**
 * 数字滚动 —— 规格 §5.4
 *
 * 铁律：**数字只在「因为用户刚做的这个动作而改变」时才动；
 * 页面加载时呈现的数字一律不动。**
 *
 * 所以这个 hook 只该用在刊末页总容量、PR 的 prev→next、底栏「N 动作 · M 组」
 * 这类事件结果上。历史值、输入框里的重量、计时器、Recharts 都不许用它
 * ——正在输入时插值就是撒谎，等宽数字逐秒硬切本身就是正确的时间表现。
 */
import { useEffect, useRef, useState } from 'react';

interface Options {
  /** 起始值，默认 0 */
  from?: number;
  durationMs?: number;
  /** 小数位 */
  decimals?: number;
  /** 关掉滚动直接给终值（reduced-motion 或不该动的场合） */
  disabled?: boolean;
}

export function useCountUp(to: number, { from = 0, durationMs = 700, decimals = 0, disabled }: Options = {}) {
  const [value, setValue] = useState(disabled ? to : from);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (disabled) {
      setValue(to);
      return;
    }
    // §11 坑 3：隐藏标签页里 rAF 不推进。
    // 起始就隐藏 → 直接落终值；动画途中被切到后台 → 也立刻落终值，
    // 否则数字会永远冻在中途（实测过：读数停在 0.0，看起来像算错了）。
    const settle = () => setValue(to);
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      settle();
      return;
    }

    const start = performance.now();
    const delta = to - from;
    let done = false;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      // easeOutCubic：末尾放缓，读数看得清
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(from + delta * eased);
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
      else done = true;
    };
    rafRef.current = requestAnimationFrame(tick);

    const onHide = () => {
      if (document.visibilityState === 'hidden' && !done) {
        if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
        settle();
      }
    };
    document.addEventListener('visibilitychange', onHide);

    // 兜底：rAF 有可能一帧都不跑（WebView 被切到后台、页面没在合成帧），
    // 那样数字会永远停在起始值，看起来就是「算错了」。
    // 超过时长一点还没跑完就直接落终值 —— 宁可少一次动画，不能显示错的数。
    const guard = window.setTimeout(() => {
      if (!done) settle();
    }, durationMs + 250);

    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.clearTimeout(guard);
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [to, from, durationMs, disabled]);

  return decimals > 0 ? value.toFixed(decimals) : String(Math.round(value));
}
