/**
 * 「能挂的重量」与就近取整 —— docs/design-plates.md §3「馆档案」。
 *
 * 三条规则（2026-10-18 用户定，示意：docs/demos/gym-workbench.html）：
 *   1. 你选的单位就是你现在用的片子：所有数（片子、器械一档、±、拖动、取整）都在显示单位下算。
 *   2. 自动生成的重量（底稿、带动后面、递减默认、切单位 / 换馆）严格取最近能挂的重量，等距取轻。
 *      手打的数照原样记。
 *   3. 一档 = 这个馆、这件器材的一档（馆档案）；个别器械在动作 ⋯ 里单独设（gymOverrides）。
 *
 * 全部是纯函数：值一律是「显示单位下带符号的数」，调用方负责 kg ⇄ 显示单位换算。
 */
import type { LoadKind } from '../hooks/useLoadKind';
import { DEFAULT_PLATES, KG_PER_LB, type PlateUnit } from './plates';

export interface IncSpec {
  v: number;
  u: PlateUnit;
  /**
   * 配重片的起始（最轻一格，和 v 同单位）：有的龙门架从 12.5 lb 起、每格 +5，能插的是 12.5 / 17.5 / 22.5…
   * 没有或 0＝从 0 起（一档的整数倍）。只对配重片（插销）生效（2026-10-20 用户定）。
   */
  s?: number;
}

/** 一个馆的器材档案（存 AppPrefs.gyms[馆名]） */
export interface GymProfile {
  plateUnit: PlateUnit;
  /** 这个馆有的片（plateUnit 下的标称重量） */
  plates: number[];
  cable: IncSpec;
  machine: IncSpec;
  dumbbell: IncSpec;
  /** 壶铃一档（2026-10-20 加）：旧档案没有这一项，按默认 */
  kettlebell?: IncSpec;
}

/** 器械 / 哑铃 / 壶铃一档能选的值（档案表单的 − / ＋ 走这张表；换单位时也取它里面最接近的） */
export const INC_CHOICES: Record<PlateUnit, number[]> = {
  kg: [0.5, 1, 1.25, 2, 2.5, 4, 5, 10],
  lbs: [1, 2.5, 5, 10, 15, 20],
};

/** 壶铃常见是 8 / 12 / 16 / 20 / 24 kg 一档 4 kg；磅的壶铃多是 5 lb 一档 */
export const DEFAULT_KETTLEBELL_INC: Record<PlateUnit, IncSpec> = {
  kg: { v: 4, u: 'kg' },
  lbs: { v: 5, u: 'lbs' },
};

/** 没设过档案的馆（或没标馆）：常用的标准片（DEFAULT_PLATES）+ 常见档位 */
export function defaultProfile(unit: PlateUnit): GymProfile {
  return unit === 'kg'
    ? { plateUnit: 'kg', plates: [...DEFAULT_PLATES.kg], cable: { v: 5, u: 'kg' }, machine: { v: 5, u: 'kg' }, dumbbell: { v: 2.5, u: 'kg' }, kettlebell: DEFAULT_KETTLEBELL_INC.kg }
    : { plateUnit: 'lbs', plates: [...DEFAULT_PLATES.lbs], cable: { v: 10, u: 'lbs' }, machine: { v: 10, u: 'lbs' }, dumbbell: { v: 5, u: 'lbs' }, kettlebell: DEFAULT_KETTLEBELL_INC.lbs };
}

function convert(v: number, from: PlateUnit, to: PlateUnit): number {
  if (from === to) return v;
  return from === 'kg' ? v / KG_PER_LB : v * KG_PER_LB;
}

/** 档位换到当前单位：取 INC_CHOICES 里最接近的（2.5 kg 一档在 lb 下就是 5 lb 一档 —— 单位就是一切） */
export function incIn(c: IncSpec, unit: PlateUnit): number {
  if (c.u === unit) return c.v;
  const v = convert(c.v, c.u, unit);
  return INC_CHOICES[unit].reduce((best, x) => (Math.abs(x - v) < Math.abs(best - v) ? x : best), INC_CHOICES[unit][0]);
}

/** 起始换到当前单位：同单位照用；换单位按实际重量换算（这摞配重片本身没变），保留到 0.05 */
export function startIn(c: IncSpec | undefined, unit: PlateUnit): number {
  if (!c?.s || c.s <= 0) return 0;
  return Math.round(convert(c.s, c.u, unit) * 20) / 20;
}

/** 当前单位下实际用的那一套：档案和单位一致就照用，不一致按标准片、档位换算到最近（这次换了一套片子） */
export interface LoadCtx {
  unit: PlateUnit;
  /** 能用的片（当前单位） */
  plates: number[];
  /** 杠铃空杠（当前单位）；挂片式器械只算片子，不用它 */
  bar: number;
  /** 这件器材的一档（配重片 / 哑铃 / 辅助），按 kind 选好了 */
  inc: number;
  /** 配重片的起始（最轻一格，当前单位）；0 / 没有＝一档的整数倍 */
  start?: number;
}

export function profileIn(
  profile: GymProfile | undefined,
  unit: PlateUnit,
): {
  plates: number[];
  cable: number;
  machine: number;
  dumbbell: number;
  kettlebell: number;
  cableStart: number;
  machineStart: number;
} {
  const p = profile ?? defaultProfile(unit);
  return {
    plates: p.plateUnit === unit && p.plates.length ? [...p.plates].sort((a, b) => b - a) : [...DEFAULT_PLATES[unit]],
    cable: incIn(p.cable, unit),
    machine: incIn(p.machine, unit),
    dumbbell: incIn(p.dumbbell, unit),
    kettlebell: incIn(p.kettlebell ?? DEFAULT_KETTLEBELL_INC[p.plateUnit], unit),
    cableStart: startIn(p.cable, unit),
    machineStart: startIn(p.machine, unit),
  };
}

/* ── 每边能凑出来的重量：这一套片、每种不限数量的背包（0.05 为单位），带回溯 ── */

// 0.05：自定义片按馆的单位存、四舍五入到 0.05（kg 馆里的 45 lb 片 = 20.4），0.25 的格子会把它当成 20.5（2026-10-20）
const Q = 20;
const tables = new Map<string, Int16Array>();
function sideTable(plates: number[], unit: PlateUnit): Int16Array {
  const key = `${unit}:${plates.join(',')}`;
  const hit = tables.get(key);
  if (hit) return hit;
  const max = (unit === 'kg' ? 300 : 660) * Q;
  const can = new Int16Array(max + 1).fill(-1);
  can[0] = 0;
  const ps = [...plates].sort((a, b) => b - a).map(p => Math.round(p * Q));
  for (let s = 1; s <= max; s++) {
    for (const p of ps) {
      if (s >= p && can[s - p] >= 0) {
        can[s] = p;
        break;
      }
    }
  }
  tables.set(key, can);
  return can;
}

/** 每边从里到外挂哪几片（side 必须是能凑出来的，否则返回凑到的最接近的那一边） */
export function sidePlates(side: number, plates: number[], unit: PlateUnit): number[] {
  const can = sideTable(plates, unit);
  let u = Math.max(0, Math.min(can.length - 1, Math.round(side * Q)));
  while (u > 0 && can[u] < 0) u--;
  const out: number[] = [];
  while (u > 0) {
    const p = can[u];
    out.push(p / Q);
    u -= p;
  }
  return out.sort((a, b) => b - a);
}

function sideBracket(side: number, plates: number[], unit: PlateUnit): [number, number] {
  const can = sideTable(plates, unit);
  const su = side * Q;
  // 夹在表内：超出 DP 表（杠铃 600 多 kg）时 can[x] 是 undefined，扫描会停在不能挂的数上
  let lo = Math.min(can.length - 1, Math.max(0, Math.floor(su + 1e-6)));
  let hi = Math.min(can.length - 1, Math.max(0, Math.ceil(su - 1e-6)));
  while (lo > 0 && can[lo] < 0) lo--;
  while (hi < can.length - 1 && can[hi] < 0) hi++;
  return [lo / Q, hi / Q];
}

const r2 = (v: number) => Math.round(v * 100) / 100;

/** 是不是要取整的器材：纯数字的动作（含没有重量这一项的）不管 */
export function snaps(kind: LoadKind): boolean {
  return kind !== 'plain';
}

/** v 上下两个能挂的重量（当前单位、带符号） */
export function bracket(kind: LoadKind, v: number, ctx: LoadCtx): { lo: number; hi: number } {
  if (kind === 'plates' || kind === 'loaded') {
    const base = kind === 'plates' ? ctx.bar : 0;
    if (v <= base) return { lo: base, hi: base };
    const [a, b] = sideBracket((v - base) / 2, ctx.plates, ctx.unit);
    return { lo: r2(base + 2 * a), hi: r2(base + 2 * b) };
  }
  if (kind === 'signed' && v > 0) {
    // 负重：腰上挂一摞片（一边）
    const [a, b] = sideBracket(v, ctx.plates, ctx.unit);
    return { lo: r2(a), hi: r2(b) };
  }
  const st = ctx.inc > 0 ? ctx.inc : 1;
  // 配重片：能插的是 最轻一格、+一档、…；最轻一格也是下限（拖 / ± / 取整都到不了更轻），没设就是一档本身。
  // 比最轻一格还轻的（手打的 5）照原样记，取整往上吸到最轻一格；0 是「还没填」，不吸
  const s0 = kind === 'pin' ? (ctx.start && ctx.start > 0 ? ctx.start : st) : 0;
  if (s0 > 0) {
    if (v <= 1e-9) return { lo: 0, hi: 0 };
    if (v < s0 - 1e-9) return { lo: r2(s0), hi: r2(s0) };
    return {
      lo: r2(s0 + Math.floor((v - s0) / st + 1e-9) * st),
      hi: r2(s0 + Math.ceil((v - s0) / st - 1e-9) * st),
    };
  }
  let lo = Math.floor(v / st + 1e-9) * st;
  let hi = Math.ceil(v / st - 1e-9) * st;
  if (kind === 'pair' || kind === 'bell') {
    lo = Math.max(st, lo);
    hi = Math.max(st, hi);
  }
  return { lo: r2(lo), hi: r2(hi) };
}

export function isLoadable(kind: LoadKind, v: number, ctx: LoadCtx): boolean {
  if (!snaps(kind)) return true;
  const { lo, hi } = bracket(kind, v, ctx);
  return Math.abs(v - lo) < 0.01 || Math.abs(v - hi) < 0.01;
}

/** 严格取最近能挂的重量，等距取轻（2026-10-18 用户定） */
export function nearest(kind: LoadKind, v: number, ctx: LoadCtx): number {
  if (!snaps(kind)) return r2(v);
  const { lo, hi } = bracket(kind, v, ctx);
  return hi - v < v - lo - 1e-9 ? hi : lo;
}

export function snap(kind: LoadKind, v: number, ctx: LoadCtx): number {
  return isLoadable(kind, v, ctx) ? r2(v) : nearest(kind, v, ctx);
}

/** 这件器材的一档（当前单位）。纯数字的动作返回 null：调用方用首选项的步长兜底 */
export function stepOf(kind: LoadKind, v: number, ctx: LoadCtx): number | null {
  if (kind === 'plates' || kind === 'loaded') return Math.min(...ctx.plates) * 2;
  if (kind === 'signed') return v < 0 ? ctx.inc : Math.min(...ctx.plates);
  if (kind === 'pin' || kind === 'pair' || kind === 'bell') return ctx.inc;
  return null;
}

/**
 * 从 cur 往 dir 走一下（± 一下、拖动一格）：
 * 不在格子上的第一下先落到那个方向最近能挂的重量（吃掉这一下）；在格子上就走 mult 档。
 * 片子组合不规则时（比如只有 20 和 25）按「能挂的下一个」走，不会落进挂不出来的数。
 */
export function stepTo(kind: LoadKind, cur: number, dir: 1 | -1, mult: number, ctx: LoadCtx, opts: { min?: number } = {}): number {
  const min = opts.min ?? (kind === 'signed' ? -Infinity : 0);
  const st = stepOf(kind, cur, ctx);
  if (st === null) return cur;
  const { lo, hi } = bracket(kind, cur, ctx);
  let next: number;
  if (!isLoadable(kind, cur, ctx)) next = dir > 0 ? hi : lo;
  else {
    // 一下＝那个方向上紧挨着的下一个能挂的重量。片子齐全时就是一档（最小一对片 / 一档）；
    // 片子不规则（只有 25、20）时不会跳过能挂的 70（原先按「最小片 ×2」找，会从 60 直接跳到 100）。
    // 到了下限（空杠、哑铃最小那对、0）原地不动
    let x = cur;
    for (let i = 0; i < mult; i++) {
      const b = bracket(kind, x + dir * 0.001, ctx);
      const n = dir > 0 ? b.hi : b.lo;
      if (Math.abs(n - x) < 0.001) break;
      x = n;
    }
    next = x;
  }
  // 杠铃往下减不到空杠以下（空杠就是最轻的那一下）；要记 0 就直接打字
  if (kind === 'plates' && next < ctx.bar && cur >= ctx.bar - 0.01) next = ctx.bar;
  // 比最轻能挂的还轻（0、手打的 15）：往下不能反而跳到空杠 / 最小一档，原地不动；往上照常吸上去
  if (dir < 0 && next > cur) next = cur;
  if (dir > 0 && next < cur) next = cur;
  // + 0：把 -0 收成 0（−5 往上走一档落在 -0）
  return Math.max(min, r2(next)) + 0;
}
