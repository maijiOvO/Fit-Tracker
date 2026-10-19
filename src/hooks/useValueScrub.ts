/**
 * 横向拖动改数值 —— 速度自适应步长。
 *
 * 用在账本行的重量格与次数格上：整个格子就是 scrub 区，
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
import { useCallback, useEffect, useRef, useState } from 'react';
import type React from 'react';
import { haptic, H } from '../utils/haptics';
import { scrubFeel, SCRUB_FEEL_PX } from '../utils/scrubFeel';

/**
 * 每跨这么多像素落一档（首选项「滑动手感」：细 / 中 / 粗 ＝ 14 / 10 / 7，默认 10）。
 * 间距固定，加成全部来自档位本身（读的是模块缓存，每次移动取一下不费事）。
 */
const pxPerDetent = () => SCRUB_FEEL_PX[scrubFeel()];

/**
 * 速度（px/ms）阈值梯。阈值是按台式机手感定的初值，
 * ⚠️ 真机手速与屏幕密度不同，值得在手机上再调一轮。
 *
 * 档位表可以按格子给（重量 1/2/5/10、次数 1/2/5），但阈值梯全站共用一条：
 * 「甩这么快＝跳第二档」这件事在哪一格都该是同一个手感，
 * 只是次数没有 ×10 这一档，早一档到顶而已。
 */
const VELOCITY_LADDER = [0, 0.55, 1.3, 2.5];

/** 重量格的档位表（§12.3） */
export const SCRUB_STEPS_WEIGHT = [1, 2, 5, 10];
/** 次数格的档位表：一次训练里 reps 的动态范围比重量小得多，×10 没有用武之地 */
export const SCRUB_STEPS_REPS = [1, 2, 5];

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

/**
 * 换算残留：显示值不是 0.5 的倍数（kg↔lbs 换算出来的 132.28、61.24）。
 * 62.5、132.5 这种用户自己定的半档不算。
 */
const isResidue = (v: number) => Math.abs(v * 2 - Math.round(v * 2)) > 1e-6;

function tierFor(v: number, steps: number[], scale: number): number {
  let step = steps[0] ?? 1;
  for (let i = 0; i < steps.length && i < VELOCITY_LADDER.length; i++) {
    if (v >= VELOCITY_LADDER[i] * scale) step = steps[i];
  }
  return step;
}

interface Options {
  /** 当前【显示值】（已按当前单位换算过） */
  value: number;
  /** 改后的显示值。调用方负责换算回存储单位 */
  onChange: (next: number) => void;
  /** 下限，默认 0 */
  min?: number;
  /** 档位表，默认重量的 1/2/5/10。次数传 SCRUB_STEPS_REPS。 */
  steps?: number[];
  disabled?: boolean;
  /**
   * 拖动方向，默认横向。「杠铃片」§3：方向顺着重量的摆放方向 ——
   * 杠铃片沿杆横排就横拖；配重片一摞竖着排就竖拖，往下 = 插销往下 = 更重。
   * 竖拖的格子要配 touch-action: pan-x（.is-scrub-y），否则竖向手势先被页面滚动吃掉。
   */
  axis?: 'x' | 'y';
  /**
   * 吸附网格：第一档先把不在网格上的值吸到网格（往右 ceil、往左 floor）并吃掉这一档。
   * 不传＝原来的「0.5 的倍数」（只收拾 kg⇄lbs 换算残留）。
   * 杠铃传最小一对片（kg 2.5 / lbs 5）：62 配不出来，往左拖第一格先到 60，再照常一格 2.5。
   */
  grid?: number;
  /**
   * 「杠铃片」馆档案：按器材走一下（ExRounder.stepToD）。给了它，steps 就是「一下走几档」的倍数表
   * （[1, 2, 4]），落点由它决定（第一下先吸到那个方向最近能挂的重量，片子不规则时按能挂的下一个走）；
   * grid / 残留取整都不再用。不给＝原来的定步长（纯数字的动作）。
   */
  stepFn?: (v: number, dir: 1 | -1, mult: number) => number;
}

/** 给了 stepFn 时的倍数档：慢拖一档、甩起来两档 / 四档 */
export const SCRUB_MULTS = [1, 2, 4];

interface Result {
  handlers: {
    onPointerDown: (e: React.PointerEvent) => void;
    onPointerMove: (e: React.PointerEvent) => void;
    onPointerUp: (e: React.PointerEvent) => void;
    onPointerCancel: () => void;
    onDragStart: (e: React.DragEvent) => void;
    onClickCapture: (e: React.MouseEvent) => void;
  };
  /** 正在拖动 —— 用来显示刻度与档位角标 */
  scrubbing: boolean;
  /** 当前档位，显示用 */
  step: number;
}

export function useValueScrub({
  value,
  onChange,
  min = 0,
  steps = SCRUB_STEPS_WEIGHT,
  disabled = false,
  axis = 'x',
  grid,
  stepFn,
}: Options): Result {
  // 调用方每次渲染都新建 stepFn：放 ref 里，别让它把 onPointerMove 的身份打翻
  const stepFnRef = useRef(stepFn);
  stepFnRef.current = stepFn;
  const offGrid = (v: number) => (grid ? Math.abs(v / grid - Math.round(v / grid)) > 1e-6 : isResidue(v));
  const toGrid = (v: number, sign: number) =>
    grid
      ? Math.round((sign > 0 ? Math.ceil(v / grid - 1e-9) : Math.floor(v / grid + 1e-9)) * grid * 100) / 100
      : sign > 0 ? Math.ceil(v) : Math.floor(v);
  const pos = (e: React.PointerEvent) => (axis === 'y' ? e.clientY : e.clientX);
  const [scrubbing, setScrubbing] = useState(false);
  const [step, setStep] = useState(steps[0] ?? 1);
  /** 档位表按值比较，别让调用方每次渲染新建的数组把 onPointerMove 的身份打翻 */
  const stepsKey = steps.join(',');
  // 档位表换了（切单位、换器材）就把当前档复位，否则下一次慢拖的第一下会被当成「换档」震一下
  useEffect(() => {
    setStep(Number(stepsKey.split(',')[0]) || 1);
  }, [stepsKey]);

  const drag = useRef<{
    x0: number;
    x: number;
    acc: number;
    engaged: boolean;
    vs: number;
    samples: [number, number][];
    /** 本次拖动已经落过第一档 —— 残留取整只在第一档做 */
    snapped: boolean;
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
      const p = pos(e);
      drag.current = {
        x0: p,
        x: p,
        acc: 0,
        engaged: false,
        vs: 0,
        samples: [[performance.now(), p]],
        snapped: false,
      };
    },
    [disabled, axis],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const d = drag.current;
      if (!d) return;

      if (!d.engaged) {
        if (Math.abs(pos(e) - d.x0) < ENGAGE_PX) return;
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

      const p = pos(e);
      const dx = p - d.x;
      d.x = p;
      d.samples.push([performance.now(), p]);
      if (d.samples.length > 8) d.samples.shift();

      d.vs = d.vs * EMA + vel() * (1 - EMA);
      const px = pxPerDetent();
      // 速度阈值按每档宽度同比例缩放：每档越宽，跳档要甩得越快
      const nextStep = tierFor(d.vs, stepsKey.split(',').map(Number), px / 10);
      if (nextStep !== step) {
        setStep(nextStep);
        haptic(H.longpress); // §5.7 两档：换档＝确认感
      }

      d.acc += dx;
      let moved = false;
      let next = valueRef.current;
      while (Math.abs(d.acc) >= px) {
        const sign = d.acc > 0 ? 1 : -1;
        const fn = stepFnRef.current;
        if (fn) {
          next = Math.max(min, fn(next, sign, nextStep));
        } else if (!d.snapped && offGrid(next)) {
          // 切过单位后的 132.28 这种值，第一档先取整（往右 ceil、往左 floor）并吃掉这一档，
          // 之后再照常 ±1/2/5/10 —— 否则会一路拖出 133.28、134.28。
          // 只在拖动时取整：切单位、打字都保留原值。
          next = Math.max(min, toGrid(next, sign));
        } else {
          next = Math.max(min, Math.round((next + sign * nextStep) * 10) / 10);
        }
        d.snapped = true;
        d.acc -= sign * px;
        // 到了下限 / 空杠再往下拖：值没变就不算一档（不震、不回调）
        if (next !== valueRef.current) moved = true;
      }
      if (moved) {
        valueRef.current = next;
        onChange(next);
        haptic(H.tap); // 每档＝点击感
      }
    },
    [min, onChange, step, stepsKey, vel, axis, grid],
  );

  const end = useCallback(() => {
    if (drag.current?.engaged) scrubEndedAt.current = performance.now();
    drag.current = null;
    setScrubbing(false);
    setStep(Number(stepsKey.split(',')[0]) || 1);
  }, [stepsKey]);

  return {
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: end,
      onPointerCancel: end,
      /**
       * 点进格子旧值是全选的（2026-10-11 聚焦即全选）：鼠标在选中的文字上按住一拖，浏览器会起一次
       * 「拖拽选中文字」的原生拖放，这一拖就不再是横拖改值了（Playwright 的鼠标事件还会被它卡死）。
       * 触屏不会这样，但统一掐掉：这一格上的拖动只有一种意思。
       */
      onDragStart: (e: React.DragEvent) => e.preventDefault(),
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
