/**
 * Hooks 入口文件
 * 统一导出所有自定义 Hooks
 */

export { useAuth, default as useAuthDefault } from './useAuth';
export type { AuthMode } from './useAuth';

export { useWorkout, default as useWorkoutDefault } from './useWorkout';

export { useUserSettings, default as useUserSettingsDefault } from './useUserSettings';

export { useChartData, getChartTimeRange } from './useChartData';
export type { ChartDataPoint } from './useChartData';
