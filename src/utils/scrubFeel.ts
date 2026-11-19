/**
 * 横拖改数的手感（首选项「滑动手感」，审查 2026-10-06 第一节第 3 点）：细 / 中 / 粗 ＝ 每档 18 / 14 / 10 px
 * （2026-11-18 整体加宽一号：10px 一档时用户摸不准滑多远是一格），
 * 速度阈值按同比例缩放（每档越宽，跳档要甩得越快）。起拖阈值（ENGAGE_PX）不跟着变。
 *
 * 跟设备走（同振动、撤销开关），不进同步：屏幕密度和手指是这台手机自己的事。
 */
export type ScrubFeel = 'fine' | 'mid' | 'coarse';

export const SCRUB_FEEL_PX: Record<ScrubFeel, number> = { fine: 18, mid: 14, coarse: 10 };

const KEY = 'fitlog_scrub_feel';
let cached: ScrubFeel | null = null;

export function scrubFeel(): ScrubFeel {
  if (cached === null) {
    try {
      const v = localStorage.getItem(KEY);
      cached = v === 'fine' || v === 'coarse' ? v : 'mid';
    } catch {
      cached = 'mid';
    }
  }
  return cached;
}

export function setScrubFeel(v: ScrubFeel): void {
  cached = v;
  try {
    localStorage.setItem(KEY, v);
  } catch {
    /* 写不进去时内存里的值仍然生效 */
  }
}

/**
 * 甩快了一下走两档（首选项「快滑加速」，默认开）。关掉＝无论多快都一格一格走：同样的距离永远是同样的格数。
 * 和滑动手感一样跟设备走。
 */
const ACCEL_KEY = 'fitlog_scrub_accel';
let accel: boolean | null = null;

export function scrubAccel(): boolean {
  if (accel === null) {
    try {
      accel = localStorage.getItem(ACCEL_KEY) !== '0';
    } catch {
      accel = true;
    }
  }
  return accel;
}

export function setScrubAccel(on: boolean): void {
  accel = on;
  try {
    localStorage.setItem(ACCEL_KEY, on ? '1' : '0');
  } catch {
    /* 写不进去时内存里的值仍然生效 */
  }
}

/**
 * 这一下走几倍（2026-11-18 用户反馈「不知道滑多少才是一格」后收紧：原来四档 ×1/2/5/10、0.55 px/ms 就跳，
 * 正常手速也会一格变两格）。只留两档，门槛抬到 1.2 px/ms（每档 14px 时），慢拖和正常拖永远是 tiers[0]。
 * v：平滑后的速度（px/ms）；px：每档像素。纯函数，logic-check 直接测。
 */
export const ACCEL_VELOCITY = 1.2;
export function scrubTier(v: number, tiers: number[], px: number, on: boolean): number {
  const base = tiers[0] ?? 1;
  if (!on || tiers.length < 2) return base;
  return v >= ACCEL_VELOCITY * (px / SCRUB_FEEL_PX.mid) ? tiers[1] : base;
}

/**
 * 起拖阈值：沿拖动方向走够这么多像素才认定「这是一次拖动」。
 *
 * 热区同时也是输入框的点击区，出汗手滑时一次「点」很容易带出几像素位移——误判成拖动的代价是把重量改错。
 * 原来是 12，翻页时手指从重量格上滑过去还是常被认成横划改了值（2026-10-21 用户反馈），抬到 20。
 */
export const ENGAGE_PX = 20;
/**
 * 沿拖动方向的位移要大于另一方向才算拖动；否则是在翻页，放手给页面滚。
 * 原来要 1.5 倍：拇指斜着划时浏览器因为 touch-action 不滚页面，这边又不认是拖动，这一下什么都不发生（2026-10-21 放宽）。
 */
const AXIS_DOMINANCE = 1;

/**
 * 按下后还没起拖时，看位移决定：再等等 / 起拖 / 放手（这一下是翻页，不归这一格管）。
 * along＝沿拖动方向的位移，across＝垂直方向的位移（都是相对按下点）。
 */
export function scrubEngage(along: number, across: number, engagePx = ENGAGE_PX): 'wait' | 'engage' | 'release' {
  // 竖拖（配重片刻度轨）时 along 是竖向、across 是横向，同一条规则
  const a = Math.abs(along);
  const c = Math.abs(across);
  if (Math.max(a, c) < engagePx) return 'wait';
  return a > AXIS_DOMINANCE * c ? 'engage' : 'release';
}

/**
 * 大图往哪个方向拖：跟重量的摆放方向走——配重片一摞竖着排就竖拖（往下＝插销往下＝更重），其余横拖。
 * 2026-10-21 一度把配重片也改成横拖防误触，真机上用户按直觉竖着滑没反应（报成「新动作调不了重量」），
 * 用户纠正后改回：误触靠起拖距离（ENGAGE_PX）和「上次 x」一键改回兜底，不改主手势。组行的格子一律横拖。
 */
export function heroScrubAxis(kind: string | undefined): 'x' | 'y' {
  return kind === 'pin' ? 'y' : 'x';
}

/**
 * 大图画哪一组、拖动能不能写它（2026-11-13 用户定）：选中的组在这张卡上就是它（能写），否则第一组待做（能写），
 * 都做完了画最后一组但不能写——滚页面时拇指落在做完的卡上，一斜划就静默改了入册的重量，做完的组又没有「改回」。
 * 要改做完的组先点组号选中它。idx −1＝一组都没有。
 */
export function heroFocus(sets: { id: string | number; ghost?: boolean }[], selectedId: string | null): { idx: number; live: boolean } {
  const sel = selectedId ? sets.findIndex(s => String(s.id) === selectedId) : -1;
  if (sel >= 0) return { idx: sel, live: true };
  const pending = sets.findIndex(s => s.ghost);
  if (pending >= 0) return { idx: pending, live: true };
  return { idx: sets.length - 1, live: false };
}

/**
 * 拖动走一档后的落点夹在 [min, max]：越界就停在边界上；已经在边界（或超限的旧数据还要往外走）原地不动，
 * 调用方看值没变就不算一档（不震、不回调）。往回走照常。
 */
export function boundDetent(prev: number, next: number, dir: 1 | -1, min: number, max: number): number {
  if (dir > 0) return next > max ? Math.max(prev, max) : next;
  return next < min ? Math.min(prev, min) : next;
}

/**
 * 配重片刻度轨（2026-10-25 用户选定，示意 docs/demos/weight-stack-directions.html 方向 B）：
 * 只有右侧那条轨能起拖，图本身和两侧照常滚页面。起手位置已经挑过，起拖阈值可以比格子低；
 * 一档＝一片＝片距，手指走多少插销走多少；不吃速度跳档（片是离散的，甩一下跳十片只会是误触）。
 */
export const STACK_PITCH = 12;
export const STACK_ENGAGE_PX = 8;

/** 一次拖动的计步状态（useValueScrub 的 drag 里的那几项） */
export interface ScrubTrack {
  /** 按下点（沿拖动方向 / 垂直方向） */
  x0: number;
  c0: number;
  /** 上一次计步到的位置 */
  x: number;
  /** 还没凑够一档的位移 */
  acc: number;
  engaged: boolean;
}

/**
 * 手指挪到 p（沿拖动方向）/ c（垂直方向）：还没起拖就按 scrubEngage 判；起拖那一刻**从当前位置开始计步**，
 * 之前走过的那段只用来判「这是一次拖动」，不算档（2026-10-22：ENGAGE_PX 20 比每档 10px 宽，原来把按下点到接管点的
 * 整段都算进去，第一次接管就连走两档——杠铃 61.24 一划直接到 70）。之后每走够 px 一档，返回这一下走的各档方向。
 * 纯函数：useValueScrub 和 logic-check 共用。
 */
export function trackScrub(
  t: ScrubTrack,
  p: number,
  c: number,
  px: number,
  engagePx = ENGAGE_PX,
): { t: ScrubTrack; go: 'wait' | 'release' | 'move'; detents: (1 | -1)[] } {
  if (!t.engaged) {
    const go = scrubEngage(p - t.x0, c - t.c0, engagePx);
    if (go !== 'engage') return { t, go, detents: [] };
    return { t: { ...t, engaged: true, x: p, acc: 0 }, go: 'move', detents: [] };
  }
  let acc = t.acc + (p - t.x);
  const detents: (1 | -1)[] = [];
  while (Math.abs(acc) >= px) {
    const sign = acc > 0 ? 1 : -1;
    detents.push(sign);
    acc -= sign * px;
  }
  return { t: { ...t, x: p, acc }, go: 'move', detents };
}
