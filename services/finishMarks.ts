/**
 * 这台设备上最近点「结束」的几场，时间线据此给「继续这场」（utils/sessionDate.canResumeFinished）。
 * 存 localStorage（经 storage 门面），不进同步快照、不进撤销日志：只回答「是不是刚在这里点了结束」。
 * 记几场而不是一场：结束 A、又开 B 结束再删掉，A 照样能接回。写的时候丢掉出了窗口的。
 * 刚结束就被划掉时可能没落盘，代价只是这场的菜单里少一项「继续这场」。
 */
import { RESUME_WINDOW_MS, type FinishMark } from '../src/utils/sessionDate';
import { parseJsonOr, storage } from './appStorage';

const KEY = 'fitlog_finish_marks';

export function readFinishMarks(): FinishMark[] {
  const v = parseJsonOr<unknown>(storage.getItem(KEY), null);
  return Array.isArray(v) ? v.filter((m): m is FinishMark => typeof m?.id === 'string' && typeof m?.finishedAt === 'string') : [];
}

export function markFinished(id: string, finishedAt: string): void {
  const at = Date.parse(finishedAt);
  const keep = readFinishMarks().filter(m => m.id !== id && Math.abs(at - Date.parse(m.finishedAt)) < RESUME_WINDOW_MS);
  storage.setItem(KEY, JSON.stringify([...keep, { id, finishedAt }]));
}
