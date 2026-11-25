/**
 * 计划编辑器没保存的草稿（审查 D5 / 上架审查 C28）：按返回键 / × 关掉、或者 App 被系统回收 / 划掉，再打开同一份接着填。
 * 存 localStorage 而不是 IndexedDB：编辑器的初始 state 要同步读；计划草稿丢最后几秒可以接受（训练编辑草稿不行，见 workbenchPersist 的 EDIT_DRAFT_ID）。
 * 不进撤销日志（JOURNALED_KEYS 没有它）；覆盖恢复 / 重置时跟着丢（WorkoutContext.discardWorkbenchWith）。
 */
import type { ScheduledExercise } from '../../types';
import { storage } from '../../services/appStorage';

export const PLAN_DRAFTS_KEY = 'fitlog_plan_drafts';

/** 目标重量是显示单位下的数，换了单位就不用 */
export interface PlanDraft {
  unit: 'kg' | 'lbs';
  title: string;
  date: string;
  exercises: ScheduledExercise[];
  notes: string;
}

const isPlanDraft = (d: unknown): d is PlanDraft => {
  if (!d || typeof d !== 'object') return false;
  const x = d as Record<string, unknown>;
  return (
    (x.unit === 'kg' || x.unit === 'lbs') &&
    typeof x.title === 'string' &&
    typeof x.date === 'string' &&
    typeof x.notes === 'string' &&
    Array.isArray(x.exercises) &&
    x.exercises.every(e => !!e && typeof e === 'object' && typeof (e as ScheduledExercise).id === 'string' && typeof (e as ScheduledExercise).name === 'string')
  );
};

/** 存着的草稿表（键＝哪份计划 + 它的版本）：坏 JSON、形状不对的条目跳过，不抛 */
export function parsePlanDrafts(raw: string | null): Record<string, PlanDraft> {
  let all: unknown;
  try {
    all = JSON.parse(raw ?? 'null');
  } catch {
    return {};
  }
  if (!all || typeof all !== 'object' || Array.isArray(all)) return {};
  return Object.fromEntries(Object.entries(all).filter(([, d]) => isPlanDraft(d))) as Record<string, PlanDraft>;
}

export const readPlanDraft = (key: string): PlanDraft | undefined => parsePlanDrafts(storage.getItem(PLAN_DRAFTS_KEY))[key];

/** 写入 / 删掉（null）一条，其余原样留着 */
export function writePlanDraft(key: string, draft: PlanDraft | null): void {
  const all = parsePlanDrafts(storage.getItem(PLAN_DRAFTS_KEY));
  if (draft) all[key] = draft;
  else if (!(key in all)) return;
  else delete all[key];
  if (Object.keys(all).length) storage.setItem(PLAN_DRAFTS_KEY, JSON.stringify(all));
  else storage.removeItem(PLAN_DRAFTS_KEY);
}
