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
import type { FitlogRemoteSnapshot, FitlogSyncedPrefs, FitlogTombstones } from './fitlogSnapshotTypes';
import {
  applySnapshotToLocalIndexedDb,
  collectLocalSnapshot,
  isRemoteConfigured,
  mergeLocalWithRemote,
  readPrefsFromLocalStorage,
  writePrefsToLocalStorage,
} from './fitlogRemote';
import { db } from './db';
import { undoJournal } from './undoJournal';
import { langOf, unitOf } from './appPrefs';
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
 * false：回滚也没成，可能停在改了一半——提示要说实话，并指向「撤销上次恢复、导入或重置」（审查 A25）
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
 * 整份改写本机之前把快照收拾成「以它为准」的样子（审查 A23 / A24）：
 *   - 墓碑：写之前有、写之后没有的 id 记墓碑（同步合并时服务器上的那份不会回来）；写之后有的 id 摘掉墓碑
 *     （恢复回来的训练要是还挂着墓碑，下一次合并就把它过滤掉了）
 *   - 时间戳换成现在：记录的 updatedAt、首选项的各个 lastUpdate —— 万一走到合并，也是这一份赢
 * 单设备用：不考虑另一台设备同时在改。
 */
function asAuthoritative(next: FitlogRemoteSnapshot, before: FitlogRemoteSnapshot): FitlogRemoteSnapshot {
  const now = new Date().toISOString();
  const nowMs = Date.now();
  const ids = (snap: FitlogRemoteSnapshot, k: keyof FitlogRemoteSnapshot) =>
    new Set(((snap[k] as { id: string }[] | undefined) ?? []).map(x => x.id));
  const tomb: FitlogTombstones = {};
  for (const [tk, sk] of STORES) {
    const keep = ids(next, sk);
    const dropped = [...ids(before, sk)].filter(id => !keep.has(id));
    const all = new Set([...(before.tombstones?.[tk] ?? []), ...(next.tombstones?.[tk] ?? []), ...dropped]);
    const list = [...all].filter(id => !keep.has(id));
    if (list.length) tomb[tk] = list;
  }
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
 * 用 next 整份改写本机（恢复备份 / 导入 / 撤销导入 / 重置共用）：
 * 写之前的样子 before 由调用方存好回滚槽；写到一半失败就自动换回 before，换不回来如实报。
 * 写成了标「以本机为准」，再试着立刻推一次（失败不要紧，启动 / 回到前台会补推，且不会先拉回旧数据）。
 * 返回推送结果：pushed / not-configured / failed（调用方据此决定提示怎么说）。
 */
export async function overwriteLocal(
  next: FitlogRemoteSnapshot,
  before: FitlogRemoteSnapshot,
): Promise<'pushed' | 'not-configured' | 'failed'> {
  const snap = asAuthoritative(next, before);
  // 整份改写不进撤销日志，之前的撤销历史作废（导入另有「撤销导入」）
  undoJournal.clear();
  try {
    await undoJournal.withoutJournal(async () => {
      writePrefsToLocalStorage(snap.prefs);
      await applySnapshotToLocalIndexedDb(snap);
    });
  } catch (err) {
    console.error('[fitlog] 写回本机失败，换回写之前的样子:', err);
    let rolledBack = false;
    try {
      await undoJournal.withoutJournal(async () => {
        writePrefsToLocalStorage(before.prefs);
        await applySnapshotToLocalIndexedDb(before);
      });
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
 * 覆盖式恢复。顺序即安全性：
 *   1. 先把当前状态整份存进回滚槽 —— 失败就整个中止，绝不带着「备份没存成
 *      但数据已经被覆盖」的状态往下走
 *   2. 再写 prefs 与 IndexedDB（后者内部是 clear + 写，本来就是覆盖）
 */
export async function applyBackup(parsed: ParsedBackup): Promise<'pushed' | 'not-configured' | 'failed'> {
  const current = await collectLocalSnapshot();

  // 旧格式缺的字段沿用当前值
  const next: FitlogRemoteSnapshot = { ...parsed.snapshot };
  if (parsed.legacy) {
    next.prs = current.prs;
    next.scheduledWorkouts = current.scheduledWorkouts;
  }

  // 回滚槽（存不进去直接抛，不吞），再改写
  return withRollbackSlot(current, () => overwriteLocal(next, current));
}

/**
 * 合并式恢复：记录和服务端同步同一套规则（按 id 取较新 + 墓碑过滤），删过的不会被旧备份捞回来。
 * 首选项和同步不同：两边按 id / 键取并集、同键较新的一边为准（unionPrefs，2026-11-14 用户定），
 * 本机删掉的键（没有墓碑的那几类）会被备份带回来 —— 按钮上写的就是「两边都留」。
 *
 * **只对新格式（v2，带墓碑）可用。** 旧格式没有墓碑，按 id 合并会把用户删掉的训练捞回来，
 * 而且界面上看不出来 —— 那种文件只能走 applyBackup 覆盖。调用方按 parsed.legacy 决定给不给这个选项。
 */
export async function mergeBackup(parsed: ParsedBackup): Promise<'pushed' | 'not-configured' | 'failed'> {
  if (parsed.legacy) throw new Error('legacy-cannot-merge');
  const current = await collectLocalSnapshot();
  const merged = mergeLocalWithRemote(current, parsed.snapshot, { unionPrefs: true });
  return withRollbackSlot(current, () => overwriteLocal(merged, current));
}

/**
 * 重置账户：清空全部数据，只留语言和单位。和覆盖恢复同样的顺序安全性：先存回滚槽（失败直接抛、不重置），
 * 「撤销上次恢复、导入或重置」7 天内能撤回（2026-11-14 用户定，为了数据安全）。
 * 走 overwriteLocal：删掉的每一条记墓碑、以本机为准推上去（原来清空墓碑，下次启动拉取会把服务器上的合并回来，审查 A24）。
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
      avatarDataUrl: null,
      // 训练计划、馆档案等首选项一起清掉，只留语言和单位
      appPrefs: { ...(keepApp?.lang ? { lang: keepApp.lang } : {}), ...(keepApp?.unit ? { unit: keepApp.unit } : {}) },
    },
  };
  return withRollbackSlot(before, () => overwriteLocal(empty, before));
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
  return withRollbackSlot(current, () => overwriteLocal(next, current));
}

/** 摘要用：备份里最后一次训练的日期（ISO），没有训练返回 null */
export function lastWorkoutDate(parsed: ParsedBackup): string | null {
  let m: string | null = null;
  for (const w of parsed.snapshot.workouts) if (w?.date && (!m || w.date > m)) m = w.date;
  return m;
}

// ============ 回滚 ============

type RollbackRow = { id: string; createdAt: string; snapshot: FitlogRemoteSnapshot };

/** 把当前状态整份存进回滚槽（失败直接抛，不吞） */
async function saveRollbackSlot(current: FitlogRemoteSnapshot): Promise<void> {
  await db.save(ROLLBACK_STORE, { id: ROLLBACK_ID, createdAt: new Date().toISOString(), snapshot: current });
}

/**
 * 先存回滚槽（存不进去直接抛，什么都没写），再整份改写。改写失败时：
 *   - 已经自动换回原样（rolledBack），或者根本没写到库：把上一份副本放回去 —— 「数据未改动」那句话才完全属实，
 *     上一次恢复 / 导入 / 重置仍撤销得了（上架审查 C54：原来失败也把唯一的副本换成了当前样子）；
 *   - 写了一半换不回来：留新副本，它就是这次操作之前的样子，提示里指向的「撤销」靠的正是它。
 */
async function withRollbackSlot<T>(current: FitlogRemoteSnapshot, write: () => Promise<T>): Promise<T> {
  const prev = await findRollbackRow();
  await saveRollbackSlot(current);
  try {
    return await write();
  } catch (err) {
    if (!(err instanceof OverwriteFailedError) || err.rolledBack) {
      try {
        if (prev) await db.save(ROLLBACK_STORE, prev);
        else await db.delete(ROLLBACK_STORE, ROLLBACK_ID);
      } catch (e) {
        console.error('[fitlog] 放回上一份回滚副本失败:', e);
      }
    }
    throw err;
  }
}

async function findRollbackRow(): Promise<RollbackRow | undefined> {
  const rows = await db.getAll<RollbackRow>(ROLLBACK_STORE);
  return rows.find((r) => r.id === ROLLBACK_ID);
}

/** 7 天内的才算还在；过期后怎么处理（清掉 / 报错）由调用方定 */
const rollbackFresh = (row: RollbackRow) => Date.now() - new Date(row.createdAt).getTime() < ROLLBACK_MAX_AGE_MS;

export interface RollbackInfo {
  createdAt: string;
  workouts: number;
  /** 现在本机有、副本里没有的训练（导入之后新记的）：撤销会把它们一起丢掉，确认时要说 */
  newer: number;
}

/** 回滚槽（过了 7 天的当场清掉、当没有） */
export async function readRollback(): Promise<RollbackInfo | null> {
  const row = await findRollbackRow();
  if (!row?.snapshot) return null;
  if (!rollbackFresh(row)) {
    await db.delete(ROLLBACK_STORE, ROLLBACK_ID).catch(() => undefined);
    return null;
  }
  const had = new Set((row.snapshot.workouts ?? []).map(w => w.id));
  const now = await db.getAll<WorkoutSession>('workouts');
  const newer = now.filter(w => !had.has(w.id) && new Date(w.date).getTime() > new Date(row.createdAt).getTime()).length;
  return { createdAt: row.createdAt, workouts: row.snapshot.workouts?.length ?? 0, newer };
}

/** 撤销上一次恢复 / 导入 / 重置。回滚槽用掉即清空 —— 留着会让人以为还能再撤一次。 */
export async function rollbackImport(): Promise<'pushed' | 'not-configured' | 'failed'> {
  const row = await findRollbackRow();
  if (!row?.snapshot || !rollbackFresh(row)) throw new Error('no-rollback');
  const current = await collectLocalSnapshot();
  const pushed = await overwriteLocal(row.snapshot, current);
  await db.delete(ROLLBACK_STORE, ROLLBACK_ID);
  return pushed;
}
