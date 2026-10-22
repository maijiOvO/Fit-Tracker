/**
 * 横拖改数的手感（首选项「滑动手感」，审查 2026-10-06 第一节第 3 点）：细 / 中 / 粗 ＝ 每档 14 / 10 / 7 px，
 * 速度阈值梯按同比例缩放（每档越宽，跳档要甩得越快）。起拖阈值（ENGAGE_PX）不跟着变。
 *
 * 跟设备走（同振动、撤销开关），不进同步：屏幕密度和手指是这台手机自己的事。
 */
export type ScrubFeel = 'fine' | 'mid' | 'coarse';

export const SCRUB_FEEL_PX: Record<ScrubFeel, number> = { fine: 14, mid: 10, coarse: 7 };

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
export const AXIS_DOMINANCE = 1;

/**
 * 按下后还没起拖时，看位移决定：再等等 / 起拖 / 放手（这一下是翻页，不归这一格管）。
 * along＝沿拖动方向的位移，across＝垂直方向的位移（都是相对按下点）。
 */
export function scrubEngage(along: number, across: number): 'wait' | 'engage' | 'release' {
  // 竖拖（配重片大图）时 along 是竖向、across 是横向，同一条规则
  const a = Math.abs(along);
  const c = Math.abs(across);
  if (Math.max(a, c) < ENGAGE_PX) return 'wait';
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
): { t: ScrubTrack; go: 'wait' | 'release' | 'move'; detents: (1 | -1)[] } {
  if (!t.engaged) {
    const go = scrubEngage(p - t.x0, c - t.c0);
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
