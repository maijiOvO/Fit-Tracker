/**
 * 日期时间选择器组件
 */
import React, { useState } from 'react';
import { ChevronUp, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { translations } from '../../translations';
import { Language } from '../../types';
import { getDaysInMonth, getFirstDayOfMonth, localYmd, resolvePickedDate, rotateWeekdays, stepMinute } from '../utils/dateUtils';
import { Modal, ModalFooter } from './Modal';

interface DateTimePickerProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (date: Date) => void;
  initialDate?: Date;
  lang: Language;
  /** 只调时分（动作时间）：不画月历，确定时沿用 initialDate 的年月日 */
  timeOnly?: boolean;
}

/**
 * 外壳只管开关：关着时什么都不挂，打开那一刻才挂上内层。
 * 内层的 useState 只在挂载时取初值 —— 以前整个组件常驻挂载，
 * 打开时停在 App 启动那一刻（或上一次的选择），只调分钟点确定就把旧训练挪到今天
 * （datepicker-stale-initial）。现在每次打开都从 initialDate 重新开始。
 *
 * 这个选择器只回答「什么时候练的」：未来的日子点不了，确定值晚于现在的夹到现在；
 * 和初值同一分钟就当没改，只关弹窗、不回调（resolvePickedDate，审查 C25 / C26）。
 */
export const DateTimePicker: React.FC<DateTimePickerProps> = ({ isOpen, ...rest }) => {
  if (!isOpen) return null;
  return <DateTimePickerBody {...rest} />;
};

const DateTimePickerBody: React.FC<Omit<DateTimePickerProps, 'isOpen'>> = ({
  onClose,
  onConfirm,
  initialDate = new Date(),
  lang,
  timeOnly = false,
}) => {
  const [selectedDate, setSelectedDate] = useState(initialDate);
  const [selectedHour, setSelectedHour] = useState(initialDate.getHours());
  const [selectedMinute, setSelectedMinute] = useState(initialDate.getMinutes());
  const [currentMonth, setCurrentMonth] = useState(initialDate.getMonth());
  const [currentYear, setCurrentYear] = useState(initialDate.getFullYear());

  const days = getDaysInMonth(currentMonth, currentYear);
  const firstDay = getFirstDayOfMonth(currentMonth, currentYear);
  const weekDays = rotateWeekdays(
    lang === Language.CN
      ? ['日', '一', '二', '三', '四', '五', '六']
      : ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'],
  );

  const months =
    lang === Language.CN
      ? ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月']
      : ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  const handleConfirm = () => {
    // timeOnly 时月历不画，selectedDate 一直是 initialDate：年月日沿用它
    const picked = new Date(selectedDate);
    picked.setHours(selectedHour, selectedMinute, 0, 0);
    const date = resolvePickedDate(initialDate, picked, new Date());
    if (date) onConfirm(date);
    onClose();
  };

  const now = new Date();
  const todayKey = localYmd(now);
  const keyOf = (day: number) => localYmd(new Date(currentYear, currentMonth, day));
  const isToday = (day: number) => keyOf(day) === todayKey;
  const isFuture = (day: number) => keyOf(day) > todayKey;
  const atOrAfterThisMonth = currentYear * 12 + currentMonth >= now.getFullYear() * 12 + now.getMonth();

  const isSelected = (day: number) =>
    day === selectedDate.getDate() &&
    currentMonth === selectedDate.getMonth() &&
    currentYear === selectedDate.getFullYear();

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={
        timeOnly
          ? lang === Language.CN ? '改动作时间' : 'Change exercise time'
          : lang === Language.CN ? '选择日期和时间' : 'Select date & time'
      }
      size="md"
      layer="modal-2"
      dismissOnScrim={false}
      bodyClassName="space-y-5"
      footer={
        <ModalFooter
          cancelLabel={lang === Language.CN ? '取消' : 'Cancel'}
          confirmLabel={lang === Language.CN ? '确定' : 'OK'}
          onCancel={onClose}
          onConfirm={handleConfirm}
        />
      }
    >

        {!timeOnly && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <button
              onClick={() => {
                if (currentMonth === 0) {
                  setCurrentMonth(11);
                  setCurrentYear(currentYear - 1);
                } else setCurrentMonth(currentMonth - 1);
              }}
              className="tap-44 p-2 hover:bg-inset rounded-control transition-colors"
              aria-label={lang === Language.CN ? '上个月' : 'Previous month'}
            >
              {/* 换月是左右，不是上下（审查 B13） */}
              <ChevronLeft size={20} className="text-secondary" />
            </button>
            <span className="font-semibold text-primary">
              {currentYear} {months[currentMonth]}
            </span>
            <button
              disabled={atOrAfterThisMonth}
              onClick={() => {
                if (currentMonth === 11) {
                  setCurrentMonth(0);
                  setCurrentYear(currentYear + 1);
                } else setCurrentMonth(currentMonth + 1);
              }}
              className="tap-44 p-2 hover:bg-inset rounded-control transition-colors disabled:opacity-30 disabled:hover:bg-transparent"
              aria-label={lang === Language.CN ? '下个月' : 'Next month'}
            >
              <ChevronRight size={20} className="text-secondary" />
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
                    disabled={isFuture(day)}
                    onClick={() => setSelectedDate(new Date(currentYear, currentMonth, day))}
                    className={`p-2 text-small font-mono font-medium rounded-control transition-colors tabular-nums ${
                      isSelected(day)
                        ? 'bg-accent text-on-accent'
                        : isToday(day)
                          ? 'bg-accent-soft text-accent'
                          : isFuture(day)
                            ? 'text-tertiary opacity-40'
                            : 'hover:bg-inset text-primary'
                    }`}
                  >
                    {day}
                  </button>
                );
              })}
          </div>
        </div>
        )}

        <div className="flex items-center justify-center gap-4">
          <div className="flex flex-col items-center space-y-2">
            <button
              onClick={() => setSelectedHour(selectedHour === 23 ? 0 : selectedHour + 1)}
              className="tap-44 p-2 hover:bg-inset rounded-control"
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
              className="tap-44 p-2 hover:bg-inset rounded-control"
            >
              <ChevronDown size={20} className="text-secondary" />
            </button>
          </div>

          <div className="text-2xl font-mono text-tertiary">:</div>

          <div className="flex flex-col items-center space-y-2">
            <button
              onClick={() => setSelectedMinute(stepMinute(selectedMinute, 1))}
              className="tap-44 p-2 hover:bg-inset rounded-control"
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
              onClick={() => setSelectedMinute(stepMinute(selectedMinute, -1))}
              className="tap-44 p-2 hover:bg-inset rounded-control"
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
              label: lang === Language.CN ? '早上 8 点' : '8:00 AM',
              action: () => {
                setSelectedHour(8);
                setSelectedMinute(0);
              },
            },
            {
              label: lang === Language.CN ? '晚上 6 点' : '6:00 PM',
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
