// Metrics UI Bug 精确调试脚本
// 模拟实际UI渲染逻辑中的问题

console.log('=== Metrics UI Bug 精确调试 ===');

const STANDARD_METRICS = ['weight', 'reps', 'distance', 'duration', 'speed'];

// 模拟用户的实际配置（测试时选择了所有5个metrics）
let mockExerciseMetricConfigs = {
  "平板杠铃卧推": ["weight", "reps", "distance", "duration", "speed"]
};

const getActiveMetrics = (name) => {
  return mockExerciseMetricConfigs[name] || ['weight', 'reps'];
};

const exerciseName = "平板杠铃卧推";

console.log('\n=== 问题分析：UI渲染的metrics来源 ===');
console.log('STANDARD_METRICS:', STANDARD_METRICS);
console.log('getActiveMetrics结果:', getActiveMetrics(exerciseName));

// 这是实际UI中使用的逻辑
const uiMetrics = Array.from(new Set([...STANDARD_METRICS, ...getActiveMetrics(exerciseName)]));
console.log('UI中显示的metrics:', uiMetrics);

console.log('\n=== 关键发现：数组顺序和重复问题 ===');
console.log('合并前的数组:', [...STANDARD_METRICS, ...getActiveMetrics(exerciseName)]);
console.log('Set去重后的数组:', uiMetrics);

// 检查每个metric在两个数组中的位置
console.log('\n=== 位置分析 ===');
STANDARD_METRICS.forEach((metric, index) => {
  const activeIndex = getActiveMetrics(exerciseName).indexOf(metric);
  console.log(`${metric}: STANDARD位置=${index}, ACTIVE位置=${activeIndex}`);
});

console.log('\n=== 模拟toggleMetric调用 ===');

const toggleMetric = (exerciseName, metricKey) => {
  console.log(`\n--- 切换 ${metricKey} ---`);
  
  const current = getActiveMetrics(exerciseName);
  console.log('当前配置:', current);
  console.log('要切换的key:', `"${metricKey}"`);
  console.log('includes检查:', current.includes(metricKey));
  
  // 详细检查每个元素
  console.log('详细匹配检查:');
  current.forEach((item, index) => {
    console.log(`  [${index}] "${item}" === "${metricKey}": ${item === metricKey}`);
    console.log(`      类型: ${typeof item} vs ${typeof metricKey}`);
    console.log(`      长度: ${item.length} vs ${metricKey.length}`);
    if (item !== metricKey) {
      console.log(`      字符码对比: [${item.split('').map(c => c.charCodeAt(0)).join(',')}] vs [${metricKey.split('').map(c => c.charCodeAt(0)).join(',')}]`);
    }
  });
  
  let next = current.includes(metricKey) 
    ? current.filter(m => m !== metricKey) 
    : [...current, metricKey];
  
  if (next.length === 0) next = ['reps'];
  
  console.log('切换后配置:', next);
  mockExerciseMetricConfigs[exerciseName] = next;
  
  return next;
};

// 测试每个metric的切换
console.log('\n=== 逐个测试切换功能 ===');
uiMetrics.forEach(metric => {
  // 重置状态
  mockExerciseMetricConfigs[exerciseName] = ["weight", "reps", "distance", "duration", "speed"];
  toggleMetric(exerciseName, metric);
});

console.log('\n=== 测试可能的数据污染问题 ===');

// 模拟可能的数据污染场景
const possibleCorruptedConfigs = [
  // 场景1：包含空格的数据
  { "平板杠铃卧推": ["weight ", " reps", "distance", "duration", "speed"] },
  // 场景2：包含特殊字符
  { "平板杠铃卧推": ["weight\n", "reps\t", "distance", "duration", "speed"] },
  // 场景3：包含Unicode字符
  { "平板杠铃卧推": ["weight\u200B", "reps", "distance", "duration", "speed"] },
  // 场景4：大小写问题
  { "平板杠铃卧推": ["Weight", "Reps", "distance", "duration", "speed"] }
];

possibleCorruptedConfigs.forEach((config, index) => {
  console.log(`\n--- 测试污染场景 ${index + 1} ---`);
  mockExerciseMetricConfigs = config;
  
  const current = getActiveMetrics(exerciseName);
  console.log('当前配置:', current.map(m => `"${m}"`));
  
  // 测试是否能正确识别weight
  const testMetric = "weight";
  console.log(`测试切换 "${testMetric}":`, current.includes(testMetric));
  
  // 显示每个元素的详细信息
  current.forEach((item, idx) => {
    if (item.includes('weight') || item.toLowerCase().includes('weight')) {
      console.log(`  [${idx}] 疑似weight: "${item}" (长度:${item.length}, 字符码:[${item.split('').map(c => c.charCodeAt(0)).join(',')}])`);
    }
  });
});

console.log('\n=== 解决方案测试 ===');

// 测试增强的toggleMetric函数
const enhancedToggleMetric = (exerciseName, metricKey) => {
  console.log(`\n--- 增强版切换 ${metricKey} ---`);
  
  const current = getActiveMetrics(exerciseName);
  
  // 标准化处理
  const normalizedCurrent = current.map(m => m.trim().toLowerCase());
  const normalizedKey = metricKey.trim().toLowerCase();
  
  console.log('原始配置:', current);
  console.log('标准化配置:', normalizedCurrent);
  console.log('标准化key:', normalizedKey);
  
  const isCurrentlySelected = normalizedCurrent.includes(normalizedKey);
  console.log('是否选中:', isCurrentlySelected);
  
  let next;
  if (isCurrentlySelected) {
    // 找到原始的匹配项进行删除
    const indexToRemove = normalizedCurrent.indexOf(normalizedKey);
    next = current.filter((_, index) => index !== indexToRemove);
  } else {
    next = [...current, metricKey];
  }
  
  if (next.length === 0) next = ['reps'];
  
  console.log('增强版结果:', next);
  return next;
};

// 测试增强版本
console.log('\n--- 测试增强版本对污染数据的处理 ---');
mockExerciseMetricConfigs = { "平板杠铃卧推": ["weight ", " reps", "distance", "duration", "speed"] };
enhancedToggleMetric(exerciseName, "weight");
enhancedToggleMetric(exerciseName, "reps");

console.log('\n=== 调试完成 ===');