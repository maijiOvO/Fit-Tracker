// 构建产物对照：两棵树各跑 vite build --minify false，归一化文件名 / 内容里的哈希后逐文件 diff。
// 用法：node scripts/diff/build-diff.mjs <treeA> <treeB> [--out dir]
// 直接调 vite，不走 npm run build —— 避免 build:fonts 在有 fonts/ 源的主仓里重切字体。
// 两棵树的 .env.local 要一致（VITE_* 会被烙进产物），否则差异全是环境变量。
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, parseArgs, tree, outDir } from './_paths.mjs';

const { pos: [a, b], opts } = parseArgs(process.argv.slice(2), { positional: 2, usage: 'usage: node scripts/diff/build-diff.mjs <treeA> <treeB> [--out dir]', flags: { out: '' } });
const outRoot = outDir('build', opts.out);

function build(t, out) {
  fs.rmSync(out, { recursive: true, force: true });
  // 工作树没装依赖时退回仓库根的 vite（bare import 会沿目录向上找到主仓的 node_modules）
  const vite = [t, ROOT].map(r => path.join(r, 'node_modules', 'vite', 'bin', 'vite.js')).find(fs.existsSync);
  if (!vite) { console.error('找不到 vite：先 npm ci'); process.exit(2); }
  execFileSync(process.execPath, [vite, 'build', '--minify', 'false', '--outDir', out, '--emptyOutDir', '--logLevel', 'warn'], { cwd: t, stdio: 'inherit' });
}

const HASH = /-[A-Za-z0-9_-]{8}(?=\.(js|css|woff2|png|svg|json)\b)/g;
const norm = (s) => s.replace(HASH, '-HASH');

// 同名不同哈希的 chunk（几个 Capacitor 插件都叫 web-*.js）归一化后会撞名，所以按名字分组、组内先配对相同内容，剩下的才算差异
function collect(dir) {
  const out = new Map(); // normName -> [text]
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else {
        const rel = norm(path.relative(dir, p).replace(/\\/g, '/'));
        const buf = fs.readFileSync(p);
        const text = /\.(js|css|html|json|txt|svg)$/.test(rel) ? norm(buf.toString('utf8')) : buf.toString('base64');
        if (!out.has(rel)) out.set(rel, []);
        out.get(rel).push(text);
      }
    }
  };
  walk(dir);
  return out;
}

const outA = path.join(outRoot, 'A'), outB = path.join(outRoot, 'B');
fs.mkdirSync(outRoot, { recursive: true });
for (const f of fs.readdirSync(outRoot)) if (/\.(A|B)\.txt$/.test(f)) fs.rmSync(path.join(outRoot, f));
build(tree(a), outA);
build(tree(b), outB);
const A = collect(outA), B = collect(outB);
let diffs = 0, total = 0;
for (const k of new Set([...A.keys(), ...B.keys()])) {
  const la = [...(A.get(k) ?? [])], lb = [...(B.get(k) ?? [])];
  total += Math.max(la.length, lb.length);
  // 先配对完全相同的
  for (let i = la.length - 1; i >= 0; i--) { const j = lb.indexOf(la[i]); if (j >= 0) { la.splice(i, 1); lb.splice(j, 1); } }
  // 剩下的按长度最接近配对，当成「同一个文件改了」
  while (la.length && lb.length) {
    const ta = la.shift();
    let bi = 0, best = Infinity;
    lb.forEach((t, i) => { const d = Math.abs(t.length - ta.length); if (d < best) { best = d; bi = i; } });
    const tb = lb.splice(bi, 1)[0];
    diffs++;
    const xa = ta.split('\n'), xb = tb.split('\n');
    let changed = 0;
    for (let i = 0; i < Math.max(xa.length, xb.length); i++) if (xa[i] !== xb[i]) changed++;
    const tag = `${k.replace(/[\/]/g, '__')}.${diffs}`;
    console.log(`~ differs: ${k}  (${xa.length} vs ${xb.length} lines, ~${changed} lines differ) → ${tag}.{A,B}.txt`);
    fs.writeFileSync(path.join(outRoot, `${tag}.A.txt`), ta);
    fs.writeFileSync(path.join(outRoot, `${tag}.B.txt`), tb);
  }
  for (const t of la) { diffs++; console.log(`- only in A: ${k} (${t.split('\n').length} lines)`); }
  for (const t of lb) { diffs++; console.log(`+ only in B: ${k} (${t.split('\n').length} lines)`); }
}
console.log(diffs === 0 ? `== 产物逐字节相同（${total} 个文件）==` : `== ${diffs} 个文件有差异，两版已落到 ${outRoot} 供 diff，净变化看 net-diff ==`);
process.exit(diffs === 0 ? 0 : 1);
