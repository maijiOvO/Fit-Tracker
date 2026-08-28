import React from 'react';
import { Language } from '../../../types';
import { translations } from '../../../translations';
import { Modal, ModalFooter } from '../Modal';

interface NoteModalProps {
  open: boolean;
  lang: Language;
  data: { name: string; note: string } | null;
  setData: (d: { name: string; note: string } | null) => void;
  onClose: () => void;
  onSave: () => void;
}

export const NoteModal: React.FC<NoteModalProps> = ({ open, lang, data, setData, onClose, onSave }) => {
  const isCn = lang === Language.CN;
  return (
    <Modal
      isOpen={open && !!data}
      onClose={onClose}
      title={isCn ? '动作备注' : 'Exercise Note'}
      subtitle={data?.name}
      size="sm"
      dismissOnScrim={false}
      footer={
        <ModalFooter
          cancelLabel={isCn ? '取消' : 'Cancel'}
          confirmLabel={translations.confirm[lang]}
          onCancel={onClose}
          onConfirm={onSave}
        />
      }
    >
      <textarea
        className="ui-input min-h-[120px] resize-none"
        placeholder={isCn ? '例如：座椅高度 4，宽握...' : 'E.g. Seat height 4, wide grip...'}
        value={data?.note ?? ''}
        onChange={e => data && setData({ ...data, note: e.target.value })}
        autoFocus
      />
    </Modal>
  );
};

export default NoteModal;
