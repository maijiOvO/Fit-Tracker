// 把 build-diff 落下的各 chunk 差异行汇总：一边删一边加的同一行（chunk 间搬家）互相抵消，只剩净变化。
// 用法：node scripts/diff/net-diff.mjs [--out dir]   （dir 与 build-diff 的 --out 一致，默认 test-artifacts/diff/build）
// 只汇总不判红绿：它是 build-diff 变红之后帮人看「到底净删 / 净增了什么」的放大镜。
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs, outDir } from './_paths.mjs';

const { opts } = parseArgs(process.argv.slice(2), { positional: 0, usage: 'usage: node scripts/diff/net-diff.mjs [--out dir]', flags: { out: '' } });
const dir = outDir('build', opts.out);
if (!fs.existsSync(dir)) { console.error(`没有 ${dir}：先跑 build-diff`); process.exit(2); }

// 按行计数做多重集差：和 diff 输出的 < / > 行最后抵消出的净结果相同，但不依赖系统有 diff 命令
const removed = new Map(), added = new Map();
const count = (text, m) => { for (const line of text.split('\n')) { const k = line.trim(); m.set(k, (m.get(k) ?? 0) + 1); } };
let pairs = 0;
for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.A.txt'))) {
  pairs++;
  count(fs.readFileSync(path.join(dir, f), 'utf8'), removed);
  count(fs.readFileSync(path.join(dir, f.replace(/\.A\.txt$/, '.B.txt')), 'utf8'), added);
}
const netRemoved = [], netAdded = [];
for (const [k, n] of removed) { const m = added.get(k) ?? 0; if (n > m) netRemoved.push(`${n - m > 1 ? `×${n - m} ` : ''}${k}`); }
for (const [k, n] of added) { const m = removed.get(k) ?? 0; if (n > m) netAdded.push(`${n - m > 1 ? `×${n - m} ` : ''}${k}`); }
const skip = /^(\}|\},|\};|\);|\)|\{|)$/;
console.log(`== ${pairs} 对差异文件 · 净删 ${netRemoved.length} 行 ==`); for (const l of netRemoved) if (!skip.test(l)) console.log('- ' + l.slice(0, 150));
console.log(`== 净增 ${netAdded.length} 行 ==`); for (const l of netAdded) if (!skip.test(l)) console.log('+ ' + l.slice(0, 150));
