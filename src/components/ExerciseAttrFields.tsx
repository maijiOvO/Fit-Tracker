/**
 * 动作属性表（2026-10-20，取代「部位与器材」那一片胶囊）：
 *
 *   训练类型   [ 力量 | 有氧 | 自由 ]
 *   部位       胸            ›
 *   细分       上胸          ›
 *   器材       固定器械      ›
 *   阻力       配重片        ›      ← 器材自带阻力时锁定，只显示
 *
 * 每行单选。点一行就地展开它的选项（同一时间只展开一行），选中即收起。
 * 编辑动作、新建动作、做法三个地方共用；做法模式下第一项是「跟动作走」，部位 / 类型不出现。
 * 只管值，不存：存由外面的弹窗在「保存」时做（做法即点即存，跟原来一样）。
 */
import React, { useState } from 'react';
import { ChevronRight, Lock, PlusCircle } from 'lucide-react';
import { ExerciseCategory, Language } from '../../types';
import { translations } from '../../translations';
import { BODY_PARTS } from '../constants/exercises';
import { useExercisePrefs } from '../contexts/ExercisePrefsContext';
import {
  RESISTANCES,
  RESISTANCE_NAMES,
  resistanceChoices,
  defaultResistance,
  effectiveResistance,
  resistanceSelectable,
  type Resistance,
} from '../utils/exerciseAttrs';
import { RegionChooser, hasRegionSection } from './RegionChooser';

export interface AttrValue {
  category: ExerciseCategory;
  bodyPart: string;
  /** 细分，主细分在前（2026-10-21 起多选）；[] = 未细分 / 做法里＝跟动作走 */
  regions: string[];
  /** 做法模式下 '' = 跟动作走；动作模式下 '' = 无器材 */
  equipment: string;
  resistance?: Resistance;
}

interface Props {
  lang: Language;
  value: AttrValue;
  onChange: (next: AttrValue) => void;
  /** 做法：只出细分（可选）、器材、阻力；inherited 是跟动作走时的器材与阻力 */
  variant?: { inherited: { equipment: string; resistance: Resistance }; regions: string[] };
  testId?: string;
}

type RowKey = 'part' | 'region' | 'equipment' | 'resistance';

export const ExerciseAttrFields: React.FC<Props> = ({ lang, value, onChange, variant, testId }) => {
  const { getTagName, customTags, equipmentIds, addTag } = useExercisePrefs();
  const [open, setOpen] = useState<RowKey | null>(null);
  /** 就地新建器材（新动作用的器材库里还没有时，不用先退出去建）：名字 + 默认阻力 */
  const [newEquip, setNewEquip] = useState<{ name: string; res: Resistance } | null>(null);
  const isCn = lang === Language.CN;
  const set = (patch: Partial<AttrValue>) => onChange({ ...value, ...patch });
  const toggle = (k: RowKey) => {
    setNewEquip(null);
    setOpen(o => (o === k ? null : k));
  };
  const commitNewEquip = () => {
    if (!newEquip) return;
    const id = addTag('equipment', newEquip.name, newEquip.res);
    if (!id) return; // 重名：addTag 已 toast，表单留着改
    set({ equipment: id, resistance: undefined });
    setNewEquip(null);
    setOpen(null);
  };
  const resName = (r: Resistance) => RESISTANCE_NAMES[r][isCn ? 'cn' : 'en'];

  const following = !!variant && !value.equipment;
  const eqForRes = following ? variant!.inherited.equipment : value.equipment;
  const resNow = following
    ? variant!.inherited.resistance
    : effectiveResistance(value.equipment, value.resistance, customTags);
  const resLocked = following || !resistanceSelectable(value.equipment);

  const partIds = [...BODY_PARTS, ...customTags.filter(t => t.category === 'bodyPart').map(t => t.id)];
  const showRegion = variant ? variant.regions.length > 0 : hasRegionSection(value.bodyPart, value.category);

  const noneEquipLabel = variant
    ? isCn ? '跟动作走' : 'Same as exercise'
    : isCn ? '无器材' : 'No gear';
  const equipLabel = value.equipment
    ? getTagName(value.equipment) || noneEquipLabel
    : variant
      ? `${noneEquipLabel}${variant.inherited.equipment ? `（${getTagName(variant.inherited.equipment)}）` : ''}`
      : noneEquipLabel;

  /** 一个选项格：统一宽度的格子，选中的上淡底 —— 不再是长短不一的胶囊 */
  const option = (key: string, label: string, on: boolean, pick: () => void, custom = false) => (
    <button
      key={key || 'none'}
      type="button"
      aria-pressed={on}
      onClick={() => {
        pick();
        setOpen(null);
      }}
      className={`min-h-[40px] px-1.5 py-1 rounded-control text-xs font-bold leading-tight text-center break-words transition-ui ${
        on
          ? 'bg-accent-soft text-accent'
          : custom
            ? 'bg-inset text-primary active:bg-card-hover'
            : 'bg-inset text-secondary active:bg-card-hover'
      }`}
    >
      {label}
    </button>
  );

  const row = (k: RowKey, label: string, shown: string, opts: { locked?: boolean; body?: React.ReactNode }) => (
    <div className="attr-row" data-attr={k}>
      <button
        type="button"
        disabled={opts.locked}
        onClick={() => toggle(k)}
        aria-expanded={!opts.locked && open === k}
        className="w-full min-h-[48px] px-3.5 flex items-center gap-3 text-left active:bg-card-hover disabled:active:bg-transparent"
      >
        <span className="w-14 flex-shrink-0 text-label text-secondary">{label}</span>
        <span className={`flex-1 min-w-0 truncate text-sm font-semibold ${shown ? 'text-primary' : 'text-tertiary'}`}>
          {shown || (isCn ? '未设置' : 'Not set')}
        </span>
        {opts.locked ? (
          <Lock size={13} className="flex-shrink-0 text-tertiary" aria-label={isCn ? '随器材' : 'Set by gear'} />
        ) : (
          <ChevronRight
            size={16}
            className={`flex-shrink-0 text-tertiary transition-transform ${open === k ? 'rotate-90' : ''}`}
          />
        )}
      </button>
      {!opts.locked && open === k && <div className="px-3 pb-3">{opts.body}</div>}
    </div>
  );

  return (
    <div className="space-y-3" data-testid={testId}>
      {!variant && (
        <div className="flex gap-2" role="group" aria-label={isCn ? '训练类型' : 'Category'}>
          {(['STRENGTH', 'CARDIO', 'FREE'] as ExerciseCategory[]).map(cat => (
            <button
              key={cat}
              type="button"
              aria-pressed={value.category === cat}
              onClick={() => set({ category: cat })}
              className={`flex-1 min-h-[40px] rounded-control text-xs font-bold transition-ui ${
                value.category === cat ? 'bg-accent-soft text-accent' : 'bg-card text-secondary hover:bg-card-hover'
              }`}
            >
              {cat === 'STRENGTH' && translations.strengthTraining[lang]}
              {cat === 'CARDIO' && translations.cardioTraining[lang]}
              {cat === 'FREE' && translations.freeTraining[lang]}
            </button>
          ))}
        </div>
      )}

      <div className="attr-table rounded-card border border-divider bg-card divide-y divide-divider overflow-hidden">
        {!variant &&
          row('part', isCn ? '部位' : 'Part', value.bodyPart ? getTagName(value.bodyPart) : '', {
            body: (
              <div className="grid grid-cols-3 gap-1.5">
                {option('', isCn ? '无' : 'None', !value.bodyPart, () => set({ bodyPart: '', regions: [] }))}
                {partIds.map(id => {
                  const n = getTagName(id);
                  return n
                    ? option(id, n, value.bodyPart === id, () => set({ bodyPart: id, regions: id === value.bodyPart ? value.regions : [] }), !BODY_PARTS.includes(id))
                    : null;
                })}
              </div>
            ),
          })}

        {showRegion &&
          row(
            'region',
            isCn ? '细分' : 'Region',
            value.regions.length
              ? value.regions.map(getTagName).join(isCn ? '、' : ', ')
              : isCn ? (variant ? '跟动作走' : '未细分') : variant ? 'Same as exercise' : 'Unassigned',
            {
              // 多选：点了不收起，选完点行头收
              body: (
                <RegionChooser
                  part={value.bodyPart}
                  category={value.category}
                  value={value.regions}
                  onChange={rs => set({ regions: rs })}
                  lang={lang}
                  variantOptions={variant?.regions}
                />
              ),
            },
          )}

        {row('equipment', isCn ? '器材' : 'Gear', equipLabel, {
          body: (
            <>
              <div className="grid grid-cols-3 gap-1.5">
                {option('', noneEquipLabel, !value.equipment, () => set({ equipment: '', resistance: undefined }))}
                {equipmentIds.map(id => {
                  const n = getTagName(id);
                  return n
                    ? option(id, n, value.equipment === id, () => set({ equipment: id, resistance: undefined }), /^ct_/i.test(id))
                    : null;
                })}
                {!newEquip && (
                  <button
                    type="button"
                    onClick={() => setNewEquip({ name: '', res: 'none' })}
                    className="min-h-[40px] px-1.5 rounded-control text-xs font-bold text-accent border border-dashed border-accent/40 flex items-center justify-center gap-1 active:bg-accent/10"
                    data-testid="attr-new-equip"
                  >
                    <PlusCircle size={13} /> {isCn ? '新建器材' : 'New gear'}
                  </button>
                )}
              </div>
              {newEquip && (
                <div className="mt-2.5 p-2.5 rounded-control bg-inset space-y-2" data-testid="attr-new-equip-form">
                  <div className="flex gap-2">
                    <input
                      className="ui-input flex-1 min-w-0"
                      value={newEquip.name}
                      onChange={e => setNewEquip({ ...newEquip, name: e.target.value })}
                      onKeyDown={e => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          commitNewEquip();
                        }
                      }}
                      placeholder={isCn ? '器材名称，如：史密斯' : 'Gear name'}
                      aria-label={isCn ? '新器材名称' : 'New gear name'}
                      autoFocus
                    />
                    <button
                      type="button"
                      onClick={commitNewEquip}
                      disabled={!newEquip.name.trim()}
                      className="flex-shrink-0 px-4 rounded-control bg-accent text-on-accent font-semibold disabled:opacity-40"
                    >
                      {isCn ? '添加' : 'Add'}
                    </button>
                  </div>
                  <p className="px-0.5 text-label text-secondary">{isCn ? '默认阻力' : 'Default load'}</p>
                  <div className="grid grid-cols-4 gap-1.5">
                    {RESISTANCES.map(r => (
                      <button
                        key={r}
                        type="button"
                        aria-pressed={newEquip.res === r}
                        onClick={() => setNewEquip({ ...newEquip, res: r })}
                        className={`min-h-[36px] px-1 rounded-control text-[11px] font-bold leading-tight transition-ui ${
                          newEquip.res === r ? 'bg-accent-soft text-accent' : 'bg-card text-secondary'
                        }`}
                      >
                        {resName(r)}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          ),
        })}

        {row('resistance', isCn ? '阻力' : 'Load', resName(resNow), {
          locked: resLocked,
          body: (
            <div className="grid grid-cols-3 gap-1.5">
              {resistanceChoices(eqForRes).map(r =>
                option(r, resName(r), resNow === r, () =>
                  // 选回器材默认的就不写（以后器材默认改了跟着走）
                  set({ resistance: r === defaultResistance(eqForRes, customTags) ? undefined : r }),
                ),
              )}
            </div>
          ),
        })}
      </div>
    </div>
  );
};

export default ExerciseAttrFields;
