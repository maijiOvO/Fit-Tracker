/**
 * 时长（H / M / S）选择器：用于设置某一组动作的持续时间
 */
import React, { useEffect, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { Language } from '../../../types';
import { translations } from '../../../translations';
import { secondsToHMS } from '../../utils/format';
import { Modal, ModalFooter } from '../Modal';

interface DurationPickerModalProps {
  open: boolean;
  lang: Language;
  initialSeconds: number;
  onClose: () => void;
  onConfirm: (totalSeconds: number) => void;
}

export const DurationPickerModal: React.FC<DurationPickerModalProps> = ({
  open,
  lang,
  initialSeconds,
  onClose,
  onConfirm,
}) => {
  const isCn = lang === Language.CN;
  const [tempHMS, setTempHMS] = useState(() => secondsToHMS(initialSeconds || 0));

  useEffect(() => {
    if (open) setTempHMS(secondsToHMS(initialSeconds || 0));
  }, [initialSeconds, open]);

  if (!open) return null;

  const columns: Array<{ label: string; key: 'h' | 'm' | 's'; max: number }> = [
    { label: isCn ? '时' : 'Hour', key: 'h', max: 23 },
    { label: isCn ? '分' : 'Min', key: 'm', max: 59 },
    { label: isCn ? '秒' : 'Sec', key: 's', max: 59 },
  ];

  return (
    <Modal
      isOpen={open}
      onClose={onClose}
      title={isCn ? '设置时长' : 'Set Duration'}
      size="md"
      layer="modal-2"
      dismissOnScrim={false}
      footer={
        <ModalFooter
          cancelLabel={isCn ? '取消' : 'Cancel'}
          confirmLabel={translations.confirm[lang]}
          onCancel={onClose}
          onConfirm={() => onConfirm(tempHMS.h * 3600 + tempHMS.m * 60 + tempHMS.s)}
        />
      }
    >
      <div className="flex justify-around items-center gap-4">
          {columns.map(col => (
            <div key={col.key} className="flex flex-col items-center gap-4 flex-1">
              <button
                onClick={() =>
                  setTempHMS(p => ({
                    ...p,
                    [col.key]: p[col.key] + 1 > col.max ? 0 : p[col.key] + 1,
                  }))
                }
                className="w-full py-4 bg-card rounded-card flex justify-center text-accent active:bg-accent-ink active:text-on-accent transition-ui"
              >
                <ChevronUp size={28} strokeWidth={3} />
              </button>

              <div className="flex flex-col items-center">
                <span className="text-4xl font-semibold text-primary tabular-nums">
                  {tempHMS[col.key].toString().padStart(2, '0')}
                </span>
                <span className="text-[10px] font-bold text-tertiary  mt-1">
                  {col.label}
                </span>
              </div>

              <button
                onClick={() =>
                  setTempHMS(p => ({
                    ...p,
                    [col.key]: p[col.key] - 1 < 0 ? col.max : p[col.key] - 1,
                  }))
                }
                className="w-full py-4 bg-card rounded-card flex justify-center text-accent active:bg-accent-ink active:text-on-accent transition-ui"
              >
                <ChevronDown size={28} strokeWidth={3} />
              </button>
            </div>
        ))}
      </div>
    </Modal>
  );
};

export default DurationPickerModal;
