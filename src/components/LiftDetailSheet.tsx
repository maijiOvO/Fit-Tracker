/**
 * 一个动作的历史，一次铺开：纪录卡 → 趋势图 → 逐场记录。
 *
 * 以前在列表里原地展开，图下面的「历史」还要再点开一次，每场是一整排组胶囊外加常驻的编辑 / 删除按钮。
 * 现在逐场一行（日期 · 这场最好的一组 · 组数 · 破纪录打 PR），点一行才展开全部组和操作。
 */
import React, { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { ChevronDown, Edit2, Trash2 } from 'lucide-react';
import { Modal } from './Modal';
import { Language } from '../../types';
import { translations } from '../../translations';
import {
  E1RM,
  type ChartRange,
  type LiftSummary,
  chartMetricsFor,
  prSessionIds,
  sessionMetric,
  sessionMetricSet,
} from '../utils/liftHistory';
import { formatLoad, formatMetric, formatSet, metricLabel, metricUnit, shortDate, toDisplay, trimNum } from '../utils/liftDisplay';
import { plural } from '../utils/format';
import { storage } from '../../services/appStorage';

const LiftTrendChart = lazy(() => import('./LazyCharts').then(m => ({ default: m.LiftTrendChart })));

const RANGE_STORAGE_KEY = 'fitlog_lift_chart_range';
const RANGES: ChartRange[] = ['3m', '6m', '1y', 'all'];
const rangeLabel = (r: ChartRange, isCn: boolean) =>
  ({ '3m': isCn ? '3月' : '3M', '6m': isCn ? '6月' : '6M', '1y': isCn ? '1年' : '1Y', all: isCn ? '全部' : 'All' })[r];

function savedRange(): ChartRange | null {
  try {
    const saved = storage.getItem(RANGE_STORAGE_KEY);
    if (saved && (RANGES as string[]).includes(saved)) return saved as ChartRange;
  } catch {}
  return null;
}

/** 没选过范围时：历史不到半年看全部，再长先看半年 */
const autoRange = (lift: LiftSummary): ChartRange =>
  Date.now() - lift.sessions[0].ts > 183 * 86400000 ? '6m' : 'all';

interface LiftDetailSheetProps {
  lift: LiftSummary | null;
  onClose: () => void;
  lang: Language;
  unit: 'kg' | 'lbs';
  activeMetrics: string[];
  metric: string | undefined;
  onMetricChange: (metric: string) => void;
  renderSetCapsule: (s: any, exerciseName: string, ex: unknown, idx: number) => React.ReactNode;
  formatExerciseTime: (iso: string, lang: 'cn' | 'en') => { time: string };
  onEditExerciseTime: (workoutId: string, exerciseId: string, initial: Date) => void;
  onEditWorkout: (workoutId: string) => void;
  onDeleteRecord: (e: React.MouseEvent, workoutId: string, exerciseId: string, date: string) => void;
}

export const LiftDetailSheet: React.FC<LiftDetailSheetProps> = ({
  lift,
  onClose,
  lang,
  unit,
  activeMetrics,
  metric: preferred,
  onMetricChange,
  renderSetCapsule,
  formatExerciseTime,
  onEditExerciseTime,
  onEditWorkout,
  onDeleteRecord,
}) => {
  const isCn = lang === Language.CN;
  // 关闭动画期间 lift 已经是 null：留住最后一个，内容别在退场时闪空
  const [shown, setShown] = useState<LiftSummary | null>(lift);
  useEffect(() => {
    if (lift) setShown(lift);
  }, [lift]);
  const [chosenRange, setChosenRange] = useState<ChartRange | null>(savedRange);
  const [expanded, setExpanded] = useState<string | null>(null);
  useEffect(() => setExpanded(null), [lift?.key]);

  const chooseRange = (r: ChartRange) => {
    setChosenRange(r);
    try { storage.setItem(RANGE_STORAGE_KEY, r); } catch {}
  };

  const l = lift ?? shown;
  const metrics = l ? chartMetricsFor(l, activeMetrics) : [];
  const metric = preferred && metrics.includes(preferred) ? preferred : metrics[0];
  const prIds = useMemo(() => (l && metric ? prSessionIds(l.sessions, metric) : new Set<string>()), [l, metric]);
  const newestFirst = useMemo(() => (l ? [...l.sessions].reverse() : []), [l]);

  if (!l) return null;
  const range = chosenRange ?? autoRange(l);

  const cards: { label: string; value: string; unit?: string; sub: string }[] = [];
  if (l.hasWeight) {
    const w = l.best.weight;
    if (w?.set) {
      cards.push({
        label: isCn ? '最重' : 'Heaviest',
        value: formatSet(w.set, unit, l.signed, isCn),
        sub: shortDate(w.ts, isCn),
      });
    }
    const e = l.best.e1rm;
    if (e?.set) {
      cards.push({
        label: metricLabel(E1RM, lang),
        value: trimNum(toDisplay(E1RM, e.value, unit)),
        unit,
        sub: `${formatSet(e.set, unit, false, isCn)} · ${shortDate(e.ts, isCn)}`,
      });
    }
    const r = l.best.reps;
    if (r?.set) {
      cards.push({
        label: isCn ? '最多次' : 'Most reps',
        value: formatSet(r.set, unit, l.signed, isCn),
        sub: shortDate(r.ts, isCn),
      });
    }
  } else {
    // 非力量动作：每个指标的最好值
    for (const m of activeMetrics.slice(0, 3)) {
      let best: { v: number; ts: number } | null = null;
      for (const s of l.sessions) {
        const v = sessionMetric(s, m);
        if (v != null && (!best || v > best.v)) best = { v, ts: s.ts };
      }
      if (best) cards.push({ label: metricLabel(m, lang), value: formatMetric(m, best.v, unit), unit: metricUnit(m, unit) || undefined, sub: shortDate(best.ts, isCn) });
    }
  }

  // 逐场一行写的是「决定当前图表指标的那一组」：和图上的点、PR 标记是同一组
  // （看估算 1RM 时写 87.5×10，看重量时写 92.5×3），否则 PR 标在一个看起来不像纪录的数上
  const rowSummary = (s: LiftSummary['sessions'][number]) => {
    const set = sessionMetricSet(s, metric) ?? (l.hasWeight ? s.top : null);
    if (set) return formatSet(set, unit, l.signed, isCn);
    const v = sessionMetric(s, metric);
    return v == null ? '—' : `${formatMetric(metric, v, unit)}${metricUnit(metric, unit) && ` ${metricUnit(metric, unit)}`}`;
  };

  return (
    <Modal
      isOpen={!!lift}
      onClose={onClose}
      variant="sheet"
      size="full"
      title={l.key}
      subtitle={`${l.sessions.length} ${isCn ? '场' : plural(l.sessions.length, 'session')}`}
      className="h-[92dvh] flex flex-col"
      bodyClassName="flex-1 min-h-0 overflow-y-auto custom-scrollbar pb-8"
      testId="lift-detail"
    >
      {cards.length > 0 && (
        <div className={`grid gap-2 ${cards.length >= 3 ? 'grid-cols-3' : cards.length === 2 ? 'grid-cols-2' : 'grid-cols-1'}`}>
          {cards.map(c => (
            <div key={c.label} className="bg-inset rounded-control px-3 py-2.5 min-w-0">
              <div className="text-[11px] text-tertiary">{c.label}</div>
              <div className="font-mono font-semibold text-primary tabular-nums text-lg leading-tight truncate">
                {c.value}
                {c.unit && <span className="text-[11px] text-tertiary font-normal ml-1">{c.unit}</span>}
              </div>
              <div className="text-[11px] text-tertiary leading-snug">{c.sub}</div>
            </div>
          ))}
        </div>
      )}

      {/* 指标 + 时间范围 */}
      <div className="flex items-center justify-between gap-2 mt-5 flex-wrap">
        <div className="flex gap-1.5 flex-wrap">
          {metrics.length > 1 &&
            metrics.map(m => (
              <button
                key={m}
                type="button"
                onClick={() => onMetricChange(m)}
                className={`px-2.5 py-1 rounded-chip text-xs font-medium ${
                  m === metric ? 'bg-accent-soft text-accent' : 'text-secondary'
                }`}
              >
                {metricLabel(m, lang)}
              </button>
            ))}
        </div>
        <div className="flex gap-0.5 bg-inset rounded-control p-0.5" role="group">
          {RANGES.map(r => (
            <button
              key={r}
              type="button"
              onClick={() => chooseRange(r)}
              className={`px-2 py-1 rounded-chip text-xs font-semibold tabular-nums ${r === range ? 'seg-on' : 'text-tertiary'}`}
              aria-pressed={r === range}
            >
              {rangeLabel(r, isCn)}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-3">
        <Suspense fallback={<div className="h-[220px]" />}>
          {metric && <LiftTrendChart lift={l} metric={metric} range={range} lang={lang} unit={unit} />}
        </Suspense>
        <p className="text-[11px] text-tertiary mt-1 leading-snug">
          {isCn
            ? '线：历史最好 · 点：每场最好 · 实心：破纪录'
            : 'Line: all-time best · Dots: best set each session · Filled: new record'}
          {metric === E1RM && (isCn ? ' · 仅算 12 次以内' : ' · Est. 1RM uses sets of ≤12 reps')}
        </p>
      </div>

      {/* 逐场 */}
      <h4 className="ui-section-label mt-6 mb-1">{translations.history[lang]}</h4>
      <div>
        {newestFirst.map(s => {
          const id = `${s.workoutId}-${s.exerciseId}`;
          const open = expanded === id;
          const isPr = prIds.has(s.workoutId);
          return (
            <div key={id} className="border-b border-divider last:border-0" data-testid="lift-session">
              <button
                type="button"
                onClick={() => setExpanded(open ? null : id)}
                className="w-full flex items-center gap-3 py-3 text-left active:opacity-70"
                aria-expanded={open}
              >
                <span className="w-[88px] flex-shrink-0 text-sm text-secondary tabular-nums">{shortDate(s.ts, isCn)}</span>
                <span className="flex-1 min-w-0 font-mono font-semibold text-primary tabular-nums truncate">
                  {rowSummary(s)}
                </span>
                {isPr && (
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-chip bg-warning/15 text-warning">PR</span>
                )}
                <span className="text-xs text-tertiary tabular-nums whitespace-nowrap">
                  {s.sets.length} {isCn ? '组' : plural(s.sets.length, 'set')}
                </span>
                <ChevronDown size={16} className={`text-tertiary transition-transform ${open ? 'rotate-180' : ''}`} />
              </button>

              {open && (
                <div className="pb-4 space-y-3 anim-reveal">
                  {(s.gym || s.fromSchedule || s.exerciseTime) && (
                    <div className="flex items-center gap-2 flex-wrap text-xs">
                      {s.gym && <span className="px-2 py-0.5 rounded-chip bg-inset text-secondary">{s.gym}</span>}
                      {s.fromSchedule && (
                        <span className="px-2 py-0.5 rounded-chip bg-accent-soft text-accent font-medium">
                          {translations.planBadgeFaithful?.[lang] ?? (isCn ? '来自计划' : 'From plan')}
                        </span>
                      )}
                      {s.exerciseTime && (
                        <button
                          type="button"
                          onClick={() => onEditExerciseTime(s.workoutId, s.exerciseId, new Date(s.exerciseTime!))}
                          className="px-2 py-0.5 rounded-chip bg-inset border border-divider font-mono text-secondary"
                        >
                          {formatExerciseTime(s.exerciseTime, isCn ? 'cn' : 'en').time}
                        </button>
                      )}
                    </div>
                  )}
                  <div className="flex flex-wrap gap-2">
                    {s.sets.map((set, i) => renderSetCapsule(set, s.exercise.name, s.exercise, i))}
                  </div>
                  {l.hasWeight && !l.signed && s.e1rm && (
                    <p className="text-xs text-tertiary">
                      {metricLabel(E1RM, lang)} {trimNum(toDisplay(E1RM, s.e1rm.value, unit))} {unit}
                      <span className="mx-1">·</span>
                      {formatLoad(s.e1rm.kg, unit, false, isCn)}×{s.e1rm.reps}
                    </p>
                  )}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => onEditWorkout(s.workoutId)}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-control bg-inset text-sm font-medium text-primary"
                    >
                      <Edit2 size={14} strokeWidth={1.75} />
                      {isCn ? '编辑这场' : 'Edit workout'}
                    </button>
                    <button
                      type="button"
                      onClick={e => onDeleteRecord(e, s.workoutId, s.exerciseId, s.date)}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-control text-sm font-medium text-danger"
                    >
                      <Trash2 size={14} strokeWidth={1.75} />
                      {isCn ? '删除这条' : 'Delete entry'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Modal>
  );
};
