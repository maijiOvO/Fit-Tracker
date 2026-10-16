/**
 * 工作台的「做到哪了」与交替组（2026-10，demo：docs/demos/set-pointer-alternating.html）
 *
 * 一条规则：全场一个指针，落在最后一组做完的后面。
 *   - 指针不存状态，由组的状态推出来：最后一条做完的行之后。所以拖指针、点做完、退回、删组之后，
 *     它自己就落在对的地方；重开工作台（App 被回收、继续这场）也接得上。
 *   - 组的状态只有两种：做完（ghost=false）/ 待做（ghost=true）。待做不入册，结束训练时丢掉 ——
 *     不想做的组不点就是了（2026-10-15 用户定，删掉了「跳过」）。所以指针上面也可以留着待做组
 *     （扫过时没填数的、练一半换动作时没做完的），点组号原地补做。
 *   - 旧数据里的 skipped 标记一律当待做读，做完 / 退回时顺手剥掉。
 *
 * 卡片：单个动作一张卡；交替组（Exercise.altGroup 相同、在数组里挨着）合成一张卡。
 *   - 单个动作的行序＝sets 数组的顺序（点做完时把那一组挪到指针下面，数组就是实际顺序）。
 *   - 交替组的行序：做完的按 seq（实际先后），待做的按轮换，从最后做完那组的下一个动作接着轮。
 *
 * 全部是纯函数：输入 exercises，输出新的 exercises。UI（NewWorkoutTab）只管调用和渲染。
 */
import type { Exercise, SetLog, SubSetLog } from '../../types';
import { fromSignedKg, signedKg } from './load';
import { followDiag } from './followDiag';

export const isPending = (s: SetLog): boolean => !!s.ghost;

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
  /** 补做的是另一张卡上留下的组：提示「和 X 交替做？」（两张都是单个动作时） */
  suggestPair?: { a: string; b: string };
}

/** 指针上面留下的待做组原地补做（不挪指针、不挪卡）；补的是别的卡 → 提示交替 */
function fillInPlace(exs: Exercise[], r: RowRef): DoneResult {
  const cards = buildCards(exs);
  const rowCard = cards.find(c => c.exIds.includes(r.exId))!;
  const ptrCard = pointerCard(exs);
  const next = patchSet(exs, r, x => asDone(x, nextSeq(exs)));
  const suggest =
    ptrCard && ptrCard.key !== rowCard.key && !ptrCard.group && !rowCard.group
      ? { a: rowCard.exIds[0], b: ptrCard.exIds[0] }
      : undefined;
  return { exs: next, suggestPair: suggest };
}

/** rowCard 整张挪到当前卡下面（当前卡没做的组原样留着待做）；还没开始（没有当前卡）就挪到最前面 */
function bringCardToPointer(exs: Exercise[], rowCard: WorkbenchCard, ptrCard: WorkbenchCard | null): Exercise[] {
  if (!ptrCard) return moveCardBlock(exs, rowCard, () => 0);
  const lastId = ptrCard.exIds[ptrCard.exIds.length - 1];
  return moveCardBlock(exs, rowCard, rest => rest.findIndex(e => e.id === lastId) + 1);
}

/** 一张卡里前 gap 行：有数的待做组记做完（全零的留着待做） */
function sweepCard(exs: Exercise[], card: WorkbenchCard, gap: number): Exercise[] {
  let next = exs;
  let seq = nextSeq(exs);
  for (const r of cardRows(card, exs).slice(0, gap)) {
    next = patchSet(next, r, s => (isPending(s) && setHasValue(s) ? asDone(s, seq++) : s));
  }
  return next;
}

/** 指针此刻所在的卡（它正上方那一行所在的卡）；一组都没做过时为 null */
export function pointerCard(exs: Exercise[]): WorkbenchCard | null {
  const P = pointerIndex(exs);
  if (P === 0) return null;
  const key = flatRows(exs)[P - 1].cardKey;
  return buildCards(exs).find(c => c.key === key) ?? null;
}

/** 某一行在它那张卡里的位次（它正下方那条缝＝idx + 1） */
function rowSeat(exs: Exercise[], r: RowRef): { card: WorkbenchCard; idx: number } | null {
  const card = buildCards(exs).find(c => c.exIds.includes(r.exId));
  if (!card) return null;
  const idx = cardRows(card, exs).findIndex(x => x.exId === r.exId && x.setId === r.setId);
  return idx < 0 ? null : { card, idx };
}

export type TapOutcome =
  /** 这一组做完（指针落在它正下方，经过的有数的待做组一并做完；或在指针上面原地补做） */
  | 'done'
  /** 刚做完的那组退回待做 */
  | 'revert'
  /** 指针挪回这一组正下方，后面的退回待做 */
  | 'moved'
  /** 全零的组：只选中，不动指针 */
  | 'empty'
  /** 编辑旧训练时点记录里的组：只选中，什么都不改 */
  | 'select'
  | 'noop';

export interface TapResult extends DoneResult {
  outcome: TapOutcome;
}

/**
 * 点组号（2026-10-11，用户按真机手感定）：**一下＝选中这一组 + 指针挪到它正下方。**
 * 以前要「先选中、再点一下才做完」，挪指针得精确拖书签（瞄起点、瞄终点两次）；现在一次点击顶掉这两样。
 *   - 待做、在指针下面：指针所在的卡里（或还没开始）→ 像拖指针一样扫下去：经过的有数的待做组做完，这一组做完。
 *     别的卡 → 那张卡整张挪到当前卡下面（还没开始就挪到最前），再在那张卡里扫到这一组。当前卡没做的组原样留着。
 *     全零的组点不实（做完也记不下东西）：只选中，指针不动。
 *   - 待做、在指针上面（扫过时没数、或换卡时留下的）：原地补做；补的是别的卡 → 提示交替。
 *   - 刚做完的那组（指针正上方）：退回待做，值保留 —— 点错了再点一下就撤。
 *   - 更上面的做完组：指针挪回它正下方，后面的组退回待做（值保留）—— 等于把书签往上拖。
 * 选中（组号实心、±5）由 UI 记：不管哪种结果，被点的那组就是选中的。
 */
export function tapSetNum(exs: Exercise[], r: RowRef): TapResult {
  const s = findSet(exs, r);
  if (!s) return { exs, outcome: 'noop' };
  if (isPending(s)) {
    if (!setHasValue(s)) return { exs, outcome: 'empty' };
    const at = flatRows(exs).findIndex(x => x.exId === r.exId && x.setId === r.setId);
    if (at >= 0 && at < pointerIndex(exs)) return { ...fillInPlace(exs, r), outcome: 'done' };
    const ptrCard = pointerCard(exs);
    const rowCard = buildCards(exs).find(c => c.exIds.includes(r.exId))!;
    if (ptrCard?.key === rowCard.key || (!ptrCard && buildCards(exs)[0].key === rowCard.key)) {
      const seat = rowSeat(exs, r);
      if (!seat) return { exs, outcome: 'noop' };
      return { exs: movePointerTo(exs, seat.card.key, seat.idx + 1), outcome: 'done' };
    }
    // 换卡：那张卡挪到当前卡下面，只在它自己里面扫到这一组。不能用 movePointerTo ——
    // 它按全场行序扫，会把当前卡剩下、已经填了数的组顺手记成做完
    const next = bringCardToPointer(exs, rowCard, ptrCard);
    const seat = rowSeat(next, r);
    if (!seat) return { exs, outcome: 'noop' };
    return { exs: sweepCard(next, seat.card, seat.idx + 1), outcome: 'done' };
  }
  if (isJustDone(exs, r)) return { exs: revertSet(exs, r), outcome: 'revert' };
  const seat = rowSeat(exs, r);
  if (!seat) return { exs, outcome: 'noop' };
  return { exs: movePointerTo(exs, seat.card.key, seat.idx + 1), outcome: 'moved' };
}

/**
 * 编辑旧训练时点组号（2026-10-15）：**只动被点的这一组，不挪卡、不扫别的组。**
 * 练完的训练没有「做到哪了」：指针停在最后一组下面，套 tapSetNum 会把点到的待做组当成「换到另一张卡」、
 * 把点到的旧组当成「书签往上拖」—— 后面的组全退回待做，保存时被当底稿剥掉，记录就丢了。
 *   - 记录里的组（没有 seq：入册时 seq 被剥掉）：只选中，用来改数。
 *   - 这次编辑里点实的组（有 seq）：退回待做 —— 点错了再点一下就撤。
 *   - 待做 / 跳过（编辑时加的组）：原地做完；全零的点不实。
 */
export function tapSetNumEditing(exs: Exercise[], r: RowRef): TapResult {
  const s = findSet(exs, r);
  if (!s) return { exs, outcome: 'noop' };
  if (!s.ghost) return s.seq ? { exs: revertSet(exs, r), outcome: 'revert' } : { exs, outcome: 'select' };
  if (!setHasValue(s)) return { exs, outcome: 'empty' };
  return { exs: patchSet(exs, r, x => asDone(x, nextSeq(exs))), outcome: 'done' };
}

/**
 * 改值时随 updates 一起传的两个标记（不落进组里）：
 *   - holdFollow：打字中途。只改这一格，重量先不带后面的组 —— 打 150 会先经过 1、15，
 *     逐键平移会让后面的组一路跳，减到 0 以下还会被截掉，差值就丢了。
 *   - followFrom：打完（离开输入框 / 回车）。按「聚焦时的值 → 现在的值」的总差值平移一次。
 *     sub 是递减档下标，不写＝母组。
 * 横拖和 ±5 每档都是小步，不带标记，逐档实时跟。
 */
export type SetUpdate = Partial<SetLog> & {
  holdFollow?: boolean;
  followFrom?: { kg: number; sub?: number };
};

/**
 * 改一组的值：后面「待做、这个格子没手动改过」的组跟着变。
 *   - 重量（2026-10-15 用户定）：**保持差值** —— 这组 +5，后面的组都 +5，原值不同的也跟。
 *     上次留下的金字塔（145/185/185/165）整体平移成 150/190/190/170，结构不被压平。和递减档同一条规则。
 *     在带符号的数上算（辅助 −10 +5 → −5），普通重量不低于 0。
 *   - 次数（2026-10-11 用户定）：只跟「原值和这组改之前一样」的组。
 * 做完的组改、待做的组改都触发；跟着变的仍是底稿（不记 touched），所以结束时不当「改过数但没点完成」提醒，之后还会继续跟。
 *
 * 递减档（2026-10-15 用户定：和普通组完全一样）：
 *   - 改某一组第 j 档的重量 / 次数，后面各组的第 j 档照上面同一套跟（重量保持差值，次数原值相同才跟）。
 *   - 母组重量变了，它自己的递减档保持差值一起挪（60→55→50 改成 70 → 70→65→60）；档上改过的重量不动。
 *     跟着变的母组也一样带着自己的递减档挪。
 */
export function applySetUpdate(exs: Exercise[], r: RowRef, raw: SetUpdate): Exercise[] {
  const { holdFollow, followFrom, ...updates } = raw;
  return exs.map(e => {
    if (e.id !== r.exId) return e;
    const i = e.sets.findIndex(s => String(s.id) === r.setId);
    if (i < 0) return e;
    const before = e.sets[i];
    const edited = { ...before, ...updates };
    const sets = [...e.sets];
    sets[i] = edited;

    // 打完结算：值已经在打字时写进去了，这里只按总差值带后面
    if (followFrom) {
      if (followFrom.sub === undefined) {
        const shift = signedKg(edited, e) - followFrom.kg;
        const signed = !!edited.bodyweightMode;
        sets[i] = shiftSubs(edited, edited, shift, e, signed);
        followWeight(sets, i, shift, e, signed);
      } else {
        const sub = edited.subSets?.[followFrom.sub];
        if (sub) followSubWeight(sets, i, followFrom.sub, signedKg(sub, e, edited) - followFrom.kg, !!sub.bodyweightMode, e);
      }
      return { ...e, sets };
    }

    const signed = 'bodyweightMode' in updates;
    // 重量的变化量（带符号的 kg，跨过 0 也算得对）：后面的组和递减档都平移这么多
    const shift = 'weight' in updates && !holdFollow ? signedKg(edited, e) - signedKg(before, e) : 0;
    if (shift) {
      sets[i] = shiftSubs(edited, before, shift, e, signed);
      followWeight(sets, i, shift, e, signed);
    }
    if ('reps' in updates) followReps(sets, i, e, Number(before.reps) || 0, updates.reps);
    if (updates.subSets) followSubs(sets, i, before, edited, e, !!holdFollow);
    return { ...e, sets };
  });
}

/** 一组（或一档）的重量平移 shift（带符号的 kg）：带正负的负荷连号一起写，普通重量不低于 0 */
function shiftWeight<T extends SetLog | SubSetLog>(
  x: T, shift: number, ex: Exercise, signed: boolean, parent?: SetLog,
): Pick<SetLog, 'weight' | 'bodyweightMode'> {
  const v = signedKg(x, ex, parent) + shift;
  return signed || x.bodyweightMode ? fromSignedKg(v) : { weight: Math.max(0, v) };
}

/** 第 i 组后面的待做、重量没改过的组平移 shift，各自带着递减档 */
function followWeight(sets: SetLog[], i: number, shift: number, e: Exercise, signed: boolean) {
  if (!shift) return;
  const rows: Record<string, unknown>[] = [];
  for (let k = i + 1; k < sets.length; k++) {
    const s = sets[k];
    const why = !s.ghost ? 'done' : s.touched?.weight ? 'touched' : 'followed';
    rows.push({ no: k + 1, id: s.id, value: s.weight, touched: s.touched, why });
    if (why !== 'followed') continue;
    sets[k] = shiftSubs({ ...s, ...shiftWeight(s, shift, e, signed) }, s, shift, e, signed);
  }
  followDiag('follow', { ex: e.name, from: i + 1, key: 'weight', shift, rows });
}

/** 次数：后面待做、没改过、原值和这组改之前一样的组跟着变 */
function followReps(sets: SetLog[], i: number, e: Exercise, oldV: number, reps: SetLog['reps'] | undefined) {
  if (oldV === (Number(reps) || 0)) return;
  const rows: Record<string, unknown>[] = [];
  for (let k = i + 1; k < sets.length; k++) {
    const s = sets[k];
    const why = !s.ghost ? 'done' : s.touched?.reps ? 'touched'
      : (Number(s.reps) || 0) !== oldV ? 'value-differs' : 'followed';
    rows.push({ no: k + 1, id: s.id, value: s.reps, touched: s.touched, why });
    if (why === 'followed') sets[k] = { ...s, reps: reps! };
  }
  followDiag('follow', { ex: e.name, from: i + 1, key: 'reps', oldV, newV: reps, rows });
}

/** 母组从 prev 变成 next：没改过重量的递减档平移 shift */
function shiftSubs(next: SetLog, prev: SetLog, shift: number, ex: Exercise, signed: boolean): SetLog {
  if (!shift || !next.subSets?.length) return next;
  const subSets = next.subSets.map(sub =>
    sub.touched?.weight ? sub : { ...sub, ...shiftWeight(sub, shift, ex, signed, prev) },
  );
  return { ...next, subSets };
}

/** 后面各组的第 j 档：待做、重量没改过的平移 shift */
function followSubWeight(sets: SetLog[], i: number, j: number, shift: number, signed: boolean, ex: Exercise) {
  if (!shift) return;
  for (let k = i + 1; k < sets.length; k++) {
    const s = sets[k];
    const sub = s.subSets?.[j];
    if (!sub || !isPending(s) || sub.touched?.weight) continue;
    const subSets = [...s.subSets!];
    subSets[j] = { ...sub, ...shiftWeight(sub, shift, ex, signed, s) };
    sets[k] = { ...s, subSets };
  }
}

/** 第 i 组的递减档从 prev 改成 next：后面各组的同一档照普通组的规则跟。加档 / 删档不跟；hold＝打字中途，重量先不跟 */
function followSubs(sets: SetLog[], i: number, prev: SetLog, next: SetLog, ex: Exercise, hold: boolean) {
  const oldSubs = prev.subSets ?? [];
  const newSubs = next.subSets ?? [];
  if (oldSubs.length !== newSubs.length) return;
  newSubs.forEach((nu, j) => {
    const old = oldSubs[j];
    if (!hold) followSubWeight(sets, i, j, signedKg(nu, ex, next) - signedKg(old, ex, prev), !!nu.bodyweightMode, ex);
    const oldReps = Number(old.reps) || 0;
    if (oldReps === (Number(nu.reps) || 0)) return;
    for (let k = i + 1; k < sets.length; k++) {
      const s = sets[k];
      const sub = s.subSets?.[j];
      if (!sub || !isPending(s) || sub.touched?.reps || (Number(sub.reps) || 0) !== oldReps) continue;
      const subSets = [...s.subSets!];
      subSets[j] = { ...sub, reps: nu.reps };
      sets[k] = { ...s, subSets };
    }
  });
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
 * 拖指针到某张卡的第 gap 条缝。往下：经过的待做组记做完（全零的原样留着待做 —— 没填数的组做完也记不下东西）；
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
    const marked: RowRef[] = [];
    for (const r of flat.slice(P, N)) {
      next = patchSet(next, r, s => {
        if (!isPending(s) || !setHasValue(s)) return s;
        marked.push(r);
        return asDone(s, seq++);
      });
    }
    followDiag('pointer-down', { cardKey, gap, marked });
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
 */
export function groupExercises(exs: Exercise[], exIds: string[]): Exercise[] {
  const ids = new Set(exIds);
  const existing = exs.find(e => ids.has(e.id) && e.altGroup)?.altGroup;
  const gid = existing ?? newGroupId();
  // 已在组里的成员连同整组一起算
  const all = new Set([...ids, ...exs.filter(e => e.altGroup && e.altGroup === existing).map(e => e.id)]);
  const first = exs.findIndex(e => all.has(e.id));
  const members = exs
    .filter(e => all.has(e.id))
    .map(e => ({ ...e, altGroup: gid }));
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
