import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Calendar,
  ChevronDown,
  ChevronUp,
  Edit2,
  Plus,
  CopyPlus,
  Merge,
  Trash2,
  CalendarDays,
  CalendarRange,
  CalendarClock,
  CalendarSearch,
  MapPin,
} from 'lucide-react';
import { Language, WorkoutSession, Exercise } from '../../types';
import { translations } from '../../translations';
import { useLongPress } from '../hooks/useLongPress';
import { LongPressAffordance } from './LongPressAffordance';

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
  /** §12.8：长按菜单里的删除走「先执行 + 撤销条」，skipConfirm 跳过确认弹窗 */
  onDeleteWorkout: (workoutId: string, options?: { skipConfirm?: boolean }) => void;
  /** 把这场并入时间上紧邻的前一场（误结束拆场的事后补救），带撤销 */
  onMergeIntoPrevious: (workoutId: string) => void;
  /** 把这场的结构铺成今天的一次新训练（全部为底稿），进工作台 */
  onCopyToToday: (workoutId: string) => void;
}

/** 底稿行不算数据（§12.6）：未收尾的草稿场次里可能带着 ghost 行 */
function realSets(ex: Exercise): Exercise['sets'] {
  return (ex.sets ?? []).filter((s: any) => !s.ghost);
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
    className={`flex-1 min-h-[40px] flex items-center justify-center gap-1.5 rounded-control text-xs font-bold transition-ui ${
      active
        ? 'bg-accent text-on-accent'
        : 'bg-transparent text-secondary hover:text-primary'
    }`}
  >
    {icon}
    <span>{label}</span>
  </button>
);

interface SessionCardProps {
  w: WorkoutSession;
  lang: Language;
  isExpanded: boolean;
  onToggleExpand: () => void;
  resolveName: (name: string) => string;
  renderSetCapsule: (s: any, exerciseName: string, exercise?: Exercise) => React.ReactNode;
  onEdit: () => void;
  onAppend: () => void;
  onDelete: () => void;
  onMerge: () => void;
  onCopy: () => void;
  /** 前面还有训练可并入时才给这一项 —— 最早的一场没有「上一场」 */
  canMerge: boolean;
  /**
   * 合并态（天粒度且这一天只有一场）：组头已经被吃掉，日期改由卡片
   * 最左边那一列承担。false 时保留原来那行完整日期（周/月/年粒度、
   * 以及一天里有两场以上的情况仍然需要组头）。
   */
  merged: boolean;
}

/**
 * 时间线里的一场训练（§12.8）。
 *
 * 点按＝展开/收起详情（原语义不动）；长按＝浮出操作菜单
 * （编辑 / 补记动作 / 删除）。原先每张卡常驻一排「编辑·补加·删除」按钮，
 * 低频操作永久占着版面 —— 收进长按后，卡面只剩内容本身。
 * 删除不再弹确认框：先执行 + 撤销条（撤销就是那道保险，两道锁是冗余）。
 * 菜单形态与 ExerciseCard 的 ⋯ 菜单同一idiom：卡内 absolute、点外关闭。
 *
 * ⚠️ 菜单开着时整张卡必须抬 z（不是只给菜单加 z-20）：菜单比矮卡片高，
 * 会探出卡片下缘，而下一张卡是【后面的兄弟节点】—— 卡片自己不抬层级的话，
 * 后来的兄弟直接盖在探出来那截上，最下面那项（删除）永远点不到。
 */
const SessionCard: React.FC<SessionCardProps> = ({
  w,
  lang,
  isExpanded,
  onToggleExpand,
  resolveName,
  renderSetCapsule,
  onEdit,
  onAppend,
  onDelete,
  onMerge,
  onCopy,
  canMerge,
  merged,
}) => {
  const isCN = lang === Language.CN;
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  /**
   * 长按松手会带出一次 click，它有两个去处，两个都得挡：
   *
   * 1. 落在卡片上 → 会把卡片展开（原本就挡着的）；
   * 2. **落在菜单项上** —— 菜单是在【手指底下】长出来的。真机实测：
   *    长按卡片右上角，一松手当场就进了「编辑这次训练」。按卡片正中间测不出来，
   *    所以这个 bug 一直藏着。
   *
   * 两处共用一个时间戳，而不是各自一个布尔（§12.5 三件套）：布尔是粘滞的 ——
   * 手势若以 pointercancel 结束就没有 click 来清它，它会一直挂着，
   * 把用户下一次正常点击吃掉。时间戳会自己过期。
   *
   * ⚠️ 静默期从【松手】那一刻起算，不是从菜单出现那一刻：菜单在按满 500ms 时
   * 就长出来了，而手指可以再压半秒才抬 —— 按菜单出现起算的话，
   * 按得久一点就直接绕过了这道闸门。
   */
  const armedAt = useRef(0);
  const MENU_ARM_MS = 350;
  const swallowingClick = () => performance.now() - armedAt.current < MENU_ARM_MS;

  /** 这一次手势按满了长按 —— 只有它的那次松手才需要武装静默期 */
  const becameLongPress = useRef(false);

  const press = useLongPress({
    onLongPress: () => {
      becameLongPress.current = true;
      setMenuOpen(true);
    },
    disabled: menuOpen,
  });

  /**
   * 注意 becameLongPress 必须在这里清掉。不清的话，之后每一次点菜单项的松手
   * 都会冒泡到卡片上、把静默期重新武装一遍，于是那次点击自己被自己吞掉 ——
   * 菜单从此一项都点不动。
   *
   * 而「点菜单项」这个新手势不会把它重新置位：菜单开着时 useLongPress 是
   * disabled 的，长按根本不会达成。
   */
  const pressHandlers = {
    ...press.handlers,
    onPointerUp: () => {
      press.handlers.onPointerUp();
      if (becameLongPress.current) armedAt.current = performance.now();
      becameLongPress.current = false;
    },
    onPointerCancel: () => {
      press.handlers.onPointerCancel();
      becameLongPress.current = false;
    },
  };

  /** 菜单项统一走这里：静默期内的点击是长按松手带出来的，丢掉。 */
  const runMenuAction = (fn: () => void) => {
    if (swallowingClick()) return;
    setMenuOpen(false);
    fn();
  };

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenuOpen(false);
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const exerciseCount = w.exercises?.length || 0;
  const setCount = w.exercises?.reduce((s, ex) => s + realSets(ex).length, 0) || 0;
  const when = new Date(w.date);
  const dateStr = when.toLocaleDateString(isCN ? 'zh-CN' : 'en-US', {
    month: 'short',
    day: 'numeric',
    weekday: 'short',
  });
  const timeStr = when.toLocaleTimeString(isCN ? 'zh-CN' : 'en-US', {
    hour: '2-digit',
    minute: '2-digit',
  });
  const weekdayStr = when.toLocaleDateString(isCN ? 'zh-CN' : 'en-US', { weekday: 'short' });

  /**
   * 副行：时间 + 前三个动作。
   * 原先这一行只有「N 动作 M 组」两个数字 —— 回看时想知道的是「那天练了啥」，
   * 不是「练了几个」。数字挪到右列，这一行换成真正有信息的内容，不多占高度。
   */
  const preview = (w.exercises ?? [])
    .slice(0, 3)
    .map(ex => resolveName(ex.name))
    .join(' · ');
  const subtitle = [timeStr, preview].filter(Boolean).join(' · ');

  const menuItem =
    'w-full min-h-[44px] px-4 flex items-center gap-3 text-left text-sm text-primary active:bg-card-hover';

  return (
    <div
      data-testid={`timeline-session-${w.id}`}
      className={`ui-card-interactive relative px-3 py-2.5 transition-ui touch-pan-y ${
        isExpanded ? 'ring-2 ring-accent/25' : ''
      }${menuOpen ? ' z-30 shadow-overlay' : ''}`}
      {...pressHandlers}
    >
      <LongPressAffordance
        active={press.pressing}
        hint={press.hinting}
        label={isCN ? '更多操作' : 'Actions'}
        hintLabel={isCN ? '按住出菜单 · 点按看详情' : 'Hold for actions'}
        drawMs={press.drawMs}
        placement="down"
      />

      {/* 一行三列：日期柱 / 标题+副行 / 计数。
          原先是三行左对齐（日期、标题、计数），右半张卡永远是空的，
          而天粒度下第一行还跟组头重复了一遍。 */}
      <div
        className="flex items-center gap-3 cursor-pointer"
        onClick={() => {
          if (swallowingClick()) return;
          onToggleExpand();
        }}
      >
        {merged && (
          <div className="flex-none w-10 text-center">
            <div className="font-mono font-bold text-[19px] leading-none text-primary tabular-nums">
              {when.getDate()}
            </div>
            <div className="text-[9.5px] text-tertiary mt-1">{weekdayStr}</div>
          </div>
        )}

        <div className="flex-1 min-w-0">
          {!merged && (
            <div className="flex items-center gap-2 text-[11px] text-tertiary mb-1">
              <Calendar size={11} strokeWidth={2} />
              <span className="font-medium">{dateStr}</span>
            </div>
          )}
          <div className="flex items-center gap-2 min-w-0">
            <h4 className="font-bold text-primary truncate">
              {w.title || (isCN ? '未命名训练' : 'Untitled')}
            </h4>
            {w.fromSchedule && (
              <span className="flex-none text-[9px] px-1.5 py-0.5 rounded-chip font-bold bg-accent-soft text-accent">
                {isCN ? '按计划' : 'Planned'}
              </span>
            )}
            {/* §12.11 场地。没标过的（新增字段之前的历史）什么都不显示 —— 不编。
                ⚠️ 必须能被压缩并自己截断：写死 flex-none 的话，一个长场地名
                会把标题挤到只剩几个字 —— 标题才是主信息，该让路的是场地。 */}
            {w.gym && (
              <span
                className="min-w-0 max-w-[5rem] text-[9px] px-1.5 py-0.5 rounded-chip bg-inset text-tertiary inline-flex items-center gap-1"
                data-testid="timeline-gym"
              >
                <MapPin size={8} strokeWidth={2.25} className="flex-none" />
                <span className="truncate">{w.gym}</span>
              </span>
            )}
          </div>
          <div className="text-[10.5px] text-tertiary truncate mt-0.5">{subtitle}</div>
        </div>

        <div className="flex-none flex items-center gap-1.5">
          <div className="text-right text-[10px] text-tertiary leading-[1.45]">
            <div>
              <span className="font-mono font-bold text-[13px] text-secondary tabular-nums">
                {exerciseCount}
              </span>{' '}
              {isCN ? '动作' : 'ex.'}
            </div>
            <div>
              <span className="font-mono font-bold text-[13px] text-secondary tabular-nums">
                {setCount}
              </span>{' '}
              {isCN ? '组' : 'sets'}
            </div>
          </div>
          <div className="text-tertiary">
            {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </div>
        </div>
      </div>

      {/* 长按菜单：卡内 absolute，右上角浮出（同 ExerciseCard ⋯ 菜单的形态） */}
      {menuOpen && (
        <div
          ref={menuRef}
          role="menu"
          data-testid="timeline-session-menu"
          className="anim-reveal absolute right-3 top-3 z-20 w-48 py-1 bg-card border border-divider rounded-card shadow-overlay"
        >
          <button
            type="button"
            role="menuitem"
            className={menuItem}
            onClick={() => runMenuAction(onEdit)}
          >
            <Edit2 size={16} strokeWidth={1.75} className="text-tertiary" />
            {isCN ? '编辑这次训练' : 'Edit workout'}
          </button>
          <button
            type="button"
            role="menuitem"
            className={menuItem}
            onClick={() => runMenuAction(onAppend)}
          >
            <Plus size={16} strokeWidth={1.75} className="text-tertiary" />
            {isCN ? '补记动作' : 'Add exercise'}
          </button>
          {/* 「上次那套，再来一遍」：结构照抄，但每一组都以底稿铺下去（§12.6），
              点组号才描实 —— 复制不替用户上报他没做的事。 */}
          <button
            type="button"
            role="menuitem"
            className={menuItem}
            onClick={() => runMenuAction(onCopy)}
          >
            <CopyPlus size={16} strokeWidth={1.75} className="text-tertiary" />
            <span className="flex-1">{isCN ? '复制为今天的训练' : 'Copy to today'}</span>
            <span className="text-[10px] text-tertiary">{isCN ? '底稿' : 'Draft'}</span>
          </button>
          {/* 误结束拆场的事后补救：把这场并回紧邻的前一场。
              和删除一样走「先执行 + 撤销」——手滑点到它，撤销条就在下面。 */}
          {canMerge && (
            <button
              type="button"
              role="menuitem"
              className={menuItem}
              onClick={() => runMenuAction(onMerge)}
            >
              <Merge size={16} strokeWidth={1.75} className="text-tertiary" />
              <span className="flex-1">{isCN ? '并入上一场' : 'Merge into previous'}</span>
              <span className="text-[10px] text-tertiary">{isCN ? '可撤销' : 'Undoable'}</span>
            </button>
          )}
          {/* §6.6：删除入口是墨色文字项，不靠颜色喊危险；
              保险由撤销条提供（先执行 + 5 秒撤销），不再弹确认框。 */}
          <button
            type="button"
            role="menuitem"
            className={`${menuItem} border-t border-divider mt-1 pt-1`}
            onClick={() => runMenuAction(onDelete)}
          >
            <Trash2 size={16} strokeWidth={1.75} className="text-tertiary" />
            <span className="flex-1">{isCN ? '删除' : 'Delete'}</span>
            <span className="text-[10px] text-tertiary">{isCN ? '可撤销' : 'Undoable'}</span>
          </button>
        </div>
      )}

      {/* 展开详情 */}
      {isExpanded && (
        <div className="mt-4 pt-4 border-t border-divider space-y-3 anim-reveal">
          {(w.exercises || []).map((ex, idx) => {
            const sets = realSets(ex);
            return (
              <div key={`${ex.id}-${idx}`} className="bg-inset/60 p-3 rounded-control space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-sm text-primary truncate">
                    {resolveName(ex.name)}
                  </span>
                  <span className="text-[10px] text-tertiary bg-card px-2 py-0.5 rounded-chip">
                    {sets.length} {isCN ? '组' : 'sets'}
                  </span>
                </div>
                {sets.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {sets.map((s) => renderSetCapsule(s, ex.name, ex))}
                  </div>
                )}
              </div>
            );
          })}
          {exerciseCount === 0 && (
            <div className="text-center text-xs text-tertiary py-2">
              {isCN ? '这场训练还没有动作' : 'No exercises yet'}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

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
  onMergeIntoPrevious,
  onCopyToToday,
}) => {
  const isCN = lang === Language.CN;
  /** 全局最早那一场的 id —— 只有它没有「上一场」可并 */
  const earliestId = useMemo(() => {
    let earliest: WorkoutSession | null = null;
    for (const w of workouts) {
      if (!w.date) continue;
      if (!earliest || new Date(w.date).getTime() < new Date(earliest.date).getTime()) {
        earliest = w;
      }
    }
    return earliest?.id ?? null;
  }, [workouts]);
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
    <div className={granularity === 'day' ? 'space-y-2' : 'space-y-5'}>
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

      {/* 分组列表。
          天粒度下一个组就是一天，而一天几乎总是只有一场 —— 组头与卡片会把
          日期和计数各说两遍。所以「天粒度 + 组内只有一场」时组头整个吃掉，
          日期改由卡片最左边那一列承担，月份降级成一条轻标题（见 mergedGroup）。
          周/月/年粒度，以及一天里练了两场的情况，仍然走原来的组头。 */}
      <div className={granularity === 'day' ? 'space-y-2' : 'space-y-5'}>
      {grouped.map((group, gi) => {
        const totalExercises = group.workouts.reduce(
          (s, w) => s + (w.exercises?.length || 0),
          0,
        );
        const totalSets = group.workouts.reduce(
          (s, w) => s + (w.exercises?.reduce((ss, ex) => ss + realSets(ex).length, 0) || 0),
          0,
        );
        const isCollapsed = collapsedGroups.has(group.key);
        const mergedGroup = granularity === 'day' && group.workouts.length === 1;

        // 合并态下月份换了才起一条标题；非合并态的组头自带完整日期，不需要它
        const monthLabel = (() => {
          if (!mergedGroup) return null;
          const d = new Date(group.workouts[0].date);
          const prev = gi > 0 ? grouped[gi - 1] : null;
          const prevD = prev?.workouts?.[0]?.date ? new Date(prev.workouts[0].date) : null;
          const sameMonth =
            !!prevD &&
            prevD.getFullYear() === d.getFullYear() &&
            prevD.getMonth() === d.getMonth();
          if (sameMonth) return null;
          return isCN
            ? `${d.getFullYear()} 年 ${d.getMonth() + 1} 月`
            : d.toLocaleDateString('en-US', { year: 'numeric', month: 'long' });
        })();

        if (mergedGroup) {
          const w = group.workouts[0];
          return (
            <div key={group.key} className="space-y-2">
              {monthLabel && (
                <div className="px-1 pt-2 text-[10px] tracking-[0.14em] text-tertiary font-medium">
                  {monthLabel}
                </div>
              )}
              <SessionCard
                w={w}
                lang={lang}
                merged
                isExpanded={expandedWorkoutId === w.id}
                onToggleExpand={() =>
                  setExpandedWorkoutId(expandedWorkoutId === w.id ? null : w.id)
                }
                resolveName={resolveName}
                renderSetCapsule={renderSetCapsule}
                onEdit={() => onEditWorkout(w.id)}
                onAppend={() => onAddExerciseToWorkout(w.id)}
                onDelete={() => onDeleteWorkout(w.id, { skipConfirm: true })}
                onMerge={() => onMergeIntoPrevious(w.id)}
                onCopy={() => onCopyToToday(w.id)}
                canMerge={w.id !== earliestId}
              />
            </div>
          );
        }

        return (
          <div key={group.key} className="space-y-2">
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
              group.workouts.map((w) => (
                <SessionCard
                  key={w.id}
                  w={w}
                  lang={lang}
                  isExpanded={expandedWorkoutId === w.id}
                  onToggleExpand={() =>
                    setExpandedWorkoutId(expandedWorkoutId === w.id ? null : w.id)
                  }
                  resolveName={resolveName}
                  renderSetCapsule={renderSetCapsule}
                  onEdit={() => onEditWorkout(w.id)}
                  onAppend={() => onAddExerciseToWorkout(w.id)}
                  onDelete={() => onDeleteWorkout(w.id, { skipConfirm: true })}
                  onMerge={() => onMergeIntoPrevious(w.id)}
                  onCopy={() => onCopyToToday(w.id)}
                  canMerge={w.id !== earliestId}
                  merged={false}
                />
              ))}
          </div>
        );
      })}
      </div>
    </div>
  );
};

export default TimelineView;
