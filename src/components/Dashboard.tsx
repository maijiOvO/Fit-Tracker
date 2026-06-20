import React, { lazy, useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { DateTimePicker } from './DateTimePicker';
import { SetCapsule } from './SetCapsule';
import {
  Trophy, PlusCircle, Plus, Trash2, Edit2, Star, Calendar,
  Scale, TrendingUp, History, ChevronDown, ChevronUp, Cloud,
  Download, Clock, Play
} from 'lucide-react';
import { Language, WeightEntry, Exercise } from '../../types';
import { translations } from '../../translations';
import { formatWeight } from '../utils/format';
import { TimelineView, type TimelineGranularity } from './TimelineView';
import { useUserSettingsContext } from '../contexts/UserSettingsContext';
import { useWorkoutContext } from '../contexts/WorkoutContext';
import { useExercisePrefs } from '../contexts/ExercisePrefsContext';
import { useExerciseStats } from '../hooks/useFilteredExercises';
import { useExerciseTimeEditor } from '../hooks/useExerciseTimeEditor';

const TrendChart = lazy(() => import('./LazyCharts').then(m => ({ default: m.TrendChart })));

type DashboardView = 'timeline' | 'pr';
const VIEW_STORAGE_KEY = 'fitlog_dashboard_view';
const GRANULARITY_STORAGE_KEY = 'fitlog_timeline_granularity';

/** 必须由 App 注入的交互（依赖 Tab 切换、Modal、Workout 变更等） */
export interface DashboardActions {
  onStartNewWorkout: () => void;
  onResumeDraft: () => void;
  onEditWorkout: (workoutId: string, options?: { scrollToPicker?: boolean }) => void;
  onAddExerciseToPastWorkout: (workoutId: string) => void;
  onDeleteWorkout: (workoutId: string) => void | Promise<void>;
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
  const { lang, unit, weightEntries } = useUserSettingsContext();
  const { workouts, hasDraft } = useWorkoutContext();
  const prefs = useExercisePrefs();
  const { bestLifts } = useExerciseStats();
  const { formatExerciseTime, updateExerciseTime } = useExerciseTimeEditor();

  const getChartMetric = useCallback(
    (exerciseName: string) =>
      chartMetricPreference[exerciseName] ||
      prefs.getActiveMetrics(exerciseName)[0] ||
      'reps',
    [chartMetricPreference, prefs],
  );

  const renderSetCapsule = useCallback(
    (s: any, exerciseName: string) => (
      <SetCapsule
        set={s}
        setIdx={0}
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

  const [isHistoryVisible, setIsHistoryVisible] = useState(false);
  const lastSelectionRef = useRef<string | null>(null);
  useEffect(() => {
    if (lastSelectionRef.current !== selectedPRProject) {
      setIsHistoryVisible(false);
      lastSelectionRef.current = selectedPRProject;
    }
  }, [selectedPRProject]);
  // 视图模式：默认按时间线
  const [view, setView] = useState<DashboardView>(() => {
    try {
      const saved = localStorage.getItem(VIEW_STORAGE_KEY);
      return saved === 'pr' ? 'pr' : 'timeline';
    } catch {
      return 'timeline';
    }
  });
  const [granularity, setGranularity] = useState<TimelineGranularity>(() => {
    try {
      const saved = localStorage.getItem(GRANULARITY_STORAGE_KEY);
      if (saved === 'day' || saved === 'week' || saved === 'month' || saved === 'year') {
        return saved;
      }
      return 'day';
    } catch {
      return 'day';
    }
  });
  useEffect(() => {
    try { localStorage.setItem(VIEW_STORAGE_KEY, view); } catch {}
  }, [view]);
  useEffect(() => {
    try { localStorage.setItem(GRANULARITY_STORAGE_KEY, granularity); } catch {}
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
    const baseline =
      [...sorted].reverse().find(e => new Date(e.date).getTime() <= cutoff)
      ?? sorted[sorted.length - 1];
    const delta = latest.weight - baseline.weight;
    const sign = delta > 0 ? '+' : '';
    return {
      value: formatWeight(latest.weight, unit),
      delta: sorted.length >= 2 ? `${sign}${formatWeight(delta, unit)}` : null,
    };
  }, [weightEntries, unit]);

  if (workouts.length === 0 && weightEntries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center p-6 animate-fade-in">
        <div className="bg-accent-soft p-8 rounded-full mb-8">
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
      </div>
    );
  }

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Draft 横幅：未完成的训练 */}
      {hasDraft && (
        <button
          onClick={actions.onResumeDraft}
          className="ui-card p-5 bg-accent/5 border border-accent/20 hover:bg-accent/10 transition-colors w-full text-left cursor-pointer"
        >
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-full bg-accent/10 text-accent">
              <Play size={20} strokeWidth={2} fill="currentColor" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-primary text-sm">
                {lang === Language.CN ? '你有一场未完成的训练' : 'You have an unfinished workout'}
              </p>
              <p className="text-xs text-secondary mt-0.5">
                {lang === Language.CN ? '点击继续训练 →' : 'Tap to resume →'}
              </p>
            </div>
            <div className="text-accent font-bold text-sm flex-shrink-0">
              {lang === Language.CN ? '继续训练' : 'Resume'}
            </div>
          </div>
        </button>
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
            className="w-10 h-10 flex items-center justify-center bg-accent text-white rounded-xl active:scale-95"
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
            <p className="ui-section-label flex items-center gap-2 mb-4">
              <TrendingUp size={12} strokeWidth={1.75} />
              {translations.weightTrend[lang]}
            </p>
            <TrendChart
              target="__WEIGHT__"
              workouts={workouts}
              weightEntries={weightEntries}
              lang={lang}
              unit={unit}
              resolveName={prefs.resolveName}
              getChartMetric={getChartMetric}
            />

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
                    {new Date(entry.date).toLocaleDateString('zh-CN', {
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
          className={`flex-1 min-h-[42px] flex items-center justify-center gap-2 rounded-xl text-sm font-bold transition-all ${
            view === 'timeline'
              ? 'bg-accent text-white shadow-md shadow-blue-600/20'
              : 'bg-transparent text-secondary hover:text-primary'
          }`}
        >
          <Clock size={14} strokeWidth={2} />
          <span>{lang === Language.CN ? '按时间' : 'Timeline'}</span>
        </button>
        <button
          type="button"
          onClick={() => setView('pr')}
          className={`flex-1 min-h-[42px] flex items-center justify-center gap-2 rounded-xl text-sm font-bold transition-all ${
            view === 'pr'
              ? 'bg-accent text-white shadow-md shadow-blue-600/20'
              : 'bg-transparent text-secondary hover:text-primary'
          }`}
        >
          <Trophy size={14} strokeWidth={2} />
          <span>{lang === Language.CN ? '按动作 PR' : 'By PR'}</span>
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
        />
      )}

      {/* PR 管理 */}
      {view === 'pr' && (
      <div className="space-y-3">
        <h3 className="ui-section-label flex items-center gap-2 px-1">
          <Trophy className="text-warning" size={14} strokeWidth={1.75} />
          {translations.prManagement[lang]}
        </h3>

        {bestLifts.map(lift => {
          const isExpanded = selectedPRProject === lift.key;
          const isStarred = !!prefs.starredExercises[lift.key];
          const historyExs = workouts
            .flatMap(w => w.exercises.map(e => ({
              ...e,
              date: w.date,
              workoutId: w.id,
              fromSchedule: w.fromSchedule,
            })))
            .filter(e => e.name === lift.key)
            .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

          return (
            <div
              key={lift.name}
              className={`ui-card-interactive p-5 ${isExpanded ? 'ring-2 ring-accent/25' : ''}`}
            >
              <div
                className="flex justify-between items-center cursor-pointer"
                onClick={() => setSelectedPRProject(isExpanded ? null : lift.key)}
              >
                <div className="flex items-center gap-3">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      prefs.toggleStarExercise(lift.key);
                    }}
                    className={`p-2.5 rounded-control transition-colors ${
                      isStarred
                        ? 'bg-warning/15 text-warning'
                        : 'bg-inset text-tertiary hover:text-warning'
                    }`}
                  >
                    <Star size={18} fill={isStarred ? 'currentColor' : 'none'} strokeWidth={1.75} />
                  </button>
                  <span className="font-semibold text-primary">{lift.name}</span>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <span className="font-mono font-medium text-lg text-primary tabular-nums leading-none">
                      {formatWeight(lift.weight, unit)}
                    </span>
                    <span className="text-xs text-tertiary uppercase block">{unit}</span>
                  </div>
                  <span className="text-tertiary">
                    {isExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                  </span>
                </div>
              </div>

              {isExpanded && (
                <div className="border-t border-divider mt-5 pt-5 animate-fade-in">
                  <div className="flex flex-wrap gap-2 mb-4">
                    {prefs.getActiveMetrics(lift.name).map(m => (
                      <button
                        key={m}
                        onClick={() =>
                          setChartMetricPreference({ ...chartMetricPreference, [lift.name]: m })
                        }
                        className={`px-3 py-1.5 rounded-chip text-xs font-medium transition-colors ${
                          getChartMetric(lift.name) === m
                            ? 'bg-accent text-white'
                            : 'bg-inset text-secondary border border-divider'
                        }`}
                      >
                        {translations[m as keyof typeof translations]?.[lang] || m.replace('custom_', '')}
                      </button>
                    ))}
                  </div>

                  <div className="mb-6">
                    <TrendChart
                      target={lift.name}
                      metricKey={getChartMetric(lift.name)}
                      workouts={workouts}
                      weightEntries={weightEntries}
                      lang={lang}
                      unit={unit}
                      resolveName={prefs.resolveName}
                      getChartMetric={getChartMetric}
                    />
                  </div>

                  {historyExs.length > 0 && (
                    <div className="space-y-3 border-t border-divider pt-5">
                      <button
                        onClick={() => setIsHistoryVisible(!isHistoryVisible)}
                        className="w-full flex items-center justify-between group"
                      >
                        <h4 className="ui-section-label group-hover:text-accent transition-colors">
                          {translations.history[lang]} ({historyExs.length})
                        </h4>
                        <span
                          className={`p-1.5 rounded-chip bg-inset text-tertiary transition-transform ${
                            isHistoryVisible ? 'rotate-180 text-accent' : ''
                          }`}
                        >
                          <ChevronDown size={16} />
                        </span>
                      </button>

                      {isHistoryVisible && (
                        <div className="space-y-4 max-h-[500px] overflow-y-auto custom-scrollbar pr-1 animate-fade-in">
                          {historyExs.map((ex, exIdx) => (
                            <div
                              key={`${ex.workoutId}-${ex.id}-${exIdx}`}
                              className="space-y-3 pb-4 border-b border-divider last:border-0 last:pb-0"
                            >
                              <div className="flex justify-between items-center">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      actions.onEditWorkout(ex.workoutId);
                                    }}
                                    className="p-2 text-accent bg-accent-soft rounded-chip"
                                  >
                                    <Edit2 size={14} strokeWidth={1.75} />
                                  </button>
                                  <button
                                    onClick={(e) =>
                                      actions.onDeleteExerciseRecord(
                                        e,
                                        ex.workoutId,
                                        ex.id,
                                        prefs.resolveName(ex.name),
                                        ex.date
                                      )
                                    }
                                    className="p-2 text-danger bg-danger/10 rounded-chip"
                                  >
                                    <Trash2 size={16} strokeWidth={1.75} />
                                  </button>
                                  <div className="flex items-center gap-2 text-tertiary">
                                    <Calendar size={14} strokeWidth={1.75} />
                                    <span className="text-xs font-medium">
                                      {new Date(ex.date).toLocaleDateString('zh-CN', {
                                        year: 'numeric',
                                        month: 'short',
                                        day: 'numeric',
                                      })}
                                    </span>
                                  </div>
                                  {ex.fromSchedule && (
                                    <span
                                      className={`text-[10px] px-2 py-0.5 rounded-chip font-medium ${
                                        ex.fromSchedule.faithful
                                          ? 'bg-accent-soft text-accent'
                                          : 'bg-warning/15 text-warning'
                                      }`}
                                      title={ex.fromSchedule.faithful
                                        ? (translations.planBadgeFaithful?.[lang] ?? '来自计划')
                                        : (translations.planBadgeModified?.[lang] ?? '计划 · 有调整')}
                                    >
                                      {ex.fromSchedule.faithful
                                        ? (translations.planBadgeFaithful?.[lang] ?? '来自计划')
                                        : (translations.planBadgeModified?.[lang] ?? '计划 · 有调整')}
                                    </span>
                                  )}
                                  {ex.exerciseTime && (
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setExerciseTimeEdit({
                                          workoutId: ex.workoutId,
                                          exerciseId: ex.id,
                                          initial: new Date(ex.exerciseTime),
                                        });
                                      }}
                                      className="px-2 py-1 bg-inset border border-divider rounded-chip text-xs font-mono text-secondary hover:text-accent transition-colors"
                                    >
                                      {formatExerciseTime(ex.exerciseTime, lang === Language.CN ? 'cn' : 'en').time}
                                    </button>
                                  )}
                                </div>
                                <span className="text-xs font-medium text-tertiary bg-inset px-2.5 py-1 rounded-chip">
                                  {ex.sets.length} {translations.setsCount[lang]}
                                </span>
                              </div>
                              <div className="flex flex-wrap gap-2">
                                {ex.sets.map((s: any) => renderSetCapsule(s, ex.name))}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      )}

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

      {/* 导出 */}
      <div className="mt-8 mb-8 px-1 pb-16">
        <div className="ui-card p-6 text-center space-y-4">
          <div className="flex justify-center">
            <div className="p-3 bg-accent-soft text-accent rounded-full">
              <Cloud size={28} strokeWidth={1.75} />
            </div>
          </div>
          <h4 className="font-display text-lg font-semibold text-primary">
            {translations.exportData[lang]}
          </h4>
          <p className="text-xs text-secondary leading-relaxed max-w-[240px] mx-auto">
            {translations.exportDesc[lang]}
          </p>
          <button onClick={actions.onExportData} className="ui-btn-secondary w-full flex items-center justify-center gap-2 py-3.5">
            <Download size={18} strokeWidth={1.75} className="text-accent" />
            {lang === Language.CN ? '立即导出备份' : 'Export backup'}
          </button>
          <p className="text-[10px] text-tertiary">Your data is yours. Always.</p>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
