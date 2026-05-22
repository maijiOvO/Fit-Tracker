/**
 * 动作实例配置（金字塔 / 自重模式 / 子组配置）相关的纯函数
 */
import { Exercise } from '../../types';

export const DEFAULT_INSTANCE_CONFIG: NonNullable<Exercise['instanceConfig']> = {
  enablePyramid: false,
  bodyweightMode: 'none',
  pyramidMode: 'decreasing',
  autoCalculateSubSets: false,
};

export function getExerciseConfig(
  exercise: Exercise,
): NonNullable<Exercise['instanceConfig']> {
  return exercise.instanceConfig || DEFAULT_INSTANCE_CONFIG;
}

export function isBodyweightMode(exercise: Exercise): boolean {
  return getExerciseConfig(exercise).bodyweightMode !== 'none';
}

export function isPyramidEnabled(exercise: Exercise): boolean {
  return getExerciseConfig(exercise).enablePyramid;
}
