import React from 'react';
import { Goal, Language } from '../../../types';
import { translations } from '../../../translations';
import { Modal, ModalFooter } from '../Modal';
import { ScrubNumber } from '../ScrubNumber';
import { LiftPicker } from '../LiftPicker';

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
          // 没填目标值时按钮灰着（原来能点、点了没反应）
          confirmDisabled={!newGoal.label?.trim() || !newGoal.targetValue}
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
          placeholder={translations.goalLabelPlaceholder[lang]}
        />
        {newGoal.type === 'strength' && (
          <LiftPicker
            isCn={isCn}
            picked={newGoal.autoUpdateRule?.exerciseName}
            onPick={(stableId, key) =>
              setNewGoal({
                ...newGoal,
                label: newGoal.label?.trim() ? newGoal.label : key,
                autoUpdateRule: { sourceType: 'workouts', calculation: 'max', exerciseName: stableId },
              })
            }
          />
        )}
        <div className="grid grid-cols-2 gap-3">
          {/* 绑了动作的力量目标、频率目标：当前值从训练记录算，不用填 */}
          {!(newGoal.type === 'frequency' || newGoal.autoUpdateRule) && (
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
            className="ui-input"
          />
        </div>
      </div>
    </Modal>
  );
};
