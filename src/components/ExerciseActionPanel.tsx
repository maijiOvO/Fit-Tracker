/**
 * 动作面板（2026-10 第三版细分格，demo：docs/demos/region-board-v3.html）
 *
 * 两个入口共用这一个面板：添加动作弹层普通态「长按动作」、整理态「点动作」。
 * 由原来的长按管理菜单扩出来，样子照旧：bg-inset 底部面板 + 全宽 bg-card 描边按钮 + 删除项 danger/10 底。
 *   - 头部：名字（点了就地改名）+ ★ 开关；副行「部位 · 细分」
 *   - 「归到细分」chip 行（有细分的力量动作）
 *   - 部位与器材 / 做法 / 备注 / 记录项：打开现有的同一批弹窗
 *   - 并入另一个动作（2.5 整理）：这个动作变成那个动作的一个做法，历史 / 纪录跟过去；撤销条
 *   - 从动作库删除：先执行 + 撤销，不弹确认
 *
 * 长按满 500ms 时面板就弹出来了，手指还按着：松手补发的那次 click 不带新的 pointerdown，
 * 会落到面板里正好在指下的按钮上（无头触摸模拟里必现：直接点中「删除」「编辑标签」）。
 * 面板里任何真点击都先有一次 pointerdown，所以「下一次 pointerdown 之前的 click 一律吞掉」——
 * 这是吞一次就作废的条件版，不会把以后的正常点击吃掉。
 */
import React, { useRef, useState } from 'react';
import { FileText, GitMerge, ListChecks, Search, Shuffle, Star, Tags, Trash2 } from 'lucide-react';
import { ExerciseDefinition, Language } from '../../types';
import { useExercisePrefs } from '../contexts/ExercisePrefsContext';
import { useUiOverlay } from '../contexts/UiOverlayContext';

interface Props {
  ex: ExerciseDefinition;
  lang: Language;
  onClose: () => void;
  /** 归到细分（'' = 放回未细分）；由弹层负责写序号与撤销条 */
  onAssignRegion: (ex: ExerciseDefinition, regionId: string) => void;
  onEditTags: (ex: ExerciseDefinition) => void;
  onVariants: (name: string) => void;
  onNote: (name: string) => void;
  onMetrics: (name: string) => void;
  onDelete: (id: string) => void;
  /** 并入候选：动作库里还在的动作（已合并覆盖层） */
  library: ExerciseDefinition[];
}

const btn =
  'w-full min-h-[48px] px-4 rounded-card bg-card border border-divider text-sm font-bold text-primary flex items-center gap-2.5 active:bg-card-hover transition-colors';

export const ExerciseActionPanel: React.FC<Props> = ({
  ex,
  lang,
  onClose,
  onAssignRegion,
  onEditTags,
  onVariants,
  onNote,
  onMetrics,
  onDelete,
  library,
}) => {
  const {
    resolveName,
    regionsOf,
    effectiveRegion,
    effectivePart,
    getTagName,
    starredExercises,
    toggleStarExercise,
    renameExercise,
    mergeExerciseInto,
  } = useExercisePrefs();
  const { toast } = useUiOverlay();
  const isCn = lang === Language.CN;
  const name = resolveName(ex.name[lang]);
  const [draft, setDraft] = useState<string | null>(null);
  /** 并入另一个动作：null＝没打开；字符串＝搜索词 */
  const [mergeQ, setMergeQ] = useState<string | null>(null);
  const ghostRef = useRef(true);

  const part = effectivePart(ex);
  const regs = (ex.category || 'STRENGTH') === 'STRENGTH' && part ? regionsOf(part) : [];
  const cur = effectiveRegion(ex) ?? '';
  const where = [
    part ? getTagName(part) : (ex.category || 'STRENGTH') === 'STRENGTH' ? (isCn ? '未分部位' : 'No part') : '',
    regs.length ? (cur ? getTagName(cur) : isCn ? '未细分' : 'Unassigned') : '',
  ]
    .filter(Boolean)
    .join(' · ');
  const starred = Object.keys(starredExercises).some(k => k.toLowerCase() === name.toLowerCase());

  const commitRename = () => {
    const v = (draft ?? '').trim();
    if (!v || v === name) {
      setDraft(null);
      return;
    }
    // 重名会被拒（已 toast），输入框留着让人改
    if (!renameExercise(ex.id, v)) return;
    setDraft(null);
    toast(isCn ? '已保存' : 'Saved', 'success');
  };

  /** 关面板再开别的弹窗：面板和弹窗不叠在一起 */
  const then = (fn: () => void) => () => {
    onClose();
    fn();
  };

  return (
    <div
      className="absolute inset-0 z-10 bg-scrim flex items-end sm:items-center justify-center p-0 sm:p-6 anim-fade"
      onPointerDownCapture={() => {
        ghostRef.current = false;
      }}
      onClickCapture={e => {
        if (!ghostRef.current) return;
        ghostRef.current = false;
        e.stopPropagation();
        e.preventDefault();
      }}
      onClick={onClose}
      data-testid="row-action-menu"
    >
      <div
        className="bg-inset border-t sm:border border-divider w-full sm:max-w-sm max-h-[88%] overflow-y-auto rounded-t-sheet sm:rounded-card p-4 space-y-2 shadow-2xl"
        style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start gap-2 pl-2 pb-1">
          {draft === null ? (
            <button
              type="button"
              onClick={() => setDraft(name)}
              className="flex-1 min-w-0 text-left text-sm font-semibold text-primary cursor-text"
              data-testid="action-panel-name"
            >
              {name}
              {where && <span className="block text-xs font-medium text-tertiary">{where}</span>}
            </button>
          ) : (
            <div className="flex-1 min-w-0 flex gap-2">
              <input
                className="ui-input flex-1 min-w-0"
                value={draft}
                onChange={e => setDraft(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    commitRename();
                  }
                }}
                aria-label={isCn ? '动作名称' : 'Exercise name'}
                autoFocus
                onFocus={e => e.currentTarget.select()}
              />
              <button
                type="button"
                onClick={commitRename}
                className="flex-shrink-0 px-4 rounded-control bg-accent text-on-accent font-semibold"
              >
                {isCn ? '改名' : 'Rename'}
              </button>
            </div>
          )}
          <button
            type="button"
            onClick={() => toggleStarExercise(name)}
            aria-pressed={starred}
            aria-label={isCn ? '收藏' : 'Star'}
            className="w-11 h-11 -mt-2 -mr-2 -mb-1 flex-shrink-0 flex items-center justify-center rounded-control text-warning"
            data-testid="action-panel-star"
          >
            <Star size={20} strokeWidth={2} className={starred ? 'fill-warning' : ''} />
          </button>
        </div>

        {regs.length > 0 && (
          <>
            <div className="px-2 pt-0.5 text-[10px] font-bold tracking-[0.2em] text-secondary">
              {isCn ? '归到细分' : 'REGION'}
            </div>
            <div className="flex flex-wrap gap-1.5 pb-1.5" data-testid="menu-region-chips">
              {[{ id: '' }, ...regs].map(r => {
                const on = cur === r.id;
                return (
                  <button
                    key={r.id || 'none'}
                    type="button"
                    aria-pressed={on}
                    onClick={() => {
                      onClose();
                      if (!on) onAssignRegion(ex, r.id);
                    }}
                    className={`min-h-[38px] px-3 rounded-control text-xs font-bold border transition-colors ${
                      on ? 'bg-accent border-accent text-on-accent shadow-elevated' : 'bg-card border-divider text-secondary'
                    }`}
                  >
                    {r.id ? getTagName(r.id) : isCn ? '未细分' : 'Unassigned'}
                  </button>
                );
              })}
            </div>
          </>
        )}

        <button type="button" className={btn} onClick={then(() => onEditTags(ex))}>
          <Tags size={16} className="text-accent" />
          {isCn ? '部位与器材' : 'Part & gear'}
        </button>
        <button type="button" className={btn} onClick={then(() => onVariants(name))}>
          <Shuffle size={16} className="text-accent" />
          {isCn ? '做法' : 'Variants'}
        </button>
        {mergeQ === null ? (
          <button type="button" className={btn} onClick={() => setMergeQ('')} data-testid="merge-open">
            <GitMerge size={16} className="text-accent" />
            {isCn ? '并入另一个动作…' : 'Merge into another…'}
          </button>
        ) : (
          (() => {
            // 同部位的排前面；搜名字（中英、曾用名）
            const q = mergeQ.trim().toLowerCase();
            const myPart = (part || '').toLowerCase();
            const list = library
              .filter(d => d.id !== ex.id)
              .filter(d => {
                if (!q) return (d.bodyPart || '').toLowerCase() === myPart;
                return [d.name.cn, d.name.en, ...(d.aliases ?? [])].some(n => (n || '').toLowerCase().includes(q));
              })
              .slice(0, 12);
            return (
              <div className="rounded-card border border-divider bg-card p-2 space-y-1.5" data-testid="merge-panel">
                <div className="px-1 text-xs font-medium text-tertiary">
                  {isCn ? `把「${name}」并进哪个动作？它会成为那个动作的一个做法，历史和纪录一起过去` : `Merge "${name}" into which exercise? It becomes a variant; history follows.`}
                </div>
                <div className="relative">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-tertiary" />
                  <input
                    className="ui-input w-full pl-8"
                    value={mergeQ}
                    onChange={e => setMergeQ(e.target.value)}
                    placeholder={isCn ? '搜动作名' : 'Search'}
                    aria-label={isCn ? '搜动作名' : 'Search'}
                  />
                </div>
                {list.map(d => (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => {
                      if (mergeExerciseInto(ex.id, d.id)) onClose();
                    }}
                    className="w-full min-h-[44px] px-3 rounded-control text-left text-sm font-semibold text-primary active:bg-card-hover flex items-center gap-2"
                    data-testid="merge-target"
                  >
                    {resolveName(d.name[lang])}
                    {d.bodyPart && <span className="ml-auto text-xs font-medium text-tertiary">{getTagName(d.bodyPart)}</span>}
                  </button>
                ))}
                {!list.length && <div className="px-1 py-2 text-xs text-tertiary">{isCn ? '没有匹配的动作' : 'No match'}</div>}
              </div>
            );
          })()
        )}
        <button type="button" className={btn} onClick={then(() => onNote(name))}>
          <FileText size={16} className="text-accent" />
          {isCn ? '备注' : 'Note'}
        </button>
        <button type="button" className={btn} onClick={then(() => onMetrics(name))}>
          <ListChecks size={16} className="text-accent" />
          {isCn ? '记录项' : 'Metrics'}
        </button>
        <button
          type="button"
          onClick={then(() => onDelete(ex.id))}
          className="w-full min-h-[48px] px-4 rounded-card bg-danger/10 text-sm font-bold text-danger flex items-center gap-2.5 active:bg-danger/20 transition-colors"
        >
          <Trash2 size={16} />
          {isCn ? '从动作库删除' : 'Delete from library'}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="w-full min-h-[48px] px-4 rounded-card text-sm font-bold text-secondary flex items-center justify-center active:bg-card-hover transition-colors"
        >
          {isCn ? '取消' : 'Cancel'}
        </button>
      </div>
    </div>
  );
};

export default ExerciseActionPanel;
