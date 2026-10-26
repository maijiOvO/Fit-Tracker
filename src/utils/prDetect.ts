/**
 * PR 检测 —— 规格 §9。判定口径在 utils/prRecords（和训练中的 PB 标、历史纪录点同一份）。
 *
 * 这里管的是刊末页上牌的那几条规矩：
 *   - 历史为空不算 PR —— 否则第一次训练全是 PR，签名时刻当场作废
 *   - 编辑旧训练不触发 —— 在改历史，语义混乱
 *   - 每个动作只上一种纪录（最大重量 > 估算 1RM > 次数纪录 > 单组容量）
 *   - 最多 2 枚牌，再多合成「另 N 项刷新」—— 满屏印章就不是签名时刻了
 */
import { WorkoutSession, Exercise } from '../../types';
import { setVolumeKg } from './load';
import { RECORD_PRIORITY, findRecords, prSetsOf, type PRSet, type RecordKind } from './prRecords';

export type PRKind = RecordKind;

export interface PRHit {
  kind: PRKind;
  /** 显示用动作名（已 resolve） */
  exercise: string;
  prev: number;
  next: number;
  /** 提升幅度，用于排序取最大者 */
  delta: number;
  unitLabel: string;
  /** 次数纪录：在多重的时候（带符号 kg；辅助为负） */
  atKg?: number;
}

export interface PRResult {
  /** 最多 2 枚印 */
  stamps: PRHit[];
  /** >2 时，第二枚合并成「另 N 项刷新」 */
  extraCount: number;
}

/** 底稿行不是事实（§12.6），不能参与任何纪录判定（history 里可能躺着没结束就被放弃的草稿） */
export function realSets(ex: Exercise): Exercise['sets'] {
  return (ex.sets ?? []).filter((s: any) => !s.ghost);
}

/** 单次训练里这个动作的总容量 Σ(weight × reps)，含子组；辅助的那部分不算 */
function exerciseVolume(ex: Exercise): number {
  return realSets(ex).reduce((sum: number, s: any) => sum + setVolumeKg(s, ex), 0);
}

interface DetectParams {
  /** 刚结束的这一场 */
  session: WorkoutSession;
  /** 历史训练（不含本场） */
  history: WorkoutSession[];
  /** 编辑旧训练时不触发 */
  editingWorkoutId: string | null;
  resolveName: (name: string) => string;
  /**
   * 项目键（第 8 条）：同一动作的不同练法各算各的纪录。不传＝按现名（旧行为）。
   * 印上写的也是它（「高位下拉（宽握）」）。
   */
  keyOf?: (ex: { name: string; variantId?: string; variantName?: string }) => string;
  /** 没有重量这一项的（自重类）按最多次数比 */
  getActiveMetrics: (name: string) => string[];
  unitLabel: string;
  /** 这条记录按带正负的负荷记吗（辅助负、自重 0、负重正）；不传＝都不是 */
  isSigned?: (ex: Exercise) => boolean;
  /** 器械类（配重片 / 挂片）的纪录只在同一个馆里比（useGymScopedPR）；不传＝都跨馆比 */
  gymScoped?: (ex: Exercise) => boolean;
}

export function detectPRs({
  session,
  history,
  editingWorkoutId,
  resolveName,
  keyOf,
  getActiveMetrics,
  unitLabel,
  isSigned,
  gymScoped,
}: DetectParams): PRResult {
  const key = keyOf ?? ((e: { name: string }) => resolveName(e.name));
  // 在改历史，语义混乱，不触发
  if (editingWorkoutId !== null) return { stamps: [], extraCount: 0 };

  const hits: PRHit[] = [];

  for (const ex of session.exercises ?? []) {
    const name = key(ex).trim();
    if (!name) continue;
    const signed = !!isSigned?.(ex);
    const rule = {
      // 动作设置按动作共享，不分练法
      tracksWeight: getActiveMetrics(resolveName(ex.name)).includes('weight'),
      signed,
      machine: !!gymScoped?.(ex),
    };
    const past: PRSet[] = history.flatMap(w =>
      (w.exercises ?? []).filter(e => key(e).trim() === name).flatMap(e => prSetsOf(e, w.gym, signed)),
    );
    const top = findRecords(rule, past, prSetsOf(ex, session.gym, signed), session.gym)[0];
    if (!top) continue;
    hits.push({
      kind: top.kind,
      exercise: name,
      prev: top.prev,
      next: top.next,
      delta: top.next - top.prev,
      unitLabel: top.kind === 'reps' && !rule.tracksWeight ? '' : unitLabel,
      ...(top.atKg !== undefined ? { atKg: top.atKg } : {}),
    });
  }

  if (hits.length === 0) return { stamps: [], extraCount: 0 };

  // §9 数量上限：最多 2 枚印。先按纪录的硬度（最大重量最硬），同一种按提升幅度；
  // >2 时第一枚取最前面那个，第二枚合并为「另 N 项刷新」。
  const sorted = [...hits].sort(
    (a, b) =>
      RECORD_PRIORITY.indexOf(a.kind) - RECORD_PRIORITY.indexOf(b.kind) ||
      b.delta / Math.max(Math.abs(b.prev), 1) - a.delta / Math.max(Math.abs(a.prev), 1),
  );
  if (sorted.length <= 2) return { stamps: sorted, extraCount: 0 };
  return { stamps: [sorted[0]], extraCount: sorted.length - 1 };
}

/**
 * 印章上的数按显示单位换算（pr-stamp-kg-labeled-lbs）。
 * detectPRs 只管判定，prev / next / delta 一律是库里存的 kg（容量是 kg×次）；
 * 刊末页后面又标着当前单位，lbs 下不换算就成了「83.9 → 90.7 lbs」。
 * 次数类（reps）不是重量，不换算。
 */
export function stampsInUnit(stamps: PRHit[], unit: 'kg' | 'lbs', kgToLbs: number): PRHit[] {
  if (unit === 'kg') return stamps;
  return stamps.map(s =>
    s.kind === 'reps'
      ? s.atKg !== undefined ? { ...s, atKg: s.atKg * kgToLbs } : s
      : { ...s, prev: s.prev * kgToLbs, next: s.next * kgToLbs, delta: s.delta * kgToLbs },
  );
}

/** 一场训练的总容量与总组数，刊末页要用 */
export function sessionSummary(session: WorkoutSession) {
  const exercises = session.exercises ?? [];
  const sets = exercises.reduce((n, ex) => n + realSets(ex).length, 0);
  const volume = exercises.reduce((n, ex) => n + exerciseVolume(ex), 0);
  return { exerciseCount: exercises.length, setCount: sets, volumeKg: volume };
}
