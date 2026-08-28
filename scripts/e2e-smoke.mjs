// End-to-end smoke test that simulates a real user session.
// Runs against the running dev server at http://localhost:3000.
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

async function step(page, name, fn) {
  process.stdout.write(`▶ ${name}\n`);
  try {
    const detail = await fn();
    logStep(name, 'pass', detail);
    await shoot(page, name.replace(/[^a-z0-9]+/gi, '_').toLowerCase());
  } catch (err) {
    logStep(name, 'fail', err.message);
    await shoot(page, 'FAIL-' + name.replace(/[^a-z0-9]+/gi, '_').toLowerCase());
    throw err;
  }
}

const main = async () => {
  console.log(`\n== e2e smoke against ${BASE} ==\n`);

  const browser = await chromium.launch({ headless: true });
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
    await page.getByText(/外观|Appearance/).waitFor({ state: 'visible' });
    return '我的 tab open';
  });

  await step(page, 'theme-manual-dark', async () => {
    await page.getByRole('button', { name: /^深色$|^Dark$/ }).click();
    await page.waitForTimeout(200);
    const isDark = await page.evaluate(() => document.documentElement.classList.contains('dark'));
    if (!isDark) throw new Error('manual dark did not apply');
    return 'manual dark works';
  });

  await step(page, 'theme-manual-light', async () => {
    await page.getByRole('button', { name: /^浅色$|^Light$/ }).click();
    await page.waitForTimeout(200);
    const isDark = await page.evaluate(() => document.documentElement.classList.contains('dark'));
    if (isDark) throw new Error('manual light did not apply');
    return 'manual light works';
  });

  await step(page, 'theme-back-to-auto', async () => {
    await page.getByRole('button', { name: /跟随系统|System/ }).click();
    await page.waitForTimeout(150);
    const pref = await page.evaluate(() => localStorage.getItem(lsKey('theme-pref')));
    if (pref !== 'auto') throw new Error('theme-pref not persisted as auto');
    return 'auto persisted';
  });

  await step(page, 'goto-plan', async () => {
    await page.locator('nav button', { hasText: /训练计划|Plan/ }).click();
    await page.waitForTimeout(400);
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
    // Open library through the editor and append the first available exercise
    await page.locator('[data-testid="schedule-pick-library"]').click();
    // Library overlay must sit above the schedule editor.
    // 以前这里按 `.z-[100]` 类名找 —— 锁死在一个随手 z 值上，而设计规格
    // 要求的正是干掉这些随手值。现在按 testid 找，并且真的比较计算层级。
    const lib = page.locator('[data-testid="library-modal"]');
    await lib.waitFor({ state: 'visible', timeout: 5_000 });
    const stacking = await page.evaluate(() => {
      const z = el => (el ? Number(getComputedStyle(el).zIndex) : NaN);
      const libEl = document.querySelector('[data-testid="library-modal"]');
      const editorEl = document.querySelector('[data-testid="schedule-editor"]');
      const editorRoot = editorEl && editorEl.closest('[role="presentation"]');
      return {
        lib: z(libEl),
        editor: z(editorRoot),
        // 同一个父节点才使 z-index 的比较有意义（否则各自在局部层叠上下文里）
        sameParent: !!libEl && !!editorRoot && libEl.parentElement === editorRoot.parentElement,
      };
    });
    if (!(stacking.lib > stacking.editor)) {
      throw new Error(`library z-index ${stacking.lib} not above editor ${stacking.editor}`);
    }
    if (!stacking.sameParent) {
      throw new Error('library and editor are not in the same stacking parent');
    }

    // === Sub-check: the sidebar tags should be functional ===
    // In "all categories" mode (default from plan picker), sidebar should show body parts header.
    // ExercisePicker 使用 h4 作为部位/器材分区标题（非 h3）
    await lib.locator('h3, h4', { hasText: /训练部位|Body Parts/ }).first().waitFor({ state: 'visible', timeout: 5_000 });
    const initialCount = await page.locator('[data-testid="library-exercise-card"]').count();
    if (initialCount === 0) throw new Error('library showed 0 exercises in "all categories" mode');
    // Click the first body-part tag in the sidebar and ensure list narrows
    const firstBodyPartTag = lib
      .locator('button')
      .filter({ hasText: /^(胸部|肩部|背部|手臂|腿部|核心|Chest|Shoulder|Back|Arms|Legs|Core)$/ })
      .first();
    await firstBodyPartTag.click();
    await page.waitForTimeout(300);
    const filteredCount = await page.locator('[data-testid="library-exercise-card"]').count();
    if (filteredCount === 0 || filteredCount >= initialCount) {
      throw new Error(
        `sidebar tag filter not working: initial=${initialCount}, after-click=${filteredCount}`,
      );
    }

    // Pick the first remaining exercise
    await page.locator('[data-testid="library-exercise-card"]').first().click();
    // Library closes
    await lib.waitFor({ state: 'detached', timeout: 5_000 });
    // Editor should still be open and have at least 2 exercise rows
    const rows = await page.locator('[data-testid="schedule-exercise-row"]').count();
    if (rows < 2) throw new Error(`expected >= 2 exercise rows after library pick, got ${rows}`);
    // Inferred body parts chip area should now contain at least one entry
    const inferred = page.locator('[data-testid="schedule-inferred-bodyparts"]');
    const hasInferred = await inferred.isVisible().catch(() => false);
    if (!hasInferred) throw new Error('inferred body-parts chip area not visible after pick');
    return `tag-filter ${initialCount}→${filteredCount}; ${rows} rows; inferred chips ok`;
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
    await page.waitForSelector('text=/新建训练|New Workout/', { timeout: 5_000 });
    // The prefilled exercise name should be visible somewhere in the workout view
    const has = await page.locator('text=E2E Bench Press').first().isVisible().catch(() => false);
    if (!has) throw new Error('prefilled exercise not visible in new-workout view');
    // Go back without saving (UiOverlay confirm, not window.confirm)
    await page.getByRole('button', { name: /^返回$|^Back$/ }).click();
    await acceptAppConfirm(page);
    await page.locator('[data-testid="tab-plan"]').waitFor({ state: 'visible', timeout: 5_000 });
    return 'prefill + back ok';
  });

  // 从计划开始训练 → 结束 → 训练记录带上 fromSchedule.scheduleId 并推到远端。
  // 「按计划 / 有调整」确认弹窗已随 6c612c4 移除，这里只校验计划与训练的关联。
  await step(page, 'plan-finish-from-schedule', async () => {
    // Re-enter Plan tab and start the session again
    await page.locator('[data-testid="tab-plan"]').click();
    await page.waitForTimeout(300);
    await page.locator('[data-testid="plan-subview-schedule"]').click();
    await page.waitForTimeout(200);
    const startBtn = page.locator(`[data-testid="schedule-start-${createdScheduleId}"]`);
    await startBtn.click();
    await page.waitForSelector('text=/新建训练|New Workout/', { timeout: 5_000 });
    // 按钮文案是动态的（结束训练/结束中/已结束/失败），所以不能用 ^...$ 精确匹配。
    await page.getByRole('button', { name: /结束训练|End Workout/ }).first().click();
    await acceptAppConfirm(page);
    // After finishing it goes back to dashboard within 2s
    await page.waitForTimeout(2500);

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
    return `workout ${verify.workoutId} linked to schedule, persisted to remote`;
  });

  await step(page, 'plan-switch-to-goals', async () => {
    // After plan-finish-from-schedule we landed back on dashboard — return to Plan first
    await page.locator('[data-testid="tab-plan"]').click();
    await page.waitForTimeout(300);
    await page.locator('[data-testid="plan-subview-goals"]').click();
    await page.waitForTimeout(200);
    const selected = await page.locator('[data-testid="plan-subview-goals"]').getAttribute('aria-selected');
    if (selected !== 'true') throw new Error('goals sub-view not active');
    return 'goals sub-view active';
  });

  await step(page, 'goto-dashboard', async () => {
    await page.locator('nav button', { hasText: /个人记录|PR Hub|Dashboard/ }).click();
    await page.waitForTimeout(400);
    return 'dashboard tab open';
  });

  // ── 时间线操作层（§12.8）──────────────────────────────────────
  // 行内「编辑·补加·删除」三个常驻按钮已被长按菜单取代，删除也从确认弹窗
  // 改成了「先执行 + 撤销条」。这两件事此前一个用例都没覆盖到 ——
  // 按钮被删掉时 e2e 依然全绿，正说明这块是盲区。
  await step(page, 'timeline-no-inline-buttons', async () => {
    if (!finishedWorkoutId) throw new Error('no finished workout to inspect');
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
    // 长按 500ms 达成（120ms 静默 + 380ms 进度线），这里按满 750ms 留余量。
    await page.mouse.move(box.x + box.width - 60, box.y + 32);
    await page.mouse.down();
    await page.waitForTimeout(750);
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

    // 通则 3：破坏性操作用「先执行 + 撤销」，不再弹确认框
    await page.waitForTimeout(400);
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
    await page.waitForTimeout(700);
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
    const before = await cards.count();
    if (before < 2) throw new Error(`need >= 2 sessions to test merge, got ${before}`);
    const first = cards.first();
    const mergedId = await first.getAttribute('data-testid');
    const box = await first.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(750);
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
    await page.waitForTimeout(750);
    await page.mouse.up();

    const menu = page.locator('[data-testid="timeline-session-menu"]');
    await menu.waitFor({ state: 'visible', timeout: 3_000 });
    await page.waitForTimeout(400); // 同上：静默期
    await menu.getByRole('menuitem').filter({ hasText: /复制为今天的训练|Copy to today/ }).click();

    await page.waitForSelector('text=/新建训练|New Workout/', { timeout: 5_000 });
    const hasExercise = await page.locator('text=E2E Bench Press').first().isVisible().catch(() => false);
    if (!hasExercise) throw new Error('copied workout has no exercises');
    // 红线（§12.6）：复制来的组必须是底稿，不能静默变成数据 —— 眉批就是它的凭据
    const draftNote = page.locator('text=/底稿 · 上次|Draft · last/').first();
    await draftNote.waitFor({ state: 'visible', timeout: 3_000 });

    // 别给后续用例留状态：底稿从没落过盘，返回即丢
    await page.getByRole('button', { name: /^返回$|^Back$/ }).click();
    await acceptAppConfirm(page);
    await page.waitForTimeout(300);
    return 'copied as drafts with prefill note';
  });

  await step(page, 'open-workout-via-fab', async () => {
    await page.getByRole('button', { name: /开始训练|Start Workout/ }).click();
    // 刚才结束过训练，防误结束拆场的闸门会先问一句 —— 这里选「新开一场」
    await clickAppConfirm(page, /^新开一场$|^Start new$/);
    await page.waitForSelector('text=/新建训练|New Workout/', { timeout: 5_000 });
    return 'resume prompt dismissed, new-workout view shown';
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
    await page.waitForTimeout(400); // 弹层滑入动画
    await sheet.getByRole('button', { name: /^(胸部|Chest)$/ }).first().click();
    await page.locator('[data-testid="picker-sheet-exercise"]').first().waitFor({
      state: 'visible',
      timeout: 5_000,
    });
    const count = await page.locator('[data-testid="picker-sheet-exercise"]').count();
    if (count === 0) throw new Error('picker sheet showed 0 exercises under 胸部');
    return `picker sheet visible, ${count} exercises under 胸部`;
  });

  await step(page, 'close-library', async () => {
    // 清空筛选（不给后续步骤留状态）并关闭弹层
    const clearBtn = page
      .locator('[data-testid="picker-sheet"]')
      .getByRole('button', { name: /清空筛选|Clear/ })
      .first();
    if (await clearBtn.isVisible().catch(() => false)) await clearBtn.click();
    await page.locator('[data-testid="picker-sheet-close"]').click();
    await page.waitForTimeout(400);
    return 'picker sheet closed';
  });

  // §12.3 的横拖改值现在也铺到了次数格（档位 1/2/5）。
  // 这里用真实指针事件拖一把 —— 合成 dispatchEvent 进不了 pointer capture 那条路径。
  await step(page, 'scrub-reps-cell', async () => {
    // 先真的加一个动作进来，账本行才存在
    await page.locator('[data-testid="open-picker-sheet"]').click();
    await page.waitForTimeout(400);
    await page.locator('[data-testid="picker-sheet-exercise"]').first().click();
    await page.locator('[data-testid="picker-sheet-close"]').click();
    await page.waitForTimeout(400);

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

  await step(page, 'back-to-tab-from-workout', async () => {
    await page.getByRole('button', { name: /^返回$|^Back$/ }).click();
    // 现在工作台里有一个刚加的动作，返回会先确认
    await acceptAppConfirm(page);
    await page.waitForTimeout(300);
    const navVisible = await page.locator('nav').first().isVisible();
    if (!navVisible) throw new Error('bottom nav should reappear after back');
    return 'back to dashboard';
  });

  await step(page, 'unit-toggle', async () => {
    const btn = page.locator('header button').filter({ hasText: /^(kg|lbs)$/i }).first();
    await btn.waitFor({ state: 'visible' });
    const before = (await btn.textContent())?.trim();
    await btn.click();
    await page.waitForTimeout(200);
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
    await page.locator('[data-testid="language-toggle"]').click();
    await page.waitForTimeout(300);

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
        await page.waitForTimeout(300);
      }
      for (const hit of await sweep()) found.push(`${name} → ${hit}`);
    }

    // 新建训练页（部位印那一屏）也扫一遍：印章之外不该有汉字。
    // 前面的用例刚结束过一场，10 分钟内点开始会先问「继续刚才那场？」——
    // 这里要的是干净的新建页，所以选「新开一场」。
    await page.getByRole('button', { name: /开始训练|Start workout/i }).click();
    await page.waitForTimeout(400);
    const resumeDlg = page.locator('[role="dialog"]');
    if (await resumeDlg.isVisible().catch(() => false)) {
      await clickAppConfirm(page, /^新开一场$|^Start new$/);
      await page.waitForTimeout(400);
    }
    for (const hit of await sweep()) found.push(`new-workout → ${hit}`);

    // 遮罩退场有动画，DOM 还在的那几帧里点谁都会被 scrim 吞掉（点击会一直重试到超时）。
    // 等它真的从 DOM 上消失再点，比 waitForTimeout 猜一个数可靠。
    await page.waitForFunction(() => !document.querySelector('[role="presentation"]'), null, {
      timeout: 5_000,
    });
    // 用 aria-label 定位而不是可及名：部位印那一格的可及名也是 Back（背），
    // getByRole 会同时命中两个而报 strict mode violation。那一格没有 aria-label。
    await page.getByLabel(/^返回$|^Back$/).first().click();
    await page.waitForTimeout(400);
    // 空训练直接返回不会弹确认；真弹了（有内容）就确认离开，别把后面的用例卡住
    if (await resumeDlg.isVisible().catch(() => false)) {
      await acceptAppConfirm(page);
      await page.waitForTimeout(300);
    }

    // 复原成中文，后续用例看到的还是原来的界面
    await nav(/我的|Profile/);
    await page.locator('[data-testid="language-toggle"]').click();
    await page.waitForTimeout(300);

    if (found.length) {
      throw new Error(`${found.length} Chinese string(s) leaked in English mode: ${found.slice(0, 8).join(' | ')}`);
    }
    return 'no Chinese outside decorative seals';
  });

  // 防误结束拆场的另一半：选「继续这场」要把刚结束的那场接回工作台。
  // 放在最后，因为它会把一条记录的 finishedAt 清掉，改变后续用例看到的数据。
  await step(page, 'resume-recent-workout', async () => {
    await page.locator('nav button', { hasText: /个人记录|PR Hub|Dashboard/ }).click();
    await page.waitForTimeout(300);
    await page.getByRole('button', { name: /开始训练|Start Workout/ }).click();
    await clickAppConfirm(page, /^继续这场$|^Resume$/);
    await page.waitForSelector('text=/新建训练|New Workout/', { timeout: 5_000 });

    // 接回来的是那一场【本身】：动作还在
    const hasExercise = await page
      .locator('text=E2E Bench Press')
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
    }, finishedWorkoutId);
    if (!check.found) throw new Error(`resumed workout ${finishedWorkoutId} vanished from the snapshot`);
    if (check.finishedAt) throw new Error(`finishedAt not cleared on resume: ${check.finishedAt}`);
    return `resumed same record (${check.total} workouts), finishedAt cleared`;
  });

  await step(page, 'final-screenshot', async () => 'done');

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
  console.log(`\n== summary: ${report.steps.length - failed.length}/${report.steps.length} passed ==`);
  console.log(`   console.error count: ${report.consoleErrors.length}`);
  console.log(`   page errors: ${report.pageErrors.length}`);
  if (failed.length || report.consoleErrors.length || report.pageErrors.length) {
    process.exit(1);
  }
};

main().catch(err => {
  console.error('e2e crashed:', err);
  fs.writeFileSync(path.join(OUT, 'crash.txt'), String(err.stack || err));
  process.exit(1);
});
