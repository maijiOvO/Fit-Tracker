import React from 'react';
import { Scale } from 'lucide-react';
import { Language } from '../../../types';
import { translations } from '../../../translations';
import { Modal, ModalFooter } from '../Modal';
import { ScrubNumber } from '../ScrubNumber';

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
        <ScrubNumber
          value={weightInputValue.trim() === '' || !Number.isFinite(Number(weightInputValue)) ? null : Number(weightInputValue)}
          onCommit={n => setWeightInputValue(n === null ? '' : String(n))}
          allowEmpty
          live
          decimals={1}
          steps={[0.1, 0.5, 1, 5]}
          placeholder="0.0"
          autoFocus
          ariaLabel={unit}
          fill
          className="flex-1"
          inputClassName="ledger-input text-left"
        />
        <span className="ledger-unit self-center">{unit}</span>
      </label>
    </Modal>
  );
};
