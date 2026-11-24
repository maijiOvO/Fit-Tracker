/**
 * 组上有哪些「值」只在这里定义（上架审查 C21 / gap-3#1 / gap-5#2 / gap-2#2）。
 *
 * 原来有四份各写各的：入册判定（setHasValue）、记 touched 的键表（setWrite.VALUE_KEYS）、底稿复制（toGhostSets）、
 * 添加组的展开。前三份都漏了速度和自定义记录项：只记速度 / RPE 的组被当成空组整个丢掉，底稿上只改了速度被当成没动过整行换掉，
 * 底稿、复制、计划开练都不抄它们。反过来，复制点又不看动作当前开着哪些记录项：训练中关掉的次数、计划塞进的「次数 10」
 * 藏在组里照样入册、一场场抄下去。
 *
 * 用白名单、不用「任意数值字段」：seq（时间戳）、want、added 都是数，但不是数据。
 */
import type { SetLog } from '../../types';

const STANDARD = new Set(['weight', 'reps', 'distance', 'duration', 'speed']);
/** 旧字段：time / score 只在老数据里有 */
const LEGACY = new Set(['time', 'score']);
/** 跟着值一起改的伴随键：改了它们也算这一格动过 */
const COMPANIONS = new Set(['timeUnit', 'distanceUnit', 'bodyweightMode', 'subSets']);

export const isValueKey = (k: string): boolean => STANDARD.has(k) || LEGACY.has(k) || k.startsWith('custom_');
export const isTouchKey = (k: string): boolean => isValueKey(k) || COMPANIONS.has(k);

const anyTouched = (t: Record<string, boolean | undefined> | undefined) => Object.values(t ?? {}).some(Boolean);

/**
 * 这一行亲手动过：改过某一格（touched）、点了力竭、或某个递减档改过。
 * 力竭直接读字段、不进 touched：取消竭以后这行自动回到「没动过」。
 */
export function rowEdited(s: SetLog): boolean {
  return anyTouched(s.touched) || !!s.toFailure || (s.subSets ?? []).some(sub => anyTouched(sub.touched));
}

/** 有没有填数：任一值字段是非 0 的有限数（自定义项可以是负数），或某个递减档有重量 / 次数 */
export function setHasValue(s: SetLog): boolean {
  const rec = s as unknown as Record<string, unknown>;
  const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v !== 0;
  return Object.keys(rec).some(k => isValueKey(k) && num(rec[k])) || (s.subSets ?? []).some(sub => Number(sub.weight) > 0 || Number(sub.reps) > 0);
}

/**
 * 抄一组的值（底稿、添加组共用）：只抄开着的记录项。重量连带正负号和片子单位，次数照抄；这两项没开就写 0。
 * 其余开着的项有值才抄。力竭、touched、seq、want、prefillRef、added 一律不抄（力竭是当日事实，不继承）。
 */
export function copyValues(s: SetLog, metrics: string[]): Partial<SetLog> & { weight: number; reps: number } {
  const on = new Set(metrics);
  const src = s as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = {
    weight: on.has('weight') ? s.weight ?? 0 : 0,
    reps: on.has('reps') ? s.reps ?? 0 : 0,
  };
  if (on.has('weight')) {
    // 带正负的负荷：号跟着抄，否则辅助的组下次会变成负重；挂的是哪种片也跟着抄
    if (s.bodyweightMode) out.bodyweightMode = s.bodyweightMode;
    if (s.plateUnit) out.plateUnit = s.plateUnit;
  }
  if (on.has('duration')) {
    if (s.duration) out.duration = s.duration;
    if (s.time) Object.assign(out, { time: s.time, timeUnit: s.timeUnit });
  }
  if (on.has('distance') && s.distance) Object.assign(out, { distance: s.distance, distanceUnit: s.distanceUnit });
  if (on.has('speed') && s.speed) out.speed = s.speed;
  for (const k of Object.keys(src)) {
    if (k.startsWith('custom_') && on.has(k) && typeof src[k] === 'number' && Number.isFinite(src[k]) && src[k] !== 0) out[k] = src[k];
  }
  return out as Partial<SetLog> & { weight: number; reps: number };
}

/**
 * 把一串既有的组铺成底稿行（§12.6）：添加单个动作（底稿预填）、整场复制、换做法 / 换馆重铺共用，语义必须是同一套。
 * 只抄开着的记录项（copyValues）；递减档只在重量或次数开着时抄（和母组一样是上次的数据，跟着母组一起描实 / 丢弃）。
 * 上次若本身是未收尾的草稿，先滤掉它的 ghost —— 别把底稿再抄成底稿。
 */
export function toGhostSets(sets: SetLog[] | undefined, idPrefix: string, metrics: string[]): SetLog[] {
  const subsOn = metrics.includes('weight') || metrics.includes('reps');
  return (sets ?? [])
    .filter(s => !s.ghost)
    .map((s, j) => ({
      id: `${idPrefix}_${j}`,
      ...copyValues(s, metrics),
      ...(subsOn && s.subSets?.length
        ? {
            subSets: s.subSets.map((sub, k) => ({
              id: `${idPrefix}_${j}_sub${k}`,
              weight: metrics.includes('weight') ? sub.weight ?? 0 : 0,
              reps: metrics.includes('reps') ? sub.reps ?? 0 : 0,
              ...(sub.bodyweightMode ? { bodyweightMode: sub.bodyweightMode } : {}),
              // 递减档的登记单位也抄（原先只抄了母组的，子组下一场又得靠推断）
              ...(sub.plateUnit ?? s.plateUnit ? { plateUnit: sub.plateUnit ?? s.plateUnit } : {}),
            })),
          }
        : {}),
      ghost: true,
    }));
}

/**
 * 训练中关掉记录项：目标动作指针以下（ghost）、没改过的那一格清掉 —— 不清的话旧值藏在组里照样入册、一场场抄下去（gap-2#2）。
 * 做完的行和改过的格子不动。什么都没变时返回原数组（不产生写入、不进撤销）。
 */
export function pruneDraftToMetrics<E extends { name: string; sets: SetLog[] }>(exs: E[], isTarget: (e: E) => boolean, keep: string[]): E[] {
  const on = new Set(keep);
  let changed = false;
  const next = exs.map(e => {
    if (!isTarget(e)) return e;
    let exChanged = false;
    const sets = e.sets.map(s => {
      if (!s.ghost) return s;
      const rec = { ...s } as unknown as Record<string, unknown>;
      const touched = s.touched ?? {};
      let c = false;
      for (const k of Object.keys(rec)) {
        if (!isValueKey(k) || on.has(k) || touched[k]) continue;
        if (k === 'weight' || k === 'reps') {
          if (rec[k] === 0) continue;
          rec[k] = 0;
          if (k === 'weight') for (const w of ['bodyweightMode', 'prefillRef', 'draftAuto', 'checkWeight', 'want']) delete rec[w];
        } else {
          delete rec[k];
          if (k === 'distance') delete rec.distanceUnit;
          if (k === 'time') delete rec.timeUnit;
        }
        c = true;
      }
      if (!c) return s;
      exChanged = true;
      return rec as unknown as SetLog;
    });
    if (!exChanged) return e;
    changed = true;
    return { ...e, sets };
  });
  return changed ? next : exs;
}
