// 数据安全的 e2e：自动备份（选文件夹 → 写 → 读回核对 → 清理）、重装恢复、合并 + 墓碑、
// CSV 导出、Strong / Hevy 导入。设计见 docs/design-backup.md。
//
// 浏览器里没有安卓的文件夹授权，services/fitlogFolder.ts 带了一个 mock：
// localStorage `fitlog_mock_folder` = '1' 打开，文件存在裸 localStorage `fitlog_mock_folder_fs`，
// `fitlog_mock_folder_fault` 注入故障（corrupt-write / deny / cancel）。
// 「卸载」= 清掉除 mock 文件夹以外的 localStorage + 删掉 IndexedDB —— 公共目录里的文件卸载后还在，正是这个形状。
//
// 每条盯的是状态（mock 里的文件、库里的条数和重量），不只是提示文案：
// 「提示备份成功」本身就是这个项目踩过的假信号。
//
// 跑法：
//   整套 e2e（npm run e2e / node scripts/e2e-smoke.mjs）里已经包含这一套：和带夹具的场景并行，共用一个浏览器、各开各的 context。
//   单独跑：E2E_BASE=http://localhost:3100 node scripts/e2e-backup.mjs（默认 http://localhost:3000），E2E_ONLY 同样适用。
// 这一套是一条链：每步接着上一步留下的文件夹 / 库，挑一步跑会带上它前面的所有步骤（BACKUP_STEPS）。

import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { parseOnly, planSuite, enterStep, describeSelection, printSlowest } from './e2e-plan.mjs';

const BASE = (process.env.E2E_BASE || 'http://localhost:3000').replace(/\/$/, '');
const OUT = path.resolve('test-artifacts', 'backup');

/** 依赖表：一条链（规则见 e2e-plan.mjs） */
export const BACKUP_STEPS = [
  ['pure-retention', []],
  ['seed-and-setup-prompt'],
  ['status-in-prefs'],
  ['verify-failure-not-success'],
  ['retention-in-folder'],
  ['csv-to-folder'],
  ['uninstall-then-restore'],
  ['merge-respects-tombstones'],
  ['strong-import-asks-units'],
  ['strong-reimport-no-dup-and-hevy-unit'],
];

const iso = daysAgo => new Date(Date.now() - daysAgo * 86400000).toISOString();
function seedWorkout(id, daysAgo, title, exName, sets) {
  const at = iso(daysAgo);
  return {
    id,
    userId: 'u_solo',
    date: at,
    title,
    status: 'completed',
    finishedAt: at,
    updatedAt: at,
    exercises: [{ id: `${id}_ex`, name: exName, category: 'STRENGTH', sets: sets.map(([weight, reps], i) => ({ id: `${id}_s${i}`, weight, reps })) }],
  };
}
const SEED = [
  seedWorkout('seed_a', 10, 'E2E 推', '杠铃平板卧推', [[100, 5], [100, 5]]),
  seedWorkout('seed_b', 7, 'E2E 腿', '杠铃深蹲', [[140, 3]]),
  seedWorkout('seed_c', 3, 'E2E 拉', '硬拉', [[180, 2], [170, 3], [160, 5]]),
  seedWorkout('seed_del', 2, 'E2E 待删', '杠铃划船', [[60, 8]]),
];
const SEED_SETS = SEED.reduce((n, w) => n + w.exercises[0].sets.length, 0);

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

/** 页面里的工具：mock 文件夹、库里的快照、按环境加前缀的 key */
async function installHelpers(page) {
  await page.evaluate(() => {
    window.__t = {
      fs: () => JSON.parse(localStorage.getItem('fitlog_mock_folder_fs') || '{}'),
      setFs: o => localStorage.setItem('fitlog_mock_folder_fs', JSON.stringify(o)),
      fault: f => (f ? localStorage.setItem('fitlog_mock_folder_fault', f) : localStorage.removeItem('fitlog_mock_folder_fault')),
      key: k => (window.__fitlog.env().env === 'dev' ? `dev:${k}` : k),
      snap: async () => (await window.__fitlog.backup.build()).snapshot,
    };
  });
}

/** 点「立即备份」并等这一次真的结束（状态里的时间戳变了），不靠可能是上一次留下的提示 */
async function backupAndWait(page) {
  const statusOf = () => page.evaluate(() => localStorage.getItem(window.__t.key('fitlog_backup_status')));
  const before = await statusOf();
  await page.locator('[data-testid="backup-now"]').click();
  await page.waitForFunction(b => localStorage.getItem(window.__t.key('fitlog_backup_status')) !== b, before, { timeout: 12_000 });
}

async function waitToast(page, re, timeout = 12_000) {
  await page.getByText(re).first().waitFor({ state: 'visible', timeout });
}

async function openPrefs(page) {
  if (await page.locator('[data-testid="data-safety"]').isVisible().catch(() => false)) return;
  await page.getByRole('button', { name: /我的|Profile/ }).click();
  await page.locator('[data-testid="prefs-entry"]').click();
  await page.locator('[data-testid="data-safety"]').scrollIntoViewIfNeeded();
}

async function reloadAndSettle(page) {
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('header', { timeout: 15_000 });
  await installHelpers(page);
}

/**
 * 在给定的浏览器里开一个新 context 跑这一套。plan.run 为空就什么都不做。
 * 返回 { results, pageErrors, failed, timings }；不关浏览器、不退出进程。
 */
export async function runBackup(browser, plan) {
  const results = [];
  const timings = [];
  let failed = false;
  if (!plan.run.size) return { results, pageErrors: [], failed, timings };
  fs.mkdirSync(OUT, { recursive: true });
  // 和别的套件并行时日志会交错：每行带上 [backup]
  const log = s => console.log(`[backup] ${s}`);
  async function step(page, name, fn) {
    if (!(await enterStep(plan, name))) return;
    log(`▶ ${name}`);
    const t0 = Date.now();
    try {
      const detail = await fn();
      results.push({ name, status: 'pass', detail });
      log(`  ✓ ${name}${detail ? ' — ' + detail : ''}`);
      await page.screenshot({ path: path.join(OUT, `${String(results.length).padStart(2, '0')}-${name}.png`) });
    } catch (err) {
      failed = true;
      results.push({ name, status: 'fail', detail: err.message });
      log(`  ✗ ${name} — ${err.message}`);
      await page.screenshot({ path: path.join(OUT, `FAIL-${name}.png`) }).catch(() => {});
      throw err;
    } finally {
      timings.push({ name, ms: Date.now() - t0 });
      results.at(-1).ms = timings.at(-1).ms;
    }
  }

  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'zh-CN', timezoneId: 'America/Toronto' });
  // 只放行本机 dev server：e2e 不该碰任何真实后端
  await context.route('**/*', route => {
    const u = route.request().url();
    return u.startsWith(BASE) || u.startsWith('data:') || u.startsWith('blob:') ? route.continue() : route.abort();
  });
  await context.addInitScript(() => {
    if (!sessionStorage.getItem('__e2e_init')) {
      sessionStorage.setItem('__e2e_init', '1');
      localStorage.clear();
      localStorage.setItem('fitlog_mock_folder', '1');
    }
  });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e)));

  try {
    await step(page, 'pure-retention', async () => {
      await page.goto(BASE, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('header', { timeout: 15_000 });
      await installHelpers(page);
      const r = await page.evaluate(async () => {
        const m = await import('/services/fitlogAutoBackup.ts');
        const now = new Date(2026, 9, 20, 18, 30);
        const f = (y, mo, d, h = 12, mi = 0, dev = false) => {
          const p = n => String(n).padStart(2, '0');
          const name = `fitlog-${dev ? 'dev-' : ''}backup-${y}-${p(mo)}-${p(d)}-${p(h)}${p(mi)}.json`;
          return { uri: name, name, size: 1, modified: 0 };
        };
        const files = [
          f(2026, 10, 20, 9), f(2026, 10, 20, 18, 30), // 今天两份 → 留 18:30
          f(2026, 10, 7), // 13 天前 → 留
          f(2026, 10, 6), // 14 天前 → 进月度规则；10 月最早的是它 → 留
          f(2026, 10, 2), // 10 月更早的一份 → 它才是 10 月最早 → 留，10-06 删
          f(2026, 9, 3), f(2026, 9, 20), // 9 月：留 9-03
          f(2025, 11, 5), // 11 个月前 → 留
          f(2025, 10, 5), // 12 个月前 → 删
          f(2026, 10, 1, 12, 0, true), // dev 环境的不归这里管
          { uri: 'mine.json', name: 'mine.json', size: 1, modified: 0 },
        ];
        const del = m.selectBackupsToDelete(files, now, 'prod').map(x => x.name).sort();
        // 读回核对：少一次训练必须判不一致
        const file = await window.__fitlog.backup.build();
        file.snapshot.workouts = [{ id: 'x', date: '2026-01-01', exercises: [] }];
        const good = m.verifyReadBack(file, JSON.stringify(file));
        const bad = m.verifyReadBack(file, JSON.stringify({ ...file, snapshot: { ...file.snapshot, workouts: [] } }));
        const trunc = m.verifyReadBack(file, JSON.stringify(file).slice(0, 50));
        return { del, good, bad, trunc };
      });
      const want = ['fitlog-backup-2025-10-05-1200.json', 'fitlog-backup-2026-09-20-1200.json', 'fitlog-backup-2026-10-06-1200.json', 'fitlog-backup-2026-10-20-0900.json'];
      if (JSON.stringify(r.del) !== JSON.stringify(want)) throw new Error(`retention deleted ${JSON.stringify(r.del)}, want ${JSON.stringify(want)}`);
      if (r.good !== null) throw new Error(`identical read-back flagged: ${r.good}`);
      if (!r.bad || !/workouts/.test(r.bad)) throw new Error(`missing workout not flagged: ${r.bad}`);
      if (r.trunc !== 'not-parseable') throw new Error(`truncated file not flagged: ${r.trunc}`);
      return `deletes ${r.del.length}, read-back mismatches caught`;
    });

    await step(page, 'seed-and-setup-prompt', async () => {
      await page.evaluate(async seed => {
        const f = await window.__fitlog.backup.build();
        f.snapshot.workouts = seed;
        await window.__fitlog.backup.apply(JSON.stringify(f));
      }, SEED);
      await reloadAndSettle(page);
      // 有了结束的训练、还没选文件夹 → 引导一次
      await page.locator('[data-testid="backup-setup-choose"]').click({ timeout: 10_000 });
      await waitToast(page, /已备份并核对：4 次训练/);
      const files = await page.evaluate(() => Object.keys(window.__t.fs()));
      if (files.length !== 1 || !/^fitlog-(dev-)?backup-\d{4}-\d{2}-\d{2}-\d{4}\.json$/.test(files[0])) throw new Error(`files: ${files}`);
      const n = await page.evaluate(name => JSON.parse(window.__t.fs()[name].text).snapshot.workouts.length, files[0]);
      if (n !== 4) throw new Error(`backup has ${n} workouts`);
      // 完整快照：prs / scheduledWorkouts / prefs / 墓碑都在（复用 buildBackupFile，不挑字段）
      const keys = await page.evaluate(name => Object.keys(JSON.parse(window.__t.fs()[name].text).snapshot).sort().join(','), files[0]);
      for (const k of ['prs', 'scheduledWorkouts', 'prefs', 'tombstones', 'customExerciseDefsFromDb', 'goals', 'weightLogs']) {
        if (!keys.split(',').includes(k)) throw new Error(`snapshot lacks ${k}: ${keys}`);
      }
      return files[0];
    });

    await step(page, 'status-in-prefs', async () => {
      await reloadAndSettle(page);
      if (await page.locator('[data-testid="backup-setup-modal"]').isVisible().catch(() => false)) throw new Error('setup prompt shown twice');
      await openPrefs(page);
      const s = await page.locator('[data-testid="backup-status"]').innerText();
      if (!/上次备份：今天/.test(s) || !/文档\/fitlog/.test(s) || !/共 1 份/.test(s)) throw new Error(`status: ${s}`);
      return s;
    });

    await step(page, 'verify-failure-not-success', async () => {
      await page.evaluate(() => window.__t.fault('corrupt-write'));
      await backupAndWait(page);
      await waitToast(page, /备份失败：写进去的内容读回来对不上/);
      const s = await page.locator('[data-testid="backup-status"]').innerText();
      if (!/上次备份失败/.test(s)) throw new Error(`status after corrupt write: ${s}`);
      const n = await page.evaluate(() => Object.keys(window.__t.fs()).length);
      if (n !== 1) throw new Error(`corrupt file should have been removed, folder has ${n}`);
      await page.evaluate(() => window.__t.fault('deny'));
      await backupAndWait(page);
      await waitToast(page, /备份失败：没有文件夹权限/);
      if (!/重新选择/.test(await page.locator('[data-testid="backup-change-folder"]').innerText())) throw new Error('no-access should offer 重新选择');
      await page.evaluate(() => window.__t.fault(''));
      await backupAndWait(page);
      const s2 = await page.locator('[data-testid="backup-status"]').innerText();
      if (!/上次备份：今天/.test(s2)) throw new Error(`status after recovery: ${s2}`);
      return 'corrupt + deny reported as failures, recovery ok';
    });

    await step(page, 'retention-in-folder', async () => {
      const before = await page.evaluate(() => {
        const fsObj = window.__t.fs();
        const env = window.__fitlog.env().env === 'dev' ? 'dev-' : '';
        const p = n => String(n).padStart(2, '0');
        for (let d = 1; d <= 60; d++) {
          const t = new Date(Date.now() - d * 86400000);
          const name = `fitlog-${env}backup-${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}-1200.json`;
          fsObj[name] = { text: '{}', modified: t.getTime() };
        }
        const old = new Date(Date.now() - 400 * 86400000);
        fsObj[`fitlog-${env}backup-${old.getFullYear()}-${p(old.getMonth() + 1)}-${p(old.getDate())}-1200.json`] = { text: '{}', modified: 0 };
        fsObj['my-notes.json'] = { text: '{"mine":1}', modified: 0 };
        window.__t.setFs(fsObj);
        return Object.keys(fsObj).length;
      });
      await backupAndWait(page);
      const r = await page.evaluate(() => {
        const names = Object.keys(window.__t.fs());
        const re = /backup-(\d{4})-(\d{2})-(\d{2})-\d{4}\.json$/;
        const days = names.map(n => re.exec(n)).filter(Boolean).map(m => new Date(+m[1], +m[2] - 1, +m[3]));
        const today = new Date();
        const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
        const ago = d => Math.round((t0 - d.getTime()) / 86400000);
        const dayKeys = days.map(d => d.toDateString());
        const recent = days.filter(d => ago(d) <= 13).length;
        const older = days.filter(d => ago(d) > 13);
        const months = older.map(d => `${d.getFullYear()}-${d.getMonth()}`);
        return {
          names,
          dupDays: dayKeys.length - new Set(dayKeys).size,
          recent,
          olderPerMonthUnique: months.length === new Set(months).size,
          tooOld: days.some(d => ago(d) > 370),
          mine: names.includes('my-notes.json'),
        };
      });
      if (r.dupDays) throw new Error('two backups on the same day survived');
      if (r.recent !== 14) throw new Error(`expected 14 daily backups in the last 14 days, got ${r.recent}`);
      if (!r.olderPerMonthUnique) throw new Error(`more than one backup kept for an older month: ${r.names.sort().join(' ')}`);
      if (r.tooOld) throw new Error('backup older than 12 months kept');
      if (!r.mine) throw new Error("user's own file was deleted");
      const s = await page.locator('[data-testid="backup-status"]').innerText();
      return `${before} → ${r.names.length} files · ${s}`;
    });

    await step(page, 'csv-to-folder', async () => {
      await page.locator('[data-testid="export-csv-folder"]').click();
      await waitToast(page, new RegExp(`已导出 ${SEED_SETS} 组（4 次训练）`));
      const csv = await page.evaluate(() => {
        const fsObj = window.__t.fs();
        const name = Object.keys(fsObj).find(n => n.endsWith('.csv'));
        return name ? { name, text: fsObj[name].text } : null;
      });
      if (!csv || !/^fitlog-训练记录-\d{4}-\d{2}-\d{2}\.csv$/.test(csv.name)) throw new Error(`csv file: ${csv?.name}`);
      if (!csv.text.startsWith('﻿日期,开始时间,训练')) throw new Error('csv must start with BOM + 中文表头');
      const lines = csv.text.replace(/^﻿/, '').trim().split('\r\n');
      if (lines.length !== SEED_SETS + 1) throw new Error(`csv has ${lines.length - 1} rows, want ${SEED_SETS}`);
      if (!lines.some(l => /杠铃平板卧推,,胸部,1,正式,100,kg,100,5/.test(l))) throw new Error(`bench row missing:\n${lines.slice(0, 4).join('\n')}`);
      return `${csv.name} · ${lines.length - 1} rows`;
    });

    await step(page, 'uninstall-then-restore', async () => {
      // 卸载：App 自己的数据全没了，公共目录里的文件还在
      await page.evaluate(async () => {
        const keep = {};
        for (const k of ['fitlog_mock_folder', 'fitlog_mock_folder_fs']) keep[k] = localStorage.getItem(k);
        localStorage.clear();
        for (const [k, v] of Object.entries(keep)) localStorage.setItem(k, v);
        const dbs = (await indexedDB.databases?.()) ?? [];
        await Promise.all(dbs.map(d => new Promise(r => { const q = indexedDB.deleteDatabase(d.name); q.onsuccess = q.onerror = q.onblocked = r; })));
      });
      await reloadAndSettle(page);
      const n0 = await page.evaluate(async () => (await window.__t.snap()).workouts.length);
      if (n0 !== 0) throw new Error(`after uninstall there are still ${n0} workouts`);
      await page.locator('[data-testid="empty-restore"]').click({ timeout: 10_000 });
      const summary = await page.locator('[data-testid="restore-summary"]').innerText({ timeout: 10_000 });
      if (!/找到备份：4 次训练/.test(summary) || !/最后一次训练/.test(summary)) throw new Error(`summary: ${summary}`);
      await page.locator('[data-testid="restore-apply"]').click();
      await page.waitForEvent('load', { timeout: 15_000 });
      await page.waitForSelector('header', { timeout: 15_000 });
      await installHelpers(page);
      await waitToast(page, /已恢复：4 次训练/);
      const n1 = await page.evaluate(async () => (await window.__t.snap()).workouts.length);
      if (n1 !== 4) throw new Error(`restored ${n1} workouts, want 4`);
      // 恢复用的文件夹顺手设成了备份文件夹，重载后补了一份备份
      await page.waitForFunction(() => !!localStorage.getItem(window.__t.key('fitlog_backup_status')), null, { timeout: 10_000 });
      const st = await page.evaluate(() => JSON.parse(localStorage.getItem(window.__t.key('fitlog_backup_status'))));
      if (!st.lastOkAt || st.lastOkWorkouts !== 4) throw new Error(`post-restore backup status: ${JSON.stringify(st)}`);
      return summary.replace(/\s+/g, ' ');
    });

    await step(page, 'merge-respects-tombstones', async () => {
      // 本地：删了 seed_del（墓碑），又新练了一场；备份里还有 seed_del
      await page.evaluate(async () => {
        const f = await window.__fitlog.backup.build();
        const ws = f.snapshot.workouts.filter(w => w.id !== 'seed_del');
        const t = new Date().toISOString();
        ws.push({ id: 'local_new', userId: 'u_solo', date: t, title: 'E2E 新练的', status: 'completed', finishedAt: t, updatedAt: t,
          exercises: [{ id: 'ln_ex', name: '杠铃推举', category: 'STRENGTH', sets: [{ id: 'ln_s', weight: 50, reps: 5 }] }] });
        f.snapshot.workouts = ws;
        f.snapshot.tombstones = { ...(f.snapshot.tombstones || {}), workouts: ['seed_del'] };
        await window.__fitlog.backup.apply(JSON.stringify(f));
      });
      await reloadAndSettle(page);
      await openPrefs(page);
      await page.locator('[data-testid="backup-restore"]').click();
      // 默认取最新一份：恢复后补的那份，里面还有 seed_del、没有 local_new
      await page.locator('[data-testid="restore-summary"]').waitFor({ timeout: 10_000 });
      await page.locator('[data-testid="restore-merge"]').click();
      await page.waitForEvent('load', { timeout: 15_000 });
      await page.waitForSelector('header', { timeout: 15_000 });
      await installHelpers(page);
      const ids = await page.evaluate(async () => (await window.__t.snap()).workouts.map(w => w.id).sort());
      if (!ids.includes('local_new')) throw new Error(`merge lost the local workout: ${ids}`);
      if (ids.includes('seed_del')) throw new Error('merge brought back a deleted workout');
      if (ids.length !== 4) throw new Error(`merged ids: ${ids}`);
      return ids.join(',');
    });

    await step(page, 'strong-import-asks-units', async () => {
      await openPrefs(page);
      const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.locator('[data-testid="import-csv"]').click()]);
      await chooser.setFiles({ name: 'strong.csv', mimeType: 'text/csv', buffer: Buffer.from(STRONG_ANDROID) });
      await page.locator('[data-testid="import-unit-ask"]').waitFor({ timeout: 10_000 });
      const modal = await page.locator('[data-testid="import-csv-modal"]').innerText();
      if (!/2 次训练/.test(modal) || !/最重 225/.test(modal) || !/新建自定义动作/.test(modal) || !/杠铃平板卧推/.test(modal)) throw new Error(`modal: ${modal.replace(/\s+/g, ' ')}`);
      await page.locator('[data-testid="import-unit-all"] button', { hasText: 'lb' }).click();
      await page.locator('[data-testid="import-csv-run"]').click();
      await page.waitForEvent('load', { timeout: 15_000 });
      await page.waitForSelector('header', { timeout: 15_000 });
      await installHelpers(page);
      await waitToast(page, /已导入 2 次训练/);
      const r = await page.evaluate(async () => {
        const s = await window.__t.snap();
        const imp = s.workouts.filter(w => w.id.startsWith('imp_strong_'));
        const bench = imp.flatMap(w => w.exercises).find(e => e.name === '杠铃平板卧推');
        const custom = s.prefs.customExercises.find(d => d.name.en === 'Strong Only Machine');
        return { n: imp.length, total: s.workouts.length, bench: bench?.sets.map(x => [x.weight, x.plateUnit, x.reps, x.subSets?.length ?? 0]), custom: !!custom };
      });
      if (r.n !== 2) throw new Error(`imported ${r.n}`);
      // 热身组默认不导；225 lb → 102.06 kg；递减组挂在下面
      if (!r.bench || r.bench.length !== 1 || Math.abs(r.bench[0][0] - 102.058) > 0.01 || r.bench[0][1] !== 'lbs' || r.bench[0][3] !== 1) throw new Error(`bench: ${JSON.stringify(r.bench)}`);
      if (!r.custom) throw new Error('unmatched exercise should become a custom exercise');
      return `total ${r.total}, bench ${JSON.stringify(r.bench)}`;
    });

    await step(page, 'strong-reimport-no-dup-and-hevy-unit', async () => {
      const before = await page.evaluate(async () => (await window.__t.snap()).workouts.length);
      await openPrefs(page);
      let [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.locator('[data-testid="import-csv"]').click()]);
      await chooser.setFiles({ name: 'strong.csv', mimeType: 'text/csv', buffer: Buffer.from(STRONG_ANDROID.replace(/;/g, ',')) });
      await page.locator('[data-testid="import-csv-run"]').click();
      await page.waitForEvent('load', { timeout: 15_000 });
      await page.waitForSelector('header', { timeout: 15_000 });
      await installHelpers(page);
      const mid = await page.evaluate(async () => (await window.__t.snap()).workouts.length);
      if (mid !== before) throw new Error(`re-import (iOS comma variant) changed count ${before} → ${mid}`);

      await openPrefs(page);
      [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.locator('[data-testid="import-csv"]').click()]);
      await chooser.setFiles({ name: 'hevy.csv', mimeType: 'text/csv', buffer: Buffer.from(HEVY) });
      const known = await page.locator('[data-testid="import-unit-known"]').innerText({ timeout: 10_000 });
      if (!/lb（来自文件）/.test(known)) throw new Error(`hevy unit line: ${known}`);
      await page.locator('[data-testid="import-csv-run"]').click();
      await page.waitForEvent('load', { timeout: 15_000 });
      await page.waitForSelector('header', { timeout: 15_000 });
      await installHelpers(page);
      const w = await page.evaluate(async () => (await window.__t.snap()).workouts.find(x => x.id.startsWith('imp_hevy_'))?.exercises[0].sets[0]);
      if (!w || Math.abs(w.weight - 83.91) > 0.01) throw new Error(`hevy 185 lb should be 83.91 kg, got ${JSON.stringify(w)}`);
      return `count stable at ${mid}; hevy ${w.weight.toFixed(2)} kg`;
    });

  } catch {
    // step 已经记过
  } finally {
    fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ base: BASE, results, pageErrors }, null, 2));
    await context.close();
  }
  return { results, pageErrors, failed, timings };
}

/** 单独跑：自己起浏览器 */
async function main() {
  console.log(`\n== e2e backup against ${BASE} ==\n`);
  const only = parseOnly(process.env.E2E_ONLY);
  const plan = planSuite('备份', BACKUP_STEPS, only);
  describeSelection([plan], only);
  const browser = await chromium.launch({ headless: true, executablePath: process.env.E2E_CHROMIUM || undefined });
  const { results, pageErrors, failed, timings } = await runBackup(browser, plan);
  await browser.close();
  const pass = results.filter(r => r.status === 'pass').length;
  console.log(`\n${pass}/${results.length} passed${failed ? ' — FAILED' : ''}${pageErrors.length ? ` · page errors: ${pageErrors.length}` : ''}\n`);
  printSlowest('备份', timings);
  process.exit(failed || pageErrors.length ? 1 : 0);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
