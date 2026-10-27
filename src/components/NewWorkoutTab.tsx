/**
 * 新建 / 编辑训练页（从 App.tsx 抽出，减轻主文件体积）
 *
 * 添加动作走底部常驻栏唤起的 ExercisePickerSheet（弹层），页面本体只保留动作卡列表。
 * 本页隐藏全局 AppHeader，自己的 sticky 头部是唯一顶栏（含状态栏留白）。
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Check,
  Flag,
  MapPin,
  Plus,
  X,
  Scale,
} from 'lucide-react';
import {
  Exercise,
  ExerciseDefinition,
  Language,
  SetLog,
  SubSetLog,
  WorkoutSession,
} from '../../types';
import { translations } from '../../translations';
import { ExerciseCard, type PRPool } from './ExerciseCard';
import { AlternatingCard } from './AlternatingCard';
import {
  applySetUpdate,
  buildCards,
  cardRows,
  findSet,
  groupExercises,
  moveGroupMember,
  movePointerTo,
  moveSetToExercise,
  nextPendingRow,
  normalizeGroups,
  pointerSeam,
  removeFromGroup,
  RowRef,
  splitGroup,
  tapSetNum as tapSetNumPure,
  tapSetNumEditing,
} from '../utils/workbench';
import { usesSignedLoad } from '../utils/load';
import { useLoadRounder } from '../hooks/useLoadRounder';
import { haptic, H } from '../utils/haptics';
import { ExercisePickerSheet } from './ExercisePickerSheet';
import { BodyPartPicker, isPartTitle, partTitleFor } from './BodyPartPicker';
import { useCardReorder } from '../hooks/useCardReorder';
import { ReorderStrip } from './ReorderStrip';
import { plural } from '../utils/format';
import { useExercisePrefs } from '../contexts/ExercisePrefsContext';
import { useUiOverlay } from '../contexts/UiOverlayContext';
import { UndoRedoButtons } from './UndoRedoButtons';

export interface NewWorkoutTabProps {
  lang: Language;
  unit: string;
  currentWorkout: WorkoutSession;
  /** 要支持函数式更新：异步回来的改动（交替提示等）必须按那一刻的最新状态改 */
  setCurrentWorkout: React.Dispatch<React.SetStateAction<WorkoutSession>>;
  editingWorkoutId: string | null;
  hasUnsavedChanges: boolean;
  saveStatus: 'idle' | 'saving' | 'saved' | 'error';
  exerciseNotes: Record<string, string>;
  getActiveMetrics: (name: string) => string[];
  resolveName: (name: string) => string;
  onBack: () => void;
  onSave: () => void;
  /** kg ⇄ lbs 显示切换（训练页隐藏了全局 AppHeader，入口在本页头部） */
  onToggleUnit: () => void;
  onOpenTimePicker: (exIdx: number, setIdx: number) => void;
  /** 改动作的时间（卡头那个「12:13」）。以前它误开的是第 1 组的时长 */
  onOpenExerciseTime?: (exId: string) => void;
  /** 底稿抄自哪一场（C2）：给卡头「底稿 · 10/4」用 */
  lastSessionFor?: (ex: Exercise) => { date: string; sets: SetLog[] } | null;
  /** 训练中标 PB 用：这个动作以前做完的组 + 比法（utils/prRecords） */
  prPoolFor?: (ex: Exercise) => PRPool;
  onToggleNote: (name: string, gymKey?: string) => void;
  /**
   * exIdx 用于在弹窗内修改该动作实例的负重/辅助标记；从动作库进来时不给（不显示那一节）。
   * group：从交替组打开（交替组的卡片没有重量大图，弹窗里「这一台」只写一句说明）。
   */
  onOpenMetricModal: (name: string, exIdx?: number, focus?: 'gym', group?: boolean) => void;
  /** 动作设置弹窗里「在 X」一段的挂载点，交给弹窗所属的那张卡 */
  metricSlot?: { exIdx: number; el: HTMLElement | null } | null;
  onDeleteExerciseFromSession: (exIdx: number) => void;
  /** 编辑模式下触发日期选择器（仅 editingWorkoutId 非空时显示日期区域） */
  onChangeDate?: () => void;
  /** 打开场地选择器（§12.11）。编辑旧训练时同样可用 —— 那是补标历史的唯一入口。 */
  onChangeGym?: () => void;

  // ===== 添加动作弹层 =====
  pickerOpen: boolean;
  /**
   * focusPart：打开时直接停在哪个部位栏（选了部位印进来时带上）。
   * targetGroup：从交替组的「加一个动作」打开 —— 这次选的动作加进这个组（App 记着，pick 时带上）。
   */
  onPickerOpenChange: (open: boolean, focusPart?: string | null, targetGroup?: string | null) => void;
  /** 这次弹层是「加到某个交替组」：头部写「加到 X ⇄ Y」 */
  pickerTargetLabel?: string | null;
  /** 本次打开弹层要停在的部位栏，由 App 保管（FAB 印谱与页内印谱两条路共用） */
  pickerFocusPart?: string | null;
  /** 小写显示名 -> 当前训练中出现次数（弹层「已添加」徽标） */
  addedCounts: Record<string, number>;
  /** 本次弹层会话累计添加数 */
  sessionAdded: number;
  onPickExercise: (ex: ExerciseDefinition, variantId?: string) => boolean | void;
  onCreateCustomExercise: (prefilled?: string, preset?: { bodyPart?: string; category?: string; regions?: string[] }) => void;
  /** 弹层动作面板里的「部位与器材」（转发到 App 层的弹窗） */
  onEditExerciseTags: (ex: ExerciseDefinition) => void;
  onRenameExercise: (id: string, currentName: string) => void;
  /** 换练法（第 8 条） */
  onSwitchVariant: (exerciseId: string, variantId: string | undefined, name?: string) => void;
  onDeleteLibraryExercise: (id: string) => void;
  /** 弹层关闭后需要滚动定位并高亮的动作卡 id */
  flashExerciseId: string | null;
  onFlashDone: () => void;
  /**
   * §12.4：经由 FAB 印谱手势选了「⋯」（其他，自己命名）的那次训练 id。
   * 命中时不再问「今天练哪里」，并把焦点交给标题输入框。
   */
  partPrechosenId?: string | null;
}

export const NewWorkoutTab: React.FC<NewWorkoutTabProps> = ({
  lang,
  unit,
  currentWorkout,
  setCurrentWorkout,
  editingWorkoutId,
  hasUnsavedChanges,
  saveStatus,
  exerciseNotes,
  getActiveMetrics,
  resolveName,
  onBack,
  onSave,
  onToggleUnit,
  onOpenTimePicker,
  onOpenExerciseTime,
  lastSessionFor,
  prPoolFor,
  onToggleNote,
  onOpenMetricModal,
  metricSlot,
  onDeleteExerciseFromSession,
  onChangeDate,
  onChangeGym,
  pickerOpen,
  onPickerOpenChange,
  pickerFocusPart = null,
  pickerTargetLabel = null,
  addedCounts,
  sessionAdded,
  onPickExercise,
  onCreateCustomExercise,
  onEditExerciseTags,
  onRenameExercise,
  onSwitchVariant,
  onDeleteLibraryExercise,
  flashExerciseId,
  onFlashDone,
  partPrechosenId = null,
}) => {
  const isCn = lang === Language.CN;
  const { findExerciseDef, signedLoadOf } = useExercisePrefs();
  const rounderFor = useLoadRounder();
  const { toast, toastUndo } = useUiOverlay();
  const flashTimerRef = useRef<number | null>(null);
  const titleInputRef = useRef<HTMLInputElement | null>(null);

  /**
   * 已经选过部位的那次训练 id。
   *
   * 存 id 而不是布尔值：换一次训练（新 id）自然重新需要选，
   * 而本次训练中途把动作全删光时，不会把已经选过的界面又弹回来。
   */
  const [partChosenFor, setPartChosenFor] = useState<string | null>(null);

  /**
   * 结束训练不弹确认框（§12.5 通则 3：结束不在例外名单里，结束后能从时间线接回 / 编辑）。
   * 顶栏的按钮离拇指远、容易误触，所以同一键再点一次才结束：第一下只把按钮改成「再点一次结束」，4 秒没点回去。
   * 第二下落在同一处，不用重新瞄准（2026-10-26 按记录开销计分改：确认弹窗每场多一次等待、一次想、一次瞄准）。
   * 一组都没做完时不上膛，直接交给下面问「放弃？」。
   */
  const [endArmed, setEndArmed] = useState(false);
  const endArmTimer = useRef<number | null>(null);
  useEffect(() => () => window.clearTimeout(endArmTimer.current ?? undefined), []);
  const onFinishClick = () => {
    const anyDone = (currentWorkout.exercises ?? []).some(e => e.sets.some(s => !s.ghost || s.touched));
    if (editingWorkoutId || !anyDone) {
      onSave();
      return;
    }
    if (!endArmed) {
      setEndArmed(true);
      haptic(H.tap);
      endArmTimer.current = window.setTimeout(() => setEndArmed(false), 4000);
      return;
    }
    window.clearTimeout(endArmTimer.current ?? undefined);
    setEndArmed(false);
    onSave();
  };

  /**
   * 「做到哪了」（2026-10 指针，demo：docs/demos/set-pointer-alternating.html）：全场一个指针，
   * 指针以上＝做完或跳过。指针不存状态，由组的状态推出来（workbench.pointerSeam），
   * 所以重开工作台、接回训练、删组之后它自己就落在对的地方。
   *
   * 选中：组号实心 + ±5。默认选中指针下面那一组；点哪一组的组号，哪一组就选中，
   * 点的是指针下面的待做组，指针同时前进到它正下方（2026-10-11 用户按真机手感定：一次点击顶掉「先选中再点做完」和「拖书签」两件事）；
   * 点做完的组只选中，指针不往回跳（2026-10-25）。
   * 只存「手动选中的那一组」，删掉 / 拖书签之后清空，回到默认。
   */
  const exs = currentWorkout.exercises ?? [];
  const [pickedSetId, setPickedSetId] = useState<string | null>(null);
  const seam = pointerSeam(exs);
  const defaultRow = nextPendingRow(exs);
  const pickedValid = !!pickedSetId && exs.some(e => e.sets.some(s => String(s.id) === pickedSetId));
  const selectedSetId = pickedValid ? pickedSetId : defaultRow?.setId ?? null;
  const cards = buildCards(exs);

  /**
   * 换动作自动跟过去（2026-10-26）：点组号把指针推进到另一张卡时，页面滚到那张卡顶；同一张卡内不滚。
   * 只由点组号触发（tapSetNum 里记下目标卡），删组 / 拖书签 / 撤销挪动指针都不滚 —— 那些时候手在别处。
   */
  const scrollToCardRef = useRef<string | null>(null);
  useEffect(() => {
    const key = scrollToCardRef.current;
    if (!key) return;
    scrollToCardRef.current = null;
    document.querySelector<HTMLElement>(`[data-card-key="${key}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [exs]);

  const setExs = (fn: (list: Exercise[]) => Exercise[]) =>
    setCurrentWorkout(w => ({ ...w, exercises: normalizeGroups(fn(w.exercises ?? [])) }));

  const isSigned = (ex: Exercise) => usesSignedLoad(ex, signedLoadOf(ex));

  /**
   * 点组号：一下＝选中这一组；待做的组顺带做完、指针前进（语义全在 workbench.tapSetNum）。
   * 已选中的组再点什么都不变；全零的组点不实，只选中。
   * 编辑旧训练另走 tapSetNumEditing：只动被点的那一组（练完的训练没有指针可挪）。
   */
  const tapSetNum = (r: RowRef) => {
    // 已经实心（选中）的做完组再点：什么都不变（2026-10-25 用户定）。
    // 只挡做完的：没点过时默认实心的是指针下面那一组待做，点它就是「这组做完了」
    if (r.setId === selectedSetId && findSet(exs, r)?.ghost === false) return;
    const res = editingWorkoutId ? tapSetNumEditing(exs, r) : tapSetNumPure(exs, r);
    if (res.outcome === 'noop') return;
    haptic(H.tap);
    // 被点的那组就是选中的，做完也一样：刚做完常要回头改这一组的数（2026-10-25 用户定，撤掉审查 A1 的「交给默认」）
    setPickedSetId(r.setId);
    if (res.outcome === 'select') return;
    if (res.outcome === 'empty') {
      // 全零的组点不实：一组什么都没填，做完也记不下任何东西
      toast(isCn ? '这组还没填数' : 'Nothing entered yet', 'info');
      return;
    }
    const nextSeam = pointerSeam(res.exs);
    if (nextSeam && nextSeam.cardKey !== seam?.cardKey) scrollToCardRef.current = nextSeam.cardKey;
    setCurrentWorkout(w => ({ ...w, exercises: normalizeGroups(stampDoneUnit(exs, res.exs)) }));
    if (res.suggestPair) {
      const { a, b } = res.suggestPair;
      const other = exs.find(e => e.id === b);
      toastUndo(
        isCn ? `和「${other ? resolveName(other.name) : ''}」交替做？` : `Alternate with "${other ? resolveName(other.name) : ''}"?`,
        () => setExs(list => groupExercises(list, [a, b])),
        { undoLabel: isCn ? '交替' : 'Alternate', durationMs: 6000 },
      );
    }
  };

  /**
   * 「杠铃片」：这一下由待做变成做完的组，记下做完时挂的是哪种片 —— 这个馆的片子单位（审查 A8：原来记显示单位，
   * 显示 lb 的 kg 馆会被记成磅片）。纯数字的动作没有片子：已经记过的照留，没记过的按显示单位。
   * 之后切单位，做完的组不动，行下标「做完时挂的是磅片」靠它；下一次抄底稿时「上次 x」的单位也靠它。
   */
  const stampDoneUnit = (prev: typeof exs, next: typeof exs) => {
    const shown: SetLog['plateUnit'] = unit === 'lbs' ? 'lbs' : 'kg';
    const was = new Map<string, boolean>();
    for (const e of prev) for (const st of e.sets) was.set(`${e.id}|${st.id}`, !!st.ghost);
    return next.map(e => {
      let changed = false;
      const gu = rounderFor(e, currentWorkout.gym)?.unit;
      const sets = e.sets.map(st => {
        if (st.ghost || !was.get(`${e.id}|${st.id}`) || !(Number(st.weight) > 0 || st.subSets?.length)) return st;
        changed = true;
        const u = gu ?? st.plateUnit ?? shown;
        return { ...st, plateUnit: u, ...(st.subSets?.length ? { subSets: st.subSets.map(sub => ({ ...sub, plateUnit: gu ?? sub.plateUnit ?? u })) } : {}) };
      });
      return changed ? { ...e, sets } : e;
    });
  };

  const movePointer = (cardKey: string, gap: number) => {
    // 拖指针做完的组同样记下做完时挂的片
    setCurrentWorkout(w => ({ ...w, exercises: stampDoneUnit(w.exercises ?? [], movePointerTo(w.exercises ?? [], cardKey, gap)) }));
    setPickedSetId(null);
  };

  /** 更新一组（按 id，交替组和单卡共用）；后面同值、没动过的底稿跟着变（workbench.applySetUpdate） */
  const updateSet = (r: RowRef, updates: Partial<SetLog>) =>
    setCurrentWorkout(w => ({
      ...w,
      // 被带着平移的组 / 递减档按这一场的馆就近取整（docs/design-plates.md §3）；纯数字动作照旧纯平移
      exercises: applySetUpdate(w.exercises ?? [], r, updates, e => rounderFor(e, w.gym)?.snapKg ?? null),
    }));

  /** 添加组：克隆这个动作最后一组的值，新行从待做开始 */
  const addSetTo = (exId: string) =>
    setCurrentWorkout(w => ({
      ...w,
      exercises: (w.exercises ?? []).map(e => {
        if (e.id !== exId) return e;
        const lastSet = e.sets.length > 0 ? e.sets[e.sets.length - 1] : null;
        // 克隆上一行的值，新行从【待做】开始（第 4 条）：加出来不等于做完了。
        // 力竭是当日这一组的事实，不跟着抄；touched / 跳过 / 先后号同理。
        // 递减档照抄（2026-10-15 用户定：和普通组一样继承；不做那档就删掉），换新 id、去掉改过标记。
        const newId = `${Date.now()}`;
        // 编辑旧训练时加的组是补记做过的（审查 B3）：直接按做完入册，不用再点一下组号；新训练照旧从待做开始
        const asDone = !!editingWorkoutId;
        const newSet: SetLog = lastSet
          ? (() => {
              // draftAuto / checkWeight / prefillRef 不抄（上一次并没有这一组，不能也标「上次」）：抄出来的是「照着上一行」，不是「从上一次纯换算来的」；
              // 片子单位按这个馆的片子（这一组还没做，挂的就是今天的片）
              const { subSets, touched: _t, fromGhost: _fg, toFailure: _tf, skipped: _sk, seq: _q, draftAuto: _da, checkWeight: _cw, prefillRef: _pr, ...base } = lastSet;
              const pu: SetLog['plateUnit'] = rounderFor(e, w.gym)?.unit ?? (unit === 'lbs' ? 'lbs' : 'kg');
              return {
                ...base,
                id: newId,
                ghost: !asDone,
                ...(Number(base.weight) > 0 ? { plateUnit: pu } : {}),
                ...(subSets?.length
                  ? {
                      subSets: subSets.map(({ touched: _st, draftAuto: _sda, checkWeight: _scw, prefillRef: _spr, ...sub }, k) => ({
                        ...sub,
                        id: `${newId}_sub${k}`,
                        ...(Number(sub.weight) > 0 ? { plateUnit: pu } : {}),
                      })),
                    }
                  : {}),
              };
            })()
          : { id: newId, weight: 0, reps: 0, ghost: !asDone };
        return { ...e, sets: [...e.sets, newSet] };
      }),
    }));

  /**
   * 删组：单击即删，不给撤销（2026-10-18 用户定：删了加回来就行，撤销条一次都没点过，
   * 原先的「删组 / 删动作后可撤销」开关一起去掉）
   */
  const removeSet = (r: RowRef) => {
    const ex = exs.find(e => e.id === r.exId);
    const idx = ex?.sets.findIndex(s => String(s.id) === r.setId) ?? -1;
    if (!ex || idx < 0) return;
    setCurrentWorkout(w => ({
      ...w,
      exercises: (w.exercises ?? []).map(e =>
        e.id === r.exId ? { ...e, sets: e.sets.filter(st => String(st.id) !== r.setId) } : e,
      ),
    }));
    if (pickedSetId === r.setId) setPickedSetId(null);
  };

  /** 删一档递减 / 递增：同删组，单击即删、不给撤销 */
  const removeSubSet = (r: RowRef, subIdx: number) => {
    const set = findSet(exs, r);
    const removed = (set?.subSets ?? [])[subIdx];
    if (!removed) return;
    const patchSubs = (fn: (subs: SubSetLog[]) => SubSetLog[]) => {
      setCurrentWorkout(w => ({
        ...w,
        exercises: (w.exercises ?? []).map(e =>
          e.id !== r.exId
            ? e
            : { ...e, sets: e.sets.map(st => (String(st.id) === r.setId ? { ...st, subSets: fn(st.subSets ?? []) } : st)) },
        ),
      }));
    };
    patchSubs(subs => subs.filter(sb => sb.id !== removed.id));
  };

  const exerciseCount = exs.length;
  // 底稿行不算数据（§12.6）：口径必须跟刊头的 realSetCount 一致，
  // 否则刊头写「3组」底栏写「4组」，其中一个在说假话。
  const setCount = exs.reduce((s, ex) => s + (ex.sets?.filter(set => !set.ghost).length || 0), 0);
  /**
   * 是否先问「今天练哪里」。四个条件缺一不可：
   *  - 还没有动作：一旦开始记就不该再打断
   *  - 不是在编辑旧训练：那是在改历史，问部位没有意义
   *  - 标题为空：从计划开始的训练已经带着名字（useWorkoutMutations.ts:381）
   *  - 本次训练还没选过：含选了「其他」的情况（那时标题仍为空）
   */
  const needsBodyPart =
    exerciseCount === 0 &&
    !editingWorkoutId &&
    !currentWorkout.title &&
    partChosenFor !== currentWorkout.id &&
    partPrechosenId !== currentWorkout.id;

  /**
   * FAB 印谱选了「⋯」（其他）进来：部位已在手势里选过，这里只剩把名字写出来。
   * 延后一拍聚焦（同 onPickOther 的理由：等重排结束，否则移动端键盘弹不出来）。
   */
  const focusedForRef = useRef<string | null>(null);
  useEffect(() => {
    if (
      partPrechosenId === currentWorkout.id &&
      !currentWorkout.title &&
      exerciseCount === 0 &&
      focusedForRef.current !== currentWorkout.id
    ) {
      focusedForRef.current = currentWorkout.id;
      window.setTimeout(() => titleInputRef.current?.focus(), 0);
    }
  }, [partPrechosenId, currentWorkout.id, currentWorkout.title, exerciseCount]);

  /** §12.7 长按刊头拖动排序 */
  const reorder = useCardReorder({
    // 按卡排：交替组整张一起挪
    count: cards.length,
    onReorder: (from, to) => {
      setCurrentWorkout(w => {
        const list = w.exercises ?? [];
        const cs = buildCards(list);
        const order = [...cs];
        const [moved] = order.splice(from, 1);
        order.splice(to, 0, moved);
        const m = new Map(list.map(e => [e.id, e]));
        return { ...w, exercises: order.flatMap(c => c.exIds.map(id => m.get(id)!)) };
      });
    },
  });

  // 弹层关闭后：滚到最新添加的动作卡并高亮
  useEffect(() => {
    if (!flashExerciseId) return;
    const el = document.querySelector<HTMLElement>(`[data-ex-card="${flashExerciseId}"]`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      // §5.5：anim-ring（1.6s 的 box-shadow 光晕）已废弃——那是 Material 的辐射语汇，
      // 纸上没有辐射源，而且逐帧重绘 96 帧。改成一次墨色过冲。
      el.classList.remove('anim-ink-mark');
      void el.offsetWidth;
      el.classList.add('anim-ink-mark');
      flashTimerRef.current = window.setTimeout(() => {
        el.classList.remove('anim-ink-mark');
        onFlashDone();
      }, 600);
    } else {
      onFlashDone();
    }
    return () => {
      if (flashTimerRef.current !== null) window.clearTimeout(flashTimerRef.current);
    };
  }, [flashExerciseId, onFlashDone]);

  return (
    // ⚠️ anim-tab-enter 动的是 transform，而带 transform 的元素会成为
    // position: fixed 子元素的包含块 —— 底部常驻栏与添加动作弹层的 inset-0
    // 会改为对着这个盒子解析，被顶出视口。所以它们必须留在这个包装层之外。
    <>
      <div className="anim-tab-enter">
        {/* 本页唯一顶栏（AppHeader 在训练页隐藏），pt-14 为状态栏留白 */}
      <div className="sticky top-0 -mx-4 md:-mx-8 px-4 md:px-8 pt-14 pb-3 md:pt-[calc(env(safe-area-inset-top)+0.75rem)] bg-base/95 z-sticky border-b border-divider mb-4">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onBack}
            className="w-11 h-11 flex-shrink-0 inline-flex items-center justify-center bg-card/60 border border-divider rounded-card text-primary hover:bg-card active:scale-press-sm transition-ui"
            aria-label={isCn ? '返回' : 'Back'}
          >
            <ArrowLeft size={18} />
          </button>

          <div className="flex-1 min-w-0 space-y-1">
            {/* flex-wrap + 每项 nowrap：360/384 宽下编辑态的五项挤不下一行，
                原先是每项被压成一字一行（「未保存」竖着排）；现在整项折到第二行。 */}
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-micro font-bold text-tertiary uppercase tracking-[0.15em] [&>*]:whitespace-nowrap">
              {/* 「新建训练」字样拿掉了（2026-10-25）：顶栏要给撤销 / 重做让一列，训练页本身就说明了是新的一场；
                  编辑旧训练还写「编辑训练」—— 那时保存语义不一样，得看得出来 */}
              {editingWorkoutId && <span>{isCn ? '编辑训练' : 'Edit Workout'}</span>}
              {editingWorkoutId && currentWorkout.date && (
                <button
                  type="button"
                  onClick={onChangeDate}
                  className="normal-case tracking-normal text-tertiary hover:text-accent transition-colors inline-flex items-center gap-1"
                  title={isCn ? '修改训练日期' : 'Change workout date'}
                >
                  ·{' '}
                  {new Date(currentWorkout.date).toLocaleDateString(
                    isCn ? 'zh-CN' : 'en-US',
                    { month: 'numeric', day: 'numeric', weekday: 'short' },
                  )}
                </button>
              )}
              {/* §12.11 场地：日期右边一格。没标过时只是个淡图标，
                  标过之后显示场地名 —— 常驻但极轻，语义不会漂。 */}
              {onChangeGym && (
                <button
                  type="button"
                  onClick={onChangeGym}
                  // 没选馆时只剩一个图标，以前再降到 45% 透明度，约 1.9:1 看不见能点（2026-10-22 颜色审查）
                  className="normal-case tracking-normal inline-flex items-center gap-1 transition-colors hover:text-accent text-tertiary"
                  title={translations.gymPickTitle[lang] as string}
                  aria-label={translations.gymPickTitle[lang] as string}
                  data-testid="gym-button"
                >
                  <MapPin size={10} strokeWidth={2} />
                  <span className="max-w-[6rem] truncate">{currentWorkout.gym || ''}</span>
                </button>
              )}
              <button
                type="button"
                onClick={onToggleUnit}
                className="ml-auto normal-case tracking-normal flex items-center gap-1 px-2 py-1 -my-1 rounded-chip bg-inset text-tertiary active:scale-press-sm hover:text-secondary transition-ui"
                title={isCn ? '切换 kg / 磅显示' : 'Toggle kg / lbs'}
                aria-label={isCn ? '切换重量单位' : 'Toggle weight unit'}
                data-testid="unit-toggle"
              >
                <Scale size={10} />
                {unit}
              </button>
              {/* 只在编辑旧训练、草稿和原样真不一样时亮；新训练每一下都已自动保存，不挂这个 */}
              {editingWorkoutId && hasUnsavedChanges && (
                <span className="inline-flex items-center gap-1 text-warning normal-case" data-testid="edit-dirty">
                  <span className="w-1.5 h-1.5 rounded-full bg-warning" />
                  {isCn ? '已修改' : 'Edited'}
                </span>
              )}
            </div>
            <input
              ref={titleInputRef}
              className="w-full bg-transparent text-base font-bold text-primary outline-none placeholder:text-tertiary min-h-[36px]"
              value={currentWorkout.title}
              onChange={e =>
                setCurrentWorkout({ ...currentWorkout, title: e.target.value })
              }
              placeholder={translations.trainingTitlePlaceholder[lang]}
            />
          </div>

          {/* 全局撤销 / 重做：独占一列、上下两行都不伸到它下面，纵向没有别的按钮（2026-10-25） */}
          <UndoRedoButtons isCn={isCn} />

          <button
            type="button"
            onClick={onFinishClick}
            data-armed={endArmed ? 'true' : undefined}
            disabled={saveStatus === 'saving' || !(currentWorkout.exercises?.length) || (!!editingWorkoutId && !hasUnsavedChanges)}
            data-testid="finish-button"
            className={`min-h-[44px] px-4 rounded-card font-bold text-small flex-shrink-0 flex items-center gap-2 transition-ui active:scale-press-sm ${
              saveStatus === 'saving'
                ? 'bg-tertiary/30 text-tertiary cursor-not-allowed'
                : saveStatus === 'saved'
                  ? 'bg-success text-on-accent'
                  : saveStatus === 'error'
                    ? 'bg-danger text-on-accent'
                    : !(currentWorkout.exercises?.length) || (editingWorkoutId && !hasUnsavedChanges)
                      ? 'bg-card/40 text-tertiary cursor-not-allowed'
                      : editingWorkoutId || endArmed
                        ? 'bg-accent text-on-accent hover:opacity-90'
                        // 训练中的「结束训练」用次要样式：这一屏的主操作是底部「添加动作」，
                        // 两个实心按钮一上一下抢眼，结束反而比继续练更显眼（2026-10-22 界面审查）
                        : 'bg-btn text-primary border border-divider [&>svg]:text-accent'
            }`}
          >
            {saveStatus === 'saving' ? (
              <>
                <div className="w-4 h-4 border-2 border-current/30 border-t-current rounded-full animate-spin" />
                <span>{editingWorkoutId ? (isCn ? '保存中' : 'Saving') : isCn ? '结束中' : 'Ending'}</span>
              </>
            ) : saveStatus === 'saved' ? (
              <>
                <Flag size={16} strokeWidth={3} />
                <span>{isCn ? '已结束' : 'Ended'}</span>
              </>
            ) : saveStatus === 'error' ? (
              <>
                <X size={16} strokeWidth={3} />
                <span>{isCn ? '失败' : 'Failed'}</span>
              </>
            ) : (
              <>
                {editingWorkoutId ? <Check size={16} strokeWidth={3} /> : <Flag size={16} strokeWidth={3} />}
                <span>
                  {editingWorkoutId
                    ? isCn ? '保存修改' : 'Save changes'
                    : endArmed
                      ? isCn ? '再点一次结束' : 'Tap again to end'
                      : isCn ? '结束训练' : 'End Workout'}
                </span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* 拖动排序时浮出的位置条：每张卡一行（交替组一行写全部成员） */}
      <ReorderStrip
        strip={reorder.strip}
        labels={cards.map(c => c.exIds.map(id => resolveName(exs.find(e => e.id === id)?.name ?? '')).join(' ⇄ '))}
      />

      {/* 动作卡列表；底部为常驻添加栏预留空间 */}
      <div className="space-y-6 pb-32">
        {cards.map((card, ci) => {
          // 编辑旧训练不画书签：拖它往上会把后面的组退回待做，保存时整段被剥掉
          const pointerGap = !editingWorkoutId && seam?.cardKey === card.key ? seam.gap : null;
          const wrap = (body: React.ReactNode, flashId: string) => (
            <div
              key={card.key}
              data-ex-card={flashId}
              data-card-key={card.key}
              ref={reorder.itemRef(ci)}
              // scroll-mt：自动跟到下一张卡时别钻到吸顶页头底下
              className={`relative rounded-card bg-base scroll-mt-28${reorder.draggingIdx === ci ? ' reorder-lifted' : ''}`}
            >
              {body}
            </div>
          );
          const dragHandle =
            cards.length > 1
              ? {
                  handlers: reorder.handleProps(ci),
                  pressing: reorder.pressingIdx === ci,
                  hinting: reorder.hintingIdx === ci,
                  drawMs: reorder.drawMs,
                }
              : undefined;

          if (card.group) {
            const members = card.exIds.map(id => exs.find(e => e.id === id)!).filter(Boolean);
            const indexOf = (exId: string) => exs.findIndex(e => e.id === exId);
            return wrap(
              <AlternatingCard
                cardKey={card.key}
                cardNo={ci + 1}
                members={members}
                rows={cardRows(card, exs)}
                lang={lang}
                unit={unit}
                exerciseNotes={exerciseNotes}
                getActiveMetrics={getActiveMetrics}
                resolveName={resolveName}
                isSigned={isSigned}
                pointerGap={pointerGap}
                onMovePointer={movePointer}
                selectedSetId={selectedSetId}
                onNumTap={tapSetNum}
                onSetUpdate={updateSet}
                onRemoveSet={removeSet}
                onRemoveSubSet={removeSubSet}
                onAddSet={addSetTo}
                gym={currentWorkout.gym}
                onMoveMember={(exId, dir) => setExs(list => moveGroupMember(list, exId, dir))}
                onRemoveMember={exId => setExs(list => removeFromGroup(list, exId))}
                onDeleteMember={exId => onDeleteExerciseFromSession(indexOf(exId))}
                renameMember={exId => {
                  const ex = exs.find(e => e.id === exId);
                  const def = ex ? findExerciseDef(ex.name) : null;
                  return ex && def ? () => onRenameExercise(def.id, resolveName(ex.name)) : undefined;
                }}
                onSplit={() => setExs(list => splitGroup(list, card.group!))}
                onAddMember={() => onPickerOpenChange(true, null, card.group)}
                onSwitchRowExercise={(r, to) => setExs(list => moveSetToExercise(list, r, to, isSigned))}
                onSwitchVariant={(exId, v, name) => onSwitchVariant(exId, v, name)}
                onToggleNote={onToggleNote}
                onOpenMetricModal={(name, exId) => onOpenMetricModal(name, indexOf(exId), undefined, true)}
                onOpenTimePicker={(exId, setId) => {
                  const ei = indexOf(exId);
                  const si = exs[ei]?.sets.findIndex(s => String(s.id) === setId) ?? -1;
                  if (ei >= 0 && si >= 0) onOpenTimePicker(ei, si);
                }}
                dragHandle={dragHandle}
              />,
              members[members.length - 1]?.id ?? card.key,
            );
          }

          const ex = exs.find(e => e.id === card.exIds[0])!;
          const exIdx = exs.indexOf(ex);
          const next = cards[ci + 1];
          const prev = cards[ci - 1];
          return wrap(
            <ExerciseCard
              exercise={ex}
              exIdx={exIdx}
              cardNo={ci + 1}
              lang={lang}
              unit={unit}
              exerciseNotes={exerciseNotes}
              getActiveMetrics={getActiveMetrics}
              resolveName={resolveName}
              pointerGap={pointerGap}
              onMovePointer={movePointer}
              selectedSetId={selectedSetId}
              onNumTap={setId => tapSetNum({ exId: ex.id, setId })}
              signed={isSigned(ex)}
              gym={currentWorkout.gym}
              onAlternateWithNext={
                next ? () => setExs(list => groupExercises(list, [ex.id, ...next.exIds])) : undefined
              }
              onJoinGroupAbove={
                prev?.group ? () => setExs(list => groupExercises(list, [...prev.exIds, ex.id])) : undefined
              }
              onUpdateExercise={(idx, updates) => {
                setCurrentWorkout(w => {
                  const list = [...(w.exercises ?? [])];
                  list[idx] = { ...list[idx], ...updates };
                  return { ...w, exercises: list };
                });
              }}
              onDeleteExercise={onDeleteExerciseFromSession}
              dragHandle={dragHandle}
              onOpenTimePicker={onOpenTimePicker}
              onOpenExerciseTime={onOpenExerciseTime ? () => onOpenExerciseTime(ex.id) : undefined}
              lastSession={lastSessionFor ? lastSessionFor(ex) : null}
              // 编辑旧训练不判纪录（和结束训练时的 detectPRs 同一口径）
              prPool={!editingWorkoutId && prPoolFor ? prPoolFor(ex) : null}
              onToggleNote={onToggleNote}
              onOpenMetricModal={(name, focus) => onOpenMetricModal(name, exIdx, focus)}
              settingsSlot={metricSlot?.exIdx === exIdx ? metricSlot.el : null}
              onSwitchVariant={(v, name) => onSwitchVariant(ex.id, v, name)}
              onRename={(() => {
                const def = findExerciseDef(ex.name);
                return def ? () => onRenameExercise(def.id, resolveName(ex.name)) : undefined;
              })()}
              onSetUpdate={(_eIdx, setIdx, updates) => {
                const s = ex.sets[setIdx];
                if (s) updateSet({ exId: ex.id, setId: String(s.id) }, updates);
              }}
              onAddSet={() => addSetTo(ex.id)}
              onRemoveSet={(_eIdx, setIdx) => {
                const s = ex.sets[setIdx];
                if (s) removeSet({ exId: ex.id, setId: String(s.id) });
              }}
              onRemoveSubSet={(_eIdx, setIdx, subIdx) => {
                const s = ex.sets[setIdx];
                if (s) removeSubSet({ exId: ex.id, setId: String(s.id) }, subIdx);
              }}
            />,
            ex.id,
          );
        })}

        {exerciseCount === 0 &&
          (needsBodyPart ? (
            <BodyPartPicker
              lang={lang}
              onPick={(title, bodyPart) => {
                // 记下这一场练的部位：之后每次「添加动作」都默认停在这一栏
                setCurrentWorkout({ ...currentWorkout, title, ...(bodyPart ? { focusPart: bodyPart } : {}) });
                setPartChosenFor(currentWorkout.id);
                // 选完部位的下一步必然是挑动作，别让用户再点一次「添加动作」。
                // （「其他」不走这条：那条路的下一步是把名字打出来，
                //   弹层盖上去反而挡住标题输入框。）
                // 选的是「练胸」，弹层就直接停在胸部那一栏。
                onPickerOpenChange(true, bodyPart);
              }}
              onPickOther={() => {
                setPartChosenFor(currentWorkout.id);
                // 「其他」的全部含义就是「我自己写」——把焦点交给顶部标题输入框。
                // 延后一拍：本次 setState 引发的重排结束后再 focus，否则移动端键盘弹不出来。
                window.setTimeout(() => titleInputRef.current?.focus(), 0);
              }}
            />
          ) : (
            <div className="bg-inset border border-dashed border-divider rounded-card p-10 text-center space-y-2">
              <p className="text-small text-secondary font-semibold">
                {isCn ? '还没有动作' : 'No exercises yet'}
              </p>
              <p className="text-xs text-tertiary">
                {isCn ? '点击下方「添加动作」开始记录' : 'Tap "Add Exercise" below to start'}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* 底部常驻添加栏 —— fixed，故意在 anim-tab-enter 之外 */}
      <div
        className="fixed bottom-0 inset-x-0 z-bar bg-base/95 border-t border-divider"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="max-w-2xl mx-auto flex items-center gap-3 px-4 py-3">
          <span className="text-xs font-semibold text-secondary whitespace-nowrap tabular-nums">
            {exerciseCount} {isCn ? '动作' : 'ex'} · {setCount} {isCn ? '组' : plural(setCount, 'set')}
          </span>
          <button
            type="button"
            onClick={() => onPickerOpenChange(true)}
            className="flex-1 min-h-[52px] rounded-card bg-accent text-on-accent text-base font-bold flex items-center justify-center gap-2 active:scale-press transition-transform"
            data-testid="open-picker-sheet"
          >
            <Plus size={19} strokeWidth={2.5} />
            {isCn ? '添加动作' : 'Add Exercise'}
          </button>
        </div>
      </div>

      {/* 添加动作弹层（常驻挂载，open 控制显隐 → 筛选记忆） */}
      <ExercisePickerSheet
        open={pickerOpen}
        gym={currentWorkout.gym}
        focusPart={pickerFocusPart}
        targetLabel={pickerTargetLabel}
        onClose={() => onPickerOpenChange(false)}
        addedCounts={addedCounts}
        sessionAdded={sessionAdded}
        onPickExercise={onPickExercise}
        onPartChange={bodyPart => {
          // B3：开场点错部位没退路 —— 训练名还是「练胸」这种自动填的，就跟着弹层里换的部位改。
          // 只在还一个动作都没加的时候（审查 A14）：加了胸的动作再去背那一栏找一个，是在找动作，不是改主意；
          // 标题和「添加动作默认停的那一栏」（focusPart）一起改，两者不打架
          const label = partTitleFor(bodyPart, lang);
          if (!label) return;
          setCurrentWorkout(w =>
            (w.exercises?.length ?? 0) > 0 || !w.title || w.title === label || !isPartTitle(w.title, lang)
              ? w
              : { ...w, title: label, focusPart: bodyPart },
          );
        }}
        onCreateCustomExercise={onCreateCustomExercise}
        onEditExerciseTags={onEditExerciseTags}
        onDeleteExercise={onDeleteLibraryExercise}
        onOpenNote={onToggleNote}
        onOpenMetrics={name => onOpenMetricModal(name)}
      />
    </>
  );
};
