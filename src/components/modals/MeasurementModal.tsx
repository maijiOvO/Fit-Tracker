import React from 'react';
import { Language } from '../../../types';
import { translations } from '../../../translations';
import type { MeasurementForm } from '../../hooks/useMeasurementLog';
import { Modal, ModalFooter } from '../Modal';

interface MeasurementModalProps {
  open: boolean;
  lang: Language;
  editingMeasurementId: string | null;
  measureForm: MeasurementForm;
  setMeasureForm: (form: MeasurementForm) => void;
  onClose: () => void;
  onSubmit: () => void;
}

export const MeasurementModal: React.FC<MeasurementModalProps> = ({
  open,
  lang,
  editingMeasurementId,
  measureForm,
  setMeasureForm,
  onClose,
  onSubmit,
}) => {
  const isCn = lang === Language.CN;
  // §3 排印铁律：中文永远 letter-spacing: 0、永不 uppercase，
  // 所以这里的标签不再是 uppercase tracking-wider 那一套
  const label = 'block text-label font-medium text-secondary mb-1.5';
  return (
    <Modal
      isOpen={open}
      onClose={onClose}
      title={
        editingMeasurementId
          ? isCn ? '修改记录' : 'Edit Entry'
          : isCn ? '记录身体指标' : 'Track Metric'
      }
      size="sm"
      dismissOnScrim={false}
      footer={
        <ModalFooter
          cancelLabel={isCn ? '取消' : 'Cancel'}
          confirmLabel={translations.confirm[lang]}
          onCancel={onClose}
          onConfirm={onSubmit}
          confirmDisabled={!measureForm.name.trim() || !measureForm.value.trim()}
        />
      }
    >
      <div className="space-y-4">
        <div>
          <span className={label}>{isCn ? '指标名称（如：腰围）' : 'Metric Name (e.g. Waist)'}</span>
          <input
            className="ui-input"
            value={measureForm.name}
            onChange={e => setMeasureForm({ ...measureForm, name: e.target.value })}
            placeholder={isCn ? '输入名称...' : 'Enter name...'}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <span className={label}>{isCn ? '数值' : 'Value'}</span>
            <input
              type="number"
              inputMode="decimal"
              className="ui-input"
              value={measureForm.value}
              onChange={e => setMeasureForm({ ...measureForm, value: e.target.value })}
              placeholder="0.0"
            />
          </div>
          <div>
            <span className={label}>{isCn ? '单位' : 'Unit'}</span>
            <input
              className="ui-input"
              value={measureForm.unit}
              onChange={e => setMeasureForm({ ...measureForm, unit: e.target.value })}
              placeholder="cm"
            />
          </div>
        </div>
      </div>
    </Modal>
  );
};

export default MeasurementModal;
