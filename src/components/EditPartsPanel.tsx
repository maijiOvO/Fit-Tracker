/**
 * 编辑部位（2026-10-27 添加动作重构，demo：docs/demos/picker-layout-a.html）：整理态竖栏底部「编辑部位」。
 *
 * 两屏：部位列表（改名 · 排序 · 删自建 · 新建，「细分 ›」进去）；某个部位的细分列表（改名 · 排序 · 删除 · 新建，
 * 删掉的系统细分在下面能恢复）。从某个部位进来直接落在它的细分屏，从「全部」进来落在部位列表。
 *
 * 点名字＝就地改名；长按一行抬起后上下拖＝排序，和训练页动作卡同一套（useCardReorder + 位置条，2026-10-27 用户定：
 * 原来的 ↑↓ 按钮改成直接拖）。名字不是 button：整行都是长按热区，排序 hook 碰到 button 会跳过。
 * 内置部位只能改名、排序，不能删（同原来）。
 */
import React, { useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Plus, RotateCcw, X } from 'lucide-react';
import { Language } from '../../types';
import { BODY_PARTS } from '../constants/exercises';
import { useExercisePrefs } from '../contexts/ExercisePrefsContext';
import { useCardReorder } from '../hooks/useCardReorder';
import { LongPressAffordance } from './LongPressAffordance';
import { ReorderStrip } from './ReorderStrip';

interface Props {
  lang: Language;
  /** 从哪个部位进来（落在它的细分屏）；null＝部位列表 */
  startPart: string | null;
  /** 部位 / 细分下有几个动作（行尾的计数） */
  countPart: (id: string) => number;
  countRegion: (id: string) => number;
  onClose: () => void;
}

interface Item {
  id: string;
  name: string;
  count: number;
  /** 不能删（内置部位）：✕ 灰掉 */
  locked?: boolean;
}

/** 一屏的列表：行（就地改名 + 长按拖排序 + ✕ + 可选的尾按钮）+ 末行新建 */
const EditList: React.FC<{
  items: Item[];
  isCn: boolean;
  newLabel: string;
  onRename: (id: string, name: string) => boolean;
  onReorder: (from: number, to: number) => void;
  onDelete: (id: string) => void;
  onCreate: (name: string) => boolean;
  tail?: (id: string) => React.ReactNode;
  head?: React.ReactNode;
}> = ({ items, isCn, newLabel, onRename, onReorder, onDelete, onCreate, tail, head }) => {
  const reorder = useCardReorder({ count: items.length, onReorder });
  const [editing, setEditing] = useState<{ id: string; draft: string } | null>(null);
  /** 长按过的那次松手还会补发 click：按下超过这么久的不当「点名字」 */
  const downAt = useRef(0);
  const commit = () => {
    if (!editing) return;
    const it = items.find(i => i.id === editing.id);
    const v = editing.draft.trim();
    // 重名会被拒（已 toast），输入框留着让人改
    if (editing.id === '' ? !v || onCreate(v) : !v || v === it?.name || onRename(editing.id, v)) setEditing(null);
  };
  const input = (
    <input
      className="ui-input flex-1 min-w-0 font-semibold"
      value={editing?.draft ?? ''}
      onChange={e => setEditing(s => s && { ...s, draft: e.target.value })}
      onKeyDown={e => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
      onBlur={commit}
      autoFocus
      onFocus={e => e.currentTarget.select()}
      aria-label={newLabel}
    />
  );
  return (
    <div className="rounded-card border border-divider bg-card divide-y divide-divider overflow-hidden">
      <ReorderStrip strip={reorder.strip} labels={items.map(i => i.name)} />
      {head}
      {items.map((it, i) => (
        <div
          key={it.id}
          ref={reorder.itemRef(i)}
          className={`relative min-h-[50px] pl-3.5 pr-1.5 flex items-center gap-1 touch-pan-y select-none${reorder.draggingIdx === i ? ' reorder-lifted' : ''}`}
          {...reorder.handleProps(i)}
          onPointerDownCapture={() => (downAt.current = performance.now())}
          data-testid="edit-parts-row"
        >
          <LongPressAffordance
            active={reorder.pressingIdx === i}
            hint={reorder.hintingIdx === i && !editing}
            label={isCn ? '拖动排序' : 'Drag to reorder'}
            hintLabel={isCn ? '按住拖动排序' : 'Hold to reorder'}
            drawMs={reorder.drawMs}
            placement="down"
          />
          {editing?.id === it.id ? (
            input
          ) : (
            <span
              className="flex-1 min-w-0 truncate py-3 text-small font-semibold text-primary cursor-text"
              onClick={() => {
                if (performance.now() - downAt.current > 450) return;
                setEditing({ id: it.id, draft: it.name });
              }}
              data-testid="edit-parts-name"
            >
              {it.name}
            </span>
          )}
          <span className="w-7 flex-shrink-0 text-right text-xs tabular-nums text-tertiary">{it.count || ''}</span>
          <button
            type="button"
            disabled={it.locked}
            onClick={() => onDelete(it.id)}
            aria-label={isCn ? '删除' : 'Delete'}
            className="w-9 h-9 flex-shrink-0 flex items-center justify-center rounded-control text-danger disabled:text-tertiary disabled:opacity-40 active:bg-danger/10"
            data-testid="edit-parts-delete"
          >
            <X size={16} />
          </button>
          {tail?.(it.id)}
        </div>
      ))}
      {editing?.id === '' ? (
        <div className="min-h-[50px] px-3.5 flex items-center">{input}</div>
      ) : (
        <button
          type="button"
          onClick={() => setEditing({ id: '', draft: '' })}
          className="w-full min-h-[48px] px-3.5 flex items-center gap-1.5 text-small font-bold text-accent active:bg-card-hover"
          data-testid="edit-parts-new"
        >
          <Plus size={14} strokeWidth={2.5} />
          {newLabel}
        </button>
      )}
    </div>
  );
};

export const EditPartsPanel: React.FC<Props> = ({ lang, startPart, countPart, countRegion, onClose }) => {
  const {
    customTags,
    getTagName,
    sortParts,
    reorderParts,
    renameTag,
    addTag,
    deleteTag,
    regionsOf,
    hiddenRegionsOf,
    reorderRegions,
    addRegionTag,
    removeRegion,
    restoreRegion,
  } = useExercisePrefs();
  const isCn = lang === Language.CN;
  const [part, setPart] = useState<string | null>(startPart);

  const partIds = sortParts([...BODY_PARTS, ...customTags.filter(t => t.category === 'bodyPart').map(t => t.id)]);
  const hidden = part ? hiddenRegionsOf(part) : [];

  return (
    <div
      className="absolute inset-0 z-10 bg-scrim flex items-end sm:items-center justify-center anim-fade"
      onClick={onClose}
      data-testid="edit-parts"
    >
      <div
        className="bg-inset border-t sm:border border-divider w-full sm:max-w-sm max-h-[88%] overflow-y-auto rounded-t-sheet sm:rounded-card p-4 space-y-2.5 shadow-2xl"
        style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}
        onClick={e => e.stopPropagation()}
      >
        <p className="px-1 pb-1 flex items-center gap-1 text-small font-semibold text-primary">
          {part && (
            <button
              type="button"
              onClick={() => setPart(null)}
              aria-label={isCn ? '回到部位列表' : 'Back to parts'}
              className="w-8 h-8 -ml-1 flex items-center justify-center rounded-control text-secondary active:bg-card-hover"
              data-testid="edit-parts-back"
            >
              <ChevronLeft size={18} />
            </button>
          )}
          {part ? getTagName(part) : isCn ? '编辑部位' : 'Edit parts'}
          {part && <span className="text-xs font-medium text-tertiary">{isCn ? '细分' : 'Regions'}</span>}
        </p>

        {part ? (
          <>
            <EditList
              key={part}
              isCn={isCn}
              items={regionsOf(part).map(r => ({ id: r.id, name: getTagName(r.id), count: countRegion(r.id) }))}
              newLabel={isCn ? '新建细分' : 'New region'}
              onRename={renameTag}
              onReorder={(from, to) => reorderRegions(part, from, to)}
              onDelete={id => removeRegion(part, id)}
              onCreate={name => !!addRegionTag(part, name)}
              head={
                // 热身不是细分（是动作的热身用途），但在添加动作里固定排第一：列出来让顺序一眼看全
                <div className="min-h-[50px] px-3.5 flex items-center text-small font-semibold text-tertiary">{isCn ? '热身' : 'Warm-up'}</div>
              }
            />
            {hidden.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {hidden.map(h => (
                  <button
                    key={h}
                    type="button"
                    onClick={() => restoreRegion(part, h)}
                    className="min-h-[38px] px-3 rounded-control text-xs font-bold bg-card border border-dashed border-divider text-secondary flex items-center gap-1.5"
                  >
                    <RotateCcw size={12} /> {getTagName(h)}
                  </button>
                ))}
              </div>
            )}
          </>
        ) : (
          <EditList
            isCn={isCn}
            items={partIds.map(id => ({ id, name: getTagName(id), count: countPart(id), locked: BODY_PARTS.includes(id) }))}
            newLabel={isCn ? '新建部位' : 'New part'}
            onRename={renameTag}
            onReorder={(from, to) => reorderParts(partIds, from, to)}
            onDelete={id => void deleteTag(id)}
            onCreate={name => !!addTag('bodyPart', name)}
            tail={id => (
              <button
                type="button"
                onClick={() => setPart(id)}
                className="flex-shrink-0 min-h-[36px] pl-2 pr-1 flex items-center text-xs font-bold text-accent"
                data-testid="edit-parts-open"
              >
                {isCn ? '细分' : 'Regions'}
                <ChevronRight size={14} />
              </button>
            )}
          />
        )}

        <button
          type="button"
          onClick={onClose}
          className="w-full min-h-[48px] px-4 rounded-card text-small font-bold text-secondary flex items-center justify-center active:bg-card-hover transition-colors"
        >
          {isCn ? '完成' : 'Done'}
        </button>
      </div>
    </div>
  );
};
