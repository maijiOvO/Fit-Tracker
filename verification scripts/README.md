# 验证脚本文件夹

这个文件夹包含了所有用于验证功能实现、调试问题和分析系统行为的脚本文件。

## 📁 文件分类

### 🐛 Bug修复验证脚本
这些脚本用于验证各种bug修复的有效性：

#### 高优先级Bug修复
- `bug-fix-verification.js` - 高优先级技术稳定性bug修复验证
- `medium-priority-bug-verification.js` - 中优先级bug修复验证  
- `low-priority-bug-verification.js` - 低优先级bug修复验证

#### 单位转换相关Bug修复
- `unit-consistency-fix-verification.js` - 单位显示一致性修复验证
- `unit-conversion-double-bug-fix-verification.js` - 单位转换双重转换bug修复验证
- `unit-toggle-double-conversion-fix-verification.js` - 单位切换双重转换修复验证
- `history-edit-double-conversion-fix-verification.js` - 历史记录编辑双重转换修复验证
- `data-display-consistency-bug-fix-verification.js` - 数据显示一致性bug修复验证
- `final-unit-fix-verification.js` - 最终单位修复验证

#### 界面和交互Bug修复
- `mobile-layout-bug-fix-verification.js` - 移动端布局bug修复验证
- `missing-close-buttons-fix-verification.js` - 缺失关闭按钮修复验证
- `metrics-reset-bug-fix-verification.js` - 指标重置bug修复验证

#### 数据同步相关Bug修复
- `cloud-sync-delete-fix-verification.js` - 云同步删除功能修复验证
- `metrics-fix-verification.js` - 指标选择bug修复验证

### 🔧 功能实现验证脚本
这些脚本用于验证新功能的正确实现：

- `account-reset-verification.js` - 一键重置账户功能验证
- `save-functionality-verification.js` - 保存功能改进验证
- `custom-exercise-time-verification.js` - 自定义动作时间功能验证
- `improved-goals-system-verification.js` - 改进目标系统验证
- `add-exercise-ui-optimization-verification.js` - 添加动作界面优化验证

### 🔍 调试和分析脚本
这些脚本用于问题调试和系统行为分析：

- `cloud-sync-data-recovery-bug-analysis.js` - 云同步数据恢复bug分析
- `metrics-bug-debug.js` - 指标bug调试脚本
- `metrics-ui-bug-debug.js` - 指标UI bug调试脚本
- `unit-display-inconsistency-debug.js` - 单位显示不一致调试脚本

### 📝 文本修正验证
- `text-correction-verification.js` - 文本错误修正验证

## 🚀 使用方法

### 运行单个验证脚本
```bash
# 在项目根目录运行
node "verification scripts/script-name.js"
```

### 运行所有验证脚本
```bash
# 创建批量运行脚本
node "verification scripts/run-all-verifications.js"
```

## 📋 脚本命名规范

- **验证脚本**: `feature-name-verification.js`
- **调试脚本**: `issue-name-debug.js` 
- **分析脚本**: `problem-name-analysis.js`
- **修复验证**: `bug-name-fix-verification.js`

## 🔄 添加新脚本

当添加新的验证脚本时，请：

1. 遵循命名规范
2. 在脚本开头添加清晰的注释说明用途
3. 更新此README文件的分类列表
4. 确保脚本可以独立运行
5. 包含适当的错误处理和输出格式

## 📊 验证脚本标准格式

每个验证脚本应该包含：

```javascript
/**
 * 功能名称验证脚本
 * 
 * 验证内容：
 * - 功能点1
 * - 功能点2
 * - 功能点3
 */

console.log('🎯 开始验证 [功能名称]...\n');

// 验证逻辑
const verificationResults = [];

// 输出结果
console.log('📊 验证结果汇总');
console.log('═'.repeat(50));
console.log(`总验证项: ${total}`);
console.log(`通过项目: ${passed}`);
console.log(`失败项目: ${failed}`);
console.log(`通过率: ${(passed/total*100).toFixed(1)}%`);

console.log('\n✨ 验证完成！');
```

## 📈 验证覆盖率

目前已覆盖的验证领域：
- ✅ Bug修复验证 (15个脚本)
- ✅ 功能实现验证 (5个脚本)  
- ✅ 调试分析工具 (4个脚本)
- ✅ 界面优化验证 (1个脚本)

总计：**24个验证脚本**，覆盖了项目的主要功能和bug修复。