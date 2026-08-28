import React from 'react';
import { Zap } from 'lucide-react';
import { Language } from '../../../types';
import { translations } from '../../../translations';
import { Modal, ModalFooter } from '../Modal';
import {
  BODY_PARTS,
  EQUIPMENT_TAGS,
  ExerciseCategory,
} from '../../constants/exercises';
import type { CustomTag } from '../../contexts/ExercisePrefsContext';

interface AddCustomExerciseModalProps {
  open: boolean;
  lang: Language;
  newExerciseName: string;
  setNewExerciseName: (s: string) => void;
  newExerciseCategory: ExerciseCategory;
  setNewExerciseCategory: (cat: ExerciseCategory) => void;
  newExerciseBodyPart: string;
  setNewExerciseBodyPart: (s: string) => void;
  newExerciseTags: string[];
  setNewExerciseTags: React.Dispatch<React.SetStateAction<string[]>>;
  customTags: CustomTag[];
  getTagName: (id: string) => string;
  onClose: () => void;
  onConfirm: () => void;
}

export const AddCustomExerciseModal: React.FC<AddCustomExerciseModalProps> = ({
  open,
  lang,
  newExerciseName,
  setNewExerciseName,
  newExerciseCategory,
  setNewExerciseCategory,
  newExerciseBodyPart,
  setNewExerciseBodyPart,
  newExerciseTags,
  setNewExerciseTags,
  customTags,
  getTagName,
  onClose,
  onConfirm,
}) => {
  const isCn = lang === Language.CN;
  return (
    <Modal
      isOpen={open}
      onClose={onClose}
      title={translations.addCustomExercise[lang]}
      subtitle={isCn ? '创建后将加入本次训练' : 'Will be added to this workout'}
      size="md"
      layer="modal-2"
      dismissOnScrim={false}
      bodyClassName="overflow-y-auto max-h-[70vh] custom-scrollbar space-y-5"
      footer={
        <ModalFooter
          cancelLabel={isCn ? '取消' : 'Cancel'}
          confirmLabel={translations.confirm[lang]}
          onCancel={onClose}
          onConfirm={onConfirm}
        />
      }
    >

        <div className="space-y-2">
          <label className="text-[10px] font-semibold text-secondary px-1">
            {isCn ? '动作名称' : 'Exercise Name'}
          </label>
          <input
            className="w-full bg-card border border-divider rounded-card py-4 px-6 text-primary outline-none focus:ring-2 focus:ring-accent transition-all min-h-[48px]"
            value={newExerciseName}
            onChange={e => setNewExerciseName(e.target.value)}
            placeholder={translations.exerciseNamePlaceholder[lang]}
            autoFocus
          />
        </div>

        <div>
          <label className="text-[10px] font-semibold text-secondary px-1 mb-2 block">
            {isCn ? '训练类型' : 'Category'}
          </label>
          <div className="flex gap-2">
            {(['STRENGTH', 'CARDIO', 'FREE'] as ExerciseCategory[]).map(cat => (
              <button
                key={cat}
                type="button"
                onClick={() => setNewExerciseCategory(cat)}
                className={`flex-1 min-h-[40px] rounded-control text-xs font-bold transition-all ${
                  newExerciseCategory === cat
                    ? 'bg-accent text-on-accent'
                    : 'bg-card text-secondary hover:bg-card-hover'
                }`}
              >
                {cat === 'STRENGTH' && translations.strengthTraining[lang]}
                {cat === 'CARDIO' && translations.cardioTraining[lang]}
                {cat === 'FREE' && translations.freeTraining[lang]}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="text-[10px] font-semibold text-secondary px-1 mb-2 block">
            {translations.bodyPartHeader[lang]} · {isCn ? '单选' : 'single'}
          </label>
          <div className="flex flex-wrap gap-2">
            {[
              ...BODY_PARTS,
              ...customTags.filter(ct => ct.category === 'bodyPart').map(t => t.id),
            ].map(id => (
              <button
                key={id}
                type="button"
                onClick={() =>
                  setNewExerciseBodyPart(newExerciseBodyPart === id ? '' : id)
                }
                className={`min-h-[40px] px-4 rounded-control text-xs font-bold transition-all ${
                  newExerciseBodyPart === id
                    ? 'bg-accent text-on-accent shadow-elevated'
                    : 'bg-card text-secondary hover:bg-card-hover'
                }`}
              >
                {getTagName(id)}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="text-[10px] font-semibold text-secondary px-1 mb-2 block">
            {translations.equipmentHeader[lang]} · {isCn ? '多选' : 'multi'}
          </label>
          <div className="flex flex-wrap gap-2">
            {[
              ...EQUIPMENT_TAGS,
              ...customTags.filter(ct => ct.category === 'equipment').map(t => t.id),
            ].map(id => (
              <button
                key={id}
                type="button"
                onClick={() =>
                  setNewExerciseTags(p =>
                    p.includes(id) ? p.filter(x => x !== id) : [...p, id],
                  )
                }
                className={`min-h-[40px] px-4 rounded-control text-xs font-bold transition-all ${
                  newExerciseTags.includes(id)
                    ? 'bg-accent text-on-accent shadow-elevated'
                    : 'bg-card text-secondary hover:bg-card-hover'
                }`}
              >
                {getTagName(id)}
              </button>
            ))}
          </div>
        </div>

    </Modal>
  );
};

export default AddCustomExerciseModal;
