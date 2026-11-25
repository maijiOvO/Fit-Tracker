/**
 * 「能挂的重量」与就近取整 —— docs/design-plates.md §3「馆档案」。
 *
 * 三条规则（2026-10-18 用户定，示意：docs/demos/gym-workbench.html）：
 *   1. 片子按这个馆的单位算（2026-10-22 起；原来按显示单位，显示 lb 的 kg 馆会按磅片取整，审查 A9）：
 *      格子都在馆的片子单位下，显示单位只是换算着标（useLoadRounder 负责换算）。
 *   2. 自动生成的重量（底稿、带动后面、递减默认、切单位 / 换馆）严格取最近能挂的重量，等距取轻。
 *      手打的数照原样记。例外：同馆同片、不是计划来的底稿原样抄上一次的数（2026-11-24 作者定，useLoadRounder.keepOf），
 *      这张卡在本馆换过台 / 刻度之后照旧取整。
 *   3. 一档 = 这个馆、这件器材的一档（馆档案）；个别器械存成一台（Rig，卡片大图上方的药丸）。
 *
 * 全部是纯函数：值一律是「ctx.unit（馆的片子单位）下带符号的数」，调用方负责换算。
 */
import type { LoadKind } from '../hooks/useLoadKind';
import { DEFAULT_PLATES, convert, type PlateUnit } from './plates';
import { EQ_CABLE, EQ_MACHINE } from './exerciseAttrs';

export interface IncSpec {
  v: number;
  u: PlateUnit;
  /**
   * 配重片的起始（最轻一格，和 v 同单位）：有的龙门架从 12.5 lb 起、每格 +5，能插的是 12.5 / 17.5 / 22.5…
   * 没有或 0＝从 0 起（一档的整数倍）。只对配重片（插销）生效（2026-10-20 用户定）。
   */
  s?: number;
  /**
   * 配重片的最重一格（和 v 同单位，2026-11-13 用户定）：拖动和 ± 到它为止，自动取整吸到它。没有＝不设限。
   * 只存在存下来的台（Rig）上：馆档案的默认那一格不带它，在默认上设＝另存一台。
   */
  e?: number;
  /**
   * 配重片的加片（和 v 同单位，2026-11-18 用户定）：插销之外另挂在摞子上的小片，一块写一项（两块 2.5 写 [2.5, 2.5]）。
   * 能到的重量＝插销的格子 + 任选几块加片。只存在存下来的形式（Rig）上，同 e。
   */
  a?: number[];
  /**
   * 换单位之前那份（只带 v / u / s / e / a，上架审查 C48）：换算是吸到最近的档位，单向的，换过去再换回来回不到原值；
   * 切回原单位、中间又没改过时原样还原它（rigInUnit / withPlateUnit）。数据进来那层（appPrefs cleanRigs / cleanGyms）校验它。
   */
  was?: IncSpec;
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
  /** 固定杠铃（成品杠）一档（2026-10-21 加）：旧档案没有这一项，按默认 */
  fixedBar?: IncSpec;
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

/** 固定杠铃常见 10 / 12.5 / 15… kg 一档 2.5；磅的多是 5 lb 一档 */
export const DEFAULT_FIXED_BAR_INC: Record<PlateUnit, IncSpec> = {
  kg: { v: 2.5, u: 'kg' },
  lbs: { v: 5, u: 'lbs' },
};

/**
 * 馆里存的一种刻度（存 AppPrefs.gymRigs，键见 rigListKey）；每个动作记住自己用的哪一种（gymRigPick[馆|动作|做法]）。
 * 配重片的叫「形式」，全馆一份（2026-11-18 用户定）：最轻 5 每格 5、最轻 2.5 每格 5……凡是插销负载的动作，
 * 不分龙门架还是固定器械，选一种就能用。哑铃 / 壶铃 / 固定杠铃是「一台」，按器材共用。
 * n：起的名字，不写就拿刻度当名字。
 */
export interface Rig extends IncSpec {
  id: string;
  n?: string;
}

/** 「每格 / 最轻一格」下方常驻的预设（kg / lb 同一排）：点一下填进去，横划也只在这几格里跳；别的数手打 */
export const RIG_STEPS = [1, 2.5, 5, 10, 15, 20];

export const newRigId = () => `r${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;

/** 能存成「一台」的画法：一档就是器械自己的器材（配重片 / 哑铃 / 壶铃 / 固定杠铃），有自己的单位 */
export function rigKind(kind: LoadKind): kind is 'pin' | 'pair' | 'bell' | 'fixed' {
  return kind === 'pin' || kind === 'pair' || kind === 'bell' || kind === 'fixed';
}

type RigInfo = { kind: LoadKind; equipment?: string };

/** 这件器材在这个馆共用的那份列表：馆|器材（没填器材的按画法分） */
function sharedRigKey(gym: string, info: RigInfo): string {
  return `${gym}|${info.equipment || `~${info.kind}`}`;
}

/**
 * 列表的键。配重片的形式全馆一份：馆|~stack（2026-11-18；原来龙门架按「馆|器材」共用、固定器械按「馆|器材|动作」各存各的，
 * 新动作总要重新建，见 legacyStackKeys）。哑铃、壶铃、固定杠铃按器材共用：馆|器材。
 * 例外：固定器械上挂哑铃 / 壶铃 / 固定杠铃存在「馆|tagMachine~画法」—— 「馆|tagMachine」是 11-18 前配重片的旧键，
 * 存在那里会被当成配重片形式折进配重片、存一次配重片就被清掉（上架审查 gap-3#2）。
 */
export function rigListKey(gym: string | undefined, info: RigInfo): string | null {
  if (!gym || !rigKind(info.kind)) return null;
  if (info.kind === 'pin') return `${gym}|~stack`;
  return info.equipment === EQ_MACHINE ? `${gym}|${EQ_MACHINE}~${info.kind}` : sharedRigKey(gym, info);
}

/**
 * 2026-11-18 之前配重片存过的那些键：馆|龙门架、馆|器械（11-13 前固定器械也共用）、馆|~pin、馆|器材|动作。
 * 自定义器材的「馆|器材」从键上认不出是不是配重片，不在这里（rigsOf 只接动作选着的那一台）。
 * 前提：馆名不含半角「|」（gymNameIssue 拦），否则「A」和「A|B」的键前缀分不开。
 */
function legacyStackKeys(all: Record<string, Rig[]>, gym: string): string[] {
  const pre = `${gym}|`;
  return Object.keys(all)
    .filter(k => {
      if (!k.startsWith(pre)) return false;
      const rest = k.slice(pre.length);
      return rest !== '~stack' && (rest === EQ_CABLE || rest === EQ_MACHINE || rest === '~pin' || rest.includes('|'));
    })
    .sort();
}

/**
 * 这个动作在这个馆能选的几种。配重片：全馆那一份，再把旧键里的折进来（按 id 去重）——读的时候折，不另跑迁移：
 * 两台设备各自升级、同步谁先谁后都得到同一份。第一次改动时整份写进新键、旧键清空（rigsPatch）。
 */
export function rigsOf(all: Record<string, Rig[]>, gym: string | undefined, info: RigInfo, pick: string | undefined): Rig[] {
  const key = rigListKey(gym, info);
  if (!key || !gym) return [];
  if (info.kind !== 'pin') return all[key] ?? [];
  const out = [...(all[key] ?? [])];
  const seen = new Set(out.map(r => r.id));
  const take = (list: Rig[] | undefined) => {
    for (const r of list ?? []) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      out.push(r);
    }
  };
  for (const k of legacyStackKeys(all, gym)) take(all[k]);
  if (pick && !seen.has(pick)) take(all[sharedRigKey(gym, info)]?.filter(r => r.id === pick));
  return out;
}

/**
 * 存这份列表的补丁（整张 gymRigs）。配重片：写进全馆那一份，旧键清成空数组 —— 不清的话删掉的形式下次读又从旧键折回来；
 * 空数组也是同步用的墓碑（另一台设备上的旧列表按键合并时被它压住）。
 */
export function rigsPatch(all: Record<string, Rig[]>, gym: string, info: RigInfo, list: Rig[]): Record<string, Rig[]> {
  const key = rigListKey(gym, info);
  if (!key) return all;
  const next = { ...all, [key]: list };
  if (info.kind === 'pin') for (const k of legacyStackKeys(all, gym)) next[k] = [];
  return next;
}

/** 药丸排上显示哪几枚：刻度一样又都没起名的只留一枚（旧键折进来时各动作各建过一份同样的），选中的那枚优先留 */
export function distinctRigs(list: Rig[], sel: string): Rig[] {
  const out: Rig[] = [];
  for (const r of list) {
    const at = r.n ? -1 : out.findIndex(k => !k.n && sameSpec(k, r));
    if (at < 0) out.push(r);
    else if (r.id === sel) out[at] = r;
  }
  return out;
}

/** 这个动作在这个馆实际用的刻度：选中的台 → 以前按动作单独设的（gymOverrides）→ undefined（馆默认）。选的台删了＝没选 */
export function machineSpecOf(rigs: Rig[] | undefined, pick: string | undefined, own: IncSpec | undefined): IncSpec | undefined {
  return (pick ? rigs?.find(r => r.id === pick) : undefined) ?? own;
}

export function sameSpec(a: IncSpec, b: IncSpec): boolean {
  const add = (x: IncSpec) => [...(x.a ?? [])].sort((p, q) => p - q).join(',');
  return a.u === b.u && Math.abs(a.v - b.v) < 1e-9 && Math.abs((a.s ?? 0) - (b.s ?? 0)) < 1e-9 && Math.abs((a.e ?? 0) - (b.e ?? 0)) < 1e-9 && add(a) === add(b);
}

/**
 * 关掉设置时收掉白加的台（审查 B5）：fresh 里（这次「＋」出来的）、没起名、和馆默认或排在前面的某台刻度一样的去掉，
 * 选着它的改指那一台（'' ＝馆默认）。配重片没设最轻一格＝从一档起，比较前按这个口径补上。
 */
export function dropTwins(list: Rig[], fresh: ReadonlySet<string>, def: IncSpec | null, pick: string, pin: boolean): { list: Rig[]; pick: string } {
  const norm = (x: IncSpec): IncSpec => (pin && !(x.s && x.s > 0) ? { ...x, s: x.v } : x);
  const kept: Rig[] = [];
  let sel = pick;
  for (const r of list) {
    const twin = !fresh.has(r.id) || r.n ? undefined
      : def && sameSpec(norm(r), norm(def)) ? ''
      : kept.find(k => sameSpec(norm(k), norm(r)))?.id;
    if (twin === undefined) kept.push(r);
    else if (sel === r.id) sel = twin;
  }
  return { list: kept, pick: sel };
}

/** 馆档案里这一类器材的一档（旧档案没有壶铃 / 固定杠铃，按默认） */
export function gymSpecOf(profile: GymProfile, kind: 'pin' | 'pair' | 'bell' | 'fixed', stack: 'cable' | 'machine'): IncSpec {
  return kind === 'pair' ? profile.dumbbell
    : kind === 'bell' ? profile.kettlebell ?? DEFAULT_KETTLEBELL_INC[profile.plateUnit]
    : kind === 'fixed' ? profile.fixedBar ?? DEFAULT_FIXED_BAR_INC[profile.plateUnit]
    : stack === 'cable' ? profile.cable : profile.machine;
}

/** 没设过档案的馆（或没标馆）：常用的标准片（DEFAULT_PLATES）+ 常见档位 */
export function defaultProfile(unit: PlateUnit): GymProfile {
  return unit === 'kg'
    ? { plateUnit: 'kg', plates: [...DEFAULT_PLATES.kg], cable: { v: 5, u: 'kg' }, machine: { v: 5, u: 'kg' }, dumbbell: { v: 2.5, u: 'kg' }, kettlebell: DEFAULT_KETTLEBELL_INC.kg, fixedBar: DEFAULT_FIXED_BAR_INC.kg }
    : { plateUnit: 'lbs', plates: [...DEFAULT_PLATES.lbs], cable: { v: 10, u: 'lbs' }, machine: { v: 10, u: 'lbs' }, dumbbell: { v: 5, u: 'lbs' }, kettlebell: DEFAULT_KETTLEBELL_INC.lbs, fixedBar: DEFAULT_FIXED_BAR_INC.lbs };
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

/** 最重一格换到当前单位，口径同 startIn；0＝没设 */
export function endIn(c: IncSpec | undefined, unit: PlateUnit): number {
  if (!c?.e || c.e <= 0) return 0;
  return Math.round(convert(c.e, c.u, unit) * 20) / 20;
}

/** 加片换到当前单位，口径同 startIn */
export function addonsIn(c: IncSpec | undefined, unit: PlateUnit): number[] {
  return (c?.a ?? []).filter(x => x > 0).map(x => Math.round(convert(x, c!.u, unit) * 20) / 20);
}

/** 加片最多几块（能凑出的组合是 2 的块数次方，bracket 每次都要扫一遍） */
export const ADDON_MAX = 4;
/** 加片每块最重多少（按这台自己的单位；馆档案的框和 appPrefs 的清洗共用，上架审查 gap-3#5） */
export const ADDON_EACH_MAX: Record<'kg' | 'lbs', number> = { kg: 50, lbs: 110 };

/** 几块加片能凑出的各种合计（含 0），从小到大、去重 */
export function addonSums(addons: readonly number[] | undefined): number[] {
  let sums = [0];
  for (const x of (addons ?? []).slice(0, ADDON_MAX)) sums = [...sums, ...sums.map(s => r2(s + x))];
  return [...new Set(sums)].sort((p, q) => p - q);
}

/**
 * 换一台的片子单位（2026-10-25 用户定：一台器械只有一种片）：每格取新单位里最近的档位；最轻一格单独设过的按实重换算，
 * 没设过（或等于一档）的跟新的一档走——5 kg 一档换成 lb 是 10 + 10，不是按实重换出来的 11 + 10（审查 B4）。
 * s / e / a / was 显式给 undefined：调用方拿它覆盖旧的那台。加片按实重换算。
 * 换算是单向的（吸到最近的档位）：换过去时把原来那份记进 was，切回原单位、中间没改过（还等于 was 换过来的样子）就原样还原（上架审查 C48）。
 */
export function rigInUnit(c: IncSpec, u: PlateUnit): IncSpec {
  const w = c.was;
  if (w && w.u === u && c.u !== u && sameSpec(c, rigConv(w, c.u))) return { v: w.v, u, s: w.s, e: w.e, a: w.a ? [...w.a] : undefined, was: undefined };
  return { ...rigConv(c, u), was: specOnly(c) };
}

function rigConv(c: IncSpec, u: PlateUnit): IncSpec {
  const s = c.s && Math.abs(c.s - c.v) > 1e-9 ? startIn(c, u) : 0;
  const e = endIn(c, u);
  // 换算后夹到新单位的上限：50 kg 换成 lb 是 110.25，超过 110 会被清洗层丢掉（上架审查 gap-3#5）
  const a = addonsIn(c, u).map(x => Math.min(x, ADDON_EACH_MAX[u]));
  return { v: incIn(c, u), u, s: s > 0 ? s : undefined, e: e > 0 ? e : undefined, a: a.length ? a : undefined };
}

/** 只留刻度字段（记进 was 用）：不能带 id / n —— 馆档案里的「存的形式」会把补丁铺到每一台刻度一样的上，带了 id 会撞号 */
function specOnly(c: IncSpec): IncSpec {
  return { v: c.v, u: c.u, ...(c.s ? { s: c.s } : {}), ...(c.e ? { e: c.e } : {}), ...(c.a?.length ? { a: [...c.a] } : {}) };
}

const INC_KEYS = ['cable', 'machine', 'dumbbell', 'kettlebell', 'fixedBar'] as const;

/**
 * 切这个馆的片子单位（档案表单顶上的「公斤片 ⇄ 磅片」，2026-11-03 用户定）：
 * 片子表重置为那种单位的标准片（自定义片一起清掉，design-plates.md「换馆重量」D）；
 * 各档里还跟着旧片子单位走的（单位 = 旧片子单位）一起换过去：没动过的用新单位的默认，改过的一档取 INC_CHOICES 里最近的、起始按实重换算；
 * 已经单独设成另一种单位的那一档（kg 馆里一台 lb 的龙门架）原样保留。旧档案缺的档不凭空补。
 * 改过的档换过去时记下原来那份（was），切回来、中间没改过就原样还原（口径同 rigInUnit，上架审查 C48）；默认档换默认档本来就往返恒等。
 */
export function withPlateUnit(p: GymProfile, unit: PlateUnit): GymProfile {
  if (p.plateUnit === unit) return p;
  const next: GymProfile = { ...p, plateUnit: unit, plates: [...DEFAULT_PLATES[unit]] };
  // 没动过的档（还是旧单位的默认，没设起始）直接用新单位的默认：4 kg 壶铃换成 5 lb，不是表里最近的 10 lb
  const isDef = (c: IncSpec, k: (typeof INC_KEYS)[number]) => c.v === defaultProfile(c.u)[k]!.v && !c.s;
  const incTo = (c: IncSpec, k: (typeof INC_KEYS)[number], to: PlateUnit): IncSpec => {
    if (isDef(c, k)) return defaultProfile(to)[k]!;
    const s = startIn(c, to);
    return { u: to, v: incIn(c, to), ...(s > 0 ? { s } : {}) };
  };
  for (const k of INC_KEYS) {
    const c = p[k];
    if (!c || c.u !== p.plateUnit) continue;
    const w = c.was;
    if (w && w.u === unit && sameSpec(c, incTo(w, k, c.u))) {
      next[k] = specOnly(w);
      continue;
    }
    next[k] = isDef(c, k) ? incTo(c, k, unit) : { ...incTo(c, k, unit), was: specOnly(c) };
  }
  return next;
}

/** 当前单位下实际用的那一套：档案和单位一致就照用，不一致按标准片、档位换算到最近（这次换了一套片子） */
export interface LoadCtx {
  unit: PlateUnit;
  /** 能用的片（当前单位） */
  plates: number[];
  /** 杠铃空杠（当前单位）；挂片式器械不用它，用 tare */
  bar: number;
  /**
   * 挂片式器械的自重（当前单位；滑台 / 史密斯杠，2026-11-08 用户定）：填了就当空杠算进总重，
   * 记的数＝自重 + 片子；没填（undefined）只算片子。可以是 0 或负数（带配重平衡的史密斯）。只对 loaded 生效。
   */
  tare?: number;
  /** 这件器材的一档（配重片 / 哑铃 / 辅助），按 kind 选好了 */
  inc: number;
  /** 配重片的起始（最轻一格，当前单位）；0 / 没有＝一档的整数倍 */
  start?: number;
  /** 配重片的最重一格（当前单位）；0 / 没有＝不设限 */
  end?: number;
  /** 配重片的加片（当前单位，一块一项）：能到的重量＝格子 + 任选几块 */
  addons?: number[];
  /**
   * 单边挂片（T 杠划船、地雷架、单边的挂片器械，2026-10-22 用户定）：只有一边能挂，总重＝底座 + 一边，
   * 一档＝最小的一片（不 ×2）。只对挂片式器械（loaded）生效，存这一台的 gymOverrides（键 + '|one'）。
   */
  oneSide?: boolean;
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
  fixedBar: number;
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
    fixedBar: incIn(p.fixedBar ?? DEFAULT_FIXED_BAR_INC[p.plateUnit], unit),
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

export const r2 = (v: number) => Math.round(v * 100) / 100;

/** 是不是要取整的器材：纯数字的动作（含没有重量这一项的）不管 */
function snaps(kind: LoadKind): boolean {
  return kind !== 'plain';
}

/** 片子以外的底：杠铃是空杠，挂片式器械是填过的自重（没填＝0，只算片子），其余 0 */
export function baseOf(kind: LoadKind, ctx: LoadCtx): number {
  return kind === 'plates' ? ctx.bar : kind === 'loaded' ? ctx.tare ?? 0 : 0;
}

/** v 上下两个能挂的重量（当前单位、带符号） */
export function bracket(kind: LoadKind, v: number, ctx: LoadCtx): { lo: number; hi: number } {
  if (kind === 'plates' || kind === 'loaded') {
    const base = baseOf(kind, ctx);
    if (v <= base) return { lo: base, hi: base };
    const sides = kind === 'loaded' && ctx.oneSide ? 1 : 2;
    const [a, b] = sideBracket((v - base) / sides, ctx.plates, ctx.unit);
    return { lo: r2(base + sides * a), hi: r2(base + sides * b) };
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
    // 最重一格：比它重的格子不存在，上下两档都落在它（不在格子上的最重一格按它以下最近的一格）
    const top = kind === 'pin' && ctx.end && ctx.end >= s0 ? s0 + Math.floor((ctx.end - s0) / st + 1e-9) * st : Infinity;
    // 加片：每种合计 a 各看一遍「插销格子 + a」，下面取最重的、上面取最轻的。没有加片时只有 a = 0 这一遍。
    // 插销至少插在最轻一格上（只挂加片不算一个重量）；格子到顶以后再往上只能靠加片
    let lo = -Infinity;
    let hi = Infinity;
    for (const a of addonSums(kind === 'pin' ? ctx.addons : undefined)) {
      const x = v - a;
      if (x < s0 - 1e-9) {
        hi = Math.min(hi, s0 + a);
        continue;
      }
      lo = Math.max(lo, Math.min(top, s0 + Math.floor((x - s0) / st + 1e-9) * st) + a);
      const up = s0 + Math.ceil((x - s0) / st - 1e-9) * st;
      if (up <= top + 1e-9) hi = Math.min(hi, up + a);
    }
    if (hi === Infinity) hi = lo;
    return { lo: r2(lo), hi: r2(hi) };
  }
  let lo = Math.floor(v / st + 1e-9) * st;
  let hi = Math.ceil(v / st - 1e-9) * st;
  if (kind === 'pair' || kind === 'bell' || kind === 'fixed') {
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
  if (kind === 'plates' || kind === 'loaded') return Math.min(...ctx.plates) * (kind === 'loaded' && ctx.oneSide ? 1 : 2);
  if (kind === 'signed') return v < 0 ? ctx.inc : Math.min(...ctx.plates);
  if (kind === 'pin' || kind === 'pair' || kind === 'bell' || kind === 'fixed') return ctx.inc;
  return null;
}

/**
 * 「走一格」往那个方向探多远、多近算同一格：bracket 的格子经 r2 最多偏 0.005（换算过来的杠重、手打三位小数的每格），
 * 探得比它近就会把下一格认回同一格、± 卡住不动（上架审查 C47）；又要远小于最细的格（0.05）。
 */
const PROBE = 0.006;

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
      const b = bracket(kind, x + dir * PROBE, ctx);
      const n = dir > 0 ? b.hi : b.lo;
      if (Math.abs(n - x) < PROBE) break;
      x = n;
    }
    next = x;
  }
  // 杠铃 / 填了自重的挂片器械往下减不到空杠以下（空杠就是最轻的那一下）；要记 0 就直接打字
  const base = baseOf(kind, ctx);
  if ((kind === 'plates' || kind === 'loaded') && next < base && cur >= base - 0.01) next = base;
  // 比最轻能挂的还轻（0、手打的 15）：往下不能反而跳到空杠 / 最小一档，原地不动；往上照常吸上去
  if (dir < 0 && next > cur) next = cur;
  if (dir > 0 && next < cur) next = cur;
  // + 0：把 -0 收成 0（−5 往上走一档落在 -0）
  return Math.max(min, r2(next)) + 0;
}

/**
 * 配重片上的一个重量拆成「插销插在哪一格 + 挂了哪几块加片」（大图和说明用）：加片用得越少越好。
 * 拆不出来（不在格子上）＝全算在插销上、不挂加片。
 */
export function splitStack(v: number, ctx: LoadCtx): { pin: number; add: number[] } {
  const none = { ...ctx, addons: undefined };
  if (isLoadable('pin', v, none)) return { pin: v, add: [] };
  const list = (ctx.addons ?? []).slice(0, ADDON_MAX);
  let best: number[] | null = null;
  for (let mask = 1; mask < 1 << list.length; mask++) {
    const add = list.filter((_, i) => mask & (1 << i));
    const pin = r2(v - add.reduce((p, q) => p + q, 0));
    if (pin > 0 && isLoadable('pin', pin, none) && (!best || add.length < best.length)) best = add;
  }
  return best ? { pin: r2(v - best.reduce((p, q) => p + q, 0)), add: best } : { pin: v, add: [] };
}
