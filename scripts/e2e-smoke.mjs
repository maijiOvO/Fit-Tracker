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
    .filter({ hasText: /^(确定|OK|保存|Save|Delete|删除)$/ })
    .last()
    .click();
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
  // 后端地址由 E2E_API_BASE / .env.local 的 VITE_API_URL 决定，默认同 DEFAULT_API_BASE_URL。
  // 这里只拦截请求，不真正连服务器，所以跑 e2e 不需要连 Tailscale。
  const apiHostPattern = new RegExp(`^${escapeRe(API_BASE)}(:\\d+)?/api/fitlog/state.*`);
  // Mock assistant chat (OpenAI-compatible SSE)
  let assistantChatCalls = 0;
  let assistantCreatedScheduleId = null;
  const assistantChatPattern = new RegExp(`^${escapeRe(API_BASE)}(:\\d+)?/api/chat.*`);
  await context.route(assistantChatPattern, async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    assistantChatCalls++;
    if (assistantChatCalls === 1) {
      const d = new Date();
      d.setDate(d.getDate() + 5);
      const dateStr = d.toISOString().slice(0, 10);
      const toolArgs = JSON.stringify({
        date: dateStr,
        title: 'E2E Assistant Plan',
        bodyParts: ['subChest'],
        exercises: [
          {
            name: 'E2E Assistant Press',
            category: 'STRENGTH',
            bodyPart: 'subChest',
            targetSets: 3,
            targetReps: 8,
          },
        ],
      });
      const sseLines = [
        `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: '安排中…' }, finish_reason: null }] })}`,
        `data: ${JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_e2e_assist', type: 'function', function: { name: 'create_schedule', arguments: '' } }] }, finish_reason: null }] })}`,
        `data: ${JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: toolArgs } }] }, finish_reason: 'tool_calls' }] })}`,
        'data: [DONE]',
        '',
      ].join('\n\n');
      return route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
        body: sseLines,
      });
    }
    const sseLines = [
      `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: '计划已写入日程。' }, finish_reason: 'stop' }] })}`,
      'data: [DONE]',
      '',
    ].join('\n\n');
    return route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
      body: sseLines,
    });
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
        pref: localStorage.getItem('theme-pref'),
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
        pref: localStorage.getItem('theme-pref'),
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
    const pref = await page.evaluate(() => localStorage.getItem('theme-pref'));
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
    // Library overlay should appear at z-100 above editor
    const lib = page.locator('div.fixed.inset-0.z-\\[100\\]');
    await lib.waitFor({ state: 'visible', timeout: 5_000 });

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

  // Plan completion confirmation: start session → save → choose "有调整" → workout
  // record receives fromSchedule.faithful=false and remote PUT carries it.
  await step(page, 'plan-confirm-modified', async () => {
    // Re-enter Plan tab and start the session again
    await page.locator('[data-testid="tab-plan"]').click();
    await page.waitForTimeout(300);
    await page.locator('[data-testid="plan-subview-schedule"]').click();
    await page.waitForTimeout(200);
    const startBtn = page.locator(`[data-testid="schedule-start-${createdScheduleId}"]`);
    await startBtn.click();
    await page.waitForSelector('text=/新建训练|New Workout/', { timeout: 5_000 });
    // Click "Save Workout" — unit confirm (UiOverlay), then plan-confirm modal
    await page.getByRole('button', { name: /^保存$|^Save$/ }).first().click();
    await acceptAppConfirm(page);
    // Plan confirm modal should appear
    await page.locator('[data-testid="plan-confirm-modified"]').waitFor({ state: 'visible', timeout: 5_000 });
    await page.locator('[data-testid="plan-confirm-modified"]').click();
    // After save it goes back to dashboard within 2s
    await page.waitForTimeout(2500);

    // Force a remote push then GET, verify fromSchedule.faithful=false in the saved workout
    const verify = await page.evaluate(async (id) => {
      await window.__fitlog.flush();
      const snap = await window.__fitlog.fetchRemote();
      if (!snap) return { ok: false, reason: 'snap null' };
      const w = (snap.workouts || []).find(w => w.fromSchedule?.scheduleId === id);
      if (!w) return { ok: false, reason: 'no workout linked to schedule' };
      return { ok: w.fromSchedule.faithful === false, faithful: w.fromSchedule.faithful };
    }, createdScheduleId);
    if (!verify.ok) throw new Error(`fromSchedule check failed: ${JSON.stringify(verify)}`);
    return `fromSchedule.faithful=${verify.faithful} persisted to remote`;
  });

  await step(page, 'plan-switch-to-goals', async () => {
    // After plan-confirm-modified we landed back on dashboard — return to Plan first
    await page.locator('[data-testid="tab-plan"]').click();
    await page.waitForTimeout(300);
    await page.locator('[data-testid="plan-subview-goals"]').click();
    await page.waitForTimeout(200);
    const selected = await page.locator('[data-testid="plan-subview-goals"]').getAttribute('aria-selected');
    if (selected !== 'true') throw new Error('goals sub-view not active');
    return 'goals sub-view active';
  });

  // === Smart assistant ===
  await step(page, 'goto-assistant', async () => {
    await page.locator('[data-testid="tab-assistant"]').click();
    await page.waitForTimeout(400);
    await page.locator('[data-testid="assistant-chat-panel"]').waitFor({ state: 'visible', timeout: 5_000 });
    return 'assistant tab open';
  });

  await step(page, 'assistant-mock-chat', async () => {
    const input = page.locator('[data-testid="assistant-input"]');
    await input.fill('帮我在五天后安排一次推日训练');
    await page.locator('[data-testid="assistant-send"]').click();
    await page.locator('[data-testid="assistant-toolcall-create_schedule"]').waitFor({ state: 'visible', timeout: 15_000 });
    await page.locator('[data-testid="assistant-toolcall-create_schedule"][data-toolcall-status="executed"]').waitFor({
      state: 'visible',
      timeout: 15_000,
    });
    if (assistantChatCalls < 1) throw new Error('assistant chat mock was not called');
    return `mock chat calls=${assistantChatCalls}`;
  });

  await step(page, 'assistant-remote-save', async () => {
    const flushed = await page.evaluate(async () => {
      await window.__fitlog.flush();
      return window.__fitlog.fetchRemote();
    });
    if (!flushed) throw new Error('remote snapshot null after assistant');
    const schedules = flushed.scheduledWorkouts || [];
    const found = schedules.find(s => s.title === 'E2E Assistant Plan');
    if (!found) throw new Error(`assistant schedule not in remote PUT (count=${schedules.length})`);
    assistantCreatedScheduleId = found.id;
    const convs = flushed.assistantConversations || [];
    if (!convs.length) throw new Error('assistantConversations missing from remote snapshot');
    return `schedule=${found.id}, convs=${convs.length}`;
  });

  await step(page, 'assistant-rename-conversation', async () => {
    await page.locator('[aria-label="open-sidebar"]').click();
    await page.locator('[data-testid="assistant-sidebar"]').waitFor({ state: 'visible' });
    await page.locator('[data-testid="assistant-rename-btn"]').first().click({ force: true });
    await page.locator('[data-testid="assistant-rename-input"]').fill('E2E 助手对话');
    await page.locator('[aria-label="rename-confirm"]').click();
    await page.waitForTimeout(400);
    const title = await page.locator('[data-testid="assistant-active-title"]').textContent();
    if (!title?.includes('E2E')) throw new Error(`rename failed: ${title}`);
    await page.evaluate(async () => { await window.__fitlog.flush(); });
    const snap = await page.evaluate(async () => window.__fitlog.fetchRemote());
    const conv = (snap?.assistantConversations || []).find(c => c.title?.includes('E2E'));
    if (!conv) throw new Error('renamed conversation not in remote snapshot');
    return `title=${conv.title}`;
  });

  await step(page, 'assistant-delete-conversation', async () => {
    const sidebarOpen = await page.locator('[data-testid="assistant-sidebar"]').isVisible().catch(() => false);
    if (!sidebarOpen) {
      await page.locator('[aria-label="open-sidebar"]').click();
      await page.locator('[data-testid="assistant-sidebar"]').waitFor({ state: 'visible' });
    }
    await page.locator('[data-testid="assistant-delete-btn"]').first().click({ force: true });
    await acceptAppConfirm(page);
    await page.waitForTimeout(500);
    await page.evaluate(async () => { await window.__fitlog.flush(); });
    const snap = await page.evaluate(async () => window.__fitlog.fetchRemote());
    const convs = snap?.assistantConversations || [];
    const tomb = snap?.tombstones?.assistantConversations || [];
    if (convs.length > 0 && !tomb.length) {
      throw new Error(`conversation still in snapshot after delete (convs=${convs.length})`);
    }
    return `remote convs=${convs.length}, tombstones=${tomb.length}`;
  });

  await step(page, 'assistant-close-sidebar', async () => {
    const close = page.locator('[aria-label="close-sidebar"]');
    if (await close.isVisible().catch(() => false)) {
      await close.click();
      await page.waitForTimeout(200);
    }
    return 'sidebar closed if open';
  });

  await step(page, 'goto-dashboard', async () => {
    await page.locator('nav button', { hasText: /个人记录|PR Hub|Dashboard/ }).click();
    await page.waitForTimeout(400);
    return 'dashboard tab open';
  });

  await step(page, 'open-workout-via-fab', async () => {
    await page.getByRole('button', { name: /开始训练|Start Workout/ }).click();
    await page.waitForSelector('text=/新建训练|New Workout/', { timeout: 5_000 });
    return 'new-workout view shown';
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
    // NewWorkoutTab 内嵌 ExercisePicker：点分类 chip 后应出现动作卡片
    await page.getByRole('button', { name: /力量训练|Strength/ }).first().click();
    await page.locator('[data-testid="library-exercise-card"]').first().waitFor({
      state: 'visible',
      timeout: 5_000,
    });
    return 'embedded exercise picker visible';
  });

  await step(page, 'close-library', async () => {
    // 内嵌选择器无需关闭全屏 library；切回「全部」分类即可
    await page.getByRole('button', { name: /全部|All/ }).first().click();
    await page.waitForTimeout(200);
    return 'picker category reset';
  });

  await step(page, 'back-to-tab-from-empty-workout', async () => {
    await page.getByRole('button', { name: /^返回$|^Back$/ }).click();
    // No confirm because the workout is empty.
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

  await step(page, 'final-screenshot', async () => 'done');

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
