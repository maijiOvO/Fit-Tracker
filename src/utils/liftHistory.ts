/**
 * 「按动作」历史的数据层：一个动作（动作 + 练法）逐场的最好一组、纪录、估算 1RM。
 *
 * 列表、详情、趋势图三处共用这一份口径，避免再出现「列表按带符号负荷、图按原始 weight」
 * 那种不一致（辅助 −20 在列表是 −20、在图上画成 20）。
 *
 * 全部是纯函数，单位一律存储单位（kg / km），显示时再换算。
 */
import type { Exercise, WorkoutSession } from '../../types';
import { signedKg } from './load';
import { e1rmOf, findRecords, prSetsOf, type PRSet, type RecordKind } from './prRecords';

/** 估算 1RM 的伪指标键。不在 activeMetrics 里，只在图表 / 纪录里出现 */
export const E1RM = 'e1rm';

export interface SetRef {
  /** 带符号的 kg（辅助为负）；不带号的动作就是 weight */
  kg: number;
  reps: number;
}

export interface LiftSession {
  workoutId: string;
  exerciseId: string;
  /** 训练的 date（ISO） */
  date: string;
  ts: number;
  gym?: string;
  fromSchedule?: WorkoutSession['fromSchedule'];
  exerciseTime?: string;
  exercise: Exercise;
  /** 不含底稿行 */
  sets: any[];
  /** 最重的一组（同重取次数多的） */
  top: SetRef | null;
  /** 估算 1RM 最高的一组 */
  e1rm: (SetRef & { value: number }) | null;
  /** 次数最多的一组（同次数取更重的） */
  mostReps: SetRef | null;
  /** 这一场破了哪几种纪录（utils/prRecords，和刊末页的 PB 牌同一口径）；第一次练 / 这个馆第一次练的器械没有 */
  records: RecordKind[];
  /** 这个动作按带正负的负荷比 */
  signed: boolean;
}

export interface LiftRecord {
  value: number;
  ts: number;
  set?: SetRef;
}

export interface LiftSummary {
  key: string;
  /** 稳定键「定义 id|做法 id」：改名、切语言不变（特别关注按它存） */
  stableId: string;
  baseName: string;
  /** 按带正负的负荷记（自重类） */
  signed: boolean;
  hasWeight: boolean;
  /** 历史里有过一组负荷不为 0（带号动作：加过负重或辅助）；纯自重练的动作为 false */
  loaded: boolean;
  /** 旧 → 新 */
  sessions: LiftSession[];
  lastTs: number;
  best: {
    weight: LiftRecord | null;
    e1rm: LiftRecord | null;
    reps: LiftRecord | null;
  };
}

/**
 * 一场里某个指标的值（存储单位）。没有可比的数据返回 null。
 * weight 按带符号的 kg；e1rm 取估算最高的那组；其余指标取各组最大。
 */
export function sessionMetric(s: LiftSession, metric: string): number | null {
  if (metric === E1RM) return s.e1rm?.value ?? null;
  if (metric === 'weight') return s.top?.kg ?? null;
  if (metric === 'reps') return s.mostReps?.reps ?? null;
  const vs = s.sets.map(set => Number(set[metric]) || 0).filter(v => v > 0);
  return vs.length ? Math.max(...vs) : null;
}

/** 这一场里决定该指标的那一组（tooltip、逐场列表用）；非力量指标没有 */
export function sessionMetricSet(s: LiftSession, metric: string): SetRef | null {
  if (metric === E1RM) return s.e1rm;
  if (metric === 'weight') return s.top;
  if (metric === 'reps') return s.mostReps;
  return null;
}

function buildSession(w: WorkoutSession, ex: Exercise, signed: boolean): LiftSession | null {
  const sets = (ex.sets ?? []).filter((s: any) => !s.ghost);
  if (!sets.length) return null;
  let top: SetRef | null = null;
  let e1rm: LiftSession['e1rm'] = null;
  let mostReps: SetRef | null = null;
  for (const s of sets) {
    const kg = signed ? signedKg(s, ex) : Number(s.weight) || 0;
    const reps = Number(s.reps) || 0;
    if (!top || kg > top.kg || (kg === top.kg && reps > top.reps)) top = { kg, reps };
    if (reps > 0 && (!mostReps || reps > mostReps.reps || (reps === mostReps.reps && kg > mostReps.kg))) {
      mostReps = { kg, reps };
    }
    // 带号的动作不估 1RM：自重那部分不在数里，估出来的数没有意义
    const est = signed ? null : e1rmOf(kg, reps);
    if (est != null && (!e1rm || est > e1rm.value)) e1rm = { kg, reps, value: est };
  }
  return {
    workoutId: w.id,
    exerciseId: ex.id,
    date: w.date,
    ts: new Date(w.date).getTime(),
    gym: w.gym,
    fromSchedule: w.fromSchedule,
    exerciseTime: ex.exerciseTime,
    exercise: ex,
    sets,
    top,
    e1rm,
    mostReps,
    records: [],
    signed,
  };
}

function bestOf(
  sessions: LiftSession[],
  pick: (s: LiftSession) => { value: number; set?: SetRef } | null,
): LiftRecord | null {
  let best: LiftRecord | null = null;
  for (const s of sessions) {
    const p = pick(s);
    if (!p) continue;
    // 严格大于：同值保留最早达成的那次
    if (!best || p.value > best.value) best = { value: p.value, ts: s.ts, set: p.set };
  }
  return best;
}

interface BuildParams {
  workouts: WorkoutSession[];
  stableIdOf: (ex: Exercise) => string;
  liftKey: (ex: Exercise) => string;
  resolveName: (name: string) => string;
  signedLoadOf: (ex: Exercise) => boolean;
  getActiveMetrics: (baseName: string) => string[];
  /** 器械类（配重片 / 挂片）的纪录只在同一个馆里比（useGymScopedPR）；不传＝都跨馆 */
  gymScoped?: (ex: Exercise) => boolean;
}

/** 全部动作的逐场数据；未排序 */
export function buildLiftSummaries({
  workouts,
  stableIdOf,
  liftKey,
  resolveName,
  signedLoadOf,
  getActiveMetrics,
  gymScoped,
}: BuildParams): LiftSummary[] {
  const map = new Map<string, LiftSummary>();
  for (const w of workouts) {
    for (const ex of w.exercises ?? []) {
      const key = liftKey(ex);
      let lift = map.get(key);
      if (!lift) {
        const baseName = resolveName(ex.name);
        lift = {
          key,
          stableId: stableIdOf(ex),
          baseName,
          signed: false,
          hasWeight: getActiveMetrics(baseName).includes('weight'),
          loaded: false,
          sessions: [],
          lastTs: 0,
          best: { weight: null, e1rm: null, reps: null },
        };
        map.set(key, lift);
      }
      // 只要有一场按带号记，这个动作就按带号比：同一个动作前后口径一致
      if (signedLoadOf(ex)) lift.signed = true;
    }
  }
  // 号定下来之后再逐场算：同一个动作前后口径必须一致
  for (const w of workouts) {
    for (const ex of w.exercises ?? []) {
      const lift = map.get(liftKey(ex))!;
      const s = buildSession(w, ex, lift.signed);
      if (s) lift.sessions.push(s);
    }
  }
  const out: LiftSummary[] = [];
  for (const lift of map.values()) {
    if (!lift.sessions.length) continue;
    lift.sessions.sort((a, b) => a.ts - b.ts);
    lift.lastTs = lift.sessions[lift.sessions.length - 1].ts;
    // 逐场判纪录：和结束训练时一样，只拿这一场之前的比（器械只比同一个馆）
    const rule = { tracksWeight: lift.hasWeight, signed: lift.signed, machine: !!gymScoped?.(lift.sessions[0].exercise) };
    const hist: PRSet[] = [];
    for (const s of lift.sessions) {
      const cur = prSetsOf(s.exercise, s.gym, lift.signed);
      s.records = findRecords(rule, hist, cur, s.gym).map(h => h.kind);
      hist.push(...cur);
    }
    lift.loaded = lift.sessions.some(s => s.sets.some((set: any) =>
      (lift.signed ? signedKg(set, s.exercise) : Number(set.weight) || 0) !== 0));
    lift.best = {
      weight: bestOf(lift.sessions, s => (s.top ? { value: s.top.kg, set: s.top } : null)),
      e1rm: lift.signed ? null : bestOf(lift.sessions, s => (s.e1rm ? { value: s.e1rm.value, set: s.e1rm } : null)),
      reps: bestOf(lift.sessions, s => (s.mostReps ? { value: s.mostReps.reps, set: s.mostReps } : null)),
    };
    out.push(lift);
  }
  return out;
}

/**
 * 这个动作可选的图表指标，第一个是默认（2026-10-20 用户定）：
 *   - 负重动作默认看重量；估算 1RM 只是可选项，排在重量后面 —— 公式推出来的数不如重量直观
 *   - 自重动作从没加过负重 / 辅助：重量一直是 0，画出来是一条平线，默认看次数
 *   - 自重动作加过负重 / 辅助：默认看带号的重量（辅助 −30 → 自重 → +10 一路往上就是进步）
 */
export function chartMetricsFor(lift: LiftSummary, activeMetrics: string[]): string[] {
  const list = [...activeMetrics];
  if (lift.hasWeight && !lift.signed && lift.best.e1rm) {
    const i = list.indexOf('weight');
    list.splice(i + 1, 0, E1RM);
  }
  if (lift.signed && !lift.loaded && list.includes('reps')) {
    list.splice(list.indexOf('reps'), 1);
    list.unshift('reps');
  }
  if (lift.hasWeight && (!lift.signed || lift.loaded) && list[0] !== 'weight') {
    list.splice(list.indexOf('weight'), 1);
    list.unshift('weight');
  }
  return list.length ? list : ['reps'];
}

export interface TrendPoint {
  ts: number;
  /** 这一场的值；补到今天的那个延长点没有 */
  val: number | null;
  /** 截至这一场的历史最好（阶梯线） */
  best: number;
  /** 这一场刷新了纪录（utils/prRecords 同口径：历史为空不算 PR，器械只比同一个馆） */
  pr: boolean;
  set?: SetRef | null;
  gym?: string;
  workoutId?: string;
}

/**
 * 这一场在这个指标上算不算破纪录：重量 / 估算 1RM / 次数指标按 utils/prRecords 判出来的那几种
 * （和刊末页、训练中的 PB 标一个口径，分馆也一样）；带号动作的重量图上，少用辅助的次数纪录也算（数往上走了）。
 * 其余指标（时长、距离…）照旧按数比。
 */
function isRecordOn(s: LiftSession, metric: string, rose: boolean): boolean {
  if (metric === 'weight') return s.records.includes('weight') || (s.signed && rose && s.records.includes('reps'));
  if (metric === E1RM) return s.records.includes('e1rm');
  if (metric === 'reps') return s.records.includes('reps');
  return rose;
}

/** 逐场的值 + 阶梯纪录线。阈值很小，只挡浮点噪声 */
export function trendPoints(sessions: LiftSession[], metric: string): TrendPoint[] {
  const out: TrendPoint[] = [];
  let best = -Infinity;
  let seen = false;
  for (const s of sessions) {
    const v = sessionMetric(s, metric);
    if (v == null) continue;
    const pr = seen && isRecordOn(s, metric, v > best + 1e-6);
    if (v > best) best = v;
    out.push({ ts: s.ts, val: v, best, pr, set: sessionMetricSet(s, metric), gym: s.gym, workoutId: s.workoutId });
    seen = true;
  }
  return out;
}

/** workoutId → 这一场在该指标上刷新了纪录 */
export function prSessionIds(sessions: LiftSession[], metric: string): Set<string> {
  return new Set(trendPoints(sessions, metric).filter(p => p.pr).map(p => p.workoutId!));
}

export type ChartRange = '3m' | '6m' | '1y' | 'all';
const RANGE_DAYS: Record<Exclude<ChartRange, 'all'>, number> = { '3m': 91, '6m': 183, '1y': 365 };

export function rangeStart(range: ChartRange, now = Date.now()): number {
  return range === 'all' ? -Infinity : now - RANGE_DAYS[range] * 86400000;
}

// ---------------------------------------------------------------------------
// 特别关注
// ---------------------------------------------------------------------------

/** 默认的特别关注：三大项（深蹲、卧推、硬拉的标准做法），按力量举的比赛顺序 */
export const BIG_THREE = ['sq_barbell|', 'bp_barbell|', 'dl_barbell|'];

/** 截至某一刻（含）的历史最好；那时还没练过返回 null */
export function bestAsOf(lift: LiftSummary, metric: string, ts: number): number | null {
  let best: number | null = null;
  for (const s of lift.sessions) {
    if (s.ts > ts) break;
    const v = sessionMetric(s, metric);
    if (v != null && (best == null || v > best)) best = v;
  }
  return best;
}

export interface FeaturedStats {
  metric: string;
  best: number;
  /** 决定纪录的那一组（重量 / 次数指标才有） */
  bestSet: SetRef | null;
  bestTs: number;
  /** 第一次练这个动作时的值（起步） */
  first: number;
  firstTs: number;
  /** 破纪录的次数（第一场不算） */
  prCount: number;
  /** 最近一次破纪录；从没破过（只练过一次 / 一直没超过起步）为 null */
  lastPrTs: number | null;
  /** 阶梯纪录线的点（全部历史） */
  steps: { ts: number; best: number }[];
}

export function featuredStats(lift: LiftSummary, metric: string): FeaturedStats | null {
  const pts = trendPoints(lift.sessions, metric);
  if (!pts.length) return null;
  let bestPt = pts[0];
  for (const p of pts) if (p.val != null && p.val > (bestPt.val ?? -Infinity)) bestPt = p;
  const prs = pts.filter(p => p.pr);
  return {
    metric,
    best: bestPt.val!,
    bestSet: bestPt.set ?? null,
    bestTs: bestPt.ts,
    first: pts[0].val!,
    firstTs: pts[0].ts,
    prCount: prs.length,
    lastPrTs: prs.length ? prs[prs.length - 1].ts : null,
    steps: pts.map(p => ({ ts: p.ts, best: p.best })),
  };
}
