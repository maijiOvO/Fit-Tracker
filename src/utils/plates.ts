/**
 * 杠铃片配片（视觉方向「杠铃片」，docs/design-plates.md §3）。
 *
 * 全 App 只有片子能用彩色：颜色 = 你等会儿要往杆上挂的那一片。
 * 配色取国际举联比赛片（kg）与常见磅制彩色片（lbs），按「档位」对应同一组令牌，
 * 这样切单位时颜色的意思不变：最重那档永远是红、次重是蓝……
 *
 * 全部是纯函数，重量一律用「显示单位」下的数（调用方先按 unit 换算好）。
 */

export type PlateUnit = 'kg' | 'lbs';

/** 每一档片子：重量、颜色令牌、相对厚度（大片同直径，靠厚度和印字区分）、相对高度 */
export interface PlateSpec {
  w: number;
  token: PlateToken;
  /** 厚度系数，1 = 最重那档 */
  t: number;
  /** 高度系数，1 = 大片直径。大片（同直径）都是 1，小片按比例矮 */
  h: number;
  /** 浅色片（白 / 镀铬）上的字要用深色 */
  light?: boolean;
}

export type PlateToken = 'red' | 'blue' | 'yellow' | 'green' | 'white' | 'chrome';

export const PLATE_SPECS: Record<PlateUnit, PlateSpec[]> = {
  kg: [
    { w: 25, token: 'red', t: 1, h: 1 },
    { w: 20, token: 'blue', t: 0.82, h: 1 },
    { w: 15, token: 'yellow', t: 0.68, h: 1 },
    { w: 10, token: 'green', t: 0.55, h: 1 },
    { w: 5, token: 'white', t: 0.45, h: 0.68, light: true },
    { w: 2.5, token: 'red', t: 0.34, h: 0.52 },
    { w: 1.25, token: 'chrome', t: 0.28, h: 0.42, light: true },
  ],
  lbs: [
    { w: 55, token: 'red', t: 1, h: 1 },
    { w: 45, token: 'blue', t: 0.82, h: 1 },
    { w: 35, token: 'yellow', t: 0.68, h: 1 },
    { w: 25, token: 'green', t: 0.55, h: 1 },
    { w: 10, token: 'white', t: 0.45, h: 0.68, light: true },
    { w: 5, token: 'chrome', t: 0.34, h: 0.52, light: true },
    { w: 2.5, token: 'chrome', t: 0.28, h: 0.42, light: true },
  ],
};

export const DEFAULT_BAR: Record<PlateUnit, number> = { kg: 20, lbs: 45 };
export const BAR_OPTIONS: Record<PlateUnit, readonly number[]> = { kg: [20, 15, 10], lbs: [45, 35, 25] };

/** 杠铃拖动一格：最小一对片的总重（kg 2.5、lbs 5，2026-10-18 用户定） */
export const BARBELL_STEP: Record<PlateUnit, number> = { kg: 2.5, lbs: 5 };

export function plateSpec(unit: PlateUnit, w: number): PlateSpec | undefined {
  return PLATE_SPECS[unit].find((p) => p.w === w);
}

export interface Loadout {
  /** 每边从里到外挂的片 */
  perSide: number[];
  /** 每边还差多少配不出来（片库里没有更小的片）；0 = 刚好 */
  remainder: number;
  /** 比空杆还轻 */
  underBar: boolean;
}

const EPS = 1e-6;
const round = (n: number) => Math.round(n * 1000) / 1000;

/**
 * 贪心配片：从最重的开始挂，每种片不限数量。
 * 标准片组（每档是下一档的倍数或差一档能补上）下贪心就是最优解，不需要背包。
 *
 * @param disabled 片库里停用的片重（如健身房没有 1.25 的小片）
 */
export function loadSide(side: number, unit: PlateUnit, disabled: readonly number[] = []): Omit<Loadout, 'underBar'> {
  let r = round(side);
  const perSide: number[] = [];
  for (const p of PLATE_SPECS[unit]) {
    if (disabled.includes(p.w)) continue;
    while (r >= p.w - EPS) {
      perSide.push(p.w);
      r = round(r - p.w);
    }
  }
  return { perSide, remainder: r < EPS ? 0 : r };
}

export function loadBarbell(
  total: number,
  unit: PlateUnit,
  bar: number = DEFAULT_BAR[unit],
  disabled: readonly number[] = [],
): Loadout {
  if (!(total > 0)) return { perSide: [], remainder: 0, underBar: false };
  const side = (total - bar) / 2;
  if (side < -EPS) return { perSide: [], remainder: 0, underBar: true };
  return { ...loadSide(Math.max(0, side), unit, disabled), underBar: false };
}

/** 「每边 20 + 1.25」这种说明文字 */
export function describeSide(perSide: readonly number[]): string {
  return perSide.map((w) => String(w)).join(' + ');
}
