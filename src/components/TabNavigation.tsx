/**
 * 底部导航栏组件
 */
import React from 'react';
import { Dumbbell, BarChart2, Target, User as UserIcon, Plus } from 'lucide-react';
import { translations } from '../translations';
import { Language } from '../types';

type TabType = 'dashboard' | 'new' | 'goals' | 'profile';

interface TabNavigationProps {
  activeTab: TabType;
  onTabChange: (tab: TabType) => void;
  lang: Language;
}

const tabs: { id: TabType; icon: React.ElementType; labelKey: keyof typeof translations.dashboard; activeLabelKey?: keyof typeof translations.dashboard }[] = [
  { id: 'dashboard', icon: BarChart2, labelKey: 'dashboard' },
  { id: 'new', icon: Plus, labelKey: 'dashboard', activeLabelKey: 'newWorkout' },
  { id: 'goals', icon: Target, labelKey: 'goals' },
  { id: 'profile', icon: UserIcon, labelKey: 'profile' },
];

export const TabNavigation: React.FC<TabNavigationProps> = ({
  activeTab,
  onTabChange,
  lang,
}) => {
  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-slate-900/95 backdrop-blur-xl border-t border-slate-800 safe-area-pb z-40">
      <div className="flex items-center justify-around py-2">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          const label = tab.id === 'new' 
            ? translations.newWorkout[lang]
            : (translations as any)[tab.labelKey]?.[lang] || tab.labelKey;

          return (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className={`
                flex flex-col items-center justify-center px-6 py-2 rounded-2xl transition-all
                ${isActive 
                  ? 'text-blue-500' 
                  : 'text-slate-500 hover:text-slate-300'
                }
              `}
            >
              <div className={`
                p-2 rounded-xl transition-all
                ${isActive 
                  ? 'bg-blue-500/20' 
                  : ''
                }
              `}>
                <Icon size={22} strokeWidth={isActive ? 2.5 : 2} />
              </div>
              <span className={`
                text-[10px] font-black mt-1 uppercase tracking-wider
                ${isActive ? 'text-blue-500' : ''}
              `}>
                {label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};

export default TabNavigation;
