# 手动Git推送完整指南

## 1. 检查状态
```bash
# 查看当前状态
git status

# 查看修改的文件
git diff --name-only

# 查看具体修改内容（可选）
git diff
```

## 2. 暂存文件
```bash
# 添加所有修改
git add .

# 或选择性添加
git add App.tsx services/supabase.ts
```

## 3. 提交修改
```bash
git commit -m "fix: 修复云同步删除数据恢复bug

- 添加云端删除函数 deleteWeightFromCloud, deleteMeasurementFromCloud
- 修改删除操作同时删除本地和云端数据  
- 实现智能合并策略，避免覆盖用户删除操作
- 保持离线友好特性，网络异常时优雅降级
- 解决删除体重记录后同步时数据恢复的问题

Fixes: 用户删除数据后点击同步按钮数据重新出现
Tested: 体重记录删除、身体指标删除、网络异常场景"
```

## 4. 推送到远程
```bash
# 标准推送
git push

# 第一次推送新分支
git push -u origin feature/fix-cloud-sync-delete

# 强制推送（谨慎使用）
git push --force-with-lease
```

## 5. 创建版本标签（可选）
```bash
# 创建标签
git tag -a v1.2.3 -m "修复云同步删除bug - v1.2.3

主要修复:
- 云同步删除数据恢复bug
- 智能合并策略实现  
- 离线操作优化

测试通过:
- 体重记录删除测试
- 身体指标删除测试
- 网络异常场景测试
- 多设备数据一致性测试"

# 推送标签
git push origin v1.2.3
```

## 6. 验证推送结果
```bash
# 查看最新提交
git log --oneline -5

# 查看远程分支状态
git branch -r

# 查看标签
git tag -l
```

## 提交信息规范

### 格式模板
```
<type>: <简短描述>

<详细描述>
- 修复内容1
- 修复内容2
- 修复内容3

<相关信息>
Fixes: 问题描述
Tested: 测试场景
```

### Type类型
- `fix`: 修复bug
- `feat`: 新功能
- `docs`: 文档更新
- `style`: 代码格式调整
- `refactor`: 代码重构
- `test`: 测试相关
- `chore`: 构建/工具相关

### 示例
```bash
git commit -m "fix: 修复云同步删除数据恢复bug

- 添加deleteWeightFromCloud和deleteMeasurementFromCloud函数
- 修改handleDeleteWeightEntry和handleDeleteMeasurement同时删除云端数据
- 在performFullSync中实现智能合并策略
- 保持离线操作能力，网络异常时优雅降级

Fixes: 删除体重记录后同步时数据重新出现的问题
Tested: 体重删除、指标删除、网络异常、多设备同步场景"
```