#!/usr/bin/env node
/**
 * index.html 里两段启动脚本的自检（上架审查 startup-compat#1 / #4）：
 *   - #webview-gate：系统 WebView 太旧时拦下、给提示。它要在被拦的旧 WebView 上自己先跑得起来，所以只能是 ES5；
 *     每一项特性探测缺了都要拦，全有时不拦（误拦 = 所有人都打不开 App）。
 *   - #sw-control：原生容器里不注册 SW、把旧的注销和缓存清掉；浏览器里照常注册。
 * 在 node:vm 里搭假环境跑原文，不另抄一份逻辑。用法：node scripts/boot-check.mjs
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { transformSync } from 'esbuild';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
const scriptOf = id => {
  const m = new RegExp(`<script id="${id}">([\\s\\S]*?)</script>`).exec(html);
  assert.ok(m, `index.html 里找不到 <script id="${id}">`);
  return m[1];
};
const gate = scriptOf('webview-gate');
const sw = scriptOf('sw-control');

let n = 0;
const t = async (name, fn) => {
  await fn();
  n++;
  console.log(`  ✓ ${name}`);
};
console.log('boot-check');

await t('两段启动脚本只用 ES5：降到 es5 和原样输出一字不差（箭头函数、??、?.、模板串、let/const 都过不了）', () => {
  for (const [name, src] of [['webview-gate', gate], ['sw-control', sw]]) {
    const es5 = transformSync(src, { loader: 'js', target: 'es5' }).code;
    const same = transformSync(src, { loader: 'js', target: 'esnext' }).code;
    assert.equal(es5, same, `${name} 用了 ES5 以后的语法`);
  }
});

/** 跑一遍闸门：missing 是缺的那几项 */
function runGate(missing = []) {
  const attrs = {};
  const root = { innerHTML: '' };
  const cssOk = {
    'height|1dvh': 'dvh', 'container-type|inline-size': 'container', 'selector(:has(a))|': 'has', 'color|color-mix(in srgb, red, blue)': 'color-mix',
  };
  const ctx = {
    CSS: { supports: (p, v) => { const k = cssOk[`${p}|${v ?? ''}`]; return !!k && !missing.includes(k); } },
    navigator: { language: 'zh-CN', userAgent: 'Mozilla/5.0 Chrome/89.0 Mobile' },
    document: { documentElement: { setAttribute: (k, v) => { attrs[k] = v; } }, getElementById: id => (id === 'root' ? root : null) },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  // vm 里的内置对象是新的一套，删掉它们不影响本进程
  vm.runInContext(`
    ${missing.includes('at') ? 'delete Array.prototype.at;' : ''}
    ${missing.includes('hasOwn') ? 'delete Object.hasOwn;' : ''}
    ${missing.includes('structuredClone') ? '' : 'this.structuredClone = function (x) { return x; };'}
    ${missing.includes('nullish') ? 'this.Function = function (src) { if (/\\?\\?/.test(src)) throw new SyntaxError("??"); return function () {}; };' : ''}
  `, ctx);
  vm.runInContext(gate, ctx);
  return { blocked: attrs['data-webview-gate'] === 'blocked', notice: /data-webview-gate-notice/.test(root.innerHTML), html: root.innerHTML };
}

await t('闸门：八项特性全有时不拦；缺任何一项都拦下并给提示（带 Chrome 版本号）', () => {
  const ok = runGate();
  assert.deepEqual([ok.blocked, ok.notice], [false, false], '全有时误拦了 —— 所有人都会打不开 App');
  for (const miss of ['dvh', 'container', 'has', 'color-mix', 'at', 'structuredClone', 'hasOwn', 'nullish']) {
    const r = runGate([miss]);
    assert.ok(r.blocked && r.notice, `缺 ${miss} 没有拦`);
    assert.match(r.html, /Chrome 89/);
  }
});

/** 跑一遍 SW 开关 */
function runSw({ native, protocol = 'https:', caches = true }) {
  const calls = [];
  let onload = null;
  const reg = name => ({ unregister: () => calls.push(`unregister ${name}`) });
  const ctx = {
    navigator: {
      serviceWorker: {
        getRegistrations: () => Promise.resolve([reg('a'), reg('b')]),
        register: url => { calls.push(`register ${url}`); return Promise.resolve(); },
      },
    },
    location: { protocol },
    addEventListener: (e, fn) => { if (e === 'load') onload = fn; },
    console,
    ...(native ? { Capacitor: { isNativePlatform: () => true } } : {}),
    ...(caches ? { caches: { keys: () => Promise.resolve(['fitlog-v8', 'x']), delete: k => { calls.push(`delete ${k}`); return Promise.resolve(true); } } } : {}),
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(sw, ctx);
  return { calls, load: () => onload?.() };
}
const settle = () => new Promise(r => setTimeout(r, 0));

await t('SW 开关：原生里不注册、注销旧的并清缓存（没有 caches 也不抛）；浏览器 https 在 load 后注册；http 什么都不做', async () => {
  const a = runSw({ native: true });
  a.load();
  await settle();
  assert.deepEqual(a.calls.sort(), ['delete fitlog-v8', 'delete x', 'unregister a', 'unregister b']);
  const b = runSw({ native: true, caches: false });
  await settle();
  assert.deepEqual(b.calls.sort(), ['unregister a', 'unregister b']);
  const c = runSw({ native: false });
  assert.deepEqual(c.calls, []);
  c.load();
  await settle();
  assert.deepEqual(c.calls, ['register /sw.js']);
  const d = runSw({ native: false, protocol: 'http:' });
  d.load();
  await settle();
  assert.deepEqual(d.calls, []);
});

console.log(`\nboot-check: ${n} passed`);
