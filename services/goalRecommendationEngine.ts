import { Goal, GoalRecommendation, WorkoutSession, WeightEntry } from '../types';
import { db } from './db';

/**
 * 目标推荐引擎
 * 基于用户历史数据智能推荐合适的目标
 */
export class GoalRecommendationEngine {
  
  /**
   * 为用户推荐目标
   */
  async recommendGoals(userId: string): Promise<GoalRecommendation[]> {
    try {
      const recommendations: GoalRecommendation[] = [];
      
      // 获取用户历史数据
      const [workouts, weightEntries, measurements, existingGoals] = await Promise.all([
        this.getUserWorkouts(userId),
        this.getUserWeightEntries(userId),
        this.getUserMeasurements(userId),
        this.getUserGoals(userId)
      ]);
      
      // 力量目标推荐
      if (workouts.length >= 5) {
        const strengthRecs = await this.recommendStrengthGoals(workouts, existingGoals);
        recommendations.push(...strengthRecs);
      }
      
      // 体重目标推荐
      if (weightEntries.length >= 3) {
        const weightRecs = await this.recommendWeightGoals(weightEntries, existingGoals);
        recommendations.push(...weightRecs);
      }
      
      // 训练频率目标推荐
      if (workouts.length >= 2) {
        const frequencyRecs = await this.recommendFrequencyGoals(workouts, existingGoals);
        recommendations.push(...frequencyRecs);
      }
      
      // 身体指标目标推荐
      if (measurements.length >= 2) {
        const metricsRecs = await this.recommendBodyMetricsGoals(measurements, existingGoals);
        recommendations.push(...metricsRecs);
      }
      
      // 按置信度排序
      return recommendations.sort((a, b) => b.confidence - a.confidence);
      
    } catch (error) {
      console.error('生成目标推荐失败:', error);
      return [];
    }
  }

  /**
   * 推荐力量目标
   */
  private async recommendStrengthGoals(
    workouts: WorkoutSession[], 
    existingGoals: Goal[]
  ): Promise<GoalRecommendation[]> {
    const recommendations: GoalRecommendation[] = [];
    const currentPRs = this.calculateCurrentPRs(workouts);
    
    // 过滤掉已有的力量目标
    const existingStrengthGoals = existingGoals.filter(g => g.type === 'strength');
    
    for (const [exerciseName, prData] of Object.entries(currentPRs)) {
      // 检查是否已有该动作的目标
      const hasExistingGoal = existingStrengthGoals.some(g => 
        g.autoUpdateRule?.exerciseName === exerciseName
      );
      
      if (!hasExistingGoal && prData.workoutCount >= 3) {
        const recommendedIncrease = this.calculateRecommendedIncrease(prData);
        const recommendedTarget = prData.maxWeight + recommendedIncrease;
        
        recommendations.push({
          type: 'strength',
          category: 'exercisePR',
          title: `${exerciseName} PR突破`,
          description: `挑战你的${exerciseName}个人最佳记录`,
          currentValue: prData.maxWeight,
          recommendedTarget,
          unit: 'kg',
          reasoning: `基于你最近${prData.workoutCount}次${exerciseName}训练，当前PR是${prData.maxWeight}kg，建议目标${recommendedTarget}kg（提升${recommendedIncrease}kg）`,
          confidence: this.calculateStrengthConfidence(prData)
        });
      }
    }
    
    return recommendations;
  }

  /**
   * 推荐体重目标
   */
  private async recommendWeightGoals(
    weightEntries: WeightEntry[], 
    existingGoals: Goal[]
  ): Promise<GoalRecommendation[]> {
    const recommendations: GoalRecommendation[] = [];
    
    // 检查是否已有体重目标
    const hasWeightGoal = existingGoals.some(g => g.type === 'weight');
    if (hasWeightGoal) return recommendations;
    
    const sortedEntries = weightEntries.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    const currentWeight = sortedEntries[0].weight;
    const unit = sortedEntries[0].unit;
    
    // 分析体重趋势
    const trend = this.analyzeWeightTrend(weightEntries);
    
    if (trend.direction === 'increasing' && trend.rate > 0.2) {
      // 体重上升趋势，推荐减重目标
      const recommendedTarget = currentWeight - (currentWeight * 0.05); // 建议减重5%
      
      recommendations.push({
        type: 'weight',
        category: 'weightLoss',
        title: '健康减重目标',
        description: '基于你的体重趋势，建议设置减重目标',
        currentValue: currentWeight,
        recommendedTarget,
        unit,
        reasoning: `你的体重呈上升趋势（每周约${trend.rate.toFixed(1)}${unit}），建议设置减重目标来保持健康体重`,
        confidence: 0.8
      });
    } else if (trend.direction === 'decreasing' && trend.rate > 0.3) {
      // 体重下降过快，推荐维持目标
      recommendations.push({
        type: 'weight',
        category: 'weightMaintenance',
        title: '体重维持目标',
        description: '保持当前健康的体重水平',
        currentValue: currentWeight,
        recommendedTarget: currentWeight,
        unit,
        reasoning: `你的体重下降较快，建议设置维持目标来稳定体重`,
        confidence: 0.7
      });
    } else if (trend.direction === 'stable') {
      // 体重稳定，可以推荐微调目标
      const bmi = this.estimateBMI(currentWeight, unit);
      if (bmi && bmi > 25) {
        const recommendedTarget = currentWeight - (currentWeight * 0.03); // 建议减重3%
        
        recommendations.push({
          type: 'weight',
          category: 'weightLoss',
          title: '优化体重目标',
          description: '进一步优化你的体重水平',
          currentValue: currentWeight,
          recommendedTarget,
          unit,
          reasoning: `你的体重相对稳定，可以考虑适度减重来达到更理想的体重水平`,
          confidence: 0.6
        });
      }
    }
    
    return recommendations;
  }

  /**
   * 推荐训练频率目标
   */
  private async recommendFrequencyGoals(
    workouts: WorkoutSession[], 
    existingGoals: Goal[]
  ): Promise<GoalRecommendation[]> {
    const recommendations: GoalRecommendation[] = [];
    
    // 检查是否已有频率目标
    const hasFrequencyGoal = existingGoals.some(g => g.type === 'frequency');
    if (hasFrequencyGoal) return recommendations;
    
    const weeklyFrequency = this.calculateAverageWeeklyFrequency(workouts);
    
    if (weeklyFrequency < 3) {
      // 训练频率较低，推荐增加
      const recommendedTarget = Math.min(weeklyFrequency + 1, 4);
      
      recommendations.push({
        type: 'frequency',
        category: 'weeklyWorkouts',
        title: '提升训练频率',
        description: '增加每周训练次数来获得更好效果',
        currentValue: weeklyFrequency,
        recommendedTarget,
        unit: '次/周',
        reasoning: `你目前平均每周训练${weeklyFrequency.toFixed(1)}次，建议增加到${recommendedTarget}次/周来获得更好的训练效果`,
        confidence: 0.8
      });
    } else if (weeklyFrequency >= 3 && weeklyFrequency < 5) {
      // 训练频率适中，推荐保持或微调
      recommendations.push({
        type: 'frequency',
        category: 'weeklyWorkouts',
        title: '保持训练频率',
        description: '维持良好的训练习惯',
        currentValue: weeklyFrequency,
        recommendedTarget: Math.ceil(weeklyFrequency),
        unit: '次/周',
        reasoning: `你的训练频率很好，建议保持每周${Math.ceil(weeklyFrequency)}次的训练节奏`,
        confidence: 0.7
      });
    }
    
    return recommendations;
  }

  /**
   * 推荐身体指标目标
   */
  private async recommendBodyMetricsGoals(
    measurements: any[], 
    existingGoals: Goal[]
  ): Promise<GoalRecommendation[]> {
    const recommendations: GoalRecommendation[] = [];
    
    // 分析各项指标
    const metricsByName = this.groupMeasurementsByName(measurements);
    
    for (const [metricName, entries] of Object.entries(metricsByName)) {
      // 检查是否已有该指标的目标
      const hasExistingGoal = existingGoals.some(g => 
        g.type === 'bodyMetrics' && g.category === metricName
      );
      
      if (!hasExistingGoal && entries.length >= 2) {
        const latestEntry = entries[0];
        const trend = this.analyzeMeasurementTrend(entries);
        
        // 根据指标类型推荐目标
        const recommendation = this.generateMetricRecommendation(metricName, latestEntry, trend);
        if (recommendation) {
          recommendations.push(recommendation);
        }
      }
    }
    
    return recommendations;
  }

  // 辅助方法

  private async getUserWorkouts(userId: string): Promise<WorkoutSession[]> {
    const allWorkouts = await db.getAll<WorkoutSession>('workouts');
    return allWorkouts.filter(w => w.userId === userId);
  }

  private async getUserWeightEntries(userId: string): Promise<WeightEntry[]> {
    const allEntries = await db.getAll<WeightEntry>('weightLogs');
    return allEntries.filter(w => w.userId === userId);
  }

  private async getUserMeasurements(userId: string): Promise<any[]> {
    const allMeasurements = await db.getAll<any>('custom_metrics');
    return allMeasurements.filter(m => m.userId === userId);
  }

  private async getUserGoals(userId: string): Promise<Goal[]> {
    const allGoals = await db.getAll<Goal>('goals');
    return allGoals.filter(g => g.userId === userId);
  }

  private calculateCurrentPRs(workouts: WorkoutSession[]): Record<string, {maxWeight: number, workoutCount: number, lastDate: string}> {
    const prs: Record<string, {maxWeight: number, workoutCount: number, lastDate: string}> = {};
    
    for (const workout of workouts) {
      for (const exercise of workout.exercises) {
        const exerciseName = exercise.name;
        
        if (!prs[exerciseName]) {
          prs[exerciseName] = {maxWeight: 0, workoutCount: 0, lastDate: workout.date};
        }
        
        prs[exerciseName].workoutCount++;
        prs[exerciseName].lastDate = workout.date;
        
        for (const set of exercise.sets) {
          if (set.weight > prs[exerciseName].maxWeight) {
            prs[exerciseName].maxWeight = set.weight;
          }
        }
      }
    }
    
    return prs;
  }

  private calculateRecommendedIncrease(prData: {maxWeight: number, workoutCount: number}): number {
    // 基于当前重量和训练次数计算建议增重
    const baseIncrease = prData.maxWeight * 0.05; // 基础5%增长
    const experienceMultiplier = Math.min(prData.workoutCount / 10, 1); // 经验系数
    
    return Math.round(baseIncrease * experienceMultiplier * 2) / 2; // 四舍五入到0.5kg
  }

  private calculateStrengthConfidence(prData: {maxWeight: number, workoutCount: number}): number {
    // 基于训练次数和重量计算推荐置信度
    const countFactor = Math.min(prData.workoutCount / 10, 1);
    const weightFactor = prData.maxWeight > 20 ? 0.9 : 0.7; // 重量越大置信度越高
    
    return countFactor * weightFactor;
  }

  private analyzeWeightTrend(weightEntries: WeightEntry[]): {direction: 'increasing' | 'decreasing' | 'stable', rate: number} {
    if (weightEntries.length < 2) return {direction: 'stable', rate: 0};
    
    const sorted = weightEntries.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    
    const weightChange = last.weight - first.weight;
    const timeSpan = (new Date(last.date).getTime() - new Date(first.date).getTime()) / (1000 * 60 * 60 * 24 * 7); // 周数
    const weeklyRate = Math.abs(weightChange / timeSpan);
    
    if (Math.abs(weightChange) < 1) {
      return {direction: 'stable', rate: weeklyRate};
    } else if (weightChange > 0) {
      return {direction: 'increasing', rate: weeklyRate};
    } else {
      return {direction: 'decreasing', rate: weeklyRate};
    }
  }

  private estimateBMI(weight: number, unit: string): number | null {
    // 简单的BMI估算（假设平均身高170cm）
    const weightInKg = unit === 'kg' ? weight : weight / 2.20462;
    const heightInM = 1.7; // 假设身高
    
    return weightInKg / (heightInM * heightInM);
  }

  private calculateAverageWeeklyFrequency(workouts: WorkoutSession[]): number {
    if (workouts.length === 0) return 0;
    
    const sorted = workouts.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    const firstDate = new Date(sorted[0].date);
    const lastDate = new Date(sorted[sorted.length - 1].date);
    
    const weeks = (lastDate.getTime() - firstDate.getTime()) / (1000 * 60 * 60 * 24 * 7);
    
    return weeks > 0 ? workouts.length / weeks : workouts.length;
  }

  private groupMeasurementsByName(measurements: any[]): Record<string, any[]> {
    const grouped: Record<string, any[]> = {};
    
    for (const measurement of measurements) {
      if (!grouped[measurement.name]) {
        grouped[measurement.name] = [];
      }
      grouped[measurement.name].push(measurement);
    }
    
    // 按日期排序
    for (const name in grouped) {
      grouped[name].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    }
    
    return grouped;
  }

  private analyzeMeasurementTrend(entries: any[]): {direction: 'increasing' | 'decreasing' | 'stable', rate: number} {
    if (entries.length < 2) return {direction: 'stable', rate: 0};
    
    const sorted = entries.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    
    const change = last.value - first.value;
    const timeSpan = (new Date(last.date).getTime() - new Date(first.date).getTime()) / (1000 * 60 * 60 * 24); // 天数
    const dailyRate = Math.abs(change / timeSpan);
    
    if (Math.abs(change) < 0.5) {
      return {direction: 'stable', rate: dailyRate};
    } else if (change > 0) {
      return {direction: 'increasing', rate: dailyRate};
    } else {
      return {direction: 'decreasing', rate: dailyRate};
    }
  }

  private generateMetricRecommendation(metricName: string, latestEntry: any, trend: any): GoalRecommendation | null {
    // 根据不同的身体指标生成推荐
    switch (metricName.toLowerCase()) {
      case '体脂率':
      case 'body fat':
        if (latestEntry.value > 20) {
          return {
            type: 'bodyMetrics',
            category: metricName,
            title: `降低${metricName}`,
            description: `优化身体成分，降低体脂率`,
            currentValue: latestEntry.value,
            recommendedTarget: latestEntry.value - 2,
            unit: latestEntry.unit,
            reasoning: `你的${metricName}为${latestEntry.value}%，建议降低到${latestEntry.value - 2}%以获得更好的身体成分`,
            confidence: 0.7
          };
        }
        break;
        
      case '肌肉量':
      case 'muscle mass':
        return {
          type: 'bodyMetrics',
          category: metricName,
          title: `增加${metricName}`,
          description: `通过力量训练增加肌肉量`,
          currentValue: latestEntry.value,
          recommendedTarget: latestEntry.value + 1,
          unit: latestEntry.unit,
          reasoning: `建议通过规律的力量训练增加${metricName}，目标增加1${latestEntry.unit}`,
          confidence: 0.8
        };
        
      default:
        return null;
    }
  }
}

// 导出单例实例
export const goalRecommendationEngine = new GoalRecommendationEngine();