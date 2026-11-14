import type { WorkoutSession } from '../../types';

/** 这一场之前练的（按 date，不含它自己）：判纪录、排期号、找「比上次」都只能看这场那天之前的 */
export function sessionsBefore(workouts: WorkoutSession[], session: Pick<WorkoutSession, 'id' | 'date'>): WorkoutSession[] {
  const at = Date.parse(session.date);
  return workouts.filter(w => w.id !== session.id && Date.parse(w.date) < at);
}

/**
 * 训练中把这场挪到另一个时刻（补录）：动作时间跟着平移，startTime 去掉 ——
 * 结束时 finishedAt 写的是现在，和开练时刻相减只是录入花的时间，不是练了多久；
 * 没有 startTime，sessionDurationMin 就不显示时长。
 */
export function redateLiveSession(w: WorkoutSession, date: Date): WorkoutSession {
  const delta = date.getTime() - Date.parse(w.date);
  const { startTime: _start, ...rest } = w;
  return {
    ...rest,
    date: date.toISOString(),
    exercises: w.exercises.map(e =>
      e.exerciseTime ? { ...e, exerciseTime: new Date(Date.parse(e.exerciseTime) + delta).toISOString() } : e,
    ),
  };
}

/** 训练中的场没有 startTime ＝ 改过日期：开练时 createNewWorkout 一定写它，只有 redateLiveSession 会去掉（没分到 id 的空工作台除外） */
export const isBackdated = (w: Pick<WorkoutSession, 'id' | 'startTime'>): boolean => !!w.id && !w.startTime;
