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

export interface LastHit {
  ex: Exercise;
  workout: WorkoutSession;
}

/**
 * workouts 按时间新的在前（WorkoutContext 的顺序）。
 * variantId：null / undefined＝不分做法；''＝标准做法；其余＝那个做法。
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
): LastHit | null {
  const target = resolveName(exerciseName);
  if (!target) return null;
  const beforeMs = before ? new Date(before).getTime() : NaN;
  let fallback: LastHit | null = null;
  for (const w of workouts) {
    if (skipWorkoutId && w.id === skipWorkoutId) continue;
    if (Number.isFinite(beforeMs) && !(new Date(w.date).getTime() < beforeMs)) continue;
    // 已经有退路了，别的馆的就不用再看
    if (fallback && w.gym !== preferGym) continue;
    for (const we of w.exercises) {
      if (resolveName(we.name) !== target) continue;
      if (variantId !== null && variantId !== undefined && (variantIdOf(we) || undefined) !== (variantId || undefined)) continue;
      if (!we.sets?.some(s => !s.ghost)) continue;
      const hit = { ex: we, workout: w };
      if (!preferGym || w.gym === preferGym) return hit;
      fallback ??= hit;
      break;
    }
  }
  return fallback;
}

const touchedAny = (s: { touched?: Record<string, boolean | undefined> }) => Object.values(s.touched ?? {}).some(Boolean);

/**
 * 这张卡是不是「全是没动过的底稿」：都是待做、一格都没改过、不是从计划来的。
 * 换馆时只有这种卡按新馆重新挑底稿来源（有做完 / 改过的组的卡只重新取整，同换做法的口径）。
 */
export function isPristineDraftCard(sets: SetLog[] | undefined): boolean {
  if (!sets?.length) return false;
  return sets.every(
    s => s.ghost && !touchedAny(s) && !s.prefillRef?.plan && !(s.subSets ?? []).some(sub => touchedAny(sub)),
  );
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

/**
 * 刊末页「比上次」（2026-11-13 用户定 D6）：这场每个动作的最好一组 vs 上一场同动作的最好一组，只陈述、不给建议。
 * 上一场由调用方按底稿的口径找（findLastIn：同做法，器械本馆优先），没有上一场、或哪边一组有数的都没有就不列。
 */
export function vsLastSession(
  exs: Exercise[],
  findLast: (ex: Exercise) => LastHit | null,
  signedOf: (ex: Exercise) => boolean,
): { exId: string; now: VsSet; last: VsSet }[] {
  const out: { exId: string; now: VsSet; last: VsSet }[] = [];
  for (const ex of exs) {
    const signed = signedOf(ex);
    const now = bestSet(ex, signed);
    const hit = now ? findLast(ex) : null;
    const last = hit ? bestSet(hit.ex, signed) : null;
    if (now && last) out.push({ exId: ex.id, now, last });
  }
  return out;
}
