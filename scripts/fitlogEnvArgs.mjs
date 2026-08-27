/**
 * 运维脚本共用的环境解析。
 *
 * 默认值刻意选 dev：这些脚本在开发机上跑，误连生产端点的代价远大于
 * 误连开发端点。要碰真实用户数据必须显式写 --prod。
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// 与 services/fitlogRemote.ts 的 DEFAULT_API_BASE_URL 保持一致：
// 家庭 NAS，经 Tailscale Serve 暴露，必须用主机名（打 IP 会 404）。
export const DEFAULT_API_BASE_URL = 'https://hometj.taild995c6.ts.net';

/** 读 .env 变量：dotenv 允许值被引号包裹，这里要和 Vite 行为一致地剥掉。 */
function stripQuotes(v) {
  const t = v.trim();
  if (t.length >= 2 && ((t[0] === "'" && t.at(-1) === "'") ||
                        (t[0] === '"' && t.at(-1) === '"'))) {
    return t.slice(1, -1);
  }
  return t;
}

export function resolveTarget(argv = process.argv) {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const raw = readFileSync(resolve(__dirname, '..', '.env.local'), 'utf-8');
  const read = (name) => stripQuotes(raw.match(new RegExp(`^${name}\s*=\s*(.+)$`, 'm'))?.[1] || '');

  const wantsProd = argv.includes('--prod') || argv.includes('-p');
  const env = wantsProd ? 'prod' : 'dev';

  const base = (read('VITE_API_URL') || DEFAULT_API_BASE_URL).replace(/\/$/, '');
  const statePath = env === 'prod' ? '/api/fitlog/state' : '/api/fitlog/state-dev';

  // 环境各用各的 key：dev key 打不动生产端点，服务端会 403
  const key = env === 'prod'
    ? read('VITE_API_KEY')
    : (read('VITE_API_KEY_DEV') || read('VITE_API_KEY'));

  if (!key) {
    console.error(`❌ .env.local 中缺少 ${env === 'prod' ? 'VITE_API_KEY' : 'VITE_API_KEY_DEV / VITE_API_KEY'}`);
    process.exit(1);
  }

  return { env, base, statePath, key, url: `${base}${statePath}` };
}

export function printTarget({ env, base, statePath, key }) {
  console.log(`🔗 目标服务器: ${base}`);
  console.log(`🔑 API Key 长度: ${key.length} 字符`);
  console.log(
    env === 'prod'
      ? '🔴 环境: prod (state) —— 真实用户数据'
      : '🧪 环境: dev (state-dev) —— 默认；加 --prod 才会读生产数据',
  );
  console.log(`📡 请求: GET ${base}${statePath}`);
}
