/**
 * 目标的规则（审查 D7、C71、C72）：新建、编辑、目标卡共用这一份。目标值不再只能手抄 —— 力量、频率从训练记录现算，
 * 体重从体重记录现算；进度按「起点 → 目标」算，减重（80 → 75）和增重同一个式子。全是纯函数。
 */
import type { Goal, GoalType, WeightEntry, WorkoutSession } from '../../types';
import { translations } from '../../translations';
import { KG_TO_LBS } from '../constants';
import { dayOfWeekIndex } from './dateUtils';
import { bestAsOf, latestGymView, type LiftSummary } from './liftHistory';
import { weightBaseline } from './weightSummary';

/**
 * 卡上显示的当前值和起点：力量目标绑了动作就取那个动作的最重一组、频率目标数本周练了几场，
 * 都从训练记录现算；体重目标的当前值从体重记录现算，起点取建目标那一刻的体重。都不落库。
 * current 为 null ＝ 不知道（没记过体重、也没手填），卡上写「—」、不画进度条。
 * 力量目标存的是动作的稳定键（LiftSummary.stableId），先过 canonical（并入、补建之后的旧键换成现在的），
 * 再在每个动作组出现过的全部键里找；找不到返回 missing —— 不再显示成 0 / 目标、再练也不动（审查 C30）。
 */
export function goalCardValues(
  g: Goal,
  lifts: LiftSummary[],
  workouts: WorkoutSession[],
  weightEntries: WeightEntry[],
  canonical: (key: string) => string,
): { current: number | null; start: number | null; missing?: true } {
  if (g.type === 'frequency') return { current: workoutsThisWeek(workouts), start: 0 };
  if (g.type === 'weight') {
    return {
      current: weightGoalCurrent(weightEntries, g.unit) ?? (g.currentValue > 0 ? g.currentValue : null),
      start: weightAtStart(weightEntries, g.startDate, g.unit),
    };
  }
  const liftId = g.type === 'strength' ? g.autoUpdateRule?.exerciseName : undefined;
  if (!liftId) return { current: g.currentValue, start: 0 };
  const id = canonical(liftId);
  const whole = lifts.find(l => l.ids.includes(id) || l.ids.includes(liftId));
  if (!whole) return { current: null, start: null, missing: true };
  // 按馆比的器械看最近练的那个馆（跨馆的重量不可比）
  const lift = latestGymView(whole);
  const inUnit = (kg: number) => (g.unit === 'lbs' ? kg * KG_TO_LBS : kg);
  return {
    current: inUnit(lift.best.weight?.value ?? 0),
    start: inUnit(bestAsOf(lift, 'weight', new Date(g.startDate).getTime()) ?? 0),
  };
}

/** 从起点走到目标走了几成（0–1）。起点不明、或起点就是目标时返回 null（不画进度条） */
export function goalProgress(current: number, start: number | null, target: number): number | null {
  if (start == null || target === start) return null;
  return Math.min(1, Math.max(0, (current - start) / (target - start)));
}

/** 体重目标的起点：建目标那一刻之前最近的一次体重；之前没记过就取之后最早的一次。按目标自己的单位 */
export function weightAtStart(entries: WeightEntry[], startIso: string, unit: string): number | null {
  const start = new Date(startIso).getTime();
  let before: WeightEntry | null = null;
  let after: WeightEntry | null = null;
  for (const e of entries) {
    const t = new Date(e.date).getTime();
    if (t <= start) {
      if (!before || t > new Date(before.date).getTime()) before = e;
    } else if (!after || t < new Date(after.date).getTime()) {
      after = e;
    }
  }
  const hit = before ?? after;
  if (!hit) return null;
  return kgInGoalUnit(hit.weight, unit);
}

/**
 * 体重记录一律存 kg，目标的当前 / 目标值却按建目标时的单位（g.unit）存、原样显示，不跟全局单位 ——
 * 拿来比之前换成目标自己的单位，否则 lbs 用户看到的「当前」是公斤数。不是 lbs 就按 kg
 * （编辑弹窗旧 bug 留下的 unit='times/week' 体重目标也落在这里，显示和计算一致）。
 */
function kgInGoalUnit(kg: number, unit: string): number {
  return unit === 'lbs' ? kg * KG_TO_LBS : kg;
}

/** 体重目标的当前值：按日期最新的一次称重，换成目标单位、取一位小数；没记过体重返回 null */
export function weightGoalCurrent(entries: WeightEntry[], unit: string): number | null {
  const latest = weightBaseline(entries)?.latest;
  return latest ? Math.round(kgInGoalUnit(latest.weight, unit) * 10) / 10 : null;
}

/**
 * 当前值格藏起来（当前值是现算的，手填了也不生效）：频率目标、绑了动作的力量目标、已有体重记录时的体重目标
 */
export function currentHidden(type: GoalType | undefined, autoUpdateRule: Goal['autoUpdateRule'], hasWeightLog: boolean): boolean {
  if (type === 'frequency') return true;
  if (type === 'strength') return !!autoUpdateRule;
  if (type === 'weight') return hasWeightLog;
  return false;
}

const goalName = (g: Partial<Goal>) => (g.title || g.label || '').trim();

/**
 * 存库前把目标按类型规整一遍（新建、编辑都过）：编辑弹窗切类型原来不跟着改单位、类别、绑定（审查 C72），
 * 藏起来的当前值也照样入库（C75）。
 *   - unit：频率 'times/week'；体重 / 力量原来就是 kg / lbs 的保留（目标跟建立时的单位，既有决定），否则用当前显示单位
 *   - 动作绑定只有力量目标留着，dataSource 跟着它
 *   - title、label 存同一串去掉首尾空白的名字
 */
export function normalizeGoal<T extends Partial<Goal>>(g: T, opts: { unit: 'kg' | 'lbs'; hasWeightLog: boolean }): T {
  const unit =
    g.type === 'frequency'
      ? 'times/week'
      : g.type === 'weight' || g.type === 'strength'
        ? g.unit === 'kg' || g.unit === 'lbs'
          ? g.unit
          : opts.unit
        : g.unit;
  const autoUpdateRule = g.type === 'strength' ? g.autoUpdateRule : undefined;
  const name = goalName(g);
  return {
    ...g,
    category: g.type,
    unit,
    autoUpdateRule,
    dataSource: autoUpdateRule ? 'auto' : 'manual',
    currentValue: currentHidden(g.type, autoUpdateRule, opts.hasWeightLog) ? 0 : (g.currentValue ?? 0),
    title: name,
    label: name,
  };
}

/** 存得下：有名字、目标值是大于 0 的有限数（空标题原来会存进去，同步时被换成英文兜底） */
export function canSaveGoal(g: Partial<Goal>): boolean {
  const t = g.targetValue;
  return goalName(g) !== '' && typeof t === 'number' && Number.isFinite(t) && t > 0;
}

/** 名称框的占位：按类型给例子（力量和没选类型时沿用卧推） */
export function goalLabelPlaceholder(type: GoalType | undefined, isCn: boolean): string {
  const key =
    type === 'weight' ? 'goalLabelPlaceholderWeight' : type === 'frequency' ? 'goalLabelPlaceholderFrequency' : 'goalLabelPlaceholderStrength';
  return String(translations[key][isCn ? 'cn' : 'en']);
}

/** 目标卡、输入框后缀上的单位：频率目标库里存的是 'times/week'，按语言显示；其余不是 lbs 就按 kg */
export function goalUnitLabel(g: Partial<Goal>, isCn: boolean): string {
  if (g.type === 'frequency') return String(translations.goalUnitPerWeek[isCn ? 'cn' : 'en']);
  return g.unit === 'lbs' ? 'lbs' : 'kg';
}

/** 本周（按首选项的周起始日）练了几场 */
export function workoutsThisWeek(workouts: Pick<WorkoutSession, 'date'>[], now = new Date()): number {
  const weekStart = new Date(now);
  weekStart.setHours(0, 0, 0, 0);
  weekStart.setDate(weekStart.getDate() - dayOfWeekIndex(now));
  const from = weekStart.getTime();
  return workouts.filter(w => {
    const t = new Date(w.date).getTime();
    return t >= from && t <= now.getTime();
  }).length;
}
