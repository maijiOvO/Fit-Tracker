import React from 'react';
import { X } from 'lucide-react';
import { Language } from '../../../types';
import { translations } from '../../../translations';

interface AddTagModalProps {
  open: boolean;
  lang: Language;
  newTagName: string;
  setNewTagName: (s: string) => void;
  newTagCategory: 'bodyPart' | 'equipment';
  setNewTagCategory: (cat: 'bodyPart' | 'equipment') => void;
  onClose: () => void;
  onConfirm: () => void;
}

export const AddTagModal: React.FC<AddTagModalProps> = ({
  open,
  lang,
  newTagName,
  setNewTagName,
  newTagCategory,
  setNewTagCategory,
  onClose,
  onConfirm,
}) => {
  if (!open) return null;
  const isCn = lang === Language.CN;
  return (
    <div className="fixed inset-0 z-[110] bg-base/80 backdrop-blur-md flex items-end sm:items-center justify-center p-0 sm:p-6 animate-in fade-in">
      <div className="bg-inset border-t sm:border border-divider w-full sm:max-w-sm rounded-t-3xl sm:rounded-card p-6 space-y-5 shadow-2xl">
        <div className="flex justify-between items-center">
          <h2 className="text-xl font-semibold text-primary">
            {translations.addCustomTag[lang]}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="w-11 h-11 flex items-center justify-center rounded-xl hover:bg-card-hover active:scale-90 transition-all"
          >
            <X size={20} className="text-secondary" />
          </button>
        </div>
        <div className="flex gap-2 p-1 bg-card rounded-xl">
          {(['bodyPart', 'equipment'] as const).map(cat => (
            <button
              key={cat}
              type="button"
              onClick={() => setNewTagCategory(cat)}
              className={`flex-1 min-h-[40px] rounded-lg text-xs font-bold transition-all ${
                newTagCategory === cat ? 'bg-accent text-white' : 'text-secondary'
              }`}
            >
              {cat === 'bodyPart'
                ? translations.bodyPartHeader[lang]
                : translations.equipmentHeader[lang]}
            </button>
          ))}
        </div>
        <input
          className="w-full bg-card border border-divider rounded-2xl py-4 px-6 outline-none focus:ring-2 focus:ring-blue-500 min-h-[48px]"
          value={newTagName}
          onChange={e => setNewTagName(e.target.value)}
          placeholder={translations.tagNamePlaceholder[lang]}
          autoFocus
        />
        <div className="flex gap-3">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 min-h-[48px] rounded-2xl bg-card text-secondary font-bold"
          >
            {isCn ? '取消' : 'Cancel'}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="flex-[2] min-h-[48px] rounded-2xl bg-accent text-white font-bold active:scale-95 transition-all"
          >
            {translations.confirm[lang]}
          </button>
        </div>
      </div>
    </div>
  );
};

export default AddTagModal;
