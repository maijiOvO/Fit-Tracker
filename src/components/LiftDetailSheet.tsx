/**
 * 一个动作的历史，一次铺开：纪录卡 → 趋势图 → 逐场记录。
 *
 * 以前在列表里原地展开，图下面的「历史」还要再点开一次，每场是一整排组胶囊外加常驻的编辑 / 删除按钮。
 * 现在逐场一行（日期 · 这场最好的一组 · 组数 · 破纪录打 PR），点一行才展开全部组和操作。
 *
 * 两处打开：首页「按动作」（Dashboard），训练卡 ⋯ →「历史」（ExerciseHistorySheet，审查 D8）。
 * 训练页上只看不改：不给「编辑这场 / 删除这条 / 改时间」——编辑旧训练会把进行中的这场暂存起来。
 */
import React, { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Edit2, Trash2 } from 'lucide-react';
import { Modal } from './Modal';
import { Exercise, Language } from '../../types';
import { translations } from '../../translations';
import {
  E1RM,
  type ChartRange,
  type LiftSummary,
  chartMetricsFor,
  gymChoices,
  inGym,
  prSessionIds,
  sessionMetric,
  sessionMetricSet,
} from '../utils/liftHistory';
import { CHART_RANGES, formatLoad, formatMetric, formatSet, gymLabel, metricLabel, metricUnit, rangeLabel, shortDate, toDisplay, trimNum } from '../utils/liftDisplay';
import { E1RM_MAX_REPS } from '../utils/prRecords';
import { plural } from '../utils/format';
import { storage } from '../../services/appStorage';
import { formatExerciseTime } from '../utils/dateUtils';
import { SetCapsule } from './SetCapsule';
import { useExercisePrefs } from '../contexts/ExercisePrefsContext';
import { useUserSettingsContext } from '../contexts/UserSettingsContext';
import { useDoneWorkouts, useLiftSummaries } from '../hooks/useLiftSummaries';

const LiftTrendChart = lazy(() => import('./LazyCharts').then(m => ({ default: m.LiftTrendChart })));

const RANGE_STORAGE_KEY = 'fitlog_lift_chart_range';

function savedRange(): ChartRange | null {
  const saved = storage.getItem(RANGE_STORAGE_KEY);
  return saved && (CHART_RANGES as string[]).includes(saved) ? (saved as ChartRange) : null;
}

/** 没选过范围时：历史不到半年看全部，再长先看半年 */
const autoRange = (lift: LiftSummary): ChartRange =>
  Date.now() - lift.sessions[0].ts > 183 * 86400000 ? '6m' : 'all';

/**
 * 点「编辑这场」进编辑、改完回来（审查 B5）：详情接着开着，展开的那一场、滚到哪儿都和走之前一样。
 * 首页（连同这张详情）在训练页时是卸掉的，状态只能记在模块里；用一次就清。
 */
let resumeAt: { key: string; expanded: string | null; scrollTop: number; gym: string | null } | null = null;

/**
 * 首页的选中动作已经没了（记录删光、那一场被接回工作台）：记着的接回位置一起作废，免得这个动作以后再有记录时套上过期的展开 / 滚动。
 * 不在详情挂载时按 key 对不上就清：训练页的 ExerciseHistorySheet 也挂这张详情，会在编辑途中把 B5 要用的位置提前清掉
 */
export function dropResume(): void {
  resumeAt = null;
}

interface LiftDetailSheetProps {
  lift: LiftSummary | null;
  onClose: () => void;
  lang: Language;
  unit: 'kg' | 'lbs';
  activeMetrics: string[];
  metric: string | undefined;
  onMetricChange: (metric: string) => void;
  /** 下面三个不传＝只看（训练页上打开）：时间只显示，没有编辑 / 删除 */
  onEditExerciseTime?: (workoutId: string, exerciseId: string, initial: Date) => void;
  /** exerciseId：编辑页打开后滚到这个动作 */
  onEditWorkout?: (workoutId: string, exerciseId?: string) => void;
  onDeleteRecord?: (e: React.MouseEvent, workoutId: string, exerciseId: string) => void;
}

export const LiftDetailSheet: React.FC<LiftDetailSheetProps> = ({
  lift,
  onClose,
  lang,
  unit,
  activeMetrics,
  metric: preferred,
  onMetricChange,
  onEditExerciseTime,
  onEditWorkout,
  onDeleteRecord,
}) => {
  const isCn = lang === Language.CN;
  const { getActiveMetrics } = useExercisePrefs();
  // 关闭动画期间 lift 已经是 null：留住最后一个，内容别在退场时闪空
  const [shown, setShown] = useState<LiftSummary | null>(lift);
  useEffect(() => {
    if (lift) setShown(lift);
  }, [lift]);
  const [chosenRange, setChosenRange] = useState<ChartRange | null>(savedRange);
  const [expanded, setExpanded] = useState<string | null>(null);
  // 按馆比的器械看哪个馆；null＝最近练的那个
  const [chosenGym, setChosenGym] = useState<string | null>(null);
  useEffect(() => {
    setExpanded(null);
    setChosenGym(null);
  }, [lift?.key]);
  const bodyRef = useRef<HTMLDivElement>(null);
  const scroller = () => bodyRef.current?.parentElement ?? null;
  // 从编辑回来：接着展开那一场、滚回原处（在上面那个清空之后跑）
  useEffect(() => {
    if (!lift || resumeAt?.key !== lift.key) return;
    setExpanded(resumeAt.expanded);
    setChosenGym(resumeAt.gym);
  }, [lift?.key]);
  useLayoutEffect(() => {
    if (!lift || resumeAt?.key !== lift.key || expanded !== resumeAt.expanded) return;
    const top = resumeAt.scrollTop;
    resumeAt = null;
    // 图表是懒加载的，高度晚一拍才定：等两帧再滚
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const el = scroller();
      if (el) el.scrollTop = top;
    }));
  }, [lift?.key, expanded]);

  const chooseRange = (r: ChartRange) => {
    setChosenRange(r);
    storage.setItem(RANGE_STORAGE_KEY, r);
  };

  const whole = lift ?? shown;
  // 按馆比的器械：纪录卡、阶梯线、逐场都只算选中的那个馆（审查 G4）；图上不加换馆记号（§12.11）
  const gyms = useMemo(() => (whole ? gymChoices(whole) : []), [whole]);
  const gym = chosenGym !== null && gyms.includes(chosenGym) ? chosenGym : gyms[0];
  const l = useMemo(() => (whole && gym !== undefined ? inGym(whole, gym) : whole), [whole, gym]);
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
      <div ref={bodyRef} className="contents" />
      {gyms.length > 1 && (
        <div className="flex gap-1.5 flex-wrap mb-3" role="group" data-testid="lift-gyms">
          {gyms.map(g => (
            <button
              key={g}
              type="button"
              onClick={() => setChosenGym(g)}
              aria-pressed={g === gym}
              className={`tap-44 px-2.5 py-1 rounded-chip text-xs font-medium ${g === gym ? 'bg-accent-soft text-accent' : 'bg-inset text-secondary'}`}
            >
              {gymLabel(g, isCn)}
            </button>
          ))}
        </div>
      )}
      {cards.length > 0 && (
        <div className={`grid gap-2 ${cards.length >= 3 ? 'grid-cols-3' : cards.length === 2 ? 'grid-cols-2' : 'grid-cols-1'}`}>
          {cards.map(c => (
            <div key={c.label} className="bg-inset rounded-control px-3 py-2.5 min-w-0">
              <div className="text-micro font-normal text-tertiary">{c.label}</div>
              <div className="font-mono font-semibold text-primary tabular-nums text-lg leading-tight truncate">
                {c.value}
                {c.unit && <span className="text-micro text-tertiary font-normal ml-1">{c.unit}</span>}
              </div>
              <div className="text-micro font-normal text-tertiary leading-snug">{c.sub}</div>
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
                className={`tap-44 px-2.5 py-1 rounded-chip text-xs font-medium ${
                  m === metric ? 'bg-accent-soft text-accent' : 'text-secondary'
                }`}
              >
                {metricLabel(m, lang)}
              </button>
            ))}
        </div>
        <div className="flex gap-0.5 bg-inset rounded-control p-0.5" role="group">
          {CHART_RANGES.map(r => (
            <button
              key={r}
              type="button"
              onClick={() => chooseRange(r)}
              className={`tap-44 px-2 py-1 rounded-chip text-xs font-semibold tabular-nums ${r === range ? 'seg-on' : 'text-tertiary'}`}
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
        <p className="text-micro font-normal text-tertiary mt-1 leading-snug">
          {isCn
            ? '线：历史最好 · 点：每场最好 · 实心：破纪录'
            : 'Line: all-time best · Dot: session best · Filled: PR'}
          {metric === E1RM && (isCn ? ` · 仅算 ${E1RM_MAX_REPS} 次以内` : ` · sets of ≤${E1RM_MAX_REPS} reps only`)}
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
                <span className="w-[88px] flex-shrink-0 text-small text-secondary tabular-nums">{shortDate(s.ts, isCn)}</span>
                <span className="flex-1 min-w-0 font-mono font-semibold text-primary tabular-nums truncate">
                  {rowSummary(s)}
                </span>
                {isPr && (
                  <span className="text-micro font-bold px-1.5 py-0.5 rounded-chip bg-chalk text-on-chalk border border-on-chalk">PR</span>
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
                          {translations.planBadgeFaithful[lang]}
                        </span>
                      )}
                      {s.exerciseTime &&
                        (onEditExerciseTime ? (
                          <button
                            type="button"
                            onClick={() => onEditExerciseTime(s.workoutId, s.exerciseId, new Date(s.exerciseTime!))}
                            className="px-2 py-0.5 rounded-chip bg-inset border border-divider font-mono text-secondary"
                          >
                            {formatExerciseTime(s.exerciseTime, isCn ? 'cn' : 'en').time}
                          </button>
                        ) : (
                          <span className="px-2 py-0.5 font-mono text-secondary">{formatExerciseTime(s.exerciseTime, isCn ? 'cn' : 'en').time}</span>
                        ))}
                    </div>
                  )}
                  <div className="flex flex-wrap gap-2">
                    {s.sets.map((set, i) => (
                      <SetCapsule
                        key={`${set.id ?? 'set'}-${i}`}
                        set={set}
                        setIdx={i}
                        activeMetrics={getActiveMetrics(s.exercise.name)}
                        unit={unit}
                        lang={lang}
                        readOnly
                        onUpdate={() => {}}
                        onRemove={() => {}}
                      />
                    ))}
                  </div>
                  {l.hasWeight && !l.signed && s.e1rm && (
                    <p className="text-xs text-tertiary">
                      {metricLabel(E1RM, lang)} {trimNum(toDisplay(E1RM, s.e1rm.value, unit))} {unit}
                      <span className="mx-1">·</span>
                      {formatLoad(s.e1rm.kg, unit, false, isCn)}×{s.e1rm.reps}
                    </p>
                  )}
                  {onEditWorkout && onDeleteRecord && (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        resumeAt = { key: l.key, expanded, scrollTop: scroller()?.scrollTop ?? 0, gym: chosenGym };
                        onEditWorkout(s.workoutId, s.exerciseId);
                      }}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-control bg-inset text-small font-medium text-primary"
                    >
                      <Edit2 size={14} strokeWidth={1.75} />
                      {isCn ? '编辑这场' : 'Edit workout'}
                    </button>
                    {/* §6.6：删除是墨色文字项，不靠颜色喊危险。删的是那场最后一个动作＝删整场，外面先确认（审查 D10） */}
                    <button
                      type="button"
                      onClick={e => onDeleteRecord(e, s.workoutId, s.exerciseId)}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-control text-small font-medium text-secondary"
                    >
                      <Trash2 size={14} strokeWidth={1.75} />
                      {isCn ? '删除这条' : 'Delete entry'}
                    </button>
                  </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Modal>
  );
};

/**
 * 训练卡 ⋯ →「历史」：在训练页上直接开这个动作的详情（审查 D8），关掉还在训练页原处。
 * 只看不改，在这里点什么都不留痕：进行中的这场不算（useDoneWorkouts 已排除），不给编辑 / 删除。
 * 图表指标只记在这一次打开里（首页那份偏好在 App，不往训练页拉）。
 */
export const ExerciseHistorySheet: React.FC<{ exercise: Exercise; open: boolean; onClose: () => void }> = ({ exercise, open, onClose }) => {
  const { lang, unit } = useUserSettingsContext();
  const prefs = useExercisePrefs();
  const { workouts } = useDoneWorkouts();
  const lifts = useLiftSummaries(workouts);
  const key = prefs.liftKey(exercise);
  const lift = open ? lifts.find(l => l.key === key) ?? null : null;
  const [metric, setMetric] = useState<string | undefined>(undefined);
  return (
    <LiftDetailSheet
      lift={lift}
      onClose={onClose}
      lang={lang}
      unit={unit}
      activeMetrics={lift ? prefs.getActiveMetrics(lift.baseName) : []}
      metric={metric}
      onMetricChange={setMetric}
    />
  );
};
