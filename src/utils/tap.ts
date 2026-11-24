/**
 * 「这一下算不算点击」自己判，加一份点按记录（2026-11-18）。
 *
 * 起因：随手点组号偶尔没反应，认真点又复现不了。浏览器的 click 很娇气 —— 手指按下后滑出触摸容差
 * （安卓约 8dp）就当成滚动、不再发 click；鼠标抬起时移出了元素也不发。按下的反馈有了，动作没有。
 * 所以关键控件不等 click：抬手时位移在 TAP_SLOP_PX 以内、没按到长按那么久，就算点了（hooks/useTap）。
 *
 * 点按记录是全局的：每次按在按钮上，记位移、时长、浏览器有没有发 click、有没有被自判救回来，
 * 存这台设备最近 TAP_LOG_MAX 条（首选项「点按记录」里看）。它回答的是「别的按钮是不是同一个毛病」。
 */

/** 抬手时离按下点这么近就算点击。比浏览器的容差宽：随手点带出的那点滑动要收进来，真要滚页面的一划远不止这么多 */
export const TAP_SLOP_PX = 14;

export type TapVerdict = 'tap' | 'moved' | 'held';

/** dx / dy：抬手点相对按下点的位移；ms：按了多久；maxMs：按到这么久就是长按，不算点击 */
export function judgeTap(dx: number, dy: number, ms: number, maxMs: number): TapVerdict {
  if (ms >= maxMs) return 'held';
  return Math.hypot(dx, dy) <= TAP_SLOP_PX ? 'tap' : 'moved';
}

export interface TapRec {
  /** 按下的时刻（Date.now） */
  at: number;
  /** 按的是哪个控件（同撤销步的叫法） */
  label: string;
  kind: string;
  /** 抬手时的位移（px，取整）和按住的时长 */
  move: number;
  ms: number;
  /** 浏览器有没有发 click */
  click: boolean;
  /** 自判点击把这一下接住了（useTap） */
  saved: boolean;
}

export const TAP_LOG_MAX = 60;
const KEY = 'fitlog_tap_log';

export function readTapLog(): TapRec[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export function clearTapLog(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* 清不掉就算了：只是诊断记录 */
  }
}

/** 短按、没怎么动，浏览器却没发 click，也没被自判接住：这就是「点了没反应」 */
export function isLostTap(r: TapRec, maxMs: number): boolean {
  return !r.click && !r.saved && judgeTap(r.move, 0, r.ms, maxMs) === 'tap';
}

function push(rec: TapRec): void {
  try {
    localStorage.setItem(KEY, JSON.stringify([...readTapLog(), rec].slice(-TAP_LOG_MAX)));
  } catch {
    /* 存不下就不记 */
  }
}

/** 正在进行 / 刚结束、还在等 click 的那一下 */
let open: (TapRec & { x: number; y: number; t0: number; timer?: number }) | null = null;

/** useTap 判成点击并执行了：记到这一下头上 */
export function noteTapSaved(): void {
  if (open) open.saved = true;
}

/** 抬手后等这么久看 click 来不来（click 紧跟着 pointerup，慢机器上留点余量） */
const CLICK_WAIT_MS = 400;

/**
 * 装上全局记录（App 挂载时一次）。labelOf：按下的元素叫什么，不是按钮返回 ''（不记）。
 * 全部是捕获阶段的被动监听，不拦任何事件。
 */
export function installTapLog(labelOf: (el: Element | null) => string): () => void {
  const flush = () => {
    if (!open) return;
    window.clearTimeout(open.timer);
    const { x: _x, y: _y, t0: _t0, timer: _timer, ...rec } = open;
    open = null;
    push(rec);
  };
  const onDown = (e: PointerEvent) => {
    flush();
    if (!e.isPrimary) return;
    const label = labelOf(e.target as Element | null);
    if (!label) return;
    open = { at: Date.now(), label, kind: e.pointerType, move: 0, ms: 0, click: false, saved: false, x: e.clientX, y: e.clientY, t0: performance.now() };
  };
  const endAt = (x: number, y: number) => {
    if (!open || open.timer !== undefined) return;
    open.move = Math.round(Math.hypot(x - open.x, y - open.y));
    open.ms = Math.round(performance.now() - open.t0);
    open.timer = window.setTimeout(flush, CLICK_WAIT_MS);
  };
  // 触屏看 touchend：浏览器接管滚动后 pointer 事件就断了（pointercancel），touch 事件还在，位移才量得到
  const onUp = (e: PointerEvent) => {
    if (e.pointerType !== 'touch') endAt(e.clientX, e.clientY);
  };
  const onTouchEnd = (e: TouchEvent) => {
    const t = e.changedTouches[0];
    if (t) endAt(t.clientX, t.clientY);
  };
  const onClick = () => {
    if (open) open.click = true;
  };
  document.addEventListener('pointerdown', onDown, true);
  document.addEventListener('pointerup', onUp, true);
  document.addEventListener('touchend', onTouchEnd, { capture: true, passive: true });
  document.addEventListener('touchcancel', onTouchEnd, { capture: true, passive: true });
  document.addEventListener('click', onClick, true);
  return () => {
    flush();
    document.removeEventListener('pointerdown', onDown, true);
    document.removeEventListener('pointerup', onUp, true);
    document.removeEventListener('touchend', onTouchEnd, true);
    document.removeEventListener('touchcancel', onTouchEnd, true);
    document.removeEventListener('click', onClick, true);
  };
}

/**
 * 连点的第二下（审查 C40）：删组 / 删档是单击即删，删完下一行立刻补到指下（滚到底时是上面的行被夹回来），
 * 手抖连点的第二下就会多删一行。离上一次真正执行的删除不到 400ms、落点相距不到 22px（44px 删除键的一半；
 * 相邻两行的删除键至少隔 44px）就判为连点。故意快速删相邻几行时手指会挪开 ≥44px，不受影响。
 */
const REPEAT_TAP_MS = 400;
const REPEAT_TAP_PX = 22;
export function isRepeatTap(prev: { t: number; x: number; y: number } | null, cur: { t: number; x: number; y: number }): boolean {
  return !!prev && cur.t - prev.t < REPEAT_TAP_MS && Math.hypot(cur.x - prev.x, cur.y - prev.y) < REPEAT_TAP_PX;
}

/**
 * 吞手势补发的那次 click（审查 navigation-overlays#5）：限时、吞一次就作废，**下一次按下也作废**。
 * 真点击一定先有 pointerdown，补发的 click 没有；安卓上不补发时，第一下真点按带着 pointerdown 当场把窗口作废，
 * 不会被误吞（DevNotes patterns「吞掉手势补发的 click」）。状态放在调用方的 ref 里。
 */
export interface ClickSwallow {
  at: number;
}
export const newClickSwallow = (): ClickSwallow => ({ at: -Infinity });
/** 手势达成：武装 */
export function armSwallow(s: ClickSwallow, now: number): void {
  s.at = now;
}
/** 来了一次真按下：作废 */
export function disarmSwallow(s: ClickSwallow): void {
  s.at = -Infinity;
}
/** click 来了：在窗口内返回 true 并立刻作废（只吞一次）；超时返回 false */
export function takeSwallow(s: ClickSwallow, now: number, ms: number): boolean {
  const hit = now - s.at < ms;
  s.at = -Infinity;
  return hit;
}
