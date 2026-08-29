
export enum Language {
  EN = 'en',
  CN = 'cn'
}

export interface User {
  id: string;
  username: string;
  email: string;
  avatarUrl?: string;
}

export type BodyweightMode = 'normal' | 'weighted' | 'assisted';
export type ExerciseCategory = 'STRENGTH' | 'CARDIO' | 'FREE' | 'OTHER';

export interface SetLog {
  id: string;
  weight: number; 
  reps: number;
  /** Duration in seconds (e.g. cardio / timed sets) */
  duration?: number;
  /** Optional score / output used for completeness checks */
  score?: number;
  time?: number; 
  timeUnit?: 's' | 'm' | 'h';
  distance?: number;
  distanceUnit?: 'km' | 'm';
  bodyweightMode?: BodyweightMode;
  /**
   * 这一组做到力竭。
   *
   * 只能由用户上报 —— App 算不出来「你是不是真的推不动了」。
   * 它是渐进超负荷唯一可靠的信号：没有它，「这周该不该加重量」
   * 只能靠记忆（SetCapsule.tsx 里那句「递减组多半做到力竭」的注释，
   * 说明这个概念早就在决策里，只是一直没被记下来）。
   *
   * 可选字段：远端旧快照没有它，合并时天然兼容，不需要迁移。
   */
  toFailure?: boolean;

  /**
   * 底稿行（§12.6 预填）：添加练过的动作时，上次同动作的每一组
   * 以「淡墨底稿」预填进来。底稿不是事实 ——
   *   点组号照抄 / 改任何一格 都会把它转正（ghost 清掉）；
   *   结束训练时仍是 ghost 的行整组丢弃，绝不静默入册。
   * 可选字段，远端旧快照天然兼容。
   */
  ghost?: boolean;

  /**
   * 退回凭据（§12.6 误触）。
   *
   * 描实是全站唯一「零输入就产生数据」的路径，原先还不可逆 ——
   * 误点一下组号（或误点竭顺带描实）就凭空多出一条你没做过的记录，
   * 它会进 PR / bestLifts / 图表 / 容量，而删一组反倒要长按 400ms 保险。
   *
   * 这个字段只在「一击描实、且此后没改过任何值」时存在。它还在，
   * 就说明行里的值仍是底稿原值 —— 退回是无损的，不必另存一份快照。
   * 任何值编辑都会清掉它（改过的行退回等于丢弃真实输入，只能走长按删除）；
   * 结束训练时随 ghost 一并剥掉，不进历史。
   */
  fromGhost?: boolean;

  // ✅ 增强：递增递减组子组数据
  subSets?: SubSetLog[];
}

// ✅ 新增：子组数据结构
export interface SubSetLog {
  id: string;
  weight: number;    // 独立的重量设置
  reps: number;      // 独立的次数设置
  restSeconds?: number; // 子组间休息时间（可选）
  note?: string;     // 子组备注（可选）
}

export interface Exercise {
  id: string;
  name: string;
  category: string; 
  bodyPart?: string; 
  sets: SetLog[];
  tags?: string[];
  // ✅ 新增：动作的具体训练时间
  exerciseTime?: string; // ISO 8601 格式
  // ✅ 新增：动作持续时间（可选）
  duration?: number; // 秒数
  
  /**
   * 底稿的出处（§12.6）：预填自哪一场训练的 date（ISO）。
   * 只在工作台里给眉批「底稿 · 上次 X月X日」用，结束训练时剥掉。
   */
  prefillFrom?: string;

  /**
   * 底稿来源那一场的场地（§12.11），**仅在与本场不同时**才写。
   * 换馆那天预填照抄的重量是按另一套刻度记的，眉批要把这件事摊开。
   * 同 prefillFrom：只服务工作台眉批，结束训练时剥掉。
   */
  prefillGym?: string;

  // ✅ 增强：动作实例的特殊配置（用户可自定义）
  instanceConfig?: {
    enablePyramid: boolean;       // 本次训练是否启用递增递减组
    pyramidMode?: 'increasing' | 'decreasing' | 'mixed'; // 递增递减模式
    bodyweightMode: 'none' | 'bodyweight' | 'assisted' | 'weighted'; // 本次训练的自重模式
    autoCalculateSubSets?: boolean; // 是否自动计算子组重量/次数
  };
}

export interface ExerciseDefinition {
  id: string;
  name: {
    en: string;
    cn: string;
  };
  bodyPart: string;
  tags: string[];
  // ✅ 新增这一行，允许存储分类信息
  category?: ExerciseCategory;
  
  // ✅ 增强：动作特殊属性配置
  exerciseConfig?: {
    supportsPyramid: boolean;     // 是否支持递增递减组
    pyramidModes?: ('increasing' | 'decreasing' | 'mixed')[]; // 支持的递增递减模式
    bodyweightType: 'none' | 'bodyweight' | 'assisted' | 'weighted'; // 自重类型
    defaultBodyweightMode?: BodyweightMode; // 默认自重模式
    maxSubSets?: number; // 最大子组数量限制
  };
}

export interface WorkoutSession {
  id: string;
  userId: string;
  date: string;
  title: string;
  exercises: Exercise[];
  notes?: string;
  // ✅ 训练开始和结束时间
  startTime?: string;
  endTime?: string;
  /** IndexedDB / 远端同步可选字段 */
  duration?: number;
  tags?: string[];
  /** 来自训练计划标记 */
  fromSchedule?: WorkoutFromSchedule;
  /**
   * 这一场在哪个馆练的（§12.11）。存**字面量**（'F4L' / '国内'），不存 id ——
   * 场地表如果放进 prefs，就得同时改 FitlogSyncedPrefs / read / write /
   * mergeFitlogPrefs 四处枚举，漏一处每次同步都会静默吞掉它。候选列表改成
   * 从历史 workouts 现算（src/utils/gyms.ts），零同步面。
   *
   * 只做标注，不参与任何计算：PR / bestLifts / e1RM 一律不按场地分组 ——
   * 杠铃跨馆一致，会变的是龙门架/绳索的配重刻度，而那些动作本来就不看纪录。
   *
   * 可选字段：新增前的历史记录没有它，合并时天然兼容，不做回填。
   */
  gym?: string;
  createdAt?: string;
  updatedAt?: string;
  /** 训练实际结束时间（ISO 8601）。为空表示用户尚未手动结束 */
  finishedAt?: string;
  /** @deprecated 保留向后兼容，不再用于分流 UI */
  status?: 'draft' | 'completed';
}

/** 体脂、围度等记录在 IndexedDB `custom_metrics` */
export interface Measurement {
  id: string;
  userId: string;
  name: string;
  value: number;
  unit: string;
  date: string;
  createdAt?: string;
}

export interface WeightEntry {
  id: string;
  userId: string;
  weight: number;
  date: string;
  unit: 'kg' | 'lbs';
  createdAt?: string;
}

export type GoalType = 'weight' | 'strength' | 'frequency' | 'bodyMetrics' | 'custom';

export interface Goal {
  id: string;
  userId: string;
  type: GoalType;
  category: string; // 'weightLoss', 'benchPress', 'weeklyWorkouts', etc.
  
  // 基本信息
  title: string;
  description?: string;
  
  // 目标设置
  targetValue: number;
  currentValue: number;
  unit: string;
  
  // 时间设置
  startDate: string;
  targetDate?: string;
  
  // 数据源配置
  dataSource: 'auto' | 'manual';
  autoUpdateRule?: {
    sourceType: 'workouts' | 'weightLogs' | 'measurements';
    calculation: 'max' | 'latest' | 'average' | 'count';
    exerciseName?: string; // 用于力量目标
  };
  
  // 进度追踪
  progressHistory: Array<{
    date: string;
    value: number;
    note?: string;
  }>;
  
  // 设置选项
  isActive: boolean;
  
  // 元数据
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  
  // 兼容旧版本
  label?: string; // 兼容旧版本
  deadline?: string; // 兼容旧版本
}

// 工作集合的训练「来源」：来自训练计划时记录是否照计划完成
export interface WorkoutFromSchedule {
  scheduleId: string;
}

// 训练计划：用户为未来某一天安排的训练
export interface ScheduledExercise {
  id: string;
  name: string;                  // 与 ExerciseDefinition.name (en/cn) 或 customExercises 一致
  category: ExerciseCategory;
  /** 训练部位标签 id（取自 BODY_PARTS 或自定义 bodyPart 标签） */
  bodyPart?: string;
  /** 器材 / 通用 标签集合（取自 EQUIPMENT_TAGS 或自定义 equipment 标签） */
  tags?: string[];
  targetSets?: number;
  targetReps?: number;
  targetWeight?: number;         // kg，使用时按 unit 显示
  notes?: string;
}

export type ScheduleStatus = 'planned' | 'completed' | 'skipped';

export interface ScheduledWorkout {
  id: string;
  userId: string;
  date: string;                  // 'YYYY-MM-DD' 本地日期
  title?: string;
  bodyParts: string[];           // tag id（沿用 customTags.bodyPart）
  exercises: ScheduledExercise[];
  notes?: string;
  status: ScheduleStatus;
  linkedWorkoutId?: string;      // 完成后关联到 WorkoutSession.id
  createdAt: string;
  updatedAt: string;
}

export interface PRRecord {
  id: string;
  exerciseName: string;
  weight: number; 
  date: string;
}

export interface TranslationStrings {
  [key: string]: {
    en: string | string[];
    cn: string | string[];
  };
}

