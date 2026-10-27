import type { ExRounder } from '../hooks/useLoadRounder';

/**
 * 选中组操作条（−/+ 一档、递减一档）的纯计算。都在【显示单位、带符号】的数上做：
 * 辅助为负、自重 0、负重为正，所以带正负的负荷能从 −5 走到 0 再走到 +5。
 * 组行（SetCapsule 长按组号 / 「再加一档」）和底栏上方的操作条（SetActionStrip）共用这一份。
 */

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * − / + 一档：有馆档案的器材走这个馆这件器材的一档（第一下先吸到那个方向最近能挂的）；
 * 纯数字的动作走首选项的步长（默认 5），换算残留不取整。普通重量下限 0，带正负的负荷可以跨过 0。
 */
export function bumpShown(shown: number, dir: 1 | -1, rounder: ExRounder | null | undefined, weightStep: number, signed: boolean): number {
  const next = rounder ? rounder.stepToD(shown, dir) : round2(shown + dir * weightStep);
  return signed ? next : Math.max(0, next);
}

/**
 * 键上写的步长，按方向各算：带正负的在 0 上往下走的是辅助一档、往上走的是最小一片，两边不一样。
 * 不在格子上（换算残留）时写这件器材的一档，不写「离格子还差多少」。
 */
export function stepShown(shown: number, dir: 1 | -1, rounder: ExRounder | null | undefined, weightStep: number): number {
  if (!rounder) return weightStep;
  const moved = Math.abs(rounder.stepToD(shown, dir) - shown);
  return round2(rounder.loadableD(shown) && moved > 0 ? moved : rounder.stepD(shown) || weightStep);
}

/**
 * 加一档子组（递减 dir = −1 / 递增 dir = 1）的重量，从【上一行】（最后一档，没有就是母组）走一档：
 * 有馆档案的器材 ∓ 一档再吸到最近能挂的（片子不规则时按能挂的下一个走）；已经是最轻一档的不降到 0，和上一档一样。
 * 纯数字的动作 ∓「递减每档」（首选项，默认 5），上一行是换算残留（132.28）先取整再走。
 */
export function nextDropShown(prevShown: number, dir: 1 | -1, rounder: ExRounder | null | undefined, dropStep: number, signed: boolean): number {
  let next: number;
  if (rounder) {
    next = rounder.snapD(prevShown + dir * rounder.stepD(prevShown));
    // 吸回了原处（空杠再往下、片子太粗）：按「能挂的下一个」走
    if (Math.abs(next - prevShown) < 0.01) next = rounder.stepToD(prevShown, dir);
    // 已经是最轻的一档（哑铃最小那对、空杠）：不降到 0，和上一档一样，自己再改
    if (!signed && next <= 0 && prevShown > 0) next = prevShown;
  } else {
    const residue = Math.abs(prevShown * 2 - Math.round(prevShown * 2)) > 1e-6;
    const base = residue ? (dir < 0 ? Math.floor(prevShown) : Math.ceil(prevShown)) : prevShown;
    next = base + dir * dropStep;
  }
  return signed ? next : Math.max(0, next);
}
