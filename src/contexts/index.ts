/**
 * Contexts 入口文件
 * 统一导出所有 Context Providers
 */

export { AvatarProvider, useAvatar } from './AvatarContext';
export { WorkoutProvider, useWorkoutContext } from './WorkoutContext';
export { GoalsProvider, useGoalsContext } from './GoalsContext';
export { ScheduleProvider, useScheduleContext } from './ScheduleContext';
export { UserSettingsProvider, useUserSettingsContext } from './UserSettingsContext';
export { UiOverlayProvider, useUiOverlay } from './UiOverlayContext';
export { ExercisePrefsProvider, useExercisePrefs } from './ExercisePrefsContext';
export type { CustomTag } from './ExercisePrefsContext';
