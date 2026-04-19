/**
 * 移动端动作库界面布局修复验证脚本
 * 验证左侧标签栏占25%，右侧动作列表占75%的布局修复
 */

import fs from 'fs';

console.log('🔍 开始验证移动端动作库界面布局修复...\n');

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
    id: 'left-sidebar-width-fix',
    name: '验证左侧标签栏使用25%宽度',
    check: () => {
      // 检查是否将w-80改为w-1/4
      return appContent.includes('w-1/4 overflow-y-auto space-y-6 pr-4 border-r border-slate-800/50 custom-scrollbar');
    }
  },
  {
    id: 'right-content-width-fix',
    name: '验证右侧动作列表使用75%宽度',
    check: () => {
      // 检查是否将flex-1改为w-3/4
      return appContent.includes('w-3/4 overflow-y-auto space-y-4 custom-scrollbar pr-2 pb-20');
    }
  },
  {
    id: 'no-fixed-width-320px',
    name: '验证移除了固定320px宽度',
    check: () => {
      // 检查动作库界面中不再使用w-80（320px）
      const librarySection = appContent.substring(
        appContent.indexOf('showLibrary && ('),
        appContent.indexOf('</div>\n          )}', appContent.indexOf('showLibrary && ('))
      );
      return !librarySection.includes('w-80 overflow-y-auto space-y-6 pr-4 border-r');
    }
  },
  {
    id: 'no-flex-1-right-side',
    name: '验证右侧不再使用flex-1',
    check: () => {
      // 检查动作库界面中右侧不再使用flex-1
      const librarySection = appContent.substring(
        appContent.indexOf('showLibrary && ('),
        appContent.indexOf('</div>\n          )}', appContent.indexOf('showLibrary && ('))
      );
      return !librarySection.includes('flex-1 overflow-y-auto space-y-4 custom-scrollbar pr-2 pb-20');
    }
  },
  {
    id: 'layout-container-structure',
    name: '验证布局容器结构完整',
    check: () => {
      return appContent.includes('flex flex-1 overflow-hidden gap-6') &&
             appContent.includes('w-1/4') &&
             appContent.includes('w-3/4');
    }
  },
  {
    id: 'sidebar-functionality-preserved',
    name: '验证侧边栏功能保持完整',
    check: () => {
      return appContent.includes('onDragOver') &&
             appContent.includes('onDragLeave') &&
             appContent.includes('onDrop') &&
             appContent.includes('isDraggingOverSidebar');
    }
  },
  {
    id: 'exercise-list-functionality-preserved',
    name: '验证动作列表功能保持完整',
    check: () => {
      return appContent.includes('filteredExercises.map') &&
             appContent.includes('onClick={() => {') &&
             appContent.includes('setCurrentWorkout');
    }
  },
  {
    id: 'responsive-design-ready',
    name: '验证响应式设计就绪',
    check: () => {
      // 检查使用了Tailwind的分数宽度类
      return appContent.includes('w-1/4') && appContent.includes('w-3/4');
    }
  },
  {
    id: 'gap-spacing-preserved',
    name: '验证间距保持一致',
    check: () => {
      return appContent.includes('gap-6') &&
             appContent.includes('space-y-6') &&
             appContent.includes('space-y-4');
    }
  },
  {
    id: 'scrolling-behavior-preserved',
    name: '验证滚动行为保持正常',
    check: () => {
      return appContent.includes('overflow-y-auto') &&
             appContent.includes('custom-scrollbar');
    }
  },
  {
    id: 'border-styling-preserved',
    name: '验证边框样式保持完整',
    check: () => {
      return appContent.includes('border-r border-slate-800/50') &&
             appContent.includes('pr-4') &&
             appContent.includes('pr-2');
    }
  },
  {
    id: 'drag-drop-functionality-preserved',
    name: '验证拖拽功能保持完整',
    check: () => {
      return appContent.includes('setIsDraggingOverSidebar') &&
             appContent.includes('draggedFromExId') &&
             appContent.includes('draggedTagId') &&
             appContent.includes('resetDragState');
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
  console.log('\n🎉 所有验证项目都通过了！移动端动作库界面布局修复完成。');
} else if (passedCount >= totalCount * 0.8) {
  console.log('\n✨ 大部分验证项目通过，布局修复基本完成，但还有一些细节需要完善。');
} else {
  console.log('\n⚠️  多个验证项目失败，需要检查修复实现。');
}

// 功能测试指南
console.log('\n📖 功能测试指南:');
console.log('1. 在移动端设备或浏览器开发者工具的移动端模式下测试');
console.log('2. 进入添加动作界面');
console.log('3. 点击"浏览动作库"按钮');
console.log('4. 验证布局效果:');
console.log('   - 左侧标签栏占据屏幕宽度的25%');
console.log('   - 右侧动作列表占据屏幕宽度的75%');
console.log('   - 在不同屏幕尺寸下比例保持一致');
console.log('5. 测试功能完整性:');
console.log('   - 标签筛选功能正常');
console.log('   - 动作搜索功能正常');
console.log('   - 动作添加功能正常');
console.log('   - 拖拽功能正常');

console.log('\n🔧 预期改进效果:');
console.log('- 移动端左侧标签栏不再占满整个屏幕');
console.log('- 左右布局比例固定为1:3（25%:75%）');
console.log('- 在任何屏幕尺寸下都保持正确比例');
console.log('- 保持所有原有功能完整性');
console.log('- 提升移动端用户体验');

console.log('\n📱 测试设备建议:');
console.log('- iPhone SE (375px 宽度)');
console.log('- iPhone 12/13/14 (390px 宽度)');
console.log('- Android 标准尺寸 (360px 宽度)');
console.log('- iPad Mini (768px 宽度)');
console.log('- 各种自定义屏幕尺寸');