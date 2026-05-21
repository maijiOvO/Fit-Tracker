/**
 * 训练组输入胶囊组件
 */
import React, { useState } from 'react';
import { Layers, Minus } from 'lucide-react';
import { translations } from '../../translations';
import { Language, BodyweightMode, SubSetLog, SetLog } from '../../types';

interface SetCapsuleProps {
  set: any;
  setIdx: number;
  activeMetrics: string[];
  unit: string;
  lang: Language;
  isPyramid?: boolean;
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
  unit,
  lang,
  isPyramid = false,
  readOnly = false,
  onUpdate,
  onRemove,
  onDurationClick,
}) => {
  const [expandedSubSets, setExpandedSubSets] = useState<SubSetLog[]>(set.subSets || []);

  const handleSubSetUpdate = (subIdx: number, updates: Partial<SubSetLog>) => {
    const newSubSets = [...expandedSubSets];
    newSubSets[subIdx] = { ...newSubSets[subIdx], ...updates };
    setExpandedSubSets(newSubSets);
    onUpdate({ subSets: newSubSets });
  };

  const handleAddSubSet = () => {
    const newSubSet: SubSetLog = {
      id: `sub_${Date.now()}`,
      weight: set.weight || 0,
      reps: (set.reps || 0) - 5 > 0 ? set.reps - 5 : 0,
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

  return (
    <div className="space-y-2">
      <div
        className="grid gap-2 items-center bg-inset p-3 rounded-control border border-divider transition-colors focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/15"
        style={{ gridTemplateColumns: `35px repeat(${activeMetrics.length}, 1fr) 35px` }}
      >
        <span className="text-accent font-mono font-medium text-xs tabular-nums">{setIdx + 1}</span>

        {activeMetrics.map(m => {
          if (m === 'duration') {
            const hms = secondsToHMS(set.duration || 0);
            return (
              <button
                key={m}
                type="button"
                onClick={onDurationClick}
                className="mx-auto bg-card hover:bg-card-hover border border-divider px-2 py-1.5 rounded-chip flex items-center gap-1 transition-colors active:scale-95"
              >
                <span className="text-sm font-mono font-medium text-accent tabular-nums">
                  {hms.h.toString().padStart(2, '0')}:{hms.m.toString().padStart(2, '0')}:{hms.s.toString().padStart(2, '0')}
                </span>
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
              <span key={m} className="text-center text-sm font-mono font-medium text-primary tabular-nums">
                {display}
              </span>
            );
          }

          return (
            <input
              key={m}
              type="number"
              className="bg-transparent font-mono font-medium text-center outline-none text-primary focus:text-accent w-full text-sm tabular-nums"
              placeholder="0"
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
          );
        })}

        <div className="flex justify-end gap-1 pr-1">
          {!readOnly && isPyramid && (
            <button onClick={handleAddSubSet} className="text-accent hover:opacity-80" title={lang === Language.CN ? '添加子组' : 'Add Sub Set'}>
              <Layers size={16} strokeWidth={1.75} />
            </button>
          )}
          {!readOnly && (
            <button onClick={onRemove} className="text-tertiary hover:text-danger">
              <Minus size={16} strokeWidth={1.75} />
            </button>
          )}
        </div>
      </div>

      {isPyramid && expandedSubSets.length > 0 && (
        <div className="space-y-2 ml-6">
          {expandedSubSets.map((sub, ssi) => (
            <div
              key={sub.id || ssi}
              className="grid grid-cols-4 gap-3 items-center bg-card p-2.5 rounded-control border border-dashed border-divider"
            >
              <span className="text-[10px] font-medium text-tertiary">
                {lang === Language.CN ? '递减' : 'Sub'}
              </span>
              <input
                type="number"
                step="any"
                className="bg-transparent text-sm font-mono font-medium text-center outline-none text-primary tabular-nums w-full"
                value={sub.weight === 0 ? '' : formatWeight(sub.weight, unit)}
                onChange={e => {
                  const val = e.target.value === '' ? 0 : Number(e.target.value);
                  handleSubSetUpdate(ssi, { weight: parseWeight(val, unit) });
                }}
              />
              <input
                type="number"
                className="bg-transparent text-sm font-mono font-medium text-center outline-none text-primary tabular-nums"
                value={sub.reps || ''}
                onChange={e => {
                  const val = e.target.value === '' ? 0 : Number(e.target.value);
                  handleSubSetUpdate(ssi, { reps: val });
                }}
              />
              <button
                onClick={() => handleRemoveSubSet(ssi)}
                className="flex justify-end text-tertiary hover:text-danger text-xs"
              >
                {lang === Language.CN ? '删' : '×'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default SetCapsule;
