/**
 * 标签管理页 —— 只管标签词表（部位 + 器材），不含动作列表。
 *
 * 设计逻辑（与「添加动作」弹层头部的入口配合）：
 *   - 进来即是可编辑态：点标签改名，自定义标签可删，末尾「＋新建」
 *   - 每个标签显示使用数（几个动作在用），删除的确认与撤销由 prefs.deleteTag 内建
 *   - 系统标签只能改名不能删（与老动作库管理模式的规则一致）
 */
import React, { useMemo } from 'react';
import { Edit2, PlusCircle, Trash2, Sparkles, Filter } from 'lucide-react';
import { Language } from '../../../types';
import { BODY_PARTS, DEFAULT_EXERCISES, EQUIPMENT_TAGS } from '../../constants/exercises';
import { Modal } from '../Modal';
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
  const { customTags, customExercises, exerciseOverrides, getTagName } = useExercisePrefs();
  const isCn = lang === Language.CN;

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
      const merged = over ? { ...def, ...over } : def;
      bump(merged.bodyPart);
      for (const t of merged.tags ?? []) bump(t);
    }
    return counts;
  }, [customExercises, exerciseOverrides]);

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
      footer={
        <p className="text-micro text-tertiary leading-relaxed">
          {isCn
            ? '点标签改名 · 带「自定义」的是你创建的标签，可删除（可撤销）· 其余为系统标签，只能改名（改过名的也算系统标签）'
            : 'Tap to rename · "custom" tags are yours and deletable (undoable) · the rest are system tags, rename-only (renaming does not make them custom)'}
        </p>
      }
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
          {renderSection(
            <Filter size={11} />,
            isCn ? '器材标签' : 'Equipment',
            isCn ? '数字为使用数' : 'number = usage',
            EQUIPMENT_TAGS,
            'equipment',
            isCn ? '新建器材' : 'New gear',
          )}
      </div>
    </Modal>
  );
};

export default TagManageModal;
