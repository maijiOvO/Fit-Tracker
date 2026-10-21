#!/usr/bin/env node
/**
 * prefs 读 / 写 / 合并的自检（services/fitlogRemote.ts、services/appPrefs.ts）。
 *
 * prefs 的同步是逐 key 枚举的：readPrefsFromLocalStorage / writePrefsToLocalStorage / mergeFitlogPrefs 三处，
 * 漏掉一处就在同步时静默丢数据，e2e 摸不到（假的成功信号：全绿 ≠ 测到了）。
 * 这里用 esbuild 把模块打成临时 ESM，配一个内存版 localStorage 直接跑断言。
 * 哨兵在 scripts/prefsSentinel.ts（tsc 保证每个 key 都填了）。
 *
 * 用法：node scripts/prefs-check.mjs
 */
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = mkdtempSync(join(tmpdir(), 'prefs-check-'));
const out = join(dir, 'prefs.mjs');
await build({
  stdin: {
    contents: [
      "export * from './services/fitlogRemote.ts';",
      "export * from './services/appPrefs.ts';",
      "export * from './scripts/prefsSentinel.ts';",
    ].join('\n'),
    resolveDir: ROOT,
    loader: 'ts',
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: out,
  logLevel: 'silent',
  // 模块顶层读 import.meta.env（API 地址、构建模式）；这里只测纯逻辑，给空的
  define: { 'import.meta.env': '{}' },
});

/** 内存版 localStorage（appStorage 走的就是全局 localStorage） */
const mem = new Map();
globalThis.localStorage = {
  getItem: k => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: k => mem.delete(k),
  clear: () => mem.clear(),
  key: i => [...mem.keys()][i] ?? null,
  get length() {
    return mem.size;
  },
};

const P = await import(pathToFileURL(out).href);
rmSync(dir, { recursive: true, force: true });

let n = 0;
const t = (name, fn) => {
  mem.clear();
  fn();
  n++;
  console.log(`  ✓ ${name}`);
};

const S = P.PREFS_SENTINEL;
const skip = new Set(Object.keys(P.NOT_ROUND_TRIPPED));
const without = obj => Object.fromEntries(Object.entries(obj).filter(([k]) => !skip.has(k)));
/** 一份「空的」本机 prefs：没打过任何时间戳 */
const empty = () => P.readPrefsFromLocalStorage();

console.log('prefs-check');

t('每个 key 写进本机再读回来，原样不变', () => {
  P.writePrefsToLocalStorage(S);
  assert.deepEqual(without(P.readPrefsFromLocalStorage()), without(S));
});

t('跟一份空的合并（本机是哨兵）：每个 key 原样留下', () => {
  P.writePrefsToLocalStorage(S);
  const local = P.readPrefsFromLocalStorage();
  mem.clear();
  assert.deepEqual(without(P.mergeFitlogPrefs(local, empty())), without(S));
});

t('跟一份空的合并（远端是哨兵）：每个 key 都拿到', () => {
  assert.deepEqual(without(P.mergeFitlogPrefs(empty(), S)), without(S));
});

t('单位：本机刚切过（appPrefs 新），远端整块 prefs 更新但 appPrefs 旧 —— 不被翻回去', () => {
  const local = { ...empty(), unit: 'kg', prefsLastUpdateMs: 100, appPrefs: { unit: 'kg' }, appPrefsUpdatedMs: 900 };
  const remote = { ...empty(), unit: 'lbs', prefsLastUpdateMs: 500, appPrefs: { unit: 'lbs' }, appPrefsUpdatedMs: 300 };
  const m = P.mergeFitlogPrefs(local, remote);
  assert.equal(m.unit, 'kg');
  assert.equal(m.appPrefs.unit, 'kg');
  assert.equal(m.appPrefsUpdatedMs, 900);
});

t('单位：远端是没升级的设备（没有 appPrefs），本机切过 —— 本机赢', () => {
  const local = { ...empty(), unit: 'kg', prefsLastUpdateMs: 100, appPrefs: { unit: 'kg' }, appPrefsUpdatedMs: 900 };
  const remote = { ...empty(), unit: 'lbs', lang: 'en', prefsLastUpdateMs: 5000 };
  const m = P.mergeFitlogPrefs(local, remote);
  assert.equal(m.unit, 'kg');
  // 本机 appPrefs 里没有的字段（语言）照旧口径：整块 prefs 远端新，用远端的
  assert.equal(m.lang, 'en');
});

t('单位：另一台设备后切的（远端 appPrefs 新）—— 远端赢', () => {
  const local = { ...empty(), unit: 'kg', appPrefs: { unit: 'kg', lang: 'cn' }, appPrefsUpdatedMs: 300 };
  const remote = { ...empty(), unit: 'lbs', appPrefs: { unit: 'lbs' }, appPrefsUpdatedMs: 900 };
  const m = P.mergeFitlogPrefs(local, remote);
  assert.equal(m.unit, 'lbs');
  // 远端对象里没有的字段用本机的补
  assert.equal(m.appPrefs.lang, 'cn');
});

t('两边都没有 appPrefs：单位 / 语言按旧口径（整块 prefs 的时间戳）', () => {
  const m = P.mergeFitlogPrefs(
    { ...empty(), unit: 'kg', prefsLastUpdateMs: 100 },
    { ...empty(), unit: 'lbs', prefsLastUpdateMs: 200 },
  );
  assert.equal(m.unit, 'lbs');
  assert.equal(m.appPrefs, undefined);
});

t('合并后的 prefsLastUpdateMs 写回本机（原先不写，本机一旦落后就永远输）', () => {
  const m = P.mergeFitlogPrefs({ ...empty(), prefsLastUpdateMs: 100 }, { ...empty(), prefsLastUpdateMs: 700 });
  P.writePrefsToLocalStorage(m);
  assert.equal(P.readPrefsFromLocalStorage().prefsLastUpdateMs, 700);
});

t('recordAppPrefs：并进已有对象、打新时间戳', () => {
  P.writeAppPrefs({ unit: 'kg', lang: 'cn' }, 5);
  P.recordAppPrefs({ unit: 'lbs' });
  const r = P.readAppPrefs();
  assert.deepEqual(r.appPrefs, { unit: 'lbs', lang: 'cn' });
  assert.ok(r.appPrefsUpdatedMs > 5);
});

t('器械形式 / 本馆备注按键合并：另一台设备只是后切了单位，不会用旧表盖掉这边新设的', () => {
  const local = { unit: 'kg', gymKinds: { 'A|leg_press|': 'pin' }, gymNotes: { 'A|leg_press|': '凳子 3' } };
  const remote = { unit: 'lbs', gymNotes: { 'B|leg_press|': '挂钩 5' } };
  const m = P.mergeAppPrefs(local, 100, remote, 200);
  assert.equal(m.appPrefs.unit, 'lbs');
  assert.deepEqual(m.appPrefs.gymKinds, { 'A|leg_press|': 'pin' });
  assert.deepEqual(m.appPrefs.gymNotes, { 'A|leg_press|': '凳子 3', 'B|leg_press|': '挂钩 5' });
});

t('器械形式 / 本馆备注删除写墓碑：新的一边删了，旧的一边的值不复活；读出来当作没有', () => {
  const older = { gymKinds: { 'A|x|': 'loaded' }, gymNotes: { 'A|x|': '旧备注' } };
  const newer = { gymKinds: { 'A|x|': '' }, gymNotes: { 'A|x|': '' } };
  const m = P.mergeAppPrefs(newer, 300, older, 100);
  assert.deepEqual(m.appPrefs.gymKinds, { 'A|x|': '' });
  const r = P.resolveAppPrefs(m.appPrefs);
  assert.deepEqual(r.gymKinds, {});
  assert.deepEqual(r.gymNotes, {});
});

t('keyedPatch：在存储里的原表上改（保留墓碑）；原来没有的键删除时不写墓碑', () => {
  P.writeAppPrefs({ gymNotes: { 'A|x|': '', 'A|y|': '留着' } }, 5);
  assert.deepEqual(P.keyedPatch('gymNotes', 'A|z|', '新的'), { gymNotes: { 'A|x|': '', 'A|y|': '留着', 'A|z|': '新的' } });
  assert.deepEqual(P.keyedPatch('gymNotes', 'B|q|', ''), { gymNotes: { 'A|x|': '', 'A|y|': '留着' } });
  assert.deepEqual(P.keyedPatch('gymNotes', 'A|y|', ''), { gymNotes: { 'A|x|': '', 'A|y|': '' } });
});

console.log(`== ${n} passed ==`);
