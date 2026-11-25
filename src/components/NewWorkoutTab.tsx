/**
 * 新建 / 编辑训练页（从 App.tsx 抽出，减轻主文件体积）
 *
 * 添加动作走底部常驻栏唤起的 ExercisePickerSheet（弹层），页面本体只保留动作卡列表。
 * 本页隐藏全局 AppHeader，自己的 sticky 头部是唯一顶栏（含状态栏留白）。
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  CalendarDays,
  Check,
  Flag,
  MapPin,
  Plus,
  X,
  Scale,
  StickyNote,
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
import { AlternatingCard, Panel, panelBtn } from './AlternatingCard';
import {
  applySetUpdate,
  buildCards,
  cardRows,
  findSet,
  groupExercises,
  isJustDone,
  moveGroupMember,
  doneCount,
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
  willRecord,
} from '../utils/workbench';
import { usesSignedLoad } from '../utils/load';
import { useLoadRounder } from '../hooks/useLoadRounder';
import { haptic, H } from '../utils/haptics';
import { ExercisePickerSheet } from './ExercisePickerSheet';
import { useWorkoutContext } from '../contexts/WorkoutContext';
import { altCombosByName, type LastHit } from '../utils/prefillSource';
import { isBackdated } from '../utils/sessionDate';
import { isToday } from '../utils/dateUtils';
import { BodyPartPicker, isPartTitle, partTitleFor } from './BodyPartPicker';
import { useCardReorder } from '../hooks/useCardReorder';
import { ReorderStrip } from './ReorderStrip';
import { plural } from '../utils/format';
import { useExercisePrefs } from '../contexts/ExercisePrefsContext';
import { UndoRedoButtons } from './UndoRedoButtons';
import { LocalDataAlert } from './LocalDataAlert';
import { copyValues } from '../utils/setValues';
import { SetActionStrip } from './SetActionStrip';

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
  /** exIdx 用于在弹窗内修改该动作实例的负重/辅助标记；从动作库进来时不给（不显示那一节） */
  onOpenMetricModal: (name: string, exIdx?: number, focus?: 'gym') => void;
  /** 动作设置弹窗里「在 X」一段的挂载点，交给弹窗所属的那张卡 */
  metricSlot?: { exIdx: number; el: HTMLElement | null } | null;
  onDeleteExerciseFromSession: (exIdx: number) => void;
  /** 打开日期时间选择器：编辑旧训练改日期；训练中改到过去＝补录 */
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
  onPickExercise: (ex: ExerciseDefinition, variantId: string | undefined, altFrom: LastHit | undefined, existingId: string | null) => boolean | void;
  onCreateCustomExercise: (prefilled?: string, preset?: { bodyPart?: string; category?: string; regions?: string[]; equipment?: string }) => void;
  /** 弹层动作面板里的「部位与器材」（转发到 App 层的弹窗） */
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
  onSwitchVariant,
  onDeleteLibraryExercise,
  flashExerciseId,
  onFlashDone,
  partPrechosenId = null,
}) => {
  const isCn = lang === Language.CN;  const { signedLoadOf } = useExercisePrefs();
  const { workouts } = useWorkoutContext();
  // 训练中改过日期的场（补录）：和编辑旧训练一样，只看那一场之前的
  const backdated = !editingWorkoutId && isBackdated(currentWorkout);
  // 补加旧训练 / 补录：选动作列表只看那一场之前的（交替搭配、行上的「上次」和点行铺的底稿同一个范围，审查 C102）
  const historyBefore = editingWorkoutId || backdated ? currentWorkout.date : undefined;
  // 选动作列表里的交替搭配：范围和点行时带搭档的一样（跳过这一场自己）
  const altCombos = useMemo(
    () => (pickerOpen ? altCombosByName(workouts, resolveName, currentWorkout.id || undefined, historyBefore) : undefined),
    [pickerOpen, workouts, resolveName, currentWorkout.id, historyBefore],
  );
  const rounderFor = useLoadRounder();
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
   * 卡上一个有数的组都没有（没东西可入册）时不上膛，直接交给下面问「放弃？」。
   */
  const [endArmed, setEndArmed] = useState(false);
  const endArmTimer = useRef<number | null>(null);
  useEffect(() => () => window.clearTimeout(endArmTimer.current ?? undefined), []);
  const onFinishClick = () => {
    const anyRecorded = (currentWorkout.exercises ?? []).some(e => e.sets.some(willRecord));
    if (editingWorkoutId || !anyRecorded) {
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
   * 整场备注（2026-10-27 批示）：给这一场留一句「为什么今天不一样」（没睡好、养伤降重），
   * 以后翻时间线看到数字掉了知道原因。只是一条文字，不参与任何计算。
   * 入口是刊头下的眉批（§6.2），点开原地变成多行输入，不弹层（§6.6）；失焦收回成一行。
   */
  const [noteOpen, setNoteOpen] = useState(false);
  useEffect(() => setNoteOpen(false), [currentWorkout.id]);
  /** 吸顶页头里的备注入口（审查 A8）：练到后半场不用滚回页顶找眉批 */
  const openNoteFromHeader = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    setNoteOpen(true);
  };

  /** 「和…交替做」选目标的面板开着：给的是发起的那张单卡的动作 id */
  const [pairFor, setPairFor] = useState<string | null>(null);

  /**
   * 「做到哪了」（2026-10 指针，demo：docs/demos/set-pointer-alternating.html）：全场一个指针，
   * 指针以上算练过的，位置记在组上（workbench.pointerSeam），所以重开工作台、接回训练、删组之后它自己就落在对的地方；
   * 没点过任何组时在第一组上方。
   *
   * 选中：组号实心 = 我点过的那一组（审查 A5：没手动选中时任何组号都不实心，「实心」只有一种来历）。
   * 点哪一组的组号，哪一组就选中，指针落到它正下方，往回点也一样（2026-11-23 用户定：没有单独的「做完」）。
   * 删掉 / 拖书签之后清空选中。没选中时底栏操作条改的是指针下面那一组，小字写明第几组。
   */
  const exs = currentWorkout.exercises ?? [];
  const [pickedSetId, setPickedSetId] = useState<string | null>(null);
  const seam = pointerSeam(exs);
  const pickedFound: RowRef | null =
    (pickedSetId && exs.flatMap(e => e.sets.filter(s => String(s.id) === pickedSetId).map(s => ({ exId: e.id, setId: String(s.id) }))).at(0)) || null;
  // 选中的组就是指针正上方那一组：撤销把指针挪走之后，留着的 pickedSetId 不再算选中（否则组号实心、指针却在别处）。
  // 编辑旧训练没有指针，点哪组选哪组
  const pickedRow = pickedFound && (editingWorkoutId || isJustDone(exs, pickedFound)) ? pickedFound : null;
  const selectedSetId = pickedRow ? pickedSetId : null;
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

  /**
   * 选中组操作条（SetActionStrip）固定在底栏上方，改的是选中那一组；没选中时是指针下面那一条待做组。
   * 软键盘起来时和添加动作弹层开着时收掉：前者让键盘上方只剩正在改的那行，后者弹层盖住了它。
   */
  const stripRef = pickedRow ?? nextPendingRow(exs);
  const selectedRow = stripRef
    ? exs.flatMap(e => (e.id === stripRef.exId ? e.sets.filter(s => String(s.id) === stripRef.setId).map(s => ({ ex: e, set: s })) : [])).at(0)
    : undefined;
  /** 行上显示的组号：单卡是第几组，交替卡里按动作各数各的（同 AlternatingCard 按行序数） */
  const rowNo = (r: RowRef): number => {
    const card = cards.find(c => c.exIds.includes(r.exId));
    let n = 0;
    for (const x of card ? cardRows(card, exs) : []) {
      if (x.exId !== r.exId) continue;
      n++;
      if (x.setId === r.setId) return n;
    }
    return n;
  };
  /**
   * 键盘在不在（审查 A9）：不看输入框焦点 —— 用系统的收起键盘收掉键盘后，输入框还拿着焦点，操作条会一直不回来。
   * 看可见视口比见过的最高矮了多少：Capacitor adjustResize 下 innerHeight 跟着缩，和它比不出来。宽度变了（转屏）重新记。
   */
  const [keyboardUp, setKeyboardUp] = useState(false);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    let tallest = vv.height;
    let width = vv.width;
    const sync = () => {
      if (vv.width !== width) {
        width = vv.width;
        tallest = vv.height;
      }
      tallest = Math.max(tallest, vv.height);
      setKeyboardUp(tallest - vv.height > 150);
    };
    vv.addEventListener('resize', sync);
    return () => vv.removeEventListener('resize', sync);
  }, []);
  const stripRow = selectedRow && !keyboardUp && !pickerOpen ? selectedRow : null;

  const setExs = (fn: (list: Exercise[]) => Exercise[]) =>
    setCurrentWorkout(w => ({ ...w, exercises: normalizeGroups(fn(w.exercises ?? [])) }));

  // 交替卡渲染时就调它：身份只跟 signedLoadOf 变（卡包了 memo，见下面 cardFn）
  const isSigned = useCallback((ex: Exercise) => usesSignedLoad(ex, signedLoadOf(ex)), [signedLoadOf]);

  /**
   * 两种卡都包了 memo（审查 F4：录一组 / 拖一档原来整页每张卡都重渲染）。传给卡的回调每次渲染都是新闭包，memo 就白包了：
   * cardFn 按名字给一个身份不变的转发，调用时转给这一次渲染的闭包。在渲染里就写进去 —— 子组件的 effect 先于这里的 effect 跑，
   * 放进 effect 会让卡在 effect 里调到上一次的闭包。只用于事件 / effect 里才调的回调；渲染时就调的（isSigned、lastSessionFor、
   * prPoolFor）传本身，否则它们变了卡不跟着重画。传 undefined 回 undefined：卡上靠有没有来决定出不出那个菜单项。
   */
  const fnBoxes = useRef(new Map<string, { f: ((...a: any[]) => unknown) | undefined; stable: (...a: any[]) => unknown }>());
  function cardFn<F extends (...a: any[]) => any>(name: string, f: F): F;
  function cardFn<F extends (...a: any[]) => any>(name: string, f: F | undefined): F | undefined;
  function cardFn<F extends (...a: any[]) => any>(name: string, f: F | undefined): F | undefined {
    let box = fnBoxes.current.get(name);
    if (!box) {
      const b: { f: F | undefined; stable: (...a: any[]) => unknown } = { f, stable: (...a) => b.f!(...a) };
      box = b;
      fnBoxes.current.set(name, box);
    }
    box.f = f;
    return f ? (box.stable as F) : undefined;
  }
  /**
   * 动作库或卡片做法弹窗里删掉一个做法（审查 gap-2#4）：工作台上记着这个做法的卡当场回到标准
   * （和卡片自己弹窗里点「标准」一样：标签、画法、取整、「这一台」四处一致）。
   * 只看卡上写明的 variantId：靠并入别名认出的卡不用管 —— 删并入做法会先拆回，那些卡自己就回到了原来的动作。
   */
  const onVariantRemoved = (exerciseName: string, variantId: string) => {
    const target = resolveName(exerciseName);
    for (const ex of currentWorkout.exercises ?? []) {
      if (ex.variantId === variantId && resolveName(ex.name) === target) onSwitchVariant(ex.id, undefined);
    }
  };
  /** 每次渲染新建、内容常常没变的对象 / 数组（交替卡的成员、组行、拖动柄）：和上一次一样就还给上一次那个 */
  const keptVals = useRef(new Map<string, unknown>());
  const keep = <T,>(name: string, v: T, same: (a: T, b: T) => boolean): T => {
    const prev = keptVals.current.get(name) as T | undefined;
    if (prev !== undefined && same(prev, v)) return prev;
    keptVals.current.set(name, v);
    return v;
  };

  /**
   * 点组号：一下＝选中这一组，指针落到它正下方（语义全在 workbench.tapSetNum）。已选中的组再点什么都不变。
   * 编辑旧训练另走 tapSetNumEditing：只动被点的那一组（练完的训练没有指针可挪）。
   */
  const tapSetNum = (r: RowRef) => {
    if (r.setId === selectedSetId) return;
    const res = editingWorkoutId ? tapSetNumEditing(exs, r) : tapSetNumPure(exs, r);
    if (res.outcome === 'noop') return;
    haptic(H.tap);
    setPickedSetId(r.setId);
    if (res.outcome === 'select') return;
    const nextSeam = pointerSeam(res.exs);
    if (nextSeam && nextSeam.cardKey !== seam?.cardKey) scrollToCardRef.current = nextSeam.cardKey;
    setCurrentWorkout(w => ({ ...w, exercises: normalizeGroups(stampDoneUnit(exs, res.exs)) }));
  };

  /**
   * 「杠铃片」：这一下落到指针上面的组，记下当时挂的是哪种片 —— 这个馆的片子单位（审查 A8：原来记显示单位，
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
    // 书签拎起来又放回原处：不算拖动
    if (seam?.cardKey === cardKey && seam.gap === gap) return;
    const after = movePointerTo(exs, cardKey, gap);
    // 拖指针扫过的组同样记下当时挂的片
    setCurrentWorkout(w => ({ ...w, exercises: stampDoneUnit(w.exercises ?? [], after) }));
    setPickedSetId(null);
    // 落定后不弹底部提示（2026-11-18 用户定）：10-29 加它是因为「拖到底了」其实没动；
    // 那个根因已由拖动时自动滚页（RestBookmark）修掉，落点在拖动中的书签上写着，改错了走顶栏撤销
  };

  /** 更新一组（按 id，交替组和单卡共用）：只改这一组，同一组的递减档保持差值（workbench.applySetUpdate） */
  const updateSet = (r: RowRef, updates: Partial<SetLog>) =>
    setCurrentWorkout(w => ({
      ...w,
      // 被母组带着平移的递减档按这一场的馆就近取整（docs/design-plates.md §3）；纯数字动作照旧纯平移
      exercises: applySetUpdate(w.exercises ?? [], r, updates, e => rounderFor(e, w.gym)?.snapKg ?? null),
    }));

  /** 添加组：克隆这个动作最后一组的值，新行从待做开始；有数就入册（workbench.willRecord），全零的不入册 */
  const addSetTo = (exId: string) =>
    setCurrentWorkout(w => ({
      ...w,
      exercises: (w.exercises ?? []).map(e => {
        if (e.id !== exId) return e;
        const lastSet = e.sets.length > 0 ? e.sets[e.sets.length - 1] : null;
        // 克隆上一行的值，新行落在指针下面。
        // 力竭是当日这一组的事实，不跟着抄；touched / 跳过 / 先后号同理。
        // 递减档照抄（2026-10-15 用户定：和普通组一样继承；不做那档就删掉），换新 id、去掉改过标记。
        const newId = `${Date.now()}`;
        // 编辑旧训练时加的组是补记做过的（审查 B3）：直接按做完，不用再点一下组号；新训练照旧从待做开始
        const asDone = !!editingWorkoutId;
        const newSet: SetLog = lastSet
          ? (() => {
              // 只抄值、只抄开着的记录项（setValues.copyValues）：关掉的次数 / 重量不再藏在新组里入册（上架审查 gap-2#2）；
              // draftAuto / checkWeight / prefillRef 不抄（上一次并没有这一组，不能也标「上次」）：抄出来的是「照着上一行」。
              // 片子单位按这个馆的片子（这一组还没做，挂的就是今天的片）
              const { subSets } = lastSet;
              const base = copyValues(lastSet, getActiveMetrics(e.name));
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
  // 分子是指针进度（点过的组），不是入册数：有数的组结束时都入册（willRecord），抄来的底稿几乎都有数，
  // 按入册口径数开场就是满的。口径跟刊头的 realSetCount 一致，入册数看刊末页。
  const setCount = doneCount(exs);
  // 分母同刊头的 plannedCount：台上全部的组。做完数和台上的组数不一样时人才看得见「还有组没点完」
  const plannedCount = exs.reduce((s, ex) => s + (ex.sets?.length || 0), 0);
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

  /**
   * 一次加完几个动作（审查 G7）：弹层打开时记下已有的动作，关掉时落在这批里排在最前、还在的那张卡 ——
   * 开场一次点 5 个，要做的是第 1 张，不是最后点的那张。中途补加一个时和原来一样。换一场就作废。
   */
  const pickSnapRef = useRef<Set<string> | null>(null);
  // 先作废再记：开场长按 FAB 时换场和开弹层落在同一次提交里
  useEffect(() => {
    pickSnapRef.current = null;
  }, [currentWorkout.id]);
  useEffect(() => {
    if (pickerOpen) pickSnapRef.current = new Set(exs.map(e => e.id));
  }, [pickerOpen]);

  // 弹层关闭后：滚到这次添加的动作卡并高亮
  useEffect(() => {
    if (!flashExerciseId) return;
    const snap = pickSnapRef.current;
    pickSnapRef.current = null;
    const target = (snap && !snap.has(flashExerciseId) && exs.find(e => !snap.has(e.id))?.id) || flashExerciseId;
    const key = buildCards(exs).find(c => c.exIds.includes(target))?.key;
    const el = key ? document.querySelector<HTMLElement>(`[data-card-key="${key}"]`) : null;
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
    // 交替卡的面板（AlternatingCard 的 Panel，含这里的「和…交替做」）渲染在包装层里，所以它自己 portal 到 body。
    <>
      <div className="anim-tab-enter">
        {/* 本页唯一顶栏（AppHeader 在训练页隐藏），pt-14 为状态栏留白 */}
      <div className="sticky top-0 -mx-4 md:-mx-8 px-4 md:px-8 pt-14 pb-3 md:pt-[calc(env(safe-area-inset-top)+0.75rem)] bg-base z-sticky border-b border-divider mb-4">
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
            {/* 编辑态五项挤不下一行，整项折到第二行（每项 nowrap，否则压成一字一行）。
                训练中只有日期、馆和单位：不折行，馆名让位，头部高度不随按钮状态跳。
                手机宽度下这一行夹在撤销列和结束键之间只剩约 100px：今天的日期只给图标、备注图标放到标题行，
                否则馆名被压成 0 宽、点不到。 */}
            <div className={`flex ${editingWorkoutId ? 'flex-wrap' : ''} items-center gap-x-2 gap-y-1 text-micro font-bold text-tertiary uppercase tracking-[0.15em] [&>*]:whitespace-nowrap`}>
              {/* 「新建训练」字样拿掉了（2026-10-25）：顶栏要给撤销 / 重做让一列，训练页本身就说明了是新的一场；
                  编辑旧训练还写「编辑训练」—— 那时保存语义不一样，得看得出来 */}
              {editingWorkoutId && <span>{isCn ? '编辑训练' : 'Edit workout'}</span>}
              {/* 训练中也能改：忘了记、回头补录就把这场挪到那天（补录不新开首页入口，D2） */}
              {!!currentWorkout.id && (
                <button
                  type="button"
                  onClick={onChangeDate}
                  className="relative before:absolute before:-top-4 before:-bottom-1 before:-inset-x-1 flex-shrink-0 normal-case tracking-normal text-tertiary hover:text-accent transition-colors inline-flex items-center gap-1"
                  title={isCn ? '修改训练日期' : 'Change workout date'}
                  aria-label={isCn ? '修改训练日期' : 'Change workout date'}
                  data-testid="workout-date-button"
                >
                  {editingWorkoutId && '· '}
                  {!editingWorkoutId && isToday(new Date(currentWorkout.date))
                    ? <CalendarDays size={10} strokeWidth={2} />
                    : new Date(currentWorkout.date).toLocaleDateString(
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
                  className="relative before:absolute before:-top-4 before:-bottom-1 before:-inset-x-2 min-w-[10px] normal-case tracking-normal inline-flex items-center gap-1 transition-colors hover:text-accent text-tertiary"
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
                className="relative before:absolute before:-top-3 before:-bottom-1 before:inset-x-0 ml-auto flex-shrink-0 normal-case tracking-normal flex items-center gap-1 px-2 py-1 -my-1 rounded-chip bg-inset text-tertiary active:scale-press-sm hover:text-secondary transition-ui"
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
              {/* 存不进本机时常驻（上架审查 C13）：训练页没有顶栏，这里是唯一看得到的地方 */}
              <LocalDataAlert isCn={isCn} />
            </div>
            <div className="flex items-center gap-2">
              <input
                ref={titleInputRef}
                className="flex-1 min-w-0 bg-transparent text-base font-bold text-primary outline-none placeholder:text-tertiary min-h-[36px]"
                value={currentWorkout.title}
                onChange={e =>
                  setCurrentWorkout({ ...currentWorkout, title: e.target.value })
                }
                placeholder={translations.trainingTitlePlaceholder[lang]}
              />
              <button
                type="button"
                onClick={openNoteFromHeader}
                className="relative before:absolute before:-inset-3 flex-shrink-0 inline-flex items-center text-tertiary hover:text-secondary transition-colors"
                aria-label={isCn ? '整场备注' : 'Workout note'}
                data-testid="workout-notes-jump"
              >
                <StickyNote size={12} strokeWidth={2} />
                {/* 有备注时带一个点 */}
                {currentWorkout.notes && <span className="absolute -top-0.5 -right-1 w-1.5 h-1.5 rounded-full bg-accent" />}
              </button>
            </div>
          </div>

          {/* 全局撤销 / 重做：独占一列、上下两行都不伸到它下面，纵向没有别的按钮（2026-10-25） */}
          <UndoRedoButtons isCn={isCn} />

          <button
            type="button"
            onClick={onFinishClick}
            data-armed={endArmed ? 'true' : undefined}
            disabled={saveStatus === 'saving' || !(currentWorkout.exercises?.length) || (!!editingWorkoutId && !hasUnsavedChanges)}
            data-testid="finish-button"
            className={`min-h-[44px] min-w-[114px] px-4 rounded-card font-bold text-small flex-shrink-0 flex items-center justify-center gap-2 transition-ui active:scale-press-sm ${
              saveStatus === 'saving'
                ? 'bg-tertiary/30 text-tertiary cursor-not-allowed'
                : saveStatus === 'saved'
                  ? 'bg-success text-on-semantic'
                  : saveStatus === 'error'
                    ? 'bg-danger text-on-semantic'
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
                      // 和「结束训练」等字数：上膛这一下按钮不能变宽，否则挤动整个头部
                      ? isCn ? '确认结束' : 'Confirm end'
                      : isCn ? '结束训练' : 'End workout'}
                </span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* 整场备注眉批：有备注时露首行（二级字），没有时淡墨「加备注」；点开原地编辑 */}
      <div className="-mt-1 mb-5 px-1">
        {noteOpen ? (
          <textarea
            className="ui-input w-full min-h-[64px] resize-none text-small"
            value={currentWorkout.notes ?? ''}
            onChange={e => setCurrentWorkout({ ...currentWorkout, notes: e.target.value })}
            onBlur={() => setNoteOpen(false)}
            placeholder={isCn ? '比如：没睡好、养伤降重、换了器械' : 'e.g. slept badly, deload, different machine'}
            autoFocus
            data-testid="workout-notes-input"
          />
        ) : (
          <button
            type="button"
            onClick={() => setNoteOpen(true)}
            className={`inline-flex max-w-full text-left text-label ${currentWorkout.notes ? 'text-secondary' : 'text-tertiary'}`}
            aria-label={isCn ? '整场备注' : 'Workout note'}
            data-testid="workout-notes"
          >
            <span className="marginalia truncate">
              {currentWorkout.notes ? currentWorkout.notes.split('\n')[0] : isCn ? '加备注' : 'Add note'}
            </span>
          </button>
        )}
      </div>

      {/* 拖动排序时浮出的位置条：每张卡一行（交替组一行写全部成员） */}
      <ReorderStrip
        strip={reorder.strip}
        labels={cards.map(c => c.exIds.map(id => resolveName(exs.find(e => e.id === id)?.name ?? '')).join(' ⇄ '))}
      />

      {/* 动作卡列表；底部为常驻添加栏（操作条露出时再高一截）预留空间 */}
      <div className={`space-y-6 ${stripRow ? 'pb-48' : 'pb-32'}`}>
        {cards.map((card, ci) => {
          // 编辑旧训练不画书签：拖它往上会把后面的组退回待做，保存时整段被剥掉
          const pointerGap = !editingWorkoutId && seam?.cardKey === card.key ? seam.gap : null;
          const wrap = (body: React.ReactNode) => (
            <div
              key={card.key}
              data-card-key={card.key}
              ref={reorder.itemRef(ci)}
              // scroll-mt：自动跟到下一张卡时别钻到吸顶页头底下
              className={`relative rounded-card bg-base scroll-mt-28${reorder.draggingIdx === ci ? ' reorder-lifted' : ''}`}
            >
              {body}
            </div>
          );
          const at = (name: string) => `${card.key}|${name}`;
          const handleProps = cards.length > 1 ? reorder.handleProps(ci) : null;
          const dragHandle = handleProps
            ? keep(
                at('drag'),
                {
                  handlers: {
                    onPointerDown: cardFn(at('drag.down'), handleProps.onPointerDown),
                    onPointerMove: cardFn(at('drag.move'), handleProps.onPointerMove),
                    onPointerUp: cardFn(at('drag.up'), handleProps.onPointerUp),
                    onPointerCancel: cardFn(at('drag.cancel'), handleProps.onPointerCancel),
                    onContextMenu: cardFn(at('drag.menu'), handleProps.onContextMenu),
                  },
                  pressing: reorder.pressingIdx === ci,
                  hinting: reorder.hintingIdx === ci,
                  drawMs: reorder.drawMs,
                },
                (a, b) => a.pressing === b.pressing && a.hinting === b.hinting && a.drawMs === b.drawMs,
              )
            : undefined;

          if (card.group) {
            const members = keep(
              at('members'),
              card.exIds.map(id => exs.find(e => e.id === id)!).filter(Boolean),
              (a, b) => a.length === b.length && a.every((m, i) => m === b[i]),
            );
            const indexOf = (exId: string) => exs.findIndex(e => e.id === exId);
            const settingsFor =
              metricSlot && members.some(m => indexOf(m.id) === metricSlot.exIdx)
                ? { exId: exs[metricSlot.exIdx].id, el: metricSlot.el }
                : null;
            return wrap(
              <AlternatingCard
                cardKey={card.key}
                cardNo={ci + 1}
                members={members}
                rows={keep(
                  at('rows'),
                  cardRows(card, exs),
                  (a, b) => a.length === b.length && a.every((r, i) => r.exId === b[i].exId && r.setId === b[i].setId),
                )}
                lang={lang}
                unit={unit}
                exerciseNotes={exerciseNotes}
                getActiveMetrics={getActiveMetrics}
                resolveName={resolveName}
                isSigned={isSigned}
                pointerGap={pointerGap}
                onMovePointer={cardFn('movePointer', movePointer)}
                selectedSetId={selectedSetId}
                onNumTap={cardFn('tapSetNum', tapSetNum)}
                onSetUpdate={cardFn('updateSet', updateSet)}
                onRemoveSet={cardFn('removeSet', removeSet)}
                onRemoveSubSet={cardFn('removeSubSet', removeSubSet)}
                onAddSet={cardFn('addSetTo', addSetTo)}
                gym={currentWorkout.gym}
                lastSessionFor={lastSessionFor}
                // 编辑旧训练不判纪录（同单卡）
                prPoolFor={!editingWorkoutId ? prPoolFor : undefined}
                onMoveMember={cardFn(at('moveMember'), (exId: string, dir: -1 | 1) => setExs(list => moveGroupMember(list, exId, dir)))}
                onRemoveMember={cardFn(at('removeMember'), (exId: string) => setExs(list => removeFromGroup(list, exId)))}
                onDeleteMember={cardFn(at('deleteMember'), (exId: string) => onDeleteExerciseFromSession(indexOf(exId)))}
                onSplit={cardFn(at('split'), () => setExs(list => splitGroup(list, card.group!)))}
                onAddMember={cardFn(at('addMember'), () => onPickerOpenChange(true, null, card.group))}
                onSwitchRowExercise={cardFn(at('switchRow'), (r: RowRef, to: string) => setExs(list => moveSetToExercise(list, r, to, isSigned)))}
                onSwitchVariant={cardFn('switchVariant', onSwitchVariant)}
                onVariantRemoved={cardFn('variantRemoved', onVariantRemoved)}
                onToggleNote={cardFn('toggleNote', onToggleNote)}
                onOpenMetricModal={cardFn(at('metric'), (name: string, exId: string, focus?: 'gym') => onOpenMetricModal(name, indexOf(exId), focus))}
                settingsFor={keep(at('settingsFor'), settingsFor, (a, b) => a === b || (!!a && !!b && a.exId === b.exId && a.el === b.el))}
                onUpdateMemberSets={cardFn(at('memberSets'), (exId: string, sets: SetLog[]) => setExs(list => list.map(e => (e.id === exId ? { ...e, sets } : e))))}
                onOpenTimePicker={cardFn(at('timePicker'), (exId: string, setId: string) => {
                  const ei = indexOf(exId);
                  const si = exs[ei]?.sets.findIndex(s => String(s.id) === setId) ?? -1;
                  if (ei >= 0 && si >= 0) onOpenTimePicker(ei, si);
                })}
                dragHandle={dragHandle}
              />,
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
              onMovePointer={cardFn('movePointer', movePointer)}
              selectedSetId={selectedSetId}
              onNumTap={cardFn(at('numTap'), (setId: string) => tapSetNum({ exId: ex.id, setId }))}
              signed={isSigned(ex)}
              gym={currentWorkout.gym}
              // 场上三张及以上：先问和哪一张（不相邻的也能直接组，审查 A8；最后一张也有）；只有两张就直接和下一张
              onAlternateWithNext={cardFn(
                at('altNext'),
                cards.length > 2
                  ? () => setPairFor(ex.id)
                  : next
                    ? () => setExs(list => groupExercises(list, [ex.id, ...next.exIds]))
                    : undefined,
              )}
              onJoinGroupAbove={cardFn(
                at('joinAbove'),
                prev?.group ? () => setExs(list => groupExercises(list, [...prev.exIds, ex.id])) : undefined,
              )}
              onUpdateExercise={cardFn('updateExercise', (idx: number, updates: Partial<Exercise>) => {
                setCurrentWorkout(w => {
                  const list = [...(w.exercises ?? [])];
                  list[idx] = { ...list[idx], ...updates };
                  return { ...w, exercises: list };
                });
              })}
              onDeleteExercise={cardFn('deleteExercise', onDeleteExerciseFromSession)}
              dragHandle={dragHandle}
              onOpenTimePicker={cardFn('openTimePicker', onOpenTimePicker)}
              onOpenExerciseTime={cardFn(at('exTime'), onOpenExerciseTime ? () => onOpenExerciseTime(ex.id) : undefined)}
              // 两个都按输入缓存（App.tsx）：同样的输入回同一个对象，memo 比得住
              lastSession={lastSessionFor ? lastSessionFor(ex) : null}
              // 编辑旧训练不判纪录（和结束训练时的 detectPRs 同一口径）
              prPool={!editingWorkoutId && prPoolFor ? prPoolFor(ex) : null}
              onToggleNote={cardFn('toggleNote', onToggleNote)}
              onOpenMetricModal={cardFn(at('metric'), (name: string, focus?: 'gym') => onOpenMetricModal(name, exIdx, focus))}
              settingsSlot={metricSlot?.exIdx === exIdx ? metricSlot.el : null}
              onSwitchVariant={cardFn(at('variant'), (v: string | undefined, name?: string) => onSwitchVariant(ex.id, v, name))}
              onVariantRemoved={cardFn('variantRemoved', onVariantRemoved)}
              onSetUpdate={cardFn(at('setUpdate'), (_eIdx: number, setIdx: number, updates: Partial<SetLog>) => {
                const s = ex.sets[setIdx];
                if (s) updateSet({ exId: ex.id, setId: String(s.id) }, updates);
              })}
              onAddSet={cardFn(at('addSet'), () => addSetTo(ex.id))}
              onRemoveSet={cardFn(at('removeSet'), (_eIdx: number, setIdx: number) => {
                const s = ex.sets[setIdx];
                if (s) removeSet({ exId: ex.id, setId: String(s.id) });
              })}
              onRemoveSubSet={cardFn(at('removeSub'), (_eIdx: number, setIdx: number, subIdx: number) => {
                const s = ex.sets[setIdx];
                if (s) removeSubSet({ exId: ex.id, setId: String(s.id) }, subIdx);
              })}
            />,
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
            </div>
          ))}
        </div>
      </div>

      {/* 底部常驻添加栏 —— fixed，故意在 anim-tab-enter 之外；选中组操作条叠在它上面 */}
      <div
        className="fixed bottom-0 inset-x-0 z-bar bg-base border-t border-divider"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        {stripRow && (
          <SetActionStrip
            exercise={stripRow.ex}
            set={stripRow.set}
            setNo={rowNo({ exId: stripRow.ex.id, setId: String(stripRow.set.id) })}
            name={resolveName(stripRow.ex.name)}
            activeMetrics={getActiveMetrics(stripRow.ex.name)}
            unit={unit}
            lang={lang}
            signed={isSigned(stripRow.ex)}
            rounder={rounderFor(stripRow.ex, currentWorkout.gym)}
            onUpdate={u => updateSet({ exId: stripRow.ex.id, setId: String(stripRow.set.id) }, u)}
          />
        )}
        <div className="max-w-2xl mx-auto flex items-center gap-3 px-4 py-3">
          <span className="text-xs font-semibold text-secondary whitespace-nowrap tabular-nums">
            {exerciseCount} {isCn ? '动作' : 'ex.'} · {setCount}
            {plannedCount > setCount && <span className="text-tertiary">/{plannedCount}</span>}
            {isCn ? ' 组' : ` ${plural(plannedCount > setCount ? plannedCount : setCount, 'set')}`}
          </span>
          <button
            type="button"
            onClick={() => onPickerOpenChange(true)}
            className="flex-1 min-h-[44px] rounded-card bg-accent text-on-accent text-small font-bold flex items-center justify-center gap-2 active:scale-press transition-transform"
            data-testid="open-picker-sheet"
          >
            <Plus size={16} strokeWidth={2.5} />
            {isCn ? '添加动作' : 'Add exercise'}
          </button>
        </div>
      </div>

      {pairFor && (() => {
        const from = exs.find(e => e.id === pairFor);
        if (!from) return null;
        return (
          <Panel
            title={isCn ? `「${resolveName(from.name)}」和哪个交替做` : `Alternate "${resolveName(from.name)}" with`}
            onClose={() => setPairFor(null)}
            cancel={isCn ? '取消' : 'Cancel'}
            testId="alt-pair-panel"
          >
            {cards
              .filter(c => !c.exIds.includes(pairFor))
              .map(c => (
                <button
                  key={c.key}
                  type="button"
                  className={panelBtn}
                  onClick={() => {
                    setPairFor(null);
                    setExs(list => groupExercises(list, [pairFor, ...c.exIds]));
                  }}
                >
                  <span className="min-w-0 truncate">
                    {c.exIds.map(id => resolveName(exs.find(e => e.id === id)?.name ?? '')).join(' ⇄ ')}
                  </span>
                </button>
              ))}
          </Panel>
        );
      })()}

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
        altCombos={altCombos}
        before={historyBefore}
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
        onDeleteExercise={onDeleteLibraryExercise}
        onVariantRemoved={onVariantRemoved}
        onOpenNote={onToggleNote}
        onOpenMetrics={name => onOpenMetricModal(name)}
      />
    </>
  );
};
