import {
  collectLocalSnapshot,
  fetchRemoteSnapshotResult,
  mergeLocalWithRemote,
  putRemoteSnapshot,
  applySnapshotToLocalIndexedDb,
  writePrefsToLocalStorage,
  migrateRecordsToSoloUserId,
  isRemoteConfigured,
} from './fitlogRemote';
import type { FitlogSyncedPrefs } from './fitlogSnapshotTypes';
import { db } from './db';
import { getDataEnv, setDataEnv, type DataEnv } from './appEnv';
import { cancelPendingFitlogPush } from './fitlogSyncScheduler';
import { storage } from './appStorage';
import { undoJournal } from './undoJournal';
import { RemoteError } from './fitlogRemote';

/* ── 推送的稳妥性（2026-10-22，审查 A26；单设备用，不做按条目的时间戳） ──
 *
 * 1. 「有改动还没推上去」记在本机（DIRTY_KEY，值是最后一次改动的时刻）：App 被杀、推送失败，
 *    下次启动 / 回到前台照样补推，不靠内存里那个防抖定时器。
 * 2. 这次启动还没成功拉过远端（启动那次拉取失败 / 超时），推送前先拉一次合并：
 *    不能拿本地去盖一份没读到的远端。启动那次拉取还在路上就等它落定。
 * 3. 恢复备份 / 导入 / 撤销导入 / 重置之后，本机就是想要的样子（LOCAL_AUTH_KEY）：
 *    下一次推送以本机为准、启动时先推不拉 —— 否则启动拉取会按 id 把服务器上的旧数据合并回来，恢复白做。
 */
const DIRTY_KEY = 'fitlog_push_dirty';
const LOCAL_AUTH_KEY = 'fitlog_local_authoritative';

/** 这次启动成功拉过（merged / remote-empty）或推过：之后的推送不用先拉 */
let pullOk = false;
let inflight: Promise<PullOutcome> | null = null;

export type SyncState = 'synced' | 'pending' | 'failed';
let syncState: { state: SyncState; at: number | null } | null = null;

/** 同步状态（首选项「同步」一行）：pending＝有改动还没推上去；failed＝最近一次推送失败；synced＝都推上去了 */
export function currentSyncState(): { state: SyncState; at: number | null } {
  return syncState ?? { state: isPushDirty() ? 'pending' : 'synced', at: null };
}

function setSyncState(state: SyncState, at: number | null = syncState?.at ?? null): void {
  syncState = { state, at };
  // 异步派发：markPushDirty 会从别的组件的 setState 更新函数里（渲染中）被调到，同步派发让 App 在别人渲染时 setState，
  // React 报「Cannot update a component while rendering a different component」（2026-10-22 e2e 抓到）
  const detail = syncState;
  if (typeof window !== 'undefined') queueMicrotask(() => window.dispatchEvent(new CustomEvent('fitlog:sync-state', { detail })));
}

export function isPushDirty(): boolean {
  return !!storage.getItem(DIRTY_KEY);
}

/** 有改动要推（防抖推送排上时调） */
export function markPushDirty(): void {
  storage.setItem(DIRTY_KEY, String(Date.now()));
  if (currentSyncState().state !== 'failed') setSyncState('pending');
}

/** 推送彻底失败（重试用完）：首选项那一行如实显示 */
export function markPushFailed(): void {
  setSyncState('failed');
}

export function isLocalAuthoritative(): boolean {
  return storage.getItem(LOCAL_AUTH_KEY) === '1';
}

/** 本机刚被整份改写（恢复 / 导入 / 撤销导入 / 重置）：下一次推送以本机为准，启动时先推不拉 */
export function markLocalAuthoritative(): void {
  storage.setItem(LOCAL_AUTH_KEY, '1');
  markPushDirty();
}

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
  if (inflight) return { kind: 'locked' };
  inflight = (async (): Promise<PullOutcome> => {
    await migrateRecordsToSoloUserId();
    const remote = await fetchRemoteSnapshotResult();
    if (remote.status === 'empty') return { kind: 'remote-empty' };
    if (remote.status === 'failed') return { kind: 'failed', reason: remote.reason };
    const local = await collectLocalSnapshot();
    const merged = mergeLocalWithRemote(local, remote.snapshot);
    // 拉进来的是别处的改动：不进撤销日志，而且之前的撤销历史作废（撤销会把它们盖掉）
    await undoJournal.withoutJournal(async () => {
      writePrefsToLocalStorage(merged.prefs);
      await applySnapshotToLocalIndexedDb(merged);
    });
    undoJournal.clear();
    return { kind: 'merged', prefs: merged.prefs };
  })();
  try {
    const r = await inflight;
    if (r.kind === 'merged' || r.kind === 'remote-empty') {
      pullOk = true;
      if (!isPushDirty()) setSyncState('synced', Date.now());
    }
    return r;
  } finally {
    inflight = null;
  }
}

/** 只要合并后的 prefs（没合并成就是 null）的调用方用这个 */
export async function pullAndMergeFitlogRemote(): Promise<FitlogSyncedPrefs | null> {
  const r = await pullAndMergeFitlogRemoteDetailed();
  return r.kind === 'merged' ? r.prefs : null;
}

export async function pushFitlogRemoteSnapshot(): Promise<void> {
  if (!isRemoteConfigured()) return;
  if (!isLocalAuthoritative() && !pullOk) {
    // 启动那次拉取还在路上：等它落定（它成功了就不用再拉）
    if (inflight) await inflight.catch(() => undefined);
    if (!pullOk) {
      const r = await pullAndMergeFitlogRemoteDetailed();
      // 拉进来了别的设备 / 服务器上的东西：界面重读本地库（useFitlogSync 接）
      if (r.kind === 'merged' && typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('fitlog:pulled'));
      if (!pullOk) {
        throw new RemoteError(
          `pull ${r.kind}${r.kind === 'failed' ? ` (${r.reason})` : ''} before push; push skipped so the server copy is not overwritten`,
          'unreachable',
        );
      }
    }
  }
  const startedAt = Date.now();
  await migrateRecordsToSoloUserId();
  const snap = await collectLocalSnapshot();
  await putRemoteSnapshot(snap);
  pullOk = true;
  storage.removeItem(LOCAL_AUTH_KEY);
  // 推的过程中又有改动（它会再排一次推送）：标记留着
  const dirtyAt = Number(storage.getItem(DIRTY_KEY) || 0);
  if (dirtyAt <= startedAt) storage.removeItem(DIRTY_KEY);
  setSyncState(dirtyAt <= startedAt ? 'synced' : 'pending', Date.now());
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
  undoJournal.clear();
  setDataEnv(next);

  // 两个环境各算各的：换过去之后那边还没拉过
  pullOk = false;
  syncState = null;
  try {
    await db.reopen();
    // 那个环境刚恢复 / 重置过还没推上去：以本机为准先推，别拉回来盖掉
    if (isRemoteConfigured()) {
      if (isLocalAuthoritative()) await pushFitlogRemoteSnapshot().catch(e => console.warn('[fitlog] 切换环境后推送失败:', e));
      else await pullAndMergeFitlogRemote();
    }
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
