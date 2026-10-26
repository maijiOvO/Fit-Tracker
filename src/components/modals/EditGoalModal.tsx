import React from 'react';
import { Goal, GoalType, Language } from '../../../types';
import { translations } from '../../../translations';
import { Modal, ModalFooter } from '../Modal';
import { ScrubNumber } from '../ScrubNumber';

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
                  editingGoal.type === type ? 'seg-on' : 'text-secondary'
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
            <ScrubNumber
              value={editingGoal.currentValue ? Number(editingGoal.currentValue) : null}
              onCommit={n => setEditingGoal({ ...editingGoal, currentValue: n ?? 0 })}
              allowEmpty
              live
              min={-1e6}
              max={1e6}
              steps={[1, 5, 10, 50]}
              placeholder={String(translations.current[lang])}
              ariaLabel={String(translations.current[lang])}
              fill
              className="ui-input"
            />
            <ScrubNumber
              value={editingGoal.targetValue ? Number(editingGoal.targetValue) : null}
              onCommit={n => setEditingGoal({ ...editingGoal, targetValue: n ?? 0 })}
              allowEmpty
              live
              min={-1e6}
              max={1e6}
              steps={[1, 5, 10, 50]}
              placeholder={String(translations.target[lang])}
              ariaLabel={String(translations.target[lang])}
              fill
              className="ui-input"
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
