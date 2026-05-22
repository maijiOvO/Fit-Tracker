/**
 * 全屏动作库
 */
import React from 'react';
import { X } from 'lucide-react';
import { ExerciseDefinition, Language } from '../../../types';
import { ExercisePicker } from '../ExercisePicker';
import { ExerciseCategory } from '../../constants/exercises';
import type { CustomTag } from '../../contexts/ExercisePrefsContext';

interface LibraryModalProps {
  open: boolean;
  /** 是否处于"选择动作"模式（计划编辑器从 library 拉动作） */
  pickMode: boolean;
  lang: Language;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  activeLibraryCategory: ExerciseCategory | null;
  setActiveLibraryCategory: (c: ExerciseCategory | null) => void;
  selectedTags: string[];
  setSelectedTags: React.Dispatch<React.SetStateAction<string[]>>;
  filteredExercises: ExerciseDefinition[];
  customTags: CustomTag[];
  starredExercises: Record<string, number>;
  recentExerciseNames: string[];
  getTagName: (id: string) => string;
  resolveName: (name: string) => string;
  isEditingTags: boolean;
  onToggleEditingTags: () => void;
  onClose: () => void;
  onPickExercise: (ex: ExerciseDefinition) => void;
  onCreateCustomExercise: (prefilled?: string) => void;
  onCreateCustomTag: (category: 'bodyPart' | 'equipment') => void;
  onEditExerciseTags: (ex: ExerciseDefinition) => void;
  onRenameTag: (id: string, name: string) => void;
  onDeleteTag: (id: string) => void;
  onRenameExercise: (id: string, name: string) => void;
  onDeleteLibraryExercise: (id: string) => void;
  onToggleStar: (name: string) => void;
}

export const LibraryModal: React.FC<LibraryModalProps> = ({
  open,
  pickMode,
  lang,
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
  getTagName,
  resolveName,
  isEditingTags,
  onToggleEditingTags,
  onClose,
  onPickExercise,
  onCreateCustomExercise,
  onCreateCustomTag,
  onEditExerciseTags,
  onRenameTag,
  onDeleteTag,
  onRenameExercise,
  onDeleteLibraryExercise,
  onToggleStar,
}) => {
  if (!open) return null;
  const isCn = lang === Language.CN;
  return (
    <div className="fixed inset-0 z-[100] bg-base flex flex-col animate-in fade-in">
      <div className="flex-shrink-0 flex items-center justify-between px-4 py-3 border-b border-divider">
        <h2 className="text-lg font-semibold text-primary">
          {pickMode
            ? isCn
              ? '选择动作'
              : 'Pick Exercise'
            : isCn
              ? '动作库'
              : 'Exercise Library'}
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="w-11 h-11 flex items-center justify-center rounded-xl hover:bg-card-hover active:scale-90 transition-all"
          aria-label={isCn ? '关闭' : 'Close'}
        >
          <X size={24} className="text-secondary" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-4 pb-10 custom-scrollbar">
        <ExercisePicker
          variant="modal"
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
          onToggleEditingTags={onToggleEditingTags}
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
    </div>
  );
};

export default LibraryModal;
