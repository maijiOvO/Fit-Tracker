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
  // 换手机时备份在「下载」根目录，选不了文件夹（上架审查 solo-isolation#4）：取消选文件夹后停在弹窗里，选一个备份文件走摘要 → 恢复，
  // 不设备份文件夹。「取消后不关」「单文件走同一套摘要」「恢复不要求文件夹」是弹窗的状态机，下层测不到
  ['restore-from-file'],
  // 再卸载一次、在「我的」页选回原来的文件夹：不写空备份，转去恢复，默认项是带着记录的那份（上架审查 C11 / C53）。
  // 选完文件夹 → 先看文件夹里有没有本机没有的 → 写 / 跳过 → 开恢复弹窗，这段 hook 接线 data-check 测不到
  ['reinstall-choose-old-folder'],
  // 坏数据让整页崩了：兜底页直接给「撤销上次恢复」（上架审查 C08 / gap-r3-2#1：原来撤销挂在崩掉的「我的」页里）。
  // 组件测不了这层接线，只能在这里测
  ['crash-undo-restore', []],
  // 开库失败：首页显示「读不出本机数据」和重试，顶栏有红签，不是新用户的空状态（上架审查 C14）；读失败回落成空状态这条接线只能在这里测
  ['read-failure-not-empty', []],
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
    // 模拟本机库开不了（存储写满、后备存储出错）：read-failure-not-empty 那一步用
    if (sessionStorage.getItem('__idb_fail') === '1') {
      const realOpen = indexedDB.open.bind(indexedDB);
      indexedDB.open = (name, ver) => {
        if (!/^FitLogDB/.test(name)) return realOpen(name, ver);
        const req = {};
        setTimeout(() => {
          Object.defineProperty(req, 'error', { value: new DOMException('simulated backing store error', 'UnknownError') });
          req.onerror?.(new Event('error'));
        });
        return req;
      };
    }
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
      // 先只删库、localStorage 留着 = 系统清掉了 WebView 的库：首页要报「N 场不见了」，不是新用户的空状态（上架审查 C12）
      await page.evaluate(async () => {
        const dbs = (await indexedDB.databases?.()) ?? [];
        await Promise.all(dbs.map(d => new Promise(r => { const q = indexedDB.deleteDatabase(d.name); q.onsuccess = q.onerror = q.onblocked = r; })));
      });
      await reloadAndSettle(page);
      await page.locator('[data-testid="local-loss"]').waitFor({ timeout: 10_000 });
      if (await page.locator('[data-testid="empty-restore"]').count()) throw new Error('local loss should not fall back to the new-user empty state');
      // 再照卸载来：App 自己的数据全没了（localStorage 也没了），公共目录里的文件还在；这时不该误报丢失
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
      if (await page.locator('[data-testid="local-loss"]').count()) throw new Error('a real uninstall must not be reported as data loss');
      // 空库首页的「从备份恢复」→ 读到文件夹里那份 → 覆盖（整页重载）
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

    await step(page, 'restore-from-file', async () => {
      const text = await page.evaluate(async () => {
        const fs = window.__t.fs();
        const newest = Object.keys(fs).sort().at(-1);
        const keep = {};
        for (const k of ['fitlog_mock_folder', 'fitlog_mock_folder_fs']) keep[k] = localStorage.getItem(k);
        localStorage.clear();
        for (const [k, v] of Object.entries(keep)) localStorage.setItem(k, v);
        const dbs = (await indexedDB.databases?.()) ?? [];
        await Promise.all(dbs.map(d => new Promise(r => { const q = indexedDB.deleteDatabase(d.name); q.onsuccess = q.onerror = q.onblocked = r; })));
        return fs[newest].text;
      });
      await reloadAndSettle(page);
      await page.evaluate(() => window.__t.fault('cancel'));
      try {
        await page.locator('[data-testid="empty-restore"]').click({ timeout: 10_000 });
        // 选文件夹取消了：弹窗还开着，给「选一个备份文件」
        await page.locator('[data-testid="restore-pick-file"]').waitFor({ timeout: 10_000 });
        if (!(await page.locator('[data-testid="restore-modal"]').isVisible())) throw new Error('restore modal closed after cancelling the folder picker');
        const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.locator('[data-testid="restore-pick-file"]').click()]);
        await chooser.setFiles({ name: 'fitlog-backup.json', mimeType: 'application/json', buffer: Buffer.from(text) });
        await page.locator('[data-testid="restore-summary"]').waitFor({ timeout: 10_000 });
        await page.locator('[data-testid="restore-apply"]').click();
        await page.waitForEvent('load', { timeout: 15_000 });
      } finally {
        await page.evaluate(() => localStorage.removeItem('fitlog_mock_folder_fault')).catch(() => {});
      }
      await page.waitForSelector('header', { timeout: 15_000 });
      await installHelpers(page);
      const n = await page.evaluate(async () => (await window.__t.snap()).workouts.length);
      if (n !== SEED.length) throw new Error(`restored ${n} workouts from the file, want ${SEED.length}`);
      const folder = await page.evaluate(() => localStorage.getItem(window.__t.key('fitlog_backup_folder')));
      if (folder) throw new Error(`restoring from a single file set a backup folder: ${folder}`);
      return `restored ${n} workouts from a single file, no folder set`;
    });

    await step(page, 'reinstall-choose-old-folder', async () => {
      await page.evaluate(async () => {
        const keep = {};
        for (const k of ['fitlog_mock_folder', 'fitlog_mock_folder_fs']) keep[k] = localStorage.getItem(k);
        localStorage.clear();
        for (const [k, v] of Object.entries(keep)) localStorage.setItem(k, v);
        const dbs = (await indexedDB.databases?.()) ?? [];
        await Promise.all(dbs.map(d => new Promise(r => { const q = indexedDB.deleteDatabase(d.name); q.onsuccess = q.onerror = q.onblocked = r; })));
      });
      await reloadAndSettle(page);
      const before = await page.evaluate(() => Object.keys(window.__t.fs()).length);
      await page.getByRole('button', { name: /^(我的|Profile)$/ }).click({ timeout: 10_000 });
      await page.locator('[data-testid="profile-backup-choose"]').click({ timeout: 10_000 });
      const summary = page.locator('[data-testid="restore-summary"]');
      await summary.waitFor({ timeout: 10_000 });
      const n = await summary.getAttribute('data-workouts');
      if (n !== String(SEED.length)) throw new Error(`default backup has ${n} workouts, want ${SEED.length}`);
      const after = await page.evaluate(() => Object.keys(window.__t.fs()).length);
      if (after !== before) throw new Error(`choosing the folder with an empty db wrote a file (${before} → ${after})`);
      return `no empty backup, restore opened on ${n} workouts`;
    });
  } catch {
    // step 已经记过；下面这步不依赖前面那条链
  }

  try {
    await step(page, 'crash-undo-restore', async () => {
      if (!page.url().startsWith(BASE)) await page.goto(BASE, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('header', { timeout: 15_000 });
      await installHelpers(page);
      const good = SEED.slice(0, 2);
      // 恢复两次同一份：回滚槽里就是「两场好训练」的样子
      await page.evaluate(async seed => {
        const f = await window.__fitlog.backup.build();
        f.snapshot.workouts = seed;
        await window.__fitlog.backup.apply(JSON.stringify(f));
        await window.__fitlog.backup.apply(JSON.stringify(f));
      }, good);
      // 绕过入口规整直接往库里塞一行坏的（旧版本恢复进来的就是这样）
      await page.evaluate(async bad => {
        const dbs = (await indexedDB.databases()).filter(d => /^FitLogDB/.test(d.name));
        const name = dbs.find(d => /dev/.test(d.name))?.name ?? dbs[0].name;
        await new Promise((res, rej) => {
          const q = indexedDB.open(name);
          q.onerror = () => rej(q.error);
          q.onsuccess = () => {
            const tx = q.result.transaction('workouts', 'readwrite');
            tx.objectStore('workouts').put(bad);
            tx.oncomplete = () => { q.result.close(); res(); };
            tx.onerror = () => rej(tx.error);
          };
        });
      }, { ...SEED[2], id: 'bad_row', exercises: null });
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.locator('[data-testid="error-fallback"]').first().waitFor({ timeout: 15_000 });
      await page.locator('[data-testid="error-undo-import"]').first().click({ timeout: 10_000 });
      await page.locator('[data-testid="error-undo-confirm"]').first().click();
      await page.waitForEvent('load', { timeout: 15_000 });
      await page.waitForSelector('header', { timeout: 15_000 });
      await installHelpers(page);
      if (await page.locator('[data-testid="error-fallback"]').count()) throw new Error('still on the error page after undo');
      const ids = await page.evaluate(async () => (await window.__t.snap()).workouts.map(w => w.id).sort());
      if (ids.join(',') !== good.map(w => w.id).sort().join(',')) throw new Error(`after undo: ${ids}`);
      return `undo from error page → ${ids.length} workouts`;
    });
  } catch {
    // step 已经记过
  }

  try {
    await step(page, 'read-failure-not-empty', async () => {
      if (!page.url().startsWith(BASE)) await page.goto(BASE, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('header', { timeout: 15_000 });
      await installHelpers(page);
      const seeded = await page.evaluate(async () => (await window.__t.snap()).workouts.length);
      if (!seeded) throw new Error('need workouts in the db before this step');
      await page.evaluate(() => sessionStorage.setItem('__idb_fail', '1'));
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.locator('[data-testid="local-read-error"]').waitFor({ timeout: 15_000 });
      await page.locator('[data-testid="local-read-failed"]').waitFor({ timeout: 5_000 });
      if (await page.locator('[data-testid="empty-restore"]').count()) throw new Error('read failure fell back to the new-user empty state');
      await page.evaluate(() => sessionStorage.removeItem('__idb_fail'));
      await page.locator('[data-testid="local-read-retry"]').click();
      await page.waitForEvent('load', { timeout: 15_000 });
      await page.waitForSelector('header', { timeout: 15_000 });
      await page.locator('[data-testid^="timeline-session-"]').first().waitFor({ timeout: 10_000 });
      if (await page.locator('[data-testid="local-read-error"]').count()) throw new Error('still showing the read error after retry');
      return `read error card + badge, retry → ${seeded} workouts back`;
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
