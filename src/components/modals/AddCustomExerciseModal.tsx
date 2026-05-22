import React from 'react';
import { X, Zap } from 'lucide-react';
import { Language } from '../../../types';
import { translations } from '../../../translations';
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
  if (!open) return null;
  const isCn = lang === Language.CN;
  return (
    <div className="fixed inset-0 z-[110] bg-base/80 backdrop-blur-md flex items-end sm:items-center justify-center p-0 sm:p-6 animate-in fade-in">
      <div className="bg-inset border-t sm:border border-divider w-full sm:max-w-md rounded-t-3xl sm:rounded-card p-6 space-y-5 shadow-2xl overflow-y-auto max-h-[90vh] custom-scrollbar">
        <div className="flex justify-between items-start gap-4">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-accent-soft rounded-xl">
              <Zap size={24} className="text-accent" />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-primary">
                {translations.addCustomExercise[lang]}
              </h2>
              <p className="text-xs text-secondary font-bold mt-0.5">
                {isCn ? '创建后将加入本次训练' : 'Will be added to this workout'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-11 h-11 flex items-center justify-center rounded-xl hover:bg-card-hover active:scale-90 transition-all"
            aria-label={isCn ? '关闭' : 'Close'}
          >
            <X size={20} className="text-secondary" />
          </button>
        </div>

        <div className="space-y-2">
          <label className="text-[10px] font-semibold text-secondary px-1">
            {isCn ? '动作名称' : 'Exercise Name'}
          </label>
          <input
            className="w-full bg-card border border-divider rounded-2xl py-4 px-6 text-primary outline-none focus:ring-2 focus:ring-blue-500 transition-all min-h-[48px]"
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
                className={`flex-1 min-h-[40px] rounded-xl text-xs font-bold transition-all ${
                  newExerciseCategory === cat
                    ? 'bg-accent text-white'
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
                className={`min-h-[40px] px-4 rounded-xl text-xs font-bold transition-all ${
                  newExerciseBodyPart === id
                    ? 'bg-accent text-white shadow-elevated'
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
                className={`min-h-[40px] px-4 rounded-xl text-xs font-bold transition-all ${
                  newExerciseTags.includes(id)
                    ? 'bg-accent text-white shadow-elevated'
                    : 'bg-card text-secondary hover:bg-card-hover'
                }`}
              >
                {getTagName(id)}
              </button>
            ))}
          </div>
        </div>

        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 min-h-[48px] py-3 rounded-2xl bg-card text-secondary font-bold hover:bg-card-hover transition-colors"
          >
            {isCn ? '取消' : 'Cancel'}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="flex-[2] min-h-[48px] py-3 rounded-2xl bg-accent text-white font-bold shadow-elevated active:scale-95 transition-all"
          >
            {translations.confirm[lang]}
          </button>
        </div>
      </div>
    </div>
  );
};

export default AddCustomExerciseModal;
