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

/**
 * 覆盖层之后的中英文名。中英原名相同的动作（自建动作都是这样）覆盖层只写了一种语言时，另一种也用它。
 *
 * 2026-10 之前的改名只写当前语言（en-duplicate-renamed）：中文下把自建「悍马卧推」改成「曲肘蝴蝶机」，
 * 覆盖层是 { cn: '曲肘蝴蝶机' }，英文还停在原名，跟另一个「悍马卧推」撞名，点错就记到别的动作下。
 * 现在改名两种语言一起写，旧数据在读的时候补，不用改服务器上的数据。
 * 内置动作中英原名不同，各语言的改名互不影响。
 */
export function mergedName(
  ex: ExerciseDefinition,
  over: Partial<ExerciseDefinition> | undefined,
): ExerciseDefinition['name'] {
  const o = over?.name;
  if (!o) return ex.name;
  if (ex.name.cn === ex.name.en) {
    const one = o.cn || o.en;
    if (one) return { ...ex.name, cn: o.cn || one, en: o.en || one };
  }
  return { ...ex.name, ...o };
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
    name: mergedName(ex, over),
    ...(aliases.length ? { aliases: [...new Set(aliases)] } : {}),
    ...(variants ? { variants } : {}),
    equipment: attrs.equipment,
    resistance: attrs.resistance,
  } as ExerciseDefinition;
}
