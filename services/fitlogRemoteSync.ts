import {
  collectLocalSnapshot,
  fetchRemoteSnapshot,
  mergeLocalWithRemote,
  putRemoteSnapshot,
  applySnapshotToLocalIndexedDb,
  writePrefsToLocalStorage,
  readPrefsFromLocalStorage,
  migrateRecordsToSoloUserId,
  isRemoteConfigured,
} from './fitlogRemote';
import type { FitlogSyncedPrefs, FitlogRemoteSnapshot } from './fitlogSnapshotTypes';

let pullLock = false;

/**
 * 从个人服务器拉取并与本地合并写入 IndexedDB；prefs 写入 localStorage。
 */
export async function pullAndMergeFitlogRemote(): Promise<FitlogSyncedPrefs | null> {
  if (!isRemoteConfigured() || pullLock) return null;
  pullLock = true;
  try {
    await migrateRecordsToSoloUserId();
    const remote = await fetchRemoteSnapshot();
    const local = await collectLocalSnapshot();
    if (!remote) return null;
    const merged = mergeLocalWithRemote(local, remote);
    writePrefsToLocalStorage(merged.prefs);
    await applySnapshotToLocalIndexedDb(merged);
    return merged.prefs;
  } finally {
    pullLock = false;
  }
}

export async function pushFitlogRemoteSnapshot(): Promise<void> {
  if (!isRemoteConfigured()) return;
  await migrateRecordsToSoloUserId();
  const snap = await collectLocalSnapshot();
  await putRemoteSnapshot(snap);
}

/**
 * 模式切换专用：从当前端点拉取快照并完全覆盖本地 IndexedDB。
 * 若远端无数据（404），则清空本地实体数据（保留 prefs：语言/单位/自定义动作等）。
 */
export async function reloadLocalFromRemote(): Promise<void> {
  if (!isRemoteConfigured()) return;

  await migrateRecordsToSoloUserId();
  const remote = await fetchRemoteSnapshot();

  if (remote) {
    writePrefsToLocalStorage(remote.prefs);
    await applySnapshotToLocalIndexedDb(remote);
  } else {
    // 新端点无数据 → 仅清空实体数据，保留 prefs（语言、单位、自定义动作等）
    const prefs = readPrefsFromLocalStorage();
    const emptySnapshot: FitlogRemoteSnapshot = {
      schemaVersion: 2,
      clientExportedAt: new Date().toISOString(),
      workouts: [],
      goals: [],
      weightLogs: [],
      customMetrics: [],
      prs: [],
      customExerciseDefsFromDb: [],
      scheduledWorkouts: [],
      assistantConversations: [],
      prefs,
      tombstones: {},
    };
    writePrefsToLocalStorage(prefs);
    await applySnapshotToLocalIndexedDb(emptySnapshot);
  }
}