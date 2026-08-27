import type { FitlogTombstones } from './fitlogSnapshotTypes';
import { storage } from './appStorage';

const LS_KEY = 'fitlog_tombstones';

export function readTombstones(): FitlogTombstones {
  try {
    const raw = storage.getItem(LS_KEY);
    return raw ? (JSON.parse(raw) as FitlogTombstones) : {};
  } catch {
    return {};
  }
}

export function writeTombstones(t: FitlogTombstones): void {
  storage.setItem(LS_KEY, JSON.stringify(t));
}

export function clearTombstones(): void {
  storage.removeItem(LS_KEY);
}

export function recordTombstone(
  store: keyof FitlogTombstones,
  id: string,
): void {
  const t = readTombstones();
  const list = new Set(t[store] ?? []);
  list.add(id);
  writeTombstones({ ...t, [store]: [...list] });
}

/** 撤销删除时从 tombstone 列表移除 id */
export function removeTombstone(
  store: keyof FitlogTombstones,
  id: string,
): void {
  const t = readTombstones();
  const list = t[store];
  if (!list?.length) return;
  const next = list.filter(x => x !== id);
  const out: FitlogTombstones = { ...t };
  if (next.length) out[store] = next;
  else delete out[store];
  writeTombstones(out);
}

export function mergeTombstoneSets(
  local: FitlogTombstones,
  remote: FitlogTombstones,
): FitlogTombstones {
  const keys: (keyof FitlogTombstones)[] = [
    'workouts',
    'goals',
    'weightLogs',
    'customMetrics',
    'prs',
    'customExerciseDefs',
    'scheduledWorkouts',
  ];
  const out: FitlogTombstones = {};
  for (const k of keys) {
    const merged = new Set([...(local[k] ?? []), ...(remote[k] ?? [])]);
    if (merged.size) out[k] = [...merged];
  }
  return out;
}

export function tombstoneIdSet(t: FitlogTombstones, store: keyof FitlogTombstones): Set<string> {
  return new Set(t[store] ?? []);
}

export function filterByTombstones<T extends { id: string }>(
  items: T[],
  ids: Set<string>,
): T[] {
  if (!ids.size) return items;
  return items.filter((x) => !ids.has(x.id));
}
