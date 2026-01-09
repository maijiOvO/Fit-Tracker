/**
 * 个人记录查看界面历史记录显示优化验证脚本
 * 验证历史记录中是否正确显示递增递减组、负重、辅助重量等配置信息
 */

import fs from 'fs';
import path from 'path';

console.log('🔍 开始验证个人记录查看界面历史记录显示优化...\n');

// 读取App.tsx文件内容
let appContent = '';
try {
  appContent = fs.readFileSync('App.tsx', 'utf8');
} catch (error) {
  console.error('❌ 无法读取App.tsx文件:', error.message);
  process.exit(1);
}

// 验证项目列表
const verificationItems = [
  {
    id: 'renderSetCapsule-function-exists',
    name: '验证renderSetCapsule函数存在',
    check: () => {
      return appContent.includes('const renderSetCapsule = (s: any, exerciseName: string, exercise?: Exercise)');
    }
  },
  {
    id: 'pyramid-indicator-display',
    name: '验证递增递减组标识显示',
    check: () => {
      return appContent.includes('递增递减') && 
             appContent.includes('Pyramid') &&
             appContent.includes('orange-500');
    }
  },
  {
    id: 'bodyweight-mode-indicators',
    name: '验证自重模式标识显示',
    check: () => {
      return appContent.includes('自重') && 
             appContent.includes('负重') &&
             appContent.includes('辅助') &&
             appContent.includes('green-500') &&
             appContent.includes('blue-500') &&
             appContent.includes('purple-500');
    }
  },
  {
    id: 'subset-count-display',
    name: '验证子组数量显示',
    check: () => {
      return appContent.includes('子组') && 
             appContent.includes('Sub') &&
             appContent.includes('s.subSets.length');
    }
  },
  {
    id: 'subset-details-display',
    name: '验证子组详细信息显示',
    check: () => {
      return appContent.includes('s.subSets && s.subSets.length > 0') &&
             appContent.includes('subSet.weight') &&
             appContent.includes('subSet.reps');
    }
  },
  {
    id: 'exercise-config-function',
    name: '验证getExerciseConfig函数存在',
    check: () => {
      return appContent.includes('const getExerciseConfig = (exercise: Exercise)');
    }
  },
  {
    id: 'pyramid-enabled-function',
    name: '验证isPyramidEnabled函数存在',
    check: () => {
      return appContent.includes('const isPyramidEnabled = (exercise: Exercise)');
    }
  },
  {
    id: 'bodyweight-mode-function',
    name: '验证isBodyweightMode函数存在',
    check: () => {
      return appContent.includes('const isBodyweightMode = (exercise: Exercise)');
    }
  },
  {
    id: 'icon-imports',
    name: '验证所需图标已导入',
    check: () => {
      return appContent.includes('Layers,') && 
             appContent.includes('User,') && 
             appContent.includes('Hash,') && 
             appContent.includes('StickyNote,');
    }
  },
  {
    id: 'chinese-english-support',
    name: '验证中英文双语支持',
    check: () => {
      return appContent.includes('lang === Language.CN ? \'递增递减\' : \'Pyramid\'') &&
             appContent.includes('lang === Language.CN ? \'自重\' : \'BW\'') &&
             appContent.includes('lang === Language.CN ? \'负重\' : \'+W\'') &&
             appContent.includes('lang === Language.CN ? \'辅助\' : \'AST\'');
    }
  },
  {
    id: 'history-visibility-state',
    name: '验证历史记录可见性状态管理',
    check: () => {
      return appContent.includes('const [isHistoryVisible, setIsHistoryVisible] = useState(false)');
    }
  },
  {
    id: 'exercise-parameter-passing',
    name: '验证exercise参数正确传递给renderSetCapsule',
    check: () => {
      return appContent.includes('renderSetCapsule(s, ex.name, ex)');
    }
  },
  {
    id: 'config-based-logic',
    name: '验证基于配置的逻辑而非标签',
    check: () => {
      return appContent.includes('const config = exercise ? getExerciseConfig(exercise) : null') &&
             appContent.includes('config?.enablePyramid') &&
             appContent.includes('config?.bodyweightMode');
    }
  },
  {
    id: 'subset-weight-reps-display',
    name: '验证子组重量和次数独立显示',
    check: () => {
      return appContent.includes('subSet.weight > 0 && `${subSet.weight}${unit') &&
             appContent.includes('subSet.reps > 0 && `${subSet.reps}${lang');
    }
  },
  {
    id: 'subset-note-display',
    name: '验证子组备注显示',
    check: () => {
      return appContent.includes('subSet.note && (') &&
             appContent.includes('<StickyNote size={8}') &&
             appContent.includes('title={subSet.note}');
    }
  }
];

// 执行验证
let passedCount = 0;
let totalCount = verificationItems.length;

console.log(`📋 总共 ${totalCount} 个验证项目:\n`);

verificationItems.forEach((item, index) => {
  try {
    const result = item.check();
    const status = result ? '✅ 通过' : '❌ 失败';
    const icon = result ? '✅' : '❌';
    
    console.log(`${index + 1}. ${icon} ${item.name}`);
    
    if (result) {
      passedCount++;
    } else {
      console.log(`   ⚠️  验证失败: ${item.id}`);
    }
  } catch (error) {
    console.log(`${index + 1}. ❌ ${item.name}`);
    console.log(`   ⚠️  验证出错: ${error.message}`);
  }
});

// 输出总结
console.log(`\n📊 验证结果总结:`);
console.log(`✅ 通过: ${passedCount}/${totalCount} (${(passedCount/totalCount*100).toFixed(1)}%)`);
console.log(`❌ 失败: ${totalCount - passedCount}/${totalCount} (${((totalCount-passedCount)/totalCount*100).toFixed(1)}%)`);

if (passedCount === totalCount) {
  console.log('\n🎉 所有验证项目都通过了！个人记录查看界面历史记录显示优化功能实现完整。');
} else if (passedCount >= totalCount * 0.8) {
  console.log('\n✨ 大部分验证项目通过，功能基本实现，但还有一些细节需要完善。');
} else {
  console.log('\n⚠️  多个验证项目失败，需要检查实现。');
}

// 功能测试指南
console.log('\n📖 功能测试指南:');
console.log('1. 进入个人记录查看界面');
console.log('2. 选择一个有历史记录的动作');
console.log('3. 点击展开历史记录');
console.log('4. 检查历史记录中是否显示:');
console.log('   - 递增递减组标识（橙色"递增递减"/"Pyramid"标签）');
console.log('   - 自重模式标识（绿色"自重"/蓝色"负重"/紫色"辅助"）');
console.log('   - 子组数量显示（如"3 子组"/"3 Sub"）');
console.log('   - 子组详细信息（重量×次数，备注等）');
console.log('5. 验证中英文切换时标识文字正确显示');
console.log('6. 测试不同配置的动作记录显示效果');

console.log('\n🔧 预期改进效果:');
console.log('- 历史记录中清晰显示动作的特殊配置');
console.log('- 递增递减组显示子组详细信息');
console.log('- 自重模式用不同颜色标识区分');
console.log('- 支持中英文双语显示');
console.log('- 保持原有功能完整性');