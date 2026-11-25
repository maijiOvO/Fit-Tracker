/**
 * 「并入上一场」挑目标、拼结果（§12.8，上架审查 C04）。纯函数，hook 只管写库。
 */
import type { WorkoutSession } from '../../types';
import { hasDoneSets, insertDoneCards } from './workbench';
import { MAX_MIN } from './sessionDuration';

export interface MergePlan {
  /** 并进的那一场（拼好之前的样子，toast 报它的名字、计划改指它） */
  into: WorkoutSession;
  merged: WorkoutSession;
  /** 目标就是工作台上正在练的那场：合并结果要放回工作台，由自动落盘写库（只改库会被工作台下一次落盘整行盖回） */
  live: boolean;
}

/** 两场的收尾时间取更晚的那个：合并后的一场是到那一刻才结束的 */
const laterOf = (a?: string, b?: string) => {
  if (!a) return b;
  if (!b) return a;
  return Date.parse(a) >= Date.parse(b) ? a : b;
};

/**
 * 能不能并：误结束拆开的两场隔不了一场训练的长度（和 sessionDuration 的上限同一口径），也不会跨馆。
 * 按 date 比不按 finishedAt：补录的场 finishedAt 是补录那一刻，按它比会把隔天的两场放行（上架审查 C92）。
 */
const canMergeInto = (prev: WorkoutSession, w: WorkoutSession) =>
  Math.abs(Date.parse(w.date) - Date.parse(prev.date)) <= MAX_MIN * 60_000 && !(prev.gym && w.gym && prev.gym !== w.gym);

/**
 * 被并那场自己的整场字段：备注接在后面，计划标记和馆前一场没有就带过来（unlinkPlanOf 已把计划改指前一场）。
 * 标题、日期、开练时刻取前一场是本意：合并后的一场就是前一场开始的那场（上架审查 C92）。
 */
function carriedFields(prev: WorkoutSession, w: WorkoutSession): Partial<WorkoutSession> {
  const a = prev.notes?.trim() ? prev.notes : '';
  const b = w.notes?.trim() ? w.notes : '';
  return {
    ...(b ? { notes: a ? `${a}\n${b}` : b } : {}),
    ...(!prev.fromSchedule && w.fromSchedule ? { fromSchedule: w.fromSchedule } : {}),
    ...(!prev.gym && w.gym ? { gym: w.gym } : {}),
  };
}

/** 前一场的挑法：工作台那场（只有待做行也算）或真正练过的场里，date 早于 w 且最晚的那场 */
const eligible = (x: WorkoutSession, live: WorkoutSession | null) => x === live || hasDoneSets(x);

/**
 * w 并进时间上紧邻的前一场。live：工作台上正在练的那场（库里那份可能比它旧），候选里用它替换库副本；
 * 它只有待做行也算「上一场」，否则今天的组会被并进几天前的场。其余场只认真正练过的（审查 A20）。
 * 前面没有可并的、或隔得太久 / 跨馆（canMergeInto）返回 null。
 */
export function planMergeIntoPrevious(
  workouts: WorkoutSession[],
  w: WorkoutSession,
  live: WorkoutSession | null,
  now = new Date().toISOString(),
): MergePlan | null {
  const pool = workouts.map(x => (live && x.id === live.id ? live : x));
  if (live && !pool.includes(live)) pool.push(live);
  const t = Date.parse(w.date);
  const prev = pool
    .filter(x => x.id !== w.id && eligible(x, live) && Date.parse(x.date) < t)
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date))[0];
  if (!prev || !canMergeInto(prev, w)) return null;
  if (prev === live) {
    // 工作台那场还没结束：不拷 finishedAt / endTime，插在待做卡前面（指针以上都是做过的）
    return { into: live, live: true, merged: { ...live, ...carriedFields(live, w), exercises: insertDoneCards(live.exercises ?? [], w.exercises ?? []), updatedAt: now } };
  }
  const finishedAt = laterOf(prev.finishedAt, w.finishedAt);
  const endTime = laterOf(prev.endTime, w.endTime);
  return {
    into: prev,
    live: false,
    merged: {
      ...prev,
      ...carriedFields(prev, w),
      exercises: [...(prev.exercises || []), ...(w.exercises || [])],
      ...(finishedAt ? { finishedAt } : {}),
      ...(endTime ? { endTime } : {}),
      updatedAt: now,
    },
  };
}

/**
 * 时间线上哪些场给「并入上一场」：和 planMergeIntoPrevious 同一个挑法（不含工作台那份，时间线拿不到），
 * 挑到的前一场 canMergeInto 才给。排一次序走一遍，上千场也不逐场重排。
 */
export function mergeableIds(workouts: WorkoutSession[]): Set<string> {
  const asc = workouts.filter(w => w.date).sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  const out = new Set<string>();
  let prev: WorkoutSession | undefined; // date 严格早于当前这组的最晚一场可并目标
  for (let i = 0; i < asc.length; ) {
    const t = Date.parse(asc[i].date);
    let j = i;
    for (; j < asc.length && Date.parse(asc[j].date) === t; j++) if (prev && canMergeInto(prev, asc[j])) out.add(asc[j].id);
    for (let k = j - 1; k >= i; k--) if (eligible(asc[k], null)) { prev = asc[k]; break; }
    i = j;
  }
  return out;
}
