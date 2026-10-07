/**
 * 工作台的「做到哪了」与交替组（2026-10，demo：docs/demos/set-pointer-alternating.html）
 *
 * 一条规则：全场一个指针，指针以上＝做完或跳过，以下＝待做。
 *   - 指针不存状态，由组的状态推出来：最后一条「不是待做」的行之后。所以拖指针、点做完、退回、删组之后，
 *     它自己就落在对的地方；重开工作台（App 被回收、继续这场）也接得上。
 *   - 组的状态：做完（ghost=false）/ 待做（ghost=true）/ 跳过（ghost=true + skipped）。跳过和待做一样不入册。
 *
 * 卡片：单个动作一张卡；交替组（Exercise.altGroup 相同、在数组里挨着）合成一张卡。
 *   - 单个动作的行序＝sets 数组的顺序（点做完时把那一组挪到指针下面，数组就是实际顺序）。
 *   - 交替组的行序：做完 / 跳过的按 seq（实际先后），待做的按轮换，从最后做完那组的下一个动作接着轮。
 *
 * 全部是纯函数：输入 exercises，输出新的 exercises。UI（NewWorkoutTab）只管调用和渲染。
 */
import type { Exercise, SetLog } from '../../types';

export const isPending = (s: SetLog): boolean => !!s.ghost && !s.skipped;
export const isSkipped = (s: SetLog): boolean => !!s.ghost && !!s.skipped;

export interface WorkbenchCard {
  /** 单个动作＝动作 id；交替组＝'g:' + 组 id */
  key: string;
  group?: string;
  exIds: string[];
}

export interface RowRef {
  exId: string;
  setId: string;
}

/** 有没有填数：全零的组做完也记不下任何东西 */
export function setHasValue(s: SetLog): boolean {
  const n = (v: unknown) => Number(v) > 0;
  return (
    ['weight', 'reps', 'duration', 'distance', 'score', 'time'].some(k => n((s as any)[k])) ||
    (s.subSets ?? []).some(sub => n(sub.weight) || n(sub.reps))
  );
}

/** 把交替组成员挪到一起（以第一个成员的位置为准），只剩一个成员的组拆掉 */
export function normalizeGroups(exs: Exercise[]): Exercise[] {
  const count = new Map<string, number>();
  for (const e of exs) if (e.altGroup) count.set(e.altGroup, (count.get(e.altGroup) ?? 0) + 1);
  const cleaned = exs.map(e => {
    if (!e.altGroup || (count.get(e.altGroup) ?? 0) >= 2) return e;
    const { altGroup: _g, ...rest } = e;
    return rest as Exercise;
  });
  const out: Exercise[] = [];
  const placed = new Set<string>();
  for (const e of cleaned) {
    if (!e.altGroup) {
      out.push(e);
      continue;
    }
    if (placed.has(e.altGroup)) continue;
    placed.add(e.altGroup);
    out.push(...cleaned.filter(x => x.altGroup === e.altGroup));
  }
  return out;
}

export function buildCards(exs: Exercise[]): WorkbenchCard[] {
  const cards: WorkbenchCard[] = [];
  for (const e of exs) {
    const last = cards[cards.length - 1];
    if (e.altGroup && last?.group === e.altGroup) {
      last.exIds.push(e.id);
      continue;
    }
    cards.push(e.altGroup ? { key: `g:${e.altGroup}`, group: e.altGroup, exIds: [e.id] } : { key: e.id, exIds: [e.id] });
  }
  // 只剩一个成员的「组」按单个动作算（normalize 之前的中间态）
  return cards.map(c => (c.group && c.exIds.length < 2 ? { key: c.exIds[0], exIds: c.exIds } : c));
}

const byId = (exs: Exercise[]) => new Map<string, Exercise>(exs.map(e => [e.id, e] as [string, Exercise]));

/** 一张卡此刻的行序 */
export function cardRows(card: WorkbenchCard, exs: Exercise[]): RowRef[] {
  const m = byId(exs);
  const members = card.exIds.map(id => m.get(id)).filter(Boolean) as Exercise[];
  if (!card.group || members.length < 2) {
    const ex = members[0];
    return ex ? ex.sets.map(s => ({ exId: ex.id, setId: String(s.id) })) : [];
  }
  const M = members.length;
  const non: { r: RowRef; key: number; done: boolean; mi: number }[] = [];
  const queues: RowRef[][] = members.map(() => []);
  members.forEach((ex, mi) => {
    ex.sets.forEach((s, k) => {
      const r = { exId: ex.id, setId: String(s.id) };
      if (isPending(s)) queues[mi].push(r);
      // 没有 seq 的（旧数据 / 接回来的训练）按轮换位次排在前面；seq 是时间戳，天然排在它们之后
      else non.push({ r, key: s.seq ?? k * M + mi, done: !s.ghost, mi });
    });
  });
  non.sort((a, b) => a.key - b.key);
  const lastDone = [...non].reverse().find(x => x.done);
  let k = lastDone ? (lastDone.mi + 1) % M : 0;
  const pend: RowRef[] = [];
  while (queues.some(q => q.length)) {
    if (queues[k].length) pend.push(queues[k].shift()!);
    k = (k + 1) % M;
  }
  return [...non.map(x => x.r), ...pend];
}

export function flatRows(exs: Exercise[]): (RowRef & { cardKey: string })[] {
  return buildCards(exs).flatMap(c => cardRows(c, exs).map(r => ({ ...r, cardKey: c.key })));
}

export function findSet(exs: Exercise[], r: RowRef): SetLog | undefined {
  return exs.find(e => e.id === r.exId)?.sets.find(s => String(s.id) === r.setId);
}

/** 指针以上有几行（全场扁平序）＝最后一条「不是待做」的行之后 */
export function pointerIndex(exs: Exercise[]): number {
  const flat = flatRows(exs);
  for (let i = flat.length - 1; i >= 0; i--) {
    const s = findSet(exs, flat[i]);
    if (s && !isPending(s)) return i + 1;
  }
  return 0;
}

/** 指针落在哪张卡的第几条缝（gap=0 是第一行之前） */
export function pointerSeam(exs: Exercise[]): { cardKey: string; gap: number } | null {
  const cards = buildCards(exs);
  if (!cards.length) return null;
  const P = pointerIndex(exs);
  if (P === 0) return { cardKey: cards[0].key, gap: 0 };
  let n = 0;
  for (const c of cards) {
    const len = cardRows(c, exs).length;
    if (P <= n + len) return { cardKey: c.key, gap: P - n };
    n += len;
  }
  return { cardKey: cards[cards.length - 1].key, gap: 0 };
}

/** 默认选中：指针下面第一条待做 */
export function nextPendingRow(exs: Exercise[]): RowRef | null {
  const flat = flatRows(exs);
  const P = pointerIndex(exs);
  for (let i = P; i < flat.length; i++) {
    const s = findSet(exs, flat[i]);
    if (s && isPending(s)) return { exId: flat[i].exId, setId: flat[i].setId };
  }
  return null;
}

/** 新的先后号：比现有的都大（时间戳，跨重开也单调） */
function nextSeq(exs: Exercise[]): number {
  let max = 0;
  for (const e of exs) for (const s of e.sets) if (s.seq && s.seq > max) max = s.seq;
  return Math.max(Date.now(), max + 1);
}

/** 做完：剥掉工作台上的待做标记（改过的格子、递减档的改过标记） */
function asDone(s: SetLog, seq: number): SetLog {
  const { touched: _t, fromGhost: _fg, skipped: _sk, ...rest } = s;
  return {
    ...rest,
    ghost: false,
    seq,
    ...(rest.subSets?.length ? { subSets: rest.subSets.map(({ touched: _st, ...sub }) => sub) } : {}),
  };
}

function patchSet(exs: Exercise[], r: RowRef, fn: (s: SetLog) => SetLog): Exercise[] {
  return exs.map(e =>
    e.id !== r.exId ? e : { ...e, sets: e.sets.map(s => (String(s.id) === r.setId ? fn(s) : s)) },
  );
}

/** 把一张卡（它的全部成员）整块挪到数组的 at 位置（at 按挪走之后的数组算） */
function moveCardBlock(exs: Exercise[], card: WorkbenchCard, at: (rest: Exercise[]) => number): Exercise[] {
  const ids = new Set(card.exIds);
  const block = exs.filter(e => ids.has(e.id));
  const rest = exs.filter(e => !ids.has(e.id));
  const i = Math.max(0, Math.min(at(rest), rest.length));
  return [...rest.slice(0, i), ...block, ...rest.slice(i)];
}

export interface DoneResult {
  exs: Exercise[];
  /** 补做的是另一张卡上跳过的组：提示「和 X 交替做？」（两张都是单个动作时） */
  suggestPair?: { a: string; b: string };
}

/**
 * 点做完（第二次点已选中的组号）。
 *   - 跳过的组：原地补做（它本来就在指针上面）；补的是别的卡 → 提示交替。
 *   - 指针所在的卡里：这一组挪到指针正下方，记做完。
 *   - 别的卡：当前卡没做的组记跳过，被点的卡整张挪到当前卡下面；一组都还没做（指针在最开头）就挪到最前面。
 */
export function markSetDone(exs: Exercise[], r: RowRef): DoneResult {
  const s = findSet(exs, r);
  if (!s || !s.ghost) return { exs };
  const seq = nextSeq(exs);
  const cards = buildCards(exs);
  const flat = flatRows(exs);
  const P = pointerIndex(exs);
  const rowCard = cards.find(c => c.exIds.includes(r.exId))!;
  const ptrCard = P > 0 ? cards.find(c => c.key === flat[P - 1].cardKey) ?? null : null;

  if (isSkipped(s)) {
    const next = patchSet(exs, r, x => asDone(x, seq));
    const suggest =
      ptrCard && ptrCard.key !== rowCard.key && !ptrCard.group && !rowCard.group
        ? { a: rowCard.exIds[0], b: ptrCard.exIds[0] }
        : undefined;
    return { exs: next, suggestPair: suggest };
  }

  let next = exs;
  if (!ptrCard || ptrCard.key !== rowCard.key) {
    if (ptrCard) {
      const gap = P - flat.findIndex(x => x.cardKey === ptrCard.key);
      const leftover = cardRows(ptrCard, exs).slice(gap);
      let sq = seq;
      for (const lr of leftover) {
        next = patchSet(next, lr, x => (isPending(x) ? { ...x, skipped: true, seq: sq++ } : x));
      }
      next = moveCardBlock(next, rowCard, rest => {
        const lastId = ptrCard.exIds[ptrCard.exIds.length - 1];
        return rest.findIndex(e => e.id === lastId) + 1;
      });
    } else {
      next = moveCardBlock(next, rowCard, () => 0);
    }
  }
  // 单个动作：这一组挪到它自己已做 / 跳过的组后面（＝指针正下方）
  if (!rowCard.group) {
    next = next.map(e => {
      if (e.id !== r.exId) return e;
      const sets = e.sets.filter(x => String(x.id) !== r.setId);
      const at = sets.filter(x => !isPending(x)).length;
      const target = e.sets.find(x => String(x.id) === r.setId)!;
      sets.splice(at, 0, target);
      return { ...e, sets };
    });
  }
  next = patchSet(next, r, x => asDone(x, seq + 100));
  return { exs: next };
}

/** 退回待做：只给指针正上方那一组（刚做完的那组），值保留 */
export function revertSet(exs: Exercise[], r: RowRef): Exercise[] {
  return patchSet(exs, r, s => {
    const { seq: _q, skipped: _sk, ...rest } = s;
    return { ...rest, ghost: true };
  });
}

export function isJustDone(exs: Exercise[], r: RowRef): boolean {
  const P = pointerIndex(exs);
  if (P === 0) return false;
  const f = flatRows(exs)[P - 1];
  const s = findSet(exs, r);
  return !!s && !s.ghost && f.exId === r.exId && f.setId === r.setId;
}

/**
 * 拖指针到某张卡的第 gap 条缝。往下：经过的待做组记做完（全零的记跳过 —— 没填数的组做完也记不下东西）；
 * 往上：经过的组退回待做（值保留）。
 */
export function movePointerTo(exs: Exercise[], cardKey: string, gap: number): Exercise[] {
  const cards = buildCards(exs);
  let N = 0;
  for (const c of cards) {
    if (c.key === cardKey) {
      N += gap;
      break;
    }
    N += cardRows(c, exs).length;
  }
  const P = pointerIndex(exs);
  const flat = flatRows(exs);
  let next = exs;
  let seq = nextSeq(exs);
  if (N > P) {
    for (const r of flat.slice(P, N)) {
      next = patchSet(next, r, s =>
        isPending(s) ? (setHasValue(s) ? asDone(s, seq++) : { ...s, skipped: true, seq: seq++ }) : s,
      );
    }
  } else if (N < P) {
    for (const r of flat.slice(N, P)) {
      next = patchSet(next, r, s => {
        const { seq: _q, skipped: _sk, ...rest } = s;
        return { ...rest, ghost: true };
      });
    }
  }
  return next;
}

/* ── 交替组 ─────────────────────────────────────────────── */

export const newGroupId = () => `alt_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

/**
 * 把几个动作合成一个交替组（已经在组里的沿用那个组）。成员挨着放在最靠前那个的位置，顺序按数组原顺序。
 * unskip：跳过的组恢复待做（「跳回来补做 → 交替？」那条路）。
 */
export function groupExercises(exs: Exercise[], exIds: string[], opts: { unskip?: boolean } = {}): Exercise[] {
  const ids = new Set(exIds);
  const existing = exs.find(e => ids.has(e.id) && e.altGroup)?.altGroup;
  const gid = existing ?? newGroupId();
  // 已在组里的成员连同整组一起算
  const all = new Set([...ids, ...exs.filter(e => e.altGroup && e.altGroup === existing).map(e => e.id)]);
  const first = exs.findIndex(e => all.has(e.id));
  const members = exs
    .filter(e => all.has(e.id))
    .map(e => ({
      ...e,
      altGroup: gid,
      sets: opts.unskip
        ? e.sets.map(s => {
            if (!isSkipped(s)) return s;
            const { skipped: _sk, seq: _q, ...rest } = s;
            return rest;
          })
        : e.sets,
    }));
  const rest = exs.filter(e => !all.has(e.id));
  const at = exs.slice(0, first).filter(e => !all.has(e.id)).length;
  return normalizeGroups([...rest.slice(0, at), ...members, ...rest.slice(at)]);
}

/** 交替组里挪成员（左移 / 右移）：只改轮换顺序，做完的组不动 */
export function moveGroupMember(exs: Exercise[], exId: string, dir: -1 | 1): Exercise[] {
  const ex = exs.find(e => e.id === exId);
  if (!ex?.altGroup) return exs;
  const idx = exs.indexOf(ex);
  const j = idx + dir;
  if (j < 0 || j >= exs.length || exs[j].altGroup !== ex.altGroup) return exs;
  const next = [...exs];
  [next[idx], next[j]] = [next[j], next[idx]];
  return next;
}

/** 移出交替：这个动作的组带着状态变回一张单独的卡，放在交替组下面 */
export function removeFromGroup(exs: Exercise[], exId: string): Exercise[] {
  const ex = exs.find(e => e.id === exId);
  if (!ex?.altGroup) return exs;
  const gid = ex.altGroup;
  const { altGroup: _g, ...single } = ex;
  const rest = exs.filter(e => e.id !== exId);
  const lastIdx = rest.map(e => e.altGroup).lastIndexOf(gid);
  rest.splice(lastIdx + 1, 0, single as Exercise);
  return normalizeGroups(rest);
}

/** 拆开：每个成员还原成单独的卡，按各自第一组做完的先后排（都没做的排后面） */
export function splitGroup(exs: Exercise[], gid: string): Exercise[] {
  const members = exs.filter(e => e.altGroup === gid);
  if (!members.length) return exs;
  const first = (e: Exercise) =>
    Math.min(...e.sets.filter(s => !isPending(s)).map(s => s.seq ?? 0), Number.POSITIVE_INFINITY);
  const ordered = [...members]
    .sort((a, b) => first(a) - first(b))
    .map(e => {
      const { altGroup: _g, ...rest } = e;
      return rest as Exercise;
    });
  const at = exs.findIndex(e => e.altGroup === gid);
  const rest = exs.filter(e => e.altGroup !== gid);
  return [...rest.slice(0, at), ...ordered, ...rest.slice(at)];
}

/** 这一组改记到组里另一个动作名下（值原样带过去） */
export function moveSetToExercise(exs: Exercise[], r: RowRef, toExId: string): Exercise[] {
  if (r.exId === toExId) return exs;
  const s = findSet(exs, r);
  if (!s) return exs;
  return exs.map(e => {
    if (e.id === r.exId) return { ...e, sets: e.sets.filter(x => String(x.id) !== r.setId) };
    if (e.id === toExId) return { ...e, sets: [...e.sets, s] };
    return e;
  });
}

/** 交替组每个成员的简称：从后往前找第一个别的成员名字里没有的字；找不到用 A / B / C */
export function memberAbbrs(names: string[]): string[] {
  return names.map((n, i) => {
    const others = names.filter((_, j) => j !== i).join('');
    const chars = [...n.replace(/[（）()\s·]/g, '')].reverse();
    return chars.find(ch => !others.includes(ch)) ?? String.fromCharCode(65 + (i % 26));
  });
}

/** 结束训练：剥掉工作台标记；只剩一个成员的交替组拆掉 */
export function stripWorkbenchSet<T extends SetLog>(s: T): T {
  const { skipped: _sk, seq: _q, ...rest } = s;
  return rest as T;
}
