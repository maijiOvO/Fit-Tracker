/**
 * 把显示的重量写回一组：组行（SetCapsule）、底栏操作条（SetActionStrip）、大图拖动（ExerciseCard）共用一份，
 * 显示 ⇄ 存储的口径和 touched 的键表只在这里改。
 */
import type { SetLog } from '../../types';
import { KG_TO_LBS } from '../constants';
import type { ExRounder } from '../hooks/useLoadRounder';
import { parseTypedNum, parseWeight } from './format';
import { trimNum } from './liftDisplay';
import { clampLoadD, fromSignedKg } from './load';
import { isTouchKey } from './setValues';

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
  // 不带正负的卡写的是普通重量：清掉从底稿抄来的旧辅助号，不然纪录一直按 0 比（审查 gap-2#5）
  if (!signed) return { weight, plateUnit, bodyweightMode: undefined };
  return { weight, plateUnit, bodyweightMode: v < 0 ? 'assisted' : v > 0 ? 'weighted' : 'normal' };
}

/**
 * 「改回上次」的默认值（带符号 kg）：上次（或计划）的重量按今天的馆取整。这一组现在的重量和它、和上次的原数
 * 都不一样才给，否则 undefined —— 换算的零头、切过单位后没取整的同一个重量（60 kg 显示成 132.28 lb）不算改过。
 * 组行的「上次 x」小字和卡片左下角的「改回上次」共用这一份。
 */
export function restoreKgOf(set: SetLog, sign: -1 | 1, unit: string, snapKg?: (kg: number) => number): number | undefined {
  const ref = set.prefillRef;
  if (!ref || !(Math.abs(ref.kg) > 0)) return undefined;
  const defKg = snapKg ? snapKg(ref.kg) : ref.kg;
  const curD = shownWeight(Number(set.weight) || 0, sign, unit);
  const offBy = (kg: number) => Math.abs(shownWeight(Math.abs(kg), kg < 0 ? -1 : 1, unit) - curD) >= 0.01;
  return offBy(defKg) && offBy(ref.kg) ? defKg : undefined;
}

/** 把一组的重量改回 kg（restoreKgOf 给的）：顺手撤掉「改过重量」，格子回到底稿的墨色 */
export function restoreUpdate(set: SetLog, kg: number, signed: boolean): Partial<SetLog> {
  const w = signed ? fromSignedKg(kg) : { weight: Math.abs(kg), bodyweightMode: undefined };
  if (!set.touched?.weight) return w;
  const { weight: _w, bodyweightMode: _b, ...touched } = set.touched;
  return { ...w, touched };
}

/**
 * 重量格打字的一键（组行和递减档共用）。sign 是聚焦那一刻这一组的号（调用方记下，上架审查 C37）：
 * 原来每一键按「当前」的号乘 —— 清空那一下组变成 0、号变成 normal，下一键改按上一组 / 默认的号补，辅助 20 改 25 存成负重 25。
 * 打正数乘 sign，打负数就是辅助；空串算 0；打到一半不是完整的数（'-'、'1.2.3'）返回 null，这一键不写。上限照旧由 weightFromShown 夹。
 */
export function typedWeight(
  text: string,
  sign: -1 | 1,
  unit: string,
  rounder: ExRounder | null | undefined,
  signed: boolean,
): Pick<SetLog, 'weight' | 'plateUnit' | 'bodyweightMode'> | null {
  const n = text.trim() === '' ? 0 : parseTypedNum(text);
  if (n === null) return null;
  const v = signed && n >= 0 ? n * sign : n;
  return weightFromShown(signed ? v : Math.max(0, v), unit, rounder, signed);
}

/**
 * 指针下面的组：把这次改到的值字段记进 touched；指针上面的组原样返回。
 * 键表在 setValues.isTouchKey（含速度和自定义记录项）。touched 管格子墨色、递减档「手改过就不跟母组」（workbench.shiftSubs），
 * 也是「这一行动过没有」（setValues.rowEdited）的依据：换做法、换馆重铺时动过的行保留。
 */
export function markTouched<U extends Partial<SetLog>>(set: SetLog, updates: U): U {
  if (!set.ghost) return updates;
  const keys = Object.keys(updates).filter(isTouchKey);
  if (!keys.length) return updates;
  const touched = { ...(set.touched || {}) };
  for (const k of keys) touched[k] = true;
  return { ...updates, touched };
}
