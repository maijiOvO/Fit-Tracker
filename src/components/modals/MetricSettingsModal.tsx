/**
 * 动作设置（卡片 ⋯ → 动作设置）。2026-10-23 按「改的是谁」分三层，每层只管自己那份：
 *
 *   做法 [窄握 ▾]                        单位 kg|lb
 *   ─ 这个动作 · 所有做法、所有馆共用
 *       名称 ›   部位 ›   记录哪些数（标签 + 自定义 + 恢复默认）
 *   ─ 做法「窄握」 · 只管这个做法          （只有标准时叫「器材与阻力」）
 *       器材 ›   阻力 ›                    ← 阻力是「自重」＝带正负记（原「负荷记法」并进来）
 *   ─ 在 X 的这一台 · 只改这里             （训练里从卡片打开才有）
 *       卡片把这台器械的设置 portal 进来；条件不够时卡片放一句缺什么
 *
 * 做法切换只换编辑对象，不换卡片上的做法。「这一台」只给卡片上正用的做法设（状态在卡片上）。
 * 每项都是点了就存，底栏只有「完成」。
 */
import React, { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, ChevronRight, Plus } from 'lucide-react';
import { Language } from '../../../types';
import { translations } from '../../../translations';
import { Modal } from '../Modal';
import { STANDARD_METRICS } from '../../constants/exercises';
import { useExercisePrefs } from '../../contexts/ExercisePrefsContext';
import { mergeOverride } from '../../utils/exerciseOverride';
import { regionList, variantAttrs } from '../../utils/exerciseAttrs';
import { ExerciseAttrFields, type AttrValue } from '../ExerciseAttrFields';

interface MetricSettingsModalProps {
  open: boolean;
  exerciseName: string | null;
  lang: Language;
  /** 记录项恢复默认（外面弹确认框） */
  onResetMetrics: () => Promise<void> | void;
  onClose: () => void;
  /** 改名：打开动作库里同一个改名弹窗。动作不在库里时不传 */
  onRename?: () => void;
  /** 部位（类型 / 部位 / 细分）：打开属性弹窗的「只改部位」版 */
  onEditPart?: () => void;
  /**
   * 训练里从卡片打开：卡片上正用的做法、这场的馆、是不是交替组。不传＝从动作库等处打开，没有「这一台」。
   */
  card?: { variantId?: string; gym?: string; group?: boolean };
  /** 「这一台」的挂载点：卡片把这台器械的设置行 portal 进来 */
  gymSlotRef?: (el: HTMLElement | null) => void;
  /** 从大图的小药丸进来：打开后滚到「这一台」 */
  focusGym?: boolean;
  /** 显示单位（全局，跟训练页顶上那个是同一个） */
  unit?: 'kg' | 'lbs';
  onToggleUnit?: () => void;
}

export const MetricSettingsModal: React.FC<MetricSettingsModalProps> = ({
  open,
  exerciseName,
  lang,
  onResetMetrics,
  onClose,
  onRename,
  onEditPart,
  card,
  gymSlotRef,
  focusGym,
  unit,
  onToggleUnit,
}) => {
  const {
    getActiveMetrics,
    toggleMetric,
    findExerciseDef,
    exerciseOverrides,
    variantsOf,
    attrsOf,
    getTagName,
    saveExerciseAttrs,
    setVariantAttrs,
    clearSignedLoad,
    signedLoadOf,
  } = useExercisePrefs();
  const isCn = lang === Language.CN;
  const isOpen = open && !!exerciseName;

  // 正在改的做法（undefined＝标准）。每次打开从卡片上正用的那个开始
  const [editing, setEditing] = useState<string | undefined>(undefined);
  const [menuOpen, setMenuOpen] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const [newCustom, setNewCustom] = useState('');
  const [shownFor, setShownFor] = useState<string | null>(null);
  const openKey = isOpen ? exerciseName : null;
  if (openKey !== shownFor) {
    setShownFor(openKey);
    setEditing(card?.variantId);
    setMenuOpen(false);
    setCustomOpen(false);
    setNewCustom('');
  }

  const gymRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!isOpen || !focusGym) return;
    // 卡片拿到挂载点后下一轮才渲染进来，弹窗还在进场动画里（滚了也被吞），所以等内容到了、动画过了再滚
    let tries = 0;
    let t = window.setTimeout(function tick() {
      const el = gymRef.current;
      if (el?.querySelector('.metric-gym-slot')?.childElementCount) el.scrollIntoView({ block: 'start', behavior: 'smooth' });
      else if (++tries < 10) t = window.setTimeout(tick, 60);
    }, 260);
    return () => window.clearTimeout(t);
  }, [isOpen, focusGym]);

  const name = exerciseName ?? '';
  const def = name ? findExerciseDef(name) : undefined;
  const merged = def ? mergeOverride(def, exerciseOverrides[def.id]) : undefined;
  const variants = merged ? variantsOf(name) : [];
  const v = editing ? variants.find(x => x.id === editing) : undefined;
  // 做法被删了（或从别处带进来的 id 认不出）：按标准
  const editingId = v?.id;
  const cardio = merged?.category === 'CARDIO';
  const activeMetrics = name ? getActiveMetrics(name) : [];
  const metricName = (m: string) => translations[m as keyof typeof translations]?.[lang] || m.replace('custom_', '');

  const partSummary = merged
    ? [merged.bodyPart ? getTagName(merged.bodyPart) : '', ...regionList(merged).map(getTagName)].filter(Boolean).join(' · ')
    : '';
  const variantLabel = (id: string | undefined) =>
    id ? variants.find(x => x.id === id)?.name ?? '' : isCn ? '标准' : 'Standard';

  /* ── 做法这一层：器材 / 阻力 ── */
  const exAttrs: AttrValue | null = merged
    ? {
        category: merged.category || 'STRENGTH',
        bodyPart: merged.bodyPart || '',
        regions: regionList(merged),
        equipment: merged.equipment ?? '',
        resistance: merged.resistance,
      }
    : null;
  const own = variantAttrs(v);
  const effective = merged ? attrsOf(merged, editingId) : null;
  const signedNow = name ? signedLoadOf({ name, variantId: editingId }) : false;
  const byResistance = effective?.resistance === 'bodyweight';
  const attrRows = cardio ? (['equipment'] as const) : (['equipment', 'resistance'] as const);

  const saveStandard = (nv: AttrValue) => {
    if (!def || !exAttrs) return;
    if (nv.equipment === exAttrs.equipment && nv.resistance === exAttrs.resistance) return;
    saveExerciseAttrs(def.id, { ...exAttrs, equipment: nv.equipment, resistance: nv.resistance });
    // 改了动作的器材 / 阻力：旧的「负荷记法」开关作废，以后跟着阻力走
    clearSignedLoad(name);
  };
  const saveVariant = (nv: AttrValue) => {
    if (!v) return;
    if (nv.equipment === (own?.equipment ?? '') && nv.resistance === own?.resistance) return;
    setVariantAttrs(name, v.id, nv.equipment, nv.resistance);
  };

  const sectionHead = (title: string, note?: string, aside?: React.ReactNode) => (
    <div className="metric-sec-head">
      <b>{title}</b>
      {note && <small>{note}</small>}
      {aside}
    </div>
  );

  /* ── 这一台 ── */
  const onCardVariant = (card?.variantId || undefined) === editingId;
  const gymNote = !card
    ? null
    : card.group
      ? isCn
        ? '交替组的卡片上没有重量大图，这台器械的刻度要在单独的卡片上设。'
        : 'Alternating cards have no load view; set this machine up on a single card.'
      : !onCardVariant
        ? isCn
          ? `这一台的设置跟着卡片上的做法（${variantLabel(card.variantId)}）。在卡片上换成「${variantLabel(editingId)}」再来设。`
          : `Machine settings follow the card's variant (${variantLabel(card.variantId)}). Switch the card to "${variantLabel(editingId)}" to set them.`
        : null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isCn ? '动作设置' : 'Exercise settings'}
      subtitle={exerciseName || undefined}
      size="sm"
      layer="modal-2"
      bodyClassName="overflow-y-auto max-h-[70vh] custom-scrollbar !pt-0"
      footer={
        <button
          type="button"
          onClick={onClose}
          data-testid="metric-modal-done"
          className="w-full min-h-[52px] rounded-control bg-accent text-on-accent font-semibold transition-opacity duration-tap ease-paper"
        >
          {isCn ? '完成' : 'Done'}
        </button>
      }
    >
      <div className="metric-modal">
        {/* 顶栏：改哪个做法 + 显示单位。随内容滚时钉在上面 */}
        {(variants.length > 0 || (card && onToggleUnit && !cardio)) && (
          <div className="metric-topbar">
            {variants.length > 0 && (
              <div className="relative">
                <button
                  type="button"
                  className="metric-variant-btn"
                  onClick={() => setMenuOpen(o => !o)}
                  aria-haspopup="listbox"
                  aria-expanded={menuOpen}
                  data-testid="settings-variant"
                >
                  <span className="text-tertiary font-normal">{isCn ? '做法' : 'Variant'}</span>
                  {variantLabel(editingId)}
                  <ChevronDown size={14} className="text-tertiary" />
                </button>
                {menuOpen && (
                  <div role="listbox" className="metric-variant-menu anim-reveal">
                    {[undefined, ...variants.map(x => x.id)].map(id => (
                      <button
                        key={id ?? ''}
                        type="button"
                        role="option"
                        aria-selected={id === editingId}
                        className={id === editingId ? 'is-on' : ''}
                        onClick={() => {
                          setEditing(id);
                          setMenuOpen(false);
                        }}
                      >
                        <Check size={14} className={id === editingId ? '' : 'invisible'} />
                        {variantLabel(id)}
                        {card && (card.variantId || undefined) === id && (
                          <small>{isCn ? '卡片正用' : 'On the card'}</small>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            {card && onToggleUnit && !cardio && (
              <span className="metric-unit">
                {isCn ? '单位' : 'Unit'}
                <span className="gym-seg" role="group" aria-label={isCn ? '重量单位' : 'Weight unit'} data-testid="sheet-unit">
                  {(['kg', 'lbs'] as const).map(k => (
                    <button
                      key={k}
                      type="button"
                      className={`min-h-[32px] px-3 text-small font-semibold ${unit === k ? 'seg-on' : 'text-secondary'}`}
                      aria-pressed={unit === k}
                      onClick={() => unit !== k && onToggleUnit()}
                    >
                      {k === 'kg' ? 'kg' : 'lb'}
                    </button>
                  ))}
                </span>
              </span>
            )}
          </div>
        )}

        {/* ── 第一层：这个动作 ── */}
        <section className="metric-sec">
          {sectionHead(isCn ? '这个动作' : 'This exercise', merged ? (isCn ? '所有做法、所有馆共用' : 'Every variant and gym') : undefined)}
          {onRename && (
            <button type="button" onClick={onRename} className="metric-prop" data-testid="settings-rename">
              <span className="k">{isCn ? '名称' : 'Name'}</span>
              <span className="v">{exerciseName}</span>
              <ChevronRight size={16} className="text-tertiary flex-shrink-0" />
            </button>
          )}
          {onEditPart && (
            <button type="button" onClick={onEditPart} className="metric-prop" data-testid="settings-edit-tags">
              <span className="k">{isCn ? '部位' : 'Part'}</span>
              <span className={`v ${partSummary ? '' : 'text-tertiary'}`}>{partSummary || (isCn ? '未设置' : 'None')}</span>
              <ChevronRight size={16} className="text-tertiary flex-shrink-0" />
            </button>
          )}

          <div className="metric-sub-head">
            <span>{isCn ? '记录哪些数' : 'Track'}</span>
            <button type="button" className="metric-link" onClick={onResetMetrics} data-testid="settings-reset-metrics">
              {isCn ? '恢复默认' : 'Reset'}
            </button>
          </div>
          <div className="flex flex-wrap gap-2" data-testid="settings-metrics">
            {Array.from(new Set([...STANDARD_METRICS, ...activeMetrics])).map(m => {
              const on = activeMetrics.includes(m);
              return (
                <button
                  key={m}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleMetric(name, m)}
                  className={`metric-chip ${on ? 'is-on' : ''}`}
                >
                  {on && <Check size={14} strokeWidth={2.5} />}
                  {metricName(m)}
                </button>
              );
            })}
            <button
              type="button"
              className="metric-chip is-add"
              aria-expanded={customOpen}
              onClick={() => setCustomOpen(o => !o)}
              data-testid="settings-add-metric"
            >
              <Plus size={14} />
              {isCn ? '自定义' : 'Custom'}
            </button>
          </div>
          {customOpen && (
            <form
              className="flex gap-2 mt-2"
              onSubmit={e => {
                e.preventDefault();
                const n = newCustom.trim();
                if (!n) return;
                toggleMetric(name, `custom_${n}`);
                setNewCustom('');
                setCustomOpen(false);
              }}
            >
              <input
                className="ui-input flex-1 min-w-0"
                placeholder={translations.dimensionPlaceholder[lang]}
                value={newCustom}
                onChange={e => setNewCustom(e.target.value)}
                aria-label={isCn ? '自定义记录项' : 'Custom metric'}
                autoFocus
              />
              <button type="submit" disabled={!newCustom.trim()} className="px-3 text-small font-bold text-accent disabled:opacity-40">
                {isCn ? '添加' : 'Add'}
              </button>
            </form>
          )}
        </section>

        {/* ── 第二层：做法（器材 / 阻力） ── */}
        {merged && exAttrs && effective && (
          <section className="metric-sec" data-testid="settings-variant-attrs">
            {variants.length === 0
              ? sectionHead(isCn ? '器材与阻力' : 'Gear & load')
              : editingId
                ? sectionHead(isCn ? `做法「${variantLabel(editingId)}」` : `Variant "${variantLabel(editingId)}"`, isCn ? '只管这个做法' : 'This variant only')
                : sectionHead(isCn ? '做法「标准」' : 'Variant "Standard"', isCn ? '＝动作本身，别的做法默认跟它走' : 'The exercise itself; others follow it')}
            {v ? (
              <ExerciseAttrFields
                key={v.id}
                lang={lang}
                flat
                rows={attrRows}
                variant={{ inherited: attrsOf(merged), regions: [] }}
                value={{ ...exAttrs, regions: [], equipment: own?.equipment ?? '', resistance: own?.resistance }}
                onChange={saveVariant}
              />
            ) : (
              <ExerciseAttrFields key="std" lang={lang} flat rows={attrRows} value={exAttrs} onChange={saveStandard} />
            )}
            {!cardio && (signedNow || byResistance) && (
              <p className="metric-note" data-testid="settings-signed-note">
                {signedNow === byResistance
                  ? isCn
                    ? '带正负记：辅助记负数，纯自重记 0，负重记正数。'
                    : 'Signed load: assisted is negative, bodyweight 0, weighted positive.'
                  : signedNow
                    ? isCn
                      ? '按以前的设置带正负记。改一下器材或阻力，就改成跟着阻力走。'
                      : 'Signed load from an older setting. Changing gear or load hands it back to the load type.'
                    : isCn
                      ? '按以前的设置记普通重量。改一下器材或阻力，就改成跟着阻力走。'
                      : 'Plain weight from an older setting. Changing gear or load hands it back to the load type.'}
              </p>
            )}
          </section>
        )}

        {/* ── 第三层：这一台（训练里从卡片打开才有；有氧没有器械刻度） ── */}
        {card && !cardio && (
          <section className="metric-sec" ref={gymRef} data-testid="settings-gym">
            {sectionHead(
              card.gym ? (isCn ? `在 ${card.gym} 的这一台` : `This machine at ${card.gym}`) : isCn ? '这一台器械' : 'This machine',
              isCn ? '只改这里' : 'Only here',
            )}
            {gymNote && <p className="metric-note">{gymNote}</p>}
            {/* 挂载点一直在（卡片的 portal 不用跟着做法切换重挂），不是卡片上的做法时藏起来 */}
            <div className="metric-gym-slot" hidden={!!gymNote} ref={gymSlotRef} />
          </section>
        )}
      </div>
    </Modal>
  );
};

export default MetricSettingsModal;
