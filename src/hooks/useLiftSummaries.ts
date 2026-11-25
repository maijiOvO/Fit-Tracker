/**
 * 「按动作」的逐场数据（utils/liftHistory），首页和「我的」共用一份口径。
 *
 * 原来只在 Dashboard 里算；「我的」页的热力图镁粉点（「杠铃片」阶段二）
 * 也要知道哪天破了纪录、每个动作每场最重多少 —— 抽出来，两边同一个算法，不会各说各的。
 *
 * 全 App 共用一份结果（模块级缓存，审查 C36）：切页重挂、关着的弹层、撤销没碰到的东西都命中同一份，不再各算各的。
 * 所以拿到的 LiftSummary 只读，任何消费方都不能原地改它 —— 改了会串到别的页。
 */
import type { WorkoutSession } from '../../types';
import { buildLiftSummaries, type LiftSummary } from '../utils/liftHistory';
import { usesSignedLoad } from '../utils/load';
import { useWorkoutContext } from '../contexts/WorkoutContext';
import { hasDoneSets } from '../utils/workbench';
import { useExercisePrefs } from '../contexts/ExercisePrefsContext';
import { gymScopedIn } from './useLoadKind';

let lastDone: { all: WorkoutSession[]; skipId: string | undefined; out: WorkoutSession[] } | null = null;

/**
 * 做完的训练：去掉进行中的那场（skipId）和一组都没做完的空场。
 * 输入没变返回同一个数组；过滤出来逐个和上一次相同（加第一个动作、进行中那场开 / 关）也返回上一次的，汇总就不重算。
 */
export function doneWorkoutsOf(all: WorkoutSession[], skipId: string | undefined): WorkoutSession[] {
  if (lastDone && lastDone.all === all && lastDone.skipId === skipId) return lastDone.out;
  const next = all.filter(w => w.id !== skipId && hasDoneSets(w));
  const prev = lastDone?.out;
  const out = prev && prev.length === next.length && prev.every((w, i) => w === next[i]) ? prev : next;
  lastDone = { all, skipId, out };
  return out;
}

/**
 * 进行中的那场（工作台里有动作、还没结束）不算，一组都没做完的空场也不算 —— 它们不是数据。
 * 返回 inProgress 给首页顶上那一行用。
 */
export function useDoneWorkouts(): { workouts: WorkoutSession[]; inProgress: WorkoutSession | null } {
  const { workouts: all, currentWorkout } = useWorkoutContext();
  const inProgress =
    !!currentWorkout.id && (currentWorkout.exercises?.length ?? 0) > 0 && !currentWorkout.finishedAt
      ? currentWorkout
      : null;
  return { workouts: doneWorkoutsOf(all, inProgress?.id), inProgress };
}

type Prefs = ReturnType<typeof useExercisePrefs>;
/**
 * 汇总真正用到的首选项：只拿这几样的身份当缓存键，点星、存备注、特别关注这类改动不触发重算（审查 scale-perf#2）。
 * 不能拿组件里现建的闭包当键：每个组件各有一个 useCallback 实例，跨页永远命中不了。
 * getActiveMetrics 还读 appPrefsNow().cardioMetrics（不在键里）：它只影响有氧的 hasWeight，有氧可选的记录项里没有重量，结果不变。
 */
const KEY_FIELDS = [
  'findExerciseDef',
  'variantIdOf',
  'liftKey',
  'stableIdOf',
  'resolveName',
  'signedLoadOf',
  'getActiveMetrics',
  'attrsOf',
  'exerciseOverrides',
] as const;

let lastLifts: { done: WorkoutSession[]; key: unknown[]; out: LiftSummary[] } | null = null;

/** 做完的训练 → 逐场汇总。全 App 一格缓存：done 是同一个数组、KEY_FIELDS 逐个相同就返回上一次的 */
export function liftSummariesFor(done: WorkoutSession[], prefs: Pick<Prefs, (typeof KEY_FIELDS)[number]>): LiftSummary[] {
  const key = KEY_FIELDS.map(k => prefs[k]);
  if (lastLifts && lastLifts.done === done && lastLifts.key.every((v, i) => v === key[i])) return lastLifts.out;
  const out = buildLiftSummaries({
    workouts: done,
    stableIdOf: prefs.stableIdOf,
    liftKey: prefs.liftKey,
    resolveName: prefs.resolveName,
    signedLoadOf: ex => usesSignedLoad(ex, prefs.signedLoadOf(ex)),
    getActiveMetrics: prefs.getActiveMetrics,
    // 器械类纪录只在同一个馆里比（和刊末页同一口径，utils/prRecords）
    gymScoped: ex => gymScopedIn(ex, prefs),
  });
  lastLifts = { done, key, out };
  return out;
}

const NONE: LiftSummary[] = [];

/** enabled＝false（这一页眼下用不到，比如关着的弹层）：返回空数组，不算也不碰缓存 */
export function useLiftSummaries(workouts: WorkoutSession[], enabled = true): LiftSummary[] {
  const prefs = useExercisePrefs();
  return enabled ? liftSummariesFor(workouts, prefs) : NONE;
}
