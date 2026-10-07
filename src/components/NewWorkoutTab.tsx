/**
 * 新建 / 编辑训练页（从 App.tsx 抽出，减轻主文件体积）
 *
 * 添加动作走底部常驻栏唤起的 ExercisePickerSheet（弹层），页面本体只保留动作卡列表。
 * 本页隐藏全局 AppHeader，自己的 sticky 头部是唯一顶栏（含状态栏留白）。
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
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
import { ExerciseCard } from './ExerciseCard';
import { AlternatingCard } from './AlternatingCard';
import {
  buildCards,
  cardRows,
  findSet,
  groupExercises,
  isJustDone,
  markSetDone,
  moveGroupMember,
  movePointerTo,
  moveSetToExercise,
  nextPendingRow,
  normalizeGroups,
  pointerSeam,
  removeFromGroup,
  revertSet,
  RowRef,
  setHasValue,
  splitGroup,
} from '../utils/workbench';
import { usesSignedLoad } from '../utils/load';
import { undoWorkoutDeletes } from '../utils/undoPref';
import { haptic, H } from '../utils/haptics';
import { ExercisePickerSheet } from './ExercisePickerSheet';
import { BodyPartPicker } from './BodyPartPicker';
import { useCardReorder } from '../hooks/useCardReorder';
import { plural } from '../utils/format';
import { useExercisePrefs } from '../contexts/ExercisePrefsContext';
import { useUiOverlay } from '../contexts/UiOverlayContext';

export interface NewWorkoutTabProps {
  lang: Language;
  unit: string;
  currentWorkout: WorkoutSession;
  /** 要支持函数式更新：撤销条的回调是 5 秒后才跑的，必须按那一刻的最新状态插回去 */
  setCurrentWorkout: React.Dispatch<React.SetStateAction<WorkoutSession>>;
  editingWorkoutId: string | null;
  hasUnsavedChanges: boolean;
  saveStatus: 'idle' | 'saving' | 'saved' | 'error';
  previousTab: string;
  exerciseNotes: Record<string, string>;
  getActiveMetrics: (name: string) => string[];
  resolveName: (name: string) => string;
  onBack: () => void;
  onSave: () => void;
  /** kg ⇄ lbs 显示切换（训练页隐藏了全局 AppHeader，入口在本页头部） */
  onToggleUnit: () => void;
  onOpenTimePicker: (exIdx: number, setIdx: number, seconds: number) => void;
  onToggleNote: (name: string) => void;
  /** exIdx 用于在弹窗内修改该动作实例的负重/辅助标记；从动作库进来时不给（不显示那一节） */
  onOpenMetricModal: (name: string, exIdx?: number) => void;
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
  onPickExercise: (ex: ExerciseDefinition) => void;
  onCreateCustomExercise: (prefilled?: string) => void;
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
   * §12.4：经由 FAB 印谱手势选了「制」（自己命名）的那次训练 id。
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
  onToggleNote,
  onOpenMetricModal,
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
   * 「做到哪了」（2026-10 指针，demo：docs/demos/set-pointer-alternating.html）：全场一个指针，
   * 指针以上＝做完或跳过。指针不存状态，由组的状态推出来（workbench.pointerSeam），
   * 所以重开工作台、接回训练、删组之后它自己就落在对的地方。
   *
   * 选中：组号实心 + ±5。默认选中指针下面那一组（正常情况点一下就做完）；点别的组号先选中它，再点才算做完。
   * 只存「手动选中的那一组」，做完 / 删掉之后清空，回到默认。
   */
  const exs = currentWorkout.exercises ?? [];
  const [pickedSetId, setPickedSetId] = useState<string | null>(null);
  const seam = pointerSeam(exs);
  const defaultRow = nextPendingRow(exs);
  const pickedValid = !!pickedSetId && exs.some(e => e.sets.some(s => String(s.id) === pickedSetId));
  const selectedSetId = pickedValid ? pickedSetId : defaultRow?.setId ?? null;
  const cards = buildCards(exs);

  const setExs = (fn: (list: Exercise[]) => Exercise[]) =>
    setCurrentWorkout(w => ({ ...w, exercises: normalizeGroups(fn(w.exercises ?? [])) }));

  const isSigned = (ex: Exercise) => usesSignedLoad(ex, signedLoadOf(ex.name));

  /** 点组号：没选中＝选中；选中的待做 / 跳过组＝做完；选中的刚做完那组＝退回；其余选中的做完组＝取消选中 */
  const tapSetNum = (r: RowRef) => {
    const set = findSet(exs, r);
    if (!set) return;
    if (selectedSetId !== r.setId) {
      haptic(H.tap);
      setPickedSetId(r.setId);
      return;
    }
    if (set.ghost) {
      if (!setHasValue(set)) {
        // 全零的组点不实：一组什么都没填，做完也记不下任何东西
        haptic(H.tap);
        toast(isCn ? '这组还没填数' : 'Nothing entered yet', 'info');
        return;
      }
      haptic(H.tap);
      const res = markSetDone(exs, r);
      setCurrentWorkout(w => ({ ...w, exercises: normalizeGroups(res.exs) }));
      setPickedSetId(null);
      if (res.suggestPair) {
        const { a, b } = res.suggestPair;
        const other = exs.find(e => e.id === b);
        toastUndo(
          isCn ? `和「${other ? resolveName(other.name) : ''}」交替做？` : `Alternate with "${other ? resolveName(other.name) : ''}"?`,
          () => setExs(list => groupExercises(list, [a, b], { unskip: true })),
          { undoLabel: isCn ? '交替' : 'Alternate', durationMs: 6000 },
        );
      }
      return;
    }
    if (isJustDone(exs, r)) {
      haptic(H.tap);
      setCurrentWorkout(w => ({ ...w, exercises: revertSet(w.exercises ?? [], r) }));
      setPickedSetId(r.setId);
      return;
    }
    setPickedSetId(null);
  };

  const movePointer = (cardKey: string, gap: number) => {
    setCurrentWorkout(w => ({ ...w, exercises: movePointerTo(w.exercises ?? [], cardKey, gap) }));
    setPickedSetId(null);
  };

  /** 更新一组（按 id，交替组和单卡共用） */
  const updateSet = (r: RowRef, updates: Partial<SetLog>) =>
    setCurrentWorkout(w => ({
      ...w,
      exercises: (w.exercises ?? []).map(e =>
        e.id !== r.exId ? e : { ...e, sets: e.sets.map(s => (String(s.id) === r.setId ? { ...s, ...updates } : s)) },
      ),
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
        // 递减档也一样（addset-clones-drop-set）：子组是当组的事实，照抄过来点了组号，
        // 没做过的那档就被记进历史和容量；真要再做，长按组号加。
        const newId = `${Date.now()}`;
        const newSet: SetLog = lastSet
          ? (() => {
              const { subSets: _sub, touched: _t, fromGhost: _fg, toFailure: _tf, skipped: _sk, seq: _q, ...base } = lastSet;
              return { ...base, id: newId, ghost: true };
            })()
          : { id: newId, weight: 0, reps: 0, ghost: true };
        return { ...e, sets: [...e.sets, newSet] };
      }),
    }));

  /** 删组：单击即删；撤销条看设置（2.6，默认关） */
  const removeSet = (r: RowRef) => {
    const ex = exs.find(e => e.id === r.exId);
    const idx = ex?.sets.findIndex(s => String(s.id) === r.setId) ?? -1;
    if (!ex || idx < 0) return;
    const removed = ex.sets[idx];
    setCurrentWorkout(w => ({
      ...w,
      exercises: (w.exercises ?? []).map(e =>
        e.id === r.exId ? { ...e, sets: e.sets.filter(st => String(st.id) !== r.setId) } : e,
      ),
    }));
    if (pickedSetId === r.setId) setPickedSetId(null);
    if (!undoWorkoutDeletes()) return;
    toastUndo(isCn ? '已删除一组' : 'Set deleted', () => {
      setCurrentWorkout(w => ({
        ...w,
        exercises: (w.exercises ?? []).map(e => {
          if (e.id !== r.exId || e.sets.some(st => String(st.id) === r.setId)) return e;
          const sets = [...e.sets];
          sets.splice(Math.min(idx, sets.length), 0, removed);
          return { ...e, sets };
        }),
      }));
    });
  };

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
    if (!undoWorkoutDeletes()) return;
    toastUndo(isCn ? '已删除一档' : 'Step deleted', () =>
      patchSubs(subs => {
        if (subs.some(sb => sb.id === removed.id)) return subs;
        const next = [...subs];
        next.splice(Math.min(subIdx, next.length), 0, removed);
        return next;
      }),
    );
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
   * FAB 印谱选了「制」进来：部位已在手势里选过，这里只剩把名字写出来。
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
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] font-bold text-tertiary uppercase tracking-[0.15em] [&>*]:whitespace-nowrap">
              <span>
                {editingWorkoutId
                  ? (isCn ? '编辑训练' : 'Edit Workout')
                  : (isCn ? '新建训练' : 'New Workout')}
              </span>
              {editingWorkoutId && currentWorkout.date && (
                <button
                  type="button"
                  onClick={onChangeDate}
                  className="normal-case tracking-normal text-tertiary/80 hover:text-accent transition-colors inline-flex items-center gap-1"
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
                  className={`normal-case tracking-normal inline-flex items-center gap-1 transition-colors hover:text-accent ${
                    currentWorkout.gym ? 'text-tertiary/80' : 'text-tertiary/45'
                  }`}
                  title={translations.gymPickTitle[lang] as string}
                  aria-label={translations.gymPickTitle[lang] as string}
                  data-testid="gym-button"
                >
                  <MapPin size={10} strokeWidth={2} />
                  {currentWorkout.gym || ''}
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
              {hasUnsavedChanges && (
                <span className="inline-flex items-center gap-1 text-warning normal-case">
                  <span className="w-1.5 h-1.5 rounded-full bg-warning animate-pulse" />
                  {isCn ? '未保存' : 'Unsaved'}
                </span>
              )}
            </div>
            <input
              ref={titleInputRef}
              className="w-full bg-transparent text-base font-bold text-primary outline-none placeholder:text-tertiary/60 min-h-[36px]"
              value={currentWorkout.title}
              onChange={e =>
                setCurrentWorkout({ ...currentWorkout, title: e.target.value })
              }
              placeholder={translations.trainingTitlePlaceholder[lang]}
            />
          </div>

          <button
            type="button"
            onClick={onSave}
            disabled={saveStatus === 'saving' || !(currentWorkout.exercises?.length)}
            className={`min-h-[44px] px-4 rounded-card font-bold text-sm flex-shrink-0 flex items-center gap-2 transition-ui active:scale-press-sm ${
              saveStatus === 'saving'
                ? 'bg-tertiary/30 text-tertiary cursor-not-allowed'
                : saveStatus === 'saved'
                  ? 'bg-success text-on-accent'
                  : saveStatus === 'error'
                    ? 'bg-danger text-on-accent'
                    : !(currentWorkout.exercises?.length)
                      ? 'bg-card/40 text-tertiary cursor-not-allowed'
                      : 'bg-accent text-on-accent hover:opacity-90'
            }`}
          >
            {saveStatus === 'saving' ? (
              <>
                <div className="w-4 h-4 border-2 border-current/30 border-t-current rounded-full animate-spin" />
                <span>{isCn ? '结束中' : 'Ending'}</span>
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
                <Flag size={16} strokeWidth={3} />
                <span>{isCn ? '结束训练' : 'End Workout'}</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* 动作卡列表；底部为常驻添加栏预留空间 */}
      <div className="space-y-6 pb-32">
        {cards.map((card, ci) => {
          const pointerGap = seam?.cardKey === card.key ? seam.gap : null;
          const wrap = (body: React.ReactNode, flashId: string) => (
            <div
              key={card.key}
              data-ex-card={flashId}
              data-card-key={card.key}
              ref={reorder.itemRef(ci)}
              className={`relative rounded-card bg-base${reorder.draggingIdx === ci ? ' reorder-lifted' : ''}`}
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
                onMoveMember={(exId, dir) => setExs(list => moveGroupMember(list, exId, dir))}
                onRemoveMember={exId => setExs(list => removeFromGroup(list, exId))}
                onDeleteMember={exId => onDeleteExerciseFromSession(indexOf(exId))}
                onSplit={() => setExs(list => splitGroup(list, card.group!))}
                onAddMember={() => onPickerOpenChange(true, null, card.group)}
                onSwitchRowExercise={(r, to) => setExs(list => moveSetToExercise(list, r, to))}
                onSwitchVariant={(exId, v, name) => onSwitchVariant(exId, v, name)}
                onToggleNote={onToggleNote}
                onOpenMetricModal={(name, exId) => onOpenMetricModal(name, indexOf(exId))}
                onOpenTimePicker={(exId, setId, sec) => {
                  const ei = indexOf(exId);
                  const si = exs[ei]?.sets.findIndex(s => String(s.id) === setId) ?? -1;
                  if (ei >= 0 && si >= 0) onOpenTimePicker(ei, si, sec);
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
              onToggleNote={onToggleNote}
              onOpenMetricModal={name => onOpenMetricModal(name, exIdx)}
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
                setCurrentWorkout({ ...currentWorkout, title });
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
              <p className="text-sm text-secondary font-semibold">
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
            className="flex-1 min-h-[52px] rounded-card bg-accent text-on-accent text-[15px] font-bold flex items-center justify-center gap-2 active:scale-press transition-transform"
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
        focusPart={pickerFocusPart}
        targetLabel={pickerTargetLabel}
        onClose={() => onPickerOpenChange(false)}
        addedCounts={addedCounts}
        sessionAdded={sessionAdded}
        onPickExercise={onPickExercise}
        onCreateCustomExercise={onCreateCustomExercise}
        onEditExerciseTags={onEditExerciseTags}
        onDeleteExercise={onDeleteLibraryExercise}
        onOpenNote={onToggleNote}
        onOpenMetrics={name => onOpenMetricModal(name)}
      />
    </>
  );
};

export default NewWorkoutTab;
