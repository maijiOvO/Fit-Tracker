
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
  /**
   * 「杠铃片」：登记这组重量时用的单位 = 杆上挂的是 kg 片还是磅片（2026-10-18 用户定：按登记时的单位，
   * 不按健身房）。之后切显示单位，片子不变，只是换算着标。老数据没有，见 src/utils/plates.ts plateUnitOf。
   */
  plateUnit?: 'kg' | 'lbs';
  /**
   * 工作台专用（入册时剥掉）：底稿抄自上一次时那一组的原值（带符号的 kg）和当时的片子单位。
   * 只做参考：「上次 135 lb」；切单位 / 换馆时没动过的底稿从它重算，不会越换越漂。
   */
  prefillRef?: { kg: number; unit: 'kg' | 'lbs'; /** 来自计划的目标重量（标「计划 x」，不是「上次 x」） */ plan?: boolean };
  /** 工作台专用（入册时剥掉）：这个数完全是从 prefillRef 换算取整来的（没打过、没拖过、没被带着平移过） */
  draftAuto?: boolean;
  /** 工作台专用（入册时剥掉）：被带着平移时让 0 或上一行截住了，本来该是多少（带符号的 kg）；截它的让开了就回去（workbench.shiftRow / holdTouchedSubs） */
  want?: number;
  /** 工作台专用（入册时剥掉）：换了做法、新做法没练过，剩下的底稿是按新器材硬取整的 —— 标「换了做法，确认一下重量」 */
  checkWeight?: boolean;
  /** 工作台专用（入册时剥掉）：改记到不带正负的动作时辅助的数写成 0，这里记着原来带符号的 kg；改回带正负的动作、数还是 0 就还原（workbench.moveSetToExercise） */
  movedKg?: number;
  reps: number;
  /** Duration in seconds (e.g. cardio / timed sets) */
  duration?: number;
  /** Optional score / output used for completeness checks */
  score?: number;
  time?: number; 
  timeUnit?: 's' | 'm' | 'h';
  distance?: number;
  distanceUnit?: 'km' | 'm';
  /** 速度（km/h 或 mph，跟距离单位走）。值字段表见 src/utils/setValues.ts */
  speed?: number;
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
   * 以「淡墨底稿」预填进来。ghost＝待做，只管指针和选中；入不入册看 workbench.willRecord ——
   * 有数就入册，不论点没点过组号，全零的不入册（2026-11 用户定）。
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

  /**
   * 待做行上改过哪几格（第 4 条，2026-10）。工作台专用，结束训练时剥掉。
   *
   * 改过的格子不再被前面的组带着跟随；也给格子墨色用：改过的格子变实墨，组号仍是虚线印。
   * 键是 VALUE_KEYS 里的字段名。⚠️ fromGhost 已停写，旧数据里读到忽略。
   */
  touched?: Partial<Record<string, boolean>>;

  /**
   * 已停用（2026-10-15 删掉了「跳过」）：旧版工作台把「还没做、人去做别的了」的待做组记成跳过。
   * 只留着兼容旧数据：读的时候一律当待做，做完 / 退回 / 结束训练时剥掉。新代码不再写它。
   */
  skipped?: boolean;
  /**
   * 做完 / 跳过的先后（工作台专用，结束训练时剥掉）。交替组里做完的组按它排 ——
   * 实际先做哪组、后做哪组；没有它（旧数据、接回来的训练）按轮换排。
   */
  seq?: number;
  /**
   * 已停写（2026-11：有数的组都入册，不再靠它区分手加组）。只留着兼容进行中工作台里的旧数据，入册时剥掉。
   */
  added?: boolean;

  // ✅ 增强：递增递减组子组数据
  subSets?: SubSetLog[];
}

// ✅ 新增：子组数据结构
export interface SubSetLog {
  id: string;
  weight: number;    // 独立的重量设置
  /** 「杠铃片」：登记时的单位（递减档改重量时和母组一样会写上） */
  plateUnit?: 'kg' | 'lbs';
  /**
   * 工作台专用（入册时剥掉）：底稿抄自上一次时那一组的原值（带符号的 kg）和当时的片子单位。
   * 只做参考：「上次 135 lb」；切单位 / 换馆时没动过的底稿从它重算，不会越换越漂。
   */
  prefillRef?: { kg: number; unit: 'kg' | 'lbs'; /** 来自计划的目标重量（标「计划 x」，不是「上次 x」） */ plan?: boolean };
  /** 工作台专用（入册时剥掉）：这个数完全是从 prefillRef 换算取整来的（没打过、没拖过、没被带着平移过） */
  draftAuto?: boolean;
  /** 工作台专用（入册时剥掉）：被带着平移时让 0 或上一行截住了，本来该是多少（带符号的 kg）；截它的让开了就回去（workbench.shiftRow / holdTouchedSubs） */
  want?: number;
  /** 工作台专用（入册时剥掉）：换了做法、新做法没练过，剩下的底稿是按新器材硬取整的 —— 标「换了做法，确认一下重量」 */
  checkWeight?: boolean;
  /** 工作台专用（入册时剥掉）：同 SetLog.movedKg */
  movedKg?: number;
  reps: number;      // 独立的次数设置
  restSeconds?: number; // 子组间休息时间（可选）
  note?: string;     // 子组备注（可选）
  /** 母组待做时改过的格子（同 SetLog.touched，工作台专用，结束训练时剥掉） */
  touched?: Partial<Record<'weight' | 'reps', boolean>>;
  /** 带正负的负荷（2026-10 变体第二层）：这一档是辅助还是负重。不写＝跟母组同号 */
  bodyweightMode?: BodyweightMode;
}

export interface Exercise {
  id: string;
  name: string;
  category: string; 
  bodyPart?: string; 
  sets: SetLog[];
  tags?: string[];
  /**
   * 练法（第 8 条）：同一个动作的不同做法（宽握 / 窄握 / 暂停…）。一条记录只选一种。
   * variantId 指向动作定义上的 variants；variantName 是当时的名字（练法被删 / 改名后，历史仍能显示）。
   * 都没有＝「标准」。可选字段，旧记录天然归标准，不改写历史。
   */
  variantId?: string;
  variantName?: string;
  /**
   * 交替组（2026-10）：同一场里几个动作交替着做（内收 ⇄ 外展）。同一个值＝同一组，成员在 exercises 里挨着放，
   * 先后就是轮换顺序。进历史：下次加其中一个动作，底稿把同组的一起带进来、按轮换排。
   * 不影响纪录 / 统计：每个动作还是各算各的。
   */
  altGroup?: string;
  // ✅ 新增：动作的具体训练时间
  exerciseTime?: string; // ISO 8601 格式
  // ✅ 新增：动作持续时间（可选）
  duration?: number; // 秒数
  
  /**
   * 底稿的出处（§12.6）：预填自哪一场训练的 date（ISO）。
   * 结束训练时剥掉，不进历史。
   *
   * 读的地方：卡头眉批「底稿 · 10/4」（ExerciseCard，C2 起恢复），点开看那次做了哪几组。
   */
  prefillFrom?: string;

  /**
   * 底稿抄自那一场的哪几张卡（同场同项目可能有几张：计划排两行、并入上一场、复制为今天）。
   * 卡头点开的「上次」按它列组（utils/prefillSource.prefillSourceLookup）；跟着 prefillFrom 一起写、一起清，结束训练时剥掉。
   * 升级前存下的草稿没有，按「日期 + 名字 + 做法」退回那场的全部同项目卡。
   */
  prefillIds?: string[];

  /**
   * 底稿来源那一场的场地（§12.11），无条件记，「跟本场是不是同一个馆」渲染时再比。
   * 不是同一个馆时眉批写「底稿 · 在 X 10/4」（design-plates.md「换馆重量」A：本馆没练过才会抄别的馆）。
   * 同 prefillFrom：结束训练时剥掉。
   */
  prefillGym?: string;

  /**
   * 旧的整场号：组上没写 bodyweightMode 时按它算（load.setSign）。
   * 旧记录里还可能带着 enablePyramid / pyramidMode / autoCalculateSubSets（递增递减组的早期配置），已停写、没有读取方。
   */
  instanceConfig?: {
    bodyweightMode: 'none' | 'bodyweight' | 'assisted' | 'weighted';
  };
}

/**
 * 做法（变体第一层，原「练法」）：同一个动作的不同做法（宽握 / 窄握 / V 把…）。
 * 可以带自己的细分和器材：添加动作的细分格里，带细分的做法单独成一张小卡、落在自己那一列
 * （用户要找的是「练到这块肌肉的动作」，具体是哪个动作的哪种做法不那么重要）。
 * 不写 region / tags＝跟动作本身走。
 */
export interface ExerciseVariant {
  id: string;
  name: string;
  /** 主细分（细分格里只摆在这一列）；不写＝跟动作走 */
  region?: string;
  /** 全部细分（多选，2026-10-21），主细分在前；读法同 ExerciseDefinition.regions */
  regions?: string[];
  /** 做法自己的器材；'' / 不写 = 跟动作走（src/utils/exerciseAttrs.ts） */
  equipment?: string;
  /** 做法自己的阻力类型；不写 = 跟器材默认 */
  resistance?: import('./src/utils/exerciseAttrs').Resistance;
  /** 旧字段（多选器材）：只读来换算、写时镜像 [equipment] 给旧版 APK */
  tags?: string[];
}

export interface ExerciseDefinition {
  id: string;
  /** 「杠铃片」：这个动作用哪根杠（标准 / 女子 / 短杠），每个动作记住自己的。不写 = 标准杠 */
  bar?: import('./src/utils/plates').BarChoice;
  name: {
    en: string;
    cn: string;
  };
  bodyPart: string;
  /**
   * 器材（单选，2026-10-20 起；原多选 tags）。'' = 无器材。
   * 内置 / 自建器材 id，见 src/utils/exerciseAttrs.ts。没写的旧数据按 tags 换算（legacyAttrs）。
   */
  equipment?: string;
  /** 阻力类型：重量从哪来、一格多少。不写 = 跟器材默认；只有器械 / 自建器材 / 无器材能改 */
  resistance?: import('./src/utils/exerciseAttrs').Resistance;
  /** 旧字段（多选器材标签）：只读来换算，写时镜像 [equipment] 给旧版 APK */
  tags?: string[];
  /**
   * 曾用名（第 7 条改名）。历史记录里存的是当时的名字，**一律不改写**；
   * 名字解析认「原名 + 曾用名 + 现名」，所以改过几次名，旧记录都还认得回来。
   * 内置动作改名时旧名写在这里；用户改名时旧名推进 exerciseOverrides[id].aliases
   * （放进已有的同步容器，不新增 prefs key）。可选字段，旧数据天然兼容。
   */
  aliases?: string[];
  /**
   * 部位细分（第 3 条）：系统细分 id（BODY_REGIONS）或自建细分标签 id。
   * 不属于当前部位就当「未细分」（部位改过的情况）。'' = 明确放回未细分（覆盖层用）。
   */
  region?: string;
  /**
   * 全部细分（2026-10-21 起多选：深蹲练股四也练臀），主细分在前。region 仍是主细分、照旧单独存：
   * 旧版 APK、拖到细分都只认它。读的时候主细分以 region 为准，这里别的几个当次要细分
   * （添加动作的细分格里只出现在主细分那一列，次要的能搜到）。没有 region＝未细分，这里不单独生效。
   * 见 src/utils/exerciseAttrs.ts regionList。
   */
  regions?: string[];
  /** 停用：旧版「拖到细分」写的列内手动顺序。拖排序 10-27 已删，留在旧数据里不读不写 */
  regionRank?: number;
  /**
   * 热身用途（2026-10-27，原各部位的「热身」细分）：这个动作出现在哪几个部位的热身里（部位 id）。
   * 不写 / 空＝不当热身。和训练的部位 / 细分互不影响：蝴蝶机夹胸既是内侧的训练动作，也在胸部热身里。
   */
  warmParts?: string[];
  /** 只当热身、不是训练动作（手臂绕环）：训练的部位 / 细分组里不出现。只在 warmParts 非空时有意义 */
  warmOnly?: boolean;
  /**
   * 练法（第 8 条）。内置动作写在覆盖层、自建动作写在定义本身（已有同步容器）。
   * 底稿预填、PR、PR 列表、趋势图按「动作 + 练法」分开；备注与动作设置按动作共享。
   */
  variants?: ExerciseVariant[];
  /** 用户删掉的内置做法 id（只写覆盖层）：读时合并内置做法时跳过它们（utils/exerciseAttrs.combineVariants） */
  removedVariants?: string[];
  /**
   * 做法墓碑：用户删掉的自己的做法，整条留着（id、名字、器材、细分），删得晚的在后。
   * 记录上的 id 认不出时按它显示名字、取器材；同名新建时接回旧 id，底稿 / 馆设置 / 稳定键都接回旧记录（utils/exerciseMerge）。
   * 自建动作写定义本身、内置动作写覆盖层，放在已有的同步容器里，不新增 prefs key。
   */
  deletedVariants?: ExerciseVariant[];
  /**
   * 带正负的负荷（2026-10 变体第二层）：自重类动作的重量记成一条数轴 —— 辅助为负、自重 0、负重为正，
   * 从辅助一路练到负重是连续的，纪录按带符号的数比。不写＝按默认（内置自重类 / 带「自重」器材标签的开）。
   * 内置动作写覆盖层、自建动作写定义本身。
   */
  signedLoad?: boolean;
  /**
   * 并进来的动作（「并入另一个动作」）：旧名 → 它变成的那个做法 id。
   * 历史记录不改写：记录里存的还是旧名、没有 variantId，名字解析认到这个动作、做法按这张表认。
   * 旧名的记录自带源动作自己的做法时，做法 id 读成「并入做法/源做法」（utils/liftIdentity.variantIdIn）。
   * 按名字存的备注、记录项、收藏不认这张表（留在源名下，拆回就恢复）；馆设置在并入那一下复制过来。
   */
  variantAliases?: Record<string, string>;
  /** 这个动作已并入另一个动作（只写覆盖层）：名字解析把它的名字全交给那个动作，动作库里不再出现 */
  mergedInto?: string;
  /**
   * 从动作库删除（2026-10 起内置 / 自建一律只隐藏，可在「整理 → 已删除」恢复）。
   * 只写在覆盖层 exerciseOverrides[id] 上；定义本身不动，历史记录照样认得这个名字。
   */
  hidden?: boolean;
  // ✅ 新增这一行，允许存储分类信息
  category?: ExerciseCategory;
  
  // 内置动作的特殊属性
  exerciseConfig?: {
    bodyweightType: 'none' | 'bodyweight' | 'assisted' | 'weighted'; // 自重类型
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
  /**
   * 开练时选的部位（部位 id，如 subBack）：这一场之后每次「添加动作」默认停在这一栏（2026-10-21 用户定）。
   * 标题会被改名，不能从标题反推；没选部位（「其他」、旧数据、编辑历史）就没有。
   */
  focusPart?: string;
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
  /** 最后一次改动（同步合并按它比；旧记录没有，退回 createdAt / date） */
  updatedAt?: string;
}

export interface WeightEntry {
  id: string;
  userId: string;
  weight: number;
  date: string;
  unit: 'kg' | 'lbs';
  createdAt?: string;
  /** 最后一次改动（同步合并按它比；旧记录没有，退回 date） */
  updatedAt?: string;
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

