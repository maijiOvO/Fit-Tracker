/**
 * 小号配片：一侧从里到外的片子，片高按真实直径比例（「杠铃片」阶段二，2026-10-22）。
 *
 * 用在训练页以外「说重量」的地方：计划卡的目标重量、「我的」里的上片里程碑。
 * 训练页组行里试过同样的迷你配片，用户觉得多余删了（design-plates §3）—— 所以只放在
 * 「去之前想好挂什么」和「回顾成就」这两处，不回到组行。
 */
import React from 'react';
import { PLATE_SPECS, DEFAULT_PLATES, loadBarbell, convert, type PlateUnit, type PlateToken } from '../utils/plates';

const specOf = (w: number, unit: PlateUnit) => PLATE_SPECS[unit].find(p => Math.abs(p.w - w) < 1e-6);

/**
 * 目标总重（kg 存）→ 当前单位下每边挂哪几片。按没设档案的馆的默认片库配（计划不绑馆）。
 * bar：杠铃算杆重；挂片器械传 0（只算片子）。
 * 凑不整（计划常是另一种单位换算来的：80 kg = 176.4 lb）就画不超过目标的最接近配法，
 * approx 给出那个配法的总重（同训练页大图「图上是最接近的配法」）。比杆还轻 / 一片都挂不上返回 null。
 */
export function planSide(
  totalKg: number,
  unit: PlateUnit,
  bar: number,
): { perSide: number[]; approx: number | null } | null {
  if (!(totalKg > 0)) return null;
  const total = convert(totalKg, 'kg', unit);
  const disabled = PLATE_SPECS[unit].map(p => p.w).filter(w => !DEFAULT_PLATES[unit].includes(w));
  const L = loadBarbell(total, unit, bar, disabled);
  if (L.underBar || !L.perSide.length) return null;
  const loaded = bar + 2 * L.perSide.reduce((a, b) => a + b, 0);
  return { perSide: L.perSide, approx: L.remainder > 0.05 ? Math.round(loaded * 100) / 100 : null };
}

const TOKEN_CN: Record<PlateToken, string> = { red: '红', blue: '蓝', yellow: '黄', green: '绿', white: '白', chrome: '铬' };
const TOKEN_EN: Record<PlateToken, string> = { red: 'red', blue: 'blue', yellow: 'yellow', green: 'green', white: 'white', chrome: 'chrome' };

/** 「一片红 25 + 一片白 5」：同重量的合并成「两片蓝 20」 */
export function plateWords(perSide: number[], unit: PlateUnit, isCn: boolean): string {
  const groups: { w: number; n: number }[] = [];
  for (const w of perSide) {
    const g = groups.find(x => x.w === w);
    if (g) g.n++;
    else groups.push({ w, n: 1 });
  }
  const num = ['', '一', '两', '三', '四', '五', '六'];
  return groups
    .map(({ w, n }) => {
      const tok = specOf(w, unit)?.token ?? 'chrome';
      return isCn ? `${num[n] ?? n}片${TOKEN_CN[tok]} ${w}` : `${n} × ${w} ${TOKEN_EN[tok]}`;
    })
    .join(' + ');
}

export const MiniPlates: React.FC<{ perSide: number[]; unit: PlateUnit }> = ({ perSide, unit }) => (
  <span className="mini-plates" aria-hidden>
    <span className="mini-rod" />
    {perSide.map((w, i) => {
      const s = specOf(w, unit);
      return (
        <i
          key={i}
          className={`plate-${s?.token ?? 'chrome'}`}
          style={{ height: `${Math.max(5, Math.round(((s?.dia ?? 160) / 450) * 16))}px` }}
        />
      );
    })}
  </span>
);
