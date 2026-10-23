/**
 * 「这个动作的重量怎么画、怎么算」—— 「杠铃片」规格 docs/design-plates.md §3 的原型。
 *
 * 训练里的 Exercise 身上不带器材（buildExercise 不写），只能回动作库查：
 * 动作定义 + 覆盖层，做法自己设过器材的以做法为准（见 ExercisePrefsContext.attrsOf）。
 * 手打的、库里查不到的动作 → 纯数字。
 *
 * 2026-10-20 起由「器材 + 阻力类型」决定（src/utils/exerciseAttrs.ts），不再从多选标签里按优先级猜，
 * 也不再靠内置挂片器械名单：挂片器械就是「器械 + 杠铃片」。
 */
import { useCallback } from 'react';
import { useExercisePrefs, type ExerciseAttrs } from '../contexts/ExercisePrefsContext';
import { useUserSettingsContext } from '../contexts/UserSettingsContext';
import { mergeOverride } from '../utils/exerciseOverride';
import { EQ_BARBELL, EQ_CABLE } from '../utils/exerciseAttrs';
import type { Exercise } from '../../types';
import { usesSignedLoad } from '../utils/load';

/**
 * plates：杠铃（杆重 + 两边对称挂片）；loaded：挂片式器械（史密斯 / 倒蹬 / 哈克 / T 杠，按杠铃那样算但只算片子，
 * 2026-10-18 用户定）；pin：配重片插销（器械 / 龙门架）；pair：哑铃；bell：壶铃（单只、按馆的壶铃一档）；
 * fixed：固定杠铃（焊死的成品杠，一根一个总重、按馆的固定杠铃一档，2026-10-21 用户定）；
 * signed：带符号负荷（辅助负 / 负重正）；plain：纯数字（弹力带、不计重）。
 */
export type LoadKind = 'plates' | 'loaded' | 'pin' | 'pair' | 'bell' | 'fixed' | 'signed' | 'plain';

export interface LoadInfo {
  kind: LoadKind;
  /** 配重片的是龙门架 / 绳索还是固定器械（馆档案里两者各有一档）；辅助器械按固定器械算 */
  stack: 'cable' | 'machine';
  /** 动作定义 id + 做法 id：馆里单独设一档时的键 */
  defId?: string;
  variantId?: string;
  /**
   * 动作库给的形式（没按馆改之前）。kind 是这个馆实际用的：库里是插销 / 挂片的，
   * 可以在某个馆改成另一种（AppPrefs.gymKinds，design-plates.md「换馆重量」A2）。
   */
  libKind: LoadKind;
}

/** 这个馆、这个动作（某个做法）的键：gymOverrides / gymKinds / gymNotes 共用 */
export function gymMachineKey(gym: string | undefined, info: { defId?: string; variantId?: string }): string | null {
  if (!gym || !info.defId) return null;
  return `${gym}|${info.defId}|${info.variantId ?? ''}`;
}

/** 能在馆里改「插销 / 挂片」的形式 */
export function gymSwitchableKind(kind: LoadKind): kind is 'pin' | 'loaded' {
  return kind === 'pin' || kind === 'loaded';
}

/**
 * 器材 + 阻力 → 画法。带符号负荷最先（自重动作挂了腰片也还是自重）；
 * 杠铃片挂在杠铃上算杆重，挂在别的器材上（史密斯、倒蹬）只算片子。
 */
export function loadKindOf(attrs: ExerciseAttrs, signed: boolean): LoadKind {
  if (signed) return 'signed';
  switch (attrs.resistance) {
    case 'plates':
      return attrs.equipment === EQ_BARBELL ? 'plates' : 'loaded';
    case 'fixedBar':
      return 'fixed';
    case 'stack':
      return 'pin';
    case 'dumbbell':
      return 'pair';
    case 'kettlebell':
      return 'bell';
    default:
      return 'plain';
  }
}

/**
 * 返回一个查询函数：(训练里的动作, 它是不是带符号负荷, 这场的馆) → 画法与算法。
 * 动作库的形式由「器材 + 阻力」定（libKind）；传了馆：库里是插销 / 挂片的动作按这个馆记住的形式走（gymKinds）。
 */
export function useLoadInfoOf(): (ex: Pick<Exercise, 'name' | 'variantId'>, signed: boolean, gym?: string) => LoadInfo {
  const { findExerciseDef, exerciseOverrides, variantIdOf, attrsOf } = useExercisePrefs();
  const gymKinds = useUserSettingsContext().appPrefs.gymKinds;
  return useCallback(
    (ex, signed, gym) => {
      const def = findExerciseDef(ex.name);
      const vid = variantIdOf(ex);
      if (!def) {
        const k: LoadKind = signed ? 'signed' : 'plain';
        return { kind: k, libKind: k, stack: 'machine', variantId: vid };
      }
      const attrs = attrsOf(mergeOverride(def, exerciseOverrides[def.id]), vid);
      const libKind = loadKindOf(attrs, signed);
      const stack = attrs.equipment === EQ_CABLE ? 'cable' : 'machine';
      const key = gymSwitchableKind(libKind) ? gymMachineKey(gym, { defId: def.id, variantId: vid }) : null;
      const kind = (key && gymKinds[key]) || libKind;
      return { kind, libKind, stack, defId: def.id, variantId: vid };
    },
    [findExerciseDef, exerciseOverrides, variantIdOf, attrsOf, gymKinds],
  );
}

/** 只要画法 */
export function useLoadKindOf(): (ex: Pick<Exercise, 'name' | 'variantId'>, signed: boolean, gym?: string) => LoadKind {
  const infoOf = useLoadInfoOf();
  return useCallback((ex, signed, gym) => infoOf(ex, signed, gym).kind, [infoOf]);
}

/**
 * 纪录只在同一个馆里比的器材（2026-10-18 用户定）：配重片器械 / 龙门架、挂片式器械 ——
 * 每个馆的器械杠杆、配重片标称都不一样，A 馆的 60 和 B 馆的 60 不是同一个重量。
 * 杠铃、固定杠铃、哑铃、带正负的负荷是真重量，跨馆照常比（固定杠铃同哑铃：标的就是这根的总重）。
 */
export function gymScopedKind(kind: LoadKind): boolean {
  return kind === 'pin' || kind === 'loaded';
}

/** (动作) => 这个动作的纪录要不要只在同一个馆里比（按馆改形式只在插销 / 挂片之间换，两者都按馆比，所以不用传馆） */
export function useGymScopedPR(): (ex: Exercise) => boolean {
  const kindOf = useLoadKindOf();
  const { signedLoadOf } = useExercisePrefs();
  return useCallback(
    ex => gymScopedKind(kindOf(ex, usesSignedLoad(ex, signedLoadOf(ex)))),
    [kindOf, signedLoadOf],
  );
}
