// 数据安全的 e2e：选好备份文件夹、写出第一份备份 → 「卸载」→ 从文件夹恢复。设计见 docs/design-backup.md。
// 保留规则、读回核对、写坏 / 没权限、CSV 导出、合并 + 墓碑、Strong / Hevy 导入都是 services 里的规则，在 scripts/data-check.mjs。
//
// 浏览器里没有安卓的文件夹授权，services/fitlogFolder.ts 带了一个 mock：
// localStorage `fitlog_mock_folder` = '1' 打开，文件存在裸 localStorage `fitlog_mock_folder_fs`。
// 「卸载」= 清掉除 mock 文件夹以外的 localStorage + 删掉 IndexedDB —— 公共目录里的文件卸载后还在，正是这个形状。
// 盯的是状态（mock 里的文件、库里的条数），不是提示文案：「提示备份成功」本身就是这个项目踩过的假信号。
//
// 跑法：整套 e2e（npm run e2e）里已经包含这一套，和别的套件并行。
//   单独跑：E2E_BASE=http://localhost:3100 node scripts/e2e-backup.mjs（默认 http://localhost:3000），E2E_ONLY 同样适用。

import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { parseOnly, planSuite, enterStep, describeSelection, printSlowest } from './e2e-plan.mjs';

const BASE = (process.env.E2E_BASE || 'http://localhost:3000').replace(/\/$/, '');
const OUT = path.resolve('test-artifacts', 'backup');

/** 依赖表：一条链（规则见 e2e-plan.mjs） */
export const BACKUP_STEPS = [
  ['seed-and-first-backup', []],
  ['uninstall-then-restore'],
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
    await step(page, 'seed-and-first-backup', async () => {
      await page.goto(BASE, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('header', { timeout: 15_000 });
      await installHelpers(page);
      await page.evaluate(async seed => {
        const f = await window.__fitlog.backup.build();
        f.snapshot.workouts = seed;
        await window.__fitlog.backup.apply(JSON.stringify(f));
      }, SEED);
      await reloadAndSettle(page);
      // 有了结束的训练、还没选文件夹 → 引导一次；选好就写第一份（写完读回核对过才算）
      await page.locator('[data-testid="backup-setup-choose"]').click({ timeout: 10_000 });
      await page.waitForFunction(() => !!JSON.parse(localStorage.getItem(window.__t.key('fitlog_backup_status')) || '{}').lastOkAt, null, { timeout: 12_000 });
      const files = await page.evaluate(() => Object.keys(window.__t.fs()));
      if (files.length !== 1) throw new Error(`files: ${files}`);
      const n = await page.evaluate(name => JSON.parse(window.__t.fs()[name].text).snapshot.workouts.length, files[0]);
      if (n !== SEED.length) throw new Error(`backup has ${n} workouts`);
      return files[0];
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
      // 空库首页的「从备份恢复」→ 读到文件夹里那份 → 覆盖恢复（整页重载）
      await page.locator('[data-testid="empty-restore"]').click({ timeout: 10_000 });
      await page.locator('[data-testid="restore-summary"]').waitFor({ timeout: 10_000 });
      await page.locator('[data-testid="restore-apply"]').click();
      await page.waitForEvent('load', { timeout: 15_000 });
      await page.waitForSelector('header', { timeout: 15_000 });
      await installHelpers(page);
      const n1 = await page.evaluate(async () => (await window.__t.snap()).workouts.length);
      if (n1 !== SEED.length) throw new Error(`restored ${n1} workouts, want ${SEED.length}`);
      // 恢复用的文件夹顺手设成了备份文件夹，重载后补了一份备份
      await page.waitForFunction(() => !!localStorage.getItem(window.__t.key('fitlog_backup_status')), null, { timeout: 10_000 });
      const st = await page.evaluate(() => JSON.parse(localStorage.getItem(window.__t.key('fitlog_backup_status'))));
      if (!st.lastOkAt || st.lastOkWorkouts !== SEED.length) throw new Error(`post-restore backup status: ${JSON.stringify(st)}`);
      return `restored ${n1} workouts, folder re-armed`;
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
