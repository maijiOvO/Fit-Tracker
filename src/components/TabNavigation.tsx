/**
 * 底部导航栏组件
 * 替换 App.tsx 中的内联导航代码
 */
import React from 'react';
import { BarChart2, Target, User as UserIcon, Plus } from 'lucide-react';
import { translations } from '../../translations';
import { Language } from '../../types';

type TabType = 'dashboard' | 'new' | 'goals' | 'profile';

interface TabNavigationProps {
  activeTab: TabType;
  onTabChange: (tab: TabType) => void;
  lang: Language;
  onStartWorkout?: () => void; // 开始训练按钮的回调
}

const TabNavigation: React.FC<TabNavigationProps> = ({
  activeTab,
  onTabChange,
  lang,
  onStartWorkout,
}) => {
  const handleStartClick = () => {
    if (onStartWorkout) {
      onStartWorkout();
    } else {
      onTabChange('new');
    }
  };

  return (
    <nav className="fixed bottom-6 left-1/2 -translate-x-1/2 w-[90%] max-w-md bg-slate-950/90 backdrop-blur-3xl border border-white/10 p-2 flex justify-between items-center rounded-[2.5rem] z-50 shadow-2xl">
      
      {/* 1. 开始训练 - 带蓝色圆圈 */}
      <button 
        onClick={handleStartClick}
        className="flex-1 flex flex-col items-center gap-1.5 py-2 rounded-3xl transition-all hover:bg-white/5 active:scale-95"
      >
        <div className={`rounded-full p-2.5 shadow-lg shadow-blue-600/30 transition-all ${activeTab === 'new' ? 'bg-blue-500 text-white' : 'bg-blue-600 text-white'}`}>
          <Plus size={20} strokeWidth={3} />
        </div>
        <span className={`text-[9px] font-black uppercase tracking-wide ${activeTab === 'new' ? 'text-blue-500' : 'text-slate-500'}`}>
          {lang === Language.CN ? '开始' : 'Start'}
        </span>
      </button>

      {/* 2. Dashboard */}
      <button 
        onClick={() => onTabChange('dashboard')} 
        className={`flex-1 flex flex-col items-center gap-1.5 py-2 rounded-3xl transition-all ${activeTab === 'dashboard' ? 'text-blue-500' : 'text-slate-600 hover:text-slate-400'}`}
      >
        <div className="p-2.5">
          <BarChart2 size={20} strokeWidth={2.5} />
        </div>
        <span className="text-[9px] font-black uppercase tracking-wide">{translations.dashboard[lang]}</span>
      </button>

      {/* 3. Goals */}
      <button 
        onClick={() => onTabChange('goals')} 
        className={`flex-1 flex flex-col items-center gap-1.5 py-2 rounded-3xl transition-all ${activeTab === 'goals' ? 'text-blue-500' : 'text-slate-600 hover:text-slate-400'}`}
      >
        <div className="p-2.5">
          <Target size={20} strokeWidth={2.5} />
        </div>
        <span className="text-[9px] font-black uppercase tracking-wide">{translations.goals[lang]}</span>
      </button>

      {/* 4. Profile */}
      <button 
        onClick={() => onTabChange('profile')} 
        className={`flex-1 flex flex-col items-center gap-1.5 py-2 rounded-3xl transition-all ${activeTab === 'profile' ? 'text-blue-500' : 'text-slate-600 hover:text-slate-400'}`}
      >
        <div className="p-2.5">
          <UserIcon size={20} strokeWidth={2.5} />
        </div>
        <span className="text-[9px] font-black uppercase tracking-wide">
          {lang === Language.CN ? '我的' : 'Profile'}
        </span>
      </button>

    </nav>
  );
};

export default TabNavigation;
