/**
 * 统一的动作选择 / 浏览 / 管理面板
 * 适配两种使用场景：
 *   1. variant="embedded"  —— 训练页底部内嵌，作为正在进行训练时添加动作的入口
 *   2. variant="modal"     —— 在全屏弹窗里使用，作为 PlanTab 给训练计划挑动作的 picker
 *
 * 设计原则：
 *   - 所有可点击元素的触控区 ≥ 44×44px（Apple HIG / Material 推荐值）
 *   - 部位单选、器材多选，并在 UI 上明确提示
 *   - 列表分组：★ 收藏 → 📌 最近练过 → 📋 全部结果
 *   - 不使用 HTML5 拖拽（Capacitor / 移动端浏览器支持不一致）
 */
import React, { useMemo } from 'react';
import {
  Search,
  Plus,
  PlusCircle,
  Zap,
  Star,
  Edit2,
  Trash2,
  PencilLine,
  X,
  Sparkles,
  History,
  Filter,
} from 'lucide-react';
import { ExerciseDefinition, Language } from '../../types';
import { translations } from '../../translations';
import { BODY_PARTS, EQUIPMENT_TAGS, ExerciseCategory } from '../constants/exercises';
import { useUiOverlay } from '../contexts/UiOverlayContext';

interface ExercisePickerProps {
  lang: Language;
  variant?: 'embedded' | 'modal';

  // 筛选状态
  searchQuery: string;
  onSearchChange: (q: string) => void;
  activeCategory: ExerciseCategory | null;
  onCategoryChange: (cat: ExerciseCategory | null) => void;
  selectedTags: string[];
  onSelectedTagsChange: (next: string[]) => void;

  // 数据
  filteredExercises: ExerciseDefinition[];
  customTags: {
    id: string;
    name: string;
    category: 'bodyPart' | 'equipment';
    parentCategory?: ExerciseCategory;
  }[];
  starredExercises: Record<string, number>;
  recentExerciseNames: string[];

  // 工具
  getTagName: (tid: string) => string;
  resolveName: (name: string) => string;

  // 管理模式
  isEditingTags: boolean;
  onToggleEditingTags: () => void;

  // 回调
  onPickExercise: (ex: ExerciseDefinition) => void;
  onCreateCustomExercise: (prefilledName?: string) => void;
  onCreateCustomTag: (category: 'bodyPart' | 'equipment') => void;
  onEditExerciseTags: (ex: ExerciseDefinition) => void;
  onRenameTag: (id: string, currentName: string) => void;
  onDeleteTag: (id: string) => void;
  onRenameExercise: (id: string, currentName: string) => void;
  onDeleteExercise: (id: string) => void;
  onToggleStar: (name: string) => void;
}

const CATEGORY_OPTIONS: Array<{ id: ExerciseCategory | null; labelKey: keyof typeof translations }> = [
  { id: null, labelKey: 'allTags' },
  { id: 'STRENGTH', labelKey: 'strengthTraining' },
  { id: 'CARDIO', labelKey: 'cardioTraining' },
  { id: 'FREE', labelKey: 'freeTraining' },
];

export const ExercisePicker: React.FC<ExercisePickerProps> = ({
  lang,
  variant = 'embedded',
  searchQuery,
  onSearchChange,
  activeCategory,
  onCategoryChange,
  selectedTags,
  onSelectedTagsChange,
  filteredExercises,
  customTags,
  starredExercises,
  recentExerciseNames,
  getTagName,
  resolveName,
  isEditingTags,
  onToggleEditingTags,
  onPickExercise,
  onCreateCustomExercise,
  onCreateCustomTag,
  onEditExerciseTags,
  onRenameTag,
  onDeleteTag,
  onRenameExercise,
  onDeleteExercise,
  onToggleStar,
}) => {
  const { confirm } = useUiOverlay();
  const t = translations;
  const isCn = lang === Language.CN;

  // 部位 chips = 系统部位 + 自定义部位（按 parentCategory 过滤）
  const bodyPartChips = useMemo(() => {
    const sys = BODY_PARTS.map(id => ({ id, isCustom: false }));
    const custom = customTags
      .filter(
        ct =>
          ct.category === 'bodyPart' &&
          (activeCategory === null || !ct.parentCategory || ct.parentCategory === activeCategory),
      )
      .map(ct => ({ id: ct.id, isCustom: true }));
    return [...sys, ...custom];
  }, [customTags, activeCategory]);

  // 器材 chips = 系统器材（按分类过滤）+ 自定义器材
  const equipmentChips = useMemo(() => {
    const sysFiltered = EQUIPMENT_TAGS.filter(id => {
      if (activeCategory === null) return true;
      if (activeCategory === 'STRENGTH') return !['tagOutdoor', 'tagIndoor', 'tagBallGame', 'tagGym'].includes(id);
      return true;
    });
    const sys = sysFiltered.map(id => ({ id, isCustom: false }));
    const custom = customTags
      .filter(
        ct =>
          ct.category === 'equipment' &&
          (activeCategory === null || !ct.parentCategory || ct.parentCategory === activeCategory),
      )
      .map(ct => ({ id: ct.id, isCustom: true }));
    return [...sys, ...custom];
  }, [customTags, activeCategory]);

  // 部位单选：选中的部位 chip 替换原有部位选择
  const handleToggleBodyPart = (tid: string) => {
    if (isEditingTags) {
      onRenameTag(tid, getTagName(tid));
      return;
    }
    onSelectedTagsChange(
      (() => {
        const withoutBodyParts = selectedTags.filter(
          tag => !BODY_PARTS.includes(tag) && !customTags.some(ct => ct.id === tag && ct.category === 'bodyPart'),
        );
        return selectedTags.includes(tid) ? withoutBodyParts : [...withoutBodyParts, tid];
      })(),
    );
  };

  // 器材多选
  const handleToggleEquipment = (tid: string) => {
    if (isEditingTags) {
      onRenameTag(tid, getTagName(tid));
      return;
    }
    onSelectedTagsChange(
      selectedTags.includes(tid) ? selectedTags.filter(x => x !== tid) : [...selectedTags, tid],
    );
  };

  // 三段分组
  const { starredGroup, recentGroup, otherGroup } = useMemo(() => {
    const starSet = new Set(
      Object.keys(starredExercises).map(k => k.toLowerCase()),
    );
    const recentSet = new Set(recentExerciseNames.map(n => n.toLowerCase()));

    const starredGroup: ExerciseDefinition[] = [];
    const recentGroup: ExerciseDefinition[] = [];
    const otherGroup: ExerciseDefinition[] = [];

    for (const ex of filteredExercises) {
      const displayName = resolveName(ex.name[lang]).toLowerCase();
      if (starSet.has(displayName)) {
        starredGroup.push(ex);
      } else if (recentSet.has(displayName)) {
        recentGroup.push(ex);
      } else {
        otherGroup.push(ex);
      }
    }

    // ★ 按上次收藏时间倒序（O(1) 查表）
    const starScoreByName = new Map<string, number>();
    for (const [k, v] of Object.entries(starredExercises)) {
      starScoreByName.set(k.toLowerCase(), Number(v ?? 0));
    }
    starredGroup.sort((a, b) => {
      const ka = resolveName(a.name[lang]).toLowerCase();
      const kb = resolveName(b.name[lang]).toLowerCase();
      return (starScoreByName.get(kb) ?? 0) - (starScoreByName.get(ka) ?? 0);
    });

    // 📌 按最近练过的顺序；同 displayName 只保留一条（避免重复自定义动作）
    const seenRecentNames = new Set<string>();
    const dedupedRecent: ExerciseDefinition[] = [];
    for (const ex of recentGroup) {
      const key = resolveName(ex.name[lang]).toLowerCase();
      if (seenRecentNames.has(key)) continue;
      seenRecentNames.add(key);
      dedupedRecent.push(ex);
    }
    recentGroup.length = 0;
    recentGroup.push(...dedupedRecent);
    recentGroup.sort((a, b) => {
      const ka = resolveName(a.name[lang]).toLowerCase();
      const kb = resolveName(b.name[lang]).toLowerCase();
      return (
        recentExerciseNames.findIndex(n => n.toLowerCase() === ka)
        - recentExerciseNames.findIndex(n => n.toLowerCase() === kb)
      );
    });

    return { starredGroup, recentGroup, otherGroup };
  }, [filteredExercises, starredExercises, recentExerciseNames, resolveName, lang]);

  const totalCount = filteredExercises.length;
  const searchHasNoExactMatch =
    searchQuery.trim().length > 0
    && !filteredExercises.some(ex => resolveName(ex.name[lang]).toLowerCase() === searchQuery.trim().toLowerCase());

  const containerSpacing = variant === 'embedded' ? 'space-y-5' : 'space-y-4';

  return (
    <div className={`flex flex-col ${containerSpacing}`}>
      {/* 1. 搜索 + 创建快捷 */}
      <div className="flex gap-2 items-stretch">
        <div className="relative flex-1">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-secondary" size={18} />
          <input
            className="w-full bg-inset border border-divider rounded-2xl pl-11 pr-4 py-3 text-sm text-primary outline-none focus:border-blue-500 transition-all min-h-[44px]"
            placeholder={isCn ? '搜索动作名称…' : 'Search exercise name…'}
            value={searchQuery}
            onChange={e => onSearchChange(e.target.value)}
            inputMode="search"
          />
        </div>
        <button
          onClick={() => onCreateCustomExercise(searchQuery.trim() || undefined)}
          className="px-4 min-h-[44px] bg-accent text-white rounded-2xl text-xs font-bold flex items-center gap-1.5 hover:opacity-90 active:scale-95 transition-all whitespace-nowrap"
          aria-label={t.addCustomExercise[lang]}
        >
          <Plus size={16} strokeWidth={2.5} />
          {isCn ? '新动作' : 'New'}
        </button>
      </div>

      {/* 2. 分类 chips */}
      <div className="flex gap-2 overflow-x-auto -mx-1 px-1 pb-1 custom-scrollbar">
        {CATEGORY_OPTIONS.map(opt => {
          const active = activeCategory === opt.id;
          const label = opt.id === null ? (isCn ? '全部' : 'All') : t[opt.labelKey][lang];
          return (
            <button
              key={opt.id ?? 'all'}
              onClick={() => {
                onCategoryChange(opt.id);
                onSelectedTagsChange([]);
              }}
              className={`px-4 min-h-[40px] rounded-xl text-xs font-bold uppercase tracking-wider transition-all whitespace-nowrap ${
                active
                  ? 'bg-accent text-white shadow-elevated'
                  : 'bg-inset text-secondary hover:bg-card-hover'
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* 3. 部位 chips (单选) */}
      <div>
        <div className="flex items-center justify-between mb-2 px-1">
          <h4 className="text-[10px] font-bold text-secondary uppercase tracking-[0.2em] flex items-center gap-1.5">
            <Sparkles size={11} /> {t.bodyPartHeader[lang]}
            <span className="text-tertiary normal-case tracking-normal">
              · {isCn ? '单选' : 'single'}
            </span>
          </h4>
          <button
            onClick={onToggleEditingTags}
            className={`px-3 min-h-[36px] rounded-lg text-[10px] font-bold transition-all ${
              isEditingTags
                ? 'bg-amber-500/20 text-amber-400'
                : 'text-tertiary hover:text-secondary'
            }`}
          >
            {isEditingTags ? (isCn ? '完成' : 'Done') : (isCn ? '管理' : 'Manage')}
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          {bodyPartChips.map(({ id, isCustom }) => {
            const active = selectedTags.includes(id);
            const name = getTagName(id);
            if (!name) return null;
            return (
              <TagChip
                key={id}
                label={name}
                active={active}
                isCustom={isCustom}
                isEditing={isEditingTags}
                onClick={() => handleToggleBodyPart(id)}
                onDelete={isCustom ? () => onDeleteTag(id) : undefined}
              />
            );
          })}
          <button
            onClick={() => onCreateCustomTag('bodyPart')}
            className="min-h-[40px] px-3 rounded-xl text-[11px] font-bold text-accent border border-dashed border-accent/40 hover:bg-accent/10 transition-all flex items-center gap-1"
          >
            <PlusCircle size={12} /> {isCn ? '部位' : 'part'}
          </button>
        </div>
      </div>

      {/* 4. 器材 chips (多选) */}
      <div>
        <h4 className="text-[10px] font-bold text-secondary uppercase tracking-[0.2em] mb-2 px-1 flex items-center gap-1.5">
          <Filter size={11} /> {t.equipmentHeader[lang]}
          <span className="text-tertiary normal-case tracking-normal">
            · {isCn ? '多选' : 'multi'}
          </span>
        </h4>
        <div className="flex flex-wrap gap-2">
          {equipmentChips.map(({ id, isCustom }) => {
            const active = selectedTags.includes(id);
            const name = getTagName(id);
            if (!name) return null;
            return (
              <TagChip
                key={id}
                label={name}
                active={active}
                isCustom={isCustom}
                isEditing={isEditingTags}
                onClick={() => handleToggleEquipment(id)}
                onDelete={isCustom ? () => onDeleteTag(id) : undefined}
              />
            );
          })}
          <button
            onClick={() => onCreateCustomTag('equipment')}
            className="min-h-[40px] px-3 rounded-xl text-[11px] font-bold text-accent border border-dashed border-accent/40 hover:bg-accent/10 transition-all flex items-center gap-1"
          >
            <PlusCircle size={12} /> {isCn ? '器材' : 'gear'}
          </button>
        </div>
      </div>

      {/* 5. 结果计数 + 清空筛选 */}
      <div className="flex items-center justify-between px-1 text-xs">
        <span className="text-secondary font-semibold">
          {totalCount} {isCn ? '个结果' : 'results'}
          {selectedTags.length > 0 && (
            <span className="text-tertiary"> · {selectedTags.length} {isCn ? '个筛选' : 'filters'}</span>
          )}
        </span>
        {(selectedTags.length > 0 || searchQuery) && (
          <button
            onClick={() => {
              onSelectedTagsChange([]);
              onSearchChange('');
            }}
            className="text-accent font-bold min-h-[36px] px-2"
          >
            {isCn ? '清空' : 'Clear'}
          </button>
        )}
      </div>

      {/* 6. 分组列表 */}
      <div className="space-y-5">
        {starredGroup.length > 0 && (
          <ExerciseGroup
            titleIcon={<Star size={14} className="text-amber-400 fill-amber-400" />}
            title={isCn ? '我的常用' : 'Favorites'}
            count={starredGroup.length}
            items={starredGroup}
            lang={lang}
            isEditing={isEditingTags}
            starredExercises={starredExercises}
            resolveName={resolveName}
            getTagName={getTagName}
            onPick={onPickExercise}
            onToggleStar={onToggleStar}
            onEditTags={onEditExerciseTags}
            onRename={onRenameExercise}
            onDelete={onDeleteExercise}
            onConfirmDelete={confirm}
          />
        )}

        {recentGroup.length > 0 && (
          <ExerciseGroup
            titleIcon={<History size={14} className="text-accent" />}
            title={isCn ? '最近练过' : 'Recent'}
            count={recentGroup.length}
            items={recentGroup}
            lang={lang}
            isEditing={isEditingTags}
            starredExercises={starredExercises}
            resolveName={resolveName}
            getTagName={getTagName}
            onPick={onPickExercise}
            onToggleStar={onToggleStar}
            onEditTags={onEditExerciseTags}
            onRename={onRenameExercise}
            onDelete={onDeleteExercise}
            onConfirmDelete={confirm}
          />
        )}

        {otherGroup.length > 0 && (
          <ExerciseGroup
            titleIcon={<Zap size={14} className="text-tertiary" />}
            title={
              starredGroup.length + recentGroup.length === 0
                ? (isCn ? '全部动作' : 'All Exercises')
                : (isCn ? '更多' : 'More')
            }
            count={otherGroup.length}
            items={otherGroup}
            lang={lang}
            isEditing={isEditingTags}
            starredExercises={starredExercises}
            resolveName={resolveName}
            getTagName={getTagName}
            onPick={onPickExercise}
            onToggleStar={onToggleStar}
            onEditTags={onEditExerciseTags}
            onRename={onRenameExercise}
            onDelete={onDeleteExercise}
            onConfirmDelete={confirm}
          />
        )}

        {/* 没结果 → 引导创建 */}
        {totalCount === 0 && (
          <div className="bg-inset border border-dashed border-divider rounded-card p-8 text-center space-y-4">
            <Search size={36} className="mx-auto text-tertiary" strokeWidth={1.5} />
            <p className="text-sm text-secondary font-semibold">
              {searchQuery
                ? (isCn ? '动作库里没有匹配的动作' : 'No matching exercise in library')
                : (isCn ? '当前筛选下没有动作' : 'No exercises under current filters')}
            </p>
            {searchHasNoExactMatch && (
              <button
                onClick={() => onCreateCustomExercise(searchQuery.trim())}
                className="inline-flex items-center gap-2 px-5 min-h-[44px] bg-accent text-white rounded-2xl font-bold text-sm active:scale-95 transition-all"
              >
                <Plus size={18} strokeWidth={2.5} />
                {isCn ? `创建「${searchQuery.trim()}」` : `Create "${searchQuery.trim()}"`}
              </button>
            )}
          </div>
        )}

        {/* 有结果，但用户可能想创建一个新的 */}
        {totalCount > 0 && searchHasNoExactMatch && (
          <button
            onClick={() => onCreateCustomExercise(searchQuery.trim())}
            className="w-full min-h-[44px] py-3 border border-dashed border-divider rounded-2xl text-sm text-accent font-bold hover:bg-card-hover transition-all flex items-center justify-center gap-2"
          >
            <Plus size={16} strokeWidth={2.5} />
            {isCn ? `没找到？创建「${searchQuery.trim()}」` : `Create "${searchQuery.trim()}"`}
          </button>
        )}
      </div>
    </div>
  );
};

// === 子组件：单个标签 chip ===

interface TagChipProps {
  label: string;
  active: boolean;
  isCustom: boolean;
  isEditing: boolean;
  onClick: () => void;
  onDelete?: () => void;
}

const TagChip: React.FC<TagChipProps> = ({ label, active, isCustom, isEditing, onClick, onDelete }) => {
  // 管理模式 + 自定义标签：拆分为「重命名」和「删除」两个并排大按钮
  if (isEditing && isCustom && onDelete) {
    return (
      <div className="flex items-stretch rounded-xl overflow-hidden border border-amber-400/40 bg-amber-500/10">
        <button
          onClick={onClick}
          className="min-h-[44px] pl-4 pr-3 text-xs font-bold uppercase tracking-wider text-amber-400 flex items-center gap-1.5 active:bg-amber-500/20 transition-colors"
          aria-label={`rename ${label}`}
        >
          {label}
          <Edit2 size={12} />
        </button>
        <button
          onClick={e => {
            e.stopPropagation();
            onDelete();
          }}
          className="w-11 min-h-[44px] flex items-center justify-center text-red-500 border-l border-amber-400/30 active:bg-red-500/20 active:scale-95 transition-all"
          aria-label={`delete ${label}`}
        >
          <Trash2 size={16} strokeWidth={2} />
        </button>
      </div>
    );
  }

  // 管理模式 + 系统标签：只允许重命名（不显示删除）
  if (isEditing) {
    return (
      <button
        onClick={onClick}
        className="min-h-[44px] px-4 rounded-xl text-xs font-bold uppercase tracking-wider transition-all flex items-center gap-1.5 bg-amber-500/15 text-amber-400 border border-amber-400/30 active:scale-95"
        aria-label={`rename ${label}`}
      >
        {label}
        <Edit2 size={12} />
      </button>
    );
  }

  // 普通模式：选中态 / 未选中态
  return (
    <button
      onClick={onClick}
      className={`min-h-[40px] px-4 rounded-xl text-xs font-bold uppercase tracking-wider transition-all flex items-center ${
        active
          ? 'bg-accent text-white shadow-elevated'
          : isCustom
            ? 'bg-blue-400/10 text-accent border border-blue-400/20'
            : 'bg-inset text-secondary hover:bg-card-hover'
      }`}
    >
      {label}
    </button>
  );
};

// === 子组件：分组容器 ===

interface ExerciseGroupProps {
  titleIcon: React.ReactNode;
  title: string;
  count: number;
  items: ExerciseDefinition[];
  lang: Language;
  isEditing: boolean;
  starredExercises: Record<string, number>;
  resolveName: (name: string) => string;
  getTagName: (tid: string) => string;
  onPick: (ex: ExerciseDefinition) => void;
  onToggleStar: (name: string) => void;
  onEditTags: (ex: ExerciseDefinition) => void;
  onRename: (id: string, currentName: string) => void;
  onDelete: (id: string) => void;
  onConfirmDelete: ExerciseListItemProps['onConfirmDelete'];
}

const ExerciseGroup: React.FC<ExerciseGroupProps> = ({
  titleIcon,
  title,
  count,
  items,
  lang,
  isEditing,
  starredExercises,
  resolveName,
  getTagName,
  onPick,
  onToggleStar,
  onEditTags,
  onRename,
  onDelete,
  onConfirmDelete,
}) => {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2 px-1">
        {titleIcon}
        <h3 className="text-xs font-bold text-primary uppercase tracking-[0.15em]">{title}</h3>
        <span className="text-[10px] font-bold text-tertiary">· {count}</span>
      </div>
      <div className="space-y-2">
        {items.map(ex => (
          <ExerciseListItem
            key={ex.id}
            exercise={ex}
            lang={lang}
            isEditing={isEditing}
            isStarred={
              !!Object.keys(starredExercises).find(
                k => k.toLowerCase() === resolveName(ex.name[lang]).toLowerCase(),
              )
            }
            resolveName={resolveName}
            getTagName={getTagName}
            onPick={onPick}
            onToggleStar={onToggleStar}
            onEditTags={onEditTags}
            onRename={onRename}
            onDelete={onDelete}
            onConfirmDelete={onConfirmDelete}
          />
        ))}
      </div>
    </div>
  );
};

// === 子组件：单个动作卡 ===

interface ExerciseListItemProps {
  exercise: ExerciseDefinition;
  lang: Language;
  isEditing: boolean;
  isStarred: boolean;
  resolveName: (name: string) => string;
  getTagName: (tid: string) => string;
  onPick: (ex: ExerciseDefinition) => void;
  onToggleStar: (name: string) => void;
  onEditTags: (ex: ExerciseDefinition) => void;
  onRename: (id: string, currentName: string) => void;
  onDelete: (id: string) => void;
  onConfirmDelete: (options: { message: string; danger?: boolean; confirmLabel?: string }) => Promise<boolean>;
}

const ExerciseListItem: React.FC<ExerciseListItemProps> = ({
  exercise: ex,
  lang,
  isEditing,
  isStarred,
  resolveName,
  getTagName,
  onPick,
  onToggleStar,
  onEditTags,
  onRename,
  onDelete,
  onConfirmDelete,
}) => {
  const displayName = resolveName(ex.name[lang]);
  const partName = ex.bodyPart ? getTagName(ex.bodyPart) : '';

  return (
    <div className="bg-card border border-divider rounded-2xl flex items-stretch overflow-hidden hover:border-blue-500/40 transition-all">
      {/* 主区：点击添加 / 选中 */}
      <button
        onClick={() => (isEditing ? onRename(ex.id, displayName) : onPick(ex))}
        className="flex-1 p-3 text-left flex flex-col gap-1.5 min-h-[64px] hover:bg-card-hover active:scale-[0.99] transition-all"
        data-testid="library-exercise-card"
      >
        <span className={`font-semibold text-sm ${isEditing ? 'text-amber-400' : 'text-primary'}`}>
          {displayName}
        </span>
        <div className="flex flex-wrap gap-1.5">
          {partName && (
            <span className="text-[10px] font-bold uppercase bg-inset px-2 py-1 rounded-lg text-tertiary">
              {partName}
            </span>
          )}
          {ex.tags?.slice(0, 4).map(t => {
            const tagName = getTagName(t);
            if (!tagName) return null;
            return (
              <span
                key={t}
                className="text-[10px] font-bold uppercase bg-accent/10 px-2 py-1 rounded-lg text-accent"
              >
                {tagName}
              </span>
            );
          })}
          {ex.tags && ex.tags.length > 4 && (
            <span className="text-[10px] font-bold text-tertiary px-1 py-1">
              +{ex.tags.length - 4}
            </span>
          )}
        </div>
      </button>

      {/* 右侧操作区：触控区 ≥ 44×44px */}
      <div className="flex items-stretch border-l border-divider">
        {!isEditing && (
          <>
            <button
              onClick={e => {
                e.stopPropagation();
                onToggleStar(displayName);
              }}
              className="w-11 min-h-[64px] flex items-center justify-center text-amber-400 hover:bg-amber-400/10 active:scale-90 transition-all"
              aria-label={lang === Language.CN ? '收藏' : 'favorite'}
            >
              <Star
                size={20}
                strokeWidth={2}
                className={isStarred ? 'fill-amber-400' : ''}
              />
            </button>
            <button
              onClick={e => {
                e.stopPropagation();
                onEditTags(ex);
              }}
              className="w-11 min-h-[64px] flex items-center justify-center text-tertiary hover:bg-card-hover active:scale-90 transition-all border-l border-divider"
              aria-label={lang === Language.CN ? '编辑标签' : 'edit tags'}
            >
              <PencilLine size={18} strokeWidth={2} />
            </button>
          </>
        )}
        {isEditing && (
          <>
            <button
              onClick={e => {
                e.stopPropagation();
                onEditTags(ex);
              }}
              className="w-11 min-h-[64px] flex items-center justify-center text-accent hover:bg-card-hover active:scale-90 transition-all"
              aria-label="tags"
            >
              <Edit2 size={18} strokeWidth={2} />
            </button>
            <button
              onClick={async e => {
                e.stopPropagation();
                const ok = await onConfirmDelete({
                  message:
                    lang === Language.CN
                      ? '确定要从动作库中删除此动作吗？'
                      : 'Delete this exercise from library?',
                  danger: true,
                  confirmLabel: lang === Language.CN ? '删除' : 'Delete',
                });
                if (ok) onDelete(ex.id);
              }}
              className="w-11 min-h-[64px] flex items-center justify-center text-red-500 hover:bg-red-500/10 active:scale-90 transition-all border-l border-divider"
              aria-label="delete"
            >
              <Trash2 size={18} strokeWidth={2} />
            </button>
          </>
        )}
      </div>
    </div>
  );
};

export default ExercisePicker;
