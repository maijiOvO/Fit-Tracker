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
import { layerAttrs } from './exerciseAttrs';

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
  return {
    ...ex,
    ...over,
    name: { ...ex.name, ...(over.name ?? {}) },
    ...(aliases.length ? { aliases: [...new Set(aliases)] } : {}),
    equipment: attrs.equipment,
    resistance: attrs.resistance,
  } as ExerciseDefinition;
}
