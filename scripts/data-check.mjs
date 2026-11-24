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
    b.onResolve({ filter: /^\.(\/services)?\/db$/ }, () => ({ path: 'db', namespace: 'stub' }));
    b.onLoad({ filter: /^capacitor$/, namespace: 'stub' }, () => ({
      contents: `export const Capacitor = { isNativePlatform: () => false, getPlatform: () => 'web' };
        export const registerPlugin = () => new Proxy({}, { get: () => () => { throw new Error('native plugin used in data-check'); } });`,
      loader: 'js',
    }));
    // 内存版 IndexedDB：每个 store 一张 id → 行的表
    b.onLoad({ filter: /^db$/, namespace: 'stub' }, () => ({
      contents: `const stores = new Map();
        const s = n => { if (!stores.has(n)) stores.set(n, new Map()); return stores.get(n); };
        export const db = {
          async init() {}, async reopen() {},
          async getAll(n) { return [...s(n).values()].map(x => structuredClone(x)); },
          async save(n, x) { s(n).set(x.id, structuredClone(x)); },
          async upsert(n, x) { s(n).set(x.id, structuredClone(x)); },
          async delete(n, id) { s(n).delete(id); },
          async clear(n) { s(n).clear(); },
          // 多表一个事务：同步写完，要么全写要么（抛在写之前）全不写；挂起 / 抛错由用例替换这个方法注入
          async replaceStores(replace, extra = {}) {
            for (const [n, rows] of replace) { s(n).clear(); for (const x of rows) s(n).set(x.id, structuredClone(x)); }
            for (const [n, x] of extra.put ?? []) s(n).set(x.id, structuredClone(x));
            for (const [n, id] of extra.del ?? []) s(n).delete(id);
          },
          __reset() { stores.clear(); },
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
      "export { parseImportCsv, materialize, importDefs } from './services/fitlogCsvImport.ts';",
      "export { mergeLocalWithRemote, collectLocalSnapshot, readPrefsFromLocalStorage, writePrefsToLocalStorage } from './services/fitlogRemote.ts';",
      "export { applyBackup, mergeBackup, parseBackupFile, resetAccount, readRollback, rollbackImport, addImportedRecords, buildBackupFile, finishPendingOverwrite, localDataSummary } from './services/fitlogBackup.ts';",
      "export { PrefsWriteError } from './services/fitlogRemote.ts';",
      "export { writeTombstones } from './services/fitlogTombstones.ts';",
      "export { defaultProfile } from './src/utils/loadable.ts';",
      "export { readText as folderReadText, writeText as folderWriteText } from './services/fitlogFolder.ts';",
      "export { migrateLocalData } from './services/fitlogRemote.ts';",
      "export * as LC from './services/localCensus.ts';",
      "export { storage } from './services/appStorage.ts';",
      "export { isLocalAuthoritative } from './services/fitlogRemoteSync.ts';",
      "export { db } from './services/db';",
      "export { DEFAULT_EXERCISES } from './src/constants/exercises.ts';",
      "export { buildNameIndex } from './src/utils/nameIndex.ts';",
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
  const { text } = D.buildWorkoutsCsv([w], { isCn: true, resolveName: x => x, bodyPartOf: () => '', regionsOf: () => '', fallbackUnit: 'kg' });
  const lines = text.replace(/^﻿/, '').trim().split('\r\n').slice(1);
  assert.equal(lines.length, 2);
  assert.ok(lines.every(l => /^[^,]*,[^,]*,52,E2E 时长,/.test(l)), lines[0]);
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
});

await t('撤销导入：之后补记的旧日期训练算进「会丢」，进行中那场不算、撤销后保留这期间记的组、回滚槽清掉（C62）', async () => {
  const live1 = W('w_live', 0, [[100, 5]]);
  await putAll(S, [live1]);
  await S.addImportedRecords({ workouts: [W('imp', 20)], newDefs: [], metricSeeds: {} });
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
/** defs / findByName 和导入弹窗同一套接法：importDefs 合覆盖层，名字索引认自建动作 */
const importOpts = (plan, customs = [], overrides = {}) => {
  const idx = D.buildNameIndex(D.DEFAULT_EXERCISES, customs, overrides);
  return {
    unitByExercise: Object.fromEntries(plan.exercises.filter(e => e.needsUnit).map(e => [e.srcName, 'lbs'])),
    includeWarmups: false,
    isCn: true,
    userId: 'u_solo',
    defs: D.importDefs(customs, overrides),
    findByName: name => idx.get(name.trim()),
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

// 防：做法写死成内置的 eq_machine、或弹窗拿没合覆盖层的动作表 —— 用户删掉的做法还往上记、
// 用户早先自建的同器材做法（combineVariants 认成同一个）记不上
await t('导入：做法按合上覆盖层后的做法表认 —— 删掉的不记、自建的同器材做法认它', () => {
  const removed = importAs(['Calf Raise (Machine)'], [], { calf_raise: { variants: [], removedVariants: ['eq_machine'] } });
  assert.deepEqual(recs(removed).map(e => [e.name, e.variantId]), [['Calf Raise (Machine)', undefined]]);
  assert.deepEqual(removed.newDefs.map(d => d.name.en), ['Calf Raise (Machine)']);
  const own = importAs(['Calf Raise (Machine)'], [], { calf_raise: { variants: [{ id: 'v_1', name: '固定器械' }] } });
  assert.deepEqual(recs(own).map(e => [e.name, e.variantId, e.variantName]), [['提踵', 'v_1', '固定器械']]);
});

console.log(`\ndata-check: ${n} passed`);
