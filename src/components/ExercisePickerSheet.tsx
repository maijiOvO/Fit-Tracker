/**
 * 训练页「添加动作」底部弹层
 *
 * 交互设计（与 App.tsx / NewWorkoutTab 配合）：
 *   - 常驻挂载，open 切换显隐（内部筛选状态跨开合保留 = 筛选记忆；每次打开只清搜索词）
 *   - 部位行（单选，含自定义部位 + 有氧/自由两个伪部位）+ 器材行（多选，联动计数，0 隐藏）
 *   - 点行即添加，弹层不关：行闪烁 + ✓已添加徽标 + 头部「本次已加 N」+ 震动；450ms 双击防误触
 *   - 软键盘弹起时 visualViewport 计算 inset，弹层压缩到键盘上沿
 *   - 标签管理入口在头部（Tags 图标）直达 TagManageModal；长按动作行弹出该动作的管理菜单
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Filter, History, PencilLine, Plus, Search, Star, Tags, Trash2, X, Zap } from 'lucide-react';
import { ExerciseDefinition, Language } from '../../types';
import { BODY_PARTS } from '../constants/exercises';
import { useExercisePrefs } from '../contexts/ExercisePrefsContext';
import { useUserSettingsContext } from '../contexts/UserSettingsContext';
import { useExerciseStats } from '../hooks/useFilteredExercises';
import { useExercisePickerData, PickerAxis } from '../hooks/useExercisePickerData';
import { useKeyboardInset } from '../hooks/useKeyboardInset';
import { useLongPress } from '../hooks/useLongPress';
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
}) => {
  const press = useLongPress({ onLongPress });
  return (
    <div
      ref={bindRef}
      className="flex items-stretch bg-card border border-divider rounded-card overflow-hidden"
    >
      <button
        type="button"
        onClick={onPick}
        {...press.handlers}
        className="relative flex-1 min-w-0 text-left px-3 py-2.5 flex flex-col gap-1.5 min-h-[60px] active:bg-card-hover transition-colors duration-tap ease-paper select-none touch-none"
        data-testid="picker-sheet-exercise"
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
    </div>
  );
};

interface ExercisePickerSheetProps {
  open: boolean;
  onClose: () => void;
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
  addedCounts,
  sessionAdded,
  onPickExercise,
  onCreateCustomExercise,
  onOpenTagManage,
  onEditExerciseTags,
  onRenameExercise,
  onDeleteExercise,
}) => {
  const { starredExercises, resolveName, getTagName, toggleStarExercise } = useExercisePrefs();
  const { lang } = useUserSettingsContext();
  const { recentExerciseNames } = useExerciseStats();
  const isCn = lang === Language.CN;

  // ===== 筛选状态（跨开合保留；仅搜索词随打开重置） =====
  const [query, setQuery] = useState('');
  const [axis, setAxis] = useState<PickerAxis>(null);
  const [equips, setEquips] = useState<ReadonlySet<string>>(new Set());

  const { results, equipCounts, axisAvailable, equipIds, customPartIds } =
    useExercisePickerData({ query, axis, equips });

  const inset = useKeyboardInset(open);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const resultsRef = useRef<HTMLDivElement | null>(null);
  const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const lastPickRef = useRef<{ id: string; t: number }>({ id: '', t: 0 });
  // 长按动作行 → 该动作的管理菜单（编辑标签 / 重命名 / 删除）
  const [menuFor, setMenuFor] = useState<ExerciseDefinition | null>(null);
  // 键盘弹起时筛选区收起为摘要行（点摘要可临时展开，键盘收起后自动复原）
  const [kbExpandFilters, setKbExpandFilters] = useState(false);
  const suppressClickRef = useRef(false);
  const sheetRef = useRef<HTMLElement | null>(null);
  const dragRef = useRef<{ startY: number; y: number } | null>(null);

  // ===== 抓手拖动关闭（grabber 区域向下拖 > 110px 松手即关闭，否则弹回） =====
  const handleDragStart = (e: React.PointerEvent) => {
    if (!open) return;
    dragRef.current = { startY: e.clientY, y: 0 };
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* noop */ }
    if (sheetRef.current) sheetRef.current.style.transition = 'none';
  };
  const handleDragMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
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

  // 打开：清搜索词、结果滚回顶部；关闭：收键盘
  useEffect(() => {
    if (open) {
      setQuery('');
      if (resultsRef.current) resultsRef.current.scrollTop = 0;
    } else {
      searchInputRef.current?.blur();
      setMenuFor(null);
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
  const { starredGroup, recentGroup, otherGroup, flatGroup } = useMemo(() => {
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
      return { starredGroup: [], recentGroup: [], otherGroup: [], flatGroup: flat };
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
    return { starredGroup: starred, recentGroup: dedupedRecent, otherGroup: other, flatGroup: [] };
  }, [q, results, starredExercises, recentExerciseNames, resolveName, lang]);

  const totalCount = results.length;
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
  const renderRow = (ex: ExerciseDefinition) => {
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
        bindRef={el => {
          if (el) rowRefs.current.set(ex.id, el);
          else rowRefs.current.delete(ex.id);
        }}
        onPick={() => {
          if (suppressClickRef.current) {
            suppressClickRef.current = false;
            return;
          }
          handlePick(ex);
        }}
        onLongPress={() => {
          suppressClickRef.current = true; // 松手后的 click 不再当作「添加」
          setMenuFor(ex);
        }}
        onToggleStar={() => toggleStarExercise(displayName)}
      />
    );
  };

  const renderGroup = (icon: React.ReactNode, title: string, items: ExerciseDefinition[]) => {
    if (items.length === 0) return null;
    return (
      <div key={title}>
        <div className="flex items-center gap-1.5 mb-2 px-0.5 mt-3 first:mt-1">
          {icon}
          <h3 className="text-[11px] font-bold text-primary uppercase tracking-[0.12em]">{title}</h3>
          <span className="text-[10px] font-bold text-tertiary">· {items.length}</span>
        </div>
        <div className="space-y-2">{items.map(renderRow)}</div>
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
          onPointerUp={handleDragEnd}
          onPointerCancel={handleDragEnd}
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
          onPointerUp={handleDragEnd}
          onPointerCancel={handleDragEnd}
        >
          <h2 className="font-display text-lg font-semibold text-primary">
            {isCn ? '添加动作' : 'Add Exercise'}
          </h2>
          {sessionAdded > 0 && (
            <span
              key={sessionAdded}
              className="anim-ink-mark inline-flex items-center gap-1 px-2.5 py-1 rounded-control bg-success/15 text-success text-[11px] font-bold"
            >
              ✓ {isCn ? `本次已加 ${sessionAdded}` : `Added ${sessionAdded}`}
            </span>
          )}
          <button
            type="button"
            onClick={onOpenTagManage}
            className="ml-auto w-11 h-11 flex items-center justify-center rounded-control text-secondary hover:bg-card-hover active:scale-press-sm transition-ui"
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
        {filtersCollapsed && (
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
        {!filtersCollapsed && (
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
        {!filtersCollapsed && (
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
        {(q || nFilters > 0) && (
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
          className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 pb-6 custom-scrollbar"
        >
          {q ? (
            renderGroup(
              <Search size={13} className="text-accent" />,
              isCn ? '搜索结果' : 'Results',
              flatGroup,
            )
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
            <p className="px-2 pb-1 text-sm font-semibold text-primary">
              {resolveName(menuFor.name[lang])}
            </p>
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
