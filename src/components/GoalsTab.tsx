import React from 'react';
import { Plus, Edit2, Trash2 } from 'lucide-react';
import { Goal, Language, type WeightEntry, type WorkoutSession } from '../../types';
import { translations } from '../../translations';
import { useGoalsContext, useUserSettingsContext } from '../contexts';
import { useDoneWorkouts, useLiftSummaries } from '../hooks/useLiftSummaries';
import { bestAsOf, latestGymView, type LiftSummary } from '../utils/liftHistory';
import { goalProgress, weightAtStart, workoutsThisWeek } from '../utils/goalProgress';
import { trimNum } from '../utils/liftDisplay';
import { KG_TO_LBS } from '../constants';

const TYPE_LABEL: Partial<Record<Goal['type'], keyof typeof translations>> = {
  weight: 'goalWeight',
  strength: 'goalStrength',
  frequency: 'goalFrequency',
};

/**
 * 卡上显示的当前值和起点（审查 D7）：力量目标绑了动作就取那个动作的最重一组、频率目标数本周练了几场，
 * 都从训练记录现算、不落库；体重的当前值由记体重时写回（useWeightLog），起点取建目标那一刻的体重。
 */
function progressOf(
  g: Goal,
  lifts: LiftSummary[],
  workouts: WorkoutSession[],
  weightEntries: WeightEntry[],
): { current: number; start: number | null } {
  if (g.type === 'frequency') return { current: workoutsThisWeek(workouts), start: 0 };
  if (g.type === 'weight') return { current: g.currentValue, start: weightAtStart(weightEntries, g.startDate, g.unit) };
  // exerciseName 存的是动作的稳定键（LiftSummary.stableId）：改名、切语言都找得到
  const liftId = g.type === 'strength' ? g.autoUpdateRule?.exerciseName : undefined;
  const whole = liftId ? lifts.find(l => l.stableId === liftId) : undefined;
  if (!whole) return { current: g.currentValue, start: 0 };
  // 按馆比的器械看最近练的那个馆（跨馆的重量不可比）
  const lift = latestGymView(whole);
  const inUnit = (kg: number) => (g.unit === 'lbs' ? kg * KG_TO_LBS : kg);
  return {
    current: inUnit(lift.best.weight?.value ?? 0),
    start: inUnit(bestAsOf(lift, 'weight', new Date(g.startDate).getTime()) ?? 0),
  };
}

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
          const { current, start } = progressOf(g, lifts, workouts, weightEntries);
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
                {trimNum(current)} / {g.targetValue}
              </span>
              <span className="text-tertiary text-xs">{g.unit}</span>
            </div>

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
