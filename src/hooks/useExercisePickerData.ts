/**
 * 训练页「添加动作」弹层的数据派生：
 *   - results:       当前 搜索词 × 浏览轴 × 器材 约束下的动作列表（带匹配分）
 *   - equipCounts:   浏览轴+搜索词 约束下各器材的动作数（联动计数，0 的 chip 隐藏）
 *   - axisAvailable: 器材+搜索词 约束下哪些浏览轴还有结果（无结果的 chip 置灰）
 *
 * 浏览轴 = 部位（系统 + 自定义部位标签，单选）∪ 有氧(CARDIO) ∪ 自由(FREE)。
 * 「分类」不再作为独立筛选 UI，但 category 字段照旧存在（决定记录维度）。
 */
import { useMemo } from 'react';
import { useExercisePrefs } from '../contexts/ExercisePrefsContext';
import { useUserSettingsContext } from '../contexts/UserSettingsContext';
import { DEFAULT_EXERCISES, EQUIPMENT_TAGS } from '../constants/exercises';
import { ExerciseDefinition } from '../../types';
import {
  ExerciseSearchEntry,
  buildSearchEntry,
  scoreEntry,
  tokenize,
} from '../utils/exerciseSearch';

export type PickerAxis = { kind: 'part' | 'cat'; v: string } | null;

export interface ScoredExercise {
  ex: ExerciseDefinition;
  score: number;
}

function matchAxis(ex: ExerciseDefinition, axis: PickerAxis): boolean {
  if (!axis) return true;
  if (axis.kind === 'part') {
    return (ex.bodyPart || '').toLowerCase() === axis.v.toLowerCase();
  }
  return (ex.category || 'STRENGTH') === axis.v;
}

function matchEquips(ex: ExerciseDefinition, equips: ReadonlySet<string>): boolean {
  if (equips.size === 0) return true;
  return (ex.tags ?? []).some(t => equips.has((t || '').toLowerCase()));
}

export function useExercisePickerData({
  query,
  axis,
  equips,
}: {
  query: string;
  axis: PickerAxis;
  /** 已选器材 tag id 集合（小写） */
  equips: ReadonlySet<string>;
}) {
  const { customExercises, exerciseOverrides, customTags, getTagName } = useExercisePrefs();
  const { lang } = useUserSettingsContext();

  /** 覆盖合并 + 去隐藏后的完整动作库 */
  const merged = useMemo(() => {
    return [...DEFAULT_EXERCISES, ...customExercises]
      .map(ex => (exerciseOverrides[ex.id] ? { ...ex, ...exerciseOverrides[ex.id] } : ex))
      .filter(ex => !(exerciseOverrides[ex.id] as any)?.hidden)
      .filter(ex => ex.name && ex.name[lang]);
  }, [customExercises, exerciseOverrides, lang]);

  /** 搜索索引（名字/拼音/标签名），随库或标签名变化重建 */
  const index = useMemo(() => {
    const m = new Map<string, ExerciseSearchEntry>();
    for (const ex of merged) {
      const tagNames: string[] = [];
      if (ex.bodyPart) {
        const n = getTagName(ex.bodyPart);
        if (n) tagNames.push(n);
      }
      for (const t of ex.tags ?? []) {
        const n = getTagName(t);
        if (n) tagNames.push(n);
      }
      m.set(ex.id, buildSearchEntry(ex.name.cn ?? '', ex.name.en ?? '', tagNames));
    }
    return m;
  }, [merged, getTagName]);

  const tokens = useMemo(() => tokenize(query), [query]);

  /** 只做搜索匹配（不含轴/器材），供结果与两个联动计数共用 */
  const scored = useMemo<ScoredExercise[]>(() => {
    return merged
      .map(ex => {
        const entry = index.get(ex.id);
        return { ex, score: entry ? scoreEntry(entry, tokens) : 0 };
      })
      .filter(r => r.score > 0);
  }, [merged, index, tokens]);

  const results = useMemo(
    () => scored.filter(r => matchAxis(r.ex, axis) && matchEquips(r.ex, equips)),
    [scored, axis, equips],
  );

  /** 器材 chip 候选：系统器材 + 自定义器材标签 */
  const equipIds = useMemo(
    () => [
      ...EQUIPMENT_TAGS,
      ...customTags.filter(t => t.category === 'equipment').map(t => t.id),
    ],
    [customTags],
  );

  /** 部位轴候选：系统部位在组件侧引入（BODY_PARTS），这里只补自定义部位标签 */
  const customPartIds = useMemo(
    () => customTags.filter(t => t.category === 'bodyPart').map(t => t.id),
    [customTags],
  );

  const equipCounts = useMemo(() => {
    const counts = new Map<string, number>();
    const lowerToId = new Map<string, string>();
    for (const id of equipIds) {
      counts.set(id, 0);
      lowerToId.set(id.toLowerCase(), id);
    }
    for (const { ex } of scored) {
      if (!matchAxis(ex, axis)) continue;
      for (const t of ex.tags ?? []) {
        const id = lowerToId.get((t || '').toLowerCase());
        if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
      }
    }
    return counts;
  }, [scored, axis, equipIds]);

  /** `part:<lowercase id>` / `cat:<CATEGORY>` → 在器材+搜索约束下是否有结果 */
  const axisAvailable = useMemo(() => {
    const avail = new Set<string>();
    for (const { ex } of scored) {
      if (!matchEquips(ex, equips)) continue;
      if (ex.bodyPart) avail.add('part:' + ex.bodyPart.toLowerCase());
      avail.add('cat:' + (ex.category || 'STRENGTH'));
    }
    return avail;
  }, [scored, equips]);

  return { results, equipCounts, axisAvailable, equipIds, customPartIds };
}

export default useExercisePickerData;
