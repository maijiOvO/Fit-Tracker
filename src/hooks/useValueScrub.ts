/**
 * 横向拖动改数值 —— 速度自适应步长。
 *
 * 用在账本行的重量格上：整个格子就是 scrub 区，
 *   - 点一下 → 照旧聚焦输入框、弹键盘（键盘路径一点没变）
 *   - 横向拖 → 按速度分档改值，慢拖 ×1、甩起来最大 ×10
 *
 * 为什么不做一条独立轨道（原型里是那样）：账本行只有 52px 高、
 * 列宽在 375px 上已经吃紧（2 指标每列 100.5px），再切一条轨道要么
 * 挤指标列、要么把行撑高，两个都撞硬约束 1「抬眼 0.3 秒读到重量和次数」。
 * 整格当热区是唯一零成本的位置。
 *
 * 为什么固定间距 + 变档位，而不是变间距：
 * 甩得快时「触发的档位更多」和「每档更值钱」是双重加成，
 * 一次甩动就能跨很大范围；而慢下来立刻回到 ×1，末端精调不用切模式。
 */
import { useCallback, useRef, useState } from 'react';
import type React from 'react';
import { haptic, H } from '../utils/haptics';

/** 每跨这么多像素落一档。间距固定，加成全部来自档位本身。 */
const PX_PER_DETENT = 10;

/**
 * 速度（px/ms）→ 步长。阈值是按台式机手感定的初值，
 * ⚠️ 真机手速与屏幕密度不同，值得在手机上再调一轮。
 */
const TIERS: { min: number; step: number }[] = [
  { min: 0, step: 1 },
  { min: 0.55, step: 2 },
  { min: 1.3, step: 5 },
  { min: 2.5, step: 10 },
];

/**
 * 横向位移超过这个距离才认定「这是一次拖动」。
 *
 * 取 12 而不是常见的 6：这个热区同时也是输入框的点击区，
 * 而出汗手滑时一次「点」很容易带出 6px 位移 —— 误判成 scrub
 * 的代价是把重量改错，比多拖两像素贵得多。
 */
const ENGAGE_PX = 12;

/** 速度平滑系数。不平滑的话档位会在阈值边界反复横跳。 */
const EMA = 0.7;

function tierFor(v: number): number {
  let step = 1;
  for (const t of TIERS) if (v >= t.min) step = t.step;
  return step;
}

interface Options {
  /** 当前【显示值】（已按当前单位换算过） */
  value: number;
  /** 改后的显示值。调用方负责换算回存储单位 */
  onChange: (next: number) => void;
  /** 下限，默认 0 */
  min?: number;
  disabled?: boolean;
}

interface Result {
  handlers: {
    onPointerDown: (e: React.PointerEvent) => void;
    onPointerMove: (e: React.PointerEvent) => void;
    onPointerUp: (e: React.PointerEvent) => void;
    onPointerCancel: () => void;
    onClickCapture: (e: React.MouseEvent) => void;
  };
  /** 正在拖动 —— 用来显示刻度与档位角标 */
  scrubbing: boolean;
  /** 当前档位，显示用 */
  step: number;
}

export function useValueScrub({ value, onChange, min = 0, disabled = false }: Options): Result {
  const [scrubbing, setScrubbing] = useState(false);
  const [step, setStep] = useState(1);

  const drag = useRef<{
    x0: number;
    x: number;
    acc: number;
    engaged: boolean;
    vs: number;
    samples: [number, number][];
  } | null>(null);
  /**
   * 拖过之后要吞掉紧跟着的那次 click，否则松手会顺手聚焦输入框、弹出键盘。
   *
   * 用【时间戳】而不是布尔开关：布尔开关是粘滞的 —— 手势若以 pointercancel
   * 结束（来电、系统手势打断），后面根本不会有 click 来把它清掉，
   * 这个 true 就会一直挂着，把用户【下一次】正常点击吃掉，
   * 表现为「点重量没反应」，而且极难复现。时间戳会自己过期。
   */
  const scrubEndedAt = useRef(0);
  const SWALLOW_MS = 300;
  /** 拖动期间 value 会连续变化，用 ref 拿最新值，避免闭包读到旧的 */
  const valueRef = useRef(value);
  valueRef.current = value;

  const vel = useCallback(() => {
    const d = drag.current;
    if (!d || d.samples.length < 2) return d?.vs ?? 0;
    const last = d.samples[d.samples.length - 1];
    let ref: [number, number] | null = null;
    for (let i = d.samples.length - 2; i >= 0; i--) {
      ref = d.samples[i];
      if (last[0] - ref[0] >= 16) break;
    }
    if (!ref) return d.vs;
    let dt = last[0] - ref[0];
    // 时钟分辨率兜底：高刷屏上多次 move 可能落在同一毫秒里，
    // dt 直接算 0 会把「甩得最快」读成「速度为 0」，档位当场掉回 ×1——正好反了。
    if (dt < 1) dt = 1;
    return Math.abs(last[1] - ref[1]) / dt;
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (disabled) return;
      drag.current = {
        x0: e.clientX,
        x: e.clientX,
        acc: 0,
        engaged: false,
        vs: 0,
        samples: [[performance.now(), e.clientX]],
      };
    },
    [disabled],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const d = drag.current;
      if (!d) return;

      if (!d.engaged) {
        if (Math.abs(e.clientX - d.x0) < ENGAGE_PX) return;
        d.engaged = true;
        setScrubbing(true);
        try {
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        } catch {
          /* noop */
        }
        // 已经聚焦时把键盘收掉：拖着改数值的同时键盘杵在下面，
        // 既挡视线又会因为 visualViewport 变化让行跳一下。
        (document.activeElement as HTMLElement | null)?.blur?.();
      }

      const dx = e.clientX - d.x;
      d.x = e.clientX;
      d.samples.push([performance.now(), e.clientX]);
      if (d.samples.length > 8) d.samples.shift();

      d.vs = d.vs * EMA + vel() * (1 - EMA);
      const nextStep = tierFor(d.vs);
      if (nextStep !== step) {
        setStep(nextStep);
        haptic(H.longpress); // §5.7 两档：换档＝确认感
      }

      d.acc += dx;
      let moved = false;
      let next = valueRef.current;
      while (Math.abs(d.acc) >= PX_PER_DETENT) {
        const sign = d.acc > 0 ? 1 : -1;
        next = Math.max(min, Math.round((next + sign * nextStep) * 10) / 10);
        d.acc -= sign * PX_PER_DETENT;
        moved = true;
      }
      if (moved) {
        valueRef.current = next;
        onChange(next);
        haptic(H.tap); // 每档＝点击感
      }
    },
    [min, onChange, step, vel],
  );

  const end = useCallback(() => {
    if (drag.current?.engaged) scrubEndedAt.current = performance.now();
    drag.current = null;
    setScrubbing(false);
    setStep(1);
  }, []);

  return {
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: end,
      onPointerCancel: end,
      onClickCapture: (e: React.MouseEvent) => {
        if (performance.now() - scrubEndedAt.current > SWALLOW_MS) return;
        scrubEndedAt.current = 0;
        e.preventDefault();
        e.stopPropagation();
      },
    },
    scrubbing,
    step,
  };
}
