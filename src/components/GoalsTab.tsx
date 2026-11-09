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

  const addButton = (
    <button
      onClick={onAddGoal}
      className="flex-shrink-0 min-h-[44px] px-3 inline-flex items-center gap-1.5 bg-btn text-primary border border-divider rounded-control text-small font-semibold active:scale-press-sm [&>svg]:text-accent"
    >
      <Plus size={16} strokeWidth={2} />
      {translations.setGoal[lang]}
    </button>
  );

  return (
    <div className="space-y-5 anim-tab-enter">
      {/* 标题不写：上面的子页标签已经是「训练目标」。添加用次要样式，实色 ＋ 只留给右下角开练 */}
      <div className="flex justify-between items-center gap-3">
        <p className="text-secondary text-small">{translations.goalsSubtitle[lang]}</p>
        {goals.length > 0 && addButton}
      </div>

      {goals.length === 0 && (
        <div className="ui-card p-8 flex flex-col items-center gap-4 text-small text-secondary" data-testid="goals-empty">
          {lang === Language.CN ? '还没有目标' : 'No goals yet'}
          {addButton}
        </div>
      )}

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
