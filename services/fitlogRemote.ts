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
  AssistantConversation,
  Goal,
  WeightEntry,
  WorkoutSession,
  PRRecord,
  ExerciseDefinition,
  Measurement,
  ScheduledWorkout,
} from '../types';

const RAW_API_URL = import.meta.env.VITE_API_URL || '';
const API_KEY = import.meta.env.VITE_API_KEY || '';
const STATE_PATH = import.meta.env.VITE_FITLOG_STATE_PATH || '/api/fitlog/state';

/** 允许 .env 里写裸 IP/域名，自动补 https:// */
export function normalizeApiBaseUrl(raw: string): string {
  const t = raw.trim();
  if (!t) return '';
  if (/^https?:\/\//i.test(t)) return t.replace(/\/$/, '');
  return `https://${t.replace(/\/$/, '')}`;
}

const API_BASE_URL = normalizeApiBaseUrl(RAW_API_URL);

export function isRemoteConfigured(): boolean {
  return Boolean(API_BASE_URL && API_KEY.trim());
}

export function markPrefsUpdated(): void {
  localStorage.setItem('fitlog_prefs_last_update', String(Date.now()));
}

function headers(): HeadersInit {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${API_KEY}`,
  };
}

export async function fetchRemoteSnapshot(): Promise<FitlogRemoteSnapshot | null> {
  if (!isRemoteConfigured()) return null;

  try {
    const response = await fetch(`${API_BASE_URL.replace(/\/$/, '')}${STATE_PATH}`, {
      method: 'GET',
      headers: headers(),
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`GET ${STATE_PATH} ${response.status}`);
    const data = (await response.json()) as FitlogRemoteSnapshot;
    if (!data || data.schemaVersion !== 2) return null;
    return data;
  } catch (e) {
    console.warn('[fitlog] fetch remote snapshot failed:', e);
    return null;
  }
}

export async function putRemoteSnapshot(snapshot: FitlogRemoteSnapshot): Promise<void> {
  if (!isRemoteConfigured()) return;
  const payload: FitlogRemoteSnapshot = {
    ...snapshot,
    clientExportedAt: new Date().toISOString(),
  };
  const response = await fetch(`${API_BASE_URL.replace(/\/$/, '')}${STATE_PATH}`, {
    method: 'PUT',
    headers: headers(),
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(`PUT ${STATE_PATH} ${response.status}`);
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

function assistantConvUpdatedMs(c: AssistantConversation): number {
  return new Date(c.updatedAt || c.createdAt || 0).getTime();
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
    assistantSyncEnabled: localWins
      ? localLs.assistantSyncEnabled !== false
      : remote.assistantSyncEnabled !== false,
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
    customTags: readParsed(localStorage.getItem('fitlog_custom_tags'), []),
    customExercises: readParsed(localStorage.getItem('fitlog_custom_exercises'), []),
    exerciseNotes: readParsed(localStorage.getItem('fitlog_exercise_notes'), {}),
    starredExercises: readParsed(localStorage.getItem('fitlog_starred_exercises'), {}),
    exerciseMetricConfigs: readParsed(localStorage.getItem('fitlog_metric_configs'), {}),
    tagRenameOverrides: readParsed(localStorage.getItem('fitlog_tag_rename_overrides'), {}),
    exerciseOverrides: readParsed(localStorage.getItem('fitlog_exercise_overrides'), {}),
    starredLastUpdateMs: Number.parseInt(localStorage.getItem('fitlog_starred_last_update') || '0', 10) || 0,
    metricsLastUpdateMs: Number.parseInt(localStorage.getItem('fitlog_metrics_last_update') || '0', 10) || 0,
    prefsLastUpdateMs: Number.parseInt(localStorage.getItem('fitlog_prefs_last_update') || '0', 10) || 0,
    lang: (localStorage.getItem('fitlog_lang') as FitlogSyncedPrefs['lang']) || undefined,
    unit: (localStorage.getItem('fitlog_unit') as 'kg' | 'lbs') || undefined,
    avatarDataUrl: localStorage.getItem('fitlog_avatar_data_url'),
    assistantSyncEnabled: localStorage.getItem('fitlog_assistant_sync_enabled') !== '0',
  };
}

export function writePrefsToLocalStorage(p: FitlogSyncedPrefs): void {
  localStorage.setItem('fitlog_custom_tags', JSON.stringify(p.customTags ?? []));
  localStorage.setItem('fitlog_custom_exercises', JSON.stringify(p.customExercises ?? []));
  localStorage.setItem('fitlog_exercise_notes', JSON.stringify(p.exerciseNotes ?? {}));
  localStorage.setItem('fitlog_starred_exercises', JSON.stringify(p.starredExercises ?? {}));
  localStorage.removeItem('fitlog_rest_prefs');
  localStorage.setItem('fitlog_metric_configs', JSON.stringify(p.exerciseMetricConfigs ?? {}));
  localStorage.setItem('fitlog_tag_rename_overrides', JSON.stringify(p.tagRenameOverrides ?? {}));
  localStorage.setItem('fitlog_exercise_overrides', JSON.stringify(p.exerciseOverrides ?? {}));
  localStorage.setItem('fitlog_starred_last_update', String(p.starredLastUpdateMs || 0));
  localStorage.setItem('fitlog_metrics_last_update', String(p.metricsLastUpdateMs || 0));
  if (p.lang) localStorage.setItem('fitlog_lang', String(p.lang));
  if (p.unit) localStorage.setItem('fitlog_unit', p.unit);
  if (p.avatarDataUrl) localStorage.setItem('fitlog_avatar_data_url', p.avatarDataUrl);
  else localStorage.removeItem('fitlog_avatar_data_url');
  localStorage.setItem('fitlog_assistant_sync_enabled', p.assistantSyncEnabled === false ? '0' : '1');
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
  const assistantConversationsRaw = await db.getAll<AssistantConversation>('assistantConversations');
  const syncAssistant = prefs.assistantSyncEnabled !== false;

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
    assistantConversations: syncAssistant ? assistantConversationsRaw : [],
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
  const syncAssistant = mergedPrefs.assistantSyncEnabled !== false;
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
    assistantConversations: syncAssistant
      ? mergeEntityList(
          local.assistantConversations || [],
          remote.assistantConversations || [],
          assistantConvUpdatedMs,
          tombstoneIdSet(tombstones, 'assistantConversations'),
        )
      : local.assistantConversations || [],
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
  if (snapshot.prefs.assistantSyncEnabled !== false) {
    await replaceStore('assistantConversations', snapshot.assistantConversations || []);
  }
  if (snapshot.tombstones) writeTombstones(snapshot.tombstones);
}
