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

/** 显示用：带号的数（按显示单位），自重 0 显示「自重」 */
export function formatSignedLoad(kgSigned: number, unit: string, isCn: boolean): string {
  const v = unit === 'lbs' ? kgSigned * 2.20462 : kgSigned;
  const r = Math.round(v * 10) / 10;
  if (r === 0) return isCn ? '自重' : 'BW';
  const abs = String(Math.abs(r));
  return `${r > 0 ? '+' : '−'}${abs} ${unit === 'lbs' ? 'lbs' : 'kg'}`;
}
