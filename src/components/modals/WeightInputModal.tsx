import React from 'react';
import { Scale, X } from 'lucide-react';
import { Language } from '../../../types';
import { translations } from '../../../translations';

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
  if (!open) return null;
  const isCn = lang === Language.CN;
  return (
    <div className="fixed inset-0 z-[70] bg-base/80 backdrop-blur-md flex items-center justify-center p-6 animate-in fade-in">
      <div className="bg-inset border border-divider w-full max-sm rounded-card p-8 space-y-6 shadow-2xl">
        <div className="flex justify-between items-center">
          <h2 className="text-2xl font-semibold">
            {editingWeightId
              ? isCn
                ? '编辑体重记录'
                : 'Edit Weight Entry'
              : translations.logWeight[lang]}
          </h2>
          <button onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        <div className="space-y-4">
          <div className="relative group">
            <Scale
              className="absolute left-6 top-1/2 -translate-y-1/2 text-secondary group-focus-within:text-accent"
              size={24}
            />
            <input
              type="number"
              step="0.1"
              className="w-full bg-card border border-divider rounded-2xl py-6 pl-16 pr-20 text-2xl font-semibold outline-none focus:ring-2 focus:ring-blue-500"
              value={weightInputValue}
              onChange={e => setWeightInputValue(e.target.value)}
              placeholder="0.0"
              autoFocus
            />
            <span className="absolute right-6 top-1/2 -translate-y-1/2 text-secondary font-semibold text-xl uppercase">
              {unit}
            </span>
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

export default WeightInputModal;
