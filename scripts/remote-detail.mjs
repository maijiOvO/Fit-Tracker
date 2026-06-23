import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, '..', '.env.local');
const raw = readFileSync(envPath, 'utf-8');
const url = (raw.match(/VITE_API_URL\s*=\s*(.+)/)?.[1] || '').trim();
const key = (raw.match(/VITE_API_KEY\s*=\s*(.+)/)?.[1] || '').trim();
const envPathOverride = (raw.match(/VITE_FITLOG_STATE_PATH\s*=\s*(.+)/)?.[1] || '').trim();

const base = url.replace(/\/$/, '');

const devModeArg = process.argv.includes('--dev') || process.argv.includes('-d');
let statePath = '/api/fitlog/state';
if (envPathOverride) {
  statePath = envPathOverride;
} else if (devModeArg) {
  statePath = '/api/fitlog/state-dev';
}

console.log(`🔬 模式: ${statePath.includes('dev') ? '开发 (state-dev)' : '用户 (state)'}\n`);

const resp = await fetch(`${base}${statePath}`, {
  headers: { Authorization: `Bearer ${key}` },
});
const data = await resp.json();

console.log('========== 云端数据详情 ==========');
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