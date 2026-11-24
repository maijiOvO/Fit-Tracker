/**
 * 「并入上一场」挑目标、拼结果（§12.8，上架审查 C04）。纯函数，hook 只管写库。
 */
import type { WorkoutSession } from '../../types';
import { hasDoneSets, insertDoneCards } from './workbench';

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
 * w 并进时间上紧邻的前一场。live：工作台上正在练的那场（库里那份可能比它旧），候选里用它替换库副本；
 * 它只有待做行也算「上一场」，否则今天的组会被并进几天前的场。其余场只认真正练过的（审查 A20）。
 * 前面没有可并的返回 null。
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
    .filter(x => x.id !== w.id && (x === live || hasDoneSets(x)) && Date.parse(x.date) < t)
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date))[0];
  if (!prev) return null;
  if (prev === live) {
    // 工作台那场还没结束：不拷 finishedAt / endTime，插在待做卡前面（指针以上都是做过的）
    return { into: live, live: true, merged: { ...live, exercises: insertDoneCards(live.exercises ?? [], w.exercises ?? []), updatedAt: now } };
  }
  const finishedAt = laterOf(prev.finishedAt, w.finishedAt);
  const endTime = laterOf(prev.endTime, w.endTime);
  return {
    into: prev,
    live: false,
    merged: {
      ...prev,
      exercises: [...(prev.exercises || []), ...(w.exercises || [])],
      ...(finishedAt ? { finishedAt } : {}),
      ...(endTime ? { endTime } : {}),
      updatedAt: now,
    },
  };
}
