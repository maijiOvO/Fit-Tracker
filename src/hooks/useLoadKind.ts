/**
 * 「这个动作的重量怎么画」—— 「杠铃片」规格 docs/design-plates.md §3 的五种原型。
 *
 * 训练里的 Exercise 身上不带器材标签（buildExercise 不写 tags），只能回动作库查：
 * 动作定义 + 覆盖层，变体自己设过器材的以变体为准（[] = 跟随动作）。
 * 手打的、库里查不到的动作 → 纯数字。
 */
import { useCallback } from 'react';
import { useExercisePrefs } from '../contexts/ExercisePrefsContext';
import { mergeOverride } from '../utils/exerciseOverride';
import type { Exercise } from '../../types';

export type LoadKind = 'plates' | 'pin' | 'pair' | 'signed' | 'plain';

/**
 * 多个器材标签时的取法：带符号负荷最先（自重动作挂了腰片也还是自重），
 * 其余按「配片 > 插销 > 成对 > 纯数字」取第一个。
 */
export function loadKindFromTags(tags: readonly string[] | undefined, signed: boolean): LoadKind {
  if (signed) return 'signed';
  const t = tags ?? [];
  if (t.includes('tagBarbell')) return 'plates';
  if (t.includes('tagMachine') || t.includes('tagCable')) return 'pin';
  if (t.includes('tagDumbbell')) return 'pair';
  return 'plain';
}

/** 返回一个查询函数：(训练里的动作, 它是不是带符号负荷) → 画法 */
export function useLoadKindOf(): (ex: Pick<Exercise, 'name' | 'variantId'>, signed: boolean) => LoadKind {
  const { findExerciseDef, exerciseOverrides, variantsOf, variantIdOf } = useExercisePrefs();
  return useCallback(
    (ex, signed) => {
      if (signed) return 'signed';
      const def = findExerciseDef(ex.name);
      if (!def) return 'plain';
      const merged = mergeOverride(def, exerciseOverrides[def.id]);
      const vid = variantIdOf(ex);
      const vTags = vid ? variantsOf(ex.name).find((v) => v.id === vid)?.tags : undefined;
      return loadKindFromTags(vTags && vTags.length ? vTags : merged.tags, false);
    },
    [findExerciseDef, exerciseOverrides, variantsOf, variantIdOf],
  );
}
