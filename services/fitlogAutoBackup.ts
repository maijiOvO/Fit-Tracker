/**
 * 自动备份：把完整快照写进用户选的文件夹（卸载 App 也不丢）。设计见 docs/design-backup.md §1。
 *
 * 三条底线：
 *   1. 内容只走 buildBackupFile() —— 和手动导出同一份完整快照，不在这里挑字段
 *      （以前手工列字段漏了 prs / scheduledWorkouts，恢复后训练计划没了）。
 *   2. 「备份成功」= 写完读回来、解析、逐项条数和 exportedAt 都对上。写出去不等于写成了。
 *   3. 永远新建文件、核对通过之后才清理旧的；没有任何用户数据时不写；旧文件只在内容已被新备份覆盖时才删 ——
 *      重装后没恢复、恢复了较旧的一份、时钟跳过，文件名里的时间都会骗人，只有内容不会（上架审查 C11 / gap-1）。
 *
 * 文件夹和状态存在本机 storage（按数据环境分区），**不进同步快照**：这是这台手机的设置。
 */
import { buildBackupFile, hasUserData, parseBackupFile, type FitlogBackupFile } from './fitlogBackup';
import { collectLocalSnapshot } from './fitlogRemote';
import type { FitlogRemoteSnapshot, FitlogTombstones } from './fitlogSnapshotTypes';
import {
  FolderError,
  deleteFile,
  folderSupported,
  hasAccess,
  listFiles,
  readText,
  writeText,
  type FolderFile,
  type FolderRef,
} from './fitlogFolder';
import { parseJsonOr, storage } from './appStorage';
import { getDataEnv } from './appEnv';
import { pad2 } from '../src/utils/format';
import { fnv1a } from '../src/utils/hash';

const FOLDER_KEY = 'fitlog_backup_folder';
const STATUS_KEY = 'fitlog_backup_status';
/** 恢复 / 导入之后 reload，新页面起来要补一份备份 —— 用这个标记跨过那次 reload */
const PENDING_KEY = 'fitlog_backup_pending';
/** 结束训练后该写的那份还没写成（进程被杀、没权限、和别的备份撞上）：下次启动 / 回前台补（审查 E3） */
const DUE_KEY = 'fitlog_backup_due';
/**
 * 正在写的那份（文件名）：写到一半进程没了，原生 catch 来不及删，文件夹里留下半截 / 0 字节的文件。
 * 核对通过、或坏文件删掉时清；下次 doBackup 开头看到它还在，就去删同名的那份（上架审查 android-native#6）
 */
const WRITING_KEY = 'fitlog_backup_writing';

const DAY_MS = 24 * 3600 * 1000;

export const BACKUP_STATUS_EVENT = 'fitlog:backup-status';

export type BackupErrorCode = FolderError['code'] | 'verify-failed' | 'no-folder';

export interface BackupStatus {
  /** 上一次**核对通过**的备份 */
  lastOkAt?: string;
  lastOkName?: string;
  /** 只给界面看；不再当清理的基线（存在本机，重装后归零） */
  lastOkWorkouts?: number;
  /** 上一次成功备份时的数据指纹：没变、且上次那份还在，就不再写 */
  fingerprint?: string;
  /** 文件夹里的备份份数（清理之后） */
  fileCount?: number;
  /** 最近一次尝试失败（成功会清掉它） */
  lastError?: { at: string; code: BackupErrorCode; message: string };
  /** 日历规则该删、但内容没被新备份覆盖（或读不出、或比新的大一倍以上）而留下的旧备份（文件名）。换文件夹时清空 */
  held?: string[];
}

// ============ 状态 ============

function readJson<T>(key: string): T | null {
  return parseJsonOr<T | null>(storage.getItem(key), null);
}

export function getBackupFolder(): FolderRef | null {
  return readJson<FolderRef>(FOLDER_KEY);
}

export function setBackupFolder(f: FolderRef): void {
  // 别的文件夹里的同名文件不是同一份，之前的「留着」判定不能沿用
  const s = getBackupStatus();
  if (s.held && getBackupFolder()?.dirUri !== f.dirUri) {
    delete s.held;
    storage.setItem(STATUS_KEY, JSON.stringify(s));
  }
  storage.setItem(FOLDER_KEY, JSON.stringify(f));
  emit();
}

/**
 * 恢复时用的文件夹要不要顺手设成备份目的地（上架审查 C56）：还没设过、原来的没权限了、或本来就是它，才设。
 * 已经有一个能用的文件夹时不动 —— 从别处恢复一份，不该悄悄把以后的备份改写到那里。设了返回 true。
 */
export async function adoptRestoreFolder(picked: FolderRef): Promise<boolean> {
  const cur = getBackupFolder();
  if (cur && cur.dirUri !== picked.dirUri && (await hasAccess(cur))) return false;
  setBackupFolder(picked);
  return true;
}

export function getBackupStatus(): BackupStatus {
  return readJson<BackupStatus>(STATUS_KEY) ?? {};
}

function setBackupStatus(s: BackupStatus): void {
  storage.setItem(STATUS_KEY, JSON.stringify(s));
  emit();
}

function emit(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(BACKUP_STATUS_EVENT));
}

/** 标记的值是打标记的时刻：备份跑的过程中又打了一次，跑完不能把新的那次一起清掉 */
const mark = (key: string) => storage.setItem(key, String(Date.now()));

export function markBackupPending(): void {
  mark(PENDING_KEY);
}

// ============ 命名 ============

/** fitlog-backup-2026-10-20-1832.json（本地时间）；dev 数据环境多一段 dev */
function autoBackupName(when = new Date(), env = getDataEnv()): string {
  const stamp = `${when.getFullYear()}-${pad2(when.getMonth() + 1)}-${pad2(when.getDate())}-${pad2(when.getHours())}${pad2(when.getMinutes())}`;
  return `fitlog-${env === 'dev' ? 'dev-' : ''}backup-${stamp}.json`;
}

const NAME_RE = /^fitlog-(dev-)?backup-(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})(?: \((\d+)\))?\.json$/;

export interface NamedBackup {
  file: FolderFile;
  dev: boolean;
  /** 本地时间 */
  at: Date;
  /** 同一分钟撞名时系统加的「 (n)」里的 n，没有为 0：n 大的写得晚 */
  seq: number;
}

/** 认得出的自动备份文件（用户自己放进来的文件一概不算） */
export function parseAutoBackupName(file: FolderFile): NamedBackup | null {
  const m = NAME_RE.exec(file.name);
  if (!m) return null;
  const at = new Date(+m[2], +m[3] - 1, +m[4], +m[5], +m[6]);
  return { file, dev: !!m[1], at, seq: m[7] ? +m[7] : 0 };
}

// ============ 保留规则 ============

const dayKey = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const monthIndex = (d: Date) => d.getFullYear() * 12 + d.getMonth();

/**
 * 按日历该删哪些（只看当前数据环境、命名规则内的文件）：
 *   - 同一天只留最新一份；
 *   - 最近 14 天每天一份；
 *   - 再往前每月留当月最早那份，留 12 个月。
 * 0 字节的（写到一半、存储满时建出来的空壳）不当「当天最新 / 当月最早」，直接进删除表；
 * 大小未知（-1，provider 没报）的照常参与。
 * 只产生候选：真删之前 doBackup 还要读内容确认已被新备份覆盖（uncoveredRecords）。纯函数。
 */
export function selectBackupsToDelete(files: FolderFile[], now = new Date(), env = getDataEnv()): FolderFile[] {
  const mine = files
    .map(parseAutoBackupName)
    .filter((b): b is NamedBackup => !!b && b.dev === (env === 'dev'))
    // 同一分钟按 seq 比数字：按名字比，「X (1)」排在「X」前面、「(10)」排在「(2)」前面（上架审查 C66）
    .sort((a, b) => b.at.getTime() - a.at.getTime() || b.seq - a.seq);

  const keep = new Set<string>();
  // 每天最新一份
  const newestOfDay = new Map<string, NamedBackup>();
  for (const b of mine) if (b.file.size !== 0 && !newestOfDay.has(dayKey(b.at))) newestOfDay.set(dayKey(b.at), b);

  const today0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const cutoff14 = new Date(today0.getTime() - 13 * 86400000);
  const oldestMonth = monthIndex(now) - 11;
  const earliestOfMonth = new Map<number, NamedBackup>();

  for (const b of newestOfDay.values()) {
    if (b.at >= cutoff14) {
      keep.add(b.file.uri);
      continue;
    }
    const mi = monthIndex(b.at);
    if (mi < oldestMonth) continue;
    const cur = earliestOfMonth.get(mi);
    if (!cur || b.at < cur.at) earliestOfMonth.set(mi, b);
  }
  for (const b of earliestOfMonth.values()) keep.add(b.file.uri);

  return mine.filter(b => !keep.has(b.file.uri)).map(b => b.file);
}

// ============ 按内容判断 ============

/**
 * 能逐条删、删了记墓碑的五张表。prs、自建动作定义、首选项不算：它们没有逐条的墓碑，
 * 算进来的话正常删一个自建动作，旧备份就永远删不掉了。
 */
const RECORD_TABLES = ['workouts', 'weightLogs', 'customMetrics', 'goals', 'scheduledWorkouts'] as const satisfies readonly (keyof FitlogTombstones & keyof FitlogRemoteSnapshot)[];

const rowsOf = (s: FitlogRemoteSnapshot, k: (typeof RECORD_TABLES)[number]) => (s[k] ?? []) as { id: string }[];

/** old 里有、next 里既没有这一行也没有它的墓碑的记录（「表:id」）。为空 = old 的内容 next 都交代过了 */
export function uncoveredRecords(old: FitlogRemoteSnapshot, next: FitlogRemoteSnapshot): string[] {
  const out: string[] = [];
  for (const k of RECORD_TABLES) {
    const known = new Set([...rowsOf(next, k).map(r => r.id), ...(next.tombstones?.[k] ?? [])]);
    for (const r of rowsOf(old, k)) if (!known.has(r.id)) out.push(`${k}:${r.id}`);
  }
  return out;
}

const recordCount = (s: FitlogRemoteSnapshot) => RECORD_TABLES.reduce((n, k) => n + rowsOf(s, k).length, 0);

// ============ 排序与默认项（清理、恢复列表、选文件夹共用） ============

export interface ListedBackup {
  file: FolderFile;
  /** 名字里的时间（自动备份）或修改时间（手动导出），毫秒 */
  at: number;
  /** 同一分钟撞名的序号，见 NamedBackup.seq */
  seq: number;
  dev: boolean;
  /** 以下读过文件才有 —— 文件里写的导出时刻（毫秒）、用户数据条数（同 hasUserData 的口径）、这台手机上没有的记录条数 */
  exportedAt?: number;
  records?: number;
  foreign?: number;
  bad?: boolean;
}

/** 新的在前：读过的按文件里的 exportedAt（手动导出的修改时间会被拷贝改掉），没读过的按名字 / 修改时间，同一时刻 seq 大的在前 */
export function orderBackups<T extends ListedBackup>(list: T[]): T[] {
  const key = (e: T) => e.exportedAt ?? e.at;
  return [...list].sort((a, b) => key(b) - key(a) || b.seq - a.seq);
}

/** 文件夹里的 .json 按新旧排好（还没读内容） */
export function listBackups(files: FolderFile[]): ListedBackup[] {
  return orderBackups(
    files
      .filter(f => /\.json$/i.test(f.name))
      .map(f => {
        const named = parseAutoBackupName(f);
        return named ? { file: f, at: named.at.getTime(), seq: named.seq, dev: named.dev } : { file: f, at: f.modified, seq: 0, dev: false };
      }),
  );
}

/** 时间比现在晚一天以上：手机时钟调快过时写的，不能当「最新」 */
export const backupInFuture = (e: ListedBackup, now = Date.now()) => (e.exportedAt ?? e.at) > now + DAY_MS;

/**
 * 恢复弹窗的默认项（上架审查 C53 / C66 / C67 / C11）。只在读得出的里挑：
 *   1. 最新一份不空、时间不在未来、且带着这台手机没有的记录的 —— 重装后选回旧文件夹，默认是旧谱系那份，不是刚写的几场；
 *   2. 没有就取不空、时间不在未来的最新一份；
 *   3. 再没有就取第一份读得出的。
 */
export function pickDefaultBackup<T extends ListedBackup>(entries: T[], now = Date.now()): T | undefined {
  const ok = orderBackups(entries).filter(e => !e.bad && e.records !== undefined);
  const usable = (e: T) => e.records! > 0 && !backupInFuture(e, now);
  return ok.find(e => usable(e) && (e.foreign ?? 0) > 0) ?? ok.find(usable) ?? ok[0];
}

// ============ 指纹 ============

/** 快照内容的哈希（去掉每次都变的 clientExportedAt）：改一条旧围度、只改记录项也算变了（上架审查 C61） */
function snapshotFingerprint(file: FitlogBackupFile): string {
  return fnv1a(JSON.stringify({ ...file.snapshot, clientExportedAt: undefined }));
}

// ============ 核对 ============

function countsOf(file: FitlogBackupFile) {
  const s = file.snapshot;
  return {
    workouts: s.workouts.length,
    goals: s.goals?.length ?? 0,
    weightLogs: s.weightLogs?.length ?? 0,
    customMetrics: s.customMetrics?.length ?? 0,
    prs: s.prs?.length ?? 0,
    scheduledWorkouts: s.scheduledWorkouts?.length ?? 0,
    customExerciseDefs: s.customExerciseDefsFromDb?.length ?? 0,
    customExercises: s.prefs?.customExercises?.length ?? 0,
  };
}

/**
 * 读回来的内容和刚才要写的是不是同一份。返回 null = 对上了；否则返回哪里不对。
 * 用 parseBackupFile 解析 —— 恢复时走的也是它，它能解析才说明这份文件真的能恢复。
 */
export function verifyReadBack(expected: FitlogBackupFile, text: string): string | null {
  let parsedJson: FitlogBackupFile;
  try {
    parsedJson = JSON.parse(text);
    parseBackupFile(text);
  } catch {
    return 'not-parseable';
  }
  if (parsedJson.exportedAt !== expected.exportedAt) return 'exportedAt';
  const a = countsOf(expected);
  const b = countsOf(parsedJson);
  for (const k of Object.keys(a) as Array<keyof typeof a>) {
    if (a[k] !== b[k]) return `${k}: ${a[k]} ≠ ${b[k]}`;
  }
  return null;
}

// ============ 备份 ============

export type BackupReason = 'workout-finished' | 'daily' | 'manual' | 'after-restore' | 'first-setup';

export type BackupOutcome =
  /** held：文件夹里因内容没被覆盖而留着的旧备份份数 */
  | { kind: 'ok'; name: string; workouts: number; pruned: number; held: number }
  | { kind: 'skipped'; why: 'unsupported' | 'no-folder' | 'empty' | 'unchanged' | 'busy' }
  | { kind: 'failed'; code: BackupErrorCode; message: string };

let running: Promise<BackupOutcome> | null = null;

export function backupNow(reason: BackupReason): Promise<BackupOutcome> {
  // 并发的两次（比如结束训练和回到前台同时触发）合成一次，不写两份
  if (running) return running.then(() => ({ kind: 'skipped', why: 'busy' }) as BackupOutcome);
  running = doBackup(reason).finally(() => {
    running = null;
  });
  return running;
}

async function doBackup(reason: BackupReason): Promise<BackupOutcome> {
  if (!folderSupported()) return { kind: 'skipped', why: 'unsupported' };
  const folder = getBackupFolder();
  if (!folder) return { kind: 'skipped', why: 'no-folder' };

  const status = getBackupStatus();
  const fail = (code: BackupErrorCode, message: string): BackupOutcome => {
    setBackupStatus({ ...status, lastError: { at: new Date().toISOString(), code, message } });
    return { kind: 'failed', code, message };
  };

  // 先查授权再读库比指纹：换机 / 系统还原后授权没跟过来，数据没变也得报出来（上架审查 C58），也省一次注定白读的整库读
  if (!(await hasAccess(folder))) return fail('no-access', 'no persisted permission');
  await dropUnfinishedWrite(folder, status.lastOkName);

  const file = await buildBackupFile();
  const workouts = file.snapshot.workouts.length;
  // 没有任何用户数据就不写，手动 / 选文件夹 / 恢复后也一样：空文件保护不了什么，还会排到恢复列表最前面（上架审查 C53）。
  // 只记了体重 / 围度 / 计划的照写（C57）
  if (!hasUserData(file.snapshot)) return { kind: 'skipped', why: 'empty' };
  const manual = reason === 'manual' || reason === 'first-setup' || reason === 'after-restore';
  const fp = snapshotFingerprint(file);
  if (!manual && fp === status.fingerprint && !status.lastError) {
    // 数据没变也要看一眼文件夹（上架审查 C55）：目录被删 / 改名、或用户删光了备份，只比指纹会一直报「上次备份」那个早没了的文件。
    // 只有目录没了 / 没权限记成失败；别的列不出（网盘 provider 抖一下）照旧算没变，免得无故报红
    let files: FolderFile[];
    try {
      files = await listFiles(folder);
    } catch (e) {
      const code = (e as FolderError).code;
      if (code === 'folder-missing' || code === 'no-access') return fail(code, (e as Error).message);
      return { kind: 'skipped', why: 'unchanged' };
    }
    if (files.some(f => f.name === status.lastOkName)) {
      const count = files.filter(f => parseAutoBackupName(f)).length;
      if (count !== status.fileCount) setBackupStatus({ ...status, fileCount: count });
      return { kind: 'skipped', why: 'unchanged' };
    }
    // 上次那份不在了：照常写一份
  }

  const name = autoBackupName(new Date(file.exportedAt));
  storage.setItem(WRITING_KEY, name);
  let written: { uri: string; name: string | null };
  try {
    written = await writeText(folder, name, JSON.stringify(file));
  } catch (e) {
    // 标记留着：原生 catch 里删建了一半的那份是尽力而为，没删掉的下次开头再删
    const err = e as FolderError;
    return fail(err.code, err.message);
  }

  // 读回核对：不过就删掉这份坏文件（删不掉也无妨，它不符合也不会被当成好备份 —— 恢复前会再解析；标记留着，下次再删）
  const dropWritten = async () => {
    if (await deleteFile(written.uri).catch(() => false)) storage.removeItem(WRITING_KEY);
  };
  let back: string;
  try {
    back = await readText(written.uri);
  } catch (e) {
    await dropWritten();
    return fail('verify-failed', `read back: ${(e as Error).message}`);
  }
  const mismatch = verifyReadBack(file, back);
  if (mismatch) {
    await dropWritten();
    return fail('verify-failed', mismatch);
  }
  // 核对通过就清，不等清理完：清理途中进程没了时标记还指着这份，下次开头会把这份好备份当半截文件删掉
  storage.removeItem(WRITING_KEY);

  // 通过之后才清理。恢复后补的这份只写不清：恢复的可能是较旧的一份，当天更早那份里有它没有的（gap-1），
  // 之前留着的也清空，让下一次正常备份对着恢复后的内容重新判
  let pruned = 0;
  let fileCount: number | undefined;
  let held = reason === 'after-restore' ? [] : (status.held ?? []);
  try {
    const files = await listFiles(folder);
    const present = new Set(files.map(f => f.name));
    held = held.filter(n => present.has(n));
    if (reason !== 'after-restore') ({ pruned, held } = await prune(files, written.uri, file.snapshot, held));
    fileCount = files.filter(f => parseAutoBackupName(f)).length - pruned;
  } catch {
    // 清理失败不影响「这份备份写成了」
  }

  // 整份重写：held 要带上，漏了每次成功都会把它清掉
  setBackupStatus({
    lastOkAt: new Date().toISOString(),
    lastOkName: written.name ?? name,
    lastOkWorkouts: workouts,
    fingerprint: fp,
    fileCount,
    ...(held.length ? { held } : {}),
  });
  storage.removeItem(ANNOUNCED_KEY);
  return { kind: 'ok', name: written.name ?? name, workouts, pruned, held: held.length };
}

/**
 * 上次写到一半进程没了（WRITING_KEY 还在）：删掉同名（含系统加的「 (n)」）、且不是上次核对通过那份的文件，再清标记。
 * 列不出 / 删不掉就留着标记下次再来，不挡这次备份。
 */
async function dropUnfinishedWrite(folder: FolderRef, lastOkName: string | undefined): Promise<void> {
  const name = storage.getItem(WRITING_KEY);
  if (!name) return;
  const base = name.replace(/\.json$/, '');
  const same = (n: string) => n === name || (n.startsWith(`${base} (`) && /^ \(\d+\)\.json$/.test(n.slice(base.length)));
  try {
    for (const f of await listFiles(folder)) {
      if (same(f.name) && f.name !== lastOkName && !(await deleteFile(f.uri))) return;
    }
    storage.removeItem(WRITING_KEY);
  } catch {
    // 下次再清
  }
}

/** 每次清理最多读几份候选：文件大时读一份要几百毫秒，剩下的下次再判 */
const PRUNE_READS = 8;

/**
 * 日历规则挑出的候选，读内容再决定删不删。留下（进 held）的：
 *   - 读不出、解析不了、版本比本 App 新的；
 *   - 有新备份既没有、也没记墓碑的记录（重装后的旧谱系、恢复了较旧一份之后的新内容）；
 *   - 记录总数比新备份多一倍以上（误删一大片也能挡住）。
 * 原来按本机 storage 里的上次训练数判骤减：重装后归零、每次成功又被覆盖，只挡得住一次（上架审查 C11），所以改成看候选文件本身。
 */
async function prune(files: FolderFile[], writtenUri: string, snap: FitlogRemoteSnapshot, held: string[]): Promise<{ pruned: number; held: string[] }> {
  const skip = new Set(held);
  const cands = selectBackupsToDelete(files).filter(f => f.uri !== writtenUri && !skip.has(f.name));
  const total = recordCount(snap);
  const out = [...held];
  let pruned = 0;
  for (const f of cands.slice(0, PRUNE_READS)) {
    // 0 字节的里面什么都没有，不用读：按「读不出就留」会让它永远进 held
    let keep = false;
    if (f.size !== 0) {
      try {
        const old = parseBackupFile(await readText(f.uri)).snapshot;
        keep = uncoveredRecords(old, snap).length > 0 || recordCount(old) > 2 * total;
      } catch {
        keep = true;
      }
    }
    if (keep) out.push(f.name);
    else if (await deleteFile(f.uri).catch(() => false)) pruned++;
  }
  return { pruned, held: out };
}

/**
 * 文件夹里最新一份能读的备份（最多试 3 份）有几条这台手机上没有的记录。
 * 选文件夹时用：> 0 说明这是重装前的备份文件夹，该先去恢复（上架审查 C11）。读不了按 0 算。
 */
export async function foreignInFolder(folder: FolderRef): Promise<number> {
  const env = getDataEnv();
  try {
    const mine = listBackups(await listFiles(folder)).filter(b => !parseAutoBackupName(b.file) || b.dev === (env === 'dev'));
    const local = await collectLocalSnapshot();
    for (const b of mine.slice(0, 3)) {
      try {
        return uncoveredRecords(parseBackupFile(await readText(b.file.uri)).snapshot, local).length;
      } catch {
        // 这份读不出，试下一份
      }
    }
  } catch {
    // 列不出文件：当成没有
  }
  return 0;
}

// ============ 时机 ============

/**
 * 跑一次备份，做成了（或确实不用做：数据没变 / 没训练 / 没文件夹）才清掉标记。
 * 失败、或撞上另一次正在跑的（busy：那次的快照可能早于这次的改动）都留着，下次启动 / 回前台再来。
 */
function runMarked(key: string, reason: BackupReason): void {
  const at = storage.getItem(key);
  void backupNow(reason).then(o => {
    announceAutoFailure(o);
    const done = o.kind === 'ok' || (o.kind === 'skipped' && o.why !== 'busy');
    if (done && storage.getItem(key) === at) storage.removeItem(key);
  });
}

/** 自动备份失败、且这个原因还没报过：DataSafetyHost 弹一次（审查 D11 / E2） */
export const AUTO_BACKUP_FAILED_EVENT = 'fitlog:auto-backup-failed';
/** 报过的失败原因。同一原因不重报：回到前台每次都会重试，每次都弹就成了噪音；成功一次清掉 */
const ANNOUNCED_KEY = 'fitlog_backup_fail_announced';

function announceAutoFailure(o: BackupOutcome): void {
  if (o.kind !== 'failed' || storage.getItem(ANNOUNCED_KEY) === o.code) return;
  storage.setItem(ANNOUNCED_KEY, o.code);
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent<BackupErrorCode>(AUTO_BACKUP_FAILED_EVENT, { detail: o.code }));
}

/**
 * 结束训练后调：先在本机记一笔再立即写（finishWorkout 已经等库写完）。不靠内存定时器：
 * 练完锁屏 / 划掉 App 进程被回收，定时器就没了，而 24 小时内 maybeDailyBackup 不补（审查 E3）。
 */
export function scheduleAutoBackup(): void {
  if (!folderSupported() || !getBackupFolder()) return;
  mark(DUE_KEY);
  runMarked(DUE_KEY, 'workout-finished');
}

/**
 * 启动 / 回到前台时调：先补没写成的（恢复后的、练完的），否则距上次成功超过 24 小时才写
 * （数据没变也不写，见 doBackup 的指纹）。练完的那份按 workout-finished 补：指纹没变就跳过，不像恢复后那样强制写。
 */
export function maybeDailyBackup(): void {
  const folder = getBackupFolder();
  if (!folderSupported() || !folder) return;
  if (storage.getItem(PENDING_KEY)) return runMarked(PENDING_KEY, 'after-restore');
  if (storage.getItem(DUE_KEY)) return runMarked(DUE_KEY, 'workout-finished');
  const last = getBackupStatus().lastOkAt;
  // 上次成功在未来（时钟调快过又调回来）按到期算：不然要等到那个时刻才再备份（上架审查 C67）
  const age = last ? Date.now() - new Date(last).getTime() : NaN;
  if (age >= 0 && age < DAY_MS) {
    // 24 小时内不用写，但授权要查：换机 / 系统还原后授权没跟过来，原来要等下一次真写才发现（上架审查 C58）
    void hasAccess(folder).then(ok => {
      if (ok) return;
      const o: BackupOutcome = { kind: 'failed', code: 'no-access', message: 'no persisted permission' };
      setBackupStatus({ ...getBackupStatus(), lastError: { at: new Date().toISOString(), code: o.code, message: o.message } });
      announceAutoFailure(o);
    });
    return;
  }
  void backupNow('daily').then(announceAutoFailure);
}
