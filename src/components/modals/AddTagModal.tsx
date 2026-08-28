import React from 'react';
import { Language } from '../../../types';
import { translations } from '../../../translations';
import { Modal, ModalFooter } from '../Modal';

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
  const isCn = lang === Language.CN;
  return (
    <Modal
      isOpen={open}
      onClose={onClose}
      title={translations.addCustomTag[lang]}
      size="sm"
      layer="modal-2"
      dismissOnScrim={false}
      footer={
        <ModalFooter
          cancelLabel={isCn ? '取消' : 'Cancel'}
          confirmLabel={translations.confirm[lang]}
          onCancel={onClose}
          onConfirm={onConfirm}
          confirmDisabled={!newTagName.trim()}
        />
      }
    >
      <div className="space-y-4">
        <div className="flex gap-2 p-1 bg-inset border border-divider rounded-control">
          {(['bodyPart', 'equipment'] as const).map(cat => (
            <button
              key={cat}
              type="button"
              onClick={() => setNewTagCategory(cat)}
              className={`flex-1 min-h-[40px] rounded-chip text-label font-semibold transition-colors duration-tap ease-paper ${
                newTagCategory === cat ? 'bg-accent text-on-accent' : 'text-secondary'
              }`}
            >
              {cat === 'bodyPart'
                ? translations.bodyPartHeader[lang]
                : translations.equipmentHeader[lang]}
            </button>
          ))}
        </div>
        <input
          className="ui-input"
          value={newTagName}
          onChange={e => setNewTagName(e.target.value)}
          placeholder={translations.tagNamePlaceholder[lang]}
          autoFocus
        />
      </div>
    </Modal>
  );
};

export default AddTagModal;
