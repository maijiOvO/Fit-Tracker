#!/usr/bin/env node
/**
 * 数据安全的自检（docs/design-backup.md）：自动备份的保留规则 / 读回核对 / 写坏和没权限算失败、
 * CSV 导出、合并式恢复不捞回删过的 / 首选项两边都留、重置先存回滚槽且撤销得回来、Strong / Hevy 导入（单位、热身组、递减组、重复导入不翻倍）。
 *
 * 这些原先是 e2e-backup.mjs 里一步一步点界面验的；规则全在 services 里，界面只是转一手。
 * 这里照 prefs-check 的写法：esbuild 打成临时 ESM，node:assert 直接跑。浏览器才有的两样换成内存版 ——
 * IndexedDB（services/db）和 Capacitor（fitlogFolder 的 mock 文件夹走的是 localStorage，原样用）。
 * e2e 只留「卸载后从文件夹恢复」那一条完整路径。
 *
 * 用法：node scripts/data-check.mjs
 */
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = mkdtempSync(join(tmpdir(), 'data-check-'));

const stubs = {
  name: 'stub-browser',
  setup(b) {
    b.onResolve({ filter: /^@capacitor\/core$/ }, () => ({ path: 'capacitor', namespace: 'stub' }));
    b.onResolve({ filter: /^@capacitor\/(filesystem|share)$/ }, a => ({ path: a.path.slice('@capacitor/'.length), namespace: 'stub' }));
    b.onResolve({ filter: /^\.(\/services)?\/db$/ }, () => ({ path: 'db', namespace: 'stub' }));
    // isNativePlatform 读全局开关：saveTextFile 的原生分支（分享）要能测；getPlatform 一直是 web，文件夹照旧走 mock
    b.onLoad({ filter: /^capacitor$/, namespace: 'stub' }, () => ({
      contents: `export const Capacitor = { isNativePlatform: () => !!globalThis.__native, getPlatform: () => 'web' };
        export const registerPlugin = () => new Proxy({}, { get: () => () => { throw new Error('native plugin used in data-check'); } });`,
      loader: 'js',
    }));
    b.onLoad({ filter: /^filesystem$/, namespace: 'stub' }, () => ({
      contents: `export const Filesystem = { writeFile: async () => ({}), getUri: async () => ({ uri: 'file:///cache/x' }) };
        export const Directory = { Cache: 'CACHE' }; export const Encoding = { UTF8: 'utf8' };`,
      loader: 'js',
    }));
    b.onLoad({ filter: /^share$/, namespace: 'stub' }, () => ({ contents: `export const Share = { share: o => globalThis.__share(o) };`, loader: 'js' }));
    // 内存版 IndexedDB：每个 store 一张 id → 行的表
    b.onLoad({ filter: /^db$/, namespace: 'stub' }, () => ({
      contents: `const stores = new Map();
        const s = n => { if (!stores.has(n)) stores.set(n, new Map()); return stores.get(n); };
        export const db = {
          async init() {}, async reopen() {},
          async getAll(n) { return [...s(n).values()].map(x => structuredClone(x)); },
          async save(n, x) { s(n).set(x.id, structuredClone(x)); },
          // 一张表写好几条、一个事务：全成或全不成（抛错由用例替换这个方法注入）；calls 给用例数调了几次
          async saveMany(n, rows, also = []) { this.saveManyCalls = (this.saveManyCalls ?? 0) + 1; for (const x of rows) s(n).set(x.id, structuredClone(x)); for (const o of also) s(o.store).set(o.id, structuredClone(o.row)); },
          async upsert(n, x) { s(n).set(x.id, structuredClone(x)); },
          async delete(n, id) { s(n).delete(id); },
          async deleteMany(n, ids) { for (const id of ids) s(n).delete(id); },
          async clear(n) { s(n).clear(); },
          // 多表一个事务：同步写完，要么全写要么（抛在写之前）全不写；挂起 / 抛错由用例替换这个方法注入
          async replaceStores(replace, extra = {}) {
            for (const [n, rows] of replace) { s(n).clear(); for (const x of rows) s(n).set(x.id, structuredClone(x)); }
            for (const [n, x] of extra.put ?? []) s(n).set(x.id, structuredClone(x));
            for (const [n, id] of extra.del ?? []) s(n).delete(id);
          },
          __reset() { stores.clear(); this.saveManyCalls = 0; },
        };`,
      loader: 'js',
    }));
  },
};

/**
 * 两份包：D 照 personal 构建打（有服务器的那套：整份改写记墓碑、刷时间戳），S 照单机构建打（VITE_FITLOG_SOLO）。
 * 原有用例走 D；单机版恢复语义（上架审查 C10 那批）走 S。
 */
async function bundle(env, file) {
  const outfile = join(dir, file);
  await build({
  stdin: {
    contents: [
      "export * from './services/fitlogAutoBackup.ts';",
      "export { buildWorkoutsCsv } from './services/fitlogCsvExport.ts';",
      "export { parseImportCsv, materialize, importLookup, mergeImportSeeds, previewMatches, planImportWrite } from './services/fitlogCsvImport.ts';",
      "export { mergeLocalWithRemote, collectLocalSnapshot, readPrefsFromLocalStorage, writePrefsToLocalStorage } from './services/fitlogRemote.ts';",
      "export { applyBackup, mergeBackup, parseBackupFile, resetAccount, readRollback, rollbackImport, addImportedRecords, buildBackupFile, finishPendingOverwrite, localDataSummary, backupFileName } from './services/fitlogBackup.ts';",
      "export { PrefsWriteError } from './services/fitlogRemote.ts';",
      "export { writeTombstones, readTombstones } from './services/fitlogTombstones.ts';",
      "export { deleteMetric } from './services/metricDelete.ts';",
      "export { defaultProfile } from './src/utils/loadable.ts';",
      "export { readText as folderReadText, writeText as folderWriteText, routeRestoredPick } from './services/fitlogFolder.ts';",
      "export { saveTextFile } from './services/fitlogSaveFile.ts';",
      "export { pickFile } from './services/fitlogPickFile.ts';",
      "export { backupErrorText, needsRepick } from './src/components/data/flash.ts';",
      "export { migrateLocalData, migrateRecordsToSoloUserId } from './services/fitlogRemote.ts';",
      "export { undoJournal } from './services/undoJournal.ts';",
      "export * as LC from './services/localCensus.ts';",
      "export { storage } from './services/appStorage.ts';",
      "export { isLocalAuthoritative } from './services/fitlogRemoteSync.ts';",
      "export { db } from './services/db';",
      "export { DEFAULT_EXERCISES } from './src/constants/exercises.ts';",
      "export { buildNameIndex } from './src/utils/nameIndex.ts';",
      "export { planMerge } from './src/utils/exerciseMerge.ts';",
      "export { resumeGymRenames, renameGymRows, markGymRename, unmarkGymRename } from './services/gymRename.ts';",
      "export { readAppPrefs, writeAppPrefs } from './services/appPrefs.ts';",
    ].join('\n'),
    resolveDir: ROOT,
    loader: 'ts',
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile,
  logLevel: 'silent',
  plugins: [stubs],
  define: { 'import.meta.env': JSON.stringify(env) },
  });
  return import(pathToFileURL(outfile).href);
}

/** 内存版 localStorage（appStorage、mock 文件夹都走它） */
const mem = new Map();
globalThis.localStorage = {
  getItem: k => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: k => mem.delete(k),
  clear: () => mem.clear(),
  key: i => [...mem.keys()][i] ?? null,
  get length() {
    return mem.size;
  },
};

const D = await bundle({}, 'data.mjs');
const S = await bundle({ VITE_FITLOG_SOLO: 'true' }, 'data-solo.mjs');
rmSync(dir, { recursive: true, force: true });

let n = 0;
const t = async (name, fn) => {
  mem.clear();
  D.db.__reset();
  S.db.__reset();
  await fn();
  n++;
  console.log(`  ✓ ${name}`);
};

const DAY = 86400000;
const iso = daysAgo => new Date(Date.now() - daysAgo * DAY).toISOString();
function seedWorkout(id, daysAgo, title, exName, sets) {
  const at = iso(daysAgo);
  return {
    id, userId: 'u_solo', date: at, title, status: 'completed', finishedAt: at, updatedAt: at,
    exercises: [{ id: `${id}_ex`, name: exName, category: 'STRENGTH', sets: sets.map(([weight, reps], i) => ({ id: `${id}_s${i}`, weight, reps })) }],
  };
}
const SEED = [
  seedWorkout('seed_a', 10, 'E2E 推', '杠铃平板卧推', [[100, 5], [100, 5]]),
  seedWorkout('seed_b', 7, 'E2E 腿', '杠铃深蹲', [[140, 3]]),
  seedWorkout('seed_c', 3, 'E2E 拉', '硬拉', [[180, 2], [170, 3], [160, 5]]),
  seedWorkout('seed_del', 2, 'E2E 待删', '杠铃划船', [[60, 8]]),
];

/** mock 文件夹（services/fitlogFolder.ts）：打开、选好文件夹、注入故障、读里面的文件 */
const FOLDER = { treeUri: 'mock://tree', dirUri: 'mock://primary:Documents/fitlog', dirDocId: 'primary:Documents/fitlog' };
const useMockFolder = () => {
  localStorage.setItem('fitlog_mock_folder', '1');
  D.setBackupFolder(FOLDER);
};
const folderFs = () => JSON.parse(localStorage.getItem('fitlog_mock_folder_fs') || '{}');
const fault = f => (f ? localStorage.setItem('fitlog_mock_folder_fault', f) : localStorage.removeItem('fitlog_mock_folder_fault'));
const seedDb = async () => {
  for (const w of SEED) await D.db.save('workouts', w);
};

console.log('data-check');

// ── 保留规则 ─────────────────────────────────────────────────────────
await t('保留：同一天留最新、14 天内每天一份、更早每月留最早一份、超过 12 个月删；用户自己的文件和 dev 环境的不碰', () => {
  const now = new Date(2026, 9, 20, 18, 30);
  const f = (y, mo, d, h = 12, mi = 0, dev = false) => {
    const p = x => String(x).padStart(2, '0');
    const name = `fitlog-${dev ? 'dev-' : ''}backup-${y}-${p(mo)}-${p(d)}-${p(h)}${p(mi)}.json`;
    return { uri: name, name, size: 1, modified: 0 };
  };
  const files = [
    f(2026, 10, 20, 9), f(2026, 10, 20, 18, 30), // 今天两份 → 留 18:30
    f(2026, 10, 7), // 13 天前 → 留
    f(2026, 10, 6), // 14 天前 → 进月度规则
    f(2026, 10, 2), // 10 月最早 → 留，10-06 删
    f(2026, 9, 3), f(2026, 9, 20), // 9 月：留 9-03
    f(2025, 11, 5), // 11 个月前 → 留
    f(2025, 10, 5), // 12 个月前 → 删
    f(2026, 10, 1, 12, 0, true), // dev 环境的不归这里管
    { uri: 'mine.json', name: 'mine.json', size: 1, modified: 0 },
  ];
  const del = D.selectBackupsToDelete(files, now, 'prod').map(x => x.name).sort();
  assert.deepEqual(del, [
    'fitlog-backup-2025-10-05-1200.json',
    'fitlog-backup-2026-09-20-1200.json',
    'fitlog-backup-2026-10-06-1200.json',
    'fitlog-backup-2026-10-20-0900.json',
  ]);
});

// ── 读回核对 ─────────────────────────────────────────────────────────
await t('读回核对：一模一样才算过；少一次训练、截断的文件都判不一致', () => {
  const file = { app: 'Fit Tracker', formatVersion: 2, exportedAt: '2026-10-20T12:00:00.000Z', snapshot: { schemaVersion: 2, workouts: [SEED[0]], prefs: {} } };
  assert.equal(D.verifyReadBack(file, JSON.stringify(file)), null);
  assert.match(D.verifyReadBack(file, JSON.stringify({ ...file, snapshot: { ...file.snapshot, workouts: [] } })), /workouts/);
  assert.equal(D.verifyReadBack(file, JSON.stringify(file).slice(0, 50)), 'not-parseable');
});

// ── 备份：完整快照、写坏 / 没权限算失败 ──────────────────────────────
await t('备份：写的是完整快照（prs / 计划 / prefs / 墓碑都在）；写坏了算失败并删掉坏文件、没权限算失败，恢复后清掉错误', async () => {
  await seedDb();
  useMockFolder();
  const ok = await D.backupNow('first-setup');
  assert.equal(ok.kind, 'ok');
  assert.equal(ok.workouts, 4);
  const names = Object.keys(folderFs());
  assert.equal(names.length, 1);
  assert.match(names[0], /^fitlog-(dev-)?backup-\d{4}-\d{2}-\d{2}-\d{4}\.json$/);
  const snap = JSON.parse(folderFs()[names[0]].text).snapshot;
  for (const k of ['prs', 'scheduledWorkouts', 'prefs', 'tombstones', 'customExerciseDefsFromDb', 'goals', 'weightLogs']) assert.ok(k in snap, `snapshot lacks ${k}`);

  fault('corrupt-write');
  const bad = await D.backupNow('manual');
  assert.equal(bad.kind, 'failed');
  assert.equal(bad.code, 'verify-failed');
  assert.deepEqual(Object.keys(folderFs()), names, 'corrupt file should have been removed');
  assert.equal(D.getBackupStatus().lastError?.code, 'verify-failed');
  assert.equal(D.getBackupStatus().lastOkName, names[0], 'a failed backup must not replace the last good one');

  fault('deny');
  const denied = await D.backupNow('manual');
  assert.equal(denied.kind, 'failed');
  assert.equal(denied.code, 'no-access');

  fault('');
  assert.equal((await D.backupNow('manual')).kind, 'ok');
  assert.equal(D.getBackupStatus().lastError, undefined);
});

// ── 练完的备份没写成要补（审查 E3）：标记记在本机，24 小时内也补；恢复后的那份失败了标记也不丢 ──────
await t('备份时机：结束训练那次没写成（进程被杀 / 没权限），下次回前台即使距上次成功不到 24 小时也补写；恢复后的补备份失败了，下次照样补', async () => {
  const until = async (cond, what) => {
    for (let i = 0; i < 100 && !cond(); i++) await new Promise(r => setTimeout(r, 10));
    assert.ok(cond(), what);
  };
  await seedDb();
  useMockFolder();
  assert.equal((await D.backupNow('first-setup')).kind, 'ok');
  await D.db.save('workouts', seedWorkout('new_one', 0, '刚练完', '杠铃深蹲', [[150, 3]]));

  fault('deny');
  D.scheduleAutoBackup();
  await until(() => D.getBackupStatus().lastError, '结束训练那次应该马上开始写（这里写失败）');
  fault('');
  D.maybeDailyBackup();
  await until(() => D.getBackupStatus().lastOkWorkouts === 5, '回前台要补上刚练完那场');
  D.maybeDailyBackup();
  await new Promise(r => setTimeout(r, 30));
  assert.equal(D.getBackupStatus().lastError, undefined);

  D.markBackupPending();
  fault('deny');
  D.maybeDailyBackup();
  await until(() => D.getBackupStatus().lastError, '恢复后的补备份（这里写失败）');
  fault('');
  const before = D.getBackupStatus().lastOkAt;
  await new Promise(r => setTimeout(r, 5));
  D.maybeDailyBackup();
  await until(() => !D.getBackupStatus().lastError && D.getBackupStatus().lastOkAt !== before, '恢复后的补备份失败了，下次要再补');
});

// ── 文件夹授权没了（上架审查 C58：换机 / 云还原后授权没跟过来）──────────
await t('备份文件夹授权没了：数据没变、24 小时内也要报 no-access（只报一次）；有改动的那次备份也报 no-access 而不是跳过', async () => {
  const until = async (cond, what) => {
    for (let i = 0; i < 100 && !cond(); i++) await new Promise(r => setTimeout(r, 10));
    assert.ok(cond(), what);
  };
  await seedDb();
  useMockFolder();
  assert.equal((await D.backupNow('first-setup')).kind, 'ok');
  const announced = [];
  const on = () => announced.push(1);
  globalThis.window = new EventTarget();
  window.addEventListener(D.AUTO_BACKUP_FAILED_EVENT, on);
  try {
    fault('deny');
    D.maybeDailyBackup();
    await until(() => D.getBackupStatus().lastError?.code === 'no-access', '24 小时内、数据没变也要查授权');
    D.maybeDailyBackup();
    await new Promise(r => setTimeout(r, 30));
    assert.equal(announced.length, 1, '同一原因只报一次');
    const o = await D.backupNow('workout-finished');
    assert.deepEqual([o.kind, o.code], ['failed', 'no-access']);
  } finally {
    fault('');
    delete globalThis.window;
  }
});

// ── 清理按内容放行、写入闸门、默认项（上架审查第 11 批：C11 / gap-1 / C53 / C56 / C57 / C61 / C66 / C67）──
// 文件名里的时间、本机 storage 里的计数都会骗人：重装、恢复较旧的一份、时钟跳变、同一分钟撞名。下面每条造一种。
const p2 = x => String(x).padStart(2, '0');
/** 自动备份的文件名（本地时间；seq = 同一分钟撞名的「 (n)」） */
const autoName = (d, seq = 0) =>
  `fitlog-backup-${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${seq ? ` (${seq})` : ''}.json`;
const fileText = (at, snap) =>
  JSON.stringify({ app: 'Fit Tracker', formatVersion: 2, exportedAt: at.toISOString(), snapshot: { schemaVersion: 2, prefs: {}, workouts: [], ...snap } });
/** 往 mock 文件夹里直接放文件 */
const putFiles = entries => {
  const fs = folderFs();
  for (const [name, text] of entries) fs[name] = { text, modified: Date.now() };
  localStorage.setItem('fitlog_mock_folder_fs', JSON.stringify(fs));
};
const ws = ids => ids.map((id, i) => seedWorkout(id, 30 - i, id, '杠铃深蹲', [[100, 5]]));

// ── 原生层和系统交接处的结果（上架审查第 15 批：C55 / C63 / C64 / android-native#2 #3 #5 #6 / i18n-settings#9）──
/** 把上次成功拨到 2 天前，让 daily 真的跑；其余字段原样 */
const ageStatus = () => D.storage.setItem('fitlog_backup_status', JSON.stringify({ ...D.getBackupStatus(), lastOkAt: iso(2) }));

// 防：数据没变就只比指纹、不看文件夹 —— 目录被删 / 改名，或用户删光了备份，界面一直报「上次备份」那个早没了的文件（C55）
await t('备份文件夹没了：数据没变也报 folder-missing；用户删光了备份就补写一份、份数按实际；有改动那次报 folder-missing 不是写入失败', async () => {
  await seedDb();
  useMockFolder();
  assert.equal((await D.backupNow('first-setup')).kind, 'ok');

  ageStatus();
  localStorage.setItem('fitlog_mock_folder_fs', '{}');
  const b = await D.backupNow('daily');
  assert.equal(b.kind, 'ok', `删光了备份要补写，实际 ${JSON.stringify(b)}`);
  assert.equal(Object.keys(folderFs()).length, 1);
  assert.equal(D.getBackupStatus().fileCount, 1);

  ageStatus();
  const okName = D.getBackupStatus().lastOkName;
  fault('missing');
  const a = await D.backupNow('daily');
  assert.deepEqual([a.kind, a.code], ['failed', 'folder-missing']);
  assert.equal(D.getBackupStatus().lastError?.code, 'folder-missing');
  assert.equal(D.getBackupStatus().lastOkName, okName);

  await D.db.save('workouts', seedWorkout('new_one', 0, '刚练完', '杠铃深蹲', [[150, 3]]));
  const c = await D.backupNow('workout-finished');
  assert.deepEqual([c.kind, c.code], ['failed', 'folder-missing']);
  fault('');
});

// 防：失败文案按笼统类别给（persist / mkdir / list 都落成「写入失败」）、英文界面出中文（原生 message 原样拼进提示），
// 或者目录没了也不给「重新选择」（i18n-settings#9 / C55 / android-native#3）
await t('备份失败文案只按 code 出：英文里没有中文，权限 / 建目录 / 打开 / 列目录 / 目录没了各说各的；只有没权限、目录没了要重选', () => {
  const codes = ['no-access', 'folder-missing', 'persist-failed', 'mkdir-failed', 'open-failed', 'list-failed', 'create-failed', 'write-failed',
    'read-failed', 'delete-failed', 'unsupported', 'unknown', 'verify-failed', 'no-folder', 'bad-args'];
  for (const c of codes) {
    assert.ok(D.backupErrorText(c, true), `${c} 没有中文文案`);
    assert.doesNotMatch(D.backupErrorText(c, false), /[㐀-鿿]/, `${c} 的英文文案里有中文`);
  }
  for (const c of ['persist-failed', 'mkdir-failed', 'open-failed', 'list-failed', 'folder-missing'])
    assert.notEqual(D.backupErrorText(c, true), D.backupErrorText('write-failed', true), `${c} 落成了「写入失败」`);
  assert.deepEqual(codes.filter(D.needsRepick).sort(), ['folder-missing', 'no-access']);
});

// 防：写坏的 0 字节文件被当成「当天最新 / 当月最早」留下，好备份反被删掉；大小未知（-1）的被当 0 删掉（android-native#6）
await t('保留：0 字节的不当代表、直接删；大小未知（-1）的照常参与', () => {
  const f = (mo, d, h, mi, size) => {
    const name = `fitlog-backup-2026-${p2(mo)}-${p2(d)}-${p2(h)}${p2(mi)}.json`;
    return { uri: name, name, size, modified: 0 };
  };
  const files = [
    f(11, 1, 20, 5, 0), f(11, 1, 20, 10, 0), f(11, 1, 20, 15, 0),
    f(11, 2, 12, 0, 4e6), f(11, 6, 12, 0, 4e6), f(11, 12, 12, 0, 4e6), f(11, 20, 12, 0, 4e6),
    f(12, 20, 12, 0, 4e6), f(10, 5, 12, 0, -1),
  ];
  const del = D.selectBackupsToDelete(files, new Date(2026, 11, 20, 18, 0), 'prod').map(x => x.name).sort();
  assert.deepEqual(del, [
    'fitlog-backup-2026-11-01-2005.json', 'fitlog-backup-2026-11-01-2010.json', 'fitlog-backup-2026-11-01-2015.json',
    'fitlog-backup-2026-11-06-1200.json', 'fitlog-backup-2026-11-12-1200.json', 'fitlog-backup-2026-11-20-1200.json',
  ]);
});

// 防：写到一半进程没了，半截文件一直留在文件夹里（原生 catch 不会执行）；或者清理时把核对通过的那份也删了（android-native#6）
await t('写到一半进程没了：下次备份先删掉写前标记指着的同名文件（含「 (n)」），不碰上次核对通过的那份和用户自己的文件', async () => {
  await seedDb();
  useMockFolder();
  assert.equal((await D.backupNow('first-setup')).kind, 'ok');
  // 把那份好备份挪到 3 天前（14 天内每天一份，不会被日历规则清掉）
  const fs0 = folderFs();
  const [first] = Object.keys(fs0);
  const good = autoName(new Date(Date.now() - 3 * DAY));
  const half = autoName(new Date(Date.now() - DAY));
  const half1 = half.replace(/\.json$/, ' (1).json');
  localStorage.setItem('fitlog_mock_folder_fs', JSON.stringify({ [good]: fs0[first] }));
  D.storage.setItem('fitlog_backup_status', JSON.stringify({ ...D.getBackupStatus(), lastOkName: good }));
  putFiles([[half, fs0[first].text.slice(0, 40)], [half1, ''], ['mine.json', '{}']]);
  D.storage.setItem('fitlog_backup_writing', half);

  await D.db.save('workouts', seedWorkout('new_one', 0, '刚练完', '杠铃深蹲', [[150, 3]]));
  const o = await D.backupNow('manual');
  assert.equal(o.kind, 'ok');
  const names = Object.keys(folderFs());
  assert.ok(!names.includes(half) && !names.includes(half1), `半截文件还在：${names}`);
  assert.ok(names.includes(good) && names.includes('mine.json') && names.includes(o.name), `该留的没了：${names}`);
  assert.equal(D.storage.getItem('fitlog_backup_writing'), null);

  // 标记正好指着上次核对通过的那份（核对通过后、清标记前没了）：不删
  D.storage.setItem('fitlog_backup_writing', o.name);
  ageStatus();
  assert.equal((await D.backupNow('daily')).kind, 'skipped');
  assert.ok(Object.keys(folderFs()).includes(o.name));
  assert.equal(D.storage.getItem('fitlog_backup_writing'), null);
});

// 防：分享面板 resolve 了、却没报交给了谁（OEM 面板 / 面板被系统收掉），照样报「已导出」（C64 / android-native#2）
await t('分享结果分四种：报了接收应用 → handed；空串 → unconfirmed；用户取消 → cancelled；别的错往外抛', async () => {
  globalThis.__native = true;
  try {
    const kind = async r => {
      globalThis.__share = async () => r;
      return (await D.saveTextFile('a.json', '{}')).kind;
    };
    assert.equal(await kind({ activityType: 'com.google.android.gm' }), 'handed');
    assert.equal(await kind({ activityType: '' }), 'unconfirmed');
    globalThis.__share = async () => { throw new Error('Share canceled'); };
    assert.equal((await D.saveTextFile('a.json', '{}')).kind, 'cancelled');
    globalThis.__share = async () => { throw new Error('boom'); };
    await assert.rejects(D.saveTextFile('a.json', '{}'), /boom/);
  } finally {
    delete globalThis.__native;
    delete globalThis.__share;
  }
});

// 防：选文件的结果靠「拿回焦点后 400ms 内有没有 change」去猜 —— change 晚到就把选中的文件丢了；只派发 cancel 时永远没结论（C63）
await t('选文件只认 input 的事件：晚到的 change 不丢，cancel 立刻给 null；上一次没结论时再选一次，上一次按取消收掉', async () => {
  const win = new EventTarget();
  win.setTimeout = setTimeout;
  const inputs = [];
  globalThis.window = win;
  globalThis.document = {
    createElement: () => {
      const el = new EventTarget();
      Object.assign(el, { style: {}, files: null, click() {}, remove() { el.removed = true; } });
      Object.defineProperty(el, 'onchange', { set: fn => el.addEventListener('change', fn) });
      inputs.push(el);
      return el;
    },
    body: { appendChild() {} },
  };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const within = (p, ms) => Promise.race([p, sleep(ms).then(() => 'pending')]);
  try {
    const a = D.pickFile('.json');
    win.dispatchEvent(new Event('focus'));
    await sleep(450);
    inputs.at(-1).files = [{ name: 'backup.json' }];
    inputs.at(-1).dispatchEvent(new Event('change'));
    assert.deepEqual(await within(a, 100), { name: 'backup.json' });

    const b = D.pickFile('.json');
    inputs.at(-1).dispatchEvent(new Event('cancel'));
    assert.equal(await within(b, 100), null);
    assert.ok(inputs.at(-1).removed);

    const c1 = D.pickFile('.json');
    const first = inputs.at(-1);
    const c2 = D.pickFile('.json');
    assert.equal(await within(c1, 100), null);
    assert.ok(first.removed);
    inputs.at(-1).dispatchEvent(new Event('cancel'));
    assert.equal(await within(c2, 100), null);
  } finally {
    delete globalThis.window;
    delete globalThis.document;
  }
});

// 防：有人改了 purpose 的字面量或事件字段名，进程被回收后补回来的选择结果又被静默丢掉（android-native#5）
await t('进程重建后补回的选文件夹结果：按 purpose 分给开启备份 / 恢复；取消、别的插件或方法不认；失败保住 code', () => {
  const folder = { treeUri: 'content://t', dirUri: 'content://t/d', dirDocId: 'primary:Documents/fitlog' };
  const ev = (data, extra = {}) => ({ pluginId: 'FitlogFolder', methodName: 'pickFolder', success: true, data, ...extra });
  assert.deepEqual(D.routeRestoredPick(ev({ ...folder, purpose: 'setup' })), { purpose: 'setup', folder });
  assert.deepEqual(D.routeRestoredPick(ev({ ...folder, purpose: 'restore' })), { purpose: 'restore', folder });
  assert.equal(D.routeRestoredPick(ev({ cancelled: true, purpose: 'setup' })), null);
  assert.equal(D.routeRestoredPick(ev({ ...folder, purpose: 'setup' }, { pluginId: 'Share' })), null);
  assert.equal(D.routeRestoredPick(ev({ ...folder, purpose: 'setup' }, { methodName: 'list' })), null);
  assert.deepEqual(D.routeRestoredPick(ev(undefined, { success: false, error: { code: 'persist-failed', message: 'x' } })), { code: 'persist-failed' });
});

const soloFolder = () => {
  localStorage.setItem('fitlog_mock_folder', '1');
  S.setBackupFolder(FOLDER);
};
const workoutsIn = name => JSON.parse(folderFs()[name].text).snapshot.workouts.map(w => w.id);
const statusOf = () => S.getBackupStatus();
const setStatus = s => S.storage.setItem('fitlog_backup_status', JSON.stringify(s));

// 防：恢复了较旧的一份后，补写那次 / 下一次清理把当天更早、内容更新的那份删掉（gap-1）。
// 00:00–00:01 跑时「now−1 分钟」落到昨天，同一天的前提不成立，这条测不到
await t('新装机恢复较旧的一份：补写不清理；之后当天更早、带着本机没有的训练的那份留着、进 held', async () => {
  soloFolder();
  const now = new Date();
  const yest = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 21, 0);
  const today = new Date(now.getTime() - 60000);
  const yText = fileText(yest, { workouts: ws(['w1', 'w2', 'w3']) });
  putFiles([[autoName(yest), yText], [autoName(today), fileText(today, { workouts: ws(['w1', 'w2', 'w3', 'w4', 'w5']) })]]);
  await S.applyBackup(S.parseBackupFile(yText));
  const a = await S.backupNow('after-restore');
  assert.deepEqual([a.kind, a.pruned], ['ok', 0], '恢复后的补写只写不清');
  const b = await S.backupNow('manual');
  assert.equal(b.kind, 'ok');
  assert.deepEqual(workoutsIn(autoName(today)), ['w1', 'w2', 'w3', 'w4', 'w5'], '今天更早那份还在');
  assert.ok(folderFs()[autoName(yest)], '昨天那份还在');
  assert.ok(statusOf().held.includes(autoName(today)));
});

// 防：personal 版覆盖时给被换掉的 id 记墓碑，旧机上恢复了较旧的一份后，当天更早那份新备份按内容判「都交代过了」被删（gap-1 / D11）。
// 单机版不记这类墓碑，上一条用例已覆盖；00:00–00:01 跑时同一天的前提不成立，同上
await t('personal 覆盖成较旧的一份：比它新的自动备份钉住，之后的清理不删；文件里没写时刻就全钉', async () => {
  localStorage.setItem('fitlog_mock_folder', '1');
  D.setBackupFolder(FOLDER);
  // personal 包的数据环境是 dev，自动备份名带 dev，清理只看同环境的
  const name = d => autoName(d).replace('fitlog-backup-', 'fitlog-dev-backup-');
  const now = new Date();
  const yest = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 21, 0);
  const today = new Date(now.getTime() - 60000);
  const yText = fileText(yest, { workouts: ws(['w1', 'w2', 'w3']) });
  const tText = fileText(today, { workouts: ws(['w1', 'w2', 'w3', 'w4', 'w5']) });
  await D.applyBackup(D.parseBackupFile(tText)); // 旧机：本机就是今天那份的内容
  putFiles([[name(yest), yText], [name(today), tText]]);
  const older = D.parseBackupFile(yText);
  await D.applyBackup(older);
  await D.pinNewerBackups(older.exportedAt);
  const pins = [name(yest), name(today)];
  assert.deepEqual(D.getBackupStatus().pinned.sort(), pins, '比恢复那份新的都钉上（同一分钟的它自己也算上，多留不多删）');
  assert.equal((await D.backupNow('after-restore')).kind, 'ok');
  const b = await D.backupNow('manual');
  assert.equal(b.kind, 'ok');
  assert.deepEqual(workoutsIn(name(today)), ['w1', 'w2', 'w3', 'w4', 'w5'], '今天更早那份还在');
  assert.deepEqual(D.getBackupStatus().pinned.sort(), pins, '补写和清理之后钉的还在');
  await D.pinNewerBackups(undefined);
  assert.equal(D.getBackupStatus().pinned.length, Object.keys(folderFs()).length, '不知道导出时刻：文件夹里的自动备份全钉');
});

// 防：重装后没恢复就选回原来的文件夹，first-setup 写了几场新的，日历规则把旧谱系一口气删掉（C11）
await t('重装后没恢复、选回旧文件夹：旧谱系 25 份一份不删、进 held；选之前看得出文件夹里有 25 条本机没有的', async () => {
  soloFolder();
  const old = [];
  for (let d = 40; d >= 16; d--) {
    const at = new Date(Date.now() - d * DAY);
    at.setHours(12, 0, 0, 0);
    old.push([autoName(at), fileText(at, { workouts: ws(Array.from({ length: 41 - d }, (_, i) => `old${i}`)) })]);
  }
  putFiles(old);
  for (const id of ['n1', 'n2', 'n3']) await S.db.save('workouts', seedWorkout(id, 0, id, '硬拉', [[100, 3]]));
  assert.equal(await S.foreignInFolder(FOLDER), 25);
  const first = await S.backupNow('first-setup');
  assert.equal(first.pruned, 0);
  await S.backupNow('first-setup');
  await S.backupNow('first-setup');
  for (const [name] of old) assert.ok(folderFs()[name], `${name} 被删了`);
  const held = statusOf().held;
  assert.ok(held.length >= 16, `每次最多读 8 份，三次下来应留住两轮以上，实际 ${held.length}`);
  assert.ok(held.every(n => old.some(([o]) => o === n)), 'held 里只有旧谱系的');
});

// 防：判据写得太严 —— 正常删过、改过训练的用户从此不再清理，文件夹一天涨一份
await t('同一谱系每天一份、中途删过（有墓碑）改过：照日历清理，held 为空', async () => {
  soloFolder();
  const deleted = new Map([[21, 'w2'], [14, 'w9'], [7, 'w16']]);
  const files = [];
  let tomb = [];
  for (let d = 30; d >= 1; d--) {
    const at = new Date(Date.now() - d * DAY);
    at.setHours(12, 0, 0, 0);
    if (deleted.has(d)) tomb = [...tomb, deleted.get(d)];
    const ids = Array.from({ length: 31 - d }, (_, i) => `w${i + 1}`).filter(id => !tomb.includes(id));
    const rows = ws(ids).map(w => (w.id === 'w5' && d <= 15 ? { ...w, title: '改过', updatedAt: at.toISOString() } : w));
    files.push([autoName(at), fileText(at, { workouts: rows, tombstones: { workouts: tomb } })]);
  }
  putFiles(files);
  const last = JSON.parse(files.at(-1)[1]).snapshot;
  for (const w of last.workouts) await S.db.save('workouts', w);
  S.writeTombstones({ workouts: tomb });
  for (let i = 0; i < 3; i++) assert.equal((await S.backupNow('manual')).kind, 'ok');
  assert.equal(statusOf().held, undefined);
  const left = Object.keys(folderFs()).map(name => ({ uri: `x/${name}`, name, size: 1, modified: 0 }));
  // 只看放进去的 30 份：这一分钟连写三份会复用被删掉的名字（「X」又排到「X (1)」后面），那几份内容相同，删哪份都不丢
  const mine = new Set(files.map(([name]) => name));
  assert.deepEqual(S.selectBackupsToDelete(left).map(f => f.name).filter(n => mine.has(n)), [], '日历规则该删的都删了');
});

// 防：拆掉本机 lastOkWorkouts 基线时，把「一次删光」这道防线也一起拆了（重装后基线是 0）
await t('内容版缩水保险：候选记录数比新备份多一倍以上，即使都有墓碑也不删', async () => {
  soloFolder();
  const ids = Array.from({ length: 10 }, (_, i) => `w${i}`);
  const earlier = new Date(Date.now() - 2 * 60000);
  putFiles([[autoName(earlier), fileText(earlier, { workouts: ws(ids) })]]);
  for (const w of ws(ids).slice(0, 2)) await S.db.save('workouts', w);
  S.writeTombstones({ workouts: ids.slice(2) });
  assert.equal((await S.backupNow('manual')).kind, 'ok');
  assert.ok(folderFs()[autoName(earlier)]);
  assert.deepEqual(statusOf().held, [autoName(earlier)]);
});

// 防：选文件夹 / 恢复后 / 手动绕过「空就不写」，0 场文件排到恢复列表最前面（C53）
await t('没有任何用户数据：选文件夹、恢复后、手动都不写', async () => {
  soloFolder();
  for (const r of ['first-setup', 'after-restore', 'manual']) {
    const o = await S.backupNow(r);
    assert.deepEqual([o.kind, o.why], ['skipped', 'empty'], r);
  }
  assert.deepEqual(Object.keys(folderFs()), []);
});

const until = async (cond, what) => {
  for (let i = 0; i < 100 && !cond(); i++) await new Promise(r => setTimeout(r, 10));
  assert.ok(cond(), what);
};

// 防：「空」只看训练条数 —— 只记体重 / 围度的用户永远不自动备份（C57）
await t('只有体重 / 围度、0 场训练：每日备份照写，当天更早、内容已覆盖的那份删掉', async () => {
  soloFolder();
  const wl = [1, 2, 3].map(i => ({ id: `wl${i}`, userId: 'u', weight: 80 + i, unit: 'kg', date: iso(i) }));
  for (const r of wl) await S.db.save('weightLogs', r);
  for (const i of [1, 2]) await S.db.save('custom_metrics', { id: `m${i}`, userId: 'u', name: '腰围', value: 80, unit: 'cm', date: iso(i) });
  const earlier = new Date(Date.now() - 2 * 60000);
  putFiles([[autoName(earlier), fileText(earlier, { weightLogs: wl })]]);
  setStatus({ lastOkAt: new Date(Date.now() - 25 * 3600000).toISOString() });
  const before = statusOf().lastOkAt;
  S.maybeDailyBackup();
  await until(() => statusOf().lastOkAt !== before, '要写一份');
  assert.equal(JSON.parse(folderFs()[statusOf().lastOkName].text).snapshot.weightLogs.length, 3);
  assert.equal(folderFs()[autoName(earlier)], undefined, '内容已被覆盖的那份删掉');
});

// 防：指纹手列字段，改一条旧围度的值指纹不变，每日备份当成「没变」跳过（C61 b）
await t('指纹按内容：只改一条旧围度的值，每日备份也写新的一份', async () => {
  soloFolder();
  const m = { id: 'm1', userId: 'u', name: '腰围', value: 80, unit: 'cm', date: iso(30), updatedAt: iso(30) };
  await S.db.save('custom_metrics', m);
  await S.db.save('workouts', SEED[0]);
  assert.equal((await S.backupNow('manual')).kind, 'ok');
  await S.db.save('custom_metrics', { ...m, value: 78, updatedAt: iso(29) });
  setStatus({ ...statusOf(), lastOkAt: new Date(Date.now() - 25 * 3600000).toISOString() });
  const before = statusOf().lastOkAt;
  S.maybeDailyBackup();
  await until(() => statusOf().lastOkAt !== before, '改了值要写');
  assert.equal(JSON.parse(folderFs()[statusOf().lastOkName].text).snapshot.customMetrics[0].value, 78);
});

// 防：上次成功的时刻在未来（时钟调快过又调回）时，每日备份要等到那一刻才恢复（C67 ④）
await t('上次成功在 3 天后：照样按到期写', async () => {
  soloFolder();
  await S.db.save('workouts', SEED[0]);
  setStatus({ lastOkAt: new Date(Date.now() + 3 * DAY).toISOString(), fingerprint: 'x' });
  S.maybeDailyBackup();
  await until(() => Object.keys(folderFs()).length === 1, '要写一份');
});

// 防：同一分钟撞名按名字比 —— 「X (1)」排在「X」前面被当成旧的删掉，「(10)」排在「(2)」前面（C66）
await t('同一分钟撞名：按序号数字比新旧', () => {
  const now = new Date();
  const at = new Date(now.getTime() - 5 * 60000);
  const f = name => ({ uri: name, name, size: 1, modified: 0 });
  const del = files => D.selectBackupsToDelete(files.map(f), now, 'prod').map(x => x.name);
  assert.deepEqual(del([autoName(at), autoName(at, 1)]), [autoName(at)]);
  assert.deepEqual(del([autoName(at, 2), autoName(at, 10)]), [autoName(at, 2)]);
});

// 防：默认项取「名字最新 / 修改时间最新 / 第一份读得出的」—— 空的、时间在未来的、拷贝过的旧导出当了默认（C53 / C66 / C67 / C11）
await t('恢复默认项：跳过空的、未来的、读不出的；按 exportedAt 排；带本机没有的记录的优先；同一分钟序号大的在前', () => {
  const now = Date.now();
  const H = 3600000;
  const e = (k, o) => ({ k, file: { uri: k, name: k, size: 1, modified: 0 }, seq: 0, dev: false, ...o });
  const list = [
    e('empty', { at: now - H, exportedAt: now - H, records: 0 }),
    e('future', { at: now - 5 * H, exportedAt: now + 30 * DAY, records: 5 }),
    e('bad', { at: now - H / 2, bad: true }),
    e('copied', { at: now, exportedAt: now - 3 * DAY, records: 5 }),
    e('same0', { at: now - 2 * DAY, records: 3 }),
    e('same1', { at: now - 2 * DAY, seq: 1, records: 3 }),
    e('real', { at: now - 2 * H, exportedAt: now - 2 * H, records: 6 }),
  ];
  assert.equal(D.pickDefaultBackup(list, now).k, 'real');
  const foreign = list.map(x => (x.k.startsWith('same') ? { ...x, foreign: 2 } : x));
  assert.equal(D.pickDefaultBackup(foreign, now).k, 'same1');
  assert.equal(D.pickDefaultBackup(list.filter(x => ['empty', 'future', 'bad'].includes(x.k)), now).k, 'future');
});

// 防：从别的文件夹恢复一份，悄悄把以后的备份目的地改到那里（C56）；换了文件夹沿用旧的 held / pinned 判定
await t('恢复用的文件夹：已有能用的不改；没权限 / 没设过才换；换文件夹清掉 held / pinned', async () => {
  soloFolder();
  const B = { ...FOLDER, dirUri: 'mock://primary:Download', dirDocId: 'primary:Download' };
  setStatus({ held: ['a.json'], pinned: ['b.json'] });
  assert.equal(await S.adoptRestoreFolder(B), false);
  assert.equal(S.getBackupFolder().dirUri, FOLDER.dirUri);
  assert.equal(await S.adoptRestoreFolder({ ...FOLDER, treeUri: 'mock://tree2' }), true);
  assert.deepEqual([statusOf().held, statusOf().pinned], [['a.json'], ['b.json']], '同一个文件夹不清');
  fault('deny');
  assert.equal(await S.adoptRestoreFolder(B), true);
  fault('');
  assert.equal(S.getBackupFolder().dirUri, B.dirUri);
  assert.deepEqual([statusOf().held, statusOf().pinned], [undefined, undefined]);
  S.storage.removeItem('fitlog_backup_folder');
  assert.equal(await S.adoptRestoreFolder(FOLDER), true);
  assert.equal(S.getBackupFolder().dirUri, FOLDER.dirUri);
});

// 防：读到过期的回滚副本就当场删掉 —— 时钟调快过一次，副本就永远没了（C67 ①）
await t('回滚副本过期只读成没有、不删；时间回到期限内又读得到', async () => {
  const row = { id: 'pre-import', createdAt: iso(8), snapshot: { workouts: [SEED[0]] } };
  await S.db.save('backups', row);
  assert.equal(await S.readRollback(), null);
  assert.equal((await S.db.getAll('backups')).length, 1);
  await S.db.save('backups', { ...row, createdAt: iso(1) });
  assert.equal((await S.readRollback())?.workouts, 1);
});

// 防：手动导出的文件名用 UTC 日期，多伦多晚上 8 点后导出的写成第二天（C66 / datetime#10）
await t('手动导出文件名按本地日期', () => {
  const tz = process.env.TZ;
  process.env.TZ = 'America/Toronto';
  try {
    assert.equal(S.backupFileName(new Date(2026, 10, 23, 20, 30)), 'FitTracker_Backup_2026-11-23.json');
  } finally {
    if (tz === undefined) delete process.env.TZ;
    else process.env.TZ = tz;
  }
});

await t('安卓清单：系统云备份 / 旧版整机备份都排除 WebView 目录（重装不被还原成旧数据，C58）；设备直传不排除', async () => {
  const { readFileSync } = await import('node:fs');
  const main = join(ROOT, 'android/app/src/main');
  const manifest = readFileSync(join(main, 'AndroidManifest.xml'), 'utf8');
  assert.match(manifest, /android:dataExtractionRules="@xml\/data_extraction_rules"/);
  assert.match(manifest, /android:fullBackupContent="@xml\/backup_rules"/);
  const rules = readFileSync(join(main, 'res/xml/data_extraction_rules.xml'), 'utf8');
  assert.match(rules, /<cloud-backup>[\s\S]*<exclude domain="root" path="app_webview\/"\s*\/>[\s\S]*<\/cloud-backup>/);
  assert.doesNotMatch(rules, /<device-transfer>[\s\S]*app_webview/);
  assert.match(readFileSync(join(main, 'res/xml/backup_rules.xml'), 'utf8'), /<exclude domain="root" path="app_webview\/"\s*\/>/);
});

// ── 本机训练数的水位跟着整份改写走（上架审查 C12）──────────────────────
await t('水位：恢复 / 合并 / 重置 / 撤销之后跟着新内容走，丢失标记随恢复成功清掉（不然那次重载会被当成库被清空）', async () => {
  for (const w of SEED) await D.db.save('workouts', w);
  D.LC.recordLocalWorkouts(SEED.length);
  D.storage.setItem('fitlog_local_loss', JSON.stringify({ expected: 4, at: iso(0) }));
  const two = JSON.stringify({ app: 'Fit Tracker', formatVersion: 2, exportedAt: iso(0), snapshot: { schemaVersion: 2, workouts: SEED.slice(0, 2), prefs: {} } });
  await D.applyBackup(D.parseBackupFile(two));
  assert.equal(D.storage.getItem('fitlog_local_workouts'), '2');
  assert.equal(D.LC.readLocalLoss(), null);
  await D.resetAccount();
  assert.equal(D.storage.getItem('fitlog_local_workouts'), '0');
  await D.rollbackImport();
  assert.equal(D.storage.getItem('fitlog_local_workouts'), '2');
});

// ── CSV 导出 ─────────────────────────────────────────────────────────
await t('CSV：BOM + 中文表头、一组一行、重量带单位和 kg 两列', () => {
  const { text, rows } = D.buildWorkoutsCsv(SEED, {
    variantOf: ex => ex.variantName ?? '',
    isCn: true,
    resolveName: x => x,
    bodyPartOf: x => (x === '杠铃平板卧推' ? '胸部' : ''),
    regionsOf: () => '',
    fallbackUnit: 'kg',
  });
  assert.ok(text.startsWith('﻿日期,开始时间,训练时长(分),训练'));
  const lines = text.replace(/^﻿/, '').trim().split('\r\n');
  const sets = SEED.reduce((k, w) => k + w.exercises[0].sets.length, 0);
  assert.equal(rows, sets);
  assert.equal(lines.length, sets + 1);
  assert.ok(lines.some(l => /杠铃平板卧推,,胸部,[^,]*,1,正式,100,kg,100,5/.test(l)), lines.slice(0, 3).join('\n'));
  // 种子没有 startTime：时长列留空，不编一个数
  assert.ok(lines.slice(1).every(l => /^[^,]*,[^,]*,,/.test(l)), lines[1]);
});

await t('CSV：有开始和结束时间的场，每一行都带整场时长（分）', () => {
  const w = seedWorkout('seed_t', 3, 'E2E 时长', '杠铃推举', [[50, 5], [50, 5]]);
  w.startTime = new Date(Date.parse(w.finishedAt) - 52 * 60000 - 30000).toISOString();
  const { text } = D.buildWorkoutsCsv([w], { isCn: true, resolveName: x => x, variantOf: () => '', bodyPartOf: () => '', regionsOf: () => '', fallbackUnit: 'kg' });
  const lines = text.replace(/^﻿/, '').trim().split('\r\n').slice(1);
  assert.equal(lines.length, 2);
  assert.ok(lines.every(l => /^[^,]*,[^,]*,52,E2E 时长,/.test(l)), lines[0]);
});

// 防 C23 读取侧：库里 / 备份里已经分叉的旧记录（编辑时只改了 date，startTime 还在原来那天），CSV 按 date 写日期、排序
await t('CSV：日期 / 开始时间 / 排序跟 date 走，startTime 只用来算时长', () => {
  const moved = seedWorkout('seed_moved', 3, 'E2E 改过日期', '杠铃推举', [[50, 5]]);
  moved.date = new Date(2026, 9, 15, 18, 3, 27).toISOString();
  moved.startTime = new Date(2026, 10, 20, 10, 3, 27).toISOString();
  moved.finishedAt = new Date(2026, 10, 20, 11, 15, 59).toISOString();
  const other = seedWorkout('seed_other', 3, 'E2E 另一场', '杠铃推举', [[50, 5]]);
  other.date = new Date(2026, 10, 19, 18, 0).toISOString();
  const { text } = D.buildWorkoutsCsv([other, moved], { isCn: true, resolveName: x => x, variantOf: () => '', bodyPartOf: () => '', regionsOf: () => '', fallbackUnit: 'kg' });
  const lines = text.replace(/^﻿/, '').trim().split('\r\n').slice(1);
  assert.ok(lines[0].startsWith('2026-10-15,18:03,72,E2E 改过日期,'), lines[0]);
  assert.ok(lines[1].includes('E2E 另一场'), lines[1]);
});

// ── 合并式恢复 ───────────────────────────────────────────────────────
await t('合并恢复：本机删过的（墓碑）不被旧备份捞回来，本机新练的留着', () => {
  const snap = (workouts, tombstones) => ({
    schemaVersion: 2, workouts, goals: [], weightLogs: [], customMetrics: [], prs: [], customExerciseDefsFromDb: [], scheduledWorkouts: [],
    prefs: {}, tombstones,
  });
  const local = snap([...SEED.filter(w => w.id !== 'seed_del'), seedWorkout('local_new', 0, 'E2E 新练的', '杠铃推举', [[50, 5]])], { workouts: ['seed_del'] });
  const backup = snap(SEED, {});
  const ids = D.mergeLocalWithRemote(local, backup).workouts.map(w => w.id).sort();
  assert.deepEqual(ids, ['local_new', 'seed_a', 'seed_b', 'seed_c']);
});

// 防 C79 整项删除漏写墓碑：personal 下次拉取会把服务器上那几条原样合并回来；也防按大小写一起删掉另一项
await t('身体指标整项删除：只删同名的几条、每条记墓碑，服务器那份合并回来也不复活', async () => {
  D.writeTombstones({});
  await D.db.clear('custom_metrics');
  const m = (id, name, value) => ({ id, userId: 'u', name, value, unit: 'cm', date: '2026-11-01T08:00:00.000Z', updatedAt: '2026-11-01T08:00:00.000Z' });
  const rows = [m('a', 'Waist', 80), m('b', 'Waist', 79), m('c', 'waist', 81), m('d', '腰围', 78)];
  for (const r of rows) await D.db.save('custom_metrics', r);
  await D.deleteMetric(rows, 'Waist');
  assert.deepEqual((await D.db.getAll('custom_metrics')).map(r => r.id).sort(), ['c', 'd']);
  assert.deepEqual([...(D.readTombstones().customMetrics ?? [])].sort(), ['a', 'b']);
  const snap = (customMetrics, tombstones) => ({
    schemaVersion: 2, workouts: [], goals: [], weightLogs: [], customMetrics, prs: [], customExerciseDefsFromDb: [], scheduledWorkouts: [],
    prefs: {}, tombstones,
  });
  const merged = D.mergeLocalWithRemote(snap(await D.db.getAll('custom_metrics'), D.readTombstones()), snap(rows, {}));
  assert.deepEqual(merged.customMetrics.map(r => r.id).sort(), ['c', 'd']);
  D.writeTombstones({});
});

const PREFS = (ts, extra = {}) => ({
  customTags: [], customExercises: [], exerciseNotes: {}, starredExercises: {}, exerciseMetricConfigs: {},
  tagRenameOverrides: {}, exerciseOverrides: {}, starredLastUpdateMs: ts, metricsLastUpdateMs: ts, prefsLastUpdateMs: ts,
  avatarDataUrl: null, appPrefsUpdatedMs: ts, ...extra,
});
const tag = (id, name) => ({ id, name, category: 'equipment' });
const def = (id, cn) => ({ id, name: { en: cn, cn }, category: 'STRENGTH', bodyPart: 'chest', tags: [] });
const snapP = (prefs, workouts = []) => ({
  schemaVersion: 2, workouts, goals: [], weightLogs: [], customMetrics: [], prs: [], customExerciseDefsFromDb: [], scheduledWorkouts: [],
  prefs, tombstones: {},
});
// 本机较新（200）：有自己的标签 / 动作 / 备注 / 馆，本机馆卧推的选台清成了墓碑 ''；备份较旧（100）各有各的
const LOCAL_P = PREFS(200, {
  customTags: [tag('t_local', '本机标签'), tag('t_both', '本机改的名')],
  customExercises: [def('x_local', '本机动作')],
  exerciseNotes: { 卧推: '本机备注' },
  tagRenameOverrides: { a: '本机改名' },
  appPrefs: { unit: 'kg', gyms: { 本机馆: { unit: 'kg' } }, gymRigPick: { '本机馆|bench|': '' }, gymOverrides: { '本机馆|bench|': { step: 2.5 } } },
});
const BACKUP_P = PREFS(100, {
  customTags: [tag('t_both', '备份的旧名'), tag('t_backup', '备份标签')],
  customExercises: [def('x_backup', '备份动作')],
  exerciseNotes: { 卧推: '备份旧备注', 深蹲: '备份备注' },
  tagRenameOverrides: { b: '备份改名' },
  appPrefs: { unit: 'lbs', gyms: { 备份馆: { unit: 'lbs' } }, gymRigPick: { '本机馆|bench|': 'rig_old' }, gymOverrides: { '备份馆|squat|': { step: 5 } } },
});

await t('合并恢复（备份）：首选项两边独有的标签 / 动作 / 备注 / 馆都留；同 id / 同键取较新那边；较新的墓碑不被旧备份捞回', async () => {
  // 走真的 mergeBackup：本机写进 localStorage，备份走解析，合并后读回
  D.writePrefsToLocalStorage(LOCAL_P);
  const file = JSON.stringify({ app: 'Fit Tracker', formatVersion: 2, exportedAt: iso(5), snapshot: snapP(BACKUP_P) });
  await D.mergeBackup(D.parseBackupFile(file));
  const m = D.readPrefsFromLocalStorage();
  assert.deepEqual(m.customTags.map(x => `${x.id}:${x.name}`).sort(), ['t_backup:备份标签', 't_both:本机改的名', 't_local:本机标签']);
  assert.deepEqual(m.customExercises.map(x => x.id).sort(), ['x_backup', 'x_local']);
  assert.deepEqual(m.exerciseNotes, { 卧推: '本机备注', 深蹲: '备份备注' });
  assert.deepEqual(m.tagRenameOverrides, { a: '本机改名', b: '备份改名' });
  assert.deepEqual(Object.keys(m.appPrefs.gyms).sort(), ['备份馆', '本机馆']);
  assert.equal(m.appPrefs.gymRigPick['本机馆|bench|'], '', '本机较新的墓碑（回到默认）不能被备份里的旧选台捞回');
  assert.deepEqual(Object.keys(m.appPrefs.gymOverrides).sort(), ['备份馆|squat|', '本机馆|bench|']);
  assert.equal(m.unit, 'kg', '单值照旧取较新的一边');
});

await t('合并恢复（备份）：备份那边较新时，同键冲突以备份为准，本机独有的照样留', () => {
  const m = D.mergeLocalWithRemote(snapP(LOCAL_P), snapP({ ...BACKUP_P, prefsLastUpdateMs: 300, appPrefsUpdatedMs: 300 }), { unionPrefs: true }).prefs;
  assert.deepEqual(m.exerciseNotes, { 卧推: '备份旧备注', 深蹲: '备份备注' });
  assert.equal(m.customTags.find(x => x.id === 't_both').name, '备份的旧名');
  assert.ok(m.customTags.some(x => x.id === 't_local'));
  assert.equal(m.appPrefs.gymRigPick['本机馆|bench|'], 'rig_old');
  assert.deepEqual(Object.keys(m.appPrefs.gymOverrides).sort(), ['备份馆|squat|', '本机馆|bench|']);
});

await t('合并恢复（备份）：本机从没打过时间戳（新装）时，本机没有头像不算删掉，用备份里的那张', () => {
  const m = D.mergeLocalWithRemote(snapP(PREFS(0)), snapP(PREFS(0, { avatarDataUrl: 'data:image/png;base64,AA' })), { unionPrefs: true }).prefs;
  assert.equal(m.avatarDataUrl, 'data:image/png;base64,AA');
});

await t('服务端同步（不带 unionPrefs）：首选项仍整块取较新的一边 —— 旧的一边独有的标签 / 备注 / 一档不并进来', () => {
  const m = D.mergeLocalWithRemote(snapP(LOCAL_P), snapP(BACKUP_P)).prefs;
  assert.deepEqual(m.customTags.map(x => x.id), ['t_local', 't_both']);
  assert.deepEqual(m.exerciseNotes, { 卧推: '本机备注' });
  assert.deepEqual(m.tagRenameOverrides, { a: '本机改名' });
  assert.deepEqual(Object.keys(m.appPrefs.gymOverrides), ['本机馆|bench|']);
});

// ── 重置账户 ─────────────────────────────────────────────────────────
await t('重置：先存回滚槽（重置前的样子），清空并给每条记墓碑；撤销把训练带回来、墓碑摘掉、以本机为准推送', async () => {
  for (const w of SEED) await D.db.save('workouts', w);
  D.writePrefsToLocalStorage(LOCAL_P);
  await D.resetAccount();
  assert.equal((await D.db.getAll('workouts')).length, 0);
  const after = await D.collectLocalSnapshot();
  assert.deepEqual([...after.tombstones.workouts].sort(), SEED.map(w => w.id).sort());
  assert.deepEqual(after.prefs.customTags, []);
  assert.equal((await D.readRollback())?.workouts, SEED.length, '重置前的样子要在回滚槽里');

  await D.rollbackImport();
  assert.deepEqual((await D.db.getAll('workouts')).map(w => w.id).sort(), SEED.map(w => w.id).sort());
  const back = await D.collectLocalSnapshot();
  assert.deepEqual(back.tombstones.workouts ?? [], [], '撤销回来的训练还挂着墓碑，下次合并会被服务器那份墓碑再删一次');
  assert.ok(D.isLocalAuthoritative(), '撤销后要以本机为准推（先推不拉），不然启动拉取把服务器上的墓碑并回来');
  assert.ok(back.prefs.customTags.some(x => x.id === 't_local'));
  assert.equal(await D.readRollback(), null, '回滚槽用掉即清空');
});

/** 换掉内存库的 replaceStores（第 i 次调用由 impl(i, 原方法, ...参数) 决定），fn 跑完换回 */
const withReplace = async (M, impl, fn) => {
  const orig = M.db.replaceStores;
  let i = 0;
  M.db.replaceStores = (...a) => impl(i++, (...b) => orig.apply(M.db, b), ...a);
  try {
    return await fn();
  } finally {
    M.db.replaceStores = orig;
  }
};
/** 快照里比得上的部分（导出时刻每次不同） */
const state = async M => {
  const { clientExportedAt, ...rest } = await M.collectLocalSnapshot();
  return { ...rest, backups: await M.db.getAll('backups') };
};

await t('重置：回滚槽和清空同一个事务，存不进去（配额满）就中止，数据和首选项一条不动', async () => {
  for (const w of SEED) await D.db.save('workouts', w);
  D.writePrefsToLocalStorage(LOCAL_P);
  const before = await state(D);
  await withReplace(D, async () => { throw new Error('quota'); }, () => assert.rejects(D.resetAccount(), e => /quota/.test(e.message) && e.rolledBack === true));
  assert.deepEqual(await state(D), before);
});

// ── 回滚副本不被失败冲掉（上架审查 C54）──────────────────────────────
const backupOf = workouts => JSON.stringify({ app: 'Fit Tracker', formatVersion: 2, exportedAt: iso(0), snapshot: { schemaVersion: 2, workouts, goals: [], weightLogs: [], customMetrics: [], prs: [], scheduledWorkouts: [], customExerciseDefsFromDb: [], prefs: {} } });

await t('恢复失败、已自动换回（提示「数据未改动」）：上一份回滚副本原样留着，撤销还能回到重置之前', async () => {
  await seedDb();
  await D.resetAccount();
  const before = await D.readRollback();
  await withReplace(D, async (i, orig, ...a) => { if (i === 0) throw new Error('quota'); return orig(...a); },
    () => assert.rejects(D.applyBackup(D.parseBackupFile(backupOf(SEED.slice(0, 1)))), e => e.rolledBack === true));
  const after = await D.readRollback();
  assert.equal(after?.workouts, SEED.length, '副本被这次失败的恢复换掉了');
  assert.equal(after.createdAt, before.createdAt);
  assert.equal((await D.db.getAll('workouts')).length, 0);
});

await t('库提交了、写首选项抛错、换回也失败：留新副本（本次操作之前的样子），撤销能回去', async () => {
  await seedDb();
  await D.resetAccount();
  // 第一次（这次恢复）写成后抛「首选项没写成」；第二次（换回去）配额满
  await withReplace(D, async (i, orig, ...a) => {
    if (i > 0) throw new Error('quota');
    await orig(...a);
    throw new D.PrefsWriteError(new Error('ls'));
  }, () => assert.rejects(D.applyBackup(D.parseBackupFile(backupOf(SEED.slice(0, 1)))), e => e.rolledBack === false));
  assert.equal((await D.readRollback())?.workouts, 0);
  await D.rollbackImport();
  assert.equal((await D.db.getAll('workouts')).length, 0);
});

await t('写到一半被杀（C60）：库那一步没提交，7 张表、首选项、墓碑、回滚槽和写之前一模一样', async () => {
  for (const w of SEED) await S.db.save('workouts', w);
  S.writePrefsToLocalStorage(LOCAL_P);
  S.writeTombstones({ workouts: ['gone'] });
  const before = await state(S);
  await withReplace(S, () => new Promise(() => {}), async () => {
    void S.applyBackup(S.parseBackupFile(backupOf(SEED.slice(0, 1))));
    for (let k = 0; k < 20; k++) await new Promise(r => setImmediate(r));
  });
  assert.deepEqual(await state(S), before);
});

await t('写到一半被杀（C60）：库已提交、首选项没写完 —— 启动时照标记行补写，下次启动删掉标记行', async () => {
  S.writePrefsToLocalStorage(LOCAL_P);
  const pending = { id: 'overwrite-pending', token: 'tk1', prefs: PREFS(500, { exerciseNotes: { 卧推: '标记里的' } }), tombstones: { workouts: ['zz'] } };
  await S.db.save('backups', pending);
  await S.finishPendingOverwrite();
  const p = S.readPrefsFromLocalStorage();
  assert.deepEqual(p.exerciseNotes, { 卧推: '标记里的' });
  assert.equal(p.prefsLastUpdateMs, 500);
  assert.deepEqual((await S.collectLocalSnapshot()).tombstones, { workouts: ['zz'] });
  assert.equal((await S.db.getAll('backups')).length, 1, '补写的这次还没确认落盘，行先留着');
  await S.finishPendingOverwrite();
  assert.deepEqual(await S.db.getAll('backups'), []);
});

// ── 单机版的恢复语义（上架审查 C10 那批）：整份改写不记墓碑不刷时间戳、合并不用备份的墓碑 ──
const W = (id, daysAgo = 1, sets = [[100, 5]]) => seedWorkout(id, daysAgo, `E2E ${id}`, '杠铃深蹲', sets);
const ids = async M => (await M.db.getAll('workouts')).map(w => w.id).sort();
const fileNow = async M => JSON.stringify(await M.buildBackupFile());
const putAll = async (M, list) => { for (const w of list) await M.db.save('workouts', w); };

for (const [label, M] of [['单机', S], ['personal', D]]) {
  await t(`合并恢复（${label}）：备份带的墓碑不删本机还在的行、也不落进本机；本机墓碑照样挡住备份的行；如实报新增 / 挡下几场`, async () => {
    await putAll(M, [W('a'), W('n')]);
    M.writeTombstones({ workouts: ['x'] });
    const B1 = await fileNow(M);
    M.db.__reset();
    mem.clear();
    await putAll(M, [W('a'), W('x')]);
    M.writeTombstones({ workouts: ['n'] });
    const r = await M.mergeBackup(M.parseBackupFile(B1));
    assert.deepEqual(await ids(M), ['a', 'x'], 'x 是本机撤销删除救回来的，被备份的墓碑删掉了');
    assert.deepEqual((await M.collectLocalSnapshot()).tombstones.workouts, ['n']);
    assert.equal(r.added, 0);
    assert.equal(r.blocked, 1);
  });
}

await t('单机：存 a b c → 重置 → 记 new1 → 从重置前的备份合并：四场都在，没有墓碑（C10 A）', async () => {
  await putAll(S, [W('a'), W('b'), W('c')]);
  const B0 = await fileNow(S);
  await S.resetAccount();
  await putAll(S, [W('new1', 0)]);
  const r = await S.mergeBackup(S.parseBackupFile(B0));
  assert.deepEqual(await ids(S), ['a', 'b', 'c', 'new1']);
  assert.deepEqual((await S.collectLocalSnapshot()).tombstones.workouts ?? [], []);
  assert.equal(r.added, 3);
});

await t('单机：误用旧备份覆盖后再合并新备份，六场都在；合并 → 撤销 → 再合并结果一样（C10 B）', async () => {
  const six = ['w1', 'w2', 'w3', 'w4', 'w5', 'w6'].map((id, i) => W(id, 10 - i));
  await putAll(S, six);
  const Bnew = S.parseBackupFile(await fileNow(S));
  await S.applyBackup(S.parseBackupFile(backupOf(six.slice(0, 3))));
  await S.mergeBackup(Bnew);
  assert.deepEqual(await ids(S), six.map(w => w.id));
  await S.rollbackImport();
  assert.deepEqual(await ids(S), ['w1', 'w2', 'w3']);
  await S.mergeBackup(Bnew);
  assert.deepEqual(await ids(S), six.map(w => w.id));
});

await t('单机：重置 → 记 new1 → 备份 → 撤销重置 → 合并那份备份：a b c new1 都在（C10 C，原来是空库）', async () => {
  await putAll(S, [W('a'), W('b'), W('c')]);
  await S.resetAccount();
  await putAll(S, [W('new1', 0)]);
  const Bz = await fileNow(S);
  await S.rollbackImport();
  await S.mergeBackup(S.parseBackupFile(Bz));
  assert.deepEqual(await ids(S), ['a', 'b', 'c', 'new1']);
});

const GYM = (plates, cable = { v: 5, u: 'kg' }, plateUnit = 'kg') => ({ plateUnit, plates, cable, machine: { v: 5, u: plateUnit }, dumbbell: { v: 2.5, u: plateUnit } });
await t('单机：覆盖成旧备份后合并新备份，按真实的改动时刻取新 —— 改过的组、备注、片都是新的；反过来合并旧的不退回（gap-1#2）', async () => {
  const t1 = Date.now() - 5 * DAY;
  const w1 = W('w1', 6);
  await putAll(S, [w1]);
  S.writePrefsToLocalStorage(PREFS(t1, { exerciseNotes: { 卧推: '旧备注' }, appPrefs: { gyms: { 铁馆: GYM([20, 10]) } } }));
  const B1 = await fileNow(S);
  const t2 = t1 + DAY;
  await putAll(S, [{ ...W('w1', 6, [[105, 6]]), updatedAt: new Date(t2).toISOString() }, W('w_eve', 0)]);
  S.writePrefsToLocalStorage(PREFS(t2, { exerciseNotes: { 卧推: '新备注' }, appPrefs: { gyms: { 铁馆: GYM([25, 20, 10]) } } }));
  const B2 = await fileNow(S);
  S.db.__reset();
  mem.clear();
  await S.applyBackup(S.parseBackupFile(B1));
  await S.mergeBackup(S.parseBackupFile(B2));
  const check = async () => {
    const w = (await S.db.getAll('workouts')).find(x => x.id === 'w1');
    assert.deepEqual(w.exercises[0].sets.map(s => [s.weight, s.reps]), [[105, 6]]);
    const p = S.readPrefsFromLocalStorage();
    assert.equal(p.exerciseNotes.卧推, '新备注');
    assert.deepEqual(p.appPrefs.gyms.铁馆.plates, [25, 20, 10]);
    assert.deepEqual(await ids(S), ['w1', 'w_eve']);
  };
  await check();
  await S.mergeBackup(S.parseBackupFile(B1));
  await check();
});

await t('单机：本机逐条删过的，合并旧备份不捞回，墓碑照旧（§3.1）', async () => {
  await putAll(S, [W('a'), W('del')]);
  const old = await fileNow(S);
  await S.db.delete('workouts', 'del');
  S.writeTombstones({ workouts: ['del'] });
  const r = await S.mergeBackup(S.parseBackupFile(old));
  assert.deepEqual(await ids(S), ['a']);
  assert.deepEqual((await S.collectLocalSnapshot()).tombstones.workouts, ['del']);
  assert.equal(r.blocked, 1);
});

await t('单机：新装后种下的默认值（默认馆档案、有氧记录项）合并时让给备份里设过的；本机真改过、较新的照旧赢（gap-1#3）', async () => {
  const old = Date.now() - 30 * DAY;
  const ironLbs = GYM([45, 25, 10], { v: 7.5, u: 'lbs', s: 12.5 }, 'lbs');
  const run = ['duration', 'distance', 'speed', 'custom_坡度'];
  const file = JSON.stringify({ app: 'Fit Tracker', formatVersion: 2, exportedAt: iso(30), snapshot: snapP(PREFS(old, { exerciseMetricConfigs: { 跑步机: run }, appPrefs: { gyms: { 铁馆: ironLbs } } })) });
  const now = Date.now();
  S.writePrefsToLocalStorage(PREFS(now, { exerciseMetricConfigs: { 跑步机: ['duration', 'distance'] }, appPrefs: { gyms: { 铁馆: S.defaultProfile('kg') } } }));
  await S.mergeBackup(S.parseBackupFile(file));
  let p = S.readPrefsFromLocalStorage();
  assert.deepEqual(p.appPrefs.gyms.铁馆, ironLbs);
  assert.deepEqual(p.exerciseMetricConfigs.跑步机, run);

  mem.clear();
  S.writePrefsToLocalStorage(PREFS(now, { exerciseMetricConfigs: { 跑步机: ['duration'] }, appPrefs: { gyms: { 铁馆: GYM([25, 20]) } } }));
  await S.mergeBackup(S.parseBackupFile(file));
  p = S.readPrefsFromLocalStorage();
  assert.deepEqual(p.appPrefs.gyms.铁馆.plates, [25, 20]);
  assert.deepEqual(p.exerciseMetricConfigs.跑步机, ['duration']);
});

// 防第 19 批风险 2：导入种子打的是「现在」的时间戳，按较新取会把备份里配好的记录项盖掉；本机原有的配置不能被标成自动的
await t('单机：导入写下的记录项种子记成自动的，之后合并旧备份时让给备份里配过的；本机原有的配置照旧按较新', async () => {
  const old = Date.now() - 30 * DAY;
  const file = JSON.stringify({
    app: 'Fit Tracker', formatVersion: 2, exportedAt: iso(30),
    snapshot: snapP(PREFS(old, { exerciseMetricConfigs: { 平板支撑: ['weight', 'duration'], 卧推: ['weight', 'reps', 'custom_x'] } })),
  });
  S.writePrefsToLocalStorage(PREFS(old + DAY, { exerciseMetricConfigs: { 卧推: ['weight', 'reps'] } }));
  await S.addImportedRecords({ source: 'hevy', workouts: [W('imp_auto', 20)], newDefs: [], metricSeeds: { 平板支撑: ['duration'], 卧推: ['reps'] } }, 'skip');
  let p = S.readPrefsFromLocalStorage();
  assert.deepEqual(p.metricAutoKeys, ['平板支撑']);
  assert.deepEqual(p.exerciseMetricConfigs.卧推, ['weight', 'reps']);
  await S.mergeBackup(S.parseBackupFile(file));
  p = S.readPrefsFromLocalStorage();
  assert.deepEqual(p.exerciseMetricConfigs.平板支撑, ['weight', 'duration']);
  assert.deepEqual(p.exerciseMetricConfigs.卧推, ['weight', 'reps']);
  assert.deepEqual(p.metricAutoKeys, []);
});

await t('合并时两边各一条同名自建动作：归成 id 较老的那条，做法、本馆设置、特别关注跟过去，不建同名做法；本机原有的重名不碰（C34）', async () => {
  const NAME = '测试臀桥';
  const v1 = { id: 'v1', name: '窄距' };
  const goal = { id: 'g1', type: 'strength', title: '臀桥', startDate: iso(9), currentValue: 0, targetValue: 100, unit: 'kg', autoUpdateRule: { sourceType: 'workouts', calculation: 'max', exerciseName: '1000|v1' } };
  const file = JSON.stringify({
    app: 'Fit Tracker', formatVersion: 2, exportedAt: iso(3),
    snapshot: { ...snapP(PREFS(100, { customExercises: [{ ...def('1000', NAME), variants: [v1] }], appPrefs: { gymKinds: { '铁馆|1000|v1': 'pin' }, featuredLifts: ['1000|v1'] } })), goals: [goal] },
  });
  S.writePrefsToLocalStorage(PREFS(200, { customExercises: [def('2000', NAME)], appPrefs: { gymNotes: { '铁馆|2000|': '本机备注' }, featuredLifts: ['2000|'] } }));
  await S.mergeBackup(S.parseBackupFile(file));
  const p = S.readPrefsFromLocalStorage();
  assert.equal(S.buildNameIndex(S.DEFAULT_EXERCISES, p.customExercises, p.exerciseOverrides).get(NAME).id, '1000');
  assert.equal(p.exerciseOverrides['2000'].mergedInto, '1000');
  const keep = p.customExercises.find(d => d.id === '1000');
  assert.ok(!(keep.variants ?? []).some(v => v.name === NAME), '不该建出同名做法');
  assert.deepEqual(p.appPrefs.gymNotes, { '铁馆|1000|': '本机备注' });
  // 特别关注整块取较新的一边（本机），里面指向本机那条的键换到留下的那条
  assert.deepEqual(p.appPrefs.featuredLifts, ['1000|']);
  assert.equal((await S.db.getAll('goals'))[0].autoUpdateRule.exerciseName, '1000|v1');

  mem.clear();
  S.db.__reset();
  S.writePrefsToLocalStorage(PREFS(200, { customExercises: [def('3000', '悍马卧推'), def('3001', '悍马卧推')] }));
  await S.mergeBackup(S.parseBackupFile(JSON.stringify({ app: 'Fit Tracker', formatVersion: 2, exportedAt: iso(3), snapshot: snapP(PREFS(100)) })));
  assert.deepEqual(S.readPrefsFromLocalStorage().exerciseOverrides, {});

  // 从动作库删掉的（只打 hidden，定义还在）不参与配对：否则较老的已删那条赢，正在用的被藏，两条都看不见
  for (const [bk, loc, gone] of [['4000', '5000', '4000'], ['6000', '5500', '5500']]) {
    mem.clear();
    S.db.__reset();
    const hid = (id) => (id === gone ? { exerciseOverrides: { [id]: { hidden: true } } } : {});
    S.writePrefsToLocalStorage(PREFS(200, { customExercises: [def(loc, '删过的臀桥')], ...hid(loc) }));
    await S.mergeBackup(S.parseBackupFile(JSON.stringify({ app: 'Fit Tracker', formatVersion: 2, exportedAt: iso(3), snapshot: snapP(PREFS(100, { customExercises: [def(bk, '删过的臀桥')], ...hid(bk) })) })));
    const o = S.readPrefsFromLocalStorage().exerciseOverrides;
    const using = gone === bk ? loc : bk;
    assert.ok(!o[using]?.hidden && !o[using]?.mergedInto, `正在用的 ${using} 不该被藏`);
    assert.ok(!o[gone]?.mergedInto, `已删的 ${gone} 不该被配对`);
  }
});

await t('撤销导入：之后补记的旧日期训练算进「会丢」，进行中那场不算、撤销后保留这期间记的组、回滚槽清掉（C62）', async () => {
  const live1 = W('w_live', 0, [[100, 5]]);
  await putAll(S, [live1]);
  await S.addImportedRecords({ source: 'strong', workouts: [W('imp', 20)], newDefs: [], metricSeeds: {} }, 'skip');
  const live3 = { ...live1, exercises: [{ ...live1.exercises[0], sets: [[100, 5], [100, 5], [100, 5]].map(([weight, reps], i) => ({ id: `l${i}`, weight, reps })) }] };
  await putAll(S, [live3]);
  await putAll(S, [{ ...W('w_back', 3), id: `w_back_${Date.now()}`, createdAt: iso(0), updatedAt: iso(0) }]);
  assert.equal((await S.readRollback('w_live')).newer, 1);
  await S.rollbackImport(live3);
  const ws = await S.db.getAll('workouts');
  assert.deepEqual(ws.map(w => w.id), ['w_live']);
  assert.equal(ws[0].exercises[0].sets.length, 3);
  assert.equal(await S.readRollback(), null);
});

await t('本机有没有数据按各表数：只有体重 / 只有馆也算有；只有语言单位和种下的记录项算空（C68）', () => {
  const has = s => Object.values(S.localDataSummary(s)).some(n => n > 0);
  assert.equal(has({ ...snapP(PREFS(0)), weightLogs: [{ id: 'b1', weight: 70, date: iso(1) }] }), true);
  assert.equal(has(snapP(PREFS(0, { appPrefs: { gyms: { 铁馆: GYM([20]) } } }))), true);
  assert.equal(has(snapP(PREFS(0, { appPrefs: { lang: 'cn', unit: 'kg', gyms: { 旧名: '' } }, exerciseMetricConfigs: { 跑步机: ['duration', 'distance'] } }))), false);
});

// ── 备份文件夹里带 BOM 的文件（上架审查 C65）─────────────────────────
await t('备份文件夹里被外部工具存成带 BOM 的 .json 照样读得出', async () => {
  useMockFolder();
  const { uri } = await D.folderWriteText(FOLDER, 'FitTracker_auto_x.json', '﻿' + backupOf(SEED));
  const text = await D.folderReadText(uri);
  assert.equal(D.parseBackupFile(text).counts.workouts, SEED.length);
});

// ── 启动迁移碰到坏行不抛（上架审查 gap-r3-2#2）──────────────────────
await t('启动迁移：缺 exerciseTime 的照补，坏行（日期解析不了、exercises 缺失或不是数组）原样跳过，不抛', async () => {
  const ok = { ...SEED[0], exercises: SEED[0].exercises.map(({ exerciseTime: _t, ...e }) => e) };
  const bad = [
    { id: 'bad_date', userId: 'u_solo', date: 'not-a-date', exercises: [{ id: 'x', name: '深蹲', sets: [] }] },
    { id: 'bad_empty', userId: 'u_solo', date: '', exercises: [{ id: 'y', name: '深蹲', sets: [] }] },
    { id: 'bad_none', userId: 'u_solo', date: iso(1) },
    { id: 'bad_null', userId: 'u_solo', date: iso(1), exercises: null },
  ];
  for (const w of [ok, ...bad]) await D.db.save('workouts', w);
  await D.migrateLocalData();
  const rows = new Map((await D.db.getAll('workouts')).map(w => [w.id, w]));
  assert.equal(rows.get(ok.id).exercises[0].exerciseTime, new Date(ok.date).toISOString());
  for (const b of bad) assert.deepEqual(rows.get(b.id), b);
});

// 防 scale-perf#1：单机版启动只在迁移写过库时才重读，迁移把「写过」报成没写，界面就停在迁移前的数据直到下次启动
await t('启动迁移：写过库返回 true、库里已改好；再跑一次没东西可改返回 false、库不变', async () => {
  const noTime = { ...SEED[0], id: 'w_notime', exercises: SEED[0].exercises.map(({ exerciseTime: _t, ...e }) => e) };
  const other = { ...SEED[1], id: 'w_other', userId: 'u_someone_else' };
  for (const w of [noTime, other]) await D.db.save('workouts', w);
  assert.equal(await D.migrateRecordsToSoloUserId(), true);
  assert.equal(await D.migrateLocalData(), true);
  const after = new Map((await D.db.getAll('workouts')).map(w => [w.id, w]));
  assert.equal(after.get('w_other').userId, 'u_solo');
  assert.ok(after.get('w_notime').exercises.every(e => e.exerciseTime));
  assert.equal(await D.migrateRecordsToSoloUserId(), false);
  assert.equal(await D.migrateLocalData(), false);
  assert.deepEqual(new Map((await D.db.getAll('workouts')).map(w => [w.id, w])), after);
});

// ── Strong / Hevy 导入 ───────────────────────────────────────────────
const STRONG_ANDROID = `Date;Workout Name;Duration;Exercise Name;Set Order;Weight;Reps;Distance;Seconds;Notes;Workout Notes;RPE
2024-03-14 18:05:12;Push;1h 5m;Bench Press (Barbell);W;135;10;0;0;;;
2024-03-14 18:05:12;Push;1h 5m;Bench Press (Barbell);1;225;5;0;0;;;8
2024-03-14 18:05:12;Push;1h 5m;Bench Press (Barbell);D;185;8;0;0;;;
2024-03-14 18:05:12;Push;1h 5m;Bench Press (Barbell);Rest Timer;0;0;0;90;;;
2024-03-16 09:00:00;Legs;45m;Squat (Barbell);1;315;3;0;0;;;
2024-03-16 09:00:00;Legs;45m;Strong Only Machine;F;50;12;0;0;;;
`;
const HEVY = `"title","start_time","end_time","description","exercise_title","superset_id","exercise_notes","set_index","set_type","weight_lbs","reps","distance_miles","duration_seconds","rpe"
"Upper","18 Oct 2025, 08:47","18 Oct 2025, 09:50","","Bench Press (Barbell)","","",0,"normal",185,5,,,
`;
/** defs / findByName 和导入弹窗同一套接法（importLookup）：合覆盖层，名字索引认自建动作和并入别名 */
const importOpts = (plan, customs = [], overrides = {}) => {
  const look = D.importLookup(customs, overrides);
  return {
    unitByExercise: Object.fromEntries(plan.exercises.filter(e => e.needsUnit).map(e => [e.srcName, 'lbs'])),
    includeWarmups: false,
    overCap: 'skip',
    isCn: true,
    userId: 'u_solo',
    defs: look.defs,
    findByName: look.findByName,
  };
};
/** 一场 Hevy 训练，每个名字一组（kg） */
const hevyOf = names =>
  `"title","start_time","end_time","description","exercise_title","superset_id","exercise_notes","set_index","set_type","weight_kg","reps","distance_km","duration_seconds","rpe"\n` +
  names.map((n, i) => `"Day","18 Oct 2025, 08:47","18 Oct 2025, 09:50","","${n}","","",${i},"normal",40,8,,,`).join('\n') +
  '\n';
const importAs = (names, customs, overrides) => {
  const plan = D.parseImportCsv(hevyOf(names));
  return D.materialize(plan, importOpts(plan, customs, overrides));
};
const recs = r => r.workouts.flatMap(w => w.exercises);

await t('Strong：文件没写单位要问；按 lb 导入 225 → 102.06 kg、热身组默认不导、递减组挂在下面、认不出的动作新建自定义', () => {
  const plan = D.parseImportCsv(STRONG_ANDROID);
  assert.equal(plan.fileUnit, null);
  assert.ok(plan.exercises.some(e => e.needsUnit));
  const r = D.materialize(plan, importOpts(plan));
  assert.equal(r.workouts.length, 2);
  const bench = r.workouts.flatMap(w => w.exercises).find(e => e.name === '杠铃平板卧推');
  assert.ok(bench, 'Bench Press (Barbell) should map to the built-in 杠铃平板卧推');
  assert.equal(bench.sets.length, 1);
  assert.ok(Math.abs(bench.sets[0].weight - 102.058) < 0.01);
  assert.equal(bench.sets[0].plateUnit, 'lbs');
  assert.equal(bench.sets[0].subSets?.length, 1);
  assert.ok(r.newDefs.some(d => d.name.en === 'Strong Only Machine'));
});

await t('Strong：同一份文件再导一次（iOS 的逗号版）训练 id 不变 —— 只覆盖、不翻倍', () => {
  const ids = csv => {
    const plan = D.parseImportCsv(csv);
    return D.materialize(plan, importOpts(plan)).workouts.map(w => w.id).sort();
  };
  const a = ids(STRONG_ANDROID);
  assert.deepEqual(ids(STRONG_ANDROID.replace(/;/g, ',')), a);
  assert.ok(a.every(id => id.startsWith('imp_strong_')));
});

await t('Hevy：单位来自文件（weight_lbs）不问；185 lb → 83.91 kg', () => {
  const plan = D.parseImportCsv(HEVY);
  assert.equal(plan.fileUnit, 'lbs');
  const w = D.materialize(plan, importOpts(plan)).workouts[0];
  assert.ok(w.id.startsWith('imp_hevy_'));
  assert.ok(Math.abs(w.exercises[0].sets[0].weight - 83.91) < 0.01);
});

// 防：名字只留 a-z0-9 时非拉丁文字整段剥成空串，全并进同样剥空的中文曾用名「杠铃上斜卧推」。
// 后三个是对照：中文曾用名 / 英文名照旧认得；标点删而不是换空格（换了 Farmers Walk 就对不上 Farmer's Walk）
await t('导入：非拉丁文字的动作名各自新建，不再并进上斜杠铃卧推；中文曾用名和英文名照旧认得', () => {
  const r = importAs(['悍马卧推', 'Жим лёжа', 'ベンチプレス', '🔥🔥', '杠铃上斜卧推', 'Bench Press (Barbell)', 'Farmers Walk']);
  assert.deepEqual(recs(r).map(e => e.name), ['悍马卧推', 'Жим лёжа', 'ベンチプレス', '🔥🔥', '上斜杠铃卧推', '杠铃平板卧推', '农夫行走']);
  assert.deepEqual(r.newDefs.map(d => d.name.en), ['悍马卧推', 'Жим лёжа', 'ベンチプレス', '🔥🔥']);
});

// 防：剥到只剩器材词（「卧推 (Barbell)」→ barbell）也拿去比，第二次导入时新名字被第一次建的自建动作吞掉。
// 只放宽字符集、不加守卫的半截修法，💪 (Barbell) 会并进 🔥 (Barbell)
await t('导入：第二次导入时已有的自建动作不吞新名字，同名的认回自己', () => {
  const first = importAs(['卧推 (Barbell)', '🔥 (Barbell)']);
  const customs = [
    ...first.newDefs,
    { id: '1700000000001', name: { en: '史密斯 Squat', cn: '史密斯 Squat' }, bodyPart: 'subLegs', tags: [], category: 'STRENGTH' },
  ];
  const r = importAs(['架上拉 (Barbell)', '💪 (Barbell)', 'Squat', '卧推 (Barbell)'], customs);
  assert.deepEqual(recs(r).map(e => e.name), ['架上拉 (Barbell)', '💪 (Barbell)', 'Squat', '卧推 (Barbell)']);
  assert.deepEqual(r.newDefs.map(d => d.name.en), ['架上拉 (Barbell)', '💪 (Barbell)', 'Squat']);
});

// 防：手工表只给动作 id、不看括号里的器材 —— 器械提踵落到自重的标准做法（画成自重 +80）、
// 哑铃牧师凳弯举进了杠铃那条纪录线；以及 materialize 没把做法写到记录上
await t('导入：带器材后缀的名字记到同器材的做法，动作没有这个做法就新建', () => {
  const r = importAs(['Calf Raise (Machine)', 'Standing Calf Raise (Machine)', 'Preacher Curl (Dumbbell)', 'Preacher Curl (Barbell)']);
  const pick = e => ({ name: e.name, variantId: e.variantId });
  assert.deepEqual(recs(r).map(pick), [
    { name: '提踵', variantId: 'eq_machine' },
    { name: '提踵', variantId: 'eq_machine' },
    { name: 'Preacher Curl (Dumbbell)', variantId: undefined },
    { name: '牧师凳弯举', variantId: undefined },
  ]);
  assert.deepEqual(r.newDefs.map(d => d.name.en), ['Preacher Curl (Dumbbell)']);
});

// 防真机测试：Hevy 的「Pull Up」「Romanian Deadlift (Dumbbell)」认不出、每次导入都新建自定义动作；
// 内置英文名不带器材词（Hack Squat、Close-Grip Bench Press）时带括号的名字整串比不上。后三个是对照：器材 / 动作对不上的照旧新建
// （辅助引体的重量是辅助量，记到加重引体上会变成 +40）
await t('导入：Hevy / Strong 常见名认回内置动作（引体、哑铃罗马尼亚硬拉落到哑铃做法、去掉括号器材再比）；对不上的照旧新建', () => {
  const r = importAs([
    'Pull Up', 'Romanian Deadlift (Dumbbell)', 'Hack Squat (Machine)', 'Bench Press - Close Grip (Barbell)', 'Arnold Press (Dumbbell)',
    'Triceps Rope Pushdown', 'Chest Fly (Dumbbell)', 'Bench Press (Smith Machine)', 'Skullcrusher (Dumbbell)', 'Ab Wheel',
    'Deadlift (Dumbbell)', 'Pull Up (Assisted)', 'Sumo Deadlift (Barbell)',
  ]);
  assert.deepEqual(recs(r).map(e => [e.name, e.variantId]), [
    ['加重引体向上', undefined], ['罗马尼亚硬拉', 'eq_db'], ['哈克深蹲', undefined], ['窄距杠铃卧推', undefined], ['阿诺德推举', undefined],
    ['肱三头肌下压', undefined], ['哑铃飞鸟', undefined], ['史密斯平板卧推', undefined], ['仰卧臂屈伸', 'eq_db'], ['健腹轮', undefined],
    ['Deadlift (Dumbbell)', undefined], ['Pull Up (Assisted)', undefined], ['Sumo Deadlift (Barbell)', undefined],
  ]);
  assert.deepEqual(r.newDefs.map(d => d.name.en), ['Deadlift (Dumbbell)', 'Pull Up (Assisted)', 'Sumo Deadlift (Barbell)']);
});

// 防：做法写死成内置的 eq_machine、或弹窗拿没合覆盖层的动作表 —— 用户删掉的做法还往上记、
// 用户早先自建的同器材做法（combineVariants 认成同一个）记不上
await t('导入：做法按合上覆盖层后的做法表认 —— 删掉的不记、自建的同器材做法认它', () => {
  const removed = importAs(['Calf Raise (Machine)'], [], { calf_raise: { variants: [], removedVariants: ['eq_machine'] } });
  assert.deepEqual(recs(removed).map(e => [e.name, e.variantId]), [['Calf Raise (Machine)', undefined]]);
  assert.deepEqual(removed.newDefs.map(d => d.name.en), ['Calf Raise (Machine)']);
  const own = importAs(['Calf Raise (Machine)'], [], { calf_raise: { variants: [{ id: 'v_1', name: '固定器械' }] } });
  assert.deepEqual(recs(own).map(e => [e.name, e.variantId, e.variantName]), [['提踵', 'v_1', '固定器械']]);
});

await t('启动迁移 userId：读整表的时候不压住撤销日志，这段时间里用户的改动照样能撤（上架审查 C19）', async () => {
  const J = D.undoJournal;
  J.clear();
  await D.db.save('workouts', { id: 'w_solo', userId: 'u_solo', exercises: [] });
  const getAll = D.db.getAll;
  let open;
  const gate = new Promise(r => (open = r));
  D.db.getAll = async n => (await gate, getAll.call(D.db, n));
  try {
    const mig = D.migrateRecordsToSoloUserId();
    await new Promise(r => setTimeout(r));
    J.beginStep('改单位');
    D.storage.setItem('fitlog_unit', 'lbs');
    await new Promise(r => setTimeout(r));
    assert.equal(J.getState().canUndo, true);
    open();
    await mig;
  } finally {
    D.db.getAll = getAll;
    J.clear();
  }
});

// ── 馆改名一次写完、被杀了能续（services/gymRename.ts，上架审查 C49）──────────
// 原来首选项和每场训练各写各的、中间没有「进行中」标记：被杀就停在「档案叫新名字、一部分训练还叫旧名字」
const RENAME_KEY = 'fitlog_gym_renames';
const gymRow = (id, gym) => ({ id, userId: 'u_solo', date: iso(1), title: id, gym, exercises: [] });
const gymsOf = async () => new Map((await D.db.getAll('workouts')).map(w => [w.id, w.gym]));

await t('馆改名续完：标记还在、首选项已挪 —— 库里还叫 A 的整批改成 C（半截已改的不重写），B 不动，标记摘掉；再跑一次什么都不写', async () => {
  const profile = D.defaultProfile('kg');
  D.writeAppPrefs({ gyms: { A: '', C: profile } }, 1);
  D.storage.setItem(RENAME_KEY, JSON.stringify([{ from: 'A', to: 'C', profile }]));
  for (const [id, gym] of [['a1', 'A'], ['a2', 'A'], ['a3', 'C'], ['b1', 'B']]) await D.db.save('workouts', gymRow(id, gym));
  assert.equal(await D.resumeGymRenames(), 1);
  assert.deepEqual([...(await gymsOf())].sort(), [['a1', 'C'], ['a2', 'C'], ['a3', 'C'], ['b1', 'B']]);
  assert.equal(D.db.saveManyCalls, 1, '剩下的两场一个事务写完');
  assert.equal(D.storage.getItem(RENAME_KEY), null);
  assert.equal(await D.resumeGymRenames(), 0);
  assert.equal(D.db.saveManyCalls, 1, '幂等：第二次不再写库');
});

await t('馆改名续完：只记下了标记、首选项还没挪 —— 补一次挪档案和器械设置（A 留墓碑、A|… 的键挪到 C|…）', async () => {
  const profile = { ...D.defaultProfile('kg'), dumbbell: { v: 2, u: 'kg' } };
  D.writeAppPrefs({ gyms: { A: D.defaultProfile('kg') }, gymOverrides: { 'A|器械推肩|': { v: 4, u: 'kg' } } }, 1);
  D.storage.setItem(RENAME_KEY, JSON.stringify([{ from: 'A', to: 'C', profile }]));
  await D.db.save('workouts', gymRow('a1', 'A'));
  await D.resumeGymRenames();
  const p = D.readAppPrefs().appPrefs;
  assert.equal(p.gyms.A, '');
  assert.deepEqual(p.gyms.C, profile);
  assert.deepEqual(p.gymOverrides, { 'C|器械推肩|': { v: 4, u: 'kg' } });
  assert.equal((await gymsOf()).get('a1'), 'C');
});

await t('馆改名写库：整批写失败一场都不改、标记留着下次续；改名只调一次整批写，工作台上那场（skipId）不在里面', async () => {
  const profile = D.defaultProfile('kg');
  D.writeAppPrefs({ gyms: { A: '', C: profile } }, 1);
  D.storage.setItem(RENAME_KEY, JSON.stringify([{ from: 'A', to: 'C', profile }]));
  for (const id of ['a1', 'a2', 'live']) await D.db.save('workouts', gymRow(id, 'A'));
  const saveMany = D.db.saveMany;
  D.db.saveMany = async () => {
    throw new Error('QuotaExceededError');
  };
  try {
    await assert.rejects(D.resumeGymRenames(), /QuotaExceededError/);
  } finally {
    D.db.saveMany = saveMany;
  }
  assert.deepEqual([...(await gymsOf()).values()], ['A', 'A', 'A']);
  assert.equal(JSON.parse(D.storage.getItem(RENAME_KEY)).length, 1);
  // 前一次失败不卡住后面的改名链
  let rows;
  D.db.saveMany = async (n, r) => {
    rows = r;
    return saveMany.call(D.db, n, r);
  };
  try {
    assert.equal(await D.renameGymRows('A', 'C', 'live'), 2);
  } finally {
    D.db.saveMany = saveMany;
  }
  assert.deepEqual(rows.map(w => w.id).sort(), ['a1', 'a2']);
  assert.equal((await gymsOf()).get('live'), 'A');
});

await t('馆连着改名、前一次写库失败：A→B 标记还挂着时改 B→C，库里还叫 A 的也改成 C，两条标记一起摘；后来又改的 C→A 不被顺手摘', async () => {
  const profile = D.defaultProfile('kg');
  D.writeAppPrefs({ gyms: { A: '', B: '', C: profile } }, 1);
  D.storage.setItem(RENAME_KEY, JSON.stringify([{ from: 'A', to: 'B', profile }, { from: 'B', to: 'C', profile }, { from: 'C', to: 'A', profile }]));
  for (const [id, gym] of [['a1', 'A'], ['b1', 'B'], ['x1', 'X']]) await D.db.save('workouts', gymRow(id, gym));
  assert.equal(await D.renameGymRows('B', 'C'), 2);
  D.unmarkGymRename({ from: 'B', to: 'C' });
  assert.deepEqual([...(await gymsOf())].sort(), [['a1', 'C'], ['b1', 'C'], ['x1', 'X']]);
  assert.deepEqual(
    JSON.parse(D.storage.getItem(RENAME_KEY)).map(m => `${m.from}→${m.to}`),
    ['C→A'],
  );
});

// 防：改名后几百毫秒内被杀，localStorage 的首选项和标记没落盘、库里训练却已改名（真机复现）——靠和训练同事务写进库的标记补回首选项
await t('馆改名：事务提交后 localStorage 整批没落盘 —— 下次启动按库里的标记补回首选项；再下次确认落盘后清掉标记，不再重做', async () => {
  const profile = { ...D.defaultProfile('kg'), dumbbell: { v: 2, u: 'kg' } };
  D.writeAppPrefs({ gyms: { A: D.defaultProfile('kg') } }, 1);
  const before = { ...Object.fromEntries(Object.entries({ ...localStorage })) };
  await D.db.save('workouts', gymRow('a1', 'A'));
  D.markGymRename({ from: 'A', to: 'C', profile });
  D.writeAppPrefs({ gyms: { A: '', C: profile } }, 2);
  await D.renameGymRows('A', 'C');
  D.unmarkGymRename({ from: 'A', to: 'C' });
  localStorage.clear();
  for (const [k, v] of Object.entries(before)) localStorage.setItem(k, v);
  assert.equal(await D.resumeGymRenames(), 1);
  const p = D.readAppPrefs().appPrefs;
  assert.equal(p.gyms.A, '');
  assert.deepEqual(p.gyms.C, profile);
  assert.equal((await gymsOf()).get('a1'), 'C');
  assert.equal(await D.resumeGymRenames(), 0);
  assert.deepEqual(await D.db.getAll('backups'), []);
});

// 防 C33#6：并入之后再导同一份文件，按完整名字解析会把已导入的记录名改写成目标名（落进标准）、或另建一个重复动作
await t('CSV 导入：并入之后再导同一份 Strong 文件，记录名和第一次相同、落在并入做法上，不另建动作', () => {
  const csv = `Date;Workout Name;Duration;Exercise Name;Set Order;Weight;Reps;Distance;Seconds;Notes;Workout Notes;RPE
2024-03-14 18:05:12;Pull;1h;Chin Up;1;0;10;0;0;;;
2024-03-14 18:05:12;Pull;1h;Incline Bench Press (Dumbbell);1;30;10;0;0;;;
`;
  const plan = D.parseImportCsv(csv);
  const r1 = D.materialize(plan, importOpts(plan));
  const names1 = recs(r1).map(e => e.name);
  assert.deepEqual(names1, ['Chin Up', '上斜哑铃卧推']);
  const customs = r1.newDefs;
  const pull = customs.find(d => d.name.en === 'Chin Up').id;
  // 用户把 Chin Up 并进加重引体向上、上斜哑铃卧推并进哑铃卧推
  let st = { customs, overrides: {} };
  st = D.planMerge(D.DEFAULT_EXERCISES, st, pull, 'pu_weighted', { lang: 'cn', named: l => l ?? [], newId: 'v_m1' }).state;
  st = D.planMerge(D.DEFAULT_EXERCISES, st, 'bp_incline_dumbbell', 'bp_dumbbell', { lang: 'cn', named: l => l ?? [], newId: 'v_m2' }).state;
  const r2 = D.materialize(plan, importOpts(plan, st.customs, st.overrides));
  assert.equal(r2.workouts[0].id, r1.workouts[0].id);
  assert.deepEqual(recs(r2).map(e => e.name), names1);
  assert.deepEqual(r2.newDefs, []);
  // 读的时候照样经名字索引 + 别名落到并入做法上
  const idx = D.buildNameIndex(D.DEFAULT_EXERCISES, st.customs, st.overrides);
  const landed = recs(r2).map(e => {
    const d = idx.get(e.name);
    const aliases = st.overrides[d.id]?.variantAliases ?? d.variantAliases ?? {};
    return [d.id, aliases[e.name]];
  });
  assert.deepEqual(landed, [['pu_weighted', 'v_m1'], ['bp_dumbbell', 'v_m2']]);
});

// 防 C33 csv#10：CSV 的做法列直接读记录上存的 variantName —— 并入前的记录（没有 variantName）是空的，做法改过名的写旧名
await t('CSV 导出：做法列按 variantOf 写（并入前的记录写并入做法名、做法改过名的写现名）', () => {
  const w = seedWorkout('seed_v', 2, 'E2E 做法', '窄距高位下拉', [[45, 10]]);
  w.exercises.push({ ...w.exercises[0], id: 'seed_v_2', name: '高位下拉', variantId: 'v1', variantName: '宽握' });
  const now = { 窄距高位下拉: '窄距', v1: '宽距' };
  const { text } = D.buildWorkoutsCsv([w], {
    isCn: true,
    resolveName: x => (x === '窄距高位下拉' ? '高位下拉' : x),
    variantOf: ex => now[ex.variantId ?? ex.name] ?? '',
    bodyPartOf: () => '',
    regionsOf: () => '',
    fallbackUnit: 'kg',
  });
  const variantCol = text.replace(/^﻿/, '').trim().split('\r\n').slice(1).map(l => l.split(',')[6]);
  assert.deepEqual(variantCol, ['窄距', '宽距']);
});

// 防 csv#2 / gap-5#7 导入端：对上内置动作时不写记录项，平板支撑的时长、跑步机的距离被按重量 × 次数 / 首选项现算藏掉
await t('CSV 导入：对上内置的计时 / 距离 / 有氧动作写记录项，正好重量 × 次数的力量动作不写', () => {
  const H = `"title","start_time","end_time","description","exercise_title","superset_id","exercise_notes","set_index","set_type","weight_lbs","reps","distance_miles","duration_seconds","rpe"\n`;
  const row = (n, i, w, r, d, s) => `"Day","18 Oct 2025, 08:47","18 Oct 2025, 09:50","","${n}","","",${i},"normal",${w},${r},${d},${s},`;
  const csv =
    H +
    [
      row('Plank', 0, '', '', '', 60),
      row('Treadmill', 0, '', '', 3.23, 1800),
      row('Jump Rope', 0, '', 200, '', ''),
      row('Farmers Walk', 0, 88, '', 0.03, 30),
      row('Yoga', 0, '', '', '', 1800),
      row('Rowing Machine', 0, 143, 12, '', ''),
      row('Bench Press (Barbell)', 0, 185, 5, '', ''),
    ].join('\n') +
    '\n';
  const plan = D.parseImportCsv(csv);
  const r = D.materialize(plan, importOpts(plan));
  assert.deepEqual(r.newDefs.map(d => d.name.en), [], '都应对上内置动作');
  assert.deepEqual({ ...r.metricSeeds }, {
    平板支撑: ['duration'],
    跑步机: ['distance', 'duration'],
    跳绳: ['reps'],
    农夫行走: ['weight', 'distance', 'duration'],
    瑜伽: ['duration'],
    划船机: ['weight', 'reps'],
  });
});

// 防 csv#2：新动作的类型和种子只看第一场 —— 第二场带了重量也被建成有氧、看不到重量
await t('CSV 导入：新动作按整份文件定类型和记录项（第一场只有时长、第二场带重量 → 力量 + 重量 / 时长）', () => {
  const H = `"title","start_time","end_time","description","exercise_title","superset_id","exercise_notes","set_index","set_type","weight_kg","reps","distance_km","duration_seconds","rpe"\n`;
  const csv =
    H +
    `"A","18 Oct 2025, 08:47","18 Oct 2025, 09:50","","Dead Hang","","",0,"normal",,,,45,\n` +
    `"B","20 Oct 2025, 08:47","20 Oct 2025, 09:50","","Dead Hang","","",0,"normal",10,,,30,\n`;
  const plan = D.parseImportCsv(csv);
  const r = D.materialize(plan, importOpts(plan));
  const def = r.newDefs.find(d => d.name.en === 'Dead Hang');
  assert.ok(def, 'Dead Hang 应新建');
  assert.equal(def.category, 'STRENGTH');
  assert.deepEqual(r.metricSeeds['Dead Hang'], ['weight', 'duration']);
});

// 防：另一种语言下的原键配置被导入种子盖掉；导入把本机按重量 × 次数记过的列藏掉
await t('CSV 导入种子：显示名已配置的丢掉，本机有记录没配置的取当前那组和种子的并集，其余原样', () => {
  const out = D.mergeImportSeeds(
    // 英文界面导入，种子键是 Plank；本机是在中文名下配置的
    { Plank: ['duration'], 农夫行走: ['distance', 'duration'], 跑步机: ['distance', 'duration'] },
    {
      resolveName: n => (n === 'Plank' ? '平板支撑' : n),
      // 按显示名归并过的配置（原键是 'Plank'）
      configs: { 平板支撑: ['weight', 'reps'] },
      recorded: new Set(['农夫行走']),
      activeOf: () => ['weight', 'reps'],
    },
  );
  assert.deepEqual({ ...out }, { 农夫行走: ['weight', 'reps', 'distance', 'duration'], 跑步机: ['distance', 'duration'] });
});

// ── CSV 导入解析从严、报账、重叠（第 28 批审查：csv#3–#8、gap-4#6、C69）────────────────
const SH = 'Date,Workout Name,Duration,Exercise Name,Set Order,Weight,Reps,Distance,Seconds,Notes,Workout Notes,RPE';
/** 一行 Strong（逗号版）：日期、标题、动作、组序、重量、次数 */
const srow = (date, title, ex, order, w, r) => `${date},${title},1h,${ex},${order},${w},${r},0,0,,,`;
const strongOf = rows => `${SH}\n${rows.join('\n')}\n`;
const HH = '"title","start_time","end_time","description","exercise_title","superset_id","exercise_notes","set_index","set_type","weight_kg","reps","distance_km","duration_seconds","rpe"';
const hrow = (title, start, ex, ss, type, w, r) => `"${title}","${start}","","","${ex}","${ss}","",0,"${type}",${w},${r},,,`;
const hevyRows = rows => `${HH}\n${rows.join('\n')}\n`;
const mat = (plan, over = {}) => D.materialize(plan, { ...importOpts(plan), ...over });

// 防 csv#6：new Date 兜底把 01/03 读成 1 月 3 日、13 号以后整行丢；PM 读成上午
await t('CSV 导入日期：日 / 月文件 28 场全进、首尾是 3 月 1 日和 28 日；美式 PM、Hevy 的 PM 读成下午', () => {
  const days = Array.from({ length: 28 }, (_, i) => srow(`${String(i + 1).padStart(2, '0')}/03/2024 18:00`, `D${i + 1}`, 'Squat (Barbell)', 1, 100, 5));
  const plan = D.parseImportCsv(strongOf(days));
  assert.equal(plan.workouts.length, 28);
  const first = plan.workouts[0].start;
  const last = plan.workouts[27].start;
  assert.deepEqual([first.getMonth(), first.getDate(), last.getMonth(), last.getDate()], [2, 1, 2, 28]);
  assert.equal(plan.dateOrderGuessed, null);
  assert.equal(D.parseImportCsv(strongOf([srow('3/14/2024 6:05 PM', 'A', 'Squat (Barbell)', 1, 100, 5)])).workouts[0].start.getHours(), 18);
  assert.equal(D.parseImportCsv(hevyRows([hrow('A', '18 Oct 2025, 8:47 PM', 'Squat (Barbell)', '', 'normal', 100, 5)])).workouts[0].start.getHours(), 20);
  // 德式 / 荷式写法
  const de = D.parseImportCsv(strongOf([srow('14.03.2024 18:00', 'A', 'Squat (Barbell)', 1, 100, 5), srow('14-3-2024 19:00', 'B', 'Squat (Barbell)', 1, 100, 5)]));
  assert.deepEqual(de.workouts.map(w => [w.start.getMonth(), w.start.getDate(), w.start.getHours()]), [[2, 14, 18], [2, 14, 19]]);
});

// 防 csv#6：认不出的日期被兜底成 2000 / 2001 年的两场，或整行悄悄没了、确认页不知道
await t('CSV 导入报账：日期认不出的行不进来、计数；整份都认不出时报 bad-dates', () => {
  const plan = D.parseImportCsv(
    strongOf([
      srow('2024-03-14 18:05:12', 'A', 'Squat (Barbell)', 1, 100, 5),
      srow('2024-03-16 09:00:00', 'B', 'Squat (Barbell)', 1, 100, 5),
      srow('0', 'C', 'Squat (Barbell)', 1, 100, 5),
      srow('Squat 1', 'D', 'Squat (Barbell)', 1, 100, 5),
      srow('"18 Okt 2025, 08:47"', 'E', 'Squat (Barbell)', 1, 100, 5),
      srow('31/02/2024 18:00', 'F', 'Squat (Barbell)', 1, 100, 5),
    ]),
  );
  assert.equal(plan.workouts.length, 2);
  assert.equal(plan.skipped.date, 4);
  assert.throws(() => D.parseImportCsv(strongOf([srow('0', 'C', 'Squat (Barbell)', 1, 100, 5)])), e => e.code === 'bad-dates');
  // 少了动作名、多出有字的列：算格式不对
  const bad = D.parseImportCsv(strongOf([srow('2024-03-14 18:05:12', 'A', 'Squat (Barbell)', 1, 100, 5), srow('2024-03-14 18:05:12', 'A', '', 1, 100, 5), srow('2024-03-14 18:05:12', 'A', 'Squat (Barbell)', 1, 100, 5) + ',x']));
  assert.equal(bad.skipped.malformed, 2);
});

// 防 csv#6：字段中间一个没转义的引号开始引用、吞掉后面几场；收尾规则改坏合法的 "" 转义和多行备注
await t('CSV 导入引号：没转义的引号当字面字符、10 场全进；"" 转义和带换行的引用字段照常', () => {
  const ten = title => strongOf(Array.from({ length: 10 }, (_, i) => srow(`2024-03-${String(i + 1).padStart(2, '0')} 18:00:00`, i === 3 ? title : `D${i}`, 'Squat (Barbell)', 1, 100, 5)));
  const a = D.parseImportCsv(ten('Push "heavy day'));
  assert.equal(a.workouts.length, 10);
  assert.equal(a.workouts[3].title, 'Push "heavy day');
  const b = D.parseImportCsv(ten('"Push "heavy" day"'));
  assert.equal(b.workouts.length, 10);
  assert.equal(b.workouts[3].title, 'Push "heavy" day');
  const c = D.parseImportCsv(`${SH}\n2024-03-01 18:00:00,"Say ""hi""",1h,Squat (Barbell),1,100,5,0,0,,"line 1\nline 2",\n`);
  assert.equal(c.workouts[0].title, 'Say "hi"');
  assert.equal(c.workouts[0].notes, 'line 1\nline 2');
});

// 防 csv#6：分隔符只看第一行，文件开头空一行的分号文件整份认不出
await t('CSV 导入分隔符：开头空一行的分号 Strong 文件照样认得', () => {
  assert.equal(D.parseImportCsv('\n' + STRONG_ANDROID).workouts.length, 2);
});

// 防 csv#7：Number() 兜底把 1,000 读成 1、0x10 读成 16、1e3 读成 1000、「100 kg」丢掉；负次数、小数次数原样入库；1 后面多按几个 0 也照导
await t('CSV 导入数字：千分位按整份文件的小数符号读，0x10 / 1e3 / 「100 kg」不认并计数，次数取整不为负，超上限的组默认不导', () => {
  const comma = D.parseImportCsv(strongOf([srow('2024-03-01 18:00:00', 'A', 'Squat (Barbell)', 1, '"1,000"', 1), srow('2024-03-02 18:00:00', 'B', 'Squat (Barbell)', 1, 22.5, 5)]));
  assert.equal(comma.workouts[0].exercises[0].sets[0].weight, 1000);
  const semi = D.parseImportCsv(STRONG_ANDROID.split('\n')[0] + '\n2024-03-14 18:05:12;Push;1h;Squat (Barbell);1;1.000,5;1;0;0;;;\n');
  assert.equal(semi.workouts[0].exercises[0].sets[0].weight, 1000.5);
  const junk = D.parseImportCsv(
    strongOf([
      srow('2024-03-01 18:00:00', 'A', 'Squat (Barbell)', 1, '0x10', 5),
      srow('2024-03-01 18:00:00', 'A', 'Squat (Barbell)', 2, '1e3', 5),
      srow('2024-03-01 18:00:00', 'A', 'Squat (Barbell)', 3, '100 kg', 5),
      srow('2024-03-01 18:00:00', 'A', 'Squat (Barbell)', 4, 100, -3),
      srow('2024-03-01 18:00:00', 'A', 'Squat (Barbell)', 5, 100, 5.5),
      srow('2024-03-01 18:00:00', 'A', 'Squat (Barbell)', 6, 99999, 1),
    ]),
  );
  assert.equal(junk.skipped.numbers, 3);
  const plan = { ...junk, fileUnit: 'kg' };
  const sets = mat(plan).workouts[0].exercises[0].sets;
  assert.deepEqual(sets.map(s => [s.weight, s.reps]), [[0, 5], [0, 5], [0, 5], [100, 0], [100, 6]]);
  const r = mat(plan, { overCap: 'keep' });
  assert.equal(r.overCapSets, 1);
  assert.equal(r.workouts[0].exercises[0].sets.length, 6);
  assert.equal(mat(plan).overCapSets, 1);
});

// 防 csv#4 / csv#3：「日期原文 + 标题」的 32 位哈希撞号（两场成了同一个 id、互相覆盖）；来源改了标题、Excel 换了日期写法就成了另一场
await t('CSV 导入 id：按文件里的开始时间到分钟，不撞号、改标题和换日期写法都不变；同一分钟两场各有 id', () => {
  const ids = csv => D.parseImportCsv(csv).workouts.map(w => w.id);
  const [a, b] = ids(strongOf([srow('2020-04-29 19:12:53', 'Morning Workout', 'Squat (Barbell)', 1, 100, 5), srow('2022-12-10 20:01:54', 'Evening Workout', 'Squat (Barbell)', 1, 100, 5)]));
  assert.notEqual(a, b);
  const twin = strongOf([srow('2024-03-14 18:05:12', 'Push', 'Squat (Barbell)', 1, 100, 5), srow('2024-03-14 18:05:40', 'Pull', 'Squat (Barbell)', 1, 100, 5)]);
  const t1 = ids(twin);
  assert.equal(new Set(t1).size, 2);
  assert.deepEqual(ids(twin), t1);
  assert.deepEqual(ids(strongOf([srow('2024-03-14 18:05:12', 'Push (renamed)', 'Squat (Barbell)', 1, 100, 5)])), [t1[0]]);
  assert.deepEqual(ids(strongOf([srow('3/14/2024 18:05', 'Push', 'Squat (Barbell)', 1, 100, 5)])), [t1[0]]);
});

// 防 csv#3：再导一次无条件覆盖 App 里改过的场；来源改过标题的那场翻倍；用户删掉的导入训练被捞回来
await t('CSV 导入重叠：默认保留 fitlog 里改过的、不翻倍、删过的不回来；选覆盖才换成文件里的、旧 id 一并删', async () => {
  const day = (d, title) => srow(`2024-03-0${d} 18:00:00`, title, 'Squat (Barbell)', 1, 100, 5);
  const write = async (rows, mode) => {
    const plan = D.parseImportCsv(strongOf(rows));
    await S.addImportedRecords(mat(plan), mode);
  };
  const A = [day(1, 'A1'), day(2, 'A2'), day(3, 'A3')];
  await write(A, 'skip');
  const all = async () => (await S.db.getAll('workouts')).sort((x, y) => x.startTime.localeCompare(y.startTime));
  const [w1] = await all();
  const edited = { ...w1, title: '改过', notes: '我的备注', exercises: [{ ...w1.exercises[0], sets: [{ ...w1.exercises[0].sets[0], weight: 100, reps: 12 }] }] };
  await S.db.save('workouts', edited);
  // 旧版 32 位 id、和 A2 同一开始时间的一场
  const [, w2] = await all();
  await S.db.save('workouts', { ...w2, id: 'imp_strong_1ea6psa' });
  await S.db.delete('workouts', w2.id);
  const A2 = [day(1, 'A1'), day(2, 'A2 renamed'), day(3, 'A3'), day(4, 'A4')];
  const plan = D.parseImportCsv(strongOf(A2));
  const local = { workouts: await S.db.getAll('workouts'), tombstonedIds: [] };
  assert.equal(D.planImportWrite(mat(plan).workouts, local, 'strong', 'skip').overlap, 3);
  await write(A2, 'skip');
  let rows = await all();
  assert.equal(rows.length, 4);
  assert.deepEqual([rows[0].title, rows[0].notes, rows[0].exercises[0].sets[0].reps], ['改过', '我的备注', 12]);
  assert.equal(rows[1].id, 'imp_strong_1ea6psa');
  await write(A2, 'replace');
  rows = await all();
  assert.equal(rows.length, 4);
  assert.equal(new Set(rows.map(w => w.startTime)).size, 4);
  assert.deepEqual([rows[0].title, rows[0].exercises[0].sets[0].reps], ['A1', 5]);
  assert.ok(!rows.some(w => w.id === 'imp_strong_1ea6psa'));
  // 删掉一场导入的训练（墓碑）：'skip' 再导不回来
  await S.db.delete('workouts', rows[3].id);
  S.writeTombstones({ workouts: [rows[3].id] });
  await write(A2, 'skip');
  assert.equal((await all()).length, 3);
});

// 防 C69：确认页和写入口径不一致 —— 只有热身组的动作也新建成空动作；一场都没有还照样整库改写
await t('CSV 导入 C69：只有热身组的动作不建定义、不种记录项，预览不列；一场都没有时 write 为空', () => {
  const only = D.parseImportCsv(strongOf([srow('2024-03-01 18:00:00', 'A', 'Warm Only Lift', 'W', 20, 10)]));
  const r0 = mat(only);
  assert.equal(r0.workouts.length, 0);
  assert.deepEqual(r0.newDefs, []);
  assert.deepEqual(D.planImportWrite(r0.workouts, { workouts: [], tombstonedIds: [] }, 'strong', 'skip').write, []);
  const two = D.parseImportCsv(
    strongOf([srow('2024-03-01 18:00:00', 'A', 'Squat (Barbell)', 1, 100, 5), srow('2024-03-01 18:00:00', 'A', 'Warm Two', 'W', 20, 10), srow('2024-03-02 18:00:00', 'B', 'Warm Only Lift', 'W', 20, 10)]),
  );
  const r = mat(two);
  assert.equal(r.workouts.length, 1);
  assert.deepEqual(r.newDefs.map(d => d.name.en), []);
  assert.ok(!('Warm Two' in r.metricSeeds) && !('Warm Only Lift' in r.metricSeeds));
  const look = D.importLookup([], {});
  assert.deepEqual(D.previewMatches(two, look.defs, look.findByName, false).map(e => e.srcName), ['Squat (Barbell)']);
  assert.equal(D.previewMatches(two, look.defs, look.findByName, true).length, 3);
});

// 防 csv#5：有 Weight Unit 列也当没写单位去问；kg / lb 混着的动作按原值比「最重」，135 lb 压过 100 kg
await t('CSV 导入单位：Weight Unit 列全是 lbs 时整份按 lb；kg / lb 混着时按 kg 比最重、带上它的单位', () => {
  const H = 'Date,Workout Name,Duration,Exercise Name,Set Order,Weight,Weight Unit,Reps';
  const lbs = D.parseImportCsv(`${H}\n2024-03-01 18:00:00,A,1h,Squat (Barbell),1,225,lbs,5\n2024-03-01 18:00:00,A,1h,Squat (Barbell),2,0,,5\n`);
  assert.equal(lbs.fileUnit, 'lbs');
  const mixed = D.parseImportCsv(`${H}\n2024-03-01 18:00:00,A,1h,Squat (Barbell),1,100,kg,5\n2024-03-02 18:00:00,B,1h,Squat (Barbell),1,135,lbs,5\n`);
  assert.equal(mixed.fileUnit, null);
  const s = mixed.exercises[0];
  assert.deepEqual([s.maxWeight, s.maxUnit], [100, 'kg']);
});

// 防 csv#8：Distance (meters) 不认、距离丢掉；Distance (miles) 被当成米；认不出的单位悄悄按米导
await t('CSV 导入距离：表头 (meters) / (miles) 按单位换算，认不出的单位整列不导、列进 ignoredColumns', () => {
  const run = (h, v) => D.parseImportCsv(`Date,Workout Name,Exercise Name,Set Order,${h},Seconds\n2024-03-01 18:00:00,A,Running,1,${v},1800\n`);
  const m = run('Distance (meters)', 5000);
  const set = mat(m).workouts[0].exercises[0].sets[0];
  assert.deepEqual([set.distance, set.distanceUnit], [5, 'km']);
  assert.ok(Math.abs(run('Distance (miles)', 3.1).workouts[0].exercises[0].sets[0].distanceKm - 4.989) < 0.001);
  const yd = run('Distance (yd)', 100);
  assert.equal(yd.workouts[0].exercises[0].sets[0].distanceKm, null);
  assert.deepEqual(yd.ignoredColumns, ['Distance (yd)']);
});

// 防 gap-4#6：Hevy 的 superset_id 不读，超级组导进来拆成单个动作；各场的 superset_id 0 串成同一组
await t('CSV 导入超级组：Hevy 同一 superset_id 的动作成交替组、挨着放，组 id 每场不同；只剩一个成员的、同名一块组一块单做的不成组', () => {
  const S1 = '18 Oct 2025, 08:47';
  const S2 = '20 Oct 2025, 08:47';
  const plan = D.parseImportCsv(
    hevyRows([
      hrow('A', S1, 'Bench Press (Barbell)', 0, 'normal', 60, 8),
      hrow('A', S1, 'Lat Pulldown (Cable)', '', 'normal', 40, 10),
      hrow('A', S1, 'Incline Bench Press (Dumbbell)', 0, 'normal', 20, 10),
      hrow('A', S1, 'Bench Press (Barbell)', 0, 'normal', 60, 8),
      hrow('A', S1, 'Incline Bench Press (Dumbbell)', 0, 'normal', 20, 10),
      hrow('B', S2, 'Bench Press (Barbell)', 0, 'normal', 60, 8),
      hrow('B', S2, 'Incline Bench Press (Dumbbell)', 0, 'normal', 20, 10),
    ]),
  );
  const [a, b] = mat(plan).workouts;
  assert.deepEqual(a.exercises.map(e => e.altGroup ?? null), [`${a.id}_ss0`, `${a.id}_ss0`, null]);
  assert.notEqual(b.exercises[0].altGroup, a.exercises[0].altGroup);
  assert.equal(b.exercises[0].altGroup, b.exercises[1].altGroup);
  // 一个成员只有热身组、被跳过：剩下的那个不成组
  const warm = D.parseImportCsv(hevyRows([hrow('A', S1, 'Bench Press (Barbell)', 0, 'normal', 60, 8), hrow('A', S1, 'Incline Bench Press (Dumbbell)', 0, 'warmup', 20, 10)]));
  assert.equal(mat(warm).workouts[0].exercises[0].altGroup, undefined);
  // 同名动作一块在超级组里、一块单做：不成组
  const mixed = D.parseImportCsv(
    hevyRows([hrow('A', S1, 'Bench Press (Barbell)', 0, 'normal', 60, 8), hrow('A', S1, 'Incline Bench Press (Dumbbell)', 0, 'normal', 20, 10), hrow('A', S1, 'Bench Press (Barbell)', '', 'normal', 60, 8)]),
  );
  assert.deepEqual(mat(mixed).workouts[0].exercises.map(e => e.altGroup), [undefined, undefined]);
});

// 防 C70：文字格以 = + - @ 开头时被表格软件当公式算；德语区域的 Excel 不按逗号分列、把 22.5 读成日期 / 文本
await t('CSV 导出：公式符号开头的文字加单引号、数值不加；系统区域用逗号当小数点时按分号分隔、小数写逗号', () => {
  const w = { ...seedWorkout('seed_f', 2, '=1+1', '杠铃深蹲', [[22.5, 5]]), gym: '@home', notes: '- 左肩不舒服; 下次轻点' };
  w.exercises.push({ id: 'seed_f_2', name: '辅助引体向上', sets: [{ id: 'a1', weight: 20, reps: 8, bodyweightMode: 'assisted' }] });
  const h = { isCn: true, resolveName: x => x, variantOf: () => '+宽握', bodyPartOf: () => '', regionsOf: () => '', fallbackUnit: 'kg' };
  const lines = D.buildWorkoutsCsv([w], { ...h, decimalComma: false }).text.replace(/^﻿/, '').trim().split('\r\n');
  const row = lines[1].split(',');
  assert.deepEqual([row[3], row[4], row[6]], ["'=1+1", "'@home", "'+宽握"]);
  assert.ok(lines[1].endsWith(`"'- 左肩不舒服; 下次轻点"`) || lines[1].endsWith(`'- 左肩不舒服; 下次轻点`));
  const assisted = lines[2].split(',');
  assert.deepEqual([assisted[11], assisted[13]], ['-20', '-20']);
  const de = D.buildWorkoutsCsv([w], { ...h, decimalComma: true }).text.replace(/^﻿/, '').trim().split('\r\n');
  assert.equal(de[0].split(';').length, 20);
  const deRow = de[1].split(';');
  assert.deepEqual([deRow[11], deRow[13]], ['22,5', '22,5']);
  assert.ok(de[1].endsWith(`"'- 左肩不舒服; 下次轻点"`));
});

console.log(`\ndata-check: ${n} passed`);
