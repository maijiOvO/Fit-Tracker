/**
 * 训练计划 Tab —— 顶部 segmented control 在「日程」与「目标」之间切换
 */
import React, { useEffect, useState } from 'react';
import { Calendar, Target } from 'lucide-react';
import { Goal, Language } from '../../types';
import { translations } from '../../translations';
import GoalsTab from './GoalsTab';
import ScheduleView from './ScheduleView';
import type { PlanPickerHost } from './ScheduleEditorModal';
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
  /** 计划编辑器选动作弹层用的 App 层弹窗 */
  planPickerHost: PlanPickerHost;
}

const PlanTab: React.FC<PlanTabProps> = ({
  lang,
  unit,
  onAddGoal,
  onEditGoal,
  customTags,
  onStartScheduledSession,
  planPickerHost,
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
    <div className="space-y-5 anim-tab-enter">
      {/* 不再有页面大标题：顶栏是整个 App 的刊名，首页 / 我的都没有页标题，只有这里多一个「训练计划」，
          和顶栏叠成两个标题（2026-10-22 界面审查）。底部导航已经标着当前页。
          日程 / 目标和首页「按时间 / 按动作」是同一种页内视图切换，做成同样的下划线标签。 */}
      <div
        role="tablist"
        aria-label={translations.scheduleViewSwitch[lang]}
        className="flex items-stretch border-b border-divider"
      >
        <button
          role="tab"
          aria-selected={subView === 'schedule'}
          onClick={() => setSubView('schedule')}
          data-testid="plan-subview-schedule"
          className={`flex-1 min-h-[44px] -mb-px flex items-center justify-center gap-2 border-b-2 text-small font-bold transition-ui ${
            subView === 'schedule'
              ? 'border-[color:var(--accent-text)] text-primary [&>svg]:text-accent'
              : 'border-transparent text-tertiary hover:text-primary'
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
          className={`flex-1 min-h-[44px] -mb-px flex items-center justify-center gap-2 border-b-2 text-small font-bold transition-ui ${
            subView === 'goals'
              ? 'border-[color:var(--accent-text)] text-primary [&>svg]:text-accent'
              : 'border-transparent text-tertiary hover:text-primary'
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
          pickerHost={planPickerHost}
        />
      ) : (
        <GoalsTab lang={lang} onAddGoal={onAddGoal} onEditGoal={onEditGoal} />
      )}
    </div>
  );
};

export default PlanTab;
