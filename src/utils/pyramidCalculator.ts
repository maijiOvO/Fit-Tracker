/**
 * 金字塔训练计算器
 */
import { SubSetLog, PyramidCalculator } from '../types';

/**
 * 计算金字塔子组
 */
export const calculatePyramidSubSets = (config: PyramidCalculator): SubSetLog[] => {
  const subSets: SubSetLog[] = [];
  
  for (let i = 0; i < config.subSetCount; i++) {
    let weight = config.baseWeight;
    let reps = config.baseReps;
    
    switch (config.mode) {
      case 'decreasing':
        weight = config.baseWeight * (1 - (config.weightStep / 100) * (i + 1));
        break;
      case 'increasing':
        weight = config.baseWeight * (1 + (config.weightStep / 100) * (i + 1));
        break;
      case 'mixed':
        // 先增后减的金字塔模式
        const midPoint = Math.floor(config.subSetCount / 2);
        if (i < midPoint) {
          weight = config.baseWeight * (1 + (config.weightStep / 100) * (i + 1));
        } else {
          weight = config.baseWeight * (1 - (config.weightStep / 100) * (i - midPoint));
        }
        break;
    }
    
    // 次数策略
    switch (config.repsStrategy) {
      case 'increasing':
        reps = config.baseReps + i;
        break;
      case 'decreasing':
        reps = Math.max(1, config.baseReps - i);
        break;
      case 'failure':
        reps = i === config.subSetCount - 1 ? -1 : config.baseReps; // -1 表示力竭
        break;
      // 'constant' 保持不变
    }
    
    subSets.push({
      id: `subset_${Date.now()}_${i}`,
      weight: Math.round(weight * 2) / 2, // 四舍五入到0.5kg
      reps: reps,
      restSeconds: 15,
      note: ''
    });
  }
  
  return subSets;
};
