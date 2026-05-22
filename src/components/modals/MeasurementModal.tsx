import React from 'react';
import { X } from 'lucide-react';
import { Language } from '../../../types';
import { translations } from '../../../translations';
import type { MeasurementForm } from '../../hooks/useMeasurementLog';

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
  if (!open) return null;
  const isCn = lang === Language.CN;
  return (
    <div className="fixed inset-0 z-[70] bg-base/80 backdrop-blur-md flex items-center justify-center p-6 animate-in fade-in">
      <div className="bg-inset border border-divider w-full max-sm rounded-card p-8 space-y-6 shadow-2xl">
        <div className="flex justify-between items-center">
          <h2 className="text-2xl font-semibold">
            {editingMeasurementId
              ? isCn
                ? '修改记录'
                : 'Edit Entry'
              : isCn
                ? '记录身体指标'
                : 'Track Metric'}
          </h2>
          <button onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-xs font-bold text-secondary uppercase tracking-wider">
              {isCn ? '指标名称 (如: 腰围)' : 'Metric Name (e.g. Waist)'}
            </label>
            <input
              className="w-full bg-card border border-divider rounded-2xl py-4 px-6 outline-none focus:ring-2 focus:ring-blue-500"
              value={measureForm.name}
              onChange={e => setMeasureForm({ ...measureForm, name: e.target.value })}
              placeholder={isCn ? '输入名称...' : 'Enter name...'}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-xs font-bold text-secondary uppercase tracking-wider">
                {isCn ? '数值' : 'Value'}
              </label>
              <input
                type="number"
                className="w-full bg-card border border-divider rounded-2xl py-4 px-6 outline-none focus:ring-2 focus:ring-blue-500"
                value={measureForm.value}
                onChange={e => setMeasureForm({ ...measureForm, value: e.target.value })}
                placeholder="0.0"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold text-secondary uppercase tracking-wider">
                {isCn ? '单位' : 'Unit'}
              </label>
              <input
                className="w-full bg-card border border-divider rounded-2xl py-4 px-6 outline-none focus:ring-2 focus:ring-blue-500"
                value={measureForm.unit}
                onChange={e => setMeasureForm({ ...measureForm, unit: e.target.value })}
                placeholder="cm"
              />
            </div>
          </div>
        </div>
        <button
          onClick={onSubmit}
          className="w-full bg-accent py-5 rounded-2xl font-semibold text-lg shadow-xl shadow-blue-600/20 active:scale-95 transition-all"
        >
          {translations.confirm[lang]}
        </button>
      </div>
    </div>
  );
};

export default MeasurementModal;
