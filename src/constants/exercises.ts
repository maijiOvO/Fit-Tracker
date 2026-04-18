/**
 * 默认动作库
 * 包含力量训练、有氧训练、自由训练三大类
 */
import { ExerciseDefinition } from '../types';

export type ExerciseCategory = 'STRENGTH' | 'CARDIO' | 'FREE' | 'OTHER';

/**
 * 身体部位列表
 */
export const BODY_PARTS = ['subChest', 'subShoulder', 'subBack', 'subArms', 'subLegs', 'subCore'];

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
 */

/**
 * 默认动作库
 */
export const DEFAULT_EXERCISES: ExerciseDefinition[] = [
  // === 胸部 (Chest) ===
  { id: 'bp_barbell', name: { en: 'Barbell Bench Press', cn: '杠铃平板卧推' }, bodyPart: 'subChest', tags: ['tagBarbell'], category: 'STRENGTH', exerciseConfig: { supportsPyramid: true, bodyweightType: 'none', pyramidModes: ['increasing', 'decreasing', 'mixed'] } },
  { id: 'bp_incline_barbell', name: { en: 'Incline Barbell Bench Press', cn: '杠铃上斜卧推' }, bodyPart: 'subChest', tags: ['tagBarbell'], category: 'STRENGTH', exerciseConfig: { supportsPyramid: true, bodyweightType: 'none', pyramidModes: ['increasing', 'decreasing'] } },
  { id: 'bp_dumbbell', name: { en: 'Dumbbell Bench Press', cn: '哑铃平板卧推' }, bodyPart: 'subChest', tags: ['tagDumbbell'], category: 'STRENGTH' },
  { id: 'bp_incline_dumbbell', name: { en: 'Incline Dumbbell Bench Press', cn: '哑铃上斜卧推' }, bodyPart: 'subChest', tags: ['tagDumbbell'], category: 'STRENGTH' },
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
  { id: 'skull_crusher', name: { en: 'Skull Crusher', cn: '哑卧臂屈伸' }, bodyPart: 'subArms', tags: ['tagBarbell', 'tagDumbbell'], category: 'STRENGTH' },
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
