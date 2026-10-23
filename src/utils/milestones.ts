/**
 * 上片里程碑（「杠铃片」阶段二，2026-10-22）：杠铃动作每边第一次挂上 N 片「蓝」的那一天。
 *
 * 蓝片 = 20 kg / 45 lb（比赛片的 20 级）。按磅算正好是举铁圈子常说的
 * 135 / 225 / 315 / 405 四道关；按公斤是 60 / 100 / 140 / 180。
 * 判定只看重量够不够（杆 + 两边各 N 片蓝），不管当天实际挂的是红片还是零片——
 * 「第一次推到两片蓝的重量」才是里程碑的意思。
 */
import type { LiftSummary } from './liftHistory';
import { barWeight, convert, type PlateUnit } from './plates';

export interface Milestone {
  /** 每边几片蓝 */
  blues: number;
  ts: number;
}

export const BLUE: Record<PlateUnit, number> = { kg: 20, lbs: 45 };

/** 这个动作达到过的所有里程碑，旧 → 新。只看每场最重的一组。 */
export function blueMilestones(lift: LiftSummary, unit: PlateUnit): Milestone[] {
  const bar = barWeight(undefined, unit); // 标准杠 20 kg / 45 lb
  const out: Milestone[] = [];
  let reached = 0;
  for (const s of lift.sessions) {
    const kg = s.top?.kg;
    if (!(kg && kg > 0)) continue;
    const total = convert(kg, 'kg', unit);
    // 容差 0.1：kg 存储换成磅会有 0.0x 的尾巴（225 lb = 102.058 kg）
    const n = Math.floor((total - bar + 0.1) / (2 * BLUE[unit]));
    for (let b = reached + 1; b <= n; b++) out.push({ blues: b, ts: s.ts });
    if (n > reached) reached = n;
  }
  return out;
}
