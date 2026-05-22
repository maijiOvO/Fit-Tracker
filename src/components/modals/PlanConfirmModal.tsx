/**
 * 训练计划保存训练时的「按计划 / 有调整 / 取消」确认弹窗
 */
import React from 'react';
import { Language } from '../../../types';
import { translations } from '../../../translations';

interface PlanConfirmModalProps {
  open: boolean;
  lang: Language;
  onFaithful: () => void;
  onModified: () => void;
  onCancel: () => void;
}

export const PlanConfirmModal: React.FC<PlanConfirmModalProps> = ({
  open,
  lang,
  onFaithful,
  onModified,
  onCancel,
}) => {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[80] bg-base/80 backdrop-blur-md flex items-center justify-center p-6 animate-fade-in">
      <div className="bg-card border border-divider w-full max-w-sm rounded-card p-6 space-y-4 shadow-elevated">
        <div>
          <h2 className="font-display text-lg font-semibold text-primary">
            {translations.planConfirmTitle[lang]}
          </h2>
          <p className="text-xs text-secondary mt-1">
            {translations.planConfirmSubtitle[lang]}
          </p>
        </div>
        <div className="space-y-2">
          <button
            data-testid="plan-confirm-faithful"
            onClick={onFaithful}
            className="w-full py-3 rounded-control bg-accent text-white text-sm font-medium hover:opacity-90 active:scale-95 transition"
          >
            {translations.planFaithful[lang]}
          </button>
          <button
            data-testid="plan-confirm-modified"
            onClick={onModified}
            className="w-full py-3 rounded-control border border-divider text-primary text-sm font-medium hover:bg-card-hover active:scale-95 transition"
          >
            {translations.planModified[lang]}
          </button>
          <button
            data-testid="plan-confirm-cancel"
            onClick={onCancel}
            className="w-full py-3 rounded-control text-tertiary text-sm hover:text-primary transition"
          >
            {translations.planNotDone[lang]}
          </button>
        </div>
      </div>
    </div>
  );
};

// silence unused Language import for IDEs that don't tree-shake
void Language;

export default PlanConfirmModal;
