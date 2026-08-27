import React from 'react';
import { Trash2, StickyNote, Settings as SettingsIcon, Calendar, Plus } from 'lucide-react';
import { Exercise, Language } from '../../types';
import { translations } from '../../translations';
import { formatExerciseTime } from '../utils/dateUtils';
import { SetCapsule } from './SetCapsule';
import { getLoadMode, LoadMode } from '../utils/exerciseConfig';

/**
 * 指标列对应的单位标签（按 metric 类型 + 当前单位制 + 语言返回）。
 * - reps / 自定义 → 不显示单位（避免出现"次数下面写 kg"的笑话）
 * - weight → kg / lbs
 * - distance / speed → 取决于单位制
 * - duration → h:m:s
 */
function metricUnitLabel(metric: string, unit: string, lang: Language, loadMode: LoadMode): string {
  const isCN = lang === Language.CN;
  switch (metric) {
    case 'weight': {
      const u = unit === 'kg' ? 'kg' : 'lbs';
      // 负重/辅助标记体现在表头符号上（备忘用途，不参与统计）
      return loadMode === 'weighted' ? `+${u}` : loadMode === 'assisted' ? `−${u}` : u;
    }
    case 'reps':
      return isCN ? '次' : 'reps';
    case 'distance':
      return unit === 'kg' ? 'km' : 'mi';
    case 'speed':
      return unit === 'kg' ? 'km/h' : 'mph';
    case 'duration':
      return 'h:m:s';
    default:
      return '';
  }
}

interface ExerciseCardProps {
  exercise: Exercise;
  exIdx: number;
  lang: Language;
  unit: string;
  exerciseNotes: Record<string, string>;
  getActiveMetrics: (name: string) => string[];
  resolveName: (name: string) => string;
  onUpdateExercise: (exIdx: number, updates: Partial<Exercise>) => void;
  onDeleteExercise: (exIdx: number) => void;
  onOpenTimePicker: (exIdx: number, setIdx: number, currentSeconds: number) => void;
  onToggleNote: (name: string) => void;
  onOpenMetricModal: (name: string) => void;
  onSetUpdate: (exIdx: number, setIdx: number, updates: Partial<Exercise['sets'][0]>) => void;
  onAddSet: (exIdx: number) => void;
  onRemoveSet: (exIdx: number, setIdx: number) => void;
}

export const ExerciseCard: React.FC<ExerciseCardProps> = ({
  exercise,
  exIdx,
  lang,
  unit,
  exerciseNotes,
  getActiveMetrics,
  resolveName,
  onUpdateExercise,
  onDeleteExercise,
  onOpenTimePicker,
  onToggleNote,
  onOpenMetricModal,
  onSetUpdate,
  onAddSet,
  onRemoveSet,
}) => {

  const exerciseName = resolveName(exercise.name);
  const activeMetrics = getActiveMetrics(exerciseName);
  const hasNote = !!exerciseNotes[exerciseName];
  const loadMode = getLoadMode(exercise);

  const handleDurationClick = (setIdx: number) => {
    onOpenTimePicker(exIdx, setIdx, exercise.sets[setIdx].duration || 0);
  };

  return (
    <div className="ui-card p-6">
      <div className="flex flex-col gap-2 mb-5">
        <div className="flex justify-between items-start">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-display text-lg font-semibold text-primary leading-tight">{exerciseName}</h3>

            {loadMode !== 'none' && (
              <button
                onClick={() => onOpenMetricModal(exerciseName)}
                className="px-2 py-0.5 rounded-chip text-[10px] font-semibold bg-accent/10 text-accent border border-accent/25"
                title={lang === Language.CN ? '修改负重/辅助标记' : 'Change load mode'}
              >
                {loadMode === 'weighted'
                  ? lang === Language.CN ? '负重 +' : 'Weighted +'
                  : lang === Language.CN ? '辅助 −' : 'Assisted −'}
              </button>
            )}

            {exercise.exerciseTime && (
              <button
                onClick={() => handleDurationClick(0)}
                className="px-2.5 py-1 bg-inset border border-divider rounded-chip text-xs font-mono text-secondary flex items-center gap-1"
              >
                <Calendar size={12} strokeWidth={1.75} />
                {formatExerciseTime(exercise.exerciseTime, lang === Language.CN ? 'cn' : 'en').time}
              </button>
            )}

            <button
              onClick={() => onToggleNote(exerciseName)}
              className={`p-2 rounded-control transition-colors ${
                hasNote ? 'text-warning bg-warning/10' : 'text-tertiary hover:text-secondary'
              }`}
            >
              <StickyNote size={18} strokeWidth={1.75} />
            </button>
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={() => onOpenMetricModal(exerciseName)}
              className="p-2 rounded-control text-tertiary hover:text-accent bg-inset"
            >
              <SettingsIcon size={18} strokeWidth={1.75} />
            </button>
            <button
              onClick={() => onDeleteExercise(exIdx)}
              className="w-11 h-11 flex items-center justify-center text-danger bg-danger/10 hover:bg-danger/20 rounded-control transition-colors active:scale-95"
              title={lang === Language.CN ? '删除此动作' : 'Delete exercise'}
              aria-label={lang === Language.CN ? '删除此动作' : 'Delete exercise'}
            >
              <Trash2 size={18} strokeWidth={1.75} />
            </button>
          </div>
        </div>

        {hasNote && (
          <div
            onClick={() => onToggleNote(exerciseName)}
            className="self-start bg-warning/10 border border-warning/20 rounded-control px-3 py-2 cursor-pointer"
          >
            <p className="text-xs text-warning font-medium flex items-start gap-2">
              <StickyNote size={12} className="mt-0.5 flex-shrink-0" strokeWidth={1.75} />
              {exerciseNotes[exerciseName]}
            </p>
          </div>
        )}
      </div>

      <div
        className="grid gap-2 items-center px-2 mb-2 text-xs font-medium text-tertiary"
        style={{ gridTemplateColumns: `35px repeat(${activeMetrics.length}, 1fr) 35px` }}
      >
        <span className="pl-1">#</span>
        {activeMetrics.map(m => {
          const unitLabel = metricUnitLabel(m, unit, lang, loadMode);
          return (
            <div key={m} className="flex flex-col items-center leading-tight">
              <span>{translations[m as keyof typeof translations]?.[lang] || m.replace('custom_', '')}</span>
              {unitLabel && (
                <span className="text-[10px] opacity-60">{unitLabel}</span>
              )}
            </div>
          );
        })}
        <span />
      </div>

      <div className="space-y-3">
        {exercise.sets.map((set, setIdx) => (
          <SetCapsule
            key={set.id}
            set={set}
            setIdx={setIdx}
            activeMetrics={activeMetrics}
            unit={unit}
            lang={lang}
            onUpdate={updates => onSetUpdate(exIdx, setIdx, updates)}
            onRemove={() => onRemoveSet(exIdx, setIdx)}
            onDurationClick={() => handleDurationClick(setIdx)}
          />
        ))}
      </div>

      <div className="mt-4 flex items-center gap-2">
        <button
          onClick={() => onAddSet(exIdx)}
          className="flex-1 min-h-[44px] py-3 border border-dashed border-divider rounded-control text-secondary font-medium flex items-center justify-center gap-2 hover:bg-card-hover transition-colors active:scale-[0.98]"
        >
          <Plus size={16} strokeWidth={1.75} /> {lang === Language.CN ? '添加组' : 'Add Set'}
        </button>
        <button
          onClick={() => onDeleteExercise(exIdx)}
          className="min-h-[44px] px-4 rounded-control text-danger bg-danger/10 hover:bg-danger/20 font-bold flex items-center justify-center gap-2 transition-colors active:scale-95"
          title={lang === Language.CN ? '删除此动作' : 'Delete this exercise'}
        >
          <Trash2 size={16} strokeWidth={2} />
          <span className="text-sm">{lang === Language.CN ? '删除动作' : 'Delete'}</span>
        </button>
      </div>
    </div>
  );
};

export default ExerciseCard;
