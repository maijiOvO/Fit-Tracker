/**
 * 手动切单位 / 换馆 / 改今天这个馆的档案 —— docs/design-plates.md §3「馆档案」。
 *
 * 「单位就是片子」（2026-10-18 用户定）：用户自己切到 lbs，就是今天挂的是磅片 ——
 * 工作台上没做完的组全部换到新单位那套片子上重新取整（reRoundPending）；做完的不动。
 * 选一个设过档案的馆，单位跟着切到那个馆的片子单位。
 *
 * 只有用户亲手的这几下走这里。同步拉回来的单位、开发 / 生产切换带来的单位变化
 * 直接改 UserSettingsContext，不经过这里 —— 不能因为另一台设备切了单位就把今天的底稿改掉。
 */
import { useCallback } from 'react';
import type { WorkoutSession } from '../../types';
import { useWorkoutContext } from '../contexts/WorkoutContext';
import { useUserSettingsContext } from '../contexts/UserSettingsContext';
import { reRoundPending, useLoadRounder } from './useLoadRounder';
import type { GymProfile } from '../utils/loadable';
import type { PlateUnit } from '../utils/plates';

export function useGymSwitch() {
  const { setCurrentWorkout, persistCurrentWorkout } = useWorkoutContext();
  const { unit, changeUnit, appPrefs } = useUserSettingsContext();
  const rounderFor = useLoadRounder();

  const reRound = useCallback(
    (w: WorkoutSession, gym: string | undefined, u: PlateUnit, gyms?: Record<string, GymProfile>): WorkoutSession => ({
      ...w,
      exercises: (w.exercises ?? []).map(e => {
        const sets = reRoundPending(e.sets ?? [], e, rounderFor(e, gym, u, gyms));
        return sets === e.sets ? e : { ...e, sets };
      }),
    }),
    [rounderFor],
  );

  /** 手动切单位（训练页头上的 kg / lbs、首选项里的单位） */
  const switchUnit = useCallback(
    (next: PlateUnit) => {
      if (next === (unit === 'lbs' ? 'lbs' : 'kg')) return;
      changeUnit(next);
      setCurrentWorkout(w => reRound(w, w.gym, next));
      // 落盘读的是 ref（渲染时才更新）：等这次改动渲染完再写
      window.setTimeout(() => persistCurrentWorkout(), 0);
    },
    [changeUnit, persistCurrentWorkout, reRound, setCurrentWorkout, unit],
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
      return reRound(next, gym, u, gyms);
    },
    [appPrefs.gyms, changeUnit, reRound, unit],
  );

  return { switchUnit, switchGym };
}
