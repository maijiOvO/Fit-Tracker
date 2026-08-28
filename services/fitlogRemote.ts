import { db } from './db';
import { FITLOG_SOLO_USER_ID } from './fitlogSolo';
import type { FitlogRemoteSnapshot, FitlogSyncedPrefs } from './fitlogSnapshotTypes';
import {
  filterByTombstones,
  mergeTombstoneSets,
  readTombstones,
  tombstoneIdSet,
  writeTombstones,
} from './fitlogTombstones';
import type {
  Goal,
  WeightEntry,
  WorkoutSession,
  PRRecord,
  ExerciseDefinition,
  Measurement,
  ScheduledWorkout,
} from '../types';
import { storage } from './appStorage';
import { getDataEnv, statePath } from './appEnv';

/**
 * 个人服务器默认地址：家庭 NAS，经 Tailscale Serve 对外暴露。
 *
 * ⚠️ 必须使用主机名，不能换成 Tailscale IP：
 *    Tailscale Serve 按 Host 头路由，直接请求 IP 会返回 404。
 * ⚠️ 仅在设备已连接 Tailscale 时可达，公网无法访问。
 *
 * 证书为 Let's Encrypt 正式签发，Android 无需 cleartext / 自签白名单。
 *
 * 覆盖方式：在 .env.local 设置 VITE_API_URL（环境变量优先级最高）。
 * 端点路径（state / state-dev）不可用环境变量覆盖 —— 见 services/appEnv.ts。
 * 回滚旧 VPS：VITE_API_URL=https://fitlog.myronhub.com
 */
export const DEFAULT_API_BASE_URL = 'https://hometj.taild995c6.ts.net';

const RAW_API_URL = import.meta.env.VITE_API_URL || DEFAULT_API_BASE_URL;

/**
 * 两套凭据：dev 与 prod 各一把。
 * 服务端把 key 绑定到端点（dev key 只能碰 state-dev，prod key 只能碰 state），
 * 于是即便客户端把路径算错，服务器也会 403 —— 隔离不再依赖客户端算对。
 * 未配置 VITE_API_KEY_DEV 时回落到 VITE_API_KEY，保证升级过程中不中断。
 */
const PROD_API_KEY = import.meta.env.VITE_API_KEY || '';
const DEV_API_KEY = import.meta.env.VITE_API_KEY_DEV || PROD_API_KEY;

/**
 * 当前数据环境对应的凭据。
 * 助手客户端（/api/chat，两把 key 都放行）也复用它，
 * 免得开发机只配了 dev key 时助手用不了。
 */
export function apiKey(): string {
  return getDataEnv() === 'dev' ? DEV_API_KEY : PROD_API_KEY;
}

/** 兼容旧调用点（App.tsx / ProfileTab）—— 判定逻辑已统一到 services/appEnv.ts */
export { isDevMode, setDevMode, isEnvLocked, getDataEnv } from './appEnv';

/** 状态端点路径：完全由数据环境决定，不再接受任意的环境变量覆盖。 */
export function resolveStatePath(): string {
  return statePath();
}

/** 允许 .env 里写裸 IP/域名，自动补 https:// */
export function normalizeApiBaseUrl(raw: string): string {
  const t = raw.trim();
  if (!t) return '';
  if (/^https?:\/\//i.test(t)) return t.replace(/\/$/, '');
  return `https://${t.replace(/\/$/, '')}`;
}

export const API_BASE_URL = normalizeApiBaseUrl(RAW_API_URL);

export function isRemoteConfigured(): boolean {
  return Boolean(API_BASE_URL && apiKey().trim());
}

export function markPrefsUpdated(): void {
  storage.setItem('fitlog_prefs_last_update', String(Date.now()));
}

/**
 * 远端调用失败的分类结果。
 *
 * 服务端把 key 绑定到端点、并校验环境标记之后，多了两个语义明确的错误码，
 * 它们和"网络不通"是完全不同的问题，必须分开提示 —— 否则一律显示
 * "请检查 Tailscale"会把配置错误引到完全错误的排查方向上。
 */
export type RemoteFailureKind =
  | 'forbidden-endpoint'  // 403：这把 key 无权访问该端点
  | 'env-mismatch'        // 409：环境标记与端点不符，服务端拒绝写入
  | 'http'                // 其它非 2xx
  | 'unreachable'         // 根本没连上（Tailscale 未连 / NAS 离线）
  | 'env-guard';          // 客户端硬守卫拦下：本机环境与目标端点不符

export class RemoteError extends Error {
  constructor(
    message: string,
    readonly kind: RemoteFailureKind,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'RemoteError';
  }
}

/**
 * 把一个非 2xx 响应翻译成带分类的错误。
 *
 * ⚠️ 不变量：services/ 里【抛出去】的 Error.message 一律用英文。
 * 用户看到的那句话由 UI 按 kind 从 translations 里取（App.tsx 的 push-failed 监听），
 * message 只是给控制台看的诊断。中文写在这里的话，英文模式下会被原样拼进
 * 「Sync failed: …」——这正是 2026-08-28 那次全局英文体检查出来的一处。
 * console.* 不受这条约束：那是纯开发信息，不进 UI。
 */
async function toRemoteError(resp: Response, method: string, path: string): Promise<RemoteError> {
  const body = await resp.text().catch(() => '');
  const tail = body ? `: ${body.substring(0, 200)}` : '';
  if (resp.status === 403) {
    return new RemoteError(
      `${method} ${path} 403 — this API key is not allowed on that endpoint${tail}`,
      'forbidden-endpoint',
      403,
    );
  }
  if (resp.status === 409) {
    return new RemoteError(
      `${method} ${path} 409 — env marker does not match the endpoint; the server refused the write${tail}`,
      'env-mismatch',
      409,
    );
  }
  return new RemoteError(`${method} ${path} ${resp.status}${tail}`, 'http', resp.status);
}

/**
 * 所有远端读写的唯一出口。
 *
 * 收口的意义：路径与环境的一致性只需要在这一个地方断言。
 * 任何新增的 fetch 都必须经过这里，否则绕过守卫 —— 这是刻意的。
 */
async function remoteFetch(
  method: 'GET' | 'PUT',
  path: string,
  body?: unknown,
  timeoutMs?: number,
): Promise<Response> {
  const env = getDataEnv();
  const pathIsDev = path.endsWith('-dev');

  // 🔒 硬守卫：环境与端点必须匹配。宁可让开发时的请求直接抛错，
  //    也不能让一次写入落到另一个环境的数据上。
  if (env === 'dev' && !pathIsDev) {
    throw new RemoteError(
      `[fitlog] blocked: dev env tried to reach the prod endpoint ${method} ${path}`,
      'env-guard',
    );
  }
  if (env === 'prod' && pathIsDev) {
    throw new RemoteError(
      `[fitlog] blocked: prod env tried to reach the dev endpoint ${method} ${path}`,
      'env-guard',
    );
  }

  return fetch(`${API_BASE_URL.replace(/\/$/, '')}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey()}`,
      // 服务端据此二次校验；与 key 绑定的端点不符则拒绝写入
      'X-Fitlog-Env': env,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined,
  });
}

export async function fetchRemoteSnapshot(): Promise<FitlogRemoteSnapshot | null> {
  if (!isRemoteConfigured()) return null;

  const path = resolveStatePath();
  try {
    const response = await remoteFetch('GET', path);
    if (response.status === 404) return null;
    if (!response.ok) throw await toRemoteError(response, 'GET', path);
    const data = (await response.json()) as FitlogRemoteSnapshot;
    if (!data || data.schemaVersion !== 2) return null;

    // 快照自带环境烙印时必须与当前环境一致。
    // 旧快照没有 env 字段 → 放行（向后兼容），一旦服务端开始回写就自动生效。
    if (data.env && data.env !== getDataEnv()) {
      console.error(
        `[fitlog] 已拒绝应用快照：快照标记为 ${data.env}，当前环境为 ${getDataEnv()}`,
      );
      return null;
    }
    return data;
  } catch (e) {
    // 配置类错误（key 用错端点 / 环境标记写反）必须冒泡出去让用户看见，
    // 静默返回 null 会让 App 表现得像"远端没有数据"，掩盖真正的问题。
    if (e instanceof RemoteError && (e.kind === 'forbidden-endpoint' || e.kind === 'env-mismatch')) {
      console.error('[fitlog]', e.message);
      throw e;
    }
    console.warn('[fitlog] fetch remote snapshot failed:', e);
    return null;
  }
}

export async function putRemoteSnapshot(snapshot: FitlogRemoteSnapshot): Promise<void> {
  if (!isRemoteConfigured()) return;
  const path = resolveStatePath();
  const payload: FitlogRemoteSnapshot = {
    ...snapshot,
    env: getDataEnv(),
    clientExportedAt: new Date().toISOString(),
  };
  try {
    const response = await remoteFetch('PUT', path, payload, 15000);
    if (!response.ok) throw await toRemoteError(response, 'PUT', path);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('[fitlog] 远端推送快照失败:', msg);
    throw err;
  }
}

function entityUpdatedMs(w: WorkoutSession): number {
  const ts = (w as { updatedAt?: string }).updatedAt || (w as { createdAt?: string }).createdAt || w.date;
  return new Date(ts).getTime();
}

function goalUpdatedMs(g: Goal): number {
  return new Date(g.updatedAt || g.createdAt || 0).getTime();
}

function weightUpdatedMs(w: WeightEntry): number {
  return new Date(w.date).getTime();
}

function metricUpdatedMs(m: Measurement): number {
  return new Date((m.createdAt || m.date) ?? m.date).getTime();
}

function prUpdatedMs(p: PRRecord): number {
  return new Date(p.date).getTime();
}

function scheduleUpdatedMs(s: ScheduledWorkout): number {
  return new Date(s.updatedAt || s.createdAt || s.date).getTime();
}

export function mergeByIdPreferNewer<T extends { id: string }>(
  local: T[],
  remote: T[],
  getTs: (x: T) => number,
): T[] {
  const map = new Map<string, T>();
  for (const x of local) map.set(x.id, x);
  for (const y of remote) {
    const prev = map.get(y.id);
    if (!prev) map.set(y.id, y);
    else map.set(y.id, getTs(y) > getTs(prev) ? y : prev);
  }
  return [...map.values()];
}

/** 与原 performFullSync 中 prefs 段落等价的 starred / metric 合并 */
function pickObject<T extends Record<string, unknown>>(local: T, remote: T, localWins: boolean): T {
  return localWins ? ({ ...remote, ...local } as T) : ({ ...local, ...remote } as T);
}

function pickArray<T>(local: T[], remote: T[], localWins: boolean): T[] {
  if (localWins) return local.length ? local : remote;
  return remote.length ? remote : local;
}

export function mergeFitlogPrefs(
  localLs: FitlogSyncedPrefs,
  remote: FitlogSyncedPrefs,
): FitlogSyncedPrefs {
  let finalStarred = localLs.starredExercises;
  let finalMetricConfigs = localLs.exerciseMetricConfigs;

  const localStarTs = typeof localLs.starredLastUpdateMs === 'number' ? localLs.starredLastUpdateMs : 0;
  const remoteStarTs = typeof remote.starredLastUpdateMs === 'number' ? remote.starredLastUpdateMs : 0;
  if (
    remote.starredExercises &&
    typeof remote.starredExercises === 'object' &&
    Object.keys(remote.starredExercises).length > 0 &&
    remoteStarTs >= localStarTs
  ) {
    finalStarred = remote.starredExercises;
  }

  const localMetTs =
    typeof localLs.metricsLastUpdateMs === 'number' ? localLs.metricsLastUpdateMs : 0;
  const remoteMetTs =
    typeof remote.metricsLastUpdateMs === 'number' ? remote.metricsLastUpdateMs : 0;
  if (remote.exerciseMetricConfigs && typeof remote.exerciseMetricConfigs === 'object' && remoteMetTs >= localMetTs) {
    finalMetricConfigs = remote.exerciseMetricConfigs;
  }

  const localPrefsTs = localLs.prefsLastUpdateMs ?? 0;
  const remotePrefsTs = remote.prefsLastUpdateMs ?? 0;
  const localWins = localPrefsTs >= remotePrefsTs;

  return {
    customTags: pickArray(localLs.customTags ?? [], remote.customTags ?? [], localWins),
    customExercises: pickArray(localLs.customExercises ?? [], remote.customExercises ?? [], localWins),
    exerciseNotes: pickObject(
      (localLs.exerciseNotes ?? {}) as Record<string, string>,
      (remote.exerciseNotes ?? {}) as Record<string, string>,
      localWins,
    ),
    starredExercises: finalStarred,
    exerciseMetricConfigs: finalMetricConfigs,
    tagRenameOverrides: pickObject(
      (localLs.tagRenameOverrides ?? {}) as Record<string, string>,
      (remote.tagRenameOverrides ?? {}) as Record<string, string>,
      localWins,
    ),
    exerciseOverrides: pickObject(
      (localLs.exerciseOverrides ?? {}) as Record<string, Partial<ExerciseDefinition>>,
      (remote.exerciseOverrides ?? {}) as Record<string, Partial<ExerciseDefinition>>,
      localWins,
    ),
    starredLastUpdateMs: Math.max(localStarTs, remoteStarTs),
    metricsLastUpdateMs: Math.max(localMetTs, remoteMetTs),
    prefsLastUpdateMs: Math.max(localPrefsTs, remotePrefsTs),
    lang: localWins ? (localLs.lang ?? remote.lang) : (remote.lang ?? localLs.lang),
    unit: localWins ? (localLs.unit ?? remote.unit) : (remote.unit ?? localLs.unit),
    avatarDataUrl: localWins
      ? (localLs.avatarDataUrl ?? remote.avatarDataUrl)
      : (remote.avatarDataUrl ?? localLs.avatarDataUrl),
  };
}

function readParsed<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function readPrefsFromLocalStorage(): FitlogSyncedPrefs {
  return {
    customTags: readParsed(storage.getItem('fitlog_custom_tags'), []),
    customExercises: readParsed(storage.getItem('fitlog_custom_exercises'), []),
    exerciseNotes: readParsed(storage.getItem('fitlog_exercise_notes'), {}),
    starredExercises: readParsed(storage.getItem('fitlog_starred_exercises'), {}),
    exerciseMetricConfigs: readParsed(storage.getItem('fitlog_metric_configs'), {}),
    tagRenameOverrides: readParsed(storage.getItem('fitlog_tag_rename_overrides'), {}),
    exerciseOverrides: readParsed(storage.getItem('fitlog_exercise_overrides'), {}),
    starredLastUpdateMs: Number.parseInt(storage.getItem('fitlog_starred_last_update') || '0', 10) || 0,
    metricsLastUpdateMs: Number.parseInt(storage.getItem('fitlog_metrics_last_update') || '0', 10) || 0,
    prefsLastUpdateMs: Number.parseInt(storage.getItem('fitlog_prefs_last_update') || '0', 10) || 0,
    lang: (storage.getItem('fitlog_lang') as FitlogSyncedPrefs['lang']) || undefined,
    unit: (storage.getItem('fitlog_unit') as 'kg' | 'lbs') || undefined,
    avatarDataUrl: storage.getItem('fitlog_avatar_data_url'),
  };
}

export function writePrefsToLocalStorage(p: FitlogSyncedPrefs): void {
  storage.setItem('fitlog_custom_tags', JSON.stringify(p.customTags ?? []));
  storage.setItem('fitlog_custom_exercises', JSON.stringify(p.customExercises ?? []));
  storage.setItem('fitlog_exercise_notes', JSON.stringify(p.exerciseNotes ?? {}));
  storage.setItem('fitlog_starred_exercises', JSON.stringify(p.starredExercises ?? {}));
  storage.removeItem('fitlog_rest_prefs');
  storage.setItem('fitlog_metric_configs', JSON.stringify(p.exerciseMetricConfigs ?? {}));
  storage.setItem('fitlog_tag_rename_overrides', JSON.stringify(p.tagRenameOverrides ?? {}));
  storage.setItem('fitlog_exercise_overrides', JSON.stringify(p.exerciseOverrides ?? {}));
  storage.setItem('fitlog_starred_last_update', String(p.starredLastUpdateMs || 0));
  storage.setItem('fitlog_metrics_last_update', String(p.metricsLastUpdateMs || 0));
  if (p.lang) storage.setItem('fitlog_lang', String(p.lang));
  if (p.unit) storage.setItem('fitlog_unit', p.unit);
  if (p.avatarDataUrl) storage.setItem('fitlog_avatar_data_url', p.avatarDataUrl);
  else storage.removeItem('fitlog_avatar_data_url');
}

export async function migrateRecordsToSoloUserId(): Promise<void> {
  const solo = FITLOG_SOLO_USER_ID;
  const fixList = async <T extends { id: string; userId?: string }>(store: string, items: T[]) => {
    for (const item of items) {
      if (item.userId && item.userId !== 'u_guest' && item.userId !== solo) {
        await db.save(store, { ...item, userId: solo });
      }
    }
  };
  await fixList('workouts', await db.getAll<WorkoutSession>('workouts'));
  await fixList('goals', await db.getAll<Goal>('goals'));
  await fixList('weightLogs', await db.getAll<WeightEntry>('weightLogs'));
  await fixList('custom_metrics', await db.getAll<Measurement>('custom_metrics'));
}

export async function collectLocalSnapshot(): Promise<FitlogRemoteSnapshot> {
  const prefs = readPrefsFromLocalStorage();
  const tombstones = readTombstones();
  const workouts = await db.getAll<WorkoutSession>('workouts');
  const goals = await db.getAll<Goal>('goals');
  const weightLogs = await db.getAll<WeightEntry>('weightLogs');
  const customMetrics = await db.getAll<Measurement>('custom_metrics');
  const prs = await db.getAll<PRRecord>('prs');
  const customExerciseDefsFromDb = await db.getAll<ExerciseDefinition>('customExercises');
  const scheduledWorkouts = await db.getAll<ScheduledWorkout>('scheduledWorkouts');

  return {
    schemaVersion: 2,
    clientExportedAt: new Date().toISOString(),
    workouts,
    goals,
    weightLogs,
    customMetrics,
    prs,
    customExerciseDefsFromDb,
    scheduledWorkouts,
    prefs,
    tombstones,
  };
}

function mergeEntityList<T extends { id: string }>(
  local: T[],
  remote: T[],
  getTs: (x: T) => number,
  deleted: Set<string>,
): T[] {
  return filterByTombstones(mergeByIdPreferNewer(local, remote, getTs), deleted);
}

export function mergeLocalWithRemote(
  local: FitlogRemoteSnapshot,
  remote: FitlogRemoteSnapshot,
): FitlogRemoteSnapshot {
  const tombstones = mergeTombstoneSets(local.tombstones ?? readTombstones(), remote.tombstones ?? {});
  writeTombstones(tombstones);

  const mergedPrefs = mergeFitlogPrefs(local.prefs, remote.prefs);
  return {
    schemaVersion: 2,
    clientExportedAt: new Date().toISOString(),
    workouts: mergeEntityList(
      local.workouts,
      remote.workouts,
      entityUpdatedMs,
      tombstoneIdSet(tombstones, 'workouts'),
    ),
    goals: mergeEntityList(local.goals, remote.goals, goalUpdatedMs, tombstoneIdSet(tombstones, 'goals')),
    weightLogs: mergeEntityList(
      local.weightLogs,
      remote.weightLogs,
      weightUpdatedMs,
      tombstoneIdSet(tombstones, 'weightLogs'),
    ),
    customMetrics: mergeEntityList(
      local.customMetrics,
      remote.customMetrics,
      metricUpdatedMs,
      tombstoneIdSet(tombstones, 'customMetrics'),
    ),
    prs: mergeEntityList(local.prs, remote.prs, prUpdatedMs, tombstoneIdSet(tombstones, 'prs')),
    customExerciseDefsFromDb: filterByTombstones(
      mergeExerciseDefs(local.customExerciseDefsFromDb || [], remote.customExerciseDefsFromDb || []),
      tombstoneIdSet(tombstones, 'customExerciseDefs'),
    ),
    scheduledWorkouts: mergeEntityList(
      local.scheduledWorkouts || [],
      remote.scheduledWorkouts || [],
      scheduleUpdatedMs,
      tombstoneIdSet(tombstones, 'scheduledWorkouts'),
    ),
    prefs: mergedPrefs,
    tombstones,
  };
}

function mergeExerciseDefs(
  local: ExerciseDefinition[],
  remote: ExerciseDefinition[],
): ExerciseDefinition[] {
  const map = new Map<string, ExerciseDefinition>();
  for (const l of local) map.set(l.id, l);
  for (const r of remote) map.set(r.id, r);
  return [...map.values()];
}

export async function applySnapshotToLocalIndexedDb(snapshot: FitlogRemoteSnapshot): Promise<void> {
  const replaceStore = async <T extends { id: string }>(name: string, rows: T[]) => {
    await db.clear(name);
    for (const row of rows) await db.save(name, row);
  };

  await replaceStore('workouts', snapshot.workouts);
  await replaceStore('goals', snapshot.goals);
  await replaceStore('weightLogs', snapshot.weightLogs);
  await replaceStore('custom_metrics', snapshot.customMetrics);
  await replaceStore('prs', snapshot.prs);
  await replaceStore('customExercises', snapshot.customExerciseDefsFromDb || []);
  await replaceStore('scheduledWorkouts', snapshot.scheduledWorkouts || []);
  if (snapshot.tombstones) writeTombstones(snapshot.tombstones);
}