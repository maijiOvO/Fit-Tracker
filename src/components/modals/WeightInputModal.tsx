import React from 'react';
import { Scale } from 'lucide-react';
import { Language } from '../../../types';
import { translations } from '../../../translations';
import { Modal, ModalFooter } from '../Modal';

interface WeightInputModalProps {
  open: boolean;
  lang: Language;
  unit: 'kg' | 'lbs';
  weightInputValue: string;
  setWeightInputValue: (v: string) => void;
  editingWeightId: string | null;
  onClose: () => void;
  onSubmit: () => void;
}

export const WeightInputModal: React.FC<WeightInputModalProps> = ({
  open,
  lang,
  unit,
  weightInputValue,
  setWeightInputValue,
  editingWeightId,
  onClose,
  onSubmit,
}) => {
  const isCn = lang === Language.CN;
  return (
    <Modal
      isOpen={open}
      onClose={onClose}
      title={editingWeightId ? (isCn ? '编辑体重记录' : 'Edit Weight Entry') : translations.logWeight[lang]}
      size="sm"
      dismissOnScrim={false}
      footer={
        <ModalFooter
          cancelLabel={isCn ? '取消' : 'Cancel'}
          confirmLabel={translations.confirm[lang]}
          onCancel={onClose}
          onConfirm={onSubmit}
          confirmDisabled={!weightInputValue.trim()}
        />
      }
    >
      {/* 体重是「数据」，走 data-md 等宽而不是普通输入框字号（§3） */}
      <label className="ledger-field justify-start gap-3 px-4 py-3 bg-inset border border-divider rounded-control">
        <Scale size={20} strokeWidth={1.75} className="text-tertiary flex-shrink-0 self-center" />
        <input
          type="number"
          step="0.1"
          inputMode="decimal"
          className="ledger-input text-left flex-1"
          value={weightInputValue}
          onChange={e => setWeightInputValue(e.target.value)}
          placeholder="0.0"
          autoFocus
        />
        <span className="ledger-unit self-center">{unit}</span>
      </label>
    </Modal>
  );
};

export default WeightInputModal;
