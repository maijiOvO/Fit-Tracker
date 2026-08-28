/**
 * 场地（§12.11）—— 候选列表全部从历史训练现算，不落 prefs。
 *
 * 理由见 types.ts 里 WorkoutSession.gym 的注释：prefs 的合并是逐 key 枚举的
 * （services/fitlogRemote.ts mergeFitlogPrefs），新增一个 key 要同时改四处，
 * 漏一处就是每次同步静默丢数据。场地这种低频、字面量、可从既有数据派生的东西
 * 不值得引入那个风险面。
 */
import { WorkoutSession } from '../../types';

/** 空白 / 纯空格一律当没填 */
export function normalizeGym(raw: string | undefined | null): string | undefined {
  const t = (raw ?? '').trim();
  return t ? t : undefined;
}

/**
 * 用过的场地，按「最近一次使用」倒序。
 * workouts 由 WorkoutContext 按 date 倒序给出；这里不再排序，直接按遇到的先后去重，
 * 于是列表天然就是「最近用的排最前」——选择器里最常点的那个永远在第一行。
 */
export function listGyms(workouts: WorkoutSession[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const w of workouts) {
    const g = normalizeGym(w.gym);
    if (g && !seen.has(g)) {
      seen.add(g);
      out.push(g);
    }
  }
  return out;
}

/**
 * 新建训练时的默认场地 = 上一场的场地。
 *
 * 「沿用上次」是这里唯一说得通的默认：连着去同一个馆时你永远不用碰这个控件，
 * 换馆那天点一下。猜不出来（历史全空）时就是 undefined，不编。
 */
export function lastUsedGym(workouts: WorkoutSession[]): string | undefined {
  for (const w of workouts) {
    const g = normalizeGym(w.gym);
    if (g) return g;
  }
  return undefined;
}
