import React, { useMemo, useState } from 'react';
import {
  Calendar,
  ChevronDown,
  ChevronUp,
  Edit2,
  Plus,
  Trash2,
  CalendarDays,
  CalendarRange,
  CalendarClock,
  CalendarSearch,
} from 'lucide-react';
import { Language, WorkoutSession, Exercise } from '../../types';
import { translations } from '../../translations';

export type TimelineGranularity = 'day' | 'week' | 'month' | 'year';

interface TimelineViewProps {
  lang: Language;
  workouts: WorkoutSession[];
  granularity: TimelineGranularity;
  onGranularityChange: (g: TimelineGranularity) => void;
  resolveName: (name: string) => string;
  renderSetCapsule: (s: any, exerciseName: string, exercise?: Exercise) => React.ReactNode;
  onEditWorkout: (workoutId: string) => void;
  onAddExerciseToWorkout: (workoutId: string) => void;
  onDeleteWorkout: (workoutId: string) => void;
}

/** ISO 周键：YYYY-Www */
function getISOWeekKey(date: Date): { key: string; label: string; start: Date; end: Date } {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  const year = d.getUTCFullYear();

  // 本周一作为 start（按本地时区显示给用户）
  const start = new Date(date);
  const offset = (start.getDay() || 7) - 1;
  start.setDate(start.getDate() - offset);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);

  return { key: `${year}-W${String(weekNo).padStart(2, '0')}`, label: `W${weekNo}`, start, end };
}

function getGroupInfo(
  date: Date,
  granularity: TimelineGranularity,
  lang: Language,
): { key: string; label: string; sortKey: string } {
  const isCN = lang === Language.CN;
  if (granularity === 'day') {
    const y = date.getFullYear();
    const m = date.getMonth() + 1;
    const d = date.getDate();
    const weekdayStr = date.toLocaleDateString(isCN ? 'zh-CN' : 'en-US', { weekday: 'short' });
    const key = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const label = isCN
      ? `${m}月${d}日 · ${weekdayStr}`
      : `${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} · ${weekdayStr}`;
    return { key, label, sortKey: key };
  }
  if (granularity === 'week') {
    const { key, start, end } = getISOWeekKey(date);
    const sm = start.getMonth() + 1;
    const sd = start.getDate();
    const em = end.getMonth() + 1;
    const ed = end.getDate();
    const weekNum = parseInt(key.split('W')[1], 10);
    const label = isCN
      ? `${start.getFullYear()}年 · 第${weekNum}周 (${sm}/${sd} - ${em}/${ed})`
      : `${start.getFullYear()} · Week ${weekNum} (${sm}/${sd} - ${em}/${ed})`;
    return { key, label, sortKey: key };
  }
  if (granularity === 'month') {
    const y = date.getFullYear();
    const m = date.getMonth() + 1;
    const key = `${y}-${String(m).padStart(2, '0')}`;
    const label = isCN
      ? `${y}年${m}月`
      : date.toLocaleDateString('en-US', { year: 'numeric', month: 'long' });
    return { key, label, sortKey: key };
  }
  // year
  const y = date.getFullYear();
  return { key: `${y}`, label: isCN ? `${y}年` : `${y}`, sortKey: `${y}` };
}

interface GranularityChipProps {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}

const GranularityChip: React.FC<GranularityChipProps> = ({ active, icon, label, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className={`flex-1 min-h-[40px] flex items-center justify-center gap-1.5 rounded-xl text-xs font-bold transition-all ${
      active
        ? 'bg-accent text-white shadow-md shadow-blue-600/20'
        : 'bg-transparent text-secondary hover:text-primary'
    }`}
  >
    {icon}
    <span>{label}</span>
  </button>
);

export const TimelineView: React.FC<TimelineViewProps> = ({
  lang,
  workouts,
  granularity,
  onGranularityChange,
  resolveName,
  renderSetCapsule,
  onEditWorkout,
  onAddExerciseToWorkout,
  onDeleteWorkout,
}) => {
  const isCN = lang === Language.CN;
  const [expandedWorkoutId, setExpandedWorkoutId] = useState<string | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  const grouped = useMemo(() => {
    const sorted = [...workouts].sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
    );
    const map = new Map<
      string,
      { label: string; sortKey: string; workouts: WorkoutSession[] }
    >();
    for (const w of sorted) {
      if (!w.date) continue;
      const info = getGroupInfo(new Date(w.date), granularity, lang);
      if (!map.has(info.key)) {
        map.set(info.key, { label: info.label, sortKey: info.sortKey, workouts: [] });
      }
      map.get(info.key)!.workouts.push(w);
    }
    return Array.from(map.entries())
      .map(([key, value]) => ({ key, ...value }))
      .sort((a, b) => b.sortKey.localeCompare(a.sortKey));
  }, [workouts, granularity, lang]);

  if (workouts.length === 0) {
    return (
      <div className="ui-card p-8 text-center text-secondary text-sm">
        {isCN ? '还没有训练记录' : 'No workouts yet'}
      </div>
    );
  }

  const toggleGroup = (key: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div className="space-y-5">
      {/* 颛粒度切换 */}
      <div className="ui-card p-1.5 flex items-center gap-1">
        <GranularityChip
          active={granularity === 'day'}
          icon={<Calendar size={13} strokeWidth={2} />}
          label={isCN ? '天' : 'Day'}
          onClick={() => onGranularityChange('day')}
        />
        <GranularityChip
          active={granularity === 'week'}
          icon={<CalendarRange size={13} strokeWidth={2} />}
          label={isCN ? '周' : 'Week'}
          onClick={() => onGranularityChange('week')}
        />
        <GranularityChip
          active={granularity === 'month'}
          icon={<CalendarDays size={13} strokeWidth={2} />}
          label={isCN ? '月' : 'Month'}
          onClick={() => onGranularityChange('month')}
        />
        <GranularityChip
          active={granularity === 'year'}
          icon={<CalendarClock size={13} strokeWidth={2} />}
          label={isCN ? '年' : 'Year'}
          onClick={() => onGranularityChange('year')}
        />
      </div>

      {/* 分组列表 */}
      {grouped.map((group) => {
        const totalExercises = group.workouts.reduce(
          (s, w) => s + (w.exercises?.length || 0),
          0,
        );
        const totalSets = group.workouts.reduce(
          (s, w) => s + (w.exercises?.reduce((ss, ex) => ss + (ex.sets?.length || 0), 0) || 0),
          0,
        );
        const isCollapsed = collapsedGroups.has(group.key);

        return (
          <div key={group.key} className="space-y-3">
            {/* 组头：可折叠 */}
            <button
              type="button"
              onClick={() => toggleGroup(group.key)}
              className="w-full flex items-center justify-between px-1 py-2 group"
            >
              <div className="flex items-center gap-2">
                <CalendarSearch size={14} className="text-accent" strokeWidth={2} />
                <h3 className="text-sm font-bold text-primary">{group.label}</h3>
              </div>
              <div className="flex items-center gap-2.5 text-[11px] text-tertiary font-medium">
                <span>
                  {group.workouts.length} {isCN ? '场' : 'sess.'}
                </span>
                <span className="text-divider">·</span>
                <span>
                  {totalExercises} {isCN ? '动作' : 'ex.'}
                </span>
                <span className="text-divider">·</span>
                <span>
                  {totalSets} {isCN ? '组' : 'sets'}
                </span>
                {isCollapsed ? (
                  <ChevronDown size={14} className="text-secondary" />
                ) : (
                  <ChevronUp size={14} className="text-secondary" />
                )}
              </div>
            </button>

            {!isCollapsed &&
              group.workouts.map((w) => {
                const isExpanded = expandedWorkoutId === w.id;
                const exerciseCount = w.exercises?.length || 0;
                const setCount = w.exercises?.reduce((s, ex) => s + (ex.sets?.length || 0), 0) || 0;
                const dateStr = new Date(w.date).toLocaleDateString(
                  isCN ? 'zh-CN' : 'en-US',
                  { month: 'short', day: 'numeric', weekday: 'short' },
                );
                const timeStr = new Date(w.date).toLocaleTimeString(
                  isCN ? 'zh-CN' : 'en-US',
                  { hour: '2-digit', minute: '2-digit' },
                );

                return (
                  <div
                    key={w.id}
                    className={`ui-card-interactive p-4 transition-all ${
                      isExpanded ? 'ring-2 ring-accent/25' : ''
                    }`}
                  >
                    <div
                      className="flex items-start justify-between gap-3 cursor-pointer"
                      onClick={() =>
                        setExpandedWorkoutId(isExpanded ? null : w.id)
                      }
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 text-[11px] text-tertiary mb-1.5">
                          <Calendar size={11} strokeWidth={2} />
                          <span className="font-medium">
                            {dateStr} · {timeStr}
                          </span>
                          {w.status === 'draft' && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded-chip font-bold bg-orange-500/10 text-orange-500">
                              {isCN ? '未完成' : 'Draft'}
                            </span>
                          )}
                          {w.fromSchedule && (
                            <span
                              className={`text-[9px] px-1.5 py-0.5 rounded-chip font-bold ${
                                w.fromSchedule.faithful
                                  ? 'bg-accent-soft text-accent'
                                  : 'bg-warning/15 text-warning'
                              }`}
                            >
                              {w.fromSchedule.faithful
                                ? isCN
                                  ? '按计划'
                                  : 'Planned'
                                : isCN
                                ? '计划·调整'
                                : 'Plan·Mod'}
                            </span>
                          )}
                        </div>
                        <h4 className="font-bold text-primary truncate">
                          {w.title || (isCN ? '未命名训练' : 'Untitled')}
                        </h4>
                        <div className="flex items-center gap-3 text-[11px] text-tertiary mt-1.5">
                          <span>
                            <span className="text-secondary font-bold">{exerciseCount}</span>{' '}
                            {isCN ? '动作' : 'ex.'}
                          </span>
                          <span>
                            <span className="text-secondary font-bold">{setCount}</span>{' '}
                            {isCN ? '组' : 'sets'}
                          </span>
                        </div>
                      </div>
                      <div className="text-tertiary flex-shrink-0">
                        {isExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                      </div>
                    </div>

                     {/* 操作按钮区 */}
                     <div className="flex items-center gap-2 mt-3 pt-3 border-t border-divider">
                       <button
                         type="button"
                         onClick={(e) => {
                           e.stopPropagation();
                           onEditWorkout(w.id);
                         }}
                         className="flex-1 min-h-[40px] flex items-center justify-center gap-1.5 bg-accent text-white rounded-xl text-xs font-bold hover:opacity-90 active:scale-95 transition-all shadow-sm shadow-blue-600/20"
                         title={isCN ? '编辑训练' : 'Edit'}
                       >
                         <Edit2 size={13} strokeWidth={2} />
                         <span>{isCN ? '编辑' : 'Edit'}</span>
                       </button>
                       <button
                         type="button"
                         onClick={(e) => {
                           e.stopPropagation();
                           onAddExerciseToWorkout(w.id);
                         }}
                         className="min-h-[40px] px-3 flex items-center justify-center gap-1.5 bg-inset text-secondary rounded-xl text-xs font-bold hover:text-primary active:scale-95 transition-all"
                         title={isCN ? '为此训练补加动作' : 'Add exercise'}
                       >
                         <Plus size={14} strokeWidth={2} />
                         <span>{isCN ? '补加' : 'Add'}</span>
                       </button>
                       <button
                         type="button"
                         onClick={(e) => {
                           e.stopPropagation();
                           onDeleteWorkout(w.id);
                         }}
                         className="min-h-[40px] w-11 flex items-center justify-center text-danger bg-danger/10 rounded-xl hover:opacity-80 active:scale-95 transition-all"
                         title={isCN ? '删除整场' : 'Delete workout'}
                       >
                         <Trash2 size={14} strokeWidth={2} />
                       </button>
                     </div>

                    {/* 展开详情 */}
                    {isExpanded && (
                      <div className="mt-4 pt-4 border-t border-divider space-y-3 animate-fade-in">
                        {(w.exercises || []).map((ex, idx) => (
                          <div
                            key={`${ex.id}-${idx}`}
                            className="bg-inset/60 p-3 rounded-control space-y-2"
                          >
                            <div className="flex items-center justify-between">
                              <span className="font-semibold text-sm text-primary truncate">
                                {resolveName(ex.name)}
                              </span>
                              <span className="text-[10px] text-tertiary bg-card px-2 py-0.5 rounded-chip">
                                {ex.sets?.length || 0} {isCN ? '组' : 'sets'}
                              </span>
                            </div>
                            {ex.sets && ex.sets.length > 0 && (
                              <div className="flex flex-wrap gap-1.5">
                                {ex.sets.map((s) => renderSetCapsule(s, ex.name, ex))}
                              </div>
                            )}
                          </div>
                        ))}
                        {exerciseCount === 0 && (
                          <div className="text-center text-xs text-tertiary py-2">
                            {isCN ? '这场训练还没有动作' : 'No exercises yet'}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
          </div>
        );
      })}
    </div>
  );
};

export default TimelineView;
