/**
 * 纪录（PR）的唯一口径 —— 结束训练的 PB 牌（prDetect）、训练中组行上的 PB 标（ExerciseCard）、
 * 「按动作」历史里的纪录点 / 特别关注「刚破纪录」（liftHistory）三处共用这一份（2026-10-22 重做，审查 PR）。
 * 原来三处各写各的（阈值、分馆、看哪种纪录都不一样），刊末页说破了纪录、历史里却没有点，反过来也有。
 *
 * 照 Strong / Hevy 的做法分几种纪录，同时破了按这个先后挑一种上牌：
 *   1. 最大重量：任意次数里最重的一组
 *   2. 估算 1RM：Epley，只算 ≤ 10 次的组（次数再高公式偏差太大），1 次就是它本身
 *   3. 次数纪录：这个重量下做得更多（或这个次数下做得更重）——
 *      本场某一组 (w, r) 不被历史上任何一组 (w' ≥ w, r' ≥ r) 盖住，就是一项次数纪录
 *   4. 单组容量：重量 × 次数
 * 自重（没有重量这一项）：单组最多次数。
 * 带正负的负荷（辅助为负、负重为正）：最大重量只看加了负重的组（自重算 0）；
 *   辅助的组走次数纪录 —— 少用一点辅助做一样多次、同样的辅助做更多次都算。估算 1RM、容量不算（自重那部分不在数里）。
 *
 * 阈值：不设百分比。重量已经吸到真实的片子 / 档位上了，比之前任何一组多出 0.01 kg 以上就算（只挡浮点噪声）。
 * 分馆：器械（配重片 / 挂片，gymScopedKind）只和同一个馆比；带正负动作里辅助的那些组（辅助器械）也只和同一个馆比；
 *   其余（杠铃、哑铃、负重、自重）跨馆比。
 * 历史为空不算 PR（同一个馆都没练过的器械也是）；编辑旧训练不判（调用方管）。
 */
import type { Exercise } from '../../types';
import { signedKg } from './load';

export type RecordKind = 'weight' | 'e1rm' | 'reps' | 'volume';

/** 同时破了几种时上牌的先后 */
export const RECORD_PRIORITY: RecordKind[] = ['weight', 'e1rm', 'reps', 'volume'];

/** 比重量时的容差（kg）：挡 kg ⇄ lb 换算的浮点噪声 */
const TOL = 0.01;

/** 超过这个次数的组不估 1RM */
const E1RM_MAX_REPS = 10;

/** Epley：w × (1 + r/30)；1 次就是本身。估不了返回 null */
export function e1rmOf(kg: number, reps: number): number | null {
  if (!(kg > 0) || !(reps >= 1) || reps > E1RM_MAX_REPS) return null;
  return reps === 1 ? kg : kg * (1 + reps / 30);
}

/** 拿来比纪录的一组：带符号的 kg、次数、在哪个馆（'' = 没标馆）；at＝这一组在卡上的下标（递减档算母组的） */
export interface PRSet {
  kg: number;
  reps: number;
  gym: string;
  at?: number;
}

/** 这个动作按哪套规矩比 */
export interface PRRule {
  /** 记重量（没有重量这一项的按自重比最多次数） */
  tracksWeight: boolean;
  /** 带正负的负荷 */
  signed: boolean;
  /** 器械类：只和同一个馆比 */
  machine: boolean;
}

/** 一张卡上做完的组（递减 / 递增档各算一组，at 指回母组）；底稿行不算 */
export function prSetsOf(ex: Exercise, gym: string | undefined, signed: boolean): PRSet[] {
  const g = gym ?? '';
  const out: PRSet[] = [];
  (ex.sets ?? []).forEach((s, i) => {
    if (s.ghost) return;
    out.push({ kg: signed ? signedKg(s, ex) : Number(s.weight) || 0, reps: Number(s.reps) || 0, gym: g, at: i });
    for (const sub of s.subSets ?? []) {
      out.push({ kg: signed ? signedKg(sub, ex, s) : Number(sub.weight) || 0, reps: Number(sub.reps) || 0, gym: g, at: i });
    }
  });
  return out;
}

/** 历史上这一组能不能拿来和 gym 那一场比 */
function comparableTo(rule: PRRule, s: PRSet, gym: string): boolean {
  if (rule.machine) return s.gym === gym;
  // 辅助器械的辅助量各馆不通用；加了负重 / 纯自重的是真重量，跨馆比
  if (rule.signed && s.kg < 0) return s.gym === gym;
  return true;
}

export interface RecordHit {
  kind: RecordKind;
  /** 之前的纪录 / 这一次（重量类是 kg，次数类是次数，容量是 kg×次） */
  prev: number;
  next: number;
  /** 次数纪录：这一组的重量（带符号 kg） */
  atKg?: number;
  /** 本场破纪录的那一组（PRSet.at） */
  at?: number;
}

const maxBy = <T,>(xs: T[], f: (x: T) => number): T | undefined =>
  xs.reduce<T | undefined>((b, x) => (b === undefined || f(x) > f(b) ? x : b), undefined);

/**
 * 本场这几组破了哪些纪录（按 RECORD_PRIORITY 排好）。
 * history：这个动作（同一做法）以前所有做完的组，各带自己那场的馆；这里按规矩筛能比的。
 * current：本场的组（都在 gym 这个馆）。
 */
export function findRecords(rule: PRRule, history: PRSet[], current: PRSet[], gym: string | undefined): RecordHit[] {
  const g = gym ?? '';
  const past = history.filter(s => comparableTo(rule, s, g));
  const now = current.filter(s => s.reps > 0 || s.kg !== 0);
  if (!past.length || !now.length) return [];
  const hits: RecordHit[] = [];

  if (!rule.tracksWeight) {
    const prev = Math.max(...past.map(s => s.reps));
    const best = maxBy(now, s => s.reps)!;
    if (best.reps > prev) hits.push({ kind: 'reps', prev, next: best.reps, at: best.at });
    return hits;
  }

  // 1. 最大重量（带号的：只看加了负重的组，自重算 0 —— 第一次挂上 5 kg 也是纪录）
  const loadOf = (s: PRSet) => (rule.signed ? Math.max(0, s.kg) : s.kg);
  const pastW = past.filter(s => s.reps > 0 || !rule.signed);
  const nowW = now.filter(s => (rule.signed ? s.kg > 0 && s.reps > 0 : s.kg > 0));
  if (pastW.length && nowW.length) {
    const prev = Math.max(...pastW.map(loadOf));
    const best = maxBy(nowW, loadOf)!;
    if (loadOf(best) > prev + TOL && (prev > 0 || rule.signed)) hits.push({ kind: 'weight', prev, next: loadOf(best), at: best.at });
  }

  // 2. 估算 1RM（带号的不估）
  if (!rule.signed) {
    const pastE = past.map(s => e1rmOf(s.kg, s.reps)).filter((v): v is number => v != null);
    const nowE = now.map(s => ({ s, v: e1rmOf(s.kg, s.reps) })).filter((x): x is { s: PRSet; v: number } => x.v != null);
    if (pastE.length && nowE.length) {
      const prev = Math.max(...pastE);
      const best = maxBy(nowE, x => x.v)!;
      if (best.v > prev + TOL) hits.push({ kind: 'e1rm', prev, next: best.v, at: best.s.at });
    }
  }

  // 3. 次数纪录：不被历史上任何一组盖住（更重或一样重、更多或一样多）
  const fresh = now.filter(c => c.reps > 0 && !past.some(p => p.kg >= c.kg - TOL && p.reps >= c.reps));
  if (fresh.length) {
    // 挑最重的那组（同重挑次数多的）报
    const c = fresh.reduce((b, x) => (x.kg > b.kg + TOL || (Math.abs(x.kg - b.kg) <= TOL && x.reps > b.reps) ? x : b));
    // 之前在这个重量（及更重）下最多做到几次
    const prev = Math.max(0, ...past.filter(p => p.kg >= c.kg - TOL).map(p => p.reps));
    hits.push({ kind: 'reps', prev, next: c.reps, atKg: c.kg, at: c.at });
  }

  // 4. 单组容量（带号的不算）
  if (!rule.signed) {
    const vol = (s: PRSet) => Math.max(0, s.kg) * s.reps;
    const prev = Math.max(...past.map(vol));
    const best = maxBy(now, vol)!;
    if (prev > 0 && vol(best) > prev + TOL) hits.push({ kind: 'volume', prev, next: vol(best), at: best.at });
  }

  return hits.sort((a, b) => RECORD_PRIORITY.indexOf(a.kind) - RECORD_PRIORITY.indexOf(b.kind));
}
