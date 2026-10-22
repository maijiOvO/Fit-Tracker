/**
 * 「部位与器材」：改某个动作的属性 —— 训练类型、部位、细分、器材、阻力（2026-10-20 原「编辑标签」改成属性表）。
 * 从添加动作弹层的动作面板进来。删除不在这里（动作面板里「从动作库删除」，先执行 + 撤销）。
 * 改完点「保存」才落盘；取消不留痕。
 */
import React, { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { ExerciseDefinition, Language } from '../../types';
import { regionList } from '../utils/exerciseAttrs';
import { Modal, ModalFooter } from './Modal';
import { hasRegionSection } from './RegionChooser';
import { ExerciseAttrFields, type AttrValue } from './ExerciseAttrFields';

interface ExerciseAttrsModalProps {
  open: boolean;
  /** 已合并覆盖层的动作（equipment 已规范化） */
  exercise: ExerciseDefinition | null;
  lang: Language;
  onClose: () => void;
  onSave: (exerciseId: string, value: AttrValue) => void;
}

const fromDef = (ex: ExerciseDefinition): AttrValue => ({
  category: ex.category || 'STRENGTH',
  bodyPart: ex.bodyPart || '',
  regions: regionList(ex),
  equipment: ex.equipment ?? '',
  resistance: ex.resistance,
});

export const ExerciseAttrsModal: React.FC<ExerciseAttrsModalProps> = ({ open, exercise, lang, onClose, onSave }) => {
  const [value, setValue] = useState<AttrValue | null>(null);

  useEffect(() => {
    if (open && exercise) setValue(fromDef(exercise));
  }, [open, exercise]);

  if (!open || !exercise || !value) return null;
  const isCn = lang === Language.CN;

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={exercise.name[lang]}
      subtitle={isCn ? '部位与器材' : 'Part & gear'}
      size="md"
      // 从弹层的动作菜单里开出来，再往上一层
      layer="modal-3"
      dismissOnScrim={false}
      testId="exercise-attrs-modal"
      bodyClassName="overflow-y-auto max-h-[65vh] custom-scrollbar"
      footer={
        <ModalFooter
          cancelLabel={isCn ? '取消' : 'Cancel'}
          confirmLabel={isCn ? '保存' : 'Save'}
          onCancel={onClose}
          onConfirm={() => {
            // 部位换了、细分没跟着选：存成未细分（细分只认当前部位下的）
            onSave(exercise.id, { ...value, regions: hasRegionSection(value.bodyPart, value.category) ? value.regions : [] });
            onClose();
          }}
          confirmIcon={<Check size={16} strokeWidth={2.5} />}
        />
      }
    >
      <ExerciseAttrFields lang={lang} value={value} onChange={setValue} testId="exercise-attrs" />
    </Modal>
  );
};

export default ExerciseAttrsModal;
