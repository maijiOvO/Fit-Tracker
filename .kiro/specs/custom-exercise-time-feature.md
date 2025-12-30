# 自定义动作训练时间功能规范

## 问题描述

### 当前限制
- **固定时间**: 所有动作记录都使用当前训练的日期时间
- **无法回溯**: 用户无法为过去的训练补充记录
- **时间不准确**: 用户可能在不同时间完成不同动作，但记录时间相同

### 用户需求
- **自定义时间**: 允许用户为每个动作设置具体的训练时间
- **灵活编辑**: 在添加动作时和历史记录中都能修改时间
- **时间精度**: 支持日期和时间的精确设置

## 用户故事

### 用户故事 1: 添加动作时自定义时间
**作为** 健身用户  
**我想要** 在添加动作时设置具体的训练时间  
**以便** 准确记录我实际完成训练的时间  

**验收标准**:
- [ ] 在添加动作界面显示时间选择器
- [ ] 默认显示当前时间，用户可以修改
- [ ] 支持日期和时间的独立设置
- [ ] 时间格式符合用户的语言设置
- [ ] 设置的时间保存到动作记录中

### 用户故事 2: 历史记录中编辑时间
**作为** 健身用户  
**我想要** 在历史记录中修改动作的训练时间  
**以便** 纠正错误的时间记录或补充遗漏的信息  

**验收标准**:
- [ ] 历史记录显示每个动作的具体时间
- [ ] 点击时间可以进入编辑模式
- [ ] 提供日期时间选择器
- [ ] 修改后立即保存并同步
- [ ] 修改时间不影响其他动作记录

### 用户故事 3: 批量时间设置
**作为** 健身用户  
**我想要** 为同一训练中的多个动作设置相同时间  
**以便** 快速完成时间设置  

**验收标准**:
- [ ] 提供"应用到所有动作"选项
- [ ] 支持时间间隔设置（如每个动作间隔5分钟）
- [ ] 批量设置后用户仍可单独调整

## 技术需求

### 数据结构更新

#### 动作记录结构
```typescript
interface ExerciseRecord {
  id: string;
  name: string;
  sets: SetRecord[];
  notes?: string;
  // ✅ 新增：动作的具体训练时间
  exerciseTime?: string; // ISO 8601 格式
  // ✅ 新增：动作持续时间（可选）
  duration?: number; // 秒数
}
```

#### 训练记录结构
```typescript
interface WorkoutSession {
  id: string;
  userId: string;
  date: string; // 训练日期（保持现有逻辑）
  title: string;
  exercises: ExerciseRecord[];
  notes?: string;
  // ✅ 新增：训练开始和结束时间
  startTime?: string;
  endTime?: string;
}
```

### 功能需求

#### 1. 时间选择组件
```typescript
interface TimePickerProps {
  value: string; // ISO 8601 格式
  onChange: (time: string) => void;
  label?: string;
  showSeconds?: boolean;
  minDate?: string;
  maxDate?: string;
}

const TimePicker: React.FC<TimePickerProps> = ({
  value,
  onChange,
  label,
  showSeconds = false
}) => {
  // 实现日期时间选择器
};
```

#### 2. 添加动作时的时间设置
```typescript
const addExerciseToWorkout = (
  exerciseName: string, 
  customTime?: string
) => {
  const exerciseTime = customTime || new Date().toISOString();
  
  const newExercise: ExerciseRecord = {
    id: generateExerciseId(),
    name: exerciseName,
    sets: [{ reps: 0, weight: 0 }],
    notes: '',
    exerciseTime: exerciseTime
  };
  
  // 添加到当前训练
};
```

#### 3. 历史记录时间编辑
```typescript
const updateExerciseTime = async (
  workoutId: string,
  exerciseId: string,
  newTime: string
) => {
  const workout = await db.get<WorkoutSession>('workouts', workoutId);
  const exerciseIndex = workout.exercises.findIndex(ex => ex.id === exerciseId);
  
  if (exerciseIndex !== -1) {
    workout.exercises[exerciseIndex].exerciseTime = newTime;
    await db.save('workouts', workout);
    
    // 同步到云端
    if (user && user.id !== 'u_guest') {
      performFullSync(user.id);
    }
  }
};
```

### UI/UX 需求

#### 1. 添加动作界面
- **时间选择器位置**: 在动作名称下方，metrics选择上方
- **默认行为**: 显示当前时间，用户可选择修改
- **快捷选项**: 提供"现在"、"1小时前"、"今天早上"等快捷选项

#### 2. 历史记录界面
- **时间显示**: 在动作名称旁显示具体时间（如"14:30"）
- **编辑入口**: 点击时间进入编辑模式
- **视觉区分**: 自定义时间与默认时间有不同的视觉样式

#### 3. 时间格式
```typescript
const formatExerciseTime = (time: string, lang: string) => {
  const date = new Date(time);
  
  if (lang === 'cn') {
    return {
      date: date.toLocaleDateString('zh-CN'),
      time: date.toLocaleTimeString('zh-CN', { 
        hour: '2-digit', 
        minute: '2-digit' 
      })
    };
  } else {
    return {
      date: date.toLocaleDateString('en-US'),
      time: date.toLocaleTimeString('en-US', { 
        hour: '2-digit', 
        minute: '2-digit' 
      })
    };
  }
};
```

### 数据迁移需求

#### 1. 现有数据兼容
```typescript
const migrateExistingData = async () => {
  const workouts = await db.getAll<WorkoutSession>('workouts');
  
  for (const workout of workouts) {
    let hasChanges = false;
    
    for (const exercise of workout.exercises) {
      if (!exercise.exerciseTime) {
        // 为现有动作设置默认时间（使用训练日期）
        exercise.exerciseTime = new Date(workout.date).toISOString();
        hasChanges = true;
      }
    }
    
    if (hasChanges) {
      await db.save('workouts', workout);
    }
  }
};
```

## 实现计划

### 阶段1: 核心功能实现
1. [ ] 更新数据结构，添加exerciseTime字段
2. [ ] 实现TimePicker组件
3. [ ] 在添加动作时集成时间选择
4. [ ] 实现历史记录时间编辑功能

### 阶段2: UI优化
1. [ ] 优化时间选择器的用户体验
2. [ ] 添加快捷时间选项
3. [ ] 实现批量时间设置功能
4. [ ] 优化历史记录的时间显示

### 阶段3: 高级功能
1. [ ] 添加训练持续时间统计
2. [ ] 实现时间范围筛选
3. [ ] 添加时间相关的数据分析
4. [ ] 优化数据同步逻辑

## 测试用例

### 测试用例1: 添加动作时设置自定义时间
**前置条件**: 用户正在添加新动作  
**操作步骤**:
1. 选择动作名称
2. 点击时间选择器
3. 设置自定义时间
4. 保存动作

**预期结果**:
- 动作记录包含设置的自定义时间
- 时间格式正确显示
- 数据正确保存到数据库

### 测试用例2: 历史记录中编辑时间
**前置条件**: 用户有历史训练记录  
**操作步骤**:
1. 进入历史记录界面
2. 点击某个动作的时间
3. 修改时间
4. 保存修改

**预期结果**:
- 时间修改成功
- 界面立即更新显示新时间
- 数据同步到云端

### 测试用例3: 数据迁移
**前置条件**: 存在没有exerciseTime的历史数据  
**操作步骤**:
1. 启动应用
2. 触发数据迁移
3. 查看历史记录

**预期结果**:
- 所有历史动作都有时间信息
- 时间默认为训练日期
- 不影响现有功能

## 风险评估

### 高风险
- **数据迁移**: 需要确保现有数据的完整性
- **时区处理**: 不同时区的时间显示和存储

### 中风险
- **性能影响**: 时间选择器可能影响界面响应速度
- **用户体验**: 复杂的时间设置可能困扰用户

### 低风险
- **UI一致性**: 时间选择器需要与应用整体风格一致
- **本地化**: 不同语言的时间格式处理

## 成功标准

1. **功能完整性**: 用户可以在所有需要的地方设置和编辑时间
2. **数据准确性**: 时间信息准确保存和显示
3. **用户体验**: 时间设置流程简单直观
4. **系统稳定性**: 新功能不影响现有功能
5. **数据一致性**: 时间信息正确同步到所有设备

## 验收标准

- [ ] 所有测试用例通过
- [ ] 数据迁移成功完成
- [ ] 用户体验测试通过
- [ ] 性能测试通过
- [ ] 多语言支持测试通过