import React from 'react';
import { Trash2 } from 'lucide-react';
import { Language } from '../../../types';
import { translations } from '../../../translations';

interface ResetAccountModalProps {
  open: boolean;
  lang: Language;
  resetConfirmText: string;
  setResetConfirmText: (s: string) => void;
  isResetting: boolean;
  onClose: () => void;
  /** confirm 按钮点击：内部会判断输入是否匹配 */
  onConfirmRequested: () => void;
}

export const ResetAccountModal: React.FC<ResetAccountModalProps> = ({
  open,
  lang,
  resetConfirmText,
  setResetConfirmText,
  isResetting,
  onClose,
  onConfirmRequested,
}) => {
  if (!open) return null;
  const isCn = lang === Language.CN;
  const confirmWord = isCn ? '重置' : 'RESET';

  return (
    <div className="fixed inset-0 z-[100] bg-base/90 backdrop-blur-md flex items-center justify-center p-6 anim-fade">
      <div className="bg-inset border border-divider w-full max-w-md rounded-card p-8 shadow-2xl">
        <div className="text-center mb-8">
          <div className="w-20 h-20 bg-danger/10 rounded-full flex items-center justify-center mx-auto mb-6">
            <Trash2 size={32} className="text-danger" />
          </div>
          <h2 className="text-2xl font-semibold text-primary mb-4">
            {translations.resetAccountWarning[lang]}
          </h2>
          <p className="text-sm text-secondary leading-relaxed whitespace-pre-line">
            {translations.resetAccountDesc[lang]}
          </p>
        </div>

        <div className="space-y-6">
          <div>
            <label className="block text-xs font-bold text-secondary  mb-3">
              {translations.resetConfirmText[lang]}
            </label>
            <input
              type="text"
              value={resetConfirmText}
              onChange={e => setResetConfirmText(e.target.value)}
              placeholder={translations.resetConfirmPlaceholder[lang]}
              className="w-full bg-base border border-divider rounded-2xl px-4 py-4 text-primary outline-none focus:border-danger transition-colors"
              autoFocus
            />
          </div>

          <div className="flex gap-4">
            <button
              onClick={onClose}
              className="flex-1 py-4 rounded-2xl bg-card text-secondary font-semibold hover:bg-card-hover transition-colors"
              disabled={isResetting}
            >
              {translations.resetCancel[lang]}
            </button>
            <button
              onClick={onConfirmRequested}
              disabled={isResetting || resetConfirmText !== confirmWord}
              className="flex-[2] py-4 rounded-2xl bg-danger text-on-accent font-semibold hover:opacity-90 transition-all shadow-elevated active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {isResetting ? (
                <>
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                  {translations.resetInProgress[lang]}
                </>
              ) : (
                translations.resetConfirm[lang]
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ResetAccountModal;
