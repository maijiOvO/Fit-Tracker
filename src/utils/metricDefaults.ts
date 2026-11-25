/**
 * 记录项的默认与「记过的不动」要用的查询。
 *
 * 没配置过记录项的动作每次读历史都按 fallbackMetricsOf 现算；所以改类型、改有氧默认、导入之前，
 * 有记录的动作要先把此刻生效的那组写成显式配置（ExercisePrefsContext 的 saveExerciseAttrs / pinCardioMetrics、
 * fitlogCsvImport.mergeImportSeeds），不然同一批历史会按新口径重读。
 */
import type { ExerciseCategory, WorkoutSession } from '../../types';
import { setHasValue } from './setValues';

/** 没配置时的回落值：有氧跟首选项「有氧默认记录」，其余重量 × 次数。改它会重读所有没配置的动作的历史 */
export function fallbackMetricsOf(category: ExerciseCategory | '' | undefined, cardio: string[]): string[] {
  return category === 'CARDIO' ? [...cardio] : ['weight', 'reps'];
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
