/**
 * 时长（H / M / S）选择器：用于设置某一组动作的持续时间
 */
import React, { useEffect, useState } from 'react';
import { ChevronDown, ChevronUp, X } from 'lucide-react';
import { Language } from '../../../types';
import { translations } from '../../../translations';
import { secondsToHMS } from '../../utils/format';

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
    <div className="fixed inset-0 z-[100] bg-base/90 backdrop-blur-md flex items-end sm:items-center justify-center animate-in fade-in slide-in-from-bottom-10">
      <div className="bg-inset border-t sm:border border-divider w-full max-w-md rounded-t-[3rem] sm:rounded-[3rem] p-8 shadow-2xl">
        <div className="flex justify-between items-center mb-8">
          <h2 className="text-xl font-semibold text-white">
            {isCn ? '设置时长' : 'Set Duration'}
          </h2>
          <button onClick={onClose} className="p-2 text-secondary">
            <X size={24} />
          </button>
        </div>

        <div className="flex justify-around items-center gap-4 mb-10">
          {columns.map(col => (
            <div key={col.key} className="flex flex-col items-center gap-4 flex-1">
              <button
                onClick={() =>
                  setTempHMS(p => ({
                    ...p,
                    [col.key]: p[col.key] + 1 > col.max ? 0 : p[col.key] + 1,
                  }))
                }
                className="w-full py-4 bg-card rounded-2xl flex justify-center text-accent active:bg-blue-500 active:text-white transition-all"
              >
                <ChevronUp size={28} strokeWidth={3} />
              </button>

              <div className="flex flex-col items-center">
                <span className="text-4xl font-semibold text-white tabular-nums">
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
                className="w-full py-4 bg-card rounded-2xl flex justify-center text-accent active:bg-blue-500 active:text-white transition-all"
              >
                <ChevronDown size={28} strokeWidth={3} />
              </button>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <button
            onClick={onClose}
            className="py-5 rounded-card bg-card text-secondary font-semibold"
          >
            {isCn ? '取消' : 'Cancel'}
          </button>
          <button
            onClick={() => onConfirm(tempHMS.h * 3600 + tempHMS.m * 60 + tempHMS.s)}
            className="py-5 rounded-card bg-accent text-white font-semibold shadow-xl shadow-blue-600/30"
          >
            {translations.confirm[lang]}
          </button>
        </div>
      </div>
    </div>
  );
};

export default DurationPickerModal;
