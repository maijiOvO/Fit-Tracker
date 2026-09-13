import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { createServer } from 'vite';

const root = process.argv[2] ?? 'dist';
assert.equal(JSON.parse(readFileSync(`${root}/fitlog-build-env.json`, 'utf8')).env, 'demo');
const inline = readFileSync(`${root}/index.html`, 'utf8').match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(inline, 'built HTML includes the pre-paint theme initializer');
for (const systemDark of [true, false]) {
  let dark = false, themeColor = '';
  runInNewContext(inline, {
    localStorage: { getItem: key => key === 'theme-pref' ? 'dark' : null },
    window: { matchMedia: () => ({ matches: systemDark }) },
    document: {
      documentElement: { classList: { add: name => { if (name === 'dark') dark = true; } }, setAttribute() {} },
      querySelector: () => ({ setAttribute: (_, value) => { themeColor = value; } }),
    },
  });
  assert.equal(dark, false, 'demo first paint ignores OS dark mode and unrelated stored preferences');
  assert.equal(themeColor, '#EFE9DC');
}
const server = await createServer({ mode: 'demo', optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true }, appType: 'custom' });
try {
  const stored = new Map();
  let dark = false;
  globalThis.localStorage = { getItem: key => stored.get(key) ?? null };
  globalThis.window = { matchMedia: () => ({ matches: true }) };
  globalThis.document = {
    documentElement: { classList: { toggle: (_, value) => { dark = value; } } },
    querySelector: () => ({ content: '' }),
  };
  const { applyThemeFromStorage } = await server.ssrLoadModule('/src/hooks/useTheme.ts');
  applyThemeFromStorage();
  assert.equal(dark, false, 'React-side default remains light on a dark system');
  stored.set('demo:theme-pref', 'dark');
  applyThemeFromStorage();
  assert.equal(dark, true, 'explicit in-session dark preference still works');
  stored.set('demo:theme-pref', 'auto');
  applyThemeFromStorage();
  assert.equal(dark, true, 'explicit system-following preference still works');
  stored.clear();
  applyThemeFromStorage();
  assert.equal(dark, false, 'a fresh demo starts light again');
  console.log('PASS: demo pre-paint and mounted defaults are light; explicit dark/auto still work.');
} finally { await server.close(); }
