import type {
  AssistantConversation,
  ExerciseDefinition,
  Goal,
  Language,
  PRRecord,
  ScheduledWorkout,
  WeightEntry,
  WorkoutSession,
  Measurement,
} from '../types';

/** 已删除实体 ID（多端同步时防止「删了又回来」） */
export interface FitlogTombstones {
  workouts?: string[];
  goals?: string[];
  weightLogs?: string[];
  customMetrics?: string[];
  prs?: string[];
  customExerciseDefs?: string[];
  scheduledWorkouts?: string[];
  assistantConversations?: string[];
}

/**
 * 与 UI / localStorage / 服务端同步的首选项（原 Supabase user_configs）
 */
export interface FitlogSyncedPrefs {
  customTags: { id: string; name: string; category: 'bodyPart' | 'equipment'; parentCategory?: string }[];
  customExercises: ExerciseDefinition[];
  exerciseNotes: Record<string, string>;
  /** @deprecated 休息计时器功能已移除，仅为兼容旧 snapshot 解析保留字段 */
  restPrefs?: Record<string, number>;
  starredExercises: Record<string, number>;
  exerciseMetricConfigs: Record<string, string[]>;
  tagRenameOverrides: Record<string, string>;
  exerciseOverrides: Record<string, Partial<ExerciseDefinition>>;
  /** 毫秒时间戳，用于与原逻辑一致地合并 starred / metricConfigs */
  starredLastUpdateMs: number;
  metricsLastUpdateMs: number;
  /** 其它 prefs 块的最后本地修改时间 */
  prefsLastUpdateMs?: number;
  lang?: Language | string;
  unit?: 'kg' | 'lbs';
  avatarDataUrl?: string | null;
  /** 是否将智能助手对话同步到远端；默认 true（未设置视为开启） */
  assistantSyncEnabled?: boolean;
}

/**
 * PUT/GET `/api/fitlog/state` 的 JSON 体（你的服务端只需持久化这段 JSON）
 */
export interface FitlogRemoteSnapshot {
  schemaVersion: 2;
  /**
   * 数据环境烙印。写入时由客户端盖章，读取时双向校验：
   * 客户端拒绝应用 env 不符的快照，服务端拒绝 env 与端点不符的写入。
   * 旧快照没有这个字段 → 视为兼容放行。
   */
  env?: 'dev' | 'prod';
  /** 客户端生成以便做简单合并参考 */
  clientExportedAt?: string;
  workouts: WorkoutSession[];
  goals: Goal[];
  weightLogs: WeightEntry[];
  customMetrics: Measurement[];
  prs: PRRecord[];
  /** IndexedDB 中的自定义动作库 */
  customExerciseDefsFromDb?: ExerciseDefinition[];
  /** 训练计划（日程） */
  scheduledWorkouts?: ScheduledWorkout[];
  /** 智能助手对话历史 */
  assistantConversations?: AssistantConversation[];
  prefs: FitlogSyncedPrefs;
  tombstones?: FitlogTombstones;
}
