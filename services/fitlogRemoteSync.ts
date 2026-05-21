import {
  collectLocalSnapshot,
  fetchRemoteSnapshot,
  mergeLocalWithRemote,
  putRemoteSnapshot,
  applySnapshotToLocalIndexedDb,
  writePrefsToLocalStorage,
  migrateRecordsToSoloUserId,
  isRemoteConfigured,
} from './fitlogRemote';
import type { FitlogSyncedPrefs } from './fitlogSnapshotTypes';

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
