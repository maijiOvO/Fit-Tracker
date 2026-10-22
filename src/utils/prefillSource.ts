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
