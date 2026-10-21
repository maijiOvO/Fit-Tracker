import React from 'react';
import { Language } from '../../../types';
import { translations } from '../../../translations';
import { Modal, ModalFooter } from '../Modal';

/**
 * 备注弹窗的数据。标了馆的训练里打开时带 gym / gymKey / gymNote：上下两栏，上面本馆、下面通用
 * （design-plates.md「换馆重量」B）。动作库、计划里打开只有通用一栏。
 */
export interface NoteModalData {
  name: string;
  note: string;
  gym?: string;
  gymKey?: string;
  gymNote?: string;
}

interface NoteModalProps {
  open: boolean;
  lang: Language;
  data: NoteModalData | null;
  setData: (d: NoteModalData | null) => void;
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
      // 从计划编辑器的选动作弹层（modal-2）里也会打开
      layer="modal-2"
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
      {data?.gymKey ? (
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-label text-secondary">
              {isCn ? <>在 <b className="text-primary">{data.gym}</b>（只在这个馆显示）</> : <>At <b className="text-primary">{data.gym}</b> (this gym only)</>}
            </span>
            <textarea
              className="ui-input min-h-[80px] resize-none"
              placeholder={isCn ? '例如：凳子高度 3，挂钩第 5 孔' : 'E.g. Seat 3, hook on hole 5'}
              value={data.gymNote ?? ''}
              onChange={e => setData({ ...data, gymNote: e.target.value })}
              autoFocus
              data-testid="note-gym"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-label text-secondary">{isCn ? '通用（哪个馆都显示）' : 'Everywhere'}</span>
            <textarea
              className="ui-input min-h-[80px] resize-none"
              placeholder={isCn ? '例如：激活背阔，单侧重量' : 'E.g. Engage lats, weight per side'}
              value={data.note}
              onChange={e => setData({ ...data, note: e.target.value })}
              data-testid="note-general"
            />
          </label>
        </div>
      ) : (
        <textarea
          className="ui-input min-h-[120px] resize-none"
          placeholder={isCn ? '例如：座椅高度 4，宽握...' : 'E.g. Seat height 4, wide grip...'}
          value={data?.note ?? ''}
          onChange={e => data && setData({ ...data, note: e.target.value })}
          autoFocus
          data-testid="note-general"
        />
      )}
    </Modal>
  );
};

export default NoteModal;
