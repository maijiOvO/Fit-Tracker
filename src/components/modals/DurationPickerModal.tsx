/**
 * 时长（H / M / S）选择器：用于设置某一组动作的持续时间。
 * 数字本身是输入框（2026-10-11）：以前只有 ±1 的箭头，设 1:30 要点 32 下；现在点进去直接打，箭头保留。
 */
import React, { useEffect, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { Language } from '../../../types';
import { translations } from '../../../translations';
import { secondsToHMS } from '../../utils/format';
import { Modal, ModalFooter } from '../Modal';
import { ScrubNumber } from '../ScrubNumber';

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

  /**
   * wrap：箭头走到头回绕的值；max：打字的上限。分、秒打字放到 999（上架审查 C39）：原来上限 59，
   * 打 90 秒、75 分钟直接点确定会被静默夹成 59。确定时本来就按总秒数算，下次打开 secondsToHMS 会折回 01:30。
   */
  const columns: Array<{ label: string; key: 'h' | 'm' | 's'; wrap: number; max: number }> = [
    { label: isCn ? '时' : 'Hour', key: 'h', wrap: 23, max: 23 },
    { label: isCn ? '分' : 'Min', key: 'm', wrap: 59, max: 999 },
    { label: isCn ? '秒' : 'Sec', key: 's', wrap: 59, max: 999 },
  ];
  /** 箭头之前先把超过 59 的格子折算进上一格，再按 wrap 走一格 */
  const stepCol = (key: 'h' | 'm' | 's', wrap: number, d: 1 | -1) =>
    setTempHMS(p => {
      const n = p.m > 59 || p.s > 59 ? secondsToHMS(p.h * 3600 + p.m * 60 + p.s) : p;
      const v = n[key] + d;
      return { ...n, [key]: v > wrap ? 0 : v < 0 ? wrap : v };
    });

  return (
    <Modal
      isOpen={open}
      onClose={onClose}
      title={isCn ? '设置时长' : 'Set duration'}
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
      <div className="flex justify-around items-center gap-4" data-duration-fields>
          {columns.map(col => (
            <div key={col.key} className="flex flex-col items-center gap-4 flex-1">
              <button
                onClick={() => stepCol(col.key, col.wrap, 1)}
                className="w-full py-4 bg-card rounded-card flex justify-center text-accent active:bg-accent-ink active:text-on-accent transition-ui"
              >
                <ChevronUp size={28} strokeWidth={3} />
              </button>

              <div className="flex flex-col items-center">
                <ScrubNumber
                  value={tempHMS[col.key]}
                  onCommit={n => setTempHMS(p => ({ ...p, [col.key]: Math.floor(n ?? 0) }))}
                  live
                  min={0}
                  max={col.max}
                  steps={[1, 5, 10]}
                  decimals={0}
                  pad={2}
                  inputMode="numeric"
                  enterKeyHint={col.key === 's' ? 'done' : 'next'}
                  inputClassName="w-16 text-center text-4xl font-semibold text-primary tabular-nums focus:text-accent"
                  ariaLabel={col.label}
                  testId={`duration-${col.key}`}
                  onKeyDown={e => {
                    if (e.key !== 'Enter') return;
                    e.preventDefault();
                    const box = e.currentTarget.closest('[data-duration-fields]');
                    const inputs: HTMLInputElement[] = box ? Array.prototype.slice.call(box.querySelectorAll('input')) : [];
                    const next = inputs[inputs.indexOf(e.currentTarget) + 1];
                    if (next) next.focus();
                    else e.currentTarget.blur();
                  }}
                />
                <span className="text-micro font-bold text-tertiary  mt-1">
                  {col.label}
                </span>
              </div>

              <button
                onClick={() => stepCol(col.key, col.wrap, -1)}
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
