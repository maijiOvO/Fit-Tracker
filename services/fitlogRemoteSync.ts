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
import type { FitlogSyncedPrefs } from './fitlogSnapshotTypes';
import { db } from './db';
import { getDataEnv, setDataEnv, type DataEnv } from './appEnv';
import { cancelPendingFitlogPush } from './fitlogSyncScheduler';

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
 * 切换数据环境（dev ⇄ prod）。
 *
 * 顺序是安全性的关键：
 *   1. 取消待发的防抖推送 —— 否则它会带着旧环境的数据打到新端点
 *   2. 翻转环境标记 —— 此后 storage / db / 网络三者的命名空间同时改变
 *   3. 重开 IndexedDB —— 换到新环境的独立库
 *   4. 从新端点拉取合并
 *
 * 因为本地存储本身已按环境分区，这里**不需要**清空任何数据：
 * 两个环境的数据各自躺在自己的库里，切换只是换一个视图。
 *
 * 任一步失败都回滚到原环境，绝不停在「标记已翻转但数据没跟上」的错配状态。
 */
export async function switchDataEnv(next: DataEnv): Promise<void> {
  const previous = getDataEnv();
  if (previous === next) return;

  cancelPendingFitlogPush();
  setDataEnv(next);

  try {
    await db.reopen();
    if (isRemoteConfigured()) await pullAndMergeFitlogRemote();
  } catch (e) {
    // 回滚：环境标记与本地库必须重新对齐到切换前的状态
    setDataEnv(previous);
    try {
      await db.reopen();
    } catch (reopenErr) {
      console.error('[fitlog] 回滚重开数据库失败:', reopenErr);
    }
    throw e;
  }
}
