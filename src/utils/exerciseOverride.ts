/**
 * 动作定义 + 覆盖层（exerciseOverrides[id]）的合并。
 *
 * 覆盖层里的 name 只写了改名时那一种语言（{ cn: '新名' }），
 * 原先 `{ ...ex, ...override }` 整对象替换 → name.en 丢了，
 * 中文下改过名的动作在英文模式的弹层 / 动作库里直接消失。名字必须按语言合并。
 * aliases 两边都有时取并集（内置的旧名 + 用户改名留下的旧名）。
 */
import type { ExerciseDefinition } from '../../types';

export function mergeOverride(
  ex: ExerciseDefinition,
  over: Partial<ExerciseDefinition> | undefined,
): ExerciseDefinition {
  if (!over) return ex;
  const aliases = [...(ex.aliases ?? []), ...(over.aliases ?? [])];
  return {
    ...ex,
    ...over,
    name: { ...ex.name, ...(over.name ?? {}) },
    ...(aliases.length ? { aliases: [...new Set(aliases)] } : {}),
  } as ExerciseDefinition;
}
