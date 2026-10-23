/**
 * 训练页「添加动作」底部弹层
 *
 * 交互设计（与 App.tsx / NewWorkoutTab 配合）：
 *   - 常驻挂载，open 切换显隐（内部筛选状态跨开合保留 = 筛选记忆；每次打开只清搜索词）
 *   - 部位行（单选，含自定义部位 + 有氧/自由两个伪部位）+ 器材行（多选，联动计数，0 隐藏）；
 *     选了部位时筛选收成一行：部位横滑，器材收成行尾一颗 chip（点开才铺器材行）
 *   - 点 = 添加，弹层不关：闪一下 + 头部「本次已加 N」+ 震动；450ms 双击防误触
 *   - 长按 = 动作面板（ExerciseActionPanel），不能拖
 *   - 「整理」常驻头部，是动作库唯一的编辑入口（2026-10 第三版，demo：docs/demos/region-board-v3.html）：
 *     点 = 动作面板、按住即拖（归细分 / 调顺序）；部位行末尾「未分部位 · 已删除 · ＋」；
 *     点表头出细分面板、表头末尾「＋」新建细分；再点已选中的部位出部位面板；最底下器材节
 *   - 软键盘弹起时 visualViewport 计算 inset，弹层压缩到键盘上沿
 *   - 手指在弹层任何位置往下拉即可关闭（列表不在顶部时先让列表往回滚）；带部位进来时停在该部位栏
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  CircleDashed,
  Filter,
  History,
  Move,
  Plus,
  RotateCcw,
  Search,
  Star,
  Trash2,
  ArrowDownUp,
  X,
  Zap,
  Lock,
} from 'lucide-react';
import { ExerciseDefinition, ExerciseVariant, Language } from '../../types';
import { BODY_PARTS } from '../constants/exercises';
import { useExercisePrefs } from '../contexts/ExercisePrefsContext';
import { useUserSettingsContext } from '../contexts/UserSettingsContext';
import { useExerciseStats } from '../hooks/useFilteredExercises';
import { useExercisePickerData, PickerAxis, matchAxis, equipmentsOf } from '../hooks/useExercisePickerData';
import { RESISTANCES, RESISTANCE_NAMES, defaultResistance, resistanceSelectable, type Resistance } from '../utils/exerciseAttrs';
import { useKeyboardInset } from '../hooks/useKeyboardInset';
import { useLongPress } from '../hooks/useLongPress';
import { useRegionDrag } from '../hooks/useRegionDrag';
import { useUiOverlay } from '../contexts/UiOverlayContext';
import { haptic, H } from '../utils/haptics';
import { segmentName } from '../utils/nameSegments';
import { LongPressAffordance } from './LongPressAffordance';
import { ExerciseActionPanel } from './ExerciseActionPanel';
import { VariantModal } from './modals/VariantModal';
import { useBackClose } from '../hooks/useBackClose';

const NO_EQUIPS: ReadonlySet<string> = new Set();

interface PickerRowProps {
  displayName: string;
  added: number;
  isStarred: boolean;
  partName: string;
  /** 器材（动作本身在前，做法用到的接在后面）；hit = 被当前器材筛选命中 */
  gear: { name: string; hit: boolean }[];
  isCn: boolean;
  bindRef: (el: HTMLDivElement | null) => void;
  onPick: () => void;
  onLongPress: () => void;
  onToggleStar: () => void;
}

/**
 * 弹层里的一行动作（全部 / 搜索 / 没有细分的部位）。
 * 长按＝动作面板。必须带自解释标签：不加的话连设计者本人都不记得这手势是干嘛的。
 */
const PickerRow: React.FC<PickerRowProps> = ({
  displayName,
  added,
  isStarred,
  partName,
  gear,
  isCn,
  bindRef,
  onPick,
  onLongPress,
  onToggleStar,
}) => {
  const press = useLongPress({ onLongPress });
  return (
    <div ref={bindRef} className="flex items-stretch bg-card border border-divider rounded-card overflow-hidden">
      <button
        type="button"
        onClick={onPick}
        {...press.handlers}
        className="relative flex-1 min-w-0 text-left px-3 py-2.5 flex flex-col gap-1.5 min-h-[60px] active:bg-card-hover transition-colors duration-tap ease-paper select-none touch-pan-y"
        data-testid="picker-sheet-exercise"
      >
        <span className="flex items-center gap-2 flex-wrap text-small font-semibold text-primary">
          {displayName}
          {added > 0 && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-chip bg-success/15 text-success text-micro font-bold whitespace-nowrap">
              ✓ {isCn ? '已添加' : 'Added'}{added > 1 ? ` ×${added}` : ''}
            </span>
          )}
        </span>
        {/* 属性一行：部位 · 器材（2026-10-20 起不再是一串胶囊）。筛中的器材上强调色 */}
        {(partName || gear.length > 0) && (
          <span className="text-xs text-tertiary truncate" data-testid="picker-row-attrs">
            {partName}
            {partName && gear.length > 0 && ' · '}
            {gear.map((g, i) => (
              <React.Fragment key={g.name}>
                {i > 0 && ' / '}
                <span className={g.hit ? 'text-accent font-semibold' : ''}>{g.name}</span>
              </React.Fragment>
            ))}
          </span>
        )}
        <LongPressAffordance
          active={press.pressing}
          label={isCn ? '管理这个动作' : 'Manage'}
          drawMs={press.drawMs}
          placement="down"
        />
      </button>
      <button
        type="button"
        onClick={e => {
          e.stopPropagation();
          onToggleStar();
        }}
        className="w-11 flex items-center justify-center border-l border-divider text-accent active:scale-press-sm transition-transform duration-tap ease-paper"
        aria-label={isCn ? '收藏' : 'Star'}
      >
        <Star size={18} strokeWidth={2} className={isStarred ? 'fill-current' : ''} />
      </button>
    </div>
  );
};

interface RegionCardProps {
  id: string;
  displayName: string;
  added: number;
  isStarred: boolean;
  /** 额外 class：is-un（未细分）/ is-tap（只能点）/ is-deleted（已删除） */
  variant?: string;
  /** 格子里的显式行列（行对齐的 grid） */
  cell?: { col: string; ci: number; r: number };
  /** 未细分托盘里的卡：可拖回格子 */
  unassigned?: boolean;
  /** 普通态：长按满 500ms 出动作面板 */
  longPress: boolean;
  bindRef: (el: HTMLButtonElement | null) => void;
  onPick: () => void;
  onLongPress: () => void;
}

/**
 * 细分格里的小卡（第三版，方向 A）：跟部位 / 器材 chip 同一套样子 ——
 * 灰底无边框、粗体；已添加＝朱砂实底；收藏是右上角一颗小星，「×N」是右下角 mono 角标。
 * 名字按词断行（词间 <wbr>，CSS keep-all）。整理态的「按住即拖」由 useRegionDrag 在结果区统一接管。
 */
const RegionCard: React.FC<RegionCardProps> = ({
  id,
  displayName,
  added,
  isStarred,
  variant = '',
  cell,
  unassigned = false,
  longPress,
  bindRef,
  onPick,
  onLongPress,
}) => {
  const press = useLongPress({ onLongPress, disabled: !longPress });
  const segs = segmentName(displayName);
  const draggable = !!cell || unassigned;
  return (
    <button
      ref={bindRef}
      type="button"
      onClick={onPick}
      {...(longPress ? press.handlers : { onContextMenu: (e: React.SyntheticEvent) => e.preventDefault() })}
      className={`region-card select-none${variant ? ` ${variant}` : ''}${added ? ' is-added' : ''}`}
      style={cell ? { gridColumn: cell.ci, gridRow: cell.r } : undefined}
      data-testid="picker-region-card"
      {...(draggable ? { 'data-drag-id': id, 'data-region-col': cell?.col ?? '' } : {})}
      {...(cell ? { 'data-r': cell.r, 'data-ci': cell.ci } : {})}
    >
      <span className="region-card-name">
        {segs.map((s, i) => (
          <React.Fragment key={i}>
            {i > 0 && <wbr />}
            {s}
          </React.Fragment>
        ))}
      </span>
      {isStarred && (
        <span className="region-card-star" aria-hidden>
          <Star size={9} strokeWidth={0} className="fill-current" />
        </span>
      )}
      {added > 1 && <span className="region-card-x">×{added}</span>}
      {press.pressing && <span className="longpress-line" style={{ animationDuration: `${press.drawMs}ms` }} />}
    </button>
  );
};

interface NamePanelProps {
  testId: string;
  title: string;
  subtitle: string;
  /** 现名；'' = 新建 */
  initial: string;
  placeholder: string;
  isCn: boolean;
  /** 返回 false = 没成（重名等，已 toast），面板留着 */
  onCommit: (name: string) => boolean;
  onClose: () => void;
  children?: React.ReactNode;
}

/**
 * 细分 / 部位 / 器材的底部面板（同一个样子：标题 + 名字输入 + 改名/添加 + 其他操作 + 完成）。
 * 「完成」时名字改过就一起存（region-panel-done-discards-rename：原先只认改名按钮和回车，直接点完成会丢）。
 */
const NamePanel: React.FC<NamePanelProps> = ({
  testId,
  title,
  subtitle,
  initial,
  placeholder,
  isCn,
  onCommit,
  onClose,
  children,
}) => {
  const [draft, setDraft] = useState(initial);
  const dirty = !!draft.trim() && draft.trim() !== initial;
  const commit = () => {
    if (dirty && onCommit(draft.trim())) onClose();
  };
  return (
    <div
      className="absolute inset-0 z-10 bg-scrim flex items-end sm:items-center justify-center anim-fade"
      onClick={onClose}
      data-testid={testId}
    >
      <div
        className="bg-inset border-t sm:border border-divider w-full sm:max-w-sm rounded-t-sheet sm:rounded-card p-4 space-y-2 shadow-2xl"
        style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}
        onClick={e => e.stopPropagation()}
      >
        <p className="px-2 pb-1 text-small font-semibold text-primary">
          {title}
          <span className="block text-xs font-medium text-tertiary">{subtitle}</span>
        </p>
        <div className="flex gap-2">
          <input
            className="ui-input flex-1 min-w-0"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commit();
              }
            }}
            placeholder={placeholder}
            aria-label={placeholder}
            autoFocus={!initial}
          />
          <button
            type="button"
            onClick={commit}
            disabled={!dirty}
            className="flex-shrink-0 px-4 rounded-control bg-accent text-on-accent font-semibold disabled:opacity-40"
          >
            {initial ? (isCn ? '改名' : 'Rename') : isCn ? '添加' : 'Add'}
          </button>
        </div>
        {children}
        <button
          type="button"
          onClick={() => {
            if (dirty && !onCommit(draft.trim())) return;
            onClose();
          }}
          className="w-full min-h-[48px] px-4 rounded-card text-small font-bold text-secondary flex items-center justify-center active:bg-card-hover transition-colors"
        >
          {isCn ? '完成' : 'Done'}
        </button>
      </div>
    </div>
  );
};

const panelBtn =
  'w-full min-h-[48px] px-4 rounded-card bg-card border border-divider text-small font-bold text-primary flex items-center gap-2.5 active:bg-card-hover transition-colors disabled:opacity-40';
const dangerBtn =
  'w-full min-h-[48px] px-4 rounded-card bg-danger/10 text-small font-bold text-danger flex items-center gap-2.5 active:bg-danger/20 transition-colors';

interface ExercisePickerSheetProps {
  open: boolean;
  onClose: () => void;
  /**
   * 这次打开要直接停在哪个部位（BODY_PARTS 的 id，如 'subChest'）。
   * 开练时选了「练胸」→ 弹层一打开就是胸部那一栏，不用再点一次。
   * 只在打开的那一刻生效一次；null = 沿用上次的筛选（筛选记忆）。
   */
  focusPart?: string | null;
  /** 小写显示名 -> 当前训练中出现次数（驱动「已添加 ×N」） */
  addedCounts: Record<string, number>;
  /** 本次弹层会话累计添加数（App 维护，含新建动作路径） */
  sessionAdded: number;
  /** variantId：点的是某个做法的小卡 */
  /** 点卡片。返回 false＝这是「取消本次添加」（本次打开里刚加过的再点一下），不播添加动画 */
  onPickExercise: (ex: ExerciseDefinition, variantId?: string) => boolean | void;
  /** 普通态里换了部位 chip（部位标签，如 subChest）：训练名没手动改过时跟着改 */
  onPartChange?: (bodyPart: string) => void;
  /** preset：弹层眼下停的部位 / 有氧栏（「新动作」照它预填，审查 A16） */
  onCreateCustomExercise: (prefilledName?: string, preset?: { bodyPart?: string; category?: string }) => void;
  /** 从交替组「加一个动作」打开：头部写「加到 X ⇄ Y」，选的动作加进那个组 */
  targetLabel?: string | null;
  /**
   * 层级：训练页是页面上的弹层（sheet）；计划编辑器是弹窗（z-modal），从它里面打开要压过它（modal-2）。
   * 弹层里再开的弹窗（新建动作、备注、记录项、改名 = modal-2，改标签 = modal-3）都是后挂的 portal，同层也盖得住。
   */
  layer?: 'sheet' | 'modal-2';
  /**
   * 只管动作库（首选项「动作库与标签 ›」打开）：一打开就是整理态，「完成」直接关弹层。
   * 不加动作，onPickExercise 不会被调到。
   */
  libraryOnly?: boolean;
  // ===== 动作面板里打开的弹窗（复用 App 层同一批弹窗） =====
  onEditExerciseTags: (ex: ExerciseDefinition) => void;
  onDeleteExercise: (id: string) => void;
  onOpenNote: (name: string) => void;
  onOpenMetrics: (name: string) => void;
}

/** 整理里的特殊视图：未分部位 / 已删除 */
type Special = 'none' | 'del' | null;

export const ExercisePickerSheet: React.FC<ExercisePickerSheetProps> = ({
  open,
  onClose,
  focusPart = null,
  targetLabel = null,
  layer = 'sheet',
  libraryOnly = false,
  addedCounts,
  sessionAdded,
  onPickExercise,
  onPartChange,
  onCreateCustomExercise,
  onEditExerciseTags,
  onDeleteExercise,
  onOpenNote,
  onOpenMetrics,
}) => {
  const {
    starredExercises,
    resolveName,
    getTagName,
    toggleStarExercise,
    regionsOf,
    hiddenRegionsOf,
    effectiveRegion,
    effectivePart,
    applyRegionLayout,
    renameTag,
    addRegionTag,
    addTag,
    setEquipmentResistance,
    customTags,
    deleteTag,
    moveRegion,
    removeRegion,
    restoreRegion,
    restoreLibraryExercise,
    updateVariant,
  } = useExercisePrefs();
  const { toast, toastUndo, dismissToasts } = useUiOverlay();
  const { lang } = useUserSettingsContext();
  const { recentExerciseNames } = useExerciseStats();
  const isCn = lang === Language.CN;

  /** 「整理」：动作库的编辑态。点 = 动作面板，按住即拖 */
  const [arranging, setArranging] = useState(false);
  const [special, setSpecial] = useState<Special>(null);
  /** 从「全部」/ 搜索进整理时落到上次整理的部位 */
  const lastArrangePartRef = useRef<string>(BODY_PARTS[0]);
  /** 细分面板：点某个表头＝{ id }；表头末尾「＋」＝{ id: '' } */
  const [regionMenu, setRegionMenu] = useState<{ id: string } | null>(null);
  /** 部位 / 器材面板：{ id }＝改名 / 删除；{ id: '' }＝新建 */
  const [partMenu, setPartMenu] = useState<{ id: string } | null>(null);
  const [equipMenu, setEquipMenu] = useState<{ id: string } | null>(null);
  /** 新建器材时先选的默认阻力（建好才落盘） */
  const [newEquipRes, setNewEquipRes] = useState<Resistance>('none');
  /** 动作面板（长按 / 整理态点卡）：存 id，每次渲染从库里取最新的（改名、加星后立刻反映） */
  const [menuFor, setMenuFor] = useState<string | null>(null);
  /** 动作面板里打开的练法（只管理，不切换） */
  const [variantFor, setVariantFor] = useState<string | null>(null);
  /** 收成一行时，器材 chip 点开铺出器材行 */
  const [equipOpen, setEquipOpen] = useState(false);
  /** 拖拽接管中（整理态按下）：弹层整张下拉关闭看到它就让路 */
  const regionGestureRef = useRef(false);
  /** 细分格当前每一列（含 '' = 未细分）的顺序，落下 / 归列时据此写序号 */
  const boardColsRef = useRef<Map<string, ExerciseDefinition[]>>(new Map());
  /**
   * 吸顶表头与格子是两个横向滚动容器，scrollLeft 双向同步：滑格子表头跟着走，滑表头格子跟着走
   * （也让「滚到某个表头」这类 scrollIntoView 能把格子带过去）。
   */
  const headwrapRef = useRef<HTMLDivElement | null>(null);
  const bscrollRef = useRef<HTMLDivElement | null>(null);
  const syncScroll = (from: HTMLDivElement | null, to: HTMLDivElement | null) => {
    if (from && to && Math.abs(to.scrollLeft - from.scrollLeft) > 0.5) to.scrollLeft = from.scrollLeft;
  };

  // ===== 筛选状态（跨开合保留；仅搜索词随打开重置） =====
  const [query, setQuery] = useState('');
  const [axis, setAxis] = useState<PickerAxis>(null);
  const [equips, setEquips] = useState<ReadonlySet<string>>(new Set());

  // 整理：不搜索、不按器材筛（整理态看不到器材行，筛着会让格子缺一块，arrange-hidden-equip-filter）
  const { results, equipCounts, axisAvailable, equipIds, customPartIds, boardPart, merged, byId, deleted, noPart } =
    useExercisePickerData({ query: arranging ? '' : query, axis, equips: arranging ? NO_EQUIPS : equips });

  const inset = useKeyboardInset(open);
  // 安卓返回键关弹层（审查 B11）
  useBackClose(open, onClose);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const resultsRef = useRef<HTMLDivElement | null>(null);
  const partScrollRef = useRef<HTMLDivElement | null>(null);
  const rowRefs = useRef<Map<string, HTMLElement>>(new Map());
  const lastPickRef = useRef<{ id: string; t: number }>({ id: '', t: 0 });
  // 键盘弹起时筛选区收起为摘要行（点摘要可临时展开，键盘收起后自动复原）
  const [kbExpandFilters, setKbExpandFilters] = useState(false);
  /**
   * 长按出面板 / 拖完之后，吞掉松手带出的那次 click（不算「添加」）。
   * 用时间戳不用布尔：面板一弹出就盖在手指下面，那次 click 往往根本落不到卡上，
   * 布尔立起来就没人清 —— 用完长按之后的下一次正常点选会被吃掉（§12.5 粘滞布尔）。
   */
  const suppressClickRef = useRef(-Infinity);
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
      // 整理态的拖动接管了这次触摸：整次手势都不归弹层
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

  // 打开：清搜索词、结果滚回顶部；关闭：收键盘、退出整理、收掉所有面板
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
      if (libraryOnly) {
        if (!focusPart) setAxis(a => a ?? { kind: 'part', v: lastArrangePartRef.current });
        setArranging(true);
      }
    } else {
      searchInputRef.current?.blur();
      setMenuFor(null);
      setArranging(false);
      setSpecial(null);
      setRegionMenu(null);
      setPartMenu(null);
      setEquipMenu(null);
      setEquipOpen(false);
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

  // 部位横滑：选中的那颗滚进可见
  useEffect(() => {
    const sc = partScrollRef.current;
    const on = sc?.querySelector<HTMLElement>('[data-on="1"]');
    if (!sc || !on) return;
    const l = on.offsetLeft - 16;
    const r = on.offsetLeft + on.offsetWidth - sc.clientWidth + 16;
    if (sc.scrollLeft > l) sc.scrollLeft = l;
    else if (sc.scrollLeft < r) sc.scrollLeft = r;
  }, [axis, special, arranging]);

  // ===== 分组 =====
  const q = arranging ? '' : query.trim();
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

  /** 「新动作」按眼下停的那一栏预填：部位栏 → 这个部位；有氧 / 自由栏 → 那一类 */
  const createPreset = () =>
    axis?.kind === 'part' ? { bodyPart: axis.v } : axis?.kind === 'cat' ? { category: axis.v } : undefined;
  /** 搜索时每个结果命中的做法（做法名对上、动作名对不上的那些） */
  const variantHitOf = useMemo(
    () => new Map(results.filter(r => r.variant).map(r => [r.ex.id, r.variant!] as const)),
    [results],
  );
  const totalCount = results.length;
  const searchHere = axis ? flatGroup.filter(ex => matchAxis(ex, axis)) : flatGroup;
  const searchRest = axis ? flatGroup.filter(ex => !matchAxis(ex, axis)) : [];
  const hasExactMatch =
    q.length > 0
    && results.some(r => resolveName(r.ex.name[lang]).toLowerCase() === q.toLowerCase());
  const nFilters = (axis ? 1 : 0) + equips.size;

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
  const selectedEquipNames = equipIds.filter(id => equips.has(id.toLowerCase())).map(getTagName).filter(Boolean);
  const filterSummary = [...(axis ? [axisLabel(axis)] : []), ...selectedEquipNames].join(' · ');

  /**
   * 放进某个细分（拖拽落下 / 面板里点细分都走这里）。
   * 拖拽落下（idx 有值）或这一列已经手动排过：整列按当前顺序写序号，从此这一列按手动顺序；
   * 面板归列且这一列没排过：只写细分，照默认排序。'' = 放回未细分（去掉序号）。
   */
  const placeInRegion = (exId: string, region: string, idx: number | null, fallback?: ExerciseDefinition) => {
    // 不在细分格里（从「全部」列表的长按面板进来）：格子的列顺序不可信，只写这一个动作，接在列尾
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
    enabled: arranging && !special && !!boardPart,
    activeRef: regionGestureRef,
    suppressClickRef,
    onDrop: (id, target, idx) => {
      // 做法小卡（ex::v）：改的是这个做法的细分，不动动作本身；拖回未细分＝跟动作走
      const sep = id.indexOf('::');
      if (sep > 0) {
        const ex = byId.get(id.slice(0, sep));
        const vid = id.slice(sep + 2);
        if (!ex) return;
        const name = ex.name[lang];
        const before = (ex.variants ?? []).find(v => v.id === vid)?.region ?? '';
        updateVariant(name, vid, { region: target });
        haptic(H.tap);
        toastUndo(
          target ? (isCn ? `做法已归到「${getTagName(target)}」` : `Variant moved to ${getTagName(target)}`) : isCn ? '做法跟回动作本身' : 'Variant follows the exercise',
          () => updateVariant(name, vid, { region: before }),
        );
        return;
      }
      placeInRegion(id, target, idx);
    },
  });

  // ===== 添加 =====
  const handlePick = (ex: ExerciseDefinition, variantId?: string) => {
    const now = Date.now();
    const pickKey = variantId ? `${ex.id}::${variantId}` : ex.id;
    if (lastPickRef.current.id === pickKey && now - lastPickRef.current.t < 450) return;
    lastPickRef.current = { id: pickKey, t: now };
    try {
      haptic(H.pick);
    } catch {
      /* noop */
    }
    // 本次打开里加过的再点一下＝取消这次添加（App 里判），那一下不播「添加」的墨迹
    if (onPickExercise(ex, variantId) === false) return;
    const row = rowRefs.current.get(pickKey);
    if (row) {
      // remove → offsetWidth → add 的强制重排触发法保留（写得对，能重放同一条动画）
      row.classList.remove('anim-ink-mark');
      void row.offsetWidth;
      row.classList.add('anim-ink-mark');
    }
  };

  // B3（2026-10-11）：普通态换部位 → 告诉工作台（训练名还是「练胸」这种自动填的就跟着改）
  useEffect(() => {
    if (!open || arranging || !axis || axis.kind !== 'part') return;
    onPartChange?.(axis.v);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [axis, open, arranging]);

  /** 打开动作面板：先收起撤销条（它会盖住面板底部的「删除」） */
  const openActionPanel = (id: string) => {
    dismissToasts();
    setMenuFor(id);
  };
  const swallowed = () => {
    if (performance.now() - suppressClickRef.current < 450) {
      suppressClickRef.current = -Infinity;
      return true;
    }
    return false;
  };

  const toggleArranging = () => {
    if (arranging && libraryOnly) {
      onClose();
      return;
    }
    if (arranging) {
      setArranging(false);
      setSpecial(null);
    } else {
      setQuery('');
      searchInputRef.current?.blur();
      // 从「全部」进来：落到上次整理的部位
      if (!axis) setAxis({ kind: 'part', v: lastArrangePartRef.current });
      setArranging(true);
    }
    setEquipOpen(false);
    if (resultsRef.current) resultsRef.current.scrollTop = 0;
  };
  useEffect(() => {
    if (arranging && axis?.kind === 'part') lastArrangePartRef.current = axis.v;
  }, [arranging, axis]);

  // ===== 行渲染 =====
  const bindItemRef = (id: string) => (el: HTMLElement | null) => {
    if (el) rowRefs.current.set(id, el);
    else rowRefs.current.delete(id);
  };
  const isStarredName = (name: string) => Object.keys(starredExercises).some(k => k.toLowerCase() === name.toLowerCase());

  // 提成真组件而不是 renderRow 函数：长按要用 useLongPress，而 hook 不能写在 .map() 的回调里。
  const renderRow = (ex: ExerciseDefinition) => {
    const baseName = resolveName(ex.name[lang]);
    // 搜的是做法名（「宽握」）：这一行就是那个做法，点它加的也是那个做法（审查 A13）
    const vh = q ? variantHitOf.get(ex.id) : undefined;
    const displayName = vh ? `${baseName} · ${vh.name}` : baseName;
    const key = baseName.toLowerCase();
    return (
      <PickerRow
        key={ex.id}
        displayName={displayName}
        added={(vh ? addedCounts[`${key}::${vh.id}`] : addedCounts[key]) || 0}
        isStarred={isStarredName(baseName)}
        partName={ex.bodyPart ? getTagName(ex.bodyPart) : ''}
        gear={equipmentsOf(ex)
          .map(t => ({ name: getTagName(t), hit: equips.has(t) }))
          .filter(g => g.name)}
        isCn={isCn}
        bindRef={bindItemRef(vh ? `${ex.id}::${vh.id}` : ex.id)}
        onPick={() => {
          if (swallowed()) return;
          handlePick(ex, vh?.id);
        }}
        onLongPress={() => {
          suppressClickRef.current = performance.now(); // 松手后的 click 不再当作「添加」
          openActionPanel(ex.id);
        }}
        onToggleStar={() => toggleStarExercise(baseName)}
      />
    );
  };

  const renderCard = (
    ex: ExerciseDefinition,
    opts: {
      variantCls?: string;
      cell?: { col: string; ci: number; r: number };
      unassigned?: boolean;
      isDeleted?: boolean;
      /** 做法小卡（带细分的做法单独一张） */
      variant?: ExerciseVariant;
    } = {},
  ) => {
    const baseName = resolveName(ex.name[lang]);
    const v = opts.variant;
    const displayName = v ? `${baseName}·${v.name}` : baseName;
    const key = baseName.toLowerCase();
    const id = v ? `${ex.id}::${v.id}` : ex.id;
    const added = opts.isDeleted ? 0 : v ? addedCounts[`${key}::${v.id}`] || 0 : addedCounts[key] || 0;
    return (
      <RegionCard
        key={id}
        id={id}
        displayName={displayName}
        added={added}
        isStarred={!opts.isDeleted && !v && isStarredName(baseName)}
        variant={`${opts.variantCls ?? ''}${v ? ' is-variant' : ''}`.trim()}
        cell={opts.cell}
        unassigned={opts.unassigned}
        longPress={!arranging}
        bindRef={bindItemRef(id)}
        onPick={() => {
          if (swallowed()) return;
          if (opts.isDeleted) {
            restoreLibraryExercise(ex.id);
            haptic(H.tap);
            // 「已删除」恢复空了：落到它所在的部位（demo 同）
            if (special === 'del' && deleted.length <= 1) {
              const part = effectivePart(ex);
              setSpecial(part || (ex.category || 'STRENGTH') !== 'STRENGTH' ? null : 'none');
              if (part) setAxis({ kind: 'part', v: part });
            }
            return;
          }
          if (arranging) {
            openActionPanel(ex.id);
            return;
          }
          handlePick(ex, v?.id);
        }}
        onLongPress={() => {
          suppressClickRef.current = performance.now();
          openActionPanel(ex.id);
        }}
      />
    );
  };

  /** 栏线：列与列之间正中一道 1px，按列宽算位置（中文等分 / 英文 112px） */
  const rules = (n: number) =>
    Array.from({ length: n - 1 }, (_, k) => (
      <span
        key={k}
        className="region-rule"
        style={{ left: `calc(var(--region-colw) * ${k + 1} + var(--region-gap) * ${k + 0.5} - 0.5px)` }}
        aria-hidden
      />
    ));

  const trayTpl = (n = 5) => (isCn ? `repeat(${n}, minmax(0, 1fr))` : 'repeat(auto-fill, minmax(104px, 1fr))');

  /**
   * 细分格（第三版「A + 栏线」）：吸顶的表头（刊头双线）+ 一张行对齐的 grid；
   * 下面是同列宽的「未细分」小卡托盘（轻一档），整理时再接本部位的「已删除」托盘。
   *
   * 一屏最多 4 列（2.2，2026-10-06 用户定）：细分多于 4 个时每列按 4 列宽、整张格子横滑；
   * 表头始终吸顶、不随纵向滚动走（横滑时跟着格子同步平移 —— 吸顶的表头放在横滑容器外面，
   * 横向位置由 onScroll 同步，因为 sticky 在 overflow-x 容器里吸不了顶）。英文每列 112px，同样横滑。
   *
   * 带细分的做法（变体第一层）单独成一张小卡、落在自己那一列（「高位下拉 · 宽握」在背阔、「· V 把」在中背）：
   * 用户找的是「练到这块肌肉的动作」。点它＝加这个动作并直接用这个做法；整理时拖它＝改这个做法的细分。
   */
  const renderBoard = (part: string) => {
    const regs = regionsOf(part);
    const n = regs.length;
    const wide = !isCn;
    const scroll = wide || n > 4;
    const tpl = scroll ? `repeat(${n}, var(--region-colw))` : `repeat(${n}, minmax(0, 1fr))`;
    const items = results.map(r => r.ex).sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
    // 列内顺序：手动排过的（regionRank）在前按序号，没排过的接在后面按默认（收藏 → 最近 → 其余）
    const byRank = (arr: ExerciseDefinition[]) => [
      ...arr.filter(e => e.regionRank != null).sort((a, b) => a.regionRank! - b.regionRank!),
      ...arr.filter(e => e.regionRank == null),
    ];
    const by = new Map<string, ExerciseDefinition[]>(regs.map(r => [r.id, []]));
    /** 做法小卡：每列里接在动作后面 */
    const vby = new Map<string, { ex: ExerciseDefinition; v: ExerciseVariant }[]>(regs.map(r => [r.id, []]));
    const unassigned: ExerciseDefinition[] = [];
    for (const ex of items) {
      const rg = effectiveRegion(ex);
      const col = rg ? by.get(rg) : undefined;
      if (col) col.push(ex);
      else unassigned.push(ex);
      for (const v of ex.variants ?? []) {
        if (v.region && vby.has(v.region)) vby.get(v.region)!.push({ ex, v });
      }
    }
    for (const [k, arr] of by) by.set(k, byRank(arr));
    boardColsRef.current = new Map([...by, ['', unassigned]]);
    const dels = arranging ? deleted.filter(ex => (ex.bodyPart || '').toLowerCase() === part.toLowerCase()) : [];
    const trayCols = scroll ? (wide ? trayTpl() : trayTpl(4)) : tpl;
    const heads = (
      <div className="region-heads">
        {regs.map(r =>
          arranging ? (
            <button
              key={r.id}
              type="button"
              className="region-head is-editable"
              data-region-head={r.id}
              data-testid="region-head-edit"
              onClick={() => {
                dismissToasts();
                setRegionMenu({ id: r.id });
              }}
            >
              <b>{getTagName(r.id)}</b>
              <i>{by.get(r.id)!.length + vby.get(r.id)!.length}</i>
            </button>
          ) : (
            <div key={r.id} className="region-head" data-region-head={r.id}>
              <b>{getTagName(r.id)}</b>
            </div>
          ),
        )}
        {arranging && (
          <button
            type="button"
            className="region-head-plus"
            aria-label={isCn ? '新建细分' : 'New region'}
            data-testid="region-new"
            onClick={() => {
              dismissToasts();
              setRegionMenu({ id: '' });
            }}
          >
            <span>
              <Plus size={13} strokeWidth={2.5} />
            </span>
          </button>
        )}
        {rules(n)}
      </div>
    );
    return (
      <div
        className={`region-board${wide ? ' is-wide' : ''}${scroll ? ' is-scroll' : ''}`}
        style={{ ['--region-n' as string]: n, ['--region-tpl' as string]: tpl }}
        data-testid="picker-region-board"
        data-region-board=""
      >
        {/* 吸顶的表头：在横滑容器外面（sticky 在 overflow-x 里吸不了顶），横向位置跟格子双向同步 */}
        <div
          className="region-headwrap"
          ref={headwrapRef}
          onScroll={() => syncScroll(headwrapRef.current, bscrollRef.current)}
        >
          {heads}
        </div>
        <div
          className="region-bscroll"
          ref={bscrollRef}
          onScroll={() => syncScroll(bscrollRef.current, headwrapRef.current)}
        >
          <div className="region-bin">
            <div className="region-gwrap">
              <div className="region-band" aria-hidden />
              {rules(n)}
              <div className="region-grid">
                {regs.map((r, ci) => {
                  const col = by.get(r.id)!;
                  const vcol = vby.get(r.id)!;
                  if (!col.length && !vcol.length) {
                    // 正常态空列不画占位（表头下留白就整齐）；整理时是「可以放进来」的虚线落位
                    return arranging ? (
                      <div
                        key={r.id}
                        className="region-card is-empty"
                        style={{ gridColumn: ci + 1, gridRow: 1 }}
                        data-ci={ci + 1}
                        aria-hidden
                      />
                    ) : null;
                  }
                  return [
                    ...col.map((ex, ri) => renderCard(ex, { cell: { col: r.id, ci: ci + 1, r: ri + 1 } })),
                    ...vcol.map(({ ex, v }, vi) =>
                      renderCard(ex, { cell: { col: r.id, ci: ci + 1, r: col.length + vi + 1 }, variant: v }),
                    ),
                  ];
                })}
              </div>
            </div>
          </div>
        </div>
        {/* 「未细分」那一片也是落点：拖进来＝放回未细分 */}
        <div className="region-unzone" data-region-col="">
          {(unassigned.length > 0 || arranging) && (
            <div className="region-ulab">
              <CircleDashed size={13} />
              <h3>{isCn ? '未细分' : 'Unassigned'}</h3>
              <span>{unassigned.length}</span>
            </div>
          )}
          <div
            className="region-tray"
            data-drop-body=""
            style={{ ['--region-tpl' as string]: trayCols, minHeight: arranging && !unassigned.length ? 44 : undefined }}
          >
            {unassigned.map(ex => renderCard(ex, { variantCls: 'is-un', unassigned: true }))}
          </div>
        </div>
        {dels.length > 0 && (
          <>
            <div className="region-ulab">
              <RotateCcw size={13} />
              <h3>{isCn ? '已删除' : 'Deleted'}</h3>
              <span>{dels.length}</span>
            </div>
            <div className="region-tray" style={{ ['--region-tpl' as string]: trayCols }}>
              {dels.map(ex => renderCard(ex, { variantCls: 'is-deleted is-tap', isDeleted: true }))}
            </div>
          </>
        )}
      </div>
    );
  };

  /** 整理里的小卡托盘（没有细分的部位 / 未分部位 / 已删除）：只能点，不能拖 */
  const renderTray = (list: ExerciseDefinition[], isDeleted = false) => {
    if (!list.length) return null;
    const sorted = isDeleted ? list : [...list].sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
    return (
      <div className="region-tray mt-1" style={{ ['--region-tpl' as string]: trayTpl(), ['--region-gap' as string]: '9px' }}>
        {sorted.map(ex =>
          renderCard(ex, { variantCls: isDeleted ? 'is-deleted is-tap' : 'is-un is-tap', isDeleted }),
        )}
      </div>
    );
  };

  /** 整理最底下的器材节：一行器材 chip（带使用数），点开器材面板；行尾「＋」新建 */
  /**
   * 整理最底下的「器材」：器材表（2026-10-20，原一排胶囊）。一行一件：名字 · 阻力 · 用到它的动作数。
   * 内置器材的阻力锁定（行内带锁）；点任一行打开器材面板（改名 / 自建的改阻力、删除），末行新建。
   */
  const renderEquipSection = () => {
    const pool = special === 'none' ? noPart : special === 'del' ? deleted : results.map(r => r.ex);
    return (
      <div className="mt-1.5" data-testid="arrange-equip">
        <div className="region-ulab">
          <h3>{isCn ? '器材' : 'Gear'}</h3>
        </div>
        <div className="rounded-card border border-divider bg-card divide-y divide-divider overflow-hidden">
          {equipIds.map(id => {
            const label = getTagName(id);
            if (!label) return null;
            const n = pool.filter(ex => equipmentsOf(ex).includes(id.toLowerCase())).length;
            const res = defaultResistance(id, customTags);
            const locked = !resistanceSelectable(id);
            return (
              <button
                key={id}
                type="button"
                onClick={() => {
                  dismissToasts();
                  setEquipMenu({ id });
                }}
                className="w-full min-h-[44px] px-3.5 flex items-center gap-3 text-left active:bg-card-hover"
                data-testid="equip-row"
              >
                <span className="w-20 flex-shrink-0 truncate text-small font-semibold text-primary">{label}</span>
                <span className="flex-1 min-w-0 truncate text-xs text-secondary flex items-center gap-1">
                  {RESISTANCE_NAMES[res][isCn ? 'cn' : 'en']}
                  {locked && <Lock size={11} className="flex-shrink-0 text-tertiary" aria-label={isCn ? '随器材' : 'Set by gear'} />}
                </span>
                <span className="flex-shrink-0 text-xs tabular-nums text-tertiary">
                  {n ? (isCn ? `${n} 个动作` : `${n}`) : '—'}
                </span>
                <ChevronRight size={15} className="flex-shrink-0 text-tertiary" />
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => {
              dismissToasts();
              setNewEquipRes('none');
              setEquipMenu({ id: '' });
            }}
            aria-label={isCn ? '新建器材' : 'New gear'}
            className="w-full min-h-[44px] px-3.5 flex items-center gap-2 text-small font-bold text-accent active:bg-card-hover"
          >
            <Plus size={14} strokeWidth={2.5} />
            {isCn ? '新建器材' : 'New gear'}
          </button>
        </div>
      </div>
    );
  };

  const renderGroup = (icon: React.ReactNode, title: string, items: ExerciseDefinition[]) => {
    if (items.length === 0) return null;
    return (
      <div key={title}>
        <div className="flex items-center gap-1.5 mb-2 px-0.5 mt-3 first:mt-1">
          {icon}
          <h3 className="text-micro font-bold text-primary uppercase tracking-[0.12em]">{title}</h3>
          <span className="text-micro font-bold text-tertiary">· {items.length}</span>
        </div>
        <div className="space-y-2">{items.map(ex => renderRow(ex))}</div>
      </div>
    );
  };

  /**
   * 部位行是动作库的目录，不是标签（2026-10-20）：文字标签栏，选中的下面一条强调色横线。
   * 自建部位和内置部位同一个样子。
   */
  const tabCls = (on: boolean) =>
    `relative flex-shrink-0 min-h-[40px] px-3 text-small font-bold whitespace-nowrap flex items-center gap-1 transition-colors ${
      on ? 'text-accent' : 'text-secondary active:text-primary'
    }`;
  const tabBar = (on: boolean) =>
    on ? <span className="absolute left-2 right-2 bottom-0 h-[2px] rounded-full bg-accent" aria-hidden /> : null;
  const tabCount = (n: number, on: boolean) => (
    <i className={`not-italic text-micro font-semibold tabular-nums ${on ? 'text-accent' : 'text-tertiary'}`}>{n}</i>
  );

  /** 部位标签（普通态：0 结果的隐藏，已选中的除外；整理态：全部列出） */
  const renderAxisChips = () =>
    axisChips.map(chip => {
      const on = !special && axis !== null && axis.kind === chip.kind && axis.v === chip.v;
      const availKey = chip.kind === 'part' ? 'part:' + chip.v.toLowerCase() : 'cat:' + chip.v;
      if (!arranging && !on && !axisAvailable.has(availKey)) return null;
      const label = axisLabel(chip);
      if (!label) return null;
      return (
        <button
          key={chip.kind + chip.v}
          type="button"
          aria-pressed={on}
          data-on={on ? '1' : undefined}
          onClick={() => {
            if (arranging) {
              // 再点一次已选中的部位＝部位面板（改名 / 删除自建）
              if (on && chip.kind === 'part') {
                dismissToasts();
                setPartMenu({ id: chip.v });
                return;
              }
              setSpecial(null);
              setAxis({ kind: chip.kind, v: chip.v });
              if (resultsRef.current) resultsRef.current.scrollTop = 0;
              return;
            }
            // 再点一下已选中的部位什么都不做（审查 B7）：原来会取消筛选、整个列表一跳，多半是手滑
            if (on) return;
            setAxis({ kind: chip.kind, v: chip.v });
          }}
          className={tabCls(on)}
        >
          {label}
          {tabBar(on)}
        </button>
      );
    });

  /** 器材筛选：等宽格（跟属性表的选项格同一个样子），多选，带联动计数，0 的隐藏 */
  const equipChips = () =>
    equipIds.map(id => {
      const n = equipCounts.get(id) ?? 0;
      const on = equips.has(id.toLowerCase());
      if (n === 0 && !on) return null;
      const label = getTagName(id);
      if (!label) return null;
      return (
        <button
          key={id}
          type="button"
          aria-pressed={on}
          onClick={() => {
            const next = new Set(equips);
            const key = id.toLowerCase();
            if (next.has(key)) next.delete(key);
            else next.add(key);
            setEquips(next);
          }}
          className={`min-h-[40px] px-1.5 py-1 rounded-control text-xs font-bold leading-tight flex flex-col items-center justify-center transition-colors ${
            on ? 'bg-accent-soft text-accent' : 'bg-inset text-secondary'
          }`}
        >
          <span className="break-words text-center">{label}</span>
          <span className={`text-micro font-semibold tabular-nums ${on ? 'text-accent' : 'text-tertiary'}`}>{n}</span>
        </button>
      );
    });

  const arrangeTitle = special === 'none'
    ? isCn ? '未分部位' : 'No part'
    : special === 'del'
      ? isCn ? '已删除' : 'Deleted'
      : axis ? axisLabel(axis) : '';
  /** 选了部位（普通态）：筛选收成一行 */
  const oneLine = !arranging && !!axis;
  const menuEx = menuFor ? byId.get(menuFor) : undefined;

  return (
    <div
      className={`fixed inset-0 ${layer === 'modal-2' ? 'z-modal-2' : 'z-sheet'} ${open ? '' : 'pointer-events-none'}`}
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

        {/* 头部：普通态「添加动作 [本次已加 N] … [整理] [×]」；整理态「整理 · 胸部 [完成]」。整行（按钮除外）也是拖拽关闭的热区 */}
        <div
          className="flex items-center gap-2.5 px-4 pt-1.5 pb-0.5 flex-shrink-0 select-none cursor-grab active:cursor-grabbing min-h-[52px]"
          style={{ touchAction: 'none' }}
          onPointerDown={e => {
            if ((e.target as HTMLElement).closest('button')) return;
            handleDragStart(e);
          }}
          onPointerMove={handleDragMove}
          onPointerUp={handlePointerEnd}
          onPointerCancel={handlePointerEnd}
        >
          <h2 className="font-display text-lg font-semibold text-primary whitespace-nowrap truncate">
            {arranging
              ? `${isCn ? '整理' : 'Arrange'} · ${arrangeTitle}`
              : targetLabel
                ? `${isCn ? '加到' : 'Add to'} ${targetLabel}`
                : isCn ? '添加动作' : 'Add Exercise'}
          </h2>
          {sessionAdded > 0 && !arranging && (
            <span
              key={sessionAdded}
              className="anim-ink-mark inline-flex items-center gap-1 px-2.5 py-1 rounded-control bg-success/15 text-success text-micro font-bold whitespace-nowrap"
            >
              ✓ {isCn ? `本次已加 ${sessionAdded}` : `Added ${sessionAdded}`}
            </span>
          )}
          <button
            type="button"
            onClick={toggleArranging}
            aria-pressed={arranging}
            className={`ml-auto flex-shrink-0 min-h-[34px] px-3 rounded-control text-xs font-bold flex items-center gap-1.5 whitespace-nowrap transition-colors ${
              arranging ? 'bg-accent-soft text-accent' : 'bg-inset text-secondary'
            }`}
            data-testid="region-arrange"
          >
            <Move size={14} strokeWidth={2} />
            {arranging ? (isCn ? '完成' : 'Done') : isCn ? '整理' : 'Arrange'}
          </button>
          {!arranging && (
            <button
              type="button"
              onClick={onClose}
              className="w-11 h-11 flex-shrink-0 flex items-center justify-center rounded-control text-secondary hover:bg-card-hover active:scale-press-sm transition-ui"
              aria-label={isCn ? '完成并关闭' : 'Done'}
              data-testid="picker-sheet-close"
            >
              <X size={21} />
            </button>
          )}
        </div>

        {/* 搜索行（整理时收起） */}
        {!arranging && (
          <div className="flex gap-2 px-4 pt-1.5 pb-2.5 flex-shrink-0">
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
                className="w-full min-h-[46px] bg-inset border border-divider rounded-card pl-10 pr-10 text-small text-primary outline-none focus:border-accent transition-colors placeholder:text-tertiary"
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
              onClick={() => onCreateCustomExercise(q || undefined, createPreset())}
              // 次要样式：弹层的主操作是底部「完成」（2026-10-22 界面审查：一屏一个主操作）
              className="flex-shrink-0 min-h-[46px] px-3.5 rounded-card bg-btn text-primary border border-divider text-xs font-bold flex items-center gap-1 active:scale-press-sm transition-transform [&>svg]:text-accent"
            >
              <Plus size={14} strokeWidth={2.5} />
              {isCn ? '新动作' : 'New'}
            </button>
          </div>
        )}

        {/* 筛选区收起态：一行摘要（键盘弹起时） */}
        {filtersCollapsed && !arranging && (
          <div className="flex items-center gap-2 px-4 pb-2 flex-shrink-0">
            <button
              type="button"
              onClick={() => setKbExpandFilters(true)}
              className="flex-1 min-w-0 min-h-[36px] px-3 rounded-control bg-inset text-micro font-bold text-secondary flex items-center gap-1.5 active:bg-card-hover transition-colors"
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

        {/* 整理：部位目录一行横滑，末尾「未分部位 N · 已删除 N · ＋ 部位」 */}
        {arranging && (
          <div className="mx-4 mb-2.5 flex-shrink-0 border-b border-divider">
            <div ref={partScrollRef} className="flex overflow-x-auto hscroll-bare -mx-1" data-testid="arrange-parts">
              {renderAxisChips()}
              {noPart.length > 0 && (
                <button
                  type="button"
                  aria-pressed={special === 'none'}
                  data-on={special === 'none' ? '1' : undefined}
                  onClick={() => setSpecial('none')}
                  className={tabCls(special === 'none')}
                  data-testid="arrange-nopart"
                >
                  {isCn ? '未分部位' : 'No part'}
                  {tabCount(noPart.length, special === 'none')}
                  {tabBar(special === 'none')}
                </button>
              )}
              {deleted.length > 0 && (
                <button
                  type="button"
                  aria-pressed={special === 'del'}
                  data-on={special === 'del' ? '1' : undefined}
                  onClick={() => setSpecial('del')}
                  className={tabCls(special === 'del')}
                  data-testid="arrange-deleted"
                >
                  {isCn ? '已删除' : 'Deleted'}
                  {tabCount(deleted.length, special === 'del')}
                  {tabBar(special === 'del')}
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  dismissToasts();
                  setPartMenu({ id: '' });
                }}
                aria-label={isCn ? '新建部位' : 'New part'}
                className="flex-shrink-0 min-h-[40px] px-3 text-small font-bold text-accent flex items-center gap-1 whitespace-nowrap"
                data-testid="arrange-new-part"
              >
                <Plus size={14} strokeWidth={2.5} />
                {isCn ? '部位' : 'Part'}
              </button>
            </div>
          </div>
        )}

        {/* 普通态筛选：部位目录（全部 + 各部位）一行横滑 + 行尾「器材」，点开铺等宽格（2026-10-20 统一，原两套排法） */}
        {!filtersCollapsed && !arranging && (
          <>
            <div className="mx-4 mb-2.5 flex-shrink-0 border-b border-divider flex items-end gap-1" data-testid="filters-one-line">
              <div ref={partScrollRef} className="flex-1 min-w-0 flex overflow-x-auto hscroll-bare -ml-1">
                <button
                  type="button"
                  aria-pressed={axis === null}
                  data-on={axis === null ? '1' : undefined}
                  onClick={() => setAxis(null)}
                  className={tabCls(axis === null)}
                >
                  {isCn ? '全部' : 'All'}
                  {tabBar(axis === null)}
                </button>
                {renderAxisChips()}
              </div>
              <button
                type="button"
                onClick={() => setEquipOpen(v => !v)}
                aria-expanded={equipOpen}
                className={`flex-shrink-0 max-w-[128px] min-h-[40px] pl-2.5 pr-1 text-small font-bold flex items-center gap-1 border-l border-divider ${
                  equips.size > 0 ? 'text-accent' : 'text-secondary'
                }`}
                data-testid="equip-toggle"
              >
                <span className="truncate">{selectedEquipNames.length ? selectedEquipNames.join(' · ') : isCn ? '器材' : 'Gear'}</span>
                {equipOpen ? <ChevronUp size={13} className="flex-shrink-0" /> : <ChevronDown size={13} className="flex-shrink-0" />}
              </button>
            </div>
            {equipOpen && (
              <div className="grid grid-cols-4 gap-1.5 px-4 pb-2.5 flex-shrink-0" data-testid="equip-filter">
                {equipChips()}
              </div>
            )}
          </>
        )}

        {/* 计数 / 清空（选了部位时不显示：清空就是点「全部」） */}
        {(q || nFilters > 0) && !arranging && !oneLine && (
          <div className="flex items-center justify-between px-4 pb-1.5 flex-shrink-0 text-micro font-semibold text-tertiary">
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
            boardPart || arranging ? 'pb-24' : 'pb-6'
          }${arranging ? ' is-arranging' : ''}${isCn ? '' : ' is-en'}`}
        >
          {arranging ? (
            <>
              {special === 'none'
                ? renderTray(noPart)
                : special === 'del'
                  ? renderTray(deleted, true)
                  : boardPart
                    ? renderBoard(boardPart)
                    : renderTray(results.map(r => r.ex))}
              {renderEquipSection()}
            </>
          ) : q ? (
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
                <Star size={13} className="text-accent fill-current" />,
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

          {!arranging && totalCount === 0 && (
            <div className="text-center pt-9 pb-2 text-small font-semibold text-secondary">
              <Search size={32} className="mx-auto mb-2.5 text-tertiary" strokeWidth={1.5} />
              {q
                ? (isCn ? '动作库里没有匹配的动作' : 'No matching exercise')
                : (isCn ? '当前筛选下没有动作' : 'No exercises under current filters')}
            </div>
          )}

          {!arranging && q && !hasExactMatch && (
            <button
              type="button"
              onClick={() => onCreateCustomExercise(q, createPreset())}
              className="w-full min-h-[46px] mt-3 border border-dashed border-divider rounded-card text-accent text-small font-bold flex items-center justify-center gap-2 active:bg-card-hover transition-colors"
            >
              <Plus size={15} strokeWidth={2.5} />
              {isCn ? `没找到？创建「${q}」` : `Create "${q}"`}
            </button>
          )}
        </div>

        {/* 底部「完成」（2026-10-11）：关闭原来只在最上面（× / 顶上一条 scrim），而「添加动作」在最下面，
            每加一个动作都要换一次手位。这一条固定在拇指区；下滑关闭照旧。整理态底部是器材栏，不叠。 */}
        {!arranging && (
          <div
            className="flex-shrink-0 px-4 pt-2 border-t border-divider"
            style={{ paddingBottom: 'calc(10px + env(safe-area-inset-bottom, 0px))' }}
          >
            <button
              type="button"
              onClick={onClose}
              className="w-full min-h-[48px] rounded-control bg-accent text-on-accent font-bold text-base flex items-center justify-center gap-2 active:opacity-90"
              data-testid="picker-done"
            >
              {isCn ? '完成' : 'Done'}
              {sessionAdded > 0 && (
                <span className="text-xs font-semibold tabular-nums">
                  · {isCn ? `本次已加 ${sessionAdded}` : `${sessionAdded} added`}
                </span>
              )}
            </button>
          </div>
        )}
      </section>

      {/* 细分面板（整理）：改名 / 左右移 / 按默认排序 / 删除；或新建 + 恢复删掉的系统细分 */}
      {regionMenu && boardPart && (() => {
        const part = boardPart;
        const ids = regionsOf(part).map(r => r.id);
        const id = regionMenu.id;
        const i = ids.indexOf(id);
        const hidden = hiddenRegionsOf(part);
        const close = () => setRegionMenu(null);
        return (
          <NamePanel
            key={id || 'new'}
            testId="region-menu"
            title={id ? getTagName(id) : isCn ? '新建细分' : 'New region'}
            subtitle={getTagName(part)}
            initial={id ? getTagName(id) : ''}
            placeholder={isCn ? '细分名称' : 'Region name'}
            isCn={isCn}
            onCommit={name => (id ? renameTag(id, name) : !!addRegionTag(part, name))}
            onClose={close}
          >
            {id ? (
              <>
                <div className="flex gap-2">
                  <button type="button" className={`${panelBtn} justify-center`} disabled={i <= 0} onClick={() => moveRegion(part, id, -1)}>
                    <ChevronLeft size={16} className="text-accent" /> {isCn ? '左移' : 'Move left'}
                  </button>
                  <button
                    type="button"
                    className={`${panelBtn} justify-center`}
                    disabled={i < 0 || i >= ids.length - 1}
                    onClick={() => moveRegion(part, id, 1)}
                  >
                    {isCn ? '右移' : 'Move right'} <ChevronRight size={16} className="text-accent" />
                  </button>
                </div>
                <button
                  type="button"
                  className={panelBtn}
                  onClick={() => {
                    // 拖过一次的列从此按手动顺序；这里清掉序号，回到「收藏 → 最近 → 其余」
                    const col = boardColsRef.current.get(id) ?? [];
                    applyRegionLayout(col.map(e => ({ id: e.id, region: id })));
                    close();
                    toast(isCn ? `「${getTagName(id)}」已按默认排序` : `"${getTagName(id)}" back to default order`, 'success');
                  }}
                >
                  <ArrowDownUp size={16} className="text-accent" />
                  {isCn ? '按默认排序' : 'Default order'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    close();
                    removeRegion(part, id);
                  }}
                  className={dangerBtn}
                >
                  <Trash2 size={16} />
                  {isCn ? '删除这个细分' : 'Remove region'}
                </button>
              </>
            ) : (
              hidden.length > 0 && (
                <>
                  <div className="px-2 pt-1 text-micro font-bold tracking-[0.2em] text-secondary">
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
          </NamePanel>
        );
      })()}

      {/* 部位面板（整理）：再点已选中的部位＝改名 / 删除自建；「＋」＝新建 */}
      {partMenu && (() => {
        const id = partMenu.id;
        const custom = !!id && customPartIds.some(c => c.toLowerCase() === id.toLowerCase());
        const close = () => setPartMenu(null);
        return (
          <NamePanel
            key={id || 'new'}
            testId="part-menu"
            title={id ? getTagName(id) : isCn ? '新建部位' : 'New part'}
            subtitle={isCn ? '部位' : 'Part'}
            initial={id ? getTagName(id) : ''}
            placeholder={isCn ? '部位名称' : 'Part name'}
            isCn={isCn}
            onCommit={name => {
              if (id) return renameTag(id, name);
              const nid = addTag('bodyPart', name);
              if (!nid) return false;
              setSpecial(null);
              setAxis({ kind: 'part', v: nid });
              return true;
            }}
            onClose={close}
          >
            {custom && (
              <button
                type="button"
                onClick={() => {
                  close();
                  // 用过它的动作落到「未分部位」（引用不改，撤销即回来）
                  const orphans = merged.filter(ex => (ex.bodyPart || '').toLowerCase() === id.toLowerCase()).length;
                  void deleteTag(id);
                  if (orphans) setSpecial('none');
                  else setAxis({ kind: 'part', v: BODY_PARTS[0] });
                }}
                className={dangerBtn}
              >
                <Trash2 size={16} />
                {isCn ? '删除这个部位' : 'Delete part'}
              </button>
            )}
          </NamePanel>
        );
      })()}

      {/* 器材面板（整理最底下的器材节）：改名 / 删除自建；「＋」＝新建 */}
      {equipMenu && (() => {
        const id = equipMenu.id;
        const custom = !!id && /^ct_/i.test(id);
        const close = () => setEquipMenu(null);
        return (
          <NamePanel
            key={id || 'new'}
            testId="equip-menu"
            title={id ? getTagName(id) : isCn ? '新建器材' : 'New gear'}
            subtitle={isCn ? '器材' : 'Gear'}
            initial={id ? getTagName(id) : ''}
            placeholder={isCn ? '器材名称' : 'Gear name'}
            isCn={isCn}
            onCommit={name => (id ? renameTag(id, name) : !!addTag('equipment', name, newEquipRes))}
            onClose={close}
          >
            {/* 阻力：自建器材（含新建）可选，决定用它的动作默认怎么取整；内置器材只显示 */}
            {(() => {
              const selectable = !id || custom;
              const cur = id ? defaultResistance(id, customTags) : newEquipRes;
              const resName = (r: Resistance) => RESISTANCE_NAMES[r][isCn ? 'cn' : 'en'];
              if (!selectable) {
                return (
                  <p className="px-2 py-1 text-xs text-tertiary" data-testid="equip-resistance">
                    {isCn ? '阻力' : 'Load'}：{resName(cur)}
                    {resistanceSelectable(id) ? (isCn ? '（默认，动作上可改）' : ' (default, per exercise)') : ''}
                  </p>
                );
              }
              return (
                <div className="px-1 pt-1 space-y-1.5" data-testid="equip-resistance">
                  <p className="px-1 text-label text-secondary">{isCn ? '默认阻力' : 'Default load'}</p>
                  <div className="grid grid-cols-3 gap-1.5">
                    {RESISTANCES.map(r => (
                      <button
                        key={r}
                        type="button"
                        aria-pressed={cur === r}
                        onClick={() => (id ? setEquipmentResistance(id, r) : setNewEquipRes(r))}
                        className={`min-h-[40px] px-2 rounded-control text-xs font-bold transition-ui ${
                          cur === r ? 'bg-accent-soft text-accent' : 'bg-card text-secondary active:bg-card-hover'
                        }`}
                      >
                        {resName(r)}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })()}
            {custom && (
              <button
                type="button"
                onClick={() => {
                  close();
                  void deleteTag(id);
                }}
                className={dangerBtn}
              >
                <Trash2 size={16} />
                {isCn ? '删除这个器材' : 'Delete gear'}
              </button>
            )}
          </NamePanel>
        );
      })()}

      {/* 动作面板：普通态长按 / 整理态点卡 */}
      {menuEx && (
        <ExerciseActionPanel
          ex={menuEx}
          lang={lang}
          onClose={() => setMenuFor(null)}
          onAssignRegion={(ex, region) => placeInRegion(ex.id, region, null, ex)}
          onEditTags={onEditExerciseTags}
          onVariants={setVariantFor}
          onNote={onOpenNote}
          onMetrics={onOpenMetrics}
          onDelete={onDeleteExercise}
          library={merged}
        />
      )}

      {/* 从动作库进的做法：只管理（改名 / 删除 / 新建 / 细分与器材），不切换任何一张训练卡 */}
      <VariantModal
        open={!!variantFor}
        lang={lang}
        exerciseName={variantFor ?? ''}
        manage
        onSelect={() => {}}
        onClose={() => setVariantFor(null)}
      />
    </div>
  );
};

export default ExercisePickerSheet;
