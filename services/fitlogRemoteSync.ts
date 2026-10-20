import {
  collectLocalSnapshot,
  fetchRemoteSnapshotResult,
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
 * 一次拉取的结局。只有 merged / remote-empty 之后推送才是安全的：
 * failed（没读到远端）和 locked（另一次拉取还在进行、这次根本没拉）时推送，
 * 等于拿本地去盖一份没合并进来的远端。
 */
export type PullOutcome =
  | { kind: 'merged'; prefs: FitlogSyncedPrefs }
  | { kind: 'remote-empty' }
  | { kind: 'failed'; reason: 'unreachable' | 'incompatible' }
  | { kind: 'locked' }
  | { kind: 'not-configured' };

/**
 * 从个人服务器拉取并与本地合并写入 IndexedDB；prefs 写入 localStorage。
 */
export async function pullAndMergeFitlogRemoteDetailed(): Promise<PullOutcome> {
  if (!isRemoteConfigured()) return { kind: 'not-configured' };
  if (pullLock) return { kind: 'locked' };
  pullLock = true;
  try {
    await migrateRecordsToSoloUserId();
    const remote = await fetchRemoteSnapshotResult();
    if (remote.status === 'empty') return { kind: 'remote-empty' };
    if (remote.status === 'failed') return { kind: 'failed', reason: remote.reason };
    const local = await collectLocalSnapshot();
    const merged = mergeLocalWithRemote(local, remote.snapshot);
    writePrefsToLocalStorage(merged.prefs);
    await applySnapshotToLocalIndexedDb(merged);
    return { kind: 'merged', prefs: merged.prefs };
  } finally {
    pullLock = false;
  }
}

/** 只要合并后的 prefs（没合并成就是 null）的调用方用这个 */
export async function pullAndMergeFitlogRemote(): Promise<FitlogSyncedPrefs | null> {
  const r = await pullAndMergeFitlogRemoteDetailed();
  return r.kind === 'merged' ? r.prefs : null;
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
