import type { WorkoutSession } from '../../types';
import { localYmd } from './dateUtils';
import { MAX_MIN } from './sessionDuration';
import { retitleForDate } from './workbench';
import { setActedOn } from './setValues';

/** 这一场之前练的（按 date，不含它自己）：判纪录、排期号、找「比上次」都只能看这场那天之前的 */
export function sessionsBefore(workouts: WorkoutSession[], session: Pick<WorkoutSession, 'id' | 'date'>): WorkoutSession[] {
  const at = Date.parse(session.date);
  return workouts.filter(w => w.id !== session.id && Date.parse(w.date) < at);
}

const shiftIso = (iso: string, delta: number): string => new Date(Date.parse(iso) + delta).toISOString();

const shiftExerciseTimes = (w: WorkoutSession, delta: number): WorkoutSession['exercises'] =>
  w.exercises.map(e => (e.exerciseTime ? { ...e, exerciseTime: shiftIso(e.exerciseTime, delta) } : e));

/**
 * 训练中把这场挪到另一个时刻（补录）：动作时间跟着平移，startTime 去掉 ——
 * 结束时 finishedAt 写的是现在，和开练时刻相减只是录入花的时间，不是练了多久；
 * 没有 startTime，sessionDurationMin 就不显示时长。
 */
export function redateLiveSession(w: WorkoutSession, date: Date): WorkoutSession {
  const delta = date.getTime() - Date.parse(w.date);
  const { startTime: _start, ...rest } = w;
  return { ...rest, date: date.toISOString(), exercises: shiftExerciseTimes(w, delta) };
}

/**
 * 编辑一场练完的训练时改日期：date / startTime / finishedAt / endTime / 动作时间整场平移同一段，时长不变（审查 C23）。
 * 以前只改 date，startTime 还停在原处，CSV 和时长读的是另一个时刻。
 * - 平移量按整分钟对齐（picked − date 取整到分）：选择器给的是整分，直接 picked − date 会把差几毫秒的 startTime 显示成早一分钟；
 * - 平移后整场最晚的时刻不能晚于 now（审查 C25）：不然 finishedAt 落在未来，时间线会对旧训练给出「继续这场」；
 *   只看离 date 12 小时以内的时刻。补录的场 finishedAt 是录入那一刻、旧版改过日期的场 startTime / finishedAt 还在实际练的那天，
 *   拿它们算会把平移量扣光，选的日期不生效；这类时刻平移后落在未来就留在原处（本来就和 date 对不上）；
 * - 兜底标题跟着换成新日期（审查 C95）。
 */
export function redateEdited(w: WorkoutSession, picked: Date, now: Date): WorkoutSession {
  const at = Date.parse(w.date);
  const nearDate = (t: number) => Math.abs(t - at) <= MAX_MIN * 60_000;
  let delta = picked.getTime() - Math.floor(at / 60_000) * 60_000;
  const times = [w.date, w.startTime, w.finishedAt, w.endTime, ...w.exercises.map(e => e.exerciseTime)]
    .filter((s): s is string => !!s)
    .map(Date.parse)
    .filter(n => !Number.isNaN(n) && nearDate(n));
  const over = Math.max(...times) + delta - now.getTime();
  if (over > 0) delta -= over;
  const shift = (iso: string): string => {
    const t = Date.parse(iso);
    return nearDate(t) || t + delta <= now.getTime() ? shiftIso(iso, delta) : iso;
  };
  const date = shiftIso(w.date, delta);
  return {
    ...w,
    date,
    ...(w.startTime ? { startTime: shift(w.startTime) } : {}),
    ...(w.finishedAt ? { finishedAt: shift(w.finishedAt) } : {}),
    ...(w.endTime ? { endTime: shift(w.endTime) } : {}),
    title: retitleForDate(w.title, new Date(date)),
    exercises: w.exercises.map(e => (e.exerciseTime ? { ...e, exerciseTime: shift(e.exerciseTime) } : e)),
  };
}

/**
 * 训练中的场没有 startTime ＝ 改过日期（补录）：开练时 createNewWorkout 一定写它，选馆后隔久了才动手时 restampStaleStart 把它重打成动手那一刻（仍然在），
 * 只有 redateLiveSession 会去掉（没分到 id 的空工作台除外）
 */
export const isBackdated = (w: Pick<WorkoutSession, 'id' | 'startTime'>): boolean => !!w.id && !w.startTime;

/**
 * 选馆后隔多久才第一次动手，就把开练时刻改记成动手那一刻（上架审查 C87）。
 * 开练时刻在选馆那一下就打了：选了馆隔几小时、甚至隔夜才真正开练，时长会记成几百分钟，日期落在前一天。
 * 60 分钟：选完馆换衣服、热身、等器械都在这之内；再久就不是「这一场的开头」了。
 */
export const STALE_START_MS = 60 * 60_000;

const hasActed = (w: WorkoutSession): boolean => w.exercises.some(e => e.sets.some(setActedOn));
const startKey = (w: WorkoutSession): string => `${w.id}@${w.startTime}`;

/**
 * 开练时刻已经定下的那一场（id + startTime）：工作台上一出现「做完或改过」的组就记下，之后组又全退回底稿也不忘
 * （书签拖过头把行全退回、删掉唯一做过组的卡，再做第一组不算第一次动手，D6 审查）。
 * 带上 startTime：撤销第一次动手会把重打前的开练时刻换回来，对不上了，再做才照样重打。
 * WorkoutContext 只记在内存里：全退回底稿后 App 被杀、重开再做，仍会按第一次动手处理。
 */
export const settleStart = (w: WorkoutSession, settled: string | null): string | null => (hasActed(w) ? startKey(w) : settled);

/**
 * 工作台第一次有组「做完或改过」（setValues.setActedOn，点组号描实也算）时，距开练已过 STALE_START_MS，
 * 就把 date / startTime 改成 now，早于它的动作时间挪到它（卡都是选馆之后加的，整段平移会跑到未来；那时一组还没做，都算从现在开始）。
 * 其余情况原样返回同一个对象：换了一场、补录的（没有 startTime）、之前已经动过手的（现在动过，或 settled 记着动过）、开练不到阈值的。
 * 只给训练中的改动用（WorkoutContext 包在对外的 setCurrentWorkout 外面）；编辑草稿、撤销、接回这类整份替换不走这里。
 */
export function restampStaleStart(prev: WorkoutSession, next: WorkoutSession, nowMs: number, settled: string | null): WorkoutSession {
  if (!next.id || prev.id !== next.id || !next.startTime || settled === startKey(next)) return next;
  if (nowMs - Date.parse(next.startTime) < STALE_START_MS || hasActed(prev) || !hasActed(next)) return next;
  const now = new Date(nowMs).toISOString();
  return {
    ...next,
    date: now,
    startTime: now,
    exercises: next.exercises.map(e => (e.exerciseTime ? { ...e, exerciseTime: Date.parse(e.exerciseTime) < nowMs ? now : e.exerciseTime } : e)),
  };
}

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
