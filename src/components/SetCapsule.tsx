/**
 * 训练组胶囊组件
 * 用于显示单个训练组的数据（重量、次数、距离等）
 */
import React from 'react';
import { Layers, Hash, User as UserIcon, Plus, Minus } from 'lucide-react';
import { translations } from '../../translations';
import { Language, SubSetLog } from '../../types';
import { formatValue } from '../utils/format';

interface SetCapsuleProps {
  set: any;
  exerciseName: string;
  exercise?: { instanceConfig?: any };
  metrics: string[];
  unit: 'kg' | 'lbs';
  lang: Language;
}

export const SetCapsule: React.FC<SetCapsuleProps> = ({
  set,
  exerciseName,
  exercise,
  metrics,
  unit,
  lang,
}) => {
  const config = exercise?.instanceConfig;
  const isPyramid = config?.enablePyramid || false;
  const bodyweightMode = config?.bodyweightMode || 'none';

  return (
    <div className="bg-slate-900/60 border border-slate-800/80 px-4 py-2 rounded-2xl transition-all hover:border-blue-500/30">
      {/* 显示配置标识 */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {/* 显示训练数据 */}
        {metrics.map(m => (
          <div key={m} className="flex items-center gap-1">
            <span className="text-[10px] text-slate-500 font-bold uppercase">
              {translations[m as keyof typeof translations]?.[lang] || m.replace('custom_', '')}:
            </span>
            <span className="font-black text-slate-100 text-sm">{formatValue(set[m], m, unit)}</span>
          </div>
        ))}
        
        {/* 显示特殊配置标识 */}
        <div className="flex items-center gap-1 ml-2">
          {/* 递增递减组标识 */}
          {isPyramid && (
            <div className="flex items-center gap-1 px-2 py-1 bg-orange-500/20 text-orange-400 rounded-lg border border-orange-500/30">
              <Layers size={10} />
              <span className="text-[8px] font-black uppercase">
                {lang === Language.CN ? '递增递减' : 'Pyramid'}
              </span>
            </div>
          )}
          
          {/* 自重模式标识 */}
          {bodyweightMode !== 'none' && (
            <div className={`flex items-center gap-1 px-2 py-1 rounded-lg border text-[8px] font-black uppercase ${
              bodyweightMode === 'bodyweight' ? 'bg-green-500/20 text-green-400 border-green-500/30' :
              bodyweightMode === 'weighted' ? 'bg-blue-500/20 text-blue-400 border-blue-500/30' :
              bodyweightMode === 'assisted' ? 'bg-purple-500/20 text-purple-400 border-purple-500/30' :
              'bg-slate-500/20 text-slate-400 border-slate-500/30'
            }`}>
              {bodyweightMode === 'bodyweight' && <><UserIcon size={10} /><span>{lang === Language.CN ? '自重' : 'BW'}</span></>}
              {bodyweightMode === 'weighted' && <><Plus size={10} /><span>{lang === Language.CN ? '负重' : '+W'}</span></>}
              {bodyweightMode === 'assisted' && <><Minus size={10} /><span>{lang === Language.CN ? '辅助' : 'AST'}</span></>}
            </div>
          )}
          
          {/* 递增递减组子组显示 */}
          {isPyramid && set.subSets && set.subSets.length > 0 && (
            <div className="flex items-center gap-1 px-2 py-1 bg-indigo-500/20 text-indigo-400 rounded-lg border border-indigo-500/30">
              <Hash size={10} />
              <span className="text-[8px] font-black">
                {set.subSets.length} {lang === Language.CN ? '子组' : 'Sub'}
              </span>
            </div>
          )}
        </div>
      </div>
      
      {/* 递增递减组子组详细信息展示 */}
      {isPyramid && set.subSets && set.subSets.length > 0 && (
        <div className="mt-2 pt-2 border-t border-slate-700/50">
          <div className="flex flex-wrap gap-1">
            {set.subSets.map((subSet: SubSetLog, idx: number) => (
              <div key={subSet.id || idx} className="flex items-center gap-1 px-2 py-1 bg-slate-800/60 rounded-lg border border-slate-700/50">
                <span className="text-[8px] text-slate-500 font-bold">{idx + 1}:</span>
                <span className="text-[8px] text-slate-300 font-bold">
                  {subSet.weight > 0 && `${subSet.weight}${unit === 'kg' ? 'kg' : 'lbs'}`}
                  {subSet.weight > 0 && subSet.reps > 0 && ' × '}
                  {subSet.reps > 0 && `${subSet.reps}${lang === Language.CN ? '次' : 'r'}`}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default SetCapsule;
