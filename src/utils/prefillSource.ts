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
import { prSetsOf, type PRRule, type PRSet } from './prRecords';
import { rowEdited } from './setValues';
import { memberKeys } from './workbench';

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

/** 一个动作交替做过的一种搭配；mates＝同组其他成员（memberKeys 的口径：同名的带做法），按那场的先后 */
export interface AltCombo extends LastHit {
  mates: string[];
}

/** 那一场里和 hit.ex 同一个交替组的全部成员，按卡序 */
const groupOf = (hit: LastHit) => hit.workout.exercises.filter(e => e.altGroup === hit.ex.altGroup);

/**
 * 每个动作交替做过的各种搭配（键：resolveName 后的名字）：最近的在前，成员相同的不管先后只留最近一次。
 * 只算同组还有别的成员、且这个动作有做完的组的。不分馆；成员按 workbench.memberKeys 认 —— 不同名的搭档关系跟馆和做法无关，
 * 同名的（§12.10 左右分记）带做法：[左,右] 和 [左,中] 是两种搭配，mates 写「哑铃弯举（右）」（审查 gap-4#2）。
 * labelOf：调用方传 liftKey。
 * 2026-11-10 用户指出：123 交替之后做了一次 13，下次想按 123 就带不出来，所以全列出来给选动作列表用。
 */
export function altCombosByName(
  workouts: WorkoutSession[],
  resolveName: (n: string) => string,
  labelOf: (ex: Exercise) => string,
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
      const keys = memberKeys(members, m => resolveName(m.name), labelOf);
      const sig = [...keys].sort().join('\n');
      members.forEach((ex, i) => {
        // 按名字去重：同名组（左 ⇄ 右）在这个名字下只列一种搭配，取先做完组的那个成员
        const key = `${names[i]}\n${sig}`;
        if (seen.has(key) || !ex.sets?.some(s => !s.ghost)) return;
        seen.add(key);
        out.set(names[i], [...(out.get(names[i]) ?? []), { ex, workout: w, mates: keys.filter((_, j) => j !== i) }]);
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
  labelOf: (ex: Exercise) => string,
  exerciseName: string,
  skipWorkoutId?: string,
  before?: string,
): LastHit | null {
  return altCombosByName(workouts, resolveName, labelOf, skipWorkoutId, before).get(resolveName(exerciseName))?.[0] ?? null;
}

/**
 * 连带交替搭档：旧组的每个成员按那场的顺序，self＝新加的这张卡占的位置（旧组里和 picked 同一成员的那张；
 * picked 的做法不在组里就占 altHit.ex 的位置）。byVariant＝这个成员的名字在组里重复（左右分记），
 * 搭档的「本场已有」、底稿和做法都要按做法认，否则「左 ⇄ 右」连带进来塌成「左 ⇄ 左」（审查 C103）。
 */
export function altPartners(
  altHit: LastHit,
  picked: Exercise,
  resolveName: (n: string) => string,
  labelOf: (ex: Exercise) => string,
): { member: Exercise; self: boolean; byVariant: boolean }[] {
  const members = groupOf(altHit);
  const names = members.map(m => resolveName(m.name));
  const keys = memberKeys(members, m => resolveName(m.name), labelOf);
  const pn = resolveName(picked.name);
  const pk = names.indexOf(pn) !== names.lastIndexOf(pn) ? labelOf(picked) : pn;
  const self = members[keys.indexOf(pk)] ?? altHit.ex;
  return members.map((m, i) => ({ member: m, self: m === self, byVariant: names.indexOf(names[i]) !== names.lastIndexOf(names[i]) }));
}

/**
 * 从计划开练时每一行的做法和交替组（审查 gap-4#3）。计划行不记做法（ScheduleEditorModal），做法从历史里推：
 *   - 交替：每行找这个动作最近一次交替做的那场（同选动作行的口径），计划里第 n 个同名行对旧组里第 n 张同名卡，行比卡多就落到最后一张；
 *     同一个旧组里对到的不同旧卡至少两张才成组，对到同一张旧卡的只有第一行进组（「卧推、深蹲、卧推」不会把两段卧推并进一组）。
 *   - 做法：成组且旧组里这个名字重名（左右分记）就跟对到的旧卡；否则计划里这个名字有几行时第 n 行对上一场第 n 张同名卡；
 *     只有一行的不指定（variantId undefined，按上一次）。'' ＝标准做法。
 * group：成组的行给同一个键（旧那场 id | 旧组 id），调用方换成新组 id。
 */
export function planRowPicks(
  names: string[],
  workouts: WorkoutSession[],
  resolveName: (n: string) => string,
  labelOf: (ex: Exercise) => string,
  variantIdOf: (ex: Exercise) => string | undefined,
  lastOf: (name: string) => LastHit | null,
  inheritAlt: boolean,
): { variantId?: string; group?: string }[] {
  const resolved = names.map(n => resolveName(n));
  const nth = resolved.map((n, i) => resolved.slice(0, i).filter(x => x === n).length);
  const count = (n: string) => resolved.filter(x => x === n).length;
  const pickOf = <T>(xs: T[], k: number) => xs[Math.min(k, xs.length - 1)];
  // ① 每行对到旧组里的哪张卡
  const altRows = resolved.map((n, i) => {
    const hit = inheritAlt ? findLastAltGroup(workouts, resolveName, labelOf, n) : null;
    if (!hit) return null;
    const members = groupOf(hit);
    const same = members.filter(m => resolveName(m.name) === n);
    return { key: `${hit.workout.id}|${hit.ex.altGroup}`, card: pickOf(same, nth[i]), dupName: same.length > 1 };
  });
  // ② 同一个旧组里对到的不同旧卡 ≥ 2 张才成组；同一张旧卡只有第一行进组
  const firstRowOfCard = new Map<string, number>();
  altRows.forEach((r, i) => {
    if (r && !firstRowOfCard.has(`${r.key}\n${r.card.id}`)) firstRowOfCard.set(`${r.key}\n${r.card.id}`, i);
  });
  const cardsPerGroup = new Map<string, number>();
  for (const k of firstRowOfCard.keys()) {
    const g = k.split('\n')[0];
    cardsPerGroup.set(g, (cardsPerGroup.get(g) ?? 0) + 1);
  }
  // ③ 做法
  return resolved.map((n, i) => {
    const r = altRows[i];
    const grouped = !!r && firstRowOfCard.get(`${r.key}\n${r.card.id}`) === i && (cardsPerGroup.get(r.key) ?? 0) >= 2;
    let variantId: string | undefined;
    if (grouped && r!.dupName) variantId = variantIdOf(r!.card) ?? '';
    else if (count(n) > 1) {
      const last = lastOf(names[i]);
      const cards = last ? last.workout.exercises.filter(e => resolveName(e.name) === n && e.sets?.some(s => !s.ghost)) : [];
      if (cards.length) variantId = variantIdOf(pickOf(cards, nth[i])) ?? '';
    }
    return { ...(variantId !== undefined ? { variantId } : {}), ...(grouped ? { group: r!.key } : {}) };
  });
}

/** 一组：带符号的 kg（辅助为负）+ 次数；有氧的组另带时长（秒）、距离（km）、速度（km/h，没打按距离 ÷ 时长），没值的不带 */
export interface VsSet {
  kg: number;
  reps: number;
  duration?: number;
  distance?: number;
  speed?: number;
}

/**
 * 几张卡做完的组里最好的一组；递减 / 递增档各算一组（同 prRecords / liftHistory 的口径）。
 * 记重量或次数的：最重（带符号），同重取次数多的；记次数的动作跳过次数为 0 的组（审查 C81：120×0 不能当成这场最好的一组）。
 * 只记有氧的：按纪录先后的第一项（距离 / 速度 / 时长）挑，同值取均速快的（审查 C85）
 */
function bestOfCards(cards: Exercise[], signed: boolean, rule: PRRule): VsSet | null {
  const k = rule.tracksWeight || rule.tracksReps ? null : rule.cardio[0];
  const val = (s: PRSet) => (k === 'distance' ? s.km : k === 'speed' ? s.kmh : s.sec);
  let top: PRSet | null = null;
  for (const s of cards.flatMap(c => prSetsOf(c, undefined, signed))) {
    if (k) {
      if (val(s) > 0 && (!top || val(s) > val(top) || (val(s) === val(top) && s.kmh > top.kmh))) top = s;
      continue;
    }
    if ((s.kg === 0 && s.reps === 0) || (rule.tracksReps && s.reps === 0)) continue;
    if (!top || s.kg > top.kg || (s.kg === top.kg && s.reps > top.reps)) top = s;
  }
  if (!top) return null;
  return {
    kg: top.kg,
    reps: top.reps,
    ...(top.sec ? { duration: top.sec } : {}),
    ...(top.km ? { distance: top.km } : {}),
    ...(top.kmh ? { speed: top.kmh } : {}),
  };
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
    /** 这个动作按哪套规矩比（prRuleFor）：带号、器械、记不记次数 */
    ruleOf: (ex: Exercise) => PRRule;
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
    const rule = o.ruleOf(cards[0]);
    const signed = cards.some(c => o.ruleOf(c).signed);
    const now = bestOfCards(cards, signed, rule);
    const hit = now ? o.findLast(cards[0]) : null;
    const last = hit ? bestOfCards(hit.exs ?? [hit.ex], signed, rule) : null;
    if (!now || !last) continue;
    const lg = hit!.workout.gym;
    out.push({ exId: cards[0].id, key, now, last, ...(rule.machine && lg && lg !== o.gym ? { lastGym: lg } : {}) });
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
