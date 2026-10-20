/**
 * 杠铃片配片（视觉方向「杠铃片」，docs/design-plates.md §3）。
 *
 * 全 App 只有片子能用彩色：颜色 = 你等会儿要往杆上挂的那一片。
 * 配色取国际举联比赛片（kg）与常见磅制彩色片（lbs），按「档位」对应同一组令牌：
 * 最重那档永远是红、次重是蓝……
 *
 * 单位（2026-10-18 用户定）：**片子按登记那一组时用的单位算**，不跟显示单位走。
 * 用 45 lb 片登记的组，切到 kg 显示时那片还是 45 lb 那片，只是标成它的公斤数（20.4）。
 * 每组记 SetLog.plateUnit；老数据没记的，看重量更像整磅数还是整公斤数（plateUnitOf）。
 *
 * 尺寸（mm）用来按真实比例画：杆长、握把段、套筒按 IWF 标准杆；片子直径按包胶片
 * （10 kg 以上同为 450 mm），厚度取常见训练包胶片的大致值 —— 不同品牌差十几毫米，只求比例像。
 */

export type PlateUnit = 'kg' | 'lbs';
export const KG_PER_LB = 0.45359237;

export type PlateToken = 'red' | 'blue' | 'yellow' | 'green' | 'white' | 'chrome';

export interface PlateSpec {
  /** 片子自己的标称重量（它所在单位下） */
  w: number;
  token: PlateToken;
  /** 厚度 mm */
  thick: number;
  /** 直径 mm */
  dia: number;
}

export const PLATE_SPECS: Record<PlateUnit, PlateSpec[]> = {
  kg: [
    { w: 25, token: 'red', thick: 60, dia: 450 },
    { w: 20, token: 'blue', thick: 52, dia: 450 },
    { w: 15, token: 'yellow', thick: 42, dia: 450 },
    { w: 10, token: 'green', thick: 32, dia: 450 },
    { w: 5, token: 'white', thick: 24, dia: 230 },
    { w: 2.5, token: 'red', thick: 18, dia: 190 },
    { w: 1.25, token: 'chrome', thick: 13, dia: 160 },
  ],
  lbs: [
    { w: 55, token: 'red', thick: 62, dia: 450 },
    { w: 45, token: 'blue', thick: 52, dia: 450 },
    { w: 35, token: 'yellow', thick: 42, dia: 450 },
    { w: 25, token: 'green', thick: 32, dia: 450 },
    { w: 10, token: 'white', thick: 24, dia: 230 },
    { w: 5, token: 'chrome', thick: 18, dia: 190 },
    { w: 2.5, token: 'chrome', thick: 13, dia: 160 },
  ],
};

export function plateSpec(unit: PlateUnit, w: number): PlateSpec | undefined {
  return PLATE_SPECS[unit].find((p) => p.w === w);
}

/* ── 杠子 ─────────────────────────────────────────────────────── */

export type BarKind = 'standard' | 'women' | 'short';

/** 存在动作定义上（每个动作记住自己的杠，2026-10-18 用户定） */
export interface BarChoice {
  kind: BarKind;
  /** 短杠的重量（各家不一样，自己填）；标准 / 女子杠不用填 */
  weight?: number;
  unit?: PlateUnit;
}

export interface BarGeometry {
  /** 全长 mm */
  length: number;
  /** 两个内挡之间（握把段）mm */
  shaft: number;
  /** 套筒（能挂片的那段）mm */
  sleeve: number;
  /** 握把直径 / 套筒直径 mm */
  shaftDia: number;
  sleeveDia: number;
}

/** IWF 男子杠 2200 / 女子杠 2010；短杠各家不一，这里取常见 1500 mm 训练杠的大致尺寸 */
export const BAR_GEOMETRY: Record<BarKind, BarGeometry> = {
  standard: { length: 2200, shaft: 1310, sleeve: 415, shaftDia: 28, sleeveDia: 50 },
  women: { length: 2010, shaft: 1310, sleeve: 320, shaftDia: 25, sleeveDia: 50 },
  short: { length: 1500, shaft: 1000, sleeve: 220, shaftDia: 28, sleeveDia: 50 },
};

export const BAR_LABEL: Record<BarKind, { cn: string; en: string }> = {
  standard: { cn: '标准杠', en: 'Standard bar' },
  women: { cn: '女子杠', en: "Women's bar" },
  short: { cn: '短杠', en: 'Short bar' },
};

const BAR_WEIGHT: Record<Exclude<BarKind, 'short'>, Record<PlateUnit, number>> = {
  standard: { kg: 20, lbs: 45 },
  women: { kg: 15, lbs: 35 },
};
export const SHORT_BAR_DEFAULT: Record<PlateUnit, number> = { kg: 10, lbs: 25 };

/** 这根杠在 plateUnit 下多重 */
export function barWeight(bar: BarChoice | undefined, plateUnit: PlateUnit): number {
  const kind = bar?.kind ?? 'standard';
  if (kind !== 'short') return BAR_WEIGHT[kind][plateUnit];
  const w = bar?.weight ?? SHORT_BAR_DEFAULT[bar?.unit ?? plateUnit];
  const u = bar?.unit ?? plateUnit;
  return convert(w, u, plateUnit);
}

/* ── 单位 ─────────────────────────────────────────────────────── */

export function convert(v: number, from: PlateUnit, to: PlateUnit): number {
  if (from === to) return v;
  return from === 'kg' ? v / KG_PER_LB : v * KG_PER_LB;
}

const near = (v: number, step: number, tol: number) => Math.abs(v / step - Math.round(v / step)) * step < tol;

/**
 * 这一组挂的是哪种片：登记时记下的优先；老数据看存下来的公斤数「整不整」——
 * 存储一律是 kg：kg 下打的数（93、62.5）本来就落在 0.25 kg 网格上，lbs 下打的数是换算出来的
 * 长小数（135 lb = 61.2349… kg）。所以先看公斤数整不整，整就是公斤片；不整、而换成磅落在 2.5 lb 网格上才是磅片。
 * （第一版反过来先看磅网格，93 kg 这类常见公斤数会被误判成磅片 —— 2026-10-18 审查扫出 19 个。）
 */
export function plateUnitOf(set: { weight?: number; plateUnit?: PlateUnit } | undefined, fallback: PlateUnit): PlateUnit {
  if (set?.plateUnit === 'kg' || set?.plateUnit === 'lbs') return set.plateUnit;
  const kg = Number(set?.weight) || 0;
  if (kg <= 0) return fallback;
  if (near(kg, 0.25, 0.004)) return 'kg';
  if (near(kg / KG_PER_LB, 2.5, 0.06)) return 'lbs';
  return fallback;
}

/* ── 配片 ─────────────────────────────────────────────────────── */

export interface Loadout {
  /** 每边从里到外挂的片（片子自己的单位） */
  perSide: number[];
  /** 每边还差多少配不出来（片子单位）；0 = 刚好 */
  remainder: number;
  /** 比空杆还轻 */
  underBar: boolean;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * 贪心配片：从最重的开始挂，每种片不限数量。标准片组下贪心就是最优解。
 * 容差 0.05：公斤换磅（或反过来）带出来的浮点尾巴不算「配不出」。
 */
export function loadSide(side: number, unit: PlateUnit, disabled: readonly number[] = []): Omit<Loadout, 'underBar'> {
  const TOL = 0.05;
  let r = round3(side);
  const perSide: number[] = [];
  for (const p of PLATE_SPECS[unit]) {
    if (disabled.includes(p.w)) continue;
    while (r >= p.w - TOL) {
      perSide.push(p.w);
      r = round3(r - p.w);
    }
  }
  return { perSide, remainder: r < TOL ? 0 : r };
}

/** total、bar 都是 plateUnit 下的数 */
export function loadBarbell(total: number, unit: PlateUnit, bar: number, disabled: readonly number[] = []): Loadout {
  if (!(total > 0)) return { perSide: [], remainder: 0, underBar: false };
  const side = (total - bar) / 2;
  if (side < -0.05) return { perSide: [], remainder: 0, underBar: true };
  return { ...loadSide(Math.max(0, side), unit, disabled), underBar: false };
}

/**
 * 片子 / 杠重在显示单位下怎么标：同单位最多两位小数（1.25 要两位；10 kg 短杠换成磅是 22.05），
 * 换单位一位小数（45 lb → 20.4）。
 */
export function plateLabel(w: number, plateUnit: PlateUnit, display: PlateUnit): string {
  const v = convert(w, plateUnit, display);
  const k = plateUnit === display ? 100 : 10;
  return (Math.round(v * k) / k).toString();
}
