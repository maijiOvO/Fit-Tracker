/**
 * 动作实例配置（负重/辅助标记、子组配置）相关的纯函数
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

/**
 * 负重/辅助标记（合并了旧的实例级 + 组级双层 bodyweightMode）。
 * 旧数据里的 'bodyweight' 档等价于「标准」（纯自重 = 隐藏重量列，走指标配置）。
 */
export type LoadMode = 'none' | 'weighted' | 'assisted';

export function getLoadMode(exercise: Exercise): LoadMode {
  const m = getExerciseConfig(exercise).bodyweightMode;
  return m === 'weighted' || m === 'assisted' ? m : 'none';
}
