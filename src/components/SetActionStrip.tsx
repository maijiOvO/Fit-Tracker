/**
 * 选中组操作条：−/+ 一档、次数 ±1、递减（带正负的动作多一颗辅助 ⇄ 负重），固定在底栏「添加动作」上方（2026-10-27 用户定）。
 * 没手动选中时改的是指针下面那一条待做组（组号不实心，小字写明第几组）。
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
import { markTouched, shownWeight, weightFromShown } from '../utils/setWrite';
import { haptic, H } from '../utils/haptics';
import { bumpShown, nextDropShown, stepShown } from '../utils/setStep';
import { carrySign } from '../utils/workbench';

interface Props {
  exercise: Exercise;
  set: SetLog;
  /** 行上显示的组号（交替组里按动作各数各的，口径同组行） */
  setNo: number;
  /** 当前语言的动作名 */
  name: string;
  activeMetrics: string[];
  /** 顶栏的显示单位；有取整器时按 rounder.display（器械有自己的单位就按它，口径同组行） */
  unit: string;
  lang: Language;
  /** 带正负的负荷：辅助为负、自重 0、负重为正，± 可以跨过 0 */
  signed: boolean;
  rounder: ExRounder | null;
  onUpdate: (updates: Partial<SetLog>) => void;
}

type Signable = { weight: number; bodyweightMode?: SetLog['bodyweightMode'] };

export const SetActionStrip: React.FC<Props> = ({ exercise, set, setNo, name, activeMetrics, unit: shownUnit, lang, signed, rounder, onUpdate }) => {
  const isCn = lang === Language.CN;
  const unit = rounder ? rounder.display : shownUnit;
  const { weightStep, dropStep } = useContext(UserSettingsContext)?.appPrefs ?? appPrefsNow();
  const hasWeight = activeMetrics.includes('weight');
  const hasReps = activeMetrics.includes('reps');
  if (!hasWeight && !hasReps) return null;

  // 号按组算（组上没写：重量是 0 沿用上一组，其余按动作实例），显示绝对值；运算在带符号的数上做 —— 口径同 SetCapsule.signOf
  const signOf = (x: Signable, parent?: Signable): -1 | 1 => {
    if (!signed) return 1;
    if (x.bodyweightMode === 'assisted') return -1;
    if (x.bodyweightMode === 'weighted') return 1;
    return parent ? signOf(parent) : carrySign(exercise, x as SetLog);
  };
  // 显示 ⇄ 存储、待做行记 touched：和组行同一份（utils/setWrite）
  const toDisplay = (kg: number, sign: -1 | 1) => shownWeight(kg, sign, unit);
  const fromDisplay = (raw: number) => weightFromShown(raw, unit, rounder, signed);
  const update = (updates: Partial<SetLog>) => onUpdate(markTouched(set, updates));

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
  /**
   * 辅助 ⇄ 负重（审查 C6）：绝对值不动，后面同号、没改过的待做组一起换（workbench.followFlip）。
   * 重量是 0 时没有号可显示，点它定下接下来打的数记成哪一边。
   */
  const flip = () => {
    haptic(H.tap);
    update({ bodyweightMode: rowSign < 0 ? 'weighted' : 'assisted' });
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
        {hasWeight && signed && (
          <button
            type="button"
            className="ledger-step-drop"
            onClick={flip}
            aria-label={isCn ? (rowSign < 0 ? '改成负重' : '改成辅助') : rowSign < 0 ? 'Switch to weighted' : 'Switch to assisted'}
            data-testid="flip-sign"
          >
            {rowSign < 0 ? (isCn ? '⇄ 负重' : '⇄ Wtd') : isCn ? '⇄ 辅助' : '⇄ Asst'}
          </button>
        )}
      </div>
    </div>
  );
};
