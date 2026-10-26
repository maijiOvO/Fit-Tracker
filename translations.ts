
import { TranslationStrings } from './types';

export const translations: TranslationStrings = {
  appTitle: { en: 'Fit Tracker', cn: '健身记录' },
  dashboard: { en: 'PR Hub', cn: '个人记录' },
  newWorkout: { en: 'New Workout', cn: '新增训练' },
  history: { en: 'History', cn: '历史记录' },
  goals: { en: 'Goals', cn: '训练目标' },
  trainingPlan: { en: 'Plan', cn: '训练计划' },
  schedule: { en: 'Schedule', cn: '日程' },
  schedulePlanned: { en: 'Planned', cn: '计划中' },
  scheduleCompleted: { en: 'Completed', cn: '已完成' },
  scheduleSkipped: { en: 'Skipped', cn: '已跳过' },
  scheduleAdd: { en: 'Plan a session', cn: '安排训练' },
  scheduleEmptyDay: { en: 'Nothing planned for this day.', cn: '今天没有安排训练。' },
  scheduleEditTitle: { en: 'Plan training', cn: '安排训练' },
  scheduleTitleLabel: { en: 'Session title', cn: '训练标题' },
  scheduleDateLabel: { en: 'Date', cn: '日期' },
  scheduleBodyPartsLabel: { en: 'Body parts', cn: '训练部位' },
  scheduleExercisesLabel: { en: 'Exercises', cn: '训练动作' },
  scheduleNotesLabel: { en: 'Notes', cn: '备注' },
  scheduleStartSession: { en: 'Start this session', cn: '开始这次训练' },
  scheduleMarkSkipped: { en: 'Mark as skipped', cn: '标记为已跳过' },
  scheduleTargetSets: { en: 'Sets', cn: '组' },
  scheduleTargetReps: { en: 'Reps', cn: '次' },
  scheduleTargetWeight: { en: 'Weight', cn: '重量' },
  scheduleNoExercises: { en: 'No exercises planned', cn: '尚未添加动作' },
  scheduleViewSwitch: { en: 'View', cn: '视图' },
  // 个人服务器在家庭 NAS 上，经 Tailscale Funnel 暴露到公网 —— 手机不用开 Tailscale。
  // 连不上通常是手机没网 / 信号差，或 NAS / 家里网络掉线，别把人引去查 Tailscale
  remoteUnreachable: {
    en: "Can't reach the server",
    cn: '连不上服务器',
  },
  // 服务端把 API key 绑定到端点后新增的两个错误码。它们是配置问题，
  // 不是网络问题 —— 提示必须和 remoteUnreachable 区分开。
  remoteForbiddenEndpoint: {
    en: 'Rejected by the server (403): this API key is not allowed on the current endpoint. Check VITE_API_KEY / VITE_API_KEY_DEV.',
    cn: '服务器拒绝（403）：当前 API key 无权访问该端点。请检查 .env.local 里的 VITE_API_KEY / VITE_API_KEY_DEV。',
  },
  // 客户端硬守卫（fitlogRemote 的 env/端点断言）拦下的请求。它意味着这个包的
  // 构建环境和它要访问的端点对不上，属于装错包，不是网络问题。
  remoteEnvGuard: {
    en: 'Blocked locally: this build’s data environment does not match the endpoint it tried to reach. Reinstall the build that matches the environment you want.',
    cn: '已在本机拦下：这个包的数据环境与它要访问的端点不符。请改装与目标环境匹配的包。',
  },
  // 远端快照读到了，但版本号 / 环境烙印对不上：不应用，也不推送去盖它
  remoteIncompatible: {
    en: 'The server copy is from an incompatible version or another data environment. Nothing was synced, to avoid overwriting it.',
    cn: '服务器上的数据版本或数据环境与本机不符，为避免覆盖，这次没有同步。',
  },
  remoteEnvMismatch: {
    en: 'Rejected by the server (409): data environment does not match the endpoint. The write was refused to protect your data.',
    cn: '服务器拒绝（409）：数据环境与端点不符，写入已被拒绝以保护数据。',
  },
  scheduleFromLibrary: { en: 'Pick from library', cn: '从动作库选择' },
  scheduleManualRow: { en: 'Manual entry', cn: '手动添加' },
  planBadgeFaithful: { en: 'From plan', cn: '来自计划' },
  logout: { en: 'Logout', cn: '退出登录' },
  weight: { en: 'Weight', cn: '重量' },
  reps: { en: 'Reps', cn: '次数' },
  subChest: { en: 'Chest', cn: '胸部' },
  // 部位细分（第 3 条，见 constants/exercises.ts BODY_REGIONS）
  chestUpper: { en: 'Upper', cn: '上胸' },
  chestMid: { en: 'Mid', cn: '中胸' },
  chestLower: { en: 'Lower', cn: '下胸' },
  chestInner: { en: 'Inner', cn: '中缝' },
  chestOuter: { en: 'Outer', cn: '外轮廓' },
  shFront: { en: 'Front', cn: '前束' },
  shSide: { en: 'Side', cn: '中束' },
  shRear: { en: 'Rear', cn: '后束' },
  backLats: { en: 'Lats', cn: '背阔' },
  backMid: { en: 'Mid', cn: '中背' },
  backTraps: { en: 'Traps', cn: '斜方' },
  backLower: { en: 'Lower', cn: '下背' },
  armBi: { en: 'Biceps', cn: '二头' },
  armTri: { en: 'Triceps', cn: '三头' },
  armFore: { en: 'Forearm', cn: '前臂' },
  legQuad: { en: 'Quads', cn: '股四头' },
  legHam: { en: 'Hams', cn: '腘绳' },
  legGlute: { en: 'Glutes', cn: '臀' },
  legCalf: { en: 'Calves', cn: '小腿' },
  legAdd: { en: 'Adduct.', cn: '内收' },
  coreUpper: { en: 'Upper', cn: '上腹' },
  coreLower: { en: 'Lower', cn: '下腹' },
  coreObl: { en: 'Obliques', cn: '腹斜' },
  coreStab: { en: 'Stable', cn: '稳定' },
  chestWarm: { en: 'Warm-up', cn: '热身' },
  shWarm: { en: 'Warm-up', cn: '热身' },
  backWarm: { en: 'Warm-up', cn: '热身' },
  armWarm: { en: 'Warm-up', cn: '热身' },
  legWarm: { en: 'Warm-up', cn: '热身' },
  coreWarm: { en: 'Warm-up', cn: '热身' },
  subShoulder: { en: 'Shoulder', cn: '肩部' },
  subBack: { en: 'Back', cn: '背部' },
  subArms: { en: 'Arms', cn: '手臂' },
  subLegs: { en: 'Legs', cn: '腿部' },
  subCore: { en: 'Core', cn: '核心' },
  tagBarbell: { en: 'Barbell', cn: '杠铃' },
  tagDumbbell: { en: 'Dumbbell', cn: '哑铃' },
  tagBodyweight: { en: 'Bodyweight', cn: '自重' },
  tagMachine: { en: 'Machine', cn: '固定器械' },
  tagCable: { en: 'Cable Machine', cn: '龙门架' },
  tagKettlebell: { en: 'Kettlebell', cn: '壶铃' },
  tagBand: { en: 'Band', cn: '弹力带' },
  createAccount: { en: "Create One", cn: "去注册" },
  setGoal: { en: 'Add Goal', cn: '添加目标' },
  goalWeight: { en: 'Body Weight', cn: '体重目标' },
  goalStrength: { en: 'Strength PR', cn: '力量目标' },
  goalFrequency: { en: 'Workouts/Week', cn: '每周频率' },
  goalBodyMetrics: { en: 'Body Metrics', cn: '身体指标' },
  goalCustom: { en: 'Custom Goal', cn: '自定义目标' },
  target: { en: 'Target', cn: '目标值' },
  current: { en: 'Current', cn: '当前值' },

  goalsSubtitle: { en: 'Keep pushing your boundaries.', cn: '不断挑战你的极限。' },
  goalLabelPlaceholder: { en: 'Target Weight / Bench Press...', cn: '目标体重 / 卧推重量...' },
  trainingTitlePlaceholder: { en: 'Training Session Title...', cn: '训练名称...' },
  // 训练部位选择（进入训练页、还没有动作时的第一步；选完即作为训练名称）
  pickBodyPartTitle: { en: 'What are you training today?', cn: '今天练哪里' },
  partChest: { en: 'Chest', cn: '练胸' },
  partShoulders: { en: 'Shoulders', cn: '练肩' },
  partBack: { en: 'Back', cn: '练背' },
  partLegs: { en: 'Legs', cn: '练腿' },
  partArms: { en: 'Arms', cn: '练手臂' },
  partOther: { en: 'Other', cn: '其他' },
  // ── 场地（§12.11）──
  gymPickTitle: { en: 'Where are you training?', cn: '在哪个馆练的' },
  gymClear: { en: 'No gym', cn: '不标场地' },
  gymLastUsed: { en: 'last', cn: '上次' },
  confirm: { en: 'Confirm', cn: '确定' },
  addCustomExercise: { en: 'Add Custom Exercise', cn: '添加自定义动作' },
  exerciseNamePlaceholder: { en: 'Exercise Name...', cn: '动作名称...' },
  dashboardEmptyTitle: { en: 'Ignite Your Fitness Journey', cn: '开启你的健身征程' },
  dashboardEmptyDesc: { en: 'Log your first workout to see trends and records here', cn: '练完第一场，这里会显示趋势和个人纪录' },
  logWeight: { en: 'Log Weight', cn: '记录体重' },
  weightTrend: { en: 'Weight Trend', cn: '体重趋势' },
  // 在 translations.ts 中添加
  guestWarningTitle: { cn: '访客模式 (仅本地存储)', en: 'Guest Mode (Local Only)' },
  guestWarningDesc: { 
  cn: '数据仅存本机。注册账号可防丢失、跨设备同步。', 
  en: 'Data is only saved on this device. To prevent data loss and sync across devices, please register.' 
},
  strengthTraining: { cn: '力量训练', en: 'Strength' },
  cardioTraining: { cn: '有氧训练', en: 'Cardio' },
  freeTraining: { cn: '自由训练', en: 'Free' },


  distance: { cn: '距离', en: 'Distance' },
  duration: { cn: '时长', en: 'Duration' },
  speed: { cn: '速度', en: 'Speed' },
  dimensionPlaceholder: { cn: '维度名称 (如: 分数)', en: 'Metric (e.g. Score)' },

  exportSuccess: { cn: '导出成功！', en: 'Export Successful!' },
  importDesc: {
    cn: '从 JSON 文件恢复，当前数据将被替换（导入前自动存可撤销副本）',
    en: 'Restore from an exported JSON file. Current data is replaced; an undoable copy is saved first',
  },
  undoImport: { cn: '撤销上次导入', en: 'Undo last import' },
  

  // --- 新增器材/环境标签 ---
  tagOutdoor: { en: 'Outdoor', cn: '室外' },
  tagIndoor: { en: 'Indoor', cn: '室内' },
  tagBallGame: { en: 'Ball Game', cn: '球类' },
  tagGym: { en: 'Gym Equipment', cn: '健身房器材' },
  tagFullBody: { en: 'Full Body', cn: '全身' },
  subFullBody: { cn: '全身', en: 'Full Body' },

  // ✅ 问题4: 一键重置账户功能翻译
  resetAccount: { en: 'Reset Account', cn: '重置账户' },
  resetAccountWarning: { en: 'Reset Account Data', cn: '重置账户数据' },
  resetAccountDesc: { 
    en: 'This will permanently delete ALL your data including:\n\n• All workout records\n• Goals and progress\n• Custom exercises and tags\n• Body weight logs\n• Personal settings and notes\n• Profile picture\n\nThis action cannot be undone!', 
    cn: '这将永久删除您的所有数据，包括：\n\n• 所有训练记录\n• 目标和进度\n• 自定义动作和标签\n• 体重记录\n• 个人设置和备注\n• 头像图片\n\n此操作无法撤销！' 
  },
  resetConfirmText: { en: 'Type "RESET" to confirm', cn: '输入"重置"确认' },
  resetConfirmPlaceholder: { en: 'Type RESET here...', cn: '在此输入"重置"...' },
  resetCancel: { en: 'Cancel', cn: '取消' },
  resetConfirm: { en: 'Reset My Account', cn: '重置我的账户' },
  resetInProgress: { en: 'Resetting account...', cn: '正在重置账户...' },
  resetSuccess: { en: 'Account reset successfully!', cn: '账户重置成功！' },
  resetError: { en: 'Reset failed. Please try again.', cn: '重置失败，请重试。' },

  // ✅ 新增：自定义日期时间选择器翻译
  selectDate: { en: 'Select Date', cn: '选择日期' },
  selectTime: { en: 'Select Time', cn: '选择时间' },
  today: { en: 'Today', cn: '今天' },
  yesterday: { en: 'Yesterday', cn: '昨天' },
  hour: { en: 'Hour', cn: '时' },
  minute: { en: 'Minute', cn: '分' },
  monthNames: {
    en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
    cn: ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月']
  },
  weekdayNames: {
    en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    cn: ['日', '一', '二', '三', '四', '五', '六']
  },

};
