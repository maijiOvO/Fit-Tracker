import React from 'react';
import { Trash2 } from 'lucide-react';
import { Language } from '../../../types';
import { translations } from '../../../translations';
import type { MeasurementForm } from '../../hooks/useMeasurementLog';
import { localYmd } from '../../utils/dateUtils';
import { Modal, ModalFooter } from '../Modal';
import { ScrubNumber } from '../ScrubNumber';

interface MeasurementModalProps {
  open: boolean;
  lang: Language;
  editingMeasurementId: string | null;
  /** 名字写进标题、不出输入框：往已有指标里记一条、或改某一条 */
  nameFixed: boolean;
  measureForm: MeasurementForm;
  setMeasureForm: (form: MeasurementForm) => void;
  onClose: () => void;
  onSubmit: () => void;
  onDelete: () => void;
}

export const MeasurementModal: React.FC<MeasurementModalProps> = ({
  open,
  lang,
  editingMeasurementId,
  nameFixed,
  measureForm,
  setMeasureForm,
  onClose,
  onSubmit,
  onDelete,
}) => {
  const isCn = lang === Language.CN;
  // §3 排印铁律：中文永远 letter-spacing: 0、永不 uppercase，
  // 所以这里的标签不再是 uppercase tracking-wider 那一套
  const label = 'block text-label font-medium text-secondary mb-1.5';
  return (
    <Modal
      isOpen={open}
      onClose={onClose}
      // 标题说清这一下是在干什么：改哪个指标的旧记录 / 给哪个指标记一条 / 建新指标
      title={
        editingMeasurementId
          ? isCn ? `修改${measureForm.name}` : `Edit ${measureForm.name}`
          : nameFixed
            ? isCn ? `记录${measureForm.name}` : `Log ${measureForm.name}`
            : isCn ? '新指标' : 'New Metric'
      }
      testId="measure-modal"
      size="sm"
      dismissOnScrim={false}
      footer={
        <ModalFooter
          cancelLabel={isCn ? '取消' : 'Cancel'}
          confirmLabel={translations.confirm[lang]}
          onCancel={onClose}
          onConfirm={onSubmit}
          confirmDisabled={!measureForm.name.trim() || !measureForm.value.trim() || !measureForm.date}
          confirmTestId="measure-save"
        />
      }
    >
      <div className="space-y-4">
        {!nameFixed && (
          <div>
            <span className={label}>{isCn ? '指标名称' : 'Metric name'}</span>
            <input
              className="ui-input"
              value={measureForm.name}
              onChange={e => setMeasureForm({ ...measureForm, name: e.target.value })}
              placeholder={isCn ? '如：腰围' : 'e.g. Waist'}
              data-testid="measure-name"
            />
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <span className={label}>{isCn ? '数值' : 'Value'}</span>
            <ScrubNumber
              value={String(measureForm.value ?? '').trim() === '' || !Number.isFinite(Number(measureForm.value)) ? null : Number(measureForm.value)}
              onCommit={n => setMeasureForm({ ...measureForm, value: n === null ? '' : String(n) })}
              allowEmpty
              live
              decimals={1}
              steps={[0.1, 0.5, 1, 5]}
              placeholder="0.0"
              ariaLabel={isCn ? '数值' : 'Value'}
              fill
              className="ui-input"
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
        <label className="block">
          <span className={label}>{isCn ? '日期' : 'Date'}</span>
          <input
            type="date"
            className="ui-input font-mono"
            value={measureForm.date}
            max={localYmd(new Date())}
            onChange={e => setMeasureForm({ ...measureForm, date: e.target.value })}
            data-testid="measure-date"
          />
        </label>
        {/* 删除只在这里：历史列表里一行一个删除键，点偏一下就没了（2026-11-16 丢过一条） */}
        {editingMeasurementId && (
          <button
            type="button"
            onClick={onDelete}
            className="tap-44 flex items-center gap-1.5 text-small font-medium text-danger"
            data-testid="measure-delete"
          >
            <Trash2 size={14} /> {isCn ? '删除这条' : 'Delete entry'}
          </button>
        )}
      </div>
    </Modal>
  );
};
