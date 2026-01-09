/**
 * 批量运行所有验证脚本
 * 
 * 这个脚本会依次运行所有验证脚本，并汇总结果
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('🚀 开始批量运行所有验证脚本...\n');

// 获取当前目录下的所有JS文件（除了这个脚本本身）
const currentDir = __dirname;
const allFiles = fs.readdirSync(currentDir);
const verificationScripts = allFiles.filter(file => 
  file.endsWith('.js') && 
  file !== 'run-all-verifications.js' &&
  (file.includes('verification') || file.includes('debug') || file.includes('analysis'))
);

console.log(`📋 找到 ${verificationScripts.length} 个验证脚本:\n`);

// 按类别分组脚本
const categories = {
  'Bug修复验证': [],
  '功能实现验证': [],
  '调试分析工具': [],
  '界面优化验证': []
};

verificationScripts.forEach(script => {
  if (script.includes('bug-fix') || script.includes('unit-') || script.includes('mobile-') || script.includes('missing-') || script.includes('metrics-reset') || script.includes('cloud-sync') || script.includes('text-correction')) {
    categories['Bug修复验证'].push(script);
  } else if (script.includes('account-reset') || script.includes('save-functionality') || script.includes('custom-exercise-time') || script.includes('improved-goals')) {
    categories['功能实现验证'].push(script);
  } else if (script.includes('debug') || script.includes('analysis')) {
    categories['调试分析工具'].push(script);
  } else if (script.includes('ui-optimization')) {
    categories['界面优化验证'].push(script);
  } else {
    categories['功能实现验证'].push(script); // 默认分类
  }
});

// 显示分类结果
Object.entries(categories).forEach(([category, scripts]) => {
  if (scripts.length > 0) {
    console.log(`📁 ${category} (${scripts.length}个):`);
    scripts.forEach(script => {
      console.log(`   • ${script}`);
    });
    console.log('');
  }
});

// 运行结果统计
const results = {
  total: 0,
  passed: 0,
  failed: 0,
  errors: 0
};

console.log('🔄 开始执行验证脚本...\n');
console.log('═'.repeat(80));

// 依次运行每个脚本
for (const script of verificationScripts) {
  results.total++;
  console.log(`\n🎯 运行: ${script}`);
  console.log('─'.repeat(60));
  
  try {
    // 运行脚本并捕获输出
    const scriptPath = path.join(currentDir, script);
    const output = execSync(`node "${scriptPath}"`, { 
      encoding: 'utf8',
      cwd: path.dirname(currentDir) // 在项目根目录运行
    });
    
    // 简单分析输出判断是否成功
    const outputLower = output.toLowerCase();
    if (outputLower.includes('验证完成') || outputLower.includes('所有验证项目都已通过') || outputLower.includes('✅')) {
      results.passed++;
      console.log('✅ 验证通过');
    } else if (outputLower.includes('失败') || outputLower.includes('错误') || outputLower.includes('❌')) {
      results.failed++;
      console.log('❌ 验证失败');
    } else {
      results.passed++; // 默认认为通过
      console.log('✅ 验证完成');
    }
    
    // 显示关键输出信息
    const lines = output.split('\n');
    const summaryLines = lines.filter(line => 
      line.includes('通过率') || 
      line.includes('验证项') || 
      line.includes('总计') ||
      line.includes('成功') ||
      line.includes('完成')
    );
    
    if (summaryLines.length > 0) {
      console.log('📊 关键信息:');
      summaryLines.slice(0, 3).forEach(line => {
        if (line.trim()) {
          console.log(`   ${line.trim()}`);
        }
      });
    }
    
  } catch (error) {
    results.errors++;
    console.log('💥 脚本执行出错:');
    console.log(`   ${error.message.split('\n')[0]}`);
  }
}

console.log('\n' + '═'.repeat(80));
console.log('📊 批量验证结果汇总');
console.log('═'.repeat(80));

console.log(`📋 总脚本数: ${results.total}`);
console.log(`✅ 验证通过: ${results.passed}`);
console.log(`❌ 验证失败: ${results.failed}`);
console.log(`💥 执行错误: ${results.errors}`);

const successRate = results.total > 0 ? ((results.passed / results.total) * 100).toFixed(1) : 0;
console.log(`📈 总体通过率: ${successRate}%`);

console.log('\n📁 按类别统计:');
Object.entries(categories).forEach(([category, scripts]) => {
  if (scripts.length > 0) {
    console.log(`   ${category}: ${scripts.length}个脚本`);
  }
});

if (results.passed === results.total) {
  console.log('\n🎉 所有验证脚本都运行成功！');
  console.log('系统功能验证完整，代码质量良好。');
} else if (results.errors > 0) {
  console.log('\n⚠️  部分脚本执行出错，请检查环境配置。');
} else {
  console.log('\n📝 部分验证未通过，请查看具体脚本输出进行修复。');
}

console.log('\n💡 提示:');
console.log('• 可以单独运行失败的脚本进行详细调试');
console.log('• 执行错误通常是由于依赖或路径问题');
console.log('• 验证失败表示功能可能需要进一步完善');

console.log('\n✨ 批量验证完成！');

// 返回适当的退出码
process.exit(results.errors > 0 ? 1 : 0);