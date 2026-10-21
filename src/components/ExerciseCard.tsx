/**
 * 一个动作＝一页稿纸（规格 §6.2）
 *
 * 头部是刊头行：左边衬线动作名，右边等宽的「第N个 · M组 · X.Xt」，下方双线分隔。
 * 组区每条组行落在自己的 border-bottom 上（稿纸横纹已于 2026-08-29 撤销，见 §6.1）。
 * 删除动作只保留一处——刊头右侧的 ⋯ 溢出菜单（§6.6：列表里的删除入口
 * 一律降级为菜单内的墨色文字项，不靠颜色区分危险）。
 */
import React, { useEffect, useRef, useState } from 'react';
import { MoreHorizontal, StickyNote, Settings as SettingsIcon, Trash2, Plus, Pencil, Shuffle, Repeat } from 'lucide-react';
import { useExercisePrefs } from '../contexts/ExercisePrefsContext';
import { VariantModal } from './modals/VariantModal';
import { Exercise, Language, SetLog } from '../../types';
import { translations } from '../../translations';
import { formatExerciseTime } from '../utils/dateUtils';
import { SetCapsule, formatWeight, weightScrubFor } from './SetCapsule';
import { useValueScrub } from '../hooks/useValueScrub';
import { LongPressAffordance } from './LongPressAffordance';
import { RestBookmark } from './RestBookmark';
import { getLoadMode, ledgerCols } from '../utils/exerciseConfig';
import { setVolumeKg, signedKg } from '../utils/load';
import { haptic, H } from '../utils/haptics';
import { plural } from '../utils/format';
import { gymMachineKey, gymSwitchableKind, useLoadInfoOf } from '../hooks/useLoadKind';
import { LoadHero } from './PlateGlyph';
import { plateUnitOf } from '../utils/plates';
import { gymOverrideKey, snapUntouched, useLoadRounder, withInc, withKind } from '../hooks/useLoadRounder';
import { keyedPatch } from '../../services/appPrefs';
import { useUserSettingsContext } from '../contexts/UserSettingsContext';
import { INC_CHOICES, profileIn } from '../utils/loadable';

/**
 * 训练中实时判「这一组破了纪录」（「杠铃片」§1 镁粉）。口径照抄结束训练时的 detectPRs 的 weight 一档：
 * 只比单组最重；历史为空不算；提升 < 0.5kg 或 < 1% 不算（带正负的负荷只看绝对提升）。
 * 一张卡至多标一行：本场最重那组里最早做的那一组。
 */
export function prSetIndex(exercise: Exercise, bestKg: number | null | undefined, signed: boolean): number {
  if (bestKg === null || bestKg === undefined) return -1;
  let max = -Infinity;
  let at = -1;
  exercise.sets.forEach((st, i) => {
    if (st.ghost) return;
    const w = signedKg(st, exercise);
    if (w > max) {
      max = w;
      at = i;
    }
  });
  if (at < 0) return -1;
  const gain = max - bestKg;
  if (gain < 0.5) return -1;
  if (!signed && (bestKg <= 0 || gain / bestKg < 0.01)) return -1;
  return at;
}

/** 本动作总容量 Σ(weight × reps)，含递减子组。刊头右侧那个数。
 *  底稿行（ghost）不算 —— 它还不是数据（§12.6）。 */
function totalVolumeKg(exercise: Exercise): number {
  // 辅助的那部分不是举起来的，不算容量（带正负的负荷）
  return exercise.sets.reduce((sum, s) => (s.ghost ? sum : sum + setVolumeKg(s, exercise)), 0);
}

function formatVolume(kg: number, unit: string): string {
  const v = unit === 'lbs' ? kg * 2.20462 : kg;
  if (v <= 0) return '—';
  if (v >= 1000) return `${(v / 1000).toFixed(1)}${unit === 'lbs' ? 'k' : 't'}`;
  return `${Math.round(v)}${unit}`;
}

interface ExerciseCardProps {
  exercise: Exercise;
  exIdx: number;
  lang: Language;
  unit: string;
  exerciseNotes: Record<string, string>;
  getActiveMetrics: (name: string) => string[];
  resolveName: (name: string) => string;
  onUpdateExercise: (exIdx: number, updates: Partial<Exercise>) => void;
  onDeleteExercise: (exIdx: number) => void;
  onOpenTimePicker: (exIdx: number, setIdx: number, currentSeconds: number) => void;
  /** 改这个动作的时间（卡头「12:13」）；不传则那行只显示不可点 */
  onOpenExerciseTime?: () => void;
  /** 底稿抄自哪一场（C2，2026-10-11）：卡头「底稿 · 10/4」，点开在卡内看那次的几组，不用离开工作台 */
  lastSession?: { date: string; sets: SetLog[] } | null;
  /** 打开备注弹窗；gymKey：这个馆这个动作的键（标了馆的训练才有），弹窗多一栏本馆备注 */
  onToggleNote: (name: string, gymKey?: string) => void;
  onOpenMetricModal: (name: string) => void;
  /** 改动作库里的名字（第 7 条）。动作不在库里（计划里手打的名字）时不传，菜单项不出现 */
  onRename?: () => void;
  /** 换练法（第 8 条）；undefined＝标准。不传则不出现练法入口 */
  onSwitchVariant?: (variantId: string | undefined, name?: string) => void;
  onSetUpdate: (exIdx: number, setIdx: number, updates: Partial<Exercise['sets'][0]>) => void;
  onAddSet: (exIdx: number) => void;
  onRemoveSet: (exIdx: number, setIdx: number) => void;
  /** 删一档递减（单击即删，不给撤销） */
  onRemoveSubSet?: (exIdx: number, setIdx: number, subIdx: number) => void;
  /**
   * 指针（2026-10，原休息书签）落在本动作的第几条缝上（gap=0 是第一组之前，gap=k 是第 k 组之后）。
   * 全场唯一，所以绝大多数卡片拿到的是 null。指针以上＝做完或跳过。
   */
  pointerGap?: number | null;
  /** 书签被拖到别处（可能是别的卡）：cardKey + gap，交给工作台改状态 */
  onMovePointer?: (cardKey: string, gap: number) => void;
  /** 选中的那一组（组号实心 + ±5） */
  selectedSetId?: string | null;
  /** 点组号（选中 / 做完 / 退回由工作台判） */
  onNumTap?: (setId: string) => void;
  /** 带正负的负荷（变体第二层）：这张卡按「辅助负、自重 0、负重正」记 */
  signed?: boolean;
  /** 刊头「第 N 个」：按卡算（交替组算一张） */
  cardNo?: number;
  /** 这个动作（同一练法）历史上单组最重的带符号 kg；null＝没有历史（不判纪录）。编辑旧训练时不传 */
  bestKg?: number | null;
  /** ⋯ 菜单：和下一个动作交替做（没有下一个时不传） */
  onAlternateWithNext?: () => void;
  /** ⋯ 菜单：加入上面的交替组（上一张不是交替组时不传） */
  onJoinGroupAbove?: () => void;
  /** 这一场训练记的馆（WorkoutSession.gym）：± / 拖动 / 取整按这个馆的档案走 */
  gym?: string;
  /** §12.7 长按刊头拖动排序：由 NewWorkoutTab 的 useCardReorder 下发，摊到刊头行上 */
  dragHandle?: {
    handlers: React.DOMAttributes<HTMLElement>;
    pressing: boolean;
    hinting: boolean;
    drawMs: number;
  };
}

export const ExerciseCard: React.FC<ExerciseCardProps> = ({
  exercise,
  exIdx,
  lang,
  unit,
  exerciseNotes,
  getActiveMetrics,
  resolveName,
  onUpdateExercise,
  onDeleteExercise,
  onOpenTimePicker,
  onOpenExerciseTime,
  lastSession = null,
  onToggleNote,
  onOpenMetricModal,
  onRename,
  onSwitchVariant,
  onSetUpdate,
  onAddSet,
  onRemoveSet,
  onRemoveSubSet,
  pointerGap = null,
  onMovePointer,
  selectedSetId = null,
  onNumTap,
  signed = false,
  cardNo,
  bestKg,
  onAlternateWithNext,
  onJoinGroupAbove,
  gym,
  dragHandle,
}) => {
  const isCn = lang === Language.CN;
  const exerciseName = resolveName(exercise.name);
  const { variantsOf, variantLabel, findExerciseDef, barOf, setBar } = useExercisePrefs();
  const [variantOpen, setVariantOpen] = React.useState(false);
  const variantName = variantLabel(exercise);
  const variantCount = variantsOf(exercise.name).length;
  const hasDef = !!findExerciseDef(exercise.name);
  const activeMetrics = getActiveMetrics(exerciseName);
  const loadMode = getLoadMode(exercise);
  // 「杠铃片」§3：这个动作的重量怎么画、怎么拖（带上馆：这台在这个馆是插销还是挂片）
  const loadInfo = useLoadInfoOf()(exercise, signed, gym);
  const loadKind = loadInfo.kind;
  // 两层备注（design-plates.md「换馆重量」B）：通用（按动作名）+ 本馆（馆|动作|做法），本馆的在前
  const { appPrefs, changeAppPrefs } = useUserSettingsContext();
  const gymKey = gymMachineKey(gym, loadInfo);
  const gymNote = gymKey ? appPrefs.gymNotes[gymKey] : undefined;
  const hasNote = !!exerciseNotes[exerciseName] || !!gymNote;
  // 馆档案取整器：纯数字的动作（含没有重量这一项的）是 null，组行照旧走首选项的步长
  const rounder = useLoadRounder()(exercise, gym);
  const prIdx = prSetIndex(exercise, bestKg, signed);
  /**
   * 顶部器材大图每张卡都画（2026-10-18 审查后用户定：只画选中那张时，做完一个动作大图跳到下一张卡，
   * 页面一跳容易点错组）。画哪一组：选中的组在这张卡上就画它，否则画这张卡下一组待做的，都做完了画最后一组。
   */
  const selIdx = selectedSetId ? exercise.sets.findIndex(s => String(s.id) === selectedSetId) : -1;
  const pendingIdx = exercise.sets.findIndex(s => s.ghost);
  const focusIdx = selIdx >= 0 ? selIdx : pendingIdx >= 0 ? pendingIdx : exercise.sets.length - 1;
  const focusSet = focusIdx >= 0 ? exercise.sets[focusIdx] : undefined;
  const focusValue = focusSet
    ? Number(formatWeight(Number(focusSet.weight) || 0, unit)) *
      (signed && (focusSet.bodyweightMode === 'assisted' || (!focusSet.bodyweightMode && loadMode === 'assisted')) ? -1 : 1)
    : 0;
  /**
   * 大图也能拖（2026-10-18 用户定）：步长 / 方向 / 吸附和组行重量格同一份（weightScrubFor），
   * 改的是选中那一组；写回的口径照 SetCapsule.update：显示单位换回 kg，带正负的按号写 bodyweightMode，
   * 底稿行记 touched（改值只改值，不描实）。
   */
  const heroFeel = weightScrubFor(rounder);
  /** 大图拖动 / 点「改成能挂的」：写回选中（或画着的）那一组 */
  const writeHero = (next: number) => {
    if (!focusSet) return;
    const kg = unit === 'lbs' ? Math.abs(next) / 2.20462 : Math.abs(next);
    // 改重量就记下登记时的单位（这一组挂的就是这种片），口径同 SetCapsule.fromDisplay
    const plateUnit: SetLog['plateUnit'] = unit === 'lbs' ? 'lbs' : 'kg';
    const updates: Partial<SetLog> = signed
      ? { weight: kg, plateUnit, bodyweightMode: next < 0 ? 'assisted' : next > 0 ? 'weighted' : 'normal' }
      : { weight: kg, plateUnit };
    if (focusSet.ghost) (updates as any).touched = { ...(focusSet.touched || {}), weight: true };
    onSetUpdate(exIdx, focusIdx, updates);
  };
  const heroScrub = useValueScrub({
    value: focusValue,
    onChange: writeHero,
    steps: heroFeel.steps,
    axis: heroFeel.axis,
    stepFn: heroFeel.stepFn,
    disabled: !focusSet,
    ...(signed ? { min: -9999 } : {}),
  });
  // 底稿行不计入「M组」——它还不是数据（§12.6）
  const realSetCount = exercise.sets.filter(s => !s.ghost).length;
  // 分母＝这张卡上全部的组（做完 + 待做）
  const plannedCount = exercise.sets.length;
  const ghostSetCount = plannedCount - realSetCount;
  /**
   * §12.6 进度：realSetCount 一直就是「已做几组」，只是没有分母时它读起来像
   * 「这个动作有几组」。补上分母，同一个数字才变成进度。
   * 底稿描完（或抹完）后分母自然消失，回到原来的单个数字。
   */

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  /**
   * 哪些组行是「刚添加出来的」——只有它们播「写下一组」入场（§5.3）。
   *
   * 靠比对上一次渲染的 id 集合判断，而不是靠组件挂载：
   * 挂载会在切 tab、展开卡片时都发生，那时整卡一起动就成噪音了。
   * 首次渲染整卡的行都不算新（seenRef 为空 → 全部跳过）。
   */
  const seenSetIdsRef = useRef<Set<string> | null>(null);
  const currentIds = exercise.sets.map((s: any) => String(s.id));
  const newSetIds = new Set<string>();
  if (seenSetIdsRef.current) {
    for (const id of currentIds) if (!seenSetIdsRef.current.has(id)) newSetIds.add(id);
  }
  // ⚠️ 必须在 commit 之后才登记，不能在渲染期改 ref：
  // StrictMode 会把渲染跑两遍，第一遍就登记的话第二遍算出来的「新行」是空的，
  // 提交到 DOM 的就永远是 isNew=false，动画一次都不会播。
  useEffect(() => {
    seenSetIdsRef.current = new Set(currentIds);
    // currentIds 每次渲染都是新数组，用它的内容当依赖
  }, [currentIds.join('|')]);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenuOpen(false);
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const [lastOpen, setLastOpen] = useState(false);
  const lastLine = lastSession
    ? lastSession.sets
        .map(s => {
          const w = formatWeight(Number(s.weight) || 0, unit);
          const sub = s.subSets?.length ? `→${s.subSets.map(x => formatWeight(Number(x.weight) || 0, unit)).join('→')}` : '';
          return `${w}${sub}×${Number(s.reps) || 0}`;
        })
        .join('、')
    : '';
  const lastDate = lastSession ? new Date(lastSession.date) : null;
  const lastDateLabel = lastDate ? `${lastDate.getMonth() + 1}/${lastDate.getDate()}` : '';
  // 底稿抄自另一个馆（本馆没练过才会这样，design-plates.md「换馆重量」A）：眉批写明在哪个馆
  const prefillElsewhere = !!exercise.prefillGym && exercise.prefillGym !== gym ? exercise.prefillGym : null;

  const handleDurationClick = (setIdx: number) => {
    onOpenTimePicker(exIdx, setIdx, exercise.sets[setIdx].duration || 0);
  };

  // 父行与子组行共用同一份列宽，根治原先「表头 px-2 vs 行 p-3」的 4px 错位
  const cols = ledgerCols(activeMetrics.length);

  const menuItem =
    'w-full min-h-[44px] px-4 flex items-center gap-3 text-left text-body text-primary active:bg-card-hover';

  /**
   * ⋯「在 X，这台器械一档多重」（2026-10-18 用户定：馆默认一档，个别器械在这里单独调）。
   * 只给配重片 / 哑铃 / 带正负的辅助：杠铃和挂片器械的一档就是片子，在馆档案里管。
   * 存 AppPrefs.gymOverrides（键：馆|动作|做法）；没标馆的训练不给（改了也找不到下一次）。
   * 改完把没做完、没改过的组吸到新的一档上。
   */
  const incKey = rounder && gym && (loadKind === 'pin' || loadKind === 'pair' || loadKind === 'signed')
    ? gymOverrideKey(gym, rounder.info)
    : null;
  const incOverridden = !!(incKey && appPrefs.gymOverrides[incKey]);
  const setIncOverride = (next: number | null) => {
    if (!rounder || !incKey) return;
    haptic(H.tap);
    const ov = { ...appPrefs.gymOverrides };
    let inc: number;
    if (next === null) {
      delete ov[incKey];
      const prof = profileIn(gym ? appPrefs.gyms[gym] : undefined, rounder.unit);
      inc = loadKind === 'pair' ? prof.dumbbell : rounder.info.stack === 'cable' ? prof.cable : prof.machine;
    } else {
      ov[incKey] = { v: next, u: rounder.unit };
      inc = next;
    }
    changeAppPrefs({ gymOverrides: ov });
    onUpdateExercise(exIdx, { sets: snapUntouched(exercise.sets, exercise, withInc(rounder, inc)) });
  };
  const stepInc = (dir: 1 | -1) => {
    if (!rounder) return;
    const list = INC_CHOICES[rounder.unit];
    const cur = rounder.ctx.inc;
    // 往上取第一个更大的、往下取最后一个更小的（当前值不在表里也成立）
    const nextV = dir > 0 ? list.find(x => x > cur + 1e-9) : [...list].reverse().find(x => x < cur - 1e-9);
    if (nextV !== undefined) setIncOverride(nextV);
  };
  const uLab = unit === 'lbs' ? 'lb' : 'kg';

  /**
   * ⋯「在 X，这台是 插销 / 挂片」（design-plates.md「换馆重量」A2）：库里是配重片或挂片式器械的动作才给。
   * 和动作库一样就写墓碑（恢复动作库），不一样就记住；没做完、没改过的组按新形式重新取整。
   */
  const kindKey = rounder && gymSwitchableKind(loadInfo.libKind) ? gymKey : null;
  const setGymKind = (k: 'pin' | 'loaded') => {
    if (!rounder || !kindKey || k === loadKind) return;
    haptic(H.tap);
    changeAppPrefs(keyedPatch('gymKinds', kindKey, k === loadInfo.libKind ? '' : k));
    onUpdateExercise(exIdx, { sets: snapUntouched(exercise.sets, exercise, withKind(rounder, k)) });
  };

  return (
    <div className="ui-card p-0 overflow-visible" style={{ ['--cols' as string]: cols }}>
      {/* ── 刊头行 ──
          §12.7：整个刊头是拖动排序的长按热区（touch-pan-y，长按满前动手指=让位给滚动）。
          热区里有按钮（⋯ 菜单），排序 hook 的 pointerdown 会自行跳过 button 目标。 */}
      <div
        className="masthead-rule relative px-3 pt-4 pb-2.5 touch-pan-y"
        {...(dragHandle?.handlers ?? {})}
      >
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
          <h3 className="title-face text-[24px] text-primary leading-tight flex-1 min-w-0 break-words">
            {exerciseName}
          </h3>

          <div className="relative -mr-1 -my-2" ref={menuRef}>
            <button
              type="button"
              onClick={() => {
                haptic(H.tap);
                setMenuOpen(o => !o);
              }}
              className="w-11 h-11 flex items-center justify-center text-tertiary"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-label={isCn ? '动作菜单' : 'Exercise menu'}
            >
              <MoreHorizontal size={20} strokeWidth={1.75} />
            </button>

            {menuOpen && (
              <div
                role="menu"
                className="anim-reveal absolute right-0 top-full z-20 mt-1 w-44 py-1 bg-card border border-divider rounded-card shadow-overlay"
              >
                <button
                  type="button"
                  role="menuitem"
                  className={menuItem}
                  onClick={() => {
                    setMenuOpen(false);
                    onToggleNote(exerciseName, gymKey ?? undefined);
                  }}
                >
                  <StickyNote size={16} strokeWidth={1.75} className="text-tertiary" />
                  {hasNote ? (isCn ? '编辑备注' : 'Edit note') : isCn ? '加备注' : 'Add note'}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className={menuItem}
                  onClick={() => {
                    setMenuOpen(false);
                    onOpenMetricModal(exerciseName);
                  }}
                >
                  <SettingsIcon size={16} strokeWidth={1.75} className="text-tertiary" />
                  {isCn ? '动作设置' : 'Settings'}
                </button>
                {onSwitchVariant && hasDef && (
                  <button
                    type="button"
                    role="menuitem"
                    className={menuItem}
                    onClick={() => {
                      setMenuOpen(false);
                      setVariantOpen(true);
                    }}
                  >
                    <Shuffle size={16} strokeWidth={1.75} className="text-tertiary" />
                    {isCn ? '做法' : 'Variant'}
                  </button>
                )}
                {onAlternateWithNext && (
                  <button
                    type="button"
                    role="menuitem"
                    className={menuItem}
                    onClick={() => {
                      setMenuOpen(false);
                      onAlternateWithNext();
                    }}
                    data-testid="alternate-with-next"
                  >
                    <Repeat size={16} strokeWidth={1.75} className="text-tertiary" />
                    {isCn ? '和下一个动作交替做' : 'Alternate with next'}
                  </button>
                )}
                {onJoinGroupAbove && (
                  <button
                    type="button"
                    role="menuitem"
                    className={menuItem}
                    onClick={() => {
                      setMenuOpen(false);
                      onJoinGroupAbove();
                    }}
                  >
                    <Repeat size={16} strokeWidth={1.75} className="text-tertiary" />
                    {isCn ? '加入上面的交替组' : 'Join the group above'}
                  </button>
                )}
                {onRename && (
                  <button
                    type="button"
                    role="menuitem"
                    className={menuItem}
                    onClick={() => {
                      setMenuOpen(false);
                      onRename();
                    }}
                  >
                    <Pencil size={16} strokeWidth={1.75} className="text-tertiary" />
                    {isCn ? '重命名' : 'Rename'}
                  </button>
                )}
                {kindKey && (
                  <div className="gym-inc border-t border-divider mt-1 px-4 pt-2 pb-2" data-testid="gym-kind">
                    <p className="text-label text-secondary">
                      {isCn ? <>在 <b className="text-primary">{gym}</b>，这台是</> : <>At <b className="text-primary">{gym}</b>, this one is</>}
                    </p>
                    <span className="gym-seg mt-1" role="group">
                      {(['pin', 'loaded'] as const).map(k => (
                        <button
                          key={k}
                          type="button"
                          className={`min-h-[36px] px-3 text-label font-semibold ${loadKind === k ? 'seg-on' : 'text-secondary'}`}
                          aria-pressed={loadKind === k}
                          onClick={() => setGymKind(k)}
                          data-testid={`gym-kind-${k}`}
                        >
                          {k === 'pin' ? (isCn ? '插销' : 'Pin stack') : isCn ? '挂片' : 'Plate-loaded'}
                        </button>
                      ))}
                    </span>
                  </div>
                )}
                {incKey && rounder && (
                  <div className="gym-inc border-t border-divider mt-1 px-4 pt-2 pb-2" data-testid="gym-inc">
                    <p className="text-label text-secondary">
                      {isCn ? <>在 <b className="text-primary">{gym}</b>，{loadKind === 'pair' ? '哑铃' : loadKind === 'signed' ? '辅助器械' : '这台器械'}一档多重</> : <>At <b className="text-primary">{gym}</b>, one step is</>}
                    </p>
                    <div className="gym-inc-stepper">
                      <button type="button" onClick={() => stepInc(-1)} aria-label={isCn ? '一档轻一点' : 'Smaller step'}>−</button>
                      <b>{rounder.ctx.inc}</b>
                      <button type="button" onClick={() => stepInc(1)} aria-label={isCn ? '一档重一点' : 'Bigger step'}>＋</button>
                      <span>{uLab}</span>
                    </div>
                    {incOverridden ? (
                      <button type="button" className="text-label text-secondary underline min-h-[36px]" onClick={() => setIncOverride(null)}>
                        {isCn ? '恢复馆默认' : 'Use gym default'}
                      </button>
                    ) : (
                      <p className="text-micro text-tertiary">{isCn ? '改了只影响这个馆的这一台' : 'Only this machine at this gym'}</p>
                    )}
                  </div>
                )}
                {/* §6.6：删除入口降级为墨色文字项，不靠颜色喊危险；
                    真正的危险确认在弹窗里做（全宽实心 + 明确文案）。 */}
                <button
                  type="button"
                  role="menuitem"
                  className={`${menuItem} border-t border-divider mt-1 pt-1`}
                  onClick={() => {
                    setMenuOpen(false);
                    onDeleteExercise(exIdx);
                  }}
                >
                  <Trash2 size={16} strokeWidth={1.75} className="text-tertiary" />
                  {isCn ? '删除动作' : 'Delete exercise'}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* 眉批：负重/辅助与动作时间。虚线下划线＝可点的批注，
            ::before 补 44px 热区而不撑大视觉尺寸。 */}
        {/* 组数·容量放在眉批行右侧，不和名字抢第一行：360 宽下两者同一行时
            「杠铃平板卧推」会被挤成「杠铃平板卧 / 推」（2026-10 手机排版摸底）。 */}
        <div className="flex items-center gap-4 mt-1.5">
          {/* 做法（变体第一层）：选了做法时常驻；有做法但这张卡是标准时淡墨「标准」，点开换 */}
          {onSwitchVariant && (variantName || variantCount > 0) && (
            <button
              type="button"
              onClick={() => setVariantOpen(true)}
              className={`marginalia text-label font-medium ${variantName ? 'text-accent' : 'text-tertiary'}`}
              data-testid="variant-marginalia"
            >
              {variantName || (isCn ? '标准' : 'Standard')}
            </button>
          )}
            {exercise.exerciseTime &&
              (onOpenExerciseTime ? (
                <button
                  type="button"
                  onClick={onOpenExerciseTime}
                  className="marginalia font-mono text-label text-secondary tabular-nums"
                  aria-label={isCn ? '改动作时间' : 'Change exercise time'}
                  data-testid="exercise-time"
                >
                  {formatExerciseTime(exercise.exerciseTime, isCn ? 'cn' : 'en').time}
                </button>
              ) : (
                <span className="font-mono text-label text-tertiary tabular-nums">
                  {formatExerciseTime(exercise.exerciseTime, isCn ? 'cn' : 'en').time}
                </span>
              ))}
          {lastSession && (
            <button
              type="button"
              onClick={() => setLastOpen(v => !v)}
              aria-expanded={lastOpen}
              className="marginalia font-mono text-label text-tertiary tabular-nums"
              data-testid="prefill-from"
            >
              {isCn ? '底稿' : 'Draft'} ·{' '}
              {prefillElsewhere && (
                <>
                  {isCn ? '在' : 'at'} <span className="text-accent" data-testid="prefill-gym">{prefillElsewhere}</span>{' '}
                </>
              )}
              {lastDateLabel}
            </button>
          )}
          <span className="ml-auto font-mono text-label text-tertiary tabular-nums whitespace-nowrap">
            {isCn ? `第${cardNo ?? exIdx + 1}个` : `#${cardNo ?? exIdx + 1}`} ·{' '}
            <span className="text-primary font-semibold">{realSetCount}</span>
            {ghostSetCount > 0 && <span className="opacity-80">/{plannedCount}</span>}
            {/* 有分母时按分母定单复数（"1/4 sets"），没分母时还按原来的分子 */}
            {isCn ? '组' : ` ${plural(ghostSetCount > 0 ? plannedCount : realSetCount, 'set')}`} ·{' '}
            {formatVolume(totalVolumeKg(exercise), unit)}
          </span>
        </div>
        {lastSession && lastOpen && (
          <p className="mt-1.5 font-mono text-label text-secondary tabular-nums break-words" data-testid="prefill-last">
            {prefillElsewhere
              ? isCn ? `上次在 ${prefillElsewhere} ${lastDateLabel}` : `Last at ${prefillElsewhere} ${lastDateLabel}`
              : isCn ? `上次 ${lastDateLabel}` : `Last ${lastDateLabel}`}{' '}
            · {lastLine} {unit}
          </p>
        )}
      </div>

      {focusSet && activeMetrics.includes('weight') && (
        <LoadHero
          kind={loadKind}
          value={focusValue}
          unit={unit === 'lbs' ? 'lbs' : 'kg'}
          plateUnit={plateUnitOf(focusSet, unit === 'lbs' ? 'lbs' : 'kg')}
          bar={barOf(exercise.name)}
          onBarChange={hasDef ? bar => setBar(exercise.name, bar) : undefined}
          isCn={isCn}
          pinStep={unit === 'lbs' ? 10 : 5}
          scrub={{ handlers: heroScrub.handlers, scrubbing: heroScrub.scrubbing, step: heroScrub.step, axis: heroFeel.axis }}
          rounder={rounder}
          onPick={next => {
            haptic(H.tap);
            writeHero(next);
          }}
        />
      )}

      {hasNote && (
        <button
          type="button"
          onClick={() => onToggleNote(exerciseName, gymKey ?? undefined)}
          className="w-full text-left px-3 py-2 bg-highlight-soft border-l-2 border-primary text-label text-primary flex items-start gap-2"
          data-testid="exercise-note"
        >
          <StickyNote size={13} className="mt-0.5 flex-shrink-0 text-warning" strokeWidth={1.75} />
          <span className="min-w-0 break-words">
            {gymNote && (
              <span className="block" data-testid="exercise-gym-note">
                <b className="font-semibold">{gym}</b> · {gymNote}
              </span>
            )}
            {exerciseNotes[exerciseName] && <span className="block">{exerciseNotes[exerciseName]}</span>}
          </span>
        </button>
      )}

      {/* ── 表头：只留列名，单位已内嵌到每行数值右下角（10px 副行已删） ── */}
      <div
        className="grid items-center px-3 pt-2.5 pb-1 text-micro font-medium text-tertiary"
        style={{ gridTemplateColumns: cols }}
      >
        <span>#</span>
        {activeMetrics.map(m => (
          <span key={m} className="text-center">
            {translations[m as keyof typeof translations]?.[lang] || m.replace('custom_', '')}
          </span>
        ))}
        {/* 力竭列的表头。给它一个列名而不是留空——这一列是全行唯一
            没有数字、也没有图标语义的控件，不写字就没人知道那个「竭」能点。 */}
        <span className="text-center">{isCn ? '竭' : 'F'}</span>
        <span />
      </div>

      {/* ── 组区 ── */}
      <div
        className="ledger-paper"
        data-ledger-paper={exercise.id}
        data-ex-name={exerciseName}
      >
        {/* §12.13：书签是流里的一个零高节点，夹在两个组块之间。
            不测量、不挂 ResizeObserver —— 行长高了缝自己会跟着走。 */}
        {pointerGap === 0 && onMovePointer && <RestBookmark lang={lang} onMove={onMovePointer} />}
        {exercise.sets.map((set, setIdx) => (
          <React.Fragment key={set.id}>
            <SetCapsule
              set={set}
              setIdx={setIdx}
              activeMetrics={activeMetrics}
              loadMode={loadMode}
              isNew={newSetIds.has(String(set.id))}
              unit={unit}
              lang={lang}
              onUpdate={updates => onSetUpdate(exIdx, setIdx, updates)}
              onRemove={() => onRemoveSet(exIdx, setIdx)}
              onRemoveSub={onRemoveSubSet ? subIdx => onRemoveSubSet(exIdx, setIdx, subIdx) : undefined}
              // 书签落在第 k 条缝 → 它正下方那一行是第 k 组（下标 k）
              selected={selectedSetId === String(set.id)}
              onNumTap={onNumTap ? () => onNumTap(String(set.id)) : undefined}
              signed={signed ? { sign: () => (getLoadMode(exercise) === 'assisted' ? -1 : 1) } : undefined}
              onDurationClick={() => handleDurationClick(setIdx)}
              loadKind={loadKind}
              rounder={rounder}
              isPR={setIdx === prIdx}
            />
            {/* 缝在这一组的整块之后 —— 递减档全都在 SetCapsule 的 fragment 里，
                所以书签自然落在「递减做完」之后，而不是母行之后。 */}
            {pointerGap === setIdx + 1 && onMovePointer && (
              <RestBookmark lang={lang} onMove={onMovePointer} />
            )}
          </React.Fragment>
        ))}
      </div>

      {onSwitchVariant && (
        <VariantModal
          open={variantOpen}
          lang={lang}
          exerciseName={exercise.name}
          currentVariantId={exercise.variantId}
          onSelect={onSwitchVariant}
          onClose={() => setVariantOpen(false)}
        />
      )}

      {/* ── 页脚：只剩一个通栏虚线按钮 ── */}
      <div className="p-3 pt-2">
        <button
          type="button"
          onClick={() => {
            haptic(H.tap);
            onAddSet(exIdx);
          }}
          className="w-full min-h-[44px] border border-dashed border-divider rounded-control text-secondary font-medium flex items-center justify-center gap-2 transition-colors duration-tap ease-paper active:bg-card-hover"
        >
          <Plus size={16} strokeWidth={1.75} /> {isCn ? '添加组' : 'Add Set'}
        </button>
      </div>
    </div>
  );
};

export default ExerciseCard;
