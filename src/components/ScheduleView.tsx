/**
 * 训练计划 -> 日程：月历 + 当日详情
 */
import React, { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Plus, Play, Trash2, Edit2, CalendarClock, Ban } from 'lucide-react';
import { ExerciseDefinition, Language, ScheduledWorkout } from '../../types';
import { translations } from '../../translations';
import { useScheduleContext } from '../contexts';
import ScheduleEditorModal from './ScheduleEditorModal';

type CustomTag = { id: string; name: string; category: 'bodyPart' | 'equipment'; parentCategory?: string };

interface ScheduleViewProps {
  lang: Language;
  unit: 'kg' | 'lbs';
  customTags: CustomTag[];
  onStartScheduledSession: (scheduleId: string) => void;
  onOpenLibraryForPicker: (onPick: (ex: ExerciseDefinition) => void) => void;
}

function toLocalISODate(d: Date): string {
  const yr = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  return `${yr}-${mo}-${da}`;
}

function buildMonthGrid(viewMonth: Date): { date: Date; inMonth: boolean }[] {
  const first = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 1);
  const startWeekDay = first.getDay(); // 0=Sun
  const startDate = new Date(first);
  startDate.setDate(first.getDate() - startWeekDay);

  const cells: { date: Date; inMonth: boolean }[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(startDate);
    d.setDate(startDate.getDate() + i);
    cells.push({ date: d, inMonth: d.getMonth() === viewMonth.getMonth() });
  }
  return cells;
}

function formatMonthLabel(d: Date, lang: Language): string {
  if (lang === Language.CN) {
    return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月`;
  }
  return d.toLocaleString('en-US', { year: 'numeric', month: 'long' });
}

function statusBadge(status: ScheduledWorkout['status'], lang: Language) {
  if (status === 'completed') {
    return { label: translations.scheduleCompleted[lang], cls: 'bg-success/15 text-success' };
  }
  if (status === 'skipped') {
    return { label: translations.scheduleSkipped[lang], cls: 'bg-tertiary/15 text-tertiary' };
  }
  return { label: translations.schedulePlanned[lang], cls: 'bg-accent-soft text-accent' };
}

const ScheduleView: React.FC<ScheduleViewProps> = ({ lang, unit, customTags, onStartScheduledSession, onOpenLibraryForPicker }) => {
  const { schedules, schedulesByDate, updateSchedule, deleteSchedule } = useScheduleContext();

  const today = useMemo(() => new Date(), []);
  const [viewMonth, setViewMonth] = useState<Date>(new Date(today.getFullYear(), today.getMonth(), 1));
  const [selectedDate, setSelectedDate] = useState<string>(toLocalISODate(today));

  const [editorOpen, setEditorOpen] = useState(false);
  const [editorTarget, setEditorTarget] = useState<ScheduledWorkout | null>(null);

  const cells = useMemo(() => buildMonthGrid(viewMonth), [viewMonth]);
  const daySchedules = schedulesByDate(selectedDate);

  const weekDays = lang === Language.CN ? ['日', '一', '二', '三', '四', '五', '六'] : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  const openNew = () => {
    setEditorTarget(null);
    setEditorOpen(true);
  };
  const openEdit = (s: ScheduledWorkout) => {
    setEditorTarget(s);
    setEditorOpen(true);
  };

  const markSkipped = async (s: ScheduledWorkout) => {
    await updateSchedule({ ...s, status: 'skipped', updatedAt: new Date().toISOString() });
  };
  const onDelete = async (s: ScheduledWorkout) => {
    const ok = window.confirm(
      lang === Language.CN ? '确定删除这条计划吗？' : 'Delete this plan?',
    );
    if (!ok) return;
    await deleteSchedule(s.id);
  };

  return (
    <div className="space-y-4">
      {/* 月份切换 */}
      <div className="flex items-center justify-between">
        <button
          aria-label="prev-month"
          onClick={() => setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1))}
          className="p-2 rounded-chip text-secondary hover:text-primary hover:bg-card-hover transition-colors"
        >
          <ChevronLeft size={18} strokeWidth={1.75} />
        </button>
        <div className="font-display text-lg text-primary tabular-nums">
          {formatMonthLabel(viewMonth, lang)}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => {
              const t = new Date();
              setViewMonth(new Date(t.getFullYear(), t.getMonth(), 1));
              setSelectedDate(toLocalISODate(t));
            }}
            className="text-xs px-2 py-1 rounded-chip border border-divider text-secondary hover:text-primary hover:bg-card-hover transition-colors"
          >
            {lang === Language.CN ? '今天' : 'Today'}
          </button>
          <button
            aria-label="next-month"
            onClick={() => setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1))}
            className="p-2 rounded-chip text-secondary hover:text-primary hover:bg-card-hover transition-colors"
          >
            <ChevronRight size={18} strokeWidth={1.75} />
          </button>
        </div>
      </div>

      {/* 月历 */}
      <div className="ui-card p-3" data-testid="month-calendar">
        <div className="grid grid-cols-7 gap-1 mb-1">
          {weekDays.map(w => (
            <div key={w} className="text-center text-[11px] text-tertiary font-medium py-1">{w}</div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {cells.map(({ date, inMonth }) => {
            const iso = toLocalISODate(date);
            const list = schedulesByDate(iso);
            const isSelected = iso === selectedDate;
            const isToday = iso === toLocalISODate(today);
            const hasPlanned = list.some(x => x.status === 'planned');
            const hasDone = list.some(x => x.status === 'completed');
            return (
              <button
                key={iso}
                onClick={() => setSelectedDate(iso)}
                data-testid={`day-${iso}`}
                className={`relative aspect-square rounded-chip text-xs font-mono transition-colors flex flex-col items-center justify-center
                  ${isSelected ? 'bg-accent text-white' : inMonth ? 'text-primary hover:bg-card-hover' : 'text-tertiary'}
                  ${isToday && !isSelected ? 'ring-1 ring-accent/60' : ''}
                `}
              >
                <span>{date.getDate()}</span>
                {list.length > 0 && (
                  <span
                    className={`mt-0.5 inline-flex gap-0.5 ${isSelected ? 'opacity-90' : ''}`}
                    aria-hidden
                  >
                    {hasPlanned && <span className="w-1 h-1 rounded-full bg-accent" />}
                    {hasDone && <span className="w-1 h-1 rounded-full bg-success" />}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* 当日详情 */}
      <div className="space-y-2" data-testid="day-detail-panel">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-secondary text-sm">
            <CalendarClock size={16} strokeWidth={1.75} />
            <span className="font-mono">{selectedDate}</span>
          </div>
          <button
            onClick={openNew}
            data-testid="schedule-add-btn"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-control bg-accent text-white text-sm font-medium hover:opacity-90 active:scale-95 transition"
          >
            <Plus size={16} strokeWidth={2} />
            {translations.scheduleAdd[lang]}
          </button>
        </div>

        {daySchedules.length === 0 ? (
          <div className="ui-card p-6 text-center text-tertiary text-sm">
            {translations.scheduleEmptyDay[lang]}
          </div>
        ) : (
          daySchedules.map(s => {
            const badge = statusBadge(s.status, lang);
            return (
              <div key={s.id} className="ui-card p-4 space-y-3" data-testid={`schedule-item-${s.id}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h4 className="font-semibold text-primary truncate">
                        {s.title || (lang === Language.CN ? '未命名训练' : 'Untitled session')}
                      </h4>
                      <span className={`text-[11px] px-2 py-0.5 rounded-chip ${badge.cls}`}>{badge.label}</span>
                    </div>
                    {s.bodyParts.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {s.bodyParts.map(tag => {
                          const builtin = (translations as any)[tag]?.[lang];
                          const custom = customTags.find(c => c.id === tag)?.name;
                          return (
                            <span
                              key={tag}
                              className="text-[11px] px-2 py-0.5 rounded-chip bg-inset text-secondary"
                            >
                              {builtin || custom || tag}
                            </span>
                          );
                        })}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => openEdit(s)}
                      aria-label="edit"
                      className="p-2 text-tertiary hover:text-accent hover:bg-accent-soft rounded-chip transition-colors"
                    >
                      <Edit2 size={16} strokeWidth={1.75} />
                    </button>
                    <button
                      onClick={() => onDelete(s)}
                      aria-label="delete"
                      className="p-2 text-tertiary hover:text-danger hover:bg-danger/10 rounded-chip transition-colors"
                    >
                      <Trash2 size={16} strokeWidth={1.75} />
                    </button>
                  </div>
                </div>

                {s.exercises.length === 0 ? (
                  <div className="text-xs text-tertiary">{translations.scheduleNoExercises[lang]}</div>
                ) : (
                  <ul className="space-y-1.5">
                    {s.exercises.map(ex => (
                      <li
                        key={ex.id}
                        className="flex items-center justify-between text-sm border border-divider rounded-chip px-3 py-2"
                      >
                        <span className="text-primary truncate">{ex.name}</span>
                        <span className="font-mono tabular-nums text-secondary text-xs">
                          {ex.targetSets ? `${ex.targetSets}×` : ''}
                          {ex.targetReps ?? ''}
                          {ex.targetWeight ? ` · ${ex.targetWeight}${unit}` : ''}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}

                {s.notes && <p className="text-xs text-secondary whitespace-pre-line">{s.notes}</p>}

                {s.status === 'planned' && (
                  <div className="flex items-center gap-2 pt-1">
                    <button
                      onClick={() => onStartScheduledSession(s.id)}
                      data-testid={`schedule-start-${s.id}`}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-control bg-accent text-white text-sm font-medium hover:opacity-90 active:scale-95 transition"
                    >
                      <Play size={14} strokeWidth={2} />
                      {translations.scheduleStartSession[lang]}
                    </button>
                    <button
                      onClick={() => markSkipped(s)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-control border border-divider text-secondary text-sm hover:text-primary hover:bg-card-hover transition"
                    >
                      <Ban size={14} strokeWidth={1.75} />
                      {translations.scheduleMarkSkipped[lang]}
                    </button>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* 仅订阅 schedules 用于让月历点呈现，本身无副作用 */}
      <span className="sr-only" data-testid="schedule-count">
        {schedules.length}
      </span>

      {editorOpen && (
        <ScheduleEditorModal
          lang={lang}
          unit={unit}
          customTags={customTags}
          defaultDate={selectedDate}
          editingSchedule={editorTarget}
          onClose={() => setEditorOpen(false)}
          onOpenLibraryForPicker={onOpenLibraryForPicker}
        />
      )}
    </div>
  );
};

export default ScheduleView;
