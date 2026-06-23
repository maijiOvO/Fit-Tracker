/**
 * 新建 / 编辑训练页（从 App.tsx 抽出，减轻主文件体积）
 */
import React, { RefObject } from 'react';
import {
  ArrowLeft,
  Flag,
  X,
  Scale,
} from 'lucide-react';
import {
  Exercise,
  ExerciseDefinition,
  Language,
  WorkoutSession,
} from '../../types';
import { translations } from '../../translations';
import { ExerciseCard } from './ExerciseCard';
import { ExercisePicker } from './ExercisePicker';
import { ExerciseCategory } from '../constants/exercises';

export interface NewWorkoutTabProps {
  lang: Language;
  unit: string;
  currentWorkout: WorkoutSession;
  setCurrentWorkout: (w: WorkoutSession) => void;
  editingWorkoutId: string | null;
  hasUnsavedChanges: boolean;
  saveStatus: 'idle' | 'saving' | 'saved' | 'error';
  previousTab: string;
  exerciseNotes: Record<string, string>;
  exercisePickerRef: RefObject<HTMLDivElement | null>;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  activeLibraryCategory: ExerciseCategory | null;
  setActiveLibraryCategory: (c: ExerciseCategory | null) => void;
  selectedTags: string[];
  setSelectedTags: (tags: string[]) => void;
  filteredExercises: ExerciseDefinition[];
  customTags: {
    id: string;
    name: string;
    category: 'bodyPart' | 'equipment';
    parentCategory?: ExerciseCategory;
  }[];
  starredExercises: Record<string, number>;
  recentExerciseNames: string[];
  isEditingTags: boolean;
  setIsEditingTags: React.Dispatch<React.SetStateAction<boolean>>;
  getTagName: (tid: string) => string;
  resolveName: (name: string) => string;
  getActiveMetrics: (name: string) => string[];
  isBodyweightMode: (ex: Exercise) => boolean;
  isPyramidEnabled: (ex: Exercise) => boolean;
  onBack: () => void;
  onSave: () => void;
  onPickExercise: (ex: ExerciseDefinition) => void;
  onCreateCustomExercise: (prefilled?: string) => void;
  onCreateCustomTag: (category: 'bodyPart' | 'equipment') => void;
  onEditExerciseTags: (ex: ExerciseDefinition) => void;
  onRenameTag: (id: string, name: string) => void;
  onDeleteTag: (id: string) => void;
  onRenameExercise: (id: string, name: string) => void;
  onDeleteLibraryExercise: (id: string) => void;
  onToggleStar: (name: string) => void;
  onOpenTimePicker: (exIdx: number, setIdx: number, seconds: number) => void;
  onToggleNote: (name: string) => void;
  onOpenMetricModal: (name: string) => void;
  onDeleteExerciseFromSession: (exIdx: number) => void;
  /** 编辑模式下触发日期选择器（仅 editingWorkoutId 非空时显示日期区域） */
  onChangeDate?: () => void;
}

export const NewWorkoutTab: React.FC<NewWorkoutTabProps> = ({
  lang,
  unit,
  currentWorkout,
  setCurrentWorkout,
  editingWorkoutId,
  hasUnsavedChanges,
  saveStatus,
  exerciseNotes,
  exercisePickerRef,
  searchQuery,
  setSearchQuery,
  activeLibraryCategory,
  setActiveLibraryCategory,
  selectedTags,
  setSelectedTags,
  filteredExercises,
  customTags,
  starredExercises,
  recentExerciseNames,
  isEditingTags,
  setIsEditingTags,
  getTagName,
  resolveName,
  getActiveMetrics,
  isBodyweightMode,
  isPyramidEnabled,
  onBack,
  onSave,
  onPickExercise,
  onCreateCustomExercise,
  onCreateCustomTag,
  onEditExerciseTags,
  onRenameTag,
  onDeleteTag,
  onRenameExercise,
  onDeleteLibraryExercise,
  onToggleStar,
  onOpenTimePicker,
  onToggleNote,
  onOpenMetricModal,
  onDeleteExerciseFromSession,
  onChangeDate,
}) => {
  const isCn = lang === Language.CN;

  return (
    <div className="animate-in slide-in-from-bottom-5">
      <div className="sticky top-0 -mx-4 md:-mx-8 px-4 md:px-8 py-3 bg-base/95 backdrop-blur-md z-30 border-b border-divider mb-4">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onBack}
            className="w-11 h-11 flex-shrink-0 inline-flex items-center justify-center bg-card/60 border border-divider rounded-2xl text-primary hover:bg-card active:scale-90 transition-all"
            aria-label={isCn ? '返回' : 'Back'}
          >
            <ArrowLeft size={18} />
          </button>

          <div className="flex-1 min-w-0 space-y-1">
            <div className="flex items-center gap-2 text-[10px] font-bold text-tertiary uppercase tracking-[0.15em]">
              <span>
                {editingWorkoutId
                  ? (isCn ? '编辑训练' : 'Edit Workout')
                  : (isCn ? '新建训练' : 'New Workout')}
              </span>
              {editingWorkoutId && currentWorkout.date && (
                <button
                  type="button"
                  onClick={onChangeDate}
                  className="normal-case tracking-normal text-tertiary/80 hover:text-accent transition-colors inline-flex items-center gap-1"
                  title={isCn ? '修改训练日期' : 'Change workout date'}
                >
                  ·{' '}
                  {new Date(currentWorkout.date).toLocaleDateString(
                    isCn ? 'zh-CN' : 'en-US',
                    { month: 'numeric', day: 'numeric', weekday: 'short' },
                  )}
                </button>
              )}
              <span className="ml-auto normal-case tracking-normal text-tertiary flex items-center gap-1">
                <Scale size={10} />
                {unit}
              </span>
              {hasUnsavedChanges && (
                <span className="inline-flex items-center gap-1 text-orange-400 normal-case">
                  <span className="w-1.5 h-1.5 rounded-full bg-orange-400 animate-pulse" />
                  {isCn ? '未保存' : 'Unsaved'}
                </span>
              )}
            </div>
            <input
              className="w-full bg-transparent text-base font-bold text-primary outline-none placeholder:text-tertiary/60 min-h-[36px]"
              value={currentWorkout.title}
              onChange={e =>
                setCurrentWorkout({ ...currentWorkout, title: e.target.value })
              }
              placeholder={translations.trainingTitlePlaceholder[lang]}
            />
          </div>

          <button
            type="button"
            onClick={() => {
              console.log('[DEBUG] NewWorkoutTab 按钮 onClick 触发, saveStatus=', saveStatus, 'exercises.length=', currentWorkout.exercises?.length);
              onSave();
            }}
            disabled={saveStatus === 'saving' || !(currentWorkout.exercises?.length)}
            className={`min-h-[44px] px-4 rounded-2xl font-bold text-sm flex-shrink-0 flex items-center gap-2 transition-all active:scale-95 ${
              saveStatus === 'saving'
                ? 'bg-tertiary/30 text-tertiary cursor-not-allowed'
                : saveStatus === 'saved'
                  ? 'bg-green-600 text-white shadow-md shadow-green-600/30'
                  : saveStatus === 'error'
                    ? 'bg-red-600 text-white'
                    : !(currentWorkout.exercises?.length)
                      ? 'bg-card/40 text-tertiary cursor-not-allowed'
                      : 'bg-accent text-white shadow-md shadow-blue-600/30 hover:opacity-90'
            }`}
          >
            {saveStatus === 'saving' ? (
              <>
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                <span>{isCn ? '结束中' : 'Ending'}</span>
              </>
            ) : saveStatus === 'saved' ? (
              <>
                <Flag size={16} strokeWidth={3} />
                <span>{isCn ? '已结束' : 'Ended'}</span>
              </>
            ) : saveStatus === 'error' ? (
              <>
                <X size={16} strokeWidth={3} />
                <span>{isCn ? '失败' : 'Failed'}</span>
              </>
            ) : (
              <>
                <Flag size={16} strokeWidth={3} />
                <span>{isCn ? '结束训练' : 'End Workout'}</span>
              </>
            )}
          </button>
        </div>
      </div>

      <div className="space-y-6">
        {currentWorkout.exercises?.map((ex, exIdx) => (
          <ExerciseCard
            key={ex.id}
            exercise={ex}
            exIdx={exIdx}
            lang={lang}
            unit={unit}
            isBodyweight={isBodyweightMode(ex)}
            isPyramid={isPyramidEnabled(ex)}
            exerciseNotes={exerciseNotes}
            getActiveMetrics={getActiveMetrics}
            resolveName={resolveName}
            onUpdateExercise={(idx, updates) => {
              const exs = [...currentWorkout.exercises!];
              exs[idx] = { ...exs[idx], ...updates };
              setCurrentWorkout({ ...currentWorkout, exercises: exs });
            }}
            onDeleteExercise={onDeleteExerciseFromSession}
            onOpenTimePicker={onOpenTimePicker}
            onToggleNote={onToggleNote}
            onOpenMetricModal={onOpenMetricModal}
            onSetUpdate={(eIdx, setIdx, updates) => {
              const exs = [...currentWorkout.exercises!];
              exs[eIdx].sets[setIdx] = { ...exs[eIdx].sets[setIdx], ...updates };
              setCurrentWorkout({ ...currentWorkout, exercises: exs });
            }}
            onAddSet={idx => {
              const exs = [...currentWorkout.exercises!];
              const currentSets = exs[idx].sets;
              const lastSet =
                currentSets.length > 0 ? currentSets[currentSets.length - 1] : null;
              const newSet = lastSet
                ? { ...lastSet, id: Date.now().toString() }
                : { id: Date.now().toString(), weight: 0, reps: 0 };
              exs[idx].sets.push(newSet);
              setCurrentWorkout({ ...currentWorkout, exercises: exs });
            }}
            onRemoveSet={(eIdx, setIdx) => {
              const exs = [...currentWorkout.exercises!];
              exs[eIdx].sets = exs[eIdx].sets.filter((_, i) => i !== setIdx);
              setCurrentWorkout({ ...currentWorkout, exercises: exs });
            }}
          />
        ))}

        <div className="space-y-6 mt-6 pb-10">
          <div className="flex items-center gap-3 px-2">
            <div className="h-[1px] flex-1 bg-card" />
            <h3 className="text-[10px] font-semibold text-secondary uppercase tracking-[0.2em]">
              {isCn ? '添加动作' : 'Add Exercises'}
            </h3>
            <div className="h-[1px] flex-1 bg-card" />
          </div>

          <div
            ref={exercisePickerRef}
            className="bg-card border border-divider p-4 rounded-card scroll-mt-24"
          >
            <ExercisePicker
              variant="embedded"
              lang={lang}
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              activeCategory={activeLibraryCategory}
              onCategoryChange={cat => {
                setActiveLibraryCategory(cat);
                setSelectedTags([]);
              }}
              selectedTags={selectedTags}
              onSelectedTagsChange={setSelectedTags}
              filteredExercises={filteredExercises}
              customTags={customTags}
              starredExercises={starredExercises}
              recentExerciseNames={recentExerciseNames}
              getTagName={getTagName}
              resolveName={resolveName}
              isEditingTags={isEditingTags}
              onToggleEditingTags={() => setIsEditingTags(v => !v)}
              onPickExercise={onPickExercise}
              onCreateCustomExercise={onCreateCustomExercise}
              onCreateCustomTag={onCreateCustomTag}
              onEditExerciseTags={onEditExerciseTags}
              onRenameTag={onRenameTag}
              onDeleteTag={onDeleteTag}
              onRenameExercise={onRenameExercise}
              onDeleteExercise={onDeleteLibraryExercise}
              onToggleStar={onToggleStar}
            />
          </div>

          {(currentWorkout.exercises?.length ?? 0) > 0 && (
            <div className="text-center text-xs text-tertiary pt-2">
              {currentWorkout.exercises!.length}{' '}
              {isCn ? '个动作' : 'exercises'} ·{' '}
              {currentWorkout.exercises!.reduce(
                (s, ex) => s + (ex.sets?.length || 0),
                0,
              )}{' '}
              {isCn ? '组' : 'sets'}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default NewWorkoutTab;
