import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, '..', '.env.local');
const raw = readFileSync(envPath, 'utf-8');

/** 读 .env 变量：dotenv 允许值被引号包裹，这里要和 Vite 行为一致地剥掉。 */
function stripQuotes(v) {
  const t = v.trim();
  if (t.length >= 2 && ((t[0] === "'" && t.at(-1) === "'") ||
                        (t[0] === '"' && t.at(-1) === '"'))) {
    return t.slice(1, -1);
  }
  return t;
}

// 与 services/fitlogRemote.ts 的 DEFAULT_API_BASE_URL 保持一致：
// 家庭 NAS，经 Tailscale Serve 暴露，必须用主机名（打 IP 会 404）。
const DEFAULT_API_BASE_URL = 'https://hometj.taild995c6.ts.net';

const url = stripQuotes(raw.match(/VITE_API_URL\s*=\s*(.+)/)?.[1] || '') || DEFAULT_API_BASE_URL;
const key = stripQuotes(raw.match(/VITE_API_KEY\s*=\s*(.+)/)?.[1] || '');
const envPathOverride = stripQuotes(raw.match(/VITE_FITLOG_STATE_PATH\s*=\s*(.+)/)?.[1] || '');

if (!key) {
  console.log('❌ .env.local 中缺少 VITE_API_KEY');
  process.exit(1);
}

// 检查命令行参数或 localStorage 提示
const devModeArg = process.argv.includes('--dev') || process.argv.includes('-d');
const prodArg = process.argv.includes('--prod') || process.argv.includes('-p');

let statePath = '/api/fitlog/state';
if (envPathOverride) {
  statePath = envPathOverride;
} else if (devModeArg) {
  statePath = '/api/fitlog/state-dev';
}

// 正常化 URL
const base = url.replace(/\/$/, '');
const stateUrl = `${base}${statePath}`;

console.log(`🔗 目标服务器: ${base}`);
console.log(`🔑 API Key 长度: ${key.length} 字符`);
console.log(`🔬 模式: ${statePath.includes('dev') ? '开发 (state-dev)' : '用户 (state)'}`);
console.log(`📡 请求: GET ${stateUrl}`);

try {
  const resp = await fetch(stateUrl, {
    method: 'GET',
    headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(15000),
  });
  console.log(`\n📊 HTTP 状态码: ${resp.status} ${resp.ok ? '✅' : '⚠️'}`);

  if (resp.status === 404) {
    console.log('ℹ️  服务器返回 404 —— 状态端点存在但数据为空（首次使用或已清空）');
    console.log('✅ 服务器连通性正常！');
  } else if (resp.ok) {
    const data = await resp.json();
    const workoutCount = data.workouts?.length ?? 0;
    const goalCount = data.goals?.length ?? 0;
    const weightCount = data.weightLogs?.length ?? 0;
    console.log(`✅ 服务器连通正常！远端数据:`);
    console.log(`   - 训练记录: ${workoutCount} 条`);
    console.log(`   - 目标: ${goalCount} 条`);
    console.log(`   - 体重记录: ${weightCount} 条`);
    console.log(`   - 快照时间: ${data.clientExportedAt || '未知'}`);
  } else {
    const body = await resp.text();
    console.log(`⚠️  服务器返回异常: ${body.substring(0, 300)}`);
  }
} catch (err) {
  console.log(`\n❌ 连接失败: ${err.message}`);
  console.log('⚠️  个人服务器在家庭 NAS 上，只有连着 Tailscale 才可达 —— 请先检查 Tailscale 是否已连接。');
  console.log('其他可能原因: NAS 离线 / Tailscale Serve 未启动 / API Key 无效');
  process.exit(1);
}