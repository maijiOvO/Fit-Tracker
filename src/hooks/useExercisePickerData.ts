/**
 * 训练页「添加动作」弹层的数据派生：
 *   - results:       当前 搜索词 × 浏览轴 × 器材 约束下的动作列表（带匹配分）
 *   - equipCounts:   浏览轴+搜索词 约束下各器材的动作数（联动计数，0 的 chip 隐藏）
 *   - axisAvailable: 器材+搜索词 约束下哪些浏览轴还有结果（无结果的 chip 置灰）
 *
 * 浏览轴 = 部位（系统 + 自定义部位标签，单选）∪ 有氧(CARDIO) ∪ 自由(FREE)。
 * 「分类」不再作为独立筛选 UI，但 category 字段照旧存在（决定记录维度）。
 */
import { useEffect, useMemo, useState } from 'react';
import { useExercisePrefs } from '../contexts/ExercisePrefsContext';
import { useUserSettingsContext } from '../contexts/UserSettingsContext';
import { DEFAULT_EXERCISES } from '../constants/exercises';
import { regionList, variantAttrs } from '../utils/exerciseAttrs';
import type { Exercise, ExerciseDefinition, WorkoutSession } from '../../types';
import type { LiftSession, LiftSummary } from '../utils/liftHistory';
import { findLastIn } from '../utils/prefillSource';
import { cardSourceFor } from '../utils/liftIdentity';
import { mergeOverride } from '../utils/exerciseOverride';
import { translations } from '../../translations';
import {
  ExerciseSearchEntry,
  buildSearchEntry,
  loadPinyin,
  pinyinLoaded,
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
    // 热身用途挂在这个部位的也算（手臂绕环没有训练部位，但在胸部、肩部的热身里）
    const v = axis.v.toLowerCase();
    return (ex.bodyPart || '').toLowerCase() === v || (ex.warmParts ?? []).some(p => p.toLowerCase() === v);
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

/**
 * 行上小灰字「上次 …」那一场：和点这一行铺的底稿同一场（useWorkoutMutations 加动作 = findLastIn，
 * 母行不分做法、做法行只认那个做法；preferGym 由调用方按器械类本馆优先给，同 preferGymFor；
 * 补加旧训练 / 补录时 before＝那一场的时间，同底稿只看那天之前的，审查 C102）。
 * 返回那一场在逐场数据里的样子（最重一组）和它的做法 —— 母行据此写出做法名（审查 C1）。
 * liftsById：useLiftSummaries 按稳定键「定义 id|做法 id」。
 */
export function rowLastSession(
  workouts: WorkoutSession[],
  liftsById: Map<string, LiftSummary>,
  resolveName: (n: string) => string,
  variantIdOf: (ex: Exercise) => string | undefined,
  /** 这个做法 id 还在做法表里：上一次的做法删了，点行按标准铺（cardSourceFor），这里也写标准的那一场 */
  live: (vid: string) => boolean,
  ex: { id: string; name: string },
  vid: string | undefined,
  skipWorkoutId: string | undefined,
  preferGym: string | undefined,
  before?: string,
): { session: LiftSession; variantId?: string } | null {
  // 弹层的行用的是动作库里的现名，不会是并入别名
  const { last: hit, variantId } = cardSourceFor({
    name: ex.name,
    variantId: vid,
    aliasOf: () => undefined,
    resolveName,
    live,
    findLast: v => findLastIn(workouts, resolveName, variantIdOf, ex.name, v, skipWorkoutId, preferGym, before),
    variantIdOf,
  });
  if (!hit) return null;
  // 按场找：逐场数据里一场是这个项目的全部卡合起来的，exerciseId 只是第一张有做完组的
  const session = liftsById.get(`${ex.id}|${variantId ?? ''}`)?.sessions.find(s => s.workoutId === hit.workout.id);
  return session ? { session, variantId } : null;
}

/**
 * 分部位浏览时组内的顺序（审查 C2）：收藏（星多的在前）→ 练过的按上次练的时间倒序 → 没练过的照库序。
 * 不用全局「最近 12 个」：练胸那天它装的是前两场腿、背的动作，胸的组里一个都不算最近，常用的自建动作沉到组尾。
 * items 按库序给；返回 id → 名次。
 */
export function browseRank<T extends { id: string }>(
  items: T[],
  starOf: (x: T) => number | undefined,
  lastTsOf: (x: T) => number,
): Map<string, number> {
  const keyed = items.map((x, i) => ({ x, i, star: starOf(x), ts: lastTsOf(x) }));
  keyed.sort((a, b) => {
    if ((a.star !== undefined) !== (b.star !== undefined)) return a.star !== undefined ? -1 : 1;
    if (a.star !== undefined && b.star !== undefined && a.star !== b.star) return b.star - a.star;
    if (a.star === undefined && a.ts !== b.ts) return b.ts - a.ts;
    return a.i - b.i;
  });
  return new Map(keyed.map((k, i) => [k.x.id, i]));
}

/**
 * 器材筛选只认还在的器材（上架审查 C98）：正在筛的自建器材在整理里被删掉后，原来列表一直是空的、筛选也取消不了。
 * 一个都没剔掉时原样返回（筛选记忆和跨开合保留不变，撤销删除后照旧生效）。
 */
export function liveEquips(equips: ReadonlySet<string>, equipIds: readonly string[]): ReadonlySet<string> {
  const ids = new Set(equipIds.map(x => x.toLowerCase()));
  const live = [...equips].filter(e => ids.has(e.toLowerCase()));
  return live.length === equips.size ? equips : new Set(live);
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
    orphanMerges,
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
  /**
   * 整理的「已删除」托盘（并入了别的动作的不算：它已经是那个动作的一个做法）。
   * 并入生成的做法已经被删掉的（孤儿，审查 C29 的存量）照样列出来：恢复＝拆回成独立动作
   */
  const deleted = useMemo(() => {
    const orphan = new Set(orphanMerges.map(d => d.id));
    return library.filter(ex => ex.hidden && (!ex.mergedInto || orphan.has(ex.id)));
  }, [library, orphanMerges]);
  /** 整理的「未分部位」：力量动作没有部位，或部位（自建）已被删掉；只当热身的不算（它本来就不归部位） */
  const noPart = useMemo(
    () => merged.filter(ex => (ex.category || 'STRENGTH') === 'STRENGTH' && !effectivePart(ex) && !(ex.warmOnly && ex.warmParts?.length)),
    [merged, effectivePart],
  );

  // 拼音字典随弹层第一次挂上才去拿，到了重建一次索引（exerciseSearch 头注）
  const [pyReady, setPyReady] = useState(pinyinLoaded);
  useEffect(() => {
    if (!pyReady) loadPinyin().then(() => setPyReady(pinyinLoaded()));
  }, [pyReady]);

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
      // 搜「热身」出全部热身动作
      if (ex.warmParts?.length) tagNames.push('热身', 'warm-up');
      m.set(ex.id, buildSearchEntry(ex.name.cn ?? '', ex.name.en ?? '', tagNames));
    }
    return m;
    // pyReady 不在函数体里读：放进依赖是为了字典到了重算（buildSearchEntry 读的是模块里的字典）
  }, [merged, getTagName, effectiveRegions, pyReady]);

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
  /** 选了有细分的部位、且没在搜索：细分组里只摆力量动作（有氧不进细分）；热身组什么类别都行（跑步机热身） */
  const boardPart =
    !searching && axis?.kind === 'part' && regionsOf(axis.v).length > 0 ? axis.v : null;
  const inScope = (ex: ExerciseDefinition) =>
    (searching || matchAxis(ex, axis)) &&
    (!boardPart || (ex.category || 'STRENGTH') === 'STRENGTH' || (ex.warmParts ?? []).some(p => p.toLowerCase() === boardPart.toLowerCase()));

  /** 器材 chip 候选：内置器材 + 自建器材 */
  const equipIds = equipmentIds;
  const activeEquips = useMemo(() => liveEquips(equips, equipIds), [equips, equipIds]);

  const results = useMemo(
    () => scored.filter(r => inScope(r.ex) && matchEquips(r.ex, activeEquips)),
    [scored, axis, activeEquips, searching, boardPart],
  );
  /**
   * 搜索时被器材筛选挡掉的（上架审查 C99）：原来逐字同名的动作被挡住时还给「创建」，照做被拒「已经有了」或建出重复的自建动作。
   * 弹层据此写「另有 N 个被器材筛选挡住」并给清除筛选，判重也算上它们。
   */
  const blocked = useMemo(
    () => (searching && activeEquips.size ? scored.filter(r => inScope(r.ex) && !matchEquips(r.ex, activeEquips)) : []),
    [scored, axis, activeEquips, searching, boardPart],
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
      if (!matchEquips(ex, activeEquips)) continue;
      if (ex.bodyPart) avail.add('part:' + ex.bodyPart.toLowerCase());
      for (const p of ex.warmParts ?? []) avail.add('part:' + p.toLowerCase());
      avail.add('cat:' + (ex.category || 'STRENGTH'));
    }
    return avail;
  }, [scored, activeEquips]);

  return {
    searching,
    results,
    blocked,
    activeEquips,
    equipCounts,
    axisAvailable,
    equipIds,
    customPartIds,
    merged,
    byId,
    deleted,
    noPart,
  };
}
