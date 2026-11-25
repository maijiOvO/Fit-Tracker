import React from 'react';
import { useDoneWorkouts, useLiftSummaries } from '../hooks/useLiftSummaries';
import { useExercisePrefs } from '../contexts/ExercisePrefsContext';

/**
 * 力量目标绑哪个动作：练过、记重量的，最近练的在前。只在选了力量目标时挂上，平时不算历史。
 * 新建和编辑目标共用：绑的动作并入别处 / 找不到了，在编辑里重选（审查 C30）。
 * picked 是存下的旧键，先规范化再和每组出现过的全部键比，旧键也能亮起来。
 */
export function LiftPicker({ isCn, picked, onPick }: { isCn: boolean; picked: string | undefined; onPick: (stableId: string, key: string) => void }) {
  const { workouts } = useDoneWorkouts();
  const lifts = useLiftSummaries(workouts);
  const { canonicalLiftId } = useExercisePrefs();
  const list = lifts.filter(l => l.hasWeight).sort((a, b) => b.lastTs - a.lastTs);
  if (!list.length) return null;
  const want = picked ? canonicalLiftId(picked) : undefined;
  return (
    <div>
      <div className="text-label text-tertiary mb-1.5">{isCn ? '哪个动作' : 'Exercise'}</div>
      <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto custom-scrollbar">
        {list.map(l => {
          const on = !!want && (l.ids.includes(want) || l.ids.includes(picked!));
          return (
            <button
              key={l.stableId}
              type="button"
              onClick={() => onPick(l.stableId, l.key)}
              aria-pressed={on}
              className={`px-2.5 py-1 rounded-chip text-xs font-medium ${on ? 'bg-accent-soft text-accent' : 'bg-inset text-secondary'}`}
            >
              {l.key}
            </button>
          );
        })}
      </div>
    </div>
  );
}
