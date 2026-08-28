/**
 * 通用「重命名」弹窗（标签 / 动作 复用）
 */
import React from 'react';
import { Language } from '../../../types';
import { translations } from '../../../translations';
import { Modal, ModalFooter } from '../Modal';

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
  const isCn = lang === Language.CN;
  return (
    <Modal
      isOpen={open}
      onClose={onClose}
      title={title}
      size="sm"
      // 从弹层的动作菜单里开出来，必须压在弹层之上
      layer="modal-2"
      dismissOnScrim={false}
      footer={
        <ModalFooter
          cancelLabel={isCn ? '取消' : 'Cancel'}
          confirmLabel={translations.confirm[lang]}
          onCancel={onClose}
          onConfirm={onConfirm}
          confirmDisabled={!value.trim()}
        />
      }
    >
      <input
        className="ui-input"
        value={value}
        onChange={e => setValue(e.target.value)}
        placeholder={placeholder}
        autoFocus
      />
    </Modal>
  );
};

export default RenameModal;
