/**
 * 本地备份：导出 / 导入 / 回滚。
 *
 * 为什么不自己攒一份数据结构，而是复用同步层的 FitlogRemoteSnapshot：
 *
 *   1. **完整性可证**。快照是服务端往返用的那一份，字段齐全且一直在被使用；
 *      自己攒的容易漏。改版前的导出就漏了 prs 与 scheduledWorkouts —— 用户
 *      导出成功、文件也有几百 KB，看起来完全正常，直到换手机后发现训练计划没了。
 *   2. **写回逻辑现成且是覆盖语义**。applySnapshotToLocalIndexedDb() 内部就是
 *      db.clear() + 逐条写，正是「恢复备份」该有的行为，不必另写一套。
 *
 * 对单机发行版（solo）来说这是**唯一**的数据出路：没有服务端兜底，
 * 卸载即失。所以这里的每一条都不能是「看起来成功」。
 */
import type {
  ExerciseDefinition,
  Goal,
  Measurement,
  PRRecord,
  ScheduledWorkout,
  WeightEntry,
  WorkoutSession,
} from '../types';
import type { FitlogRemoteSnapshot, FitlogSyncedPrefs } from './fitlogSnapshotTypes';
import {
  applySnapshotToLocalIndexedDb,
  collectLocalSnapshot,
  readPrefsFromLocalStorage,
  writePrefsToLocalStorage,
} from './fitlogRemote';
import { db } from './db';

/** 备份文件的格式版本。与 snapshot.schemaVersion 是两件事，别混。 */
export const BACKUP_FORMAT_VERSION = 2;

/**
 * 导入前的回滚副本存在 IndexedDB，**不是**存在下载下来的文件里。
 *
 * 理由：`<a download>` 在 Android WebView 里能不能真的落盘尚未验证过。
 * 拿一条没验过的路径当回滚保障，等于没有保障 —— 而且失败是静默的。
 * IndexedDB 是这个 app 本来就在可靠使用的存储。
 */
const ROLLBACK_STORE = 'backups';
const ROLLBACK_ID = 'pre-import';

export interface FitlogBackupFile {
  app: 'Fit Tracker';
  formatVersion: number;
  exportedAt: string;
  snapshot: FitlogRemoteSnapshot;
}

/** 解析结果。legacy 为真时文件来自旧版导出，缺字段，调用方必须告诉用户。 */
export interface ParsedBackup {
  snapshot: FitlogRemoteSnapshot;
  legacy: boolean;
  /** 旧格式里完全没有、因而沿用当前值的字段，用于给用户看 */
  missingFields: string[];
  counts: { workouts: number; weightLogs: number; goals: number; scheduledWorkouts: number };
}

export class BackupParseError extends Error {}

// ============ 导出 ============

export async function buildBackupFile(): Promise<FitlogBackupFile> {
  return {
    app: 'Fit Tracker',
    formatVersion: BACKUP_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    snapshot: await collectLocalSnapshot(),
  };
}

export function backupFileName(when = new Date()): string {
  return `FitTracker_Backup_${when.toISOString().split('T')[0]}.json`;
}

// ============ 解析 ============

function asArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

/**
 * 解析备份文件，兼容两种格式：
 *   - v2（本版）：{ app, formatVersion, exportedAt, snapshot }
 *   - legacy（改版前）：{ app, exportDate, data: {...}, settings: {...} }
 *
 * 旧格式没有 prs / scheduledWorkouts / 部分 prefs。**不能拿空数组去覆盖它们** ——
 * 那是拿「文件里没写」当成「用户想删掉」，会把 PR 和训练计划一起抹掉。
 * 这些字段沿用当前值，并通过 missingFields 交给 UI 明说。
 */
export function parseBackupFile(raw: string): ParsedBackup {
  let json: any;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new BackupParseError('not-json');
  }
  if (!json || typeof json !== 'object') throw new BackupParseError('not-json');

  // --- v2 ---
  if (json.snapshot && typeof json.snapshot === 'object') {
    const s = json.snapshot as FitlogRemoteSnapshot;
    if (!Array.isArray(s.workouts)) throw new BackupParseError('not-a-backup');
    return {
      snapshot: s,
      legacy: false,
      missingFields: [],
      counts: {
        workouts: s.workouts.length,
        weightLogs: asArray(s.weightLogs).length,
        goals: asArray(s.goals).length,
        scheduledWorkouts: asArray(s.scheduledWorkouts).length,
      },
    };
  }

  // --- legacy ---
  const d = json.data;
  if (!d || typeof d !== 'object' || !Array.isArray(d.workouts)) {
    throw new BackupParseError('not-a-backup');
  }
  const st = json.settings ?? {};
  const current = readPrefsFromLocalStorage();
  const now = Date.now();

  const prefs: FitlogSyncedPrefs = {
    ...current,
    customTags: asArray(st.customTags) as FitlogSyncedPrefs['customTags'],
    customExercises: asArray<ExerciseDefinition>(st.customExercises),
    exerciseNotes: st.exerciseNotes ?? current.exerciseNotes,
    starredExercises: st.starredExercises ?? current.starredExercises,
    exerciseMetricConfigs: st.metricConfigs ?? current.exerciseMetricConfigs,
    lang: st.language ?? current.lang,
    unit: st.unit ?? current.unit,
    starredLastUpdateMs: now,
    metricsLastUpdateMs: now,
    prefsLastUpdateMs: now,
  };

  return {
    snapshot: {
      schemaVersion: 2,
      clientExportedAt: json.exportDate ?? new Date().toISOString(),
      workouts: asArray<WorkoutSession>(d.workouts),
      goals: asArray<Goal>(d.goals),
      weightLogs: asArray<WeightEntry>(d.weightHistory),
      customMetrics: asArray<Measurement>(d.bodyMeasurements),
      // 旧格式没有这两项 —— 沿用当前值，绝不用空数组覆盖
      prs: [] as PRRecord[],
      scheduledWorkouts: [] as ScheduledWorkout[],
      customExerciseDefsFromDb: asArray<ExerciseDefinition>(st.customExercises),
      prefs,
    },
    legacy: true,
    missingFields: ['prs', 'scheduledWorkouts'],
    counts: {
      workouts: asArray(d.workouts).length,
      weightLogs: asArray(d.weightHistory).length,
      goals: asArray(d.goals).length,
      scheduledWorkouts: 0,
    },
  };
}

// ============ 导入（覆盖） ============

/**
 * 覆盖式恢复。顺序即安全性：
 *   1. 先把当前状态整份存进回滚槽 —— 失败就整个中止，绝不带着「备份没存成
 *      但数据已经被覆盖」的状态往下走
 *   2. 再写 prefs 与 IndexedDB（后者内部是 clear + 写，本来就是覆盖）
 *
 * @param keepFields 旧格式缺失、需要从当前数据沿用的字段
 */
export async function applyBackup(parsed: ParsedBackup): Promise<void> {
  const current = await collectLocalSnapshot();

  // 1. 回滚槽（失败直接抛，不吞）
  await db.save(ROLLBACK_STORE, {
    id: ROLLBACK_ID,
    createdAt: new Date().toISOString(),
    snapshot: current,
  });

  // 2. 旧格式缺的字段沿用当前值
  const next: FitlogRemoteSnapshot = { ...parsed.snapshot };
  if (parsed.legacy) {
    next.prs = current.prs;
    next.scheduledWorkouts = current.scheduledWorkouts;
  }

  writePrefsToLocalStorage(next.prefs);
  await applySnapshotToLocalIndexedDb(next);
}

// ============ 回滚 ============

export interface RollbackInfo {
  createdAt: string;
  workouts: number;
}

export async function readRollback(): Promise<RollbackInfo | null> {
  const rows = await db.getAll<{ id: string; createdAt: string; snapshot: FitlogRemoteSnapshot }>(
    ROLLBACK_STORE,
  );
  const row = rows.find((r) => r.id === ROLLBACK_ID);
  if (!row?.snapshot) return null;
  return { createdAt: row.createdAt, workouts: row.snapshot.workouts?.length ?? 0 };
}

/** 撤销上一次导入。回滚槽用掉即清空 —— 留着会让人以为还能再撤一次。 */
export async function rollbackImport(): Promise<void> {
  const rows = await db.getAll<{ id: string; snapshot: FitlogRemoteSnapshot }>(ROLLBACK_STORE);
  const row = rows.find((r) => r.id === ROLLBACK_ID);
  if (!row?.snapshot) throw new Error('no-rollback');
  writePrefsToLocalStorage(row.snapshot.prefs);
  await applySnapshotToLocalIndexedDb(row.snapshot);
  await db.delete(ROLLBACK_STORE, ROLLBACK_ID);
}
