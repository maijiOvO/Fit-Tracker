/**
 * 训练计划 Tab —— 顶部 segmented control 在「日程」与「目标」之间切换
 */
import React, { useEffect, useState } from 'react';
import { Calendar, Target } from 'lucide-react';
import { ExerciseDefinition, Goal, Language } from '../../types';
import { translations } from '../../translations';
import GoalsTab from './GoalsTab';
import ScheduleView from './ScheduleView';
import { storage } from '../../services/appStorage';

type PlanSubView = 'schedule' | 'goals';

const STORAGE_KEY = 'fitlog_plan_subview';

interface PlanTabProps {
  lang: Language;
  unit: 'kg' | 'lbs';
  onAddGoal: () => void;
  onEditGoal: (goal: Goal) => void;
  customTags: { id: string; name: string; category: 'bodyPart' | 'equipment'; parentCategory?: string }[];
  onStartScheduledSession: (scheduleId: string) => void;
  /** 在编辑器中点击"从动作库选择"时调用，参数是收到所选动作后的回调 */
  onOpenLibraryForPicker: (onPick: (ex: ExerciseDefinition) => void) => void;
}

const PlanTab: React.FC<PlanTabProps> = ({
  lang,
  unit,
  onAddGoal,
  onEditGoal,
  customTags,
  onStartScheduledSession,
  onOpenLibraryForPicker,
}) => {
  const [subView, setSubView] = useState<PlanSubView>(() => {
    if (typeof window === 'undefined') return 'schedule';
    const v = storage.getItem(STORAGE_KEY);
    return v === 'goals' ? 'goals' : 'schedule';
  });

  useEffect(() => {
    try { storage.setItem(STORAGE_KEY, subView); } catch {}
  }, [subView]);

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-display-sm text-primary">
          {translations.trainingPlan[lang]}
        </h2>
      </div>

      <div
        role="tablist"
        aria-label={translations.scheduleViewSwitch[lang]}
        className="grid grid-cols-2 gap-1 p-1 bg-inset rounded-control border border-divider"
      >
        <button
          role="tab"
          aria-selected={subView === 'schedule'}
          onClick={() => setSubView('schedule')}
          data-testid="plan-subview-schedule"
          className={`flex items-center justify-center gap-2 py-2.5 rounded-chip text-sm font-medium transition-colors ${
            subView === 'schedule'
              ? 'bg-accent text-on-accent'
              : 'text-secondary hover:text-primary hover:bg-card-hover'
          }`}
        >
          <Calendar size={16} strokeWidth={1.75} />
          {translations.schedule[lang]}
        </button>
        <button
          role="tab"
          aria-selected={subView === 'goals'}
          onClick={() => setSubView('goals')}
          data-testid="plan-subview-goals"
          className={`flex items-center justify-center gap-2 py-2.5 rounded-chip text-sm font-medium transition-colors ${
            subView === 'goals'
              ? 'bg-accent text-on-accent'
              : 'text-secondary hover:text-primary hover:bg-card-hover'
          }`}
        >
          <Target size={16} strokeWidth={1.75} />
          {translations.goals[lang]}
        </button>
      </div>

      {subView === 'schedule' ? (
        <ScheduleView
          lang={lang}
          unit={unit}
          customTags={customTags}
          onStartScheduledSession={onStartScheduledSession}
          onOpenLibraryForPicker={onOpenLibraryForPicker}
        />
      ) : (
        <GoalsTab lang={lang} onAddGoal={onAddGoal} onEditGoal={onEditGoal} />
      )}
    </div>
  );
};

export default PlanTab;
