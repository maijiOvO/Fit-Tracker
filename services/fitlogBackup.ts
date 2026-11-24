/**
 * 本地备份：导出 / 导入 / 回滚。
 *
 * 为什么不自己攒一份数据结构，而是复用同步层的 FitlogRemoteSnapshot：
 *
 *   1. **完整性可证**。快照是服务端往返用的那一份，字段齐全且一直在被使用；
 *      自己攒的容易漏。改版前的导出就漏了 prs 与 scheduledWorkouts —— 用户
 *      导出成功、文件也有几百 KB，看起来完全正常，直到换手机后发现训练计划没了。
 *   2. **写回逻辑现成且是覆盖语义**。writeSnapshotLocally() 内部就是
 *      db.replaceStores()（7 张表一个事务整表替换），正是「恢复备份」该有的行为，不必另写一套。
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
import type { FitlogRemoteSnapshot, FitlogSyncedPrefs, FitlogTombstones } from './fitlogSnapshotTypes';
import {
  collectLocalSnapshot,
  isRemoteConfigured,
  mergeLocalWithRemote,
  OVERWRITE_PENDING_ID,
  OVERWRITE_TOKEN_KEY,
  readPrefsFromLocalStorage,
  writePrefsToLocalStorage,
  writeSnapshotLocally,
  PrefsWriteError,
  type OverwritePendingRow,
} from './fitlogRemote';
import { writeTombstones } from './fitlogTombstones';
import { db } from './db';
import { undoJournal } from './undoJournal';
import { langOf, unitOf, type AppPrefs } from './appPrefs';
import { isOffline } from './appEnv';
import { storage } from './appStorage';
import { clearLocalLoss, recordLocalWorkouts } from './localCensus';
import { markLocalAuthoritative, pushFitlogRemoteSnapshot } from './fitlogRemoteSync';

/** 备份文件的格式版本。与 snapshot.schemaVersion 是两件事，别混。 */
const BACKUP_FORMAT_VERSION = 2;

/**
 * 导入前的回滚副本存在 IndexedDB，**不是**存在下载下来的文件里。
 *
 * 理由：`<a download>` 在 Android WebView 里能不能真的落盘尚未验证过。
 * 拿一条没验过的路径当回滚保障，等于没有保障 —— 而且失败是静默的。
 * IndexedDB 是这个 app 本来就在可靠使用的存储。
 */
const ROLLBACK_STORE = 'backups';
const ROLLBACK_ID = 'pre-import';
/** 回滚槽留 7 天（审查 A25）：再往后撤销，会把这段时间新记的训练一起丢掉，而按钮上看不出来 */
const ROLLBACK_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * 写回本机失败。rolledBack：已经自动换回写之前的样子（「数据未改动」这句话才是真的）；
 * false：库已经换成新的、首选项没写全，换回去也没成——提示要说实话，并指向「撤销上次恢复、导入或重置」（审查 A25）
 */
class OverwriteFailedError extends Error {
  constructor(readonly rolledBack: boolean, cause: unknown) {
    super(`overwrite failed (${rolledBack ? 'rolled back' : 'NOT rolled back'}): ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = 'OverwriteFailedError';
  }
}

type Store = 'workouts' | 'goals' | 'weightLogs' | 'customMetrics' | 'prs' | 'scheduledWorkouts' | 'customExerciseDefs';
const STORES: [Store, keyof FitlogRemoteSnapshot][] = [
  ['workouts', 'workouts'],
  ['goals', 'goals'],
  ['weightLogs', 'weightLogs'],
  ['customMetrics', 'customMetrics'],
  ['prs', 'prs'],
  ['scheduledWorkouts', 'scheduledWorkouts'],
  ['customExerciseDefs', 'customExerciseDefsFromDb'],
];

/**
 * 整份改写本机之前把快照收拾成「以它为准」的样子：
 *   - 写之后有的 id 摘掉墓碑（恢复回来的训练要是还挂着墓碑，下一次合并就把它过滤掉了）
 *   - 有服务器的构建（personal，审查 A23 / A24）再加两道，万一走到同步合并时这一份赢：写之前有、写之后没有的 id 记墓碑
 *     （服务器上的那份不会回来）；记录的 updatedAt、首选项的各个 lastUpdate 换成现在。
 *   - 断网构建（单机 / 演示）不加（上架审查 C10 / gap-1#2）：它没有同步，只会走到「从备份合并」，
 *     而那两道在这里正好帮倒忙 —— 重置 / 误覆盖 / 撤销之后再合并，记下的墓碑挡住备份里的行，刷过的时间戳让旧内容赢。
 *     用 isOffline()（构建期常量）不用 !isRemoteConfigured()：后者在 dev / prod 换 key 时会翻。
 * 单设备用：不考虑另一台设备同时在改。
 */
function asAuthoritative(next: FitlogRemoteSnapshot, before: FitlogRemoteSnapshot): FitlogRemoteSnapshot {
  const offline = isOffline();
  const ids = (snap: FitlogRemoteSnapshot, k: keyof FitlogRemoteSnapshot) =>
    new Set(((snap[k] as { id: string }[] | undefined) ?? []).map(x => x.id));
  const tomb: FitlogTombstones = {};
  for (const [tk, sk] of STORES) {
    const keep = ids(next, sk);
    const dropped = offline ? [] : [...ids(before, sk)].filter(id => !keep.has(id));
    const all = new Set([...(before.tombstones?.[tk] ?? []), ...(next.tombstones?.[tk] ?? []), ...dropped]);
    const list = [...all].filter(id => !keep.has(id));
    if (list.length) tomb[tk] = list;
  }
  if (offline) return { ...next, tombstones: tomb };
  const now = new Date().toISOString();
  const nowMs = Date.now();
  const stamp = <T extends object>(rows: T[] | undefined): T[] => (rows ?? []).map(r => ({ ...r, updatedAt: now }));
  return {
    ...next,
    workouts: stamp(next.workouts),
    goals: stamp(next.goals),
    weightLogs: stamp(next.weightLogs),
    customMetrics: stamp(next.customMetrics),
    scheduledWorkouts: stamp(next.scheduledWorkouts),
    prefs: {
      ...next.prefs,
      prefsLastUpdateMs: nowMs,
      metricsLastUpdateMs: nowMs,
      starredLastUpdateMs: nowMs,
      ...(next.prefs.appPrefs ? { appPrefsUpdatedMs: nowMs } : {}),
    },
    tombstones: tomb,
  };
}

/**
 * 用 next 整份改写本机（恢复备份 / 导入 / 撤销导入 / 重置共用）。回滚槽和数据在同一个事务里（上架审查 C60）：
 *   - slot 'save'：存回滚槽（写之前的样子 before）。存不进去整个中止，什么都没写；
 *   - slot 'consume'：撤销用掉回滚槽，删掉它 —— 留着会让人以为还能再撤一次。
 * 事务失败时库、首选项、回滚槽都没动（rolledBack）；只有库提交了、写 localStorage 才抛，才整份换回 before
 * （连回滚槽一起放回原来那份），换不回来如实报。
 * 写成了标「以本机为准」，再试着立刻推一次（失败不要紧，启动 / 回到前台会补推，且不会先拉回旧数据）。
 * 返回推送结果：pushed / not-configured / failed（调用方据此决定提示怎么说）。
 */
export async function overwriteLocal(
  next: FitlogRemoteSnapshot,
  before: FitlogRemoteSnapshot,
  slot: 'save' | 'consume',
): Promise<'pushed' | 'not-configured' | 'failed'> {
  const snap = asAuthoritative(next, before);
  const prevSlot = await findRollbackRow();
  // 写入时刻不早于 asAuthoritative 刷的时间戳：之后改过的训练（updatedAt 更晚）撤销时才数得出来
  const at = new Date().toISOString();
  const slotWrite: Parameters<typeof writeSnapshotLocally>[1] =
    slot === 'save'
      ? { put: [[ROLLBACK_STORE, { id: ROLLBACK_ID, createdAt: at, snapshot: before, appliedAt: at, writtenIds: snap.workouts.map(w => w.id) } satisfies RollbackRow]] }
      : { del: [[ROLLBACK_STORE, ROLLBACK_ID]] };
  // 整份改写不进撤销日志，之前的撤销历史作废（导入另有「撤销导入」）
  undoJournal.clear();
  try {
    await undoJournal.withoutJournal(() => writeSnapshotLocally(snap, slotWrite));
  } catch (err) {
    if (!(err instanceof PrefsWriteError)) throw new OverwriteFailedError(true, err);
    console.error('[fitlog] 写回本机失败，换回写之前的样子:', err);
    let rolledBack = false;
    try {
      await undoJournal.withoutJournal(() =>
        writeSnapshotLocally(before, prevSlot ? { put: [[ROLLBACK_STORE, prevSlot]] } : { del: [[ROLLBACK_STORE, ROLLBACK_ID]] }),
      );
      // 写首选项只写认得的单位 / 语言（认不出就沿用当前值）：before 里本来没有的，要清掉备份刚带进来的那个
      if (!langOf(before.prefs.lang)) storage.removeItem('fitlog_lang');
      if (!unitOf(before.prefs.unit)) storage.removeItem('fitlog_unit');
      rolledBack = true;
    } catch (e2) {
      console.error('[fitlog] 换回写之前的样子也失败了:', e2);
    }
    throw new OverwriteFailedError(rolledBack, err);
  }
  // 本机训练数的水位跟着新内容走，丢失标记随之清掉：不然重置后那次重载会被当成「库被清空」（localCensus）
  recordLocalWorkouts(snap.workouts.length);
  clearLocalLoss();
  markLocalAuthoritative();
  if (!isRemoteConfigured()) return 'not-configured';
  try {
    await pushFitlogRemoteSnapshot();
    return 'pushed';
  } catch (e) {
    console.warn('[fitlog] 改写后立刻推送失败（之后会补推）:', e);
    return 'failed';
  }
}

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
  /** 形态不对、不会恢复的记录条数（确认时要说） */
  skipped: number;
  /** 文件里写的导出时刻（新格式 exportedAt，旧格式 exportDate） */
  exportedAt?: string;
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

type Obj = Record<string, any>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const validDate = (v: unknown) => typeof v === 'string' && v !== '' && !Number.isNaN(Date.parse(v));
/** 能当数用就转成数，转不了是 undefined */
const toNum = (v: unknown): number | undefined => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : undefined;
};
/** 数值键：本来是数就不动，能转就转，转不了删掉这个键 */
function fixNums<T extends Obj>(o: T, keys: string[]): T {
  const out: Obj = { ...o };
  for (const k of keys) {
    if (!(k in out) || (typeof out[k] === 'number' && Number.isFinite(out[k]))) continue;
    const n = toNum(out[k]);
    if (n === undefined) delete out[k];
    else out[k] = n;
  }
  return out as T;
}

/**
 * 备份进来的快照逐行规整（上架审查 C08）：只修会让下游崩的形态，修不了的那条跳过并计数，其余字段一律原样。
 * 原来只验 workouts 是不是数组，坏行（exercises 不是数组、组没有 id、动作名是数字……）、写成 'lb' 的单位原样写进库，
 * App 每次启动都停在错误页，撤销也够不着。
 *
 * 写法上只做「展开 + 覆盖个别键」，绝不按白名单重拼：备份是第二条序列化路径，手工列字段会悄悄丢字段
 * （DevNotes「导出手工列字段漏了两项」）。补的 id 由位置推出，同一份文件解析两遍一样，合并时不出重复。
 * 防御只写在数据进来的这一层，读的各处不另外兜。
 */
function normalizeSnapshot(s: Obj): { snapshot: FitlogRemoteSnapshot; skipped: number } {
  let skipped = 0;
  /** 是对象、有非空字符串 id 的行；其余跳过计数 */
  const rows = (v: unknown): Obj[] =>
    asArray<unknown>(v).filter((r): r is Obj => {
      const ok = isObj(r) && typeof r.id === 'string' && r.id !== '';
      if (!ok) skipped++;
      return ok;
    });
  const objs = (v: unknown): Obj[] => asArray<unknown>(v).filter(isObj);

  const fixSet = (set: Obj, id: string): Obj => {
    const out = fixNums({ ...set, id: typeof set.id === 'string' && set.id ? set.id : id }, ['weight', 'reps']);
    if ('subSets' in out) {
      if (Array.isArray(out.subSets)) {
        const raw: unknown[] = out.subSets;
        out.subSets = raw.flatMap((sub, k) => (isObj(sub) ? [fixNums({ ...sub, id: typeof sub.id === 'string' && sub.id ? sub.id : `${out.id}_d${k}` }, ['weight', 'reps'])] : []));
      } else delete out.subSets;
    }
    return out;
  };

  const workouts = rows(s.workouts).flatMap(w => {
    if (!validDate(w.date)) {
      skipped++;
      return [];
    }
    const out: Obj = { ...w, title: typeof w.title === 'string' ? w.title : '' };
    if ('gym' in out && typeof out.gym !== 'string') delete out.gym;
    const exs: unknown[] = Array.isArray(w.exercises) ? w.exercises : [];
    out.exercises = exs.flatMap((ex, i) => {
      if (!isObj(ex)) return [];
      const name = typeof ex.name === 'number' && Number.isFinite(ex.name) ? String(ex.name) : ex.name;
      if (typeof name !== 'string' || !name.trim()) {
        skipped++;
        return [];
      }
      const id = typeof ex.id === 'string' && ex.id ? ex.id : `${w.id}_e${i}`;
      const sets: unknown[] = Array.isArray(ex.sets) ? ex.sets : [];
      return [{ ...ex, id, name, sets: sets.flatMap((set, j) => (isObj(set) ? [fixSet(set, `${id}_s${j}`)] : [])) }];
    });
    return [out];
  });

  const weightLogs = rows(s.weightLogs).flatMap(b => {
    const weight = toNum(b.weight);
    if (weight === undefined || !validDate(b.date)) {
      skipped++;
      return [];
    }
    // 体重一律按 kg 存，unit 只是登记时的显示单位：认不出就记 kg
    return [{ ...b, weight, ...('unit' in b ? { unit: unitOf(b.unit) ?? 'kg' } : {}) }];
  });

  const customMetrics = rows(s.customMetrics).flatMap(m => {
    const value = toNum(m.value);
    if (value === undefined || !validDate(m.date) || typeof m.name !== 'string') {
      skipped++;
      return [];
    }
    return [{ ...m, value }];
  });

  const scheduledWorkouts = rows(s.scheduledWorkouts).map(p => ({
    ...p,
    exercises: Array.isArray(p.exercises) ? p.exercises : [],
    bodyParts: Array.isArray(p.bodyParts) ? p.bodyParts : [],
  }));

  /** 自建动作：名字要有中英文至少一边，缺的一边用另一边补 */
  const defs = (v: unknown) =>
    rows(v).flatMap(d => {
      const n = isObj(d.name) ? d.name : {};
      const cn = typeof n.cn === 'string' ? n.cn.trim() : '';
      const en = typeof n.en === 'string' ? n.en.trim() : '';
      if (!cn && !en) {
        skipped++;
        return [];
      }
      return [cn && en && cn === n.cn && en === n.en ? d : { ...d, name: { ...n, cn: cn || en, en: en || cn } }];
    });

  const p: Obj = isObj(s.prefs) ? s.prefs : {};
  const record = (v: unknown) => (isObj(v) ? v : {});
  const stamp = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  const prefs: Obj = {
    ...p,
    customTags: objs(p.customTags).filter(t => typeof t.id === 'string' && typeof t.name === 'string'),
    customExercises: defs(p.customExercises),
    exerciseNotes: record(p.exerciseNotes),
    starredExercises: record(p.starredExercises),
    exerciseMetricConfigs: record(p.exerciseMetricConfigs),
    tagRenameOverrides: record(p.tagRenameOverrides),
    exerciseOverrides: Object.fromEntries(Object.entries(record(p.exerciseOverrides)).filter(([, v]) => isObj(v))),
    starredLastUpdateMs: stamp(p.starredLastUpdateMs),
    metricsLastUpdateMs: stamp(p.metricsLastUpdateMs),
    prefsLastUpdateMs: stamp(p.prefsLastUpdateMs),
    avatarDataUrl: typeof p.avatarDataUrl === 'string' && p.avatarDataUrl.startsWith('data:image/') ? p.avatarDataUrl : null,
  };
  /** 单位 / 语言：认得的归一，认不出的删掉（写首选项时就沿用当前值） */
  const fixUnitLang = (o: Obj) => {
    for (const [k, f] of [['unit', unitOf], ['lang', langOf]] as const) {
      if (!(k in o)) continue;
      const v = f(o[k]);
      if (v) o[k] = v;
      else delete o[k];
    }
  };
  fixUnitLang(prefs);
  if ('appPrefs' in prefs) {
    if (isObj(prefs.appPrefs)) {
      prefs.appPrefs = { ...prefs.appPrefs };
      fixUnitLang(prefs.appPrefs);
    } else delete prefs.appPrefs;
  }

  const tomb = record(s.tombstones);
  const tombstones = Object.fromEntries(Object.entries(tomb).map(([k, v]) => [k, asArray<unknown>(v).filter(x => typeof x === 'string')]));

  const snapshot: Obj = {
    ...s,
    workouts,
    goals: rows(s.goals),
    weightLogs,
    customMetrics,
    prs: rows(s.prs),
    scheduledWorkouts,
    customExerciseDefsFromDb: defs(s.customExerciseDefsFromDb),
    prefs,
  };
  if ('tombstones' in s) snapshot.tombstones = tombstones;
  return { snapshot: snapshot as FitlogRemoteSnapshot, skipped };
}

/** 计数按规整后的条数 */
const countsOf = (s: FitlogRemoteSnapshot, scheduled = s.scheduledWorkouts.length) => ({
  workouts: s.workouts.length,
  weightLogs: s.weightLogs.length,
  goals: s.goals.length,
  scheduledWorkouts: scheduled,
});

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
  if (!isObj(json)) throw new BackupParseError('not-json');
  const exportedAt = [json.exportedAt, json.exportDate].find((x): x is string => typeof x === 'string');

  // --- v2 ---
  if (isObj(json.snapshot)) {
    const s = json.snapshot;
    // 更新版本的 App 写的：结构可能变了，半懂地接受会用它覆盖本机（远端那条路同样不认，见 fetchRemoteSnapshotResult）
    if (
      (typeof json.formatVersion === 'number' && json.formatVersion > BACKUP_FORMAT_VERSION) ||
      (typeof s.schemaVersion === 'number' && s.schemaVersion > 2)
    ) {
      throw new BackupParseError('newer-version');
    }
    if (!Array.isArray(s.workouts)) throw new BackupParseError('not-a-backup');
    const { snapshot, skipped } = normalizeSnapshot(s);
    return { snapshot, legacy: false, missingFields: [], counts: countsOf(snapshot), skipped, exportedAt };
  }

  // --- legacy ---
  // 要带本 App 的标记：别家 App 恰好也有 data.workouts 的 JSON 不能当备份收（C08）。2026-08-29 改名前导出的写的是 FitLog AI
  const d = json.data;
  if (!['Fit Tracker', 'FitLog AI'].includes(json.app) || !isObj(d) || !Array.isArray(d.workouts)) {
    throw new BackupParseError('not-a-backup');
  }
  const st: Obj = isObj(json.settings) ? json.settings : {};
  const current = readPrefsFromLocalStorage();
  const now = Date.now();
  const lang = langOf(st.language);
  const unit = unitOf(st.unit);

  const prefs: FitlogSyncedPrefs = {
    ...current,
    customTags: asArray(st.customTags) as FitlogSyncedPrefs['customTags'],
    customExercises: asArray<ExerciseDefinition>(st.customExercises),
    exerciseNotes: st.exerciseNotes ?? current.exerciseNotes,
    starredExercises: st.starredExercises ?? current.starredExercises,
    exerciseMetricConfigs: st.metricConfigs ?? current.exerciseMetricConfigs,
    lang: lang ?? current.lang,
    unit: unit ?? current.unit,
    // 单位 / 语言的胜负看 appPrefs（services/appPrefs.ts）：备份里的值要一并写进去，否则读回来还是当前值
    appPrefs: {
      ...(current.appPrefs ?? {}),
      ...(lang ? { lang } : {}),
      ...(unit ? { unit } : {}),
    },
    appPrefsUpdatedMs: now,
    starredLastUpdateMs: now,
    metricsLastUpdateMs: now,
    prefsLastUpdateMs: now,
  };

  const { snapshot, skipped } = normalizeSnapshot({
    schemaVersion: 2,
    clientExportedAt: exportedAt ?? new Date().toISOString(),
    workouts: asArray<WorkoutSession>(d.workouts),
    goals: asArray<Goal>(d.goals),
    weightLogs: asArray<WeightEntry>(d.weightHistory),
    customMetrics: asArray<Measurement>(d.bodyMeasurements),
    // 旧格式没有这两项 —— 沿用当前值（applyBackup 里补），绝不用空数组覆盖
    prs: [] as PRRecord[],
    scheduledWorkouts: [] as ScheduledWorkout[],
    customExerciseDefsFromDb: asArray<ExerciseDefinition>(st.customExercises),
    prefs,
  });
  return { snapshot, legacy: true, missingFields: ['prs', 'scheduledWorkouts'], counts: countsOf(snapshot, 0), skipped, exportedAt };
}

// ============ 导入（覆盖） ============

/**
 * 覆盖式恢复：回滚槽（当前状态整份）和新数据一个事务写进去 —— 槽存不进去就整个中止，
 * 绝不带着「副本没存成但数据已经被覆盖」的状态往下走。
 */
export async function applyBackup(parsed: ParsedBackup): Promise<'pushed' | 'not-configured' | 'failed'> {
  const current = await collectLocalSnapshot();

  // 旧格式缺的字段沿用当前值
  const next: FitlogRemoteSnapshot = { ...parsed.snapshot };
  if (parsed.legacy) {
    next.prs = current.prs;
    next.scheduledWorkouts = current.scheduledWorkouts;
  }

  return overwriteLocal(next, current, 'save');
}

/**
 * 合并式恢复：记录按 id 取较新（看真实的 updatedAt），本机的墓碑照样过滤备份里的行 —— 本机删过的不会被旧备份捞回来。
 * 备份自带的墓碑不用（上架审查 solo-isolation#1）：它只管备份那一侧，本机还活着的行（撤销删除、撤销恢复、CSV 重导救回来的）
 * 不被它删掉，它也不落进本机。代价是另一台设备经备份传来的删除不生效 ——「两边都留」。
 * 首选项和同步不同：两边按 id / 键取并集、同键较新的一边为准（unionPrefs，2026-11-14 用户定），
 * 本机删掉的键（没有墓碑的那几类）会被备份带回来。两边各有一条同名自建动作的，归并成一条（dedupeSameNameCustoms）。
 *
 * **只对新格式（v2，带墓碑）可用。** 旧格式没有墓碑，按 id 合并会把用户删掉的训练捞回来，
 * 而且界面上看不出来 —— 那种文件只能走 applyBackup 覆盖。调用方按 parsed.legacy 决定给不给这个选项。
 *
 * 返回 added：合并后新多出来的训练数；blocked：备份里有、本机删过所以没带回的训练数（提示里如实说）。
 */
export async function mergeBackup(
  parsed: ParsedBackup,
): Promise<{ pushed: 'pushed' | 'not-configured' | 'failed'; added: number; blocked: number }> {
  if (parsed.legacy) throw new Error('legacy-cannot-merge');
  const current = await collectLocalSnapshot();
  const merged = dedupeSameNameCustoms(
    mergeLocalWithRemote(current, { ...parsed.snapshot, tombstones: {} }, { unionPrefs: true }),
    new Set(current.prefs.customExercises.map(d => d.id)),
    new Set(parsed.snapshot.prefs.customExercises.map(d => d.id)),
  );
  const had = new Set(current.workouts.map(w => w.id));
  const dead = new Set(current.tombstones?.workouts ?? []);
  const added = merged.workouts.filter(w => !had.has(w.id)).length;
  const blocked = parsed.snapshot.workouts.filter(w => dead.has(w.id) && !had.has(w.id)).length;
  const pushed = await overwriteLocal(merged, current, 'save');
  return { pushed, added, blocked };
}

/**
 * 合并时两边各带来一条同名自建动作（上架审查 C34 #9）：按 id 取并集会两条并存，选动作时出两个「臀桥」，历史和设置各挂一半。
 * 只管这次合并带进来的撞名 —— 现名（覆盖层优先）中文或英文相同、都是自建、都没并入别处也没从动作库删掉、一条只在本机一条只在备份；
 * 本机原有的重名不碰（真实数据里就有两条原名都叫「悍马卧推」的）。
 * 留 id 较老的那条（一般设置多、历史长），另一条标 mergedInto + hidden：名字解析把它的名字交给留下的那条，
 * 训练、备注、星标、记录项都按名字存，不用动。不走 mergeExerciseInto：它会建出同名做法，历史变成「臀桥（臀桥）」。
 * 按 id 挂的东西搬过去：做法（按 id 并进，留下那条已有的不覆盖）、馆里各台器械的设置、特别关注、力量目标的动作键。
 */
export function dedupeSameNameCustoms(merged: FitlogRemoteSnapshot, localIds: Set<string>, backupIds: Set<string>): FitlogRemoteSnapshot {
  const over = merged.prefs.exerciseOverrides ?? {};
  const names = (d: ExerciseDefinition) => [(over[d.id]?.name?.cn || d.name.cn || '').trim(), (over[d.id]?.name?.en || d.name.en || '').trim()];
  // 从动作库删掉的只打 hidden、定义还在：让它参与配对，较老的已删那条会赢，正在用的那条反被藏起来
  const live = merged.prefs.customExercises.filter(d => !over[d.id]?.mergedInto && !over[d.id]?.hidden);
  const onlyLocal = live.filter(d => localIds.has(d.id) && !backupIds.has(d.id));
  const onlyBackup = live.filter(d => backupIds.has(d.id) && !localIds.has(d.id));
  /** id 是创建时刻：数小的老；不是纯数字的按字符串比 */
  const older = (a: string, b: string) => (/^\d+$/.test(a) && /^\d+$/.test(b) ? Number(a) <= Number(b) : a <= b);
  const loserOf = new Map<string, string>();
  const paired = new Set<string>();
  for (const l of onlyLocal) {
    const [lc, le] = names(l);
    const b = onlyBackup.find(x => !paired.has(x.id) && ((lc && names(x)[0] === lc) || (le && names(x)[1] === le)));
    if (!b) continue;
    paired.add(b.id);
    const [win, lose] = older(l.id, b.id) ? [l.id, b.id] : [b.id, l.id];
    loserOf.set(lose, win);
  }
  if (!loserOf.size) return merged;

  const winners = new Set(loserOf.values());
  const defs = new Map(merged.prefs.customExercises.map(d => [d.id, d]));
  const absorb = (d: ExerciseDefinition): ExerciseDefinition => {
    if (!winners.has(d.id)) return d;
    const own = d.variants ?? [];
    const extra = [...loserOf].filter(([, w]) => w === d.id).flatMap(([lose]) => defs.get(lose)?.variants ?? []);
    const add = extra.filter(v => !own.some(o => o.id === v.id));
    return add.length ? { ...d, variants: [...own, ...add] } : d;
  };
  /** 「馆|动作 id|做法」里的动作 id 换成留下的那条；那条已有同键就留它的 */
  const rekey = <T,>(m: Record<string, T> | undefined): Record<string, T> | undefined => {
    if (!m) return m;
    const out: Record<string, T> = { ...m };
    for (const [k, v] of Object.entries(m)) {
      const p = k.split('|');
      const win = p.length === 3 ? loserOf.get(p[1]) : undefined;
      if (!win) continue;
      delete out[k];
      const nk = `${p[0]}|${win}|${p[2]}`;
      if (!Object.prototype.hasOwnProperty.call(m, nk)) out[nk] = v;
    }
    return out;
  };
  /** 稳定键「动作 id|做法」 */
  const liftKey = (k: string) => {
    const i = k.indexOf('|');
    const win = loserOf.get(i < 0 ? k : k.slice(0, i));
    return win ? win + (i < 0 ? '' : k.slice(i)) : k;
  };
  const app = merged.prefs.appPrefs;
  const appPrefs: AppPrefs | undefined = app && {
    ...app,
    gymOverrides: rekey(app.gymOverrides),
    gymKinds: rekey(app.gymKinds),
    gymNotes: rekey(app.gymNotes),
    gymTares: rekey(app.gymTares),
    gymRigPick: rekey(app.gymRigPick),
    ...(app.featuredLifts ? { featuredLifts: [...new Set(app.featuredLifts.map(liftKey))] } : {}),
  };
  const overrides = { ...over };
  for (const [lose, win] of loserOf) overrides[lose] = { ...overrides[lose], mergedInto: win, hidden: true };
  return {
    ...merged,
    customExerciseDefsFromDb: merged.customExerciseDefsFromDb.map(absorb),
    goals: merged.goals.map(g =>
      g.autoUpdateRule?.exerciseName && liftKey(g.autoUpdateRule.exerciseName) !== g.autoUpdateRule.exerciseName
        ? { ...g, autoUpdateRule: { ...g.autoUpdateRule, exerciseName: liftKey(g.autoUpdateRule.exerciseName) } }
        : g,
    ),
    prefs: { ...merged.prefs, customExercises: merged.prefs.customExercises.map(absorb), exerciseOverrides: overrides, appPrefs },
  };
}

/**
 * 重置账户：清空全部数据，只留语言和单位。和覆盖恢复一样，回滚槽和清空同一个事务（存不进去就不重置），
 * 「撤销上次恢复、导入或重置」7 天内能撤回（2026-11-14 用户定，为了数据安全）。
 * 走 overwriteLocal：有服务器的构建给删掉的每一条记墓碑、以本机为准推上去（原来清空墓碑，下次启动拉取会把服务器上的合并回来，审查 A24）；
 * 断网构建不记（见 asAuthoritative）—— 重置之后从备份合并，备份里的训练照样回来。
 */
export async function resetAccount(): Promise<'pushed' | 'not-configured' | 'failed'> {
  const before = await collectLocalSnapshot();
  const keepApp = before.prefs.appPrefs;
  const empty: FitlogRemoteSnapshot = {
    schemaVersion: 2,
    clientExportedAt: new Date().toISOString(),
    workouts: [],
    goals: [],
    weightLogs: [],
    customMetrics: [],
    prs: [],
    scheduledWorkouts: [],
    customExerciseDefsFromDb: [],
    prefs: {
      customTags: [],
      customExercises: [],
      exerciseNotes: {},
      starredExercises: {},
      exerciseMetricConfigs: {},
      tagRenameOverrides: {},
      exerciseOverrides: {},
      starredLastUpdateMs: 0,
      metricsLastUpdateMs: 0,
      prefsLastUpdateMs: 0,
      lang: before.prefs.lang,
      unit: before.prefs.unit,
      // '' 是删掉头像的墓碑，null 才是「从没设过」（合并时本机 null 取备份那张，见 mergeFitlogPrefs）
      avatarDataUrl: '',
      // 训练计划、馆档案等首选项一起清掉，只留语言和单位
      appPrefs: { ...(keepApp?.lang ? { lang: keepApp.lang } : {}), ...(keepApp?.unit ? { unit: keepApp.unit } : {}) },
    },
  };
  return overwriteLocal(empty, before, 'save');
}

/**
 * 把外来记录（Strong / Hevy 导入）加进现有数据：只新增 / 覆盖同 id 的训练和新建的自定义动作，别的不动。
 * 和覆盖恢复一样先存回滚槽，「撤销上次恢复、导入或重置」能撤回。
 *
 * 同一份文件再导一次 id 相同（见 fitlogCsvImport 的 hash），只是覆盖那几条；
 * 用户之前删过的导入训练，这次是明确要再导进来 —— 从墓碑里摘掉，否则下一次同步又会把它过滤掉。
 */
export async function addImportedRecords(input: {
  workouts: WorkoutSession[];
  newDefs: ExerciseDefinition[];
  metricSeeds: Record<string, string[]>;
}): Promise<'pushed' | 'not-configured' | 'failed'> {
  const current = await collectLocalSnapshot();

  const incoming = new Set(input.workouts.map(w => w.id));
  const knownDefs = new Set(current.prefs.customExercises.map(d => d.id));
  // 已有的自有键盖住导入的种子（原写法 !metrics[name] 遇到 constructor 会把种子跳过，C09）
  const metrics = { ...input.metricSeeds, ...current.prefs.exerciseMetricConfigs };
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
  return overwriteLocal(next, current, 'save');
}

/** 摘要用：备份里最后一次训练的日期（ISO），没有训练返回 null */
export function lastWorkoutDate(parsed: ParsedBackup): string | null {
  let m: string | null = null;
  for (const w of parsed.snapshot.workouts) if (w?.date && (!m || w.date > m)) m = w.date;
  return m;
}

// ============ 回滚 ============

/**
 * 回滚槽：snapshot 是改写之前的样子；appliedAt / writtenIds 是这次写进去的时刻和训练 id，撤销时据此数「之后新记 / 改过的」。
 * 旧版写的槽没有后两项（7 天内自然消失），按日期数。槽和改写同一个事务写（overwriteLocal）：失败时上一份副本原样留着（C54）。
 */
type RollbackRow = { id: string; createdAt: string; snapshot: FitlogRemoteSnapshot; appliedAt?: string; writtenIds?: string[] };

async function findRollbackRow(): Promise<RollbackRow | undefined> {
  const rows = await db.getAll<RollbackRow>(ROLLBACK_STORE);
  return rows.find((r) => r.id === ROLLBACK_ID);
}

/** 7 天内的才算还在；过期后怎么处理（清掉 / 报错）由调用方定 */
const rollbackFresh = (row: RollbackRow) => Date.now() - new Date(row.createdAt).getTime() < ROLLBACK_MAX_AGE_MS;

export interface RollbackInfo {
  createdAt: string;
  workouts: number;
  /** 恢复 / 导入 / 重置之后新记的、改过的训练（不算工作台上进行中的那场，它会保留）：撤销会把它们一起丢掉，确认时要说 */
  newer: number;
}

/** 回滚槽（过了 7 天的当场清掉、当没有）。liveId：工作台上进行中的那场，撤销时保留，不算进 newer */
export async function readRollback(liveId?: string): Promise<RollbackInfo | null> {
  const row = await findRollbackRow();
  if (!row?.snapshot) return null;
  if (!rollbackFresh(row)) {
    await db.delete(ROLLBACK_STORE, ROLLBACK_ID).catch(() => undefined);
    return null;
  }
  const had = new Set((row.snapshot.workouts ?? []).map(w => w.id));
  const now = (await db.getAll<WorkoutSession>('workouts')).filter(w => w.id !== liveId);
  let newer: number;
  if (row.writtenIds && row.appliedAt) {
    // 按 id 和改动时刻数（上架审查 C62）：原来按训练日期数，补记的旧日期训练、改过的旧训练都数不出来
    const written = new Set(row.writtenIds);
    const applied = Date.parse(row.appliedAt);
    newer = now.filter(w => (!had.has(w.id) && !written.has(w.id)) || (!!w.updatedAt && Date.parse(w.updatedAt) > applied)).length;
  } else {
    newer = now.filter(w => !had.has(w.id) && new Date(w.date).getTime() > new Date(row.createdAt).getTime()).length;
  }
  return { createdAt: row.createdAt, workouts: row.snapshot.workouts?.length ?? 0, newer };
}

/**
 * 撤销上一次恢复 / 导入 / 重置，回滚槽在同一个事务里用掉。
 * live：工作台上进行中的那场（WorkoutContext.keepWorkbenchWith 交进来）—— 按 id 换进 / 接到副本里，撤销后接着练（C62）；
 * 原来副本里那份（导入前只记了一组）会把这期间记的组冲掉，重载后工作台也接不回来。
 */
export async function rollbackImport(live?: WorkoutSession): Promise<'pushed' | 'not-configured' | 'failed'> {
  const row = await findRollbackRow();
  if (!row?.snapshot || !rollbackFresh(row)) throw new Error('no-rollback');
  const current = await collectLocalSnapshot();
  const snap = row.snapshot;
  const workouts = live
    ? [...snap.workouts.filter(w => w.id !== live.id), { ...live, updatedAt: new Date().toISOString() }]
    : snap.workouts;
  return overwriteLocal({ ...snap, workouts }, current, 'consume');
}

/**
 * 启动时（挂 React 之前）收尾上一次没写完的整份改写（上架审查 C60，见 writeSnapshotLocally）：
 *   - 标记行的 token 已经落进 localStorage：上次写完了，删掉标记行；
 *   - 没落进去：库已经是新的、首选项和墓碑还是旧的（进程在两步之间被杀）—— 照标记行补写，下次启动再删行。
 */
export async function finishPendingOverwrite(): Promise<void> {
  const row = (await db.getAll<OverwritePendingRow>(ROLLBACK_STORE)).find(r => r.id === OVERWRITE_PENDING_ID);
  if (!row) return;
  if (storage.getItem(OVERWRITE_TOKEN_KEY) === row.token) {
    await undoJournal.withoutJournal(() => db.delete(ROLLBACK_STORE, OVERWRITE_PENDING_ID));
    return;
  }
  await undoJournal.withoutJournal(async () => {
    writePrefsToLocalStorage(row.prefs);
    if (row.tombstones) writeTombstones(row.tombstones);
    storage.setItem(OVERWRITE_TOKEN_KEY, row.token);
  });
}

/** 本机各类数据有几条（恢复时判「本机有没有数据」、覆盖确认里列条数，上架审查 C68）。语言、单位、种下的记录项默认值不算 */
export function localDataSummary(s: FitlogRemoteSnapshot) {
  return {
    workouts: s.workouts.length,
    weightLogs: s.weightLogs.length,
    customMetrics: s.customMetrics.length,
    goals: s.goals.length,
    scheduledWorkouts: s.scheduledWorkouts.length,
    customExercises: s.prefs.customExercises.length,
    gyms: Object.values(s.prefs.appPrefs?.gyms ?? {}).filter(g => g !== '').length,
  };
}
