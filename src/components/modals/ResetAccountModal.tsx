import React from 'react';
import { Trash2 } from 'lucide-react';
import { Language } from '../../../types';
import { translations } from '../../../translations';
import { Modal, ModalFooter } from '../Modal';

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
  const confirmWord = lang === Language.CN ? '重置' : 'RESET';
  return (
    <Modal
      isOpen={open}
      onClose={onClose}
      showCloseButton={false}
      dismissOnScrim={false}
      size="md"
      footer={
        // §6.6：这是全 App 唯一允许用 danger 实心的地方——
        // 不可逆动作，且必须先手打确认词。
        <ModalFooter
          cancelLabel={translations.resetCancel[lang]}
          confirmLabel={isResetting ? translations.resetInProgress[lang] : translations.resetConfirm[lang]}
          onCancel={onClose}
          onConfirm={onConfirmRequested}
          confirmDisabled={isResetting || resetConfirmText !== confirmWord}
          danger
          confirmIcon={
            isResetting ? (
              <span className="w-4 h-4 border-2 border-current/30 border-t-current rounded-full animate-spin" />
            ) : (
              <Trash2 size={16} strokeWidth={2} />
            )
          }
        />
      }
    >
      <div className="text-center mb-6">
        <Trash2 size={28} strokeWidth={1.75} className="text-danger mx-auto mb-4" />
        <h2 className="font-display text-h2 text-primary mb-3">
          {translations.resetAccountWarning[lang]}
        </h2>
        <p className="text-body text-secondary whitespace-pre-line">
          {translations.resetAccountDesc[lang]}
        </p>
      </div>
      <label className="block text-label font-medium text-secondary mb-1.5">
        {translations.resetConfirmText[lang]}
      </label>
      <input
        type="text"
        value={resetConfirmText}
        onChange={e => setResetConfirmText(e.target.value)}
        placeholder={translations.resetConfirmPlaceholder[lang]}
        className="ui-input"
        autoFocus
      />
    </Modal>
  );
};

export default ResetAccountModal;
