/**
 * 个人服务器连通性检查（只读）。
 *
 * 默认打 **开发端点**（state-dev）。要看真实用户数据请显式加 --prod。
 */
import { resolveTarget, printTarget } from './fitlogEnvArgs.mjs';

const target = resolveTarget();
printTarget(target);

try {
  const resp = await fetch(target.url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${target.key}`,
      'Content-Type': 'application/json',
      'X-Fitlog-Env': target.env,
    },
    signal: AbortSignal.timeout(15000),
  });
  console.log(`\n📊 HTTP 状态码: ${resp.status} ${resp.ok ? '✅' : '⚠️'}`);

  if (resp.status === 404) {
    console.log('ℹ️  服务器返回 404 —— 状态端点存在但数据为空（首次使用或已清空）');
    console.log('✅ 服务器连通性正常！');
  } else if (resp.status === 403) {
    console.log('🛑 服务器拒绝：这把 key 无权访问该端点。');
    console.log('   这是端点绑定生效的正常表现 —— dev key 打不动 state，prod key 打不动 state-dev。');
    process.exit(1);
  } else if (resp.ok) {
    const data = await resp.json();
    if (data.env && data.env !== target.env) {
      console.log(`\n🛑 快照环境标记为 "${data.env}"，与请求端点 "${target.env}" 不符 —— 服务端数据可能被污染过，请检查。`);
      process.exit(1);
    }
    console.log(`✅ 服务器连通正常！远端数据:`);
    console.log(`   - 环境标记: ${data.env ?? '(旧快照，无标记)'}`);
    console.log(`   - 训练记录: ${data.workouts?.length ?? 0} 条`);
    console.log(`   - 目标: ${data.goals?.length ?? 0} 条`);
    console.log(`   - 体重记录: ${data.weightLogs?.length ?? 0} 条`);
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
