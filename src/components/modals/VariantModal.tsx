/**
 * 做法（变体第一层，原「练法」）：同一个动作的不同做法，一条记录只选一种（组合就起组合名，如「窄握·暂停」）。
 *
 * 从训练卡的眉批（当前做法）或 ⋯ 菜单「做法」进来。
 *   - 点一行＝这张卡换成这个做法（全是底稿时，底稿换成这个做法上次的那几组）
 *   - 做法可改名 / 删除（删除不确认，点错了用全局撤销；历史记录带着删时的名字，照样能显示；
 *     删的是并入生成的做法，先把并进来的旧动作拆回成独立动作；工作台上正用着它的卡当场回到标准）
 *   - 新做法：输入框 + 几个常用叫法的快捷 chip，建完直接选中
 * 「标准」＝没选做法，旧记录都在这里。
 *
 * manage：从动作库（添加动作弹层的动作面板）进来时只管理 —— 改名 / 删除 / 新建，
 * 外加每个做法自己的细分和器材（2.3：不同的杆子、握法练不同的肌肉）。带细分的做法在添加动作的细分格里
 * 单独成一张小卡、落在那一列。点行展开它的细分 / 器材，不切换；并入生成的做法展开后还能拆回成独立动作。
 */
import React, { useState } from 'react';
import { Check, ChevronDown, PencilLine, Plus, Trash2 } from 'lucide-react';
import { Language } from '../../../types';
import { ExerciseAttrFields } from '../ExerciseAttrFields';
import { regionList, regionsPatch, variantAttrs } from '../../utils/exerciseAttrs';
import { mergeOverride } from '../../utils/exerciseOverride';
import { Modal } from '../Modal';
import { useExercisePrefs } from '../../contexts/ExercisePrefsContext';

interface VariantModalProps {
  open: boolean;
  lang: Language;
  /** 记录里存的动作名（任意曾用名都行，按库里的定义找练法） */
  exerciseName: string;
  currentVariantId?: string;
  /** name 一并给：刚建的练法还没进状态，按 id 查不到名字（走查实测：记录里漏了 variantName） */
  onSelect: (variantId: string | undefined, name?: string) => void;
  onClose: () => void;
  /** 只管理，不选（动作库入口） */
  manage?: boolean;
  /** 删掉一个做法时：工作台上正用着它的卡当场回到标准（NewWorkoutTab 实现；计划编辑器里不传） */
  onVariantRemoved?: (exerciseName: string, variantId: string) => void;
}

const SUGGEST_CN = ['宽握', '窄握', '反握', '对握', 'V 把', '单侧', '暂停'];
const SUGGEST_EN = ['Wide grip', 'Close grip', 'Underhand', 'Neutral grip', 'V-bar', 'Single-arm', 'Paused'];

export const VariantModal: React.FC<VariantModalProps> = ({
  open,
  lang,
  exerciseName,
  currentVariantId,
  onSelect,
  onClose,
  manage = false,
  onVariantRemoved,
}) => {
  const {
    variantsOf,
    addVariant,
    renameVariant,
    removeVariant,
    resolveName,
    findExerciseDef,
    exerciseOverrides,
    effectivePart,
    regionsOf,
    getTagName,
    updateVariant,
    setVariantAttrs,
    attrsOf,
    mergedSourcesOf,
    unmergeExercise,
  } = useExercisePrefs();
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState<{ id: string; value: string } | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  // 弹窗常驻挂着：换一个动作 / 重新打开时清掉上一回没提交的输入、展开、改名（审查 C：原来会串到下一个动作上）
  const [shownFor, setShownFor] = useState<string | null>(null);
  const openKey = open ? exerciseName : null;
  if (openKey !== shownFor) {
    setShownFor(openKey);
    setDraft('');
    setEditing(null);
    setExpanded(null);
  }
  if (!open) return null;

  // 做法的细分只能在这个动作所在的部位里选（有氧 / 自由不分细分）
  const def = findExerciseDef(exerciseName);
  const merged = def ? mergeOverride(def, exerciseOverrides[def.id]) : undefined;
  const part = merged && (merged.category || 'STRENGTH') === 'STRENGTH' ? effectivePart(merged) : '';
  const regs = part ? regionsOf(part) : [];
  // 做法跟动作走时显示的器材与阻力
  const inherited = merged ? attrsOf(merged) : { equipment: '', resistance: 'none' as const };

  const isCn = lang === Language.CN;
  const variants = variantsOf(exerciseName);
  const pick = (id: string | undefined, name?: string) => {
    onSelect(id, name);
    onClose();
  };
  const create = (name: string) => {
    const id = addVariant(exerciseName, name);
    if (!id) return; // 重名：已 toast，留着改
    setDraft('');
    if (!manage) pick(id, name.trim());
  };
  const suggestions = (isCn ? SUGGEST_CN : SUGGEST_EN).filter(n => !variants.some(v => v.name === n));

  const row = (id: string | undefined, name: string) => {
    const on = !manage && (currentVariantId || undefined) === id;
    if (id && editing?.id === id) {
      return (
        <div key={id} className="flex gap-2">
          <input
            className="ui-input flex-1 min-w-0"
            value={editing.value}
            onChange={e => setEditing({ id, value: e.target.value })}
            onKeyDown={e => {
              if (e.key === 'Enter' && renameVariant(exerciseName, id, editing.value)) setEditing(null);
            }}
            aria-label={isCn ? '做法名称' : 'Variant name'}
            autoFocus
          />
          <button
            type="button"
            disabled={!editing.value.trim()}
            onClick={() => {
              if (renameVariant(exerciseName, id, editing.value)) setEditing(null);
            }}
            className="flex-shrink-0 px-4 rounded-control bg-accent text-on-accent font-semibold disabled:opacity-40"
          >
            {isCn ? '保存' : 'Save'}
          </button>
        </div>
      );
    }
    return (
      <div
        key={id || 'std'}
        className={`flex items-stretch rounded-card border overflow-hidden ${
          on ? 'border-accent bg-accent/10' : 'border-divider bg-card'
        }`}
      >
        <button
          type="button"
          onClick={() => {
            if (manage) {
              if (id) setExpanded(expanded === id ? null : id);
              return;
            }
            pick(id, id ? name : undefined);
          }}
          aria-pressed={on}
          className="flex-1 min-w-0 min-h-[48px] px-4 flex items-center gap-2.5 text-left text-small font-bold text-primary active:bg-card-hover"
          data-testid="variant-option"
        >
          <span className={`w-4 flex-shrink-0 ${on ? 'text-accent' : 'text-transparent'}`}>
            <Check size={16} strokeWidth={2.5} />
          </span>
          <span className={id ? '' : 'text-secondary'}>{name}</span>
          {id && (() => {
            const v = variants.find(x => x.id === id);
            const own = v?.equipment || (v?.tags?.length && merged ? attrsOf(merged, v.id).equipment : '');
            const bits = [...regionList(v).map(getTagName), own ? getTagName(own) : ''].filter(b => b && b !== name);
            return bits.length ? <span className="ml-auto text-xs font-medium text-tertiary truncate">{bits.join(' · ')}</span> : null;
          })()}
        </button>
        {id && manage && (
          <button
            type="button"
            onClick={() => setExpanded(expanded === id ? null : id)}
            className="w-11 flex items-center justify-center border-l border-divider text-tertiary active:bg-card-hover"
            aria-label={isCn ? `${name} 的细分与器材` : `Region & gear of ${name}`}
            aria-expanded={expanded === id}
            data-testid="variant-expand"
          >
            <ChevronDown size={15} className={expanded === id ? 'rotate-180' : ''} />
          </button>
        )}
        {id && (
          <>
            <button
              type="button"
              onClick={() => setEditing({ id, value: name })}
              className="w-11 flex items-center justify-center border-l border-divider text-tertiary active:bg-card-hover"
              aria-label={isCn ? `改名 ${name}` : `Rename ${name}`}
            >
              <PencilLine size={15} />
            </button>
            <button
              type="button"
              onClick={() => {
                onVariantRemoved?.(exerciseName, id);
                removeVariant(exerciseName, id);
              }}
              className="w-11 flex items-center justify-center border-l border-divider text-danger active:bg-danger/15"
              aria-label={isCn ? `删除 ${name}` : `Delete ${name}`}
            >
              <Trash2 size={15} />
            </button>
          </>
        )}
      </div>
    );
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={resolveName(exerciseName)}
      subtitle={isCn ? '做法' : 'Variant'}
      size="sm"
      layer="modal-2"
      testId="variant-modal"
      bodyClassName="overflow-y-auto max-h-[65vh] custom-scrollbar space-y-5"
    >
      <div className="space-y-2">
        {!manage && row(undefined, isCn ? '标准' : 'Standard')}
        {variants.map(v => (
          <React.Fragment key={v.id}>
            {row(v.id, v.name)}
            {manage && expanded === v.id && (
              <div className="pl-2 pb-1" data-testid="variant-tags">
                {(() => {
                  const own = variantAttrs(v);
                  return (
                    <ExerciseAttrFields
                      lang={lang}
                      variant={{ inherited, regions: regs.map(r => r.id) }}
                      value={{
                        category: merged?.category || 'STRENGTH',
                        bodyPart: part,
                        regions: regionList(v),
                        equipment: own?.equipment ?? '',
                        resistance: own?.resistance,
                      }}
                      onChange={nv => {
                        if (nv.regions.join('|') !== regionList(v).join('|')) updateVariant(exerciseName, v.id, regionsPatch(nv.regions));
                        if (nv.equipment !== (own?.equipment ?? '') || nv.resistance !== own?.resistance) {
                          setVariantAttrs(exerciseName, v.id, nv.equipment, nv.resistance);
                        }
                      }}
                    />
                  );
                })()}
                {/* 并入生成的做法：并错了隔天才发现，顶栏撤销已经够不着 */}
                {mergedSourcesOf(exerciseName, v.id).map(s => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => unmergeExercise(s.id)}
                    className="mt-2 min-h-[36px] px-3 rounded-control text-xs font-bold text-secondary border border-divider active:bg-card-hover"
                    data-testid="variant-unmerge"
                  >
                    {isCn ? `拆成独立动作「${s.name}」` : `Split out "${s.name}"`}
                  </button>
                ))}
              </div>
            )}
          </React.Fragment>
        ))}
      </div>
      <div>
        <h4 className="text-micro font-bold text-secondary uppercase tracking-[0.2em] mb-2 flex items-center gap-1.5">
          <Plus size={11} /> {isCn ? '新做法' : 'New variant'}
        </h4>
        <div className="flex gap-2">
          <input
            className="ui-input flex-1 min-w-0"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') create(draft);
            }}
            placeholder={isCn ? '如：窄握·暂停' : 'e.g. Close grip, paused'}
            aria-label={isCn ? '新做法名称' : 'New variant name'}
          />
          <button
            type="button"
            disabled={!draft.trim()}
            onClick={() => create(draft)}
            className="flex-shrink-0 px-4 rounded-control bg-accent text-on-accent font-semibold disabled:opacity-40"
          >
            {isCn ? '添加' : 'Add'}
          </button>
        </div>
        {suggestions.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-2.5">
            {suggestions.map(n => (
              <button
                key={n}
                type="button"
                onClick={() => create(n)}
                className="min-h-[36px] px-3 rounded-control text-xs font-bold text-accent border border-dashed border-accent/40 active:bg-accent/10"
              >
                {n}
              </button>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
};
