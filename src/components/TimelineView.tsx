import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
  MoreHorizontal,
  Play,
} from 'lucide-react';
import { RESUME_WINDOW_MS } from '../hooks/useWorkoutMutations';

/** 刚结束 10 分钟内：长按菜单给「继续这场」 */
const justEnded = (w: { finishedAt?: string }) =>
  !!w.finishedAt && Date.now() - new Date(w.finishedAt).getTime() < RESUME_WINDOW_MS;
import { Language, WorkoutSession, Exercise } from '../../types';
import { useLongPress } from '../hooks/useLongPress';
import { LongPressAffordance } from './LongPressAffordance';
import { plural } from '../utils/format';
import { dayOfWeekIndex } from '../utils/dateUtils';
import { appPrefsNow } from '../../services/appPrefs';
import { useExercisePrefs } from '../contexts/ExercisePrefsContext';

export type TimelineGranularity = 'day' | 'week' | 'month' | 'year';

interface TimelineViewProps {
  lang: Language;
  workouts: WorkoutSession[];
  granularity: TimelineGranularity;
  onGranularityChange: (g: TimelineGranularity) => void;
  resolveName: (name: string) => string;
  renderSetCapsule: (s: any, exerciseName: string, exercise?: Exercise, setIdx?: number) => React.ReactNode;
  onEditWorkout: (workoutId: string) => void;
  onAddExerciseToWorkout: (workoutId: string) => void;
  /** §12.8：长按菜单里的删除走「先执行 + 撤销条」，skipConfirm 跳过确认弹窗 */
  onDeleteWorkout: (workoutId: string, options?: { skipConfirm?: boolean }) => void;
  /** 把这场并入时间上紧邻的前一场（误结束拆场的事后补救），带撤销 */
  onMergeIntoPrevious: (workoutId: string) => void;
  /** 刚结束（10 分钟内）的那场接回工作台：误点结束的补救（原来是开新一场时弹「继续刚才那场？」） */
  onResumeFinished: (workoutId: string) => void;
  /** 把这场的结构铺成今天的一次新训练（全部为底稿），进工作台 */
  onCopyToToday: (workoutId: string) => void;
}

/** 底稿行不算数据（§12.6）：未收尾的草稿场次里可能带着 ghost 行 */
function realSets(ex: Exercise): Exercise['sets'] {
  return (ex.sets ?? []).filter((s: any) => !s.ghost);
}

/**
 * 周键：YYYY-Www。一周从哪天开始看首选项（默认周一）；周号取这一周里那个周一的 ISO 周号，
 * 所以周日开头时，周日归到它后面那个周一的周里。
 */
function getISOWeekKey(date: Date): { key: string; label: string; start: Date; end: Date } {
  const start = new Date(date);
  start.setDate(start.getDate() - dayOfWeekIndex(start));
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);

  const mon = new Date(start);
  mon.setDate(mon.getDate() + ((8 - mon.getDay()) % 7)); // 这一周里的周一
  const d = new Date(Date.UTC(mon.getFullYear(), mon.getMonth(), mon.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  const year = d.getUTCFullYear();

  return { key: `${year}-W${String(weekNo).padStart(2, '0')}`, label: `W${weekNo}`, start, end };
}

function getGroupInfo(
  date: Date,
  granularity: TimelineGranularity,
  lang: Language,
): { key: string; label: string; sortKey: string; sub?: string } {
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
    // 年份跟周号走（ISO 周年）：12/30 – 1/5 那一周是下一年的第 1 周，原来写成「上一年 · 第 1 周」（审查 C）
    const isoYear = key.slice(0, 4);
    // 日期范围拆成副行：原来整串「2026年 · 第41周 (10/5 - 10/11)」挤在一行，
    // 375 宽下把右边「2 场 · 16 动作 · 47 组」压成每项两行（2026-10-22）
    const label = isCN ? `${isoYear}年 · 第${weekNum}周` : `${isoYear} · Week ${weekNum}`;
    return { key, label, sortKey: key, sub: `${sm}/${sd} – ${em}/${ed}` };
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
        ? 'seg-on'
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
  renderSetCapsule: (s: any, exerciseName: string, exercise?: Exercise, setIdx?: number) => React.ReactNode;
  onEdit: () => void;
  onAppend: () => void;
  onDelete: () => void;
  onMerge: () => void;
  onCopy: () => void;
  onResume: () => void;
  /** 刚结束 10 分钟内才给「继续这场」 */
  canResume: boolean;
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
  renderSetCapsule,
  onEdit,
  onAppend,
  onDelete,
  onMerge,
  onCopy,
  onResume,
  canResume,
  canMerge,
  merged,
}) => {
  const isCN = lang === Language.CN;
  // 动作名带练法（第 8 条）：「高位下拉（宽握）」
  const { liftKey } = useExercisePrefs();
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
  const armedAt = useRef(-Infinity);
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

  /**
   * 菜单默认从卡片右上角往下长；靠近屏幕底部的卡片往下长会钻到底部 tab 栏底下，
   * 最后一项「删除」点不到。打开时量一次：下方放不下就改成从右下角往上长；
   * 上方也放不下（卡片矮、菜单高、两头都挤），就仍往下长，把页面滚到露出整份菜单。
   * 「挡住视线的栏」按 data-chrome="top|bottom" 认（AppHeader / TabNavigation）。
   */
  const [menuUp, setMenuUp] = useState(false);
  useLayoutEffect(() => {
    if (!menuOpen) {
      setMenuUp(false);
      return;
    }
    const menu = menuRef.current;
    const card = menu?.parentElement;
    if (!menu || !card) return;
    const GAP = 8;
    const INSET = 12; // top-3 / bottom-3
    const edges = (side: 'top' | 'bottom') =>
      Array.from(document.querySelectorAll<HTMLElement>(`[data-chrome="${side}"]`)).map(el => {
        const r = el.getBoundingClientRect();
        return side === 'top' ? r.bottom : r.top;
      });
    const bottomLimit = Math.min(window.innerHeight, ...edges('bottom')) - GAP;
    const topLimit = Math.max(0, ...edges('top')) + GAP;
    const h = menu.offsetHeight;
    const c = card.getBoundingClientRect();
    const downBottom = c.top + INSET + h;
    if (downBottom <= bottomLimit) return;
    if (c.bottom - INSET - h >= topLimit) {
      setMenuUp(true);
      return;
    }
    window.scrollBy({ top: downBottom - bottomLimit });
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
   * 副行：前三个动作。
   * 原先这一行只有「N 动作 M 组」两个数字 —— 回看时想知道的是「那天练了啥」，
   * 不是「练了几个」。数字挪到右列，这一行换成真正有信息的内容。
   * 时间不在这行：它和星期、馆名一样是「什么时候在哪」，归三级字（2026-10-22 界面审查）。
   */
  const preview = (w.exercises ?? [])
    .slice(0, 3)
    .map(ex => liftKey(ex))
    .join(' · ');

  const menuItem =
    'w-full min-h-[44px] px-4 flex items-center gap-3 text-left text-sm text-primary active:bg-card-hover';

  return (
    <div
      data-testid={`timeline-session-${w.id}`}
      className={`ui-card-interactive relative px-3 py-2.5 transition-ui touch-pan-y ${
        isExpanded ? 'ring-2 ring-accent/60' : ''
      }${menuOpen ? ' z-30 shadow-overlay' : ''}`}
      {...pressHandlers}
    >
      {/* 点按有自己的意思（展开详情），所以不闪「按住出菜单」的提示 —— 原来每次点击都闪 1.4 秒（2026-10-11） */}
      <LongPressAffordance
        active={press.pressing}
        hint={false}
        label={isCN ? '更多操作' : 'Actions'}
        hintLabel={isCN ? '按住出菜单 · 点按看详情' : 'Hold for actions'}
        drawMs={press.drawMs}
        placement="down"
      />

      {/* 三列：日期柱 / 标题 / 计数；动作摘要在第二行，横跨标题和计数两列。
          原先是三行左对齐（日期、标题、计数），右半张卡永远是空的，
          而天粒度下第一行还跟组头重复了一遍。
          一行分三层（2026-10-22 界面审查）：标题（primary）＝练什么；
          动作摘要（14px secondary）＝做了哪些；日期 / 星期 / 时间 / 馆名 / 单位（11px tertiary）＝什么时候在哪。
          以前摘要和时间挤在一行 11px 三级字里，整行只剩「黑」和「一片灰」两层，光改颜色看不出差别。 */}
      <div
        className={`grid ${merged ? 'grid-cols-[auto_1fr_auto]' : 'grid-cols-[1fr_auto]'} gap-x-3 gap-y-1 items-center cursor-pointer`}
        onClick={() => {
          if (swallowingClick()) return;
          onToggleExpand();
        }}
      >
        {merged && (
          <div className="row-span-2 w-10 text-center">
            <div className="font-mono font-bold text-xl leading-none text-primary tabular-nums">
              {when.getDate()}
            </div>
            <div className="text-micro font-normal text-tertiary mt-1">{weekdayStr}</div>
            <div className="text-micro font-normal text-tertiary tabular-nums">{timeStr}</div>
          </div>
        )}

        <div className="min-w-0">
          {!merged && (
            <div className="flex items-center gap-2 text-micro font-normal text-tertiary mb-1">
              <Calendar size={11} strokeWidth={2} />
              <span className="font-medium">{dateStr}</span>
              <span className="tabular-nums">{timeStr}</span>
            </div>
          )}
          <div className="flex items-center gap-2 min-w-0">
            {/* data-user-text：存下来的标题是数据（默认标题按结束时的语言生成），不随界面语言变 */}
            <h4 className="font-bold text-primary truncate" data-user-text={w.title ? '' : undefined}>
              {w.title || (isCN ? '未命名训练' : 'Untitled')}
            </h4>
            {w.fromSchedule && (
              <span className="flex-none text-micro px-1.5 py-0.5 rounded-chip font-bold bg-accent-soft text-accent">
                {isCN ? '按计划' : 'Planned'}
              </span>
            )}
            {/* §12.11 场地。没标过的（新增字段之前的历史）什么都不显示 —— 不编。
                ⚠️ 必须能被压缩并自己截断：写死 flex-none 的话，一个长场地名
                会把标题挤到只剩几个字 —— 标题才是主信息，该让路的是场地。 */}
            {w.gym && (
              <span
                className="min-w-0 max-w-[5rem] text-micro font-normal px-1.5 py-0.5 rounded-chip bg-inset text-tertiary inline-flex items-center gap-1"
                data-testid="timeline-gym"
              >
                <MapPin size={8} strokeWidth={2.25} className="flex-none" />
                <span className="truncate">{w.gym}</span>
              </span>
            )}
          </div>
        </div>

        <div className="flex-none flex items-center gap-1.5">
          <div className="text-right text-micro font-normal text-tertiary leading-[1.45]">
            <div>
              <span className="font-mono font-bold text-sm text-secondary tabular-nums">
                {exerciseCount}
              </span>{' '}
              {isCN ? '动作' : 'ex.'}
            </div>
            <div>
              <span className="font-mono font-bold text-sm text-secondary tabular-nums">
                {setCount}
              </span>{' '}
              {isCN ? '组' : plural(setCount, 'set')}
            </div>
          </div>
          <div className="text-tertiary">
            {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </div>
        </div>

        {preview && (
          <div className="col-span-2 min-w-0 text-sm text-secondary truncate">{preview}</div>
        )}
      </div>

      {/* 长按菜单：卡内 absolute，右上角浮出（同 ExerciseCard ⋯ 菜单的形态） */}
      {menuOpen && (
        <div
          ref={menuRef}
          role="menu"
          data-testid="timeline-session-menu"
          className={`anim-reveal absolute right-3 ${menuUp ? 'bottom-3' : 'top-3'} z-20 w-48 py-1 bg-card border border-divider rounded-card shadow-overlay`}
        >
          {canResume && (
            <button
              type="button"
              role="menuitem"
              className={menuItem}
              onClick={() => runMenuAction(onResume)}
              data-testid="timeline-resume"
            >
              <Play size={16} strokeWidth={1.75} className="text-tertiary" />
              <span className="flex-1">{isCN ? '继续这场' : 'Resume'}</span>
              <span className="text-micro font-normal text-tertiary">{isCN ? '刚结束' : 'Just ended'}</span>
            </button>
          )}
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
            <span className="text-micro font-normal text-tertiary">{isCN ? '作参考' : 'As reference'}</span>
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
              <span className="text-micro font-normal text-tertiary">{isCN ? '可撤销' : 'Undoable'}</span>
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
            <span className="text-micro font-normal text-tertiary">{isCN ? '可撤销' : 'Undoable'}</span>
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
                    {liftKey(ex)}
                  </span>
                  <span className="text-micro font-normal text-tertiary bg-card px-2 py-0.5 rounded-chip">
                    {sets.length} {isCN ? '组' : plural(sets.length, 'set')}
                  </span>
                </div>
                {sets.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {sets.map((s, i) => renderSetCapsule(s, ex.name, ex, i))}
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
          {/* 看得见的入口（审查 B4）：长按出菜单没人知道，展开之后给一颗按钮，开的是同一个菜单 */}
          <div className="flex justify-end">
            <button
              type="button"
              onPointerDown={e => e.stopPropagation()}
              onClick={e => {
                e.stopPropagation();
                setMenuOpen(true);
              }}
              className="min-h-[40px] px-3 inline-flex items-center gap-1.5 rounded-control text-label font-semibold text-secondary active:bg-card-hover"
              aria-label={isCN ? '更多操作' : 'More actions'}
              data-testid="timeline-more"
            >
              <MoreHorizontal size={16} strokeWidth={2} />
              {isCN ? '更多' : 'More'}
            </button>
          </div>
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
  onResumeFinished,
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

  // 周视图按首选项「每周开始于」分组（模块缓存，改了要重算）
  const weekStart = appPrefsNow().weekStart;
  const grouped = useMemo(() => {
    const sorted = [...workouts].sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
    );
    const map = new Map<
      string,
      { label: string; sub?: string; sortKey: string; workouts: WorkoutSession[] }
    >();
    for (const w of sorted) {
      if (!w.date) continue;
      const info = getGroupInfo(new Date(w.date), granularity, lang);
      if (!map.has(info.key)) {
        map.set(info.key, { label: info.label, sub: info.sub, sortKey: info.sortKey, workouts: [] });
      }
      map.get(info.key)!.workouts.push(w);
    }
    return Array.from(map.entries())
      .map(([key, value]) => ({ key, ...value }))
      .sort((a, b) => b.sortKey.localeCompare(a.sortKey));
  }, [workouts, granularity, lang, weekStart]);

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
          天粒度下一个组就是一天 —— 组头与卡片会把日期和计数各说两遍。所以天粒度
          不要组头，日期由卡片最左边那一列承担，月份降级成一条轻标题（见 mergedGroup）。
          一天练了两场也一样，就是同一天并排两张卡（2026-10-16 用户定：不另起一种样式）。
          周/月/年粒度仍然走原来的组头。 */}
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
        const mergedGroup = granularity === 'day';

        // 天粒度下段落（本周 / 某年某月）换了就起一条轻标题，不管下面是单场卡片还是一天多场的组头 ——
        // 多场组头只说是哪天，不说属于哪一段，漏了标题，后面上周的卡会读成还在「本周」下面。
        // 本周的几场标「本周」（2026-10-15 用户定）：标「2026 年 10 月」会让人以为下面几张卡是同一天。
        const thisWeek = getISOWeekKey(new Date()).key;
        const sectionOf = (d: Date) =>
          getISOWeekKey(d).key === thisWeek ? 'this-week' : `${d.getFullYear()}-${d.getMonth()}`;
        const monthLabel = (() => {
          if (granularity !== 'day') return null;
          const d = new Date(group.workouts[0].date);
          const prev = gi > 0 ? grouped[gi - 1] : null;
          const prevD = prev?.workouts?.[0]?.date ? new Date(prev.workouts[0].date) : null;
          if (prevD && sectionOf(prevD) === sectionOf(d)) return null;
          if (sectionOf(d) === 'this-week') return isCN ? '本周' : 'This week';
          return isCN
            ? `${d.getFullYear()} 年 ${d.getMonth() + 1} 月`
            : d.toLocaleDateString('en-US', { year: 'numeric', month: 'long' });
        })();
        const sectionTitle = monthLabel && (
          <div className="px-1 pt-2 text-micro tracking-[0.14em] text-tertiary font-medium">
            {monthLabel}
          </div>
        );

        if (mergedGroup) {
          return (
            <div key={group.key} className="space-y-2">
              {sectionTitle}
              {group.workouts.map((w) => (
                <SessionCard
                  key={w.id}
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
                  onResume={() => onResumeFinished(w.id)}
                  canResume={justEnded(w)}
                  canMerge={w.id !== earliestId}
                />
              ))}
            </div>
          );
        }

        return (
          <div key={group.key} className="space-y-2">
            {sectionTitle}
            {/* 组头：可折叠 */}
            <button
              type="button"
              onClick={() => toggleGroup(group.key)}
              className="w-full flex items-center justify-between px-1 py-2 group"
            >
              <div className="flex items-center gap-2 min-w-0 text-left">
                <CalendarSearch size={14} className="flex-none text-accent" strokeWidth={2} />
                <div className="min-w-0">
                  <h3 className="text-sm font-bold text-primary truncate">{group.label}</h3>
                  {group.sub && (
                    <div className="text-micro text-tertiary font-medium tabular-nums">{group.sub}</div>
                  )}
                </div>
              </div>
              {/* 统计不许折行：被挤时让标题截断，不让「16 动作」拆成两行 */}
              <div className="flex-none whitespace-nowrap flex items-center gap-2.5 text-micro text-tertiary font-medium">
                <span>
                  {group.workouts.length} {isCN ? '场' : 'sess.'}
                </span>
                <span className="text-divider">·</span>
                <span>
                  {totalExercises} {isCN ? '动作' : 'ex.'}
                </span>
                <span className="text-divider">·</span>
                <span>
                  {totalSets} {isCN ? '组' : plural(totalSets, 'set')}
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
                  onResume={() => onResumeFinished(w.id)}
                  canResume={justEnded(w)}
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
