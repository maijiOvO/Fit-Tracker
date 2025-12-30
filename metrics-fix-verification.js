// Metrics选择Bug修复验证脚本
// 验证修复后的toggleMetric函数是否能正确处理各种情况

console.log('=== Metrics选择Bug修复验证 ===');

// 模拟修复后的逻辑
const STANDARD_METRICS = ['weight', 'reps', 'distance', 'duration', 'speed'];

// 模拟各种可能的数据状态
const testScenarios = [
  {
    name: '正常数据',
    config: { "平板杠铃卧推": ["weight", "reps", "distance", "duration", "speed"] }
  },
  {
    name: '包含空格的污染数据',
    config: { "平板杠铃卧推": ["weight ", " reps", "distance", "duration ", "speed"] }
  },
  {
    name: '包含换行符的污染数据',
    config: { "平板杠铃卧推": ["weight\n", "reps", "distance", "duration", "speed\t"] }
  },
  {
    name: '混合污染数据',
    config: { "平板杠铃卧推": [" weight ", "reps\n", "\tdistance", "duration", "speed "] }
  },
  {
    name: '包含空字符串的数据',
    config: { "平板杠铃卧推": ["weight", "", "reps", "distance", "duration", "speed"] }
  }
];

// 模拟修复后的getActiveMetrics函数
const getActiveMetrics = (name, config) => {
  return config[name] || ['weight', 'reps'];
};

// 模拟修复后的数据清理逻辑
const cleanMetricsConfig = (config) => {
  const cleaned = {};
  let needsCleaning = false;
  
  Object.entries(config).forEach(([exerciseName, metrics]) => {
    if (Array.isArray(metrics)) {
      const cleanedMetrics = metrics
        .map(m => typeof m === 'string' ? m.trim() : String(m).trim())
        .filter(m => m.length > 0);
      
      const originalStr = JSON.stringify(metrics);
      const cleanedStr = JSON.stringify(cleanedMetrics);
      if (originalStr !== cleanedStr) {
        needsCleaning = true;
        console.log(`清理动作 "${exerciseName}" 的metrics数据:`, {
          原始: metrics,
          清理后: cleanedMetrics
        });
      }
      
      cleaned[exerciseName] = cleanedMetrics;
    }
  });
  
  return { cleaned, needsCleaning };
};

// 模拟修复后的toggleMetric函数
const toggleMetric = (exerciseName, metricKey, config) => {
  const current = getActiveMetrics(exerciseName, config);
  
  // 使用更安全的字符串匹配，只处理空格问题，保留大小写
  const normalizedCurrent = current.map(m => m.trim());
  const normalizedKey = metricKey.trim();
  
  const isCurrentlySelected = normalizedCurrent.includes(normalizedKey);
  
  console.log('Toggle Debug:', {
    exerciseName,
    metricKey,
    current,
    normalizedCurrent,
    normalizedKey,
    isCurrentlySelected
  });
  
  let next;
  if (isCurrentlySelected) {
    // 找到精确匹配的索引进行删除
    const indexToRemove = normalizedCurrent.indexOf(normalizedKey);
    next = current.filter((_, index) => index !== indexToRemove);
  } else {
    next = [...current, metricKey];
  }
  
  // 至少保留一个维度
  if (next.length === 0) next = ['reps'];

  // 清理存储的数据，确保没有空格污染
  const cleanNext = next.map(m => m.trim()).filter(m => m.length > 0);

  console.log('Toggle Result:', { before: current, after: cleanNext });
  
  return cleanNext;
};

// 测试每个场景
testScenarios.forEach((scenario, index) => {
  console.log(`\n=== 测试场景 ${index + 1}: ${scenario.name} ===`);
  
  // 1. 测试数据清理
  const { cleaned, needsCleaning } = cleanMetricsConfig(scenario.config);
  console.log('数据清理结果:', { needsCleaning, cleaned });
  
  // 2. 测试每个metric的切换功能
  const exerciseName = "平板杠铃卧推";
  const currentMetrics = getActiveMetrics(exerciseName, cleaned);
  
  console.log(`\n当前metrics: [${currentMetrics.join(', ')}]`);
  
  // 测试取消选择每个metric
  currentMetrics.forEach(metric => {
    console.log(`\n--- 测试取消选择: ${metric} ---`);
    const result = toggleMetric(exerciseName, metric, { [exerciseName]: currentMetrics });
    const shouldNotInclude = !result.includes(metric.trim());
    console.log(`✅ 取消选择成功: ${shouldNotInclude ? '是' : '否'}`);
  });
  
  // 测试添加新metric
  console.log(`\n--- 测试添加新metric: custom_test ---`);
  const addResult = toggleMetric(exerciseName, 'custom_test', { [exerciseName]: currentMetrics });
  const shouldInclude = addResult.includes('custom_test');
  console.log(`✅ 添加成功: ${shouldInclude ? '是' : '否'}`);
});

// 测试重置功能
console.log(`\n=== 测试重置功能 ===`);
const resetMetricsToDefault = (exerciseName, config) => {
  const updated = { ...config };
  delete updated[exerciseName];
  console.log(`重置 "${exerciseName}" 到默认配置`);
  return updated;
};

const testConfig = { "平板杠铃卧推": ["weight", "reps", "distance", "duration", "speed", "custom_test"] };
console.log('重置前:', testConfig);
const resetResult = resetMetricsToDefault("平板杠铃卧推", testConfig);
console.log('重置后:', resetResult);
const defaultMetrics = getActiveMetrics("平板杠铃卧推", resetResult);
console.log('默认metrics:', defaultMetrics);

console.log('\n=== 验证完成 ===');
console.log('\n✅ 修复要点总结:');
console.log('1. 数据清理：启动时自动清理localStorage中的污染数据');
console.log('2. 字符串匹配：使用trim()处理空格，但保留大小写');
console.log('3. 精确删除：使用索引匹配而非字符串过滤');
console.log('4. 数据验证：存储前再次清理，确保数据纯净');
console.log('5. 重置功能：提供一键重置到默认配置的选项');
console.log('6. 调试日志：添加详细日志帮助定位问题');

console.log('\n🎯 预期效果:');
console.log('- 用户可以正常取消任何已选择的metrics');
console.log('- 不再出现"某些metrics无法取消"的问题');
console.log('- 数据污染问题得到根本解决');
console.log('- 提供重置功能作为备用方案');