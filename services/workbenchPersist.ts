import type { WorkoutSession } from '../types';

/** 「进行中」能接回来的时限：超过这么久没动过的未结束训练不再自动接回（早期没有 finishedAt 字段的旧记录也靠它挡掉） */
const IN_PROGRESS_MAX_AGE_MS = 12 * 60 * 60 * 1000;

/**
 * 库里最近一场「进行中」的训练：没结束、有动作、12 小时内动过。
 * 练到一半按返回 / App 被系统回收 / 刷新之后，靠它把这场接回工作台（workbench-not-restored）。
 *
 * 只看 updatedAt 不够：早期没有 finishedAt 的旧记录，编辑 / 馆改名一下 updatedAt 就新了，会被当成进行中接回来
 * （2026-10-21 审查）。所以还得是工作台上落过盘的那一场（activeId；「继续这场」接回来的旧训练也走这条），
 * 或者开练时间本身就在 12 小时内（旧版本升级上来、还没记过 activeId 的那一场）。
 */
export function findInProgress(list: WorkoutSession[], activeId: string | null): WorkoutSession | null {
  const now = Date.now();
  const ts = (w: WorkoutSession) => new Date(w.updatedAt || w.startTime || w.date).getTime() || 0;
  const started = (w: WorkoutSession) => new Date(w.startTime || w.createdAt || w.date).getTime() || 0;
  return (
    list
      .filter(w => !w.finishedAt && w.status !== 'completed' && (w.exercises?.length ?? 0) > 0 && now - ts(w) < IN_PROGRESS_MAX_AGE_MS)
      .filter(w => w.id === activeId || now - started(w) < IN_PROGRESS_MAX_AGE_MS)
      .sort((a, b) => ts(b) - ts(a))[0] ?? null
  );
}

/**
 * 工作台的自动落盘：同一个对象（内容没变过）写成功一次就不再写，也不刷新 updatedAt。
 * updatedAt 是「最后一次改内容」的时刻 —— 上面的过期判定和同步合并都按它取新。
 * 原先切后台、列表刷新（App 的落盘 effect 跟着 context 重跑）都写一次「现在」，
 * 忘了结束的那场只要 12 小时内打开过 App 就永远算进行中（审查 Fm0）。
 * 写失败的那一份下次照原 updatedAt 重写（切后台 / 下一次 effect 都会再来）。
 */
export function createWorkbenchSaver(write: (w: WorkoutSession) => Promise<void>) {
  let last: { src: WorkoutSession; updatedAt: string; state: 'pending' | 'ok' | 'failed' } | null = null;
  return {
    /** 从库里接回来的那份：库里已经是这个样子 */
    adopt(w: WorkoutSession) {
      last = { src: w, updatedAt: w.updatedAt ?? new Date().toISOString(), state: 'ok' };
    },
    save(w: WorkoutSession) {
      if (last?.src === w && last.state !== 'failed') return;
      const entry = last?.src === w ? last : { src: w, updatedAt: new Date().toISOString(), state: 'pending' as const };
      entry.state = 'pending';
      last = entry;
      write({ ...w, updatedAt: entry.updatedAt }).then(
        () => {
          entry.state = 'ok';
        },
        () => {
          entry.state = 'failed';
        },
      );
    },
  };
}
