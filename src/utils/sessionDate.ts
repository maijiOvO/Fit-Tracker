import type { WorkoutSession } from '../../types';
import { localYmd } from './dateUtils';

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

/**
 * 结束训练后多久之内，再开新训练要先问一句「是不是刚才那场」。
 *
 * 起因是真事：8/26 有一场训练在误点结束 15 秒后重开，被拆成了两场，
 * 最后靠手工改库合回去。10 分钟是「组间休息 + 走到下一台器械」的上限，
 * 超过这个时间再开练，当作新的一场是合理默认。
 *
 * ⚠️ 这一条不违反 §12.5 通则 3（破坏性操作用先执行 + 撤销）——
 * 通则管的是【已经产生的东西被毁掉】，这里管的是【错误的数据被产生出来】：
 * 拆场之后两场各自都是「正常记录」，事后没有任何信号能自动认出它们本是一场。
 * 挡在产生之前，比事后给撤销便宜得多。
 */
export const RESUME_WINDOW_MS = 10 * 60 * 1000;

/**
 * 切到后台再回来，撤销历史还算不算数（useUndoGestures）：离开超过 RESUME_WINDOW_MS 或跨了本地日期就作废 ——
 * 不然几小时后、隔天还能撤回「结束训练」，把那场拉回进行中（上架审查 C97）。和「继续这场」用同一个窗口。
 */
export const undoLogExpired = (hiddenAt: number, now: number): boolean =>
  now - hiddenAt > RESUME_WINDOW_MS || localYmd(new Date(hiddenAt)) !== localYmd(new Date(now));
