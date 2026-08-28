/**
 * 编辑某个具体动作的标签（部位 + 器材）。替代过去的拖拽-改标签交互。
 */
import React, { useState, useEffect } from 'react';
import { Check, Sparkles, Filter, Trash2 } from 'lucide-react';
import { ExerciseDefinition, Language } from '../../types';
import { BODY_PARTS, EQUIPMENT_TAGS } from '../constants/exercises';
import { useUiOverlay } from '../contexts/UiOverlayContext';
import { Modal, ModalFooter } from './Modal';

interface EditExerciseTagsModalProps {
  open: boolean;
  exercise: ExerciseDefinition | null;
  lang: Language;
  customTags: {
    id: string;
    name: string;
    category: 'bodyPart' | 'equipment';
  }[];
  getTagName: (tid: string) => string;
  onClose: () => void;
  onSave: (exerciseId: string, bodyPart: string, tags: string[]) => void;
  /**
   * 从动作库中删除此动作（自定义动作会被彻底移除，系统动作会被标记为隐藏）。
   * 不传则不显示"删除"按钮。
   */
  onDelete?: (exerciseId: string) => void;
}

export const EditExerciseTagsModal: React.FC<EditExerciseTagsModalProps> = ({
  open,
  exercise,
  lang,
  customTags,
  getTagName,
  onClose,
  onSave,
  onDelete,
}) => {
  const { confirm } = useUiOverlay();
  const [bodyPart, setBodyPart] = useState('');
  const [tags, setTags] = useState<string[]>([]);

  useEffect(() => {
    if (open && exercise) {
      setBodyPart(exercise.bodyPart || '');
      setTags(exercise.tags || []);
    }
  }, [open, exercise]);

  if (!open || !exercise) return null;

  const isCn = lang === Language.CN;
  const bodyPartIds = [
    ...BODY_PARTS,
    ...customTags.filter(ct => ct.category === 'bodyPart').map(ct => ct.id),
  ];
  const equipmentIds = [
    ...EQUIPMENT_TAGS,
    ...customTags.filter(ct => ct.category === 'equipment').map(ct => ct.id),
  ];

  const toggleEquipment = (id: string) => {
    setTags(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={exercise.name[lang]}
      subtitle={isCn ? '编辑标签' : 'Edit Tags'}
      size="md"
      // 从弹层的动作菜单里开出来，再往上一层
      layer="modal-3"
      dismissOnScrim={false}
      bodyClassName="overflow-y-auto max-h-[65vh] custom-scrollbar space-y-5"
      footer={
        <ModalFooter
          cancelLabel={isCn ? '取消' : 'Cancel'}
          confirmLabel={isCn ? '保存' : 'Save'}
          onCancel={onClose}
          onConfirm={() => {
            onSave(exercise.id, bodyPart, tags);
            onClose();
          }}
          confirmIcon={<Check size={16} strokeWidth={2.5} />}
        />
      }
    >

        {/* 部位（单选） */}
        <div>
          <h4 className="text-[10px] font-bold text-secondary uppercase tracking-[0.2em] mb-2 flex items-center gap-1.5">
            <Sparkles size={11} /> {isCn ? '训练部位' : 'Body Part'}
            <span className="text-tertiary normal-case tracking-normal">
              · {isCn ? '单选' : 'single'}
            </span>
          </h4>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setBodyPart('')}
              className={`min-h-[40px] px-4 rounded-control text-xs font-bold uppercase tracking-wider transition-all ${
                bodyPart === ''
                  ? 'bg-accent text-on-accent'
                  : 'bg-card text-tertiary hover:bg-card-hover'
              }`}
            >
              {isCn ? '无' : 'None'}
            </button>
            {bodyPartIds.map(id => {
              const name = getTagName(id);
              if (!name) return null;
              return (
                <button
                  key={id}
                  onClick={() => setBodyPart(id)}
                  className={`min-h-[40px] px-4 rounded-control text-xs font-bold uppercase tracking-wider transition-all ${
                    bodyPart === id
                      ? 'bg-accent text-on-accent shadow-elevated'
                      : 'bg-card text-secondary hover:bg-card-hover'
                  }`}
                >
                  {name}
                </button>
              );
            })}
          </div>
        </div>

        {/* 器材（多选） */}
        <div>
          <h4 className="text-[10px] font-bold text-secondary uppercase tracking-[0.2em] mb-2 flex items-center gap-1.5">
            <Filter size={11} /> {isCn ? '使用器材' : 'Equipment'}
            <span className="text-tertiary normal-case tracking-normal">
              · {isCn ? '多选' : 'multi'}
            </span>
          </h4>
          <div className="flex flex-wrap gap-2">
            {equipmentIds.map(id => {
              const name = getTagName(id);
              if (!name) return null;
              const active = tags.includes(id);
              return (
                <button
                  key={id}
                  onClick={() => toggleEquipment(id)}
                  className={`min-h-[40px] px-4 rounded-control text-xs font-bold uppercase tracking-wider transition-all ${
                    active
                      ? 'bg-accent text-on-accent shadow-elevated'
                      : 'bg-card text-secondary hover:bg-card-hover'
                  }`}
                >
                  {name}
                </button>
              );
            })}
          </div>
        </div>

        {/* 危险区：删除此动作（§6.6：列表里的删除入口降级为墨色文字项，不喊颜色） */}
        {onDelete && (
          <div className="pt-3 mt-3 border-t border-divider">
            <button
              onClick={async () => {
                const ok = await confirm({
                  message: isCn
                    ? `确定要从动作库中删除「${exercise.name[lang]}」吗？\n相关历史训练记录不会被删除。`
                    : `Delete "${exercise.name[lang]}" from the library?\nExisting workout records will not be removed.`,
                  danger: true,
                  confirmLabel: isCn ? '删除' : 'Delete',
                });
                if (ok) {
                  onDelete(exercise.id);
                  onClose();
                }
              }}
              className="w-full min-h-[44px] rounded-control border border-divider text-primary font-medium flex items-center justify-center gap-2 transition-colors duration-tap ease-paper active:bg-card-hover"
            >
              <Trash2 size={16} strokeWidth={2} />
              {isCn ? '从动作库中删除' : 'Delete from library'}
            </button>
            <p className="text-[10px] text-tertiary text-center mt-2 px-2 leading-relaxed">
              {isCn
                ? '自定义动作会被彻底删除；系统动作会从列表中隐藏，可在「设置 → 重置」中恢复。'
                : 'Custom exercises will be removed. System exercises will be hidden and can be restored in Settings.'}
            </p>
          </div>
        )}
    </Modal>
  );
};

export default EditExerciseTagsModal;
