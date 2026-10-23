/**
 * 「按动作」的逐场数据（utils/liftHistory），首页和「我的」共用一份口径。
 *
 * 原来只在 Dashboard 里算；「我的」页的上片里程碑和热力图镁粉点（「杠铃片」阶段二）
 * 也要知道哪天破了纪录、每个动作每场最重多少 —— 抽出来，两边同一个算法，不会各说各的。
 */
import { useMemo } from 'react';
import type { WorkoutSession } from '../../types';
import { buildLiftSummaries, type LiftSummary } from '../utils/liftHistory';
import { usesSignedLoad } from '../utils/load';
import { hasDoneSets, useWorkoutContext } from '../contexts/WorkoutContext';
import { useExercisePrefs } from '../contexts/ExercisePrefsContext';
import { useGymScopedPR } from './useLoadKind';

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
  const workouts = useMemo(
    () => all.filter(w => w.id !== inProgress?.id && hasDoneSets(w)),
    [all, inProgress?.id],
  );
  return { workouts, inProgress };
}

export function useLiftSummaries(workouts: WorkoutSession[]): LiftSummary[] {
  const prefs = useExercisePrefs();
  // 器械类纪录只在同一个馆里比（和刊末页同一口径，utils/prRecords）
  const gymScoped = useGymScopedPR();
  return useMemo(
    () =>
      buildLiftSummaries({
        workouts,
        // 稳定键「定义 id|做法 id」：并进来的旧名也按 variantIdOf 认到同一个做法
        stableIdOf: ex => {
          const def = prefs.findExerciseDef(ex.name);
          return def ? `${def.id}|${prefs.variantIdOf(ex) ?? ''}` : `name:${prefs.liftKey(ex)}`;
        },
        liftKey: prefs.liftKey,
        resolveName: prefs.resolveName,
        signedLoadOf: ex => usesSignedLoad(ex, prefs.signedLoadOf(ex.name)),
        getActiveMetrics: prefs.getActiveMetrics,
        gymScoped,
      }),
    [workouts, prefs, gymScoped],
  );
}
