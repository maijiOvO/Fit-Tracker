/**
 * 本地备份：导出 / 导入 / 回滚。
 *
 * 为什么不自己攒一份数据结构，而是复用同步层的 FitlogRemoteSnapshot：
 *
 *   1. **完整性可证**。快照是服务端往返用的那一份，字段齐全且一直在被使用；
 *      自己攒的容易漏。改版前的导出就漏了 prs 与 scheduledWorkouts —— 用户
 *      导出成功、文件也有几百 KB，看起来完全正常，直到换手机后发现训练计划没了。
 *   2. **写回逻辑现成且是覆盖语义**。applySnapshotToLocalIndexedDb() 内部就是
 *      db.replaceAll()（每张表一个事务整表替换），正是「恢复备份」该有的行为，不必另写一套。
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
  mergeLocalWithRemote,
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
    // 单位 / 语言的胜负看 appPrefs（services/appPrefs.ts）：备份里的值要一并写进去，否则读回来还是当前值
    appPrefs: {
      ...(current.appPrefs ?? {}),
      ...(st.language ? { lang: st.language } : {}),
      ...(st.unit ? { unit: st.unit } : {}),
    },
    appPrefsUpdatedMs: now,
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

/**
 * 合并式恢复：和服务端同步同一套规则（按 id 取较新 + 墓碑过滤），删过的不会被旧备份捞回来。
 *
 * **只对新格式（v2，带墓碑）可用。** 旧格式没有墓碑，按 id 合并会把用户删掉的训练捞回来，
 * 而且界面上看不出来 —— 那种文件只能走 applyBackup 覆盖。调用方按 parsed.legacy 决定给不给这个选项。
 */
export async function mergeBackup(parsed: ParsedBackup): Promise<void> {
  if (parsed.legacy) throw new Error('legacy-cannot-merge');
  const current = await collectLocalSnapshot();
  await db.save(ROLLBACK_STORE, {
    id: ROLLBACK_ID,
    createdAt: new Date().toISOString(),
    snapshot: current,
  });
  const merged = mergeLocalWithRemote(current, parsed.snapshot);
  writePrefsToLocalStorage(merged.prefs);
  await applySnapshotToLocalIndexedDb(merged);
}

/**
 * 把外来记录（Strong / Hevy 导入）加进现有数据：只新增 / 覆盖同 id 的训练和新建的自定义动作，别的不动。
 * 和覆盖恢复一样先存回滚槽，「撤销上次导入」能撤回。
 *
 * 同一份文件再导一次 id 相同（见 fitlogCsvImport 的 hash），只是覆盖那几条；
 * 用户之前删过的导入训练，这次是明确要再导进来 —— 从墓碑里摘掉，否则下一次同步又会把它过滤掉。
 */
export async function addImportedRecords(input: {
  workouts: WorkoutSession[];
  newDefs: ExerciseDefinition[];
  metricSeeds: Record<string, string[]>;
}): Promise<void> {
  const current = await collectLocalSnapshot();
  await db.save(ROLLBACK_STORE, {
    id: ROLLBACK_ID,
    createdAt: new Date().toISOString(),
    snapshot: current,
  });

  const incoming = new Set(input.workouts.map(w => w.id));
  const knownDefs = new Set(current.prefs.customExercises.map(d => d.id));
  const metrics = { ...current.prefs.exerciseMetricConfigs };
  for (const [name, m] of Object.entries(input.metricSeeds)) if (!metrics[name]) metrics[name] = m;
  const now = Date.now();
  const tomb = current.tombstones ?? {};

  const next: FitlogRemoteSnapshot = {
    ...current,
    workouts: [...current.workouts.filter(w => !incoming.has(w.id)), ...input.workouts],
    prefs: {
      ...current.prefs,
      customExercises: [...input.newDefs.filter(d => !knownDefs.has(d.id)), ...current.prefs.customExercises],
      exerciseMetricConfigs: metrics,
      prefsLastUpdateMs: now,
      metricsLastUpdateMs: now,
    },
    tombstones: {
      ...tomb,
      workouts: (tomb.workouts ?? []).filter(id => !incoming.has(id)),
      customExerciseDefs: (tomb.customExerciseDefs ?? []).filter(id => !input.newDefs.some(d => d.id === id)),
    },
  };
  writePrefsToLocalStorage(next.prefs);
  await applySnapshotToLocalIndexedDb(next);
}

/** 摘要用：备份里最后一次训练的日期（ISO），没有训练返回 null */
export function lastWorkoutDate(parsed: ParsedBackup): string | null {
  let m: string | null = null;
  for (const w of parsed.snapshot.workouts) if (w?.date && (!m || w.date > m)) m = w.date;
  return m;
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
