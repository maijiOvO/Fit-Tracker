/**
 * 记录项的默认与「记过的不动」要用的查询。
 *
 * 没配置过记录项的动作每次读历史都按 fallbackMetricsOf 现算；所以改类型、改有氧默认、导入之前，
 * 有记录的动作要先把此刻生效的那组写成显式配置（ExercisePrefsContext 的 saveExerciseAttrs / pinCardioMetrics、
 * fitlogCsvImport.mergeImportSeeds），不然同一批历史会按新口径重读。
 */
import type { ExerciseCategory, WorkoutSession } from '../../types';
import { INITIAL_METRICS } from '../constants/exercises';
import { setHasValue } from './setValues';

/** 没配置时的回落值：有氧跟首选项「有氧默认记录」，其余重量 × 次数。改它会重读所有没配置的动作的历史 */
export function fallbackMetricsOf(category: ExerciseCategory | '' | undefined, cardio: string[]): string[] {
  return category === 'CARDIO' ? [...cardio] : ['weight', 'reps'];
}

/**
 * 第一次添加（从没记过、没配置过）时写下的那组；null＝不写，跟回落值走。
 * 计时类不放进回落值：已经按重量 × 次数记过平板支撑的历史会被按时长重读。def 要传合并覆盖层之后的（改成有氧的平板支撑按有氧）
 */
export function initialMetricsOf(def: { id: string; category?: ExerciseCategory | '' }, cardio: string[]): string[] | null {
  if (def.category === 'CARDIO') return [...cardio];
  const listed = INITIAL_METRICS[def.id];
  if (listed) return [...listed];
  return def.category === 'FREE' ? ['duration'] : null;
}

/**
 * 加动作、计划开练时种下的那组（initialMetricsOf）；null＝不种，按 getActiveMetrics 走。
 * 配置过的不种（用户先在记录项设置里配了带重量的平板支撑，计划的目标重量要照填，审查 D4#2）。
 * 记没记过看全部训练：补录、编辑旧训练时只看那一场之前的，会漏掉之后按重量 × 次数记的平板支撑，种下时长把它们重读掉（审查 D4#1）
 */
export function seedMetricsOf(
  def: { id: string; category?: ExerciseCategory | '' },
  name: string,
  workouts: WorkoutSession[],
  resolveName: (n: string) => string,
  configs: Record<string, string[]>,
  cardio: string[],
): string[] | null {
  const target = resolveName(name);
  if (configs[target]) return null;
  const initial = initialMetricsOf(def, cardio);
  return initial && !recordedNames(workouts, resolveName).has(target) ? initial : null;
}

/** 至少有一组填了数的动作（现名）。进行中那场也算：按值判，底稿行有数也算（它就是上次记的） */
export function recordedNames(workouts: WorkoutSession[], resolveName: (n: string) => string): Set<string> {
  const out = new Set<string>();
  for (const w of workouts) {
    for (const e of w.exercises ?? []) {
      if ((e.sets ?? []).some(setHasValue)) out.add(resolveName(e.name));
    }
  }
  return out;
}

/** 这个动作（所有做法）的组上记过数的自定义记录项，按首次出现排序：关掉以后还要能在选项里点回来 */
export function customKeysIn(workouts: WorkoutSession[], resolveName: (n: string) => string, name: string): string[] {
  const target = resolveName(name);
  const out: string[] = [];
  for (const w of workouts) {
    for (const e of w.exercises ?? []) {
      if (resolveName(e.name) !== target) continue;
      for (const s of e.sets ?? []) {
        for (const [k, v] of Object.entries(s)) {
          if (k.startsWith('custom_') && typeof v === 'number' && Number.isFinite(v) && v !== 0 && !out.includes(k)) out.push(k);
        }
      }
    }
  }
  return out;
}
