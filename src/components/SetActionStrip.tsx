/**
 * 选中组操作条：−/+ 一档、次数 ±1、递减一档，固定在底栏「添加动作」上方（2026-10-27 用户定）。
 *
 * 原来这一行跟着选中的组长在卡片里：换一组它就换一个位置，每次按之前都得先找再瞄；
 * 固定之后四颗键永远在同一个坐标（拇指区），卡片布局也不再因选中换组而抖。
 * 代价是键离开了那一行，所以上面一行小字写清在改哪一组。
 *
 * 改值口径与组行完全一致：走 workbench.applySetUpdate（后面原值一样、没改过的待做组跟着变），
 * 待做行记 touched（改值只改值，不描实）；算法在 utils/setStep。
 */
import React, { useContext } from 'react';
import { Exercise, Language, SetLog, SubSetLog } from '../../types';
import { UserSettingsContext } from '../contexts/UserSettingsContext';
import { appPrefsNow } from '../../services/appPrefs';
import type { ExRounder } from '../hooks/useLoadRounder';
import { formatWeight } from './SetCapsule';
import { parseWeight } from '../utils/format';
import { getLoadMode } from '../utils/exerciseConfig';
import { haptic, H } from '../utils/haptics';
import { bumpShown, nextDropShown, stepShown } from '../utils/setStep';

interface Props {
  exercise: Exercise;
  set: SetLog;
  /** 这个动作里的第几组（交替组里按动作各数各的） */
  setNo: number;
  /** 当前语言的动作名 */
  name: string;
  activeMetrics: string[];
  unit: string;
  lang: Language;
  /** 带正负的负荷：辅助为负、自重 0、负重为正，± 可以跨过 0 */
  signed: boolean;
  rounder: ExRounder | null;
  onUpdate: (updates: Partial<SetLog>) => void;
}

type Signable = { weight: number; bodyweightMode?: SetLog['bodyweightMode'] };

export const SetActionStrip: React.FC<Props> = ({ exercise, set, setNo, name, activeMetrics, unit, lang, signed, rounder, onUpdate }) => {
  const isCn = lang === Language.CN;
  const { weightStep, dropStep } = useContext(UserSettingsContext)?.appPrefs ?? appPrefsNow();
  const hasWeight = activeMetrics.includes('weight');
  const hasReps = activeMetrics.includes('reps');
  if (!hasWeight && !hasReps) return null;

  // 号按组算（组上没写按动作实例），显示绝对值；运算在带符号的数上做 —— 口径同 SetCapsule.signOf
  const signOf = (x: Signable, parent?: Signable): -1 | 1 => {
    if (!signed) return 1;
    if (x.bodyweightMode === 'assisted') return -1;
    if (x.bodyweightMode === 'weighted') return 1;
    return parent ? signOf(parent) : getLoadMode(exercise) === 'assisted' ? -1 : 1;
  };
  const toDisplay = (kg: number, sign: -1 | 1) => sign * Number(formatWeight(Number(kg) || 0, unit));
  // 改重量就记下这一组挂的是哪种片：有馆档案按这个馆的片子，纯数字的动作按显示单位 —— 口径同 SetCapsule.fromDisplay
  const plateUnit: SetLog['plateUnit'] = rounder ? rounder.unit : unit === 'lbs' ? 'lbs' : 'kg';
  const fromDisplay = (v: number): Pick<SetLog, 'weight' | 'plateUnit'> & { bodyweightMode?: SetLog['bodyweightMode'] } => {
    const kg = rounder ? Math.abs(rounder.kgOfD(v)) : parseWeight(Math.abs(v), unit === 'lbs' ? 'lbs' : 'kg');
    if (!signed) return { weight: kg, plateUnit };
    return { weight: kg, plateUnit, bodyweightMode: v < 0 ? 'assisted' : v > 0 ? 'weighted' : 'normal' };
  };
  /** 待做行上改了值就记 touched（格子变实墨，结束时提醒），不描实 */
  const update = (updates: Partial<SetLog>) => {
    if (!set.ghost) {
      onUpdate(updates);
      return;
    }
    const touched = { ...(set.touched || {}) };
    for (const k of ['weight', 'reps', 'subSets'] as const) if (k in updates) touched[k] = true;
    onUpdate({ ...updates, touched });
  };

  const rowSign = signOf(set);
  const shown = toDisplay(set.weight, rowSign);
  const stepDown = stepShown(shown, -1, rounder, weightStep);
  const stepUp = stepShown(shown, 1, rounder, weightStep);
  const bump = (dir: 1 | -1) => {
    haptic(H.tap);
    update(fromDisplay(bumpShown(shown, dir, rounder, weightStep, signed)));
  };
  const bumpReps = (dir: 1 | -1) => {
    haptic(H.tap);
    const cur = Number(set.reps) || 0;
    const next = Math.max(0, cur + dir);
    if (next !== cur) update({ reps: next });
  };
  /** 加一档递减：从上一行（最后一档，没有就是母组）走一档；次数跟上一行 */
  const addDrop = () => {
    haptic(H.tap);
    const subSets: SubSetLog[] = set.subSets || [];
    const prev = subSets.length > 0 ? subSets[subSets.length - 1] : set;
    const prevSign = subSets.length > 0 ? signOf(prev, set) : rowSign;
    const prevShown = toDisplay(prev.weight, prevSign);
    const next = nextDropShown(prevShown, -1, rounder, dropStep, signed);
    const sub: SubSetLog = {
      id: `sub_${Date.now()}`,
      ...(prevShown !== 0 || signed ? fromDisplay(next) : { weight: 0 }),
      reps: Number(prev.reps) || 0,
    };
    update({ subSets: [...subSets, sub] });
  };

  return (
    <div className="set-strip max-w-2xl mx-auto" data-testid="weight-step">
      <div className="text-micro text-tertiary truncate tabular-nums px-0.5 pb-0.5" data-testid="weight-step-target">
        {name} · {isCn ? `第 ${setNo} 组` : `Set ${setNo}`}
      </div>
      <div className="ledger-step">
        {hasWeight && (
          <>
            <button type="button" onClick={() => bump(-1)} aria-label={isCn ? `重量减 ${stepDown} ${unit}` : `Weight −${stepDown} ${unit}`}>
              −{stepDown} <span className="ledger-unit">{unit}</span>
            </button>
            <button type="button" onClick={() => bump(1)} aria-label={isCn ? `重量加 ${stepUp} ${unit}` : `Weight +${stepUp} ${unit}`}>
              +{stepUp} <span className="ledger-unit">{unit}</span>
            </button>
          </>
        )}
        {hasReps && (
          <>
            <button type="button" onClick={() => bumpReps(-1)} aria-label={isCn ? '次数减 1' : 'Reps −1'} data-testid="reps-dec">
              −1 <span className="ledger-unit">{isCn ? '次' : 'rep'}</span>
            </button>
            <button type="button" onClick={() => bumpReps(1)} aria-label={isCn ? '次数加 1' : 'Reps +1'} data-testid="reps-inc">
              +1 <span className="ledger-unit">{isCn ? '次' : 'rep'}</span>
            </button>
          </>
        )}
        {hasWeight && (
          <button type="button" className="ledger-step-drop" onClick={addDrop} aria-label={isCn ? '加一档递减' : 'Add a drop set'} data-testid="add-drop-set">
            {isCn ? '递减' : 'Drop'}
          </button>
        )}
      </div>
    </div>
  );
};
