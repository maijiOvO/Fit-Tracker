/**
 * 动作定义 + 覆盖层（exerciseOverrides[id]）的合并。
 *
 * 覆盖层里的 name 只写了改名时那一种语言（{ cn: '新名' }），
 * 原先 `{ ...ex, ...override }` 整对象替换 → name.en 丢了，
 * 中文下改过名的动作在英文模式的弹层 / 动作库里直接消失。名字必须按语言合并。
 * aliases 两边都有时取并集（内置的旧名 + 用户改名留下的旧名）。
 *
 * 器材 / 阻力按层取（exerciseAttrs.layerAttrs）：覆盖层写过就整组用覆盖层的（旧数据只有 tags 的当场换算），
 * 不然用定义的。合并结果一律带 equipment（'' = 无器材），读处不用再管旧 tags。
 */
import type { ExerciseDefinition } from '../../types';
import { translations } from '../../translations';
import { combineVariants, layerAttrs } from './exerciseAttrs';

/** 内置器材的中英文名（认「用户早先自己建的同名做法」用） */
export function equipmentNames(id: string): string[] {
  const t = (translations as Record<string, { cn: string; en: string } | undefined>)[id];
  return t ? [t.cn, t.en] : [];
}

/** 动作的做法表：覆盖层的 + 读时合并进来的内置做法（见 combineVariants） */
export function mergedVariants(ex: ExerciseDefinition, over: Partial<ExerciseDefinition> | undefined) {
  return combineVariants(ex.variants, over?.variants, over?.removedVariants, equipmentNames);
}

export function mergeOverride(
  ex: ExerciseDefinition,
  over: Partial<ExerciseDefinition> | undefined,
): ExerciseDefinition {
  const attrs = layerAttrs(over, ex.id) ?? layerAttrs(ex, ex.id) ?? { equipment: '' };
  if (!over) {
    return ex.equipment === attrs.equipment && ex.resistance === attrs.resistance
      ? ex
      : { ...ex, equipment: attrs.equipment, resistance: attrs.resistance };
  }
  const aliases = [...(ex.aliases ?? []), ...(over.aliases ?? [])];
  const variants = mergedVariants(ex, over);
  /**
   * 旧覆盖层（多选细分之前写的）只有 region、没有 regions：那是「主细分换成这个」。
   * 直接展开会留着定义的 regions，定义原来的主细分就混成了次要细分（审查 A15）：去掉它，次要的照留。
   */
  const legacyRegion =
    over.region !== undefined && over.regions === undefined && ex.region && over.region !== ex.region
      ? { regions: (ex.regions ?? []).filter(r => r !== ex.region) }
      : {};
  return {
    ...ex,
    ...over,
    ...legacyRegion,
    name: { ...ex.name, ...(over.name ?? {}) },
    ...(aliases.length ? { aliases: [...new Set(aliases)] } : {}),
    ...(variants ? { variants } : {}),
    equipment: attrs.equipment,
    resistance: attrs.resistance,
  } as ExerciseDefinition;
}
