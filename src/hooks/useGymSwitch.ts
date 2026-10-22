/**
 * 手动切单位 / 换馆 / 改今天这个馆的档案 —— docs/design-plates.md §3「馆档案」。
 *
 * 切单位＝纯换算（2026-10-21 用户定，原来 10-18 是「单位就是片子」、切了就重新取整）：
 * 存的 kg 一个不动，只换显示单位，60 kg 就显示 132.28 lb。之后横划 / ± / 手改的那一组才按新单位的档位走（取整器照旧）。
 * 换馆才是换了一套片子：没做完的组按新馆的片子 / 档位重新取整（reRoundPending）；做完的不动。
 * 选一个设过档案的馆，单位跟着切到那个馆的片子单位。
 *
 * 只有用户亲手的这几下走这里。同步拉回来的单位、开发 / 生产切换带来的单位变化
 * 直接改 UserSettingsContext，不经过这里 —— 不能因为另一台设备切了单位就把今天的底稿改掉。
 *
 * 换馆还要重新挑底稿来源（2026-10-20「换馆重量」A）：全是没动过底稿的卡按新馆找上一次（本馆优先），
 * 挑出来的不是现在这一场就重铺；有做完 / 改过的组的卡只重新取整。
 */
import { useCallback } from 'react';
import type { Exercise, WorkoutSession } from '../../types';
import { useWorkoutContext } from '../contexts/WorkoutContext';
import { useUserSettingsContext } from '../contexts/UserSettingsContext';
import { useExercisePrefs } from '../contexts/ExercisePrefsContext';
import { reRoundPending, roundPrefill, useLoadRounder } from './useLoadRounder';
import { toGhostSets } from './useWorkoutMutations';
import { findLastIn, isPristineDraftCard } from '../utils/prefillSource';
import type { GymProfile } from '../utils/loadable';
import type { PlateUnit } from '../utils/plates';

export function useGymSwitch() {
  const { workouts } = useWorkoutContext();
  const { unit, changeUnit, appPrefs } = useUserSettingsContext();
  const { resolveName, variantIdOf } = useExercisePrefs();
  const rounderFor = useLoadRounder();

  const reRound = useCallback(
    (
      w: WorkoutSession,
      gym: string | undefined,
      u: PlateUnit,
      gyms?: Record<string, GymProfile>,
      repick = false,
    ): WorkoutSession => ({
      ...w,
      exercises: (w.exercises ?? []).map((e, i) => {
        const r = rounderFor(e, gym, u, gyms);
        if (repick && isPristineDraftCard(e.sets)) {
          const hit = findLastIn(workouts, resolveName, variantIdOf, e.name, variantIdOf(e) ?? '', w.id, gym);
          if (hit && hit.workout.date !== e.prefillFrom) {
            const { prefillGym: _pg, ...rest } = e;
            const sets = roundPrefill(toGhostSets(hit.ex.sets, `${Date.now()}_${i}`), e, r);
            return {
              ...rest,
              sets,
              prefillFrom: hit.workout.date,
              ...(hit.workout.gym ? { prefillGym: hit.workout.gym } : {}),
            } as Exercise;
          }
        }
        const sets = reRoundPending(e.sets ?? [], e, r);
        return sets === e.sets ? e : { ...e, sets };
      }),
    }),
    [rounderFor, workouts, resolveName, variantIdOf],
  );

  /** 手动切单位（训练页头上的 kg / lbs、首选项里的单位）：只换显示，不动记录、不重新取整 */
  const switchUnit = useCallback(
    (next: PlateUnit) => {
      if (next === (unit === 'lbs' ? 'lbs' : 'kg')) return;
      changeUnit(next);
    },
    [changeUnit, unit],
  );

  /**
   * 手动换馆：设过档案的馆把单位切到它的片子单位；再按新馆的片子 / 档位把没做完的组重新取整。
   * gyms：刚存的档案（编辑完今天这个馆时传，context 还没刷新）。
   */
  const switchGym = useCallback(
    (
      w: WorkoutSession,
      gym: string | undefined,
      gyms?: Record<string, GymProfile>,
      opts: { keepUnit?: boolean } = {},
    ): WorkoutSession => {
      const prof = gym ? (gyms ?? appPrefs.gyms)[gym] : undefined;
      const cur: PlateUnit = unit === 'lbs' ? 'lbs' : 'kg';
      const u: PlateUnit = opts.keepUnit ? cur : prof?.plateUnit ?? cur;
      // 点了已经选着的馆（又没改档案）：什么都不动，免得误触把手打的数重新取整
      if (!gyms && gym === w.gym && u === cur) return w;
      if (u !== cur) changeUnit(u);
      const next = { ...w };
      if (gym) next.gym = gym;
      else delete next.gym;
      // 换了馆才重新挑底稿来源；只是改了今天这个馆的档案（同一个馆）就只重新取整
      return reRound(next, gym, u, gyms, gym !== w.gym);
    },
    [appPrefs.gyms, changeUnit, reRound, unit],
  );

  return { switchUnit, switchGym };
}
