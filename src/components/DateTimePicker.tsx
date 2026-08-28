/**
 * 日期时间选择器组件
 */
import React, { useState } from 'react';
import { ChevronUp, ChevronDown } from 'lucide-react';
import { translations } from '../../translations';
import { Language } from '../../types';
import { Modal, ModalFooter } from './Modal';

interface DateTimePickerProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (date: Date) => void;
  initialDate?: Date;
  lang: Language;
}

export const DateTimePicker: React.FC<DateTimePickerProps> = ({
  isOpen,
  onClose,
  onConfirm,
  initialDate = new Date(),
  lang,
}) => {
  const [selectedDate, setSelectedDate] = useState(initialDate);
  const [selectedHour, setSelectedHour] = useState(initialDate.getHours());
  const [selectedMinute, setSelectedMinute] = useState(initialDate.getMinutes());
  const [currentMonth, setCurrentMonth] = useState(initialDate.getMonth());
  const [currentYear, setCurrentYear] = useState(initialDate.getFullYear());

  if (!isOpen) return null;

  const getDaysInMonth = (month: number, year: number) => new Date(year, month + 1, 0).getDate();
  const getFirstDayOfMonth = (month: number, year: number) => new Date(year, month, 1).getDay();

  const days = getDaysInMonth(currentMonth, currentYear);
  const firstDay = getFirstDayOfMonth(currentMonth, currentYear);
  const weekDays =
    lang === Language.CN
      ? ['日', '一', '二', '三', '四', '五', '六']
      : ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

  const months =
    lang === Language.CN
      ? ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月']
      : ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  const handleConfirm = () => {
    const finalDate = new Date(selectedDate);
    finalDate.setHours(selectedHour, selectedMinute, 0, 0);
    onConfirm(finalDate);
    onClose();
  };

  const isToday = (day: number) => {
    const today = new Date();
    return (
      day === today.getDate() &&
      currentMonth === today.getMonth() &&
      currentYear === today.getFullYear()
    );
  };

  const isSelected = (day: number) =>
    day === selectedDate.getDate() &&
    currentMonth === selectedDate.getMonth() &&
    currentYear === selectedDate.getFullYear();

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={lang === Language.CN ? '选择日期和时间' : 'Select Date & Time'}
      size="md"
      layer="modal-2"
      dismissOnScrim={false}
      bodyClassName="space-y-5"
      footer={
        <ModalFooter
          cancelLabel={lang === Language.CN ? '取消' : 'Cancel'}
          confirmLabel={lang === Language.CN ? '确定' : 'Confirm'}
          onCancel={onClose}
          onConfirm={handleConfirm}
        />
      }
    >

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <button
              onClick={() => {
                if (currentMonth === 0) {
                  setCurrentMonth(11);
                  setCurrentYear(currentYear - 1);
                } else setCurrentMonth(currentMonth - 1);
              }}
              className="p-2 hover:bg-inset rounded-control transition-colors"
            >
              <ChevronDown size={20} className="text-secondary" />
            </button>
            <span className="font-semibold text-primary">
              {currentYear} {months[currentMonth]}
            </span>
            <button
              onClick={() => {
                if (currentMonth === 11) {
                  setCurrentMonth(0);
                  setCurrentYear(currentYear + 1);
                } else setCurrentMonth(currentMonth + 1);
              }}
              className="p-2 hover:bg-inset rounded-control transition-colors"
            >
              <ChevronUp size={20} className="text-secondary" />
            </button>
          </div>

          <div className="grid grid-cols-7 gap-1 text-center">
            {weekDays.map((day, i) => (
              <div key={i} className="text-xs font-medium text-tertiary py-2">
                {day}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1">
            {Array(firstDay)
              .fill(null)
              .map((_, i) => (
                <div key={`empty-${i}`} className="p-2" />
              ))}
            {Array(days)
              .fill(null)
              .map((_, i) => {
                const day = i + 1;
                return (
                  <button
                    key={day}
                    onClick={() => setSelectedDate(new Date(currentYear, currentMonth, day))}
                    className={`p-2 text-sm font-mono font-medium rounded-control transition-colors tabular-nums ${
                      isSelected(day)
                        ? 'bg-accent text-on-accent'
                        : isToday(day)
                          ? 'bg-accent-soft text-accent'
                          : 'hover:bg-inset text-primary'
                    }`}
                  >
                    {day}
                  </button>
                );
              })}
          </div>
        </div>

        <div className="flex items-center justify-center gap-4">
          <div className="flex flex-col items-center space-y-2">
            <button
              onClick={() => setSelectedHour(selectedHour === 23 ? 0 : selectedHour + 1)}
              className="p-2 hover:bg-inset rounded-control"
            >
              <ChevronUp size={20} className="text-secondary" />
            </button>
            <div className="bg-inset border border-divider rounded-control px-4 py-3 min-w-[60px] text-center">
              <div className="text-2xl font-mono font-medium text-primary tabular-nums">
                {selectedHour.toString().padStart(2, '0')}
              </div>
              <div className="text-xs text-tertiary">{translations.hour[lang]}</div>
            </div>
            <button
              onClick={() => setSelectedHour(selectedHour === 0 ? 23 : selectedHour - 1)}
              className="p-2 hover:bg-inset rounded-control"
            >
              <ChevronDown size={20} className="text-secondary" />
            </button>
          </div>

          <div className="text-2xl font-mono text-tertiary">:</div>

          <div className="flex flex-col items-center space-y-2">
            <button
              onClick={() => setSelectedMinute((selectedMinute + 5) % 60)}
              className="p-2 hover:bg-inset rounded-control"
            >
              <ChevronUp size={20} className="text-secondary" />
            </button>
            <div className="bg-inset border border-divider rounded-control px-4 py-3 min-w-[60px] text-center">
              <div className="text-2xl font-mono font-medium text-primary tabular-nums">
                {selectedMinute.toString().padStart(2, '0')}
              </div>
              <div className="text-xs text-tertiary">{translations.minute[lang]}</div>
            </div>
            <button
              onClick={() => setSelectedMinute(selectedMinute === 0 ? 55 : selectedMinute - 5)}
              className="p-2 hover:bg-inset rounded-control"
            >
              <ChevronDown size={20} className="text-secondary" />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2">
          {[
            {
              label: lang === Language.CN ? '现在' : 'Now',
              action: () => {
                const now = new Date();
                setSelectedHour(now.getHours());
                setSelectedMinute(now.getMinutes());
              },
            },
            {
              label: lang === Language.CN ? '早上8点' : '8:00 AM',
              action: () => {
                setSelectedHour(8);
                setSelectedMinute(0);
              },
            },
            {
              label: lang === Language.CN ? '晚上6点' : '6:00 PM',
              action: () => {
                setSelectedHour(18);
                setSelectedMinute(0);
              },
            },
          ].map(item => (
            <button
              key={item.label}
              onClick={item.action}
              className="px-3 py-2 bg-inset border border-divider rounded-chip text-xs font-medium text-secondary hover:bg-card-hover"
            >
              {item.label}
            </button>
          ))}
        </div>

    </Modal>
  );
};

export default DateTimePicker;
