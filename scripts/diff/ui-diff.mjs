// 界面对照：同一套操作在两个 dev server 上各走一遍，每步导出 页面文本 / DOM 结构 / localStorage / 整份快照，归一化后比对。
// 用法：node scripts/diff/ui-diff.mjs http://localhost:3200 http://localhost:3100 [--api https://远端] [--out dir]
// 远端走 Playwright route 的 mock（和 e2e 同一套写法），两边都拉到同一份种子快照，不碰真实 NAS。
// 两个 dev server 要分别从两棵树起（README 有命令）；比不了手势、动画、Service Worker、真机字体。
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, requireFromRoot, parseArgs, outDir } from './_paths.mjs';

const { pos: [baseA, baseB], opts } = parseArgs(process.argv.slice(2), {
  positional: 2, usage: 'usage: node scripts/diff/ui-diff.mjs <baseA> <baseB> [--api url] [--out dir]', flags: { api: '', out: '' },
});
const OUT = outDir('ui', opts.out);
fs.mkdirSync(OUT, { recursive: true });
const { chromium } = requireFromRoot('playwright');
const TZ = 'America/Toronto';
// 远端地址可能有三个来源（--api、仓库根 .env.local 的 VITE_API_URL、services/fitlogRemote.ts 的默认值）；
// 两棵树的 .env.local 不一定一样，所以 /api/fitlog/state 不限 host 一律接 mock，其余打向这些 host 的请求全部掐掉。
const API_HOSTS = new Set(['https://hometj.taild995c6.ts.net']);
if (opts.api) API_HOSTS.add(opts.api.replace(/\/$/, ''));
try { const m = fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8').match(/VITE_API_URL\s*=\s*(.+)/); const v = (m?.[1] || '').trim().replace(/^['"]|['"]$/g, ''); if (v) API_HOSTS.add(v.replace(/\/$/, '')); } catch {}
const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const API_HOST_RE = new RegExp(`^(${[...API_HOSTS].map(escapeRe).join('|')})(:\\d+)?/`);

// ── 种子（固定时间，两边同一份） ──
const T0 = Date.UTC(2026, 9, 20, 22, 5, 0); // 2026-10-20 18:05 多伦多
const iso = (daysAgo, hoursOff = 0) => new Date(T0 - daysAgo * 864e5 + hoursOff * 36e5).toISOString();
const workout = (id, at, title, items) => ({
  id, userId: 'u_solo', date: at, title, status: 'completed', finishedAt: at, updatedAt: at, gym: 'A馆',
  exercises: items.map(([name, sets], k) => ({ id: `${id}_ex${k}`, name, category: 'STRENGTH', exerciseTime: at, sets: sets.map(([w, r], i) => ({ id: `${id}_s${k}_${i}`, weight: w, reps: r, plateUnit: 'kg' })) })),
});
const SEED = {
  schemaVersion: 2,
  workouts: [
    workout('seed_a', iso(1), '推', [['杠铃平板卧推', [[60, 8], [70, 5], [80, 3]]], ['哑铃平板卧推', [[20, 10], [22.5, 8]]]]),
    workout('seed_b', iso(3), '拉', [['硬拉', [[100, 5], [110, 3]]], ['引体向上', [[0, 8], [0, 6]]]]),
    workout('seed_c', iso(8), '腿', [['杠铃深蹲', [[80, 5], [90, 5], [100, 3]]]]),
    workout('seed_d', iso(40), '推', [['杠铃平板卧推', [[55, 8], [65, 5]]]]),
  ],
  goals: [], weightLogs: [{ id: 'wl1', date: iso(2), weight: 70.5 }, { id: 'wl2', date: iso(35), weight: 72 }], customMetrics: [], prs: [], scheduledWorkouts: [],
  prefs: {
    customTags: [], customExercises: [{ id: '1779000000000', name: { cn: '自建甲', en: 'Custom A' }, bodyPart: 'subChest', tags: [], category: 'STRENGTH' }],
    exerciseNotes: {}, starredExercises: { 杠铃深蹲: T0 }, exerciseMetricConfigs: {}, tagRenameOverrides: {}, exerciseOverrides: {},
    starredLastUpdateMs: T0, metricsLastUpdateMs: 0, prefsLastUpdateMs: T0, lang: 'cn', unit: 'kg',
    appPrefs: { gyms: { 'A馆': { plateUnit: 'kg', plates: [25, 20, 15, 10, 5, 2.5, 1.25], cable: { v: 5, u: 'kg' }, machine: { v: 5, u: 'kg' }, dumbbell: { v: 2.5, u: 'kg' } } } }, appPrefsUpdatedMs: T0,
  },
  tombstones: {},
};

// ── 归一化：时间戳、随机 id、相对时间 ──
const normText = s => String(s)
  .replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g, '<ISO>')
  .replace(/(?<!\d)1\d{12}(?!\d)/g, '<TS>')
  .replace(/<TS>_[a-z0-9]{3,8}/g, '<TS>_<RND>')
  .replace(/alt_[a-z0-9]+/g, '<ALT>')
  .replace(/\d+\s*(分钟前|小时前|秒前|min ago|h ago|s ago|minutes? ago|hours? ago)/g, '<AGO>')
  .replace(/\b\d{1,2}:\d{2}\b/g, '<HM>');
const sortKeys = v => (Array.isArray(v) ? v.map(sortKeys) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, sortKeys(v[k])])) : v);

async function snapshot(page, label) {
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r)))));
  await page.waitForTimeout(350); // 让入场动画走完、防抖的写入落地
  const raw = await page.evaluate(async () => {
    // 抓整个 body 而不是 #root：首选项 / 弹窗 / 刊末页等都是 createPortal 到 body 的
    const root = document.body;
    const text = root.innerText;
    const shape = [];
    for (const el of root.querySelectorAll('*')) {
      if (/^(SCRIPT|STYLE|LINK|META)$/.test(el.tagName)) continue;
      const t = el.getAttribute('data-testid');
      const cls = [...el.classList].filter(c => !/^(anim-|is-leaving|is-entering)/.test(c)).sort().join('.');
      shape.push(`${el.tagName.toLowerCase()}${t ? '#' + t : ''}${cls ? '.' + cls : ''}`);
    }
    const ls = {};
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); ls[k] = localStorage.getItem(k); }
    let db = null;
    try { db = await window.__fitlog?.backup?.build?.(); } catch (e) { db = { __err: String(e?.message ?? e) }; }
    return { text, shape, ls, db };
  });
  return {
    label,
    text: normText(raw.text),
    shape: normText(raw.shape.join('\n')),
    ls: Object.fromEntries(Object.keys(raw.ls).sort().map(k => [k, normText(raw.ls[k])])),
    db: normText(JSON.stringify(sortKeys(raw.db))),
  };
}

async function run(browser, base, tag) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: 'light', locale: 'zh-CN', timezoneId: TZ, ignoreHTTPSErrors: true });
  const page = await context.newPage();
  context.setDefaultTimeout(6_000); // 每个动作最多等 6 s：失败就记一步错，别拖成半小时
  const remote = { snapshot: structuredClone(SEED), gets: 0, puts: 0 };
  await context.route(API_HOST_RE, route => route.abort());
  await context.route(/\/api\/fitlog\/state/, async route => {
    const req = route.request();
    if (req.method() === 'GET') { remote.gets++; return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(remote.snapshot) }); }
    if (req.method() === 'PUT') { remote.puts++; try { remote.snapshot = JSON.parse(req.postData() || '{}'); } catch {} return route.fulfill({ status: 200, body: 'ok' }); }
    return route.continue();
  });
  const errors = [];
  page.on('console', m => { if (m.type() === 'error' && !/SW registration|Failed to load resource|ERR_/.test(m.text())) errors.push(normText(m.text())); });
  page.on('pageerror', e => errors.push('pageerror ' + normText(String(e))));

  const snaps = [];
  const step = async (label, fn) => {
    try { await fn(); } catch (e) { snaps.push({ label, text: `__STEP_ERROR__ ${normText(String(e?.message ?? e)).split('\n')[0]}`, shape: '', ls: {}, db: '' }); console.log(`${tag}  ✗ ${label}: ${String(e?.message ?? e).split('\n')[0]}`); return; }
    snaps.push(await snapshot(page, label));
    console.log(`${tag}  · ${label}`);
  };
  const waitIdle = () => page.waitForFunction(() => document.documentElement.dataset.fitlogBoot === 'done' || !document.querySelector('[data-testid="header-sync"]')?.disabled, null, { timeout: 15_000 });
  const nav = re => page.locator('nav button', { hasText: re }).first();
  // 底部 sheet 关掉后不卸载，只是 translate 出屏（外层 aria-hidden）—— Playwright 仍算 visible，所以按位置 / aria-hidden 判「已关」
  const sheetClosed = id => page.waitForFunction(id => { const el = document.querySelector(`[data-testid="${id}"]`); if (!el) return true; return el.getBoundingClientRect().top >= innerHeight - 1 || el.closest('[aria-hidden="true"]') !== null; }, id, { timeout: 8_000 });
  const dlgAccept = async () => { const dlg = page.locator('[role="dialog"]'); await dlg.waitFor({ state: 'visible', timeout: 5_000 }); await dlg.locator('button').filter({ hasText: /^(确定|OK|保存|Save|结束训练|End Workout|放弃|Discard|删除|Delete)$/ }).last().click(); await dlg.waitFor({ state: 'detached', timeout: 5_000 }); };

  await step('boot：首页（种子已拉取合并）', async () => {
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await waitIdle();
    await page.locator('[data-testid="timeline-session-seed_a"]').waitFor({ timeout: 10_000 });
  });
  await step('首页：展开一场 + 菜单', async () => {
    await page.locator('[data-testid="timeline-session-seed_a"]').click();
    await page.locator('[data-testid="timeline-more"]').first().click();
    await page.locator('[data-testid="timeline-session-menu"]').waitFor({ timeout: 3_000 });
  });
  await step('首页：关菜单、切周视图', async () => {
    await page.keyboard.press('Escape');
    await page.locator('[data-testid="timeline-session-menu"]').waitFor({ state: 'detached', timeout: 3_000 }).catch(() => {});
    const week = page.getByRole('button', { name: /^(周|Week)$/ }).first();
    if (await week.isVisible().catch(() => false)) await week.click();
  });
  await step('首页：个人记录视图', async () => {
    const pr = page.getByRole('button', { name: /个人记录|纪录|PR/ }).first();
    if (await pr.isVisible().catch(() => false)) await pr.click();
  });
  await step('计划页', async () => { await page.locator('[data-testid="tab-plan"]').click(); await page.locator('[data-testid="plan-subview-schedule"]').waitFor({ timeout: 5_000 }); });
  await step('计划页：目标子页', async () => { await page.locator('[data-testid="plan-subview-goals"]').click(); });
  await step('我的', async () => { await nav(/我的|Profile|Me/).click(); await page.locator('[data-testid="prefs-entry"]').waitFor({ timeout: 5_000 }); });
  await step('我的：首选项', async () => { await page.locator('[data-testid="prefs-entry"]').click(); await page.locator('[data-testid="prefs-sheet"]').waitFor({ timeout: 5_000 }); });
  await step('我的：首选项 → 切 lbs 单位', async () => { await page.locator('[data-testid="prefs-unit"] button', { hasText: /^lbs$/ }).first().click(); });
  await step('我的：切回 kg、关首选项', async () => { await page.locator('[data-testid="prefs-unit"] button', { hasText: /^kg$/ }).first().click(); await page.locator('[data-testid="prefs-sheet-close"]').click(); await sheetClosed('prefs-sheet'); });
  await step('开练（选馆）', async () => {
    await nav(/个人记录|PR Hub|Dashboard|首页/).click();
    await page.getByRole('button', { name: /开始训练|Start Workout/ }).first().click();
    const ready = page.locator('[data-testid="finish-button"]');
    const picker = page.locator('[data-testid="gym-picker"]');
    const form = page.locator('[data-testid="gym-profile-form"]');
    await ready.or(picker).or(form).first().waitFor({ timeout: 5_000 });
    if (await form.isVisible().catch(() => false)) { await page.locator('[data-testid="gym-profile-name"]').fill('对照馆'); await page.locator('[data-testid="gym-profile-save"]').click(); await form.waitFor({ state: 'detached', timeout: 3_000 }); }
    else if (await picker.isVisible().catch(() => false)) await picker.locator('[data-testid^="gym-option-"]').first().click();
    await picker.waitFor({ state: 'detached', timeout: 3_000 }).catch(() => {});
    await ready.first().waitFor({ timeout: 5_000 });
  });
  await step('开练：动作库', async () => { await page.locator('[data-testid="open-picker-sheet"]').click(); await page.locator('[data-testid="picker-sheet"]').waitFor({ timeout: 5_000 }); });
  await step('开练：搜「卧推」加杠铃平板卧推（带底稿）', async () => {
    const sheet = page.locator('[data-testid="picker-sheet"]');
    await sheet.locator('input[type="text"]').fill('卧推');
    await sheet.locator('[data-testid="picker-sheet-exercise"]', { hasText: '杠铃平板卧推' }).first().click();
    await page.locator('[data-testid="picker-sheet-close"]').click();
    await sheetClosed('picker-sheet');
    await page.locator('.ledger-row [data-testid="ledger-field-weight"] input').first().waitFor({ timeout: 10_000 });
  });
  await step('开练：第一组改成 62.5 并回车', async () => {
    const w = page.locator('.ledger-row [data-testid="ledger-field-weight"] input').first();
    await w.click(); await w.fill('62.5'); await w.press('Enter');
  });
  await step('开练：训练页切 lbs 再切回 kg', async () => {
    const tg = page.locator('[data-testid="unit-toggle"]');
    await tg.click(); await page.waitForTimeout(300); await tg.click();
  });
  await step('开练：点第二组组号（做完）', async () => {
    const nums = page.locator('.ledger-row .set-num, .ledger-row [data-testid^="set-num"], .ledger-row button').filter({ hasText: /^2$/ });
    if (await nums.count()) await nums.first().click();
  });
  await step('结束训练 → 刊末页', async () => { await page.locator('[data-testid="finish-button"]').click(); await dlgAccept(); await page.locator('[data-testid="workout-colophon"]').waitFor({ timeout: 5_000 }); });
  await step('收刊末页 → 首页', async () => { await page.locator('[data-testid="workout-colophon"]').click(); await page.locator('[data-testid="workout-colophon"]').waitFor({ state: 'detached', timeout: 5_000 }); await nav(/个人记录|PR Hub|Dashboard|首页/).click(); });
  await step('全局撤销（那场回到工作台）', async () => { await page.locator('header [data-testid="global-undo"]').click(); await page.locator('[data-testid="finish-button"]').waitFor({ timeout: 5_000 }); });
  await step('重做', async () => { const redo = page.locator('header [data-testid="undo-redo"], header [data-testid="global-redo"]').first(); if (await redo.isVisible().catch(() => false)) await redo.click(); await page.waitForTimeout(400); });
  await step('重开 App（reload）', async () => { await page.reload({ waitUntil: 'domcontentloaded' }); await waitIdle(); await page.waitForTimeout(800); });

  const remoteFinal = normText(JSON.stringify(sortKeys(remote.snapshot)));
  await context.close();
  return { snaps, errors, remote: { gets: remote.gets, puts: remote.puts, final: remoteFinal } };
}

const browser = await chromium.launch();
const A = await run(browser, baseA, 'A');
const B = await run(browser, baseB, 'B');
await browser.close();

let diffs = 0;
const show = (k, a, b) => {
  diffs++; console.log(`~ ${k}`);
  const la = a.split('\n'), lb = b.split('\n'); let shown = 0;
  for (let i = 0; i < Math.max(la.length, lb.length) && shown < 8; i++) if (la[i] !== lb[i]) {
    const x = la[i] ?? '', y = lb[i] ?? ''; let p = 0; while (p < x.length && x[p] === y[p]) p++;
    const from = Math.max(0, p - 90);
    console.log(`    A: ${x.length > 200 ? '…' + x.slice(from, p + 110) : x}\n    B: ${y.length > 200 ? '…' + y.slice(from, p + 110) : y}`); shown++;
  }
};
for (let i = 0; i < Math.max(A.snaps.length, B.snaps.length); i++) {
  const a = A.snaps[i], b = B.snaps[i];
  if (!a || !b) { diffs++; console.log(`~ 步骤数不同`); break; }
  if (a.label !== b.label) { diffs++; console.log(`~ 步骤名不同 ${a.label} / ${b.label}`); continue; }
  if (a.text !== b.text) show(`[${a.label}] 页面文本`, a.text, b.text);
  if (a.shape !== b.shape) show(`[${a.label}] DOM 结构`, a.shape, b.shape);
  if (JSON.stringify(a.ls) !== JSON.stringify(b.ls)) show(`[${a.label}] localStorage`, JSON.stringify(a.ls, null, 1), JSON.stringify(b.ls, null, 1));
  if (a.db !== b.db) show(`[${a.label}] 快照（IndexedDB + prefs）`, a.db, b.db);
}
if (A.remote.final !== B.remote.final) show('mock 远端最终快照', A.remote.final, B.remote.final);
if (A.remote.gets !== B.remote.gets || A.remote.puts !== B.remote.puts) { diffs++; console.log(`~ 远端请求数 A gets=${A.remote.gets} puts=${A.remote.puts} / B gets=${B.remote.gets} puts=${B.remote.puts}`); }
if (JSON.stringify(A.errors) !== JSON.stringify(B.errors)) show('控制台 / 页面错误', A.errors.join('\n'), B.errors.join('\n'));
fs.writeFileSync(path.join(OUT, 'ui-A.json'), JSON.stringify(A, null, 1));
fs.writeFileSync(path.join(OUT, 'ui-B.json'), JSON.stringify(B, null, 1));
const errSteps = A.snaps.filter(s => s.text.startsWith('__STEP_ERROR__')).length;
console.log(`== 步骤 ${A.snaps.length}（其中两边都没走通的 ${errSteps}）· 远端 gets=${A.remote.gets} puts=${A.remote.puts} · 差异 ${diffs} 处 ==`);
process.exit(diffs === 0 ? 0 : 1);
