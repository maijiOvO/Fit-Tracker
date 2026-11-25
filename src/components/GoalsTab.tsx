import React from 'react';
import { Plus, Edit2, Trash2 } from 'lucide-react';
import { Goal, Language } from '../../types';
import { translations } from '../../translations';
import { useGoalsContext, useUserSettingsContext } from '../contexts';
import { useExercisePrefs } from '../contexts/ExercisePrefsContext';
import { useDoneWorkouts, useLiftSummaries } from '../hooks/useLiftSummaries';
import { goalProgress, progressOf } from '../utils/goalProgress';
import { trimNum } from '../utils/liftDisplay';

const TYPE_LABEL: Partial<Record<Goal['type'], keyof typeof translations>> = {
  weight: 'goalWeight',
  strength: 'goalStrength',
  frequency: 'goalFrequency',
};

interface GoalsTabProps {
  lang: Language;
  onAddGoal: () => void;
  onEditGoal: (goal: Goal) => void;
}

export const GoalsTab: React.FC<GoalsTabProps> = ({ lang, onAddGoal, onEditGoal }) => {
  const { goals, deleteGoal } = useGoalsContext();
  const { weightEntries } = useUserSettingsContext();
  const { workouts } = useDoneWorkouts();
  const lifts = useLiftSummaries(workouts);
  const { canonicalLiftId } = useExercisePrefs();
  const isCn = lang === Language.CN;

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
      <div className="flex justify-end items-center gap-3">
        {goals.length > 0 && addButton}
      </div>

      {goals.length === 0 && (
        <div className="ui-card p-8 flex flex-col items-center gap-4 text-small text-secondary" data-testid="goals-empty">
          {lang === Language.CN ? '还没有目标' : 'No goals yet'}
          {addButton}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {goals.map(g => {
          const { current, start, missing } = progressOf(g, lifts, workouts, weightEntries, canonicalLiftId);
          const progress = goalProgress(current, start, g.targetValue);
          const typeKey = TYPE_LABEL[g.type];
          return (
          <div key={g.id} className="ui-card-interactive p-6">
            <div className="flex justify-between items-start mb-4">
              <div>
                <h4 className="font-semibold text-lg text-primary">
                  {g.title || g.label || (isCn ? '未命名目标' : 'Untitled goal')}
                </h4>
                {typeKey && <span className="text-xs text-accent font-medium">{translations[typeKey][lang]}</span>}
              </div>
              {/* 热区补到 44、两颗隔 12px 不互相盖住（审查 D13）；删错了用顶栏全局撤销 */}
              <div className="flex items-center gap-3">
                <button
                  onClick={() => onEditGoal(g)}
                  className="tap-44 p-2 text-tertiary hover:text-accent hover:bg-accent-soft rounded-chip transition-colors"
                  aria-label={isCn ? '编辑' : 'Edit'}
                >
                  <Edit2 size={16} strokeWidth={1.75} />
                </button>
                <button
                  onClick={() => handleDeleteGoal(g.id)}
                  aria-label={isCn ? '删除' : 'Delete'}
                  className="tap-44 p-2 text-tertiary hover:text-danger hover:bg-danger/10 rounded-chip transition-colors"
                >
                  <Trash2 size={16} strokeWidth={1.75} />
                </button>
              </div>
            </div>

            <div className="flex justify-between items-end mb-2">
              <span className="font-mono font-medium text-2xl text-primary tabular-nums">
                {missing ? '—' : trimNum(current)} / {g.targetValue}
              </span>
              <span className="text-tertiary text-xs">{g.unit}</span>
            </div>
            {/* 绑的动作找不到了：明说，点编辑重选（原来静默显示 0 / 目标，再练也不动） */}
            {missing && (
              <p className="text-small text-secondary" data-testid="goal-lift-missing">
                {isCn ? '动作不在了，点编辑重新选一个' : 'Exercise not found — edit to pick another'}
              </p>
            )}

            {/* 进度按「起点 → 目标」算：减重（80 → 75）刚建是 0，不是一建就满 */}
            {progress != null && (
              <div className="mt-4 h-1.5 bg-inset rounded-full overflow-hidden">
                <div
                  className="h-full bg-accent transition-ui duration-500 rounded-full"
                  style={{ width: `${progress * 100}%` }}
                />
              </div>
            )}
          </div>
          );
        })}
      </div>
    </div>
  );
};

export default GoalsTab;
