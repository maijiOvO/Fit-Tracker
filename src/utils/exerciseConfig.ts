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

/**
 * 账本行的网格列宽（§6.1）。
 *
 * 父行、子组行、表头共用同一份，根治原先「表头 px-2 vs 行 p-3」的错位。
 * 行自己也要设一遍：只读的历史视图里没有 ExerciseCard 当父级，
 * 只靠父级下发的话 var(--cols) 会解析失败、网格塌成单列。
 */
export function ledgerCols(metricCount: number): string {
  // 组号 36 | 各指标 | 力竭 | 删组 44
  //
  // 力竭列不取 44：它紧挨删组按钮，两个 44 并排会把指标列挤爆，
  // 撞上硬约束 1（抬眼 0.3 秒读到重量和次数）。36 有先例——
  // 组号胶囊本身就是 36×36 且承载长按；且它左右两侧误触的代价都很低
  // （左边是输入框，点了只是聚焦；右边删组必须长按 400ms）。
  //
  // 指标 ≥3 时再收到 26：那种配置在 375px 上本来就装不下
  // （实测 26px 的「102.5」要 78px，而 3 指标每列只有 79px、输入框约 64px，
  // 加这一列之前就已经在溢出）。收窄是为了不把已经紧的场景推得更远。
  const fail = metricCount >= 3 ? 26 : 36;
  // minmax(0,1fr) 而不是 1fr：1fr 的自动最小值是 min-content，
  // 26px 数字撑不下时整行会横向溢出而不是让列收缩。
  return `36px repeat(${metricCount}, minmax(0, 1fr)) ${fail}px 44px`;
}

/**
 * 指标列对应的单位标签（按 metric 类型 + 当前单位制 + 语言返回）。
 * - reps / 自定义 → 不显示单位（避免出现「次数下面写 kg」的笑话）
 * - weight → kg / lbs，负重/辅助标记体现在符号上（备忘用途，不参与统计）
 * - duration → 不显示（值本身就是 h:m:s）
 *
 * 放这里而不是组件里：账本行要在数值右下角内嵌单位（§6.1 删掉了 10px 表头副行），
 * 而只读的历史视图也要显示，两边都得拿到它。
 */
export function metricUnitLabel(
  metric: string,
  unit: string,
  isCn: boolean,
  loadMode: LoadMode = 'none',
): string {
  switch (metric) {
    case 'weight': {
      const u = unit === 'kg' ? 'kg' : 'lbs';
      return loadMode === 'weighted' ? `+${u}` : loadMode === 'assisted' ? `−${u}` : u;
    }
    case 'reps':
      return isCn ? '次' : 'reps';
    case 'distance':
      return unit === 'kg' ? 'km' : 'mi';
    case 'speed':
      return unit === 'kg' ? 'km/h' : 'mph';
    default:
      return '';
  }
}
