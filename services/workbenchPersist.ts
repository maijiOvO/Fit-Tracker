import type { WorkoutSession } from '../types';
import { editKey } from '../src/utils/workbench';

/** 「进行中」能接回来的时限：超过这么久没动过的未结束训练不再接回，按入册口径收尾（见 staleRows） */
const IN_PROGRESS_MAX_AGE_MS = 12 * 60 * 60 * 1000;

/**
 * 自动收尾只碰这之后改过的行：2026-11-14（b94fdc8）起入册看「有没有数」，之前的未结束场里混着没动过的底稿，
 * 按今天的口径收尾会造出假组（作者自用库里有 21 场这样的旧行）。单机版没有这么早的数据。
 */
const SETTLE_SINCE_MS = Date.parse('2026-11-14T00:00:00');

/** 一场最后一次改内容的时刻（毫秒）：updatedAt，旧行退回开练时刻 / 日期 */
export const lastChangeMs = (w: WorkoutSession): number => new Date(w.updatedAt || w.startTime || w.date).getTime() || 0;

/** 闲置满 12 小时：不再当作正在练 */
export const isStale = (lastChange: number, now = Date.now()): boolean => now - lastChange >= IN_PROGRESS_MAX_AGE_MS;

const isOpen = (w: WorkoutSession) => !w.finishedAt && w.status !== 'completed' && (w.exercises?.length ?? 0) > 0;

/**
 * 库里最近一场「进行中」的训练：没结束、有动作、12 小时内动过。
 * 练到一半按返回 / App 被系统回收 / 刷新之后，靠它把这场接回工作台（workbench-not-restored）。
 *
 * 只认工作台上落过盘的那一场（activeId；「继续这场」接回来的旧训练也走这条）。只看 updatedAt 不够：
 * 被计划 / 复制顶下工作台的那场、编辑过的旧行，updatedAt 一新就会被当成进行中接回来（2026-10-21 审查、上架审查 C02）。
 * 还没记过 activeId（旧版本升级上来）时才退一步，认开练时间在 12 小时内的。
 */
export function findInProgress(list: WorkoutSession[], activeId: string | null): WorkoutSession | null {
  const now = Date.now();
  const started = (w: WorkoutSession) => new Date(w.startTime || w.createdAt || w.date).getTime() || 0;
  return (
    list
      .filter(w => isOpen(w) && !isStale(lastChangeMs(w), now))
      .filter(w => (activeId ? w.id === activeId : !isStale(started(w), now)))
      .sort((a, b) => lastChangeMs(b) - lastChangeMs(a))[0] ?? null
  );
}

/**
 * 该自动收尾的行（上架审查 C01 / C02）：没结束、有动作、不是工作台上那一场、闲置满 12 小时。
 * 未结束的场只该有一场，就是工作台那场；别的过期了没人会再接回，留着就是读历史的各处都看不见的组。
 */
export function staleRows(list: WorkoutSession[], workbenchId: string, now = Date.now()): WorkoutSession[] {
  return list.filter(w => isOpen(w) && w.id !== workbenchId && isStale(lastChangeMs(w), now) && lastChangeMs(w) >= SETTLE_SINCE_MS);
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
    /**
     * 这一场最后一次改内容的时刻（毫秒）：内存里的 currentWorkout.updatedAt 不随落盘刷新，过期要按这里判。
     * 这个保存器没见过它（还没落过盘）就是 null。
     */
    lastChange(id: string): number | null {
      return last && last.src.id === id ? Date.parse(last.updatedAt) || null : null;
    },
  };
}

/**
 * 编辑旧训练的草稿槽：backups 表里的一行（撤销日志、备份、同步都不带这张表）。改了没保存时工作台每变一下就写一次，
 * 进程被杀 / 被划掉后重开能回到编辑页（2026-11-24 作者定，推翻 10-07 的「被杀就丢」）。
 * 不放 localStorage：它延迟批量写盘，刚改完就划掉 App 最后几秒会丢；IndexedDB 事务 complete 就已交给系统。
 */
export const EDIT_DRAFT_ID = 'edit-draft';

export interface EditDraftRow {
  id: typeof EDIT_DRAFT_ID;
  /** 进编辑时原记录的 editKey */
  base: string;
  draft: WorkoutSession;
}

/**
 * 启动时读到的草稿槽能不能接回：形状不对、原记录没了、原记录后来被改过（启动迁移之类，宁可丢草稿也不让旧数据复活）、
 * 草稿和原记录一样，都返回 null。数据从库里进来，防御只写在这一层。
 */
export function resumableEditDraft(row: unknown, original: WorkoutSession | undefined): { base: string; draft: WorkoutSession } | null {
  if (!row || typeof row !== 'object' || !original) return null;
  const { base, draft } = row as Partial<EditDraftRow>;
  if (typeof base !== 'string' || !draft || typeof draft !== 'object' || typeof draft.id !== 'string' || !Array.isArray(draft.exercises)) return null;
  if (draft.id !== original.id || editKey(original) !== base || editKey(draft) === base) return null;
  return { base, draft };
}
