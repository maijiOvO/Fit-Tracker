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
import { mergeOverride } from '../utils/exerciseOverride';
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

export function matchAxis(ex: ExerciseDefinition, axis: PickerAxis): boolean {
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
  const { customExercises, exerciseOverrides, customTags, getTagName, effectiveRegion, regionsOf } =
    useExercisePrefs();
  const { lang } = useUserSettingsContext();

  /** 覆盖合并 + 去隐藏后的完整动作库 */
  const merged = useMemo(() => {
    return [...DEFAULT_EXERCISES, ...customExercises]
      .map(ex => mergeOverride(ex, exerciseOverrides[ex.id]))
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
      // 曾用名也能搜到（搜「杠铃上斜卧推」找得到改名后的「上斜杠铃卧推」）
      tagNames.push(...(ex.aliases ?? []));
      // 细分名也能搜到（搜「上胸」出整列）
      const rg = effectiveRegion(ex);
      if (rg) tagNames.push(getTagName(rg));
      m.set(ex.id, buildSearchEntry(ex.name.cn ?? '', ex.name.en ?? '', tagNames));
    }
    return m;
  }, [merged, getTagName, effectiveRegion]);

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

  /**
   * 搜索不再被部位锁死（第 3 条）：有搜索词时不按浏览轴过滤，弹层把当前部位的排前面、
   * 其他部位的接在下面。原先从印谱进来就选着胸，搜「三头」会说「动作库里没有」。
   * 器材是手动点的筛选，照旧生效。
   */
  const searching = tokens.length > 0;
  /** 细分格：选了有细分的部位、且没在搜索。格子里只摆力量动作（有氧不进细分列） */
  const boardPart =
    !searching && axis?.kind === 'part' && regionsOf(axis.v).length > 0 ? axis.v : null;
  const inScope = (ex: ExerciseDefinition) =>
    (searching || matchAxis(ex, axis)) &&
    (!boardPart || (ex.category || 'STRENGTH') === 'STRENGTH');

  const results = useMemo(
    () => scored.filter(r => inScope(r.ex) && matchEquips(r.ex, equips)),
    [scored, axis, equips, searching, boardPart],
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
    // 口径跟结果一致：搜索时不按部位算；细分格里只算力量动作
    for (const { ex } of scored) {
      if (!inScope(ex)) continue;
      for (const t of ex.tags ?? []) {
        const id = lowerToId.get((t || '').toLowerCase());
        if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
      }
    }
    return counts;
  }, [scored, axis, equipIds, searching, boardPart]);

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

  return { results, equipCounts, axisAvailable, equipIds, customPartIds, boardPart, searching };
}

export default useExercisePickerData;
