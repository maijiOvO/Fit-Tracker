import React, { lazy, Suspense, useState, useEffect, useMemo, useCallback } from 'react';
import { DateTimePicker } from './DateTimePicker';
import { SetCapsule } from './SetCapsule';
import {
  Trophy, PlusCircle, Plus, Trash2, Edit2,
  Scale, TrendingUp, History, ChevronDown, ChevronUp,
  Clock
} from 'lucide-react';
import { Language, WeightEntry } from '../../types';
import { translations } from '../../translations';
import { formatWeight, plural } from '../utils/format';
import { usesSignedLoad } from '../utils/load';
import { buildLiftSummaries, type ChartRange } from '../utils/liftHistory';
import { LiftList } from './LiftList';
import { FeaturedLifts } from './FeaturedLifts';
import { LiftDetailSheet } from './LiftDetailSheet';
import { TimelineView, type TimelineGranularity } from './TimelineView';
import { useUserSettingsContext } from '../contexts/UserSettingsContext';
import { hasDoneSets, useWorkoutContext } from '../contexts/WorkoutContext';
import { useExercisePrefs } from '../contexts/ExercisePrefsContext';
import { useExerciseTimeEditor } from '../hooks/useExerciseTimeEditor';
import { storage } from '../../services/appStorage';
import { RestoreFromBackupLink } from './data/RestoreFromBackupLink';

const WeightTrendChart = lazy(() => import('./LazyCharts').then(m => ({ default: m.WeightTrendChart })));

type DashboardView = 'timeline' | 'pr';
const VIEW_STORAGE_KEY = 'fitlog_dashboard_view';
const GRANULARITY_STORAGE_KEY = 'fitlog_timeline_granularity';
const WEIGHT_RANGE_STORAGE_KEY = 'fitlog_weight_chart_range';
const WEIGHT_RANGES: ChartRange[] = ['3m', '6m', '1y', 'all'];

/** 必须由 App 注入的交互（依赖 Tab 切换、Modal、Workout 变更等） */
export interface DashboardActions {
  onStartNewWorkout: () => void;
  /** 回到进行中的训练 */
  onResumeWorkout: () => void;
  /** 结束进行中的训练（一组都没做完时＝问要不要放弃） */
  onEndInProgress: () => void;
  onEditWorkout: (workoutId: string, options?: { scrollToPicker?: boolean }) => void;
  onAddExerciseToPastWorkout: (workoutId: string) => void;
  onDeleteWorkout: (
    workoutId: string,
    options?: { skipConfirm?: boolean },
  ) => void | Promise<void>;
  onMergeIntoPrevious: (workoutId: string) => void | Promise<void>;
  onCopyWorkoutToToday: (workoutId: string) => void | Promise<void>;
  /** 刚结束 10 分钟内的那场接回工作台（时间线长按菜单） */
  onResumeFinishedWorkout: (workoutId: string) => void;
  onDeleteExerciseRecord: (
    e: React.MouseEvent,
    workoutId: string,
    exerciseId: string,
    exerciseName: string,
    date: string,
  ) => void;
  onDeleteWeightEntry: (e: React.MouseEvent, id: string) => void;
  onLogWeight: () => void;
  onEditWeight: (entry: WeightEntry) => void;
  onExportData: () => void;
  onImportData: () => void;
}

interface DashboardProps {
  selectedPRProject: string | null;
  setSelectedPRProject: (key: string | null) => void;
  chartMetricPreference: Record<string, string>;
  setChartMetricPreference: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  actions: DashboardActions;
}

const Dashboard: React.FC<DashboardProps> = ({
  selectedPRProject,
  setSelectedPRProject,
  chartMetricPreference,
  setChartMetricPreference,
  actions,
}) => {
  const { lang, unit, weightEntries, appPrefs, changeAppPrefs } = useUserSettingsContext();
  const isCn = lang === Language.CN;
  const dateLocale = isCn ? 'zh-CN' : 'en-US';
  const { workouts: allWorkouts, currentWorkout } = useWorkoutContext();
  const prefs = useExercisePrefs();
  /**
   * 进行中的那场（工作台里有动作、还没结束）：顶上单独一行，不进时间线。
   * 一组都没做完的空场（练到一半放弃留下的「N 动作 0 组」）也不进时间线 —— 它不是数据。
   */
  const inProgress = !!currentWorkout.id && (currentWorkout.exercises?.length ?? 0) > 0 && !currentWorkout.finishedAt
    ? currentWorkout
    : null;
  const workouts = useMemo(
    () => allWorkouts.filter(w => w.id !== inProgress?.id && hasDoneSets(w)),
    [allWorkouts, inProgress?.id],
  );
  // 「按动作」的逐场数据：列表、详情、趋势图共用一份口径（见 utils/liftHistory）
  const lifts = useMemo(
    () =>
      buildLiftSummaries({
        workouts,
        // 稳定键「定义 id|做法 id」：并进来的旧名也按 variantIdOf 认到同一个做法
        stableIdOf: ex => {
          const def = prefs.findExerciseDef(ex.name);
          return def ? `${def.id}|${prefs.variantIdOf(ex) ?? ''}` : `name:${prefs.liftKey(ex)}`;
        },
        liftKey: prefs.liftKey,
        resolveName: prefs.resolveName,
        signedLoadOf: ex => usesSignedLoad(ex, prefs.signedLoadOf(ex.name)),
        getActiveMetrics: prefs.getActiveMetrics,
      }),
    [workouts, prefs],
  );
  const openLift =
    selectedPRProject && selectedPRProject !== '__WEIGHT__'
      ? lifts.find(l => l.key === selectedPRProject) ?? null
      : null;
  const { formatExerciseTime, updateExerciseTime } = useExerciseTimeEditor();

  const renderSetCapsule = useCallback(
    // setIdx 是这一组在它所在列表里的下标：组号显示 setIdx + 1（set-number-all-one：以前写死 0，全是「1」）
    (s: any, exerciseName: string, _exercise?: unknown, setIdx = 0) => (
      <SetCapsule
        key={`${s.id ?? 'set'}-${setIdx}`}
        set={s}
        setIdx={setIdx}
        activeMetrics={prefs.getActiveMetrics(exerciseName)}
        unit={unit}
        lang={lang}
        readOnly
        onUpdate={() => {}}
        onRemove={() => {}}
      />
    ),
    [prefs, unit, lang],
  );

  const [weightRange, setWeightRange] = useState<ChartRange>(() => {
    try {
      const saved = storage.getItem(WEIGHT_RANGE_STORAGE_KEY);
      if (saved && (WEIGHT_RANGES as string[]).includes(saved)) return saved as ChartRange;
    } catch {}
    return '3m';
  });
  useEffect(() => {
    try { storage.setItem(WEIGHT_RANGE_STORAGE_KEY, weightRange); } catch {}
  }, [weightRange]);
  // 视图模式：默认按时间线
  const [view, setView] = useState<DashboardView>(() => {
    try {
      const saved = storage.getItem(VIEW_STORAGE_KEY);
      return saved === 'pr' ? 'pr' : 'timeline';
    } catch {
      return 'timeline';
    }
  });
  const [granularity, setGranularity] = useState<TimelineGranularity>(() => {
    try {
      const saved = storage.getItem(GRANULARITY_STORAGE_KEY);
      if (saved === 'day' || saved === 'week' || saved === 'month' || saved === 'year') {
        return saved;
      }
      return 'day';
    } catch {
      return 'day';
    }
  });
  useEffect(() => {
    try { storage.setItem(VIEW_STORAGE_KEY, view); } catch {}
  }, [view]);
  useEffect(() => {
    try { storage.setItem(GRANULARITY_STORAGE_KEY, granularity); } catch {}
  }, [granularity]);

  const [exerciseTimeEdit, setExerciseTimeEdit] = useState<{
    workoutId: string;
    exerciseId: string;
    initial: Date;
  } | null>(null);

  const weightSummary = useMemo(() => {
    if (weightEntries.length === 0) return null;
    const sorted = [...weightEntries].sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
    );
    const latest = sorted[0];
    const cutoff = Date.now() - 30 * 86400000;
    // sorted 是新→旧：第一条落在截止点之前的，就是「30 天前那一刻」最近的一次称重。
    // 都在 30 天内就退到最早一条。
    const baseline =
      sorted.find(e => new Date(e.date).getTime() <= cutoff)
      ?? sorted[sorted.length - 1];
    const delta = latest.weight - baseline.weight;
    const sign = delta > 0 ? '+' : '';
    return {
      value: formatWeight(latest.weight, unit),
      delta: sorted.length >= 2 ? `${sign}${formatWeight(delta, unit)}` : null,
    };
  }, [weightEntries, unit]);

  // 进行中的训练要能接回去：哪怕还没有任何历史，也别落到空状态页（那里没有「进行中」那一行）
  if (workouts.length === 0 && weightEntries.length === 0 && !inProgress) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center p-6 anim-tab-enter">
        <div className="bg-accent-soft p-8 rounded-control mb-8">
          <Trophy size={64} className="text-accent" strokeWidth={1.75} />
        </div>
        <h2 className="font-display text-display-sm text-primary mb-3">
          {translations.dashboardEmptyTitle[lang]}
        </h2>
        <p className="text-secondary max-w-sm leading-relaxed text-[15px] mb-10">
          {translations.dashboardEmptyDesc[lang]}
        </p>
        <button onClick={actions.onStartNewWorkout} className="ui-btn-primary flex items-center gap-2 px-8 py-4 text-base">
          <PlusCircle size={22} strokeWidth={1.75} />
          {translations.newWorkout[lang]}
        </button>
        <RestoreFromBackupLink />
      </div>
    );
  }

  const inProgressDone = inProgress
    ? inProgress.exercises.reduce((n, ex) => n + ex.sets.filter(s => !s.ghost).length, 0)
    : 0;

  return (
    <div className="space-y-5 anim-tab-enter">
      {/* 进行中的训练（workbench-not-restored）：练到一半出来看一眼，从这里接回去 */}
      {inProgress && (
        <div className="ui-card flex items-stretch overflow-hidden shadow-[inset_4px_0_0_var(--text-primary)]" data-testid="in-progress">
          <button
            type="button"
            onClick={actions.onResumeWorkout}
            className="flex-1 min-w-0 min-h-[56px] px-4 flex items-center gap-3 text-left active:bg-card-hover"
          >
            <span className="w-2 h-2 rounded-full bg-accent animate-pulse flex-shrink-0" aria-hidden />
            <span className="flex-1 min-w-0">
              <span className="block text-label font-semibold text-accent">{isCn ? '进行中' : 'In progress'}</span>
              <span className="block font-semibold text-primary truncate">
                {inProgress.title || (isCn ? '未命名训练' : 'Untitled')}
                <span className="font-mono text-label text-tertiary tabular-nums ml-2">
                  {inProgress.exercises.length} {isCn ? '动作' : 'ex'} · {inProgressDone} {isCn ? '组' : plural(inProgressDone, 'set')}
                </span>
              </span>
            </span>
            <span className="text-sm font-bold text-accent whitespace-nowrap">{isCn ? '回到训练 ›' : 'Resume ›'}</span>
          </button>
          <button
            type="button"
            onClick={actions.onEndInProgress}
            className="px-4 border-l border-divider text-sm font-semibold text-secondary active:bg-card-hover whitespace-nowrap"
            data-testid="in-progress-end"
          >
            {isCn ? '结束' : 'End'}
          </button>
        </div>
      )}

      {/* 体重：单行摘要，点击展开趋势 */}
      <div className="ui-card px-4 py-3">
        <div
          className="flex items-center gap-3 cursor-pointer min-h-[44px]"
          onClick={() => setSelectedPRProject(selectedPRProject === '__WEIGHT__' ? null : '__WEIGHT__')}
        >
          <Scale size={16} strokeWidth={2} className="text-accent flex-shrink-0" />
          <div className="flex-1 min-w-0 flex items-baseline gap-2 flex-wrap">
            <span className="font-mono font-bold text-lg text-primary tabular-nums">
              {weightSummary?.value ?? '--'}
            </span>
            <span className="text-xs text-tertiary uppercase">{unit}</span>
            {weightSummary?.delta && (
              <span
                data-testid="weight-delta-30d"
                className={`text-xs font-semibold tabular-nums ${
                  weightSummary.delta.startsWith('+') ? 'text-warning' : 'text-accent'
                }`}
              >
                {weightSummary.delta} {unit}
                <span className="text-tertiary font-normal ml-0.5">
                  {lang === Language.CN ? '· 30天' : '· 30d'}
                </span>
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              actions.onLogWeight();
            }}
            className="w-10 h-10 flex items-center justify-center bg-accent text-on-accent rounded-control active:scale-press-sm"
            aria-label={lang === Language.CN ? '记录体重' : 'Log weight'}
          >
            <Plus size={18} strokeWidth={2} />
          </button>
          <span className="text-tertiary flex-shrink-0">
            {selectedPRProject === '__WEIGHT__' ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
          </span>
        </div>

        {selectedPRProject === '__WEIGHT__' && (
          <div className="border-t border-divider mt-5 pt-5">
            <div className="flex items-center justify-between gap-2 mb-3">
              <p className="ui-section-label flex items-center gap-2">
                <TrendingUp size={12} strokeWidth={1.75} />
                {translations.weightTrend[lang]}
              </p>
              <div className="flex gap-0.5 bg-inset rounded-control p-0.5" role="group">
                {WEIGHT_RANGES.map(r => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setWeightRange(r)}
                    className={`px-2 py-1 rounded-chip text-xs font-semibold tabular-nums ${r === weightRange ? 'seg-on' : 'text-tertiary'}`}
                    aria-pressed={r === weightRange}
                  >
                    {({ '3m': isCn ? '3月' : '3M', '6m': isCn ? '6月' : '6M', '1y': isCn ? '1年' : '1Y', all: isCn ? '全部' : 'All' })[r]}
                  </button>
                ))}
              </div>
            </div>
            <Suspense fallback={<div className="h-[200px]" />}>
              <WeightTrendChart weightEntries={weightEntries} range={weightRange} lang={lang} unit={unit} />
            </Suspense>

            <div className="mt-6 space-y-3 max-h-[300px] overflow-y-auto custom-scrollbar pr-1 pt-4 border-t border-divider">
              <h4 className="ui-section-label flex items-center gap-2 mb-2">
                <History size={12} strokeWidth={1.75} />
                {lang === Language.CN ? '历史体重记录' : 'Weight History'} ({weightEntries.length})
              </h4>
              {weightEntries.map(entry => (
                <div
                  key={entry.id}
                  className="bg-inset p-3 rounded-control flex justify-between items-center"
                >
                  <div className="flex items-center gap-2">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        actions.onEditWeight(entry);
                      }}
                      className="p-2 text-accent bg-accent-soft rounded-chip hover:opacity-80 transition-opacity"
                    >
                      <Edit2 size={12} strokeWidth={1.75} />
                    </button>
                    <button
                      onClick={(e) => actions.onDeleteWeightEntry(e, entry.id)}
                      className="p-2 text-danger bg-danger/10 rounded-chip hover:opacity-80 transition-opacity"
                    >
                      <Trash2 size={12} strokeWidth={1.75} />
                    </button>
                    <span className="font-mono font-medium text-sm text-primary tabular-nums ml-1">
                      {formatWeight(entry.weight, unit)}
                      <span className="text-tertiary text-xs ml-1">{unit}</span>
                    </span>
                  </div>
                  <span className="text-xs text-tertiary">
                    {new Date(entry.date).toLocaleDateString(dateLocale, {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 视图切换：按时间 / 按动作 PR */}
      <div className="ui-card p-1.5 flex items-center gap-1">
        <button
          type="button"
          onClick={() => setView('timeline')}
          className={`flex-1 min-h-[42px] flex items-center justify-center gap-2 rounded-control text-sm font-bold transition-ui ${
            view === 'timeline'
              ? 'seg-on'
              : 'bg-transparent text-secondary hover:text-primary'
          }`}
        >
          <Clock size={14} strokeWidth={2} />
          <span>{lang === Language.CN ? '按时间' : 'Timeline'}</span>
        </button>
        <button
          type="button"
          onClick={() => setView('pr')}
          className={`flex-1 min-h-[42px] flex items-center justify-center gap-2 rounded-control text-sm font-bold transition-ui ${
            view === 'pr'
              ? 'seg-on'
              : 'bg-transparent text-secondary hover:text-primary'
          }`}
        >
          <Trophy size={14} strokeWidth={2} />
          <span>{lang === Language.CN ? '按动作' : 'By exercise'}</span>
        </button>
      </div>

      {view === 'timeline' && (
        <TimelineView
          lang={lang}
          workouts={workouts}
          granularity={granularity}
          onGranularityChange={setGranularity}
          resolveName={prefs.resolveName}
          renderSetCapsule={renderSetCapsule}
          onEditWorkout={(id) => actions.onEditWorkout(id)}
          onAddExerciseToWorkout={actions.onAddExerciseToPastWorkout}
          onDeleteWorkout={actions.onDeleteWorkout}
          onMergeIntoPrevious={actions.onMergeIntoPrevious}
          onCopyToToday={actions.onCopyWorkoutToToday}
          onResumeFinished={actions.onResumeFinishedWorkout}
        />
      )}

      {/* 按动作：列表 + 详情 */}
      {view === 'pr' && (
        <FeaturedLifts
          lifts={lifts}
          chosen={appPrefs.featuredLifts}
          onChange={ids => changeAppPrefs({ featuredLifts: ids })}
          mode={appPrefs.featuredMode}
          onModeChange={m => changeAppPrefs({ featuredMode: m })}
          onOpen={setSelectedPRProject}
          getActiveMetrics={prefs.getActiveMetrics}
          weightEntries={weightEntries}
          lang={lang}
          unit={unit}
        />
      )}

      {view === 'pr' && (
        <LiftList
          lifts={lifts}
          lang={lang}
          unit={unit}
          starred={prefs.starredExercises}
          onToggleStar={prefs.toggleStarExercise}
          onOpen={setSelectedPRProject}
          getActiveMetrics={prefs.getActiveMetrics}
        />
      )}

      <LiftDetailSheet
        lift={openLift}
        onClose={() => setSelectedPRProject(null)}
        lang={lang}
        unit={unit}
        activeMetrics={openLift ? prefs.getActiveMetrics(openLift.baseName) : []}
        metric={openLift ? chartMetricPreference[openLift.key] : undefined}
        onMetricChange={m => openLift && setChartMetricPreference(prev => ({ ...prev, [openLift.key]: m }))}
        renderSetCapsule={renderSetCapsule}
        formatExerciseTime={formatExerciseTime}
        onEditExerciseTime={(workoutId, exerciseId, initial) => setExerciseTimeEdit({ workoutId, exerciseId, initial })}
        onEditWorkout={id => {
          setSelectedPRProject(null);
          actions.onEditWorkout(id);
        }}
        onDeleteRecord={(e, workoutId, exerciseId, date) =>
          actions.onDeleteExerciseRecord(e, workoutId, exerciseId, openLift?.baseName ?? '', date)
        }
      />

      <DateTimePicker
        isOpen={!!exerciseTimeEdit}
        lang={lang}
        initialDate={exerciseTimeEdit?.initial}
        onClose={() => setExerciseTimeEdit(null)}
        onConfirm={async (date) => {
          if (!exerciseTimeEdit) return;
          await updateExerciseTime(
            exerciseTimeEdit.workoutId,
            exerciseTimeEdit.exerciseId,
            date.toISOString(),
          );
          setExerciseTimeEdit(null);
        }}
      />

    </div>
  );
};

export default Dashboard;
