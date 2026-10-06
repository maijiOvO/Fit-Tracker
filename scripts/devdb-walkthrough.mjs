/**
 * 开发库走查：真实数据（本机独立开发库，见 scripts/dev-with-local-db.mjs）+ 真实触摸（CDP），384 宽（用户手机）。
 * 一整场：练胸 → 整理里把自建动作拖进细分 → 加动作（底稿 / ±5）→ 点组号做完 → 长按加递减 → 换练法
 * → 删组撤销 → 改过没点完成 → 结束（确认框点出来）→ 时间线 / PR 分练法 → 读开发库文件核对落盘。
 *
 *   node scripts/dev-with-local-db.mjs      # 先起开发库（端口 3100）
 *   node scripts/devdb-walkthrough.mjs      # 截图与日志 → test-artifacts/devdb-walk/
 *
 * 每次开跑前把开发库重置回种子（../fitlog-backups 里最新的 prod-snapshot-*.json，env 改成 dev）。
 * 任何非 localhost 请求都会被掐掉并记在 escaped 里 —— 必须为空。
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
import fs from 'node:fs';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'test-artifacts', 'devdb-walk') + path.sep;
fs.mkdirSync(OUT, { recursive: true });
const BACKUPS = path.resolve(ROOT, '..', 'fitlog-backups');
const SEED = process.env.FITLOG_DEVDB_SEED
  || path.join(BACKUPS, fs.readdirSync(BACKUPS).filter(f => /^prod-snapshot-.*\.json$/.test(f)).sort().pop());
const DB_FILE = path.join(ROOT, '.dev-data', 'state-dev.json');
const b = await chromium.launch({ executablePath: process.env.E2E_CHROMIUM || undefined });
const ctx = await b.newContext({ viewport: { width: 384, height: 854 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, locale: 'zh-CN' });
// 只允许本机：任何外网请求（含 NAS）一律掐掉并记下
const escaped = [];
await ctx.route(/^https?:\/\/(?!localhost)/, r => { const u = r.request().url(); if (/fonts\.g/.test(u)) return r.continue(); escaped.push(u); return r.abort(); });
const page = await ctx.newPage();
const errs = []; page.on('pageerror', e => errs.push(String(e))); page.on('console', m => m.type() === 'error' && errs.push(m.text()));
const cdp = await ctx.newCDPSession(page);
const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
const sleep = ms => page.waitForTimeout(ms);
async function press(x, y, holdMs) { await touch('touchStart', x, y); try { await sleep(holdMs); } finally { await touch('touchEnd'); } await sleep(400); }
async function drag(sx, sy, tx, ty, holdMs, steps = 16) {
  await touch('touchStart', sx, sy);
  try { await sleep(holdMs); for (let i = 1; i <= steps; i++) { await touch('touchMove', sx + (tx - sx) * i / steps, sy + (ty - sy) * i / steps); await sleep(22); } await sleep(80); }
  finally { await touch('touchEnd'); }
  await sleep(600);
}
const center = async loc => { const r = await loc.boundingBox(); return [r.x + r.width / 2, r.y + r.height / 2, r]; };
let n = 0; const shot = async name => page.screenshot({ path: `${OUT}${String(++n).padStart(2, '0')}-${name}.png` });
const log = [];
const note = (k, v) => { log.push([k, v]); console.log(k, typeof v === 'string' ? v : JSON.stringify(v)); };

// 每次走查前把开发库重置回种子（生产快照的拷贝，env 改成 dev）
{
  const snap = JSON.parse(fs.readFileSync(SEED, 'utf-8'));
  snap.env = 'dev';
  fs.writeFileSync(DB_FILE, JSON.stringify(snap));
}
await page.goto('http://localhost:3100'); await page.waitForSelector('nav button'); await sleep(2500);
note('timeline cards', await page.locator('[data-testid^="timeline-session-"]').count());

// 开练：练胸
await page.getByRole('button', { name: /开始训练/ }).first().tap(); await sleep(600);
const dlg = page.locator('[role="dialog"]');
if (await dlg.isVisible().catch(() => false)) { note('resume prompt', await dlg.innerText()); await dlg.getByRole('button', { name: /新开一场/ }).tap(); await sleep(500); }
await page.getByRole('button', { name: /练胸/ }).first().tap(); await sleep(800);
const sheet = page.locator('[data-testid="picker-sheet"]');
note('board heads', (await sheet.locator('.region-head').allInnerTexts()).join(' '));
note('unassigned', (await sheet.locator('.region-unzone [data-testid="picker-sheet-exercise"]').allInnerTexts()).map(t => t.split('\n')[0]));
await shot('board-open');

// 整理：把三个自建动作拖进细分
await sheet.locator('[data-testid="region-arrange"]').tap(); await sleep(300);
await shot('arrange-on');
const moves = [['蝴蝶机夹胸', '中缝'], ['器械平板卧推', '中胸'], ['龙门架夹胸', '中缝']];
for (const [name, col] of moves) {
  const row = sheet.locator('.region-unzone [data-testid="picker-region-card"]', { hasText: name });
  await row.scrollIntoViewIfNeeded(); await sleep(200);
  const [sx, sy] = await center(row);
  const colEl = sheet.locator(`.region-col[aria-label="${col}"]`);
  const last = colEl.locator('[data-testid="picker-region-card"]').last();
  const r = await last.boundingBox();
  const target = r && r.y > 0 ? [r.x + r.width / 2, r.y + r.height + 12] : null;
  if (!target) { note('target not visible', col); continue; }
  await drag(sx, sy, target[0], target[1], 40);
  const inCol = (await colEl.locator('[data-testid="picker-region-card"]').allInnerTexts()).map(t => t.trim());
  note(`drag ${name} → ${col}`, inCol.includes(name) ? 'ok' : `FAIL ${inCol.join('|')}`);
}
await shot('after-drags');
const dismiss = page.locator('[data-testid="toast"] [aria-label="dismiss"]');
while (await dismiss.count()) await dismiss.first().tap({ timeout: 1000 }).catch(() => {});
await sheet.locator('[data-testid="region-arrange"]').tap(); await sleep(300);
await sheet.evaluate(() => document.querySelector('[data-testid="picker-sheet"] .overflow-y-auto')?.scrollTo(0, 0));

// 加两个动作：上斜哑铃卧推（有历史）+ 龙门架夹胸（自建）
for (const name of ['上斜哑铃卧推', '龙门架夹胸']) {
  await sheet.locator('[data-testid="picker-region-card"]', { hasText: name }).first().tap(); await sleep(400);
}
note('added pill', await sheet.locator('text=/本次已加/').first().innerText().catch(() => null));
await shot('picked-two');
await sheet.locator('[data-testid="picker-sheet-close"]').tap(); await sleep(700);
await shot('bench');
const rows = page.locator('.ledger-row');
note('rows', await rows.count());
note('ghost rows', await page.locator('.ledger-row.is-ghost').count());
note('step strips', await page.locator('[data-testid="weight-step"]').count());
note('first card meta', await page.locator('.ui-card').first().locator('.font-mono.text-label').last().innerText().catch(() => null));

// 第一组：+5，点组号做完
// ±5 在书签正下方那一组：先找到它属于哪张卡哪一行
const stepIdx = await page.locator('[data-testid="weight-step"]').getAttribute('data-set-idx');
const stepCard = page.locator('.ui-card').filter({ has: page.locator('[data-testid="weight-step"]') });
note('step strip on', `${await stepCard.locator('h3').innerText()} 第 ${Number(stepIdx) + 1} 组`);
const w0 = stepCard.locator(`.ledger-row[data-set-idx="${stepIdx}"] [data-testid="ledger-field-weight"] input`);
const before = await w0.inputValue();
await page.locator('[data-testid="weight-step"] button').last().tap(); await sleep(200);
note('+5', `${before} → ${await w0.inputValue()}`);
await page.locator('.ledger-row').first().locator('.set-num').tap(); await sleep(600);
note('row0 done', (await page.locator('.ledger-row').first().getAttribute('class')).includes('is-inked'));
note('step strip now under row', await page.locator('[data-testid="weight-step"]').getAttribute('data-set-idx'));
await shot('after-first-done');

// 第二组：直接点组号
await page.locator('.ledger-row').nth(1).locator('.set-num').tap(); await sleep(600);
// 长按组号加递减（触摸）
const [nx, ny] = await center(page.locator('.ledger-row').nth(1).locator('.set-num'));
await press(nx, ny, 700);
note('subrows', await page.locator('.ledger-subrow').count());
await shot('drop-set');

// 换练法：第一张卡
const card0 = page.locator('.ui-card').filter({ has: page.locator('.ledger-row') }).first();
await card0.getByRole('button', { name: /动作菜单/ }).tap(); await sleep(200);
await card0.getByRole('menuitem', { name: /^练法$/ }).tap(); await sleep(400);
await shot('variant-modal');
await page.locator('[data-testid="variant-modal"]').getByRole('button', { name: /^宽握$/ }).tap(); await sleep(500);
note('variant mark', await card0.locator('[data-testid="variant-marginalia"]').innerText().catch(() => null));
note('rows after variant (done rows kept)', await card0.locator('.ledger-row').count());

// 删一组 + 撤销
const cnt = await card0.locator('.ledger-row').count();
await card0.locator('[data-testid="set-remove"]').last().tap(); await sleep(300);
note('delete', `${cnt} → ${await card0.locator('.ledger-row').count()}`);
await page.locator('[data-testid="toast-undo"]').last().tap(); await sleep(300);
note('undo', await card0.locator('.ledger-row').count());
await shot('bench-mid');
// ── 后半场 ──
// 第三组：改次数但不点完成 → 结束时要被点出来
const r2 = card0.locator('.ledger-row').nth(2);
await r2.locator('[data-testid="ledger-field-reps"] input').fill('9'); await sleep(200);
note('row2 edited stays to-do', (await r2.getAttribute('class')).includes('is-ghost'));
note('edited cell ink', await r2.locator('.ledger-field.is-edited').count());
await page.getByRole('button', { name: /结束训练/ }).first().tap(); await sleep(500);
const confirmText = await page.locator('[role="dialog"]').innerText();
note('end confirm', confirmText.replace(/\n+/g, ' / '));
await shot('end-confirm');
await page.locator('[role="dialog"]').getByRole('button', { name: /^结束训练$/ }).tap(); await sleep(2500);
const colo = page.locator('[data-testid="workout-colophon"]');
if (await colo.isVisible().catch(() => false)) { note('colophon', (await colo.innerText()).replace(/\n+/g, ' / ')); await shot('colophon'); await colo.tap(); await sleep(800); }
note('timeline first', (await page.locator('[data-testid^="timeline-session-"]').first().innerText()).replace(/\n+/g, ' / '));
await shot('timeline-after');
await page.getByRole('button', { name: /按动作 PR/ }).tap(); await sleep(500);
const prText = await page.locator('main').innerText();
note('PR has 宽握 row', /上斜哑铃卧推（宽握）/.test(prText));
note('PR has standard row', /上斜哑铃卧推\n/.test(prText));
await shot('pr-list');
await sleep(2500); // 等防抖推送落到开发库
const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
const latest = [...db.workouts].sort((a, b) => (b.date > a.date ? 1 : -1))[0];
note('devdb workouts', db.workouts.length);
note('devdb latest', latest.exercises.map(e => `${e.name}${e.variantName ? '·' + e.variantName : ''} ${e.sets.length}组 ghost=${e.sets.filter(x => x.ghost).length} touched=${e.sets.filter(x => x.touched).length}`));
const ce = db.prefs.customExercises.filter(c => ['蝴蝶机夹胸', '器械平板卧推', '龙门架夹胸'].includes(c.name.cn)).map(c => `${c.name.cn}:${c.region}#${c.regionRank}`);
note('devdb custom regions', ce);
note('devdb variants', Object.values(db.prefs.exerciseOverrides).filter(o => o.variants).map(o => o.variants.map(v => v.name)));
fs.writeFileSync(OUT + 'log1.json', JSON.stringify({ log, errs, escaped }, null, 1));
console.log('errs', errs, 'escaped', escaped);
await b.close();
