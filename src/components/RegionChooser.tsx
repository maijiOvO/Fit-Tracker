/**
 * 「细分」多选（第 3 条；2026-10-21 起多选）：属性表、新动作、做法共用。
 *
 * 随部位联动 —— 只列当前部位下的细分（系统在前、自建在后，自建的是虚线样子，
 * 跟自定义部位 chip 同一套），第一个是「未细分」（做法里是「跟动作走」）。
 * 点没选的＝加上，点选着的＝去掉；最后一个点不掉（要清空点「未细分」）。
 * 第一个选的是主细分（标「主」）：添加动作的细分格里只出现在它那一列，其余的搜得到。
 * 末尾「新建细分」就地展开一个输入框，建完直接加上。只有力量动作、且部位有细分时才出现（全身 / 有氧 / 自由不分细分）。
 */
import React, { useState } from 'react';
import { Language } from '../../types';
import { BODY_REGIONS } from '../constants/exercises';
import { useExercisePrefs } from '../contexts/ExercisePrefsContext';
import { toggleRegion } from '../utils/exerciseAttrs';
import { PlusCircle } from 'lucide-react';

interface RegionChooserProps {
  part: string;
  category: string;
  /** 选中的细分 id，主细分在前；[] = 未细分 */
  value: string[];
  onChange: (regionIds: string[]) => void;
  lang: Language;
  /** 做法：只在这几个细分里选、「未细分」叫「跟动作走」、不能就地新建 */
  variantOptions?: string[];
}

/** 这个部位 / 类别下要不要出「细分」这一节 */
export function hasRegionSection(part: string, category: string): boolean {
  return (category || 'STRENGTH') === 'STRENGTH' && !!BODY_REGIONS[part];
}

export const RegionChooser: React.FC<RegionChooserProps> = ({ part, category, value, onChange, lang, variantOptions }) => {
  const { regionsOf, getTagName, addRegionTag } = useExercisePrefs();
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  if (!variantOptions && !hasRegionSection(part, category)) return null;

  const isCn = lang === Language.CN;
  const regs = variantOptions
    ? variantOptions.map(id => ({ id, custom: !(BODY_REGIONS[part] ?? []).includes(id) }))
    : regionsOf(part);
  // 部位换过之后，原来选的细分不属于新部位 → 当作没选
  const current = value.filter(id => regs.some(r => r.id === id));

  const commit = () => {
    const id = addRegionTag(part, draft);
    if (!id) return; // 重名：addRegionTag 已 toast，输入框留着改
    onChange(current.includes(id) ? current : [...current, id]);
    setAdding(false);
    setDraft('');
  };

  const chip = (id: string, label: string, custom: boolean) => {
    const on = id ? current.includes(id) : current.length === 0;
    const primary = !!id && current[0] === id && current.length > 1;
    return (
      <button
        key={id || 'none'}
        type="button"
        aria-pressed={on}
        onClick={() => onChange(id ? toggleRegion(current, id) : [])}
        className={`min-h-[40px] px-4 rounded-control text-xs font-bold transition-ui flex items-center gap-1.5 ${
          on
            ? 'bg-accent-soft text-accent'
            : custom
              ? 'bg-accent/10 text-accent border border-accent/40'
              : 'bg-card text-secondary hover:bg-card-hover'
        }`}
        data-testid={id ? 'region-chip' : 'region-chip-none'}
      >
        {label}
        {primary && (
          <span className="px-1 rounded-sm bg-accent text-on-accent text-[10px] leading-[14px]" data-testid="region-primary">
            {isCn ? '主' : 'Main'}
          </span>
        )}
      </button>
    );
  };

  return (
    <div data-testid="region-chooser">
      <div className="flex flex-wrap gap-2">
        {chip('', variantOptions ? (isCn ? '跟动作走' : 'Same as exercise') : isCn ? '未细分' : 'Unassigned', false)}
        {regs.map(r => chip(r.id, getTagName(r.id), r.custom))}
        {!variantOptions && (
          <button
            type="button"
            onClick={() => setAdding(a => !a)}
            className="min-h-[40px] px-3.5 rounded-control text-xs font-bold text-accent border border-dashed border-accent/40 active:bg-accent/10 transition-colors flex items-center gap-1.5"
          >
            <PlusCircle size={13} /> {isCn ? '新建细分' : 'New region'}
          </button>
        )}
      </div>
      {adding && (
        <div className="flex gap-2 mt-2.5">
          <input
            className="ui-input flex-1 min-w-0"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commit();
              }
            }}
            placeholder={isCn ? '细分名称' : 'Region name'}
            aria-label={isCn ? '新细分名称' : 'New region name'}
            autoFocus
          />
          <button
            type="button"
            onClick={commit}
            disabled={!draft.trim()}
            className="flex-shrink-0 px-4 rounded-control bg-accent text-on-accent font-semibold disabled:opacity-40"
          >
            {isCn ? '添加' : 'Add'}
          </button>
        </div>
      )}
    </div>
  );
};

export default RegionChooser;
