/**
 * 全屏动作库
 */
import React from 'react';
import { ExerciseDefinition, Language } from '../../../types';
import { ExercisePicker } from '../ExercisePicker';
import { ExerciseCategory } from '../../constants/exercises';
import type { CustomTag } from '../../contexts/ExercisePrefsContext';
import { Modal } from '../Modal';

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
  const isCn = lang === Language.CN;
  return (
    <Modal
      isOpen={open}
      onClose={onClose}
      variant="full"
      // 它会从日程编辑器（layer=modal）里被打开，必须压在它上面。
      // 这条在 Modal portal 到 body 之后才真的成立——就地渲染时 z-index
      // 只在各自的局部层叠上下文里比较，比不出结果。
      layer="modal-2"
      testId="library-modal"
      title={pickMode ? (isCn ? '选择动作' : 'Pick Exercise') : isCn ? '动作库' : 'Exercise Library'}
    >
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
    </Modal>
  );
};

export default LibraryModal;
