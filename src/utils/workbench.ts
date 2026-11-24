/**
 * 工作台的「做到哪了」与交替组（2026-10，demo：docs/demos/set-pointer-alternating.html）
 *
 * 一条规则：全场一个指针，指针以上算练过的，以下是还没练到的（2026-11-23 用户定：不要单独的「做完」，
 * 加了的组就当要做，练到哪只看指针）。
 *   - 组上只记它在指针哪一边：ghost=false 在上面，ghost=true 在下面。指针的位置由它推出来（最后一条
 *     ghost=false 的行之后），所以删组之后它自己落在对的地方，重开工作台（App 被回收、继续这场）也接得上。
 *   - 点组号 / 拖书签＝把指针挪到那儿：上面的行一律记成练过（全零的也算，它只是位置），下面的一律退回。
 *     没点过任何组时指针在第一组上方。训练中的读数（已做几组、卡头容量、实时纪录）只数指针以上的。
 *   - 入不入册另看 willRecord：有数就入册，和指针无关（2026-11 用户定）；不想记的组删掉。
 *   - 旧数据里的 skipped 标记一律当指针以下读，挪指针时顺手剥掉。
 *
 * 卡片：单个动作一张卡；交替组（Exercise.altGroup 相同、在数组里挨着）合成一张卡。
 *   - 单个动作的行序＝sets 数组的顺序（点做完时把那一组挪到指针下面，数组就是实际顺序）。
 *   - 交替组的行序：做完的按 seq（实际先后），待做的按轮换，从最后做完那组的下一个动作接着轮。
 *
 * 全部是纯函数：输入 exercises，输出新的 exercises。UI（NewWorkoutTab）只管调用和渲染。
 */
import type { Exercise, SetLog, SubSetLog, WorkoutSession } from '../../types';
import { fromSignedKg, setSign, signedKg } from './load';
import { segmentName } from './nameSegments';
import { rowEdited, setHasValue } from './setValues';

const isPending = (s: SetLog): boolean => !!s.ghost;

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

/**
 * 换做法 / 换馆重铺底稿（上架审查 C43）：卡上做完或亲手动过的行留在原位，其余底稿原位换成新做法的；
 * 新做法上次多出来的组不接在后面（原来接上去，结束时作为有数的底稿记进这场）。一行保留的都没有，就整套换成 fill。
 */
export function refillDraft(sets: SetLog[], fill: SetLog[]): SetLog[] {
  const kept = (s: SetLog) => !s.ghost || rowEdited(s);
  if (!sets.some(kept)) return fill;
  return sets.flatMap((s, i) => (kept(s) ? [s] : fill[i] ? [fill[i]] : []));
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
  const non: { r: RowRef; key: number; mi: number }[] = [];
  const queues: RowRef[][] = members.map(() => []);
  members.forEach((ex, mi) => {
    ex.sets.forEach((s, k) => {
      const r = { exId: ex.id, setId: String(s.id) };
      if (isPending(s)) queues[mi].push(r);
      // 没有 seq 的（旧数据 / 接回来的训练）按轮换位次排在前面；seq 是时间戳，天然排在它们之后
      else non.push({ r, key: s.seq ?? k * M + mi, mi });
    });
  });
  non.sort((a, b) => a.key - b.key);
  const lastDone = non[non.length - 1];
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

/** 全场点过几组＝指针进度（底栏计数、拖书签的落定提示共用；不是入册数，入册看 willRecord） */
export function doneCount(exs: Exercise[]): number {
  return exs.reduce((n, e) => n + e.sets.filter(s => !isPending(s)).length, 0);
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
export function nextSeq(exs: Exercise[]): number {
  let max = 0;
  for (const e of exs) for (const s of e.sets) if (s.seq && s.seq > max) max = s.seq;
  return Math.max(Date.now(), max + 1);
}

/**
 * 做完：剥掉工作台上的待做标记。改过的格子（touched，含递减档的）留着 —— 做完的组上它不显示也不参与跟随，
 * 只为拖书签退回待做时还认得「这组改过数」，不再被前面的组带着跟；入册时 recordedExercises 统一剥掉。
 */
function asDone(s: SetLog, seq: number): SetLog {
  const { fromGhost: _fg, skipped: _sk, ...rest } = s;
  return { ...rest, ghost: false, seq };
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

/** rowCard 整张挪到当前卡下面；还没开始（没有当前卡）就挪到最前面 */
function bringCardToPointer(exs: Exercise[], rowCard: WorkbenchCard, ptrCard: WorkbenchCard | null): Exercise[] {
  if (!ptrCard) return moveCardBlock(exs, rowCard, () => 0);
  const lastId = ptrCard.exIds[ptrCard.exIds.length - 1];
  return moveCardBlock(exs, rowCard, rest => rest.findIndex(e => e.id === lastId) + 1);
}

/** 指针此刻所在的卡（它正上方那一行所在的卡）；指针在最上面时为 null */
function pointerCard(exs: Exercise[]): WorkbenchCard | null {
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
  /** 指针挪到了这一组正下方 */
  | 'moved'
  /** 指针本来就在这一组下面（编辑旧训练时点记录里的组也是）：只选中，什么都不改 */
  | 'select'
  | 'noop';

export interface TapResult {
  exs: Exercise[];
  outcome: TapOutcome;
}

/**
 * 点组号：**指针落到这一组正下方**，往回点也一样（2026-11-23 用户定：点哪组指针就在哪组下面，没有别的逻辑）。
 * 点的是指针下面、另一张卡上的组（练一半换动作）：那张卡整张挪到当前卡下面（还没开始就挪到最前），
 * 卡片顺序就是实际练的顺序；当前卡剩下的组跟着落在指针上面。
 * 选中（组号实心、操作条改哪一组）由 UI 记：被点的那组就是选中的。
 */
export function tapSetNum(exs: Exercise[], r: RowRef): TapResult {
  const at = flatRows(exs).findIndex(x => x.exId === r.exId && x.setId === r.setId);
  if (at < 0) return { exs, outcome: 'noop' };
  const P = pointerIndex(exs);
  if (at === P - 1) return { exs, outcome: 'select' };
  let next = exs;
  if (at >= P) {
    const cards = buildCards(exs);
    const rowCard = cards.find(c => c.exIds.includes(r.exId))!;
    const ptrCard = pointerCard(exs);
    if ((ptrCard ?? cards[0]).key !== rowCard.key) next = bringCardToPointer(exs, rowCard, ptrCard);
  }
  const seat = rowSeat(next, r);
  if (!seat) return { exs, outcome: 'noop' };
  return { exs: movePointerTo(next, seat.card.key, seat.idx + 1), outcome: 'moved' };
}

/**
 * 编辑旧训练时点组号（2026-10-15）：**只动被点的这一组，不挪卡、不动别的组。**
 * 练完的训练没有「练到哪了」：指针停在最后一组下面，套 tapSetNum 会把点到的旧组当成「指针往上挪」——
 * 后面的组全退到指针下面，页面上像没练过。记录里的组只选中，用来改数；编辑时新加的组点一下并进记录的样子。
 */
export function tapSetNumEditing(exs: Exercise[], r: RowRef): TapResult {
  const s = findSet(exs, r);
  if (!s) return { exs, outcome: 'noop' };
  if (!s.ghost) return { exs, outcome: 'select' };
  return { exs: patchSet(exs, r, x => asDone(x, nextSeq(exs))), outcome: 'moved' };
}

/**
 * 改值时随 updates 一起传的两个标记（不落进组里）：
 *   - holdFollow：打字中途。只改这一格，这组自己的递减档先不动 —— 打 150 会先经过 1、15，
 *     逐键平移会让下面的档一路跳，减到 0 以下还会被截掉，差值就丢了。
 *   - followFrom：打完（离开输入框 / 回车）。按「聚焦时的值 → 现在的值」的总差值平移一次。
 *     sub 是递减档下标，不写＝母组。
 * 横拖和 ±5 每档都是小步，不带标记，逐档实时带。
 */
export type SetUpdate = Partial<SetLog> & {
  holdFollow?: boolean;
  followFrom?: { kg: number; sub?: number };
};

/**
 * 改一组的值：**只改这一组，别的组一律不变**（2026-11-23 用户定，真机练下来改一组带动后面几组反而要逐组改回去）。
 * 被否过的两版：重量保持差值带动后面没改过的组（10-15，为的是上次留下的金字塔整体平移）、次数原值相同才带（11 月已先去掉）。
 *
 * 同一组里的递减链仍然保持差值：
 *   - 母组重量变了，它自己的递减档一起挪（60→55→50 改成 70 → 70→65→60）；档上手改过的重量不动。
 *   - 只换号（辅助 ⇄ 负重），自己的档保持差值跟过去。
 *   - 改第 j 档的重量，它下面没改过的档一起挪（60→50→40 改第一档成 45 → 60→45→35）。
 */
/**
 * 「杠铃片」馆档案（2026-10-18）：被母组带着平移的递减档，平移完再吸到最近能挂的重量。
 * 给的是带符号 kg → 带符号 kg；不传（纯数字的动作、workbench-check）就是纯平移。
 * 被改的那一行自己照原样（打的数照原样记）。
 */
export type SnapFor = (ex: Exercise) => ((kgSigned: number) => number) | null;

export function applySetUpdate(exs: Exercise[], r: RowRef, raw: SetUpdate, snapFor?: SnapFor): Exercise[] {
  const { holdFollow, followFrom, ...updates } = raw;
  return exs.map(e => {
    if (e.id !== r.exId) return e;
    const snap = snapFor?.(e) ?? undefined;
    const i = e.sets.findIndex(s => String(s.id) === r.setId);
    if (i < 0) return e;
    const before = e.sets[i];
    const edited = { ...before, ...updates };
    // 用户改了重量 / 号：这一组不再是「从上一次纯换算来的」—— 切单位时从当前值换，不回到上一次的原值。
    // 只看 touched 不够：做完会剥掉 touched，退回之后又成了「没改过」（审查 2026-10-18）
    if ('weight' in updates || 'bodyweightMode' in updates) {
      edited.draftAuto = false;
      edited.checkWeight = false;
      delete edited.want;
    }
    if (updates.subSets) {
      // 按 id 比：删掉中间一档后后面的档整体前移，按下标比会把没改过的档误判成改过
      const old = new Map((before.subSets ?? []).map(o => [o.id, o] as const));
      edited.subSets = updates.subSets.map(sub => {
        const o = old.get(sub.id);
        if (!o || (o.weight === sub.weight && o.bodyweightMode === sub.bodyweightMode)) return sub;
        const { want: _w, ...rest } = sub;
        return { ...rest, draftAuto: false, checkWeight: false };
      });
    }
    const sets = [...e.sets];
    sets[i] = edited;

    // 打完结算：值已经在打字时写进去了，这里只按总差值带这一组自己的递减档
    if (followFrom) {
      if (followFrom.sub === undefined) {
        const shift = signedKg(edited, e) - followFrom.kg;
        const snapF = typedSnap(snap, signedKg(edited, e));
        sets[i] = shiftSubs(edited, edited, shift, e, !!edited.bodyweightMode, snapF, followFrom.kg);
      } else {
        const j = followFrom.sub;
        const sub = edited.subSets?.[j];
        if (sub) {
          const oldKgs = rowKgs(edited, e);
          oldKgs[j + 1] = followFrom.kg;
          sets[i] = shiftLowerSubs(edited, j, signedKg(sub, e, edited) - followFrom.kg, e, oldKgs, typedSnap(snap, signedKg(sub, e, edited)));
        }
      }
      return { ...e, sets };
    }

    // 重量的变化量（带符号的 kg，跨过 0 也算得对）：这一组的递减档平移这么多
    const shift = 'weight' in updates && !holdFollow ? signedKg(edited, e) - signedKg(before, e) : 0;
    if (shift) sets[i] = shiftSubs(edited, before, shift, e, 'bodyweightMode' in updates, snap);
    if ('bodyweightMode' in updates && !('weight' in updates)) {
      // 只换号：自己的递减档保持差值跟过去（辅助 20 → 辅助 25 换成负重 20 → 负重 15），不是留在原地差出 45
      sets[i] = shiftSubs(edited, before, signedKg(edited, e) - signedKg(before, e), e, true, snap);
    }
    if (updates.subSets && !holdFollow) sets[i] = cascadeEditedSub(sets[i], before, e, snap);
    return { ...e, sets };
  });
}

/** 改了某一档的重量：同一组里它下面没改过的档保持差值一起挪（2026-10-25 用户定：60→50→40 改第一档成 45 → 60→45→35） */
function cascadeEditedSub(s: SetLog, before: SetLog, ex: Exercise, snap?: (kg: number) => number): SetLog {
  const olds = before.subSets ?? [];
  const subs = s.subSets ?? [];
  if (olds.length !== subs.length) return s;
  const j = subs.findIndex((nu, k) => olds[k].id === nu.id && signedKg(nu, ex, s) !== signedKg(olds[k], ex, before));
  return j < 0 ? s : shiftLowerSubs(s, j, signedKg(subs[j], ex, s) - signedKg(olds[j], ex, before), ex, rowKgs(before, ex), snap);
}

/** 一组里第 j 档下面、重量没改过的档平移 shift（同一组的递减链保持差值） */
function shiftLowerSubs(s: SetLog, j: number, shift: number, ex: Exercise, oldKgs: number[], snap?: (kg: number) => number): SetLog {
  if (!shift || !s.subSets) return s;
  const subSets = s.subSets.map((sub, k) =>
    k <= j || sub.touched?.weight ? sub : shiftRow(sub, shift, ex, !!sub.bodyweightMode, s, snap),
  );
  return holdTouchedSubs({ ...s, subSets }, oldKgs, ex, j + 1);
}

/** 一组各行带符号的 kg：[母组, 第 1 档, 第 2 档 …] */
const rowKgs = (s: SetLog, ex: Exercise): number[] => [signedKg(s, ex), ...(s.subSets ?? []).map(x => signedKg(x, ex, s))];

/** 手打的数不在格子上（snap 会挪它）：跟着的组原样平移，不吸格 —— 打 61.2 后面就是 61.2，不是 61.25（2026-11-18 用户定） */
const typedSnap = (snap: ((kg: number) => number) | undefined, typedKg: number) =>
  snap && Math.abs(snap(typedKg) - typedKg) < 1e-6 ? snap : undefined;

/**
 * 手改过的档不跟着平移，但上一行越过它时不让方向翻过来（母组降到递减档下面，标签会变成「递增」）：
 * 贴着上一行，本来的数记在 want 里，上一行让开了就回去（2026-11-18）。只看第 from 档及以后。
 * oldKgs＝改之前各行的数（rowKgs），用来认它本来是递减还是递增。
 */
function holdTouchedSubs(next: SetLog, oldKgs: number[], ex: Exercise, from = 0): SetLog {
  if (!next.subSets?.length || oldKgs.length !== next.subSets.length + 1) return next;
  let prevNew = signedKg(next, ex);
  let changed = false;
  const subSets = next.subSets.map((sub, k) => {
    const cur = signedKg(sub, ex, next);
    let out = sub;
    if (k >= from && sub.touched?.weight) {
      const target = sub.want ?? cur;
      // 正贴着上一行（有 want）：本来的方向＝它想去的那一边的反面
      const dir = sub.want !== undefined ? -Math.sign(sub.want - oldKgs[k]) : Math.sign(cur - oldKgs[k]);
      const crossed = dir !== 0 && Math.sign(target - prevNew) === -dir;
      const v = crossed ? prevNew : target;
      if (v !== cur || crossed !== (sub.want !== undefined)) {
        const { want: _w, ...rest } = sub;
        const signed = !!sub.bodyweightMode || !!next.bodyweightMode || v < 0;
        out = { ...rest, ...(signed ? fromSignedKg(v) : { weight: Math.max(0, v) }), ...(crossed ? { want: target } : {}) };
        changed = true;
      }
    }
    prevNew = signedKg(out, ex, next);
    return out;
  });
  return changed ? { ...next, subSets } : next;
}

/**
 * 一组（或一档）的重量平移 shift（带符号的 kg）：带正负的负荷连号一起写，普通重量不低于 0。
 * 被 0 截住的记下本来该是多少（want，工作台专用）：20→10 的递减，母组改成 5 再改回 20，档回到 10 而不是 15。
 */
function shiftRow<T extends SetLog | SubSetLog>(
  x: T, shift: number, ex: Exercise, signed: boolean, parent?: SetLog, snap?: (kg: number) => number,
): T {
  const { want, ...rest } = x;
  const target = (want ?? signedKg(x, ex, parent)) + shift;
  // 被带着平移过就不再是「从上一次纯换算来的」：切单位时从当前值重算，不再回到上一次的原值
  if (!(signed || x.bodyweightMode) && target < 0) return { ...rest, weight: 0, draftAuto: false, want: target } as T;
  const v = snap ? snap(target) : target;
  const w = signed || x.bodyweightMode ? fromSignedKg(v) : { weight: Math.max(0, v) };
  return { ...rest, ...w, draftAuto: false } as T;
}

/**
 * 带正负的动作里一组的号（审查 C6）：组上写了按组；重量是 0 的组（没有号可言）沿用这个动作里
 * 前面最近一组有重量的号 —— 0 的组打正数，辅助 20 后面接着记辅助；前面都没有重量按动作实例（旧数据整场一个号）。
 */
export function carrySign(ex: Exercise, s: SetLog): -1 | 1 {
  if (Number(s.weight) > 0) return setSign(s, ex);
  const i = ex.sets.findIndex(x => x.id === s.id);
  for (let k = i - 1; k >= 0; k--) if (Number(ex.sets[k].weight) > 0) return setSign(ex.sets[k], ex);
  return setSign(s, ex);
}

/**
 * 母组从 prev 变成 next：没改过重量的递减档平移 shift；改过的不动，除非母组越过了它（holdTouchedSubs）。
 * oldParentKg：prev 已经是新值时（打字结算）另给。
 */
function shiftSubs(
  next: SetLog, prev: SetLog, shift: number, ex: Exercise, signed: boolean, snap?: (kg: number) => number, oldParentKg?: number,
): SetLog {
  if (!shift || !next.subSets?.length) return next;
  const oldKgs = rowKgs(prev, ex);
  if (oldParentKg !== undefined) oldKgs[0] = oldParentKg;
  const subSets = next.subSets.map(sub => (sub.touched?.weight ? sub : shiftRow(sub, shift, ex, signed, prev, snap)));
  return holdTouchedSubs({ ...next, subSets }, oldKgs, ex);
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
 * 把指针挪到某张卡的第 gap 条缝（点组号、拖书签共用）：缝上面的行一律记成练过，下面的一律退回（值保留）。
 * 全零的行也照记 —— 它只表示指针在哪一边，入不入册另看 willRecord。
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
  let next = exs;
  let seq = nextSeq(exs);
  flatRows(exs).forEach((r, i) => {
    next = patchSet(next, r, s => {
      if (i < N) return isPending(s) ? asDone(s, seq++) : s;
      if (isPending(s)) return s;
      const { seq: _q, skipped: _sk, ...rest } = s;
      return { ...rest, ghost: true };
    });
  });
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

/**
 * 这一组改记到组里另一个动作名下（值原样带过去）。
 * 带过去的只是这一组的数（审查 A7）：「上次 x」参考、从上一次纯换算来的标记是原来那个动作的，剥掉；
 * 号按目标动作的口径重写（目标不按带正负记：辅助的组变成 0、负重的照重量记；目标按带正负记：带符号的数原样）。
 * isSigned：目标动作按不按带正负记（不传＝不改号，workbench-check 用）。
 */
export function moveSetToExercise(exs: Exercise[], r: RowRef, toExId: string, isSigned?: (ex: Exercise) => boolean): Exercise[] {
  if (r.exId === toExId) return exs;
  const s = findSet(exs, r);
  const from = exs.find(e => e.id === r.exId);
  const to = exs.find(e => e.id === toExId);
  if (!s || !from || !to) return exs;
  const { prefillRef: _pr, draftAuto: _da, checkWeight: _cw, ...rest } = s;
  let moved: SetLog = rest;
  if (isSigned) {
    const fix = <T extends SetLog | SubSetLog>(x: T, parent?: SetLog): T => {
      const kg = signedKg(x, from, parent);
      if (isSigned(to)) return { ...x, ...fromSignedKg(kg) };
      const { bodyweightMode: _bm, ...plain } = x;
      return { ...plain, weight: Math.max(0, kg) } as T;
    };
    moved = { ...fix(moved), ...(moved.subSets?.length ? { subSets: moved.subSets.map(sub => fix(sub, s)) } : {}) };
  }
  if (moved.subSets?.length) {
    moved = { ...moved, subSets: moved.subSets.map(({ prefillRef: _spr, draftAuto: _sda, checkWeight: _scw, ...sub }) => sub) };
  }
  return exs.map(e => {
    if (e.id === r.exId) return { ...e, sets: e.sets.filter(x => String(x.id) !== r.setId) };
    if (e.id === toExId) return { ...e, sets: [...e.sets, moved] };
    return e;
  });
}

/** 英文名里不拿来当简称的虚词 */
const ABBR_STOP = new Set(['the', 'a', 'an', 'with', 'on', 'of', 'and', 'to', 'in', 'at', 'for']);
/**
 * 一个词 / 段能压成的简称，先好的后差的：中文最多两个字（引体向上 → 引体；词表外的长段再试末两个字），
 * 英文 ≤5 个字母照写，长的取前 4 个加点
 */
const clipAbbr = (w: string): string[] => {
  if (!/\p{Script=Han}/u.test(w)) return [w.length <= 5 ? w : `${w.slice(0, 4)}.`];
  const cs = [...w];
  return cs.length <= 2 ? [w] : [cs.slice(0, 2).join(''), cs.slice(-2).join('')];
};
/** 名字切成词：中文按动作词表（nameSegments），英文按空格 / 连字符 */
function abbrWords(name: string): string[] {
  const clean = name.replace(/[（）()·]/g, ' ').trim();
  if (/\p{Script=Han}/u.test(clean)) return clean.split(/\s+/).flatMap(segmentName).filter(Boolean);
  return clean.split(/[\s\-/]+/).filter(w => w && !ABBR_STOP.has(w.toLowerCase()));
}

/**
 * 交替组每个成员的简称（2026-10-21 用户定：一个字认不出是哪个，改成一个词）：
 * 按词从后往前找第一个别的成员名字里没有的词（哑铃卧推 / 哑铃飞鸟 → 卧推 / 飞鸟；
 * 上斜哑铃卧推 / 平板哑铃卧推 → 上斜 / 平板；Dumbbell Bench Press / Dumbbell Fly → Press / Fly）。
 * 词都一样（词表外的自建名）退回原来的「别人没有的一个字」；还撞就 A / B / C。
 */
export function memberAbbrs(names: string[]): string[] {
  const words = names.map(abbrWords);
  const lower = (w: string) => w.toLowerCase();
  // 每个成员的候选，先好的后差的：别人没有的词（从后往前）压成的简称，再是别人没有的一个字
  const cands = names.map((n, i) => {
    const others = new Set(words.filter((_, j) => j !== i).flat().map(lower));
    const own = [...words[i]].reverse().filter(x => !others.has(lower(x))).flatMap(clipAbbr);
    const otherChars = names.filter((_, j) => j !== i).join('');
    const ch = [...n.replace(/[（）()\s·]/g, '')].reverse().find(c => !otherChars.includes(c));
    return ch ? [...own, ch] : own;
  });
  // 截短后和别人的候选撞了（甲乙丙 / 甲乙丁 都压成「甲乙」）就往后换；都撞或一个都没有用字母
  const picked = cands.map((cs, i) => {
    const taken = new Set(cands.filter((_, j) => j !== i).flat().map(lower));
    return cs.find(c => !taken.has(lower(c))) ?? '';
  });
  return picked.map((a, i) => a || String.fromCharCode(65 + (i % 26)));
}

/**
 * 这组结束训练 / 保存修改时入不入册（2026-11 用户定）：卡上有数的组都入册，不论点没点过组号；全零的不入册。
 * 组号的「做完」只管指针和选中。不想记的组删掉（行尾删除）。
 */
export function willRecord(s: SetLog): boolean {
  // 值字段表在 setValues：速度、自定义记录项也算数（上架审查 C21）
  return setHasValue(s);
}

/**
 * 入册的样子：只留 willRecord 的组，剥掉工作台标记；一组都不剩的动作整个丢掉，只剩一个成员的交替组拆掉。
 * prefillFrom / prefillGym 只服务工作台眉批；fromGhost（已停写）、touched、seq、added 都是工作台上的标记，不跟进历史。
 * 结束训练、保存修改、判「编辑态改没改」共用这一份；刊末页的组数也从它来。
 */
export function recordedExercises(exercises: Exercise[] | undefined): Exercise[] {
  return normalizeGroups(
    (exercises ?? [])
      .map(ex => {
        const { prefillFrom: _pf, prefillGym: _pg, ...rest } = ex;
        return {
          ...rest,
          sets: (ex.sets ?? []).filter(willRecord).map(s => {
            const { fromGhost: _fg, touched: _t, ...set } = stripWorkbenchSet({ ...s, ghost: false });
            return set.subSets?.length ? { ...set, subSets: set.subSets.map(({ touched: _st, ...sub }) => sub) } : set;
          }),
        };
      })
      .filter(ex => ex.sets.length > 0),
  );
}

/**
 * 没选部位、也没手打标题时的兜底标题。
 *
 * 原先写死 `Workout ${new Date().toLocaleDateString()}`：中文模式下刊头是英文单词，
 * 而日期又跟着【浏览器】的 locale 走而不是 App 的语言设置 —— 两头都不对。
 * 现在词和日期都由 lang 决定。标题是存进库里的数据，之后不再随语言切换而变，
 * 这符合「记下来的就是当时那句」的直觉。
 */
export function defaultWorkoutTitle(isCn: boolean, now: Date = new Date()): string {
  return isCn
    ? `训练 ${now.toLocaleDateString('zh-CN')}`
    : `Workout ${now.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })}`;
}

/**
 * 一场要入册的样子（不含 status / finishedAt，由写库的一方补）：只留 willRecord 的组、补缺省标题和日期、挂上计划。
 * 一组可入册的都没有就是 null。手动结束和自动收尾（WorkoutContext.settle*）共用这一份，口径不会分叉。
 */
export function toRecorded(w: WorkoutSession, opts: { isCn: boolean; scheduleId?: string | null; fallbackDate?: string }): WorkoutSession | null {
  const exercises = recordedExercises(w.exercises);
  if (exercises.length === 0) return null;
  const date = w.date || opts.fallbackDate || new Date().toISOString();
  return {
    ...w,
    exercises,
    title: w.title || defaultWorkoutTitle(opts.isCn, new Date(date)),
    date,
    ...(opts.scheduleId ? { fromSchedule: { scheduleId: opts.scheduleId } } : {}),
  };
}

/**
 * 这一场有没有人亲手动过：点过组号（指针以上），或改过数、点过力竭。原样的底稿 / 计划行不算。
 * 自动收尾（用户没点结束）只收动过的场：开了场、加了带底稿的动作就走了，不该凭空记成一场训练。
 */
export function hasUserInput(exercises: Exercise[] | undefined): boolean {
  const touched = (t?: Record<string, boolean | undefined>) => Object.values(t ?? {}).some(Boolean);
  return (exercises ?? []).some(ex =>
    (ex.sets ?? []).some(s => !s.ghost || s.toFailure || touched(s.touched) || (s.subSets ?? []).some(sub => touched(sub.touched))),
  );
}

/**
 * 结束时的计数（上架审查 C20）：sets＝会入册的组数（和 recordedExercises 同一判定），below＝其中还在指针下面的组
 * （填了数、没点组号）。below > 0 时结束前问一句：全部保存，还是只存到指针（2026-11-24 用户定）。
 */
export function recordTally(exercises: Exercise[] | undefined): { sets: number; below: number } {
  let sets = 0;
  let below = 0;
  for (const ex of exercises ?? [])
    for (const s of ex.sets ?? []) {
      if (!willRecord(s)) continue;
      sets++;
      if (s.ghost) below++;
    }
  return { sets, below };
}

/** 只存到指针：每张卡只留指针以上的组（ghost=false）；交给 recordedExercises 后，一组都不剩的动作整个不入册 */
export function upToPointer(exercises: Exercise[] | undefined): Exercise[] {
  return (exercises ?? []).map(ex => ({ ...ex, sets: (ex.sets ?? []).filter(s => !s.ghost) }));
}

/** 结束训练：剥掉工作台标记；只剩一个成员的交替组拆掉 */
export function stripWorkbenchSet<T extends SetLog>(s: T): T {
  // prefillRef / draftAuto 只服务工作台上的「上次 x」与切单位重算，不进历史（递减档上的也剥）
  const { skipped: _sk, seq: _q, added: _ad, prefillRef: _pr, draftAuto: _da, checkWeight: _cw, want: _wa, ...rest } = s;
  return (rest.subSets?.length
    ? { ...rest, subSets: rest.subSets.map(({ prefillRef: _spr, draftAuto: _sda, checkWeight: _scw, want: _swa, ...sub }) => sub) }
    : rest) as T;
}
