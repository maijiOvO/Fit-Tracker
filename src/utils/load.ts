/**
 * 带正负的负荷（2026-10 变体第二层）
 *
 * 自重类动作（引体、双杠、悬垂举腿…）的「重量」是相对自重的一条数轴：辅助为负、自重 0、负重为正。
 * 从辅助 −30 一路练到负重 +10 是连续的进步，纪录按带符号的数比；递减可以从 +10 降到 −20。
 *
 * 存储不动：weight 仍是非负的 kg，号记在组上的 bodyweightMode（'assisted' / 'weighted' / 'normal'）。
 * 旧数据只在动作实例上有 instanceConfig.bodyweightMode（整场一个号），组上没写时按它算 —— 不用迁移。
 */
import type { Exercise, SetLog, SubSetLog } from '../../types';
import { getLoadMode } from './exerciseConfig';

type AnySet = Pick<SetLog, 'weight' | 'bodyweightMode'>;

/** 这一组的号：组上写了辅助 / 负重就按组；没写按动作实例（旧数据整场一个号） */
export function setSign(s: AnySet, ex?: Exercise | null, parent?: AnySet): -1 | 1 {
  const own = s.bodyweightMode;
  if (own === 'assisted') return -1;
  if (own === 'weighted') return 1;
  // 'normal'（新代码只在 0 上写它）和没写一样，往上找：递减档跟母组、母组跟动作实例
  if (parent) return setSign(parent, ex);
  return ex && getLoadMode(ex) === 'assisted' ? -1 : 1;
}

/** 带符号的 kg：辅助为负 */
export function signedKg(s: AnySet, ex?: Exercise | null, parent?: AnySet): number {
  return (Number(s.weight) || 0) * setSign(s, ex, parent);
}

/** 把带符号的 kg 写回组：{ weight（非负）, bodyweightMode } */
export function fromSignedKg(v: number): Pick<SetLog, 'weight' | 'bodyweightMode'> {
  if (v < 0) return { weight: -v, bodyweightMode: 'assisted' };
  if (v > 0) return { weight: v, bodyweightMode: 'weighted' };
  return { weight: 0, bodyweightMode: 'normal' };
}

/** 动作在这场是不是按带正负记：动作设置开了，或者这张卡沿用了旧的负重 / 辅助标记 */
export function usesSignedLoad(ex: Exercise, signedByDef: boolean): boolean {
  return signedByDef || getLoadMode(ex) !== 'none';
}

/* ── 上限（2026-11-13 用户定）：多按一个 0 就是一条假纪录，按显示单位夹，边界才是整数 ── */

type Unit = 'kg' | 'lbs';
/** 一组重量（显示单位）：普通 500 kg / 1100 lb；带正负的 ±300 kg（660 lb） */
const LOAD_CAP: Record<Unit, number> = { kg: 500, lbs: 1100 };
const SIGNED_CAP: Record<Unit, number> = { kg: 300, lbs: 660 };
/** 体重（显示单位） */
const BODYWEIGHT_RANGE: Record<Unit, [number, number]> = { kg: [20, 300], lbs: [44, 660] };

/** 设置里能填的数（按那一项自己的单位）：配重片每格 / 最轻一格、馆档案一档、自定义片（最重一格按 loadCapD） */
export const RIG_NUM_MAX = 100;
export const GYM_INC_MAX = 50;
export const PLATE_MAX = 100;
export const SHORT_BAR_MAX: Record<Unit, number> = { kg: 30, lbs: 65 };

/** 这一组重量能到多重（显示单位）；带正负的下限是它的相反数 */
export function loadCapD(unit: Unit, signed: boolean): number {
  return (signed ? SIGNED_CAP : LOAD_CAP)[unit];
}

/** 写入一组重量前按显示单位夹：普通 [0, 上限]，带正负 [−上限, 上限] */
export function clampLoadD(v: number, unit: Unit, signed: boolean): number {
  const cap = loadCapD(unit, signed);
  return Math.min(cap, Math.max(signed ? -cap : 0, v));
}

export function bodyweightRangeD(unit: Unit): [number, number] {
  return BODYWEIGHT_RANGE[unit];
}

export function clampBodyweightD(v: number, unit: Unit): number {
  const [lo, hi] = BODYWEIGHT_RANGE[unit];
  return Math.min(hi, Math.max(lo, v));
}

/**
 * 一组的容量（kg×次）：辅助的那部分不是你举起来的，不算；负重照算。
 * 普通动作（weight 恒为非负、没有号）跟原来一样。
 */
export function setVolumeKg(s: SetLog, ex?: Exercise | null): number {
  let v = Math.max(0, signedKg(s, ex)) * (Number(s.reps) || 0);
  for (const sub of (s.subSets ?? []) as SubSetLog[]) {
    v += Math.max(0, signedKg(sub, ex, s)) * (Number(sub.reps) || 0);
  }
  return v;
}
