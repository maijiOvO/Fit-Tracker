// End-to-end smoke test that simulates a real user session.
// Runs against the running dev server at http://localhost:3000 (E2E_BASE 改地址).
//
// ── 跑法 ──────────────────────────────────────────────────────────────────────
//   node scripts/e2e-smoke.mjs                         整套：主流程 → 带夹具的场景 ∥ 备份（e2e-backup.mjs 的用例，同一个浏览器、各自的 context）
//   E2E_ONLY=seeded-gym node scripts/e2e-smoke.mjs     名字前缀，逗号分隔多个
//   E2E_ONLY=/^region-(drag|layout)/ node ...          /正则/（可带 flags）
//   E2E_ONLY=set-state-gestures node ...               选中的步骤会连同它的前置（递归）一起跑，启动时打印跑哪些
//   E2E_SKIP_BACKUP=1                                  不跑备份那套（默认整套跑时一起跑）
//   E2E_BASE=http://localhost:3100                     在 worktree 里必须指向 worktree 自己起的 dev server
// 依赖表在下面的 MAIN_STEPS / SEEDED_STEPS（备份的在 e2e-backup.mjs 的 BACKUP_STEPS），规则见 scripts/e2e-plan.mjs。
// 一套里一个步骤都没选中就整套不起。没在表里声明的步骤名会直接报错。
// 每步耗时收尾时打印（最慢 10 步），也写进 test-artifacts/report.json。
// 手感 / 观感类的检查不在这里，见 docs/manual-check.md（真机手测清单）。
//
// Coverage:
//  1. Cold load (clean storage) — no console errors, no page errors
//  2. Theme: switch system theme (light/dark via emulated colorScheme + manual override)
//  3. Tab navigation: dashboard -> goals -> profile -> dashboard
//  4. Workout flow: open "new" via FAB, browse library, pick exercise, add set,
//     open rest-timer settings, return via back button
//  5. Log a body weight from the dashboard quick action
//  6. Add a goal from the goals tab
//  7. Toggle unit (kg <-> lbs)
//  8. Verify back-button confirm dialog when unsaved workout exists
//  9. English mode: switch language and assert no Chinese leaks into the DOM
//
// Output:
//  - test-artifacts/*.png screenshots at each milestone
//  - test-artifacts/report.json with console errors, timing, pass/fail per step

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

function logStep(name, status, detail) {
  const entry = { name, status, detail, ts: new Date().toISOString() };
  report.steps.push(entry);
  const symbol = status === 'pass' ? '✓' : status === 'fail' ? '✗' : '·';
  console.log(`  ${symbol} ${name}${detail ? ' — ' + detail : ''}`);
}

async function shoot(page, name) {
  const file = path.join(OUT, `${String(report.steps.length).padStart(2, '0')}-${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
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

/**
 * 等整页 DOM 安静下来：隔 100ms 采样两次 body.innerHTML 长度一样（最多 3 s）。
 * 给「扫整屏」的断言用（英文扫雷）：只等某个元素出现不够 —— 别处还没画出来，漏翻的字就扫不到，变成假绿。
 */
async function domQuiet(page) {
  let prev = -1;
  for (let i = 0; i < 30; i++) {
    const len = await page.evaluate(() => document.body.innerHTML.length);
    if (len === prev) return;
    prev = len;
    await new Promise(r => setTimeout(r, 100));
  }
}

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
 * 离开工作台并结束这场：一组都没做完＝放弃；有改过数的组＝按做完入册。
 * workbench-not-restored 之后按返回只离开页面、工作台原样留着（首页顶上「进行中」、FAB 变「回到训练」）；
 * 原来靠「返回即清空」给后续用例复位的地方，改成首页「进行中 → 结束 → 放弃」。
 */
/**
 * 开练先选馆（2026-10-21 起；计划开练 / 复制为今天 2026-10-22 起也先选）：点了开练的那一下之后，
 * 弹「这场在哪个馆练」就选第一个；一个馆都没有时直接是「新的馆」表单，起个名存好（就在这个馆开）。
 * 没弹（接回进行中的那场之类）就什么都不做。等到选馆弹层关掉、新建页出来才返回。
 */
async function pickStartGym(page, name = 'E2E 默认馆') {
  const ready = page.locator('text=/新建训练|New Workout/');
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

async function backAndDiscard(page) {
  await page.getByLabel(/^返回$|^Back$/).first().click();
  // 离开训练页＝底栏回来；弹了确认框的话停在训练页、底栏不回来
  await page.locator('nav').first().waitFor({ state: 'visible', timeout: 3_000 }).catch(() => {});
  if (await page.locator('[role="dialog"]').isVisible().catch(() => false)) {
    throw new Error('back from an in-progress workout should not ask anything any more');
  }
  const row = page.locator('[data-testid="in-progress"]');
  const rowShows = () => row.waitFor({ state: 'visible', timeout: 1_000 }).then(() => true, () => false);
  // 返回落在来源页（比如计划页）时，「进行中」那一行在首页：去首页找
  if ((await page.locator('[data-testid="plan-subview-schedule"]').isVisible().catch(() => false)) || !(await rowShows())) {
    await page.locator('nav button', { hasText: /个人记录|PR Hub|Dashboard/ }).click();
  }
  if (await rowShows()) {
    await page.locator('[data-testid="in-progress-end"]').click();
    // 一组都没做完 → 「放弃」；有改过数没点完成的组 → 它们按做完入册（2026-10-20），弹的是「结束训练」
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
 * 收掉刊末页 / 弹层 / 首选项，离开训练页并放弃进行中的那场，回到首页。
 */
async function resetHome(page) {
  await page.emulateMedia({ colorScheme: 'light' });
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

/**
 * 步骤依赖表（规则见 scripts/e2e-plan.mjs）。[名字, 直接前置?（省略＝上一步）, { home }?]
 * 主流程是一条从空库走到底的长链，但不是每步都依赖上一步：这里只写真正要的前置，
 * 「指定一步」时就只跑它和它的前置。隐藏的共享状态写在旁边。
 */
const H = { home: true };
const MAIN_STEPS = [
  ['cold-load', []],
  ['no-blank-screen', ['cold-load']],
  ['bottom-nav-visible', ['cold-load']],
  ['theme-system-dark', ['cold-load']],
  ['theme-system-light', ['theme-system-dark']],
  ['goto-profile', ['cold-load'], H],
  ['theme-manual-dark', ['goto-profile']],
  // 要从深色切回来才看得出「切到浅色」生效了（单跑时本来就是浅色，断言恒真）
  ['theme-manual-light', ['theme-manual-dark']],
  ['theme-back-to-auto', ['goto-profile']],
  ['goto-plan', ['cold-load'], H],
  ['plan-open-editor', ['goto-plan']],
  ['plan-fill-editor'],
  ['plan-pick-from-library'],
  ['plan-save-schedule'],
  ['plan-remote-save', ['plan-save-schedule']],
  ['plan-start-from-schedule', ['plan-save-schedule']],
  // 落下的那场训练是后面时间线用例的靶子（finishedWorkoutId）
  ['plan-finish-from-schedule', ['plan-save-schedule']],
  ['plan-switch-to-goals', ['goto-plan'], H],
  ['timeline-no-inline-buttons', ['plan-finish-from-schedule'], H],
  ['timeline-longpress-menu', ['timeline-no-inline-buttons']],
  ['timeline-delete-is-undoable', ['timeline-longpress-menu']],
  // 时间线只剩一张卡时会自己复制一场、做一组再结束（兜底分支）——这一场又成了 resume-recent-workout 的靶子
  ['timeline-merge-into-previous', ['timeline-no-inline-buttons'], H],
  ['timeline-copy-to-today', ['timeline-no-inline-buttons'], H],
  ['open-workout-via-fab', ['cold-load'], H],
  ['rest-timer-hidden-on-empty', ['open-workout-via-fab']],
  ['browse-library', ['open-workout-via-fab']],
  // 细分格的几步各自收尾、把格子复原，互不依赖
  ['region-assign-via-panel', ['browse-library']],
  ['region-longpress-ghost-click', ['browse-library']],
  ['region-drag', ['browse-library']],
  ['region-layout-edit', ['browse-library']],
  ['region-arrange-library', ['browse-library']],
  ['exercise-attrs-gear-and-load', ['browse-library']],
  ['close-library', ['browse-library']],
  // 关掉弹层后加的第一个动作是杠铃（后面按 2.5 kg 一档断言）
  ['scrub-reps-cell', ['close-library']],
  // 改过第 1 组的重量 / 次数、长按加了一档递减 —— set-state-gestures 要这些
  ['scrub-weight-residue-and-drop-set', ['scrub-reps-cell']],
  ['set-state-gestures', ['scrub-weight-residue-and-drop-set']],
  ['rename-exercise-from-card', ['scrub-reps-cell']],
  ['exercise-variant', ['scrub-reps-cell']],
  ['back-to-tab-from-workout', ['scrub-reps-cell']],
  ['unit-toggle', ['cold-load'], H],
  ['english-mode-no-chinese', ['cold-load'], H],
  // 接回「最近结束的那一场」（10 分钟内）：至少要有计划那场
  ['resume-recent-workout', ['plan-finish-from-schedule'], H],
  ['no-real-backend-calls', [], { always: true }],
];

/** 带夹具的场景：都只要 seeded-load 的种子和 mock 远端；三条接着上一条往下走的另外写明 */
const SEEDED_STEPS = [
  ['seeded-load', []],
  ['seeded-heatmap-local-day', ['seeded-load'], H],
  ['seeded-timeline-set-numbers', ['seeded-load'], H],
  ['seeded-name-collision-stable', ['seeded-load'], H],
  ['seeded-datepicker-initial', ['seeded-load'], H],
  ['seeded-edit-history-draft', ['seeded-load'], H],
  ['seeded-delete-tombstone-undo', ['seeded-load'], H],
  ['seeded-delete-survives-failed-push', ['seeded-load'], H],
  ['seeded-library-delete-hides', ['seeded-load'], H],
  // 接着上一条：已经在空的新训练里
  ['seeded-remove-last-exercise-drops-workout', ['seeded-library-delete-hides']],
  ['seeded-pr-stamp-in-display-unit', ['seeded-load'], H],
  // 接着上一条：刚结束的那场（复制自 W_HEAT，200 lbs 做完一组）
  ['seeded-resumed-emptied-keeps-workout', ['seeded-pr-stamp-in-display-unit']],
  ['seeded-picker-toggle-done-bar-prefill', ['seeded-load'], H],
  ['seeded-create-restores-deleted', ['seeded-load'], H],
  ['seeded-unit-survives-stale-remote', ['seeded-load'], H],
  ['seeded-avatar-small-single-copy', ['seeded-load'], H],
  ['seeded-plan-picker-multi-unit', ['seeded-load'], H],
  ['seeded-gym-profile-new-and-edit', ['seeded-load'], H],
  ['seeded-weight-30d-and-goal-unit', ['seeded-load'], H],
  ['seeded-sync-skips-push-when-pull-fails', ['seeded-load'], H],
  ['seeded-gym-weight-per-gym', ['seeded-load'], H],
  // 要上一条塞进去的「E2E 甲馆」
  ['seeded-gym-tag-becomes-cable', ['seeded-gym-weight-per-gym']],
  ['seeded-stack-start-and-drop-order', ['seeded-load'], H],
];

const ONLY = parseOnly(process.env.E2E_ONLY);
const MAIN_PLAN = planSuite('主流程', MAIN_STEPS, ONLY);
const SEEDED_PLAN = planSuite('带夹具', SEEDED_STEPS, ONLY);
const BACKUP_PLAN = planSuite('备份', BACKUP_STEPS, process.env.E2E_SKIP_BACKUP ? parseOnly('/^$/') : ONLY);
/** 步骤名 → 所属的套件 */
const PLAN_OF = new Map();
for (const p of [MAIN_PLAN, SEEDED_PLAN]) for (const n of p.names) PLAN_OF.set(n, p);
const timings = new Map([[MAIN_PLAN, []], [SEEDED_PLAN, []]]);

async function step(page, name, fn) {
  const plan = PLAN_OF.get(name);
  if (!plan) throw new Error(`step "${name}" is not declared in MAIN_STEPS / SEEDED_STEPS — 先在依赖表里声明`);
  if (!(await enterStep(plan, name, () => resetHome(page)))) return;
  process.stdout.write(`▶ ${name}\n`);
  const t0 = Date.now();
  try {
    const detail = await fn();
    logStep(name, 'pass', detail);
    await shoot(page, name.replace(/[^a-z0-9]+/gi, '_').toLowerCase());
  } catch (err) {
    logStep(name, 'fail', err.message);
    await shoot(page, 'FAIL-' + name.replace(/[^a-z0-9]+/gi, '_').toLowerCase());
    throw err;
  } finally {
    const ms = Date.now() - t0;
    timings.get(plan).push({ name, ms });
    report.steps.at(-1).ms = ms;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 带夹具的场景（2026-10-06 审查第 1 批数据 bug）
//
// 主流程是一条从空库走到底的长链，造不出「历史里有一场昨晚 9 点的训练」「两个自建动作原名撞车」
// 这种数据。这里另开一个干净的 context：远端 mock 在第一次 GET 时吐一份旧格式快照当夹具
// （只用已有字段，没有新字段），App 启动时照常拉取合并，就等于「用户带着这些历史打开 App」。
// 时区钉在 America/Toronto（用户所在地）：按 UTC 切日期的 bug 只有在这里才现形。
// 每条盯的是状态（库里的日期、墓碑、存储顺序、格子的档位、组号），不是文案。
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

async function seededScenarios(browser, { escapedRemoteCalls }) {
  const yesterday = torontoYmd(1);
  const threeDaysAgo = torontoYmd(3);
  // 昨晚 21:15（多伦多）—— UTC 已经是今天了
  const W_HEAT = seedWorkout('seed_heat', torontoAt(yesterday, 21, 15), 'E2E 昨晚', '杠铃平板卧推', [
    [185 / LBS, 5],
    [185 / LBS, 5],
    [185 / LBS, 5],
  ]);
  const W_DATE = seedWorkout('seed_date', torontoAt(threeDaysAgo, 14, 33), 'E2E 改时间', '哑铃平板卧推', [[20, 10]]);
  const W_DEL = seedWorkout('seed_del', torontoAt(torontoYmd(5), 10, 0), 'E2E 待删', '杠铃深蹲', [[60, 5]]);
  const W_NAME = seedWorkout('seed_name', torontoAt(torontoYmd(7), 10, 0), 'E2E 撞名', '悍马卧推', [[50, 8]]);

  // 两个自建动作原名都是「悍马卧推」（真实数据就是这样）：B 早年改名成「曲肘蝴蝶机」，A 是后来新建的。
  // 列表顺序故意是 [B, A, C] —— 旧版「删除再撤销」会把 B 插到最前，就是这个顺序。
  const DEF_A = { id: '1781149667255', name: { cn: '悍马卧推', en: '悍马卧推' }, bodyPart: 'subChest', tags: [], category: 'STRENGTH' };
  const DEF_B = { id: '1779420343792', name: { cn: '悍马卧推', en: '悍马卧推' }, bodyPart: 'subChest', tags: [], category: 'STRENGTH' };
  const DEF_C = { id: '1779000000000', name: { cn: 'E2E自建甲', en: 'E2E自建甲' }, bodyPart: 'subChest', tags: [], category: 'STRENGTH' };

  // 体重：30 天基线应取「截止点之前最近的一次」（35 天前 82），不是最早那条（90 天前 90）。
  // 数组顺序故意打乱，排序靠代码自己。
  // 不放进初始快照（多了体重行会改变首页布局，牵动前面那些长按菜单的用例），由最后那条体重用例自己注入。
  const daysAgoIso = d => new Date(Date.now() - d * 86400000).toISOString();
  const seedWeight = (id, d, kg) => ({ id, userId: 'u_guest', weight: kg, date: daysAgoIso(d), unit: 'kg' });
  const WEIGHTS = [seedWeight('seed_w90', 90, 90), seedWeight('seed_w1', 1, 80), seedWeight('seed_w35', 35, 82), seedWeight('seed_w20', 20, 81)];
  // 体重目标建在 lbs 下：当前 / 目标值都按 lbs 存
  const GOAL_W = {
    id: 'seed_goal_w', userId: 'u_guest', type: 'weight', category: 'weight', title: 'E2E 减到 170', label: 'E2E 减到 170',
    targetValue: 170, currentValue: 180, unit: 'lbs', startDate: daysAgoIso(40), dataSource: 'manual',
    progressHistory: [], isActive: true, createdAt: daysAgoIso(40), updatedAt: daysAgoIso(40),
  };

  const seed = {
    schemaVersion: 2,
    workouts: [W_HEAT, W_DATE, W_DEL, W_NAME],
    goals: [],
    weightLogs: [],
    customMetrics: [],
    prs: [],
    scheduledWorkouts: [],
    prefs: {
      customTags: [],
      customExercises: [DEF_B, DEF_A, DEF_C],
      exerciseNotes: {},
      starredExercises: {},
      exerciseMetricConfigs: {},
      tagRenameOverrides: {},
      exerciseOverrides: { [DEF_B.id]: { name: { cn: '曲肘蝴蝶机', en: '曲肘蝴蝶机' } } },
      starredLastUpdateMs: 0,
      metricsLastUpdateMs: 0,
      prefsLastUpdateMs: Date.now(),
      lang: 'cn',
      unit: 'lbs',
    },
    tombstones: {},
  };

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
  const remote = { snapshot: seed, failPuts: false, failGets: false, gets: 0, puts: 0, putAttempts: 0 };
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
      remote.putAttempts++; // 送没送到都算：等「推送试过了」用
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
    report.consoleErrors.push(`[seeded] ${text}`);
    console.log(`    [console.error] ${text}`);
  });
  page.on('pageerror', err => {
    report.pageErrors.push(`[seeded] ${err}`);
    console.log(`    [pageerror] ${err}`);
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
   * 重开 App：reload 之后等启动流程（拉取合并 → 应用 prefs → 重读本地库）走完 ——
   * useFitlogSync 在最后给 <html> 打 data-fitlog-boot="done"（原来是 networkidle + 再死等 500–1000ms）。
   * 不能拿「时间线卡片出来了」当信号：WorkoutContext 挂载时先从本地库读一遍，卡片比拉取合并早（实测踩过：
   * 卡片出来就点「开始训练」，合并晚到把工作台重置了；更糟的是「重开后单位没翻回去」这类否定断言会在合并之前判，假绿）。
   */
  /**
   * 让同步安静下来：取消排队中的防抖推送，再立刻推一次（等这次 PUT 落地）。之后不会再有晚到的 PUT
   * 盖掉接下来往远端塞的夹具、也不会被算进 PUT 计数。原来是死等 1–1.5 s 让防抖（800ms）自己落地。
   * 走 window.__fitlog.cancelPendingPush（index.tsx）：从测试里 import 调度器模块不行 —— HMR 之后 App 用的是
   * fitlogSyncScheduler.ts?t=… 那个实例，按裸 URL import 拿到的是另一个，取消不了 App 的定时器（实测踩过）。
   */
  const quiesce = () =>
    page.evaluate(async () => {
      window.__fitlog.cancelPendingPush();
      await window.__fitlog.flush();
    });
  const relaunch = async () => {
    // 不用 networkidle：曾经「标记一出来就点『开始训练』被吞」不是启动没落定，是 FAB 吞点击的时间戳
    // 初值为 0，页面加载后前 400ms 的点击全被当成手势残余（已改 -Infinity，见 TabNavigation）
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('html[data-fitlog-boot="done"]').waitFor({ state: 'attached', timeout: 15_000 });
    await settle(page); // 重读本地库之后的那次渲染
    await toDashboard();
  };
  const longPress = async loc => {
    // 先居中：上一条用例留下的滚动位置可能让卡片贴在吸顶页头底下，按下去落在页头上
    await loc.evaluate(el => el.scrollIntoView({ block: 'center' }));
    const box = await stableBox(loc);
    await page.mouse.move(box.x + box.width / 2, box.y + Math.min(box.height / 2, 30));
    await page.mouse.down();
    await page.waitForTimeout(HOLD_MS);
    await page.mouse.up();
  };
  const sessionMenu = async (id, itemRe) => {
    // E2E_ONLY 单挑一步时可能不在首页
    if (!(await card(id).isVisible().catch(() => false))) await toDashboard();
    await longPress(card(id));
    const menu = page.locator('[data-testid="timeline-session-menu"]');
    await menu.waitFor({ state: 'visible', timeout: 3_000 });
    await page.waitForTimeout(400); // 菜单项的 350ms 静默期
    await menu.getByRole('menuitem').filter({ hasText: itemRe }).click();
  };
  const readLs = key => page.evaluate(k => JSON.parse(localStorage.getItem(lsKey(k)) || 'null'), key);
  const workoutTombstones = async () => (await readLs('fitlog_tombstones'))?.workouts ?? [];
  const remoteWorkout = id =>
    page.evaluate(async wid => {
      await window.__fitlog.flush();
      const snap = await window.__fitlog.fetchRemote();
      return (snap?.workouts || []).find(w => w.id === wid) ?? null;
    }, id);
  const dismissToasts = async () => {
    const dismiss = page.locator('[data-testid="toast"] [aria-label="dismiss"]');
    while (await dismiss.count()) await dismiss.first().click({ timeout: 1_000 }).catch(() => {});
  };

  await step(page, 'seeded-load', async () => {
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await card(W_HEAT.id).waitFor({ state: 'visible', timeout: 10_000 });
    const unit = await page.evaluate(() => localStorage.getItem(lsKey('fitlog_unit')));
    if (unit !== 'lbs') throw new Error(`seed unit not applied (${unit})`);
    return `seeded 4 workouts, unit ${unit}, tz ${TZ}`;
  });

  // heatmap-utc-day：昨晚 21:15 练的要亮在昨天那格，不是今天（UTC 日期）那格
  await step(page, 'seeded-heatmap-local-day', async () => {
    await page.locator('nav button', { hasText: /我的|Profile/ }).click();
    // 等热力图的格子画出来（读的是格子上的档位，不是格子在不在）
    await page.locator(`button[aria-label^="${torontoYmd(0)} "]`).waitFor({ state: 'attached', timeout: 5_000 });
    const level = ymd =>
      page.evaluate(d => {
        const el = document.querySelector(`button[aria-label^="${d} "]`);
        return el ? Number(getComputedStyle(el).getPropertyValue('--lvl') || el.style.getPropertyValue('--lvl')) : null;
      }, ymd);
    const today = torontoYmd(0);
    const [ly, lt] = [await level(yesterday), await level(today)];
    if (ly === null || lt === null) throw new Error(`heatmap cells not found (${yesterday}: ${ly}, ${today}: ${lt})`);
    if (!(ly > 0)) throw new Error(`${yesterday} 21:15 workout not on ${yesterday} (level ${ly})`);
    if (lt !== 0) throw new Error(`nothing trained today yet, but ${today} is lit (level ${lt}) — UTC 归日`);
    return `${yesterday} level ${ly}, ${today} level ${lt}`;
  });

  // set-number-all-one：时间线展开后组号是 1、2、3，不是 1、1、1
  await step(page, 'seeded-timeline-set-numbers', async () => {
    await toDashboard();
    await card(W_HEAT.id).click();
    const nums = card(W_HEAT.id).locator('.set-num');
    await nums.first().waitFor({ state: 'visible', timeout: 3_000 });
    const got = (await nums.allInnerTexts()).map(t => t.trim().match(/^\d+/)?.[0]);
    if (got.join(',') !== '1,2,3') throw new Error(`set numbers ${JSON.stringify(got)}, expected 1,2,3`);
    await card(W_HEAT.id).click(); // 收起
    return got.join(',');
  });

  // name-index-order-dependent（一）：自建列表顺序是 [B, A]，「悍马卧推」的历史仍归 A（现名悍马卧推），
  // 不能因为 B 排在前面就被认成「曲肘蝴蝶机」
  await step(page, 'seeded-name-collision-stable', async () => {
    await card(W_NAME.id).click();
    const text = await card(W_NAME.id).innerText();
    await card(W_NAME.id).click();
    if (/曲肘蝴蝶机/.test(text)) throw new Error('「悍马卧推」history resolved to 曲肘蝴蝶机 — 按数组顺序先到先得');
    if (!/悍马卧推/.test(text)) throw new Error(`unexpected card text: ${text.slice(0, 80)}`);
    return 'history stays with 悍马卧推';
  });

  // datepicker-stale-initial：编辑三天前 14:33 那场 → 打开日期选择器 → 不动直接确定，日期不能变
  await step(page, 'seeded-datepicker-initial', async () => {
    await sessionMenu(W_DATE.id, /编辑这次训练|Edit/);
    await page.waitForSelector('text=/编辑训练|Edit Workout/', { timeout: 5_000 });
    await page.getByTitle(/修改训练日期|Change workout date/).click();
    const dlg = page.locator('[role="dialog"]');
    await dlg.waitFor({ state: 'visible', timeout: 3_000 });
    await dlg.getByRole('button', { name: /^(确定|Confirm)$/ }).click();
    // 「确定」在同一个处理函数里写日期、关弹窗：弹窗没了时「已修改」该亮早就亮了，不用再等
    await dlg.waitFor({ state: 'detached', timeout: 3_000 });
    // 编辑态改的是草稿、不落库：日期被挪了的话这里会亮「已修改」（库里倒是不变，所以光看库测不到）
    if (await page.locator('[data-testid="edit-dirty"]').count()) {
      throw new Error('confirming the untouched picker changed the workout date (edit shows 已修改)');
    }
    await page.getByRole('button', { name: /^返回$|^Back$/ }).click();
    // 没改过＝直接离开编辑页；问了什么的话编辑页还在（被弹窗盖着）
    await page.waitForSelector('text=/编辑训练|Edit Workout/', { state: 'detached', timeout: 3_000 }).catch(() => {});
    if (await dlg.isVisible().catch(() => false)) throw new Error('back from an unchanged edit asked something');
    const w = await remoteWorkout(W_DATE.id);
    const local = await page.evaluate(iso => {
      const d = new Date(iso);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${d.getHours()}:${d.getMinutes()}`;
    }, w.date);
    if (local !== `${threeDaysAgo} 14:33`) throw new Error(`confirming untouched picker moved the workout to ${local} (was ${threeDaysAgo} 14:33)`);
    return `date kept: ${local}`;
  });

  // edit-history-cannot-discard / edit-history-false-unsaved / edit-history-end-semantics：
  // 编辑旧训练改的是草稿 —— 没改不亮「已修改」、保存键灰着；改了也不落库；返回点「放弃修改」真的丢；
  // 「保存修改」才写库，且不动 finishedAt、不出刊末页（否则 10 分钟内开练会被问「继续」这场旧训练）
  await step(page, 'seeded-edit-history-draft', async () => {
    const dirty = page.locator('[data-testid="edit-dirty"]');
    const save = page.locator('[data-testid="finish-button"]');
    const reps0 = () => page.locator('.ledger-row').first().locator('[data-testid="ledger-field-reps"] input');
    const repsInDb = async () => (await remoteWorkout(W_DATE.id))?.exercises?.[0]?.sets?.[0]?.reps;
    const openEdit = async () => {
      await sessionMenu(W_DATE.id, /编辑这次训练|Edit/);
      await page.waitForSelector('text=/编辑训练|Edit Workout/', { timeout: 5_000 });
    };

    await openEdit();
    if (await dirty.count()) throw new Error('untouched edit already shows 已修改');
    if (!(await save.isDisabled())) throw new Error('save button is enabled before any change');
    await reps0().fill('99');
    await dirty.waitFor({ state: 'visible', timeout: 3_000 });
    if (await save.isDisabled()) throw new Error('save button still disabled after an edit');
    if ((await repsInDb()) !== 10) throw new Error(`the draft leaked into the db (reps=${await repsInDb()})`);

    await page.getByRole('button', { name: /^返回$|^Back$/ }).click();
    await clickAppConfirm(page, /^(放弃修改|Discard)$/);
    // 放弃＝关掉编辑页；要是错把草稿写了库，也是在关页之前写的
    await page.waitForSelector('text=/编辑训练|Edit Workout/', { state: 'detached', timeout: 3_000 });
    if ((await repsInDb()) !== 10) throw new Error(`「放弃修改」kept the edit (reps=${await repsInDb()})`);

    await openEdit();
    if ((await reps0().inputValue()) !== '10') throw new Error('discarded edit is still on the bench');
    await reps0().fill('12');
    await dirty.waitFor({ state: 'visible', timeout: 3_000 });
    await save.click();
    await page.waitForSelector('text=/编辑训练|Edit Workout/', { state: 'detached', timeout: 5_000 });
    await page.waitForTimeout(300);
    if (await page.locator('[data-testid="workout-colophon"]').isVisible().catch(() => false)) {
      throw new Error('saving an edit replayed the colophon');
    }
    const w = await remoteWorkout(W_DATE.id);
    if (w.exercises[0].sets[0].reps !== 12) throw new Error(`save did not write (reps=${w.exercises[0].sets[0].reps})`);
    if (w.finishedAt !== W_DATE.finishedAt) throw new Error(`save moved finishedAt ${W_DATE.finishedAt} → ${w.finishedAt}`);
    await dismissToasts();
    return 'no-op edit clean; draft not persisted; discard drops it; save writes, finishedAt kept, no colophon';
  });

  // workout-delete-no-tombstone（一）：删整场立刻写墓碑，撤销摘掉
  await step(page, 'seeded-delete-tombstone-undo', async () => {
    await toDashboard();
    await sessionMenu(W_DATE.id, /删除|Delete/);
    await card(W_DATE.id).waitFor({ state: 'detached', timeout: 3_000 });
    if (!(await workoutTombstones()).includes(W_DATE.id)) throw new Error('deleting a workout wrote no tombstone');
    await page.locator('[data-testid="toast-undo"]').last().click();
    await card(W_DATE.id).waitFor({ state: 'visible', timeout: 5_000 });
    if ((await workoutTombstones()).includes(W_DATE.id)) throw new Error('undo left the tombstone behind');
    return 'tombstone written on delete, removed on undo';
  });

  // workout-delete-no-tombstone（二）：推送没送到时删一场，重开 App 拉取旧快照，它不能回来
  await step(page, 'seeded-delete-survives-failed-push', async () => {
    remote.failPuts = true;
    const attempts0 = remote.putAttempts;
    await sessionMenu(W_DEL.id, /删除|Delete/);
    await card(W_DEL.id).waitFor({ state: 'detached', timeout: 3_000 });
    // 删除和墓碑是当场写的（不等撤销条到期）；等删除之后那次防抖推送真的试过、被拒（原来死等撤销条到期 5.6 s）
    await until(() => remote.putAttempts > attempts0, 'the debounced push after the delete to be attempted', 8_000);
    const stillRemote = (remote.snapshot.workouts || []).some(w => w.id === W_DEL.id);
    if (!stillRemote) throw new Error('fixture drift: the server copy should still have the deleted workout');
    // 重开：卡片画出来时拉取合并已经落定（见 relaunch）
    await relaunch();
    remote.failPuts = false;
    if (await card(W_DEL.id).count()) throw new Error('deleted workout came back after reload — 推送失败时被拉取复活');
    await dismissToasts();
    return 'stays deleted across a reload with a stale server copy';
  });

  // 从动作库删除＝隐藏（2026-10 起内置 / 自建一样）：不弹确认，定义留在 customExercises，覆盖层打 hidden；
  // 撤销把 hidden 摘掉，自建列表的顺序一点不变（name-index-order-dependent 的那条也一并守住）
  await step(page, 'seeded-library-delete-hides', async () => {
    const before = ((await readLs('fitlog_custom_exercises')) || []).map(d => d.id);
    await page.getByRole('button', { name: /开始训练|Start Workout/ }).click();
    await pickStartGym(page);
    await page.waitForSelector('text=/新建训练|New Workout/', { timeout: 5_000 });
    // 弹层滑入不用等：fill / click 自己等元素可用、位置稳定
    await page.locator('[data-testid="open-picker-sheet"]').click();
    const sheet = page.locator('[data-testid="picker-sheet"]');
    await sheet.locator('input[type="text"]').fill('E2E自建甲');
    const row = sheet.locator('[data-testid="picker-sheet-exercise"]', { hasText: 'E2E自建甲' }).first();
    await row.waitFor({ state: 'visible', timeout: 3_000 });
    await longPress(row);
    const menu = page.locator('[data-testid="row-action-menu"]');
    await menu.waitFor({ state: 'visible', timeout: 3_000 });
    await menu.getByRole('button', { name: /从动作库删除|Delete from library/ }).click();
    // 删掉之后出撤销条（同一个处理函数里先写覆盖层、再弹条）；要是弹的是确认框，就没有撤销条
    await page.locator('[data-testid="toast-undo"]').last().waitFor({ state: 'visible', timeout: 3_000 }).catch(() => {});
    if (await page.locator('[role="dialog"]').isVisible().catch(() => false)) throw new Error('library delete asked for confirmation');
    const mid = ((await readLs('fitlog_custom_exercises')) || []).map(d => d.id);
    if (mid.join(',') !== before.join(',')) throw new Error(`delete removed the custom definition: ${before.join(',')} → ${mid.join(',')}`);
    if (!(await readLs('fitlog_exercise_overrides'))?.[DEF_C.id]?.hidden) throw new Error('delete did not mark it hidden');
    if (await row.isVisible().catch(() => false)) throw new Error('hidden exercise still listed');
    await page.locator('[data-testid="toast-undo"]').last().click();
    // 撤销：动作回到列表里（界面结果），再看存储
    await row.waitFor({ state: 'visible', timeout: 3_000 });
    if ((await readLs('fitlog_exercise_overrides'))?.[DEF_C.id]?.hidden) throw new Error('undo did not unhide');
    const after = ((await readLs('fitlog_custom_exercises')) || []).map(d => d.id);
    if (after.join(',') !== before.join(',')) throw new Error(`undo changed custom order: ${before.join(',')} → ${after.join(',')}`);
    await sheet.locator('input[type="text"]').fill('');
    await page.locator('[data-testid="picker-sheet-close"]').click();
    await dismissToasts();
    return `hidden + undo, definition and order kept: ${after.join(',')}`;
  });

  // remove-last-exercise-not-persisted：新训练删光动作 → 这场从库里删掉（写墓碑）；训练页删动作不给撤销（2026-10-18）
  await step(page, 'seeded-remove-last-exercise-drops-workout', async () => {
    // 接着上一条：已经在空的新训练里
    await page.locator('[data-testid="open-picker-sheet"]').click();
    await page.locator('[data-testid="picker-sheet-exercise"]').first().click();
    await page.locator('[data-testid="picker-sheet-close"]').click();
    const exCard = page.locator('.ui-card').filter({ has: page.locator('[data-testid="ledger-field-weight"]') }).first();
    await exCard.waitFor({ state: 'visible', timeout: 3_000 });
    const t0 = await workoutTombstones();
    const removeIt = async () => {
      await exCard.getByRole('button', { name: /动作菜单|Exercise menu/ }).click();
      await exCard.getByRole('menuitem', { name: /删除动作|Delete exercise/ }).click();
      await exCard.waitFor({ state: 'detached', timeout: 3_000 });
    };
    await removeIt();
    // 墓碑在删光之后写（下面断言恰好一条）：等它出现，超时就是没写
    const t1 = await until(async () => {
      const t = await workoutTombstones();
      return t.length > t0.length && t;
    }, 'emptying a new workout to write a workout tombstone').catch(() => workoutTombstones());
    const added = t1.filter(x => !t0.includes(x));
    if (added.length !== 1) throw new Error(`emptying a new workout should tombstone it, got ${JSON.stringify(added)}`);
    const wid = added[0];
    if (await page.locator('[data-testid="toast-undo"]').count()) throw new Error('deleting an exercise still shows an undo toast');
    // 删了再加回来接着练（没有撤销条后这是正常路径）：工作台已换新 id，这场照常落盘，不被刚写的墓碑抹掉
    const remoteIds = () =>
      page.evaluate(async () => {
        await window.__fitlog.flush();
        const snap = await window.__fitlog.fetchRemote();
        return (snap?.workouts || []).map(w => w.id);
      });
    const ids0 = await remoteIds();
    await page.locator('[data-testid="open-picker-sheet"]').click();
    await page.locator('[data-testid="picker-sheet-exercise"]').first().click();
    await page.locator('[data-testid="picker-sheet-close"]').click();
    await exCard.waitFor({ state: 'visible', timeout: 3_000 });
    // 工作台落本地库是异步的：等远端（flush 之后）出现一条新的，再判它对不对（原来死等 800ms）
    const fresh = await until(async () => {
      const f = (await remoteIds()).filter(id => !ids0.includes(id));
      return f.length && f;
    }, 'the re-added workout to persist').catch(() => []);
    const tomb = await workoutTombstones();
    if (fresh.length !== 1 || fresh[0] === wid || tomb.includes(fresh[0])) {
      throw new Error(`re-adding after emptying should persist under a new id, got ${JSON.stringify(fresh)} (old ${wid})`);
    }
    await removeIt();
    await page.getByLabel(/^返回$|^Back$/).first().click();
    // 离开＝底栏回来；问了什么就先确认
    await page.locator('nav').first().waitFor({ state: 'visible', timeout: 3_000 }).catch(() => {});
    if (await page.locator('[role="dialog"]').isVisible().catch(() => false)) await acceptAppConfirm(page);
    await card(W_HEAT.id).waitFor({ state: 'visible', timeout: 5_000 });
    if (await card(wid).count()) throw new Error('emptied workout still shows on the timeline');
    const w = await remoteWorkout(wid);
    if (w) throw new Error('emptied workout still in the library / snapshot');
    return `workout ${wid} dropped and tombstoned, no undo toast; re-added as ${fresh[0]}`;
  });

  // pr-stamp-kg-labeled-lbs：lbs 下历史最大 185，这次 200 → 印章写 185 → 200（不是 kg 的 83.9 → 90.7）
  await step(page, 'seeded-pr-stamp-in-display-unit', async () => {
    await sessionMenu(W_HEAT.id, /复制为今天的训练|Copy to today/);
    await pickStartGym(page);
    await page.waitForSelector('text=/新建训练|New Workout/', { timeout: 5_000 });
    const row0 = page.locator('.ledger-row').first();
    await row0.locator('[data-testid="ledger-field-weight"] input').fill('200');
    await row0.locator('.set-num').click();
    await row0.and(page.locator('.is-inked')).waitFor({ timeout: 3_000 });
    await page.getByRole('button', { name: /结束训练|End Workout/ }).first().click();
    await acceptAppConfirm(page);
    const nums = page.locator('.anim-stamp-drop + span .font-mono');
    await nums.first().waitFor({ state: 'visible', timeout: 5_000 });
    const t = (await nums.first().innerText()).replace(/\s+/g, ' ').trim();
    if (t !== '185 → 200') throw new Error(`PR stamp shows "${t}", expected "185 → 200" (lbs)`);
    return `stamp ${t}`;
  });

  // 「继续这场」接回来的训练删光动作，不整场删（用户定）：里面是真正练过的组
  await step(page, 'seeded-resumed-emptied-keeps-workout', async () => {
    // 接着上一条：刚结束的那场（复制自 W_HEAT，200 lbs 做完一组）
    const latest = await page.evaluate(async () => {
      await window.__fitlog.flush();
      const snap = await window.__fitlog.fetchRemote();
      const done = (snap?.workouts || []).filter(w => w.finishedAt);
      done.sort((a, b) => new Date(b.finishedAt) - new Date(a.finishedAt));
      return done[0] ? { id: done[0].id, n: done[0].exercises.length } : null;
    });
    if (!latest) throw new Error('fixture drift: no finished workout to resume');
    if (await page.locator('[data-testid="workout-colophon"]').isVisible().catch(() => false)) await dismissColophon(page);
    // 2026-10-11：开新一场不再弹「继续刚才那场？」；接回刚结束的那场走时间线长按菜单「继续这场」
    await sessionMenu(latest.id, /继续这场|Resume/);
    await page.waitForSelector('text=/新建训练|New Workout/', { timeout: 5_000 });
    const t0 = await workoutTombstones();
    const cards = page.locator('.ui-card').filter({ has: page.locator('[data-testid="ledger-field-weight"]') });
    for (let n = await cards.count(); n > 0; n--) {
      const c = cards.first();
      await c.getByRole('button', { name: /动作菜单|Exercise menu/ }).click();
      await c.getByRole('menuitem', { name: /删除动作|Delete exercise/ }).click();
      await until(async () => (await cards.count()) === n - 1, `exercise card #${n} to go away`);
    }
    // 「不该写墓碑」是否定断言，等不到它的结果：删光之后留一个和原来一样的窗口（原来每删一张等 400ms）
    await page.waitForTimeout(400);
    const added = (await workoutTombstones()).filter(x => !t0.includes(x));
    if (added.length) throw new Error(`emptying a resumed workout tombstoned ${JSON.stringify(added)} — 整场被删`);
    // 原来这里还死等 5.6 s「撤销条到期」：训练页删动作 2026-10-18 起就不出撤销条了，等的东西不存在
    await page.getByLabel(/^返回$|^Back$/).first().click();
    await page.locator('nav').first().waitFor({ state: 'visible', timeout: 3_000 }).catch(() => {});
    if (await page.locator('[role="dialog"]').isVisible().catch(() => false)) await acceptAppConfirm(page);
    await card(latest.id).waitFor({ state: 'visible', timeout: 5_000 });
    const w = await remoteWorkout(latest.id);
    if (!w || !w.exercises?.length) throw new Error('resumed workout lost its recorded exercises');
    return `workout ${latest.id} kept (${w.exercises.length} exercise)`;
  });

  // B1 / B2 / C2（2026-10-11）：弹层底部「完成」；本次打开里加过的再点一下＝取消；卡头「底稿 · M/D」点开看上次的几组
  await step(page, 'seeded-picker-toggle-done-bar-prefill', async () => {
    await page.getByRole('button', { name: /开始训练|Start Workout/ }).first().click();
    await pickStartGym(page);
    await page.waitForSelector('text=/新建训练|New Workout/', { timeout: 5_000 });
    // 问了的话是模态框：下面的点击会被遮罩挡住而超时，不会悄悄过去
    if (await page.locator('[role="dialog"]').isVisible().catch(() => false)) throw new Error('starting a workout must not ask about the last one any more');
    await page.locator('[data-testid="body-part-chest"]').click();
    const sheet = page.locator('[data-testid="picker-sheet"]');
    const search = sheet.locator('input[type="text"]');
    await search.waitFor({ state: 'visible', timeout: 3_000 });
    await search.fill('杠铃平板卧推');
    const row = sheet.locator('[data-testid="picker-sheet-exercise"]', { hasText: '杠铃平板卧推' }).first();
    await row.waitFor({ state: 'visible', timeout: 3_000 });
    const cards = page.locator('.ui-card').filter({ has: page.locator('[data-testid="ledger-field-weight"]') });
    await row.click();
    let tapAt = Date.now();
    await until(async () => (await cards.count()) >= 1, 'the tap to add a card').catch(() => {});
    if ((await cards.count()) !== 1) throw new Error(`one tap should add one card, got ${await cards.count()}`);
    const done = page.locator('[data-testid="picker-done"]');
    if (!/1/.test(await done.innerText())) throw new Error(`done bar should read 本次已加 1, got "${await done.innerText()}"`);
    await paceFrom(tapAt, PICK_DEDUPE_MS);
    // 等过了去重窗口再数一次：一下加出两张（比如 pointerup + click 各算一次）这时也该露出来了
    if ((await cards.count()) !== 1) throw new Error(`one tap should add one card, got ${await cards.count()} after ${PICK_DEDUPE_MS}ms`);
    await row.click(); // 再点一下＝取消本次添加
    tapAt = Date.now();
    await until(async () => (await cards.count()) === 0, 'the second tap to cancel the add').catch(() => {});
    if ((await cards.count()) !== 0) throw new Error(`tapping the same card again should cancel the add, got ${await cards.count()} card(s)`);
    if (/1/.test(await done.innerText())) throw new Error('done bar should drop the count after cancelling');
    await paceFrom(tapAt, PICK_DEDUPE_MS);
    if ((await cards.count()) !== 0) throw new Error(`cancel did not stick: ${await cards.count()} card(s) after ${PICK_DEDUPE_MS}ms`);
    await row.click();
    await until(async () => (await cards.count()) === 1, 'the third tap to add again');
    await done.click(); // 底部「完成」关弹层
    // 弹层常驻挂载、关了只是移出屏幕 + pointer-events-none，isVisible 看不出来，查类名
    const sheetClosed = () =>
      page.evaluate(() => {
        const el = document.querySelector('[data-testid="picker-sheet"]');
        return !!el && !!el.closest('.pointer-events-none');
      });
    const closed = await until(sheetClosed, 'the sheet to close').catch(() => false);
    if (!closed) throw new Error('bottom 完成 did not close the sheet');
    // C2：底稿抄自上次 → 卡头「底稿 · M/D」，点开看那次的几组
    const pf = page.locator('[data-testid="prefill-from"]').first();
    await pf.waitFor({ state: 'visible', timeout: 3_000 });
    await pf.click();
    const last = page.locator('[data-testid="prefill-last"]').first();
    await last.waitFor({ state: 'visible', timeout: 3_000 });
    const txt = (await last.innerText()).replace(/\s+/g, ' ').trim();
    if (!/×/.test(txt)) throw new Error(`last-session line should list sets, got "${txt}"`);
    await backAndDiscard(page);
    return `toggle add/cancel ok · done bar · ${txt}`;
  });

  // hidden-builtin-name-locked：删掉的动作名字不再被永久占着 —— 用同一个名字新建＝把它恢复出来（历史还挂在它身上）
  await step(page, 'seeded-create-restores-deleted', async () => {
    await page.getByRole('button', { name: /开始训练|Start Workout/ }).first().click();
    await pickStartGym(page);
    // 进了新建页，或者先问了一句（旧版会问「新开一场？」）：哪个先出来处理哪个
    await page.locator('[role="dialog"]').or(page.locator('text=/新建训练|New Workout/')).first().waitFor({ timeout: 5_000 });
    if (await page.locator('[role="dialog"]').isVisible().catch(() => false)) await clickAppConfirm(page, /^(新开一场|Start new)$/);
    await page.waitForSelector('text=/新建训练|New Workout/', { timeout: 5_000 });
    await page.locator('[data-testid="open-picker-sheet"]').click();
    const sheet = page.locator('[data-testid="picker-sheet"]');
    const search = sheet.locator('input[type="text"]');
    await search.fill('E2E自建甲');
    const row = sheet.locator('[data-testid="picker-sheet-exercise"]', { hasText: 'E2E自建甲' }).first();
    await row.waitFor({ state: 'visible', timeout: 3_000 });
    await longPress(row);
    const menu = page.locator('[data-testid="row-action-menu"]');
    await menu.waitFor({ state: 'visible', timeout: 3_000 });
    await menu.getByRole('button', { name: /从动作库删除|Delete from library/ }).click();
    await dismissToasts();
    await search.fill('');
    await search.fill('E2E自建甲');
    await sheet.getByRole('button', { name: /没找到？创建「E2E自建甲」/ }).click();
    const dlg = page.locator('[role="dialog"]').filter({ has: page.locator('input') }).last();
    await dlg.waitFor({ state: 'visible', timeout: 3_000 });
    await dlg.getByRole('button', { name: /^(确定|Confirm)$/ }).click();
    // 建好＝弹窗关掉；被拒的话弹窗留着、出「已经有」的提示
    await dlg.waitFor({ state: 'detached', timeout: 3_000 }).catch(() => {});
    const toasts = await page.locator('[data-testid="toast"]').allInnerTexts();
    if (toasts.some(t => /已经有/.test(t))) throw new Error(`create was refused: ${toasts.join(' / ')}`);
    if ((await readLs('fitlog_exercise_overrides'))?.[DEF_C.id]?.hidden) throw new Error('create with a deleted name did not restore it');
    const defs = (await readLs('fitlog_custom_exercises')) || [];
    if (defs.filter(d => d.name.cn === 'E2E自建甲').length !== 1) throw new Error('create with a deleted name made a duplicate definition');
    return 'same-name create restores the hidden exercise (no duplicate)';
  });

  // unit-lang-sync-revert：另一台设备后改过 prefs（远端整块时间戳更新），本机切单位后推送没送到、App 重开 ——
  // 拉取合并时单位不能被远端的旧值翻回去（原先切单位不打时间戳，整块 prefs 远端新就连单位一起赢）
  await step(page, 'seeded-unit-survives-stale-remote', async () => {
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.locator('html[data-fitlog-boot="done"]').waitFor({ state: 'attached', timeout: 15_000 });
    const btn = page.locator('[data-testid="header-unit-toggle"]');
    await btn.waitFor({ state: 'visible', timeout: 10_000 });
    const before = (await btn.innerText()).trim().toLowerCase();
    remote.snapshot = {
      ...remote.snapshot,
      prefs: { ...remote.snapshot.prefs, unit: before, prefsLastUpdateMs: Date.now() + 60_000 },
    };
    remote.failPuts = true;
    const attempts0 = remote.putAttempts;
    await btn.click();
    const after = (await btn.innerText()).trim().toLowerCase();
    if (after === before) throw new Error('unit toggle did nothing');
    // 防抖推送（这次送不到）：等它真的试过、被拒（原来死等 1.5 s）
    await until(() => remote.putAttempts > attempts0, 'the debounced push after the unit switch to be attempted');
    // 重开：卡片画出来时启动拉取合并已经落定，单位要翻回去的话此刻已经翻了（原来再死等 800ms）
    await relaunch();
    const reopened = (await btn.innerText()).trim().toLowerCase();
    remote.failPuts = false;
    if (reopened !== after) throw new Error(`unit flipped back to ${reopened} after relaunch (switched ${before} → ${after})`);
    const pushed = await page.evaluate(async () => {
      await window.__fitlog.flush();
      return (await window.__fitlog.fetchRemote())?.prefs?.appPrefs ?? null;
    });
    if (pushed?.unit !== after) throw new Error(`pushed appPrefs.unit is ${pushed?.unit}, expected ${after}`);
    await btn.click(); // 换回去，别影响后面
    return `${before} → ${after} survived a stale remote + relaunch; appPrefs pushed`;
  });

  // avatar-bloats-storage：头像缩成小 JPEG、只存一份（current_user 不再带）；旧版存的原图启动时缩一次
  await step(page, 'seeded-avatar-small-single-copy', async () => {
    const { default: sharp } = await import('sharp');
    const W = 900, H = 700;
    const noise = Buffer.alloc(W * H * 3);
    for (let i = 0; i < noise.length; i++) noise[i] = Math.floor(Math.random() * 256); // 真噪声：PNG 压不动，才像相册原图那么大
    const png = await sharp(noise, { raw: { width: W, height: H, channels: 3 } }).png().toBuffer();
    const bigDataUrl = `data:image/png;base64,${png.toString('base64')}`;
    const avatarState = () =>
      page.evaluate(() => {
        const a = localStorage.getItem(lsKey('fitlog_avatar_data_url')) || '';
        const u = JSON.parse(localStorage.getItem(lsKey('fitlog_current_user')) || '{}');
        return { len: a.length, jpeg: a.startsWith('data:image/jpeg'), userHasAvatar: 'avatarUrl' in u };
      });

    // 旧数据：两处各一整张原图
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

    // 新上传
    await page.locator('nav button', { hasText: /^我的$|^Profile$/ }).click();
    // 先清掉存的那份，好看出这次上传写了什么（上传的和上面是同一张图，缩出来一样，不清看不出变化）
    await page.evaluate(() => localStorage.removeItem(lsKey('fitlog_avatar_data_url')));
    await page.locator('input[type="file"][accept="image/*"]').setInputFiles({ name: 'big.png', mimeType: 'image/png', buffer: png });
    // 上传后缩图是异步的：等存储里有了这次写的，超时就是没写（原来死等 1 s）
    const up = await until(async () => {
      const s = await avatarState();
      return s.len > 0 && s;
    }, 'the uploaded avatar to be stored').catch(() => avatarState());
    if (!up.jpeg || up.len > 80_000) throw new Error(`uploaded avatar not shrunk: ${JSON.stringify(up)}`);
    if (up.userHasAvatar) throw new Error('upload wrote a second avatar copy into fitlog_current_user');
    const shown = await page.locator('img[alt="Avatar"]').getAttribute('src');
    if (!shown?.startsWith('data:image/jpeg')) throw new Error('profile does not show the shrunk avatar');
    return `legacy ${bigDataUrl.length} → ${legacy.len} chars; upload → ${up.len} chars; one copy`;
  });

  // plan-picker-legacy-library / plan-target-weight-unit：计划编辑器选动作走训练页同一个弹层 ——
  // 压在编辑器上面、连续多选、本次加过的再点＝取消、「已添加」按计划里已有的算、新建动作进计划不进训练；
  // 目标重量按当前单位（这里 lbs）填、存 kg、开练底稿照填的数；加到 4 个动作保存按钮仍在屏内
  await step(page, 'seeded-plan-picker-multi-unit', async () => {
    await page.locator('[data-testid="tab-plan"]').click();
    await page.locator('[data-testid="plan-subview-schedule"]').click();
    await page.locator('[data-testid="schedule-add-btn"]').click();
    await page.locator('[data-testid="schedule-editor"]').waitFor({ state: 'visible' });
    const planTitle = 'E2E 计划多选';
    await page.locator('[data-testid="schedule-title-input"]').fill(planTitle);
    const rows = page.locator('[data-testid="schedule-exercise-row"]');

    await page.locator('[data-testid="schedule-pick-library"]').click();
    const sheet = page.locator('[data-testid="picker-sheet"]');
    const search = sheet.locator('input[type="text"]');
    await search.waitFor({ state: 'visible', timeout: 3_000 });
    const z = await page.evaluate(() => {
      const zOf = el => (el ? Number(getComputedStyle(el).zIndex) : NaN);
      const sheetRoot = document.querySelector('[data-testid="picker-sheet"]')?.closest('.fixed');
      const editorRoot = document.querySelector('[data-testid="schedule-editor"]')?.closest('[role="presentation"]');
      return { sheet: zOf(sheetRoot), editor: zOf(editorRoot) };
    });
    if (!(z.sheet > z.editor)) throw new Error(`picker sheet z ${z.sheet} not above plan editor ${z.editor}`);

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
    await pick('哈克深蹲'); // 再点一下＝取消本次添加
    if ((await rows.count()) !== 2) throw new Error(`tapping 哈克深蹲 again should cancel it, got ${await rows.count()} rows`);
    const done = page.locator('[data-testid="picker-done"]');
    if (!/2/.test(await done.innerText())) throw new Error(`done bar should read 本次已加 2, got "${await done.innerText()}"`);
    await search.fill('杠铃平板卧推');
    const badge = await sheet.locator('[data-testid="picker-sheet-exercise"]', { hasText: '杠铃平板卧推' }).first().innerText();
    if (!/已添加/.test(badge)) throw new Error(`exercise already in the plan should show 已添加, got "${badge}"`);

    // 从弹层新建：进计划，不进训练（libraryPickCallbackRef 分流删掉之后改成回调）
    const newName = 'E2E计划新动作';
    await search.fill(newName);
    await sheet.getByRole('button', { name: new RegExp(`没找到？创建「${newName}」`) }).click();
    const dlg = page.locator('[role="dialog"]').filter({ has: page.locator('input') }).last();
    await dlg.waitFor({ state: 'visible', timeout: 3_000 });
    if (!/加入计划/.test(await dlg.innerText())) throw new Error('create-exercise dialog should say it goes into the plan');
    await dlg.getByRole('button', { name: /^(确定|Confirm)$/ }).click();
    await until(async () => (await rows.count()) === 3, 'the created exercise to join the plan').catch(() => {});
    if ((await rows.count()) !== 3) throw new Error(`created exercise should join the plan, got ${await rows.count()} rows`);
    if (!(await rows.nth(2).locator('[data-testid="schedule-exercise-name"]').inputValue()).includes(newName)) {
      throw new Error('third plan row is not the created exercise');
    }
    await done.click();
    const closed = await until(
      () => page.evaluate(() => !!document.querySelector('[data-testid="picker-sheet"]')?.closest('.pointer-events-none')),
      'the plan picker sheet to close',
    ).catch(() => false);
    if (!closed) throw new Error('完成 did not close the plan picker sheet');

    // 4 个动作：保存按钮还在屏内、没被盖住
    await page.locator('[data-testid="schedule-add-exercise"]').click();
    await rows.nth(3).locator('[data-testid="schedule-exercise-name"]').fill('E2E 手填');
    await rows.nth(0).locator('[data-testid="schedule-exercise-weight"]').fill('137');
    const save = page.locator('[data-testid="schedule-save-btn"]');
    const onScreen = await save.evaluate(el => {
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return r.bottom <= window.innerHeight && r.top >= 0 && !!hit && el.contains(hit);
    });
    if (!onScreen) throw new Error('save button is off screen / covered with 4 exercises');
    await save.click();
    await page.locator('[data-testid="schedule-editor"]').waitFor({ state: 'detached', timeout: 5_000 });

    const item = page.locator('[data-testid^="schedule-item-"]', { hasText: planTitle }).first();
    await item.waitFor({ state: 'visible', timeout: 5_000 });
    const itemText = await item.innerText();
    if (!/137lbs/.test(itemText)) throw new Error(`plan card should show 137lbs, got "${itemText.replace(/\s+/g, ' ')}"`);
    const scheduleId = (await item.getAttribute('data-testid')).replace('schedule-item-', '');
    const saved = await page.evaluate(async id => {
      await window.__fitlog.flush();
      const snap = await window.__fitlog.fetchRemote();
      return (snap?.scheduledWorkouts || []).find(s => s.id === id) ?? null;
    }, scheduleId);
    const kg = saved?.exercises?.[0]?.targetWeight;
    if (!(Math.abs(kg - 137 / LBS) < 0.01)) throw new Error(`targetWeight should be stored as kg (${(137 / LBS).toFixed(2)}), got ${kg}`);
    if (saved.exercises.length !== 4) throw new Error(`plan should keep 4 exercises, got ${saved.exercises.length}`);
    const workouts = await page.evaluate(async () => (await window.__fitlog.fetchRemote())?.workouts || []);
    if (workouts.some(w => (w.exercises || []).some(e => e.name === newName))) throw new Error('created exercise leaked into a workout');

    // 开练：底稿按今天的馆就近取整（「杠铃片」2026-10-18）：137 lb 杠铃 → 135（45 杆 + 每边 45；140 更远），
    // 行下标「计划 137 lb」。原来的 bug 是把 lb 当 kg 再换一次（135 → 297.62）
    await page.locator(`[data-testid="schedule-start-${scheduleId}"]`).click();
    await pickStartGym(page);
    // 前面的用例可能在工作台留了一场进行中的：从计划开练会先问要不要替换。哪个先出来处理哪个
    await page.locator('[role="dialog"]').or(page.locator('text=/新建训练|New Workout/')).first().waitFor({ timeout: 5_000 });
    if (await page.locator('[role="dialog"]').isVisible().catch(() => false)) await clickAppConfirm(page, /^(继续|Continue)$/);
    await page.waitForSelector('text=/新建训练|New Workout/', { timeout: 5_000 });
    const w0 =await page.locator('.ledger-row').first().locator('[data-testid="ledger-field-weight"] input').inputValue();
    if (Number(w0) !== 135) throw new Error(`plan 137 lb should start snapped to 135 lbs, got ${w0}`);
    const planTag = (await page.locator('.ledger-row').first().locator('[data-testid="prefill-ref"]').innerText().catch(() => '')).trim();
    if (planTag !== '计划 137 lb') throw new Error(`snapped plan weight should carry 「计划 137 lb」, got "${planTag}"`);
    await backAndDiscard(page);
    return `z ${z.sheet}>${z.editor} · pick 3 / cancel 1 / create 1 → plan · save on screen · 137lbs ↔ ${kg.toFixed(2)}kg · start 135 + 「${planTag}」`;
  });

  // 「杠铃片」馆档案（2026-10-18）：新的馆走 gym-new → 档案表单（不再是自由输入框）；
  // 每行「编辑」改档案。改的是今天这个馆、片子换成磅片 → 显示单位跟着切 lbs，没做完的组按新片子就近取整
  await step(page, 'seeded-gym-profile-new-and-edit', async () => {
    await page.locator('nav button', { hasText: /个人记录|PR Hub|Dashboard/ }).click();
    await page.getByRole('button', { name: /开始训练|Start Workout/ }).click();
    await pickStartGym(page);
    await page.waitForSelector('text=/新建训练|New Workout/', { timeout: 5_000 });
    const unitNow = async () => (await page.locator('[data-testid="unit-toggle"]').innerText()).trim();
    // 前面的用例把单位切成了 kg：先切回 lbs，好看出存公斤片的馆会把单位切过来
    if ((await unitNow()) !== 'lbs') await page.locator('[data-testid="unit-toggle"]').click();
    if ((await unitNow()) !== 'lbs') throw new Error('could not switch to lbs before the gym test');

    // 新的馆：公斤片。存好就用它 → 单位切到 kg
    await page.locator('[data-testid="gym-button"]').click();
    const picker = page.locator('[data-testid="gym-picker"]');
    await picker.waitFor({ state: 'visible', timeout: 3_000 });
    if (await page.locator('[data-testid="gym-new-input"]').count()) throw new Error('gym picker still has the free-text input');
    await page.locator('[data-testid="gym-new"]').click();
    const form = page.locator('[data-testid="gym-profile-form"]');
    await form.waitFor({ state: 'visible', timeout: 3_000 });
    // 没起名不让存
    await page.locator('[data-testid="gym-profile-save"]').click();
    if (!(await form.isVisible())) throw new Error('saving a nameless gym closed the form');
    const gymName = 'E2E 馆';
    await page.locator('[data-testid="gym-profile-name"]').fill(gymName);
    await form.getByRole('button', { name: /^公斤片$/ }).click();
    await page.locator('[data-testid="gym-profile-save"]').click();
    await form.waitFor({ state: 'detached', timeout: 3_000 });
    if (!(await page.locator('[data-testid="gym-button"]').innerText()).includes(gymName)) throw new Error('new gym was not picked for today');
    if ((await unitNow()) !== 'kg') throw new Error(`kg-plate gym should switch the unit to kg, got ${await unitNow()}`);
    const gyms = (await readLs('fitlog_app_prefs'))?.gyms;
    if (gyms?.[gymName]?.plateUnit !== 'kg') throw new Error(`profile not stored in appPrefs.gyms: ${JSON.stringify(gyms)}`);

    // 加杠铃卧推（底稿抄上一次的），凑够 3 组；底稿在公斤片上能挂（20 杆 + 一对对 1.25）
    await page.locator('[data-testid="open-picker-sheet"]').click();
    const sheet = page.locator('[data-testid="picker-sheet"]');
    await sheet.locator('input[type="text"]').fill('杠铃平板卧推');
    await sheet.locator('[data-testid="picker-sheet-exercise"]', { hasText: '杠铃平板卧推' }).first().click();
    await page.locator('[data-testid="picker-sheet-close"]').click();
    const weights = () => page.locator('.ledger-row [data-testid="ledger-field-weight"] input').evaluateAll(els => els.map(e => Number(e.value)));
    await page.locator('.ledger-row').first().waitFor({ state: 'visible', timeout: 3_000 });
    for (let n = (await weights()).length; n < 3; n++) {
      await page.getByRole('button', { name: /^\+?\s*添加组$|Add Set/ }).first().click();
      await until(async () => (await weights()).length > n, 'the added set row');
    }
    const w0 = await weights();
    const onKgGrid = v => v >= 20 && Math.abs((v - 20) / 2.5 - Math.round((v - 20) / 2.5)) < 1e-6;
    if (!onKgGrid(w0[0])) throw new Error(`draft should be snapped onto kg plates, got ${w0[0]}`);
    // 第 1 组打 60 → 后面两组跟成 60
    const first = page.locator('.ledger-row').first().locator('[data-testid="ledger-field-weight"] input');
    await first.click();
    await page.waitForTimeout(80);
    await page.keyboard.type('60');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    const w1 = await weights();
    if (!w1.every(w => w === 60)) throw new Error(`typing 60 should carry the drafts below, got ${JSON.stringify(w1)}`);

    // 编辑今天这个馆：换成磅片 → 单位切 lbs，60 kg (132.28 lb) 就近取到 130（130 差 2.28、135 差 2.72）
    await page.locator('[data-testid="gym-button"]').click();
    await picker.waitFor({ state: 'visible', timeout: 3_000 });
    const idx = await picker.locator('[data-testid^="gym-option-"]').evaluateAll((els, n) => els.findIndex(e => e.textContent.includes(n)), gymName);
    if (idx < 0) throw new Error('new gym missing from the list');
    if (!/公斤片/.test(await picker.locator(`[data-testid="gym-option-${idx}"]`).innerText())) throw new Error('gym row should show its plate unit');
    await page.locator(`[data-testid="gym-edit-${idx}"]`).click();
    await form.waitFor({ state: 'visible', timeout: 3_000 });
    if (await page.locator('[data-testid="gym-profile-name"]').count()) throw new Error('editing an existing gym should not ask for a name');
    await form.getByRole('button', { name: /^磅片$/ }).click();
    await page.locator('[data-testid="gym-profile-save"]').click();
    await form.waitFor({ state: 'detached', timeout: 3_000 });
    // 存档案 → 切单位 → 重新取整：等单位切过来、组重新取整（正向，等不到就超时、照样断言）
    await until(async () => (await unitNow()) === 'lbs' && (await weights()).every(w => w !== 60), 'the unit switch + re-round after saving lb plates').catch(() => {});
    if ((await unitNow()) !== 'lbs') throw new Error(`saving today's gym with lb plates should switch to lbs, got ${await unitNow()}`);
    const w2 = await weights();
    if (!w2.every(w => w === 130)) throw new Error(`pending sets should re-round onto lb plates (60 kg → 130 lb), got ${JSON.stringify(w2)}`);
    const t = await page.locator('[data-testid="toast"]').last().innerText();
    if (!/没做完的组按新档案重新取整/.test(t)) throw new Error(`edit-today toast: ${t}`);
    await dismissToasts();
    await backAndDiscard(page);
    return `lbs → new ${gymName} (kg plates) → kg · draft ${w0[0]} · typed 60 ×${w1.length} → edit to lb plates → ${w2.join('/')} lbs`;
  });

  // 30 天体重变化：80 - 82 = -2 kg = -4.4 lbs（旧版取最早那条：80 - 90 → -22.0）
  // 记一笔新体重后，lbs 体重目标的「当前」要是 lbs 数（旧版直接写 kg）
  await step(page, 'seeded-weight-30d-and-goal-unit', async () => {
    // 远端塞进体重 / 目标，重开 App 走启动拉取合并进本地。
    // 先让上一条留下的防抖推送作废（quiesce），否则它晚到的 PUT 会把刚塞进去的又盖掉
    await quiesce();
    remote.snapshot = { ...remote.snapshot, weightLogs: WEIGHTS, goals: [GOAL_W] };
    await relaunch();
    await page.locator('[data-testid="weight-delta-30d"]').waitFor({ state: 'visible', timeout: 10_000 });
    const unitNow = await page.evaluate(() => localStorage.getItem(lsKey('fitlog_unit')));
    if (unitNow !== 'lbs') throw new Error(`precondition: unit should be lbs, got ${unitNow}`);
    const delta = (await page.locator('[data-testid="weight-delta-30d"]').innerText()).replace(/\s+/g, ' ');
    if (!/^-4\.4 lbs/.test(delta)) throw new Error(`30d delta should be -4.4 lbs, got "${delta}"`);
    await page.getByRole('button', { name: '记录体重', exact: true }).click();
    const dlg = page.getByRole('dialog');
    await dlg.locator('.scrub-num input').fill('176.4');
    await dlg.getByRole('button', { name: '确定' }).click();
    await dlg.waitFor({ state: 'hidden', timeout: 3_000 });
    const goal = await page.evaluate(async () => {
      await window.__fitlog.flush();
      const snap = await window.__fitlog.fetchRemote();
      return (snap?.goals || []).find(g => g.id === 'seed_goal_w') ?? null;
    });
    if (!goal) throw new Error('weight goal missing from remote after logging weight');
    if (goal.currentValue !== 176.4) throw new Error(`goal currentValue should be 176.4 (lbs), got ${goal.currentValue}`);
    return `delta "${delta}", goal current ${goal.currentValue} ${goal.unit}`;
  });

  // 手动同步：拉取失败（网络断）时绝不能接着推送 —— 没读到远端就推 = 拿本地盖掉远端。
  // 先跑一遍拉取正常的，证明这个按钮确实会推（否则「没有 PUT」可能只是按钮没生效）
  await step(page, 'seeded-sync-skips-push-when-pull-fails', async () => {
    await quiesce(); // 上一条留下的防抖推送作废，免得算进来（原来死等 1.5 s）
    const sync = page.locator('[data-testid="header-sync"]');
    const waitIdle = () => page.waitForFunction(() => !document.querySelector('[data-testid="header-sync"]')?.disabled, null, { timeout: 10_000 });
    let before = remote.puts;
    await sync.click();
    // 健康的同步：拉 → 推。等推送落地（正向；等不到就超时，下面照样断言）
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
      // 「不该推」是否定断言：拉取失败后留 1 s 看有没有补推（和原来一样）
      await page.waitForTimeout(1_000);
      if (remote.puts !== before) throw new Error(`pull failed but sync still PUT ${remote.puts - before}x`);
      const cls = (await sync.getAttribute('class')) || '';
      if (!/bg-danger/.test(cls)) throw new Error('sync button should show the error state after a failed pull');
    } finally {
      remote.failGets = false;
      expectedConsole.delete('push skipped');
    }
    await dismissToasts();
    return 'healthy pull → PUT; failed pull → no PUT, error state';
  });

  // 换馆重量（2026-10-20，design-plates.md「换馆重量」）：
  // A 底稿本馆优先、本馆没练过退回别馆并写明在哪个馆、换馆时没动过的卡重新挑来源；
  // A2 这台在这个馆是插销还是挂片；B 两层备注；D 自定义片按馆的单位存
  await step(page, 'seeded-gym-weight-per-gym', async () => {
    await quiesce();
    const GA = 'E2E 甲馆', GB = 'E2E 乙馆', GC = 'E2E 丙馆';
    const kgGym = machine => ({ plateUnit: 'kg', plates: [25, 20, 15, 10, 5, 2.5, 1.25], cable: { v: 5, u: 'kg' }, machine: { v: machine, u: 'kg' }, dumbbell: { v: 2.5, u: 'kg' } });
    const at = (id, days, gym, w) => ({ ...seedWorkout(id, torontoAt(torontoYmd(days), 9, 0), `E2E ${gym}`, '器械推肩', [[w, 10]]), gym });
    const prefs = remote.snapshot.prefs ?? {};
    remote.snapshot = {
      ...remote.snapshot,
      // 乙馆的更近（1 天前），甲馆的更早：今天在甲馆要抄甲馆的 40，不是最近那次的 23
      workouts: [...(remote.snapshot.workouts ?? []), at('seed_gym_a', 3, GA, 40), at('seed_gym_b', 1, GB, 23)],
      prefs: {
        ...prefs,
        appPrefs: { ...(prefs.appPrefs ?? {}), gyms: { ...(prefs.appPrefs?.gyms ?? {}), [GA]: kgGym(5), [GB]: kgGym(1), [GC]: kgGym(5) } },
        appPrefsUpdatedMs: Date.now() + 1000,
      },
    };
    await relaunch();
    // 上一条用例留下了一场进行中的（同步用例里加的动作）：先放弃，从空的一场开始
    const inProgress = page.locator('[data-testid="in-progress"]');
    if (await inProgress.isVisible().catch(() => false)) {
      await page.locator('[data-testid="in-progress-end"]').click();
      await clickAppConfirm(page, /^(放弃|Discard)$/);
      await inProgress.waitFor({ state: 'detached', timeout: 3_000 });
    }
    await page.getByRole('button', { name: /开始训练|Start Workout/ }).click();
    await pickStartGym(page);
    await page.waitForSelector('text=/新建训练|New Workout/', { timeout: 5_000 });
    const picker = page.locator('[data-testid="gym-picker"]');
    const pickGym = async name => {
      await page.locator('[data-testid="gym-button"]').click();
      await picker.waitFor({ state: 'visible', timeout: 3_000 });
      await picker.locator('[data-testid^="gym-option-"]', { hasText: name }).click();
      await picker.waitFor({ state: 'hidden', timeout: 3_000 });
      // 换馆后卡上的底稿按新馆重挑 / 重新取整（effect 里做）：等它画完再读
      await until(async () => (await page.locator('[data-testid="gym-button"]').innerText()).includes(name), `today's gym to read ${name}`);
      await settle(page);
    };
    const weights = () => page.locator('.ledger-row [data-testid="ledger-field-weight"] input').evaluateAll(els => els.map(e => Number(e.value)));
    const eyebrow = () => page.locator('[data-testid="prefill-from"]').innerText();
    const prefillGym = async () => ((await page.locator('[data-testid="prefill-gym"]').count()) ? page.locator('[data-testid="prefill-gym"]').innerText() : null);

    // A：今天在甲馆 → 抄甲馆的 40；眉批不写馆
    await pickGym(GA);
    await page.locator('[data-testid="open-picker-sheet"]').click();
    const sheet = page.locator('[data-testid="picker-sheet"]');
    await sheet.locator('input[type="text"]').fill('器械推肩');
    await sheet.locator('[data-testid="picker-sheet-exercise"]', { hasText: '器械推肩' }).first().click();
    await page.locator('[data-testid="picker-sheet-close"]').click();
    await page.locator('.ledger-row').first().waitFor({ state: 'visible', timeout: 3_000 });
    await settle(page);
    const wA = await weights();
    if (wA.join() !== '40') throw new Error(`at ${GA} the draft should copy ${GA}'s 40, got ${JSON.stringify(wA)} (eyebrow "${await eyebrow()}")`);
    if (await prefillGym()) throw new Error(`same-gym draft should not name a gym, got "${await prefillGym()}"`);

    // 换到乙馆：卡上全是没动过的底稿 → 按乙馆重新挑，23（乙馆一档 1 kg，挂得出）
    await pickGym(GB);
    const wB = await weights();
    if (wB.join() !== '23') throw new Error(`switching to ${GB} should re-pick ${GB}'s 23, got ${JSON.stringify(wB)}`);
    if (await prefillGym()) throw new Error(`after switching to ${GB} the eyebrow should not name a gym, got "${await prefillGym()}"`);

    // 丙馆没练过 → 退回最近一次（乙馆），眉批写明「在 乙馆」；点开那行写「上次在 乙馆」
    await pickGym(GC);
    const wC = await weights();
    if (wC.join() !== '25') throw new Error(`${GC} (5 kg step) should fall back to ${GB}'s 23 rounded to 25, got ${JSON.stringify(wC)}`);
    if ((await prefillGym()) !== GB) throw new Error(`fallback draft should say it came from ${GB}, got "${await prefillGym()}" / "${await eyebrow()}"`);
    await page.locator('[data-testid="prefill-from"]').click();
    const lastLine = await page.locator('[data-testid="prefill-last"]').innerText();
    if (!lastLine.includes(`上次在 ${GB}`)) throw new Error(`expanded line should say 上次在 ${GB}: "${lastLine}"`);
    await page.locator('[data-testid="prefill-from"]').click();

    // A2：回乙馆，大图上方小药丸 → 「这台器械」里改成挂片（2026-10-21 起这些设置不在 ⋯ 菜单里了）
    await pickGym(GB);
    if ((await weights()).join() !== '23') throw new Error('back at the gym with history the draft should be 23 again');
    const face = page.locator('[data-testid="stack-menu"]');
    const openFace = async () => {
      if (!(await face.isVisible())) await page.locator('[data-testid="stack-chip"]').first().click();
      await face.waitFor({ state: 'visible', timeout: 3_000 });
    };
    const closeFace = async () => {
      await face.locator('[data-testid="stack-done"]').click();
      await face.waitFor({ state: 'hidden', timeout: 2_000 });
    };
    await openFace();
    await face.locator('[data-testid="gym-kind"]').waitFor({ state: 'visible', timeout: 3_000 });
    if ((await face.locator('[data-testid="gym-kind-pin"]').getAttribute('aria-pressed')) !== 'true') throw new Error('library kind (pin) should be selected by default');
    if (!(await face.locator('[data-testid="stack-step"]').count())) throw new Error('pin machine should offer the per-machine step');
    await face.locator('[data-testid="gym-kind-loaded"]').click();
    await settle(page);
    const kinds = (await readLs('fitlog_app_prefs'))?.gymKinds;
    if (kinds?.[`${GB}|press_machine_shoulder|`] !== 'loaded') throw new Error(`gymKinds not stored: ${JSON.stringify(kinds)}`);
    const wK = await weights();
    if (wK.join() !== '22.5') throw new Error(`plate-loaded at ${GB}: 23 should re-round to 22.5, got ${JSON.stringify(wK)}`);
    if (await face.locator('[data-testid="stack-step"]').count()) throw new Error('plate-loaded machine should not show the per-machine step');
    // 空载：填 30 → 记进 gymTares（带单位），大图说明「加空载共 52.5 kg」，记录照旧 22.5；清空 → 墓碑，回到「只算片子」
    const tare = face.locator('[data-testid="gym-tare"]');
    await tare.fill('30');
    await tare.press('Enter');
    await settle(page);
    const tares = (await readLs('fitlog_app_prefs'))?.gymTares;
    if (JSON.stringify(tares?.[`${GB}|press_machine_shoulder|`]) !== '{"v":30,"u":"kg"}') throw new Error(`gymTares not stored: ${JSON.stringify(tares)}`);
    await closeFace();
    if (!(await page.getByText('加空载共 52.5 kg').count())) throw new Error('hero caption should add the sled: 加空载共 52.5 kg');
    if (!(await page.locator('[data-testid="stack-chip"]').first().innerText()).includes('空载 30')) throw new Error('the pill should read 挂片 · 空载 30 kg');
    if ((await weights()).join() !== '22.5') throw new Error(`the sled must not change the logged weight, got ${JSON.stringify(await weights())}`);
    await openFace();
    await tare.fill('');
    await tare.press('Enter');
    await settle(page);
    if ((await readLs('fitlog_app_prefs'))?.gymTares?.[`${GB}|press_machine_shoulder|`] !== '') throw new Error('clearing the sled should leave a tombstone');
    await closeFace();
    if (!(await page.getByText(/只算片子/).count())) throw new Error('without a sled the caption should say 只算片子 again');
    // 改回插销 → 写墓碑（和动作库一样），再改成挂片留着
    await openFace();
    await face.locator('[data-testid="gym-kind-pin"]').click();
    await settle(page);
    const kinds2 = (await readLs('fitlog_app_prefs'))?.gymKinds;
    if (kinds2?.[`${GB}|press_machine_shoulder|`] !== '') throw new Error(`back to the library kind should leave a tombstone: ${JSON.stringify(kinds2)}`);
    await face.locator('[data-testid="gym-kind-loaded"]').click();
    await settle(page);
    await closeFace();

    // ⋯ 菜单只留对动作的操作：不再有插销 / 挂片、一档、空载
    await page.getByRole('button', { name: '动作菜单' }).first().click();
    const menu = page.getByRole('menu');
    await menu.waitFor({ state: 'visible', timeout: 3_000 });
    if (await menu.locator('[data-testid="gym-kind"], [data-testid="gym-tare"], [data-testid="gym-inc-value"]').count()) throw new Error('the ⋯ menu should no longer carry machine settings');
    // B：⋯ 加备注 → 两栏；卡上本馆的在前
    await menu.getByRole('menuitem', { name: /加备注|编辑备注/ }).click();
    const dlg = page.getByRole('dialog');
    await dlg.locator('[data-testid="note-gym"]').fill('凳子 3');
    await dlg.locator('[data-testid="note-general"]').fill('慢放');
    await dlg.getByRole('button', { name: '确定' }).click();
    await dlg.waitFor({ state: 'hidden', timeout: 3_000 });
    const note = await page.locator('[data-testid="exercise-note"]').innerText();
    if (!/凳子 3[\s\S]*慢放/.test(note)) throw new Error(`card should show the gym note first, then the general one: "${note}"`);
    const ap = await readLs('fitlog_app_prefs');
    if (ap?.gymNotes?.[`${GB}|press_machine_shoulder|`] !== '凳子 3') throw new Error(`gym note not stored: ${JSON.stringify(ap?.gymNotes)}`);
    const general = await readLs('fitlog_exercise_notes');
    if (general?.['器械推肩'] !== '慢放') throw new Error(`general note not stored: ${JSON.stringify(general)}`);
    // 换到甲馆：本馆备注不跟过去，通用的还在；甲馆这台照旧是插销（改的只是乙馆）
    await pickGym(GA);
    const noteA = await page.locator('[data-testid="exercise-note"]').innerText();
    if (/凳子/.test(noteA) || !/慢放/.test(noteA)) throw new Error(`at ${GA} only the general note should show: "${noteA}"`);
    if ((await weights()).join() !== '40') throw new Error(`at ${GA} (still pin) the draft should be 40, got ${JSON.stringify(await weights())}`);

    // D：编辑甲馆，加一片 45 lb → 按馆的单位存 20.4
    await page.locator('[data-testid="gym-button"]').click();
    await picker.waitFor({ state: 'visible', timeout: 3_000 });
    const idx = await picker.locator('[data-testid^="gym-option-"]').evaluateAll((els, n) => els.findIndex(e => e.textContent.includes(n)), GA);
    await page.locator(`[data-testid="gym-edit-${idx}"]`).click();
    const form = page.locator('[data-testid="gym-profile-form"]');
    await form.waitFor({ state: 'visible', timeout: 3_000 });
    await form.locator('[data-testid="gym-custom-weight"]').fill('45');
    await form.locator('[data-testid="gym-custom-unit-lbs"]').click();
    const conv = await form.locator('[data-testid="gym-custom-converted"]').innerText();
    if (!conv.includes('20.4')) throw new Error(`45 lb in a kg gym should read = 20.4 kg: "${conv}"`);
    await form.locator('[data-testid="gym-custom-add"]').click();
    await form.locator('[data-testid="gym-plate-custom-20.4"]').waitFor({ state: 'visible', timeout: 2_000 });
    await page.locator('[data-testid="gym-profile-save"]').click();
    await form.waitFor({ state: 'detached', timeout: 3_000 });
    const platesA = (await readLs('fitlog_app_prefs'))?.gyms?.[GA]?.plates ?? [];
    if (!platesA.includes(20.4)) throw new Error(`custom plate not stored in the gym profile: ${JSON.stringify(platesA)}`);
    await dismissToasts();
    await backAndDiscard(page);
    return `${GA} 40 → ${GB} ${wB} → ${GC} ${wC} (from ${GB}) · ${GB} plate-loaded ${wK} · notes "${note.replace(/\s+/g, ' ')}" · ${GA} plates +20.4`;
  });

  // 「健身房器材」→ 龙门架（2026-10-20，utils/cableTagMigration.ts）：真实数据里自建的龙门架动作和改过器材的内置龙门架动作
  // 都标成了 tagGym（用户把它改名叫「龙门架」），负荷判断不认，馆档案整套失效。远端还是旧标签时，拉下来就要纠正，
  // 而且动作卡 ⋯ 里要出现「这台是 插销 / 挂片」（之前缺的就是这个）。
  await step(page, 'seeded-gym-tag-becomes-cable', async () => {
    await quiesce();
    const NAME = 'E2E 龙门架下压';
    const prefs = remote.snapshot.prefs ?? {};
    remote.snapshot = {
      ...remote.snapshot,
      prefs: {
        ...prefs,
        customExercises: [
          ...(prefs.customExercises ?? []).filter(d => d.id !== 'e2e_gym_tag'),
          { id: 'e2e_gym_tag', name: { cn: NAME, en: NAME }, bodyPart: 'subArms', tags: ['tagGym'], category: 'STRENGTH' },
        ],
        exerciseOverrides: { ...(prefs.exerciseOverrides ?? {}), face_pull_cable: { tags: ['tagGym'] } },
        tagRenameOverrides: { ...(prefs.tagRenameOverrides ?? {}), tagGym: '龙门架' },
        prefsLastUpdateMs: Date.now() + 1000,
      },
    };
    // 迁移在启动拉取合并时做，卡片画出来时已经落定（原来再死等 800ms）
    await relaunch();
    const defs = (await readLs('fitlog_custom_exercises')) || [];
    const mine = defs.find(d => d.id === 'e2e_gym_tag');
    if (JSON.stringify(mine?.tags) !== '["tagCable"]') throw new Error(`custom tagGym should become tagCable after pull: ${JSON.stringify(mine?.tags)}`);
    const ovr = (await readLs('fitlog_exercise_overrides')) || {};
    if (JSON.stringify(ovr.face_pull_cable?.tags) !== '["tagCable"]') throw new Error(`override tagGym should become tagCable: ${JSON.stringify(ovr.face_pull_cable)}`);
    const renames = (await readLs('fitlog_tag_rename_overrides')) || {};
    if ('tagGym' in renames) throw new Error(`the 龙门架 rename on tagGym should be dropped: ${JSON.stringify(renames)}`);
    // 跑步机这类有氧的 tagGym 不动（内置定义没被覆盖，迁移也不会给它写覆盖）
    if (ovr.run_tread) throw new Error(`cardio treadmill should not get an override: ${JSON.stringify(ovr.run_tread)}`);

    // 上一条用例可能留下一场进行中的：接回去在那一场里加，最后照样放弃，不留记录
    if (await page.locator('[data-testid="in-progress"]').isVisible().catch(() => false)) {
      await page.locator('[data-testid="in-progress"] button').first().click();
    } else {
      await page.getByRole('button', { name: /开始训练|Start Workout/ }).click();
      await pickStartGym(page);
    }
    await page.locator('[data-testid="gym-button"]').waitFor({ state: 'visible', timeout: 5_000 });
    const picker = page.locator('[data-testid="gym-picker"]');
    await page.locator('[data-testid="gym-button"]').click();
    await picker.waitFor({ state: 'visible', timeout: 3_000 });
    await picker.locator('[data-testid^="gym-option-"]', { hasText: 'E2E 甲馆' }).click();
    await picker.waitFor({ state: 'hidden', timeout: 3_000 });
    await page.locator('[data-testid="open-picker-sheet"]').click();
    const sheet = page.locator('[data-testid="picker-sheet"]');
    await sheet.locator('input[type="text"]').fill(NAME);
    await sheet.locator('[data-testid="picker-sheet-exercise"]', { hasText: NAME }).first().click();
    await page.locator('[data-testid="picker-sheet-close"]').click();
    // 接回来的那一场里可能还有别的动作：按名字找这张卡，点大图上方的小药丸
    const gcard = page.locator('.ui-card', { has: page.locator('.masthead-rule', { hasText: NAME }) }).last();
    await gcard.locator('[data-testid="stack-chip"]').click();
    const gface = gcard.locator('[data-testid="stack-menu"]');
    await gface.locator('[data-testid="gym-kind"]').waitFor({ state: 'visible', timeout: 3_000 });
    if ((await gface.locator('[data-testid="gym-kind-pin"]').getAttribute('aria-pressed')) !== 'true') throw new Error('a cable exercise should default to pin');
    await gface.locator('[data-testid="stack-done"]').click();
    await gface.waitFor({ state: 'hidden', timeout: 2_000 });
    await backAndDiscard(page);
    return 'pulled tagGym → tagCable (custom + override), rename dropped, machine face shows 插销 / 挂片';
  });

  // 配重片起始 + 递减保持方向（2026-10-20 用户报）：
  // 上次 22 → 递减 16.6 lb，在每格 10 lb 的馆里两档都会吸成 20 —— 递减必须仍然更轻（→ 10）；
  // 大图上把这台改成「最轻 12.5 · 每格 5」：存进这一台的 gymOverrides，组吸到 22.5 / 12.5
  await step(page, 'seeded-stack-start-and-drop-order', async () => {
    await page.waitForTimeout(800);
    await page.evaluate(() => window.__fitlog.flush());
    const GD = 'E2E 丁馆';
    const LB = 0.45359237;
    const iso = torontoAt(torontoYmd(2), 9, 0).toISOString();
    const w = {
      id: 'seed_gym_d', userId: 'u_guest', date: iso, title: 'E2E 丁馆', status: 'completed', finishedAt: iso, updatedAt: iso, gym: GD,
      exercises: [{ id: 'seed_gym_d_ex', name: '器械推肩', category: 'STRENGTH', sets: [
        { id: 'seed_gym_d_s0', weight: 22 * LB, reps: 9, subSets: [{ weight: 16.6 * LB, reps: 6 }] },
      ] }],
    };
    const prefs = remote.snapshot.prefs ?? {};
    remote.snapshot = {
      ...remote.snapshot,
      workouts: [...(remote.snapshot.workouts ?? []).filter(x => x.id !== 'seed_gym_d'), w],
      prefs: {
        ...prefs,
        appPrefs: { ...(prefs.appPrefs ?? {}), gyms: { ...(prefs.appPrefs?.gyms ?? {}), [GD]: { plateUnit: 'lbs', plates: [45, 35, 25, 10, 5, 2.5], cable: { v: 10, u: 'lbs' }, machine: { v: 10, u: 'lbs' }, dumbbell: { v: 5, u: 'lbs' } } } },
        appPrefsUpdatedMs: Date.now() + 1000,
      },
    };
    await page.reload({ waitUntil: 'networkidle' });
    await toDashboard();
    if (await page.locator('[data-testid="in-progress"]').isVisible().catch(() => false)) {
      await page.locator('[data-testid="in-progress"] button').first().click();
    } else {
      await page.getByRole('button', { name: /开始训练|Start Workout/ }).click();
      await pickStartGym(page);
    }
    await page.locator('[data-testid="gym-button"]').waitFor({ state: 'visible', timeout: 5_000 });
    const picker = page.locator('[data-testid="gym-picker"]');
    await page.locator('[data-testid="gym-button"]').click();
    await picker.waitFor({ state: 'visible', timeout: 3_000 });
    await picker.locator('[data-testid^="gym-option-"]', { hasText: GD }).click();
    await picker.waitFor({ state: 'hidden', timeout: 3_000 });
    await page.locator('[data-testid="open-picker-sheet"]').click();
    await page.waitForTimeout(400);
    const sheet = page.locator('[data-testid="picker-sheet"]');
    await sheet.locator('input[type="text"]').fill('器械推肩');
    await sheet.locator('[data-testid="picker-sheet-exercise"]', { hasText: '器械推肩' }).first().click();
    await page.locator('[data-testid="picker-sheet-close"]').click();
    await page.waitForTimeout(400);
    const card = page.locator('[data-testid="exercise-card"], .ui-card', { has: page.locator('.masthead-rule', { hasText: '器械推肩' }) }).last();
    const pair = async () => [
      Number(await card.locator('.ledger-row [data-testid="ledger-field-weight"] input').first().inputValue()),
      Number(await card.locator('[data-testid="subset-field-weight"] input').first().inputValue()),
    ];
    const [m1, d1] = await pair();
    if (m1 !== 20 || d1 !== 10) throw new Error(`22 → 16.6 lb on a 10 lb stack should draft 20 → 10 (drop stays lighter), got ${m1} → ${d1}`);

    await card.screenshot({ path: path.join(OUT, 'stack-closed.png') });
    await card.locator('[data-testid="stack-chip"]').click();
    const menu = card.locator('[data-testid="stack-menu"]');
    await menu.waitFor({ state: 'visible', timeout: 3_000 });
    await card.screenshot({ path: path.join(OUT, 'stack-open.png') });
    await menu.locator('[data-testid="stack-start"]').fill('12.5');
    await menu.locator('[data-testid="stack-start"]').press('Enter');
    await page.waitForTimeout(300);
    // 全站数值都能横划（ScrubNumber，2026-10-21 用户定）：最轻一格往右划变重、往左划回来
    const swipe = async (testId, dx) => {
      const bx = await menu.locator(`[data-testid="${testId}-scrub"]`).boundingBox();
      await page.mouse.move(bx.x + bx.width / 2, bx.y + bx.height / 2);
      await page.mouse.down();
      for (let i = 1; i <= 8; i++) await page.mouse.move(bx.x + bx.width / 2 + (dx * i) / 8, bx.y + bx.height / 2, { steps: 2 });
      await page.mouse.up();
      await page.waitForTimeout(300);
      return Number(await menu.locator(`[data-testid="${testId}"]`).inputValue());
    };
    const up = await swipe('stack-start', 60);
    if (!(up > 12.5)) throw new Error(`swiping 最轻一格 right should raise it above 12.5, got ${up}`);
    const back = await swipe('stack-start', -60);
    if (!(back < up)) throw new Error(`swiping 最轻一格 left should lower it again (${up} → ${back})`);
    await menu.locator('[data-testid="stack-start"]').fill('12.5');
    await menu.locator('[data-testid="stack-start"]').press('Enter');
    await page.waitForTimeout(300);
    // 每格沿档位表走（10 → 5）：往左划一下
    const stepAfter = await swipe('stack-step', -20);
    if (!(stepAfter < 10 && [1, 2.5, 5].includes(stepAfter))) throw new Error(`swiping 每格 left should walk down the lb list (10 → 5 → 2.5…), got ${stepAfter}`);
    // 回到每格 5（后面按 12.5 + 5 的刻度断言）：真点一下再打字 —— 横划热区不能把「点一下进输入」吃掉
    await menu.locator('[data-testid="stack-step"]').click();
    await page.keyboard.press('Control+A');
    await page.keyboard.type('5');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    // 方案 A：设置面原地换掉大图；「完成」收回，图和标签回来
    if (await card.locator('[data-testid="load-hero"] .load-hero-drag').count()) throw new Error('the stack graphic should be replaced by the settings face while open');
    await menu.locator('[data-testid="stack-done"]').click();
    await menu.waitFor({ state: 'hidden', timeout: 2_000 });
    const chip = await card.locator('[data-testid="stack-chip"]').innerText();
    if (!chip.includes('12.5 起') || !chip.includes('每格 5')) throw new Error(`stack chip should read 12.5 起 · 每格 5: "${chip}"`);
    const ov = (await readLs('fitlog_app_prefs'))?.gymOverrides?.[`${GD}|press_machine_shoulder|`];
    if (JSON.stringify(ov) !== '{"v":5,"u":"lbs","s":12.5}') throw new Error(`stack override not stored: ${JSON.stringify(ov)}`);
    const [m2, d2] = await pair();
    if (m2 !== 22.5 || d2 !== 12.5) throw new Error(`on a 12.5 + 5k stack the sets should snap to 22.5 → 12.5, got ${m2} → ${d2}`);
    if (!(await card.locator('[data-testid="prefill-from"]').innerText()).startsWith('参考')) throw new Error('the eyebrow should read 参考 · …');
    // 拖大图往轻的方向拖一大段：不能轻过最轻一格（用户报：改了最轻一格还能拖到更轻）
    const drag = card.locator('[data-testid="load-hero"] .load-hero-drag');
    const box = await drag.boundingBox();
    const seen = [];
    for (const dy of [-1, 1]) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      for (let i = 1; i <= 30; i++) {
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + dy * i * 12, { steps: 2 });
        seen.push(Number(await card.locator('.ledger-row [data-testid="ledger-field-weight"] input').first().inputValue()));
      }
      await page.mouse.up();
      await page.waitForTimeout(400);
    }
    const low = Math.min(...seen);
    if (low < 12.5) throw new Error(`dragging the stack went below the lightest plate 12.5: reached ${low} (seen ${[...new Set(seen)].join(',')})`);
    // 最轻一格和每格对齐（每格 5、最轻 15）：照样是下限（之前当成「没起始」存 0，就能拖到 15 以下 —— 用户报的正是这个）
    if (!(await menu.isVisible())) await card.locator('[data-testid="stack-chip"]').click();
    await menu.waitFor({ state: 'visible', timeout: 3_000 });
    await menu.locator('[data-testid="stack-start"]').fill('15');
    await menu.locator('[data-testid="stack-start"]').press('Enter');
    await page.waitForTimeout(300);
    await menu.locator('[data-testid="stack-done"]').click();
    await menu.waitFor({ state: 'hidden', timeout: 2_000 });
    const ov15 = (await readLs('fitlog_app_prefs'))?.gymOverrides?.[`${GD}|press_machine_shoulder|`];
    if (ov15?.s !== 15) throw new Error(`an aligned lightest plate (15 on a 5 step) must still be stored: ${JSON.stringify(ov15)}`);
    const seen15 = [];
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    for (const dy of [-1, 1]) {
      for (let i = 1; i <= 30; i++) {
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + dy * i * 12, { steps: 2 });
        seen15.push(Number(await card.locator('.ledger-row [data-testid="ledger-field-weight"] input').first().inputValue()));
      }
    }
    await page.mouse.up();
    const low15 = Math.min(...seen15);
    if (low15 < 15) throw new Error(`with the lightest plate at 15 the stack must not drag below 15: reached ${low15}`);
    await backAndDiscard(page);
    return `22 → 16.6 lb drafts 20 → 10 · stack 12.5 + 5 → 22.5 → 12.5 · override ${JSON.stringify(ov)}`;
  });

  await context.close();
}

const T0 = Date.now();
const main = async () => {
  console.log(`\n== e2e smoke against ${BASE} ==\n`);
  describeSelection([MAIN_PLAN, SEEDED_PLAN, BACKUP_PLAN], ONLY);

  // E2E_CHROMIUM：本机装的 Playwright 浏览器版本和 node_modules 里的对不上时，指向已有的那份可执行文件
  const browser = await chromium.launch({ headless: true, executablePath: process.env.E2E_CHROMIUM || undefined });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 }, // iPhone-ish portrait
    deviceScaleFactor: 2,
    colorScheme: 'light',
    locale: 'zh-CN',
    ignoreHTTPSErrors: true, // 个人服务器走自签证书
  });

  const page = await context.newPage();

  // === Mock remote server for sync verification ===
  // Intercept all calls to the configured VITE_API_URL so the test can verify
  // the PUT payload includes our newly-created scheduledWorkout without
  // depending on the actual server being reachable.
  const remoteState = { snapshot: null, lastPutBody: null, getCount: 0, putCount: 0 };
  /** 逃逸到真实后端的请求（应当恒为空） */
  const escapedRemoteCalls = [];
  // 后端地址由 E2E_API_BASE / .env.local 的 VITE_API_URL 决定，默认同 DEFAULT_API_BASE_URL。
  // 这里只拦截请求，不真正连服务器，所以跑 e2e 不需要连 Tailscale。
  const apiHostPattern = new RegExp(`^${escapeRe(API_BASE)}(:\\d+)?/api/fitlog/state.*`);
  // 兜底：任何**没被下面显式 mock 掉**的、指向真实后端的请求一律 abort 并记为失败。
  // 少了这条，将来新增一个未 mock 的端点，e2e 就会安静地打到家里的 NAS 上。
  // ⚠️ Playwright 按注册顺序的**倒序**匹配路由，所以兜底必须最先注册。
  const escapedApiHost = new RegExp(`^${escapeRe(API_BASE)}(:\\d+)?/.*`);
  await context.route(escapedApiHost, async (route) => {
    const url = route.request().url();
    escapedRemoteCalls.push(`${route.request().method()} ${url}`);
    return route.abort();
  });

  await context.route(apiHostPattern, async (route) => {
    const req = route.request();
    if (req.method() === 'GET') {
      remoteState.getCount++;
      if (!remoteState.snapshot) {
        return route.fulfill({ status: 404, body: 'not found' });
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(remoteState.snapshot),
      });
    }
    if (req.method() === 'PUT') {
      remoteState.putCount++;
      const body = req.postData();
      try {
        const parsed = JSON.parse(body || '{}');
        remoteState.lastPutBody = parsed;
        remoteState.snapshot = parsed; // 后续 GET 可读到
      } catch {}
      return route.fulfill({ status: 200, body: 'ok' });
    }
    return route.continue();
  });

  const ignoredConsole = [
    'SW registration failed',
    'Failed to load resource', // typically the icons8 favicon
    'ERR_CONNECTION_TIMED_OUT',
    'ERR_NAME_NOT_RESOLVED',
  ];
  page.on('console', msg => {
    if (msg.type() === 'error') {
      const text = msg.text();
      if (ignoredConsole.some(s => text.includes(s))) return;
      report.consoleErrors.push(text);
      console.log(`    [console.error] ${text}`);
    }
  });
  page.on('pageerror', err => {
    report.pageErrors.push(String(err));
    console.log(`    [pageerror] ${err}`);
  });

  // Always start clean so we know which UI state we're testing.
  await page.addInitScript(() => {
    try {
      localStorage.clear();
      indexedDB.databases?.().then(dbs => dbs.forEach(d => d.name && indexedDB.deleteDatabase(d.name)));
    } catch {}

    /**
     * localStorage 现在按数据环境分区（services/appStorage.ts）。
     * 断言必须走同一套命名空间，否则 dev 环境下读到的永远是 null。
     */
    window.lsKey = (key) => {
      const env = window.__fitlog?.env?.().env;
      return env === 'dev' ? `dev:${key}` : key;
    };
  });

  await step(page, 'cold-load', async () => {
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('header', { timeout: 15_000 });
    // Wait for tab nav to be present — implies app finished mounting
    await page.waitForSelector('nav button', { timeout: 15_000 });
    const title = await page.title();
    return `title="${title}"`;
  });

  await step(page, 'no-blank-screen', async () => {
    // Heuristic: visible chars > 50 implies real UI rendered, not just header
    await page.waitForFunction(() => document.body.innerText.replace(/\s/g, '').length > 30);
    const bodyText = await page.evaluate(() => document.body.innerText.replace(/\s/g, '').length);
    if (bodyText < 30) throw new Error(`Body text suspiciously short (${bodyText} chars) — possible blank screen`);
    return `${bodyText} chars rendered`;
  });

  await step(page, 'bottom-nav-visible', async () => {
    const nav = await page.locator('nav').first();
    await nav.waitFor({ state: 'visible' });
    const box = await nav.boundingBox();
    if (!box || box.y < 600) throw new Error(`Nav not at bottom: y=${box?.y}`);
    return `nav at y=${Math.round(box.y)}`;
  });

  await step(page, 'theme-system-dark', async () => {
    await page.emulateMedia({ colorScheme: 'dark' });
    try {
      await page.waitForFunction(() => document.documentElement.classList.contains('dark'), null, { timeout: 3000 });
    } catch {
      const diag = await page.evaluate(() => ({
        mq: window.matchMedia('(prefers-color-scheme: dark)').matches,
        cls: document.documentElement.className,
        pref: localStorage.getItem(lsKey('theme-pref')),
      }));
      throw new Error(`.dark not added (diag=${JSON.stringify(diag)})`);
    }
    return 'system dark -> .dark applied';
  });

  await step(page, 'theme-system-light', async () => {
    await page.emulateMedia({ colorScheme: 'light' });
    try {
      await page.waitForFunction(() => !document.documentElement.classList.contains('dark'), null, { timeout: 3000 });
    } catch {
      const diag = await page.evaluate(() => ({
        mq: window.matchMedia('(prefers-color-scheme: dark)').matches,
        cls: document.documentElement.className,
        pref: localStorage.getItem(lsKey('theme-pref')),
      }));
      throw new Error(`.dark still present (diag=${JSON.stringify(diag)})`);
    }
    return 'system light -> .dark removed';
  });

  await step(page, 'goto-profile', async () => {
    await page.getByRole('button', { name: /我的|Profile/ }).click();
    // 外观等设置在首选项弹层里（2026-10-18）
    await page.locator('[data-testid="prefs-entry"]').click();
    await page.getByText(/外观|Appearance/).waitFor({ state: 'visible' });
    return '我的 tab open, prefs sheet open';
  });

  await step(page, 'theme-manual-dark', async () => {
    await page.getByRole('button', { name: /^深色$|^Dark$/ }).click();
    await settle(page); // 主题类名在 effect 里加
    const isDark = await page.evaluate(() => document.documentElement.classList.contains('dark'));
    if (!isDark) throw new Error('manual dark did not apply');
    return 'manual dark works';
  });

  await step(page, 'theme-manual-light', async () => {
    await page.getByRole('button', { name: /^浅色$|^Light$/ }).click();
    await settle(page);
    const isDark = await page.evaluate(() => document.documentElement.classList.contains('dark'));
    if (isDark) throw new Error('manual light did not apply');
    return 'manual light works';
  });

  await step(page, 'theme-back-to-auto', async () => {
    await page.getByRole('button', { name: /跟随系统|System/ }).click();
    await settle(page);
    const pref = await page.evaluate(() => localStorage.getItem(lsKey('theme-pref')));
    if (pref !== 'auto') throw new Error('theme-pref not persisted as auto');
    // 弹层退场时下一次点击会等遮罩让开（Playwright 的点击自己会等「能收到点击」）
    await page.locator('[data-testid="prefs-sheet-close"]').click();
    return 'auto persisted';
  });

  await step(page, 'goto-plan', async () => {
    await page.locator('nav button', { hasText: /训练计划|Plan/ }).click();
    // Default sub-view should be Schedule
    const scheduleTab = page.locator('[data-testid="plan-subview-schedule"]');
    await scheduleTab.waitFor({ state: 'visible' });
    const selected = await scheduleTab.getAttribute('aria-selected');
    if (selected !== 'true') throw new Error(`default sub-view not Schedule (aria-selected=${selected})`);
    return 'plan tab open, schedule active';
  });

  let createdScheduleId = null;
  /** plan-finish-from-schedule 落下的那场训练，后面时间线的用例都拿它当靶子 */
  let finishedWorkoutId = null;
  const scheduleTitleTag = 'E2E_PLAN_' + Date.now();
  const todayIso = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD

  await step(page, 'plan-open-editor', async () => {
    await page.locator('[data-testid="schedule-add-btn"]').click();
    await page.locator('[data-testid="schedule-editor"]').waitFor({ state: 'visible' });
    return 'editor open';
  });

  await step(page, 'plan-fill-editor', async () => {
    await page.locator('[data-testid="schedule-title-input"]').fill(scheduleTitleTag);
    // ensure today's date
    await page.locator('[data-testid="schedule-date-input"]').fill(todayIso);
    await page.locator('[data-testid="schedule-add-exercise"]').click();
    await page.locator('[data-testid="schedule-exercise-name"]').first().fill('E2E Bench Press');
    return `title=${scheduleTitleTag} date=${todayIso}`;
  });

  await step(page, 'plan-pick-from-library', async () => {
    // 计划编辑器选动作走训练页同一个弹层（plan-picker-legacy-library），弹层要压在编辑器上面
    await page.locator('[data-testid="schedule-pick-library"]').click();
    const sheet = page.locator('[data-testid="picker-sheet"]');
    const search = sheet.locator('input[type="text"]');
    await search.waitFor({ state: 'visible', timeout: 5_000 });
    const stacking = await page.evaluate(() => {
      const z = el => (el ? Number(getComputedStyle(el).zIndex) : NaN);
      const sheetRoot = document.querySelector('[data-testid="picker-sheet"]')?.closest('.fixed');
      const editorRoot = document.querySelector('[data-testid="schedule-editor"]')?.closest('[role="presentation"]');
      return {
        sheet: z(sheetRoot),
        editor: z(editorRoot),
        // 同一个父节点才使 z-index 的比较有意义（否则各自在局部层叠上下文里）
        sameParent: !!sheetRoot && !!editorRoot && sheetRoot.parentElement === editorRoot.parentElement,
      };
    });
    if (!(stacking.sheet > stacking.editor)) {
      throw new Error(`picker sheet z-index ${stacking.sheet} not above editor ${stacking.editor}`);
    }
    if (!stacking.sameParent) throw new Error('picker sheet and editor are not in the same stacking parent');

    const card = sheet.locator('[data-testid="picker-sheet-exercise"]').first();
    await card.waitFor({ state: 'visible', timeout: 5_000 });
    const rowsLoc = page.locator('[data-testid="schedule-exercise-row"]');
    const rows0 = await rowsLoc.count();
    await card.click();
    // 点一下加一行（「完成」不是同一张卡，不受 450ms 去重影响）：等行数变了再关
    await until(async () => (await rowsLoc.count()) > rows0, 'the picked exercise to join the plan editor').catch(() => {});
    await page.locator('[data-testid="picker-done"]').click();
    await settle(page);
    const rows = await rowsLoc.count();
    if (rows < 2) throw new Error(`expected >= 2 exercise rows after picking, got ${rows}`);
    // Inferred body parts chip area should now contain at least one entry
    const inferred = page.locator('[data-testid="schedule-inferred-bodyparts"]');
    const hasInferred = await inferred.isVisible().catch(() => false);
    if (!hasInferred) throw new Error('inferred body-parts chip area not visible after pick');
    return `z ${stacking.sheet}>${stacking.editor}; ${rows} rows; inferred chips ok`;
  });

  await step(page, 'plan-save-schedule', async () => {
    await page.locator('[data-testid="schedule-save-btn"]').click();
    await page.locator('[data-testid="schedule-editor"]').waitFor({ state: 'detached', timeout: 5_000 });
    // Item should now exist in day-detail panel
    const items = page.locator('[data-testid^="schedule-item-"]');
    await items.first().waitFor({ state: 'visible', timeout: 5_000 });
    const matched = page.locator('[data-testid^="schedule-item-"]', { hasText: scheduleTitleTag });
    await matched.first().waitFor({ state: 'visible' });
    const testId = await matched.first().getAttribute('data-testid');
    createdScheduleId = testId?.replace('schedule-item-', '') || null;
    if (!createdScheduleId) throw new Error('could not resolve scheduleId');
    return `id=${createdScheduleId}`;
  });

  await step(page, 'plan-remote-save', async () => {
    if (!createdScheduleId) throw new Error('no schedule id');
    // Force immediate push (bypass debounce). The mock route captures the PUT body.
    const flushed = await page.evaluate(async () => {
      const fl = window.__fitlog;
      if (!fl) return { ok: false, reason: '__fitlog not exposed' };
      try {
        await fl.flush();
        return { ok: true };
      } catch (e) {
        return { ok: false, reason: 'flush threw: ' + (e?.message || String(e)) };
      }
    });
    if (!flushed.ok) throw new Error(`PUT failed: ${flushed.reason}`);

    if (remoteState.putCount === 0) throw new Error('mock server received 0 PUT requests');
    const body = remoteState.lastPutBody;
    if (!body) throw new Error('mock server captured no body');
    const list = body.scheduledWorkouts || [];
    const found = list.find(s => s.id === createdScheduleId);
    if (!found) {
      throw new Error(
        `scheduledWorkout id=${createdScheduleId} not in PUT body (got ${list.length} items)`,
      );
    }
    if (found.exercises?.[0]?.name !== 'E2E Bench Press') {
      throw new Error(`exercise name lost in serialization: ${JSON.stringify(found.exercises)}`);
    }
    if (typeof body.schemaVersion !== 'number') {
      throw new Error('snapshot.schemaVersion missing');
    }

    // Round-trip: a subsequent GET (through the same mock) should now contain it
    const roundTrip = await page.evaluate(async (id) => {
      const snap = await window.__fitlog.fetchRemote();
      if (!snap) return { ok: false, reason: 'GET returned null' };
      const list = snap.scheduledWorkouts || [];
      return { ok: list.some(s => s.id === id), total: list.length };
    }, createdScheduleId);
    if (!roundTrip.ok) throw new Error(`round-trip GET missing id (total=${roundTrip.total})`);

    return `PUT#${remoteState.putCount} captured, GET round-trip ok (total=${roundTrip.total})`;
  });

  await step(page, 'plan-start-from-schedule', async () => {
    const startBtn = page.locator(`[data-testid="schedule-start-${createdScheduleId}"]`);
    await startBtn.click();
    await pickStartGym(page);
    await page.waitForSelector('text=/新建训练|New Workout/', { timeout: 5_000 });
    // The prefilled exercise name should be visible somewhere in the workout view
    const has = await page.locator('text=E2E Bench Press').first().isVisible().catch(() => false);
    if (!has) throw new Error('prefilled exercise not visible in new-workout view');
    // 按返回只离开页面（不再确认），首页「进行中 → 结束」：一组没做 → 放弃
    await backAndDiscard(page);
    await page.locator('[data-testid="tab-plan"]').waitFor({ state: 'visible', timeout: 5_000 });
    return 'prefill + back (kept as in-progress) + discard ok';
  });

  // 从计划开始训练 → 结束 → 训练记录带上 fromSchedule.scheduleId 并推到远端。
  // 「按计划 / 有调整」确认弹窗已随 6c612c4 移除，这里只校验计划与训练的关联。
  await step(page, 'plan-finish-from-schedule', async () => {
    // Re-enter Plan tab and start the session again
    await page.locator('[data-testid="tab-plan"]').click();
    await page.locator('[data-testid="plan-subview-schedule"]').click();
    const startBtn = page.locator(`[data-testid="schedule-start-${createdScheduleId}"]`);
    await startBtn.click();
    await pickStartGym(page);
    await page.waitForSelector('text=/新建训练|New Workout/', { timeout: 5_000 });
    // 计划里的组是待做（第 4 条）：填个次数、点组号才算做完，否则「底稿不入册」结束不了
    const firstRow = page.locator('.ledger-row').first();
    await firstRow.locator('[data-testid="ledger-field-reps"] input').fill('5');
    await firstRow.locator('.set-num').click();
    await firstRow.and(page.locator('.is-inked')).waitFor({ timeout: 3_000 });
    // 按钮文案是动态的（结束训练/结束中/已结束/失败），所以不能用 ^...$ 精确匹配。
    await page.getByRole('button', { name: /结束训练|End Workout/ }).first().click();
    await acceptAppConfirm(page);
    // 结束 → 落库 → 刊末页（约 1.9 s 后自己收）：等它出来、点掉（原来死等 2.5 s 让它自己收）
    await dismissColophon(page);

    // Force a remote push then GET, verify the schedule linkage survived the round-trip
    const verify = await page.evaluate(async (id) => {
      await window.__fitlog.flush();
      const snap = await window.__fitlog.fetchRemote();
      if (!snap) return { ok: false, reason: 'snap null' };
      const w = (snap.workouts || []).find(w => w.fromSchedule?.scheduleId === id);
      if (!w) return { ok: false, reason: 'no workout linked to schedule' };
      return { ok: true, workoutId: w.id };
    }, createdScheduleId);
    if (!verify.ok) throw new Error(`fromSchedule check failed: ${JSON.stringify(verify)}`);
    finishedWorkoutId = verify.workoutId;
    // plan-session-leaks-schedule-id：计划标完成、关联到刚结束的这一场（原来拿 workouts[0]）
    const sched = await page.evaluate(async id => {
      await window.__fitlog.flush();
      const snap = await window.__fitlog.fetchRemote();
      return (snap?.scheduledWorkouts || []).find(s => s.id === id) ?? null;
    }, createdScheduleId);
    if (sched?.status !== 'completed' || sched?.linkedWorkoutId !== verify.workoutId) {
      throw new Error(`schedule should be completed & linked to ${verify.workoutId}, got ${JSON.stringify({ status: sched?.status, linked: sched?.linkedWorkoutId })}`);
    }
    return `workout ${verify.workoutId} linked to schedule, persisted to remote`;
  });

  await step(page, 'plan-switch-to-goals', async () => {
    // After plan-finish-from-schedule we landed back on dashboard — return to Plan first
    await page.locator('[data-testid="tab-plan"]').click();
    await page.locator('[data-testid="plan-subview-goals"]').click();
    await settle(page);
    const selected = await page.locator('[data-testid="plan-subview-goals"]').getAttribute('aria-selected');
    if (selected !== 'true') throw new Error('goals sub-view not active');
    return 'goals sub-view active';
  });

  // ── 时间线操作层（§12.8）──────────────────────────────────────
  // 行内「编辑·补加·删除」三个常驻按钮已被长按菜单取代，删除也从确认弹窗
  // 改成了「先执行 + 撤销条」。这两件事此前一个用例都没覆盖到 ——
  // 按钮被删掉时 e2e 依然全绿，正说明这块是盲区。
  await step(page, 'timeline-no-inline-buttons', async () => {
    if (!finishedWorkoutId) throw new Error('no finished workout to inspect');
    // 原 goto-dashboard（只导航、没有断言）并进这里
    await page.locator('nav button', { hasText: /个人记录|PR Hub|Dashboard/ }).click();
    const card = page.locator(`[data-testid="timeline-session-${finishedWorkoutId}"]`);
    await card.waitFor({ state: 'visible', timeout: 5_000 });
    // 卡面上不该再有任何按钮：低频操作全部收进长按菜单
    const buttons = await card.locator('button').count();
    if (buttons !== 0) {
      throw new Error(`session card still renders ${buttons} inline button(s) — §12.8 要求卡面只剩内容`);
    }
    return 'card is content-only';
  });

  await step(page, 'timeline-longpress-menu', async () => {
    const card = page.locator(`[data-testid="timeline-session-${finishedWorkoutId}"]`);
    const box = await card.boundingBox();
    if (!box) throw new Error('session card has no box');
    // 刻意按在【菜单将要出现的那一片】（右上角）——菜单是在手指底下长出来的，
    // 松手那一下的 click 正好落在第一个菜单项上。真机上就是这样一松手
    // 直接进了「编辑这次训练」。按卡片正中间是测不出这个的。
    // 长按 500ms 达成（120ms 静默 + 380ms 进度线），按 HOLD_MS（550）留余量。
    // 松手离达成只有 50ms，比原来按 750 时更贴近「一达成就松手」，菜单项的静默期更要挡得住。
    await page.mouse.move(box.x + box.width - 60, box.y + 32);
    await page.mouse.down();
    await page.waitForTimeout(HOLD_MS);
    await page.mouse.up();

    const menu = page.locator('[data-testid="timeline-session-menu"]');
    await menu.waitFor({ state: 'visible', timeout: 3_000 });
    const items = await menu.getByRole('menuitem').count();
    if (items < 3) throw new Error(`menu has only ${items} items, expected >= 3`);

    // §12.8：长按松手带出的那次 click 必须被吞掉，不能顺手把卡片展开
    const expanded = await card.evaluate(el => el.className.includes('ring-accent'));
    if (expanded) throw new Error('long-press release leaked a click and expanded the card');

    // 松手带出的那次 click 已经落在菜单上了（就在上面那一下松手里）。
    // 它必须被静默期挡掉：没进编辑页、菜单还开着。
    const leaked = await page
      .locator('text=/新建训练|New Workout/')
      .first()
      .isVisible()
      .catch(() => false);
    if (leaked) throw new Error('长按松手误触了菜单第一项 —— 直接进了编辑页');
    if (!(await menu.isVisible())) throw new Error('menu closed on the release click');
    return `${items} menu items, release click swallowed at both levels`;
  });

  await step(page, 'timeline-delete-is-undoable', async () => {
    const menu = page.locator('[data-testid="timeline-session-menu"]');
    await page.waitForTimeout(400); // 过菜单项的 350ms 静默期（防长按松手误触）
    // 回归守卫：菜单最下面那项必须真的可点 —— 它会探出矮卡片的下缘，
    // 卡片不抬 z 的话会被下一张卡盖住（曾经就是这样，且肉眼完全看不出来）。
    const deleteItem = menu.getByRole('menuitem').filter({ hasText: /删除|Delete/ });
    const covered = await deleteItem.evaluate(el => {
      const r = el.getBoundingClientRect();
      const top = document.elementsFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return !el.contains(top[0]) && top[0] !== el;
    });
    if (covered) throw new Error('menu delete item is covered by a sibling card — 菜单被盖住了，点不到');
    await deleteItem.click();

    // 通则 3：破坏性操作用「先执行 + 撤销」，不再弹确认框。卡片消失或弹出确认框，哪个先来等哪个
    const cardLoc = page.locator(`[data-testid="timeline-session-${finishedWorkoutId}"]`);
    await until(
      async () => (await page.locator('[role="dialog"]').count()) > 0 || (await cardLoc.count()) === 0,
      'the delete to either remove the card or ask',
    ).catch(() => {});
    const dialogs = await page.locator('[role="dialog"]').count();
    if (dialogs !== 0) throw new Error('delete still opens a confirm dialog — §12.5 通则 3 要求先执行 + 撤销');

    // 卡片当场消失
    await page
      .locator(`[data-testid="timeline-session-${finishedWorkoutId}"]`)
      .waitFor({ state: 'detached', timeout: 3_000 });

    // 撤销条把它拿回来
    const undo = page.locator('[data-testid="toast-undo"]').first();
    await undo.waitFor({ state: 'visible', timeout: 3_000 });

    // §5.3：底边剩余时间线必须真的在走 —— 光有元素不算，
    // 要么动画没被浏览器接受，要么 duration 没接上，都会静默变成一条不动的线。
    const line = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="toast-countdown"]');
      if (!el) return { ok: false, reason: 'no countdown element' };
      const anims = el.getAnimations();
      if (!anims.length) return { ok: false, reason: 'element has no running animation' };
      const t = anims[0].effect.getTiming();
      return { ok: true, duration: t.duration, easing: getComputedStyle(el).animationTimingFunction };
    });
    if (!line.ok) throw new Error(`toast countdown line: ${line.reason}`);
    if (line.duration !== 5000) throw new Error(`countdown duration ${line.duration}ms != toast 停留时长 5000ms`);
    if (line.easing !== 'linear') throw new Error(`countdown easing is ${line.easing}, must be linear`);
    // 线性 5 s：过 250ms 就该缩到 0.95 左右，看得出在走（原来等 700ms）
    await page.waitForTimeout(250);
    const shrunk = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="toast-countdown"]');
      const m = new DOMMatrixReadOnly(getComputedStyle(el).transform);
      return m.a; // scaleX
    });
    if (!(shrunk < 1)) throw new Error(`countdown line is not shrinking (scaleX=${shrunk})`);

    await undo.click();
    await page
      .locator(`[data-testid="timeline-session-${finishedWorkoutId}"]`)
      .waitFor({ state: 'visible', timeout: 5_000 });
    return 'deleted without confirm, restored by undo';
  });

  // 并入上一场：误结束拆场的事后补救。同样是「先执行 + 撤销」。
  await step(page, 'timeline-merge-into-previous', async () => {
    const cards = page.locator('[data-testid^="timeline-session-"]');
    let before = await cards.count();
    if (before < 2) {
      // 原先计划页「开练又返回」会留下一场 0 组的空场，正好凑够两张卡；空场现在不进时间线了，
      // 这里把现有那场复制成今天的、做一组再结束，造出真正的第二场
      const b0 = await cards.first().boundingBox();
      await page.mouse.move(b0.x + b0.width / 2, b0.y + b0.height / 2);
      await page.mouse.down();
      await page.waitForTimeout(HOLD_MS);
      await page.mouse.up();
      const m0 = page.locator('[data-testid="timeline-session-menu"]');
      await m0.waitFor({ state: 'visible', timeout: 3_000 });
      await page.waitForTimeout(400);
      await m0.getByRole('menuitem').filter({ hasText: /复制为今天的训练|Copy to today/ }).click();
      await pickStartGym(page);
      await page.waitForSelector('text=/新建训练|New Workout/', { timeout: 5_000 });
      await page.locator('.ledger-row .set-num').first().click(); // 默认选中指针下那组：一下就做完
      await page.getByRole('button', { name: /结束训练|End Workout/ }).first().click();
      await acceptAppConfirm(page);
      // 做完一组再结束 → 刊末页：等它出来、点掉（原来死等 2.5 s + 0.5 s）
      await dismissColophon(page);
      await until(async () => (await cards.count()) >= 2, 'the copied session to show on the timeline').catch(() => {});
      before = await cards.count();
    }
    if (before < 2) throw new Error(`need >= 2 sessions to test merge, got ${before}`);
    const first = cards.first();
    const mergedId = await first.getAttribute('data-testid');
    const box = await first.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(HOLD_MS);
    await page.mouse.up();

    const menu = page.locator('[data-testid="timeline-session-menu"]');
    await menu.waitFor({ state: 'visible', timeout: 3_000 });
    await page.waitForTimeout(400); // 过菜单项的 350ms 静默期（防长按松手误触）
    await menu.getByRole('menuitem').filter({ hasText: /并入上一场|Merge into previous/ }).click();

    await page.locator(`[data-testid="${mergedId}"]`).waitFor({ state: 'detached', timeout: 3_000 });
    const after = await cards.count();
    if (after !== before - 1) throw new Error(`expected ${before - 1} cards after merge, got ${after}`);

    // 撤销把拆开的两场原样放回去
    const undo = page.locator('[data-testid="toast-undo"]').first();
    await undo.waitFor({ state: 'visible', timeout: 3_000 });
    await undo.click();
    await page.locator(`[data-testid="${mergedId}"]`).waitFor({ state: 'visible', timeout: 5_000 });
    const restored = await cards.count();
    if (restored !== before) throw new Error(`undo did not restore card count (${restored} vs ${before})`);
    return `${before} → ${after} → ${restored}`;
  });

  // 复制为今天的训练：结构照抄，但每一组都是底稿（§12.6），出处指向来源那一场。
  await step(page, 'timeline-copy-to-today', async () => {
    const card = page.locator(`[data-testid="timeline-session-${finishedWorkoutId}"]`);
    const box = await card.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(HOLD_MS);
    await page.mouse.up();

    const menu = page.locator('[data-testid="timeline-session-menu"]');
    await menu.waitFor({ state: 'visible', timeout: 3_000 });
    await page.waitForTimeout(400); // 同上：静默期
    await menu.getByRole('menuitem').filter({ hasText: /复制为今天的训练|Copy to today/ }).click();
    await pickStartGym(page);

    await page.waitForSelector('text=/新建训练|New Workout/', { timeout: 5_000 });
    const hasExercise = await page.locator('text=E2E Bench Press').first().isVisible().catch(() => false);
    if (!hasExercise) throw new Error('copied workout has no exercises');
    // 红线（§12.6）：复制来的组必须是底稿，不能静默变成数据。
    // 眉批（「底稿 · 上次 X月X日」）已删，改盯行本身的 is-ghost —— 它才是状态，
    // 眉批只是它的说明文字。刊头的 0/N 分母同源，一并核一眼。
    const ghostRows = page.locator('.ledger-row.is-ghost');
    await ghostRows.first().waitFor({ state: 'visible', timeout: 3_000 });
    const ghostCount = await ghostRows.count();
    const inkedRows = await page.locator('.ledger-row.is-inked').count();
    if (inkedRows > 0) throw new Error(`copied sets must all be drafts, found ${inkedRows} inked`);
    const denom = page.locator('text=/0\\/\\d+组|0\\/\\d+ sets?/').first();
    if (!(await denom.isVisible().catch(() => false)))
      throw new Error('header progress denominator missing on copied workout');

    // 别给后续用例留状态：一组没做，返回后从「进行中」放弃
    await backAndDiscard(page);
    return `copied as ${ghostCount} draft rows`;
  });

  await step(page, 'open-workout-via-fab', async () => {
    await page.getByRole('button', { name: /开始训练|Start Workout/ }).click();
    await pickStartGym(page);
    // 2026-10-11：刚结束过一场也不再问「继续刚才那场？」，直接进新建页（接回走时间线长按菜单）
    // 问了还是进了，哪个先出来等哪个（原来固定等 400ms）
    await page.locator('[role="dialog"]').or(page.locator('text=/新建训练|New Workout/')).first().waitFor({ timeout: 5_000 });
    if (await page.locator('[role="dialog"]').isVisible().catch(() => false)) throw new Error('FAB must not ask about the just-finished workout any more');
    await page.waitForSelector('text=/新建训练|New Workout/', { timeout: 5_000 });
    return 'no resume prompt, new-workout view shown';
  });

  await step(page, 'rest-timer-hidden-on-empty', async () => {
    // Timer should NOT appear when no exercise is added yet.
    const minimizedTimer = page.locator('text=/^\\d+:\\d{2}$/').first();
    const visible = await minimizedTimer.isVisible().catch(() => false);
    if (visible) {
      const t = await minimizedTimer.textContent();
      throw new Error(`Rest timer leaked into empty workout: ${t}`);
    }
    return 'timer correctly hidden';
  });

  await step(page, 'browse-library', async () => {
    // 进训练页不再自动弹层（空白页先问「今天练哪里」），一律点「添加动作」。
    // alreadyOpen 分支保留：其他入口（如从计划开始）未来若恢复自动打开，这里不用再改。
    const sheet = page.locator('[data-testid="picker-sheet"]');
    const alreadyOpen = await sheet
      .evaluate(el => el.className.includes('translate-y-0'))
      .catch(() => false);
    if (!alreadyOpen) await page.locator('[data-testid="open-picker-sheet"]').click();
    // 弹层滑入动画不用等：点击自己会等按钮位置稳定、能收到点击
    await sheet.getByRole('button', { name: /^(胸部|Chest)$/ }).first().click();
    // 第 3 条：选了有细分的部位 → 细分格（表头一排 + 每列小卡），不再是一长串动作行
    const cards = page.locator('[data-testid="picker-region-card"]');
    await cards.first().waitFor({ state: 'visible', timeout: 5_000 });
    const heads = await page.locator('[data-testid="picker-region-board"] .region-head').allInnerTexts();
    if (heads.length !== 6 || heads[0].trim() !== '热身') throw new Error(`chest should have 6 regions (热身 first), got ${heads.length}: ${heads.join('|')}`);
    const count = await cards.count();
    // 搜索不被部位锁死：胸部下搜「三头」要落到「其他部位」，不能说「没有」
    const search = sheet.locator('input[type="text"]');
    await search.fill('三头');
    await sheet.getByText(/^其他部位$/).waitFor({ state: 'visible', timeout: 3_000 });
    await search.fill('');
    return `chest board: ${heads.map(h => h.replace(/\s+/g, '')).join(' ')} · ${count} cards; cross-part search ok`;
  });

  // 细分格第三版（2026-10，docs/demos/region-board-v3.html）：格子是一张行对齐的 grid，没有按列包的容器 ——
  // 某一列的卡＝`.region-grid [data-region-col="<细分 id>"]`，按 data-r（显式行号）排序。
  const regionHelpers = sheet => {
    const colId = async name =>
      sheet.locator('[data-region-head]').filter({ has: page.locator('b', { hasText: new RegExp(`^${name}$`) }) }).first().getAttribute('data-region-head');
    const col = async name => sheet.locator(`.region-grid [data-region-col="${await colId(name)}"]`);
    const names = async name =>
      (await (await col(name)).evaluateAll(els =>
        els.sort((a, b) => Number(a.dataset.r) - Number(b.dataset.r)).map(e => e.innerText.replace(/\s+/g, '')),
      ));
    const cardIn = async (name, ex) => (await col(name)).filter({ hasText: ex });
    const hold = async (loc, ms = HOLD_MS) => {
      const b = await loc.boundingBox();
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
      await page.mouse.down();
      await page.waitForTimeout(ms);
    };
    return { colId, col, names, cardIn, hold };
  };
  const clearToasts = async () => {
    const dismiss = page.locator('[data-testid="toast"] [aria-label="dismiss"]');
    while (await dismiss.count()) await dismiss.first().click({ timeout: 1_000 }).catch(() => {});
  };

  // 普通态长按小卡 → 动作面板（不能拖），第一行「归到细分」→ 卡片换列；长按不算「添加」
  await step(page, 'region-assign-via-panel', async () => {
    const sheet = page.locator('[data-testid="picker-sheet"]');
    const { names, cardIn, hold } = regionHelpers(sheet);
    const menu = page.locator('[data-testid="row-action-menu"]');
    const addedBefore = await sheet.locator('.region-card.is-added').count();
    await hold(await cardIn('中胸', '杠铃平板卧推'));
    // 长按满 500ms 时面板已经弹出（手指还按着）
    await menu.waitFor({ state: 'visible', timeout: 3_000 });
    await page.mouse.up();
    // 松手补发的 click 在 up 里同步派发：要是被算成「添加」，过三帧也画出来了
    await settle(page);
    if ((await sheet.locator('.region-card.is-added').count()) !== addedBefore) throw new Error('long-press added the exercise');
    await menu.locator('[data-testid="menu-region-chips"]').getByRole('button', { name: '上胸' }).click();
    await settle(page);
    if (!(await names('上胸')).includes('杠铃平板卧推')) throw new Error(`assign via panel failed: 上胸 = ${(await names('上胸')).join('|')}`);
    // 放回中胸，别给后面的用例留状态
    await hold(await cardIn('上胸', '杠铃平板卧推'));
    await page.mouse.up();
    await menu.locator('[data-testid="menu-region-chips"]').getByRole('button', { name: '中胸' }).click();
    await settle(page);
    if (!(await names('中胸')).includes('杠铃平板卧推')) throw new Error('could not move it back to 中胸');
    await clearToasts();
    return 'long-press → panel (no add), region chip moves the card and back';
  });

  // longpress-ghost-click：面板在手指还按着时弹出，松手补发的那次 click（不带新的 pointerdown）
  // 会落在指下的面板按钮上。这里把这次 click 直接打在「从动作库删除」上 —— 必须被吞掉。
  await step(page, 'region-longpress-ghost-click', async () => {
    const sheet = page.locator('[data-testid="picker-sheet"]');
    const { cardIn, hold } = regionHelpers(sheet);
    const menu = page.locator('[data-testid="row-action-menu"]');
    await hold(await cardIn('下胸', '高位绳索夹胸'));
    await menu.waitFor({ state: 'visible', timeout: 3_000 });
    const del = menu.getByRole('button', { name: /从动作库删除/ });
    await del.evaluate(el => el.click()); // 合成 click，没有 pointerdown＝松手补发的那一下
    await page.mouse.up();
    await settle(page); // 被当成真点击的话，删除和提示条在这三帧里就画出来了
    const toasts = await page.locator('[data-testid="toast"]').allInnerTexts();
    if (toasts.some(t => /已从动作库删除/.test(t))) throw new Error('ghost click after long-press deleted the exercise');
    if (!(await menu.isVisible())) throw new Error('ghost click closed the panel');
    // 之后的正常点击（有 pointerdown）照常生效
    await menu.getByRole('button', { name: /^取消$/ }).click();
    await menu.waitFor({ state: 'detached', timeout: 3_000 });
    return 'release click swallowed once; next real tap works';
  });

  // 普通态长按后拖：不再拖到细分（2026-10-06 用户定，拖动只在整理里）；整理：按住即拖，同列调顺序；
  // 整理态点卡＝动作面板，不添加
  await step(page, 'region-drag', async () => {
    const sheet = page.locator('[data-testid="picker-sheet"]');
    const { col, names, cardIn } = regionHelpers(sheet);
    const menu = page.locator('[data-testid="row-action-menu"]');
    const drag = async (from, toX, toY, holdMs) => {
      const b = await from.boundingBox();
      const sx = b.x + b.width / 2, sy = b.y + b.height / 2;
      await page.mouse.move(sx, sy);
      await page.mouse.down();
      await page.waitForTimeout(holdMs);
      for (let i = 1; i <= 14; i++) {
        await page.mouse.move(sx + (toX - sx) * i / 14, sy + (toY - sy) * i / 14);
        await page.waitForTimeout(25);
      }
      await page.waitForTimeout(80);
      await page.mouse.up();
      await page.waitForTimeout(500); // 浮卡落定（220ms）+ 重渲染
    };

    // 1) 普通态：长按满后拖向上胸 —— 卡片不动，弹出的是动作面板
    const top = await (await col('上胸')).first().boundingBox();
    await drag(await cardIn('中胸', '杠铃平板卧推'), top.x + top.width / 2, top.y + 4, HOLD_MS);
    if ((await names('上胸')).includes('杠铃平板卧推')) throw new Error('long-press drag still moves cards in normal mode');
    if (!(await names('中胸')).includes('杠铃平板卧推')) throw new Error('card left 中胸');
    await menu.waitFor({ state: 'visible', timeout: 3_000 });
    await menu.getByRole('button', { name: /^取消$/ }).click();
    await menu.waitFor({ state: 'detached', timeout: 3_000 });

    // 2) 整理：按住一下（≥ 150ms，审查 B6）再拖，同列把最后一张拖到最上面；撤销条撤回。
    //    没按够就动＝在滑列表，卡片不动（原来按下即拖，格子里划不动）
    await sheet.locator('[data-testid="region-arrange"]').click();
    const mid = await names('中胸');
    const first = await (await col('中胸')).first().boundingBox();
    const midCol = await col('中胸');
    const last = midCol.filter({ hasText: mid[mid.length - 1] });
    await drag(last, first.x + first.width / 2, first.y + 4, 30);
    if ((await names('中胸'))[0] === mid[mid.length - 1]) throw new Error('a quick swipe in arrange mode should not pick the card up');
    await drag(last, first.x + first.width / 2, first.y + 4, 220);
    const midAfter = await names('中胸');
    if (midAfter[0] !== mid[mid.length - 1]) throw new Error(`arrange reorder failed: ${mid.join('|')} → ${midAfter.join('|')}`);
    const t = await page.locator('[data-testid="toast"]').last().innerText();
    if (!/已调整顺序/.test(t)) throw new Error(`no undo toast after reorder: ${t}`);
    await page.locator('[data-testid="toast-undo"]').last().click();
    await settle(page);
    if ((await names('中胸')).join('|') !== mid.join('|')) throw new Error('undo did not restore the order');
    await clearToasts();

    // 3) 整理态点卡＝动作面板，不添加
    const addedBefore = await sheet.locator('.region-card.is-added').count();
    await (await col('上胸')).first().click();
    await menu.waitFor({ state: 'visible', timeout: 3_000 });
    if ((await sheet.locator('.region-card.is-added').count()) !== addedBefore) throw new Error('tapping a card in arrange mode added it');
    await menu.getByRole('button', { name: /^取消$/ }).click();
    await menu.waitFor({ state: 'detached', timeout: 3_000 });
    await sheet.locator('[data-testid="region-arrange"]').click();
    return `normal long-press does not drag; arrange reorder ${mid.at(-1)} → top + undo; tap in arrange opens the panel`;
  });

  // 整理里的细分：表头末尾「＋」新建；点表头改名 / 右移 / 删除（系统细分＝隐藏，撤销条，动作回未细分）；
  // 输完名字直接点「完成」也要存；新建时撞上删掉的系统细分＝恢复它（不建第二个同名的）
  await step(page, 'region-layout-edit', async () => {
    const sheet = page.locator('[data-testid="picker-sheet"]');
    const heads = async () => (await sheet.locator('.region-head b').allInnerTexts()).map(t => t.trim());
    const menu = page.locator('[data-testid="region-menu"]');
    const head = name => sheet.locator('[data-testid="region-head-edit"]', { has: page.locator('b', { hasText: new RegExp(`^${name}$`) }) });
    await sheet.locator('[data-testid="region-arrange"]').click();

    // 改名（不点「改名」，直接点「完成」）+ 右移
    await head('中缝').click();
    await menu.locator('input').fill('内侧');
    await menu.getByRole('button', { name: /^完成$/ }).click();
    await menu.waitFor({ state: 'detached', timeout: 3_000 });
    if (!(await heads()).includes('内侧')) throw new Error(`「完成」dropped the typed rename: ${(await heads()).join('|')}`);
    await head('内侧').click();
    await menu.getByRole('button', { name: /右移/ }).click();
    await menu.getByRole('button', { name: /^完成$/ }).click();
    const h1 = await heads();
    if (h1.join('|') !== '热身|上胸|中胸|下胸|外轮廓|内侧') throw new Error(`rename/move failed: ${h1.join('|')}`);

    // 删除系统细分：不弹确认、撤销条 + 它的动作回到未细分（未细分是小卡托盘）
    await head('内侧').click();
    await menu.getByRole('button', { name: /删除这个细分/ }).click();
    if (await page.locator('[role="dialog"]').filter({ hasText: /确定/ }).count()) throw new Error('removing a region asks for confirmation');
    const t = await page.locator('[data-testid="toast"]').last().innerText();
    if (!/已删除细分「内侧」，2 个动作回到未细分/.test(t)) throw new Error(`remove toast: ${t}`);
    const un = await sheet.locator('.region-unzone [data-testid="picker-region-card"]').allInnerTexts();
    if (!un.some(x => x.replace(/\s+/g, '').includes('绳索夹胸'))) throw new Error('exercises of the removed region did not go back to unassigned');
    await clearToasts();

    // 「＋」新建「内侧」＝恢复那个系统细分（名字与位置都还在），不是再建一个
    await sheet.locator('[data-testid="region-new"]').click();
    await menu.locator('input').fill('内侧');
    await menu.getByRole('button', { name: /^添加$/ }).click();
    const h2 = await heads();
    if (h2.join('|') !== '热身|上胸|中胸|下胸|外轮廓|内侧') throw new Error(`typing a hidden system region's name did not restore it: ${h2.join('|')}`);
    // 表头字符串一样不算数：自建一个同名列也会排在最后。恢复回来的必须是那个系统细分本身
    const innerId = await head('内侧').getAttribute('data-region-head');
    if (innerId !== 'chestInner') throw new Error(`「内侧」is a new custom region (${innerId}), not the restored system one`);
    // 新建一个真的新列
    await sheet.locator('[data-testid="region-new"]').click();
    await menu.locator('input').fill('E2E新列');
    await menu.getByRole('button', { name: /^添加$/ }).click();
    if (!(await heads()).includes('E2E新列')) throw new Error('new region did not appear');
    if ((await heads()).length !== 7) throw new Error(`expected 7 columns, got ${(await heads()).join('|')}`);
    await clearToasts();

    // 收尾：删掉新列、名字改回去、挪回去、退出整理
    await head('E2E新列').click();
    await menu.getByRole('button', { name: /删除这个细分/ }).click();
    await head('内侧').click();
    await menu.locator('input').fill('中缝');
    await menu.getByRole('button', { name: /^改名$/ }).click();
    await head('中缝').click();
    await menu.getByRole('button', { name: /左移/ }).click();
    await menu.getByRole('button', { name: /^完成$/ }).click();
    await sheet.locator('[data-testid="region-arrange"]').click();
    await clearToasts();
    const h3 = await heads();
    if (h3.join('|') !== '热身|上胸|中胸|下胸|中缝|外轮廓') throw new Error(`cleanup left ${h3.join('|')}`);
    return 'rename via 完成 + move + remove(undo toast, back to unassigned) + restore-by-name + new region';
  });

  // 整理＝动作库唯一的编辑入口：删除＝隐藏（不弹确认），「已删除」里点一下恢复；
  // 自建部位：新建、把动作挪进去（部位与器材）、删掉后动作落到「未分部位」、撤销
  await step(page, 'region-arrange-library', async () => {
    const sheet = page.locator('[data-testid="picker-sheet"]');
    const { names, cardIn } = regionHelpers(sheet);
    const menu = page.locator('[data-testid="row-action-menu"]');
    const parts = sheet.locator('[data-testid="arrange-parts"]');
    // 切部位：已经选中时再点会打开部位面板，所以只在没选中时点
    const goPart = async name => {
      const chip = parts.getByRole('button', { name: new RegExp(`^${name}$`) });
      if ((await chip.getAttribute('data-on')) !== '1') await chip.click();
    };
    await sheet.locator('[data-testid="region-arrange"]').click();

    // 删除 → 已删除 → 恢复
    await (await cardIn('外轮廓', '宽距杠铃卧推')).click();
    await menu.getByRole('button', { name: /从动作库删除/ }).click();
    await settle(page);
    if (await page.locator('[role="dialog"]').filter({ hasText: /确定/ }).count()) throw new Error('library delete still asks for confirmation');
    const t = await page.locator('[data-testid="toast"]').last().innerText();
    if (!/已从动作库删除「宽距杠铃卧推」/.test(t)) throw new Error(`delete toast: ${t}`);
    if ((await names('外轮廓')).includes('宽距杠铃卧推')) throw new Error('deleted exercise still in its column');
    await clearToasts();
    await parts.locator('[data-testid="arrange-deleted"]').click();
    const del = sheet.locator('.region-card.is-deleted', { hasText: '宽距杠铃卧推' });
    await del.waitFor({ state: 'visible', timeout: 3_000 });
    await del.click();
    await settle(page);
    await goPart('胸部');
    if (!(await names('外轮廓')).includes('宽距杠铃卧推')) throw new Error('restore from 已删除 did not bring it back');
    await clearToasts();

    // 自建部位：「＋」新建 → 自动切过去
    await parts.locator('[data-testid="arrange-new-part"]').click();
    const pm = page.locator('[data-testid="part-menu"]');
    await pm.locator('input').fill('E2E部位');
    await pm.getByRole('button', { name: /^添加$/ }).click();
    await pm.waitFor({ state: 'detached', timeout: 3_000 });
    if (!/E2E部位/.test(await sheet.locator('h2').innerText())) throw new Error('new part not selected');
    // 部位与器材：把「宽距俯卧撑」挪进 E2E部位（训练类型那一行也在）
    await goPart('胸部');
    await (await cardIn('外轮廓', '宽距俯卧撑')).click();
    await menu.getByRole('button', { name: /部位与器材/ }).click();
    const dlg = page.locator('[role="dialog"]').filter({ hasText: /部位与器材/ });
    await dlg.waitFor({ state: 'visible', timeout: 3_000 });
    if ((await dlg.getByRole('button', { name: /力量训练/ }).getAttribute('aria-pressed')) !== 'true') throw new Error('category row missing in 部位与器材');
    // 属性表：点开「部位」那一行才出选项（2026-10-20）
    await dlg.locator('[data-attr="part"] > button').click();
    await dlg.getByRole('button', { name: /^E2E部位$/ }).click();
    await dlg.getByRole('button', { name: /^(保存|Save)$/ }).click();
    await dlg.waitFor({ state: 'detached', timeout: 3_000 });
    await goPart('E2E部位');
    await sheet.locator('[data-testid="picker-region-card"]', { hasText: '宽距俯卧撑' }).waitFor({ timeout: 3_000 });
    // 再点一次已选中的部位＝部位面板 → 删除：不弹确认，动作落到「未分部位」
    await parts.getByRole('button', { name: /^E2E部位$/ }).click();
    await pm.getByRole('button', { name: /删除这个部位/ }).click();
    await settle(page);
    if (await page.locator('[role="dialog"]').filter({ hasText: /确定/ }).count()) throw new Error('deleting a part asks for confirmation');
    const pt = await page.locator('[data-testid="toast"]').last().innerText();
    if (!/已删除部位「E2E部位」，1 个动作回到未分部位/.test(pt)) throw new Error(`part delete toast: ${pt}`);
    if (!/未分部位/.test(await sheet.locator('h2').innerText())) throw new Error('did not land on 未分部位');
    await sheet.locator('[data-testid="picker-region-card"]', { hasText: '宽距俯卧撑' }).waitFor({ timeout: 3_000 });
    if (/CT_/i.test(await sheet.innerText())) throw new Error('raw custom-part id leaked into the UI');
    // 撤销：部位回来，动作也回去
    await page.locator('[data-testid="toast-undo"]').last().click();
    await settle(page);
    await goPart('E2E部位');
    await sheet.locator('[data-testid="picker-region-card"]', { hasText: '宽距俯卧撑' }).waitFor({ timeout: 3_000 });
    await clearToasts();

    // 收尾：宽距俯卧撑挪回胸部 · 外轮廓，删掉 E2E部位
    await sheet.locator('[data-testid="picker-region-card"]', { hasText: '宽距俯卧撑' }).click();
    await menu.getByRole('button', { name: /部位与器材/ }).click();
    await dlg.waitFor({ state: 'visible', timeout: 3_000 });
    await dlg.locator('[data-attr="part"] > button').click();
    await dlg.getByRole('button', { name: /^胸部$/ }).click();
    await dlg.locator('[data-attr="region"] > button').click();
    await dlg.getByRole('button', { name: /^外轮廓$/ }).click();
    await dlg.getByRole('button', { name: /^(保存|Save)$/ }).click();
    await dlg.waitFor({ state: 'detached', timeout: 3_000 });
    await goPart('E2E部位');
    await parts.getByRole('button', { name: /^E2E部位$/ }).click();
    await pm.getByRole('button', { name: /删除这个部位/ }).click();
    await settle(page);
    await clearToasts();
    await goPart('胸部');
    if (!(await names('外轮廓')).includes('宽距俯卧撑')) throw new Error('cleanup: 宽距俯卧撑 not back in 外轮廓');
    await sheet.locator('[data-testid="region-arrange"]').click();
    return 'delete = hide + undo, restore from 已删除; custom part new / move into / delete → 未分部位 / undo';
  });

  // 动作属性（2026-10-20）：器材单选；阻力随器材锁定（杠铃 → 杠铃片），固定器械可在配重片 / 杠铃片之间选；
  // 保存后再打开还在；内置做法（罗马尼亚硬拉 · 哑铃）名字取自器材
  await step(page, 'exercise-attrs-gear-and-load', async () => {
    const sheet = page.locator('[data-testid="picker-sheet"]');
    const { cardIn } = regionHelpers(sheet);
    const menu = page.locator('[data-testid="row-action-menu"]');
    const parts = sheet.locator('[data-testid="arrange-parts"]');
    const goPart = async name => {
      const chip = parts.getByRole('button', { name: new RegExp(`^${name}$`) });
      if ((await chip.getAttribute('data-on')) !== '1') await chip.click();
    };
    const dlg = page.locator('[data-testid="exercise-attrs-modal"]');
    const row = k => dlg.locator(`[data-attr="${k}"] > button`);
    const openAttrs = async (col, name) => {
      await (await cardIn(col, name)).click();
      await menu.getByRole('button', { name: /部位与器材/ }).click();
      await dlg.waitFor({ state: 'visible', timeout: 3_000 });
    };
    const save = async () => {
      await dlg.getByRole('button', { name: /^(保存|Save)$/ }).click();
      await dlg.waitFor({ state: 'detached', timeout: 3_000 });
    };
    await sheet.locator('[data-testid="region-arrange"]').click();
    await goPart('胸部');

    await openAttrs('中胸', '器械推胸');
    if (!/固定器械/.test(await row('equipment').innerText())) throw new Error('器械推胸 gear is not 固定器械');
    if (!/配重片/.test(await row('resistance').innerText())) throw new Error('器械推胸 load is not 配重片');
    if (await row('resistance').isDisabled()) throw new Error('machine load should be selectable');
    // 换成杠铃：阻力跟着变成杠铃片；2026-10-21 起杠铃可在「杠铃片 / 固定杠铃」之间选（38d1f6f），不再锁定
    await row('equipment').click();
    await dlg.getByRole('button', { name: /^杠铃$/ }).click();
    if (!/杠铃片/.test(await row('resistance').innerText())) throw new Error('barbell did not set load to 杠铃片');
    if (await row('resistance').isDisabled()) throw new Error('barbell load should be selectable (plates / fixed bar)');
    // 换回固定器械，挑「杠铃片」（挂片式器械）并保存
    await row('equipment').click();
    await dlg.getByRole('button', { name: /^固定器械$/ }).click();
    if (!/配重片/.test(await row('resistance').innerText())) throw new Error('back to machine did not reset load to 配重片');
    await row('resistance').click();
    await dlg.getByRole('button', { name: /^杠铃片$/ }).click();
    await save();
    await openAttrs('中胸', '器械推胸');
    if (!/杠铃片/.test(await row('resistance').innerText())) throw new Error('machine + 杠铃片 did not persist');
    // 收尾：改回配重片
    await row('resistance').click();
    await dlg.getByRole('button', { name: /^配重片$/ }).click();
    await save();

    // 多器材的内置动作拆成了做法：罗马尼亚硬拉 · 哑铃
    await goPart('腿部');
    await (await cardIn('腘绳', '罗马尼亚硬拉')).click();
    await menu.getByRole('button', { name: /^做法/ }).click();
    const vm = page.locator('[data-testid="variant-modal"]');
    await vm.waitFor({ state: 'visible', timeout: 3_000 });
    const opts = await vm.locator('[data-testid="variant-option"]').allInnerTexts();
    if (!opts.some(t => /哑铃/.test(t))) throw new Error(`罗马尼亚硬拉 has no 哑铃 variant: ${opts.join(' | ')}`);
    await vm.getByRole('button', { name: /关闭|Close/ }).first().click();
    await vm.waitFor({ state: 'detached', timeout: 3_000 });
    await sheet.locator('[data-testid="region-arrange"]').click();
    return 'machine load selectable, barbell defaults to 杠铃片 (selectable), machine+杠铃片 persists; 罗马尼亚硬拉 has 哑铃 variant';
  });

  await step(page, 'close-library', async () => {
    // 清空筛选（不给后续步骤留状态）并关闭弹层
    const clearBtn = page
      .locator('[data-testid="picker-sheet"]')
      .getByRole('button', { name: /清空筛选|Clear/ })
      .first();
    if (await clearBtn.isVisible().catch(() => false)) await clearBtn.click();
    // 选了部位时筛选收成一行、没有「清空筛选」那一行：清空＝点行首的「全部」
    const oneLine = page.locator('[data-testid="filters-one-line"]');
    if (await oneLine.isVisible().catch(() => false)) await oneLine.getByRole('button', { name: /^(全部|All)$/ }).click();
    await page.locator('[data-testid="picker-sheet-close"]').click();
    const closed = await until(
      () => page.evaluate(() => !!document.querySelector('[data-testid="picker-sheet"]')?.closest('.pointer-events-none')),
      'the picker sheet to close',
    ).catch(() => false);
    if (!closed) throw new Error('picker-sheet-close did not close the sheet');
    return 'picker sheet closed';
  });

  // §12.3 的横拖改值现在也铺到了次数格（档位 1/2/5）。
  // 这里用真实指针事件拖一把 —— 合成 dispatchEvent 进不了 pointer capture 那条路径。
  await step(page, 'scrub-reps-cell', async () => {
    // 先真的加一个动作进来，账本行才存在
    await page.locator('[data-testid="open-picker-sheet"]').click();
    await page.locator('[data-testid="picker-sheet-exercise"]').first().click();
    await page.locator('[data-testid="picker-sheet-close"]').click();

    const reps = page.locator('[data-testid="ledger-field-reps"]').first();
    await reps.waitFor({ state: 'visible', timeout: 5_000 });
    const input = reps.locator('input');
    const before = Number((await input.inputValue()) || 0);

    const box = await reps.boundingBox();
    const y = box.y + box.height / 2;
    await page.mouse.move(box.x + 8, y);
    await page.mouse.down();
    // 先越过 12px 的接管阈值，再连落几档
    for (let dx = 14; dx <= 74; dx += 10) await page.mouse.move(box.x + 8 + dx, y);
    const badgeVisible = await reps
      .locator('.scrub-step')
      .isVisible()
      .catch(() => false);
    await page.mouse.up();

    const after = Number((await input.inputValue()) || 0);
    if (!(after > before)) throw new Error(`reps did not change on scrub (${before} -> ${after})`);
    if (!Number.isInteger(after)) throw new Error(`reps scrubbed to a non-integer: ${after}`);
    if (!badgeVisible) throw new Error('档位角标 (.scrub-step) never appeared during the drag');
    return `reps ${before} → ${after}, tier badge shown`;
  });

  // 换算残留（不是 0.5 的倍数，如 lbs↔kg 换出来的 61.24）：拖动的第一档先取整并吃掉这一档，
  // 之后照常一档。打字不取整。递减档默认 = 上一行 − 这件器材的一档，再就近取整（等距取轻）。
  // 「杠铃片」（2026-10-18）：这里的动作是杠铃，一档 = 最小一对片；默认片 2026-10-21 起没有 1.25（最小一对 = 5 kg），
  // 取整吸到 5 的网格（配不出来的重量第一格先吸到能配的那一档）。
  // ⚠️ 横划接管阈值 20px（scrubFeel.ENGAGE_PX）比每档 10px 宽，接管那一下会连走两档（docs/TODO.md 记着，没改手感）：
  // 61.24 →（右，接管）65 → 70；再往左：接管两档 70 → 65 → 60，再一档 → 55。
  await step(page, 'scrub-weight-residue-and-drop-set', async () => {
    const weight = page.locator('[data-testid="ledger-field-weight"]').first();
    const input = weight.locator('input');
    await input.fill('61.24');
    const typed = await input.inputValue();
    if (typed !== '61.24') throw new Error(`typing must keep the residue, got ${typed}`);

    // 慢拖：每次 move 隔开足够久，速度留在 ×1 档
    const slow = async (dxs) => {
      const box = await weight.boundingBox();
      const x0 = box.x + box.width / 2;
      const y = box.y + box.height / 2;
      await page.mouse.move(x0, y);
      await page.mouse.down();
      // 按下后先停一下：按下到第一次移动若只隔一两毫秒，速度会算成「猛甩」，
      // 直接跳到 ×2 / ×5 档 —— 真手指挪 14px 要几十毫秒，不会这样
      await page.waitForTimeout(80);
      for (const dx of dxs) {
        await page.mouse.move(x0 + dx, y);
        await page.waitForTimeout(80);
      }
      await page.mouse.up();
      await page.waitForTimeout(350);
      return Number(await input.inputValue());
    };
    const right1 = await slow([22]); // 越过 20px 接管阈值：第一档先吸到网格（65），同一下再走一档
    if (right1 !== 70) throw new Error(`61.24 dragged right past the engage threshold should snap up to 65 then step to 70 (barbell grid), got ${right1}`);
    const left2 = await slow([-22, -32]); // 接管两档 + 一档：70 → 65 → 60 → 55（已在网格上，照常 −5）
    if (left2 !== 55) throw new Error(`70 dragged left three detents should be 55, got ${left2}`);

    // 回到残留值再加递减档：61.24 − 5 = 56.24 → 就近取整（55 差 1.24、60 差 3.76）= 55
    await input.fill('61.24');
    const num = page.locator('.ledger-row .set-num').first();
    const nb = await num.boundingBox();
    await page.mouse.move(nb.x + nb.width / 2, nb.y + nb.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(HOLD_MS);
    await page.mouse.up();
    const sub = page.locator('[data-testid="subset-field-weight"] input').first();
    await sub.waitFor({ state: 'visible', timeout: 3_000 });
    const subW = Number(await sub.inputValue());
    if (subW !== 55) throw new Error(`drop set default should be snap(61.24 − 5) = 55, got ${subW}`);
    return `61.24 →(right) ${right1} →(left×2) ${left2}; drop set ${subW}`;
  });

  // 指针（2026-10-11）：点组号＝选中这一组 + 指针挪到它正下方（经过的待做组一并做完）；
  // 刚做完那组再点＝退回；改值只改值；全零的组点不实；删组单击（+ 撤销，设置开着时）；±5 跟着选中的那组。
  await step(page, 'set-state-gestures', async () => {
    const rows = page.locator('.ledger-row');
    const row0 = rows.first();
    const isInked = async r => (await r.getAttribute('class')).includes('is-inked');
    // 前面的用例改过这一行的重量和次数，但从没点过组号：仍是待做，改过的格子挂 is-edited
    if (await isInked(row0)) throw new Error('editing values marked the row done — 改值必须只改值');
    const edited = await row0.locator('.ledger-field.is-edited').count();
    if (edited < 1) throw new Error('edited cells on a to-do row are not marked is-edited');

    const isSel = async r => (await r.getAttribute('class')).includes('is-selected');
    if (!(await isSel(row0))) throw new Error('the set under the pointer is not selected by default');
    await row0.locator('.set-num').click();
    if (!(await isInked(row0))) throw new Error('tapping the set number did not mark it done');
    // 做完的那一下选中交给默认（下一组待做，审查 A1）：留在刚做完的组上，大图 / ± 改的就是做完的组
    if (await isSel(row0)) throw new Error('the set just done should hand the selection to the next to-do set');
    // 原来每次连点前等 650ms「过长按吞 click 的窗口」。组号上唯一的时间窗是 SetCapsule.onSetNumClick：
    // 长按加递减「达成后」600ms 内的那一次 click 被吞、吞完作废。这几下之间没有长按，窗口不存在，不用等
    await row0.locator('.set-num').click(); // 再点＝退回
    if (await isInked(row0)) throw new Error('tapping the just-done set did not revert it to to-do');
    if (!(await isSel(row0))) throw new Error('the reverted set should stay selected');
    // 做完再退回：改过的格子仍认得（否则结束训练时这组被静默丢弃、不提醒）
    if ((await row0.locator('.ledger-field.is-edited').count()) !== edited) throw new Error('done → revert dropped the is-edited marks');

    // ±5：全场只有一处，在选中的那一组（第 1 组，刚退回、仍选中）
    const steps = page.locator('[data-testid="weight-step"]');
    if ((await steps.count()) !== 1) throw new Error(`expected exactly one ±5 strip, got ${await steps.count()}`);
    const w = row0.locator('[data-testid="ledger-field-weight"] input');
    const w0 = Number(await w.inputValue());
    // 「杠铃片」：一档 = 这件器材的一档（杠铃 = 最小一对片，默认片里是 2.5 × 2 = 5 kg）；不在格子上的第一下先吸到上面能挂的
    const plus = steps.getByRole('button', { name: /重量加|Weight \+/ });
    const plusLabel = (await plus.getAttribute('aria-label')) || '';
    if (!/(^|\D)5 kg/.test(plusLabel)) throw new Error(`barbell + should step by the smallest pair (5 kg), label "${plusLabel}"`);
    await plus.click();
    const w1 = Number(await w.inputValue());
    const onGrid = Math.abs(((w0 - 20) / 5) - Math.round((w0 - 20) / 5)) < 1e-6;
    const want = onGrid ? w0 + 5 : 20 + Math.ceil((w0 - 20) / 5) * 5;
    if (Math.abs(w1 - want) > 0.011) throw new Error(`+ went ${w0} → ${w1}, want ${want}`);
    if (await isInked(row0)) throw new Error('+ marked the row done');

    // 添加组：新行从待做开始
    const before = await rows.count();
    await page.getByRole('button', { name: /^\+?\s*添加组$|Add Set/ }).first().click();
    await until(async () => (await rows.count()) > before, 'the added set row');
    await settle(page);
    const newRow = rows.nth(before);
    if (await isInked(newRow)) throw new Error('a freshly added set started as done');

    // 上一组带着递减档（前面的用例加的），「添加组」照抄过来（a5aa5f3，2026-10-15 用户定：和普通组同一套继承，
    // 撤回 10-06 审查的 addset-clones-drop-set「不抄」；不做那档就删掉）
    const prevSubs = await page.locator(`[data-set-idx="${before - 1}"] [data-testid="subset-remove"]`).count();
    if (prevSubs < 1) throw new Error('fixture drift: the previous set should carry a drop set here');
    const copiedSubs = await page.locator(`[data-set-idx="${before}"] [data-testid="subset-remove"]`).count();
    if (copiedSubs !== prevSubs) throw new Error(`添加组 should copy the ${prevSubs} drop-set row(s) of the previous set, got ${copiedSubs}`);

    // 点下面的组＝指针直接挪到它下方：经过的那组一并做完；再点上面的组＝指针挪回去，后面的退回待做
    // （新加的那组抄了上一组的值、仍待做，正好当第 2 组用；单组卡测不到扫动，所以这里不许跳过）
    const card0Rows = page.locator('[data-ledger-paper]').first().locator('.ledger-row');
    if ((await card0Rows.count()) < 2) throw new Error('fixture drift: the first card needs >= 2 sets to test the sweep');
    const row1 = card0Rows.nth(1);
    await row1.locator('.set-num').click();
    if (!(await isInked(row0)) || !(await isInked(row1))) throw new Error('tapping set 2 should mark sets 1 and 2 done');
    // 做完那一下选中交给下一组待做（审查 A1）：做完的两组都不再选中
    if ((await isSel(row1)) || (await isSel(row0))) throw new Error('after tapping set 2 the selection should move on to the next to-do set');
    await row0.locator('.set-num').click();
    if (!(await isInked(row0)) || (await isInked(row1))) throw new Error('tapping set 1 should move the pointer back: set 2 reverts');
    if (!(await isSel(row0))) throw new Error('set 1 should be selected after moving the pointer back');
    await row0.locator('.set-num').click(); // 刚做完的再点＝退回，回到全待做
    if (await isInked(row0)) throw new Error('reverting set 1 after the sweep failed');

    // A1：点进格子即全选，打字替换旧值；回车跳到同一行的次数格
    // A2：改了的值带动后面没动过的底稿（跟着的吸到能挂的重量）；手动改过的不跟。
    // 打字中途只改这一格，回车 / 离开输入框时按总差值结算一次（a5aa5f3：逐键跟会经过 1、15，差值被截掉）
    const w0in = row0.locator('[data-testid="ledger-field-weight"] input');
    const w1in = row1.locator('[data-testid="ledger-field-weight"] input');
    const wBefore = await w0in.inputValue();
    if ((await w1in.inputValue()) !== wBefore) throw new Error('fixture drift: set 2 should start as a clone of set 1');
    await w0in.click();
    await page.waitForTimeout(80); // 全选放在下一帧
    await page.keyboard.type('77');
    if ((await w0in.inputValue()) !== '77') throw new Error(`typing into a draft cell should replace it, got ${await w0in.inputValue()} (was ${wBefore})`);
    if ((await w1in.inputValue()) !== wBefore) throw new Error(`draft below should hold while typing, got ${await w1in.inputValue()}`);
    await page.keyboard.press('Enter');
    // 「杠铃片」：打的数照原样（77），被带着动的吸到最近能挂的（默认片下杠铃一档 5 kg：77 → 75）
    if ((await w0in.inputValue()) !== '77') throw new Error(`a typed weight must stay as typed, got ${await w0in.inputValue()}`);
    if ((await w1in.inputValue()) !== '75') throw new Error(`same-value draft below should follow and snap to 75 on Enter: ${await w1in.inputValue()}`);
    if ((await row1.locator('[data-testid="ledger-field-weight"].is-edited').count()) !== 0) throw new Error('a follower must stay a draft (not is-edited)');
    const focused = await page.evaluate(() => document.activeElement?.getAttribute('aria-label') || '');
    if (!/^reps/.test(focused)) throw new Error(`Enter in the weight cell should focus reps, focused "${focused}"`);
    await page.keyboard.press('Enter'); // 次数格回车收键盘
    await w1in.click();
    await page.waitForTimeout(80);
    await page.keyboard.type('80'); // 手动改第 2 组
    await w0in.click();
    await page.waitForTimeout(80);
    await page.keyboard.type('70');
    if ((await w1in.inputValue()) !== '80') throw new Error('a manually edited draft must not follow');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');

    // A3：选中行的 ±5 条右端「递减」一次点击加一档
    const subsBefore = await page.locator(`[data-set-idx="0"] [data-testid="subset-remove"]`).count();
    await page.locator('[data-testid="add-drop-set"]').click();
    await settle(page);
    const subsAfter = await page.locator(`[data-set-idx="0"] [data-testid="subset-remove"]`).count();
    if (subsAfter !== subsBefore + 1) throw new Error(`「递减」button should add one drop step: ${subsBefore} → ${subsAfter}`);

    // 全零的行点不实（只选中，指针不动）。新组抄来的递减档也有数，得一并删掉才是真全零 ——
    // 否则点组号会把它连同上面改过的第 1 组一起扫成做完，下面「结束训练」就没有改过没点完成的组可提示
    const newSubs = page.locator(`[data-set-idx="${before}"] [data-testid="subset-remove"]`);
    for (let k = await newSubs.count(); k > 0; k--) {
      await newSubs.first().click();
      await until(async () => (await newSubs.count()) < k, 'the drop-set row to go away');
    }
    await newRow.locator('[data-testid="ledger-field-weight"] input').fill('');
    await newRow.locator('[data-testid="ledger-field-reps"] input').fill('');
    await newRow.locator('.set-num').click();
    await newRow.locator('.set-num').click();
    if (await isInked(newRow)) throw new Error('an all-zero set could be marked done');
    if (await isInked(row0)) throw new Error('tapping an all-zero set moved the pointer (set 1 got swept to done)');

    // 删组：单击即删，不弹撤销条（2026-10-18 起训练页删组 / 删动作不给撤销）
    const n = await rows.count();
    await rows.nth(n - 1).locator('[data-testid="set-remove"]').click();
    await until(async () => (await rows.count()) === n - 1, 'the set row to be removed').catch(() => {});
    if ((await rows.count()) !== n - 1) throw new Error('single tap did not delete the set');
    if (await page.locator('[data-testid="toast-undo"]').count()) throw new Error('deleting a set still shows an undo toast');

    // 结束训练：改过没点完成的组按做完入册（2026-10-20），确认框不再提「没点完成」、也没有「返回补点」
    await page.getByRole('button', { name: /结束训练|End Workout/ }).first().click();
    const dlg = page.locator('[role="dialog"]');
    await dlg.waitFor({ state: 'visible', timeout: 3_000 });
    const text = await dlg.innerText();
    if (/没点完成|返回补点/.test(text)) throw new Error(`end confirm still nags about edited-but-not-done sets: ${text}`);
    await dlg.getByRole('button', { name: /^(取消|Cancel)$/ }).click();
    await dlg.waitFor({ state: 'detached', timeout: 3_000 });
    return `toggle ok · sweep down/up · type replaces + follow · drop btn · new row to-do · all-zero refused · + ${w0}→${w1} · delete (no undo) · end does not nag`;
  });

  // 第 7 条：训练卡 ⋯ → 重命名。改的是动作库里的名字，卡片立刻显示新名；
  // 撞上另一个动作的现名 / 曾用名时拒绝，弹窗不关（否则两个动作的历史会被认成一个）。
  await step(page, 'rename-exercise-from-card', async () => {
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

    // 重名：拿库里另一个动作的名字，必须被拒
    let dlg = await openRename();
    const other = before === '哑铃平板卧推' ? '杠铃平板卧推' : '哑铃平板卧推';
    await dlg.locator('input').fill(other);
    await dlg.getByRole('button', { name: /^(确定|确认|OK|Confirm)$/ }).click();
    // 拒绝＝出「已经是另一个动作的名字」的提示、弹窗留着；接受＝弹窗关掉。哪个先发生等哪个，再判
    await until(
      async () => (await page.locator('[data-testid="toast"]', { hasText: /已经是另一个动作的名字|already used by another exercise/ }).count()) > 0 || !(await dlg.isVisible()),
      'the rename to be rejected or accepted',
    ).catch(() => {});
    if (!(await dlg.isVisible())) throw new Error(`renaming to another exercise's name "${other}" was accepted`);
    await dlg.getByRole('button', { name: /^(取消|Cancel)$/ }).click();
    await dlg.waitFor({ state: 'detached', timeout: 3_000 });
    // 报错 toast 收掉，别让它活到后面的英文扫雷里
    // 每次重查第一条：撤销条会自己到期消失，按快照逐个点会去等一个已经不存在的元素
    const dismiss = page.locator('[data-testid="toast"] [aria-label="dismiss"]');
    while (await dismiss.count()) await dismiss.first().click({ timeout: 1_000 }).catch(() => {});

    // 正常改名
    const fresh = 'E2E 改名卧推';
    dlg = await openRename();
    await dlg.locator('input').fill(fresh);
    await dlg.getByRole('button', { name: /^(确定|确认|OK|Confirm)$/ }).click();
    await dlg.waitFor({ state: 'detached', timeout: 3_000 });
    const after = (await title.textContent())?.trim();
    if (after !== fresh) throw new Error(`card title did not follow rename (${before} → ${after})`);

    // 旧名记成曾用名：覆盖层里带着它（历史记录不改写，靠它认回来）
    const aliases = await page.evaluate(() => {
      const raw = localStorage.getItem(lsKey('fitlog_exercise_overrides')) || '{}';
      return Object.values(JSON.parse(raw)).flatMap(o => o.aliases || []);
    });
    if (!aliases.includes(before)) throw new Error(`old name "${before}" not kept as alias: ${JSON.stringify(aliases)}`);
    return `${before} → ${after}; clash with "${other}" rejected; alias kept`;
  });

  // 第 8 条：做法（原练法）。⋯ → 做法 → 快捷「宽握」建好即选中，眉批显示；改名；点眉批换回标准；删除走撤销条
  await step(page, 'exercise-variant', async () => {
    const card = page.locator('.ui-card').filter({ has: page.locator('[data-testid="ledger-field-weight"]') }).first();
    const modal = page.locator('[data-testid="variant-modal"]');
    await card.getByRole('button', { name: /动作菜单|Exercise menu/ }).click();
    await card.getByRole('menuitem', { name: /^做法$|^Variant$/ }).click();
    await modal.waitFor({ state: 'visible', timeout: 3_000 });
    await modal.getByRole('button', { name: /^宽握$/ }).click();
    await modal.waitFor({ state: 'detached', timeout: 3_000 });
    const mark = card.locator('[data-testid="variant-marginalia"]');
    if ((await mark.innerText()).trim() !== '宽握') throw new Error(`marginalia should show 宽握, got ${await mark.innerText()}`);

    // 改名
    await mark.click();
    await modal.getByRole('button', { name: /改名 宽握/ }).click();
    await modal.locator('input').first().fill('宽握·暂停');
    await modal.getByRole('button', { name: /^保存$/ }).click();
    const opts = await modal.locator('[data-testid="variant-option"]').allInnerTexts();
    if (!opts.some(o => o.includes('宽握·暂停'))) throw new Error(`rename failed: ${opts.join('|')}`);
    // 换回标准
    await modal.locator('[data-testid="variant-option"]', { hasText: '标准' }).click();
    await modal.waitFor({ state: 'detached', timeout: 3_000 });
    if ((await mark.innerText()).trim() !== '标准') throw new Error('switching back to standard failed');
    // 删除：撤销条
    await mark.click();
    await modal.getByRole('button', { name: /删除 宽握·暂停/ }).click();
    const t = await page.locator('[data-testid="toast"]').last().innerText();
    if (!/已删除做法「宽握·暂停」/.test(t)) throw new Error(`no undo toast for variant delete: ${t}`);
    await modal.getByRole('button', { name: /^(关闭|Close)$/ }).first().click();
    await modal.waitFor({ state: 'detached', timeout: 3_000 });
    const dismiss = page.locator('[data-testid="toast"] [aria-label="dismiss"]');
    while (await dismiss.count()) await dismiss.first().click({ timeout: 1_000 }).catch(() => {});
    if (await mark.count()) throw new Error('marginalia should disappear once the exercise has no variants');
    return 'create via quick chip → marginalia; rename; back to standard; delete → undo toast';
  });

  // workbench-not-restored：按返回只离开页面，工作台留着 —— 首页「进行中」+ FAB「回到训练」，点了接回原样；
  // 一组都没做 →「结束」＝放弃这场（不留空场在时间线里）
  await step(page, 'back-to-tab-from-workout', async () => {
    await page.getByLabel(/^返回$|^Back$/).first().click();
    // 离开训练页＝底栏回来；问了的话停在训练页
    await page.locator('nav').first().waitFor({ state: 'visible', timeout: 3_000 }).catch(() => {});
    if (await page.locator('[role="dialog"]').isVisible().catch(() => false)) throw new Error('back still asks for confirmation');
    const navVisible = await page.locator('nav').first().isVisible();
    if (!navVisible) throw new Error('bottom nav should reappear after back');
    const row = page.locator('[data-testid="in-progress"]');
    await row.waitFor({ state: 'visible', timeout: 3_000 });
    await page.getByRole('button', { name: /^回到训练$|^Resume workout$/ }).click();
    await page.locator('[data-testid="ledger-field-weight"]').first().waitFor({ state: 'visible', timeout: 3_000 });
    await backAndDiscard(page);
    if (await row.isVisible().catch(() => false)) throw new Error('discarded workout still shows as in progress');
    return 'back keeps the workout (in-progress row + resume FAB); end → discard';
  });

  await step(page, 'unit-toggle', async () => {
    const btn = page.locator('header button').filter({ hasText: /^(kg|lbs)$/i }).first();
    await btn.waitFor({ state: 'visible' });
    const before = (await btn.textContent())?.trim();
    await btn.click();
    await settle(page);
    const after = (await btn.textContent())?.trim();
    if (before === after) throw new Error(`unit did not toggle (${before} -> ${after})`);
    return `${before} -> ${after}`;
  });

  // 英文模式扫雷。整个 e2e 从来没切过语言，于是「英文分支忘了写」这类漏
  // 一路漏到了线上：结束训练确认框里的单位、弹窗关闭按钮的 aria-label、
  // PR 历史的日期 —— 全是同一类。这一步把主要界面在英文下走一遍，
  // 断言 DOM 里不该再出现汉字。
  //
  // .font-seal 的豁免留着当保险丝：英文下印面已经换成衬线首字母（C S B L A O / PR，
  // 见 design 文档 §12.1），font-seal 那支笔根本不上场，正常情况下这条豁免一个都不会命中。
  await step(page, 'english-mode-no-chinese', async () => {
    const sweep = () =>
      page.evaluate(() => {
        const CJK = /[一-鿿]/;
        const hits = [];
        const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        let n;
        while ((n = walk.nextNode())) {
          const t = (n.nodeValue || '').trim();
          if (!t || !CJK.test(t)) continue;
          if (n.parentElement && n.parentElement.closest('.font-seal')) continue;
          // 语言选项里的「中文」是语言名本身（首选项弹层，标了 lang="zh-CN"）
          if (n.parentElement && n.parentElement.closest('body [lang^="zh"]')) continue;
          // 训练标题是用户数据（默认标题按结束时的语言生成，比如「训练 2026/10/20」），不是界面文案
          if (n.parentElement && n.parentElement.closest('[data-user-text]')) continue;
          hits.push('text:' + t.slice(0, 40));
        }
        for (const el of document.querySelectorAll('[aria-label],[title],[placeholder]')) {
          for (const a of ['aria-label', 'title', 'placeholder']) {
            const v = el.getAttribute(a);
            if (v && CJK.test(v)) hits.push(a + ':' + v.slice(0, 40));
          }
        }
        return hits;
      });

    const nav = (re) => page.locator('nav button', { hasText: re }).click();

    await nav(/我的|Profile/);
    await page.locator('[data-testid="prefs-entry"]').click();
    await page.locator('[data-testid="language-toggle"] button[aria-pressed="false"]').click();
    await page.locator('[data-testid="prefs-sheet-close"]').click();
    await domQuiet(page);

    // 切完先自证确实在英文下：<html lang> 是跟着语言走的（UserSettingsContext）
    const htmlLang = await page.evaluate(() => document.documentElement.lang);
    if (htmlLang !== 'en') throw new Error(`language toggle did not take effect (html lang=${htmlLang})`);

    const found = [];
    const screens = [
      ['profile', null],
      ['dashboard', /个人记录|PR Hub|Dashboard/],
      ['plan', /训练计划|Plan/],
    ];
    for (const [name, re] of screens) {
      if (re) {
        await nav(re);
        await domQuiet(page); // 整屏画完再扫（原来固定等 300ms）
      }
      for (const hit of await sweep()) found.push(`${name} → ${hit}`);
    }

    // 新建训练页（部位印那一屏）也扫一遍：印章之外不该有汉字。
    // 前面的用例刚结束过一场，10 分钟内点开始会先问「继续刚才那场？」——
    // 这里要的是干净的新建页，所以选「新开一场」。
    await page.getByRole('button', { name: /开始训练|Start workout/i }).click();
    await pickStartGym(page);
    const resumeDlg = page.locator('[role="dialog"]');
    await resumeDlg.or(page.locator('text=/新建训练|New Workout/')).first().waitFor({ timeout: 5_000 });
    if (await resumeDlg.isVisible().catch(() => false)) {
      await clickAppConfirm(page, /^新开一场$|^Start new$/);
    }
    await page.waitForSelector('text=/新建训练|New Workout/', { timeout: 5_000 });
    await domQuiet(page);
    for (const hit of await sweep()) found.push(`new-workout → ${hit}`);

    // 遮罩退场有动画，DOM 还在的那几帧里点谁都会被 scrim 吞掉（点击会一直重试到超时）。
    // 等它真的从 DOM 上消失再点，比 waitForTimeout 猜一个数可靠。
    await page.waitForFunction(() => !document.querySelector('[role="presentation"]'), null, {
      timeout: 5_000,
    });
    // 用 aria-label 定位而不是可及名：部位印那一格的可及名也是 Back（背），
    // getByRole 会同时命中两个而报 strict mode violation。那一格没有 aria-label。
    await page.getByLabel(/^返回$|^Back$/).first().click();
    await page.locator('nav').first().waitFor({ state: 'visible', timeout: 3_000 }).catch(() => {});
    // 空训练直接返回不会弹确认；真弹了（有内容）就确认离开，别把后面的用例卡住
    if (await resumeDlg.isVisible().catch(() => false)) {
      await acceptAppConfirm(page);
    }

    // 复原成中文，后续用例看到的还是原来的界面
    await nav(/我的|Profile/);
    await page.locator('[data-testid="prefs-entry"]').click();
    await page.locator('[data-testid="language-toggle"] button[aria-pressed="false"]').click();
    await page.locator('[data-testid="prefs-sheet-close"]').click();
    await settle(page); // <html lang> 在 effect 里改
    if ((await page.evaluate(() => document.documentElement.lang)) === 'en') throw new Error('could not switch the language back to Chinese');

    if (found.length) {
      throw new Error(`${found.length} Chinese string(s) leaked in English mode: ${found.slice(0, 8).join(' | ')}`);
    }
    return 'no Chinese outside decorative seals';
  });

  // 防误结束拆场的另一半：选「继续这场」要把刚结束的那场接回工作台。
  // 放在最后，因为它会把一条记录的 finishedAt 清掉，改变后续用例看到的数据。
  await step(page, 'resume-recent-workout', async () => {
    await page.locator('nav button', { hasText: /个人记录|PR Hub|Dashboard/ }).click();
    await settle(page);
    // 接回的是「最近结束的那一场」：前面的用例可能又结束过别的场次（并入上一场那条会造一场），按快照现查
    const resumeTarget = await page.evaluate(async () => {
      await window.__fitlog.flush();
      const snap = await window.__fitlog.fetchRemote();
      const done = ((snap && snap.workouts) || []).filter(w => w.finishedAt);
      done.sort((a, b) => new Date(b.finishedAt) - new Date(a.finishedAt));
      return done[0] ? { id: done[0].id } : null;
    });
    if (!resumeTarget) throw new Error('fixture drift: no finished workout to resume');
    const resumeId = resumeTarget.id;
    // 2026-10-11：「继续这场」在时间线长按菜单里（刚结束 10 分钟内才有），FAB 不再问
    const rcard = page.locator(`[data-testid="timeline-session-${resumeId}"]`);
    if (!(await rcard.isVisible().catch(() => false))) {
      await page.getByRole('button', { name: /按时间|Timeline/ }).first().click();
      await rcard.waitFor({ state: 'visible', timeout: 3_000 });
    }
    // 居中：贴顶会被吸顶的页头盖住，按下去落在页头上
    await rcard.evaluate(el => el.scrollIntoView({ block: 'center' }));
    const rbox = await stableBox(rcard);
    await page.mouse.move(rbox.x + rbox.width / 2, rbox.y + rbox.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(HOLD_MS);
    await page.mouse.up();
    const rmenu = page.locator('[data-testid="timeline-session-menu"]');
    await rmenu.waitFor({ state: 'visible', timeout: 3_000 });
    await page.waitForTimeout(400);
    const resumeItem = rmenu.locator('[data-testid="timeline-resume"]');
    if (!(await resumeItem.isVisible().catch(() => false))) throw new Error('「继续这场」missing from the menu of a workout finished minutes ago');
    await resumeItem.click();
    await page.waitForSelector('text=/新建训练|New Workout/', { timeout: 5_000 });

    // 接回来的是那一场【本身】：动作还在（工作台上有组）。不写死动作名 ——
    // 前面的用例结束过哪一场取决于流程（2026-10-20 起改过数没点完成的那场也会入册）
    const hasExercise = await page
      .locator('[data-testid="ledger-field-weight"]')
      .first()
      .isVisible()
      .catch(() => false);
    if (!hasExercise) throw new Error('resumed workout lost its exercises');

    // 而且它是同一条记录 —— finishedAt 被清掉，不是新开了一场
    const check = await page.evaluate(async (id) => {
      await window.__fitlog.flush();
      const snap = await window.__fitlog.fetchRemote();
      const list = (snap && snap.workouts) || [];
      const w = list.find(x => x.id === id);
      return { total: list.length, found: !!w, finishedAt: w?.finishedAt ?? null };
    }, resumeId);
    if (!check.found) throw new Error(`resumed workout ${resumeId} vanished from the snapshot`);
    if (check.finishedAt) throw new Error(`finishedAt not cleared on resume: ${check.finishedAt}`);
    return `resumed same record (${check.total} workouts), finishedAt cleared`;
  });

  // 带夹具的场景和备份那套各开各的 context、互不相干：并行跑（主流程里有对时序敏感的拖动手势，不和它并行）
  const [, backup] = await Promise.all([
    SEEDED_PLAN.run.size ? seededScenarios(browser, { escapedRemoteCalls }) : null,
    runBackup(browser, BACKUP_PLAN),
  ]);
  report.backup = backup.results;
  if (backup.failed) report.steps.push({ name: 'backup', status: 'fail', detail: backup.results.find(r => r.status === 'fail')?.detail });
  for (const e of backup.pageErrors) report.pageErrors.push(`[backup] ${e}`);

  // 数据隔离断言：e2e 全程不得有任何请求真的打到后端
  await step(page, 'no-real-backend-calls', async () => {
    if (escapedRemoteCalls.length) {
      throw new Error(`有 ${escapedRemoteCalls.length} 个请求逃逸到真实后端: ${escapedRemoteCalls.slice(0, 5).join(', ')}`);
    }
    return 'all backend traffic mocked';
  });

  report.escapedRemoteCalls = escapedRemoteCalls;
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));

  await browser.close();

  const failed = report.steps.filter(s => s.status === 'fail');
  const bPass = backup.results.filter(r => r.status === 'pass').length;
  console.log(`\n== summary: ${report.steps.length - failed.length}/${report.steps.length} passed · backup ${bPass}/${backup.results.length} ==`);
  console.log(`   console.error count: ${report.consoleErrors.length}`);
  console.log(`   page errors: ${report.pageErrors.length}`);
  console.log(`   wall clock: ${((Date.now() - T0) / 1000).toFixed(1)}s`);
  if (UNTIL_TIMEOUTS.length) console.log(`   条件等待超时 ${UNTIL_TIMEOUTS.length} 次（白等了）：${UNTIL_TIMEOUTS.join(' | ')}`);
  printSlowest('主流程', timings.get(MAIN_PLAN));
  printSlowest('带夹具', timings.get(SEEDED_PLAN));
  printSlowest('备份', backup.timings);
  if (failed.length || report.consoleErrors.length || report.pageErrors.length) {
    process.exit(1);
  }
};

main().catch(err => {
  console.error('e2e crashed:', err);
  fs.writeFileSync(path.join(OUT, 'crash.txt'), String(err.stack || err));
  process.exit(1);
});
