// 检查localStorage中的实际数据
// 这个脚本需要在浏览器控制台中运行

console.log('=== 检查localStorage中的metrics配置数据 ===');

// 获取存储的数据
const storedData = localStorage.getItem('fitlog_metric_configs');
console.log('原始存储数据:', storedData);

if (storedData) {
  try {
    const parsed = JSON.parse(storedData);
    console.log('解析后的数据:', parsed);
    
    // 检查每个动作的配置
    Object.entries(parsed).forEach(([exerciseName, metrics]) => {
      console.log(`\n--- 动作: ${exerciseName} ---`);
      console.log('配置的metrics:', metrics);
      
      // 检查每个metric是否有问题
      metrics.forEach((metric, index) => {
        console.log(`[${index}] "${metric}"`);
        console.log(`    长度: ${metric.length}`);
        console.log(`    字符码: [${metric.split('').map(c => c.charCodeAt(0)).join(',')}]`);
        
        // 检查是否包含不可见字符
        const hasInvisibleChars = /[\s\u200B-\u200D\uFEFF]/.test(metric);
        if (hasInvisibleChars) {
          console.log(`    ⚠️ 包含不可见字符!`);
        }
        
        // 检查前后是否有空格
        if (metric !== metric.trim()) {
          console.log(`    ⚠️ 包含前后空格! 原始:"${metric}" 清理后:"${metric.trim()}"`);
        }
      });
    });
    
  } catch (e) {
    console.error('解析JSON失败:', e);
  }
} else {
  console.log('没有找到存储的metrics配置数据');
}

// 提供清理函数
console.log('\n=== 数据清理函数 ===');
console.log('如果发现数据污染，可以运行以下代码清理:');
console.log(`
// 清理污染的metrics配置数据
const cleanMetricsData = () => {
  const storedData = localStorage.getItem('fitlog_metric_configs');
  if (storedData) {
    try {
      const parsed = JSON.parse(storedData);
      const cleaned = {};
      
      Object.entries(parsed).forEach(([exerciseName, metrics]) => {
        cleaned[exerciseName] = metrics.map(metric => metric.trim());
      });
      
      localStorage.setItem('fitlog_metric_configs', JSON.stringify(cleaned));
      console.log('数据清理完成!', cleaned);
      return cleaned;
    } catch (e) {
      console.error('清理失败:', e);
    }
  }
};

// 运行清理
cleanMetricsData();
`);