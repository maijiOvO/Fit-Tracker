/**
 * 锁屏回来 App 全灰：进 WebView 内部取证（CDP，只读）。
 *
 *   node scripts/phone-webview-probe.mjs
 *
 * 先跑 .\scripts\phone-gray-diag.ps1 抓系统侧证据，再跑这个。
 *
 * 前提：
 *   - 手机插线、开 USB 调试，App 进程还活着（别先清后台）。
 *   - App 是 debug / 测试包。Capacitor 只在 debug 构建里开 WebView 调试，正式签名包没有
 *     devtools socket，连不上是正常的，不是手机坏了 —— 脚本会把这一点明白地打出来。
 *   - Node 24（自带 fetch / WebSocket，不装依赖）。
 *
 * 硬约束（DevNotes/_memory/fitlog/phone-webview-cdp.md）：
 *   - 每次换一个新端口：上次用过的记在 test-artifacts/gray-probe-port.txt，从它 +1 起试。
 *   - 一个 target 只许一个 CDP 客户端：先 /json/list 带 8 秒超时判活，超时就不再试探针。
 *   - Runtime.evaluate 一律带 userGesture: true。
 *   - 每个 WebSocket 都关掉，结束前 adb forward --remove。
 *
 * 结论怎么读：
 *   - 有盖住 ≥60% 视口的 .bg-scrim（或装着它的满屏 fixed 元素）→ 偏向假设 A（遮罩残留）
 *   - /json/list 连不上、setTimeout(0) / rAF 回调迟迟不来 → 偏向假设 B（WebView 冻结 / 卡死）
 *
 * 退出码：0 探到了；1 环境问题；2 进程不在；3 连不上 CDP。
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const PKG = 'com.myron.fittracker';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'test-artifacts');
const PORT_FILE = path.join(OUT_DIR, 'gray-probe-port.txt');
const PORT_MIN = 9340;
const PORT_MAX = 9399;
const LIST_TIMEOUT_MS = 8000;
const EVAL_TIMEOUT_MS = 15000;
const ADB = path.join(process.env.LOCALAPPDATA ?? '', 'Android', 'Sdk', 'platform-tools', 'adb.exe');

function adb(...args) {
  return execFileSync(ADB, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function adbQuiet(...args) {
  try {
    return adb(...args);
  } catch {
    return '';
  }
}

const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*$/, '').replace('T', '-');

// ── adb / 设备 / 进程 ──────────────────────────────────────
if (!existsSync(ADB)) {
  console.error(`[X] 找不到 adb：${ADB}`);
  process.exit(1);
}
const devices = adbQuiet('devices').split('\n').filter((l) => /\tdevice$/.test(l));
if (devices.length === 0) {
  console.error('[X] 没有已连接的设备。插线，并在手机上点「允许 USB 调试」。');
  process.exit(1);
}
console.log(`[OK] 设备：${devices[0].trim()}`);

const pid = adbQuiet('shell', 'pidof', PKG);
if (!pid) {
  console.error(`[!] ${PKG} 进程不在 —— 已经被杀 / 被清后台，没有可探的 WebView。看 phone-gray-diag.ps1 的 logcat 是谁杀的。`);
  process.exit(2);
}
console.log(`[OK] 主进程 pid=${pid}`);

const wakefulness = adbQuiet('shell', 'dumpsys', 'power').split('\n').find((l) => l.includes('mWakefulness='))?.trim() ?? '';
console.log(`     ${wakefulness}`);
if (!/mWakefulness=Awake/.test(wakefulness)) {
  console.log('[!] 屏幕不是 Awake：WebView 本来就不画，此时探不到不代表卡死。先点亮屏幕再跑。');
}

// devtools socket 在不在，是「没开调试」和「开了但卡死」之间最直接的分水岭。
const socketName = `webview_devtools_remote_${pid}`;
const unixSockets = adbQuiet('shell', 'cat', '/proc/net/unix');
const hasSocket = unixSockets.includes(`@${socketName}`);
const otherSockets = [...unixSockets.matchAll(/@webview_devtools_remote_(\d+)/g)].map((m) => m[1]);
if (hasSocket) {
  console.log(`[OK] devtools socket 在：@${socketName}`);
} else {
  console.log(`[!] /proc/net/unix 里没有 @${socketName}${otherSockets.length ? `（有别的：${otherSockets.join(', ')}）` : ''}`);
  console.log('    这通常是正式签名包 —— Capacitor 只在 debug 构建开 WebView 调试。装测试包（build-apk.ps1 之外的 debug 包）才能用这条探针。');
}

// ── 端口：每次换新 ────────────────────────────────────────
mkdirSync(OUT_DIR, { recursive: true });
let lastPort = PORT_MIN - 1;
try {
  lastPort = Number.parseInt(readFileSync(PORT_FILE, 'utf8'), 10) || lastPort;
} catch {
  /* 第一次跑 */
}
const inUse = new Set(
  adbQuiet('forward', '--list')
    .split('\n')
    .map((l) => l.match(/tcp:(\d+)\s/)?.[1])
    .filter(Boolean)
    .map(Number),
);
let port = 0;
for (let i = 0; i < PORT_MAX - PORT_MIN + 1; i++) {
  const candidate = PORT_MIN + ((lastPort + 1 - PORT_MIN + i) % (PORT_MAX - PORT_MIN + 1));
  if (inUse.has(candidate)) continue;
  try {
    adb('forward', `tcp:${candidate}`, `localabstract:${socketName}`);
    port = candidate;
    break;
  } catch {
    /* 本机端口被占，下一个 */
  }
}
if (!port) {
  console.error(`[X] ${PORT_MIN}-${PORT_MAX} 都建不起 forward。adb forward --list 看看是不是堆满了，--remove-all 后重跑。`);
  process.exit(1);
}
writeFileSync(PORT_FILE, String(port));
console.log(`[OK] adb forward tcp:${port} -> localabstract:${socketName}`);

function removeForward() {
  adbQuiet('forward', '--remove', `tcp:${port}`);
}

// ── /json/list 判活 ────────────────────────────────────────
let targets;
try {
  const resp = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(LIST_TIMEOUT_MS) });
  targets = await resp.json();
} catch (err) {
  removeForward();
  console.log('');
  console.log(`[X] 连不上 CDP（/json/list ${LIST_TIMEOUT_MS / 1000} 秒内失败：${err.name} ${err.cause?.message ?? err.message}）。`);
  if (!hasSocket) {
    console.log('    手机上没有 devtools socket：这是正式包没开 WebView 调试，探针帮不上忙。');
    console.log('    想用这条探针，下次装 debug / 测试包复现。系统侧证据看 phone-gray-diag.ps1 的输出。');
  } else {
    console.log('    socket 在、却不回话：WebView 的浏览器进程不处理请求 —— 冻结或卡死。这本身就是假设 B 的证据。');
    console.log('    （若上面 mWakefulness 不是 Awake，先点亮屏幕重跑一次再下结论。）');
  }
  process.exit(3);
}
const page = targets.find((t) => t.type === 'page') ?? targets[0];
if (!page?.webSocketDebuggerUrl) {
  removeForward();
  console.log(`[X] /json/list 回了 ${targets.length} 个 target，但没有 page：${JSON.stringify(targets).slice(0, 300)}`);
  process.exit(3);
}
console.log(`[OK] target：${page.title || '(无标题)'}  ${page.url}`);

// ── 探针 ───────────────────────────────────────────────────
// 在页面里以异步 IIFE 跑，awaitPromise 拿到最终对象。
const PROBE = `(async () => {
  const t0 = performance.now();
  const timeoutDelayMs = await new Promise((r) => setTimeout(() => r(performance.now() - t0), 0));
  const r0 = performance.now();
  const rafDelayMs = await Promise.race([
    new Promise((r) => requestAnimationFrame(() => r(performance.now() - r0))),
    new Promise((r) => setTimeout(() => r(-1), 2000)),
  ]);
  const vw = window.innerWidth, vh = window.innerHeight, area = vw * vh;
  const cover = (el) => { const b = el.getBoundingClientRect(); return area ? (b.width * b.height) / area : 0; };
  const describe = (el, cs) => ({
    tagName: el.tagName,
    className: String(el.className).slice(0, 120),
    testid: el.dataset.testid ?? null,
    zIndex: cs.zIndex,
    opacity: cs.opacity,
    pointerEvents: cs.pointerEvents,
    display: cs.display,
    visibility: cs.visibility,
    background: cs.backgroundColor,
    coverage: Math.round(cover(el) * 100) / 100,
  });
  const bigFixed = [];
  for (const el of document.querySelectorAll('*')) {
    const cs = getComputedStyle(el);
    if (cs.position !== 'fixed') continue;
    if (cover(el) < 0.6) continue;
    bigFixed.push({ ...describe(el, cs), scrimInside: el.querySelector('.bg-scrim') !== null });
  }
  const scrims = [...document.querySelectorAll('.bg-scrim')].map((el) => {
    const cs = getComputedStyle(el);
    return { ...describe(el, cs), position: cs.position, parentTestid: el.parentElement?.dataset.testid ?? null };
  });
  return {
    href: location.href,
    readyState: document.readyState,
    visibilityState: document.visibilityState,
    hidden: document.hidden,
    fitlogBoot: document.documentElement.dataset.fitlogBoot ?? null,
    htmlClassName: document.documentElement.className,
    viewport: { w: vw, h: vh },
    dialogCount: document.querySelectorAll('[role=dialog]').length,
    scrimCount: scrims.length,
    scrims,
    bigFixed,
    rootChildren: document.getElementById('root')?.childElementCount ?? null,
    performanceNow: Math.round(performance.now()),
    serviceWorkerController: navigator.serviceWorker?.controller ? navigator.serviceWorker.controller.scriptURL : null,
    timeoutDelayMs: Math.round(timeoutDelayMs * 10) / 10,
    rafDelayMs: rafDelayMs < 0 ? null : Math.round(rafDelayMs * 10) / 10,
  };
})()`;

function evaluateOnPage(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let settled = false;
    const finish = (fn, v) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        /* 已经断了 */
      }
      fn(v);
    };
    const timer = setTimeout(() => finish(reject, new Error(`Runtime.evaluate ${EVAL_TIMEOUT_MS / 1000} 秒没回`)), EVAL_TIMEOUT_MS);
    ws.addEventListener('open', () => {
      ws.send(
        JSON.stringify({
          id: 1,
          method: 'Runtime.evaluate',
          params: { expression: PROBE, awaitPromise: true, returnByValue: true, userGesture: true },
        }),
      );
    });
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : String(ev.data));
      if (msg.id !== 1) return;
      if (msg.error) return finish(reject, new Error(`CDP 错误：${JSON.stringify(msg.error)}`));
      if (msg.result?.exceptionDetails) {
        return finish(reject, new Error(`页面内异常：${msg.result.exceptionDetails.text} ${msg.result.exceptionDetails.exception?.description ?? ''}`));
      }
      finish(resolve, msg.result?.result?.value);
    });
    ws.addEventListener('error', (ev) => finish(reject, new Error(`WebSocket 出错：${ev.message ?? ev.type}`)));
    ws.addEventListener('close', () => finish(reject, new Error('WebSocket 在拿到结果前被关掉')));
  });
}

let probe;
try {
  probe = await evaluateOnPage(page.webSocketDebuggerUrl);
} catch (err) {
  removeForward();
  console.log('');
  console.log(`[X] 探针没拿到结果：${err.message}`);
  console.log('    /json/list 通、页面却不执行 JS：主线程被堵死 / 渲染进程没了 —— 偏向假设 B。');
  process.exit(3);
}
removeForward();

// ── 输出与结论 ─────────────────────────────────────────────
const outFile = path.join(OUT_DIR, `gray-${stamp}-probe.json`);
writeFileSync(outFile, JSON.stringify({ pid, port, wakefulness, target: page, probe }, null, 2));

console.log('');
console.log('== 页面内部 ==');
const { scrims, bigFixed, ...flat } = probe;
for (const [k, v] of Object.entries(flat)) console.log(`  ${k}: ${JSON.stringify(v)}`);
console.log(`  .bg-scrim（${scrims.length}）：`);
for (const s of scrims) console.log(`    - ${JSON.stringify(s)}`);
console.log(`  满屏 fixed 元素（覆盖 ≥60% 视口，${bigFixed.length}）：`);
for (const f of bigFixed) console.log(`    - ${JSON.stringify(f)}`);
console.log(`  已存 ${outFile}`);

const coveringScrims = scrims.filter((s) => s.coverage >= 0.6 && Number(s.opacity) > 0 && s.visibility !== 'hidden' && s.display !== 'none');
const fixedWithScrim = bigFixed.filter((f) => f.scrimInside && Number(f.opacity) > 0 && f.display !== 'none');
const mainThreadSlow = probe.timeoutDelayMs > 200;
const noPaint = probe.rafDelayMs === null;

console.log('');
console.log('== 结论 ==');
if (coveringScrims.length || fixedWithScrim.length) {
  const who = [...coveringScrims, ...fixedWithScrim].map((e) => e.testid || e.className.split(' ').slice(0, 3).join(' ')).join('；');
  console.log(`  偏向假设 A（遮罩残留）：有 ${coveringScrims.length + fixedWithScrim.length} 层满屏遮罩还在 —— ${who}`);
  console.log('  按一下安卓返回键若能恢复，就是它。把 scrims / bigFixed 的 testid 发到对话里，能定位到哪个弹层没收。');
} else if (mainThreadSlow || noPaint) {
  console.log(`  偏向假设 B（WebView 没在画）：setTimeout(0) 实际延迟 ${probe.timeoutDelayMs} ms，rAF ${noPaint ? '2 秒内没回调' : `${probe.rafDelayMs} ms`}。`);
  console.log('  DOM 里没有残留遮罩，是渲染 / 主线程的问题。对照 phone-gray-diag.ps1 的 logcat 看 Render process / 冻结记录。');
} else {
  console.log('  DOM 和主线程都正常（无满屏遮罩、setTimeout / rAF 回调及时）。');
  console.log('  若屏幕此刻仍是灰的，问题在 WebView 合成 / 显示层（假设 B 的另一种形态：页面在跑、画面没刷到屏幕上）——重点看 logcat 里 chromium / cr_ 行。');
}
if (probe.visibilityState !== 'visible') {
  console.log(`  [!] visibilityState=${probe.visibilityState}：WebView 认为自己在后台，rAF / 动画会暂停。App 在前台却是这个值，就是锁屏回来没收到 resume。`);
}
