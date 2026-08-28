import React from 'react';
import { Goal, GoalType, Language } from '../../../types';
import { translations } from '../../../translations';
import { Modal, ModalFooter } from '../Modal';

interface EditGoalModalProps {
  open: boolean;
  lang: Language;
  editingGoal: Goal | null;
  setEditingGoal: React.Dispatch<React.SetStateAction<Goal | null>>;
  onCancel: () => void;
  onSave: () => void;
}

export const EditGoalModal: React.FC<EditGoalModalProps> = ({
  open,
  lang,
  editingGoal,
  setEditingGoal,
  onCancel,
  onSave,
}) => {
  const isCn = lang === Language.CN;
  return (
    <Modal
      isOpen={open && !!editingGoal}
      onClose={onCancel}
      title={isCn ? '编辑目标' : 'Edit Goal'}
      size="sm"
      dismissOnScrim={false}
      footer={
        <ModalFooter
          cancelLabel={isCn ? '取消' : 'Cancel'}
          confirmLabel={isCn ? '保存更改' : 'Save Changes'}
          onCancel={onCancel}
          onConfirm={onSave}
        />
      }
    >
      {editingGoal && (
        <div className="space-y-4">
          <div className="flex gap-2 p-1 bg-inset border border-divider rounded-control">
            {(['weight', 'strength', 'frequency'] as const).map(type => (
              <button
                key={type}
                type="button"
                onClick={() => setEditingGoal({ ...editingGoal, type: type as GoalType })}
                className={`flex-1 min-h-[40px] rounded-chip text-label font-semibold transition-colors duration-tap ease-paper ${
                  editingGoal.type === type ? 'bg-accent text-on-accent' : 'text-secondary'
                }`}
              >
                {
                  translations[
                    `goal${type.charAt(0).toUpperCase() + type.slice(1)}` as keyof typeof translations
                  ][lang]
                }
              </button>
            ))}
          </div>

          <input
            className="ui-input"
            value={editingGoal.title || editingGoal.label || ''}
            onChange={e =>
              setEditingGoal({ ...editingGoal, title: e.target.value, label: e.target.value })
            }
            placeholder={translations.goalLabelPlaceholder[lang]}
          />

          <div className="grid grid-cols-2 gap-3">
            <input
              type="number"
              inputMode="decimal"
              className="ui-input"
              placeholder={translations.current[lang]}
              value={editingGoal.currentValue || ''}
              onChange={e => setEditingGoal({ ...editingGoal, currentValue: Number(e.target.value) })}
            />
            <input
              type="number"
              inputMode="decimal"
              className="ui-input"
              placeholder={translations.target[lang]}
              value={editingGoal.targetValue || ''}
              onChange={e => setEditingGoal({ ...editingGoal, targetValue: Number(e.target.value) })}
            />
          </div>

          <textarea
            className="ui-input resize-none"
            rows={3}
            value={editingGoal.description || ''}
            onChange={e => setEditingGoal({ ...editingGoal, description: e.target.value })}
            placeholder={isCn ? '目标描述（可选）' : 'Goal description (optional)'}
          />

          <div className="flex items-center justify-between px-4 py-3 bg-inset border border-divider rounded-control">
            <span className="text-body font-medium text-primary">
              {isCn ? '目标状态' : 'Goal Status'}
            </span>
            <button
              type="button"
              onClick={() => setEditingGoal({ ...editingGoal, isActive: !editingGoal.isActive })}
              className={`min-h-[36px] px-4 rounded-chip text-label font-semibold transition-colors duration-tap ease-paper ${
                editingGoal.isActive ? 'bg-success text-on-accent' : 'bg-card text-secondary'
              }`}
              role="switch"
              aria-checked={!!editingGoal.isActive}
            >
              {editingGoal.isActive ? (isCn ? '活跃' : 'Active') : isCn ? '暂停' : 'Paused'}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
};

export default EditGoalModal;
