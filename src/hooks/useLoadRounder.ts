/**
 * 按「今天这个馆 + 当前单位」给一个动作取整 —— docs/design-plates.md §3「馆档案」。
 *
 * 把馆档案（AppPrefs.gyms）、这个馆这个动作单独设的一档（gymOverrides）、这个动作用的杠（barOf）、
 * 画法（useLoadInfoOf）、带符号负荷、有没有重量这一项，收成一个按动作取用的取整器。
 * 纯数字的动作（含没有重量这一项的）拿到 null：调用方照旧走首选项的步长，什么都不取整。
 *
 * 换算常数和 SetCapsule.formatWeight 用同一个（2.20462），否则 kg → 显示值 → kg 来回会在等距点上翻转。
 */
import { useCallback } from 'react';
import { useExercisePrefs } from '../contexts/ExercisePrefsContext';
import { useUserSettingsContext } from '../contexts/UserSettingsContext';
import type { Exercise, SetLog, SubSetLog } from '../../types';
import { useLoadInfoOf, type LoadInfo } from './useLoadKind';
import { barWeight, plateUnitOf, type PlateUnit } from '../utils/plates';
import {
  bracket,
  incIn,
  isLoadable,
  profileIn,
  snap,
  stepOf,
  stepTo,
  type GymProfile,
  type LoadCtx,
} from '../utils/loadable';
import { fromSignedKg, setSign, signedKg, usesSignedLoad } from '../utils/load';

const K = 2.20462;
const r2 = (v: number) => Math.round(v * 100) / 100;

export interface ExRounder {
  info: LoadInfo;
  unit: PlateUnit;
  ctx: LoadCtx;
  signed: boolean;
  /** 带符号的 kg ⇄ 显示值 */
  toD: (kg: number) => number;
  fromD: (d: number) => number;
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
  if (!gym || !info.defId) return null;
  return `${gym}|${info.defId}|${info.variantId ?? ''}`;
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
) => ExRounder | null;

export function useLoadRounder(): RounderFor {
  const { unit, appPrefs } = useUserSettingsContext();
  const { barOf, signedLoadOf, getActiveMetrics, resolveName } = useExercisePrefs();
  const infoOf = useLoadInfoOf();
  const gyms = appPrefs.gyms;
  const overrides = appPrefs.gymOverrides;

  return useCallback(
    (ex, gym, unitOverride, gymsOverride) => {
      if (!getActiveMetrics(resolveName(ex.name)).includes('weight')) return null;
      const u: PlateUnit = (unitOverride ?? unit) === 'lbs' ? 'lbs' : 'kg';
      const signed = usesSignedLoad(ex, signedLoadOf(ex.name));
      const info = infoOf(ex, signed);
      if (info.kind === 'plain') return null;
      const prof = profileIn(gym ? (gymsOverride ?? gyms)[gym] : undefined, u);
      const okey = gymOverrideKey(gym, info);
      const ov = okey ? overrides[okey] : undefined;
      const stackInc = ov ? incIn(ov, u) : info.stack === 'cable' ? prof.cable : prof.machine;
      const ctx: LoadCtx = {
        unit: u,
        plates: prof.plates,
        bar: barWeight(barOf(ex.name), u),
        inc:
          info.kind === 'pair'
            ? ov ? incIn(ov, u) : prof.dumbbell
            : info.kind === 'bell'
              ? ov ? incIn(ov, u) : prof.kettlebell
              : stackInc,
      };
      return makeRounder(info, u, ctx, signed);
    },
    [unit, gyms, overrides, barOf, signedLoadOf, getActiveMetrics, resolveName, infoOf],
  );
}

/** 按画法 / 单位 / 这套片和一档造一个取整器（换一档时 withInc 也用它） */
export function makeRounder(info: LoadInfo, u: PlateUnit, ctx: LoadCtx, signed: boolean): ExRounder {
  const toD = (kg: number) => r2(u === 'lbs' ? kg * K : kg);
  const fromD = (d: number) => (u === 'lbs' ? d / K : d);
  const k = info.kind;
  return {
    info,
    unit: u,
    ctx,
    signed,
    toD,
    fromD,
    snapD: d => snap(k, d, ctx),
    loadableD: d => isLoadable(k, d, ctx),
    stepD: d => stepOf(k, d, ctx) ?? 0,
    stepToD: (d, dir, mult = 1) => stepTo(k, d, dir, mult, ctx),
    bracketD: d => bracket(k, d, ctx),
    // 0 不取整：空着的组（没填数）不能被吸成一根空杠 20 kg / 一档 5 kg
    snapKg: kg => (Math.abs(kg) < 1e-9 ? 0 : fromD(snap(k, toD(kg), ctx))),
  };
}

/** 同一个取整器换一档（⋯ 里改「这台器械一档多重」那一刻，档案还没刷新） */
export function withInc(r: ExRounder, inc: number): ExRounder {
  return makeRounder(r.info, r.unit, { ...r.ctx, inc }, r.signed);
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
      next.subSets = s.subSets.map(sub => {
        const skg = signedKg(sub, ex, s);
        return { ...writeKg(sub, r.snapKg(skg), r.signed), prefillRef: { kg: skg, unit: ref.unit }, draftAuto: true, plateUnit: r.unit } as SubSetLog;
      });
    }
    return next;
  });
}

/**
 * 切单位 / 换馆（用户手动的）：没做完的组都换到新单位那套片子上取整 ——
 * 没动过的底稿（draftAuto）从上一次的原值重算（135 lb → 60 kg → 再切回还是 135，不会越换越漂），
 * 其余（改过的、平移过的）从当前值换算。做完的组不动（2026-10-18 用户定）。
 */
export function reRoundPending(sets: SetLog[], ex: Exercise, r: ExRounder | null): SetLog[] {
  if (!r || !sets) return sets;
  return sets.map(s => {
    if (!s.ghost) return s;
    // 改过这一格（打字 / ± / 拖动 / 点了能挂的两档）就不再是纯换算来的：从当前值换，不能拿上一次的原值盖掉
    const base = s.draftAuto && s.prefillRef && !s.touched?.weight ? s.prefillRef.kg : signedKg(s, ex);
    const next: SetLog = { ...writeKg(s, r.snapKg(base), r.signed), plateUnit: r.unit };
    if (s.subSets?.length) {
      next.subSets = s.subSets.map(sub => {
        const sb = sub.draftAuto && sub.prefillRef && !sub.touched?.weight ? sub.prefillRef.kg : signedKg(sub, ex, s);
        return { ...writeKg(sub, r.snapKg(sb), r.signed), plateUnit: r.unit };
      });
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
      next.subSets = s.subSets.map(sub =>
        sub.touched?.weight ? sub : { ...writeKg(sub, r.snapKg(signedKg(sub, ex, s)), r.signed), plateUnit: r.unit },
      );
    }
    return next;
  });
}

/** 一个带符号 kg 在这个动作上的号：带动后面时给 workbench 用 */
export { setSign };
