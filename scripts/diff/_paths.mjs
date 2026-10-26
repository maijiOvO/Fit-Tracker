// 五个对照脚本共用的路径解析：仓库根 = 本文件往上两级（scripts/diff/ → 仓库根），
// 产物默认落在 test-artifacts/diff/<层名>/（test-artifacts/ 已在 .gitignore），树和地址一律按 process.cwd() 解析。
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// esbuild / playwright 从仓库根的 node_modules 取：新开的工作树没装依赖也能跑（vite 自带 esbuild；playwright 是 devDependency）。
export const requireFromRoot = createRequire(path.join(ROOT, 'package.json'));

/** 解析 `node x.mjs <位置参数…> [--key value]…`，位置参数里的树路径按 cwd 转成绝对路径。 */
export function parseArgs(argv, { positional, usage, flags = {} }) {
  const pos = [];
  const opts = { ...flags };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      if (!(k in flags)) { console.error(`unknown flag ${a}\n${usage}`); process.exit(2); }
      opts[k] = typeof flags[k] === 'boolean' ? true : argv[++i];
    } else pos.push(a);
  }
  if (pos.length < positional) { console.error(usage); process.exit(2); }
  return { pos, opts };
}

export const tree = (p) => path.resolve(process.cwd(), p);
export const outDir = (layer, override) => (override ? path.resolve(process.cwd(), override) : path.join(ROOT, 'test-artifacts', 'diff', layer));
