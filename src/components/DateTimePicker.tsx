/**
 * 日期时间选择器组件
 */
import React, { useState } from 'react';
import { ChevronUp, ChevronDown, X } from 'lucide-react';
import { translations } from '../translations';
import { Language } from '../types';

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
  const weekDays = lang === Language.CN ? ['日', '一', '二', '三', '四', '五', '六'] : ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

  const months = lang === Language.CN 
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
    return day === today.getDate() && 
           currentMonth === today.getMonth() && 
           currentYear === today.getFullYear();
  };

  const isSelected = (day: number) => {
    return day === selectedDate.getDate() && 
           currentMonth === selectedDate.getMonth() && 
           currentYear === selectedDate.getFullYear();
  };

  return (
    <div className="fixed inset-0 z-[80] bg-slate-950/90 backdrop-blur-md flex items-center justify-center p-6 animate-in fade-in">
      <div className="bg-slate-900 border border-slate-800 w-full max-w-md rounded-[2rem] p-6 space-y-6 shadow-2xl">
        {/* Header */}
        <div className="flex justify-between items-center">
          <h2 className="text-xl font-black">
            {lang === Language.CN ? '选择日期和时间' : 'Select Date & Time'}
          </h2>
          <button onClick={onClose} className="p-2 hover:bg-slate-800 rounded-full transition-colors">
            <X size={20} className="text-slate-400" />
          </button>
        </div>

        {/* Calendar */}
        <div className="space-y-4">
          {/* Month/Year Navigation */}
          <div className="flex items-center justify-between">
            <button 
              onClick={() => {
                if (currentMonth === 0) {
                  setCurrentMonth(11);
                  setCurrentYear(currentYear - 1);
                } else {
                  setCurrentMonth(currentMonth - 1);
                }
              }}
              className="p-2 hover:bg-slate-800 rounded-lg transition-colors"
            >
              <ChevronDown size={20} className="text-slate-400" />
            </button>
            <span className="text-lg font-bold">{currentYear} {months[currentMonth]}</span>
            <button 
              onClick={() => {
                if (currentMonth === 11) {
                  setCurrentMonth(0);
                  setCurrentYear(currentYear + 1);
                } else {
                  setCurrentMonth(currentMonth + 1);
                }
              }}
              className="p-2 hover:bg-slate-800 rounded-lg transition-colors"
            >
              <ChevronUp size={20} className="text-slate-400" />
            </button>
          </div>

          {/* Week Days */}
          <div className="grid grid-cols-7 gap-1 text-center">
            {weekDays.map((day, i) => (
              <div key={i} className="text-xs font-bold text-slate-500 py-2">{day}</div>
            ))}
          </div>

          {/* Days */}
          <div className="grid grid-cols-7 gap-1">
            {Array(firstDay).fill(null).map((_, i) => (
              <div key={`empty-${i}`} className="p-2" />
            ))}
            {Array(days).fill(null).map((_, i) => {
              const day = i + 1;
              return (
                <button
                  key={day}
                  onClick={() => {
                    const newDate = new Date(currentYear, currentMonth, day);
                    setSelectedDate(newDate);
                  }}
                  className={`p-2 text-sm font-medium rounded-xl transition-all ${
                    isSelected(day)
                      ? 'bg-blue-600 text-white'
                      : isToday(day)
                        ? 'bg-slate-700 text-white'
                        : 'hover:bg-slate-800 text-slate-300'
                  }`}
                >
                  {day}
                </button>
              );
            })}
          </div>
        </div>

        {/* Time Picker */}
        <div className="flex items-center justify-center gap-4">
          {/* Hour */}
          <div className="flex flex-col items-center space-y-2">
            <button 
              onClick={() => setSelectedHour(selectedHour === 23 ? 0 : selectedHour + 1)}
              className="p-2 hover:bg-slate-800 rounded-lg transition-colors"
            >
              <ChevronUp size={20} className="text-slate-400" />
            </button>
            <div className="bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 min-w-[60px] text-center">
              <div className="text-2xl font-bold text-white">
                {selectedHour.toString().padStart(2, '0')}
              </div>
              <div className="text-xs text-slate-500 font-bold">
                {translations.hour[lang]}
              </div>
            </div>
            <button 
              onClick={() => setSelectedHour(selectedHour === 0 ? 23 : selectedHour - 1)}
              className="p-2 hover:bg-slate-800 rounded-lg transition-colors"
            >
              <ChevronDown size={20} className="text-slate-400" />
            </button>
          </div>

          <div className="text-2xl font-bold text-slate-500">:</div>

          {/* Minute */}
          <div className="flex flex-col items-center space-y-2">
            <button 
              onClick={() => setSelectedMinute((selectedMinute + 5) % 60)}
              className="p-2 hover:bg-slate-800 rounded-lg transition-colors"
            >
              <ChevronUp size={20} className="text-slate-400" />
            </button>
            <div className="bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 min-w-[60px] text-center">
              <div className="text-2xl font-bold text-white">
                {selectedMinute.toString().padStart(2, '0')}
              </div>
              <div className="text-xs text-slate-500 font-bold">
                {translations.minute[lang]}
              </div>
            </div>
            <button 
              onClick={() => setSelectedMinute(selectedMinute === 0 ? 55 : selectedMinute - 5)}
              className="p-2 hover:bg-slate-800 rounded-lg transition-colors"
            >
              <ChevronDown size={20} className="text-slate-400" />
            </button>
          </div>
        </div>

        {/* Quick Time Options */}
        <div className="grid grid-cols-3 gap-2">
          <button 
            onClick={() => {
              const now = new Date();
              setSelectedHour(now.getHours());
              setSelectedMinute(now.getMinutes());
            }}
            className="px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-xs font-bold hover:bg-slate-700 transition-colors"
          >
            {lang === Language.CN ? '现在' : 'Now'}
          </button>
          <button 
            onClick={() => { setSelectedHour(8); setSelectedMinute(0); }}
            className="px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-xs font-bold hover:bg-slate-700 transition-colors"
          >
            {lang === Language.CN ? '早上8点' : '8:00 AM'}
          </button>
          <button 
            onClick={() => { setSelectedHour(18); setSelectedMinute(0); }}
            className="px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-xs font-bold hover:bg-slate-700 transition-colors"
          >
            {lang === Language.CN ? '晚上6点' : '6:00 PM'}
          </button>
        </div>

        {/* Actions */}
        <div className="flex gap-4">
          <button 
            onClick={onClose}
            className="flex-1 bg-slate-800 py-4 rounded-2xl font-black text-slate-400"
          >
            {lang === Language.CN ? '取消' : 'Cancel'}
          </button>
          <button 
            onClick={handleConfirm}
            className="flex-1 bg-blue-600 py-4 rounded-2xl font-black"
          >
            {lang === Language.CN ? '确定' : 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default DateTimePicker;
