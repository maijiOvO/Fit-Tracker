// Metrics选择Bug调试脚本
// 用于分析和验证metrics选择功能的问题

console.log('=== Metrics选择Bug调试分析 ===');

// 模拟当前的数据结构和逻辑
const STANDARD_METRICS = ['weight', 'reps', 'distance', 'duration', 'speed'];

// 模拟localStorage中的数据
let mockExerciseMetricConfigs = {
  "平板杠铃卧推": ["weight", "reps", "distance", "duration", "speed"] // 用户测试时选择的全部5个metrics
};

// 模拟getActiveMetrics函数
const getActiveMetrics = (name) => {
  return mockExerciseMetricConfigs[name] || ['weight', 'reps'];
};

// 模拟toggleMetric函数
const toggleMetric = (exerciseName, metricKey) => {
  console.log(`\n--- 尝试切换 ${exerciseName} 的 ${metricKey} ---`);
  
  const current = getActiveMetrics(exerciseName);
  console.log('当前选中的metrics:', current);
  console.log('要切换的metric:', metricKey);
  console.log('当前是否包含该metric:', current.includes(metricKey));
  
  let next = current.includes(metricKey) 
    ? current.filter(m => m !== metricKey) 
    : [...current, metricKey];
  
  console.log('切换后的metrics:', next);
  
  // 至少保留一个维度
  if (next.length === 0) {
    next = ['reps'];
    console.log('应用最小限制后的metrics:', next);
  }

  mockExerciseMetricConfigs[exerciseName] = next;
  console.log('更新后的配置:', mockExerciseMetricConfigs);
  
  return next;
};

// 测试场景1：正常取消选择
console.log('\n=== 测试场景1：正常取消选择 ===');
console.log('初始状态:', mockExerciseMetricConfigs);

// 尝试取消weight
toggleMetric("平板杠铃卧推", "weight");

// 尝试取消reps
toggleMetric("平板杠铃卧推", "reps");

// 尝试取消distance
toggleMetric("平板杠铃卧推", "distance");

// 测试场景2：检查字符串匹配问题
console.log('\n=== 测试场景2：字符串匹配问题 ===');

// 重置状态
mockExerciseMetricConfigs = {
  "平板杠铃卧推": ["weight", "reps", "distance", "duration", "speed"]
};

// 测试可能的字符串匹配问题
const testMetrics = [
  "weight",
  " weight",  // 前导空格
  "weight ",  // 尾随空格
  " weight ", // 前后空格
  "Weight",   // 大小写
  "WEIGHT"    // 全大写
];

testMetrics.forEach(metric => {
  console.log(`\n测试metric: "${metric}"`);
  const current = getActiveMetrics("平板杠铃卧推");
  console.log('includes结果:', current.includes(metric));
  console.log('严格相等检查:', current.map(m => `"${m}" === "${metric}": ${m === metric}`));
});

// 测试场景3：数组引用问题
console.log('\n=== 测试场景3：数组引用问题 ===');

// 重置状态
mockExerciseMetricConfigs = {
  "平板杠铃卧推": ["weight", "reps", "distance", "duration", "speed"]
};

const originalArray = mockExerciseMetricConfigs["平板杠铃卧推"];
console.log('原始数组:', originalArray);
console.log('原始数组引用:', originalArray === mockExerciseMetricConfigs["平板杠铃卧推"]);

// 模拟filter操作
const filtered = originalArray.filter(m => m !== "weight");
console.log('过滤后数组:', filtered);
console.log('是否是新数组:', filtered !== originalArray);

// 测试场景4：UI渲染数据源问题
console.log('\n=== 测试场景4：UI渲染数据源问题 ===');

// 模拟UI中的数据源生成逻辑
const exerciseName = "平板杠铃卧推";
const currentMetrics = getActiveMetrics(exerciseName);
const allMetricsForUI = Array.from(new Set([...STANDARD_METRICS, ...currentMetrics]));

console.log('当前选中的metrics:', currentMetrics);
console.log('UI中显示的所有metrics:', allMetricsForUI);
console.log('每个metric的选中状态:');
allMetricsForUI.forEach(m => {
  console.log(`  ${m}: ${currentMetrics.includes(m) ? '✓选中' : '✗未选中'}`);
});

// 测试场景5：localStorage序列化问题
console.log('\n=== 测试场景5：localStorage序列化问题 ===');

const testConfig = {
  "平板杠铃卧推": ["weight", "reps", "distance", "duration", "speed"]
};

// 模拟存储和读取
const serialized = JSON.stringify(testConfig);
console.log('序列化后:', serialized);

const deserialized = JSON.parse(serialized);
console.log('反序列化后:', deserialized);

// 检查数据完整性
console.log('数据完整性检查:');
console.log('原始 === 反序列化:', JSON.stringify(testConfig) === JSON.stringify(deserialized));
console.log('数组内容对比:', testConfig["平板杠铃卧推"].every((m, i) => m === deserialized["平板杠铃卧推"][i]));

console.log('\n=== 调试分析完成 ===');
console.log('\n可能的Bug原因分析:');
console.log('1. 字符串匹配问题：空格、大小写等');
console.log('2. 数组引用问题：直接修改vs创建新数组');
console.log('3. 状态同步问题：React状态与localStorage不一致');
console.log('4. UI渲染时机问题：状态更新后UI未及时刷新');
console.log('5. 事件处理问题：快速点击导致状态冲突');