#!/usr/bin/env node
/**
 * 数据安全的自检（docs/design-backup.md）：自动备份的保留规则 / 读回核对 / 写坏和没权限算失败、
 * CSV 导出、合并式恢复不捞回删过的、Strong / Hevy 导入（单位、热身组、递减组、重复导入不翻倍）。
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
const out = join(dir, 'data.mjs');

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
          async replaceAll(n, rows) { s(n).clear(); for (const x of rows) s(n).set(x.id, structuredClone(x)); },
          __reset() { stores.clear(); },
        };`,
      loader: 'js',
    }));
  },
};

await build({
  stdin: {
    contents: [
      "export * from './services/fitlogAutoBackup.ts';",
      "export { buildWorkoutsCsv } from './services/fitlogCsvExport.ts';",
      "export { parseImportCsv, materialize } from './services/fitlogCsvImport.ts';",
      "export { mergeLocalWithRemote } from './services/fitlogRemote.ts';",
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
  outfile: out,
  logLevel: 'silent',
  plugins: [stubs],
  define: { 'import.meta.env': '{}' },
});

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

const D = await import(pathToFileURL(out).href);
rmSync(dir, { recursive: true, force: true });

let n = 0;
const t = async (name, fn) => {
  mem.clear();
  D.db.__reset();
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

// ── CSV 导出 ─────────────────────────────────────────────────────────
await t('CSV：BOM + 中文表头、一组一行、重量带单位和 kg 两列', () => {
  const { text, rows } = D.buildWorkoutsCsv(SEED, {
    isCn: true,
    resolveName: x => x,
    bodyPartOf: x => (x === '杠铃平板卧推' ? '胸部' : ''),
    regionsOf: () => '',
    fallbackUnit: 'kg',
  });
  assert.ok(text.startsWith('﻿日期,开始时间,训练'));
  const lines = text.replace(/^﻿/, '').trim().split('\r\n');
  const sets = SEED.reduce((k, w) => k + w.exercises[0].sets.length, 0);
  assert.equal(rows, sets);
  assert.equal(lines.length, sets + 1);
  assert.ok(lines.some(l => /杠铃平板卧推,,胸部,[^,]*,1,正式,100,kg,100,5/.test(l)), lines.slice(0, 3).join('\n'));
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
const importOpts = plan => {
  const idx = D.buildNameIndex(D.DEFAULT_EXERCISES, [], {});
  return {
    unitByExercise: Object.fromEntries(plan.exercises.filter(e => e.needsUnit).map(e => [e.srcName, 'lbs'])),
    includeWarmups: false,
    isCn: true,
    userId: 'u_solo',
    defs: D.DEFAULT_EXERCISES,
    findByName: name => idx.get(name.trim()),
  };
};

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

console.log(`\ndata-check: ${n} passed`);
