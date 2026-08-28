import React from 'react';
import { Plus, Edit2, Trash2 } from 'lucide-react';
import { Goal, Language } from '../../types';
import { translations } from '../../translations';
import { useGoalsContext } from '../contexts';

interface GoalsTabProps {
  lang: Language;
  onAddGoal: () => void;
  onEditGoal: (goal: Goal) => void;
}

export const GoalsTab: React.FC<GoalsTabProps> = ({ lang, onAddGoal, onEditGoal }) => {
  const { goals, deleteGoal } = useGoalsContext();

  const handleDeleteGoal = async (goalId: string) => {
    await deleteGoal(goalId);
  };

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="font-display text-display-sm text-primary">{translations.goals[lang]}</h2>
          <p className="text-secondary text-sm mt-1">{translations.goalsSubtitle[lang]}</p>
        </div>
        <button
          onClick={onAddGoal}
          className="p-3 bg-accent text-on-accent rounded-control hover:opacity-90 transition-opacity active:scale-press-sm"
        >
          <Plus size={22} strokeWidth={1.75} />
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {goals.map(g => (
          <div key={g.id} className="ui-card-interactive p-6">
            <div className="flex justify-between items-start mb-4">
              <div>
                <h4 className="font-semibold text-lg text-primary">
                  {g.title || g.label || 'Untitled Goal'}
                </h4>
                <span className="text-xs text-accent font-medium">{g.type}</span>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => onEditGoal(g)}
                  className="p-2 text-tertiary hover:text-accent hover:bg-accent-soft rounded-chip transition-colors"
                >
                  <Edit2 size={16} strokeWidth={1.75} />
                </button>
                <button
                  onClick={() => handleDeleteGoal(g.id)}
                  className="p-2 text-tertiary hover:text-danger hover:bg-danger/10 rounded-chip transition-colors"
                >
                  <Trash2 size={16} strokeWidth={1.75} />
                </button>
              </div>
            </div>

            <div className="flex justify-between items-end mb-2">
              <span className="font-mono font-medium text-2xl text-primary tabular-nums">
                {g.currentValue} / {g.targetValue}
              </span>
              <span className="text-tertiary text-xs">{g.unit}</span>
            </div>

            <div className="mt-4 h-1.5 bg-inset rounded-full overflow-hidden">
              <div
                className="h-full bg-accent transition-ui duration-500 rounded-full"
                style={{
                  width: `${Math.min(100, (g.currentValue / (g.targetValue || 1)) * 100)}%`,
                }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default GoalsTab;
