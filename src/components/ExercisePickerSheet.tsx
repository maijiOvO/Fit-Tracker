/**
 * 训练页「添加动作」底部弹层（2026-10-27 重构成「分类页」，demo：docs/demos/picker-layout-a.html）
 *
 * 版面跟 App 别处一个语言：bg-card 行块 + 一行一行的列表 + 小灰字分组标题。原来是 chip 卡片墙 + 横滑的细分列，
 * 用户说「跟应用其他地方的排版逻辑非常不一致」。
 *   - 头部 → 搜索行（搜索 · 器材 · 新动作）→ 部位下划线标签 → 左竖栏 + 右行列表 → 完成
 *   - 竖栏永远列「当前这一级的下一级」：全部＝收藏 · 最近 · 热身 · 各部位；部位＝热身 · 各细分 · 未细分；
 *     有氧 / 自由没有下一级，不出竖栏。点竖栏跳到那组，滚动时竖栏跟着亮
 *   - 行：器材剪影 | 名字（做法、收藏星、兼）+ 上次成绩 · 几天前 | ＋（已加＝主色 ×N）
 *   - 复合动作在它挂的每个细分里都找得到：主细分里照常排，别的细分里收在组尾「兼练 N」，点开才铺
 *   - 热身是动作自己的热身用途（warmParts），挂在哪几个部位就出现在哪几个部位的「热身」组里
 *   - 点＝添加，弹层不关：闪一下 + 头部「本次已加 N」+ 震动；450ms 双击防误触；长按＝动作面板
 *   - 「整理」：行右侧换成 ›、小灰字换成归类；点行＝动作面板。原来的按住拖进细分列（浮卡磁吸落位）删了：
 *     拖只表达得了「换到一列」，表达不了「同时属于几列」。全部＝待办（未分部位 · 未细分 · 已删除）；
 *     竖栏底部「编辑部位」「器材」
 *   - 搜索有字 / 软键盘弹起时部位标签临时收起（搜索不按部位锁），收键盘、清搜索后复原
 *   - 常驻挂载，open 切换显隐（筛选跨开合保留，每次打开只清搜索词）；软键盘弹起时压到键盘上沿；
 *     手指在弹层任何位置往下拉即可关闭（列表不在顶部时先让列表往回滚）
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Filter, Lock, Plus, Search, Star, Trash2, X } from 'lucide-react';
import { ExerciseDefinition, ExerciseVariant, Language } from '../../types';
import { BODY_PARTS } from '../constants/exercises';
import { useExercisePrefs } from '../contexts/ExercisePrefsContext';
import { useUserSettingsContext } from '../contexts/UserSettingsContext';
import { useExerciseStats } from '../hooks/useFilteredExercises';
import { useDoneWorkouts, useLiftSummaries } from '../hooks/useLiftSummaries';
import { useExercisePickerData, PickerAxis, matchAxis, equipmentsOf } from '../hooks/useExercisePickerData';
import { EQ_BARBELL, RESISTANCES, RESISTANCE_NAMES, defaultResistance, resistanceSelectable, type Resistance } from '../utils/exerciseAttrs';
import { agoLabel, formatSet } from '../utils/liftDisplay';
import { useKeyboardInset } from '../hooks/useKeyboardInset';
import { useLongPress } from '../hooks/useLongPress';
import { useUiOverlay } from '../contexts/UiOverlayContext';
import { haptic, H } from '../utils/haptics';
import { LongPressAffordance } from './LongPressAffordance';
import { ExerciseActionPanel } from './ExerciseActionPanel';
import { EditPartsPanel } from './EditPartsPanel';
import { VariantModal } from './modals/VariantModal';
import { useBackClose } from '../hooks/useBackClose';

const NO_EQUIPS: ReadonlySet<string> = new Set();

/**
 * 器材小剪影（「杠铃片」阶段二，2026-10-22）：和训练页大图同形 —— 杠铃＝杆＋两片、哑铃＝两头、
 * 壶铃＝提手＋铃身、配重片＝一摞。灰色不上色，不抢名字。自重 / 弹力带 / 不计重不画（没有器材可画）。
 * 杠铃片挂在杠铃上画杠铃；挂在别的器材上（悍马、倒蹬、史密斯这类挂片器械）画「挂片」——
 * 一开始按阻力一律画成杠铃，悍马卧推这种固定器械也出现杠铃图标（2026-10-22 用户指出）。
 */
type EquipIcon = 'bar' | 'plate' | 'db' | 'kb' | 'stack';
const equipIconOf = ({ equipment, resistance: r }: { equipment: string; resistance: Resistance }): EquipIcon | undefined =>
  r === 'plates' ? (equipment.toLowerCase() === EQ_BARBELL.toLowerCase() ? 'bar' : 'plate')
  : r === 'fixedBar' ? 'bar'
  : r === 'dumbbell' ? 'db'
  : r === 'kettlebell' ? 'kb'
  : r === 'stack' ? 'stack'
  : undefined;

interface PickerRowProps {
  name: string;
  /** 做法名（「上斜」）：接在名字后面的小灰字 */
  sub?: string;
  isStarred: boolean;
  /** 兼练（这个细分是它的次要细分）：名字后一个「兼」 */
  also?: boolean;
  equip?: EquipIcon;
  meta: React.ReactNode;
  /** add＝＋ / ×N；more＝整理态的 ›；restore＝已删除的「恢复」 */
  right: 'add' | 'more' | 'restore';
  added: number;
  isCn: boolean;
  bindRef?: (el: HTMLButtonElement | null) => void;
  onPick: () => void;
  /** 普通态长按＝动作面板；整理态不传（点就是面板） */
  onLongPress?: () => void;
}

/**
 * 一行动作。长按要用 useLongPress，hook 不能写在 .map() 的回调里，所以提成组件。
 * 长按必须带自解释标签：不加的话连设计者本人都不记得这手势是干嘛的。
 */
const PickerRow: React.FC<PickerRowProps> = ({ name, sub, isStarred, also, equip, meta, right, added, isCn, bindRef, onPick, onLongPress }) => {
  const press = useLongPress({ onLongPress: onLongPress ?? (() => {}), disabled: !onLongPress });
  return (
    <button
      ref={bindRef}
      type="button"
      onClick={onPick}
      {...(onLongPress ? press.handlers : { onContextMenu: (e: React.SyntheticEvent) => e.preventDefault() })}
      className={`picker-row select-none${added && right === 'add' ? ' is-added' : ''}`}
      data-testid="picker-sheet-exercise"
    >
      <span className="picker-row-ico" aria-hidden>
        {equip && <i className={`eq-ico eq-${equip}`} />}
      </span>
      <span className="picker-row-mid">
        <span className="picker-row-name">
          {name}
          {sub && <span className="picker-row-sub">· {sub}</span>}
          {isStarred && <Star size={10} strokeWidth={0} className="picker-row-star fill-current" aria-label={isCn ? '收藏' : 'Starred'} />}
          {also && <span className="picker-row-also">{isCn ? '兼' : 'also'}</span>}
        </span>
        <span className="picker-row-meta" data-testid="picker-row-attrs">{meta}</span>
      </span>
      {right === 'add' ? (
        <span className="picker-row-add">{added ? `×${added}` : <Plus size={18} strokeWidth={2} />}</span>
      ) : right === 'more' ? (
        <ChevronRight size={17} className="flex-shrink-0 text-tertiary" />
      ) : (
        <span className="flex-shrink-0 px-1.5 text-xs font-bold text-accent">{isCn ? '恢复' : 'Restore'}</span>
      )}
      {onLongPress && (
        <LongPressAffordance active={press.pressing} hint={press.hinting} label={isCn ? '管理这个动作' : 'Manage'} drawMs={press.drawMs} placement="down" />
      )}
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
 * 器材的底部面板（标题 + 名字输入 + 改名/添加 + 其他操作 + 完成）。
 * 「完成」时名字改过就一起存（region-panel-done-discards-rename：原先只认改名按钮和回车，直接点完成会丢）。
 */
const NamePanel: React.FC<NamePanelProps> = ({ testId, title, subtitle, initial, placeholder, isCn, onCommit, onClose, children }) => {
  const [draft, setDraft] = useState(initial);
  const dirty = !!draft.trim() && draft.trim() !== initial;
  const commit = () => {
    if (dirty && onCommit(draft.trim())) onClose();
  };
  return (
    <div className="absolute inset-0 z-20 bg-scrim flex items-end sm:items-center justify-center anim-fade" onClick={onClose} data-testid={testId}>
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

const dangerBtn =
  'w-full min-h-[48px] px-4 rounded-card bg-danger/10 text-small font-bold text-danger flex items-center gap-2.5 active:bg-danger/20 transition-colors';

interface ExercisePickerSheetProps {
  open: boolean;
  /** 这场标的馆：插销 / 挂片的器械在这个馆改过形式（gymKinds）的，小图标跟着这个馆画 */
  gym?: string;
  onClose: () => void;
  /**
   * 这次打开要直接停在哪个部位（BODY_PARTS 的 id，如 'subChest'）。
   * 开练时选了「练胸」→ 弹层一打开就是胸部那一栏，不用再点一次。
   * 只在打开的那一刻生效一次；null = 沿用上次的筛选（筛选记忆）。
   */
  focusPart?: string | null;
  /** 小写显示名 -> 当前训练中出现次数（驱动「×N」） */
  addedCounts: Record<string, number>;
  /** 本次弹层会话累计添加数（App 维护，含新建动作路径） */
  sessionAdded: number;
  /** 点行。返回 false＝这是「取消本次添加」（本次打开里刚加过的再点一下），不播添加动画 */
  onPickExercise: (ex: ExerciseDefinition, variantId?: string) => boolean | void;
  /** 普通态里换了部位（部位标签，如 subChest）：训练名没手动改过时跟着改 */
  onPartChange?: (bodyPart: string) => void;
  /** preset：弹层眼下停的部位 / 有氧栏（「新动作」照它预填，审查 A16） */
  onCreateCustomExercise: (prefilledName?: string, preset?: { bodyPart?: string; category?: string; regions?: string[] }) => void;
  /** 从交替组「加一个动作」打开：头部写「加到 X ⇄ Y」，选的动作加进那个组 */
  targetLabel?: string | null;
  /**
   * 层级：训练页是页面上的弹层（sheet）；计划编辑器是弹窗（z-modal），从它里面打开要压过它（modal-2）。
   * 弹层里再开的弹窗（新建动作、备注、记录项、改名 = modal-2）都是后挂的 portal，同层也盖得住。
   */
  layer?: 'sheet' | 'modal-2';
  /**
   * 只管动作库（首选项「动作库与标签 ›」打开）：一打开就是整理态，「完成」直接关弹层。
   * 不加动作，onPickExercise 不会被调到。
   */
  libraryOnly?: boolean;
  // ===== 动作面板里打开的弹窗（复用 App 层同一批弹窗） =====
  onDeleteExercise: (id: string) => void;
  onOpenNote: (name: string) => void;
  onOpenMetrics: (name: string) => void;
}

/** 一行：动作，或带细分的做法（「高位下拉 · 宽握」落在背阔）；also＝兼练 */
interface Item {
  ex: ExerciseDefinition;
  v?: ExerciseVariant;
  also?: boolean;
}
interface Group {
  key: string;
  title: string;
  items: Item[];
  /** 细分组：整理态空着也列出来 */
  region?: boolean;
  /** 整理态的待办（未分部位 / 未细分）：有动作时计数标黄 */
  todo?: boolean;
  /** 全部 → 热身：小灰字写挂在哪几个部位 */
  warmAll?: boolean;
  /** 已删除：点＝恢复 */
  deleted?: boolean;
}

const warmPartsOf = (ex: ExerciseDefinition) => (ex.warmParts ?? []).map(p => p.toLowerCase());
const isWarmOnly = (ex: ExerciseDefinition) => !!ex.warmOnly && (ex.warmParts ?? []).length > 0;
const isStrength = (ex: ExerciseDefinition) => (ex.category || 'STRENGTH') === 'STRENGTH';

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
  onDeleteExercise,
  onOpenNote,
  onOpenMetrics,
  gym,
}) => {
  const {
    starredExercises,
    resolveName,
    getTagName,
    regionsOf,
    effectiveRegion,
    effectiveRegions,
    effectivePart,
    sortParts,
    renameTag,
    addTag,
    setEquipmentResistance,
    customTags,
    deleteTag,
    restoreLibraryExercise,
    attrsOf,
  } = useExercisePrefs();
  const { dismissToasts } = useUiOverlay();
  const { lang, unit, appPrefs } = useUserSettingsContext();
  const { recentExerciseNames } = useExerciseStats();
  const isCn = lang === Language.CN;

  /** 「整理」：动作库的编辑态。点行＝动作面板 */
  const [arranging, setArranging] = useState(false);
  /** 器材表 / 器材面板：{ id }＝改名 / 删除；{ id: '' }＝新建 */
  const [equipList, setEquipList] = useState(false);
  const [equipMenu, setEquipMenu] = useState<{ id: string } | null>(null);
  /** 新建器材时先选的默认阻力（建好才落盘） */
  const [newEquipRes, setNewEquipRes] = useState<Resistance>('none');
  /** 编辑部位：从哪个部位进来（null＝部位列表）；undefined＝没开 */
  const [editParts, setEditParts] = useState<string | null | undefined>(undefined);
  /** 动作面板（长按 / 整理态点行）：存 id，每次渲染从库里取最新的（改名、加星后立刻反映） */
  const [menuFor, setMenuFor] = useState<string | null>(null);
  /** 动作面板里打开的练法（只管理，不切换） */
  const [variantFor, setVariantFor] = useState<string | null>(null);
  /** 器材筛选格展开 */
  const [equipOpen, setEquipOpen] = useState(false);
  /** 展开了「兼练」的组（部位 + 组 key） */
  const [alsoOpen, setAlsoOpen] = useState<ReadonlySet<string>>(new Set());

  // ===== 筛选状态（跨开合保留；仅搜索词随打开重置） =====
  const [query, setQuery] = useState('');
  const [axis, setAxis] = useState<PickerAxis>(null);
  const [equips, setEquips] = useState<ReadonlySet<string>>(new Set());

  // 整理：不按器材筛（整理态看不到器材格，筛着会让组缺一块，arrange-hidden-equip-filter）
  const { results, equipCounts, axisAvailable, equipIds, customPartIds, merged, byId, deleted, noPart } =
    useExercisePickerData({ query, axis, equips: arranging ? NO_EQUIPS : equips });

  // 每个动作 / 做法最近一场的最重一组（行的小灰字「上次 80 kg×5 · 3 天前」）；键同 useLiftSummaries 的稳定键
  const { workouts: doneWorkouts } = useDoneWorkouts();
  const lifts = useLiftSummaries(doneWorkouts);
  const lastOf = useMemo(() => {
    const m = new Map<string, { line: string; ts: number }>();
    for (const l of lifts) {
      const s = l.sessions[l.sessions.length - 1];
      if (s) m.set(l.stableId, { line: s.top ? formatSet(s.top, unit, l.signed, isCn) : '', ts: s.ts });
    }
    return m;
  }, [lifts, unit, isCn]);

  const inset = useKeyboardInset(open);
  // 安卓返回键关弹层（审查 B11）
  useBackClose(open, onClose);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const resultsRef = useRef<HTMLDivElement | null>(null);
  const railRef = useRef<HTMLElement | null>(null);
  const partScrollRef = useRef<HTMLDivElement | null>(null);
  const rowRefs = useRef<Map<string, HTMLElement>>(new Map());
  const lastPickRef = useRef<{ id: string; t: number }>({ id: '', t: 0 });
  /**
   * 长按出面板之后，吞掉松手带出的那次 click（不算「添加」）。
   * 用时间戳不用布尔：面板一弹出就盖在手指下面，那次 click 往往根本落不到行上，
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
   * 什么时候接管：往下拉，并且——起手不在可滚的区域（行列表、竖栏）里，或那块已经在顶上。
   * 滚到一半时往下拉＝往回滚，照旧交给它；往上推、横向划一律不管。
   */
  useEffect(() => {
    const el = sheetRef.current;
    if (!el) return;
    /** 超过这么多才下结论。要小于浏览器自己的触摸容差（Android Chrome 约 15px），抢在它前面 */
    const DECIDE_PX = 4;
    let t: { x0: number; y0: number; scroller: HTMLElement | null; mode: 'undecided' | 'drag' | 'pass' } | null = null;
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
      const scroller = resultsRef.current?.contains(target) ? resultsRef.current : railRef.current?.contains(target) ? railRef.current : null;
      t = { x0: e.touches[0].clientX, y0: e.touches[0].clientY, scroller, mode: 'undecided' };
    };
    const onMove = (e: TouchEvent) => {
      if (!t || t.mode === 'pass') return;
      if (e.touches.length !== 1) {
        if (t.mode === 'drag') dragEndRef.current();
        t = null;
        return;
      }
      const dx = e.touches[0].clientX - t.x0;
      const dy = e.touches[0].clientY - t.y0;
      if (t.mode === 'undecided') {
        if (Math.abs(dx) < DECIDE_PX && Math.abs(dy) < DECIDE_PX) return;
        const atTop = (t.scroller?.scrollTop ?? 0) <= 0;
        if (dy > 0 && Math.abs(dy) > Math.abs(dx) && atTop) {
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
      if (libraryOnly) setArranging(true);
    } else {
      searchInputRef.current?.blur();
      setMenuFor(null);
      setArranging(false);
      setEditParts(undefined);
      setEquipList(false);
      setEquipMenu(null);
      setEquipOpen(false);
    }
  }, [open]);

  const kbOpen = inset > 0;

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
  }, [axis, arranging]);

  // ===== 排序：收藏 → 最近 → 其余（库内顺序） =====
  const q = query.trim();
  const { starredGroup, recentGroup, flatGroup, rank } = useMemo(() => {
    const starScore = new Map<string, number>(Object.entries(starredExercises).map(([k, v]) => [k.toLowerCase(), Number(v ?? 0)]));
    const recentIdx = new Map<string, number>(recentExerciseNames.map((n, i) => [n.toLowerCase(), i]));
    const keyOf = (ex: ExerciseDefinition) => resolveName(ex.name[lang]).toLowerCase();

    if (q) {
      // 搜索：拉平，按匹配分 + 常用 / 最近加权排序
      const boost = (ex: ExerciseDefinition) => (starScore.has(keyOf(ex)) ? 15 : 0) + (recentIdx.has(keyOf(ex)) ? 8 : 0);
      const flat = [...results].sort((a, b) => b.score + boost(b.ex) - (a.score + boost(a.ex))).map(r => r.ex);
      return { starredGroup: [], recentGroup: [], flatGroup: flat, rank: new Map<string, number>() };
    }
    const starred: ExerciseDefinition[] = [];
    const recent: ExerciseDefinition[] = [];
    const other: ExerciseDefinition[] = [];
    for (const { ex } of results) {
      const key = keyOf(ex);
      if (starScore.has(key)) starred.push(ex);
      else if (recentIdx.has(key)) recent.push(ex);
      else other.push(ex);
    }
    starred.sort((a, b) => (starScore.get(keyOf(b)) ?? 0) - (starScore.get(keyOf(a)) ?? 0));
    const seen = new Set<string>();
    const dedupedRecent = recent
      .filter(ex => !seen.has(keyOf(ex)) && !!seen.add(keyOf(ex)))
      .sort((a, b) => (recentIdx.get(keyOf(a)) ?? 0) - (recentIdx.get(keyOf(b)) ?? 0));
    const rank = new Map<string, number>();
    [...starred, ...dedupedRecent, ...other].forEach((ex, i) => rank.set(ex.id, i));
    return { starredGroup: starred, recentGroup: dedupedRecent, flatGroup: [], rank };
  }, [q, results, starredExercises, recentExerciseNames, resolveName, lang]);
  /** 组内顺序：手动排过的（regionRank）在前按序号，没排过的接在后面按默认 */
  const byRank = (arr: ExerciseDefinition[]) =>
    [...arr].sort((a, b) => {
      if ((a.regionRank != null) !== (b.regionRank != null)) return a.regionRank != null ? -1 : 1;
      if (a.regionRank != null && b.regionRank != null) return a.regionRank - b.regionRank;
      return (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0);
    });

  // ===== 部位标签（系统部位 + 自建部位按用户排的顺序，再接有氧 / 自由） =====
  const axisChips = useMemo(() => {
    const parts = sortParts([...BODY_PARTS, ...customPartIds]).map(p => ({ kind: 'part' as const, v: p }));
    return [...parts, { kind: 'cat' as const, v: 'CARDIO' }, { kind: 'cat' as const, v: 'FREE' }];
  }, [customPartIds, sortParts]);
  const axisLabel = (chip: { kind: 'part' | 'cat'; v: string }) => {
    if (chip.kind === 'cat') return chip.v === 'CARDIO' ? (isCn ? '有氧' : 'Cardio') : isCn ? '自由' : 'Free';
    return getTagName(chip.v);
  };

  // ===== 分组：竖栏的每一项 = 右边的一组 =====
  const groups = useMemo<Group[]>(() => {
    const items = (arr: ExerciseDefinition[]) => arr.map(ex => ({ ex }));
    const inResults = new Set(results.map(r => r.ex.id));
    const equipOk = (ex: ExerciseDefinition) => arranging || !equips.size || equipmentsOf(ex).some(t => equips.has(t));
    if (q) {
      // 搜索：当前部位的排前面、其他的接在下面
      const here = axis ? flatGroup.filter(ex => matchAxis(ex, axis)) : flatGroup;
      const rest = axis ? flatGroup.filter(ex => !matchAxis(ex, axis)) : [];
      const title = axis ? axisLabel(axis) : isCn ? '搜索结果' : 'Results';
      return [
        { key: 'here', title, items: items(here) },
        { key: 'rest', title: axis?.kind === 'part' ? (isCn ? '其他部位' : 'Other parts') : isCn ? '其他' : 'Others', items: items(rest) },
      ];
    }
    if (!axis) {
      if (arranging) {
        return [
          { key: 'nopart', title: isCn ? '未分部位' : 'No part', items: items(noPart.filter(ex => !isWarmOnly(ex))), todo: true },
          {
            key: 'noreg',
            title: isCn ? '未细分' : 'Unassigned',
            items: items(merged.filter(ex => isStrength(ex) && !isWarmOnly(ex) && regionsOf(effectivePart(ex)).length > 0 && !effectiveRegion(ex))),
            todo: true,
          },
          { key: 'deleted', title: isCn ? '已删除' : 'Deleted', items: items(deleted), deleted: true },
        ];
      }
      const train = results.map(r => r.ex).filter(ex => !isWarmOnly(ex));
      return [
        { key: 'star', title: isCn ? '收藏' : 'Starred', items: items(starredGroup) },
        { key: 'recent', title: isCn ? '最近' : 'Recent', items: items(recentGroup) },
        { key: 'warm', title: isCn ? '热身' : 'Warm-up', items: items(byRank(results.map(r => r.ex).filter(ex => warmPartsOf(ex).length))), warmAll: true },
        ...axisChips.map(chip => ({
          key: chip.kind + chip.v,
          title: axisLabel(chip),
          items: items(byRank(train.filter(ex => (chip.kind === 'part' ? (ex.bodyPart || '').toLowerCase() === chip.v.toLowerCase() : (ex.category || 'STRENGTH') === chip.v)))),
        })),
        { key: 'nopart', title: isCn ? '未分部位' : 'No part', items: items(noPart.filter(ex => inResults.has(ex.id) && !isWarmOnly(ex))) },
      ];
    }
    if (axis.kind === 'cat') return [{ key: 'cat', title: axisLabel(axis), items: items(byRank(results.map(r => r.ex))) }];

    const part = axis.v;
    const lower = part.toLowerCase();
    const all = results.map(r => r.ex);
    const warm: Group = { key: 'warm', title: isCn ? '热身' : 'Warm-up', items: items(byRank(all.filter(ex => warmPartsOf(ex).includes(lower)))) };
    const train = all.filter(ex => !isWarmOnly(ex) && (ex.bodyPart || '').toLowerCase() === lower);
    const regs = regionsOf(part);
    if (!regs.length) return [warm, { key: 'all', title: axisLabel(axis), items: items(byRank(train)) }];
    // 兼练可以来自别的部位（硬拉＝下背主、兼腿后侧和臀）：从整个库里找，器材筛选照样算
    const pool = merged.filter(ex => isStrength(ex) && !isWarmOnly(ex) && equipOk(ex));
    return [
      warm,
      ...regs.map(({ id }) => {
        const main = byRank(train.filter(ex => isStrength(ex) && effectiveRegion(ex) === id));
        // 带细分的做法单独一行落在自己那组（「高位下拉 · 宽握」在背阔、「· V 把」在中背）：用户找的是「练到这块肌肉的动作」
        const variants = train.flatMap(ex => (ex.variants ?? []).filter(v => v.region === id).map(v => ({ ex, v })));
        const also = byRank(pool.filter(ex => effectiveRegions(ex).indexOf(id) > 0));
        return { key: id, title: getTagName(id), region: true, items: [...items(main), ...variants, ...also.map(ex => ({ ex, also: true }))] };
      }),
      { key: 'un', title: isCn ? '未细分' : 'Unassigned', items: items(byRank(train.filter(ex => !isStrength(ex) || !effectiveRegion(ex)))), todo: true },
    ];
  }, [q, axis, arranging, results, flatGroup, starredGroup, recentGroup, merged, noPart, deleted, axisChips, equips, rank, regionsOf, effectiveRegion, effectiveRegions, effectivePart, getTagName, isCn]);

  // 普通态只列有动作的组；整理态细分空着也列（看得到才知道往哪归）
  const visible = groups.filter(g => g.items.length || (arranging && g.region));
  const showRail = !q && (arranging || visible.length > 1);
  const totalCount = results.length;

  /** 「新动作」按眼下停的那一栏预填：部位栏 → 这个部位；有氧 / 自由栏 → 那一类 */
  const createPreset = () =>
    axis?.kind === 'part' ? { bodyPart: axis.v } : axis?.kind === 'cat' ? { category: axis.v } : undefined;
  /** 搜索时每个结果命中的做法（做法名对上、动作名对不上的那些） */
  const variantHitOf = useMemo(
    () => new Map(results.filter(r => r.variant).map(r => [r.ex.id, r.variant!] as const)),
    [results],
  );
  const hasExactMatch = q.length > 0 && results.some(r => resolveName(r.ex.name[lang]).toLowerCase() === q.toLowerCase());
  const selectedEquipNames = equipIds.filter(id => equips.has(id.toLowerCase())).map(getTagName).filter(Boolean);

  // ===== 添加 =====
  const handlePick = (ex: ExerciseDefinition, variantId?: string) => {
    const now = Date.now();
    const pickKey = variantId ? `${ex.id}::${variantId}` : ex.id;
    if (lastPickRef.current.id === pickKey && now - lastPickRef.current.t < 450) return;
    lastPickRef.current = { id: pickKey, t: now };
    haptic(H.pick);
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
    setArranging(a => !a);
    setEquipOpen(false);
    if (resultsRef.current) resultsRef.current.scrollTop = 0;
  };

  // ===== 行 =====
  const bindItemRef = (id: string) => (el: HTMLElement | null) => {
    if (el) rowRefs.current.set(id, el);
    else rowRefs.current.delete(id);
  };
  const isStarredName = (name: string) => Object.keys(starredExercises).some(k => k.toLowerCase() === name.toLowerCase());
  const equipOf = (ex: ExerciseDefinition, vid?: string) => {
    const icon = equipIconOf(attrsOf(ex, vid));
    // 2026-10-22：悍马卧推在动作库里是插销，在 fit4less 改成了挂片，图标原来还画成插销
    if (!gym || (icon !== 'stack' && icon !== 'plate')) return icon;
    const k = appPrefs.gymKinds[`${gym}|${ex.id}|${vid ?? ''}`];
    return k === 'pin' ? 'stack' : k === 'loaded' ? 'plate' : icon;
  };
  /** 整理态 / 搜索的小灰字：它现在归在哪（主细分 · 兼 … · 热身 …），没归的标出来 */
  const classLine = (ex: ExerciseDefinition): React.ReactNode => {
    const warm = (ex.warmParts ?? []).length ? `${isCn ? '热身' : 'Warm-up'} · ${(ex.warmParts ?? []).map(getTagName).join(' ')}` : '';
    if (isWarmOnly(ex)) return warm;
    const part = effectivePart(ex);
    const tail = warm ? ` · ${warm}` : '';
    if (!part) return isStrength(ex) ? <><span className="text-warning font-semibold">{isCn ? '未分部位' : 'No part'}</span>{tail}</> : axisLabel({ kind: 'cat', v: ex.category || 'FREE' });
    const regs = effectiveRegions(ex);
    if (!regionsOf(part).length || !isStrength(ex)) return getTagName(part) + tail;
    if (!regs.length) return <>{getTagName(part)} · <span className="text-warning font-semibold">{isCn ? '未细分' : 'Unassigned'}</span>{tail}</>;
    const [main, ...rest] = regs;
    return (
      <>
        <span className="text-secondary font-semibold">{getTagName(main)}</span>
        {rest.length > 0 && ` · ${isCn ? '兼' : 'also'} ${rest.map(getTagName).join(' ')}`}
        {tail}
      </>
    );
  };
  const lastLine = (ex: ExerciseDefinition, vid?: string) => {
    const last = lastOf.get(`${ex.id}|${vid ?? ''}`);
    if (!last) return isCn ? '还没练过' : 'Not done yet';
    return `${isCn ? '上次' : 'Last'} ${last.line ? `${last.line} · ` : ''}${agoLabel(last.ts, isCn)}`;
  };

  const renderRow = (it: Item, g: Group) => {
    const { ex, also } = it;
    const baseName = resolveName(ex.name[lang]);
    // 搜的是做法名（「宽握」）：这一行就是那个做法，点它加的也是那个做法（审查 A13）
    const v = it.v ?? (q ? variantHitOf.get(ex.id) : undefined);
    const vid = v?.id;
    const key = baseName.toLowerCase();
    const pickKey = vid ? `${ex.id}::${vid}` : ex.id;
    const meta = arranging || q
      ? classLine(ex)
      : g.warmAll
        ? `${isCn ? '挂在' : 'For'} ${(ex.warmParts ?? []).map(getTagName).join(' · ')}`
        : lastLine(ex, vid);
    return (
      <PickerRow
        key={`${g.key}:${pickKey}${also ? ':also' : ''}`}
        name={baseName}
        sub={v?.name}
        isStarred={!vid && !g.deleted && isStarredName(baseName)}
        also={also}
        equip={equipOf(ex, vid)}
        meta={g.deleted ? (isCn ? '已删除' : 'Deleted') : meta}
        right={g.deleted ? 'restore' : arranging ? 'more' : 'add'}
        added={(vid ? addedCounts[`${key}::${vid}`] : addedCounts[key]) || 0}
        isCn={isCn}
        bindRef={bindItemRef(pickKey)}
        onPick={() => {
          if (swallowed()) return;
          if (g.deleted) {
            restoreLibraryExercise(ex.id);
            haptic(H.tap);
            return;
          }
          if (arranging) {
            openActionPanel(ex.id);
            return;
          }
          handlePick(ex, vid);
        }}
        onLongPress={
          arranging || g.deleted
            ? undefined
            : () => {
                suppressClickRef.current = performance.now(); // 松手后的 click 不再当作「添加」
                openActionPanel(ex.id);
              }
        }
      />
    );
  };

  /** 一组：吸顶的小灰字标题 + 行块；兼练收在组尾一行，点开才铺 */
  const renderGroup = (g: Group, i: number) => {
    const main = g.items.filter(it => !it.also);
    const also = g.items.filter(it => it.also);
    const openKey = `${axis?.v ?? ''}|${g.key}`;
    const alsoShown = alsoOpen.has(openKey);
    return (
      <section key={g.key} data-sec={i} className="picker-sec">
        <h3 className="picker-lbl">
          {g.title}
          <i>{main.length}</i>
        </h3>
        <div className="picker-block">
          {main.map(it => renderRow(it, g))}
          {!g.items.length && <div className="picker-none">{isCn ? '空' : 'Empty'}</div>}
          {also.length > 0 && (
            <button
              type="button"
              className="picker-also-tog"
              aria-expanded={alsoShown}
              onClick={() =>
                setAlsoOpen(s => {
                  const n = new Set(s);
                  if (n.has(openKey)) n.delete(openKey);
                  else n.add(openKey);
                  return n;
                })
              }
              data-testid="picker-also-toggle"
            >
              {isCn ? '兼练' : 'Also'} <i>{also.length}</i>
              <span>{alsoShown ? (isCn ? '收起' : 'Hide') : also.map(it => resolveName(it.ex.name[lang])).join(' · ')}</span>
              <ChevronDown size={14} className={`flex-shrink-0 transition-transform ${alsoShown ? 'rotate-180' : ''}`} />
            </button>
          )}
          {alsoShown && also.map(it => renderRow(it, g))}
        </div>
      </section>
    );
  };

  // ===== 竖栏：跟着右边滚动亮当前组；点了跳到那组 =====
  const [railOn, setRailOn] = useState(0);
  const syncRail = () => {
    const list = resultsRef.current;
    if (!list) return;
    const secs = [...list.querySelectorAll<HTMLElement>('section[data-sec]')];
    if (!secs.length) return;
    let cur = 0;
    secs.forEach((s, i) => {
      if (s.offsetTop - list.offsetTop <= list.scrollTop + 4) cur = i;
    });
    if (list.scrollTop > 0 && list.scrollTop + list.clientHeight >= list.scrollHeight - 2) cur = secs.length - 1;
    setRailOn(cur);
  };
  useEffect(() => {
    setRailOn(0);
  }, [axis, arranging, q]);
  useEffect(() => {
    railRef.current?.querySelector<HTMLElement>(`[data-rail="${railOn}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [railOn]);
  const jumpTo = (i: number) => {
    const list = resultsRef.current;
    const s = list?.querySelector<HTMLElement>(`section[data-sec="${i}"]`);
    if (list && s) list.scrollTo({ top: s.offsetTop - list.offsetTop, behavior: 'smooth' });
  };
  const addedIn = (g: Group) =>
    g.items.reduce((n, it) => {
      if (it.also) return n;
      const key = resolveName(it.ex.name[lang]).toLowerCase();
      return n + ((it.v ? addedCounts[`${key}::${it.v.id}`] : addedCounts[key]) || 0);
    }, 0);
  /** 竖栏的分隔线：全部里「热身 | 各部位」之间、部位里「热身 | 各细分」之间、未细分之前 */
  const sepBefore = (g: Group, i: number) =>
    i > 0 && (g.key === 'un' || g.key === 'nopart' || (axis ? visible[i - 1].key === 'warm' : g.key === axisChips[0].kind + axisChips[0].v));

  const tabCls = (on: boolean) =>
    `relative flex-shrink-0 min-h-[40px] px-3 text-small whitespace-nowrap flex items-center gap-1 transition-colors ${
      on ? 'text-accent font-bold' : 'text-secondary font-medium active:text-primary'
    }`;
  const tabBar = (on: boolean) => (on ? <span className="absolute left-2 right-2 bottom-0 h-[2px] rounded-full bg-accent" aria-hidden /> : null);
  const addedInPart = (part: string) => {
    const lower = part.toLowerCase();
    return merged.reduce((n, ex) => {
      if ((ex.bodyPart || '').toLowerCase() !== lower && !warmPartsOf(ex).includes(lower)) return n;
      return n + (addedCounts[resolveName(ex.name[lang]).toLowerCase()] || 0);
    }, 0);
  };

  /** 部位标签（普通态：0 结果的隐藏，已选中的除外；整理态：全部列出） */
  const renderAxisChips = () =>
    axisChips.map(chip => {
      const on = axis !== null && axis.kind === chip.kind && axis.v === chip.v;
      const availKey = chip.kind === 'part' ? 'part:' + chip.v.toLowerCase() : 'cat:' + chip.v;
      if (!arranging && !on && !axisAvailable.has(availKey)) return null;
      const label = axisLabel(chip);
      if (!label) return null;
      const n = !arranging && chip.kind === 'part' ? addedInPart(chip.v) : 0;
      return (
        <button
          key={chip.kind + chip.v}
          type="button"
          aria-pressed={on}
          data-on={on ? '1' : undefined}
          // 再点一下已选中的部位什么都不做（审查 B7）：原来会取消筛选、整个列表一跳，多半是手滑
          onClick={() => !on && setAxis({ kind: chip.kind, v: chip.v })}
          className={tabCls(on)}
        >
          {label}
          {n > 0 && <sup className="text-micro font-bold tabular-nums text-accent">{n}</sup>}
          {tabBar(on)}
        </button>
      );
    });

  /** 器材筛选：等宽格，多选，带联动计数，0 的隐藏 */
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

  /**
   * 器材表（整理态竖栏底部「器材」，2026-10-20 原整理最底下）：一行一件：名字 · 阻力 · 用到它的动作数。
   * 内置器材的阻力锁定（行内带锁）；点任一行打开器材面板（改名 / 自建的改阻力、删除），末行新建。
   */
  const renderEquipList = () => (
    <div className="absolute inset-0 z-10 bg-scrim flex items-end sm:items-center justify-center anim-fade" onClick={() => setEquipList(false)} data-testid="arrange-equip">
      <div
        className="bg-inset border-t sm:border border-divider w-full sm:max-w-sm max-h-[88%] overflow-y-auto rounded-t-sheet sm:rounded-card p-4 space-y-2.5 shadow-2xl"
        style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}
        onClick={e => e.stopPropagation()}
      >
        <p className="px-1 pb-1 text-small font-semibold text-primary">{isCn ? '器材' : 'Gear'}</p>
        <div className="rounded-card border border-divider bg-card divide-y divide-divider overflow-hidden">
          {equipIds.map(id => {
            const label = getTagName(id);
            if (!label) return null;
            const n = merged.filter(ex => equipmentsOf(ex).includes(id.toLowerCase())).length;
            const res = defaultResistance(id, customTags);
            const locked = !resistanceSelectable(id);
            return (
              <button
                key={id}
                type="button"
                onClick={() => setEquipMenu({ id })}
                className="w-full min-h-[44px] px-3.5 flex items-center gap-3 text-left active:bg-card-hover"
                data-testid="equip-row"
              >
                <span className="w-20 flex-shrink-0 truncate text-small font-semibold text-primary">{label}</span>
                <span className="flex-1 min-w-0 truncate text-xs text-secondary flex items-center gap-1">
                  {RESISTANCE_NAMES[res][isCn ? 'cn' : 'en']}
                  {locked && <Lock size={11} className="flex-shrink-0 text-tertiary" aria-label={isCn ? '随器材' : 'Set by gear'} />}
                </span>
                <span className="flex-shrink-0 text-xs tabular-nums text-tertiary">{n ? (isCn ? `${n} 个动作` : `${n}`) : '—'}</span>
                <ChevronRight size={15} className="flex-shrink-0 text-tertiary" />
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => {
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
        <button
          type="button"
          onClick={() => setEquipList(false)}
          className="w-full min-h-[48px] px-4 rounded-card text-small font-bold text-secondary flex items-center justify-center active:bg-card-hover transition-colors"
        >
          {isCn ? '完成' : 'Done'}
        </button>
      </div>
    </div>
  );

  const menuEx = menuFor ? byId.get(menuFor) : undefined;
  const countPart = (id: string) => {
    const lower = id.toLowerCase();
    return merged.filter(ex => (ex.bodyPart || '').toLowerCase() === lower || warmPartsOf(ex).includes(lower)).length;
  };
  const countRegion = (id: string) => merged.filter(ex => effectiveRegions(ex).includes(id)).length;

  return (
    <div className={`fixed inset-0 ${layer === 'modal-2' ? 'z-modal-2' : 'z-sheet'} ${open ? '' : 'pointer-events-none'}`} aria-hidden={!open}>
      {/* 蒙层 */}
      <div className={`absolute inset-0 bg-scrim transition-opacity duration-base ease-paper ${open ? 'opacity-100' : 'opacity-0'}`} onClick={onClose} />

      {/* 弹层 */}
      <section
        ref={sheetRef}
        className={`absolute inset-x-0 mx-auto max-w-2xl bg-base border-t border-divider rounded-t-[22px] shadow-elevated flex flex-col overflow-hidden transition-transform duration-300 ease-out ${
          open ? 'translate-y-0' : 'translate-y-[103%]'
        }`}
        style={{ bottom: inset, height: '90dvh', maxHeight: `max(300px, calc(100dvh - ${inset + 44}px))` }}
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

        {/* 头部：普通态「添加动作 [本次已加 N] … [整理] [×]」；整理态「整理 [完成]」。整行（按钮除外）也是拖拽关闭的热区 */}
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
            {arranging ? (isCn ? '整理' : 'Arrange') : targetLabel ? `${isCn ? '加到' : 'Add to'} ${targetLabel}` : isCn ? '添加动作' : 'Add Exercise'}
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
            // 次要操作：主色纯文字，不跟搜索框、动作行共用一种灰块（2026-10-23 界面审查）；整理中＝淡底表示「开着」
            className={`ml-auto flex-shrink-0 min-h-[44px] px-2.5 rounded-control text-small font-semibold text-accent flex items-center whitespace-nowrap transition-colors active:bg-accent-soft ${
              arranging ? 'bg-accent-soft' : ''
            }`}
            data-testid="region-arrange"
          >
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

        {/* 搜索行：搜索 · 器材（整理态不筛器材）· 新动作 */}
        <div className="flex gap-2 px-4 pt-1.5 pb-2.5 flex-shrink-0">
          <div className="relative flex-1 min-w-0">
            <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-tertiary pointer-events-none" />
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
              className="w-full min-h-[46px] bg-card rounded-card pl-10 pr-10 text-small text-primary outline-none border border-transparent focus:border-accent transition-colors placeholder:text-tertiary"
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
          {!arranging && (
            <button
              type="button"
              onClick={() => setEquipOpen(v => !v)}
              aria-expanded={equipOpen}
              aria-label={selectedEquipNames.length ? selectedEquipNames.join(' · ') : isCn ? '器材' : 'Gear'}
              className={`relative flex-shrink-0 w-[46px] min-h-[46px] rounded-card flex items-center justify-center transition-colors ${
                equips.size || equipOpen ? 'bg-accent-soft text-accent' : 'bg-btn text-secondary'
              }`}
              data-testid="equip-toggle"
            >
              <Filter size={17} />
              {equips.size > 0 && (
                <span className="absolute top-1 right-1 min-w-[16px] h-[16px] px-1 rounded-full bg-accent text-on-accent text-micro leading-[16px] font-bold tabular-nums">
                  {equips.size}
                </span>
              )}
            </button>
          )}
          <button
            type="button"
            onClick={() => onCreateCustomExercise(q || undefined, createPreset())}
            aria-label={isCn ? '新动作' : 'New exercise'}
            // 次要样式：弹层的主操作是底部「完成」（2026-10-22 界面审查：一屏一个主操作）
            className="flex-shrink-0 w-[46px] min-h-[46px] rounded-card bg-btn text-accent flex items-center justify-center active:bg-accent-soft transition-colors"
          >
            <Plus size={19} strokeWidth={2.2} />
          </button>
        </div>
        {equipOpen && !arranging && (
          <div className="grid grid-cols-4 gap-1.5 px-4 pb-2.5 flex-shrink-0" data-testid="equip-filter">
            {equipChips()}
          </div>
        )}

        {/* 部位目录：全部 + 各部位一行横滑（搜索 / 键盘弹起时收起：搜索不按部位锁） */}
        {!q && !kbOpen && (
          <div className="mx-4 flex-shrink-0 border-b border-divider" data-testid="filters-one-line">
            <div ref={partScrollRef} className="flex overflow-x-auto hscroll-bare hscroll-fade -mx-1" data-testid="arrange-parts">
              <button type="button" aria-pressed={axis === null} data-on={axis === null ? '1' : undefined} onClick={() => setAxis(null)} className={tabCls(axis === null)}>
                {isCn ? '全部' : 'All'}
                {tabBar(axis === null)}
              </button>
              {renderAxisChips()}
              {/* 末尾留一段，滚到头时最后一个部位不落在渐隐里 */}
              <span className="flex-shrink-0 w-6" aria-hidden />
            </div>
          </div>
        )}

        {/* 竖栏 + 行列表 */}
        <div className="flex-1 min-h-0 flex">
          {showRail && (
            <nav ref={railRef} className="picker-rail" aria-label={isCn ? '分组' : 'Groups'} data-testid="picker-rail">
              {visible.map((g, i) => {
                const n = arranging ? 0 : addedIn(g);
                const main = g.items.filter(it => !it.also).length;
                return (
                  <React.Fragment key={g.key}>
                    {sepBefore(g, i) && <span className="picker-rail-sep" aria-hidden />}
                    <button
                      type="button"
                      data-rail={i}
                      aria-current={railOn === i}
                      onClick={() => jumpTo(i)}
                      className={`picker-rail-item${railOn === i ? ' is-on' : ''}`}
                    >
                      <b>{g.title}</b>
                      <i className={arranging && g.todo && main ? 'text-warning' : ''}>{main}</i>
                      {n > 0 && <em>{n}</em>}
                    </button>
                  </React.Fragment>
                );
              })}
              {arranging && (
                <>
                  <span className="picker-rail-sep" aria-hidden />
                  <button
                    type="button"
                    onClick={() => {
                      dismissToasts();
                      setEditParts(axis?.kind === 'part' ? axis.v : null);
                    }}
                    className="picker-rail-item is-action"
                    data-testid="edit-parts-open-entry"
                  >
                    {isCn ? '编辑部位' : 'Edit parts'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      dismissToasts();
                      setEquipList(true);
                    }}
                    className="picker-rail-item is-action"
                  >
                    {isCn ? '器材' : 'Gear'}
                  </button>
                </>
              )}
            </nav>
          )}
          <div
            ref={resultsRef}
            onScroll={syncRail}
            className={`flex-1 min-w-0 min-h-0 overflow-y-auto overscroll-contain ${showRail ? 'pl-3 pr-4' : 'px-4'} pb-6 custom-scrollbar`}
          >
            {visible.map((g, i) => renderGroup(g, i))}

            {!arranging && totalCount === 0 && (
              <div className="text-center pt-9 pb-2 text-small font-semibold text-secondary">
                <Search size={32} className="mx-auto mb-2.5 text-tertiary" strokeWidth={1.5} />
                {q ? (isCn ? '动作库里没有匹配的动作' : 'No matching exercise') : isCn ? '当前筛选下没有动作' : 'No exercises under current filters'}
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
        </div>

        {/* 底部「完成」（2026-10-11）：关闭原来只在最上面，而「添加动作」在最下面，每加一个动作都要换一次手位。
            这一条固定在拇指区；下滑关闭照旧。整理态不出（头部「完成」就是退出整理）。 */}
        {!arranging && (
          <div className="flex-shrink-0 px-4 pt-2 border-t border-divider" style={{ paddingBottom: 'calc(10px + env(safe-area-inset-bottom, 0px))' }}>
            <button
              type="button"
              onClick={onClose}
              className="w-full min-h-[48px] rounded-control bg-accent text-on-accent font-bold text-base flex items-center justify-center gap-2 active:opacity-90"
              data-testid="picker-done"
            >
              {isCn ? '完成' : 'Done'}
              {sessionAdded > 0 && (
                <span className="text-xs font-semibold tabular-nums">· {isCn ? `本次已加 ${sessionAdded}` : `${sessionAdded} added`}</span>
              )}
            </button>
          </div>
        )}
      </section>

      {editParts !== undefined && (
        <EditPartsPanel lang={lang} startPart={editParts} countPart={countPart} countRegion={countRegion} onClose={() => setEditParts(undefined)} />
      )}

      {equipList && renderEquipList()}

      {/* 器材面板：改名 / 删除自建；新建 */}
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

      {/* 动作面板：普通态长按 / 整理态点行 */}
      {menuEx && (
        <ExerciseActionPanel
          ex={menuEx}
          lang={lang}
          focusPart={axis?.kind === 'part' ? axis.v : null}
          onClose={() => setMenuFor(null)}
          onVariants={setVariantFor}
          onNote={onOpenNote}
          onMetrics={onOpenMetrics}
          onDelete={onDeleteExercise}
          library={merged}
        />
      )}

      {/* 从动作库进的做法：只管理（改名 / 删除 / 新建 / 细分与器材），不切换任何一张训练卡 */}
      <VariantModal open={!!variantFor} lang={lang} exerciseName={variantFor ?? ''} manage onSelect={() => {}} onClose={() => setVariantFor(null)} />
    </div>
  );
};

export default ExercisePickerSheet;
