/**
 * 自动备份：把完整快照写进用户选的文件夹（卸载 App 也不丢）。设计见 docs/design-backup.md §1。
 *
 * 三条底线：
 *   1. 内容只走 buildBackupFile() —— 和手动导出同一份完整快照，不在这里挑字段
 *      （以前手工列字段漏了 prs / scheduledWorkouts，恢复后训练计划没了）。
 *   2. 「备份成功」= 写完读回来、解析、逐项条数和 exportedAt 都对上。写出去不等于写成了。
 *   3. 永远新建文件、核对通过之后才清理旧的；本地没有训练时不自动备份也不清理 ——
 *      重装后还没恢复那段时间，空快照不能把好备份挤掉。
 *
 * 文件夹和状态存在本机 storage（按数据环境分区），**不进同步快照**：这是这台手机的设置。
 */
import { buildBackupFile, parseBackupFile, type FitlogBackupFile } from './fitlogBackup';
import {
  FolderError,
  deleteFile,
  folderSupported,
  hasAccess,
  listFiles,
  readText,
  writeText,
  type FolderFile,
  type FolderRef,
} from './fitlogFolder';
import { parseJsonOr, storage } from './appStorage';
import { getDataEnv } from './appEnv';
import { pad2 } from '../src/utils/format';

const FOLDER_KEY = 'fitlog_backup_folder';
const STATUS_KEY = 'fitlog_backup_status';
/** 恢复 / 导入之后 reload，新页面起来要补一份备份 —— 用这个标记跨过那次 reload */
const PENDING_KEY = 'fitlog_backup_pending';

export const BACKUP_STATUS_EVENT = 'fitlog:backup-status';

export type BackupErrorCode = FolderError['code'] | 'verify-failed' | 'no-folder';

export interface BackupStatus {
  /** 上一次**核对通过**的备份 */
  lastOkAt?: string;
  lastOkName?: string;
  lastOkWorkouts?: number;
  /** 上一次成功备份时的数据指纹：没变就不再写 */
  fingerprint?: string;
  /** 文件夹里的备份份数（清理之后） */
  fileCount?: number;
  /** 最近一次尝试失败（成功会清掉它） */
  lastError?: { at: string; code: BackupErrorCode; message: string };
  /** 这次备份比上次少了一半以上训练，没有清理旧备份 */
  shrinkWarning?: boolean;
}

// ============ 状态 ============

function readJson<T>(key: string): T | null {
  return parseJsonOr<T | null>(storage.getItem(key), null);
}

export function getBackupFolder(): FolderRef | null {
  return readJson<FolderRef>(FOLDER_KEY);
}

export function setBackupFolder(f: FolderRef): void {
  storage.setItem(FOLDER_KEY, JSON.stringify(f));
  emit();
}

export function getBackupStatus(): BackupStatus {
  return readJson<BackupStatus>(STATUS_KEY) ?? {};
}

function setBackupStatus(s: BackupStatus): void {
  storage.setItem(STATUS_KEY, JSON.stringify(s));
  emit();
}

function emit(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(BACKUP_STATUS_EVENT));
}

export function markBackupPending(): void {
  storage.setItem(PENDING_KEY, '1');
}

// ============ 命名 ============

/** fitlog-backup-2026-10-20-1832.json（本地时间）；dev 数据环境多一段 dev */
function autoBackupName(when = new Date(), env = getDataEnv()): string {
  const stamp = `${when.getFullYear()}-${pad2(when.getMonth() + 1)}-${pad2(when.getDate())}-${pad2(when.getHours())}${pad2(when.getMinutes())}`;
  return `fitlog-${env === 'dev' ? 'dev-' : ''}backup-${stamp}.json`;
}

const NAME_RE = /^fitlog-(dev-)?backup-(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})(?: \(\d+\))?\.json$/;

export interface NamedBackup {
  file: FolderFile;
  dev: boolean;
  /** 本地时间 */
  at: Date;
}

/** 认得出的自动备份文件（用户自己放进来的文件一概不算） */
export function parseAutoBackupName(file: FolderFile): NamedBackup | null {
  const m = NAME_RE.exec(file.name);
  if (!m) return null;
  const at = new Date(+m[2], +m[3] - 1, +m[4], +m[5], +m[6]);
  return { file, dev: !!m[1], at };
}

// ============ 保留规则 ============

const dayKey = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const monthIndex = (d: Date) => d.getFullYear() * 12 + d.getMonth();

/**
 * 该删哪些（只看当前数据环境、命名规则内的文件）：
 *   - 同一天只留最新一份；
 *   - 最近 14 天每天一份；
 *   - 再往前每月留当月最早那份，留 12 个月。
 * 纯函数，e2e 里直接测。
 */
export function selectBackupsToDelete(files: FolderFile[], now = new Date(), env = getDataEnv()): FolderFile[] {
  const mine = files
    .map(parseAutoBackupName)
    .filter((b): b is NamedBackup => !!b && b.dev === (env === 'dev'))
    .sort((a, b) => b.at.getTime() - a.at.getTime() || b.file.name.localeCompare(a.file.name));

  const keep = new Set<string>();
  // 每天最新一份
  const newestOfDay = new Map<string, NamedBackup>();
  for (const b of mine) if (!newestOfDay.has(dayKey(b.at))) newestOfDay.set(dayKey(b.at), b);

  const today0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const cutoff14 = new Date(today0.getTime() - 13 * 86400000);
  const oldestMonth = monthIndex(now) - 11;
  const earliestOfMonth = new Map<number, NamedBackup>();

  for (const b of newestOfDay.values()) {
    if (b.at >= cutoff14) {
      keep.add(b.file.uri);
      continue;
    }
    const mi = monthIndex(b.at);
    if (mi < oldestMonth) continue;
    const cur = earliestOfMonth.get(mi);
    if (!cur || b.at < cur.at) earliestOfMonth.set(mi, b);
  }
  for (const b of earliestOfMonth.values()) keep.add(b.file.uri);

  return mine.filter(b => !keep.has(b.file.uri)).map(b => b.file);
}

// ============ 指纹 ============

function maxStamp(rows: Array<Record<string, unknown>> | undefined): string {
  let m = '';
  for (const r of rows ?? []) {
    const s = String(r.updatedAt ?? r.date ?? '');
    if (s > m) m = s;
  }
  return m;
}

/** 各表条数 + 最新修改时间 + prefs 时间戳。够判断「这一天有没有动过数据」，不追求精确 */
function snapshotFingerprint(file: FitlogBackupFile): string {
  const s = file.snapshot;
  const p = s.prefs as unknown as Record<string, unknown>;
  return JSON.stringify([
    s.workouts.length,
    maxStamp(s.workouts as unknown as Array<Record<string, unknown>>),
    s.goals?.length,
    maxStamp(s.goals as unknown as Array<Record<string, unknown>>),
    s.weightLogs?.length,
    maxStamp(s.weightLogs as unknown as Array<Record<string, unknown>>),
    s.customMetrics?.length,
    s.prs?.length,
    s.scheduledWorkouts?.length,
    maxStamp(s.scheduledWorkouts as unknown as Array<Record<string, unknown>>),
    s.customExerciseDefsFromDb?.length,
    p?.prefsLastUpdateMs,
    p?.appPrefsUpdatedMs,
    JSON.stringify(s.tombstones ?? {}).length,
  ]);
}

// ============ 核对 ============

function countsOf(file: FitlogBackupFile) {
  const s = file.snapshot;
  return {
    workouts: s.workouts.length,
    goals: s.goals?.length ?? 0,
    weightLogs: s.weightLogs?.length ?? 0,
    customMetrics: s.customMetrics?.length ?? 0,
    prs: s.prs?.length ?? 0,
    scheduledWorkouts: s.scheduledWorkouts?.length ?? 0,
    customExerciseDefs: s.customExerciseDefsFromDb?.length ?? 0,
    customExercises: s.prefs?.customExercises?.length ?? 0,
  };
}

/**
 * 读回来的内容和刚才要写的是不是同一份。返回 null = 对上了；否则返回哪里不对。
 * 用 parseBackupFile 解析 —— 恢复时走的也是它，它能解析才说明这份文件真的能恢复。
 */
export function verifyReadBack(expected: FitlogBackupFile, text: string): string | null {
  let parsedJson: FitlogBackupFile;
  try {
    parsedJson = JSON.parse(text);
    parseBackupFile(text);
  } catch {
    return 'not-parseable';
  }
  if (parsedJson.exportedAt !== expected.exportedAt) return 'exportedAt';
  const a = countsOf(expected);
  const b = countsOf(parsedJson);
  for (const k of Object.keys(a) as Array<keyof typeof a>) {
    if (a[k] !== b[k]) return `${k}: ${a[k]} ≠ ${b[k]}`;
  }
  return null;
}

// ============ 备份 ============

export type BackupReason = 'workout-finished' | 'daily' | 'manual' | 'after-restore' | 'first-setup';

export type BackupOutcome =
  | { kind: 'ok'; name: string; workouts: number; pruned: number; shrinkWarning: boolean }
  | { kind: 'skipped'; why: 'unsupported' | 'no-folder' | 'empty' | 'unchanged' | 'busy' }
  | { kind: 'failed'; code: BackupErrorCode; message: string };

let running: Promise<BackupOutcome> | null = null;

export function backupNow(reason: BackupReason): Promise<BackupOutcome> {
  // 并发的两次（比如结束训练和回到前台同时触发）合成一次，不写两份
  if (running) return running.then(() => ({ kind: 'skipped', why: 'busy' }) as BackupOutcome);
  running = doBackup(reason).finally(() => {
    running = null;
  });
  return running;
}

async function doBackup(reason: BackupReason): Promise<BackupOutcome> {
  if (!folderSupported()) return { kind: 'skipped', why: 'unsupported' };
  const folder = getBackupFolder();
  if (!folder) return { kind: 'skipped', why: 'no-folder' };

  const status = getBackupStatus();
  const fail = (code: BackupErrorCode, message: string): BackupOutcome => {
    setBackupStatus({ ...status, lastError: { at: new Date().toISOString(), code, message } });
    return { kind: 'failed', code, message };
  };

  const file = await buildBackupFile();
  const workouts = file.snapshot.workouts.length;
  const manual = reason === 'manual' || reason === 'first-setup' || reason === 'after-restore';
  if (!manual && workouts === 0) return { kind: 'skipped', why: 'empty' };
  const fp = snapshotFingerprint(file);
  if (!manual && fp === status.fingerprint && !status.lastError) return { kind: 'skipped', why: 'unchanged' };

  if (!(await hasAccess(folder))) return fail('no-access', 'no persisted permission');

  const name = autoBackupName(new Date(file.exportedAt));
  let written: { uri: string; name: string | null };
  try {
    written = await writeText(folder, name, JSON.stringify(file));
  } catch (e) {
    const err = e as FolderError;
    return fail(err.code ?? 'write-failed', err.message);
  }

  // 读回核对：不过就删掉这份坏文件（删不掉也无妨，它不符合也不会被当成好备份 —— 恢复前会再解析）
  let back: string;
  try {
    back = await readText(written.uri);
  } catch (e) {
    return fail('verify-failed', `read back: ${(e as Error).message}`);
  }
  const mismatch = verifyReadBack(file, back);
  if (mismatch) {
    await deleteFile(written.uri).catch(() => false);
    return fail('verify-failed', mismatch);
  }

  // 通过之后才清理。训练次数骤减（误删 / 数据出事）或者本地是空的时，一份都不删
  const prev = status.lastOkWorkouts ?? 0;
  const shrinkWarning = prev > 0 && workouts < prev * 0.5;
  let pruned = 0;
  let fileCount: number | undefined;
  try {
    const files = await listFiles(folder);
    if (!shrinkWarning && workouts > 0) {
      const doomed = selectBackupsToDelete(files).filter(f => f.uri !== written.uri);
      for (const f of doomed) {
        if (await deleteFile(f.uri).catch(() => false)) pruned++;
      }
    }
    fileCount = files.filter(f => parseAutoBackupName(f)).length - pruned;
  } catch {
    // 清理失败不影响「这份备份写成了」
  }

  setBackupStatus({
    lastOkAt: new Date().toISOString(),
    lastOkName: written.name ?? name,
    lastOkWorkouts: workouts,
    fingerprint: fp,
    fileCount,
    shrinkWarning,
  });
  return { kind: 'ok', name: written.name ?? name, workouts, pruned, shrinkWarning };
}

// ============ 时机 ============

let debounce: ReturnType<typeof setTimeout> | null = null;

/** 结束训练后调：防抖 5 秒，连续操作只写一份 */
export function scheduleAutoBackup(reason: BackupReason = 'workout-finished'): void {
  if (!folderSupported() || !getBackupFolder()) return;
  if (debounce) clearTimeout(debounce);
  debounce = setTimeout(() => {
    debounce = null;
    void backupNow(reason);
  }, 5000);
}

const DAY_MS = 24 * 3600 * 1000;

/** 启动 / 回到前台时调：距上次成功超过 24 小时才写（数据没变也不写，见 doBackup 的指纹） */
export function maybeDailyBackup(): void {
  if (!folderSupported() || !getBackupFolder()) return;
  if (storage.getItem(PENDING_KEY) === '1') {
    storage.removeItem(PENDING_KEY);
    void backupNow('after-restore');
    return;
  }
  const last = getBackupStatus().lastOkAt;
  if (last && Date.now() - new Date(last).getTime() < DAY_MS) return;
  void backupNow('daily');
}
