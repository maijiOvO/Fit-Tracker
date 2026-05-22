/**
 * 自定义日期 + 时间选择器（用于编辑动作 exerciseTime）
 * 注意：这是一个 self-contained 组件，所有日历状态都在内部管理。
 */
import React, { useEffect, useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, X } from 'lucide-react';
import { Language } from '../../../types';
import { translations } from '../../../translations';

interface ExerciseDateTimePickerModalProps {
  open: boolean;
  lang: Language;
  initialTime?: string;
  onClose: () => void;
  onConfirm: (isoString: string) => void;
}

const getDaysInMonth = (month: number, year: number) =>
  new Date(year, month + 1, 0).getDate();

const getFirstDayOfMonth = (month: number, year: number) =>
  new Date(year, month, 1).getDay();

const isToday = (date: Date) => {
  const today = new Date();
  return (
    date.getDate() === today.getDate() &&
    date.getMonth() === today.getMonth() &&
    date.getFullYear() === today.getFullYear()
  );
};

const isSameDay = (date1: Date, date2: Date) =>
  date1.getDate() === date2.getDate() &&
  date1.getMonth() === date2.getMonth() &&
  date1.getFullYear() === date2.getFullYear();

export const ExerciseDateTimePickerModal: React.FC<ExerciseDateTimePickerModalProps> = ({
  open,
  lang,
  initialTime,
  onClose,
  onConfirm,
}) => {
  const isCn = lang === Language.CN;

  const [selectedDate, setSelectedDate] = useState(() =>
    initialTime ? new Date(initialTime) : new Date(),
  );
  const [selectedHour, setSelectedHour] = useState(
    () => new Date(initialTime || Date.now()).getHours(),
  );
  const [selectedMinute, setSelectedMinute] = useState(
    () => new Date(initialTime || Date.now()).getMinutes(),
  );
  const [currentMonth, setCurrentMonth] = useState(() =>
    (initialTime ? new Date(initialTime) : new Date()).getMonth(),
  );
  const [currentYear, setCurrentYear] = useState(() =>
    (initialTime ? new Date(initialTime) : new Date()).getFullYear(),
  );

  // 每次重新打开重置
  useEffect(() => {
    if (!open) return;
    const date = initialTime ? new Date(initialTime) : new Date();
    setSelectedDate(date);
    setSelectedHour(date.getHours());
    setSelectedMinute(date.getMinutes());
    setCurrentMonth(date.getMonth());
    setCurrentYear(date.getFullYear());
  }, [initialTime, open]);

  if (!open) return null;

  const handleConfirm = () => {
    const finalDateTime = new Date(selectedDate);
    finalDateTime.setHours(selectedHour, selectedMinute, 0, 0);
    onConfirm(finalDateTime.toISOString());
  };

  return (
    <div className="fixed inset-0 z-[70] bg-base/80 backdrop-blur-md flex items-center justify-center p-6 animate-in fade-in">
      <div className="bg-inset border border-divider w-full max-w-md rounded-card p-8 space-y-6 shadow-2xl">
        <div className="flex justify-between items-center">
          <h2 className="text-2xl font-semibold">
            {isCn ? '设置训练时间' : 'Set Exercise Time'}
          </h2>
          <button onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-xs font-bold text-secondary uppercase tracking-wider">
              {translations.selectDate[lang]}
            </label>

            <div className="flex justify-between items-center mb-4">
              <button
                onClick={() => {
                  if (currentMonth === 0) {
                    setCurrentMonth(11);
                    setCurrentYear(currentYear - 1);
                  } else {
                    setCurrentMonth(currentMonth - 1);
                  }
                }}
                className="p-2 hover:bg-card rounded-lg transition-colors"
              >
                <ChevronLeft size={20} className="text-secondary" />
              </button>

              <div className="text-lg font-bold text-white">
                {(translations.monthNames[lang] as unknown as string[])[currentMonth]}{' '}
                {currentYear}
              </div>

              <button
                onClick={() => {
                  if (currentMonth === 11) {
                    setCurrentMonth(0);
                    setCurrentYear(currentYear + 1);
                  } else {
                    setCurrentMonth(currentMonth + 1);
                  }
                }}
                className="p-2 hover:bg-card rounded-lg transition-colors"
              >
                <ChevronRight size={20} className="text-secondary" />
              </button>
            </div>

            <div className="grid grid-cols-7 gap-1 mb-2">
              {(translations.weekdayNames[lang] as unknown as string[]).map((day, idx) => (
                <div
                  key={idx}
                  className="text-center text-xs font-bold text-secondary py-2"
                >
                  {day}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-7 gap-1">
              {Array.from({ length: getFirstDayOfMonth(currentMonth, currentYear) }).map(
                (_, idx) => (
                  <div key={`empty-${idx}`} className="h-10"></div>
                ),
              )}

              {Array.from({ length: getDaysInMonth(currentMonth, currentYear) }).map(
                (_, idx) => {
                  const day = idx + 1;
                  const date = new Date(currentYear, currentMonth, day);
                  const isSelected = isSameDay(date, selectedDate);
                  const isTodayDate = isToday(date);

                  return (
                    <button
                      key={day}
                      onClick={() => setSelectedDate(date)}
                      className={`h-10 rounded-lg text-sm font-bold transition-all ${
                        isSelected
                          ? 'bg-accent text-white shadow-elevated shadow-blue-600/30'
                          : isTodayDate
                            ? 'bg-inset text-accent border border-blue-500/30'
                            : 'hover:bg-card text-primary'
                      }`}
                    >
                      {day}
                    </button>
                  );
                },
              )}
            </div>
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => {
                const today = new Date();
                setSelectedDate(today);
                setCurrentMonth(today.getMonth());
                setCurrentYear(today.getFullYear());
              }}
              className="flex-1 px-4 py-2 bg-card border border-divider rounded-xl text-sm font-bold hover:bg-card-hover transition-colors"
            >
              {translations.today[lang]}
            </button>
            <button
              onClick={() => {
                const yesterday = new Date();
                yesterday.setDate(yesterday.getDate() - 1);
                setSelectedDate(yesterday);
                setCurrentMonth(yesterday.getMonth());
                setCurrentYear(yesterday.getFullYear());
              }}
              className="flex-1 px-4 py-2 bg-card border border-divider rounded-xl text-sm font-bold hover:bg-card-hover transition-colors"
            >
              {translations.yesterday[lang]}
            </button>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold text-secondary uppercase tracking-wider">
              {translations.selectTime[lang]}
            </label>

            <div className="flex gap-4 items-center justify-center">
              <div className="flex flex-col items-center space-y-2">
                <button
                  onClick={() => setSelectedHour((selectedHour + 1) % 24)}
                  className="p-2 hover:bg-card rounded-lg transition-colors"
                >
                  <ChevronUp size={20} className="text-secondary" />
                </button>

                <div className="bg-card border border-divider rounded-xl px-4 py-3 min-w-[60px] text-center">
                  <div className="text-2xl font-bold text-white">
                    {selectedHour.toString().padStart(2, '0')}
                  </div>
                  <div className="text-xs text-secondary font-bold">
                    {translations.hour[lang]}
                  </div>
                </div>

                <button
                  onClick={() =>
                    setSelectedHour(selectedHour === 0 ? 23 : selectedHour - 1)
                  }
                  className="p-2 hover:bg-card rounded-lg transition-colors"
                >
                  <ChevronDown size={20} className="text-secondary" />
                </button>
              </div>

              <div className="text-2xl font-bold text-secondary">:</div>

              <div className="flex flex-col items-center space-y-2">
                <button
                  onClick={() => setSelectedMinute((selectedMinute + 5) % 60)}
                  className="p-2 hover:bg-card rounded-lg transition-colors"
                >
                  <ChevronUp size={20} className="text-secondary" />
                </button>

                <div className="bg-card border border-divider rounded-xl px-4 py-3 min-w-[60px] text-center">
                  <div className="text-2xl font-bold text-white">
                    {selectedMinute.toString().padStart(2, '0')}
                  </div>
                  <div className="text-xs text-secondary font-bold">
                    {translations.minute[lang]}
                  </div>
                </div>

                <button
                  onClick={() =>
                    setSelectedMinute(selectedMinute === 0 ? 55 : selectedMinute - 5)
                  }
                  className="p-2 hover:bg-card rounded-lg transition-colors"
                >
                  <ChevronDown size={20} className="text-secondary" />
                </button>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2 mt-4">
              <button
                onClick={() => {
                  const now = new Date();
                  setSelectedHour(now.getHours());
                  setSelectedMinute(now.getMinutes());
                }}
                className="px-3 py-2 bg-card border border-divider rounded-lg text-xs font-bold hover:bg-card-hover transition-colors"
              >
                {isCn ? '现在' : 'Now'}
              </button>
              <button
                onClick={() => {
                  setSelectedHour(8);
                  setSelectedMinute(0);
                }}
                className="px-3 py-2 bg-card border border-divider rounded-lg text-xs font-bold hover:bg-card-hover transition-colors"
              >
                {isCn ? '早上8点' : '8:00 AM'}
              </button>
              <button
                onClick={() => {
                  setSelectedHour(18);
                  setSelectedMinute(0);
                }}
                className="px-3 py-2 bg-card border border-divider rounded-lg text-xs font-bold hover:bg-card-hover transition-colors"
              >
                {isCn ? '晚上6点' : '6:00 PM'}
              </button>
            </div>
          </div>

          <div className="bg-card/50 border border-divider rounded-xl p-4">
            <div className="text-xs font-bold text-secondary mb-1">
              {isCn ? '选择的时间' : 'Selected Time'}
            </div>
            <div className="text-lg font-bold text-white">
              {selectedDate.getFullYear()}/
              {(selectedDate.getMonth() + 1).toString().padStart(2, '0')}/
              {selectedDate.getDate().toString().padStart(2, '0')}{' '}
              {selectedHour.toString().padStart(2, '0')}:
              {selectedMinute.toString().padStart(2, '0')}
            </div>
          </div>
        </div>

        <div className="flex gap-4">
          <button
            onClick={onClose}
            className="flex-1 bg-card py-4 rounded-2xl font-semibold text-secondary"
          >
            {isCn ? '取消' : 'Cancel'}
          </button>
          <button
            onClick={handleConfirm}
            className="flex-1 bg-accent py-4 rounded-2xl font-semibold"
          >
            {isCn ? '确定' : 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ExerciseDateTimePickerModal;
