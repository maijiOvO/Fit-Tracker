/**
 * 打印云端快照明细（只读）。
 *
 * 默认打 **开发端点**（state-dev）。要看真实用户数据请显式加 --prod。
 */
import { resolveTarget } from './fitlogEnvArgs.mjs';

const target = resolveTarget();
const banner =
  target.env === 'prod'
    ? '🔴 环境: prod (state) —— 真实用户数据'
    : '🧪 环境: dev (state-dev) —— 默认；加 --prod 才会读生产数据';
console.log(banner);
console.log('');

const resp = await fetch(target.url, {
  headers: {
    Authorization: `Bearer ${target.key}`,
    'X-Fitlog-Env': target.env,
  },
});
if (!resp.ok) {
  console.error(`❌ HTTP ${resp.status} —— ${resp.status === 403 ? '这把 key 无权访问该端点（端点绑定生效）' : await resp.text().catch(() => '')}`);
  process.exit(1);
}
const data = await resp.json();

console.log('========== 云端数据详情 ==========');
console.log(`环境标记: ${data.env ?? '(旧快照，无标记)'}`);
console.log(`快照时间: ${data.clientExportedAt}`);

// 训练记录
const sortedWorkouts = (data.workouts || []).sort(
  (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
);
console.log(`\n📋 训练记录 (${sortedWorkouts.length} 条):`);
for (const w of sortedWorkouts) {
  const d = new Date(w.date);
  const dateStr = d.toLocaleDateString('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short',
  });
  const exNames = (w.exercises || []).map(e => e.name).join(', ');
  console.log(`  ${dateStr} | "${w.title}" | ${exNames || '(无动作)'}`);
}

// 体重记录
const sortedWeights = (data.weightLogs || []).sort(
  (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
);
console.log(`\n⚖️  体重记录 (${sortedWeights.length} 条):`);
for (const w of sortedWeights) {
  const d = new Date(w.date);
  console.log(`  ${d.toLocaleDateString('zh-CN')} | ${w.weight} ${w.unit}`);
}

// 目标
const sortedGoals = (data.goals || []).sort(
  (a, b) => new Date(b.updatedAt || b.createdAt || 0).getTime() - new Date(a.updatedAt || a.createdAt || 0).getTime()
);
console.log(`\n🎯 目标 (${sortedGoals.length} 条):`);
for (const g of sortedGoals) {
  console.log(`  ${g.title} | ${g.currentValue}/${g.targetValue} ${g.unit} | active=${g.isActive}`);
}

console.log('\n========== 总结 ==========');
const newestCloud = sortedWorkouts[0];
if (newestCloud) {
  console.log(`云端最新训练日期: ${new Date(newestCloud.date).toLocaleDateString('zh-CN')}`);
  console.log(`距今已过: ${Math.floor((Date.now() - new Date(newestCloud.date).getTime()) / 86400000)} 天`);
}