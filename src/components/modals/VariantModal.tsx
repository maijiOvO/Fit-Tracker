/**
 * 做法（变体第一层，原「练法」）：同一个动作的不同做法，一条记录只选一种（组合就起组合名，如「窄握·暂停」）。
 *
 * 从训练卡的眉批（当前做法）或 ⋯ 菜单「做法」进来。
 *   - 点一行＝这张卡换成这个做法（全是底稿时，底稿换成这个做法上次的那几组）
 *   - 做法可改名 / 删除（删除走撤销条；历史记录里带着当时的名字，照样能显示）
 *   - 新做法：输入框 + 几个常用叫法的快捷 chip，建完直接选中
 * 「标准」＝没选做法，旧记录都在这里。
 *
 * manage：从动作库（添加动作弹层的动作面板）进来时只管理 —— 改名 / 删除 / 新建，
 * 外加每个做法自己的细分和器材（2.3：不同的杆子、握法练不同的肌肉）。带细分的做法在添加动作的细分格里
 * 单独成一张小卡、落在那一列。点行展开它的细分 / 器材，不切换。
 */
import React, { useState } from 'react';
import { Check, ChevronDown, PencilLine, Plus, Trash2 } from 'lucide-react';
import { Language } from '../../../types';
import { EQUIPMENT_TAGS } from '../../constants/exercises';
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
    customTags,
    updateVariant,
  } = useExercisePrefs();
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState<{ id: string; value: string } | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  if (!open) return null;

  // 做法的细分只能在这个动作所在的部位里选（有氧 / 自由不分细分）
  const def = findExerciseDef(exerciseName);
  const merged = def ? mergeOverride(def, exerciseOverrides[def.id]) : undefined;
  const part = merged && (merged.category || 'STRENGTH') === 'STRENGTH' ? effectivePart(merged) : '';
  const regs = part ? regionsOf(part) : [];
  const equipIds = [...EQUIPMENT_TAGS, ...customTags.filter(t => t.category === 'equipment').map(t => t.id)];

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
          on ? 'border-accent bg-accent/5' : 'border-divider bg-card'
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
          className="flex-1 min-w-0 min-h-[48px] px-4 flex items-center gap-2.5 text-left text-sm font-bold text-primary active:bg-card-hover"
          data-testid="variant-option"
        >
          <span className={`w-4 flex-shrink-0 ${on ? 'text-accent' : 'text-transparent'}`}>
            <Check size={16} strokeWidth={2.5} />
          </span>
          <span className={id ? '' : 'text-secondary'}>{name}</span>
          {id && (() => {
            const v = variants.find(x => x.id === id);
            const bits = [v?.region ? getTagName(v.region) : '', ...(v?.tags ?? []).map(getTagName)].filter(Boolean);
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
                if (on) onSelect(undefined); // 删的是正在用的那个：这张卡回到标准
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
              <div className="pl-2 pb-1 space-y-2" data-testid="variant-tags">
                {regs.length > 0 && (
                  <>
                    <div className="text-[10px] font-bold tracking-[0.2em] text-secondary">{isCn ? '细分' : 'REGION'}</div>
                    <div className="flex flex-wrap gap-1.5">
                      {[{ id: '' }, ...regs].map(r => {
                        const on = (v.region ?? '') === r.id;
                        return (
                          <button
                            key={r.id || 'none'}
                            type="button"
                            aria-pressed={on}
                            onClick={() => updateVariant(exerciseName, v.id, { region: r.id })}
                            className={`min-h-[36px] px-3 rounded-control text-xs font-bold border ${
                              on ? 'bg-accent border-accent text-on-accent' : 'bg-card border-divider text-secondary'
                            }`}
                          >
                            {r.id ? getTagName(r.id) : isCn ? '跟动作走' : 'Same as exercise'}
                          </button>
                        );
                      })}
                    </div>
                  </>
                )}
                <div className="text-[10px] font-bold tracking-[0.2em] text-secondary">{isCn ? '器材' : 'GEAR'}</div>
                <div className="flex flex-wrap gap-1.5">
                  {equipIds.map(t => {
                    const label = getTagName(t);
                    if (!label) return null;
                    const on = (v.tags ?? []).includes(t);
                    return (
                      <button
                        key={t}
                        type="button"
                        aria-pressed={on}
                        onClick={() =>
                          updateVariant(exerciseName, v.id, {
                            tags: on ? (v.tags ?? []).filter(x => x !== t) : [...(v.tags ?? []), t],
                          })
                        }
                        className={`min-h-[36px] px-3 rounded-control text-xs font-bold border ${
                          on ? 'bg-accent border-accent text-on-accent' : 'bg-card border-divider text-secondary'
                        }`}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </React.Fragment>
        ))}
      </div>
      <div>
        <h4 className="text-[10px] font-bold text-secondary uppercase tracking-[0.2em] mb-2 flex items-center gap-1.5">
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

export default VariantModal;
