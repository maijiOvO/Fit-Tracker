import React from 'react';
import { Language } from '../../../types';
import { translations } from '../../../translations';
import { Modal, ModalFooter } from '../Modal';
import { ExerciseCategory } from '../../constants/exercises';
import type { Resistance } from '../../utils/exerciseAttrs';
import { ExerciseAttrFields } from '../ExerciseAttrFields';

interface AddCustomExerciseModalProps {
  open: boolean;
  lang: Language;
  newExerciseName: string;
  setNewExerciseName: (s: string) => void;
  newExerciseCategory: ExerciseCategory;
  setNewExerciseCategory: (cat: ExerciseCategory) => void;
  newExerciseBodyPart: string;
  setNewExerciseBodyPart: (s: string) => void;
  /** 器材与阻力（2026-10-20 起单选；resistance 不写 = 跟器材默认） */
  newExerciseEquip: { equipment: string; resistance?: Resistance };
  setNewExerciseEquip: (v: { equipment: string; resistance?: Resistance }) => void;
  /** 细分（第 3 条）；'' = 未细分 */
  newExerciseRegion: string;
  setNewExerciseRegion: (id: string) => void;
  /** 建好的动作加到哪：训练页弹层 / 计划编辑器的选动作弹层 */
  addsTo?: 'workout' | 'plan';
  onClose: () => void;
  onConfirm: () => void;
}

/** 新建动作：名字 + 跟「部位与器材」同一张属性表 */
export const AddCustomExerciseModal: React.FC<AddCustomExerciseModalProps> = ({
  open,
  lang,
  newExerciseName,
  setNewExerciseName,
  newExerciseCategory,
  setNewExerciseCategory,
  newExerciseBodyPart,
  setNewExerciseBodyPart,
  newExerciseEquip,
  setNewExerciseEquip,
  newExerciseRegion,
  setNewExerciseRegion,
  addsTo = 'workout',
  onClose,
  onConfirm,
}) => {
  const isCn = lang === Language.CN;
  return (
    <Modal
      isOpen={open}
      onClose={onClose}
      title={translations.addCustomExercise[lang]}
      subtitle={
        addsTo === 'plan'
          ? isCn ? '创建后将加入计划' : 'Will be added to the plan'
          : isCn ? '创建后将加入本次训练' : 'Will be added to this workout'
      }
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
          className="w-full bg-card border border-divider rounded-card py-4 px-6 text-primary outline-none focus:ring-2 focus:ring-accent transition-ui min-h-[48px]"
          value={newExerciseName}
          onChange={e => setNewExerciseName(e.target.value)}
          placeholder={translations.exerciseNamePlaceholder[lang]}
          autoFocus
        />
      </div>

      <ExerciseAttrFields
        lang={lang}
        testId="new-exercise-attrs"
        value={{
          category: newExerciseCategory,
          bodyPart: newExerciseBodyPart,
          region: newExerciseRegion,
          equipment: newExerciseEquip.equipment,
          resistance: newExerciseEquip.resistance,
        }}
        onChange={v => {
          if (v.category !== newExerciseCategory) setNewExerciseCategory(v.category);
          if (v.bodyPart !== newExerciseBodyPart) setNewExerciseBodyPart(v.bodyPart);
          if (v.region !== newExerciseRegion) setNewExerciseRegion(v.region);
          setNewExerciseEquip({ equipment: v.equipment, resistance: v.resistance });
        }}
      />
    </Modal>
  );
};

export default AddCustomExerciseModal;
