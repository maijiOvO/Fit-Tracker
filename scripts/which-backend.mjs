/**
 * 判定「客户端到底在往哪台服务器写」。
 *
 * 用法：
 *   1. node scripts/which-backend.mjs        ← 记下两台的 lastWrite
 *   2. 在手机上随便存一条记录（或改个体重）
 *   3. node scripts/which-backend.mjs        ← 谁的 lastWrite 变了，手机就连着谁
 *
 * 只做 GET，不写入任何数据。
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const raw = readFileSync(resolve(__dirname, '..', '.env.local'), 'utf-8');
function read(name) {
  const v = (raw.match(new RegExp(`^${name}\s*=\s*(.+)$`, 'm'))?.[1] || '').trim();
  const q = v.length >= 2 && ((v[0] === "'" && v.at(-1) === "'") || (v[0] === '"' && v.at(-1) === '"'));
  return q ? v.slice(1, -1) : v;
}
const key = read('VITE_API_KEY');

const TARGETS = [
  { label: 'NAS (新, 应该用这个)', base: 'https://hometj.taild995c6.ts.net' },
  { label: 'VPS (旧, 应该已停用)', base: 'https://fitlog.myronhub.com' },
];

for (const { label, base } of TARGETS) {
  try {
    const resp = await fetch(`${base}/api/fitlog/state`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(20000),
    });
    if (!resp.ok) {
      console.log(`${label}\n  HTTP ${resp.status}\n`);
      continue;
    }
    const d = await resp.json();
    const ago = Math.round((Date.now() - new Date(d.clientExportedAt).getTime()) / 60000);
    console.log(
      `${label}\n` +
      `  最后写入: ${d.clientExportedAt}  (${ago} 分钟前)\n` +
      `  env 标记: ${d.env ?? '(无 —— 未升级的旧服务端)'}\n` +
      `  训练/体重: ${d.workouts?.length ?? 0} / ${d.weightLogs?.length ?? 0}\n`,
    );
  } catch (e) {
    console.log(`${label}\n  连不上: ${e.message}\n`);
  }
}
console.log('判定方法：在手机上存一条记录，再跑一次本脚本 —— lastWrite 变化的那台就是手机在用的。');
