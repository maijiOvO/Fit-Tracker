// 字体子集核算：复刻 scripts/build-fonts.mjs 的 CJK 收集范围，比两棵树的字符集。
// A 有 B 没有的字就是「删掉后会从子集里消失」的字 —— 产物里还引用它的话真机上会变成豆腐块。
// 用法：node scripts/diff/charset-diff.mjs <treeA> <treeB>
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs, tree } from './_paths.mjs';

const { pos: [A, B] } = parseArgs(process.argv.slice(2), { positional: 2, usage: 'usage: node scripts/diff/charset-diff.mjs <treeA> <treeB>' });
const SCAN_EXT = new Set(['.ts', '.tsx', '.html']);
const SCAN_DIRS = ['src', 'services'];
const SCAN_FILES = ['translations.ts', 'types.ts', 'App.tsx', 'index.tsx', 'index.html'];
const isCjk = cp => (cp >= 0x4e00 && cp <= 0x9fff) || (cp >= 0x3400 && cp <= 0x4dbf) || (cp >= 0x3000 && cp <= 0x303f) || (cp >= 0xff00 && cp <= 0xffef) || (cp >= 0x2000 && cp <= 0x206f);
function walk(dir, acc = []) { for (const n of readdirSync(dir)) { const p = join(dir, n); if (statSync(p).isDirectory()) walk(p, acc); else if (SCAN_EXT.has(n.slice(n.lastIndexOf('.')))) acc.push(p); } return acc; }
function charset(root) {
  const files = [...SCAN_FILES.map(f => join(root, f)).filter(existsSync), ...SCAN_DIRS.flatMap(d => (existsSync(join(root, d)) ? walk(join(root, d)) : []))];
  const set = new Set();
  for (const f of files) for (const ch of readFileSync(f, 'utf8')) if (isCjk(ch.codePointAt(0))) set.add(ch);
  return set;
}
const a = charset(tree(A)), b = charset(tree(B));
const gone = [...a].filter(c => !b.has(c)), added = [...b].filter(c => !a.has(c));
console.log(`[charset] A=${a.size} B=${b.size} · A 有 B 没有：${gone.length ? gone.join('') : '（无）'} · B 新增：${added.length ? added.join('') : '（无）'}`);
process.exit(gone.length ? 1 : 0);
