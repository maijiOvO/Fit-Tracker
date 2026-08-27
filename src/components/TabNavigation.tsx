/**
 * 底部导航栏 — 贴底通栏 + 左侧凸起 FAB
 */
import React from 'react';
import { BarChart2, CalendarDays, User as UserIcon, Plus } from 'lucide-react';
import { translations } from '../../translations';
import { Language } from '../../types';

type TabType = 'dashboard' | 'new' | 'plan' | 'profile';

interface TabNavigationProps {
  activeTab: TabType;
  onTabChange: (tab: TabType) => void;
  lang: Language;
  onStartWorkout?: () => void;
}

const TabNavigation: React.FC<TabNavigationProps> = ({
  activeTab,
  onTabChange,
  lang,
  onStartWorkout,
}) => {
  const handleStartClick = () => {
    if (onStartWorkout) onStartWorkout();
    else onTabChange('new');
  };

  const tabBtn = (active: boolean) =>
    `flex flex-col items-center justify-center gap-1 transition-colors ${
      active ? 'text-accent' : 'text-tertiary hover:text-secondary'
    }`;

  return (
    <nav
      className="fixed bottom-0 inset-x-0 z-50 bg-base/95 backdrop-blur-xl border-t border-divider"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="relative h-16 max-w-2xl mx-auto grid grid-cols-5">
        <div aria-hidden />

        <button onClick={() => onTabChange('dashboard')} className={tabBtn(activeTab === 'dashboard')}>
          <BarChart2 size={20} strokeWidth={1.75} />
          <span className="text-[10px] font-medium">{translations.dashboard[lang]}</span>
        </button>

        <button
          onClick={() => onTabChange('plan')}
          className={tabBtn(activeTab === 'plan')}
          data-testid="tab-plan"
        >
          <CalendarDays size={20} strokeWidth={1.75} />
          <span className="text-[10px] font-medium">{translations.trainingPlan[lang]}</span>
        </button>

        <button onClick={() => onTabChange('profile')} className={tabBtn(activeTab === 'profile')}>
          <UserIcon size={20} strokeWidth={1.75} />
          <span className="text-[10px] font-medium">{lang === Language.CN ? '我的' : 'Profile'}</span>
        </button>

        <button
          onClick={handleStartClick}
          aria-label={lang === Language.CN ? '开始训练' : 'Start Workout'}
          className={`absolute left-[10%] -translate-x-1/2 -top-5 w-14 h-14 rounded-full text-white bg-accent shadow-elevated ring-4 ring-base flex items-center justify-center active:scale-95 transition-transform ${
            activeTab === 'new' ? 'opacity-90' : ''
          }`}
        >
          <Plus size={24} strokeWidth={2.5} />
        </button>
      </div>
    </nav>
  );
};

export default TabNavigation;
