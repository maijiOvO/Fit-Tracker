/**
 * 并入、拆回、删做法、新建做法：先用纯函数算出动作库的新状态（customExercises + exerciseOverrides），
 * ExercisePrefsContext 一次写入（审查第 17 批）。原来 unmergeExercise 拿闭包里的旧 variantAliases 整字段覆盖，
 * 同一次手势里连调两次，第一个来源的名字又被写回去；删做法也只从 variants 里删一条，不管指向它的别名和并入来源。
 *
 * 写法规矩和 context 原来的 writeDefField 一样：自建动作写定义本身，内置动作写覆盖层。
 */
import type { ExerciseDefinition, ExerciseVariant } from '../../types';
import { mergeOverride } from './exerciseOverride';
import { attrsPatch, regionList, regionsPatch } from './exerciseAttrs';
import { ownValue } from './nameIndex';

export interface LibState {
  customs: ExerciseDefinition[];
  overrides: Record<string, Partial<ExerciseDefinition>>;
}

/** 并入时写进目标 variantAliases 的名字（已合并覆盖层的 source）；拆回时按同一份删 */
export function mergeNamesOf(s: ExerciseDefinition): string[] {
  return [s.name.cn, s.name.en, ...(s.aliases ?? []), ...Object.keys(s.variantAliases ?? {})]
    .map(n => (n || '').trim())
    .filter(Boolean);
}

function rawDef(builtins: ExerciseDefinition[], st: LibState, id: string): ExerciseDefinition | undefined {
  return builtins.find(d => d.id === id) ?? st.customs.find(d => d.id === id);
}

function mergedDef(builtins: ExerciseDefinition[], st: LibState, id: string): ExerciseDefinition | undefined {
  const d = rawDef(builtins, st, id);
  return d && mergeOverride(d, st.overrides[id]);
}

function writeDef(st: LibState, id: string, patch: Partial<ExerciseDefinition>): LibState {
  if (st.customs.some(c => c.id === id)) {
    return { ...st, customs: st.customs.map(c => (c.id === id ? { ...c, ...patch } : c)) };
  }
  return { ...st, overrides: { ...st.overrides, [id]: { ...(st.overrides[id] || {}), ...patch } } };
}

/**
 * 写一个动作的做法表。内置做法不在新表里 = 用户删掉了，记进 removedVariants（读时合并就不再补回）；
 * 用户自己的做法删掉时整条（id、名字、器材、细分）进墓碑 deletedVariants，同名新建时接回旧 id（审查 gap-6#7）。
 * 墓碑里已经回到表上的那条随手摘掉。
 */
export function withVariantsIn(
  builtins: ExerciseDefinition[],
  st: LibState,
  defId: string,
  next: ExerciseVariant[],
): LibState {
  const def = rawDef(builtins, st, defId);
  if (!def) return st;
  const isCustom = st.customs.some(c => c.id === defId);
  const before = mergeOverride(def, st.overrides[defId]);
  const builtinIds = isCustom ? [] : (def.variants ?? []).map(v => v.id);
  const dropped = (before.variants ?? []).filter(v => !next.some(n => n.id === v.id) && !builtinIds.includes(v.id));
  const deletedVariants = [...(before.deletedVariants ?? []).filter(v => !next.some(n => n.id === v.id) && !dropped.some(d => d.id === v.id)), ...dropped];
  const tomb = deletedVariants.length ? { deletedVariants } : { deletedVariants: undefined };
  if (isCustom) {
    return { ...st, customs: st.customs.map(c => (c.id === defId ? stripUndef({ ...c, variants: next, ...tomb }) : c)) };
  }
  const removed = builtinIds.filter(id => !next.some(v => v.id === id));
  const cur: Partial<ExerciseDefinition> = { ...(st.overrides[defId] || {}), variants: next, ...tomb };
  if (removed.length) cur.removedVariants = removed;
  else delete cur.removedVariants;
  return { ...st, overrides: { ...st.overrides, [defId]: stripUndef(cur) } };
}

function stripUndef<T extends object>(o: T): T {
  const out = { ...o } as Record<string, unknown>;
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
  return out as T;
}

/**
 * 新建做法：名字撞上墓碑里的做法就接回它（同名不止一条取最后删的那条），带回器材和细分；
 * 撞上被删的内置做法就把它放回表上（removedVariants 由 withVariantsIn 重算）。都没有才用 newId。
 * builtinRemoved：这个动作被删掉的内置做法，name 已补成当前语言的器材名。
 */
export function planAddVariant(
  own: ExerciseVariant[],
  tombstones: ExerciseVariant[] | undefined,
  builtinRemoved: ExerciseVariant[],
  name: string,
  newId: string,
): { list: ExerciseVariant[]; tombstones: ExerciseVariant[]; id: string } {
  const tomb = [...(tombstones ?? [])];
  for (let i = tomb.length - 1; i >= 0; i--) {
    if (tomb[i].name !== name) continue;
    const [back] = tomb.splice(i, 1);
    return { list: [...own, back], tombstones: tomb, id: back.id };
  }
  const builtin = builtinRemoved.find(v => v.name === name);
  if (builtin) return { list: [...own, { ...builtin, name: '' }], tombstones: tomb, id: builtin.id };
  return { list: [...own, { id: newId, name }], tombstones: tomb, id: newId };
}

/** 改名改成墓碑里的名字：拒绝（要接回旧记录就新建同名做法；改过去会和墓碑里那条分成两个同名的） */
export function variantRenameBlocked(tombstones: ExerciseVariant[] | undefined, name: string): boolean {
  return !!tombstones?.some(v => v.name === name);
}

/** 拆回若干个并入的动作：一次算完，目标的 variantAliases 去掉它们全部的名字 */
export function planUnmerge(builtins: ExerciseDefinition[], st: LibState, sourceIds: string[]): LibState {
  let out = st;
  for (const sid of sourceIds) {
    const tgtId = out.overrides[sid]?.mergedInto;
    const s = mergedDef(builtins, out, sid);
    const t = tgtId ? mergedDef(builtins, out, tgtId) : undefined;
    if (!s || !t || !tgtId) continue;
    const aliases = { ...(t.variantAliases ?? {}) };
    for (const n of mergeNamesOf(s)) delete aliases[n];
    out = writeDef(out, tgtId, { variantAliases: aliases });
    const { mergedInto: _m, hidden: _h, ...rest } = out.overrides[sid] || {};
    out = { ...out, overrides: { ...out.overrides, [sid]: rest } };
  }
  return out;
}

/** 并进 target 的这个做法的旧动作（只看直接并进来的一层） */
export function mergedSourcesIn(builtins: ExerciseDefinition[], st: LibState, targetId: string, variantId: string): string[] {
  const t = mergedDef(builtins, st, targetId);
  if (!t) return [];
  const aliases = t.variantAliases ?? {};
  return [...builtins, ...st.customs]
    .filter(d => st.overrides[d.id]?.mergedInto === targetId)
    .filter(d => mergeNamesOf(mergeOverride(d, st.overrides[d.id])).some(n => aliases[n] === variantId))
    .map(d => d.id);
}

/**
 * 删做法（审查 C29）：并入生成的做法先把并进来的旧动作全部拆回，再删 —— 不然靠别名认做法的旧记录
 * 不带 variantName，「删做法后按记录里的名字单独显示」对它们不起作用，整批并进目标的「标准」。
 * 返回拆回了哪几个（toast 用）。
 */
export function planRemoveVariant(
  builtins: ExerciseDefinition[],
  st: LibState,
  targetId: string,
  variantId: string,
): { state: LibState; unmerged: string[] } {
  const unmerged = mergedSourcesIn(builtins, st, targetId, variantId);
  const after = planUnmerge(builtins, st, unmerged);
  const t = mergedDef(builtins, after, targetId);
  if (!t) return { state: st, unmerged: [] };
  const raw = mergeOverride(rawDef(builtins, after, targetId)!, after.overrides[targetId]).variants ?? [];
  return { state: withVariantsIn(builtins, after, targetId, raw.filter(v => v.id !== variantId)), unmerged };
}

/**
 * 并入（2.5 整理用）：source 变成 target 的一个做法（带着 source 的细分和器材），source 从动作库消失。
 * 做法名：source 的名字去掉 target 的名字（「窄距高位下拉」并进「高位下拉」→「窄距」），去完是空的就用全名；
 * 跟 target 现有的做法重名就直接认那个做法，墓碑里有同名的就接回它。
 * moves：馆设置要复制的键段（「|源 id|做法」→「|目标 id|做法」），和 liftIdentity.variantIdIn 的命名空间同一规则。
 */
export function planMerge(
  builtins: ExerciseDefinition[],
  st: LibState,
  sourceId: string,
  targetId: string,
  o: { lang: 'cn' | 'en'; named: (list: ExerciseVariant[] | undefined) => ExerciseVariant[]; newId: string },
): { state: LibState; moves: [string, string][]; srcName: string; tgtName: string; variantName: string } | null {
  if (sourceId === targetId) return null;
  const s = mergedDef(builtins, st, sourceId);
  const t = mergedDef(builtins, st, targetId);
  if (!s || !t) return null;
  const srcName = s.name[o.lang] || s.name.cn;
  const tgtName = t.name[o.lang] || t.name.cn;
  const stripped = srcName.split(tgtName).join('').replace(/^[\s·()（）-]+|[\s·()（）-]+$/g, '');
  const vName = stripped || srcName;
  const live = o.named(t.variants).find(v => v.name === vName);
  const buried = live ? undefined : [...(t.deletedVariants ?? [])].reverse().find(v => v.name === vName);
  const existing = live ?? buried;
  const vid = existing?.id ?? o.newId;
  const sameRegionPart = (s.bodyPart || '').toLowerCase() === (t.bodyPart || '').toLowerCase();
  const variant: ExerciseVariant = existing ?? stripUndef({
    id: vid,
    name: vName,
    ...(sameRegionPart && s.region
      ? regionList(s).length > 1 ? regionsPatch(regionList(s)) : { region: s.region }
      : {}),
    // 器材：source 的跟 target 一样就跟动作走，不一样才写在做法上
    ...(s.equipment && s.equipment !== t.equipment ? attrsPatch(s.equipment, s.resistance) : {}),
  });
  // source 认得的全部名字（含曾用名、它自己并进来的旧名）都指向这个做法
  const aliases = { ...(t.variantAliases ?? {}), ...Object.fromEntries(mergeNamesOf(s).map(n => [n, vid])) };
  const rawT = mergeOverride(rawDef(builtins, st, targetId)!, st.overrides[targetId]).variants ?? [];
  let out = live ? st : withVariantsIn(builtins, st, targetId, [...rawT, variant]);
  out = writeDef(out, targetId, { variantAliases: aliases });
  out = { ...out, overrides: { ...out.overrides, [sourceId]: { ...(out.overrides[sourceId] || {}), mergedInto: targetId, hidden: true } } };
  const known = new Set([...(t.variants ?? []), variant].map(v => v.id));
  const moves: [string, string][] = [
    [`|${sourceId}|`, `|${targetId}|${vid}`],
    ...(s.variants ?? []).map((v): [string, string] => [
      `|${sourceId}|${v.id}`,
      known.has(v.id) ? `|${targetId}|${v.id}` : `|${targetId}|${vid}/${v.id}`,
    ]),
  ];
  return { state: out, moves, srcName, tgtName, variantName: variant.name };
}

/**
 * 已经成了孤儿的并入（审查 C29 的存量）：mergedInto 还在，可目标上它的名字指向的做法已经没了
 * （这批之前删并入做法不先拆回）。「已删除」托盘列出它们，恢复就走拆回。
 */
export function orphanMergesIn(builtins: ExerciseDefinition[], st: LibState): string[] {
  return [...builtins, ...st.customs]
    .filter(d => {
      const tgtId = st.overrides[d.id]?.mergedInto;
      const t = tgtId ? mergedDef(builtins, st, tgtId) : undefined;
      if (!t) return false;
      const ids = new Set((t.variants ?? []).map(v => v.id));
      const vid = mergeNamesOf(mergeOverride(d, st.overrides[d.id])).map(n => ownValue(t.variantAliases, n)).find(Boolean);
      return !vid || !ids.has(vid);
    })
    .map(d => d.id);
}
