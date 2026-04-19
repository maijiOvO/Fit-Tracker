/**
 * 训练组输入胶囊组件
 * 用于编辑单个训练组的数据（重量、次数、距离等）
 */
import React, { useState } from 'react';
import { Layers, Plus, Minus, X } from 'lucide-react';
import { translations } from '../../translations';
import { Language, BodyweightMode, SubSetLog } from '../../types';

interface SetCapsuleProps {
  set: any;
  setIdx: number;
  activeMetrics: string[];
  unit: string;
  lang: Language;
  isPyramid?: boolean;
  onUpdate: (updates: Partial<typeof set>) => void;
  onRemove: () => void;
  onDurationClick?: () => void;
}

// Helper to convert seconds to H:M:S
function secondsToHMS(seconds: number): { h: number; m: number; s: number } {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return { h, m, s };
}

// Format weight for display
function formatWeight(kg: number, targetUnit: string): string {
  if (targetUnit === 'lbs') {
    return (kg * 2.20462).toFixed(2).replace(/\.?0+$/, '');
  }
  return kg.toFixed(2).replace(/\.?0+$/, '');
}

// Parse weight from display to storage (kg)
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
      {/* Main Input Row */}
      <div 
        className="grid gap-2 items-center bg-slate-900 p-4 rounded-2xl border border-slate-800 transition-all focus-within:border-blue-500/50 relative"
        style={{ 
          gridTemplateColumns: `35px repeat(${activeMetrics.length}, 1fr) 35px` 
        }}
      >
        <span className="text-blue-500 font-black text-xs">{setIdx + 1}</span>

        {activeMetrics.map(m => {
          // Duration (H:M:S) special handling
          if (m === 'duration') {
            const hms = secondsToHMS(set.duration || 0);
            return (
              <button 
                key={m}
                type="button"
                onClick={onDurationClick}
                className="mx-auto bg-slate-800/80 hover:bg-slate-700 border border-slate-700/50 px-3 py-2 rounded-xl flex items-center gap-1.5 transition-all active:scale-95 group"
              >
                <div className="flex items-baseline gap-0.5">
                  <span className="text-sm font-black text-blue-400 tabular-nums">{hms.h.toString().padStart(2, '0')}</span>
                  <span className="text-[8px] font-bold text-slate-600">h</span>
                </div>
                <span className="text-slate-700 font-bold">:</span>
                <div className="flex items-baseline gap-0.5">
                  <span className="text-sm font-black text-blue-400 tabular-nums">{hms.m.toString().padStart(2, '0')}</span>
                  <span className="text-[8px] font-bold text-slate-600">m</span>
                </div>
                <span className="text-slate-700 font-bold">:</span>
                <div className="flex items-baseline gap-0.5">
                  <span className="text-sm font-black text-blue-400 tabular-nums">{hms.s.toString().padStart(2, '0')}</span>
                  <span className="text-[8px] font-bold text-slate-600">s</span>
                </div>
              </button>
            );
          }

          // Normal number input (weight, reps, distance, etc.)
          return (
            <input 
              key={m}
              type="number"
              className="bg-transparent font-bold text-center outline-none text-white focus:text-blue-400 w-full text-sm"
              placeholder="0"
              value={
                set[m as keyof typeof set] === 0 || set[m as keyof typeof set] === undefined 
                  ? '' 
                  : (() => {
                      const rawValue = Number(set[m as keyof typeof set]);
                      if (m === 'weight') {
                        return formatWeight(rawValue, unit);
                      } else {
                        return rawValue.toFixed(2).replace(/\.?0+$/, '');
                      }
                    })()
              }
              onChange={e => {
                const inputValue = e.target.value === '' ? 0 : Number(e.target.value);
                let storageValue = inputValue;
                if (m === 'weight') {
                  storageValue = parseWeight(inputValue, unit);
                }
                onUpdate({ [m]: storageValue });
              }}
            />
          );
        })}

        {/* Actions */}
        <div className="flex justify-end gap-2 pr-1">
          {isPyramid && (
            <button onClick={handleAddSubSet} className="text-indigo-400 hover:text-indigo-300" title={lang === Language.CN ? '添加子组' : 'Add Sub Set'}>
              <Layers size={16} />
            </button>
          )}
          <button onClick={onRemove} className="text-slate-700 hover:text-red-500">
            <Minus size={16} />
          </button>
        </div>
      </div>

      {/* Sub Sets (Pyramid) */}
      {isPyramid && expandedSubSets.length > 0 && (
        <div className="space-y-2 ml-8">
          {expandedSubSets.map((sub, ssi) => (
            <div key={sub.id || ssi} className="grid grid-cols-4 gap-4 items-center bg-slate-900/40 p-3 rounded-xl border border-dashed border-slate-800 animate-in slide-in-from-left-2">
              <span className="text-[10px] font-black text-slate-600 uppercase">
                {lang === Language.CN ? '递减' : 'Sub'}
              </span>
              <input 
                type="number" 
                step="any" 
                className="bg-transparent text-sm font-bold text-center outline-none text-slate-300 w-full" 
                value={sub.weight === 0 ? '' : formatWeight(sub.weight, unit)} 
                onChange={e => {
                  const val = e.target.value === '' ? 0 : Number(e.target.value);
                  handleSubSetUpdate(ssi, { weight: parseWeight(val, unit) });
                }} 
              />
              <input 
                type="number" 
                className="bg-transparent text-sm font-bold text-center outline-none text-slate-300" 
                value={sub.reps || ''} 
                onChange={e => {
                  const val = e.target.value === '' ? 0 : Number(e.target.value);
                  handleSubSetUpdate(ssi, { reps: val });
                }} 
              />
              <button 
                onClick={() => handleRemoveSubSet(ssi)} 
                className="flex justify-end pr-2 text-slate-700 hover:text-red-500" 
                title={lang === Language.CN ? '删除子组' : 'Remove Sub Set'}
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default SetCapsule;
