/**
 * 默认动作库
 * 包含力量训练、有氧训练、自由训练三大类
 */
import { ExerciseDefinition } from '../../types';

export type ExerciseCategory = 'STRENGTH' | 'CARDIO' | 'FREE' | 'OTHER';

/**
 * 身体部位列表
 */
export const BODY_PARTS = ['subChest', 'subShoulder', 'subBack', 'subArms', 'subLegs', 'subCore', 'subFullBody'];

/**
 * 器材标签列表
 */
export const EQUIPMENT_TAGS = [
  'tagBarbell', 'tagDumbbell', 'tagMachine', 'tagCable', 
  'tagBodyweight', 'tagOutdoor', 'tagIndoor', 'tagBallGame', 'tagGym'
];

/**
 * 标准维度列表
 */
export const STANDARD_METRICS = ['weight', 'reps', 'distance', 'duration', 'speed'];

/**
 * 默认动作库
 *
 * 改内置动作的名字时，旧名必须进 aliases：历史记录里存的是旧名，不改写；
 * 名字解析靠 aliases 把旧记录认回来（ExercisePrefsContext 的名字索引）。
 */
const BASE_EXERCISES: ExerciseDefinition[] = [
  // === 胸部 (Chest) ===
  { id: 'bp_barbell', name: { en: 'Barbell Bench Press', cn: '杠铃平板卧推' }, bodyPart: 'subChest', tags: ['tagBarbell'], category: 'STRENGTH', exerciseConfig: { supportsPyramid: true, bodyweightType: 'none', pyramidModes: ['increasing', 'decreasing', 'mixed'] } },
  { id: 'bp_incline_barbell', name: { en: 'Incline Barbell Bench Press', cn: '上斜杠铃卧推' }, aliases: ['杠铃上斜卧推'], bodyPart: 'subChest', tags: ['tagBarbell'], category: 'STRENGTH', exerciseConfig: { supportsPyramid: true, bodyweightType: 'none', pyramidModes: ['increasing', 'decreasing'] } },
  { id: 'bp_dumbbell', name: { en: 'Dumbbell Bench Press', cn: '哑铃平板卧推' }, bodyPart: 'subChest', tags: ['tagDumbbell'], category: 'STRENGTH' },
  { id: 'bp_incline_dumbbell', name: { en: 'Incline Dumbbell Bench Press', cn: '上斜哑铃卧推' }, aliases: ['哑铃上斜卧推'], bodyPart: 'subChest', tags: ['tagDumbbell'], category: 'STRENGTH' },
  { id: 'fly_cable', name: { en: 'Cable Fly', cn: '绳索夹胸' }, bodyPart: 'subChest', tags: ['tagCable'], category: 'STRENGTH' },
  { id: 'press_machine_chest', name: { en: 'Machine Chest Press', cn: '器械推胸' }, bodyPart: 'subChest', tags: ['tagMachine'], category: 'STRENGTH' },
  { id: 'chest_dip', name: { en: 'Chest Dip', cn: '胸部双杠臂屈伸' }, bodyPart: 'subChest', tags: ['tagBodyweight'], category: 'STRENGTH', exerciseConfig: { supportsPyramid: true, bodyweightType: 'bodyweight', pyramidModes: ['decreasing', 'mixed'] } },
  { id: 'pushup', name: { en: 'Push-ups', cn: '俯卧撑' }, bodyPart: 'subChest', tags: ['tagBodyweight'], category: 'STRENGTH', exerciseConfig: { supportsPyramid: true, bodyweightType: 'bodyweight', pyramidModes: ['decreasing', 'increasing'] } },
  
  // === 背部 (Back) ===
  { id: 'dl_barbell', name: { en: 'Deadlift', cn: '硬拉' }, bodyPart: 'subBack', tags: ['tagBarbell'], category: 'STRENGTH' },
  { id: 'row_barbell', name: { en: 'Barbell Row', cn: '杠铃划船' }, bodyPart: 'subBack', tags: ['tagBarbell'], category: 'STRENGTH' },
  { id: 'lat_pulldown', name: { en: 'Lat Pulldown', cn: '高位下拉' }, bodyPart: 'subBack', tags: ['tagMachine', 'tagCable'], category: 'STRENGTH' },
  { id: 'row_seated_cable', name: { en: 'Seated Cable Row', cn: '坐姿划船' }, bodyPart: 'subBack', tags: ['tagCable'], category: 'STRENGTH' },
  { id: 'pu_weighted', name: { en: 'Weighted Pull-up', cn: '加重引体向上' }, bodyPart: 'subBack', tags: ['tagBodyweight'], category: 'STRENGTH', exerciseConfig: { supportsPyramid: true, bodyweightType: 'weighted', pyramidModes: ['decreasing', 'mixed'] } },
  { id: 'single_arm_db_row', name: { en: 'Single Arm Dumbbell Row', cn: '哑铃单臂划船' }, bodyPart: 'subBack', tags: ['tagDumbbell'], category: 'STRENGTH' },
  { id: 'tbar_row', name: { en: 'T-Bar Row', cn: 'T杠划船' }, bodyPart: 'subBack', tags: ['tagBarbell', 'tagMachine'], category: 'STRENGTH' },
  { id: 'hyperextension', name: { en: 'Hyperextension', cn: '山羊挺身' }, bodyPart: 'subBack', tags: ['tagBodyweight', 'tagMachine'], category: 'STRENGTH' },
  
  // === 肩部 (Shoulder) ===
  { id: 'ohp_barbell', name: { en: 'Overhead Press', cn: '杠铃推举' }, bodyPart: 'subShoulder', tags: ['tagBarbell'], category: 'STRENGTH' },
  { id: 'ohp_dumbbell', name: { en: 'Dumbbell Shoulder Press', cn: '哑铃推肩' }, bodyPart: 'subShoulder', tags: ['tagDumbbell'], category: 'STRENGTH' },
  { id: 'lat_raise_dumbbell', name: { en: 'Dumbbell Lateral Raise', cn: '哑铃侧平举' }, bodyPart: 'subShoulder', tags: ['tagDumbbell'], category: 'STRENGTH' },
  { id: 'face_pull_cable', name: { en: 'Cable Face Pull', cn: '绳索面拉' }, bodyPart: 'subShoulder', tags: ['tagCable'], category: 'STRENGTH' },
  { id: 'press_machine_shoulder', name: { en: 'Machine Shoulder Press', cn: '器械推肩' }, bodyPart: 'subShoulder', tags: ['tagMachine'], category: 'STRENGTH' },
  { id: 'arnold_press', name: { en: 'Arnold Press', cn: '阿诺德推举' }, bodyPart: 'subShoulder', tags: ['tagDumbbell'], category: 'STRENGTH' },
  { id: 'front_raise_db', name: { en: 'Dumbbell Front Raise', cn: '哑铃前平举' }, bodyPart: 'subShoulder', tags: ['tagDumbbell'], category: 'STRENGTH' },
  
  // === 腿部 (Legs) ===
  { id: 'sq_barbell', name: { en: 'Barbell Squat', cn: '深蹲' }, bodyPart: 'subLegs', tags: ['tagBarbell'], category: 'STRENGTH', exerciseConfig: { supportsPyramid: true, bodyweightType: 'none', pyramidModes: ['increasing', 'decreasing', 'mixed'] } },
  { id: 'goblet_squat', name: { en: 'Goblet Squat', cn: '高杯深蹲' }, bodyPart: 'subLegs', tags: ['tagDumbbell'], category: 'STRENGTH' },
  { id: 'leg_press', name: { en: 'Leg Press', cn: '倒蹬/腿举' }, bodyPart: 'subLegs', tags: ['tagMachine'], category: 'STRENGTH' },
  { id: 'leg_extension', name: { en: 'Leg Extension', cn: '腿屈伸' }, bodyPart: 'subLegs', tags: ['tagMachine'], category: 'STRENGTH' },
  { id: 'leg_curl', name: { en: 'Leg Curl', cn: '腿弯举' }, bodyPart: 'subLegs', tags: ['tagMachine'], category: 'STRENGTH' },
  { id: 'calf_raise', name: { en: 'Calf Raise', cn: '提踵' }, bodyPart: 'subLegs', tags: ['tagMachine', 'tagBodyweight'], category: 'STRENGTH' },
  { id: 'lunge_dumbbell', name: { en: 'Dumbbell Lunge', cn: '哑铃箭步蹲' }, bodyPart: 'subLegs', tags: ['tagDumbbell'], category: 'STRENGTH' },
  { id: 'romanian_deadlift', name: { en: 'Romanian Deadlift', cn: '罗马尼亚硬拉' }, bodyPart: 'subLegs', tags: ['tagBarbell', 'tagDumbbell'], category: 'STRENGTH' },
  
  // === 手臂 (Arms) ===
  { id: 'cu_barbell', name: { en: 'Barbell Curl', cn: '杠铃弯举' }, bodyPart: 'subArms', tags: ['tagBarbell'], category: 'STRENGTH' },
  { id: 'cu_dumbbell', name: { en: 'Dumbbell Curl', cn: '哑铃弯举' }, bodyPart: 'subArms', tags: ['tagDumbbell'], category: 'STRENGTH' },
  { id: 'cu_hammer', name: { en: 'Hammer Curl', cn: '锤式弯举' }, bodyPart: 'subArms', tags: ['tagDumbbell'], category: 'STRENGTH' },
  { id: 'tricep_pushdown', name: { en: 'Tricep Pushdown', cn: '肱三头肌下压' }, bodyPart: 'subArms', tags: ['tagCable'], category: 'STRENGTH' },
  { id: 'skull_crusher', name: { en: 'Skull Crusher', cn: '仰卧臂屈伸' }, aliases: ['哑卧臂屈伸'], bodyPart: 'subArms', tags: ['tagBarbell', 'tagDumbbell'], category: 'STRENGTH' },
  { id: 'preacher_curl', name: { en: 'Preacher Curl', cn: '牧师凳弯举' }, bodyPart: 'subArms', tags: ['tagBarbell', 'tagMachine'], category: 'STRENGTH' },
  { id: 'overhead_extension_db', name: { en: 'Overhead Tricep Extension', cn: '颈后臂屈伸' }, bodyPart: 'subArms', tags: ['tagDumbbell'], category: 'STRENGTH' },
  
  // === 核心 (Core) ===
  { id: 'plank', name: { en: 'Plank', cn: '平板支撑' }, bodyPart: 'subCore', tags: ['tagBodyweight'], category: 'STRENGTH' },
  { id: 'leg_raise', name: { en: 'Hanging Leg Raise', cn: '悬垂举腿' }, bodyPart: 'subCore', tags: ['tagBodyweight'], category: 'STRENGTH' },
  { id: 'cable_crunch', name: { en: 'Cable Crunch', cn: '绳索卷腹' }, bodyPart: 'subCore', tags: ['tagCable'], category: 'STRENGTH' },
  { id: 'russian_twist', name: { en: 'Russian Twist', cn: '俄罗斯转体' }, bodyPart: 'subCore', tags: ['tagBodyweight', 'tagDumbbell'], category: 'STRENGTH' },
  { id: 'ab_wheel', name: { en: 'Ab Wheel Rollout', cn: '健腹轮' }, bodyPart: 'subCore', tags: ['tagBodyweight'], category: 'STRENGTH' },

  // === 有氧训练 (CARDIO) ===
  { id: 'run_out', name: { en: 'Outdoor Running', cn: '室外跑步' }, bodyPart: 'subLegs', tags: ['tagOutdoor'], category: 'CARDIO' },
  { id: 'run_tread', name: { en: 'Treadmill', cn: '跑步机' }, bodyPart: 'subLegs', tags: ['tagIndoor', 'tagGym'], category: 'CARDIO' },
  { id: 'bike_out', name: { en: 'Outdoor Cycling', cn: '室外骑行' }, bodyPart: 'subLegs', tags: ['tagOutdoor'], category: 'CARDIO' },
  { id: 'bike_stat', name: { en: 'Stationary Bike', cn: '动感单车' }, bodyPart: 'subLegs', tags: ['tagIndoor', 'tagGym'], category: 'CARDIO' },
  { id: 'swim', name: { en: 'Swimming', cn: '游泳' }, bodyPart: 'subFullBody', tags: ['tagIndoor', 'tagOutdoor'], category: 'CARDIO' },
  { id: 'rower', name: { en: 'Rowing Machine', cn: '划船机' }, bodyPart: 'subBack', tags: ['tagMachine', 'tagGym'], category: 'CARDIO' },
  { id: 'stair', name: { en: 'Stair Climber', cn: '登山机' }, bodyPart: 'subLegs', tags: ['tagMachine', 'tagGym'], category: 'CARDIO' },
  { id: 'rope', name: { en: 'Jump Rope', cn: '跳绳' }, bodyPart: 'subFullBody', tags: ['tagBodyweight'], category: 'CARDIO' },

  // === 2026-10 补充（部位细分，第 3 条）===
  // 换做法就换列的（上斜/下斜、低位/高位绳索、宽距）是独立动作；只换手感的归「练法」（第 8 条）。
  // 已和用户的自建动作去过重：蝴蝶机夹胸、直臂下压、器械内收/外展、上斜器械推胸、反向蝴蝶机、
  // 绳索弯举、器械侧平举、器械划船 这 9 个用户已有自建的，没有加进来。
  { id: 'bp_incline_smith', name: { en: "Incline Smith Machine Press", cn: '上斜史密斯卧推' }, bodyPart: 'subChest', tags: ['tagMachine'], category: 'STRENGTH' },
  { id: 'fly_cable_low', name: { en: "Low-to-High Cable Fly", cn: '低位绳索夹胸' }, bodyPart: 'subChest', tags: ['tagCable'], category: 'STRENGTH' },
  { id: 'fly_incline_db', name: { en: "Incline Dumbbell Fly", cn: '上斜哑铃飞鸟' }, bodyPart: 'subChest', tags: ['tagDumbbell'], category: 'STRENGTH' },
  { id: 'bp_smith', name: { en: "Smith Machine Bench Press", cn: '史密斯平板卧推' }, bodyPart: 'subChest', tags: ['tagMachine'], category: 'STRENGTH' },
  { id: 'bp_decline_barbell', name: { en: "Decline Barbell Bench Press", cn: '下斜杠铃卧推' }, bodyPart: 'subChest', tags: ['tagBarbell'], category: 'STRENGTH' },
  { id: 'bp_decline_dumbbell', name: { en: "Decline Dumbbell Bench Press", cn: '下斜哑铃卧推' }, bodyPart: 'subChest', tags: ['tagDumbbell'], category: 'STRENGTH' },
  { id: 'fly_cable_high', name: { en: "High-to-Low Cable Fly", cn: '高位绳索夹胸' }, bodyPart: 'subChest', tags: ['tagCable'], category: 'STRENGTH' },
  { id: 'press_squeeze_db', name: { en: "Dumbbell Squeeze Press", cn: '哑铃挤压卧推' }, bodyPart: 'subChest', tags: ['tagDumbbell'], category: 'STRENGTH' },
  { id: 'fly_db', name: { en: "Dumbbell Fly", cn: '哑铃飞鸟' }, bodyPart: 'subChest', tags: ['tagDumbbell'], category: 'STRENGTH' },
  { id: 'bp_wide_barbell', name: { en: "Wide-Grip Barbell Bench Press", cn: '宽距杠铃卧推' }, bodyPart: 'subChest', tags: ['tagBarbell'], category: 'STRENGTH' },
  { id: 'pushup_wide', name: { en: "Wide Push-ups", cn: '宽距俯卧撑' }, bodyPart: 'subChest', tags: ['tagBodyweight'], category: 'STRENGTH' },
  { id: 'ohp_smith', name: { en: "Smith Machine Shoulder Press", cn: '史密斯推肩' }, bodyPart: 'subShoulder', tags: ['tagMachine'], category: 'STRENGTH' },
  { id: 'lat_raise_cable', name: { en: "Cable Lateral Raise", cn: '绳索侧平举' }, bodyPart: 'subShoulder', tags: ['tagCable'], category: 'STRENGTH' },
  { id: 'upright_row', name: { en: "Barbell Upright Row", cn: '杠铃直立划船' }, bodyPart: 'subShoulder', tags: ['tagBarbell'], category: 'STRENGTH' },
  { id: 'rear_fly_db', name: { en: "Bent-Over Dumbbell Reverse Fly", cn: '俯身哑铃飞鸟' }, bodyPart: 'subShoulder', tags: ['tagDumbbell'], category: 'STRENGTH' },
  { id: 'rear_fly_cable', name: { en: "Cable Reverse Fly", cn: '绳索反向飞鸟' }, bodyPart: 'subShoulder', tags: ['tagCable'], category: 'STRENGTH' },
  { id: 'shrug_barbell', name: { en: "Barbell Shrug", cn: '杠铃耸肩' }, bodyPart: 'subBack', tags: ['tagBarbell'], category: 'STRENGTH' },
  { id: 'shrug_db', name: { en: "Dumbbell Shrug", cn: '哑铃耸肩' }, bodyPart: 'subBack', tags: ['tagDumbbell'], category: 'STRENGTH' },
  { id: 'cu_incline_db', name: { en: "Incline Dumbbell Curl", cn: '上斜哑铃弯举' }, bodyPart: 'subArms', tags: ['tagDumbbell'], category: 'STRENGTH' },
  { id: 'close_grip_bench', name: { en: "Close-Grip Bench Press", cn: '窄距杠铃卧推' }, bodyPart: 'subArms', tags: ['tagBarbell'], category: 'STRENGTH' },
  { id: 'wrist_curl', name: { en: "Wrist Curl", cn: '腕弯举' }, bodyPart: 'subArms', tags: ['tagDumbbell', 'tagBarbell'], category: 'STRENGTH' },
  { id: 'reverse_curl', name: { en: "Reverse Curl", cn: '反握弯举' }, bodyPart: 'subArms', tags: ['tagBarbell'], category: 'STRENGTH' },
  { id: 'farmer_walk', name: { en: "Farmer's Walk", cn: '农夫行走' }, bodyPart: 'subArms', tags: ['tagDumbbell'], category: 'STRENGTH' },
  { id: 'hack_squat', name: { en: "Hack Squat", cn: '哈克深蹲' }, bodyPart: 'subLegs', tags: ['tagMachine'], category: 'STRENGTH' },
  { id: 'nordic_curl', name: { en: "Nordic Hamstring Curl", cn: '北欧挺身' }, bodyPart: 'subLegs', tags: ['tagBodyweight'], category: 'STRENGTH' },
  { id: 'hip_thrust', name: { en: "Barbell Hip Thrust", cn: '杠铃臀推' }, bodyPart: 'subLegs', tags: ['tagBarbell'], category: 'STRENGTH' },
  { id: 'bulgarian_split', name: { en: "Bulgarian Split Squat", cn: '保加利亚分腿蹲' }, bodyPart: 'subLegs', tags: ['tagDumbbell'], category: 'STRENGTH' },
  { id: 'glute_kickback_cable', name: { en: "Cable Glute Kickback", cn: '绳索后踢腿' }, bodyPart: 'subLegs', tags: ['tagCable'], category: 'STRENGTH' },
  { id: 'crunch', name: { en: "Crunch", cn: '卷腹' }, bodyPart: 'subCore', tags: ['tagBodyweight'], category: 'STRENGTH' },
  { id: 'machine_crunch', name: { en: "Machine Crunch", cn: '器械卷腹' }, bodyPart: 'subCore', tags: ['tagMachine'], category: 'STRENGTH' },
  { id: 'lying_leg_raise', name: { en: "Lying Leg Raise", cn: '仰卧举腿' }, bodyPart: 'subCore', tags: ['tagBodyweight'], category: 'STRENGTH' },
  { id: 'reverse_crunch', name: { en: "Reverse Crunch", cn: '反向卷腹' }, bodyPart: 'subCore', tags: ['tagBodyweight'], category: 'STRENGTH' },
  { id: 'woodchop_cable', name: { en: "Cable Woodchop", cn: '绳索伐木' }, bodyPart: 'subCore', tags: ['tagCable'], category: 'STRENGTH' },
  { id: 'side_bend_db', name: { en: "Dumbbell Side Bend", cn: '哑铃侧屈' }, bodyPart: 'subCore', tags: ['tagDumbbell'], category: 'STRENGTH' },
  { id: 'side_plank', name: { en: "Side Plank", cn: '侧平板支撑' }, bodyPart: 'subCore', tags: ['tagBodyweight'], category: 'STRENGTH' },
  { id: 'dead_bug', name: { en: "Dead Bug", cn: '死虫' }, bodyPart: 'subCore', tags: ['tagBodyweight'], category: 'STRENGTH' },

  // === 自由训练 (FREE) ===
  { id: 'ball_basket', name: { en: 'Basketball', cn: '篮球' }, bodyPart: 'subFullBody', tags: ['tagBallGame', 'tagOutdoor'], category: 'FREE' },
  { id: 'ball_soccer', name: { en: 'Soccer', cn: '足球' }, bodyPart: 'subFullBody', tags: ['tagBallGame', 'tagOutdoor'], category: 'FREE' },
  { id: 'ball_badm', name: { en: 'Badminton', cn: '羽毛球' }, bodyPart: 'subFullBody', tags: ['tagBallGame', 'tagIndoor'], category: 'FREE' },
  { id: 'ball_tennis', name: { en: 'Tennis', cn: '网球' }, bodyPart: 'subFullBody', tags: ['tagBallGame', 'tagOutdoor'], category: 'FREE' },
  { id: 'yoga_flow', name: { en: 'Yoga', cn: '瑜伽' }, bodyPart: 'subFullBody', tags: ['tagBodyweight', 'tagIndoor'], category: 'FREE' },
  { id: 'stretch_all', name: { en: 'Stretching', cn: '拉伸' }, bodyPart: 'subFullBody', tags: ['tagBodyweight'], category: 'FREE' },
  { id: 'hiit_session', name: { en: 'HIIT', cn: '高强度间歇训练' }, bodyPart: 'subFullBody', tags: ['tagBodyweight', 'tagIndoor'], category: 'FREE' },
];

/**
 * 部位细分（第 3 条）：每个部位下面再分一层，添加动作弹层按细分分列摆动作。
 * 名字走 translations（getTagName），用户可改名（tagRenameOverrides）；
 * 自建细分是 customTags 里 category='region' 的标签，parentPart 指向部位。
 * 全身 / 有氧 / 自由不分细分。一个动作只落一列。
 */
export const BODY_REGIONS: Record<string, string[]> = {
  // 每个部位第一列是「热身」（2.4，2026-10-06 用户定：热身动作放进各部位的细分，不再单开自建部位）
  subChest: ['chestWarm', 'chestUpper', 'chestMid', 'chestLower', 'chestInner', 'chestOuter'],
  subShoulder: ['shWarm', 'shFront', 'shSide', 'shRear'],
  subBack: ['backWarm', 'backLats', 'backMid', 'backTraps', 'backLower'],
  subArms: ['armWarm', 'armBi', 'armTri', 'armFore'],
  subLegs: ['legWarm', 'legQuad', 'legHam', 'legGlute', 'legCalf', 'legAdd'],
  subCore: ['coreWarm', 'coreUpper', 'coreLower', 'coreObl', 'coreStab'],
};

/** 内置动作落在哪个细分。没列的（有氧、自由、全身）不分细分 */
export const REGION_OF: Record<string, string> = {
  bp_incline_barbell: 'chestUpper',
  bp_incline_dumbbell: 'chestUpper',
  bp_barbell: 'chestMid',
  bp_dumbbell: 'chestMid',
  press_machine_chest: 'chestMid',
  pushup: 'chestMid',
  chest_dip: 'chestLower',
  fly_cable: 'chestInner',
  ohp_barbell: 'shFront',
  ohp_dumbbell: 'shFront',
  press_machine_shoulder: 'shFront',
  arnold_press: 'shFront',
  front_raise_db: 'shFront',
  lat_raise_dumbbell: 'shSide',
  face_pull_cable: 'shRear',
  lat_pulldown: 'backLats',
  pu_weighted: 'backLats',
  single_arm_db_row: 'backLats',
  row_barbell: 'backMid',
  row_seated_cable: 'backMid',
  tbar_row: 'backMid',
  dl_barbell: 'backLower',
  hyperextension: 'backLower',
  cu_barbell: 'armBi',
  cu_dumbbell: 'armBi',
  cu_hammer: 'armBi',
  preacher_curl: 'armBi',
  tricep_pushdown: 'armTri',
  skull_crusher: 'armTri',
  overhead_extension_db: 'armTri',
  sq_barbell: 'legQuad',
  goblet_squat: 'legQuad',
  leg_press: 'legQuad',
  leg_extension: 'legQuad',
  leg_curl: 'legHam',
  romanian_deadlift: 'legHam',
  lunge_dumbbell: 'legGlute',
  calf_raise: 'legCalf',
  cable_crunch: 'coreUpper',
  leg_raise: 'coreLower',
  russian_twist: 'coreObl',
  plank: 'coreStab',
  ab_wheel: 'coreStab',
  bp_incline_smith: 'chestUpper',
  fly_cable_low: 'chestUpper',
  fly_incline_db: 'chestUpper',
  bp_smith: 'chestMid',
  bp_decline_barbell: 'chestLower',
  bp_decline_dumbbell: 'chestLower',
  fly_cable_high: 'chestLower',
  press_squeeze_db: 'chestInner',
  fly_db: 'chestOuter',
  bp_wide_barbell: 'chestOuter',
  pushup_wide: 'chestOuter',
  ohp_smith: 'shFront',
  lat_raise_cable: 'shSide',
  upright_row: 'shSide',
  rear_fly_db: 'shRear',
  rear_fly_cable: 'shRear',
  shrug_barbell: 'backTraps',
  shrug_db: 'backTraps',
  cu_incline_db: 'armBi',
  close_grip_bench: 'armTri',
  wrist_curl: 'armFore',
  reverse_curl: 'armFore',
  farmer_walk: 'armFore',
  hack_squat: 'legQuad',
  nordic_curl: 'legHam',
  hip_thrust: 'legGlute',
  bulgarian_split: 'legGlute',
  glute_kickback_cable: 'legGlute',
  crunch: 'coreUpper',
  machine_crunch: 'coreUpper',
  lying_leg_raise: 'coreLower',
  reverse_crunch: 'coreLower',
  woodchop_cable: 'coreObl',
  side_bend_db: 'coreObl',
  side_plank: 'coreStab',
  dead_bug: 'coreStab',
};

/**
 * 默认动作库：基础定义 + 细分。
 * 改内置动作的名字时，旧名必须进 aliases（见 BASE_EXERCISES 上方说明）。
 */
export const DEFAULT_EXERCISES: ExerciseDefinition[] = BASE_EXERCISES.map(d =>
  REGION_OF[d.id] ? { ...d, region: REGION_OF[d.id] } : d,
);

/**
 * 获取分类的显示名称
 */
export const getCategoryName = (category: ExerciseCategory | null, lang: 'cn' | 'en'): string => {
  const names: Record<ExerciseCategory, { cn: string; en: string }> = {
    STRENGTH: { cn: '力量训练', en: 'Strength Training' },
    CARDIO: { cn: '有氧训练', en: 'Cardio Training' },
    FREE: { cn: '自由训练', en: 'Free Training' },
    OTHER: { cn: '其他', en: 'Other' },
  };
  
  if (category === null) {
    return lang === 'cn' ? '全部' : 'All';
  }
  
  return names[category]?.[lang] || category;
};
