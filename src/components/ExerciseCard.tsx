import React from 'react';
import { Trash2, StickyNote, Settings as SettingsIcon, Calendar } from 'lucide-react';
import { Exercise, BodyweightMode, Language } from '../../types';
import { translations } from '../../translations';
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
  getUnitTag: (metric: string, unit: string) => string;
  secondsToHMS: (seconds: number) => { h: number; m: number; s: number };
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
  isBodyweight,
  isPyramid,
  exerciseNotes,
  getActiveMetrics,
  resolveName,
  getUnitTag,
  secondsToHMS,
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

  const handleBodyweightModeChange = (mode: BodyweightMode | 'none') => {
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
    <div className="bg-slate-800/40 p-8 rounded-[2.5rem] border border-slate-700/50">
      {/* Exercise Header */}
      <div className="flex flex-col gap-2 mb-6">
        <div className="flex justify-between items-start">
          <div className="flex items-center gap-2">
            <h3 className="text-xl font-black text-blue-400 leading-tight">{exerciseName}</h3>
            
            {/* Time Button */}
            {exercise.exerciseTime && (
              <button
                onClick={() => handleDurationClick(0)}
                className="px-3 py-1 bg-slate-700/50 border border-slate-600/50 rounded-lg text-xs font-bold text-slate-300 hover:bg-slate-600/50 transition-colors flex items-center gap-1"
              >
                <Calendar size={12} />
                {formatExerciseTime(exercise.exerciseTime, lang === Language.CN ? 'cn' : 'en').time}
              </button>
            )}
            
            {/* Note Button */}
            <button 
              onClick={() => onToggleNote(exerciseName)}
              className={`p-2 rounded-xl transition-all active:scale-90 ${hasNote ? 'text-amber-400 bg-amber-400/10' : 'text-slate-600 hover:text-slate-400'}`}
            >
              <StickyNote size={18} />
            </button>
          </div>

          {/* Settings & Delete */}
          <div className="flex items-center gap-1">
            <button 
              onClick={() => onOpenMetricModal(exerciseName)}
              className="p-2 rounded-xl text-slate-600 hover:text-blue-400 bg-slate-800/50 active:scale-90 transition-all"
            >
              <SettingsIcon size={18} />
            </button>
            <button 
              onClick={() => onDeleteExercise(exIdx)} 
              className="text-slate-600 hover:text-red-500 transition-colors p-1"
            >
              <Trash2 size={20} />
            </button>
          </div>
        </div>

        {/* Note Preview */}
        {hasNote && (
          <div 
            onClick={() => onToggleNote(exerciseName)}
            className="self-start bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2 cursor-pointer hover:bg-amber-500/20 transition-colors"
          >
            <p className="text-xs text-amber-500/90 font-bold flex items-start gap-2">
              <StickyNote size={12} className="mt-0.5 flex-shrink-0" />
              {exerciseNotes[exerciseName]}
            </p>
          </div>
        )}
      </div>
      
      {/* Config Bar */}
      <div className="flex gap-2 mb-6">
        {/* Bodyweight Mode Config */}
        <div className="flex gap-2 p-1 bg-slate-900 rounded-2xl border border-slate-800">
          {(['none', 'bodyweight', 'assisted', 'weighted'] as const).map(mode => (
            <button 
              key={mode} 
              onClick={() => handleBodyweightModeChange(mode)}
              className={`px-3 py-2 rounded-xl text-[9px] font-black uppercase transition-all 
                ${exercise.instanceConfig?.bodyweightMode === mode ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-600 hover:text-slate-400'}`}
            >
              {mode === 'none' ? (lang === Language.CN ? '器械' : 'Weight') :
               mode === 'bodyweight' ? (lang === Language.CN ? '自重' : 'Bodyweight') :
               mode === 'assisted' ? (lang === Language.CN ? '辅助' : 'Assisted') :
               (lang === Language.CN ? '负重' : 'Weighted')}
            </button>
          ))}
        </div>

        {/* Pyramid Toggle */}
        <button 
          onClick={handleTogglePyramid}
          className={`px-3 py-2 rounded-xl text-[9px] font-black uppercase transition-all border
            ${isPyramid ? 'bg-purple-600 text-white border-purple-500' : 'bg-slate-900 text-slate-600 border-slate-700 hover:text-slate-400'}`}
        >
          {lang === Language.CN ? '递增递减组' : 'Pyramid Sets'}
        </button>
      </div>

      {/* Sub-mode Selection (for bodyweight modes) */}
      {isBodyweight && (
        <div className="flex gap-2 mb-6 p-1 bg-slate-900 rounded-2xl border border-slate-800">
          {(['normal', 'weighted', 'assisted'] as BodyweightMode[]).map(mode => (
            <button 
              key={mode} 
              onClick={() => handleSubModeChange(mode)}
              className={`flex-1 py-2 rounded-xl text-[9px] font-black uppercase transition-all 
                ${exercise.sets[0]?.bodyweightMode === mode ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-600'}`}
            >
              {translations[`mode${mode.charAt(0).toUpperCase() + mode.slice(1)}` as keyof typeof translations][lang]}
            </button>
          ))}
        </div>
      )}

      {/* Set Header */}
      <div 
        className="grid gap-2 items-center px-4 mb-3 text-[10px] font-black uppercase text-slate-500 tracking-widest mt-4"
        style={{ 
          gridTemplateColumns: `35px repeat(${activeMetrics.length}, 1fr) 35px` 
        }}
      >
        <span className="pl-1">#</span>
        {activeMetrics.map(m => (
          <div key={m} className="flex flex-col items-center leading-tight">
            <span>{translations[m as keyof typeof translations]?.[lang] || m.replace('custom_', '')}</span>
            <span className="text-[7px] opacity-40 lowercase">{getUnitTag(m, unit)}</span>
          </div>
        ))}
        <span></span>
      </div>

      {/* Sets */}
      <div className="space-y-4">
        {exercise.sets.map((set, setIdx) => (
          <SetCapsule
            key={set.id}
            set={set}
            setIdx={setIdx}
            activeMetrics={activeMetrics}
            unit={unit}
            onUpdate={(updates) => onSetUpdate(exIdx, setIdx, updates)}
            onRemove={() => onRemoveSet(exIdx, setIdx)}
            onDurationClick={() => handleDurationClick(setIdx)}
          />
        ))}
      </div>

      {/* Add Set Button */}
      <button
        onClick={() => onAddSet(exIdx)}
        className="w-full mt-4 py-3 rounded-2xl border-2 border-dashed border-slate-700/50 text-slate-600 hover:text-blue-400 hover:border-blue-500/50 transition-all text-sm font-bold"
      >
        + {lang === Language.CN ? '添加组' : 'Add Set'}
      </button>
    </div>
  );
};

// Helper function to format exercise time
function formatExerciseTime(timestamp: number, locale: string): { time: string; date: string } {
  const date = new Date(timestamp);
  return {
    time: date.toLocaleTimeString(locale === 'cn' ? 'zh-CN' : 'en-US', { hour: '2-digit', minute: '2-digit' }),
    date: date.toLocaleDateString(locale === 'cn' ? 'zh-CN' : 'en-US', { month: 'short', day: 'numeric' }),
  };
}

export default ExerciseCard;
