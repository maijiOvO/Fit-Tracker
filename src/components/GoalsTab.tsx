import React from 'react';
import { Plus, Edit2, Trash2 } from 'lucide-react';
import { Goal, Language } from '../../types';
import { translations } from '../../translations';
import { db } from '../../services/db';

interface GoalsTabProps {
  goals: Goal[];
  setGoals: React.Dispatch<React.SetStateAction<Goal[]>>;
  lang: Language;
  onAddGoal: () => void;
  onEditGoal: (goal: Goal) => void;
}

export const GoalsTab: React.FC<GoalsTabProps> = ({
  goals,
  setGoals,
  lang,
  onAddGoal,
  onEditGoal,
}) => {
  const handleDeleteGoal = async (goalId: string) => {
    await db.delete('goals', goalId);
    setGoals(prev => prev.filter(g => g.id !== goalId));
  };

  return (
    <div className="space-y-6 animate-in slide-in-from-right">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-3xl font-black">{translations.goals[lang]}</h2>
          <p className="text-slate-500">{translations.goalsSubtitle[lang]}</p>
        </div>
        <button 
          onClick={onAddGoal} 
          className="p-4 bg-blue-600 rounded-2xl hover:bg-blue-500 transition-colors"
        >
          <Plus size={24} />
        </button>
      </div>

      {/* Goals Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {goals.map(g => (
          <div 
            key={g.id} 
            className="bg-slate-800/40 p-8 rounded-[2.5rem] border border-slate-700/50 hover:bg-slate-800/60 transition-colors"
          >
            {/* Header */}
            <div className="flex justify-between items-start mb-4">
              <div>
                <h4 className="font-black text-xl">{g.title || g.label || 'Untitled Goal'}</h4>
                <span className="text-[10px] text-blue-500 uppercase">{g.type}</span>
              </div>
              <div className="flex items-center gap-2">
                {/* Edit Button */}
                <button 
                  onClick={() => onEditGoal(g)}
                  className="p-2 text-slate-600 hover:text-blue-400 hover:bg-blue-400/10 rounded-lg transition-all"
                  title={lang === Language.CN ? '编辑目标' : 'Edit Goal'}
                >
                  <Edit2 size={16} />
                </button>
                {/* Delete Button */}
                <button 
                  onClick={() => handleDeleteGoal(g.id)}
                  className="p-2 text-slate-700 hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-all"
                  title={lang === Language.CN ? '删除目标' : 'Delete Goal'}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>

            {/* Progress */}
            <div className="flex justify-between items-end mb-2">
              <span className="text-2xl font-black">{g.currentValue} / {g.targetValue}</span>
              <span className="text-slate-500 text-xs">{g.unit}</span>
            </div>
            <div className="h-2 bg-slate-900 rounded-full overflow-hidden">
              <div 
                className="h-full bg-blue-600 transition-all duration-500" 
                style={{ width: `${Math.min(100, (g.currentValue / g.targetValue) * 100)}%` }}
              />
            </div>

            {/* Status Indicator */}
            {!g.isActive && (
              <div className="mt-3 flex items-center gap-2">
                <div className="w-2 h-2 bg-slate-600 rounded-full" />
                <span className="text-xs text-slate-500 font-bold">
                  {lang === Language.CN ? '已暂停' : 'Paused'}
                </span>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export default GoalsTab;
