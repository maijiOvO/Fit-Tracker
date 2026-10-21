/**
 * 「这个动作的重量怎么画、怎么算」—— 「杠铃片」规格 docs/design-plates.md §3 的原型。
 *
 * 训练里的 Exercise 身上不带器材标签（buildExercise 不写 tags），只能回动作库查：
 * 动作定义 + 覆盖层，变体（做法）自己设过器材的以做法为准（[] = 跟随动作）。
 * 手打的、库里查不到的动作 → 纯数字。
 *
 * 同一个动作能用几种器材做（罗马尼亚硬拉：杠铃 / 哑铃）→ 拆成同一个动作的不同做法，各自设器材标签
 * （2026-10-18 用户定）；没拆的按下面的优先级取第一个。
 */
import { useCallback } from 'react';
import { useExercisePrefs } from '../contexts/ExercisePrefsContext';
import { useUserSettingsContext } from '../contexts/UserSettingsContext';
import { mergeOverride } from '../utils/exerciseOverride';
import type { Exercise } from '../../types';
import { usesSignedLoad } from '../utils/load';

/**
 * plates：杠铃（杆重 + 两边对称挂片）；loaded：挂片式器械（史密斯 / 倒蹬 / 哈克 / T 杠，按杠铃那样算但只算片子，
 * 2026-10-18 用户定）；pin：配重片插销（器械 / 龙门架）；pair：哑铃；signed：带符号负荷（辅助负 / 负重正）；plain：纯数字。
 */
export type LoadKind = 'plates' | 'loaded' | 'pin' | 'pair' | 'signed' | 'plain';

/** 内置动作里的挂片式器械：标签是 tagMachine / tagBarbell，但实际是往上挂片 */
export const PLATE_LOADED_IDS = new Set(['bp_smith', 'bp_incline_smith', 'ohp_smith', 'leg_press', 'hack_squat', 'tbar_row']);

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
 * 多个器材标签时的取法：带符号负荷最先（自重动作挂了腰片也还是自重），
 * 其余按「挂片器械 > 杠铃 > 配重片 > 哑铃 > 纯数字」取第一个。
 */
export function loadKindFromTags(tags: readonly string[] | undefined, signed: boolean, defId?: string): LoadKind {
  if (signed) return 'signed';
  if (defId && PLATE_LOADED_IDS.has(defId)) return 'loaded';
  const t = tags ?? [];
  if (t.includes('tagBarbell')) return 'plates';
  if (t.includes('tagMachine') || t.includes('tagCable')) return 'pin';
  if (t.includes('tagDumbbell')) return 'pair';
  return 'plain';
}

/**
 * 返回一个查询函数：(训练里的动作, 它是不是带符号负荷, 这场的馆) → 画法与算法。
 * 传了馆：库里是插销 / 挂片的动作按这个馆记住的形式走（gymKinds）；不传就是动作库的形式。
 */
export function useLoadInfoOf(): (ex: Pick<Exercise, 'name' | 'variantId'>, signed: boolean, gym?: string) => LoadInfo {
  const { findExerciseDef, exerciseOverrides, variantsOf, variantIdOf } = useExercisePrefs();
  const gymKinds = useUserSettingsContext().appPrefs.gymKinds;
  return useCallback(
    (ex, signed, gym) => {
      const def = findExerciseDef(ex.name);
      const vid = variantIdOf(ex);
      if (!def) {
        const k: LoadKind = signed ? 'signed' : 'plain';
        return { kind: k, libKind: k, stack: 'machine', variantId: vid };
      }
      const merged = mergeOverride(def, exerciseOverrides[def.id]);
      const vTags = vid ? variantsOf(ex.name).find((v) => v.id === vid)?.tags : undefined;
      const tags = vTags && vTags.length ? vTags : merged.tags;
      // 做法自己设了器材标签时，内置的「挂片器械」名单不再作数（那个做法也许是哑铃做的）
      const libKind = loadKindFromTags(tags, signed, vTags && vTags.length ? undefined : def.id);
      const stack = (tags ?? []).includes('tagCable') ? 'cable' : 'machine';
      const key = gymSwitchableKind(libKind) ? gymMachineKey(gym, { defId: def.id, variantId: vid }) : null;
      const kind = (key && gymKinds[key]) || libKind;
      return { kind, libKind, stack, defId: def.id, variantId: vid };
    },
    [findExerciseDef, exerciseOverrides, variantsOf, variantIdOf, gymKinds],
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
 * 杠铃、哑铃、带正负的负荷是真重量，跨馆照常比。
 */
export function gymScopedKind(kind: LoadKind): boolean {
  return kind === 'pin' || kind === 'loaded';
}

/** (动作) => 这个动作的纪录要不要只在同一个馆里比（按馆改形式只在插销 / 挂片之间换，两者都按馆比，所以不用传馆） */
export function useGymScopedPR(): (ex: Exercise) => boolean {
  const kindOf = useLoadKindOf();
  const { signedLoadOf } = useExercisePrefs();
  return useCallback(
    ex => gymScopedKind(kindOf(ex, usesSignedLoad(ex, signedLoadOf(ex.name)))),
    [kindOf, signedLoadOf],
  );
}
