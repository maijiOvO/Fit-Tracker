/**
 * 交替组＝一张卡（2026-10，demo：docs/demos/set-pointer-alternating.html）
 *
 * 几个动作交替着做（内收 ⇄ 外展）：组按轮换排成一列 —— 做完的按实际先后，待做的按轮换，
 * 从最后做完那组的下一个动作接着轮。组号前一个字的简称（「收」「展」），点它＝改记到组里另一个动作名下。
 * 全场还是一个指针，在这张卡里一行一行往下走。
 *
 * 改错一律低成本、可逆（合并 / 移出 / 拆开 / 换动作都不丢数据，所以不给撤销也不弹确认）：
 *   - 卡头动作名可点：左移 / 右移（只重排待做的组）、做法、备注、移出交替、从本场删除
 *   - ⋯：加一个动作（打开同一个添加动作弹层，加进这个组）、拆开
 *   - 卡底按动作分开的「＋ 动作名」：新的组插到轮换里该在的位置
 */
import React, { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, MoreHorizontal, Plus, Scissors, Shuffle, StickyNote, Trash2, LogOut, Settings as SettingsIcon } from 'lucide-react';
import { Exercise, Language, SetLog } from '../../types';
import { translations } from '../../translations';
import { SetCapsule } from './SetCapsule';
import { RestBookmark } from './RestBookmark';
import { VariantModal } from './modals/VariantModal';
import { useExercisePrefs } from '../contexts/ExercisePrefsContext';
import { getLoadMode, ledgerCols } from '../utils/exerciseConfig';
import { memberAbbrs, RowRef } from '../utils/workbench';
import { setVolumeKg } from '../utils/load';
import { haptic, H } from '../utils/haptics';
import { plural } from '../utils/format';

interface Props {
  cardKey: string;
  cardNo: number;
  members: Exercise[];
  rows: RowRef[];
  lang: Language;
  unit: string;
  exerciseNotes: Record<string, string>;
  getActiveMetrics: (name: string) => string[];
  resolveName: (name: string) => string;
  /** 这个动作在这场是不是按带正负的负荷记 */
  isSigned: (ex: Exercise) => boolean;
  pointerGap: number | null;
  onMovePointer: (cardKey: string, gap: number) => void;
  selectedSetId: string | null;
  onNumTap: (r: RowRef) => void;
  onSetUpdate: (r: RowRef, updates: Partial<SetLog>) => void;
  onRemoveSet: (r: RowRef) => void;
  onRemoveSubSet: (r: RowRef, subIdx: number) => void;
  onAddSet: (exId: string) => void;
  onMoveMember: (exId: string, dir: -1 | 1) => void;
  onRemoveMember: (exId: string) => void;
  onDeleteMember: (exId: string) => void;
  onSplit: () => void;
  onAddMember: () => void;
  onSwitchRowExercise: (r: RowRef, toExId: string) => void;
  onSwitchVariant: (exId: string, variantId: string | undefined, name?: string) => void;
  onToggleNote: (name: string) => void;
  onOpenMetricModal: (name: string, exId: string) => void;
  onOpenTimePicker: (exId: string, setId: string, seconds: number) => void;
  dragHandle?: {
    handlers: React.DOMAttributes<HTMLElement>;
    pressing: boolean;
    hinting: boolean;
    drawMs: number;
  };
}

const panelBtn =
  'w-full min-h-[48px] px-4 rounded-card bg-card border border-divider text-sm font-bold text-primary flex items-center gap-2.5 active:bg-card-hover transition-colors disabled:opacity-40';

/** 底部面板（同添加动作弹层里的动作面板：bg-inset + 全宽 bg-card 描边按钮） */
const Panel: React.FC<{ title: string; subtitle?: string; onClose: () => void; cancel: string; children: React.ReactNode; testId?: string }> = ({
  title,
  subtitle,
  onClose,
  cancel,
  children,
  testId,
}) => (
  <div className="fixed inset-0 z-[90] bg-scrim flex items-end sm:items-center justify-center anim-fade" onClick={onClose} data-testid={testId}>
    <div
      className="bg-inset border-t sm:border border-divider w-full sm:max-w-sm max-h-[88%] overflow-y-auto rounded-t-sheet sm:rounded-card p-4 space-y-2 shadow-2xl"
      style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}
      onClick={e => e.stopPropagation()}
    >
      <p className="px-2 pb-1 text-sm font-semibold text-primary">
        {title}
        {subtitle && <span className="block text-xs font-medium text-tertiary">{subtitle}</span>}
      </p>
      {children}
      <button
        type="button"
        onClick={onClose}
        className="w-full min-h-[48px] px-4 rounded-card text-sm font-bold text-secondary flex items-center justify-center active:bg-card-hover transition-colors"
      >
        {cancel}
      </button>
    </div>
  </div>
);

export const AlternatingCard: React.FC<Props> = ({
  cardKey,
  cardNo,
  members,
  rows,
  lang,
  unit,
  exerciseNotes,
  getActiveMetrics,
  resolveName,
  isSigned,
  pointerGap,
  onMovePointer,
  selectedSetId,
  onNumTap,
  onSetUpdate,
  onRemoveSet,
  onRemoveSubSet,
  onAddSet,
  onMoveMember,
  onRemoveMember,
  onDeleteMember,
  onSplit,
  onAddMember,
  onSwitchRowExercise,
  onSwitchVariant,
  onToggleNote,
  onOpenMetricModal,
  onOpenTimePicker,
  dragHandle,
}) => {
  const isCn = lang === Language.CN;
  const { variantLabel } = useExercisePrefs();
  const names = members.map(m => resolveName(m.name));
  const abbrs = memberAbbrs(names);
  const byId = new Map<string, Exercise>(members.map(m => [m.id, m] as [string, Exercise]));
  const idx = (id: string) => members.findIndex(m => m.id === id);

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const [memberFor, setMemberFor] = useState<string | null>(null);
  const [badgeFor, setBadgeFor] = useState<RowRef | null>(null);
  const [variantFor, setVariantFor] = useState<string | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [menuOpen]);

  // 表头按第一个成员的记录项（成员记录项不同时各行自己按自己的列宽排）
  const headMetrics = getActiveMetrics(names[0] ?? '');
  const cols = ledgerCols(headMetrics.length, 58);

  const setOf = (r: RowRef) => byId.get(r.exId)?.sets.find(s => String(s.id) === r.setId);
  const done = rows.filter(r => setOf(r) && !setOf(r)!.ghost).length;
  const planned = rows.filter(r => setOf(r) && !setOf(r)!.skipped).length;
  const volume = members.reduce((n, ex) => n + ex.sets.reduce((v, s) => (s.ghost ? v : v + setVolumeKg(s, ex)), 0), 0);
  const volText = (() => {
    const v = unit === 'lbs' ? volume * 2.20462 : volume;
    if (v <= 0) return '—';
    if (v >= 1000) return `${(v / 1000).toFixed(1)}${unit === 'lbs' ? 'k' : 't'}`;
    return `${Math.round(v)}${unit}`;
  })();

  const counter = new Map<string, number>();
  const notes = members.filter(m => exerciseNotes[resolveName(m.name)]);
  const menuItem =
    'w-full min-h-[44px] px-4 flex items-center gap-3 text-left text-body text-primary active:bg-card-hover';
  const memberEx = memberFor ? byId.get(memberFor) : undefined;

  return (
    <div className="ui-card p-0 overflow-visible" style={{ ['--cols' as string]: cols }} data-alt-card={cardKey}>
      <div className="masthead-rule relative px-3 pt-4 pb-2.5 touch-pan-y" {...(dragHandle?.handlers ?? {})}>
        <div className="flex items-baseline gap-3">
          <h3 className="font-display text-h2 text-primary leading-snug flex-1 min-w-0 break-words">
            {members.map((m, i) => (
              <React.Fragment key={m.id}>
                {i > 0 && <span className="text-tertiary font-sans font-medium mx-1">⇄</span>}
                <button
                  type="button"
                  onClick={() => setMemberFor(m.id)}
                  className="marginalia"
                  data-testid="alt-member"
                >
                  {names[i]}
                  {variantLabel(m) && <span className="text-accent text-label font-sans font-medium ml-1">{variantLabel(m)}</span>}
                </button>
              </React.Fragment>
            ))}
          </h3>
          <div className="relative -mr-1 -my-2" ref={menuRef}>
            <button
              type="button"
              onClick={() => {
                haptic(H.tap);
                setMenuOpen(o => !o);
              }}
              className="w-11 h-11 flex items-center justify-center text-tertiary rounded-control active:bg-card-hover"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-label={isCn ? '交替组菜单' : 'Group menu'}
              data-testid="alt-menu"
            >
              <MoreHorizontal size={20} strokeWidth={1.75} />
            </button>
            {menuOpen && (
              <div role="menu" className="anim-reveal absolute right-0 top-full z-20 mt-1 w-48 py-1 bg-card border border-divider rounded-card shadow-overlay">
                <button
                  type="button"
                  role="menuitem"
                  className={menuItem}
                  onClick={() => {
                    setMenuOpen(false);
                    onAddMember();
                  }}
                  data-testid="alt-add-member"
                >
                  <Plus size={16} strokeWidth={1.75} className="text-tertiary" />
                  {isCn ? '加一个动作' : 'Add an exercise'}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className={menuItem}
                  onClick={() => {
                    setMenuOpen(false);
                    onSplit();
                  }}
                  data-testid="alt-split"
                >
                  <Scissors size={16} strokeWidth={1.75} className="text-tertiary" />
                  {isCn ? '拆开' : 'Split'}
                </button>
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-4 mt-1.5">
          <span className="text-label font-medium text-accent">{isCn ? '交替' : 'Alternating'}</span>
          <span className="ml-auto font-mono text-label text-tertiary tabular-nums whitespace-nowrap">
            {isCn ? `第${cardNo}个` : `#${cardNo}`} · <span className="text-primary font-semibold">{done}</span>
            {done < planned && <span className="opacity-80">/{planned}</span>}
            {isCn ? '组' : ` ${plural(done < planned ? planned : done, 'set')}`} · {volText}
          </span>
        </div>
      </div>

      {notes.map(m => (
        <button
          key={m.id}
          type="button"
          onClick={() => onToggleNote(resolveName(m.name))}
          className="w-full text-left px-3 py-2 bg-highlight-soft text-label text-primary flex items-start gap-2"
        >
          <StickyNote size={13} className="mt-0.5 flex-shrink-0 text-warning" strokeWidth={1.75} />
          <span>
            <b className="font-semibold">{abbrs[idx(m.id)]}</b> · {exerciseNotes[resolveName(m.name)]}
          </span>
        </button>
      ))}

      <div className="grid items-center px-3 pt-2.5 pb-1 text-micro font-medium text-tertiary" style={{ gridTemplateColumns: cols }}>
        <span>#</span>
        {headMetrics.map(m => (
          <span key={m} className="text-center">
            {translations[m as keyof typeof translations]?.[lang] || m.replace('custom_', '')}
          </span>
        ))}
        <span className="text-center">{isCn ? '竭' : 'F'}</span>
        <span />
      </div>

      <div className="ledger-paper" data-ledger-paper={cardKey} data-ex-name={names.join(' ⇄ ')}>
        {pointerGap === 0 && <RestBookmark lang={lang} onMove={onMovePointer} />}
        {rows.map((r, i) => {
          const ex = byId.get(r.exId);
          const set = setOf(r);
          if (!ex || !set) return null;
          const n = (counter.get(r.exId) ?? 0) + 1;
          counter.set(r.exId, n);
          const exName = names[idx(r.exId)];
          const metrics = getActiveMetrics(exName);
          return (
            <React.Fragment key={r.setId}>
              <SetCapsule
                set={set}
                setIdx={i}
                displayNo={n}
                activeMetrics={metrics}
                loadMode={getLoadMode(ex)}
                unit={unit}
                lang={lang}
                firstCol={58}
                badge={{
                  label: abbrs[idx(r.exId)],
                  title: isCn ? `${exName} · 改记到别的动作` : `${exName} · move to another exercise`,
                  onClick: () => setBadgeFor(r),
                }}
                selected={selectedSetId === r.setId}
                onNumTap={() => onNumTap(r)}
                signed={isSigned(ex) ? { sign: () => (getLoadMode(ex) === 'assisted' ? -1 : 1) } : undefined}
                onUpdate={u => onSetUpdate(r, u)}
                onRemove={() => onRemoveSet(r)}
                onRemoveSub={sub => onRemoveSubSet(r, sub)}
                onDurationClick={() => onOpenTimePicker(r.exId, r.setId, set.duration || 0)}
              />
              {pointerGap === i + 1 && <RestBookmark lang={lang} onMove={onMovePointer} />}
            </React.Fragment>
          );
        })}
      </div>

      <div className="p-3 pt-2 flex gap-2">
        {members.map((m, i) => (
          <button
            key={m.id}
            type="button"
            onClick={() => {
              haptic(H.tap);
              onAddSet(m.id);
            }}
            className="flex-1 min-w-0 min-h-[44px] border border-dashed border-divider rounded-control text-secondary font-medium flex items-center justify-center gap-1.5 transition-colors duration-tap ease-paper active:bg-card-hover"
            data-testid="alt-add-set"
          >
            <Plus size={15} strokeWidth={1.75} className="flex-none" />
            <span className="truncate">{members.length > 2 ? abbrs[i] : names[i]}</span>
          </button>
        ))}
      </div>

      {memberEx && memberFor && (
        <Panel
          title={resolveName(memberEx.name)}
          subtitle={isCn ? `交替组里的第 ${idx(memberFor) + 1} 个 · 共 ${members.length} 个` : `${idx(memberFor) + 1} of ${members.length}`}
          onClose={() => setMemberFor(null)}
          cancel={isCn ? '取消' : 'Cancel'}
          testId="alt-member-panel"
        >
          <div className="flex gap-2">
            <button
              type="button"
              className={`${panelBtn} justify-center`}
              disabled={idx(memberFor) === 0}
              onClick={() => onMoveMember(memberFor, -1)}
            >
              <ChevronLeft size={16} /> {isCn ? '左移' : 'Left'}
            </button>
            <button
              type="button"
              className={`${panelBtn} justify-center`}
              disabled={idx(memberFor) === members.length - 1}
              onClick={() => onMoveMember(memberFor, 1)}
            >
              {isCn ? '右移' : 'Right'} <ChevronRight size={16} />
            </button>
          </div>
          <button
            type="button"
            className={panelBtn}
            onClick={() => {
              setVariantFor(memberFor);
              setMemberFor(null);
            }}
          >
            <Shuffle size={16} className="text-accent" />
            {isCn ? '做法' : 'Variant'}
            {variantLabel(memberEx) && <span className="ml-auto text-xs text-tertiary">{variantLabel(memberEx)}</span>}
          </button>
          <button
            type="button"
            className={panelBtn}
            onClick={() => {
              setMemberFor(null);
              onToggleNote(resolveName(memberEx.name));
            }}
          >
            <StickyNote size={16} className="text-accent" />
            {isCn ? '备注' : 'Note'}
          </button>
          <button
            type="button"
            className={panelBtn}
            onClick={() => {
              setMemberFor(null);
              onOpenMetricModal(resolveName(memberEx.name), memberEx.id);
            }}
          >
            <SettingsIcon size={16} className="text-accent" />
            {isCn ? '动作设置' : 'Settings'}
          </button>
          <button
            type="button"
            className={panelBtn}
            onClick={() => {
              setMemberFor(null);
              onRemoveMember(memberFor);
            }}
            data-testid="alt-remove-member"
          >
            <LogOut size={16} className="text-accent" />
            {isCn ? '移出交替' : 'Take out of the group'}
          </button>
          <button
            type="button"
            onClick={() => {
              setMemberFor(null);
              onDeleteMember(memberFor);
            }}
            className="w-full min-h-[48px] px-4 rounded-card bg-danger/10 text-sm font-bold text-danger flex items-center gap-2.5 active:bg-danger/20 transition-colors"
          >
            <Trash2 size={16} />
            {isCn ? '从本场删除' : 'Remove from this workout'}
          </button>
        </Panel>
      )}

      {badgeFor && (
        <Panel title={isCn ? '这一组记到' : 'This set belongs to'} onClose={() => setBadgeFor(null)} cancel={isCn ? '取消' : 'Cancel'} testId="alt-badge-panel">
          {members.map((m, i) => {
            const on = m.id === badgeFor.exId;
            return (
              <button
                key={m.id}
                type="button"
                className={`${panelBtn}${on ? ' border-accent text-accent' : ''}`}
                onClick={() => {
                  const r = badgeFor;
                  setBadgeFor(null);
                  if (!on) onSwitchRowExercise(r, m.id);
                }}
              >
                <span className="w-5 text-center text-secondary">{abbrs[i]}</span>
                {names[i]}
                {on && <span className="ml-auto text-xs font-semibold text-tertiary">{isCn ? '当前' : 'Current'}</span>}
              </button>
            );
          })}
        </Panel>
      )}

      {variantFor && byId.get(variantFor) && (
        <VariantModal
          open
          lang={lang}
          exerciseName={byId.get(variantFor)!.name}
          currentVariantId={byId.get(variantFor)!.variantId}
          onSelect={(v, name) => onSwitchVariant(variantFor, v, name)}
          onClose={() => setVariantFor(null)}
        />
      )}
    </div>
  );
};

export default AlternatingCard;
