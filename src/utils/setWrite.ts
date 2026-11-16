/**
 * 把显示的重量写回一组：组行（SetCapsule）、底栏操作条（SetActionStrip）、大图拖动（ExerciseCard）共用一份，
 * 显示 ⇄ 存储的口径和 touched 的键表只在这里改。
 */
import type { SetLog } from '../../types';
import { KG_TO_LBS } from '../constants';
import type { ExRounder } from '../hooks/useLoadRounder';
import { parseWeight } from './format';
import { trimNum } from './liftDisplay';
import { clampLoadD } from './load';

/** 一组的重量按显示单位写：两位小数、去尾零（体重用的是 format.formatBodyWeight，一位小数） */
export function formatLoad(kg: number, targetUnit: string): string {
  const v = targetUnit === 'lbs' ? kg * KG_TO_LBS : kg;
  return v.toFixed(2).replace(/\.?0+$/, '');
}

/**
 * 换算预览（2026-11-16 用户定）：卡按器械单位写（useLoadRounder.cardUnitOf）、顶栏选的是另一种单位时，
 * 重量下面的小字「= 110.2 lb」。一位小数——只是给人看个大概，卡上的数和加减仍按器械单位。同单位 / 没填重量＝''。
 */
export function altLoadLabel(kg: number, cardUnit: string, shownUnit: string): string {
  if (cardUnit === shownUnit || !(kg > 0)) return '';
  return `= ${trimNum(shownUnit === 'lbs' ? kg * KG_TO_LBS : kg)} ${shownUnit === 'lbs' ? 'lb' : 'kg'}`;
}

/** 存储（kg，非负）→ 显示单位下的带符号数 */
export const shownWeight = (kg: number, sign: -1 | 1, unit: string): number =>
  sign * Number(formatLoad(Number(kg) || 0, unit));

/**
 * 显示单位下的带符号数 → 写回一组的字段。写入前按显示单位夹在重量上限内（多按一个 0 就是一条假纪录）；
 * 有取整器的存格子的精确 kg（显示的两位小数换回去会差一点，见 ExRounder.kgOfD）。
 * 同时记下这一组挂的是哪种片：有馆档案的器材按这个馆的片子（审查 A8），纯数字的动作按显示单位。
 */
export function weightFromShown(
  raw: number,
  unit: string,
  rounder: ExRounder | null | undefined,
  signed: boolean,
): Pick<SetLog, 'weight' | 'plateUnit' | 'bodyweightMode'> {
  const du = unit === 'lbs' ? 'lbs' : 'kg';
  const v = clampLoadD(raw, du, signed);
  const weight = rounder ? Math.abs(rounder.kgOfD(v)) : parseWeight(Math.abs(v), du);
  const plateUnit: SetLog['plateUnit'] = rounder ? rounder.unit : du;
  if (!signed) return { weight, plateUnit };
  return { weight, plateUnit, bodyweightMode: v < 0 ? 'assisted' : v > 0 ? 'weighted' : 'normal' };
}

/**
 * 值字段。待做组上改了其中任何一个，就记进 touched ——
 * 改值只改值，不顺手描实（第 4 条）；touched 只管「不再被前面的组带着跟随」和格子墨色。
 */
const VALUE_KEYS: (keyof SetLog)[] = [
  'weight', 'reps', 'duration', 'score', 'time', 'timeUnit',
  'distance', 'distanceUnit', 'bodyweightMode', 'subSets',
];

/** 待做组：把这次改到的值字段记进 touched；做完的组原样返回 */
export function markTouched<U extends Partial<SetLog>>(set: SetLog, updates: U): U {
  if (!set.ghost) return updates;
  const keys = VALUE_KEYS.filter(k => k in updates);
  if (!keys.length) return updates;
  const touched = { ...(set.touched || {}) };
  for (const k of keys) touched[k] = true;
  return { ...updates, touched };
}
