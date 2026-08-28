import React from 'react';
import { Language } from '../../../types';
import { translations } from '../../../translations';

interface NoteModalProps {
  open: boolean;
  lang: Language;
  data: { name: string; note: string } | null;
  setData: (d: { name: string; note: string } | null) => void;
  onClose: () => void;
  onSave: () => void;
}

export const NoteModal: React.FC<NoteModalProps> = ({
  open,
  lang,
  data,
  setData,
  onClose,
  onSave,
}) => {
  if (!open || !data) return null;
  const isCn = lang === Language.CN;
  return (
    <div className="fixed inset-0 z-[80] bg-base/80 backdrop-blur-sm flex items-center justify-center p-6 anim-fade">
      <div className="bg-inset border border-divider w-full max-w-sm rounded-card p-8 shadow-2xl">
        <h3 className="text-center text-secondary font-bold mb-2 text-sm">
          {data.name}
        </h3>
        <h2 className="text-center text-2xl font-semibold text-primary mb-6">
          {isCn ? '动作备注' : 'Exercise Note'}
        </h2>

        <textarea
          className="w-full bg-base border border-divider rounded-2xl p-4 text-primary outline-none focus:border-accent transition-colors min-h-[120px] resize-none mb-6"
          placeholder={
            isCn ? '例如：座椅高度 4，宽握...' : 'E.g. Seat height 4, wide grip...'
          }
          value={data.note}
          onChange={e => setData({ ...data, note: e.target.value })}
          autoFocus
        />

        <div className="flex gap-4">
          <button
            onClick={onClose}
            className="flex-1 py-4 rounded-2xl bg-card text-secondary font-semibold hover:bg-card-hover transition-colors"
          >
            {isCn ? '取消' : 'Cancel'}
          </button>
          <button
            onClick={onSave}
            className="flex-[2] py-4 rounded-2xl bg-accent text-on-accent font-semibold hover:opacity-90 transition-all shadow-elevated active:scale-95"
          >
            {translations.confirm[lang]}
          </button>
        </div>
      </div>
    </div>
  );
};

export default NoteModal;
