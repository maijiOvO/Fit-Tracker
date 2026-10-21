/**
 * 首选项容器 appPrefs：一个对象、一个时间戳，随 prefs 同步（审查 2026-10-06「首选项 · 同步怎么存」）。
 *
 * 为什么不塞进已有的 prefs 块：customTags / exerciseOverrides 等共用一个 prefsLastUpdateMs、整块比谁新，
 * 在手机上切一次单位，电脑上的标签改动就会被盖掉（反过来单位被翻回去，unit-lang-sync-revert 就是这么来的）。
 * 以后的首选项都往这个对象里加字段，不再新增同步 key；加字段不用动读 / 写 / 合并三处。
 *
 * 单位、语言迁进来了。旧字段 fitlog_unit / fitlog_lang 照写（UserSettingsContext 首帧读它们，
 * 没升级的设备也只认它们），但胜负按这里的时间戳定。
 */
import { storage } from './appStorage';
import type { GymProfile, IncSpec } from '../src/utils/loadable';

export interface AppPrefs {
  unit?: 'kg' | 'lbs';
  lang?: string;
  /** ±步长（当前重量单位下的数），kg / lbs 共用一个数（2026-10-06 用户定） */
  weightStep?: number;
  /** 手动加一档递减时每档降多少（当前重量单位下的数），同样 kg / lbs 共用 */
  dropStep?: number;
  /** 没配置过、也从没记过的有氧动作默认记哪几项 */
  cardioMetrics?: string[];
  /** 距离单位，和重量单位分开。存储固定 km、km/h，显示时换算 */
  distUnit?: 'km' | 'mi';
  /** 每周从周一还是周日开始（热力图、时间线周视图、日历） */
  weekStart?: 'mon' | 'sun';
  /**
   * 「杠铃片」馆档案（2026-10-18）：馆名 → 有哪些片、龙门架 / 器械 / 哑铃各一档多重。
   * 馆名就是训练上记的 WorkoutSession.gym（字面量）。整个对象跟 appPrefs 一起同步，不新增同步键。
   */
  gyms?: Record<string, GymProfile>;
  /** 这个馆的这个动作（某个做法）单独设的一档：键「馆名|动作定义 id|做法 id」 */
  gymOverrides?: Record<string, IncSpec>;
  /**
   * 「按动作」顶上的特别关注（2026-10-20）：动作的稳定键「定义 id|做法 id」，最多 4 个、按显示顺序。
   * 没设过（undefined）＝自动取三大项；设成空数组＝用户清空了。存 id 不存名字：改名、切语言都不失效。
   */
  featuredLifts?: string[];
  /** 特别关注按什么算：做过的最重一组，还是估算 1RM（看自己的极限大概在哪） */
  featuredMode?: 'weight' | 'e1rm';
}

/** 特别关注最多几个：三大项占 3 个，留 1 个给自己的重点动作 */
export const MAX_FEATURED = 4;

export const WEIGHT_STEP_OPTIONS = [1, 2.5, 5, 10] as const;
export const DROP_STEP_OPTIONS = [2.5, 5, 10, 15] as const;

/** 读取方一律经过这里拿默认值，AppPrefs 里只存用户改过的 */
export const APP_PREF_DEFAULTS = {
  weightStep: 5,
  dropStep: 5,
  cardioMetrics: ['duration', 'distance'],
  distUnit: 'km',
  weekStart: 'mon',
  gyms: {},
  gymOverrides: {},
  featuredMode: 'weight',
} as const satisfies Omit<Required<AppPrefs>, 'unit' | 'lang' | 'featuredLifts'>;

export type ResolvedAppPrefs = {
  weightStep: number;
  dropStep: number;
  cardioMetrics: string[];
  distUnit: 'km' | 'mi';
  weekStart: 'mon' | 'sun';
  gyms: Record<string, GymProfile>;
  gymOverrides: Record<string, IncSpec>;
  /** null＝没设过，用默认（三大项） */
  featuredLifts: string[] | null;
  featuredMode: 'weight' | 'e1rm';
};

const isUnit = (u: unknown): u is 'kg' | 'lbs' => u === 'kg' || u === 'lbs';
const isInc = (c: unknown): c is IncSpec =>
  !!c && typeof c === 'object' && typeof (c as IncSpec).v === 'number' && (c as IncSpec).v > 0 && isUnit((c as IncSpec).u);
/** 同步回来的档案缺字段 / 坏字段时整条丢掉（宁可用默认档位也不要拿 NaN 去取整） */
function cleanGyms(raw: unknown): Record<string, GymProfile> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, GymProfile> = {};
  for (const [name, g] of Object.entries(raw as Record<string, any>)) {
    if (!g || !isUnit(g.plateUnit) || !Array.isArray(g.plates) || !isInc(g.cable) || !isInc(g.machine) || !isInc(g.dumbbell)) continue;
    const plates = g.plates.filter((p: unknown) => typeof p === 'number' && p > 0);
    if (!plates.length) continue;
    out[name] = { plateUnit: g.plateUnit, plates, cable: g.cable, machine: g.machine, dumbbell: g.dumbbell };
  }
  return out;
}
function cleanOverrides(raw: unknown): Record<string, IncSpec> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return Object.fromEntries(Object.entries(raw as Record<string, unknown>).filter(([, c]) => isInc(c))) as Record<string, IncSpec>;
}

export function resolveAppPrefs(p: AppPrefs | undefined): ResolvedAppPrefs {
  const num = (v: unknown, d: number) => (typeof v === 'number' && v > 0 ? v : d);
  return {
    weightStep: num(p?.weightStep, APP_PREF_DEFAULTS.weightStep),
    dropStep: num(p?.dropStep, APP_PREF_DEFAULTS.dropStep),
    cardioMetrics:
      Array.isArray(p?.cardioMetrics) && p.cardioMetrics.length
        ? p.cardioMetrics
        : [...APP_PREF_DEFAULTS.cardioMetrics],
    distUnit: p?.distUnit === 'mi' ? 'mi' : 'km',
    weekStart: p?.weekStart === 'sun' ? 'sun' : 'mon',
    gyms: cleanGyms(p?.gyms),
    gymOverrides: cleanOverrides(p?.gymOverrides),
    featuredLifts: Array.isArray(p?.featuredLifts)
      ? p.featuredLifts.filter((k): k is string => typeof k === 'string').slice(0, MAX_FEATURED)
      : null,
    featuredMode: p?.featuredMode === 'e1rm' ? 'e1rm' : 'weight',
  };
}

const KEY = 'fitlog_app_prefs';
const TS_KEY = 'fitlog_app_prefs_last_update';

export function readAppPrefs(): { appPrefs?: AppPrefs; appPrefsUpdatedMs: number } {
  let appPrefs: AppPrefs | undefined;
  try {
    const raw = storage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) appPrefs = parsed as AppPrefs;
  } catch {
    appPrefs = undefined;
  }
  const appPrefsUpdatedMs = Number.parseInt(storage.getItem(TS_KEY) || '0', 10) || 0;
  return { appPrefs, appPrefsUpdatedMs };
}

export function writeAppPrefs(appPrefs: AppPrefs | undefined, appPrefsUpdatedMs: number): void {
  resolvedCache = null;
  if (appPrefs) storage.setItem(KEY, JSON.stringify(appPrefs));
  else storage.removeItem(KEY);
  if (appPrefsUpdatedMs) storage.setItem(TS_KEY, String(appPrefsUpdatedMs));
  else storage.removeItem(TS_KEY);
}

let resolvedCache: ResolvedAppPrefs | null = null;

/**
 * 当前生效的首选项（带默认值）。给拿不到 React context 的纯函数用（格式化、单位标签）；
 * 组件里用 UserSettingsContext 的 appPrefs，改了才会重渲染。
 */
export function appPrefsNow(): ResolvedAppPrefs {
  if (!resolvedCache) resolvedCache = resolveAppPrefs(readAppPrefs().appPrefs);
  return resolvedCache;
}

/** 切数据环境后存储换了一套，缓存作废 */
export function invalidateAppPrefsCache(): void {
  resolvedCache = null;
}

/** 用户改了某项首选项：并进对象、打时间戳。推送由调用方排（scheduleDebouncedFitlogPush） */
export function recordAppPrefs(patch: AppPrefs): void {
  const { appPrefs } = readAppPrefs();
  writeAppPrefs({ ...(appPrefs ?? {}), ...patch }, Date.now());
}

/**
 * 合并两边的 appPrefs：时间戳新的一方整体赢，它没有的字段用另一方的补（旧设备的对象字段可能更少）。
 * 两边都没有 → undefined（调用方退回旧口径）。
 */
export function mergeAppPrefs(
  local: AppPrefs | undefined,
  localMs: number,
  remote: AppPrefs | undefined,
  remoteMs: number,
): { appPrefs?: AppPrefs; appPrefsUpdatedMs: number } {
  if (!local && !remote) return { appPrefs: undefined, appPrefsUpdatedMs: Math.max(localMs, remoteMs) };
  const remoteWins = !!remote && (!local || remoteMs > localMs);
  const appPrefs: AppPrefs = remoteWins ? { ...(local ?? {}), ...remote } : { ...(remote ?? {}), ...local };
  // 馆档案按馆名合并（同名冲突新的一边赢）：appPrefs 整块按时间戳取一边，另一台设备只是切了下单位，
  // 就会用它那张旧表把这边新加的馆整张盖掉（2026-10-18 审查）。馆档案界面没有删除，并集不会让删掉的馆复活。
  // gymOverrides 有「恢复馆默认」（删键），并集会把删掉的复活，所以仍整块取新的一边。
  if (local?.gyms || remote?.gyms) {
    const older = remoteWins ? local?.gyms : remote?.gyms;
    const newer = remoteWins ? remote?.gyms : local?.gyms;
    appPrefs.gyms = { ...(older ?? {}), ...(newer ?? {}) };
  }
  return { appPrefs, appPrefsUpdatedMs: Math.max(localMs, remoteMs) };
}
