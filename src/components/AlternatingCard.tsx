/**
 * 交替组＝一张卡（2026-10，demo：docs/demos/set-pointer-alternating.html）
 *
 * 几个动作交替着做（内收 ⇄ 外展）：组按轮换排成一列 —— 做完的按实际先后，待做的按轮换，
 * 从最后做完那组的下一个动作接着轮。组号前一个字的简称（「收」「展」），点它＝改记到组里另一个动作名下。
 * 全场还是一个指针，在这张卡里一行一行往下走。
 *
 * 改错一律低成本、可逆（合并 / 移出 / 拆开 / 换动作都不丢数据，所以不弹确认，点错走顶栏全局撤销）：
 *   - 卡头动作名可点：左移 / 右移（只重排待做的组）、重命名、做法、备注、移出交替、从本场删除
 *   - ⋯：加一个动作（打开同一个添加动作弹层，加进这个组）、拆开
 *   - 卡底按动作分开的「＋ 动作名」：新的组插到轮换里该在的位置
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MachineFace, MachineMissingNote, RigChips, rigLabel } from './PlateGlyph';
import { ALT_RIG, useMachineSettings } from '../hooks/useMachineSettings';
import { useBackClose } from '../hooks/useBackClose';
import { ChevronLeft, ChevronRight, MoreHorizontal, Plus, Scissors, Shuffle, StickyNote, Trash2, LogOut, Settings as SettingsIcon, RotateCcw } from 'lucide-react';
import { Exercise, Language, SetLog } from '../../types';
import { translations } from '../../translations';
import { SetCapsule } from './SetCapsule';
import { restoreKgOf, restoreUpdate } from '../utils/setWrite';
import { RestBookmark } from './RestBookmark';
import { LongPressAffordance } from './LongPressAffordance';
import { VariantModal } from './modals/VariantModal';
import { useExercisePrefs } from '../contexts/ExercisePrefsContext';
import { gymMachineKey, useLoadInfoOf } from '../hooks/useLoadKind';
import { useUserSettingsContext } from '../contexts/UserSettingsContext';
import { useLoadRounder } from '../hooks/useLoadRounder';
import { getLoadMode, ledgerCols, metricUnitLabel } from '../utils/exerciseConfig';
import { carrySign, memberAbbrs, memberKeys, RowRef } from '../utils/workbench';
import { setVolumeKg, signedKg } from '../utils/load';
import { formatLoad, lastSetLine } from '../utils/liftDisplay';
import { prSetIndex, type PRPool } from './ExerciseCard';
import { haptic, H } from '../utils/haptics';
import { monthDay } from '../utils/dateUtils';
import { formatVolume, plural } from '../utils/format';

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
  /** 改名：动作库里找得到这个动作才有（同单卡「⋯」里的重命名），返回 undefined 就不显示 */
  onSplit: () => void;
  onAddMember: () => void;
  onSwitchRowExercise: (r: RowRef, toExId: string) => void;
  onSwitchVariant: (exId: string, variantId: string | undefined, name?: string) => void;
  /** 删掉一个做法时：工作台上正用着它的卡当场回到标准（NewWorkoutTab 实现；计划编辑器里不传） */
  onVariantRemoved?: (exerciseName: string, variantId: string) => void;
  onToggleNote: (name: string, gymKey?: string) => void;
  /** focus 'gym'：打开后滚到「这一台」那一段（成员面板里点选中的那台进来） */
  onOpenMetricModal: (name: string, exId: string, focus?: 'gym') => void;
  /** 动作设置弹窗开着、改的是这个成员：弹窗里「这一台」的挂载点，成员把器械设置行 portal 进去（单卡是 settingsSlot） */
  settingsFor?: { exId: string; el: HTMLElement | null } | null;
  /** 「这一台」改了刻度之后，把这个成员没做完、没改过的组吸到新刻度上 */
  onUpdateMemberSets: (exId: string, sets: SetLog[]) => void;
  onOpenTimePicker: (exId: string, setId: string) => void;
  /** 这一场训练记的馆：组行的 ± / 拖动 / 递减档按这个馆的档案走（各动作各按各的器材） */
  gym?: string;
  /** 每个成员上次那一场（成员面板里的参考行，同单卡「参考 · 上次」） */
  lastSessionFor?: (ex: Exercise) => { date: string; sets: SetLog[] } | null;
  /** 训练中标 PB：每个成员按自己的历史判（同单卡）；编辑旧训练不传 */
  prPoolFor?: (ex: Exercise) => PRPool;
  dragHandle?: {
    handlers: React.DOMAttributes<HTMLElement>;
    pressing: boolean;
    hinting: boolean;
    drawMs: number;
  };
}

export const panelBtn =
  'w-full min-h-[48px] px-4 rounded-card bg-card border border-divider text-small font-bold text-primary flex items-center gap-2.5 active:bg-card-hover transition-colors disabled:opacity-40';

/** 底部面板（同添加动作弹层里的动作面板：bg-inset + 全宽 bg-card 描边按钮）；训练页「和…交替做」也用它 */
export const Panel: React.FC<{ title: string; subtitle?: string; onClose: () => void; cancel: string; children: React.ReactNode; testId?: string }> = ({
  title,
  subtitle,
  onClose,
  cancel,
  children,
  testId,
}) => {
  // 只在开着时渲染：挂上就登记一层，返回键先关它
  useBackClose(true, onClose);
  // 自己 portal 到 body：会被渲染进训练页 anim-tab-enter 的 transform 包装层（§7.1），就地渲染时 fixed 按整页定位、
  // 还被 z-40 的底栏压住（点「取消」会点中底栏）
  return createPortal(
    <div className="fixed inset-0 z-[90] bg-scrim flex items-end sm:items-center justify-center anim-fade" onClick={onClose} data-testid={testId}>
      <div
        className="bg-inset border-t sm:border border-divider w-full sm:max-w-sm max-h-[88%] overflow-y-auto rounded-t-sheet sm:rounded-card p-4 space-y-2 shadow-overlay"
        style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}
        onClick={e => e.stopPropagation()}
      >
        <p className="px-2 pb-1 text-small font-semibold text-primary">
          {title}
          {subtitle && <span className="block text-xs font-medium text-tertiary">{subtitle}</span>}
        </p>
        {children}
        <button
          type="button"
          onClick={onClose}
          className="w-full min-h-[48px] px-4 rounded-card text-small font-bold text-secondary flex items-center justify-center active:bg-card-hover transition-colors"
        >
          {cancel}
        </button>
      </div>
    </div>,
    document.body,
  );
};

/**
 * 交替组成员的「这一台」（审查 B7）：卡上没有重量大图，一个成员一份 useMachineSettings，常驻挂着——
 *   - 卡上写明眼下用的哪一台（存过几台、有得选时才写）
 *   - 成员面板里一排药丸，一点就切；点选中的那台＝打开动作设置、滚到「这一台」
 *   - 动作设置开着、改的是这个成员时，把器械设置行（或缺什么的说明）portal 进弹窗
 * 常驻也让别的卡改了同一台时这里跟着吸（同单卡，审查 B8）。独立成组件是因为 hook 不能按条件调。
 */
const MemberRig: React.FC<{
  member: Exercise;
  abbr: string;
  gym?: string;
  signed: boolean;
  isCn: boolean;
  activeMetrics: string[];
  /** 成员面板开着、开的是这个成员：药丸排的挂载点 */
  chipSlot: HTMLElement | null;
  /** 动作设置开着、改的是这个成员：「这一台」的挂载点 */
  settingsEl: HTMLElement | null;
  onOpenPanel: () => void;
  onOpenSettings: () => void;
  onSets: (sets: SetLog[]) => void;
}> = ({ member, abbr, gym, signed, isCn, activeMetrics, chipSlot, settingsEl, onOpenPanel, onOpenSettings, onSets }) => {
  const ms = useMachineSettings(member, gym, signed, onSets);
  const hasWeight = activeMetrics.includes('weight');
  const hasSet = member.sets.length > 0;
  const ctl = hasWeight && hasSet ? ms.machineCtl(settingsEl, onOpenSettings) : undefined;
  const rigs = ctl?.rigs;
  const sel = rigs?.list.find(r => r.id === rigs.sel);
  // 只有默认（和那枚另一种单位的候选）时没得选，不占卡面
  const choice = !!rigs && rigs.list.some(r => r.id !== '' && r.id !== ALT_RIG);
  return (
    <>
      {choice && sel && (
        <button type="button" onClick={onOpenPanel} className="marginalia text-label text-tertiary whitespace-nowrap" data-testid="alt-member-rig">
          {abbr} · {rigLabel(sel, ms.loadKind, isCn)}
        </button>
      )}
      {chipSlot && rigs && createPortal(
        <RigChips kind={ms.loadKind} isCn={isCn} list={rigs.list} sel={rigs.sel} onPick={rigs.onPick} onEdit={onOpenSettings} />,
        chipSlot,
      )}
      {settingsEl && createPortal(
        ctl && ms.rounder ? (
          <div className="stack-face is-sheet" role="group" aria-label={isCn ? '这台器械' : 'This machine'} data-testid="stack-menu">
            <MachineFace kind={ms.loadKind} unit={ms.rounder.display} isCn={isCn} rounder={ms.rounder} machine={ctl} />
          </div>
        ) : (
          <MachineMissingNote isCn={isCn} hasWeight={hasWeight} gym={gym} hasSet={hasSet} loadKind={ms.loadKind} />
        ),
        settingsEl,
      )}
    </>
  );
};

/** 交替组组行的首列宽（简称叠在组号上方） */
const ALT_FIRST_COL = 44;

/** 包了 memo（审查 F4，同 ExerciseCard）：回调要身份稳定；isSigned / lastSessionFor / prPoolFor 渲染时就调，必须传它们本身 */
export const AlternatingCard = React.memo(function AlternatingCard({
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
  onVariantRemoved,
  onToggleNote,
  onOpenMetricModal,
  settingsFor,
  onUpdateMemberSets,
  onOpenTimePicker,
  gym,
  lastSessionFor,
  prPoolFor,
  dragHandle,
}: Props) {
  const isCn = lang === Language.CN;
  const rounderFor = useLoadRounder();
  const { variantLabel, variantIdOf, liftKey } = useExercisePrefs();
  // 「杠铃片」§3：组行的拖动步长 / 方向和迷你配片跟着各自的器材走（交替组不画顶部大图）
  const loadInfoOf = useLoadInfoOf();
  const loadKindOf = (ex: Exercise, signed: boolean) => loadInfoOf(ex, signed, gym).kind;
  // 本馆备注（「换馆重量」B）：每个成员按自己的「馆|动作|做法」取
  const { appPrefs } = useUserSettingsContext();
  const gymKeyOf = (ex: Exercise) => gymMachineKey(gym, loadInfoOf(ex, isSigned(ex), gym)) ?? undefined;
  const gymNoteOf = (ex: Exercise) => {
    const k = gymKeyOf(ex);
    return k ? appPrefs.gymNotes[k] : undefined;
  };
  // names：按动作存的（记录项、备注、动作设置）；labels：认成员用的，同名的（§12.10 左右分记）带做法，简称、菜单、改记面板写明是哪一边（审查 gap-4#2）
  const names = members.map(m => resolveName(m.name));
  const labels = memberKeys(members, m => resolveName(m.name), liftKey);
  const abbrs = memberAbbrs(labels);
  const byId = new Map<string, Exercise>(members.map(m => [m.id, m]));
  const idx = (id: string) => members.findIndex(m => m.id === id);

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useBackClose(menuOpen, () => setMenuOpen(false));
  const [memberFor, setMemberFor] = useState<string | null>(null);
  // 成员面板里药丸排的挂载点（MemberRig portal 进来）
  const [chipSlot, setChipSlot] = useState<HTMLElement | null>(null);
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
  // 首列：简称叠在组号上方，44px 放得下两个字 / 五个字母（原来简称在左边，要 58px）
  const cols = ledgerCols(headMetrics.length, ALT_FIRST_COL);

  const setOf = (r: RowRef) => byId.get(r.exId)?.sets.find(s => String(s.id) === r.setId);
  const done = rows.filter(r => setOf(r) && !setOf(r)!.ghost).length;
  const planned = rows.filter(r => setOf(r)).length;
  const volume = members.reduce((n, ex) => n + ex.sets.reduce((v, s) => (s.ghost ? v : v + setVolumeKg(s, ex)), 0), 0);
  const volText = formatVolume(volume, unit);

  /**
   * 每个成员破了纪录的那一组（同单卡 prSetIndex，一个动作至多一组）。交替着做不该看不到 PB（审查 A7）
   */
  const prSetId = useMemo(() => {
    const out = new Map<string, string>();
    if (prPoolFor) {
      for (const m of members) {
        const at = prSetIndex(m, prPoolFor(m));
        if (at >= 0 && m.sets[at]) out.set(m.id, String(m.sets[at].id));
      }
    }
    return out;
  }, [members, prPoolFor]);
  /** 成员的组行按什么单位写：器械有自己的单位就按它（D1，同单卡），否则顶栏 */
  const unitOf = (m: Exercise): 'kg' | 'lbs' => rounderFor(m, gym)?.display ?? (unit === 'lbs' ? 'lbs' : 'kg');
  /** 成员上次那一场：「上次 10/4 · 60×8、60×8 kg」（递减档不展开，详情在单卡和历史里）；单位同这个成员的组行 */
  const lastLineOf = (m: Exercise): string | null => {
    const last = lastSessionFor?.(m);
    if (!last) return null;
    const d = new Date(last.date);
    const signed = isSigned(m);
    const u = unitOf(m);
    // 只写记录项里有的（审查 gap-5#6，同单卡）
    const metrics = getActiveMetrics(resolveName(m.name));
    const sets = last.sets.map(s => lastSetLine(formatLoad(signedKg(s, m), u, signed, isCn), s, metrics, u, lang)).join(isCn ? '、' : ', ');
    return `${isCn ? '上次' : 'Last'} ${monthDay(d, isCn)} · ${sets}${metrics.includes('weight') ? ` ${u === 'lbs' ? 'lb' : 'kg'}` : ''}`;
  };

  const counter = new Map<string, number>();
  const restorable = rows.flatMap(r => {
    const ex = byId.get(r.exId);
    const set = setOf(r);
    if (!ex || !set?.ghost) return [];
    const rd = rounderFor(ex, gym);
    const signed = isSigned(ex);
    const kg = restoreKgOf(set, signed ? carrySign(ex, set) : 1, rd ? rd.display : unit, rd?.snapKg);
    return kg === undefined ? [] : [{ r, set, kg, signed }];
  });
  const notes =members.filter(m => exerciseNotes[resolveName(m.name)] || gymNoteOf(m));
  const menuItem =
    'w-full min-h-[44px] px-4 flex items-center gap-3 text-left text-body text-primary active:bg-card-hover';
  const memberEx = memberFor ? byId.get(memberFor) : undefined;

  return (
    <div className="ui-card p-0 overflow-visible" style={{ ['--cols' as string]: cols }} data-alt-card={cardKey}>
      <div className="masthead-rule relative px-3 pt-4 pb-2.5 touch-pan-y" {...(dragHandle?.handlers ?? {})}>
        {/* 和单卡一样：长按拖排序要自我解释（原来交替卡挂了手势却没画进度线，2026-10-11） */}
        {dragHandle && (
          <LongPressAffordance
            active={dragHandle.pressing}
            hint={dragHandle.hinting}
            label={isCn ? '拖动排序' : 'Drag to reorder'}
            hintLabel={isCn ? '按住拖动排序' : 'Hold to reorder'}
            drawMs={dragHandle.drawMs}
            placement="down"
          />
        )}
        <div className="flex items-baseline gap-3">
          <h3 className="title-face text-xl text-primary leading-tight flex-1 min-w-0 break-words">
            {members.map((m, i) => (
              <React.Fragment key={m.id}>
                {i > 0 && <span className="text-tertiary font-sans font-medium mx-1">⇄</span>}
                {/* data-reorder-ok：按满也能拖排序（短按照常开成员面板，见 useCardReorder 文件头） */}
                <button
                  type="button"
                  onClick={() => setMemberFor(m.id)}
                  className="marginalia"
                  data-testid="alt-member"
                  data-reorder-ok
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
                {/* 每个成员一行直达它的面板（做法 / 备注 / 动作设置 / 移出 / 删除）：原来只能点标题里的动作名，看不出能点（2026-11-02） */}
                {members.map((m, i) => (
                  <button
                    key={m.id}
                    type="button"
                    role="menuitem"
                    className={menuItem}
                    onClick={() => {
                      setMenuOpen(false);
                      setMemberFor(m.id);
                    }}
                    data-testid="alt-member-settings"
                  >
                    <SettingsIcon size={16} strokeWidth={1.75} className="text-tertiary flex-shrink-0" />
                    <span className="min-w-0 truncate">{isCn ? `设置 · ${labels[i]}` : `Set up ${labels[i]}`}</span>
                  </button>
                ))}
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
            {done < planned && <span className="text-tertiary">/{planned}</span>}
            {isCn ? '组' : ` ${plural(done < planned ? planned : done, 'set')}`} · {volText}
          </span>
        </div>
        {/* 各成员眼下用的哪一台（有得选时才写，见 MemberRig）；点开成员面板切 */}
        <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1 empty:hidden">
          {members.map((m, i) => (
            <MemberRig
              key={m.id}
              member={m}
              abbr={abbrs[i]}
              gym={gym}
              signed={isSigned(m)}
              isCn={isCn}
              activeMetrics={getActiveMetrics(names[i])}
              chipSlot={memberFor === m.id ? chipSlot : null}
              settingsEl={settingsFor?.exId === m.id ? settingsFor.el : null}
              onOpenPanel={() => setMemberFor(m.id)}
              onOpenSettings={() => {
                setMemberFor(null);
                onOpenMetricModal(names[i], m.id, 'gym');
              }}
              onSets={sets => onUpdateMemberSets(m.id, sets)}
            />
          ))}
        </div>
      </div>

      {notes.map(m => (
        <button
          key={m.id}
          type="button"
          onClick={() => onToggleNote(resolveName(m.name), gymKeyOf(m))}
          className="w-full text-left px-3 py-2 bg-highlight-soft border-l-2 border-highlight text-label text-primary flex items-start gap-2"
        >
          <StickyNote size={13} className="mt-0.5 flex-shrink-0 text-tertiary" strokeWidth={1.75} />
          <span>
            <b className="font-semibold">{abbrs[idx(m.id)]}</b> ·{' '}
            {[gymNoteOf(m) ? `${gym} · ${gymNoteOf(m)}` : '', exerciseNotes[resolveName(m.name)] ?? ''].filter(Boolean).join(' / ')}
          </span>
        </button>
      ))}

      <div className="grid items-center px-3 pt-2.5 pb-1 text-micro font-medium text-tertiary" style={{ gridTemplateColumns: cols }}>
        <span>#</span>
        {headMetrics.map(m => {
          // 列名让出单位宽，落在数字正上方（同 ExerciseCard 表头）；单位按第一个成员（同表头的记录项）
          const u = metricUnitLabel(m, members[0] ? unitOf(members[0]) : unit, isCn);
          return (
            <span
              key={m}
              className="text-center"
              style={u ? { paddingRight: `${Math.max(20, u.length * 6.5 + 4)}px` } : undefined}
            >
              {translations[m as keyof typeof translations]?.[lang] || m.replace('custom_', '')}
            </span>
          );
        })}
        <span className="text-center">{isCn ? '竭' : 'F'}</span>
        <span />
      </div>

      <div className="ledger-paper" data-ledger-paper={cardKey} data-ex-name={labels.join(' ⇄ ')}>
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
                firstCol={ALT_FIRST_COL}
                badge={{
                  label: abbrs[idx(r.exId)],
                  title: isCn ? `${labels[idx(r.exId)]} · 改记到别的动作` : `${labels[idx(r.exId)]} · move to another exercise`,
                  onClick: () => setBadgeFor(r),
                }}
                selected={selectedSetId === r.setId}
                isPR={prSetId.get(r.exId) === r.setId}
                onNumTap={() => onNumTap(r)}
                signed={isSigned(ex) ? { sign: s => carrySign(ex, s) } : undefined}
                loadKind={loadKindOf(ex, isSigned(ex))}
                rounder={rounderFor(ex, gym)}
                onUpdate={u => onSetUpdate(r, u)}
                onRemove={() => onRemoveSet(r)}
                onRemoveSub={sub => onRemoveSubSet(r, sub)}
                onDurationClick={() => onOpenTimePicker(r.exId, r.setId)}
              />
              {pointerGap === i + 1 && <RestBookmark lang={lang} onMove={onMovePointer} />}
            </React.Fragment>
          );
        })}
      </div>

      <div className="p-3 pb-0 pt-2 flex gap-2">
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
            <span className="truncate">{members.length > 2 || labels[i] !== names[i] ? abbrs[i] : names[i]}</span>
          </button>
        ))}
      </div>
      {/* 「改回上次」：同单卡（ExerciseCard），指针下面、重量改离了默认值的组一起改回 */}
      <div className="px-3 pb-3">
        {restorable.length > 0 && (
          <button
            type="button"
            data-testid="restore-last"
            onClick={() => {
              haptic(H.tap);
              for (const x of restorable) onSetUpdate(x.r, restoreUpdate(x.set, x.kg, x.signed));
            }}
            className="mt-1 -mb-1 min-h-[44px] px-1 text-label font-medium text-secondary flex items-center gap-1.5 transition-opacity duration-tap ease-paper active:opacity-60"
          >
            <RotateCcw size={14} strokeWidth={1.75} />
            {restorable.every(x => x.set.prefillRef?.plan) ? (isCn ? '改回计划' : 'Back to plan') : isCn ? '改回上次' : 'Back to last'}
          </button>
        )}
      </div>

      {memberEx && memberFor && (
        <Panel
          title={labels[idx(memberEx.id)]}
          subtitle={isCn ? `第 ${idx(memberFor) + 1} 个 · 共 ${members.length} 个` : `${idx(memberFor) + 1} of ${members.length}`}
          onClose={() => setMemberFor(null)}
          cancel={isCn ? '取消' : 'Cancel'}
          testId="alt-member-panel"
        >
          {lastLineOf(memberEx) && (
            <p className="px-2 pb-1 font-mono text-label text-secondary tabular-nums break-words" data-testid="alt-member-last">
              {lastLineOf(memberEx)}
            </p>
          )}
          {/* 这个成员用哪一台：一点就切（MemberRig portal 进来；没得设的动作这里是空的） */}
          <div ref={setChipSlot} className="empty:hidden" />
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
              onToggleNote(resolveName(memberEx.name), gymKeyOf(memberEx));
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
            {isCn ? '动作设置' : 'Exercise settings'}
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
          {/* 墨色，同单卡的删除菜单项：危险不靠颜色（§6.6），删了用顶栏撤销 */}
          <button
            type="button"
            onClick={() => {
              setMemberFor(null);
              onDeleteMember(memberFor);
            }}
            className={panelBtn}
          >
            <Trash2 size={16} className="text-accent" />
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
                <span className="min-w-[2.5rem] text-center text-secondary">{abbrs[i]}</span>
                {labels[i]}
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
          currentVariantId={variantIdOf(byId.get(variantFor)!)}
          onSelect={(v, name) => onSwitchVariant(variantFor, v, name)}
          onVariantRemoved={onVariantRemoved}
          onClose={() => setVariantFor(null)}
        />
      )}
    </div>
  );
});
