/**
 * 通用「重命名」弹窗（标签 / 动作 复用）
 */
import React from 'react';
import { X } from 'lucide-react';
import { Language } from '../../../types';
import { translations } from '../../../translations';

interface RenameModalProps {
  open: boolean;
  lang: Language;
  title: string;
  /** 当前名称，作为 placeholder */
  placeholder?: string;
  value: string;
  setValue: (s: string) => void;
  onClose: () => void;
  onConfirm: () => void;
}

export const RenameModal: React.FC<RenameModalProps> = ({
  open,
  lang,
  title,
  placeholder,
  value,
  setValue,
  onClose,
  onConfirm,
}) => {
  if (!open) return null;
  const isCn = lang === Language.CN;
  return (
    <div className="fixed inset-0 z-[110] bg-base/90 backdrop-blur-md flex items-end sm:items-center justify-center p-0 sm:p-6 anim-fade">
      <div className="bg-inset border-t sm:border border-divider w-full sm:max-w-sm rounded-t-3xl sm:rounded-card p-6 space-y-5 shadow-2xl">
        <div className="flex justify-between items-center">
          <h2 className="text-xl font-semibold text-primary">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="w-11 h-11 flex items-center justify-center rounded-xl hover:bg-card-hover active:scale-90 transition-all"
          >
            <X size={20} className="text-secondary" />
          </button>
        </div>
        <input
          className="w-full bg-card border border-divider rounded-2xl py-4 px-6 outline-none focus:ring-2 focus:ring-accent min-h-[48px]"
          value={value}
          onChange={e => setValue(e.target.value)}
          placeholder={placeholder}
          autoFocus
        />
        <div className="flex gap-3">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 min-h-[48px] bg-card rounded-2xl font-bold text-secondary"
          >
            {isCn ? '取消' : 'Cancel'}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="flex-[2] min-h-[48px] bg-accent rounded-2xl font-bold text-on-accent active:scale-95 transition-all"
          >
            {translations.confirm[lang]}
          </button>
        </div>
      </div>
    </div>
  );
};

export default RenameModal;
