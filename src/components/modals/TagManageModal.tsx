/**
 * 标签管理页 —— 只管标签词表（部位 + 细分 + 器材），不含动作列表。
 *
 * 设计逻辑（与「添加动作」弹层头部的入口配合）：
 *   - 进来即是可编辑态：点标签改名，自定义标签可删，末尾「＋新建」
 *   - 每个标签显示使用数（几个动作在用），删除的确认与撤销由 prefs.deleteTag 内建
 *   - 系统标签只能改名不能删（与老动作库管理模式的规则一致）
 */
import React, { useMemo, useState } from 'react';
import { Columns3, Edit2, PlusCircle, Trash2, Sparkles, Filter } from 'lucide-react';
import { Language } from '../../../types';
import { BODY_PARTS, BODY_REGIONS, DEFAULT_EXERCISES, EQUIPMENT_TAGS } from '../../constants/exercises';
import { Modal } from '../Modal';
import { RenameModal } from './RenameModal';
import { mergeOverride } from '../../utils/exerciseOverride';
import { useExercisePrefs } from '../../contexts/ExercisePrefsContext';

interface TagManageModalProps {
  open: boolean;
  lang: Language;
  onClose: () => void;
  /** 打开重命名弹窗（App 的 RenameModal 流程） */
  onRenameTag: (id: string, currentName: string) => void;
  /** 删除自定义标签（prefs.deleteTag，自带确认 + 撤销） */
  onDeleteTag: (id: string) => void;
  /** 打开新建标签弹窗（App 的 AddTagModal 流程） */
  onCreateCustomTag: (category: 'bodyPart' | 'equipment') => void;
}

export const TagManageModal: React.FC<TagManageModalProps> = ({
  open,
  lang,
  onClose,
  onRenameTag,
  onDeleteTag,
  onCreateCustomTag,
}) => {
  const { customTags, customExercises, exerciseOverrides, getTagName, regionsOf, effectiveRegion, addRegionTag } =
    useExercisePrefs();
  const isCn = lang === Language.CN;
  /** 「新建细分」挂在哪个部位下；null = 没在新建 */
  const [newRegionFor, setNewRegionFor] = useState<string | null>(null);
  const [newRegionName, setNewRegionName] = useState('');

  // 使用数：每个标签被多少个（未隐藏的）动作引用
  const usage = useMemo(() => {
    const counts = new Map<string, number>();
    const bump = (id?: string) => {
      if (!id) return;
      const key = id.toLowerCase();
      counts.set(key, (counts.get(key) ?? 0) + 1);
    };
    for (const def of [...DEFAULT_EXERCISES, ...customExercises]) {
      const over = exerciseOverrides[def.id];
      if ((over as { hidden?: boolean } | undefined)?.hidden) continue;
      const merged = mergeOverride(def, over);
      bump(merged.bodyPart);
      for (const t of merged.tags ?? []) bump(t);
      // 细分按「此刻落在哪一列」算：细分不属于当前部位的不计
      bump(effectiveRegion(merged) ?? undefined);
    }
    return counts;
  }, [customExercises, exerciseOverrides, effectiveRegion]);

  if (!open) return null;

  const renderChip = (id: string, isCustom: boolean) => {
    const name = getTagName(id);
    if (!name) return null;
    const n = usage.get(id.toLowerCase()) ?? 0;
    return (
      <div
        key={id}
        className="flex items-stretch rounded-control overflow-hidden border border-divider bg-card"
      >
        <button
          type="button"
          onClick={() => onRenameTag(id, name)}
          className="min-h-[44px] pl-3.5 pr-3 flex items-center gap-1.5 active:bg-card-hover transition-colors"
          aria-label={`rename ${name}`}
        >
          <span className={`text-xs font-bold ${isCustom ? 'text-accent' : 'text-primary'}`}>
            {name}
          </span>
          <span className="text-[10px] font-bold text-tertiary tabular-nums">{n}</span>
          {isCustom && (
            <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-accent/10 text-accent">
              {isCn ? '自定义' : 'custom'}
            </span>
          )}
          <Edit2 size={11} className="text-tertiary" />
        </button>
        {isCustom && (
          <button
            type="button"
            onClick={() => onDeleteTag(id)}
            className="w-10 min-h-[44px] flex items-center justify-center text-danger border-l border-divider active:bg-danger/15 transition-colors"
            aria-label={`delete ${name}`}
          >
            <Trash2 size={14} strokeWidth={2} />
          </button>
        )}
      </div>
    );
  };

  const renderSection = (
    icon: React.ReactNode,
    title: string,
    hint: string,
    systemIds: readonly string[],
    category: 'bodyPart' | 'equipment',
    addLabel: string,
  ) => {
    const customIds = customTags.filter(ct => ct.category === category).map(ct => ct.id);
    return (
      <div>
        <h3 className="text-[10px] font-bold text-secondary uppercase tracking-[0.2em] mb-2.5 px-1 flex items-center gap-1.5">
          {icon} {title}
          <span className="text-tertiary normal-case tracking-normal">· {hint}</span>
        </h3>
        <div className="flex flex-wrap gap-2">
          {systemIds.map(id => renderChip(id, false))}
          {customIds.map(id => renderChip(id, true))}
          <button
            type="button"
            onClick={() => onCreateCustomTag(category)}
            className="min-h-[44px] px-3.5 rounded-control text-xs font-bold text-accent border border-dashed border-accent/40 active:bg-accent/10 transition-colors flex items-center gap-1.5"
          >
            <PlusCircle size={13} /> {addLabel}
          </button>
        </div>
      </div>
    );
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={isCn ? '标签管理' : 'Manage Tags'}
      size="md"
      layer="modal-2"
      testId="tag-manage-modal"
      bodyClassName="overflow-y-auto max-h-[65vh] custom-scrollbar"
    >
      <div className="space-y-6">
          {renderSection(
            <Sparkles size={11} />,
            isCn ? '部位标签' : 'Body parts',
            isCn ? '数字为使用数' : 'number = usage',
            BODY_PARTS,
            'bodyPart',
            isCn ? '新建部位' : 'New part',
          )}
          {/* 细分标签（第 3 条）：按部位分组。系统细分可改名；自建细分可改名、可删
              （删除走撤销条，用到它的动作回到未细分）。 */}
          <div>
            <h3 className="text-[10px] font-bold text-secondary uppercase tracking-[0.2em] mb-2.5 px-1 flex items-center gap-1.5">
              <Columns3 size={11} /> {isCn ? '细分标签' : 'Regions'}
              <span className="text-tertiary normal-case tracking-normal">
                · {isCn ? '数字为使用数' : 'number = usage'}
              </span>
            </h3>
            <div className="divide-y divide-divider">
              {Object.keys(BODY_REGIONS).map(part => (
                <div key={part} className="flex gap-2.5 items-start py-2.5 first:pt-0" data-testid={`region-group-${part}`}>
                  <span className="min-w-[30px] flex-shrink-0 text-[11px] font-bold leading-[44px] text-tertiary">
                    {getTagName(part)}
                  </span>
                  <div className="flex-1 min-w-0 flex flex-wrap gap-2">
                    {regionsOf(part).map(r => renderChip(r.id, r.custom))}
                    <button
                      type="button"
                      onClick={() => {
                        setNewRegionName('');
                        setNewRegionFor(part);
                      }}
                      className="min-h-[44px] px-3.5 rounded-control text-xs font-bold text-accent border border-dashed border-accent/40 active:bg-accent/10 transition-colors flex items-center gap-1.5"
                    >
                      <PlusCircle size={13} /> {isCn ? '新建细分' : 'New region'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
          {renderSection(
            <Filter size={11} />,
            isCn ? '器材标签' : 'Equipment',
            isCn ? '数字为使用数' : 'number = usage',
            EQUIPMENT_TAGS,
            'equipment',
            isCn ? '新建器材' : 'New gear',
          )}
      </div>
      <RenameModal
        open={newRegionFor !== null}
        lang={lang}
        title={
          newRegionFor
            ? `${isCn ? '新建细分' : 'New region'} · ${getTagName(newRegionFor)}`
            : ''
        }
        placeholder={isCn ? '细分名称' : 'Region name'}
        value={newRegionName}
        setValue={setNewRegionName}
        onClose={() => setNewRegionFor(null)}
        onConfirm={() => {
          if (!newRegionFor) return;
          // 同一部位下重名：addRegionTag 会 toast 并返回 null，弹窗留着改
          if (addRegionTag(newRegionFor, newRegionName)) setNewRegionFor(null);
        }}
      />
    </Modal>
  );
};

export default TagManageModal;
