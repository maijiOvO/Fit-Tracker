/**
 * 训练组＝账本上的一行（规格 §6.1）
 *
 * 行不再是填充盒：去掉背景与边框，只留 border-bottom，min-height 52px。
 * 从「一堆灰色胶囊」变成账本横线，同屏噪音直接减半。
 *
 * 网格列宽由父卡片通过 --cols 下发，父行与子组行共用同一个变量，
 * 根治原先「表头 px-2、行 p-3」的 4px 错位。
 */
import React, { useState } from 'react';
import { Minus } from 'lucide-react';
import { Language, SubSetLog, SetLog } from '../../types';
import { ledgerCols, metricUnitLabel, LoadMode } from '../utils/exerciseConfig';
import { useLongPress } from '../hooks/useLongPress';
import { LongPressAffordance } from './LongPressAffordance';
import { haptic, H } from '../utils/haptics';

interface SetCapsuleProps {
  set: any;
  setIdx: number;
  activeMetrics: string[];
  /** 负重/辅助标记，影响 weight 列的单位符号（+kg / −kg）。只读历史视图可不传。 */
  loadMode?: LoadMode;
  /** 这一行是刚添加出来的 → 播「写下一组」入场（§5.3） */
  isNew?: boolean;
  unit: string;
  lang: Language;
  readOnly?: boolean;
  onUpdate: (updates: Partial<SetLog>) => void;
  onRemove: () => void;
  onDurationClick?: () => void;
}

function secondsToHMS(seconds: number): { h: number; m: number; s: number } {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return { h, m, s };
}

function formatWeight(kg: number, targetUnit: string): string {
  if (targetUnit === 'lbs') {
    return (kg * 2.20462).toFixed(2).replace(/\.?0+$/, '');
  }
  return kg.toFixed(2).replace(/\.?0+$/, '');
}

function parseWeight(displayValue: number, sourceUnit: string): number {
  if (sourceUnit === 'lbs') {
    return displayValue / 2.20462;
  }
  return displayValue;
}

export const SetCapsule: React.FC<SetCapsuleProps> = ({
  set,
  setIdx,
  activeMetrics,
  loadMode,
  isNew = false,
  unit,
  lang,
  readOnly = false,
  onUpdate,
  onRemove,
  onDurationClick,
}) => {
  const isCn = lang === Language.CN;
  // §11 坑 1：动画跑完必须摘掉入场类，否则它会盖住后续的反馈动画，
  // 且 fill:both 会把 height 钉死在 52px。
  const [entering, setEntering] = useState(isNew);
  // 显式标注：解构默认值会被本项目的宽松 tsconfig 拓宽成 string
  const mode: LoadMode = loadMode ?? 'none';
  // 自带一份列宽：ExerciseCard 会在卡片上设同样的值（表头要用），
  // 但只读历史视图没有那个父级，行必须自己兜住。
  const colStyle = { ['--cols' as string]: ledgerCols(activeMetrics.length) };
  // 单位内嵌在每个数值右下角（§6.1：10px 表头副行已删），所以标签在行内算
  const unitLabels = Object.fromEntries(
    activeMetrics.map(m => [m, metricUnitLabel(m, unit, isCn, mode)]),
  ) as Record<string, string>;
  const [expandedSubSets, setExpandedSubSets] = useState<SubSetLog[]>(set.subSets || []);
  const hasSubSets = expandedSubSets.length > 0;

  const handleSubSetUpdate = (subIdx: number, updates: Partial<SubSetLog>) => {
    const newSubSets = [...expandedSubSets];
    newSubSets[subIdx] = { ...newSubSets[subIdx], ...updates };
    setExpandedSubSets(newSubSets);
    onUpdate({ subSets: newSubSets });
  };

  const handleAddSubSet = () => {
    // 递减组的定义就是降重量再来一轮，所以默认降一档（-20%，取整到 0.5kg）。
    // 旧默认是「重量不变、次数 -5」——重量不变的话它就不是递减组了。
    // 次数保持与母组一致：递减组多半做到力竭，具体数只能现填。
    const base = set.weight || 0;
    const newSubSet: SubSetLog = {
      id: `sub_${Date.now()}`,
      weight: base > 0 ? Math.round(base * 0.8 * 2) / 2 : 0,
      reps: set.reps || 0,
    };
    const newSubSets = [...expandedSubSets, newSubSet];
    setExpandedSubSets(newSubSets);
    onUpdate({ subSets: newSubSets });
  };

  const handleRemoveSubSet = (subIdx: number) => {
    const newSubSets = expandedSubSets.filter((_, i) => i !== subIdx);
    setExpandedSubSets(newSubSets);
    onUpdate({ subSets: newSubSets });
  };

  // 长按组号＝加一条递减子组（§6.4，极低频动作）
  const addSub = useLongPress({ onLongPress: handleAddSubSet, disabled: readOnly });

  // §6.6：删除组必须长按才真删。出汗手滑场景下，只靠颜色和文案不够。
  // 400ms = 120ms 静默 + 280ms 画线。
  const removeSet = useLongPress({ onLongPress: onRemove, durationMs: 400, disabled: readOnly });

  return (
    <>
      <div
        className={`ledger-row${entering ? ' is-entering' : ''}`}
        style={colStyle}
        onAnimationEnd={e => {
          if (e.animationName === 'row-in') setEntering(false);
        }}
      >
        {/* 组号：36×36 可长按胶囊 */}
        <span
          className="relative w-9 h-9 flex items-center justify-center select-none font-mono font-semibold text-label text-accent tabular-nums touch-none"
          {...addSub.handlers}
        >
          {setIdx + 1}
          <LongPressAffordance
            active={addSub.pressing}
            hint={addSub.hinting}
            label={isCn ? '加子组' : 'Drop set'}
            hintLabel={isCn ? '按住加子组' : 'Hold for drop set'}
            drawMs={addSub.drawMs}
          />
        </span>

        {activeMetrics.map(m => {
          const unitLabel = unitLabels[m] || '';

          if (m === 'duration') {
            const hms = secondsToHMS(set.duration || 0);
            const pad = (n: number) => n.toString().padStart(2, '0');
            return (
              <button
                key={m}
                type="button"
                onClick={onDurationClick}
                disabled={readOnly}
                className="ledger-field min-h-[44px] font-mono font-semibold text-[22px] leading-none text-primary tabular-nums"
              >
                {pad(hms.h)}:{pad(hms.m)}:{pad(hms.s)}
              </button>
            );
          }

          if (readOnly) {
            const raw = set[m as keyof SetLog];
            const display =
              m === 'weight'
                ? formatWeight(Number(raw) || 0, unit)
                : raw === 0 || raw === undefined
                  ? '—'
                  : String(raw);
            return (
              <span key={m} className="ledger-field">
                <span className="font-mono font-semibold text-data-lg text-primary tabular-nums">
                  {display}
                </span>
                {/* 空值不带单位——「—次」读起来像个错字 */}
                {unitLabel && display !== '—' && <span className="ledger-unit">{unitLabel}</span>}
              </span>
            );
          }

          return (
            <label key={m} className="ledger-field">
              <input
                type="number"
                step="any"
                inputMode="decimal"
                className="ledger-input"
                placeholder="0"
                aria-label={unitLabel ? `${m} (${unitLabel})` : m}
                value={
                  set[m as keyof typeof set] === 0 || set[m as keyof typeof set] === undefined
                    ? ''
                    : (() => {
                        const rawValue = Number(set[m as keyof typeof set]);
                        if (m === 'weight') return formatWeight(rawValue, unit);
                        return rawValue.toFixed(2).replace(/\.?0+$/, '');
                      })()
                }
                onChange={e => {
                  const inputValue = e.target.value === '' ? 0 : Number(e.target.value);
                  let storageValue = inputValue;
                  if (m === 'weight') storageValue = parseWeight(inputValue, unit);
                  onUpdate({ [m]: storageValue });
                }}
              />
              {unitLabel && <span className="ledger-unit">{unitLabel}</span>}
            </label>
          );
        })}

        {/* 删组：热区补到 44×44（原先是 35px 列里的 16px 图标，
            与页面其他处精心维护的 min-h-[44px] 自相矛盾）。
            §6.6：不靠颜色区分危险，靠「必须长按」这个形态。 */}
        {!readOnly ? (
          <button
            type="button"
            className="relative w-11 h-11 justify-self-end flex items-center justify-center text-tertiary touch-none"
            aria-label={isCn ? '长按删除这一组' : 'Hold to delete set'}
            {...removeSet.handlers}
          >
            <Minus size={18} strokeWidth={1.75} />
            <LongPressAffordance
              active={removeSet.pressing}
              hint={removeSet.hinting}
              label={isCn ? '删除' : 'Delete'}
              hintLabel={isCn ? '按住删除' : 'Hold to delete'}
              drawMs={removeSet.drawMs}
            />
          </button>
        ) : (
          <span />
        )}
      </div>

      {expandedSubSets.map((sub, ssi) => (
        <div key={sub.id || ssi} className="ledger-subrow" style={colStyle}>
          <span className="text-micro font-medium text-tertiary select-none">
            {isCn ? '递减' : 'Drop'}
          </span>

          {/* 与父行遍历同一个 activeMetrics，落在同一套 --cols 上——
              原先子组行写死 grid-cols-4，指标数不等于 2 时整行错位。
              递减组只承载重量与次数，其余列留空。 */}
          {activeMetrics.map(m => {
            if (m !== 'weight' && m !== 'reps') return <span key={m} />;
            const unitLabel = m === 'weight' ? unitLabels.weight : '';
            const value = m === 'weight' ? sub.weight : sub.reps;
            const display =
              m === 'weight' ? formatWeight(sub.weight || 0, unit) : String(sub.reps || '');

            if (readOnly) {
              return (
                <span key={m} className="ledger-field">
                  <span className="font-mono font-semibold text-[22px] leading-none text-primary tabular-nums">
                    {value ? display : '—'}
                  </span>
                  {unitLabel && <span className="ledger-unit">{unitLabel}</span>}
                </span>
              );
            }

            return (
              <label key={m} className="ledger-field">
                <input
                  type="number"
                  step={m === 'weight' ? 'any' : undefined}
                  inputMode={m === 'weight' ? 'decimal' : 'numeric'}
                  className="ledger-input ledger-input-sm"
                  aria-label={
                    m === 'weight'
                      ? isCn ? '递减组重量' : 'Drop set weight'
                      : isCn ? '递减组次数' : 'Drop set reps'
                  }
                  value={value ? display : ''}
                  onChange={e => {
                    const val = e.target.value === '' ? 0 : Number(e.target.value);
                    handleSubSetUpdate(
                      ssi,
                      m === 'weight' ? { weight: parseWeight(val, unit) } : { reps: val },
                    );
                  }}
                />
                {unitLabel && <span className="ledger-unit">{unitLabel}</span>}
              </label>
            );
          })}

          {!readOnly ? (
            <button
              type="button"
              onClick={() => {
                haptic(H.tap);
                handleRemoveSubSet(ssi);
              }}
              className="w-11 h-11 justify-self-end flex items-center justify-center text-tertiary"
              aria-label={isCn ? '删除递减组' : 'Remove drop set'}
            >
              <Minus size={16} strokeWidth={1.75} />
            </button>
          ) : (
            <span />
          )}
        </div>
      ))}

      {/* 母组有子组时，补一条「再加一档」的入口——
          子组本身是低频的，但已经开了头之后再加一档是顺手的事，
          不该逼用户再长按一次。 */}
      {!readOnly && hasSubSets && (
        <button
          type="button"
          onClick={() => {
            haptic(H.tap);
            handleAddSubSet();
          }}
          className="ml-6 mb-1 min-h-[36px] px-2 text-micro font-semibold text-accent text-left"
        >
          + {isCn ? '再加一档递减' : 'Add drop set'}
        </button>
      )}
    </>
  );
};

export default SetCapsule;
