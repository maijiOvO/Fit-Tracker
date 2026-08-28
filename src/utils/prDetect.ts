/**
 * PR 检测 —— 规格 §9
 *
 * useExerciseStats.bestLifts 早就算了「历史最大单组重量」，但保存流程从来不调用它，
 * 所以这个 App 至今没有「破纪录」这个概念。这里补上。
 *
 * ⚠️ 判定口径必须写死，否则仪式会贬值。每一条都有理由，别随手放宽：
 *   - 历史为空不算 PR —— 否则第一次训练全是 PR，签名时刻当场作废
 *   - 编辑旧训练不触发 —— 在改历史，语义混乱
 *   - 阈值 0.5kg 或 1% —— 挡住 kg⇄lbs 换算的浮点噪声反复触发
 *   - 最多 2 枚印 —— 满屏印章就不是签名时刻了
 */
import { WorkoutSession, Exercise } from '../../types';

export type PRKind = 'weight' | 'volume' | 'reps';

export interface PRHit {
  kind: PRKind;
  /** 显示用动作名（已 resolve） */
  exercise: string;
  prev: number;
  next: number;
  /** 提升幅度，用于排序取最大者 */
  delta: number;
  unitLabel: string;
}

export interface PRResult {
  /** 最多 2 枚印 */
  stamps: PRHit[];
  /** >2 时，第二枚合并成「另 N 项刷新」 */
  extraCount: number;
}

/** §9 阈值：提升 < 0.5kg 或 < 1% 不算 */
function passesThreshold(prev: number, next: number): boolean {
  if (prev <= 0) return false;
  const abs = next - prev;
  if (abs < 0.5) return false;
  if (abs / prev < 0.01) return false;
  return true;
}

function maxSetWeight(ex: Exercise): number {
  const ws = (ex.sets ?? []).map((s: any) => s.weight || 0);
  return ws.length ? Math.max(...ws) : 0;
}

function maxSetReps(ex: Exercise): number {
  const rs = (ex.sets ?? []).map((s: any) => s.reps || 0);
  return rs.length ? Math.max(...rs) : 0;
}

/** 单次训练里这个动作的总容量 Σ(weight × reps)，含递减子组 */
function exerciseVolume(ex: Exercise): number {
  return (ex.sets ?? []).reduce((sum: number, s: any) => {
    let v = (s.weight || 0) * (s.reps || 0);
    for (const sub of s.subSets || []) v += (sub.weight || 0) * (sub.reps || 0);
    return sum + v;
  }, 0);
}

interface DetectParams {
  /** 刚结束的这一场 */
  session: WorkoutSession;
  /** 历史训练（不含本场） */
  history: WorkoutSession[];
  /** 编辑旧训练时不触发 */
  editingWorkoutId: string | null;
  resolveName: (name: string) => string;
  /** 判断自重类动作：activeMetrics 不含 weight 时才启用 reps 口径 */
  getActiveMetrics: (name: string) => string[];
  unitLabel: string;
}

export function detectPRs({
  session,
  history,
  editingWorkoutId,
  resolveName,
  getActiveMetrics,
  unitLabel,
}: DetectParams): PRResult {
  // 在改历史，语义混乱，不触发
  if (editingWorkoutId !== null) return { stamps: [], extraCount: 0 };

  const hits: PRHit[] = [];

  for (const ex of session.exercises ?? []) {
    const name = resolveName(ex.name).trim();
    if (!name) continue;

    // 该动作的历史记录
    const past = history.flatMap(w =>
      (w.exercises ?? []).filter(e => resolveName(e.name).trim() === name),
    );
    // 历史为空不算 PR
    if (past.length === 0) continue;

    const metrics = getActiveMetrics(name);
    const tracksWeight = metrics.includes('weight');

    if (tracksWeight) {
      // weight：该动作历史 max(sets.weight)，本次更大
      const prevW = Math.max(...past.map(maxSetWeight));
      const nextW = maxSetWeight(ex);
      if (passesThreshold(prevW, nextW)) {
        hits.push({ kind: 'weight', exercise: name, prev: prevW, next: nextW, delta: nextW - prevW, unitLabel });
        continue; // §9：同时命中时 weight 优先于 volume（更硬）
      }

      // volume：该动作单次训练总容量，本次更大
      const prevV = Math.max(...past.map(exerciseVolume));
      const nextV = exerciseVolume(ex);
      if (passesThreshold(prevV, nextV)) {
        hits.push({ kind: 'volume', exercise: name, prev: prevV, next: nextV, delta: nextV - prevV, unitLabel });
      }
    } else {
      // reps：仅当 activeMetrics 不含 weight（自重类）时启用
      const prevR = Math.max(...past.map(maxSetReps));
      const nextR = maxSetReps(ex);
      if (passesThreshold(prevR, nextR)) {
        hits.push({ kind: 'reps', exercise: name, prev: prevR, next: nextR, delta: nextR - prevR, unitLabel: '' });
      }
    }
  }

  if (hits.length === 0) return { stamps: [], extraCount: 0 };

  // §9 数量上限：最多 2 枚印；>2 时第一枚取提升幅度最大者，
  // 第二枚合并为「另 N 项刷新」。
  const sorted = [...hits].sort((a, b) => b.delta / Math.max(b.prev, 1) - a.delta / Math.max(a.prev, 1));
  if (sorted.length <= 2) return { stamps: sorted, extraCount: 0 };
  return { stamps: [sorted[0]], extraCount: sorted.length - 1 };
}

/** 一场训练的总容量与总组数，刊末页要用 */
export function sessionSummary(session: WorkoutSession) {
  const exercises = session.exercises ?? [];
  const sets = exercises.reduce((n, ex) => n + (ex.sets?.length || 0), 0);
  const volume = exercises.reduce((n, ex) => n + exerciseVolume(ex), 0);
  return { exerciseCount: exercises.length, setCount: sets, volumeKg: volume };
}
