import React, { useRef } from 'react';
import { Goal, Language } from '../../../types';
import { translations } from '../../../translations';
import { Modal, ModalFooter } from '../Modal';
import { ScrubNumber } from '../ScrubNumber';
import { LiftPicker } from '../LiftPicker';
import { useUserSettingsContext } from '../../contexts/UserSettingsContext';
import { canSaveGoal, currentHidden, goalLabelPlaceholder, goalUnitLabel, normalizeGoal } from '../../utils/goalProgress';

interface AddGoalModalProps {
  open: boolean;
  lang: Language;
  newGoal: Partial<Goal>;
  setNewGoal: React.Dispatch<React.SetStateAction<Partial<Goal>>>;
  onClose: () => void;
  onConfirm: () => void;
}

export const AddGoalModal: React.FC<AddGoalModalProps> = ({
  open,
  lang,
  newGoal,
  setNewGoal,
  onClose,
  onConfirm,
}) => {
  const isCn = lang === Language.CN;
  const { unit, weightEntries } = useUserSettingsContext();
  const hasWeightLog = weightEntries.length > 0;
  // 后缀显示将要存的单位（规整后的），和保存走同一份规则
  const suffix = <span className="flex-none text-tertiary text-small">{goalUnitLabel(normalizeGoal(newGoal, { unit, hasWeightLog }), isCn)}</span>;
  /** 上一次选的动作名：名称还是它（没自己改过）时，换动作跟着换名 */
  const pickedKeyRef = useRef<string | null>(null);
  return (
    <Modal
      isOpen={open}
      onClose={onClose}
      title={translations.setGoal[lang]}
      size="sm"
      dismissOnScrim={false}
      footer={
        <ModalFooter
          cancelLabel={isCn ? '取消' : 'Cancel'}
          confirmLabel={translations.confirm[lang]}
          onCancel={onClose}
          onConfirm={onConfirm}
          // 没名字、目标值不是正数时按钮灰着（原来能点、点了没反应）
          confirmDisabled={!canSaveGoal(newGoal)}
          confirmTestId="goal-confirm"
        />
      }
    >
      <div className="space-y-4">
        {/* 原来是 10px uppercase——中文下 uppercase 无效、10px 低于 11px 下限（§3） */}
        <div className="flex gap-2 p-1 bg-inset border border-divider rounded-control">
          {(['weight', 'strength', 'frequency'] as const).map(type => (
            <button
              key={type}
              type="button"
              // 绑的动作只属于力量目标
              onClick={() => setNewGoal({ ...newGoal, type, autoUpdateRule: type === 'strength' ? newGoal.autoUpdateRule : undefined })}
              className={`flex-1 min-h-[40px] rounded-chip text-label font-semibold transition-colors duration-tap ease-paper ${
                newGoal.type === type ? 'seg-on' : 'text-secondary'
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
          value={newGoal.label || ''}
          onChange={e => setNewGoal({ ...newGoal, label: e.target.value })}
          placeholder={goalLabelPlaceholder(newGoal.type, isCn)}
        />
        {newGoal.type === 'strength' && (
          <LiftPicker
            isCn={isCn}
            picked={newGoal.autoUpdateRule?.exerciseName}
            onPick={(stableId, key) => {
              // 名称是空的、或还是上一次选的动作名：跟着换成这个动作；自己改过的不动（审查 C75）
              const keepLabel = !!newGoal.label?.trim() && newGoal.label !== pickedKeyRef.current;
              pickedKeyRef.current = key;
              setNewGoal({
                ...newGoal,
                label: keepLabel ? newGoal.label : key,
                autoUpdateRule: { sourceType: 'workouts', calculation: 'max', exerciseName: stableId },
              });
            }}
          />
        )}
        <div className="grid grid-cols-2 gap-3">
          {/* 当前值现算的（频率、绑了动作的力量、已有体重记录的体重）不用填，填了也会被现算值盖掉 */}
          {!currentHidden(newGoal.type, newGoal.autoUpdateRule, hasWeightLog) && (
          <ScrubNumber
            value={newGoal.currentValue ? Number(newGoal.currentValue) : null}
            onCommit={n => setNewGoal({ ...newGoal, currentValue: n ?? 0 })}
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
            value={newGoal.targetValue ? Number(newGoal.targetValue) : null}
            onCommit={n => setNewGoal({ ...newGoal, targetValue: n ?? 0 })}
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
      </div>
    </Modal>
  );
};
