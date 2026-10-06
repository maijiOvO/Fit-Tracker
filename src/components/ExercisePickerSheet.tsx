/**
 * 训练页「添加动作」底部弹层
 *
 * 交互设计（与 App.tsx / NewWorkoutTab 配合）：
 *   - 常驻挂载，open 切换显隐（内部筛选状态跨开合保留 = 筛选记忆；每次打开只清搜索词）
 *   - 部位行（单选，含自定义部位 + 有氧/自由两个伪部位）+ 器材行（多选，联动计数，0 隐藏）
 *   - 点行即添加，弹层不关：行闪烁 + ✓已添加徽标 + 头部「本次已加 N」+ 震动；450ms 双击防误触
 *   - 软键盘弹起时 visualViewport 计算 inset，弹层压缩到键盘上沿
 *   - 手指在弹层任何位置往下拉即可关闭（列表不在顶部时先让列表往回滚）；带部位进来时停在该部位栏
 *   - 标签管理入口在头部（Tags 图标）直达 TagManageModal；长按动作行弹出该动作的管理菜单
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, CircleDashed, Filter, GripVertical, History, Move, PencilLine, Plus, PlusCircle, RotateCcw, Search, Star, Tags, Trash2, X, Zap } from 'lucide-react';
import { ExerciseDefinition, Language } from '../../types';
import { BODY_PARTS } from '../constants/exercises';
import { useExercisePrefs } from '../contexts/ExercisePrefsContext';
import { useUserSettingsContext } from '../contexts/UserSettingsContext';
import { useExerciseStats } from '../hooks/useFilteredExercises';
import { useExercisePickerData, PickerAxis, matchAxis } from '../hooks/useExercisePickerData';
import { useKeyboardInset } from '../hooks/useKeyboardInset';
import { useLongPress } from '../hooks/useLongPress';
import { useRegionDrag } from '../hooks/useRegionDrag';
import { useUiOverlay } from '../contexts/UiOverlayContext';
import { haptic, H } from '../utils/haptics';
import { LongPressAffordance } from './LongPressAffordance';

interface PickerRowProps {
  ex: ExerciseDefinition;
  displayName: string;
  added: number;
  isStarred: boolean;
  partName: string;
  tagNames: { tag: string; name: string; hit: boolean }[];
  isCn: boolean;
  bindRef: (el: HTMLDivElement | null) => void;
  onPick: () => void;
  onLongPress: () => void;
  onToggleStar: () => void;
  /** 细分格的「未细分」组里：长按交给拖到细分（useRegionDrag），这里不再自己管 */
  dragId?: string;
  arranging?: boolean;
}

/**
 * 弹层里的一行动作。
 *
 * 长按＝该动作的管理菜单（编辑标签/重命名/删除），极低频动作（§6.4）。
 * 必须带自解释标签：不加的话连设计者本人都不记得这手势是干嘛的。
 */
const PickerRow: React.FC<PickerRowProps> = ({
  displayName,
  added,
  isStarred,
  partName,
  tagNames,
  isCn,
  bindRef,
  onPick,
  onLongPress,
  onToggleStar,
  dragId,
  arranging = false,
}) => {
  const press = useLongPress({ onLongPress, disabled: !!dragId });
  return (
    <div
      ref={bindRef}
      className="flex items-stretch bg-card border border-divider rounded-card overflow-hidden"
      {...(dragId ? { 'data-drag-host': '' } : {})}
    >
      <button
        type="button"
        onClick={onPick}
        {...press.handlers}
        className="relative flex-1 min-w-0 text-left px-3 py-2.5 flex flex-col gap-1.5 min-h-[60px] active:bg-card-hover transition-colors duration-tap ease-paper select-none touch-pan-y"
        data-testid="picker-sheet-exercise"
        {...(dragId ? { 'data-drag-id': dragId } : {})}
      >
        <span className="flex items-center gap-2 flex-wrap text-sm font-semibold text-primary">
          {displayName}
          {added > 0 && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-chip bg-success/15 text-success text-[10px] font-bold whitespace-nowrap">
              ✓ {isCn ? '已添加' : 'Added'}{added > 1 ? ` ×${added}` : ''}
            </span>
          )}
        </span>
        <span className="flex flex-wrap gap-1">
          {partName && (
            <span className="text-[9px] font-bold uppercase tracking-wide bg-inset px-1.5 py-0.5 rounded-chip text-tertiary">
              {partName}
            </span>
          )}
          {tagNames.map(({ tag, name, hit }) =>
            name ? (
              <span
                key={tag}
                className={`text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-chip ${
                  hit ? 'bg-accent text-on-accent' : 'bg-accent/10 text-accent'
                }`}
              >
                {name}
              </span>
            ) : null,
          )}
        </span>
        <LongPressAffordance
          active={press.pressing}
          label={isCn ? '管理这个动作' : 'Manage'}
          drawMs={press.drawMs}
          placement="down"
        />
      </button>
      {arranging ? (
        <span className="w-11 flex items-center justify-center border-l border-divider text-tertiary" aria-hidden>
          <GripVertical size={18} strokeWidth={2} />
        </span>
      ) : (
        <button
          type="button"
          onClick={e => {
            e.stopPropagation();
            onToggleStar();
          }}
          className="w-11 flex items-center justify-center border-l border-divider text-warning active:scale-press-sm transition-transform duration-tap ease-paper"
          aria-label={isCn ? '收藏' : 'Star'}
        >
          <Star size={18} strokeWidth={2} className={isStarred ? 'fill-warning' : ''} />
        </button>
      )}
    </div>
  );
};

interface RegionCardProps {
  id: string;
  displayName: string;
  added: number;
  isStarred: boolean;
  bindRef: (el: HTMLButtonElement | null) => void;
  onPick: () => void;
}

/**
 * 细分格里的小卡（第 3 条）：动作行的窄版，跟上面部位 / 器材 chip 同一套样子 ——
 * 灰底无边框、粗体；已添加＝朱砂实底（同选中态）；收藏是名字前一颗实心星。
 * 长按（浮起后拖到细分 / 不动松手出管理菜单）由 useRegionDrag 在结果区统一接管。
 */
const RegionCard: React.FC<RegionCardProps> = ({ id, displayName, added, isStarred, bindRef, onPick }) => (
  <button
    ref={bindRef}
    type="button"
    onClick={onPick}
    onContextMenu={e => e.preventDefault()}
    className={`region-card select-none${added ? ' is-added' : ''}`}
    data-testid="picker-region-card"
    data-drag-id={id}
    data-drag-host=""
  >
    <span className="region-card-name">
      {isStarred && <Star size={11} strokeWidth={2} className="inline-block align-[-1px] mr-0.5 fill-current" />}
      {displayName}
      {added > 1 && <span className="region-card-x">×{added}</span>}
    </span>
  </button>
);

interface ExercisePickerSheetProps {
  open: boolean;
  onClose: () => void;
  /**
   * 这次打开要直接停在哪个部位（BODY_PARTS 的 id，如 'subChest'）。
   * 开练时选了「练胸」→ 弹层一打开就是胸部那一栏，不用再点一次。
   * 只在打开的那一刻生效一次；null = 沿用上次的筛选（筛选记忆）。
   */
  focusPart?: string | null;
  /** 小写显示名 -> 当前训练中出现次数（驱动「已添加 ×N」徽标） */
  addedCounts: Record<string, number>;
  /** 本次弹层会话累计添加数（App 维护，含新建动作路径） */
  sessionAdded: number;
  onPickExercise: (ex: ExerciseDefinition) => void;
  onCreateCustomExercise: (prefilledName?: string) => void;
  /** 打开标签管理页（头部 Tags 图标） */
  onOpenTagManage: () => void;
  // ===== 长按动作行的管理菜单（复用 App 层的弹窗/删除流程） =====
  onEditExerciseTags: (ex: ExerciseDefinition) => void;
  onRenameExercise: (id: string, currentName: string) => void;
  onDeleteExercise: (id: string) => void;
}

export const ExercisePickerSheet: React.FC<ExercisePickerSheetProps> = ({
  open,
  onClose,
  focusPart = null,
  addedCounts,
  sessionAdded,
  onPickExercise,
  onCreateCustomExercise,
  onOpenTagManage,
  onEditExerciseTags,
  onRenameExercise,
  onDeleteExercise,
}) => {
  const {
    starredExercises,
    resolveName,
    getTagName,
    toggleStarExercise,
    regionsOf,
    hiddenRegionsOf,
    effectiveRegion,
    applyRegionLayout,
    renameTag,
    addRegionTag,
    moveRegion,
    removeRegion,
    restoreRegion,
  } = useExercisePrefs();
  /**
   * 整理里的细分面板：点某个表头＝{ id }（改名 / 左右移 / 删除）；「＋ 新建细分」＝{ id: '' }。
   * 用户自定义「这个部位有哪些细分、怎么排」都在这里。
   */
  const [regionMenu, setRegionMenu] = useState<{ id: string } | null>(null);
  const [regionDraft, setRegionDraft] = useState('');
  const { toastUndo } = useUiOverlay();
  /** 「整理」：按下即拖、点卡片不添加（一口气给几十个动作归细分时用） */
  const [arranging, setArranging] = useState(false);
  /** 拖到细分的手势已接管（长按满 / 拖拽中）：弹层整张下拉关闭看到它就让路 */
  const regionGestureRef = useRef(false);
  /** 细分格当前每一列（含 '' = 未细分）的顺序，落下 / 归列时据此写序号 */
  const boardColsRef = useRef<Map<string, ExerciseDefinition[]>>(new Map());
  const { lang } = useUserSettingsContext();
  const { recentExerciseNames } = useExerciseStats();
  const isCn = lang === Language.CN;

  // ===== 筛选状态（跨开合保留；仅搜索词随打开重置） =====
  const [query, setQuery] = useState('');
  const [axis, setAxis] = useState<PickerAxis>(null);
  const [equips, setEquips] = useState<ReadonlySet<string>>(new Set());

  const { results, equipCounts, axisAvailable, equipIds, customPartIds, boardPart } =
    useExercisePickerData({ query, axis, equips });

  const inset = useKeyboardInset(open);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const resultsRef = useRef<HTMLDivElement | null>(null);
  const rowRefs = useRef<Map<string, HTMLElement>>(new Map());
  const lastPickRef = useRef<{ id: string; t: number }>({ id: '', t: 0 });
  // 长按动作行 → 该动作的管理菜单（编辑标签 / 重命名 / 删除）
  const [menuFor, setMenuFor] = useState<ExerciseDefinition | null>(null);
  // 键盘弹起时筛选区收起为摘要行（点摘要可临时展开，键盘收起后自动复原）
  const [kbExpandFilters, setKbExpandFilters] = useState(false);
  /**
   * 长按出菜单后，吞掉松手带出的那次 click（不算「添加」）。
   * 用时间戳不用布尔：菜单一弹出就盖在手指下面，那次 click 往往根本落不到行上，
   * 布尔立起来就没人清 —— 用完长按菜单后的下一次正常点选会被吃掉（§12.5 粘滞布尔）。
   */
  const suppressClickRef = useRef(0);
  const sheetRef = useRef<HTMLElement | null>(null);
  const dragRef = useRef<{ startY: number; y: number } | null>(null);

  // ===== 下拉关闭（向下拖 > 110px 松手即关闭，否则弹回） =====
  // 手指：整张弹层任何位置都能往下拉（见下面的 touch 监听）。
  // 鼠标：只有抓手与头部，桌面上没有「顺手往下一划」这回事，按住列表拖会跟选字打架。
  const handleDragStart = (e: React.PointerEvent) => {
    if (!open || e.pointerType !== 'mouse') return;
    dragRef.current = { startY: e.clientY, y: 0 };
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* noop */ }
    if (sheetRef.current) sheetRef.current.style.transition = 'none';
  };
  const handleDragMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d || e.pointerType !== 'mouse') return;
    d.y = Math.max(0, e.clientY - d.startY);
    if (sheetRef.current) sheetRef.current.style.transform = `translateY(${d.y}px)`;
  };
  const handleDragEnd = () => {
    const d = dragRef.current;
    if (!d) return;
    dragRef.current = null;
    const el = sheetRef.current;
    if (el) el.style.transition = '';
    const shouldClose = d.y > 110;
    if (shouldClose) onClose();
    // 等 class 状态先生效，再清掉内联 transform，让过渡从当前拖动位置开始
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (el) el.style.transform = '';
      });
    });
  };
  // 指针的松手只收鼠标拖动；手指拖动由下面 touchend 收尾（pointerup 先到，会抢在它前面）
  const handlePointerEnd = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse') handleDragEnd();
  };
  const dragEndRef = useRef(handleDragEnd);
  dragEndRef.current = handleDragEnd;
  const openRef = useRef(open);
  openRef.current = open;

  /**
   * 手指下拉关闭：整张弹层都是热区，不用再够到顶上那根横条。
   *
   * 走原生 touch 监听而不是 pointer：列表要能正常滚，热区不能 touch-action:none，
   * 而那样的话浏览器一旦把手势认作滚动就会发 pointercancel，拖到一半就断了。
   * 这里在第一个 touchmove 就做决定，要接管就立刻 preventDefault（必须非被动监听，
   * React 的 onTouchMove 挂在根上是被动的，拦不住），浏览器的滚动根本起不来。
   *
   * 什么时候接管：往下拉，并且——起手不在列表里，或列表已经在顶上。
   * 列表滚到一半时往下拉＝往回滚，照旧交给列表；往上推、横向划一律不管。
   */
  useEffect(() => {
    const el = sheetRef.current;
    if (!el) return;
    /** 超过这么多才下结论。要小于浏览器自己的触摸容差（Android Chrome 约 15px），抢在它前面 */
    const DECIDE_PX = 4;
    let t: { x0: number; y0: number; fromList: boolean; mode: 'undecided' | 'drag' | 'pass' } | null = null;
    // 拖过之后松手，浏览器可能还会补一个 click 落在起手那一行上 —— 那会把动作加进去。
    // 这个 click 只会紧跟在 touchend 后面到；限时作废，免得没来的时候把下一次正常点击吞掉。
    let swallowClick = false;
    let swallowTimer: number | undefined;

    const onStart = (e: TouchEvent) => {
      swallowClick = false;
      if (!openRef.current || e.touches.length !== 1) {
        t = null;
        return;
      }
      const target = e.target as Node;
      t = {
        x0: e.touches[0].clientX,
        y0: e.touches[0].clientY,
        fromList: !!resultsRef.current?.contains(target),
        mode: 'undecided',
      };
    };
    const onMove = (e: TouchEvent) => {
      if (!t || t.mode === 'pass') return;
      // 拖到细分接管了这次触摸（长按满 / 整理模式）：整次手势都不归弹层
      if (regionGestureRef.current && t.mode === 'undecided') {
        t.mode = 'pass';
        return;
      }
      if (e.touches.length !== 1) {
        if (t.mode === 'drag') dragEndRef.current();
        t = null;
        return;
      }
      const dx = e.touches[0].clientX - t.x0;
      const dy = e.touches[0].clientY - t.y0;
      if (t.mode === 'undecided') {
        if (Math.abs(dx) < DECIDE_PX && Math.abs(dy) < DECIDE_PX) return;
        const listAtTop = (resultsRef.current?.scrollTop ?? 0) <= 0;
        if (dy > 0 && Math.abs(dy) > Math.abs(dx) && (!t.fromList || listAtTop)) {
          t.mode = 'drag';
          // 从这一刻起的位移才算，免得一接管就跳 4px
          t.y0 = e.touches[0].clientY;
          dragRef.current = { startY: t.y0, y: 0 };
          el.style.transition = 'none';
          // 输入框里起手往下拉：先收键盘，否则弹层在键盘上面被拖着走
          (document.activeElement as HTMLElement | null)?.blur?.();
        } else {
          t.mode = 'pass';
          return;
        }
      }
      e.preventDefault();
      const d = dragRef.current;
      if (!d) return;
      d.y = Math.max(0, e.touches[0].clientY - d.startY);
      el.style.transform = `translateY(${d.y}px)`;
    };
    const onEnd = () => {
      if (t?.mode === 'drag') {
        if ((dragRef.current?.y ?? 0) > DECIDE_PX) {
          swallowClick = true;
          window.clearTimeout(swallowTimer);
          swallowTimer = window.setTimeout(() => (swallowClick = false), 400);
        }
        dragEndRef.current();
      }
      t = null;
    };
    const onClickCapture = (e: MouseEvent) => {
      if (!swallowClick) return;
      swallowClick = false;
      e.stopPropagation();
      e.preventDefault();
    };

    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd);
    el.addEventListener('touchcancel', onEnd);
    el.addEventListener('click', onClickCapture, true);
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
      el.removeEventListener('click', onClickCapture, true);
      window.clearTimeout(swallowTimer);
    };
  }, []);

  // 打开：清搜索词、结果滚回顶部；关闭：收键盘
  useEffect(() => {
    if (open) {
      setQuery('');
      // 选过部位 → 部位栏直接落在那一格。器材筛选一并清掉：带着上次的器材
      // 进来，「胸部」下面可能只剩两三个动作，看起来像动作库不全。
      if (focusPart) {
        setAxis({ kind: 'part', v: focusPart });
        setEquips(new Set());
      }
      if (resultsRef.current) resultsRef.current.scrollTop = 0;
    } else {
      searchInputRef.current?.blur();
      setMenuFor(null);
      setArranging(false);
      setRegionMenu(null);
    }
  }, [open]);

  const kbOpen = inset > 0;
  useEffect(() => {
    if (!kbOpen) setKbExpandFilters(false);
  }, [kbOpen]);
  const filtersCollapsed = kbOpen && !kbExpandFilters;

  // 弹层打开时锁定背景滚动
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // ===== 分组 =====
  const q = query.trim();
  const { starredGroup, recentGroup, otherGroup, flatGroup, rank } = useMemo(() => {
    const boost = (ex: ExerciseDefinition) => {
      const key = resolveName(ex.name[lang]).toLowerCase();
      const starSet = new Set(Object.keys(starredExercises).map(k => k.toLowerCase()));
      const isStar = starSet.has(key);
      const isRecent = recentExerciseNames.some(n => n.toLowerCase() === key);
      return (isStar ? 15 : 0) + (isRecent ? 8 : 0);
    };

    if (q) {
      // 搜索模式：拉平，按匹配分 + 常用/最近加权排序
      const flat = [...results]
        .sort((a, b) => b.score + boost(b.ex) - (a.score + boost(a.ex)))
        .map(r => r.ex);
      return { starredGroup: [], recentGroup: [], otherGroup: [], flatGroup: flat, rank: new Map<string, number>() };
    }

    // 浏览模式：常用 → 最近 → 其余（与原 ExercisePicker 一致）
    const starSet = new Set(Object.keys(starredExercises).map(k => k.toLowerCase()));
    const recentSet = new Set(recentExerciseNames.map(n => n.toLowerCase()));
    const starred: ExerciseDefinition[] = [];
    const recent: ExerciseDefinition[] = [];
    const other: ExerciseDefinition[] = [];
    for (const { ex } of results) {
      const key = resolveName(ex.name[lang]).toLowerCase();
      if (starSet.has(key)) starred.push(ex);
      else if (recentSet.has(key)) recent.push(ex);
      else other.push(ex);
    }
    const starScore = new Map<string, number>();
    for (const [k, v] of Object.entries(starredExercises)) {
      starScore.set(k.toLowerCase(), Number(v ?? 0));
    }
    starred.sort((a, b) => {
      const ka = resolveName(a.name[lang]).toLowerCase();
      const kb = resolveName(b.name[lang]).toLowerCase();
      return (starScore.get(kb) ?? 0) - (starScore.get(ka) ?? 0);
    });
    const seen = new Set<string>();
    const dedupedRecent = recent.filter(ex => {
      const key = resolveName(ex.name[lang]).toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    dedupedRecent.sort((a, b) => {
      const ka = resolveName(a.name[lang]).toLowerCase();
      const kb = resolveName(b.name[lang]).toLowerCase();
      return (
        recentExerciseNames.findIndex(n => n.toLowerCase() === ka)
        - recentExerciseNames.findIndex(n => n.toLowerCase() === kb)
      );
    });
    // 细分格的列内排序：收藏 → 最近 → 其余（库内顺序），跟上面三组同一个口径
    const rank = new Map<string, number>();
    [...starred, ...dedupedRecent, ...other].forEach((ex, i) => rank.set(ex.id, i));
    return { starredGroup: starred, recentGroup: dedupedRecent, otherGroup: other, flatGroup: [], rank };
  }, [q, results, starredExercises, recentExerciseNames, resolveName, lang]);

  const totalCount = results.length;
  const searchHere = axis ? flatGroup.filter(ex => matchAxis(ex, axis)) : flatGroup;
  const searchRest = axis ? flatGroup.filter(ex => !matchAxis(ex, axis)) : [];
  const hasExactMatch =
    q.length > 0
    && results.some(r => resolveName(r.ex.name[lang]).toLowerCase() === q.toLowerCase());
  const nFilters = (axis ? 1 : 0) + equips.size;
  /**
   * 整理视图：搜索 / 部位 / 器材 / 计数在整理时没用（就是在给当前部位排列），收起来把格子顶上去。
   * 走查实测：不收的话 384×854 上格子只露一行半，「未细分」在下面很远，往上拖时目标列不在屏上。
   */
  const arrangeView = !!boardPart && arranging;

  // ===== 浏览轴 chips =====
  const axisChips = useMemo(() => {
    const parts = BODY_PARTS.map(p => ({ kind: 'part' as const, v: p, custom: false }));
    const customParts = customPartIds.map(id => ({ kind: 'part' as const, v: id, custom: true }));
    const cats = [
      { kind: 'cat' as const, v: 'CARDIO', custom: false },
      { kind: 'cat' as const, v: 'FREE', custom: false },
    ];
    return [...parts, ...customParts, ...cats];
  }, [customPartIds]);

  const axisLabel = (chip: { kind: 'part' | 'cat'; v: string }) => {
    if (chip.kind === 'cat') {
      if (chip.v === 'CARDIO') return isCn ? '有氧' : 'Cardio';
      return isCn ? '自由' : 'Free';
    }
    return getTagName(chip.v);
  };

  // 收起态摘要：已选部位 + 已选器材名
  const filterSummary = (() => {
    const parts: string[] = [];
    if (axis) parts.push(axisLabel(axis));
    for (const id of equipIds) {
      if (equips.has(id.toLowerCase())) {
        const n = getTagName(id);
        if (n) parts.push(n);
      }
    }
    return parts.join(' · ');
  })();

  /**
   * 放进某个细分（拖拽落下 / 菜单里点细分都走这里）。
   * 拖拽落下（idx 有值）或这一列已经手动排过：整列按当前顺序写序号，从此这一列按手动顺序；
   * 菜单归列且这一列没排过：只写细分，照默认排序。'' = 放回未细分（去掉序号）。
   */
  const placeInRegion = (exId: string, region: string, idx: number | null, fallback?: ExerciseDefinition) => {
    // 不在细分格里（从「全部」列表的长按菜单进来）：格子的列顺序不可信，只写这一个动作，接在列尾
    const inBoard = !!boardPart && [...boardColsRef.current.values()].flat().some(e => e.id === exId);
    const cols = inBoard ? boardColsRef.current : new Map<string, ExerciseDefinition[]>();
    const all = inBoard ? [...cols.values()].flat() : fallback ? [fallback] : [];
    const ex = all.find(e => e.id === exId);
    if (!ex) return;
    const before = all.map(e => ({ id: e.id, region: e.region ?? '', regionRank: e.regionRank }));
    const fromRegion = effectiveRegion(ex) ?? '';
    let changes: { id: string; region: string; regionRank?: number }[];
    if (region) {
      const others = (cols.get(region) ?? []).filter(e => e.id !== exId);
      if (idx != null || others.some(e => e.regionRank != null)) {
        const at = idx == null ? others.length : Math.min(idx, others.length);
        const order = [...others.slice(0, at), ex, ...others.slice(at)];
        changes = order.map((e, i) => ({ id: e.id, region, regionRank: i }));
      } else {
        changes = [{ id: exId, region }];
      }
    } else {
      changes = [{ id: exId, region: '' }];
    }
    applyRegionLayout(changes);
    haptic(H.tap);
    const msg =
      region === fromRegion
        ? isCn ? '已调整顺序' : 'Order updated'
        : region
          ? isCn ? `已归到「${getTagName(region)}」` : `Moved to ${getTagName(region)}`
          : isCn ? '已放回未细分' : 'Back to unassigned';
    toastUndo(msg, () => applyRegionLayout(before));
    // 落到哪一列，那张卡渗一下墨
    window.requestAnimationFrame(() => {
      const el = rowRefs.current.get(exId);
      if (!el) return;
      el.classList.remove('anim-ink-mark');
      void el.offsetWidth;
      el.classList.add('anim-ink-mark');
    });
  };

  useRegionDrag({
    resultsRef,
    sheetRef,
    enabled: !!boardPart,
    arranging,
    activeRef: regionGestureRef,
    suppressClickRef,
    liftLabel: isCn ? '拖到细分' : 'Drag to a region',
    describe: id => {
      const ex = [...boardColsRef.current.values()].flat().find(e => e.id === id);
      if (!ex) return null;
      const name = resolveName(ex.name[lang]);
      return { name, starred: Object.keys(starredExercises).some(k => k.toLowerCase() === name.toLowerCase()) };
    },
    onMenu: id => {
      const ex = [...boardColsRef.current.values()].flat().find(e => e.id === id);
      if (ex) setMenuFor(ex);
    },
    onDrop: (id, target, idx) => placeInRegion(id, target, idx),
  });

  // ===== 添加 =====
  const handlePick = (ex: ExerciseDefinition) => {
    const now = Date.now();
    if (lastPickRef.current.id === ex.id && now - lastPickRef.current.t < 450) return;
    lastPickRef.current = { id: ex.id, t: now };
    try {
      haptic(H.pick);
    } catch {
      /* noop */
    }
    const row = rowRefs.current.get(ex.id);
    if (row) {
      // remove → offsetWidth → add 的强制重排触发法保留（写得对，能重放同一条动画）
      row.classList.remove('anim-ink-mark');
      void row.offsetWidth;
      row.classList.add('anim-ink-mark');
    }
    onPickExercise(ex);
  };

  // ===== 行渲染 =====
  // 提成真组件而不是 renderRow 函数：长按要用 useLongPress，
  // 而 hook 不能写在 .map() 的回调里。
  const renderRow = (ex: ExerciseDefinition, inBoard = false) => {
    const displayName = resolveName(ex.name[lang]);
    const key = displayName.toLowerCase();
    return (
      <PickerRow
        key={ex.id}
        ex={ex}
        displayName={displayName}
        added={addedCounts[key] || 0}
        isStarred={Object.keys(starredExercises).some(k => k.toLowerCase() === key)}
        partName={ex.bodyPart ? getTagName(ex.bodyPart) : ''}
        tagNames={(ex.tags ?? []).slice(0, 3).map(t => ({ tag: t, name: getTagName(t), hit: equips.has((t || '').toLowerCase()) }))}
        isCn={isCn}
        bindRef={bindItemRef(ex.id)}
        onPick={() => {
          if (performance.now() - suppressClickRef.current < 450) {
            suppressClickRef.current = 0;
            return;
          }
          if (inBoard && arranging) return; // 整理时点选不添加
          handlePick(ex);
        }}
        onLongPress={() => {
          suppressClickRef.current = performance.now(); // 松手后的 click 不再当作「添加」
          setMenuFor(ex);
        }}
        onToggleStar={() => toggleStarExercise(displayName)}
        dragId={inBoard ? ex.id : undefined}
        arranging={inBoard && arranging}
      />
    );
  };

  const bindItemRef = (id: string) => (el: HTMLElement | null) => {
    if (el) rowRefs.current.set(id, el);
    else rowRefs.current.delete(id);
  };

  const renderCard = (ex: ExerciseDefinition) => {
    const displayName = resolveName(ex.name[lang]);
    const key = displayName.toLowerCase();
    return (
      <RegionCard
        key={ex.id}
        id={ex.id}
        displayName={displayName}
        added={addedCounts[key] || 0}
        isStarred={Object.keys(starredExercises).some(k => k.toLowerCase() === key)}
        bindRef={bindItemRef(ex.id)}
        onPick={() => {
          if (performance.now() - suppressClickRef.current < 450) {
            suppressClickRef.current = 0;
            return;
          }
          if (arranging) return; // 整理时点卡片不添加
          handlePick(ex);
        }}
      />
    );
  };

  /**
   * 细分格（第 3 条）：上面一排吸顶的细分表头，每个细分下面一列小卡；
   * 没归细分的用现有动作行列在格子下面。细分超过 5 列时横向滑动。
   */
  const renderBoard = (part: string) => {
    const regs = regionsOf(part);
    const items = results.map(r => r.ex).sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
    // 列内顺序：手动排过的（regionRank）在前按序号，没排过的接在后面按默认（收藏 → 最近 → 其余）
    const byRank = (arr: ExerciseDefinition[]) => [
      ...arr.filter(e => e.regionRank != null).sort((a, b) => a.regionRank! - b.regionRank!),
      ...arr.filter(e => e.regionRank == null),
    ];
    const by = new Map<string, ExerciseDefinition[]>(regs.map(r => [r.id, []]));
    const unassigned: ExerciseDefinition[] = [];
    for (const ex of items) {
      const rg = effectiveRegion(ex);
      const col = rg ? by.get(rg) : undefined;
      if (col) col.push(ex);
      else unassigned.push(ex);
    }
    for (const [k, arr] of by) by.set(k, byRank(arr));
    boardColsRef.current = new Map([...by, ['', unassigned]]);
    const scroll = regs.length > 5;
    return (
      <>
        {arranging && (
          <div className="flex justify-end pt-1">
            <button
              type="button"
              onClick={() => {
                setRegionDraft('');
                setRegionMenu({ id: '' });
              }}
              className="min-h-[34px] px-3 rounded-control text-xs font-bold text-accent border border-dashed border-accent/40 active:bg-accent/10 transition-colors flex items-center gap-1.5"
              data-testid="region-new"
            >
              <PlusCircle size={13} /> {isCn ? '新建细分' : 'New region'}
            </button>
          </div>
        )}
        <div
          className={`region-board${scroll ? ' is-scroll' : ''}`}
          style={{ ['--region-cols' as string]: regs.length }}
          data-testid="picker-region-board"
          data-region-board=""
        >
          <div className="region-grid region-heads">
            {regs.map(r =>
              arranging ? (
                <button
                  key={r.id}
                  type="button"
                  className="region-head is-editable"
                  data-region-head={r.id}
                  data-testid="region-head-edit"
                  onClick={() => {
                    setRegionDraft(getTagName(r.id));
                    setRegionMenu({ id: r.id });
                  }}
                >
                  <b>{getTagName(r.id)}</b>
                  <i>{by.get(r.id)!.length}</i>
                </button>
              ) : (
                <div key={r.id} className="region-head" data-region-head={r.id}>
                  <b>{getTagName(r.id)}</b>
                  <i>{by.get(r.id)!.length}</i>
                </div>
              ),
            )}
          </div>
          <div className="region-grid">
            {regs.map(r => (
              <div key={r.id} className="region-col" role="group" aria-label={getTagName(r.id)} data-region-col={r.id}>
                {by.get(r.id)!.length ? (
                  by.get(r.id)!.map(renderCard)
                ) : (
                  <div className="region-card is-empty" aria-hidden>
                    —
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
        {/* 「未细分」那一片也是落点：拖进来＝放回未细分。空着时只在整理里留一块落点 */}
        <div className="region-unzone" data-region-col="">
          {arranging && unassigned.length > 0 ? (
            // 整理：未细分也排成小卡（同一套列宽），就在格子正下方，拖动距离短
            <>
              <div className="flex items-center gap-1.5 mb-2 px-0.5 mt-3">
                <CircleDashed size={13} className="text-tertiary" />
                <h3 className="text-[11px] font-bold text-primary uppercase tracking-[0.12em]">
                  {isCn ? '未细分' : 'Unassigned'}
                </h3>
                <span className="text-[10px] font-bold text-tertiary">· {unassigned.length}</span>
              </div>
              <div className="region-tray" data-drop-body="" style={{ ['--region-cols' as string]: Math.min(regs.length, 5) || 5 }}>
                {unassigned.map(renderCard)}
              </div>
            </>
          ) : unassigned.length > 0
            ? renderGroup(
                <CircleDashed size={13} className="text-tertiary" />,
                isCn ? '未细分' : 'Unassigned',
                unassigned,
                true,
              )
            : arranging && <div className="region-card is-empty mt-3 min-h-[60px]" aria-hidden />}
        </div>
      </>
    );
  };

  const renderGroup = (icon: React.ReactNode, title: string, items: ExerciseDefinition[], inBoard = false) => {
    if (items.length === 0) return null;
    return (
      <div key={title}>
        <div className="flex items-center gap-1.5 mb-2 px-0.5 mt-3 first:mt-1">
          {icon}
          <h3 className="text-[11px] font-bold text-primary uppercase tracking-[0.12em]">{title}</h3>
          <span className="text-[10px] font-bold text-tertiary">· {items.length}</span>
        </div>
        <div className="space-y-2" {...(inBoard ? { 'data-drop-body': '' } : {})}>
          {items.map(ex => renderRow(ex, inBoard))}
        </div>
      </div>
    );
  };

  return (
    <div
      className={`fixed inset-0 z-sheet ${open ? '' : 'pointer-events-none'}`}
      aria-hidden={!open}
    >
      {/* 蒙层 */}
      <div
        className={`absolute inset-0 bg-scrim transition-opacity duration-base ease-paper ${
          open ? 'opacity-100' : 'opacity-0'
        }`}
        onClick={onClose}
      />

      {/* 弹层 */}
      <section
        ref={sheetRef}
        className={`absolute inset-x-0 mx-auto max-w-2xl bg-base border-t border-divider rounded-t-[22px] shadow-elevated flex flex-col transition-transform duration-300 ease-out ${
          open ? 'translate-y-0' : 'translate-y-[103%]'
        }`}
        style={{
          bottom: inset,
          height: '90dvh',
          maxHeight: `max(300px, calc(100dvh - ${inset + 44}px))`,
        }}
        aria-label={isCn ? '添加动作' : 'Add exercise'}
        data-testid="picker-sheet"
      >
        <div
          className="flex-shrink-0 pt-2.5 pb-1.5 cursor-grab active:cursor-grabbing select-none"
          style={{ touchAction: 'none' }}
          onPointerDown={handleDragStart}
          onPointerMove={handleDragMove}
          onPointerUp={handlePointerEnd}
          onPointerCancel={handlePointerEnd}
        >
          <div className="w-12 h-1.5 rounded-full bg-divider mx-auto" />
        </div>

        {/* 头部：标题 + 本次已加 + 关闭；整行（按钮除外）也是拖拽关闭的热区 */}
        <div
          className="flex items-center gap-2.5 px-4 pt-1.5 pb-0.5 flex-shrink-0 select-none cursor-grab active:cursor-grabbing"
          style={{ touchAction: 'none' }}
          onPointerDown={e => {
            if ((e.target as HTMLElement).closest('button')) return;
            handleDragStart(e);
          }}
          onPointerMove={handleDragMove}
          onPointerUp={handlePointerEnd}
          onPointerCancel={handlePointerEnd}
        >
          <h2 className="font-display text-lg font-semibold text-primary">
            {arrangeView
              ? `${isCn ? '整理' : 'Arrange'} · ${getTagName(boardPart!)}`
              : isCn ? '添加动作' : 'Add Exercise'}
          </h2>
          {sessionAdded > 0 && !arrangeView && (
            <span
              key={sessionAdded}
              className="anim-ink-mark inline-flex items-center gap-1 px-2.5 py-1 rounded-control bg-success/15 text-success text-[11px] font-bold"
            >
              ✓ {isCn ? `本次已加 ${sessionAdded}` : `Added ${sessionAdded}`}
            </span>
          )}
          {boardPart && (
            <button
              type="button"
              onClick={() => setArranging(a => !a)}
              aria-pressed={arranging}
              className={`ml-auto min-h-[34px] px-3 rounded-control text-xs font-bold flex items-center gap-1.5 transition-colors ${
                arranging ? 'bg-accent text-on-accent shadow-elevated' : 'bg-inset text-secondary'
              }`}
              data-testid="region-arrange"
            >
              <Move size={14} strokeWidth={2} />
              {arranging ? (isCn ? '完成' : 'Done') : isCn ? '整理' : 'Arrange'}
            </button>
          )}
          <button
            type="button"
            onClick={onOpenTagManage}
            className={`${boardPart ? '' : 'ml-auto '}w-11 h-11 flex items-center justify-center rounded-control text-secondary hover:bg-card-hover active:scale-press-sm transition-ui`}
            aria-label={isCn ? '管理标签' : 'Manage tags'}
            data-testid="open-tag-manage"
          >
            <Tags size={20} />
          </button>
          <button
            type="button"
            onClick={onClose}
            className="w-11 h-11 flex items-center justify-center rounded-control text-secondary hover:bg-card-hover active:scale-press-sm transition-ui"
            aria-label={isCn ? '完成并关闭' : 'Done'}
            data-testid="picker-sheet-close"
          >
            <X size={21} />
          </button>
        </div>

        {/* 搜索行 */}
        <div className={`flex gap-2 px-4 pt-1.5 pb-2.5 flex-shrink-0${arrangeView ? ' hidden' : ''}`}>
          <div className="relative flex-1">
            <Search
              size={16}
              className="absolute left-3.5 top-1/2 -translate-y-1/2 text-tertiary pointer-events-none"
            />
            <input
              ref={searchInputRef}
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              }}
              enterKeyHint="search"
              autoComplete="off"
              className="w-full min-h-[46px] bg-inset border border-divider rounded-card pl-10 pr-10 text-sm text-primary outline-none focus:border-accent transition-colors placeholder:text-tertiary"
              placeholder={isCn ? '名称 / 拼音 / 首字母 / 部位…' : 'Name / initials / body part…'}
              aria-label={isCn ? '搜索动作' : 'Search exercises'}
            />
            {query && (
              <button
                type="button"
                onClick={() => {
                  setQuery('');
                  searchInputRef.current?.focus();
                }}
                className="absolute right-1 top-1/2 -translate-y-1/2 w-9 h-9 flex items-center justify-center rounded-control text-tertiary active:bg-card-hover"
                aria-label={isCn ? '清除搜索' : 'Clear search'}
              >
                <X size={15} strokeWidth={2.4} />
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={() => onCreateCustomExercise(q || undefined)}
            className="flex-shrink-0 min-h-[46px] px-3.5 rounded-card bg-accent text-on-accent text-xs font-bold flex items-center gap-1 active:scale-press-sm transition-transform"
          >
            <Plus size={14} strokeWidth={2.5} />
            {isCn ? '新动作' : 'New'}
          </button>
        </div>

        {/* 筛选区收起态：一行摘要（键盘弹起时） */}
        {filtersCollapsed && !arrangeView && (
          <div className="flex items-center gap-2 px-4 pb-2 flex-shrink-0">
            <button
              type="button"
              onClick={() => setKbExpandFilters(true)}
              className="flex-1 min-w-0 min-h-[36px] px-3 rounded-control bg-inset text-[11px] font-bold text-secondary flex items-center gap-1.5 active:bg-card-hover transition-colors"
              data-testid="filters-summary"
            >
              <Filter size={12} className="flex-shrink-0" />
              <span className="truncate">
                {nFilters > 0 ? filterSummary : isCn ? '筛选已收起' : 'Filters hidden'}
              </span>
              <ChevronDown size={13} className="ml-auto flex-shrink-0" />
            </button>
            {nFilters > 0 && (
              <button
                type="button"
                onClick={() => {
                  setAxis(null);
                  setEquips(new Set());
                }}
                className="w-9 min-h-[36px] flex-shrink-0 flex items-center justify-center rounded-control bg-inset text-tertiary active:scale-press-sm transition-transform"
                aria-label={isCn ? '清空筛选' : 'Clear filters'}
              >
                <X size={14} />
              </button>
            )}
          </div>
        )}

        {/* 部位行（单选，铺开多行，0 结果隐藏） */}
        {!filtersCollapsed && !arrangeView && (
        <div className="flex flex-wrap gap-2 px-4 pb-2.5 flex-shrink-0 items-center">
          <span className="text-[10px] font-bold text-tertiary tracking-wider w-7 flex-shrink-0">
            {isCn ? '部位' : 'PART'}
          </span>
          <button
            type="button"
            onClick={() => setAxis(null)}
            className={`flex-shrink-0 min-h-[38px] px-3.5 rounded-control text-xs font-bold transition-colors ${
              axis === null ? 'bg-accent text-on-accent shadow-elevated' : 'bg-inset text-secondary'
            }`}
          >
            {isCn ? '全部' : 'All'}
          </button>
          {axisChips.map(chip => {
            const on = axis !== null && axis.kind === chip.kind && axis.v === chip.v;
            const availKey =
              chip.kind === 'part' ? 'part:' + chip.v.toLowerCase() : 'cat:' + chip.v;
            // 当前筛选下 0 结果的部位直接隐藏（与器材行同规则），已选中的除外
            if (!on && !axisAvailable.has(availKey)) return null;
            const label = axisLabel(chip);
            if (!label) return null;
            return (
              <button
                key={chip.kind + chip.v}
                type="button"
                onClick={() => setAxis(on ? null : { kind: chip.kind, v: chip.v })}
                className={`flex-shrink-0 min-h-[38px] px-3.5 rounded-control text-xs font-bold transition-colors ${
                  on
                    ? 'bg-accent text-on-accent shadow-elevated'
                    : chip.custom
                      ? 'bg-accent/5 text-accent border border-dashed border-accent/40'
                      : 'bg-inset text-secondary'
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
        )}

        {/* 器材行（多选，联动计数，0 隐藏，铺开多行）—— 与部位行用分隔线隔开 */}
        {!filtersCollapsed && !arrangeView && (
        <div className="mx-4 pt-2.5 pb-2.5 flex-shrink-0 border-t border-divider flex flex-wrap gap-2 items-center">
          <span className="text-[10px] font-bold text-tertiary tracking-wider w-7 flex-shrink-0">
            {isCn ? '器材' : 'GEAR'}
          </span>
          {equipIds.map(id => {
            const n = equipCounts.get(id) ?? 0;
            const on = equips.has(id.toLowerCase());
            if (n === 0 && !on) return null;
            const label = getTagName(id);
            if (!label) return null;
            return (
              <button
                key={id}
                type="button"
                onClick={() => {
                  const next = new Set(equips);
                  const key = id.toLowerCase();
                  if (next.has(key)) next.delete(key);
                  else next.add(key);
                  setEquips(next);
                }}
                className={`flex-shrink-0 min-h-[34px] px-3 rounded-control text-[11px] font-bold flex items-center gap-1.5 transition-colors ${
                  on ? 'bg-accent text-on-accent shadow-elevated' : 'bg-inset text-secondary'
                }`}
              >
                {label}
                <span
                  className={`text-[10px] font-bold tabular-nums ${
                    on ? 'text-on-accent/75' : 'text-tertiary'
                  }`}
                >
                  {n}
                </span>
              </button>
            );
          })}
        </div>
        )}

        {/* 计数 / 清空 */}
        {(q || nFilters > 0) && !arrangeView && (
          <div className="flex items-center justify-between px-4 pb-1.5 flex-shrink-0 text-[11px] font-semibold text-tertiary">
            <span>
              <b className="text-secondary">{totalCount}</b> {isCn ? '个结果' : 'results'}
              {nFilters > 0 && ` · ${nFilters} ${isCn ? '个筛选' : 'filters'}`}
            </span>
            {nFilters > 0 && (
              <button
                type="button"
                onClick={() => {
                  setAxis(null);
                  setEquips(new Set());
                }}
                className="text-accent font-bold min-h-[32px] px-1"
              >
                {isCn ? '清空筛选' : 'Clear'}
              </button>
            )}
          </div>
        )}

        {/* 结果列表 */}
        <div
          ref={resultsRef}
          className={`flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 custom-scrollbar ${
            boardPart ? 'pb-24' : 'pb-6'
          }${boardPart && arranging ? ' is-arranging' : ''}`}
        >
          {q ? (
            axis ? (
              <>
                {renderGroup(<Search size={13} className="text-accent" />, axisLabel(axis), searchHere)}
                {renderGroup(
                  <Search size={13} className="text-accent" />,
                  axis.kind === 'part' ? (isCn ? '其他部位' : 'Other parts') : isCn ? '其他' : 'Others',
                  searchRest,
                )}
              </>
            ) : (
              renderGroup(<Search size={13} className="text-accent" />, isCn ? '搜索结果' : 'Results', flatGroup)
            )
          ) : boardPart ? (
            renderBoard(boardPart)
          ) : (
            <>
              {renderGroup(
                <Star size={13} className="text-warning fill-warning" />,
                isCn ? '我的常用' : 'Favorites',
                starredGroup,
              )}
              {renderGroup(
                <History size={13} className="text-accent" />,
                isCn ? '最近练过' : 'Recent',
                recentGroup,
              )}
              {renderGroup(
                <Zap size={13} className="text-tertiary" />,
                starredGroup.length + recentGroup.length > 0
                  ? (isCn ? '更多' : 'More')
                  : (isCn ? '全部动作' : 'All Exercises'),
                otherGroup,
              )}
            </>
          )}

          {totalCount === 0 && (
            <div className="text-center pt-9 pb-2 text-sm font-semibold text-secondary">
              <Search size={32} className="mx-auto mb-2.5 text-tertiary" strokeWidth={1.5} />
              {q
                ? (isCn ? '动作库里没有匹配的动作' : 'No matching exercise')
                : (isCn ? '当前筛选下没有动作' : 'No exercises under current filters')}
            </div>
          )}

          {q && !hasExactMatch && (
            <button
              type="button"
              onClick={() => onCreateCustomExercise(q)}
              className="w-full min-h-[46px] mt-3 border border-dashed border-divider rounded-card text-accent text-sm font-bold flex items-center justify-center gap-2 active:bg-card-hover transition-colors"
            >
              <Plus size={15} strokeWidth={2.5} />
              {isCn ? `没找到？创建「${q}」` : `Create "${q}"`}
            </button>
          )}
        </div>
      </section>

      {/* 整理里的细分面板：改名 / 左右移 / 删除，或新建 + 恢复删掉的系统细分 */}
      {regionMenu && boardPart && (() => {
        const part = boardPart;
        const ids = regionsOf(part).map(r => r.id);
        const id = regionMenu.id;
        const i = ids.indexOf(id);
        const hidden = hiddenRegionsOf(part);
        const close = () => setRegionMenu(null);
        const btn =
          'w-full min-h-[48px] px-4 rounded-card bg-card border border-divider text-sm font-bold text-primary flex items-center gap-2.5 active:bg-card-hover transition-colors disabled:opacity-40';
        const commit = () => {
          const name = regionDraft.trim();
          if (!name) return;
          if (id) {
            if (name !== getTagName(id) && !renameTag(id, name)) return;
            close();
          } else if (addRegionTag(part, name)) close();
        };
        return (
          <div
            className="absolute inset-0 z-10 bg-scrim flex items-end sm:items-center justify-center anim-fade"
            onClick={close}
            data-testid="region-menu"
          >
            <div
              className="bg-inset border-t sm:border border-divider w-full sm:max-w-sm rounded-t-sheet sm:rounded-card p-4 space-y-2 shadow-2xl"
              style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}
              onClick={e => e.stopPropagation()}
            >
              <p className="px-2 pb-1 text-sm font-semibold text-primary">
                {id ? getTagName(id) : isCn ? '新建细分' : 'New region'}
                <span className="block text-xs font-medium text-tertiary">{getTagName(part)}</span>
              </p>
              <div className="flex gap-2">
                <input
                  className="ui-input flex-1 min-w-0"
                  value={regionDraft}
                  onChange={e => setRegionDraft(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      commit();
                    }
                  }}
                  placeholder={isCn ? '细分名称' : 'Region name'}
                  aria-label={isCn ? '细分名称' : 'Region name'}
                  autoFocus={!id}
                />
                <button
                  type="button"
                  onClick={commit}
                  disabled={!regionDraft.trim() || (!!id && regionDraft.trim() === getTagName(id))}
                  className="flex-shrink-0 px-4 rounded-control bg-accent text-on-accent font-semibold disabled:opacity-40"
                >
                  {id ? (isCn ? '改名' : 'Rename') : isCn ? '添加' : 'Add'}
                </button>
              </div>
              {id ? (
                <>
                  <div className="flex gap-2">
                    <button type="button" className={`${btn} justify-center`} disabled={i <= 0} onClick={() => moveRegion(part, id, -1)}>
                      <ChevronLeft size={16} className="text-accent" /> {isCn ? '左移' : 'Move left'}
                    </button>
                    <button
                      type="button"
                      className={`${btn} justify-center`}
                      disabled={i < 0 || i >= ids.length - 1}
                      onClick={() => moveRegion(part, id, 1)}
                    >
                      {isCn ? '右移' : 'Move right'} <ChevronRight size={16} className="text-accent" />
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      close();
                      removeRegion(part, id);
                    }}
                    className="w-full min-h-[48px] px-4 rounded-card bg-danger/10 text-sm font-bold text-danger flex items-center gap-2.5 active:bg-danger/20 transition-colors"
                  >
                    <Trash2 size={16} />
                    {isCn ? '删除这个细分' : 'Remove region'}
                  </button>
                </>
              ) : (
                hidden.length > 0 && (
                  <>
                    <div className="px-2 pt-1 text-[10px] font-bold tracking-[0.2em] text-secondary">
                      {isCn ? '恢复' : 'RESTORE'}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {hidden.map(h => (
                        <button
                          key={h}
                          type="button"
                          onClick={() => {
                            restoreRegion(part, h);
                            close();
                          }}
                          className="min-h-[38px] px-3 rounded-control text-xs font-bold bg-card border border-dashed border-divider text-secondary flex items-center gap-1.5"
                        >
                          <RotateCcw size={12} /> {getTagName(h)}
                        </button>
                      ))}
                    </div>
                  </>
                )
              )}
              <button
                type="button"
                onClick={close}
                className="w-full min-h-[48px] px-4 rounded-card text-sm font-bold text-secondary flex items-center justify-center active:bg-card-hover transition-colors"
              >
                {isCn ? '完成' : 'Done'}
              </button>
            </div>
          </div>
        );
      })()}

      {/* 长按动作行 → 管理菜单 */}
      {menuFor && (
        <div
          className="absolute inset-0 z-10 bg-scrim flex items-end sm:items-center justify-center p-0 sm:p-6 anim-fade"
          onClick={() => setMenuFor(null)}
          data-testid="row-action-menu"
        >
          <div
            className="bg-inset border-t sm:border border-divider w-full sm:max-w-sm rounded-t-sheet sm:rounded-card p-4 space-y-2 shadow-2xl"
            style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}
            onClick={e => e.stopPropagation()}
          >
            {(() => {
              const regs =
                (menuFor.category || 'STRENGTH') === 'STRENGTH' ? regionsOf(menuFor.bodyPart) : [];
              const cur = effectiveRegion(menuFor) ?? '';
              const where = [
                menuFor.bodyPart ? getTagName(menuFor.bodyPart) : '',
                cur ? getTagName(cur) : regs.length ? (isCn ? '未细分' : 'Unassigned') : '',
              ]
                .filter(Boolean)
                .join(' · ');
              return (
                <>
                  <p className="px-2 pb-1 text-sm font-semibold text-primary">
                    {resolveName(menuFor.name[lang])}
                    {where && <span className="block text-xs font-medium text-tertiary">{where}</span>}
                  </p>
                  {regs.length > 0 && (
                    <>
                      <div className="px-2 pt-0.5 text-[10px] font-bold tracking-[0.2em] text-secondary">
                        {isCn ? '归到细分' : 'REGION'}
                      </div>
                      <div className="flex flex-wrap gap-1.5 pb-1.5" data-testid="menu-region-chips">
                        {[{ id: '', custom: false }, ...regs].map(r => {
                          const on = cur === r.id;
                          return (
                            <button
                              key={r.id || 'none'}
                              type="button"
                              aria-pressed={on}
                              onClick={() => {
                                const ex = menuFor;
                                setMenuFor(null);
                                if (!on) placeInRegion(ex.id, r.id, null, ex);
                              }}
                              className={`min-h-[38px] px-3 rounded-control text-xs font-bold border transition-colors ${
                                on
                                  ? 'bg-accent border-accent text-on-accent shadow-elevated'
                                  : 'bg-card border-divider text-secondary'
                              }`}
                            >
                              {r.id ? getTagName(r.id) : isCn ? '未细分' : 'Unassigned'}
                            </button>
                          );
                        })}
                      </div>
                    </>
                  )}
                </>
              );
            })()}
            <button
              type="button"
              onClick={() => {
                const ex = menuFor;
                setMenuFor(null);
                onEditExerciseTags(ex);
              }}
              className="w-full min-h-[48px] px-4 rounded-card bg-card border border-divider text-sm font-bold text-primary flex items-center gap-2.5 active:bg-card-hover transition-colors"
            >
              <Tags size={16} className="text-accent" />
              {isCn ? '编辑标签' : 'Edit tags'}
            </button>
            <button
              type="button"
              onClick={() => {
                const ex = menuFor;
                setMenuFor(null);
                onRenameExercise(ex.id, resolveName(ex.name[lang]));
              }}
              className="w-full min-h-[48px] px-4 rounded-card bg-card border border-divider text-sm font-bold text-primary flex items-center gap-2.5 active:bg-card-hover transition-colors"
            >
              <PencilLine size={16} className="text-accent" />
              {isCn ? '重命名' : 'Rename'}
            </button>
            <button
              type="button"
              onClick={() => {
                const ex = menuFor;
                setMenuFor(null);
                onDeleteExercise(ex.id);
              }}
              className="w-full min-h-[48px] px-4 rounded-card bg-danger/10 text-sm font-bold text-danger flex items-center gap-2.5 active:bg-danger/20 transition-colors"
            >
              <Trash2 size={16} />
              {isCn ? '从动作库删除' : 'Delete from library'}
            </button>
            <button
              type="button"
              onClick={() => setMenuFor(null)}
              className="w-full min-h-[48px] px-4 rounded-card text-sm font-bold text-secondary flex items-center justify-center active:bg-card-hover transition-colors"
            >
              {isCn ? '取消' : 'Cancel'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default ExercisePickerSheet;
