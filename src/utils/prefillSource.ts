/**
 * 底稿抄哪一场 —— docs/design-plates.md「换馆重量」A（2026-10-20 用户定）。
 *
 * 同一个动作（同一做法）先找今天这个馆最近一次练过的；本馆没练过才退回任意馆最近一次。
 * 今天没标馆 → 照旧取最近一次（不分馆）。
 * 只有器械类（配重片 / 挂片，gymScopedKind）才按馆优先：杠铃、哑铃是真重量，别的馆上一次练的照样是最新的数
 * （审查 A11：原来一律本馆优先，会抄回本馆几个月前的旧数）。preferGym 由调用方按这条传。
 * 加动作（useWorkoutMutations.findLast）、换做法、换馆重新挑底稿（useGymSwitch）共用这一份。
 */
import type { Exercise, SetLog, WorkoutSession } from '../../types';
import { prSetsOf } from './prRecords';
import { rowEdited } from './setValues';

export interface LastHit {
  ex: Exercise;
  workout: WorkoutSession;
  /** findLastIn 收齐的这一场里同项目的全部卡（按卡序，ex 是第一张）；交替搭配（altCombosByName）没有 */
  exs?: Exercise[];
}

export type PrefillHit = LastHit & { exs: Exercise[] };

/**
 * workouts 按时间新的在前（WorkoutContext 的顺序）。
 * variantId：null / undefined＝不分做法；''＝标准做法；其余＝那个做法。
 * 一场里同一项目（名字 + 做法）可能有几张卡（计划排两行、并入上一场、复制为今天、CSV 两个外来名对到同一动作）：
 * 命中那场后把同名同做法、有做完组的卡按卡序都收进 exs，读的人合起来看（审查 C84 / gap-4#1）；挑哪一场不受影响。
 */
export function findLastIn(
  workouts: WorkoutSession[],
  resolveName: (n: string) => string,
  variantIdOf: (ex: Exercise) => string | undefined,
  exerciseName: string,
  variantId?: string | null,
  skipWorkoutId?: string,
  preferGym?: string,
  /** 只找这个时间之前的（给旧训练补加动作：底稿不能抄自那一场之后练的） */
  before?: string,
): PrefillHit | null {
  const target = resolveName(exerciseName);
  if (!target) return null;
  const beforeMs = before ? new Date(before).getTime() : NaN;
  let fallback: PrefillHit | null = null;
  for (const w of workouts) {
    if (skipWorkoutId && w.id === skipWorkoutId) continue;
    if (Number.isFinite(beforeMs) && !(new Date(w.date).getTime() < beforeMs)) continue;
    // 已经有退路了，别的馆的就不用再看
    if (fallback && w.gym !== preferGym) continue;
    for (const we of w.exercises) {
      if (resolveName(we.name) !== target) continue;
      if (variantId !== null && variantId !== undefined && (variantIdOf(we) || undefined) !== (variantId || undefined)) continue;
      if (!we.sets?.some(s => !s.ghost)) continue;
      // 不分做法（variantId null）时也只收和命中那张同做法的：两种做法的数不能铺进一张卡
      const vid = variantIdOf(we) || undefined;
      const exs = w.exercises.filter(
        e => resolveName(e.name) === target && (variantIdOf(e) || undefined) === vid && e.sets?.some(s => !s.ghost),
      );
      const hit = { ex: we, workout: w, exs };
      if (!preferGym || w.gym === preferGym) return hit;
      fallback ??= hit;
      break;
    }
  }
  return fallback;
}

/**
 * 这一场要铺 n 张同项目的卡时，第 k 张（0 起）抄上一场的哪几张：
 * 只铺一张＝上一场这个项目的全部卡（合起来按卡序）；铺几张（计划排了两行、换馆重挑）＝一一对应，上一场不够就取最后一张。
 * 一一对应是为了不让两行各铺出全部组、行数翻倍。
 */
export function sourceCards(hit: LastHit, k: number, n: number): Exercise[] {
  const exs = hit.exs ?? [hit.ex];
  return n <= 1 ? exs : [exs[Math.min(k, exs.length - 1)]];
}

/**
 * 这张卡是不是「全是没动过的底稿」：都是待做、一格都没改过（含速度 / 自定义项、点了力竭，见 setValues.rowEdited）、不是从计划来的。
 * 换馆时只有这种卡按新馆重新挑底稿来源（有做完 / 改过的组的卡只重新取整，同换做法的口径）。
 */
export function isPristineDraftCard(sets: SetLog[] | undefined): boolean {
  if (!sets?.length) return false;
  return sets.every(s => s.ghost && !rowEdited(s) && !s.prefillRef?.plan);
}

/** 一个动作交替做过的一种搭配；mates＝同组其他动作的名字，按那场的先后 */
export interface AltCombo extends LastHit {
  mates: string[];
}

/**
 * 每个动作交替做过的各种搭配（键：resolveName 后的名字）：最近的在前，成员相同的不管先后只留最近一次。
 * 只算同组还有别的成员、且这个动作有做完的组的。不分馆、不分做法 —— 搭档关系跟馆和做法无关。
 * 2026-11-10 用户指出：123 交替之后做了一次 13，下次想按 123 就带不出来，所以全列出来给选动作列表用。
 */
export function altCombosByName(
  workouts: WorkoutSession[],
  resolveName: (n: string) => string,
  skipWorkoutId?: string,
  before?: string,
): Map<string, AltCombo[]> {
  const beforeMs = before ? new Date(before).getTime() : NaN;
  const out = new Map<string, AltCombo[]>();
  const seen = new Set<string>();
  for (const w of workouts) {
    if (skipWorkoutId && w.id === skipWorkoutId) continue;
    if (Number.isFinite(beforeMs) && !(new Date(w.date).getTime() < beforeMs)) continue;
    const groups = new Map<string, Exercise[]>();
    for (const e of w.exercises) if (e.altGroup) groups.set(e.altGroup, [...(groups.get(e.altGroup) ?? []), e]);
    for (const members of groups.values()) {
      if (members.length < 2) continue;
      const names = members.map(m => resolveName(m.name));
      const sig = [...names].sort().join('\n');
      members.forEach((ex, i) => {
        const key = `${names[i]}\n${sig}`;
        if (seen.has(key) || !ex.sets?.some(s => !s.ghost)) return;
        seen.add(key);
        out.set(names[i], [...(out.get(names[i]) ?? []), { ex, workout: w, mates: names.filter((_, j) => j !== i) }]);
      });
    }
  }
  return out;
}

/**
 * 这个动作最近一次**交替着做**的那场，给「连带交替搭档」用。
 * 只看上一次不够：上一次单练了、再想按交替组练时，开关开着也带不进搭档（2026-11-02 用户指出）。
 */
export function findLastAltGroup(
  workouts: WorkoutSession[],
  resolveName: (n: string) => string,
  exerciseName: string,
  skipWorkoutId?: string,
  before?: string,
): LastHit | null {
  return altCombosByName(workouts, resolveName, skipWorkoutId, before).get(resolveName(exerciseName))?.[0] ?? null;
}

/** 一组：带符号的 kg（辅助为负）+ 次数 */
export interface VsSet {
  kg: number;
  reps: number;
}

/** 一张卡做完的组里最好的一组：最重（带符号），同重取次数多的；递减 / 递增档各算一组（同 prRecords / liftHistory 的口径） */
function bestSet(ex: Exercise, signed: boolean): VsSet | null {
  let top: VsSet | null = null;
  for (const { kg, reps } of prSetsOf(ex, undefined, signed)) {
    if (kg === 0 && reps === 0) continue;
    if (!top || kg > top.kg || (kg === top.kg && reps > top.reps)) top = { kg, reps };
  }
  return top;
}

/** 几张卡合起来最好的一组 */
function bestOfCards(cards: Exercise[], signed: boolean): VsSet | null {
  let top: VsSet | null = null;
  for (const c of cards) {
    const b = bestSet(c, signed);
    if (b && (!top || b.kg > top.kg || (b.kg === top.kg && b.reps > top.reps))) top = b;
  }
  return top;
}

/** 刊末页「比上次」的一行；key＝项目键（带做法，和 PB 牌同源） */
export interface VsLastRow {
  exId: string;
  key: string;
  now: VsSet;
  last: VsSet;
  /** 器械上一场不在今天这个馆（本馆没练过，退回别的馆比）：那个馆的名字 */
  lastGym?: string;
}

/**
 * 刊末页「比上次」（2026-11-13 用户定 D6）：这场每个项目的最好一组 vs 上一场同项目的最好一组，只陈述、不给建议。
 * 上一场由调用方按底稿的口径找（findLastIn：同做法，器械本馆优先、本馆没练过退回别的馆），没有上一场、或哪边一组有数的都没有就不列。
 * 一个项目一行：本场按 keyOf 把同项目的几张卡合起来，上一场取 findLastIn 收齐的那几张（审查 gap-6#5：原来按卡比，退阶卡拿去比上次的正式组）。
 * 器械退回别的馆比时带出那个馆（gap-6#6），刊末页写「上次在 X」；挑哪一场不变。
 */
export function vsLastSession(
  exs: Exercise[],
  o: {
    keyOf: (ex: Exercise) => string;
    findLast: (ex: Exercise) => LastHit | null;
    signedOf: (ex: Exercise) => boolean;
    gymScoped: (ex: Exercise) => boolean;
    /** 今天这一场的馆 */
    gym: string | undefined;
  },
): VsLastRow[] {
  const groups = new Map<string, Exercise[]>();
  for (const ex of exs) {
    const k = o.keyOf(ex);
    groups.set(k, [...(groups.get(k) ?? []), ex]);
  }
  const out: VsLastRow[] = [];
  for (const [key, cards] of groups) {
    const signed = cards.some(o.signedOf);
    const now = bestOfCards(cards, signed);
    const hit = now ? o.findLast(cards[0]) : null;
    const last = hit ? bestOfCards(hit.exs ?? [hit.ex], signed) : null;
    if (!now || !last) continue;
    const lg = hit!.workout.gym;
    out.push({ exId: cards[0].id, key, now, last, ...(o.gymScoped(cards[0]) && lg && lg !== o.gym ? { lastGym: lg } : {}) });
  }
  return out;
}

/**
 * 卡头点开的「上次」：这张卡的底稿抄自哪一场、那次做了哪几组（审查 C2：prefillFrom 原来只写不读）。
 * 按底稿记下的来源卡（prefillIds）取，几张合起来按卡序；先找 date === prefillFrom 的那场，
 * 找不到（那场后来并入上一场，日期变了）就只按 id 找（审查 gap-6#3：原来按「日期 + 名字」取第一张同名卡，不分做法）。
 * 没有 prefillIds 的旧草稿退回「同日期 + 名字 + 做法」那场的全部同项目卡。
 * 第一次调用时建一次索引、结果按键缓存（审查 F4：原来每张卡每次渲染都线性扫全部训练），同一键回同一个对象，卡片的 memo 才比得住。
 */
export function prefillSourceLookup(
  workouts: WorkoutSession[],
  resolveName: (n: string) => string,
  variantIdOf: (ex: Exercise) => string | undefined,
): (ex: Exercise) => { date: string; sets: SetLog[] } | null {
  let byId: Map<string, { date: string; ex: Exercise }[]> | null = null;
  const hits = new Map<string, { date: string; sets: SetLog[] } | null>();
  const pack = (date: string, cards: Exercise[]) => {
    const sets = cards.flatMap(c => (c.sets ?? []).filter(s => !s.ghost));
    return sets.length ? { date, sets } : null;
  };
  return ex => {
    if (!ex.prefillFrom) return null;
    const ids = ex.prefillIds ?? [];
    const k = ids.length
      ? `${ex.prefillFrom}\n#${ids.join('\n')}`
      : `${ex.prefillFrom}\n${resolveName(ex.name)}\n${variantIdOf(ex) ?? ''}`;
    if (hits.has(k)) return hits.get(k)!;
    let hit: { date: string; sets: SetLog[] } | null = null;
    if (ids.length) {
      if (!byId) {
        byId = new Map();
        for (const w of workouts)
          for (const e of w.exercises ?? []) byId.set(e.id, [...(byId.get(e.id) ?? []), { date: w.date, ex: e }]);
      }
      const found = ids.map(id => byId!.get(id) ?? []);
      // 卡 id 只在一场里唯一：同 id 出现在几场时（复制、导入）先取 prefillFrom 那场的
      const sameDay = found.map(xs => xs.find(x => x.date === ex.prefillFrom)).filter(x => !!x);
      const cards = sameDay.length ? sameDay : found.map(xs => xs[0]).filter(x => !!x);
      if (cards.length) hit = pack(cards[0].date, cards.map(c => c.ex));
    } else {
      const name = resolveName(ex.name);
      const vid = variantIdOf(ex) || undefined;
      for (const w of workouts) {
        if (w.date !== ex.prefillFrom) continue;
        const cards = (w.exercises ?? []).filter(e => resolveName(e.name) === name && (variantIdOf(e) || undefined) === vid);
        if (cards.length) {
          hit = pack(w.date, cards);
          break;
        }
      }
    }
    hits.set(k, hit);
    return hit;
  };
}
