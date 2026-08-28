import React from 'react';
import { X } from 'lucide-react';
import { Goal, Language } from '../../../types';
import { translations } from '../../../translations';

interface AddGoalModalProps {
  open: boolean;
  lang: Language;
  newGoal: Partial<Goal>;
  setNewGoal: React.Dispatch<React.SetStateAction<Partial<Goal>>>;
  onClose: () => void;
  onConfirm: () => void;
}

export const AddGoalModal: React.FC<AddGoalModalProps> = ({
  open,
  lang,
  newGoal,
  setNewGoal,
  onClose,
  onConfirm,
}) => {
  if (!open) return null;
  const isCn = lang === Language.CN;
  return (
    <div className="fixed inset-0 z-[70] bg-base/80 backdrop-blur-md flex items-center justify-center p-6 anim-fade">
      <div className="bg-inset border border-divider w-full max-w-sm rounded-card p-8 space-y-6 shadow-2xl">
        <div className="flex justify-between items-center">
          <h2 className="text-2xl font-semibold">{translations.setGoal[lang]}</h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-card rounded-full transition-colors"
          >
            <X size={20} className="text-secondary" />
          </button>
        </div>
        <div className="space-y-4">
          <div className="flex gap-2">
            {(['weight', 'strength', 'frequency'] as const).map(type => (
              <button
                key={type}
                onClick={() => setNewGoal({ ...newGoal, type })}
                className={`flex-1 py-3 rounded-2xl text-[10px] font-semibold uppercase transition-all ${
                  newGoal.type === type ? 'bg-accent' : 'bg-card'
                }`}
              >
                {
                  translations[
                    `goal${type.charAt(0).toUpperCase() + type.slice(1)}` as keyof typeof translations
                  ][lang]
                }
              </button>
            ))}
          </div>
          <input
            className="w-full bg-card border border-divider rounded-2xl py-4 px-6"
            value={newGoal.label || ''}
            onChange={e => setNewGoal({ ...newGoal, label: e.target.value })}
            placeholder={translations.goalLabelPlaceholder[lang]}
          />
          <div className="grid grid-cols-2 gap-4">
            <input
              type="number"
              className="bg-card border border-divider rounded-2xl py-4 px-6"
              placeholder={translations.current[lang]}
              value={newGoal.currentValue || ''}
              onChange={e =>
                setNewGoal({ ...newGoal, currentValue: Number(e.target.value) })
              }
            />
            <input
              type="number"
              className="bg-card border border-divider rounded-2xl py-4 px-6"
              placeholder={translations.target[lang]}
              value={newGoal.targetValue || ''}
              onChange={e =>
                setNewGoal({ ...newGoal, targetValue: Number(e.target.value) })
              }
            />
          </div>
        </div>
        <div className="flex gap-4">
          <button
            onClick={onClose}
            className="flex-1 bg-card py-4 rounded-2xl font-semibold text-secondary hover:bg-card-hover transition-colors"
          >
            {isCn ? '取消' : 'Cancel'}
          </button>
          <button
            onClick={onConfirm}
            className="flex-[2] bg-accent py-4 rounded-2xl font-semibold text-on-accent hover:opacity-90 transition-all shadow-elevated active:scale-95"
          >
            {translations.confirm[lang]}
          </button>
        </div>
      </div>
    </div>
  );
};

export default AddGoalModal;
