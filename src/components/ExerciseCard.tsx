import React from 'react';
import { Trash2, StickyNote, Settings as SettingsIcon, Calendar, History, Plus } from 'lucide-react';
import { Exercise, BodyweightMode, Language } from '../../types';
import { translations } from '../../translations';
import { formatExerciseTime } from '../utils/dateUtils';
import { SetCapsule } from './SetCapsule';

interface ExerciseCardProps {
  exercise: Exercise;
  exIdx: number;
  lang: Language;
  unit: string;
  isBodyweight: boolean;
  isPyramid: boolean;
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
  onOpenRestSettings?: (name: string) => void;
  getRestPref?: (name: string) => number;
}

const chipActive = 'bg-accent text-white';
const chipIdle = 'bg-inset text-secondary hover:text-primary';

export const ExerciseCard: React.FC<ExerciseCardProps> = ({
  exercise,
  exIdx,
  lang,
  unit,
  isBodyweight,
  isPyramid,
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
  onOpenRestSettings,
  getRestPref,
}) => {
  const exerciseName = resolveName(exercise.name);
  const activeMetrics = getActiveMetrics(exerciseName);
  const hasNote = !!exerciseNotes[exerciseName];

  const handleBodyweightModeChange = (mode: 'none' | 'bodyweight' | 'assisted' | 'weighted') => {
    const updates: Partial<Exercise> = {
      instanceConfig: {
        ...exercise.instanceConfig,
        bodyweightMode: mode,
      },
    };

    if (mode === 'bodyweight' || mode === 'assisted' || mode === 'weighted') {
      updates.sets = exercise.sets.map(s => ({ ...s, bodyweightMode: 'normal' }));
    } else {
      updates.sets = exercise.sets.map(s => {
        const { bodyweightMode, ...rest } = s;
        return rest;
      });
    }

    onUpdateExercise(exIdx, updates);
  };

  const handleTogglePyramid = () => {
    onUpdateExercise(exIdx, {
      instanceConfig: {
        ...exercise.instanceConfig,
        enablePyramid: !exercise.instanceConfig?.enablePyramid,
      },
    });
  };

  const handleSubModeChange = (mode: BodyweightMode) => {
    onUpdateExercise(exIdx, {
      sets: exercise.sets.map(s => ({ ...s, bodyweightMode: mode })),
    });
  };

  const handleDurationClick = (setIdx: number) => {
    onOpenTimePicker(exIdx, setIdx, exercise.sets[setIdx].duration || 0);
  };

  return (
    <div className="ui-card p-6">
      <div className="flex flex-col gap-2 mb-5">
        <div className="flex justify-between items-start">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-display text-lg font-semibold text-primary leading-tight">{exerciseName}</h3>

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
              className="p-2 text-tertiary hover:text-danger transition-colors"
            >
              <Trash2 size={20} strokeWidth={1.75} />
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

      <div className="flex flex-wrap gap-2 mb-5">
        <div className="flex flex-wrap gap-1 p-1 bg-inset rounded-control border border-divider">
          {(['none', 'bodyweight', 'assisted', 'weighted'] as const).map(mode => (
            <button
              key={mode}
              onClick={() => handleBodyweightModeChange(mode)}
              className={`px-2.5 py-1.5 rounded-chip text-[10px] font-medium transition-colors ${
                exercise.instanceConfig?.bodyweightMode === mode ? chipActive : chipIdle
              }`}
            >
              {mode === 'none'
                ? lang === Language.CN
                  ? '器械'
                  : 'Weight'
                : mode === 'bodyweight'
                  ? lang === Language.CN
                    ? '自重'
                    : 'Bodyweight'
                  : mode === 'assisted'
                    ? lang === Language.CN
                      ? '辅助'
                      : 'Assisted'
                    : lang === Language.CN
                      ? '负重'
                      : 'Weighted'}
            </button>
          ))}
        </div>

        <button
          onClick={handleTogglePyramid}
          className={`px-2.5 py-1.5 rounded-chip text-[10px] font-medium border transition-colors ${
            isPyramid ? chipActive + ' border-accent' : chipIdle + ' border-divider'
          }`}
        >
          {lang === Language.CN ? '递增递减组' : 'Pyramid Sets'}
        </button>
      </div>

      {isBodyweight && (
        <div className="flex gap-1 mb-5 p-1 bg-inset rounded-control border border-divider">
          {(['normal', 'weighted', 'assisted'] as BodyweightMode[]).map(mode => (
            <button
              key={mode}
              onClick={() => handleSubModeChange(mode)}
              className={`flex-1 py-1.5 rounded-chip text-[10px] font-medium transition-colors ${
                exercise.sets[0]?.bodyweightMode === mode ? chipActive : chipIdle
              }`}
            >
              {translations[`mode${mode.charAt(0).toUpperCase() + mode.slice(1)}` as keyof typeof translations][lang]}
            </button>
          ))}
        </div>
      )}

      <div
        className="grid gap-2 items-center px-2 mb-2 text-xs font-medium text-tertiary"
        style={{ gridTemplateColumns: `35px repeat(${activeMetrics.length}, 1fr) 35px` }}
      >
        <span className="pl-1">#</span>
        {activeMetrics.map(m => (
          <div key={m} className="flex flex-col items-center leading-tight">
            <span>{translations[m as keyof typeof translations]?.[lang] || m.replace('custom_', '')}</span>
            <span className="text-[10px] opacity-60">{unit}</span>
          </div>
        ))}
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
            isPyramid={isPyramid}
            onUpdate={updates => onSetUpdate(exIdx, setIdx, updates)}
            onRemove={() => onRemoveSet(exIdx, setIdx)}
            onDurationClick={() => handleDurationClick(setIdx)}
          />
        ))}
      </div>

      <div className="flex gap-2 mt-4">
        <button
          onClick={() => onAddSet(exIdx)}
          className="flex-1 py-3 border border-dashed border-divider rounded-control text-secondary font-medium flex items-center justify-center gap-2 hover:bg-card-hover transition-colors"
        >
          <Plus size={16} strokeWidth={1.75} /> {lang === Language.CN ? '添加组' : 'Add Set'}
        </button>

        {onOpenRestSettings && getRestPref && (
          <button
            onClick={() => onOpenRestSettings(exerciseName)}
            className="px-4 py-3 bg-inset border border-divider rounded-control text-accent font-mono font-medium flex items-center gap-2 hover:bg-card-hover active:scale-95 transition-all"
          >
            <History size={18} strokeWidth={1.75} />
            <span className="text-xs tabular-nums">{getRestPref(exerciseName)}s</span>
          </button>
        )}
      </div>
    </div>
  );
};

export default ExerciseCard;
