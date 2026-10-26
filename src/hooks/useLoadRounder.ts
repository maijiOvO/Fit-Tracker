/**
 * 按「今天这个馆的片子」给一个动作取整 —— docs/design-plates.md §3「馆档案」。
 * 格子按馆的片子单位算，进出按显示单位换算（2026-10-22，审查 A9）。
 *
 * 把馆档案（AppPrefs.gyms）、这个馆这个动作单独设的一档（gymOverrides）、这个动作用的杠（barOf）、
 * 画法（useLoadInfoOf）、带符号负荷、有没有重量这一项，收成一个按动作取用的取整器。
 * 纯数字的动作（含没有重量这一项的）拿到 null：调用方照旧走首选项的步长，什么都不取整。
 *
 * 换算常数和 SetCapsule.formatWeight 用同一个（2.20462），否则 kg → 显示值 → kg 来回会在等距点上翻转。
 */
import { useCallback } from 'react';
import { KG_TO_LBS } from '../constants';
import { useExercisePrefs } from '../contexts/ExercisePrefsContext';
import { useUserSettingsContext } from '../contexts/UserSettingsContext';
import type { Exercise, SetLog, SubSetLog } from '../../types';
import { gymMachineKey, useLoadInfoOf, type LoadInfo } from './useLoadKind';
import { barWeight, plateUnitOf, type PlateUnit } from '../utils/plates';
import {
  bracket,
  incIn,
  isLoadable,
  nearest,
  profileIn,
  r2,
  startIn,
  snap,
  stepOf,
  stepTo,
  type GymProfile,
  type IncSpec,
  type LoadCtx,
} from '../utils/loadable';
import { fromSignedKg, setSign, signedKg, usesSignedLoad } from '../utils/load';

const K = KG_TO_LBS;

export interface ExRounder {
  info: LoadInfo;
  /** 这个馆的片子单位（ctx 里的数都按它）；没标馆 / 没设过档案＝显示单位 */
  unit: PlateUnit;
  /** 显示单位：…D 那几个函数的进出都按它 */
  display: PlateUnit;
  ctx: LoadCtx;
  signed: boolean;
  /** 带符号的 kg ⇄ 显示值 */
  toD: (kg: number) => number;
  fromD: (d: number) => number;
  /** 显示值 → 要存的带符号 kg：落在格子上的存格子的精确值，其余同 fromD */
  kgOfD: (d: number) => number;
  /** 显示值层面的取整 / 一档 / 走一下 / 上下两档 */
  snapD: (d: number) => number;
  loadableD: (d: number) => boolean;
  stepD: (d: number) => number;
  stepToD: (d: number, dir: 1 | -1, mult?: number) => number;
  bracketD: (d: number) => { lo: number; hi: number };
  /** 带符号 kg 层面的取整（自动生成的重量用它） */
  snapKg: (kg: number) => number;
}

export function gymOverrideKey(gym: string | undefined, info: Pick<LoadInfo, 'defId' | 'variantId'>): string | null {
  return gymMachineKey(gym, info);
}

/**
 * 返回 rounderFor(ex, gym, unitOverride?)：
 *   - gym：这场训练记的馆（WorkoutSession.gym）；没标馆 / 没设过档案 → 标准片 + 常见档位
 *   - unitOverride：切单位那一刻要按新单位算（context 里的 unit 还没刷新）
 */
export type RounderFor = (
  ex: Exercise,
  gym: string | undefined,
  unitOverride?: PlateUnit,
  /** 刚存的馆档案（context 里的 appPrefs 还没刷新） */
  gymsOverride?: Record<string, GymProfile>,
  /** 刚存的单台器械设置（同上；恢复馆默认 / 换这一台的单位时格子单位会变） */
  overridesOverride?: Record<string, IncSpec>,
) => ExRounder | null;

export function useLoadRounder(): RounderFor {
  const { unit, appPrefs } = useUserSettingsContext();
  const { barOf, signedLoadOf, getActiveMetrics, resolveName } = useExercisePrefs();
  const infoOf = useLoadInfoOf();
  const gyms = appPrefs.gyms;
  const savedOverrides = appPrefs.gymOverrides;

  return useCallback(
    (ex, gym, unitOverride, gymsOverride, overridesOverride) => {
      const overrides = overridesOverride ?? savedOverrides;
      if (!getActiveMetrics(resolveName(ex.name)).includes('weight')) return null;
      const du: PlateUnit = (unitOverride ?? unit) === 'lbs' ? 'lbs' : 'kg';
      const signed = usesSignedLoad(ex, signedLoadOf(ex));
      // 带上馆：这台器械在这个馆是插销还是挂片（gymKinds）
      const info = infoOf(ex, signed, gym);
      if (info.kind === 'plain') return null;
      // 格子按这件器械的片子单位算（显示 lb 的 kg 馆，± / 取整照样落在这个馆挂得出的重量上，审查 A9）
      const profile = gym ? (gymsOverride ?? gyms)[gym] : undefined;
      const okey = gymOverrideKey(gym, info);
      const ov = okey ? overrides[okey] : undefined;
      const u: PlateUnit = ownUnitOf(info, profile, ov) ?? profile?.plateUnit ?? du;
      const prof = profileIn(profile, u);
      const stackInc = ov ? incIn(ov, u) : info.stack === 'cable' ? prof.cable : prof.machine;
      // 配重片的起始（最轻一格）：这台单独设过就用这台的，否则馆的默认（2026-10-20）
      const stackStart = ov ? startIn(ov, u) : info.stack === 'cable' ? prof.cableStart : prof.machineStart;
      const ctx: LoadCtx = {
        unit: u,
        plates: prof.plates,
        bar: barWeight(barOf(ex.name), u),
        inc:
          info.kind === 'pair'
            ? ov ? incIn(ov, u) : prof.dumbbell
            : info.kind === 'bell'
              ? ov ? incIn(ov, u) : prof.kettlebell
              : info.kind === 'fixed'
                ? ov ? incIn(ov, u) : prof.fixedBar
                : stackInc,
        start: info.kind === 'pin' ? stackStart : 0,
        ...(info.kind === 'loaded' && okey && overrides[oneSideKey(okey)] ? { oneSide: true } : {}),
      };
      return makeRounder(info, u, ctx, signed, du);
    },
    [unit, gyms, savedOverrides, barOf, signedLoadOf, getActiveMetrics, resolveName, infoOf],
  );
}

/**
 * 一档就是这件器械本身的器材（配重片 / 哑铃 / 壶铃 / 固定杠铃）：一台器械只有一种片，格子按它自己的单位算
 * （2026-10-25 用户定：同一个馆里可以一台 lb 的龙门架、一台 kg 的）——这一台单独设过就是它设的单位，
 * 否则是馆档案里这一类的单位。没设档案＝null，跟馆的片子单位 / 显示单位走。
 * 杠铃、挂片、带正负的负荷挂的是馆的片子，照旧按馆的片子单位。
 */
export function ownUnitOf(
  info: Pick<LoadInfo, 'kind' | 'stack'>,
  profile: GymProfile | undefined,
  ov: IncSpec | undefined,
): PlateUnit | null {
  const k = info.kind;
  if (k !== 'pin' && k !== 'pair' && k !== 'bell' && k !== 'fixed') return null;
  if (ov) return ov.u;
  if (!profile) return null;
  const spec =
    k === 'pair' ? profile.dumbbell
    : k === 'bell' ? profile.kettlebell
    : k === 'fixed' ? profile.fixedBar
    : info.stack === 'cable' ? profile.cable : profile.machine;
  return spec?.u ?? profile.plateUnit;
}

/** 单边挂片的开关存在这一台的 gymOverrides 里，键是这一台的键 + '|one'（值 { v: 1 }，删键＝两边挂） */
export const oneSideKey = (machineKey: string) => `${machineKey}|one`;

/**
 * 按画法 / 片子单位 / 这套片和一档造一个取整器（换一档时 withInc 也用它）。
 * u：馆的片子单位（ctx 按它）；du：显示单位。两者不同时，…D 进来先换成片子单位算，出去再换回显示单位。
 */
export function makeRounder(info: LoadInfo, u: PlateUnit, ctx: LoadCtx, signed: boolean, du: PlateUnit = u): ExRounder {
  const toD = (kg: number) => r2(du === 'lbs' ? kg * K : kg);
  const fromD = (d: number) => (du === 'lbs' ? d / K : d);
  const toG = (kg: number) => (u === 'lbs' ? kg * K : kg);
  const fromG = (g: number) => (u === 'lbs' ? g / K : g);
  const k = info.kind;
  // 显示值只留两位小数（49.9 kg），换回片子单位差格子一点点（110.01 lb）：差在显示精度以内就认回那一格。
  // 不认的话 isLoadable 的 0.01 容差判它不在格子上，往一个方向先「吸回」同一格——拖不动 / 只走一下（2026-10-25 用户报）
  const tolG = du === u ? 0 : 0.005 * (u === 'lbs' ? K : 1 / K) + 1e-6;
  const d2g = (d: number) => {
    if (du === u) return d;
    const g = toG(fromD(d));
    // 取格子本身（nearest），不用 snap：snap 对 0.01 以内的数原样返回 139.99，还是差那一点
    const s = nearest(k, g, ctx);
    return Math.abs(s - g) <= tolG ? s : g;
  };
  const g2d = (g: number) => (du === u ? g : toD(fromG(g)));
  return {
    info,
    unit: u,
    display: du,
    ctx,
    signed,
    toD,
    fromD,
    // 写回：在格子上的存格子的精确 kg（110 lb → 49.8952，不是显示的 49.9），不在格子上的（手打的）照显示值换
    kgOfD: d => {
      const g = d2g(d);
      return Math.abs(d) > 1e-9 && isLoadable(k, g, ctx) ? fromG(nearest(k, g, ctx)) : fromD(d);
    },
    snapD: d => g2d(snap(k, d2g(d), ctx)),
    loadableD: d => isLoadable(k, d2g(d), ctx),
    stepD: d => {
      const st = stepOf(k, d2g(d), ctx) ?? 0;
      return du === u ? st : r2(du === 'lbs' ? st * K : st / K);
    },
    stepToD: (d, dir, mult = 1) => g2d(stepTo(k, d2g(d), dir, mult, ctx)),
    bracketD: d => {
      const b = bracket(k, d2g(d), ctx);
      return { lo: g2d(b.lo), hi: g2d(b.hi) };
    },
    // 0 不取整：空着的组（没填数）不能被吸成一根空杠 20 kg / 一档 5 kg
    snapKg: kg => (Math.abs(kg) < 1e-9 ? 0 : fromG(snap(k, toG(kg), ctx))),
  };
}

/** 同一个取整器换形式（⋯ 里改「这台是插销 / 挂片」那一刻，档案还没刷新）：片子和一档 ctx 里都有 */
export function withKind(r: ExRounder, kind: LoadInfo['kind']): ExRounder {
  return makeRounder({ ...r.info, kind }, r.unit, r.ctx, r.signed, r.display);
}

/** 同一个取整器换一档（⋯ 里改「这台器械一档多重」那一刻，档案还没刷新）；起始照旧 */
export function withInc(r: ExRounder, inc: number): ExRounder {
  return makeRounder(r.info, r.unit, { ...r.ctx, inc }, r.signed, r.display);
}

/** 同一个取整器换一档和起始（大图上改「最轻一格 · 每格」那一刻） */
export function withStack(r: ExRounder, inc: number, start: number): ExRounder {
  return makeRounder(r.info, r.unit, { ...r.ctx, inc, start }, r.signed, r.display);
}

/** 同一个取整器开 / 关单边挂片（大图上拨「单边」那一刻，档案还没刷新） */
export function withOneSide(r: ExRounder, oneSide: boolean): ExRounder {
  return makeRounder(r.info, r.unit, { ...r.ctx, oneSide }, r.signed, r.display);
}

/* ── 组级工具（纯函数，给工作台 / 底稿 / 切单位用） ── */

type W = Pick<SetLog, 'weight' | 'bodyweightMode'>;

/** 带符号 kg 写回：带正负的动作连号一起写，普通动作只写非负的 weight */
function writeKg<T extends W>(x: T, kg: number, signed: boolean): T {
  // 组上自己写了号（动作后来关了带正负，旧组还记着辅助）：照 workbench.shiftWeight 的口径按带号写，别截成 0
  const own = x.bodyweightMode === 'assisted' || x.bodyweightMode === 'weighted';
  return signed || own ? { ...x, ...fromSignedKg(kg) } : { ...x, weight: Math.max(0, kg) };
}

/**
 * 递减 / 递增档取整后保持方向（2026-10-20 用户报：22 → 16.6 lb 的递减，切到 kg 后两档都吸成同一个数）。
 * 原来比上一档轻的（递减），取整后必须仍然更轻；吸到和上一档一样或反了，就往原方向挪到紧挨着的那一格。
 * 原值和上一档一样的、改过的（touched）不管；已经到最轻 / 最重挪不动的照原样。
 * orig：取整前的带符号 kg（和 subs 一一对应），parentOrig / parentKg：母组取整前后的带符号 kg。
 */
function keepSubOrder(
  subs: SubSetLog[],
  orig: number[],
  parentOrig: number,
  parentKg: number,
  ex: Exercise,
  parent: SetLog,
  r: ExRounder,
): SubSetLog[] {
  let prevOrig = parentOrig;
  let prevKg = parentKg;
  return subs.map((sub, i) => {
    const o = orig[i];
    let kg = signedKg(sub, ex, parent);
    const dir = o < prevOrig - 1e-6 ? -1 : o > prevOrig + 1e-6 ? 1 : 0;
    const ok = dir === 0 || (dir < 0 ? kg < prevKg - 1e-6 : kg > prevKg + 1e-6);
    let out = sub;
    if (!ok && !sub.touched?.weight) {
      const prevD = r.toD(prevKg);
      const b = r.bracketD(prevD + dir * 0.001);
      const cand = dir < 0 ? b.lo : b.hi;
      if (dir < 0 ? cand < prevD - 1e-6 : cand > prevD + 1e-6) {
        kg = r.fromD(cand);
        out = writeKg(sub, kg, r.signed);
      }
    }
    prevOrig = o;
    prevKg = kg;
    return out;
  });
}

/**
 * 底稿取整：从上一次铺下来的组，按今天的馆和单位就近取整，记下 prefillRef（参考）和 draftAuto。
 * 上一次那组挂的片：组上记的 plateUnit，没记（旧数据）按重量推断。
 */
export function roundPrefill(sets: SetLog[], ex: Exercise, r: ExRounder | null): SetLog[] {
  if (!r || !sets) return sets;
  return sets.map(s => {
    const kg = signedKg(s, ex);
    // 旧数据没记登记单位：按重量推断（整 kg 格优先，见 plateUnitOf），不能直接当成今天的单位
    const ref = { kg, unit: plateUnitOf(s, r.unit) };
    const next: SetLog = { ...writeKg(s, r.snapKg(kg), r.signed), prefillRef: ref, draftAuto: true, plateUnit: r.unit };
    if (s.subSets?.length) {
      const orig = s.subSets.map(sub => signedKg(sub, ex, s));
      const subs = s.subSets.map((sub, i) => {
        const skg = orig[i];
        return { ...writeKg(sub, r.snapKg(skg), r.signed), prefillRef: { kg: skg, unit: ref.unit }, draftAuto: true, plateUnit: r.unit } as SubSetLog;
      });
      next.subSets = keepSubOrder(subs, orig, kg, signedKg(next, ex), ex, next, r);
    }
    return next;
  });
}

/**
 * 切单位 / 换馆（用户手动的）：没做完的组都换到新单位那套片子上取整 ——
 * 没动过的底稿（draftAuto）从上一次的原值重算（135 lb → 60 kg → 再切回还是 135，不会越换越漂），
 * 被带着平移过的从当前值换算；手打过的照原样（2026-10-22）。做完的组不动（2026-10-18 用户定）。
 */
export function reRoundPending(sets: SetLog[], ex: Exercise, r: ExRounder | null): SetLog[] {
  if (!r || !sets) return sets;
  return sets.map(s => {
    if (!s.ghost) return s;
    // 没动过的底稿从上一次的原值重算，被带着平移过的从当前值换
    const base = s.draftAuto && s.prefillRef && !s.touched?.weight ? s.prefillRef.kg : signedKg(s, ex);
    // 手打过这一格的照原样记、不重新取整（口径同 snapUntouched，审查 A10）
    const next: SetLog = s.touched?.weight ? { ...s } : { ...writeKg(s, r.snapKg(base), r.signed), plateUnit: r.unit };
    if (s.subSets?.length) {
      const orig = s.subSets.map(sub => (sub.draftAuto && sub.prefillRef && !sub.touched?.weight ? sub.prefillRef.kg : signedKg(sub, ex, s)));
      const subs = s.subSets.map((sub, i) => (sub.touched?.weight ? sub : { ...writeKg(sub, r.snapKg(orig[i]), r.signed), plateUnit: r.unit }));
      next.subSets = keepSubOrder(subs, orig, base, signedKg(next, ex), ex, next, r);
    }
    return next;
  });
}

/**
 * 换了一档（单独设 / 恢复馆默认）：没做完、这一格没改过的组吸到新的一档上（递减档一起）。
 * 改过的照原样（打的数照原样记）；做完的不动。
 */
export function snapUntouched(sets: SetLog[], ex: Exercise, r: ExRounder | null): SetLog[] {
  if (!r || !sets) return sets;
  return sets.map(s => {
    if (!s.ghost) return s;
    // 改过的那组也要新对象：下面会给它换 subSets，不能写进上一份 state
    const next: SetLog = s.touched?.weight ? { ...s } : { ...writeKg(s, r.snapKg(signedKg(s, ex)), r.signed), plateUnit: r.unit };
    if (s.subSets?.length) {
      const orig = s.subSets.map(sub => signedKg(sub, ex, s));
      const subs = s.subSets.map((sub, i) =>
        sub.touched?.weight ? sub : { ...writeKg(sub, r.snapKg(orig[i]), r.signed), plateUnit: r.unit },
      );
      next.subSets = keepSubOrder(subs, orig, signedKg(s, ex), signedKg(next, ex), ex, next, r);
    }
    return next;
  });
}

/** 一个带符号 kg 在这个动作上的号：带动后面时给 workbench 用 */
export { setSign };
