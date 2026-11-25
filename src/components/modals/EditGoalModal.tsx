import React from 'react';
import { Goal, GoalType, Language } from '../../../types';
import { translations } from '../../../translations';
import { Modal, ModalFooter } from '../Modal';
import { ScrubNumber } from '../ScrubNumber';
import { LiftPicker } from '../LiftPicker';
import { useUserSettingsContext } from '../../contexts/UserSettingsContext';
import { canSaveGoal, currentHidden, goalLabelPlaceholder, goalUnitLabel, normalizeGoal } from '../../utils/goalProgress';

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
  const { unit, weightEntries } = useUserSettingsContext();
  const hasWeightLog = weightEntries.length > 0;
  // 后缀显示这个目标自己的单位（规整后的）：lbs 用户编辑 kg 目标看到的是 kg
  const suffix = editingGoal && (
    <span className="flex-none text-tertiary text-small">{goalUnitLabel(normalizeGoal(editingGoal, { unit, hasWeightLog }), isCn)}</span>
  );
  return (
    <Modal
      isOpen={open && !!editingGoal}
      onClose={onCancel}
      title={isCn ? '编辑目标' : 'Edit goal'}
      size="sm"
      dismissOnScrim={false}
      footer={
        <ModalFooter
          cancelLabel={isCn ? '取消' : 'Cancel'}
          confirmLabel={isCn ? '保存' : 'Save'}
          onCancel={onCancel}
          onConfirm={onSave}
          // 和新建同一条：空名字、目标值不是正数存不进去（原来编辑能存，同步时空标题被换成英文兜底，审查 C72）
          confirmDisabled={!editingGoal || !canSaveGoal(editingGoal)}
          confirmTestId="goal-confirm"
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
            placeholder={goalLabelPlaceholder(editingGoal.type, isCn)}
          />

          {/* 绑的动作并入别处 / 找不到了（目标卡写「动作不在了」）就在这里重选 */}
          {editingGoal.type === 'strength' && (
            <LiftPicker
              isCn={isCn}
              picked={editingGoal.autoUpdateRule?.exerciseName}
              onPick={stableId =>
                setEditingGoal({
                  ...editingGoal,
                  autoUpdateRule: { sourceType: 'workouts', calculation: 'max', exerciseName: stableId },
                })
              }
            />
          )}

          <div className="grid grid-cols-2 gap-3">
            {/* 当前值现算的（频率、绑了动作的力量、已有体重记录的体重）不用填，填了也会被现算值盖掉 */}
            {!currentHidden(editingGoal.type, editingGoal.type === 'strength' ? editingGoal.autoUpdateRule : undefined, hasWeightLog) && (
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
              suffix={suffix}
              className="ui-input"
            />
            )}
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
              suffix={suffix}
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
        </div>
      )}
    </Modal>
  );
};
