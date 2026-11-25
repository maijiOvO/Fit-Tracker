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
 *   5. 有氧 / 计时（按记录项，见 prRuleFor）：最远（距离）> 最快（均速＝距离 ÷ 时长，打了速度就用打的）> 最长（时长，只在不记距离、或一次距离都没填过时）——
 *      定时长跑更远上「最远」，定距离跑更快上「最快」；记了距离的动作时长变长不算进步（多半只是跑慢了，审查 C85 / gap-5#4，2026-11-24 用户定）
 * 自重（没有重量这一项）：单组最多次数。
 * 带正负的负荷（辅助为负、负重为正）：最大重量只看加了负重的组（自重算 0）；
 *   辅助的组走次数纪录 —— 少用一点辅助做一样多次、同样的辅助做更多次都算。估算 1RM、容量不算（自重那部分不在数里）。
 *
 * 阈值：不设百分比，只挡换算噪声：重量多出 TOL_KG（0.1 kg）以上才算，估算 1RM、单组容量的容差按倍数放大（审查 C83）。
 *   kg、lb 都只打一位小数，跨单位手打同一个重量能差到约 0.073 kg（225 lb＝102.06，kg 下打 102.1）；
 *   最小的真实加重是单边一片 0.25 lb（约 0.113 kg），仍然算。
 * 次数为 0 的组（有数就入册，2026-11 用户定）不算举起来了：记次数的动作里它不进最大重量（审查 C81），不记次数的「重量 + 时长」照旧按重量比。
 * 分馆：器械（配重片 / 挂片，gymScopedKind）只和同一个馆比；带正负动作里辅助的那些组（辅助器械）也只和同一个馆比；
 *   其余（杠铃、哑铃、负重、自重）跨馆比。
 * 历史为空不算 PR（同一个馆都没练过的器械也是）；编辑旧训练不判（调用方管）。
 *
 * 实现是累计式的（createRecordTracker）：历史按「全局 + 各馆」分区攒摘要，findRecords 也是建一个再判，
 * 所以三处仍走同一份代码。改口径时 logic-check「逐场纪录：累计判定和逐场重判一模一样」里冻结的朴素版要跟着改。
 */
import type { Exercise } from '../../types';
import { signedKg } from './load';

type CardioKind = 'distance' | 'speed' | 'duration';
export type RecordKind = 'weight' | 'e1rm' | 'reps' | 'volume' | CardioKind;

/** 同时破了几种时上牌的先后 */
export const RECORD_PRIORITY: RecordKind[] = ['weight', 'e1rm', 'reps', 'volume', 'distance', 'speed', 'duration'];

/** 比重量时的容差（kg）：挡 kg ⇄ lb 各打一位小数的换算差，见头注释 */
const TOL_KG = 0.1;

/** 超过这个次数的组不估 1RM（界面上的说明从这里取，别手写数字） */
export const E1RM_MAX_REPS = 10;

/** Epley：w × (1 + r/30)；1 次就是本身。估不了返回 null */
export function e1rmOf(kg: number, reps: number): number | null {
  if (!(kg > 0) || !(reps >= 1) || reps > E1RM_MAX_REPS) return null;
  return reps === 1 ? kg : kg * (1 + reps / 30);
}

/** 有氧三项的容差：距离 km、速度 km/h、时长秒（挡浮点和两位小数的取整） */
const CARDIO_TOL: Record<CardioKind, number> = { distance: 0.005, speed: 0.005, duration: 0.5 };

/** 拿来比纪录的一组：带符号的 kg、次数、时长（秒）、距离（km）、速度（km/h）、在哪个馆（'' = 没标馆）；at＝这一组在卡上的下标（递减档算母组的） */
export interface PRSet {
  kg: number;
  reps: number;
  sec: number;
  km: number;
  kmh: number;
  gym: string;
  at?: number;
}

const cardioOf = (s: PRSet, k: CardioKind) => (k === 'distance' ? s.km : k === 'speed' ? s.kmh : s.sec);

/** 一组的速度（km/h）：打了速度就用打的，没打按距离 ÷ 时长算；算不出是 0 */
export function setSpeedKmh(set: { distance?: number; duration?: number; speed?: number }): number {
  const typed = Number(set.speed) || 0;
  if (typed > 0) return typed;
  const km = Number(set.distance) || 0;
  const sec = Number(set.duration) || 0;
  return km > 0 && sec > 0 ? (km * 3600) / sec : 0;
}

/** 这个动作按哪套规矩比 */
export interface PRRule {
  /** 记重量（没有重量这一项的按自重比最多次数） */
  tracksWeight: boolean;
  /** 记次数：记的动作里次数为 0 的组不算举起来了 */
  tracksReps: boolean;
  /** 带正负的负荷 */
  signed: boolean;
  /** 器械类：只和同一个馆比 */
  machine: boolean;
  /** 有氧 / 计时比哪几项，按上牌先后排（prRuleFor 定） */
  cardio: CardioKind[];
}

/**
 * 按动作的记录项（getActiveMetrics）定规矩；构造 PRRule 只走这里，几处口径才一致。
 * 有氧：记了距离比距离；记了速度、或距离和时长都记（能算均速）比速度；时长只在不记距离时按越长越好比（平板支撑、定时长的动作）。
 * sets＝这个动作的全部组（历史 + 本场）：记录项里有距离、可一组距离都没填过（有氧默认记时长 + 距离，椭圆机、划船机只填时长）
 * 按不记距离比 ——「时长变长是跑慢了」只在真记了距离时成立，否则这类动作永远没有纪录（D5 审查）
 */
export function prRuleFor(metrics: string[], signed: boolean, machine: boolean, sets: PRSet[]): PRRule {
  const noKm = !sets.some(s => s.km > 0);
  const has = (m: string) => metrics.includes(m) && !(m === 'distance' && noKm);
  const cardio: CardioKind[] = [];
  if (has('distance')) cardio.push('distance');
  if (has('speed') || (has('distance') && has('duration'))) cardio.push('speed');
  if (has('duration') && !has('distance')) cardio.push('duration');
  return { tracksWeight: has('weight'), tracksReps: has('reps'), signed, machine, cardio };
}

/** 一张卡上做完的组（递减 / 递增档各算一组，at 指回母组）；底稿行不算 */
export function prSetsOf(ex: Exercise, gym: string | undefined, signed: boolean): PRSet[] {
  const g = gym ?? '';
  const out: PRSet[] = [];
  (ex.sets ?? []).forEach((s, i) => {
    if (s.ghost) return;
    // 不带正负的动作照样看组上的号：辅助算 0、负重照算（同 setVolumeKg）。改器材前记的辅助 40 不能当成 40 kg 的纪录（审查 gap-2#5）
    out.push({
      kg: signed ? signedKg(s, ex) : Math.max(0, signedKg(s, ex)),
      reps: Number(s.reps) || 0,
      sec: Number(s.duration) || 0,
      km: Number(s.distance) || 0,
      kmh: setSpeedKmh(s),
      gym: g,
      at: i,
    });
    for (const sub of s.subSets ?? []) {
      out.push({ kg: signed ? signedKg(sub, ex, s) : Math.max(0, signedKg(sub, ex, s)), reps: Number(sub.reps) || 0, sec: 0, km: 0, kmh: 0, gym: g, at: i });
    }
  });
  return out;
}

/** 历史上这一组只和同一个馆比（进按馆的分区）：器械的全部组；辅助器械的辅助量各馆不通用。加了负重 / 纯自重的是真重量，跨馆比 */
function gymOnly(rule: PRRule, s: PRSet): boolean {
  return rule.machine || (rule.signed && s.kg < 0);
}

export interface RecordHit {
  kind: RecordKind;
  /** 之前的纪录 / 这一次（重量类是 kg，次数类是次数，容量是 kg×次；距离 km、速度 km/h、时长秒） */
  prev: number;
  next: number;
  /** 次数纪录：这一组的重量（带符号 kg） */
  atKg?: number;
  /** 本场破纪录的那一组（PRSet.at） */
  at?: number;
}

const byPriority = (a: RecordHit, b: RecordHit) => RECORD_PRIORITY.indexOf(a.kind) - RECORD_PRIORITY.indexOf(b.kind);

const maxBy = <T,>(xs: T[], f: (x: T) => number): T | undefined =>
  xs.reduce<T | undefined>((b, x) => (b === undefined || f(x) > f(b) ? x : b), undefined);

/**
 * 历史的一个分区（全局，或某一个馆）攒下的摘要：判纪录只用到这几样，不必留下每一组。
 * front：(kg, 次数) 的帕累托前沿，kg 从重到轻、次数严格递增 —— 被别的组盖住（更重或一样重、更多或一样多）的组不留。
 */
interface Part {
  n: number;
  maxReps: number;
  /** 举起来了的组（lifted）：组数、最重（loadOf） */
  nW: number;
  maxLoad: number;
  /** 能估 1RM 的组 */
  nE: number;
  maxE: number;
  maxVol: number;
  front: { kg: number; reps: number }[];
  /** 有氧三项各自的最大（没记过是 0） */
  cardio: Record<CardioKind, number>;
}

const newPart = (): Part => ({
  n: 0, maxReps: -Infinity, nW: 0, maxLoad: -Infinity, nE: 0, maxE: -Infinity, maxVol: -Infinity, front: [],
  cardio: { distance: 0, speed: 0, duration: 0 },
});

function frontAdd(front: Part['front'], kg: number, reps: number): void {
  if (front.some(q => q.kg >= kg && q.reps >= reps)) return;
  const keep = front.filter(q => !(q.kg <= kg && q.reps <= reps));
  let i = 0;
  while (i < keep.length && keep[i].kg > kg) i++;
  keep.splice(i, 0, { kg, reps });
  front.splice(0, front.length, ...keep);
}

/** 重量 ≥ x 的组里最多做到几次（没有＝-Infinity）：前沿上次数随 kg 变轻递增，最后一个够重的就是 */
function frontRepsAtLeast(front: Part['front'], x: number): number {
  let best = -Infinity;
  for (const q of front) {
    if (q.kg < x) break;
    best = q.reps;
  }
  return best;
}

export interface RecordTracker {
  /** 记进历史（逐场判时，判完一场再 add 这一场） */
  add(sets: PRSet[]): void;
  /** 本场这几组破了哪些纪录（按 RECORD_PRIORITY 排好）；不改内部状态，训练中每次渲染都可以调 */
  check(current: PRSet[], gym: string | undefined): RecordHit[];
}

/**
 * 累计式的判纪录：历史按「全局 + 各馆」分区攒摘要，判一场只合并全局和本馆两份。
 * 逐场判「按动作」历史时每场只 add 一次，单个动作是线性的；原来每场把此前全部组从头扫一遍，2000 场要一秒（审查 C36）。
 */
export function createRecordTracker(rule: PRRule): RecordTracker {
  const global = newPart();
  const byGym = new Map<string, Part>();
  // 1. 最大重量（带号的：只看加了负重的组，自重算 0 —— 第一次挂上 5 kg 也是纪录）
  const loadOf = (s: PRSet) => (rule.signed ? Math.max(0, s.kg) : s.kg);
  // 举起来了：记次数（或带号）的动作要次数 > 0；不记次数的「重量 + 时长」按重量比
  const lifted = (s: PRSet) => s.reps > 0 || !(rule.signed || rule.tracksReps);
  const vol = (s: PRSet) => Math.max(0, s.kg) * s.reps;

  return {
    add(sets) {
      for (const s of sets) {
        let p = global;
        if (gymOnly(rule, s)) {
          p = byGym.get(s.gym) ?? newPart();
          byGym.set(s.gym, p);
        }
        p.n++;
        p.maxReps = Math.max(p.maxReps, s.reps);
        if (lifted(s)) {
          p.nW++;
          p.maxLoad = Math.max(p.maxLoad, loadOf(s));
        }
        const e = e1rmOf(s.kg, s.reps);
        if (e != null) {
          p.nE++;
          p.maxE = Math.max(p.maxE, e);
        }
        p.maxVol = Math.max(p.maxVol, vol(s));
        frontAdd(p.front, s.kg, s.reps);
        for (const k of rule.cardio) p.cardio[k] = Math.max(p.cardio[k], cardioOf(s, k));
      }
    },

    check(current, gym) {
      const parts = [global, byGym.get(gym ?? '')].filter((p): p is Part => !!p);
      const has = (f: (p: Part) => number) => parts.some(p => f(p) > 0);
      const max = (f: (p: Part) => number) => Math.max(...parts.map(f));
      const now = current.filter(s => s.reps > 0 || s.kg !== 0 || s.sec > 0 || s.km > 0 || s.kmh > 0);
      if (!has(p => p.n) || !now.length) return [];
      const hits: RecordHit[] = [];

      // 5. 有氧 / 计时：以前没记过这一项（最大是 0）不算
      for (const k of rule.cardio) {
        const prev = max(p => p.cardio[k]);
        const best = maxBy(now, s => cardioOf(s, k))!;
        if (prev > 0 && cardioOf(best, k) > prev + CARDIO_TOL[k]) hits.push({ kind: k, prev, next: cardioOf(best, k), at: best.at });
      }

      if (!rule.tracksWeight) {
        if (rule.tracksReps) {
          const prev = max(p => p.maxReps);
          const best = maxBy(now, s => s.reps)!;
          if (best.reps > prev) hits.push({ kind: 'reps', prev, next: best.reps, at: best.at });
        }
        return hits.sort(byPriority);
      }

      const nowW = now.filter(s => lifted(s) && s.kg > 0);
      if (has(p => p.nW) && nowW.length) {
        const prev = max(p => p.maxLoad);
        const best = maxBy(nowW, loadOf)!;
        if (loadOf(best) > prev + TOL_KG && (prev > 0 || rule.signed)) hits.push({ kind: 'weight', prev, next: loadOf(best), at: best.at });
      }

      // 2. 估算 1RM（带号的不估）
      if (!rule.signed) {
        const nowE = now.map(s => ({ s, v: e1rmOf(s.kg, s.reps) })).filter((x): x is { s: PRSet; v: number } => x.v != null);
        if (has(p => p.nE) && nowE.length) {
          const prev = max(p => p.maxE);
          const best = maxBy(nowE, x => x.v)!;
          // 容差跟着 Epley 的倍数放大：重量差 TOL_KG 估出来差 TOL_KG×(1 + r/30)
          if (best.v > prev + TOL_KG * (1 + best.s.reps / 30)) hits.push({ kind: 'e1rm', prev, next: best.v, at: best.s.at });
        }
      }

      // 3. 次数纪录：不被历史上任何一组盖住（更重或一样重、更多或一样多）。容差只加在查询这一侧
      const repsAtLeast = (kg: number) => max(p => frontRepsAtLeast(p.front, kg - TOL_KG));
      const fresh = now.filter(c => c.reps > 0 && !(repsAtLeast(c.kg) >= c.reps));
      if (fresh.length) {
        // 挑最重的那组（同重挑次数多的）报
        const c = fresh.reduce((b, x) => (x.kg > b.kg + TOL_KG || (Math.abs(x.kg - b.kg) <= TOL_KG && x.reps > b.reps) ? x : b));
        // 之前在这个重量（及更重）下最多做到几次
        hits.push({ kind: 'reps', prev: Math.max(0, repsAtLeast(c.kg)), next: c.reps, atKg: c.kg, at: c.at });
      }

      // 4. 单组容量（带号的不算）
      if (!rule.signed) {
        const prev = max(p => p.maxVol);
        const best = maxBy(now, vol)!;
        if (prev > 0 && vol(best) > prev + TOL_KG * best.reps) hits.push({ kind: 'volume', prev, next: vol(best), at: best.at });
      }

      return hits.sort(byPriority);
    },
  };
}

/**
 * 本场这几组破了哪些纪录（按 RECORD_PRIORITY 排好）。
 * history：这个动作（同一做法）以前所有做完的组，各带自己那场的馆；按规矩分区，只和全局 + 本馆比。
 * current：本场的组（都在 gym 这个馆）。
 */
export function findRecords(rule: PRRule, history: PRSet[], current: PRSet[], gym: string | undefined): RecordHit[] {
  const tr = createRecordTracker(rule);
  tr.add(history);
  return tr.check(current, gym);
}

/**
 * 训练中这张卡标 PB 的那一行（没有＝-1）。本场同项目还有别的卡时（计划排两行、并入、复制为今天），几张合起来只标一行（审查 C84）：
 * 别的卡按卡序放前后、去掉 at 一起判，破纪录的那组在别的卡上就不标这张；并列时 findRecords 取前面的，也就是卡序在前的那张。
 */
export function recordAtAmong(
  rule: PRRule,
  history: PRSet[],
  own: PRSet[],
  peers: { before: PRSet[]; after: PRSet[] } | undefined,
  gym: string | undefined,
): number {
  const strip = (xs: PRSet[]) => xs.map(({ at: _at, ...x }) => x);
  const cur = peers ? [...strip(peers.before), ...own, ...strip(peers.after)] : own;
  return findRecords(rule, history, cur, gym)[0]?.at ?? -1;
}
