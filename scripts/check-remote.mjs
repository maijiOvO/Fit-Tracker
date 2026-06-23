import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, '..', '.env.local');
const raw = readFileSync(envPath, 'utf-8');

const url = (raw.match(/VITE_API_URL\s*=\s*(.+)/)?.[1] || '').trim();
const key = (raw.match(/VITE_API_KEY\s*=\s*(.+)/)?.[1] || '').trim();
const envPathOverride = (raw.match(/VITE_FITLOG_STATE_PATH\s*=\s*(.+)/)?.[1] || '').trim();

if (!url || !key) {
  console.log('❌ .env.local 中缺少 VITE_API_URL 或 VITE_API_KEY');
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
console.log(`🔬 模式: ${statePath.includes('dev') ? '开发 (state-dev)' : '生产 (state)'}`);
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
  console.log('可能原因: 服务器离线 / DNS 解析失败 / API Key 无效 / 网络不通');
  process.exit(1);
}