// 端到端：关键用户路径，对着跑着的 dev server（默认 http://localhost:3000，E2E_BASE 改地址）。
//
// ── 跑法 ──────────────────────────────────────────────────────────────────────
//   node scripts/e2e-smoke.mjs                         整套：主流程 ∥ 带夹具的几片 ∥ 备份（e2e-backup.mjs），同一个浏览器、各开各的 context
//   E2E_ONLY=seeded-gym node scripts/e2e-smoke.mjs     名字前缀，逗号分隔多个
//   E2E_ONLY=/^timeline/ node ...                      /正则/（可带 flags）；选中的步骤连同它的前置（递归）一起跑
//   E2E_SKIP_BACKUP=1                                  不跑备份那套
//   E2E_SERIAL=1                                       各套一个接一个跑（排查并行下才出的问题）
//   E2E_BASE=http://localhost:3100                     在 worktree 里必须指向 worktree 自己起的 dev server
// 依赖表在下面的 MAIN_STEPS / SEEDED_STEPS（备份的在 e2e-backup.mjs 的 BACKUP_STEPS），规则见 scripts/e2e-plan.mjs。
//
// 这里只走关键路径、盯状态（存储里的数、墓碑、类名、计数、远端快照），不盯文案和样式。
// 纯规则在 scripts/*-check.mjs（npm run check）；手感 / 观感在 docs/manual-check.md（真机手测）。
// 每步耗时收尾时打印（最慢 10 步），也写进 test-artifacts/report.json；失败的那一步留截图。

import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { parseOnly, planSuite, enterStep, describeSelection, printSlowest } from './e2e-plan.mjs';
import { BACKUP_STEPS, runBackup } from './e2e-backup.mjs';

/** 从 .env.local 读一个变量；文件不存在就返回空串（CI 上没有这个文件）。 */
function readEnvLocal(name) {
  try {
    const raw = fs.readFileSync(path.resolve('.env.local'), 'utf-8');
    const v = (raw.match(new RegExp(`${name}\\s*=\\s*(.+)`))?.[1] || '').trim();
    // dotenv 允许值被引号包裹，剥掉以和 Vite 行为一致
    const q = v.length >= 2 && ((v[0] === "'" && v.at(-1) === "'") || (v[0] === '"' && v.at(-1) === '"'));
    return q ? v.slice(1, -1) : v;
  } catch {
    return '';
  }
}

/** 把 URL 转义成可安全嵌进 RegExp 的字面量。 */
function escapeRe(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const BASE = process.env.E2E_BASE || 'http://localhost:3000';

// 个人服务器地址：与 services/fitlogRemote.ts 的 DEFAULT_API_BASE_URL 保持一致。
// 必须用 Tailscale 主机名，不能用 IP —— Tailscale Serve 按 Host 头路由，打 IP 会 404。
const DEFAULT_API_BASE_URL = 'https://hometj.taild995c6.ts.net';
const API_BASE = (
  process.env.E2E_API_BASE ||
  readEnvLocal('VITE_API_URL') ||
  DEFAULT_API_BASE_URL
).replace(/\/$/, '');
const OUT = path.resolve('test-artifacts');
fs.mkdirSync(OUT, { recursive: true });

const report = { base: BASE, startedAt: new Date().toISOString(), steps: [], consoleErrors: [], pageErrors: [] };

function logStep(name, status, detail, tag = '') {
  const entry = { name, status, detail, ts: new Date().toISOString() };
  report.steps.push(entry);
  const symbol = status === 'pass' ? '✓' : status === 'fail' ? '✗' : '·';
  console.log(`${tag}  ${symbol} ${name}${detail ? ' — ' + detail : ''}`);
  return entry;
}

/**
 * 轮询到 fn() 为真，超时抛错。只用来等「终将成立的正向条件」（PUT 落地、存储写完、元素出现），等完照样断言 ——
 * 条件不成立就超时报错，不会变成永远绿。「不该发生」的断言不能这么等（一进来就成立），那种要等它的起因先发生。
 */
/** 超时过的条件等待（有些调用点 catch 掉、交给后面的断言报错）：收尾时列出来，白等的地方一眼可见 */
const UNTIL_TIMEOUTS = [];
async function until(fn, what, timeout = 5_000, interval = 40) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > timeout) {
      UNTIL_TIMEOUTS.push(what);
      throw new Error(`timed out after ${timeout}ms waiting for ${what}`);
    }
    await new Promise(r => setTimeout(r, interval));
  }
}

/**
 * 等页面过三帧：这一次提交的 effect 跑完、effect 里 setState 引起的重渲染也画完。
 * 替换「点完等 300ms 再读界面」那类等渲染的 sleep（约 50ms）；读的东西要是异步写（存储、网络），用 until。
 */
const settle = page => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r)))));

/** 等元素位置稳定（scrollIntoView 可能是平滑滚动）：连续两次取到的框一样 */
async function stableBox(loc) {
  let prev = await loc.boundingBox();
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 40));
    const box = await loc.boundingBox();
    if (box && prev && box.x === prev.x && box.y === prev.y && box.height === prev.height) return box;
    prev = box;
  }
  return prev;
}

/**
 * 长按：真实阈值 500ms（useLongPress：120 静默 + 380 进度线），按 550 留 50ms 余量。
 * 注意 400ms 是删除确认的时长，不是长按阈值。
 */
const HOLD_MS = 550;

/**
 * 动作弹层的连点去重：同一张卡 450ms 内再点不算（ExercisePickerSheet）。这是业务上的时间判定，
 * 不能省 —— 只把「固定等 600ms」改成「从上一次点击算起凑够 470ms」，中间做的读取 / 断言不白等。
 */
const PICK_DEDUPE_MS = 470;
async function paceFrom(t0, ms) {
  const left = t0 + ms - Date.now();
  if (left > 0) await new Promise(r => setTimeout(r, left));
}

/** UiOverlayProvider 自定义确认框（非 window.confirm） */
async function acceptAppConfirm(page) {
  const dlg = page.locator('[role="dialog"]');
  await dlg.waitFor({ state: 'visible', timeout: 5_000 });
  await dlg
    .locator('button')
    .filter({ hasText: /^(确定|OK|保存|Save|Delete|删除|结束训练|End Workout)$/ })
    .last()
    .click();
  await dlg.waitFor({ state: 'detached', timeout: 5_000 });
}

/** 点确认框里指定文案的那个按钮（确认 / 取消都走这里） */
async function clickAppConfirm(page, labelRe) {
  const dlg = page.locator('[role="dialog"]');
  await dlg.waitFor({ state: 'visible', timeout: 5_000 });
  await dlg.locator('button').filter({ hasText: labelRe }).last().click();
  await dlg.waitFor({ state: 'detached', timeout: 5_000 });
}

/**
 * 开练先选馆：点了开练的那一下之后，弹「这场在哪个馆练」就选第一个；一个馆都没有时直接是「新的馆」表单，
 * 起个名存好（就在这个馆开）。没弹（接回进行中的那场之类）就什么都不做。等到选馆弹层关掉、新建页出来才返回。
 */
async function pickStartGym(page, name = 'E2E Gym') {
  const ready = page.locator('[data-testid="finish-button"]');
  const picker = page.locator('[data-testid="gym-picker"]');
  const form = page.locator('[data-testid="gym-profile-form"]');
  await ready.or(picker).or(form).first().waitFor({ timeout: 5_000 });
  if (await form.isVisible().catch(() => false)) {
    await page.locator('[data-testid="gym-profile-name"]').fill(name);
    await page.locator('[data-testid="gym-profile-save"]').click();
    await form.waitFor({ state: 'detached', timeout: 3_000 });
  } else if (await picker.isVisible().catch(() => false)) {
    await picker.locator('[data-testid^="gym-option-"]').first().click();
  }
  await picker.waitFor({ state: 'detached', timeout: 3_000 }).catch(() => {});
  await ready.first().waitFor({ timeout: 5_000 });
}

/**
 * 离开工作台并结束这场：按返回只离开页面、工作台原样留着（首页顶上「进行中」），
 * 再从首页「进行中 → 结束」：一组都没做完＝放弃；有改过数的组＝按做完入册（出刊末页，点掉）。
 */
async function backAndDiscard(page) {
  await page.getByLabel(/^返回$|^Back$/).first().click();
  // 离开训练页＝底栏回来；弹了确认框的话停在训练页、底栏不回来
  await page.locator('nav').first().waitFor({ state: 'visible', timeout: 3_000 }).catch(() => {});
  if (await page.locator('[role="dialog"]').isVisible().catch(() => false)) {
    throw new Error('back from an in-progress workout should not ask anything any more');
  }
  const row = page.locator('[data-testid="in-progress"]');
  // 返回落在来源页（比如计划页）时，「进行中」那一行在首页：去首页找
  if (!(await row.isVisible().catch(() => false))) {
    await page.locator('nav button', { hasText: /个人记录|PR Hub|Dashboard/ }).click();
  }
  // 空的新训练返回就没了，不留「进行中」：首页画好（底栏在）之后看一眼就够
  if (await row.waitFor({ state: 'visible', timeout: 1_000 }).then(() => true, () => false)) {
    await page.locator('[data-testid="in-progress-end"]').click();
    const dlg = page.locator('[role="dialog"]');
    await dlg.waitFor({ state: 'visible', timeout: 5_000 });
    const btn = dlg.locator('button').filter({ hasText: /^(放弃|Discard|结束训练|End Workout)$/ }).last();
    const finishing = /结束训练|End Workout/.test(await btn.innerText());
    await btn.click();
    await dlg.waitFor({ state: 'detached', timeout: 5_000 });
    await row.waitFor({ state: 'detached', timeout: 3_000 });
    // 按做完入册的会出刊末页（结束落库之后才弹）：等它出来再点掉
    if (finishing) await dismissColophon(page);
  }
}

async function dismissColophon(page) {
  const colo = page.locator('[data-testid="workout-colophon"]');
  await colo.waitFor({ state: 'visible', timeout: 5_000 });
  await colo.click();
  await colo.waitFor({ state: 'detached', timeout: 3_000 });
}

/**
 * 复位到首页：E2E_ONLY 跳过了中间的步骤时，在 home 步骤前调用（见 e2e-plan.mjs）。整套跑时不会触发。
 * 收掉刊末页 / 弹层，离开训练页并放弃进行中的那场，回到首页。
 */
async function resetHome(page) {
  const colo = page.locator('[data-testid="workout-colophon"]');
  if (await colo.isVisible().catch(() => false)) await colo.click();
  const dlg = page.locator('[role="dialog"]');
  if (await dlg.isVisible().catch(() => false)) {
    await page.keyboard.press('Escape');
    await dlg.waitFor({ state: 'detached', timeout: 3_000 }).catch(() => {});
  }
  // 弹层常驻挂载、关了只是移出屏幕：按「在不在视口里、能不能点」判断
  const onScreen = sel =>
    page.evaluate(s => {
      const el = document.querySelector(s);
      if (!el || el.closest('.pointer-events-none')) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.bottom > 0 && r.top < innerHeight;
    }, sel);
  for (const sel of ['[data-testid="picker-sheet-close"]', '[data-testid="prefs-sheet-close"]']) {
    if (await onScreen(sel)) await page.locator(sel).click();
  }
  if (await page.locator('[data-testid="ledger-field-weight"], [data-testid="open-picker-sheet"]').first().isVisible().catch(() => false)) {
    await backAndDiscard(page);
  }
  await page.locator('nav button', { hasText: /个人记录|PR Hub|Dashboard/ }).click();
  const row = page.locator('[data-testid="in-progress"]');
  if (await row.isVisible().catch(() => false)) {
    await page.locator('[data-testid="in-progress-end"]').click();
    await clickAppConfirm(page, /^(放弃|Discard|结束训练|End Workout)$/);
    if (await colo.isVisible().catch(() => false)) await colo.click();
  }
}

/** 时间线卡片的长按菜单：先居中（贴顶会被吸顶页头盖住），按住过阈值，等菜单项的 350ms 静默期过去再点 */
async function longPress(page, loc, at = 'center') {
  await loc.evaluate(el => el.scrollIntoView({ block: 'center' }));
  const box = await stableBox(loc);
  const x = at === 'top-right' ? box.x + box.width - 60 : box.x + box.width / 2;
  const y = at === 'top-right' ? box.y + 32 : box.y + Math.min(box.height / 2, 30);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.waitForTimeout(HOLD_MS);
  await page.mouse.up();
}
async function sessionMenu(page, card, itemRe) {
  await longPress(page, card);
  const menu = page.locator('[data-testid="timeline-session-menu"]');
  await menu.waitFor({ state: 'visible', timeout: 3_000 });
  await page.waitForTimeout(400); // 菜单项的 350ms 静默期（防长按松手误触）
  await menu.getByRole('menuitem').filter({ hasText: itemRe }).click();
}

/**
 * 步骤依赖表（规则见 scripts/e2e-plan.mjs）。[名字, 直接前置?（省略＝上一步）, { home }?]
 * 主流程从空库走：每条是一条完整的用户路径，只写真正要的前置。
 */
const H = { home: true };
const MAIN_STEPS = [
  ['cold-load', []],
  // 落下的那场训练是时间线那条的靶子（finishedWorkoutId）
  ['plan-to-linked-workout', ['cold-load'], H],
  ['timeline-ops', ['plan-to-linked-workout'], H],
  ['workout-log-sets', ['cold-load'], H],
  // 全局撤销 / 重做（services/undoJournal.ts）：一下一步，撤销结束训练回到工作台
  ['global-undo', ['cold-load'], H],
  // 接回「最近结束的那一场」（10 分钟内）：至少要有计划那场
  ['resume-recent-workout', ['plan-to-linked-workout'], H],
  ['no-real-backend-calls', [], { always: true }],
];

/**
 * 带夹具的场景：每片一个干净的 context（各自的夹具和 mock 远端），片与片并行。
 * 片内接着上一条往下走（同一页、同一份远端），每条都从首页开始。
 */
const SEEDED_STEPS = [
  ['seeded-load', []],
  ['seeded-history-edit', ['seeded-load'], H],
  ['seeded-sync-contract', ['seeded-load'], H],
  ['seeded-profile-data', ['seeded-load'], H],
  ['seeded-picker-and-library', ['seeded-load'], H],
  ['seeded-resumed-emptied-keeps-workout', ['seeded-load'], H],
  ['seeded-plan-target-unit', ['seeded-load'], H],
  ['seeded-gym-profile-and-switch', ['seeded-load'], H],
];
/** 分片：每片一个 context。按耗时大致摊平 */
const SEEDED_SHARDS = [
  ['seeded-history-edit', 'seeded-sync-contract', 'seeded-profile-data'],
  ['seeded-picker-and-library', 'seeded-resumed-emptied-keeps-workout'],
  ['seeded-plan-target-unit', 'seeded-gym-profile-and-switch'],
];

const ONLY = parseOnly(process.env.E2E_ONLY);
const MAIN_PLAN = planSuite('主流程', MAIN_STEPS, ONLY);
const SEEDED_PLAN = planSuite('带夹具', SEEDED_STEPS, ONLY);
const BACKUP_PLAN = planSuite('备份', BACKUP_STEPS, process.env.E2E_SKIP_BACKUP ? parseOnly('/^$/') : ONLY);
const timings = new Map([[MAIN_PLAN, []], [SEEDED_PLAN, []]]);
{
  const sharded = SEEDED_SHARDS.flat();
  for (const n of SEEDED_PLAN.names) if (n !== 'seeded-load' && !sharded.includes(n)) throw new Error(`${n} is not in any SEEDED_SHARDS entry`);
}

/**
 * 跑一步。plan 是这一片自己的运行状态（planSuite 的结果按片复制一份：enterStep 记的「上一步 / 跳过没」各片分开）。
 */
async function step(plan, page, name, fn, tag = '') {
  if (!plan.names.includes(name)) throw new Error(`step "${name}" is not declared in ${plan.label} — 先在依赖表里声明`);
  if (!(await enterStep(plan, name, () => resetHome(page)))) return;
  process.stdout.write(`${tag}▶ ${name}\n`);
  const t0 = Date.now();
  let entry;
  try {
    const detail = await fn();
    entry = logStep(name, 'pass', detail, tag);
  } catch (err) {
    entry = logStep(name, 'fail', err.message, tag);
    await page.screenshot({ path: path.join(OUT, `FAIL-${name}.png`) }).catch(() => {});
    throw err;
  } finally {
    const ms = Date.now() - t0;
    timings.get(plan.base ?? plan).push({ name, ms });
    if (entry) entry.ms = ms;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 带夹具的场景
//
// 主流程从空库走，造不出「历史里有一场昨晚 9 点的训练」「两个自建动作原名撞车」这种数据。
// 这里另开干净的 context：远端 mock 在第一次 GET 时吐一份旧格式快照当夹具，App 启动时照常拉取合并，
// 就等于「用户带着这些历史打开 App」。时区钉在 America/Toronto（用户所在地）。
// ─────────────────────────────────────────────────────────────────────────────

const TZ = 'America/Toronto';
const LBS = 2.20462;

/** 多伦多当地「N 天前的 YYYY-MM-DD」 */
function torontoYmd(daysAgo) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
  const [y, m, d] = today.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d - daysAgo));
  return t.toISOString().slice(0, 10);
}

/** 多伦多当地 ymd 的 h:m 对应的绝对时刻（夏令时 −4、冬令时 −5，试出来是哪个） */
function torontoAt(ymd, h, m) {
  const [y, mo, d] = ymd.split('-').map(Number);
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  for (const off of [4, 5]) {
    const t = new Date(Date.UTC(y, mo - 1, d, h + off, m));
    const p = Object.fromEntries(fmt.formatToParts(t).map(x => [x.type, x.value]));
    if (`${p.year}-${p.month}-${p.day}` === ymd && Number(p.hour) === h) return t;
  }
  throw new Error(`cannot place ${ymd} ${h}:${m} in ${TZ}`);
}

function seedWorkout(id, at, title, exName, sets) {
  const iso = at.toISOString();
  return {
    id,
    userId: 'u_guest',
    date: iso,
    title,
    status: 'completed',
    finishedAt: iso,
    updatedAt: iso,
    exercises: [
      {
        id: `${id}_ex`,
        name: exName,
        category: 'STRENGTH',
        sets: sets.map(([weight, reps], i) => ({ id: `${id}_s${i}`, weight, reps })),
      },
    ],
  };
}

const threeDaysAgo = torontoYmd(3);
const W_HEAT = seedWorkout('seed_heat', torontoAt(torontoYmd(1), 21, 15), 'E2E 昨晚', '杠铃平板卧推', [
  [185 / LBS, 5],
  [185 / LBS, 5],
  [185 / LBS, 5],
]);
const W_DATE = seedWorkout('seed_date', torontoAt(threeDaysAgo, 14, 33), 'E2E 改时间', '哑铃平板卧推', [[20, 10]]);
const W_DEL = seedWorkout('seed_del', torontoAt(torontoYmd(5), 10, 0), 'E2E 待删', '杠铃深蹲', [[60, 5]]);
// 自建动作 C：动作库删除 / 同名新建恢复的靶子
const DEF_C = { id: '1779000000000', name: { cn: 'E2E自建甲', en: 'E2E自建甲' }, bodyPart: 'subChest', tags: [], category: 'STRENGTH' };

const seedSnapshot = () => ({
  schemaVersion: 2,
  workouts: [W_HEAT, W_DATE, W_DEL],
  goals: [],
  weightLogs: [],
  customMetrics: [],
  prs: [],
  scheduledWorkouts: [],
  prefs: {
    customTags: [],
    customExercises: [DEF_C],
    exerciseNotes: {},
    starredExercises: {},
    exerciseMetricConfigs: {},
    tagRenameOverrides: {},
    exerciseOverrides: {},
    starredLastUpdateMs: 0,
    metricsLastUpdateMs: 0,
    prefsLastUpdateMs: Date.now(),
    lang: 'cn',
    unit: 'lbs',
  },
  tombstones: {},
});

/** 开一片：干净的 context + mock 远端 + 页面里的小工具 */
async function openSeeded(browser, escapedRemoteCalls, tag) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    colorScheme: 'light',
    locale: 'zh-CN',
    timezoneId: TZ,
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();

  // gets / puts / putAttempts：等「拉取 / 推送真的发生了」用（putAttempts 连被拒的也算）
  const remote = { snapshot: seedSnapshot(), failPuts: false, failGets: false, gets: 0, puts: 0, putAttempts: 0 };
  const apiHostPattern = new RegExp(`^${escapeRe(API_BASE)}(:\\d+)?/api/fitlog/state.*`);
  const escapedApiHost = new RegExp(`^${escapeRe(API_BASE)}(:\\d+)?/.*`);
  await context.route(escapedApiHost, async route => {
    escapedRemoteCalls.push(`${route.request().method()} ${route.request().url()}`);
    return route.abort();
  });
  await context.route(apiHostPattern, async route => {
    const req = route.request();
    if (req.method() === 'GET') {
      remote.gets++;
      if (remote.failGets) return route.abort(); // 模拟「拉取没拿到」（NAS 不通）
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(remote.snapshot) });
    }
    if (req.method() === 'PUT') {
      remote.putAttempts++;
      if (remote.failPuts) return route.abort(); // 模拟「推送没送到」（离线 / NAS 不通）
      remote.puts++;
      try {
        remote.snapshot = JSON.parse(req.postData() || '{}');
      } catch {}
      return route.fulfill({ status: 200, body: 'ok' });
    }
    return route.continue();
  });

  const ignoredConsole = ['SW registration failed', 'Failed to load resource', 'ERR_CONNECTION_TIMED_OUT', 'ERR_NAME_NOT_RESOLVED'];
  // 某条用例故意制造的报错：只在那条用例期间放行
  const expectedConsole = new Set();
  page.on('console', msg => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (ignoredConsole.some(s => text.includes(s))) return;
    if ([...expectedConsole].some(s => text.includes(s))) return;
    report.consoleErrors.push(`${tag} ${text}`);
    console.log(`${tag}    [console.error] ${text}`);
  });
  page.on('pageerror', err => {
    report.pageErrors.push(`${tag} ${err}`);
    console.log(`${tag}    [pageerror] ${err}`);
  });

  // 只在第一次打开时清空：后面要 reload 模拟「重开 App」，不能把本机数据一起抹掉
  await page.addInitScript(() => {
    try {
      if (!sessionStorage.getItem('__e2e_seeded_clean')) {
        sessionStorage.setItem('__e2e_seeded_clean', '1');
        localStorage.clear();
        indexedDB.databases?.().then(dbs => dbs.forEach(d => d.name && indexedDB.deleteDatabase(d.name)));
      }
    } catch {}
    window.lsKey = key => {
      const env = window.__fitlog?.env?.().env;
      return env === 'dev' ? `dev:${key}` : key;
    };
  });

  const card = id => page.locator(`[data-testid="timeline-session-${id}"]`);
  // 种子里的 W_HEAT 全程都在：它出现＝首页（时间线）画好了
  const toDashboard = async () => {
    await page.locator('nav button', { hasText: /个人记录|PR Hub|Dashboard/ }).click();
    await card(W_HEAT.id).waitFor({ state: 'visible', timeout: 5_000 });
  };
  /**
   * 让同步安静下来：取消排队中的防抖推送，再立刻推一次（等这次 PUT 落地）。之后不会再有晚到的 PUT
   * 盖掉接下来往远端塞的夹具。走 window.__fitlog.cancelPendingPush（index.tsx）：从测试里 import 调度器模块不行 ——
   * HMR 之后 App 用的是带 ?t= 的那个实例，按裸 URL import 拿到的是另一个，取消不了 App 的定时器。
   */
  const quiesce = () =>
    page.evaluate(async () => {
      window.__fitlog.cancelPendingPush();
      await window.__fitlog.flush();
    });
  /**
   * 重开 App：reload 之后等启动流程（拉取合并 → 应用 prefs → 重读本地库）走完 ——
   * useFitlogSync 在最后给 <html> 打 data-fitlog-boot="done"。不能拿「时间线卡片出来了」当信号：
   * WorkoutContext 挂载时先从本地库读一遍，卡片比拉取合并早，否定断言会在合并之前判，假绿。
   */
  const relaunch = async () => {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('html[data-fitlog-boot="done"]').waitFor({ state: 'attached', timeout: 15_000 });
    await settle(page); // 重读本地库之后的那次渲染
    await toDashboard();
  };
  const menuOn = async (id, itemRe) => {
    // E2E_ONLY 单挑一步时可能不在首页
    if (!(await card(id).isVisible().catch(() => false))) await toDashboard();
    await sessionMenu(page, card(id), itemRe);
  };
  const readLs = key => page.evaluate(k => JSON.parse(localStorage.getItem(lsKey(k)) || 'null'), key);
  const workoutTombstones = async () => (await readLs('fitlog_tombstones'))?.workouts ?? [];
  const remoteSnap = () =>
    page.evaluate(async () => {
      await window.__fitlog.flush();
      return window.__fitlog.fetchRemote();
    });
  const remoteWorkout = async id => ((await remoteSnap())?.workouts || []).find(w => w.id === id) ?? null;
  const dismissToasts = async () => {
    const dismiss = page.locator('[data-testid="toast"] [aria-label="dismiss"]');
    while (await dismiss.count()) await dismiss.first().click({ timeout: 1_000 }).catch(() => {});
  };
  const startWorkout = async () => {
    await page.getByRole('button', { name: /开始训练|Start Workout/ }).first().click();
    await pickStartGym(page);
  };
  const addExercise = async name => {
    await page.locator('[data-testid="open-picker-sheet"]').click();
    const sheet = page.locator('[data-testid="picker-sheet"]');
    await sheet.locator('input[type="text"]').fill(name);
    await sheet.locator('[data-testid="picker-sheet-exercise"]', { hasText: name }).first().click();
    await page.locator('[data-testid="picker-sheet-close"]').click();
  };
  const weights = () => page.locator('.ledger-row [data-testid="ledger-field-weight"] input').evaluateAll(els => els.map(e => Number(e.value)));

  return {
    context, page, remote, expectedConsole,
    card, toDashboard, quiesce, relaunch, menuOn, readLs, workoutTombstones, remoteSnap, remoteWorkout, dismissToasts, startWorkout, addExercise, weights,
  };
}

/** 带夹具的每一条：拿到 openSeeded 的工具 */
const SEEDED = {
  'seeded-load': async ({ page, card, readLs }) => {
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await card(W_HEAT.id).waitFor({ state: 'visible', timeout: 10_000 });
    const unit = await page.evaluate(() => localStorage.getItem(lsKey('fitlog_unit')));
    if (unit !== 'lbs') throw new Error(`seed unit not applied (${unit})`);
    if (!(await readLs('fitlog_custom_exercises'))?.some(d => d.id === DEF_C.id)) throw new Error('seed custom exercise not applied');
    return `seeded ${W_HEAT.id}… , unit ${unit}, tz ${TZ}`;
  },

  // 看历史、改旧训练：
  //  set-number-all-one：时间线展开后组号是 1、2、3，不是 1、1、1
  //  datepicker-stale-initial：打开日期选择器不动直接确定，日期不能变（编辑态不亮「已修改」）
  //  edit-history-*：改的是草稿 —— 没改保存键灰着、改了不落库、「放弃修改」真的丢；
  //  「保存修改」才写库，不动日期和 finishedAt、不出刊末页（否则 10 分钟内开练会被问「继续」这场旧训练）
  'seeded-history-edit': async ({ page, card, toDashboard, menuOn, remoteWorkout, dismissToasts }) => {
    await toDashboard();
    await card(W_HEAT.id).click();
    const nums = card(W_HEAT.id).locator('.set-num');
    await nums.first().waitFor({ state: 'visible', timeout: 3_000 });
    const got = (await nums.allInnerTexts()).map(t => t.trim().match(/^\d+/)?.[0]);
    if (got.join(',') !== '1,2,3') throw new Error(`set numbers ${JSON.stringify(got)}, expected 1,2,3`);
    await card(W_HEAT.id).click(); // 收起

    const editPage = page.locator('text=/编辑训练|Edit Workout/');
    const dirty = page.locator('[data-testid="edit-dirty"]');
    const save = page.locator('[data-testid="finish-button"]');
    const reps0 = () => page.locator('.ledger-row').first().locator('[data-testid="ledger-field-reps"] input');
    const repsInDb = async () => (await remoteWorkout(W_DATE.id))?.exercises?.[0]?.sets?.[0]?.reps;
    const openEdit = async () => {
      await menuOn(W_DATE.id, /编辑这次训练|Edit/);
      await editPage.first().waitFor({ timeout: 5_000 });
    };

    await openEdit();
    await page.getByTitle(/修改训练日期|Change workout date/).click();
    const dlg = page.locator('[role="dialog"]');
    await dlg.waitFor({ state: 'visible', timeout: 3_000 });
    await dlg.getByRole('button', { name: /^(确定|Confirm)$/ }).click();
    // 「确定」在同一个处理函数里写日期、关弹窗：弹窗没了时「已修改」该亮早就亮了
    await dlg.waitFor({ state: 'detached', timeout: 3_000 });
    if (await dirty.count()) throw new Error('confirming the untouched date picker changed the workout (edit shows 已修改)');
    if (!(await save.isDisabled())) throw new Error('save button is enabled before any change');
    await reps0().fill('99');
    await dirty.waitFor({ state: 'visible', timeout: 3_000 });
    if (await save.isDisabled()) throw new Error('save button still disabled after an edit');
    if ((await repsInDb()) !== 10) throw new Error(`the draft leaked into the db (reps=${await repsInDb()})`);

    await page.getByRole('button', { name: /^返回$|^Back$/ }).click();
    await clickAppConfirm(page, /^(放弃修改|Discard)$/);
    await editPage.first().waitFor({ state: 'detached', timeout: 3_000 });
    if ((await repsInDb()) !== 10) throw new Error(`「放弃修改」kept the edit (reps=${await repsInDb()})`);

    await openEdit();
    if ((await reps0().inputValue()) !== '10') throw new Error('discarded edit is still on the bench');
    await reps0().fill('12');
    await dirty.waitFor({ state: 'visible', timeout: 3_000 });
    await save.click();
    await editPage.first().waitFor({ state: 'detached', timeout: 5_000 });
    // 「不该出刊末页」是否定断言：刊末页是结束落库之后才弹，留一个和原来一样的窗口
    await page.waitForTimeout(300);
    if (await page.locator('[data-testid="workout-colophon"]').isVisible().catch(() => false)) throw new Error('saving an edit replayed the colophon');
    const w = await remoteWorkout(W_DATE.id);
    if (w.exercises[0].sets[0].reps !== 12) throw new Error(`save did not write (reps=${w.exercises[0].sets[0].reps})`);
    if (w.finishedAt !== W_DATE.finishedAt) throw new Error(`save moved finishedAt ${W_DATE.finishedAt} → ${w.finishedAt}`);
    const local = await page.evaluate(iso => {
      const d = new Date(iso);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${d.getHours()}:${d.getMinutes()}`;
    }, w.date);
    if (local !== `${threeDaysAgo} 14:33`) throw new Error(`the edit moved the workout to ${local} (was ${threeDaysAgo} 14:33)`);
    await dismissToasts();
    return 'set nums 1,2,3 · untouched picker clean · draft not persisted · discard drops · save writes reps only';
  },

  // 同步契约：
  //  workout-delete-no-tombstone：推送没送到时删一场，重开 App 拉取旧快照，它不能回来
  //  手动同步：拉取失败时绝不能接着推送（没读到远端就推 = 拿本地盖掉远端）。先跑一遍拉取正常的当对照。
  //  这段放在删除那段前面：推送失败过的删除，重开后会自己补推，补推落在「不该推」的窗口里就分不清是谁推的
  'seeded-sync-contract': async ({ page, remote, expectedConsole, card, menuOn, relaunch, quiesce, dismissToasts }) => {
    await quiesce();
    const sync = page.locator('[data-testid="header-sync"]');
    const waitIdle = () => page.waitForFunction(() => !document.querySelector('[data-testid="header-sync"]')?.disabled, null, { timeout: 10_000 });
    let before = remote.puts;
    await sync.click();
    await until(() => remote.puts > before, 'the healthy sync to PUT').catch(() => {});
    await waitIdle();
    if (remote.puts <= before) throw new Error('control: sync with a healthy pull did not PUT');
    remote.failGets = true;
    expectedConsole.add('push skipped');
    try {
      before = remote.puts;
      const gets0 = remote.gets;
      await sync.click();
      // 这次拉取被拒之后才轮到「推不推」：先等拉取真的发出去了，再等按钮回到空闲
      await until(() => remote.gets > gets0, 'the sync to attempt a pull');
      await waitIdle();
      // 「不该推」是否定断言：拉取失败后留 1 s 看有没有补推
      await page.waitForTimeout(1_000);
      if (remote.puts !== before) throw new Error(`pull failed but sync still PUT ${remote.puts - before}x`);
      if (!/bg-danger/.test((await sync.getAttribute('class')) || '')) throw new Error('sync button should show the error state after a failed pull');
    } finally {
      remote.failGets = false;
      expectedConsole.delete('push skipped');
    }
    await dismissToasts();

    remote.failPuts = true;
    const attempts0 = remote.putAttempts;
    await menuOn(W_DEL.id, /删除|Delete/);
    await card(W_DEL.id).waitFor({ state: 'detached', timeout: 3_000 });
    // 删除和墓碑是当场写的：等删除之后那次防抖推送真的试过、被拒
    await until(() => remote.putAttempts > attempts0, 'the debounced push after the delete to be attempted', 8_000);
    if (!(remote.snapshot.workouts || []).some(w => w.id === W_DEL.id)) throw new Error('fixture drift: the server copy should still have the deleted workout');
    await relaunch();
    remote.failPuts = false;
    if (await card(W_DEL.id).count()) throw new Error('deleted workout came back after reload — 推送失败时被拉取复活');
    await dismissToasts();
    return 'failed pull → no PUT; delete survives a failed push + stale pull';
  },

  // 「我的」页的数据：
  //  avatar-bloats-storage：头像缩成小 JPEG、只存一份（current_user 不再带）；旧版存的原图启动时缩一次
  //  体重目标建在 lbs 下：记一笔新体重后「当前」是 lbs 数（旧版直接写 kg）
  'seeded-profile-data': async ({ page, remote, relaunch, quiesce, remoteSnap }) => {
    const { default: sharp } = await import('sharp');
    const W = 900, Hh = 700;
    const noise = Buffer.alloc(W * Hh * 3);
    for (let i = 0; i < noise.length; i++) noise[i] = Math.floor(Math.random() * 256); // 真噪声：PNG 压不动，才像相册原图那么大
    const png = await sharp(noise, { raw: { width: W, height: Hh, channels: 3 } }).png().toBuffer();
    const bigDataUrl = `data:image/png;base64,${png.toString('base64')}`;
    const avatarState = () =>
      page.evaluate(() => {
        const a = localStorage.getItem(lsKey('fitlog_avatar_data_url')) || '';
        const u = JSON.parse(localStorage.getItem(lsKey('fitlog_current_user')) || '{}');
        return { len: a.length, jpeg: a.startsWith('data:image/jpeg'), userHasAvatar: 'avatarUrl' in u };
      });
    // 旧数据：两处各一整张原图；体重目标从远端拉下来
    await quiesce();
    const daysAgoIso = d => new Date(Date.now() - d * 86400000).toISOString();
    remote.snapshot = {
      ...remote.snapshot,
      weightLogs: [{ id: 'seed_w1', userId: 'u_guest', weight: 80, date: daysAgoIso(1), unit: 'kg' }],
      goals: [{
        id: 'seed_goal_w', userId: 'u_guest', type: 'weight', category: 'weight', title: 'E2E 减到 170', label: 'E2E 减到 170',
        targetValue: 170, currentValue: 180, unit: 'lbs', startDate: daysAgoIso(40), dataSource: 'manual',
        progressHistory: [], isActive: true, createdAt: daysAgoIso(40), updatedAt: daysAgoIso(40),
      }],
    };
    await page.evaluate(url => {
      localStorage.setItem(lsKey('fitlog_avatar_data_url'), url);
      const u = JSON.parse(localStorage.getItem(lsKey('fitlog_current_user')) || '{}');
      localStorage.setItem(lsKey('fitlog_current_user'), JSON.stringify({ ...u, avatarUrl: url }));
    }, bigDataUrl);
    await relaunch();
    // 启动时缩旧图是异步的（解码 + 画布）：等存储里换成 JPEG，超时就是没缩
    const legacy = await until(async () => {
      const s = await avatarState();
      return s.jpeg && s;
    }, 'the legacy avatar to be re-encoded on start').catch(() => avatarState());
    if (!legacy.jpeg || legacy.len > 80_000) throw new Error(`legacy avatar not shrunk on start: ${JSON.stringify(legacy)} (was ${bigDataUrl.length} chars)`);
    if (legacy.userHasAvatar) throw new Error('fitlog_current_user still carries a second avatar copy');

    await page.getByRole('button', { name: '记录体重', exact: true }).click();
    const dlg = page.getByRole('dialog');
    await dlg.locator('.scrub-num input').fill('176.4');
    await dlg.getByRole('button', { name: '确定' }).click();
    await dlg.waitFor({ state: 'hidden', timeout: 3_000 });
    const goal = ((await remoteSnap())?.goals || []).find(g => g.id === 'seed_goal_w');
    if (goal?.currentValue !== 176.4) throw new Error(`goal currentValue should be 176.4 (lbs), got ${goal?.currentValue}`);

    // 新上传：先清掉存的那份，好看出这次上传写了什么
    await page.locator('nav button', { hasText: /^我的$|^Profile$/ }).click();
    await page.evaluate(() => localStorage.removeItem(lsKey('fitlog_avatar_data_url')));
    await page.locator('input[type="file"][accept="image/*"]').setInputFiles({ name: 'big.png', mimeType: 'image/png', buffer: png });
    const up = await until(async () => {
      const s = await avatarState();
      return s.len > 0 && s;
    }, 'the uploaded avatar to be stored').catch(() => avatarState());
    if (!up.jpeg || up.len > 80_000) throw new Error(`uploaded avatar not shrunk: ${JSON.stringify(up)}`);
    if (up.userHasAvatar) throw new Error('upload wrote a second avatar copy into fitlog_current_user');
    if (!(await page.locator('img[alt="Avatar"]').getAttribute('src'))?.startsWith('data:image/jpeg')) throw new Error('profile does not show the shrunk avatar');
    return `avatar legacy ${bigDataUrl.length} → ${legacy.len}, upload → ${up.len}; goal current ${goal.currentValue} lbs`;
  },

  // 选动作 / 动作库：
  //  从动作库删除＝隐藏：不弹确认，定义留在 customExercises、覆盖层打 hidden；撤销摘掉，自建列表顺序不变
  //  remove-last-exercise-not-persisted：新训练删光动作 → 这场从库里删掉（写墓碑）；删了再加回来照常落盘
  //  弹层里本次加过的再点一下＝取消；「完成」关弹层；卡头「底稿」点开看上次的几组
  //  hidden-builtin-name-locked：用删掉的动作名新建＝把它恢复出来（不建第二个同名的）
  'seeded-picker-and-library': async ({ page, card, readLs, workoutTombstones, remoteWorkout, dismissToasts, startWorkout }) => {
    const sheet = page.locator('[data-testid="picker-sheet"]');
    const search = sheet.locator('input[type="text"]');
    const menu = page.locator('[data-testid="row-action-menu"]');
    const customIds = async () => ((await readLs('fitlog_custom_exercises')) || []).map(d => d.id).join(',');
    const hidden = async () => !!(await readLs('fitlog_exercise_overrides'))?.[DEF_C.id]?.hidden;
    const deleteFromLibrary = async row => {
      await longPress(page, row);
      await menu.waitFor({ state: 'visible', timeout: 3_000 });
      await menu.getByRole('button', { name: /从动作库删除|Delete from library/ }).click();
      // 删掉之后出撤销条（同一个处理函数里先写覆盖层、再弹条）；要是弹的是确认框，就没有撤销条
      await page.locator('[data-testid="toast-undo"]').last().waitFor({ state: 'visible', timeout: 3_000 }).catch(() => {});
    };

    const before = await customIds();
    await startWorkout();
    await page.locator('[data-testid="open-picker-sheet"]').click();
    await search.fill('E2E自建甲');
    const row = sheet.locator('[data-testid="picker-sheet-exercise"]', { hasText: 'E2E自建甲' }).first();
    await row.waitFor({ state: 'visible', timeout: 3_000 });
    await deleteFromLibrary(row);
    if (await page.locator('[role="dialog"]').isVisible().catch(() => false)) throw new Error('library delete asked for confirmation');
    if ((await customIds()) !== before) throw new Error('delete removed the custom definition');
    if (!(await hidden())) throw new Error('delete did not mark it hidden');
    if (await row.isVisible().catch(() => false)) throw new Error('hidden exercise still listed');
    await page.locator('[data-testid="toast-undo"]').last().click();
    await row.waitFor({ state: 'visible', timeout: 3_000 });
    if (await hidden()) throw new Error('undo did not unhide');
    if ((await customIds()) !== before) throw new Error('undo changed the custom list order');
    await search.fill('');
    await page.locator('[data-testid="picker-sheet-close"]').click();
    await dismissToasts();

    // 删光动作：已经在空的新训练里
    const exCards = page.locator('.ui-card').filter({ has: page.locator('[data-testid="ledger-field-weight"]') });
    const exCard = exCards.first();
    const addFirst = async () => {
      await page.locator('[data-testid="open-picker-sheet"]').click();
      await sheet.locator('[data-testid="picker-sheet-exercise"]').first().click();
      await page.locator('[data-testid="picker-sheet-close"]').click();
      await exCard.waitFor({ state: 'visible', timeout: 3_000 });
    };
    const removeIt = async () => {
      await exCard.getByRole('button', { name: /动作菜单|Exercise menu/ }).click();
      await exCard.getByRole('menuitem', { name: /删除动作|Delete exercise/ }).click();
      await exCard.waitFor({ state: 'detached', timeout: 3_000 });
    };
    await addFirst();
    const t0 = await workoutTombstones();
    await removeIt();
    const t1 = await until(async () => {
      const t = await workoutTombstones();
      return t.length > t0.length && t;
    }, 'emptying a new workout to write a workout tombstone').catch(() => workoutTombstones());
    const added = t1.filter(x => !t0.includes(x));
    if (added.length !== 1) throw new Error(`emptying a new workout should tombstone it, got ${JSON.stringify(added)}`);
    const wid = added[0];
    if (await page.locator('[data-testid="toast-undo"]').count()) throw new Error('deleting an exercise still shows an undo toast');
    const remoteIds = () =>
      page.evaluate(async () => {
        await window.__fitlog.flush();
        return ((await window.__fitlog.fetchRemote())?.workouts || []).map(w => w.id);
      });
    const ids0 = await remoteIds();
    await addFirst();
    // 工作台落本地库是异步的：等远端（flush 之后）出现一条新的，再判它对不对
    const fresh = await until(async () => {
      const f = (await remoteIds()).filter(id => !ids0.includes(id));
      return f.length && f;
    }, 'the re-added workout to persist').catch(() => []);
    if (fresh.length !== 1 || fresh[0] === wid || (await workoutTombstones()).includes(fresh[0])) {
      throw new Error(`re-adding after emptying should persist under a new id, got ${JSON.stringify(fresh)} (old ${wid})`);
    }
    await removeIt();
    await page.getByLabel(/^返回$|^Back$/).first().click();
    // 离开＝底栏回来；问了什么就先确认
    await page.locator('nav').first().waitFor({ state: 'visible', timeout: 3_000 }).catch(() => {});
    if (await page.locator('[role="dialog"]').isVisible().catch(() => false)) await acceptAppConfirm(page);
    await card(W_HEAT.id).waitFor({ state: 'visible', timeout: 5_000 });
    if (await card(wid).count()) throw new Error('emptied workout still shows on the timeline');
    if (await remoteWorkout(wid)) throw new Error('emptied workout still in the snapshot');

    // 点一下加、再点一下取消、底部「完成」关弹层；底稿抄自上次 → 卡头点开看那次的几组
    await startWorkout();
    await page.locator('[data-testid="open-picker-sheet"]').click();
    await search.fill('杠铃平板卧推');
    const bench = sheet.locator('[data-testid="picker-sheet-exercise"]', { hasText: '杠铃平板卧推' }).first();
    await bench.click();
    let tapAt = Date.now();
    await until(async () => (await exCards.count()) >= 1, 'the tap to add a card');
    await paceFrom(tapAt, PICK_DEDUPE_MS);
    // 过了去重窗口再数：一下加出两张（pointerup + click 各算一次）这时也该露出来了
    if ((await exCards.count()) !== 1) throw new Error(`one tap should add one card, got ${await exCards.count()}`);
    await bench.click(); // 再点＝取消本次添加
    tapAt = Date.now();
    await until(async () => (await exCards.count()) === 0, 'the second tap to cancel the add');
    await paceFrom(tapAt, PICK_DEDUPE_MS);
    if ((await exCards.count()) !== 0) throw new Error(`cancel did not stick: ${await exCards.count()} card(s)`);
    await bench.click();
    await until(async () => (await exCards.count()) === 1, 'the third tap to add again');
    await page.locator('[data-testid="picker-done"]').click();
    // 弹层常驻挂载、关了只是移出屏幕 + pointer-events-none，isVisible 看不出来，查类名
    await until(() => page.evaluate(() => !!document.querySelector('[data-testid="picker-sheet"]')?.closest('.pointer-events-none')), 'the sheet to close');
    await page.locator('[data-testid="prefill-from"]').first().click();
    await page.locator('[data-testid="prefill-last"]').first().waitFor({ state: 'visible', timeout: 3_000 });

    // 同名新建＝恢复：先从库里删掉 E2E自建甲，再用这个名字新建
    await page.locator('[data-testid="open-picker-sheet"]').click();
    await search.fill('E2E自建甲');
    await row.waitFor({ state: 'visible', timeout: 3_000 });
    await deleteFromLibrary(row);
    await dismissToasts();
    await search.fill('');
    await search.fill('E2E自建甲');
    await sheet.getByRole('button', { name: /没找到？创建「E2E自建甲」/ }).click();
    const dlg = page.locator('[role="dialog"]').filter({ has: page.locator('input') }).last();
    await dlg.waitFor({ state: 'visible', timeout: 3_000 });
    await dlg.getByRole('button', { name: /^(确定|Confirm)$/ }).click();
    // 建好＝弹窗关掉；被拒的话弹窗留着
    await dlg.waitFor({ state: 'detached', timeout: 3_000 }).catch(() => {});
    if (await dlg.isVisible().catch(() => false)) throw new Error('create with a deleted name was refused');
    if (await hidden()) throw new Error('create with a deleted name did not restore it');
    const defs = (await readLs('fitlog_custom_exercises')) || [];
    if (defs.filter(d => d.name.cn === 'E2E自建甲').length !== 1) throw new Error('create with a deleted name made a duplicate definition');
    await page.locator('[data-testid="picker-sheet-close"]').click();
    await backAndDiscard(page);
    return `library delete = hide + undo · emptied ${wid} dropped · tap add/cancel · same-name create restores`;
  },

  // 「继续这场」接回来的训练删光动作，不整场删（用户定）：里面是真正练过的组
  'seeded-resumed-emptied-keeps-workout': async ({ page, card, menuOn, workoutTombstones, remoteSnap, remoteWorkout }) => {
    // 先结束一场（复制 W_HEAT、做完一组），它就是「刚结束、能接回」的那场
    await menuOn(W_HEAT.id, /复制为今天的训练|Copy to today/);
    await pickStartGym(page);
    const row0 = page.locator('.ledger-row').first();
    await row0.locator('[data-testid="ledger-field-weight"] input').fill('200');
    await row0.locator('.set-num').click();
    await row0.and(page.locator('.is-inked')).waitFor({ timeout: 3_000 });
    await page.getByRole('button', { name: /结束训练|End Workout/ }).first().click();
    await acceptAppConfirm(page);
    await dismissColophon(page);
    const done = ((await remoteSnap())?.workouts || []).filter(w => w.finishedAt);
    done.sort((a, b) => new Date(b.finishedAt) - new Date(a.finishedAt));
    const latest = done[0];
    if (!latest || latest.id === W_HEAT.id) throw new Error('fixture drift: the copied workout did not finish');

    await menuOn(latest.id, /继续这场|Resume/);
    await page.locator('[data-testid="finish-button"]').first().waitFor({ timeout: 5_000 });
    const t0 = await workoutTombstones();
    const cards = page.locator('.ui-card').filter({ has: page.locator('[data-testid="ledger-field-weight"]') });
    for (let n = await cards.count(); n > 0; n--) {
      const c = cards.first();
      await c.getByRole('button', { name: /动作菜单|Exercise menu/ }).click();
      await c.getByRole('menuitem', { name: /删除动作|Delete exercise/ }).click();
      await until(async () => (await cards.count()) === n - 1, `exercise card #${n} to go away`);
    }
    // 「不该写墓碑」是否定断言，等不到它的结果：删光之后留一个窗口
    await page.waitForTimeout(400);
    const added = (await workoutTombstones()).filter(x => !t0.includes(x));
    if (added.length) throw new Error(`emptying a resumed workout tombstoned ${JSON.stringify(added)} — 整场被删`);
    await page.getByLabel(/^返回$|^Back$/).first().click();
    await page.locator('nav').first().waitFor({ state: 'visible', timeout: 3_000 }).catch(() => {});
    if (await page.locator('[role="dialog"]').isVisible().catch(() => false)) await acceptAppConfirm(page);
    await card(latest.id).waitFor({ state: 'visible', timeout: 5_000 });
    const w = await remoteWorkout(latest.id);
    if (!w || !w.exercises?.length) throw new Error('resumed workout lost its recorded exercises');
    return `workout ${latest.id} kept (${w.exercises.length} exercise)`;
  },

  // plan-picker-legacy-library / plan-target-weight-unit：计划编辑器选动作走训练页同一个弹层 ——
  // 连续多选、本次加过的再点＝取消、新建动作进计划不进训练；目标重量按当前单位（lbs）填、存 kg；
  // 开练底稿按今天的馆就近取整：137 lb 杠铃 → 135（原来的 bug 是把 lb 当 kg 再换一次：135 → 297.62）
  'seeded-plan-target-unit': async ({ page, remoteSnap }) => {
    await page.locator('[data-testid="tab-plan"]').click();
    await page.locator('[data-testid="plan-subview-schedule"]').click();
    await page.locator('[data-testid="schedule-add-btn"]').click();
    await page.locator('[data-testid="schedule-editor"]').waitFor({ state: 'visible' });
    await page.locator('[data-testid="schedule-title-input"]').fill('E2E 计划多选');
    const rows = page.locator('[data-testid="schedule-exercise-row"]');
    await page.locator('[data-testid="schedule-pick-library"]').click();
    const sheet = page.locator('[data-testid="picker-sheet"]');
    const search = sheet.locator('input[type="text"]');
    await search.waitFor({ state: 'visible', timeout: 3_000 });
    // 连点去重只管同一张卡：换一个动作不用等；同一个再点（＝取消）要凑够 450ms。点完等计划行数变了再往下
    let last = { name: '', at: 0 };
    const pick = async name => {
      const n0 = await rows.count();
      if (name === last.name) await paceFrom(last.at, PICK_DEDUPE_MS);
      await search.fill(name);
      await sheet.locator('[data-testid="picker-sheet-exercise"]', { hasText: name }).first().click();
      last = { name, at: Date.now() };
      await until(async () => (await rows.count()) !== n0, `picking ${name} to change the plan rows`).catch(() => {});
    };
    await pick('杠铃平板卧推');
    await pick('哑铃平板卧推');
    await pick('哈克深蹲');
    if ((await rows.count()) !== 3) throw new Error(`3 picks should add 3 plan rows, got ${await rows.count()}`);
    await pick('哈克深蹲');
    if ((await rows.count()) !== 2) throw new Error(`tapping 哈克深蹲 again should cancel it, got ${await rows.count()} rows`);
    const newName = 'E2E计划新动作';
    await search.fill(newName);
    await sheet.getByRole('button', { name: new RegExp(`没找到？创建「${newName}」`) }).click();
    const dlg = page.locator('[role="dialog"]').filter({ has: page.locator('input') }).last();
    await dlg.waitFor({ state: 'visible', timeout: 3_000 });
    await dlg.getByRole('button', { name: /^(确定|Confirm)$/ }).click();
    await until(async () => (await rows.count()) === 3, 'the created exercise to join the plan').catch(() => {});
    if (!(await rows.nth(2).locator('[data-testid="schedule-exercise-name"]').inputValue()).includes(newName)) throw new Error('created exercise did not join the plan');
    await page.locator('[data-testid="picker-done"]').click();
    await page.locator('[data-testid="schedule-add-exercise"]').click();
    await rows.nth(3).locator('[data-testid="schedule-exercise-name"]').fill('E2E 手填');
    await rows.nth(0).locator('[data-testid="schedule-exercise-weight"]').fill('137');
    await page.locator('[data-testid="schedule-save-btn"]').click();
    await page.locator('[data-testid="schedule-editor"]').waitFor({ state: 'detached', timeout: 5_000 });

    const item = page.locator('[data-testid^="schedule-item-"]', { hasText: 'E2E 计划多选' }).first();
    await item.waitFor({ state: 'visible', timeout: 5_000 });
    const scheduleId = (await item.getAttribute('data-testid')).replace('schedule-item-', '');
    const snap = await remoteSnap();
    const saved = (snap?.scheduledWorkouts || []).find(s => s.id === scheduleId);
    const kg = saved?.exercises?.[0]?.targetWeight;
    if (!(Math.abs(kg - 137 / LBS) < 0.01)) throw new Error(`targetWeight should be stored as kg (${(137 / LBS).toFixed(2)}), got ${kg}`);
    if (saved.exercises.length !== 4) throw new Error(`plan should keep 4 exercises, got ${saved.exercises.length}`);
    if ((snap.workouts || []).some(w => (w.exercises || []).some(e => e.name === newName))) throw new Error('created exercise leaked into a workout');

    await page.locator(`[data-testid="schedule-start-${scheduleId}"]`).click();
    await pickStartGym(page);
    const w0 = await page.locator('.ledger-row').first().locator('[data-testid="ledger-field-weight"] input').inputValue();
    if (Number(w0) !== 135) throw new Error(`plan 137 lb should start snapped to 135 lbs, got ${w0}`);
    await backAndDiscard(page);
    return `pick 3 / cancel 1 / create 1 → plan · 137 lbs ↔ ${kg.toFixed(2)} kg · start 135`;
  },

  // 馆档案：新的馆走档案表单（没起名不让存）；公斤片的馆 → 单位切 kg、底稿吸到公斤片；
  // 改今天这个馆成磅片 → 单位切 lbs，手打的组照原样（60 kg = 132.28 lb，审查 A10），跟着的组吸到 130。
  // 换馆重量（design-plates.md「换馆重量」A）：底稿本馆优先、本馆没练过退回别馆并标明出处、换馆时没动过的卡重挑
  'seeded-gym-profile-and-switch': async ({ page, remote, readLs, relaunch, quiesce, dismissToasts, startWorkout, addExercise, weights }) => {
    const gymBtn = page.locator('[data-testid="gym-button"]');
    const picker = page.locator('[data-testid="gym-picker"]');
    const form = page.locator('[data-testid="gym-profile-form"]');
    const unitNow = async () => (await page.locator('[data-testid="unit-toggle"]').innerText()).trim();
    await startWorkout();
    if ((await unitNow()) !== 'lbs') await page.locator('[data-testid="unit-toggle"]').click();
    if ((await unitNow()) !== 'lbs') throw new Error('could not switch to lbs before the gym test');

    await gymBtn.click();
    await picker.waitFor({ state: 'visible', timeout: 3_000 });
    await page.locator('[data-testid="gym-new"]').click();
    await form.waitFor({ state: 'visible', timeout: 3_000 });
    await page.locator('[data-testid="gym-profile-save"]').click();
    if (!(await form.isVisible())) throw new Error('saving a nameless gym closed the form');
    const gymName = 'E2E 馆';
    await page.locator('[data-testid="gym-profile-name"]').fill(gymName);
    await form.getByRole('button', { name: /^公斤片$/ }).click();
    await page.locator('[data-testid="gym-profile-save"]').click();
    await form.waitFor({ state: 'detached', timeout: 3_000 });
    if ((await unitNow()) !== 'kg') throw new Error(`kg-plate gym should switch the unit to kg, got ${await unitNow()}`);
    if ((await readLs('fitlog_app_prefs'))?.gyms?.[gymName]?.plateUnit !== 'kg') throw new Error('profile not stored in appPrefs.gyms');

    await addExercise('杠铃平板卧推');
    await page.locator('.ledger-row').first().waitFor({ state: 'visible', timeout: 3_000 });
    for (let n = (await weights()).length; n < 3; n++) {
      await page.getByRole('button', { name: /^\+?\s*添加组$|Add Set/ }).first().click();
      await until(async () => (await weights()).length > n, 'the added set row');
    }
    const w0 = await weights();
    const onKgGrid = v => v >= 20 && Math.abs((v - 20) / 2.5 - Math.round((v - 20) / 2.5)) < 1e-6;
    if (!onKgGrid(w0[0])) throw new Error(`draft should be snapped onto kg plates, got ${w0[0]}`);
    const first = page.locator('.ledger-row').first().locator('[data-testid="ledger-field-weight"] input');
    await first.click();
    await page.waitForTimeout(80); // 全选放在下一帧
    await page.keyboard.type('60');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    if (!(await weights()).every(w => w === 60)) throw new Error(`typing 60 should carry the drafts below, got ${JSON.stringify(await weights())}`);

    await gymBtn.click();
    await picker.waitFor({ state: 'visible', timeout: 3_000 });
    const idx = await picker.locator('[data-testid^="gym-option-"]').evaluateAll((els, nm) => els.findIndex(e => e.textContent.includes(nm)), gymName);
    if (idx < 0) throw new Error('new gym missing from the list');
    await page.locator(`[data-testid="gym-edit-${idx}"]`).click();
    await form.waitFor({ state: 'visible', timeout: 3_000 });
    if ((await page.locator('[data-testid="gym-profile-name"]').inputValue()) !== gymName) throw new Error('editing an existing gym should prefill its name');
    await form.getByRole('button', { name: /^磅片$/ }).click();
    await page.locator('[data-testid="gym-profile-save"]').click();
    await form.waitFor({ state: 'detached', timeout: 3_000 });
    await until(async () => (await unitNow()) === 'lbs' && (await weights()).slice(1).every(w => w === 130), 'the unit switch + re-round after saving lb plates').catch(() => {});
    const w2 = await weights();
    if ((await unitNow()) !== 'lbs') throw new Error(`saving today's gym with lb plates should switch to lbs, got ${await unitNow()}`);
    if (w2[0] !== 132.28 || !w2.slice(1).every(w => w === 130)) throw new Error(`typed set stays 132.28 lb, followed sets re-round onto lb plates (130), got ${JSON.stringify(w2)}`);
    await dismissToasts();
    await backAndDiscard(page);

    // 换馆：乙馆的更近（1 天前），甲馆的更早 —— 今天在甲馆要抄甲馆的 40，不是最近那次的 23
    await quiesce();
    const GA = 'E2E 甲馆', GB = 'E2E 乙馆', GC = 'E2E 丙馆';
    const kgGym = machine => ({ plateUnit: 'kg', plates: [25, 20, 15, 10, 5, 2.5, 1.25], cable: { v: 5, u: 'kg' }, machine: { v: machine, u: 'kg' }, dumbbell: { v: 2.5, u: 'kg' } });
    const at = (id, days, gym, w) => ({ ...seedWorkout(id, torontoAt(torontoYmd(days), 9, 0), `E2E ${gym}`, '器械推肩', [[w, 10]]), gym });
    const prefs = remote.snapshot.prefs ?? {};
    remote.snapshot = {
      ...remote.snapshot,
      workouts: [...(remote.snapshot.workouts ?? []), at('seed_gym_a', 3, GA, 40), at('seed_gym_b', 1, GB, 23)],
      prefs: {
        ...prefs,
        appPrefs: { ...(prefs.appPrefs ?? {}), gyms: { ...(prefs.appPrefs?.gyms ?? {}), [GA]: kgGym(5), [GB]: kgGym(1), [GC]: kgGym(5) } },
        appPrefsUpdatedMs: Date.now() + 1000,
      },
    };
    await relaunch();
    await startWorkout();
    const pickGym = async name => {
      await gymBtn.click();
      await picker.waitFor({ state: 'visible', timeout: 3_000 });
      await picker.locator('[data-testid^="gym-option-"]', { hasText: name }).click();
      await picker.waitFor({ state: 'hidden', timeout: 3_000 });
      // 换馆后卡上的底稿按新馆重挑 / 重新取整（effect 里做）：等它画完再读
      await until(async () => (await gymBtn.innerText()).includes(name), `today's gym to read ${name}`);
      await settle(page);
    };
    const prefillGym = async () => ((await page.locator('[data-testid="prefill-gym"]').count()) ? page.locator('[data-testid="prefill-gym"]').innerText() : null);
    await pickGym(GA);
    await addExercise('器械推肩');
    await page.locator('.ledger-row').first().waitFor({ state: 'visible', timeout: 3_000 });
    await settle(page);
    const wA = (await weights()).join();
    if (wA !== '40') throw new Error(`at ${GA} the draft should copy ${GA}'s 40, got ${wA}`);
    if (await prefillGym()) throw new Error('same-gym draft should not name a gym');
    await pickGym(GB);
    const wB = (await weights()).join();
    if (wB !== '23') throw new Error(`switching to ${GB} should re-pick ${GB}'s 23, got ${wB}`);
    await pickGym(GC);
    const wC = (await weights()).join();
    if (wC !== '25') throw new Error(`${GC} (5 kg step) should fall back to ${GB}'s 23 rounded to 25, got ${wC}`);
    if ((await prefillGym()) !== GB) throw new Error(`fallback draft should say it came from ${GB}, got "${await prefillGym()}"`);
    await backAndDiscard(page);
    return `kg gym → kg · typed 60 → lb plates ${w2.join('/')} · ${GA} ${wA} → ${GB} ${wB} → ${GC} ${wC} (from ${GB})`;
  },
};

/** 跑一片：自己的 context、自己的计划状态 */
async function runSeededShard(browser, escapedRemoteCalls, names, i) {
  const want = ['seeded-load', ...names].filter(n => SEEDED_PLAN.run.has(n));
  if (!names.some(n => SEEDED_PLAN.run.has(n))) return;
  const tag = `[seeded#${i + 1}]`;
  const plan = { ...SEEDED_PLAN, base: SEEDED_PLAN, lastRun: null, skipped: false, run: new Set(want) };
  const s = await openSeeded(browser, escapedRemoteCalls, tag);
  try {
    for (const n of SEEDED_PLAN.names) {
      if (n === 'seeded-load' || names.includes(n)) await step(plan, s.page, n, () => SEEDED[n](s), tag);
    }
  } finally {
    await s.context.close();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 主流程
// ─────────────────────────────────────────────────────────────────────────────

async function mainFlow(browser, escapedRemoteCalls) {
  if (!MAIN_PLAN.run.size) return;
  const plan = { ...MAIN_PLAN, base: MAIN_PLAN };
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 }, // iPhone-ish portrait
    deviceScaleFactor: 2,
    colorScheme: 'light',
    locale: 'zh-CN',
    ignoreHTTPSErrors: true, // 个人服务器走自签证书
  });
  const page = await context.newPage();
  const tag = '[main]';

  // mock 远端：拦下所有打 VITE_API_URL 的请求，GET 回最近一次 PUT 的快照。跑 e2e 不需要连 Tailscale。
  const remoteState = { snapshot: null };
  const apiHostPattern = new RegExp(`^${escapeRe(API_BASE)}(:\\d+)?/api/fitlog/state.*`);
  // 兜底：任何没被显式 mock 掉的、指向真实后端的请求一律 abort 并记下（no-real-backend-calls 判它）。
  // ⚠️ Playwright 按注册顺序的倒序匹配路由，所以兜底必须最先注册。
  const escapedApiHost = new RegExp(`^${escapeRe(API_BASE)}(:\\d+)?/.*`);
  await context.route(escapedApiHost, async route => {
    escapedRemoteCalls.push(`${route.request().method()} ${route.request().url()}`);
    return route.abort();
  });
  await context.route(apiHostPattern, async route => {
    const req = route.request();
    if (req.method() === 'GET') {
      if (!remoteState.snapshot) return route.fulfill({ status: 404, body: 'not found' });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(remoteState.snapshot) });
    }
    if (req.method() === 'PUT') {
      try {
        remoteState.snapshot = JSON.parse(req.postData() || '{}');
      } catch {}
      return route.fulfill({ status: 200, body: 'ok' });
    }
    return route.continue();
  });

  const ignoredConsole = ['SW registration failed', 'Failed to load resource', 'ERR_CONNECTION_TIMED_OUT', 'ERR_NAME_NOT_RESOLVED'];
  page.on('console', msg => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (ignoredConsole.some(s => text.includes(s))) return;
    report.consoleErrors.push(`${tag} ${text}`);
    console.log(`${tag}    [console.error] ${text}`);
  });
  page.on('pageerror', err => {
    report.pageErrors.push(`${tag} ${err}`);
    console.log(`${tag}    [pageerror] ${err}`);
  });

  await page.addInitScript(() => {
    try {
      localStorage.clear();
      indexedDB.databases?.().then(dbs => dbs.forEach(d => d.name && indexedDB.deleteDatabase(d.name)));
    } catch {}
    // localStorage 按数据环境分区（services/appStorage.ts）：断言必须走同一套命名空间
    window.lsKey = key => {
      const env = window.__fitlog?.env?.().env;
      return env === 'dev' ? `dev:${key}` : key;
    };
  });

  const s = (name, fn) => step(plan, page, name, fn, tag);
  const remoteSnap = () =>
    page.evaluate(async () => {
      await window.__fitlog.flush();
      return window.__fitlog.fetchRemote();
    });
  const toDashboard = () => page.locator('nav button', { hasText: /个人记录|PR Hub|Dashboard/ }).click();
  const newWorkoutPage = page.locator('[data-testid="finish-button"]');
  /** plan-to-linked-workout 落下的那场训练，时间线那条拿它当靶子 */
  let finishedWorkoutId = null;

  try {
    await s('cold-load', async () => {
      await page.goto(BASE, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('header', { timeout: 15_000 });
      await page.waitForSelector('nav button', { timeout: 15_000 });
      return `title="${await page.title()}"`;
    });

    // 计划 → 开练 → 结束：训练记录带上 fromSchedule.scheduleId，计划标完成并关联到这一场（plan-session-leaks-schedule-id），
    // 都推到了远端。计划编辑器选动作走训练页同一个弹层（plan-picker-legacy-library）
    await s('plan-to-linked-workout', async () => {
      const title = 'E2E_PLAN_' + Date.now();
      await page.locator('nav button', { hasText: /训练计划|Plan/ }).click();
      await page.locator('[data-testid="schedule-add-btn"]').click();
      await page.locator('[data-testid="schedule-editor"]').waitFor({ state: 'visible' });
      await page.locator('[data-testid="schedule-title-input"]').fill(title);
      await page.locator('[data-testid="schedule-date-input"]').fill(new Date().toLocaleDateString('en-CA'));
      await page.locator('[data-testid="schedule-add-exercise"]').click();
      await page.locator('[data-testid="schedule-exercise-name"]').first().fill('E2E Bench Press');
      await page.locator('[data-testid="schedule-pick-library"]').click();
      const sheet = page.locator('[data-testid="picker-sheet"]');
      const rows = page.locator('[data-testid="schedule-exercise-row"]');
      const rows0 = await rows.count();
      await sheet.locator('[data-testid="picker-sheet-exercise"]').first().click();
      await until(async () => (await rows.count()) > rows0, 'the picked exercise to join the plan editor');
      await page.locator('[data-testid="picker-done"]').click();
      await page.locator('[data-testid="schedule-save-btn"]').click();
      await page.locator('[data-testid="schedule-editor"]').waitFor({ state: 'detached', timeout: 5_000 });
      const item = page.locator('[data-testid^="schedule-item-"]', { hasText: title }).first();
      await item.waitFor({ state: 'visible', timeout: 5_000 });
      const scheduleId = (await item.getAttribute('data-testid')).replace('schedule-item-', '');

      await page.locator(`[data-testid="schedule-start-${scheduleId}"]`).click();
      await pickStartGym(page);
      const names = await page.locator('.ui-card h3').allInnerTexts();
      if (!names.some(n => n.includes('E2E Bench Press'))) throw new Error(`planned exercise not on the bench: ${names.join(' | ')}`);
      // 计划里的组是待做：填个次数、点组号才算做完，否则「底稿不入册」结束不了
      const firstRow = page.locator('.ledger-row').first();
      await firstRow.locator('[data-testid="ledger-field-reps"] input').fill('5');
      await firstRow.locator('.set-num').click();
      await firstRow.and(page.locator('.is-inked')).waitFor({ timeout: 3_000 });
      await page.getByRole('button', { name: /结束训练|End Workout/ }).first().click();
      await acceptAppConfirm(page);
      await dismissColophon(page);

      const snap = await remoteSnap();
      const w = (snap?.workouts || []).find(x => x.fromSchedule?.scheduleId === scheduleId);
      if (!w) throw new Error('no workout linked to the schedule on the remote');
      if (typeof snap.schemaVersion !== 'number') throw new Error('snapshot.schemaVersion missing');
      const sched = (snap.scheduledWorkouts || []).find(x => x.id === scheduleId);
      if (sched?.status !== 'completed' || sched?.linkedWorkoutId !== w.id) {
        throw new Error(`schedule should be completed & linked to ${w.id}, got ${JSON.stringify({ status: sched?.status, linked: sched?.linkedWorkoutId })}`);
      }
      finishedWorkoutId = w.id;
      return `schedule ${scheduleId} → workout ${w.id}, linked on the remote`;
    });

    // 时间线操作层：长按菜单（松手那一下的 click 被吞掉）、删除＝先执行 + 撤销（墓碑跟着写 / 摘）、
    // 复制为今天（每一组都是底稿，§12.6）、并入上一场 + 撤销
    await s('timeline-ops', async () => {
      if (!finishedWorkoutId) throw new Error('no finished workout to work on');
      await toDashboard();
      const cardOf = id => page.locator(`[data-testid="timeline-session-${id}"]`);
      const card = cardOf(finishedWorkoutId);
      await card.waitFor({ state: 'visible', timeout: 5_000 });
      const menu = page.locator('[data-testid="timeline-session-menu"]');
      const tombstones = async () => (await page.evaluate(() => JSON.parse(localStorage.getItem(lsKey('fitlog_tombstones')) || 'null')))?.workouts ?? [];

      // 刻意按在菜单将要出现的那一片（右上角）：菜单在手指底下长出来，松手那一下的 click 正好落在第一项上
      await longPress(page, card, 'top-right');
      await menu.waitFor({ state: 'visible', timeout: 3_000 });
      if ((await menu.getByRole('menuitem').count()) < 3) throw new Error('session menu has fewer than 3 items');
      if (await card.evaluate(el => el.className.includes('ring-accent'))) throw new Error('long-press release leaked a click and expanded the card');
      if (await newWorkoutPage.first().isVisible().catch(() => false)) throw new Error('长按松手误触了菜单第一项 —— 直接进了编辑页');
      if (!(await menu.isVisible())) throw new Error('menu closed on the release click');

      await page.waitForTimeout(400); // 菜单项的 350ms 静默期
      await menu.getByRole('menuitem').filter({ hasText: /删除|Delete/ }).click();
      await until(async () => (await page.locator('[role="dialog"]').count()) > 0 || (await card.count()) === 0, 'the delete to either remove the card or ask');
      if (await page.locator('[role="dialog"]').count()) throw new Error('delete still opens a confirm dialog — 要求先执行 + 撤销');
      if (!(await tombstones()).includes(finishedWorkoutId)) throw new Error('deleting a workout wrote no tombstone');
      await page.locator('[data-testid="toast-undo"]').first().click();
      await card.waitFor({ state: 'visible', timeout: 5_000 });
      if ((await tombstones()).includes(finishedWorkoutId)) throw new Error('undo left the tombstone behind');

      await sessionMenu(page, card, /复制为今天的训练|Copy to today/);
      await pickStartGym(page);
      // 红线（§12.6）：复制来的组必须是底稿，不能静默变成数据
      const ghost = await page.locator('.ledger-row.is-ghost').count();
      if (!ghost) throw new Error('copied workout has no draft rows');
      if (await page.locator('.ledger-row.is-inked').count()) throw new Error('copied sets must all be drafts');
      // 做完一组再结束：造出真正的第二场，给「并入上一场」用
      await page.locator('.ledger-row .set-num').first().click();
      await page.getByRole('button', { name: /结束训练|End Workout/ }).first().click();
      await acceptAppConfirm(page);
      await dismissColophon(page);

      const cards = page.locator('[data-testid^="timeline-session-"]');
      await until(async () => (await cards.count()) >= 2, 'the copied session to show on the timeline');
      const before = await cards.count();
      const mergedId = await cards.first().getAttribute('data-testid');
      await sessionMenu(page, cards.first(), /并入上一场|Merge into previous/);
      await page.locator(`[data-testid="${mergedId}"]`).waitFor({ state: 'detached', timeout: 3_000 });
      if ((await cards.count()) !== before - 1) throw new Error(`expected ${before - 1} cards after merge, got ${await cards.count()}`);
      await page.locator('[data-testid="toast-undo"]').first().click();
      await page.locator(`[data-testid="${mergedId}"]`).waitFor({ state: 'visible', timeout: 5_000 });
      if ((await cards.count()) !== before) throw new Error(`undo did not restore the card count (${await cards.count()} vs ${before})`);
      return `menu release swallowed · delete + undo (tombstone) · copy ${ghost} drafts · merge ${before} → ${before - 1} → ${before}`;
    });

    // 开练 → 加杠铃 → 记组：
    //  横拖改值（§12.3）用真实指针事件 —— 合成 dispatchEvent 进不了 pointer capture 那条路径
    //  换算残留（61.24）：拖动的第一档先吸到杠铃网格（5 kg 一档）；打字不取整；长按组号加递减档 = snap(61.24 − 5)
    //  点组号做完 / 再点退回（改过的格子仍认得）；±5 走这件器材的一档；打字替换旧值、回车时带着下面没动过的底稿吸到能挂的；
    //  删组单击即删、不出撤销条；训练卡改名撞上另一个动作的名字被拒、旧名记成曾用名
    await s('workout-log-sets', async () => {
      await toDashboard();
      await page.getByRole('button', { name: /开始训练|Start Workout/ }).click();
      await pickStartGym(page);
      // 刚结束过一场也不再问「继续刚才那场？」（接回走时间线长按菜单）
      if (await page.locator('[role="dialog"]').isVisible().catch(() => false)) throw new Error('FAB must not ask about the just-finished workout any more');
      await page.locator('[data-testid="open-picker-sheet"]').click();
      const sheet = page.locator('[data-testid="picker-sheet"]');
      await sheet.locator('input[type="text"]').fill('杠铃平板卧推');
      await sheet.locator('[data-testid="picker-sheet-exercise"]', { hasText: '杠铃平板卧推' }).first().click();
      await page.locator('[data-testid="picker-sheet-close"]').click();

      const reps = page.locator('[data-testid="ledger-field-reps"]').first();
      await reps.waitFor({ state: 'visible', timeout: 5_000 });
      const repsIn = reps.locator('input');
      const r0 = Number((await repsIn.inputValue()) || 0);
      const rb = await reps.boundingBox();
      await page.mouse.move(rb.x + 8, rb.y + rb.height / 2);
      await page.mouse.down();
      for (let dx = 14; dx <= 74; dx += 10) await page.mouse.move(rb.x + 8 + dx, rb.y + rb.height / 2);
      await page.mouse.up();
      const r1 = Number((await repsIn.inputValue()) || 0);
      if (!(r1 > r0) || !Number.isInteger(r1)) throw new Error(`reps scrub ${r0} → ${r1}`);

      const weight = page.locator('[data-testid="ledger-field-weight"]').first();
      const wIn = weight.locator('input');
      await wIn.fill('61.24');
      if ((await wIn.inputValue()) !== '61.24') throw new Error('typing must keep the residue');
      // 慢拖：每次 move 隔开足够久，速度留在 ×1 档（按下到第一次移动只隔一两毫秒会算成「猛甩」）
      const slow = async dxs => {
        const box = await weight.boundingBox();
        const x0 = box.x + box.width / 2;
        const y = box.y + box.height / 2;
        await page.mouse.move(x0, y);
        await page.mouse.down();
        await page.waitForTimeout(80);
        for (const dx of dxs) {
          await page.mouse.move(x0 + dx, y);
          await page.waitForTimeout(80);
        }
        await page.mouse.up();
        await page.waitForTimeout(350);
        return Number(await wIn.inputValue());
      };
      // 接管阈值 20px（scrubFeel.ENGAGE_PX），接管那一刻不算档，之后每 10px 一档
      const right1 = await slow([22, 32]);
      if (right1 !== 65) throw new Error(`61.24 dragged right one detent should snap up to 65, got ${right1}`);
      const left2 = await slow([-22, -32, -42]);
      if (left2 !== 55) throw new Error(`65 dragged left two detents should be 55, got ${left2}`);
      await wIn.fill('61.24');
      const nb = await page.locator('.ledger-row .set-num').first().boundingBox();
      await page.mouse.move(nb.x + nb.width / 2, nb.y + nb.height / 2);
      await page.mouse.down();
      await page.waitForTimeout(HOLD_MS);
      await page.mouse.up();
      const sub = page.locator('[data-testid="subset-field-weight"] input').first();
      await sub.waitFor({ state: 'visible', timeout: 3_000 });
      if (Number(await sub.inputValue()) !== 55) throw new Error(`drop set default should be snap(61.24 − 5) = 55, got ${await sub.inputValue()}`);

      const rows = page.locator('.ledger-row');
      const row0 = rows.first();
      const cls = async r => (await r.getAttribute('class')) || '';
      if ((await cls(row0)).includes('is-inked')) throw new Error('editing values marked the row done — 改值必须只改值');
      const edited = await row0.locator('.ledger-field.is-edited').count();
      if (edited < 1) throw new Error('edited cells on a to-do row are not marked is-edited');
      await row0.locator('.set-num').click();
      if (!(await cls(row0)).includes('is-inked')) throw new Error('tapping the set number did not mark it done');
      if (!(await cls(row0)).includes('is-selected')) throw new Error('the set just tapped done is not the selected one');
      await row0.locator('.set-num').click();
      if (!(await cls(row0)).includes('is-inked') || !(await cls(row0)).includes('is-selected')) throw new Error('tapping the selected set changed something');

      const steps = page.locator('[data-testid="weight-step"]');
      if ((await steps.count()) !== 1) throw new Error(`expected exactly one ±5 strip, got ${await steps.count()}`);
      const plus = steps.getByRole('button', { name: /重量加|Weight \+/ });
      if (!/(^|\D)5 kg/.test((await plus.getAttribute('aria-label')) || '')) throw new Error('barbell + should step by the smallest pair (5 kg)');
      const w0 = Number(await wIn.inputValue());
      await plus.click();
      const w1 = Number(await wIn.inputValue());
      const want = 20 + Math.floor((w0 - 20) / 5 + 1e-6) * 5 + 5;
      if (Math.abs(w1 - want) > 0.011) throw new Error(`+ went ${w0} → ${w1}, want ${want}`);

      const n0 = await rows.count();
      await page.getByRole('button', { name: /^\+?\s*添加组$|Add Set/ }).first().click();
      await until(async () => (await rows.count()) > n0, 'the added set row');
      const row1 = rows.nth(1);
      if ((await cls(row1)).includes('is-inked')) throw new Error('a freshly added set started as done');
      const w0in = row0.locator('[data-testid="ledger-field-weight"] input');
      const w1in = row1.locator('[data-testid="ledger-field-weight"] input');
      const wBefore = await w0in.inputValue();
      if ((await w1in.inputValue()) !== wBefore) throw new Error('fixture drift: set 2 should start as a clone of set 1');
      await w0in.click();
      await page.waitForTimeout(80); // 全选放在下一帧
      await page.keyboard.type('77');
      if ((await w0in.inputValue()) !== '77') throw new Error(`typing into a cell should replace it, got ${await w0in.inputValue()}`);
      if ((await w1in.inputValue()) !== wBefore) throw new Error('draft below should hold while typing');
      await page.keyboard.press('Enter');
      if ((await w0in.inputValue()) !== '77') throw new Error('a typed weight must stay as typed');
      if ((await w1in.inputValue()) !== '75') throw new Error(`draft below should follow and snap to 75 on Enter, got ${await w1in.inputValue()}`);
      if (await row1.locator('[data-testid="ledger-field-weight"].is-edited').count()) throw new Error('a follower must stay a draft');
      if (!/^reps/.test(await page.evaluate(() => document.activeElement?.getAttribute('aria-label') || ''))) throw new Error('Enter in the weight cell should focus reps');
      await page.keyboard.press('Enter');

      const n1 = await rows.count();
      await rows.nth(n1 - 1).locator('[data-testid="set-remove"]').click();
      await until(async () => (await rows.count()) === n1 - 1, 'the set row to be removed');
      if (await page.locator('[data-testid="toast-undo"]').count()) throw new Error('deleting a set still shows an undo toast');

      const card = page.locator('.ui-card').filter({ has: page.locator('[data-testid="ledger-field-weight"]') }).first();
      const title = card.locator('h3').first();
      const before = (await title.textContent())?.trim();
      const openRename = async () => {
        await card.getByRole('button', { name: /动作菜单|Exercise menu/ }).click();
        await card.getByRole('menuitem', { name: /重命名|Rename/ }).click();
        const dlg = page.locator('[role="dialog"]');
        await dlg.waitFor({ state: 'visible', timeout: 3_000 });
        return dlg;
      };
      let dlg = await openRename();
      await dlg.locator('input').fill('哑铃平板卧推');
      await dlg.getByRole('button', { name: /^(确定|确认|OK|Confirm)$/ }).click();
      // 拒绝＝出提示、弹窗留着；接受＝弹窗关掉。哪个先发生等哪个，再判
      await until(async () => (await page.locator('[data-testid="toast"]').count()) > 0 || !(await dlg.isVisible()), 'the rename to be rejected or accepted');
      if (!(await dlg.isVisible())) throw new Error("renaming to another exercise's name was accepted");
      await dlg.getByRole('button', { name: /^(取消|Cancel)$/ }).click();
      await dlg.waitFor({ state: 'detached', timeout: 3_000 });
      const fresh = 'E2E 改名卧推';
      dlg = await openRename();
      await dlg.locator('input').fill(fresh);
      await dlg.getByRole('button', { name: /^(确定|确认|OK|Confirm)$/ }).click();
      await dlg.waitFor({ state: 'detached', timeout: 3_000 });
      if ((await title.textContent())?.trim() !== fresh) throw new Error('card title did not follow the rename');
      const aliases = await page.evaluate(() => Object.values(JSON.parse(localStorage.getItem(lsKey('fitlog_exercise_overrides')) || '{}')).flatMap(o => o.aliases || []));
      if (!aliases.includes(before)) throw new Error(`old name "${before}" not kept as alias`);
      await backAndDiscard(page);
      return `reps ${r0}→${r1} · 61.24 → ${right1} → ${left2}, drop 55 · done/re-tap noop · + ${w0}→${w1} · 77 → follower 75 · rename (clash rejected, alias kept)`;
    });

    await s('global-undo', async () => {
      await toDashboard();
      await page.getByRole('button', { name: /开始训练|Start Workout/ }).click();
      await pickStartGym(page);
      await page.locator('[data-testid="open-picker-sheet"]').click();
      const sheet = page.locator('[data-testid="picker-sheet"]');
      await sheet.locator('input[type="text"]').fill('杠铃平板卧推');
      await sheet.locator('[data-testid="picker-sheet-exercise"]', { hasText: '杠铃平板卧推' }).first().click();
      await page.locator('[data-testid="picker-sheet-close"]').click();

      const rows = page.locator('.ledger-row');
      const undo = page.locator('[data-testid="undo-redo"]').last().locator('[data-testid="global-undo"]');
      const redo = page.locator('[data-testid="undo-redo"]').last().locator('[data-testid="global-redo"]');
      const wIn = page.locator('[data-testid="ledger-field-weight"] input').first();
      const state = async () => `${await rows.count()} rows · w=${await wIn.inputValue()} · inked=${await page.locator('.ledger-row.is-inked').count()}`;
      const settle = () => page.waitForTimeout(250);

      await wIn.click();
      await page.waitForTimeout(80); // 全选放在下一帧
      await page.keyboard.type('60');
      await page.keyboard.press('Enter');
      await settle();
      await page.getByRole('button', { name: /^\+?\s*添加组$|Add Set/ }).first().click();
      await settle();
      await rows.first().locator('.set-num').click();
      await settle();
      const done = await state();
      if (done !== '2 rows · w=60 · inked=1') throw new Error(`setup: ${done}`);

      // 一下一步往回撤：做完 → 添加组 → 打的 60（打字连回车是一步）
      const seen = [];
      for (let i = 0; i < 3; i++) {
        await undo.click();
        await settle();
        seen.push(await state());
      }
      const wantBack = ['2 rows · w=60 · inked=0', '1 rows · w=60 · inked=0'];
      if (seen[0] !== wantBack[0] || seen[1] !== wantBack[1] || seen[2].startsWith('1 rows · w=60'))
        throw new Error(`undo steps: ${seen.join(' | ')}`);
      if (!(await redo.isEnabled())) throw new Error('redo disabled after undo');
      for (let i = 0; i < 3; i++) {
        await redo.click();
        await settle();
      }
      if ((await state()) !== done) throw new Error(`redo did not come back: ${await state()}`);
      if (await redo.isEnabled()) throw new Error('redo still enabled at the newest step');

      // 结束训练 → 首页 → 撤销：那场回到工作台，做完的组还在
      await page.locator('[data-testid="finish-button"]').click();
      await acceptAppConfirm(page);
      await dismissColophon(page);
      await page.locator('nav').first().waitFor({ state: 'visible', timeout: 3_000 });
      await page.locator('header [data-testid="global-undo"]').click();
      await page.locator('[data-testid="finish-button"]').waitFor({ timeout: 3_000 });
      await settle();
      if ((await page.locator('.ledger-row.is-inked').count()) !== 1) throw new Error(`undo finish: ${await state()}`);
      await backAndDiscard(page);
      return `${seen.join(' → ')} · redo ×3 · undo finish → back on the bench`;
    });

    // 防误结束拆场的另一半：「继续这场」把刚结束的那场接回工作台 —— 同一条记录、finishedAt 清掉
    await s('resume-recent-workout', async () => {
      await toDashboard();
      const done = ((await remoteSnap())?.workouts || []).filter(w => w.finishedAt);
      done.sort((a, b) => new Date(b.finishedAt) - new Date(a.finishedAt));
      const resumeId = done[0]?.id;
      if (!resumeId) throw new Error('fixture drift: no finished workout to resume');
      const rcard = page.locator(`[data-testid="timeline-session-${resumeId}"]`);
      await rcard.waitFor({ state: 'visible', timeout: 5_000 });
      await longPress(page, rcard);
      const rmenu = page.locator('[data-testid="timeline-session-menu"]');
      await rmenu.waitFor({ state: 'visible', timeout: 3_000 });
      await page.waitForTimeout(400);
      const resumeItem = rmenu.locator('[data-testid="timeline-resume"]');
      if (!(await resumeItem.isVisible().catch(() => false))) throw new Error('「继续这场」missing from the menu of a workout finished minutes ago');
      await resumeItem.click();
      await page.locator('[data-testid="ledger-field-weight"]').first().waitFor({ state: 'visible', timeout: 5_000 });
      const w = ((await remoteSnap())?.workouts || []).find(x => x.id === resumeId);
      if (!w) throw new Error(`resumed workout ${resumeId} vanished from the snapshot`);
      if (w.finishedAt) throw new Error(`finishedAt not cleared on resume: ${w.finishedAt}`);
      return `resumed ${resumeId}, finishedAt cleared`;
    });
  } finally {
    await context.close();
  }
  return plan;
}

const T0 = Date.now();
const run = async () => {
  console.log(`\n== e2e against ${BASE} ==\n`);
  describeSelection([MAIN_PLAN, SEEDED_PLAN, BACKUP_PLAN], ONLY);

  // E2E_CHROMIUM：本机装的 Playwright 浏览器版本和 node_modules 里的对不上时，指向已有的那份可执行文件
  const browser = await chromium.launch({ headless: true, executablePath: process.env.E2E_CHROMIUM || undefined });
  /** 逃逸到真实后端的请求（应当恒为空） */
  const escapedRemoteCalls = [];
  // 先让 dev server 把整张模块图转译一遍：刚重启时五个 context 同时冷启动，首页 10 s 都画不出来（实测踩过）。
  // 这一下不连后端：所有非本机请求直接拒掉
  {
    const warm = await browser.newContext();
    await warm.route(url => !url.href.startsWith(BASE), route => route.abort());
    const p = await warm.newPage();
    await p.goto(BASE, { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('header', { timeout: 60_000 });
    await warm.close();
  }
  const suites = [
    () => mainFlow(browser, escapedRemoteCalls),
    ...SEEDED_SHARDS.map((names, i) => () => runSeededShard(browser, escapedRemoteCalls, names, i)),
    () => runBackup(browser, BACKUP_PLAN),
  ];
  // 各套各开各的 context、互不相干：并行跑。一套失败不拦别的套，收尾一起报
  const settled = process.env.E2E_SERIAL
    ? await suites.reduce(async (acc, f) => [...(await acc), await f().then(v => ({ status: 'fulfilled', value: v }), e => ({ status: 'rejected', reason: e }))], Promise.resolve([]))
    : await Promise.allSettled(suites.map(f => f()));
  const backup = settled.at(-1).status === 'fulfilled' ? settled.at(-1).value : { results: [], pageErrors: [], failed: true, timings: [] };
  report.backup = backup.results;
  if (backup.failed) report.steps.push({ name: 'backup', status: 'fail', detail: backup.results.find(r => r.status === 'fail')?.detail });
  for (const e of backup.pageErrors) report.pageErrors.push(`[backup] ${e}`);
  for (const r of settled) if (r.status === 'rejected' && !report.steps.some(x => x.status === 'fail')) report.steps.push({ name: 'crash', status: 'fail', detail: String(r.reason?.stack || r.reason) });

  // 数据隔离断言：e2e 全程不得有任何请求真的打到后端
  if (MAIN_PLAN.run.has('no-real-backend-calls')) {
    const entry = logStep('no-real-backend-calls', escapedRemoteCalls.length ? 'fail' : 'pass',
      escapedRemoteCalls.length ? `有 ${escapedRemoteCalls.length} 个请求逃逸到真实后端: ${escapedRemoteCalls.slice(0, 5).join(', ')}` : 'all backend traffic mocked');
    entry.ms = 0;
  }

  report.escapedRemoteCalls = escapedRemoteCalls;
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  await browser.close();

  const failed = report.steps.filter(s => s.status === 'fail');
  const bPass = backup.results.filter(r => r.status === 'pass').length;
  console.log(`\n== summary: ${report.steps.length - failed.length}/${report.steps.length} passed · backup ${bPass}/${backup.results.length} ==`);
  for (const f of failed) console.log(`   ✗ ${f.name} — ${f.detail}`);
  console.log(`   console.error count: ${report.consoleErrors.length}`);
  console.log(`   page errors: ${report.pageErrors.length}`);
  console.log(`   wall clock: ${((Date.now() - T0) / 1000).toFixed(1)}s`);
  if (UNTIL_TIMEOUTS.length) console.log(`   条件等待超时 ${UNTIL_TIMEOUTS.length} 次（白等了）：${UNTIL_TIMEOUTS.join(' | ')}`);
  printSlowest('主流程', timings.get(MAIN_PLAN));
  printSlowest('带夹具', timings.get(SEEDED_PLAN));
  printSlowest('备份', backup.timings);
  if (failed.length || report.consoleErrors.length || report.pageErrors.length) process.exit(1);
};

run().catch(err => {
  console.error('e2e crashed:', err);
  fs.writeFileSync(path.join(OUT, 'crash.txt'), String(err.stack || err));
  process.exit(1);
});
