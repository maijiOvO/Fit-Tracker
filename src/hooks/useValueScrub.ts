/**
 * 横向拖动改数值 —— 速度自适应步长。
 *
 * 用在账本行的重量格与次数格上：整个格子就是 scrub 区，
 *   - 点一下 → 照旧聚焦输入框、弹键盘（键盘路径一点没变）
 *   - 横向拖 → 一格一格改值，甩起来一下两格（首选项可关）
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
import { boundDetent, scrubAccel, scrubFeel, scrubGate, scrubTier, trackScrub, SCRUB_FEEL_PX } from '../utils/scrubFeel';

/** 每跨这么多像素落一档（首选项「滑动手感」，读的是模块缓存，每次移动取一下不费事） */
const pxPerDetent = () => SCRUB_FEEL_PX[scrubFeel()];

/** 档位表：慢拖一档、甩起来两档（门槛见 scrubFeel.scrubTier）。给了 stepFn 时是倍数，否则是加减的数 */
export const SCRUB_TIERS = [1, 2];

/** 速度平滑系数。不平滑的话档位会在阈值边界反复横跳。 */
const EMA = 0.7;

/**
 * 换算残留：显示值不是 0.5 的倍数（kg↔lbs 换算出来的 132.28、61.24）。
 * 62.5、132.5 这种用户自己定的半档不算。
 */
const isResidue = (v: number) => Math.abs(v * 2 - Math.round(v * 2)) > 1e-6;

interface Options {
  /** 当前【显示值】（已按当前单位换算过） */
  value: number;
  /** 改后的显示值。调用方负责换算回存储单位 */
  onChange: (next: number) => void;
  /** 下限，默认 0 */
  min?: number;
  /** 上限（重量的全站上限，loadCapD）；到顶和到下限一样：不震、不回调 */
  max?: number;
  /** 档位表，默认 SCRUB_TIERS；配重片刻度轨传 [1]（不跳档） */
  steps?: number[];
  disabled?: boolean;
  /**
   * 拖动方向，默认横向。配重片竖拖（纵向排布就竖着滑，heroScrubAxis），只挂在刻度轨上；组行格子一律横拖。
   * 竖拖的元素要配 touch-action: pan-x（.pin-rail），否则竖向手势先被页面滚动吃掉。
   */
  axis?: 'x' | 'y';
  /**
   * 吸附网格：第一档先把不在网格上的值吸到网格（往右 ceil、往左 floor）并吃掉这一档。
   * 不传＝原来的「0.5 的倍数」（只收拾 kg⇄lbs 换算残留）。
   * 杠铃传最小一对片（kg 2.5 / lbs 5）：62 配不出来，往左拖第一格先到 60，再照常一格 2.5。
   */
  grid?: number;
  /**
   * 「杠铃片」馆档案：按器材走一下（ExRounder.stepToD）。给了它，steps 就是「一下走几档」的倍数表，
   * 落点由它决定（第一下先吸到那个方向最近能挂的重量，片子不规则时按能挂的下一个走）；
   * grid / 残留取整都不再用。不给＝原来的定步长（纯数字的动作）。
   */
  stepFn?: (v: number, dir: 1 | -1, mult: number) => number;
  /** 每档固定像素（配重片刻度轨＝片距，跟手）；不传按首选项「滑动手感」 */
  px?: number;
  /** 起拖阈值；不传＝ENGAGE_PX */
  engagePx?: number;
  /** 每走一档的反馈；不传＝一下点击感振动 */
  onDetent?: (dir: 1 | -1) => void;
}

interface Result {
  handlers: {
    onPointerDown: (e: React.PointerEvent) => void;
    onPointerMove: (e: React.PointerEvent) => void;
    onPointerUp: (e: React.PointerEvent) => void;
    onPointerCancel: (e: React.PointerEvent) => void;
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
  max = Infinity,
  steps = SCRUB_TIERS,
  disabled = false,
  axis = 'x',
  grid,
  stepFn,
  px: fixedPx,
  engagePx,
  onDetent,
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
  const cross = (e: React.PointerEvent) => (axis === 'y' ? e.clientX : e.clientY);
  const [scrubbing, setScrubbing] = useState(false);
  const [step, setStep] = useState(steps[0] ?? 1);
  /** 档位表按值比较，别让调用方每次渲染新建的数组把 onPointerMove 的身份打翻 */
  const stepsKey = steps.join(',');
  // 档位表换了（切单位、换器材）就把当前档复位，否则下一次慢拖的第一下会被当成「换档」震一下
  useEffect(() => {
    setStep(Number(stepsKey.split(',')[0]) || 1);
  }, [stepsKey]);

  const drag = useRef<{
    /** 按下的那根手指：别的手指的事件一律不算这次拖动（scrubGate） */
    pid: number;
    x0: number;
    /** 按下点在垂直方向的坐标：用来判断这一下是不是在翻页 */
    c0: number;
    x: number;
    acc: number;
    engaged: boolean;
    vs: number;
    samples: [number, number][];
    /** 本次拖动已经落过第一档 —— 残留取整只在第一档做 */
    snapped: boolean;
    /** 接管后记下这一格：量规的 CSS 变量写在它上面，松手时清掉 */
    el?: HTMLElement;
  } | null>(null);
  /**
   * 拖过之后要吞掉紧跟着的那次 click，否则松手会顺手聚焦输入框、弹出键盘。
   *
   * 用【时间戳】而不是布尔开关：布尔开关是粘滞的 —— 手势若以 pointercancel
   * 结束（来电、系统手势打断），后面根本不会有 click 来把它清掉，
   * 这个 true 就会一直挂着，把用户【下一次】正常点击吃掉，
   * 表现为「点重量没反应」，而且极难复现。时间戳会自己过期。
   */
  const scrubEndedAt = useRef(-Infinity);
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
      const g = scrubGate(drag.current, { type: 'down', pid: e.pointerId, primary: e.isPrimary });
      if (g === 'abort') {
        // 两指同压 / 捏合：还没起拖就落下第二指，这一手作废，等手指全抬起、下一次主指针按下再接
        drag.current = null;
        return;
      }
      if (g !== 'start') return;
      const p = pos(e);
      drag.current = {
        pid: e.pointerId,
        x0: p,
        c0: cross(e),
        x: p,
        acc: 0,
        engaged: false,
        vs: 0,
        samples: [[performance.now(), p]],
        snapped: false,
      };
      // 鼠标：按下就捕获（2026-10-22）。窄的数字框（50px 上下）里，鼠标走够 20px 接管之前就移出了框，
      // 之后的 move 不再送到这里，横划改不了数。触屏的指针自带隐式捕获，不受影响
      if (e.pointerType === 'mouse') {
        try {
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        } catch {
          /* noop */
        }
      }
    },
    [disabled, axis],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const d = drag.current;
      if (!d || scrubGate(d, { type: 'move', pid: e.pointerId, primary: e.isPrimary }) !== 'track') return;

      const px = fixedPx ?? pxPerDetent();
      // 计步交给 trackScrub：接管那一刻从当前位置起算，之前走过的那段不算档（scrubFeel.trackScrub）
      const wasEngaged = d.engaged;
      const r = trackScrub(d, pos(e), cross(e), px, engagePx);
      if (r.go === 'wait') return;
      if (r.go === 'release') {
        // 斜着 / 竖着划是在翻页，这一下放手不管了
        drag.current = null;
        return;
      }
      if (!wasEngaged) {
        setScrubbing(true);
        try {
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        } catch {
          /* noop */
        }
        // 已经聚焦时把键盘收掉：拖着改数值的同时键盘杵在下面，
        // 既挡视线又会因为 visualViewport 变化让行跳一下。
        (document.activeElement as HTMLElement | null)?.blur?.();
        d.el = e.currentTarget as HTMLElement;
        d.el.style.setProperty('--scrub-px', `${px}px`);
      }
      Object.assign(d, r.t);
      // 量规上的游标跟手：离下一格还差多少（.scrub-gauge 读这个变量，不走 React 重渲染）
      d.el?.style.setProperty('--scrub-acc', `${d.acc}px`);

      const p = pos(e);
      d.samples.push([performance.now(), p]);
      if (d.samples.length > 8) d.samples.shift();

      d.vs = d.vs * EMA + vel() * (1 - EMA);
      const nextStep = scrubTier(d.vs, stepsKey.split(',').map(Number), px, scrubAccel());
      if (nextStep !== step) {
        setStep(nextStep);
        haptic(H.longpress); // §5.7 两档：换档＝确认感
      }

      let moved: 0 | 1 | -1 = 0;
      let next = valueRef.current;
      for (const sign of r.detents) {
        const fn = stepFnRef.current;
        // 切过单位后的 132.28 这种值，第一档先取整（往右 ceil、往左 floor）并吃掉这一档，
        // 之后再照常 ±1/2/5/10 —— 否则会一路拖出 133.28、134.28。
        // 只在拖动时取整：切单位、打字都保留原值。
        const cand = fn
          ? fn(next, sign, nextStep)
          : !d.snapped && offGrid(next)
            ? toGrid(next, sign)
            : Math.round((next + sign * nextStep) * 10) / 10;
        next = boundDetent(next, cand, sign, min, max);
        d.snapped = true;
        // 到了上下限 / 空杠再往外拖：值没变就不算一档（不震、不回调）
        if (next !== valueRef.current) moved = sign;
      }
      if (moved) {
        valueRef.current = next;
        onChange(next);
        if (onDetent) onDetent(moved);
        else haptic(H.tap); // 每档＝点击感
      }
    },
    [min, max, onChange, step, stepsKey, vel, axis, grid, fixedPx, engagePx, onDetent],
  );

  const end = useCallback(() => {
    if (drag.current?.engaged) scrubEndedAt.current = performance.now();
    drag.current?.el?.style.removeProperty('--scrub-acc');
    drag.current = null;
    setScrubbing(false);
    setStep(Number(stepsKey.split(',')[0]) || 1);
  }, [stepsKey]);

  /** 只有按下那根手指抬起 / 被打断才收尾：第二指先抬起不该把拖动停在半路 */
  const endFor = useCallback(
    (e: React.PointerEvent) => {
      const type = e.type === 'pointercancel' ? 'cancel' : 'up';
      if (scrubGate(drag.current, { type, pid: e.pointerId, primary: e.isPrimary }) === 'end') end();
    },
    [end],
  );

  return {
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: endFor,
      onPointerCancel: endFor,
      /**
       * 点进格子旧值是全选的（2026-10-11 聚焦即全选）：鼠标在选中的文字上按住一拖，浏览器会起一次
       * 「拖拽选中文字」的原生拖放，这一拖就不再是横拖改值了（Playwright 的鼠标事件还会被它卡死）。
       * 触屏不会这样，但统一掐掉：这一格上的拖动只有一种意思。
       */
      onDragStart: (e: React.DragEvent) => e.preventDefault(),
      onClickCapture: (e: React.MouseEvent) => {
        if (performance.now() - scrubEndedAt.current > SWALLOW_MS) return;
        scrubEndedAt.current = -Infinity;
        e.preventDefault();
        e.stopPropagation();
      },
    },
    scrubbing,
    step,
  };
}
