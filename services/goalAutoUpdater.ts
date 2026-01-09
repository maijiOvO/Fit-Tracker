import { Goal, WorkoutSession, WeightEntry } from '../types';
import { db } from './db';

/**
 * 目标自动更新系统
 * 根据用户的训练数据自动更新目标进度
 */
export class GoalAutoUpdater {
  
  /**
   * 体重目标自动更新
   */
  async updateWeightGoals(userId: string, newWeightEntry: WeightEntry): Promise<void> {
    try {
      const allGoals = await db.getAll<Goal>('goals');
      const weightGoals = allGoals.filter(g => 
        g.userId === userId && 
        g.type === 'weight' && 
        g.isActive && 
        g.dataSource === 'auto'
      );

      for (const goal of weightGoals) {
        const oldValue = goal.currentValue;
        const newValue = newWeightEntry.weight;
        
        // 更新当前值
        goal.currentValue = newValue;
        goal.updatedAt = new Date().toISOString();
        
        // 添加进度历史
        goal.progressHistory.push({
          date: newWeightEntry.date,
          value: newValue,
          note: `自动更新：体重记录 ${newValue}${goal.unit}`
        });
        
        // 检查是否完成目标
        if (this.isGoalCompleted(goal)) {
          goal.completedAt = new Date().toISOString();
          goal.isActive = false;
        }
        
        await db.save('goals', goal);
        
        console.log(`体重目标 "${goal.title}" 已更新: ${oldValue} → ${newValue} ${goal.unit}`);
      }
    } catch (error) {
      console.error('更新体重目标失败:', error);
    }
  }

  /**
   * 力量目标自动更新
   */
  async updateStrengthGoals(userId: string, workout: WorkoutSession): Promise<void> {
    try {
      const allGoals = await db.getAll<Goal>('goals');
      const strengthGoals = allGoals.filter(g => 
        g.userId === userId && 
        g.type === 'strength' && 
        g.isActive && 
        g.dataSource === 'auto'
      );

      for (const goal of strengthGoals) {
        if (!goal.autoUpdateRule?.exerciseName) continue;
        
        const maxWeight = this.calculateMaxWeightForExercise(workout, goal.autoUpdateRule.exerciseName);
        
        if (maxWeight > goal.currentValue) {
          const oldValue = goal.currentValue;
          goal.currentValue = maxWeight;
          goal.updatedAt = new Date().toISOString();
          
          // 添加进度历史
          goal.progressHistory.push({
            date: workout.date,
            value: maxWeight,
            note: `新PR！${goal.autoUpdateRule.exerciseName} ${maxWeight}${goal.unit}`
          });
          
          // 检查是否完成目标
          if (this.isGoalCompleted(goal)) {
            goal.completedAt = new Date().toISOString();
            goal.isActive = false;
          }
          
          await db.save('goals', goal);
          
          console.log(`力量目标 "${goal.title}" 已更新: ${oldValue} → ${maxWeight} ${goal.unit}`);
        }
      }
    } catch (error) {
      console.error('更新力量目标失败:', error);
    }
  }

  /**
   * 训练频率目标自动更新
   */
  async updateFrequencyGoals(userId: string, workout: WorkoutSession): Promise<void> {
    try {
      const allGoals = await db.getAll<Goal>('goals');
      const frequencyGoals = allGoals.filter(g => 
        g.userId === userId && 
        g.type === 'frequency' && 
        g.isActive && 
        g.dataSource === 'auto'
      );

      for (const goal of frequencyGoals) {
        const currentCount = await this.calculateFrequencyCount(userId, goal);
        
        if (currentCount !== goal.currentValue) {
          const oldValue = goal.currentValue;
          goal.currentValue = currentCount;
          goal.updatedAt = new Date().toISOString();
          
          // 添加进度历史
          goal.progressHistory.push({
            date: workout.date,
            value: currentCount,
            note: `训练计数更新: ${currentCount}次`
          });
          
          // 检查是否完成目标
          if (this.isGoalCompleted(goal)) {
            goal.completedAt = new Date().toISOString();
            // 频率目标完成后不自动停用，继续计数
          }
          
          await db.save('goals', goal);
          
          console.log(`频率目标 "${goal.title}" 已更新: ${oldValue} → ${currentCount}`);
        }
      }
    } catch (error) {
      console.error('更新频率目标失败:', error);
    }
  }

  /**
   * 身体指标目标自动更新
   */
  async updateBodyMetricsGoals(userId: string, measurement: any): Promise<void> {
    try {
      const allGoals = await db.getAll<Goal>('goals');
      const metricsGoals = allGoals.filter(g => 
        g.userId === userId && 
        g.type === 'bodyMetrics' && 
        g.isActive && 
        g.dataSource === 'auto'
      );

      for (const goal of metricsGoals) {
        // 检查是否是相关的身体指标
        if (goal.category === measurement.name) {
          const oldValue = goal.currentValue;
          const newValue = measurement.value;
          
          goal.currentValue = newValue;
          goal.updatedAt = new Date().toISOString();
          
          // 添加进度历史
          goal.progressHistory.push({
            date: measurement.date,
            value: newValue,
            note: `${measurement.name}更新: ${newValue}${goal.unit}`
          });
          
          // 检查是否完成目标
          if (this.isGoalCompleted(goal)) {
            goal.completedAt = new Date().toISOString();
            goal.isActive = false;
          }
          
          await db.save('goals', goal);
          
          console.log(`身体指标目标 "${goal.title}" 已更新: ${oldValue} → ${newValue} ${goal.unit}`);
        }
      }
    } catch (error) {
      console.error('更新身体指标目标失败:', error);
    }
  }

  /**
   * 计算训练中某个动作的最大重量
   */
  private calculateMaxWeightForExercise(workout: WorkoutSession, exerciseName: string): number {
    let maxWeight = 0;
    
    for (const exercise of workout.exercises) {
      if (this.normalizeExerciseName(exercise.name) === this.normalizeExerciseName(exerciseName)) {
        for (const set of exercise.sets) {
          if (set.weight > maxWeight) {
            maxWeight = set.weight;
          }
        }
      }
    }
    
    return maxWeight;
  }

  /**
   * 计算训练频率
   */
  private async calculateFrequencyCount(userId: string, goal: Goal): Promise<number> {
    const allWorkouts = await db.getAll<WorkoutSession>('workouts');
    const userWorkouts = allWorkouts.filter(w => w.userId === userId);
    
    const now = new Date();
    const startDate = new Date(goal.startDate);
    
    // 根据目标类别计算不同的频率
    switch (goal.category) {
      case 'weeklyWorkouts':
        // 计算本周训练次数
        const weekStart = new Date(now);
        weekStart.setDate(now.getDate() - now.getDay());
        weekStart.setHours(0, 0, 0, 0);
        
        return userWorkouts.filter(w => new Date(w.date) >= weekStart).length;
        
      case 'monthlyWorkouts':
        // 计算本月训练次数
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        
        return userWorkouts.filter(w => new Date(w.date) >= monthStart).length;
        
      case 'totalWorkouts':
        // 计算总训练次数（从目标开始日期算起）
        return userWorkouts.filter(w => new Date(w.date) >= startDate).length;
        
      default:
        return 0;
    }
  }

  /**
   * 标准化动作名称（用于匹配）
   */
  private normalizeExerciseName(name: string): string {
    return name.toLowerCase().trim();
  }

  /**
   * 检查目标是否完成
   */
  private isGoalCompleted(goal: Goal): boolean {
    switch (goal.type) {
      case 'weight':
        // 体重目标：根据类别判断
        if (goal.category === 'weightLoss') {
          return goal.currentValue <= goal.targetValue;
        } else if (goal.category === 'weightGain') {
          return goal.currentValue >= goal.targetValue;
        }
        return false;
        
      case 'strength':
      case 'bodyMetrics':
        // 力量和身体指标目标：达到或超过目标值
        return goal.currentValue >= goal.targetValue;
        
      case 'frequency':
        // 频率目标：达到或超过目标值
        return goal.currentValue >= goal.targetValue;
        
      default:
        return false;
    }
  }

  /**
   * 重置周期性目标（如每周训练次数）
   */
  async resetPeriodicGoals(userId: string): Promise<void> {
    try {
      const allGoals = await db.getAll<Goal>('goals');
      const periodicGoals = allGoals.filter(g => 
        g.userId === userId && 
        g.isActive && 
        (g.category === 'weeklyWorkouts' || g.category === 'monthlyWorkouts')
      );

      const now = new Date();
      
      for (const goal of periodicGoals) {
        let shouldReset = false;
        
        if (goal.category === 'weeklyWorkouts') {
          // 检查是否是新的一周（周一重置）
          const lastUpdate = new Date(goal.updatedAt);
          const currentWeekStart = new Date(now);
          currentWeekStart.setDate(now.getDate() - now.getDay());
          currentWeekStart.setHours(0, 0, 0, 0);
          
          shouldReset = lastUpdate < currentWeekStart;
        } else if (goal.category === 'monthlyWorkouts') {
          // 检查是否是新的一月（1号重置）
          const lastUpdate = new Date(goal.updatedAt);
          const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
          
          shouldReset = lastUpdate < currentMonthStart;
        }
        
        if (shouldReset) {
          goal.currentValue = 0;
          goal.updatedAt = new Date().toISOString();
          
          // 添加重置记录
          goal.progressHistory.push({
            date: now.toISOString(),
            value: 0,
            note: `周期重置: ${goal.category}`
          });
          
          await db.save('goals', goal);
          console.log(`周期性目标 "${goal.title}" 已重置`);
        }
      }
    } catch (error) {
      console.error('重置周期性目标失败:', error);
    }
  }
}

// 导出单例实例
export const goalAutoUpdater = new GoalAutoUpdater();