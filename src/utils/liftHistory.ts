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
import { createRecordTracker, e1rmOf, prRuleFor, prSetsOf, setSpeedKmh, type PRRule, type RecordKind } from './prRecords';

/** 估算 1RM 的伪指标键。不在 activeMetrics 里，只在图表 / 纪录里出现 */
export const E1RM = 'e1rm';

export interface SetRef {
  /** 带符号的 kg（辅助为负）；不带号的动作就是 weight */
  kg: number;
  reps: number;
}

/** 一场＝这场里这个项目（动作 + 做法）的全部卡：计划排两行、并入上一场、复制为今天都会让一场里有几张（审查 C84 / gap-4#1） */
export interface LiftSession {
  workoutId: string;
  /** 第一张有做完组的卡（编辑、改动作时间按它定位） */
  exerciseId: string;
  /** 这一场里这个项目的全部卡（按卡序）：「删除这条」一起删 */
  exerciseIds: string[];
  /** 训练的 date（ISO） */
  date: string;
  ts: number;
  gym?: string;
  fromSchedule?: WorkoutSession['fromSchedule'];
  exerciseTime?: string;
  /** 第一张卡 */
  exercise: Exercise;
  cards: Exercise[];
  /** 不含底稿行，几张卡按卡序接起来 */
  sets: any[];
  /** 以下三个在全部组里挑，递减 / 递增档各算一组 —— 最重的一组（同重取次数多的）；记次数的动作不挑次数为 0 的组（同 prRecords，审查 C81） */
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
  /**
   * 组里出现过的全部稳定键。同一个项目键下可能有好几个（手填名后来补建成自建动作、删做法后同名重建之前的旧数据），
   * 目标和特别关注命中其中任一个就算找到（审查 C30）
   */
  ids: string[];
  baseName: string;
  /** 按带正负的负荷记（自重类） */
  signed: boolean;
  /** 器械类：纪录只和同一个馆比（gymChoices / inGym 按馆看） */
  machine: boolean;
  /** 这个动作按哪套规矩判纪录（prRuleFor：记不记重量 / 次数、比哪几项有氧） */
  rule: PRRule;
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
 * weight 按带符号的 kg；e1rm 取估算最高的那组；speed 取各组的速度（没打速度按距离 ÷ 时长算均速）；其余指标取各组最大。
 */
export function sessionMetric(s: LiftSession, metric: string): number | null {
  if (metric === E1RM) return s.e1rm?.value ?? null;
  if (metric === 'weight') return s.top?.kg ?? null;
  if (metric === 'reps') return s.mostReps?.reps ?? null;
  const vs = s.sets.map(set => (metric === 'speed' ? setSpeedKmh(set) : Number(set[metric]) || 0)).filter(v => v > 0);
  return vs.length ? Math.max(...vs) : null;
}

/** 这一场里决定该指标的那一组（tooltip、逐场列表用）；非力量指标没有 */
export function sessionMetricSet(s: LiftSession, metric: string): SetRef | null {
  if (metric === E1RM) return s.e1rm;
  if (metric === 'weight') return s.top;
  if (metric === 'reps') return s.mostReps;
  return null;
}

function buildSession(w: WorkoutSession, all: Exercise[], signed: boolean, tracksReps: boolean): LiftSession | null {
  const cards = all.filter(c => (c.sets ?? []).some((s: any) => !s.ghost));
  if (!cards.length) return null;
  const ex = cards[0];
  const sets = cards.flatMap(c => (c.sets ?? []).filter((s: any) => !s.ghost));
  let top: SetRef | null = null;
  let e1rm: LiftSession['e1rm'] = null;
  let mostReps: SetRef | null = null;
  // 和纪录判定同一份组（递减 / 递增档各算一组，审查 Gm0）：否则递增档破了纪录，逐场行和图上写的还是母组
  for (const { kg, reps } of cards.flatMap(c => prSetsOf(c, w.gym, signed))) {
    if ((reps > 0 || !tracksReps) && (!top || kg > top.kg || (kg === top.kg && reps > top.reps))) top = { kg, reps };
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
    exerciseIds: cards.map(c => c.id),
    date: w.date,
    ts: new Date(w.date).getTime(),
    gym: w.gym,
    fromSchedule: w.fromSchedule,
    exerciseTime: ex.exerciseTime,
    exercise: ex,
    cards,
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

function bestsOf(sessions: LiftSession[], signed: boolean): LiftSummary['best'] {
  return {
    weight: bestOf(sessions, s => (s.top ? { value: s.top.kg, set: s.top } : null)),
    e1rm: signed ? null : bestOf(sessions, s => (s.e1rm ? { value: s.e1rm.value, set: s.e1rm } : null)),
    reps: bestOf(sessions, s => (s.mostReps ? { value: s.mostReps.reps, set: s.mostReps } : null)),
  };
}

/**
 * 按馆比的器械练过的馆，最近练的在前（'' = 没标馆的旧训练，它们彼此算一组）。
 * 跨馆比的动作返回空。带正负的动作只有辅助段按馆比，先不分馆看（审查 G4）。
 */
export function gymChoices(lift: LiftSummary): string[] {
  if (!lift.machine || lift.signed) return [];
  const out: string[] = [];
  for (let i = lift.sessions.length - 1; i >= 0; i--) {
    const g = lift.sessions[i].gym ?? '';
    if (!out.includes(g)) out.push(g);
  }
  return out;
}

/** 只看 gym 这个馆的场次：纪录卡、阶梯线、逐场都按这个馆算（跨馆的器械重量本来就不可比）。逐场的纪录本就按馆判，不用重算 */
export function inGym(lift: LiftSummary, gym: string): LiftSummary {
  const sessions = lift.sessions.filter(s => (s.gym ?? '') === gym);
  return { ...lift, sessions, lastTs: sessions[sessions.length - 1].ts, best: bestsOf(sessions, lift.signed) };
}

/** 列表、特别关注用：按馆比的器械看最近练的那个馆，其余原样 */
export function latestGymView(lift: LiftSummary): LiftSummary {
  const gyms = gymChoices(lift);
  return gyms.length ? inGym(lift, gyms[0]) : lift;
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
  const metricsOf = new Map<string, string[]>();
  for (const w of workouts) {
    for (const ex of w.exercises ?? []) {
      const key = liftKey(ex);
      let lift = map.get(key);
      const sid = stableIdOf(ex);
      if (lift && !lift.ids.includes(sid)) lift.ids.push(sid);
      if (!lift) {
        const baseName = resolveName(ex.name);
        const metrics = getActiveMetrics(baseName);
        metricsOf.set(key, metrics);
        lift = {
          key,
          stableId: sid,
          ids: [sid],
          baseName,
          signed: false,
          machine: false,
          // 号和馆在下面逐场判之前定，那时再按定下来的重算
          rule: prRuleFor(metrics, false, false),
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
  // 号定下来之后再逐场算：同一个动作前后口径必须一致。同一场里同项目的几张卡合成一场
  for (const w of workouts) {
    const byKey = new Map<string, Exercise[]>();
    for (const ex of w.exercises ?? []) {
      const key = liftKey(ex);
      byKey.set(key, [...(byKey.get(key) ?? []), ex]);
    }
    for (const [key, cards] of byKey) {
      const lift = map.get(key)!;
      const s = buildSession(w, cards, lift.signed, metricsOf.get(key)!.includes('reps'));
      if (s) lift.sessions.push(s);
    }
  }
  const out: LiftSummary[] = [];
  for (const [key, lift] of map) {
    if (!lift.sessions.length) continue;
    lift.sessions.sort((a, b) => a.ts - b.ts);
    lift.lastTs = lift.sessions[lift.sessions.length - 1].ts;
    // 逐场判纪录：和结束训练时一样，只拿这一场之前的比（器械只比同一个馆）。累计着判，不每场重扫此前全部组（审查 C36）
    lift.machine = !!gymScoped?.(lift.sessions[0].exercise);
    lift.rule = prRuleFor(metricsOf.get(key)!, lift.signed, lift.machine);
    const tr = createRecordTracker(lift.rule);
    for (const s of lift.sessions) {
      const cur = s.cards.flatMap(c => prSetsOf(c, s.gym, lift.signed));
      s.records = tr.check(cur, s.gym).map(h => h.kind);
      tr.add(cur);
    }
    lift.loaded = lift.sessions.some(s => s.cards.some(c => (c.sets ?? []).some((set: any) =>
      !set.ghost && (lift.signed ? signedKg(set, c) : Number(set.weight) || 0) !== 0)));
    lift.best = bestsOf(lift.sessions, lift.signed);
    out.push(lift);
  }
  return out;
}

/**
 * 这个动作可选的图表指标，第一个是默认（2026-10-20 用户定）：
 *   - 负重动作默认看重量；估算 1RM 只是可选项，排在重量后面 —— 公式推出来的数不如重量直观
 *   - 自重动作从没加过负重 / 辅助：重量一直是 0，画出来是一条平线，默认看次数
 *   - 自重动作加过负重 / 辅助：默认看带号的重量（辅助 −30 → 自重 → +10 一路往上就是进步）
 *   - 有氧（距离和时长都记）：默认看速度，没记速度就插一个派生的均速（距离 ÷ 时长）排第一（2026-11-24 用户定，审查 gap-5#4）——
 *     定距离跑 5 km 时距离是一条平线、时长变长是退步，进步只在均速上看得出来；这里推出来的数比原始数更直观，和上面估算 1RM 排后面相反
 */
export function chartMetricsFor(lift: LiftSummary, activeMetrics: string[]): string[] {
  const list = [...activeMetrics];
  if (list.includes('distance') && list.includes('duration')) {
    if (list.includes('speed')) list.splice(list.indexOf('speed'), 1);
    list.unshift('speed');
  }
  if (lift.rule.tracksWeight && !lift.signed && lift.best.e1rm) {
    const i = list.indexOf('weight');
    list.splice(i + 1, 0, E1RM);
  }
  if (lift.signed && !lift.loaded && list.includes('reps')) {
    list.splice(list.indexOf('reps'), 1);
    list.unshift('reps');
  }
  if (lift.rule.tracksWeight && (!lift.signed || lift.loaded) && list[0] !== 'weight') {
    list.splice(list.indexOf('weight'), 1);
    list.unshift('weight');
  }
  return list.length ? list : ['reps'];
}

/** 这个指标有没有「最好」：记了距离的动作，时长长了多半是跑慢了，不画纪录线、不出纪录卡（审查 gap-5#4） */
export function hasBest(lift: LiftSummary, metric: string): boolean {
  return metric !== 'duration' || lift.rule.cardio.includes('duration');
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
 * 这一场在这个指标上算不算破纪录：重量 / 估算 1RM / 次数 / 距离 / 速度 / 时长按 utils/prRecords 判出来的那几种
 * （和刊末页、训练中的 PB 标一个口径，分馆也一样）；带号动作的重量图上，少用辅助的次数纪录也算（数往上走了）。
 * 自定义项没有方向设置，照旧按越大越好比。
 */
function isRecordOn(s: LiftSession, metric: string, rose: boolean): boolean {
  if (metric === 'weight') return s.records.includes('weight') || (s.signed && rose && s.records.includes('reps'));
  if (metric === E1RM) return s.records.includes('e1rm');
  // 次数图上的点是全场最多次数：只有它真涨了才标（80×9 胜过 80×8 是次数纪录，但点还是那组 40×15，审查 Gm0）
  if (metric === 'reps') return rose && s.records.includes('reps');
  if (metric === 'distance' || metric === 'speed' || metric === 'duration') return s.records.includes(metric);
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
