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
import { DEFAULT_EXERCISES } from '../constants/exercises';
import { regionList, variantAttrs } from '../utils/exerciseAttrs';
import { ExerciseDefinition } from '../../types';
import { mergeOverride } from '../utils/exerciseOverride';
import { translations } from '../../translations';
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
  /**
   * 搜的是某个做法的名字（「宽握」，或并进来的旧名）、动作名本身对不上：点它就加这个做法，不加标准（审查 A13）
   */
  variant?: { id: string; name: string };
}

export function matchAxis(ex: ExerciseDefinition, axis: PickerAxis): boolean {
  if (!axis) return true;
  if (axis.kind === 'part') {
    return (ex.bodyPart || '').toLowerCase() === axis.v.toLowerCase();
  }
  return (ex.category || 'STRENGTH') === axis.v;
}

/**
 * 动作用到的全部器材（小写）：动作本身 + 各做法自己设的。
 * 筛「哑铃」时罗马尼亚硬拉也该出来 —— 它的哑铃做法就是哑铃做的。
 */
export function equipmentsOf(ex: ExerciseDefinition): string[] {
  const out = new Set<string>();
  if (ex.equipment) out.add(ex.equipment.toLowerCase());
  for (const v of ex.variants ?? []) {
    const a = variantAttrs(v);
    if (a?.equipment) out.add(a.equipment.toLowerCase());
  }
  return [...out];
}

function matchEquips(ex: ExerciseDefinition, equips: ReadonlySet<string>): boolean {
  if (equips.size === 0) return true;
  return equipmentsOf(ex).some(t => equips.has(t));
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
  const {
    customExercises,
    exerciseOverrides,
    customTags,
    getTagName,
    effectiveRegions,
    effectivePart,
    regionsOf,
    equipmentIds,
    withVariantNames,
  } = useExercisePrefs();
  const { lang } = useUserSettingsContext();

  /** 覆盖合并后的完整动作库（含已删除＝隐藏的） */
  const library = useMemo(() => {
    return [...DEFAULT_EXERCISES, ...customExercises]
      .map(ex => {
        const m = mergeOverride(ex, exerciseOverrides[ex.id]);
        // 内置做法 name 留空（显示器材名）：卡片、搜索都拿得到名字
        return m.variants?.some(v => !v.name) ? { ...m, variants: withVariantNames(m.variants) } : m;
      })
      .filter(ex => ex.name && ex.name[lang]);
  }, [customExercises, exerciseOverrides, lang, withVariantNames]);
  const merged = useMemo(() => library.filter(ex => !ex.hidden), [library]);
  const byId = useMemo(() => new Map(library.map(ex => [ex.id, ex])), [library]);
  /** 整理的「已删除」托盘（并入了别的动作的不算：它已经是那个动作的一个做法） */
  const deleted = useMemo(() => library.filter(ex => ex.hidden && !ex.mergedInto), [library]);
  /** 整理的「未分部位」：力量动作没有部位，或部位（自建）已被删掉 */
  const noPart = useMemo(
    () => merged.filter(ex => (ex.category || 'STRENGTH') === 'STRENGTH' && !effectivePart(ex)),
    [merged, effectivePart],
  );

  /** 搜索索引（名字/拼音/标签名），随库或标签名变化重建 */
  const index = useMemo(() => {
    const m = new Map<string, ExerciseSearchEntry>();
    // 系统部位 / 器材 / 细分两种语言的名字都能搜（英文界面搜「胸」、中文界面搜 chest 都找得到）
    const namesOf = (tid: string): string[] => {
      const key = Object.keys(translations).find(k => k.toLowerCase() === tid.toLowerCase());
      const t = key ? (translations as Record<string, { en: unknown; cn: unknown }>)[key] : null;
      return [getTagName(tid), ...(t ? [t.en, t.cn] : [])].filter((n): n is string => typeof n === 'string' && !!n);
    };
    for (const ex of merged) {
      const tagNames: string[] = [];
      if (ex.bodyPart) tagNames.push(...namesOf(ex.bodyPart));
      for (const t of equipmentsOf(ex)) tagNames.push(...namesOf(t));
      // 曾用名也能搜到（搜「杠铃上斜卧推」找得到改名后的「上斜杠铃卧推」）
      tagNames.push(...(ex.aliases ?? []));
      // 做法名也能搜到（搜「宽握」出高位下拉），并进来的旧名同理
      for (const v of ex.variants ?? []) tagNames.push(v.name);
      tagNames.push(...Object.keys(ex.variantAliases ?? {}));
      // 细分名也能搜到（搜「上胸」出整列）：次要细分也算（搜「臀」出深蹲，2026-10-21），做法的细分也算
      const rgs = new Set(effectiveRegions(ex));
      for (const v of ex.variants ?? []) for (const r of regionList(v)) rgs.add(r);
      for (const r of rgs) tagNames.push(...namesOf(r));
      m.set(ex.id, buildSearchEntry(ex.name.cn ?? '', ex.name.en ?? '', tagNames));
    }
    return m;
  }, [merged, getTagName, effectiveRegions]);

  const tokens = useMemo(() => tokenize(query), [query]);

  /** 只做搜索匹配（不含轴/器材），供结果与两个联动计数共用 */
  const scored = useMemo<ScoredExercise[]>(() => {
    return merged
      .map((ex): ScoredExercise => {
        const entry = index.get(ex.id);
        const score = entry ? scoreEntry(entry, tokens) : 0;
        if (!score || !tokens.length) return { ex, score };
        // 动作名（中英、曾用名）本身就对得上：照旧是这个动作；对不上、是做法名对上的：带上那个做法
        const names = [ex.name.cn ?? '', ex.name.en ?? '', ...(ex.aliases ?? [])];
        if (names.some(n => scoreEntry(buildSearchEntry(n, n, []), tokens) > 0)) return { ex, score };
        const hit = (ex.variants ?? []).find(
          v => v.name && scoreEntry(buildSearchEntry(`${ex.name.cn ?? ''}${v.name}`, `${ex.name.en ?? ''} ${v.name}`, [v.name]), tokens) > 0,
        );
        if (hit) return { ex, score, variant: { id: hit.id, name: hit.name } };
        // 并进来的旧名 → 它变成的那个做法
        for (const [alias, vid] of Object.entries(ex.variantAliases ?? {})) {
          const v = (ex.variants ?? []).find(x => x.id === vid);
          if (v && scoreEntry(buildSearchEntry(alias, alias, []), tokens) > 0) return { ex, score, variant: { id: v.id, name: v.name } };
        }
        return { ex, score };
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

  /** 器材 chip 候选：内置器材 + 自建器材 */
  const equipIds = equipmentIds;

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
      for (const t of equipmentsOf(ex)) {
        const id = lowerToId.get(t);
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

  return {
    results,
    equipCounts,
    axisAvailable,
    equipIds,
    customPartIds,
    boardPart,
    searching,
    merged,
    byId,
    deleted,
    noPart,
  };
}

export default useExercisePickerData;
