/**
 * 训练页「添加动作」底部弹层
 *
 * 交互设计（与 App.tsx / NewWorkoutTab 配合）：
 *   - 常驻挂载，open 切换显隐（内部筛选状态跨开合保留 = 筛选记忆；每次打开只清搜索词）
 *   - 部位行（单选，含自定义部位 + 有氧/自由两个伪部位）+ 器材行（多选，联动计数，0 隐藏）
 *   - 点行即添加，弹层不关：行闪烁 + ✓已添加徽标 + 头部「本次已加 N」+ 震动；450ms 双击防误触
 *   - 软键盘弹起时 visualViewport 计算 inset，弹层压缩到键盘上沿
 *   - 管理入口（⚙）在器材行末尾，打开动作库全屏页
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { History, Pencil, Plus, Search, Star, X, Zap } from 'lucide-react';
import { ExerciseDefinition, Language } from '../../types';
import { BODY_PARTS } from '../constants/exercises';
import { useExercisePrefs } from '../contexts/ExercisePrefsContext';
import { useUserSettingsContext } from '../contexts/UserSettingsContext';
import { useExerciseStats } from '../hooks/useFilteredExercises';
import { useExercisePickerData, PickerAxis } from '../hooks/useExercisePickerData';
import { useKeyboardInset } from '../hooks/useKeyboardInset';

interface ExercisePickerSheetProps {
  open: boolean;
  onClose: () => void;
  /** 小写显示名 -> 当前训练中出现次数（驱动「已添加 ×N」徽标） */
  addedCounts: Record<string, number>;
  /** 本次弹层会话累计添加数（App 维护，含新建动作路径） */
  sessionAdded: number;
  onPickExercise: (ex: ExerciseDefinition) => void;
  onCreateCustomExercise: (prefilledName?: string) => void;
  onOpenManage: () => void;
}

export const ExercisePickerSheet: React.FC<ExercisePickerSheetProps> = ({
  open,
  onClose,
  addedCounts,
  sessionAdded,
  onPickExercise,
  onCreateCustomExercise,
  onOpenManage,
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

  // 打开：清搜索词、结果滚回顶部；关闭：收键盘
  useEffect(() => {
    if (open) {
      setQuery('');
      if (resultsRef.current) resultsRef.current.scrollTop = 0;
    } else {
      searchInputRef.current?.blur();
    }
  }, [open]);

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

  // ===== 添加 =====
  const handlePick = (ex: ExerciseDefinition) => {
    const now = Date.now();
    if (lastPickRef.current.id === ex.id && now - lastPickRef.current.t < 450) return;
    lastPickRef.current = { id: ex.id, t: now };
    try {
      navigator.vibrate?.(12);
    } catch {
      /* noop */
    }
    const row = rowRefs.current.get(ex.id);
    if (row) {
      row.classList.remove('anim-add-flash');
      void row.offsetWidth;
      row.classList.add('anim-add-flash');
    }
    onPickExercise(ex);
  };

  // ===== 行渲染 =====
  const renderRow = (ex: ExerciseDefinition) => {
    const displayName = resolveName(ex.name[lang]);
    const key = displayName.toLowerCase();
    const added = addedCounts[key] || 0;
    const isStarred = Object.keys(starredExercises).some(k => k.toLowerCase() === key);
    const partName = ex.bodyPart ? getTagName(ex.bodyPart) : '';
    return (
      <div
        key={ex.id}
        ref={el => {
          if (el) rowRefs.current.set(ex.id, el);
          else rowRefs.current.delete(ex.id);
        }}
        className="flex items-stretch bg-card border border-divider rounded-2xl overflow-hidden"
      >
        <button
          type="button"
          onClick={() => handlePick(ex)}
          className="flex-1 min-w-0 text-left px-3 py-2.5 flex flex-col gap-1.5 min-h-[60px] active:bg-card-hover transition-colors"
          data-testid="picker-sheet-exercise"
        >
          <span className="flex items-center gap-2 flex-wrap text-sm font-semibold text-primary">
            {displayName}
            {added > 0 && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-lg bg-success/15 text-success text-[10px] font-bold whitespace-nowrap">
                ✓ {isCn ? '已添加' : 'Added'}{added > 1 ? ` ×${added}` : ''}
              </span>
            )}
          </span>
          <span className="flex flex-wrap gap-1">
            {partName && (
              <span className="text-[9px] font-bold uppercase tracking-wide bg-inset px-1.5 py-0.5 rounded-md text-tertiary">
                {partName}
              </span>
            )}
            {(ex.tags ?? []).slice(0, 3).map(t => {
              const tn = getTagName(t);
              if (!tn) return null;
              const hit = equips.has((t || '').toLowerCase());
              return (
                <span
                  key={t}
                  className={`text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-md ${
                    hit ? 'bg-accent text-white' : 'bg-accent/10 text-accent'
                  }`}
                >
                  {tn}
                </span>
              );
            })}
          </span>
        </button>
        <button
          type="button"
          onClick={e => {
            e.stopPropagation();
            toggleStarExercise(displayName);
          }}
          className="w-11 flex items-center justify-center border-l border-divider text-amber-400 active:scale-90 transition-transform"
          aria-label={isCn ? '收藏' : 'Star'}
        >
          <Star size={18} strokeWidth={2} className={isStarred ? 'fill-amber-400' : ''} />
        </button>
      </div>
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
      className={`fixed inset-0 z-[80] ${open ? '' : 'pointer-events-none'}`}
      aria-hidden={!open}
    >
      {/* 蒙层 */}
      <div
        className={`absolute inset-0 bg-black/45 transition-opacity duration-200 ${
          open ? 'opacity-100' : 'opacity-0'
        }`}
        onClick={onClose}
      />

      {/* 弹层 */}
      <section
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
        <div className="w-10 h-1 rounded-full bg-divider mx-auto mt-2 flex-shrink-0" />

        {/* 头部：标题 + 本次已加 + 关闭 */}
        <div className="flex items-center gap-2.5 px-4 pt-1.5 pb-0.5 flex-shrink-0">
          <h2 className="font-display text-lg font-semibold text-primary">
            {isCn ? '添加动作' : 'Add Exercise'}
          </h2>
          {sessionAdded > 0 && (
            <span
              key={sessionAdded}
              className="anim-chip-pop inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-success/15 text-success text-[11px] font-bold"
            >
              ✓ {isCn ? `本次已加 ${sessionAdded}` : `Added ${sessionAdded}`}
            </span>
          )}
          <button
            type="button"
            onClick={onClose}
            className="ml-auto w-11 h-11 flex items-center justify-center rounded-xl text-secondary hover:bg-card-hover active:scale-90 transition-all"
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
              className="w-full min-h-[46px] bg-inset border border-divider rounded-2xl pl-10 pr-10 text-sm text-primary outline-none focus:border-accent transition-colors placeholder:text-tertiary"
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
                className="absolute right-1 top-1/2 -translate-y-1/2 w-9 h-9 flex items-center justify-center rounded-full text-tertiary active:bg-card-hover"
                aria-label={isCn ? '清除搜索' : 'Clear search'}
              >
                <X size={15} strokeWidth={2.4} />
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={() => onCreateCustomExercise(q || undefined)}
            className="flex-shrink-0 min-h-[46px] px-3.5 rounded-2xl bg-accent text-white text-xs font-bold flex items-center gap-1 active:scale-95 transition-transform"
          >
            <Plus size={14} strokeWidth={2.5} />
            {isCn ? '新动作' : 'New'}
          </button>
        </div>

        {/* 部位行（单选） */}
        <div className="flex gap-2 overflow-x-auto px-4 pb-2.5 flex-shrink-0 custom-scrollbar">
          <button
            type="button"
            onClick={() => setAxis(null)}
            className={`flex-shrink-0 min-h-[38px] px-3.5 rounded-xl text-xs font-bold transition-colors ${
              axis === null ? 'bg-accent text-white shadow-elevated' : 'bg-inset text-secondary'
            }`}
          >
            {isCn ? '全部' : 'All'}
          </button>
          {axisChips.map(chip => {
            const on = axis !== null && axis.kind === chip.kind && axis.v === chip.v;
            const availKey =
              chip.kind === 'part' ? 'part:' + chip.v.toLowerCase() : 'cat:' + chip.v;
            const dim = !on && !axisAvailable.has(availKey);
            const label = axisLabel(chip);
            if (!label) return null;
            return (
              <button
                key={chip.kind + chip.v}
                type="button"
                onClick={() => setAxis(on ? null : { kind: chip.kind, v: chip.v })}
                className={`flex-shrink-0 min-h-[38px] px-3.5 rounded-xl text-xs font-bold transition-colors ${
                  on
                    ? 'bg-accent text-white shadow-elevated'
                    : chip.custom
                      ? 'bg-accent/5 text-accent border border-dashed border-accent/40'
                      : 'bg-inset text-secondary'
                } ${dim ? 'opacity-35' : ''}`}
              >
                {label}
              </button>
            );
          })}
        </div>

        {/* 器材行（多选，联动计数，0 隐藏；末尾管理入口） */}
        <div className="flex gap-2 overflow-x-auto px-4 pb-2.5 flex-shrink-0 custom-scrollbar">
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
                className={`flex-shrink-0 min-h-[34px] px-3 rounded-xl text-[11px] font-bold flex items-center gap-1.5 transition-colors ${
                  on ? 'bg-accent text-white shadow-elevated' : 'bg-inset text-secondary'
                }`}
              >
                {label}
                <span
                  className={`text-[10px] font-bold tabular-nums ${
                    on ? 'text-white/75' : 'text-tertiary'
                  }`}
                >
                  {n}
                </span>
              </button>
            );
          })}
          <button
            type="button"
            onClick={onOpenManage}
            className="flex-shrink-0 min-h-[34px] px-3 rounded-xl text-[11px] font-bold flex items-center gap-1 bg-card border border-divider text-tertiary active:scale-95 transition-transform"
            aria-label={isCn ? '管理标签与动作' : 'Manage library'}
          >
            <Pencil size={12} />
            {isCn ? '管理' : 'Manage'}
          </button>
        </div>

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
                <Star size={13} className="text-amber-400 fill-amber-400" />,
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
              className="w-full min-h-[46px] mt-3 border border-dashed border-divider rounded-2xl text-accent text-sm font-bold flex items-center justify-center gap-2 active:bg-card-hover transition-colors"
            >
              <Plus size={15} strokeWidth={2.5} />
              {isCn ? `没找到？创建「${q}」` : `Create "${q}"`}
            </button>
          )}
        </div>
      </section>
    </div>
  );
};

export default ExercisePickerSheet;
