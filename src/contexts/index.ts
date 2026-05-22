/**
 * Contexts 入口文件
 * 统一导出所有 Context Providers
 */

export { AuthProvider, useAuthContext } from './AuthContext';
export { WorkoutProvider, useWorkoutContext } from './WorkoutContext';
export { GoalsProvider, useGoalsContext } from './GoalsContext';
export { ScheduleProvider, useScheduleContext } from './ScheduleContext';
export { AssistantProvider, useAssistantContext } from './AssistantContext';
export { UserSettingsProvider, useUserSettingsContext } from './UserSettingsContext';
export { UiOverlayProvider, useUiOverlay } from './UiOverlayContext';
export { ExercisePrefsProvider, useExercisePrefs } from './ExercisePrefsContext';
export type { CustomTag } from './ExercisePrefsContext';
