// 手机排版摸底：4 宽 × 中英 × kg/lbs，五个界面，JS 探针查溢出/截断/热区/字号/重叠。
// 数据走 mock 后端（夹具），绝不连真实 NAS。跑 localhost:3000 的 dev server。
//   node scripts/layout-survey.mjs            → test-artifacts/layout-survey/{report.json, *.png}
//   WIDTHS=360 LANGS=cn UNITS=lbs node ...    → 只跑一个组合
// 重叠用文字本身的 Range 比，不用元素盒（数字溢出格子时元素盒还是格子大小）；
// 只比同一层（fixed/sticky/dialog 祖先相同）的元素，弹层盖页面不算。
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const BASE = 'http://localhost:3000';
const OUT = path.resolve(process.env.OUT || 'test-artifacts/layout-survey');
fs.mkdirSync(OUT, { recursive: true });
// 同 e2e：本机 Playwright 浏览器版本对不上时用 E2E_CHROMIUM 指过去
const EXE = process.env.E2E_CHROMIUM || undefined;
const WIDTHS = (process.env.WIDTHS || '360,384,393,412').split(',').map(Number);
const LANGS = (process.env.LANGS || 'cn,en').split(',');
const UNITS = (process.env.UNITS || 'kg,lbs').split(',');

// ---------- 夹具 ----------
const day = (n, h = 18) => { const d = new Date(); d.setDate(d.getDate() - n); d.setHours(h, 0, 0, 0); return d.toISOString(); };
let sid = 0;
const S = (weight, reps, extra = {}) => ({ id: `s${++sid}`, weight, reps, ...extra });
const ex = (name, bodyPart, sets, category = 'STRENGTH', tags = []) => ({ id: `e${++sid}`, name, bodyPart, category, tags, sets });
const finished = (n, title, exercises) => ({
  id: `w_fix_${n}`, userId: 'u_solo', date: day(n), startTime: day(n, 17), endTime: day(n), finishedAt: day(n),
  title, exercises, gym: n % 2 ? 'F4L' : '国内',
});
const workouts = [];
for (let i = 1; i <= 10; i++) {
  workouts.push(finished(i * 3, i % 2 ? '胸 + 三头' : '背 + 二头', i % 2 ? [
    ex('杠铃平板卧推', 'subChest', [S(100 + i, 8), S(102.5, 6, { toFailure: true }), S(97.5, 8, { subSets: [{ id: `sb${i}`, weight: 80, reps: 10 }] })]),
    ex('哑铃上斜卧推', 'subChest', [S(32.5, 10), S(32.5, 9)]),
    ex('肱三头肌下压', 'subArms', [S(40, 12), S(42.5, 10)]),
    ex('跑步机', 'subLegs', [{ id: `s${++sid}`, weight: 0, reps: 0, distance: 5.2, duration: 1860, speed: 10.1 }], 'CARDIO'),
  ] : [
    ex('高位下拉', 'subBack', [S(70, 10), S(75, 8)]),
    ex('坐姿器械单臂高位下拉（窄握对握）', 'subBack', [S(45, 12), S(47.5, 10)]),
    ex('杠铃弯举', 'subArms', [S(40, 10), S(42.5, 8)]),
  ]));
}
// 今天未结束的一场：点「开始训练」→「继续这场」进工作台
const today = {
  id: 'w_fix_today', userId: 'u_solo', date: day(0, 0), startTime: new Date(Date.now() - 50 * 60000).toISOString(),
  title: '胸 + 三头', exercises: [
    ex('杠铃平板卧推', 'subChest', [S(140, 5), S(142.5, 3, { toFailure: true }), S(137.5, 5, { subSets: [{ id: 'sbt1', weight: 115, reps: 8 }, { id: 'sbt2', weight: 92.5, reps: 10 }] }), S(140, 5, { ghost: true })]),
    ex('坐姿器械单臂高位下拉（窄握对握）', 'subBack', [S(45.36, 12), S(47.5, 10)]),
    ex('跑步机', 'subLegs', [{ id: 'ct1', weight: 0, reps: 0, distance: 12.35, duration: 4523, speed: 11.8 }], 'CARDIO'),
    ex('四指标测试动作', 'subLegs', [{ id: 'ct2', weight: 182.5, reps: 12, distance: 1.25, duration: 95 }]),
  ],
};
workouts.push(today);
const snapshot = {
  schemaVersion: 2, clientExportedAt: new Date().toISOString(), workouts,
  goals: [], weightLogs: [{ id: 'wl1', userId: 'u_solo', weight: 82.4, date: day(1), unit: 'kg' }], customMetrics: [], prs: [], scheduledWorkouts: [],
  prefs: {
    customTags: [], customExercises: [
      { id: 'c_narrow', name: { cn: '坐姿器械单臂高位下拉（窄握对握）', en: 'Seated Machine Single-Arm Lat Pulldown (Neutral Close Grip)' }, bodyPart: 'subBack', tags: ['tagMachine'], category: 'STRENGTH' },
      { id: 'c_four', name: { cn: '四指标测试动作', en: 'Four Metric Test Movement' }, bodyPart: 'subLegs', tags: [], category: 'STRENGTH' },
    ],
    exerciseNotes: {}, starredExercises: { '杠铃平板卧推': 1 }, starredLastUpdateMs: 1,
    exerciseMetricConfigs: { '跑步机': ['distance', 'duration', 'speed'], '四指标测试动作': ['weight', 'reps', 'distance', 'duration'] },
    metricsLastUpdateMs: 1, tagRenameOverrides: {}, exerciseOverrides: {}, prefsLastUpdateMs: 1,
  },
};

// ---------- 探针 ----------
function probe() {
  const vw = innerWidth;
  const vis = el => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity !== 0 && r.bottom > 0 && r.top < innerHeight; };
  const label = el => {
    const t = (el.getAttribute('aria-label') || el.innerText || el.value || el.getAttribute('placeholder') || '').replace(/\s+/g, ' ').trim().slice(0, 30);
    const cls = (typeof el.className === 'string' ? el.className : '').split(' ').filter(Boolean).slice(0, 3).join('.');
    return `${el.tagName.toLowerCase()}${cls ? '.' + cls : ''}「${t}」`;
  };
  const inHScroller = el => { for (let p = el.parentElement; p; p = p.parentElement) { const o = getComputedStyle(p).overflowX; if (o === 'auto' || o === 'scroll') return true; } return false; };
  const res = { docOverflow: document.documentElement.scrollWidth - vw, outOfViewport: [], truncated: [], inputClipped: [], smallTargets: [], tinyFont: [], overlaps: [] };
  const all = [...document.body.querySelectorAll('*')].filter(vis);
  for (const el of all) {
    const r = el.getBoundingClientRect();
    const clipped = (() => { for (let p = el.parentElement; p; p = p.parentElement) { if (getComputedStyle(p).overflowX !== 'visible') { const pr = p.getBoundingClientRect(); return r.left >= pr.right - 1 || r.right <= pr.left + 1; } } return false; })();
    if ((r.right > vw + 1 || r.left < -1) && !inHScroller(el) && !clipped && getComputedStyle(el).position !== 'fixed') res.outOfViewport.push(`${label(el)} [${Math.round(r.left)}..${Math.round(r.right)}]`);
    const cs = getComputedStyle(el);
    if ((cs.textOverflow === 'ellipsis' || cs.webkitLineClamp !== 'none' && cs.webkitLineClamp) && (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1)) res.truncated.push(label(el));
    if (el.tagName === 'INPUT' && el.value && el.scrollWidth > el.clientWidth + 1) res.inputClipped.push(`${label(el)} ${el.scrollWidth}>${el.clientWidth}`);
    if (el.matches('button,a[href],input,select,textarea,[role=button],[role=tab],[role=menuitem],label') && !el.closest('[aria-hidden=true]')) {
      if (r.width < 44 || r.height < 44) {
        // 热区可能由父级补足（label 包着 input 等）：父级是可交互元素且够大就不算
        const p = el.parentElement?.closest('button,a[href],[role=button],label');
        const pr = p?.getBoundingClientRect();
        if (!(pr && pr.width >= 44 && pr.height >= 44)) res.smallTargets.push(`${label(el)} ${Math.round(r.width)}×${Math.round(r.height)}`);
      }
    }
    const direct = [...el.childNodes].some(n => n.nodeType === 3 && n.nodeValue.trim());
    if (direct && parseFloat(cs.fontSize) < 11) res.tinyFont.push(`${label(el)} ${cs.fontSize}`);
  }
  // 重叠：有直接文字的叶子元素两两比较（同屏可见）
  const leaves = all.filter(el => [...el.childNodes].some(n => n.nodeType === 3 && n.nodeValue.trim()) || el.tagName === 'INPUT');
  // 层：最近的 fixed/sticky 祖先或弹层根。不同层之间的覆盖是设计如此（弹层盖页面、吸顶盖内容）
  const layerOf = el => { for (let p = el; p; p = p.parentElement) { const pos = getComputedStyle(p).position; if (pos === 'fixed' || pos === 'sticky' || p.getAttribute?.('role') === 'dialog') return p; } return document.body; };
  // 用文字本身的范围（Range）而不是元素盒：数字溢出格子时元素盒还是格子大小
  const inkRect = el => {
    if (el.tagName === 'INPUT') return el.getBoundingClientRect();
    const rg = document.createRange(); let box = null;
    for (const n of el.childNodes) if (n.nodeType === 3 && n.nodeValue.trim()) {
      rg.selectNodeContents(n); const q = rg.getBoundingClientRect();
      box = box ? { left: Math.min(box.left, q.left), right: Math.max(box.right, q.right), top: Math.min(box.top, q.top), bottom: Math.max(box.bottom, q.bottom) } : { left: q.left, right: q.right, top: q.top, bottom: q.bottom };
    }
    return box || el.getBoundingClientRect();
  };
  res.spills = [];
  for (const el of leaves) {
    if (el.tagName === 'INPUT') continue;
    const cs = getComputedStyle(el); if (cs.overflowX !== 'visible' || cs.textOverflow === 'ellipsis') continue;
    const b = el.getBoundingClientRect(), k = inkRect(el);
    if (k.left < b.left - 2 || k.right > b.right + 2) res.spills.push(`${label(el)} ink ${Math.round(k.right - k.left)} > box ${Math.round(b.width)}`);
  }
  const rects = leaves.map(el => [el, inkRect(el), layerOf(el)]);
  for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
    const [a, ra, la] = rects[i], [b, rb, lb] = rects[j];
    if (la !== lb || a.contains(b) || b.contains(a)) continue;
    const w = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
    const h = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
    if (w > 2 && h > 2) {
      // 只算处于同一层叠位置的（排除弹层盖在页面上）
      const top = document.elementFromPoint(Math.max(ra.left, rb.left) + w / 2, Math.max(ra.top, rb.top) + h / 2);
      if (top && (a.contains(top) || b.contains(top) || top === a || top === b)) {
        const other = (a.contains(top) || top === a) ? b : a;
        const cover = getComputedStyle(other);
        if (cover.visibility !== 'hidden') res.overlaps.push(`${label(a)} ⨯ ${label(b)} ${Math.round(w)}×${Math.round(h)}`);
      }
    }
  }
  for (const k of Object.keys(res)) if (Array.isArray(res[k])) res[k] = [...new Set(res[k])];
  return res;
}

// ---------- 走查 ----------
const browser = await chromium.launch({ headless: true, executablePath: EXE });
const report = {};
for (const lang of LANGS) for (const unit of UNITS) for (const w of WIDTHS) {
  const key = `${w}-${lang}-${unit}`;
  const ctx = await browser.newContext({ viewport: { width: w, height: 820 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'zh-CN' });
  // Playwright 按注册倒序匹配：兜底 abort 必须先注册
  await ctx.route(/^https:\/\/hometj\./, r => r.abort());
  await ctx.route(/\/api\/fitlog\/state.*/, r => r.request().method() === 'GET'
    ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(snapshot) })
    : r.fulfill({ status: 200, body: 'ok' }));
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.addInitScript(([lang, unit]) => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.clear();
    for (const p of ['', 'dev:']) { localStorage.setItem(p + 'fitlog_lang', lang); localStorage.setItem(p + 'fitlog_unit', unit); }
  }, [lang, unit]);
  const out = {};
  const snap = async name => {
    await page.waitForTimeout(500);
    out[name] = await page.evaluate(probe);
    await page.screenshot({ path: path.join(OUT, `${key}-${name}.png`), fullPage: false });
  };
  try {
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('nav button', { timeout: 15000 });
    await page.waitForTimeout(2500); // 远端拉取 + 合并
    await snap('dashboard');
    await page.mouse.wheel(0, 900); await snap('dashboard-scrolled');
    await page.locator('nav button', { hasText: /训练计划|Plan/ }).click(); await snap('plan');
    await page.locator('nav button', { hasText: /我的|Profile/ }).click(); await snap('profile');
    await page.locator('nav button', { hasText: /个人记录|PR Hub|Dashboard/ }).click();
    await page.waitForTimeout(300);
    const card = page.locator('[data-testid="timeline-session-w_fix_today"]');
    await card.scrollIntoViewIfNeeded();
    const box = await card.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down(); await page.waitForTimeout(750); await page.mouse.up();
    await page.waitForTimeout(450);
    await page.locator('[data-testid="timeline-session-menu"]').getByRole('menuitem').first().click();
    await page.waitForSelector('.ledger-row', { timeout: 6000 });
    await snap('workout');
    await page.mouse.wheel(0, 700); await snap('workout-scrolled');
    await page.mouse.wheel(0, 1400); await snap('workout-bottom');
    await page.locator('[data-testid="open-picker-sheet"]').click();
    await page.waitForTimeout(500);
    await page.locator('[data-testid="picker-sheet"]').getByRole('button', { name: /^(胸部|Chest)$/ }).first().click().catch(() => {});
    await snap('picker');
  } catch (e) {
    out.error = String(e).slice(0, 300);
  }
  out.pageErrors = errs;
  report[key] = out;
  console.log(key, out.error ? 'ERR ' + out.error : 'ok');
  await ctx.close();
}
await browser.close();
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
console.log('→', OUT);
