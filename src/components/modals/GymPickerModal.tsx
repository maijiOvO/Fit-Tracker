/**
 * 场地选择器（§12.11）
 *
 * 候选来自历史训练（最近用过的排最前），不是 prefs 里的一张表 —— 见 src/utils/gyms.ts。
 * 选中即落定关闭：这是个一击操作，不配确认按钮。
 */
import React, { useEffect, useState } from 'react';
import { Check, MapPin, Plus } from 'lucide-react';
import { Language } from '../../../types';
import { translations } from '../../../translations';
import { Modal } from '../Modal';
import { normalizeGym } from '../../utils/gyms';

interface GymPickerModalProps {
  open: boolean;
  lang: Language;
  /** 用过的场地，最近在前 */
  options: string[];
  /** 当前场地；undefined = 未标 */
  current?: string;
  onClose: () => void;
  /** undefined 表示清掉场地 */
  onPick: (gym: string | undefined) => void;
}

export const GymPickerModal: React.FC<GymPickerModalProps> = ({
  open,
  lang,
  options,
  current,
  onClose,
  onPick,
}) => {
  const isCn = lang === Language.CN;
  const [draft, setDraft] = useState('');

  // 每次打开都从空输入开始，免得上次没提交的半截名字残留
  useEffect(() => {
    if (open) setDraft('');
  }, [open]);

  const commit = (gym: string | undefined) => {
    onPick(gym);
    onClose();
  };

  const draftGym = normalizeGym(draft);
  const isNew = !!draftGym && !options.some(o => o === draftGym);

  const row =
    'w-full min-h-[48px] px-4 flex items-center gap-3 text-left text-sm active:bg-card-hover transition-colors duration-tap ease-paper';

  return (
    <Modal
      isOpen={open}
      onClose={onClose}
      title={translations.gymPickTitle[lang] as string}
      size="sm"
      variant="sheet"
      layer="modal-2"
      bodyClassName="px-0"
      testId="gym-picker"
    >
      <div className="-mx-4">
        {options.map((g, i) => (
          <button
            key={g}
            type="button"
            className={`${row} text-primary`}
            onClick={() => commit(g)}
            data-testid={`gym-option-${i}`}
          >
            <span className="w-4 flex-shrink-0 text-accent">
              {g === current ? <Check size={14} strokeWidth={2.5} /> : null}
            </span>
            <MapPin size={13} className="flex-shrink-0 text-tertiary" strokeWidth={1.75} />
            <span className="truncate">{g}</span>
            {i === 0 && (
              <span className="ml-auto text-label text-tertiary">
                {translations.gymLastUsed[lang] as string}
              </span>
            )}
          </button>
        ))}

        {/* 清掉场地。历史记录本来就没标，这条让「标错了」有退路。 */}
        {current && (
          <button type="button" className={`${row} text-tertiary`} onClick={() => commit(undefined)}>
            <span className="w-4 flex-shrink-0" />
            <span>{translations.gymClear[lang] as string}</span>
          </button>
        )}

        <div className="border-t border-divider mt-2 px-4 pt-3 pb-1 flex items-center gap-2">
          <input
            className="ui-input flex-1"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && draftGym) commit(draftGym);
            }}
            placeholder={translations.gymNewPlaceholder[lang] as string}
            data-testid="gym-new-input"
          />
          <button
            type="button"
            disabled={!isNew}
            onClick={() => draftGym && commit(draftGym)}
            className={`min-h-[44px] px-3 rounded-card flex-shrink-0 flex items-center gap-1 text-sm font-bold transition-ui active:scale-press-sm ${
              isNew ? 'bg-accent text-on-accent' : 'bg-card/40 text-tertiary cursor-not-allowed'
            }`}
            aria-label={isCn ? '添加场地' : 'Add gym'}
          >
            <Plus size={15} strokeWidth={2.5} />
          </button>
        </div>
      </div>
    </Modal>
  );
};

export default GymPickerModal;
