#!/usr/bin/env node
/**
 * 字号阶梯守卫：全站只用 index.css 里 --fs-* 那九档（2026-10-22 界面审查）。
 *
 * 拦两种写法：
 *   - className 里手写的 text-[Npx]
 *   - CSS 里写死像素的 font-size（要写 var(--fs-…)）
 * 图形上的字（印章、片子数字、账本按列宽自适应的数字）确实不在阶梯上：
 * CSS 在同一行写注释「阶梯外：原因」放行；TSX 列在下面的 ALLOW 里。
 *
 * 用法：node scripts/type-scale-check.mjs
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// 文件 → 允许的手写字号。只给图形用。
const ALLOW = {

};

const files = [join(ROOT, 'App.tsx')];
const walk = d => {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.tsx?$/.test(e.name)) files.push(p);
  }
};
walk(join(ROOT, 'src'));

const bad = [];
for (const f of files) {
  const rel = relative(ROOT, f).replace(/\\/g, '/');
  const allow = ALLOW[rel] || [];
  readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
    for (const m of line.match(/\btext-\[[0-9.]+(px|rem|em)\]/g) || []) {
      if (!allow.includes(m)) bad.push(`${rel}:${i + 1}  ${m}`);
    }
  });
}
for (const css of ['index.css', 'plates.css']) {
  readFileSync(join(ROOT, css), 'utf8').split('\n').forEach((line, i) => {
    if (/font-size:\s*[0-9.]+(px|rem|em)/.test(line) && !line.includes('阶梯外')) {
      bad.push(`${css}:${i + 1}  ${line.trim()}`);
    }
  });
}

if (bad.length) {
  console.error('字号不在阶梯上（改用 text-micro / label / small / body / h2 / data-md / data-lg / headline / data-xl，或 var(--fs-…)）：');
  for (const b of bad) console.error('  ' + b);
  process.exit(1);
}
console.log('== 字号阶梯：通过 ==');
