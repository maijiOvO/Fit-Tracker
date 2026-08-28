import React from 'react';
import { X } from 'lucide-react';
import { Goal, GoalType, Language } from '../../../types';
import { translations } from '../../../translations';

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
  if (!open || !editingGoal) return null;
  const isCn = lang === Language.CN;
  return (
    <div className="fixed inset-0 z-[70] bg-base/80 backdrop-blur-md flex items-center justify-center p-6 anim-fade">
      <div className="bg-inset border border-divider w-full max-w-sm rounded-card p-8 space-y-6 shadow-2xl">
        <div className="flex justify-between items-center">
          <h2 className="text-2xl font-semibold">{isCn ? '编辑目标' : 'Edit Goal'}</h2>
          <button
            onClick={onCancel}
            className="p-2 hover:bg-card rounded-full transition-colors"
          >
            <X size={20} className="text-secondary" />
          </button>
        </div>
        <div className="space-y-4">
          <div className="flex gap-2">
            {(['weight', 'strength', 'frequency'] as const).map(type => (
              <button
                key={type}
                onClick={() =>
                  setEditingGoal({ ...editingGoal, type: type as GoalType })
                }
                className={`flex-1 py-3 rounded-2xl text-[10px] font-semibold uppercase transition-all ${
                  editingGoal.type === type ? 'bg-accent' : 'bg-card'
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
            className="w-full bg-card border border-divider rounded-2xl py-4 px-6"
            value={editingGoal.title || editingGoal.label || ''}
            onChange={e =>
              setEditingGoal({
                ...editingGoal,
                title: e.target.value,
                label: e.target.value,
              })
            }
            placeholder={translations.goalLabelPlaceholder[lang]}
          />

          <div className="grid grid-cols-2 gap-4">
            <input
              type="number"
              className="bg-card border border-divider rounded-2xl py-4 px-6"
              placeholder={translations.current[lang]}
              value={editingGoal.currentValue || ''}
              onChange={e =>
                setEditingGoal({
                  ...editingGoal,
                  currentValue: Number(e.target.value),
                })
              }
            />
            <input
              type="number"
              className="bg-card border border-divider rounded-2xl py-4 px-6"
              placeholder={translations.target[lang]}
              value={editingGoal.targetValue || ''}
              onChange={e =>
                setEditingGoal({
                  ...editingGoal,
                  targetValue: Number(e.target.value),
                })
              }
            />
          </div>

          <textarea
            className="w-full bg-card border border-divider rounded-2xl py-4 px-6 resize-none"
            rows={3}
            value={editingGoal.description || ''}
            onChange={e =>
              setEditingGoal({ ...editingGoal, description: e.target.value })
            }
            placeholder={isCn ? '目标描述（可选）' : 'Goal description (optional)'}
          />

          <div className="flex items-center justify-between p-4 bg-card/50 rounded-2xl">
            <span className="text-sm font-bold text-primary">
              {isCn ? '目标状态' : 'Goal Status'}
            </span>
            <button
              onClick={() =>
                setEditingGoal({ ...editingGoal, isActive: !editingGoal.isActive })
              }
              className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                editingGoal.isActive
                  ? 'bg-success text-on-accent'
                  : 'bg-inset text-secondary'
              }`}
            >
              {editingGoal.isActive
                ? isCn
                  ? '活跃'
                  : 'Active'
                : isCn
                  ? '暂停'
                  : 'Paused'}
            </button>
          </div>
        </div>
        <div className="flex gap-4">
          <button
            onClick={onCancel}
            className="flex-1 bg-card py-4 rounded-2xl font-semibold text-secondary hover:bg-card-hover transition-colors"
          >
            {isCn ? '取消' : 'Cancel'}
          </button>
          <button
            onClick={onSave}
            className="flex-[2] bg-accent py-4 rounded-2xl font-semibold text-on-accent hover:opacity-90 transition-all shadow-elevated active:scale-95"
          >
            {isCn ? '保存更改' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default EditGoalModal;
