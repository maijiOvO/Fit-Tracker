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
  ExerciseDefinition,
  Language,
  WorkoutSession,
} from '../../types';
import { translations } from '../../translations';
import { ExerciseCard } from './ExerciseCard';
import { ExercisePickerSheet } from './ExercisePickerSheet';
import { BodyPartPicker } from './BodyPartPicker';
import { useCardReorder } from '../hooks/useCardReorder';

export interface NewWorkoutTabProps {
  lang: Language;
  unit: string;
  currentWorkout: WorkoutSession;
  setCurrentWorkout: (w: WorkoutSession) => void;
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
  /** exIdx 用于在弹窗内修改该动作实例的负重/辅助标记 */
  onOpenMetricModal: (name: string, exIdx: number) => void;
  onDeleteExerciseFromSession: (exIdx: number) => void;
  /** 编辑模式下触发日期选择器（仅 editingWorkoutId 非空时显示日期区域） */
  onChangeDate?: () => void;
  /** 打开场地选择器（§12.11）。编辑旧训练时同样可用 —— 那是补标历史的唯一入口。 */
  onChangeGym?: () => void;

  // ===== 添加动作弹层 =====
  pickerOpen: boolean;
  onPickerOpenChange: (open: boolean) => void;
  /** 小写显示名 -> 当前训练中出现次数（弹层「已添加」徽标） */
  addedCounts: Record<string, number>;
  /** 本次弹层会话累计添加数 */
  sessionAdded: number;
  onPickExercise: (ex: ExerciseDefinition) => void;
  onCreateCustomExercise: (prefilled?: string) => void;
  /** 打开标签管理弹窗 */
  onOpenTagManage: () => void;
  /** 长按动作行的管理菜单（转发到 App 层的弹窗/删除流程） */
  onEditExerciseTags: (ex: ExerciseDefinition) => void;
  onRenameExercise: (id: string, currentName: string) => void;
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
  addedCounts,
  sessionAdded,
  onPickExercise,
  onCreateCustomExercise,
  onOpenTagManage,
  onEditExerciseTags,
  onRenameExercise,
  onDeleteLibraryExercise,
  flashExerciseId,
  onFlashDone,
  partPrechosenId = null,
}) => {
  const isCn = lang === Language.CN;
  const flashTimerRef = useRef<number | null>(null);
  const titleInputRef = useRef<HTMLInputElement | null>(null);

  /**
   * 已经选过部位的那次训练 id。
   *
   * 存 id 而不是布尔值：换一次训练（新 id）自然重新需要选，
   * 而本次训练中途把动作全删光时，不会把已经选过的界面又弹回来。
   */
  const [partChosenFor, setPartChosenFor] = useState<string | null>(null);

  const exerciseCount = currentWorkout.exercises?.length ?? 0;
  const setCount = (currentWorkout.exercises ?? []).reduce(
    (s, ex) => s + (ex.sets?.length || 0),
    0,
  );

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
    count: exerciseCount,
    onReorder: (from, to) => {
      const exs = [...(currentWorkout.exercises ?? [])];
      const [moved] = exs.splice(from, 1);
      exs.splice(to, 0, moved);
      setCurrentWorkout({ ...currentWorkout, exercises: exs });
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
            <div className="flex items-center gap-2 text-[10px] font-bold text-tertiary uppercase tracking-[0.15em]">
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
        {currentWorkout.exercises?.map((ex, exIdx) => (
          <div
            key={ex.id}
            data-ex-card={ex.id}
            ref={reorder.itemRef(exIdx)}
            className={`relative rounded-card bg-base${
              reorder.draggingIdx === exIdx ? ' reorder-lifted' : ''
            }`}
          >
            <ExerciseCard
              exercise={ex}
              exIdx={exIdx}
              lang={lang}
              unit={unit}
              workoutGym={currentWorkout.gym}
              exerciseNotes={exerciseNotes}
              getActiveMetrics={getActiveMetrics}
              resolveName={resolveName}
              onUpdateExercise={(idx, updates) => {
                const exs = [...currentWorkout.exercises!];
                exs[idx] = { ...exs[idx], ...updates };
                setCurrentWorkout({ ...currentWorkout, exercises: exs });
              }}
              onDeleteExercise={onDeleteExerciseFromSession}
              dragHandle={
                exerciseCount > 1
                  ? {
                      handlers: reorder.handleProps(exIdx),
                      pressing: reorder.pressingIdx === exIdx,
                      hinting: reorder.hintingIdx === exIdx,
                      drawMs: reorder.drawMs,
                    }
                  : undefined
              }
              onOpenTimePicker={onOpenTimePicker}
              onToggleNote={onToggleNote}
              onOpenMetricModal={name => onOpenMetricModal(name, exIdx)}
              onSetUpdate={(eIdx, setIdx, updates) => {
                const exs = [...currentWorkout.exercises!];
                exs[eIdx].sets[setIdx] = { ...exs[eIdx].sets[setIdx], ...updates };
                setCurrentWorkout({ ...currentWorkout, exercises: exs });
              }}
              onAddSet={idx => {
                const exs = [...currentWorkout.exercises!];
                const currentSets = exs[idx].sets;
                const lastSet =
                  currentSets.length > 0 ? currentSets[currentSets.length - 1] : null;
                // 克隆上一行的值，但剥掉 ghost：「加一组」是用户的主动动作，
                // 长出来的行是真实数据（§12.6）
                const newSet = lastSet
                  ? { ...lastSet, id: Date.now().toString(), ghost: undefined }
                  : { id: Date.now().toString(), weight: 0, reps: 0 };
                exs[idx].sets.push(newSet);
                setCurrentWorkout({ ...currentWorkout, exercises: exs });
              }}
              onRemoveSet={(eIdx, setIdx) => {
                const exs = [...currentWorkout.exercises!];
                exs[eIdx].sets = exs[eIdx].sets.filter((_, i) => i !== setIdx);
                setCurrentWorkout({ ...currentWorkout, exercises: exs });
              }}
            />
          </div>
        ))}

        {exerciseCount === 0 &&
          (needsBodyPart ? (
            <BodyPartPicker
              lang={lang}
              onPick={title => {
                setCurrentWorkout({ ...currentWorkout, title });
                setPartChosenFor(currentWorkout.id);
                // 选完部位的下一步必然是挑动作，别让用户再点一次「添加动作」。
                // （「其他」不走这条：那条路的下一步是把名字打出来，
                //   弹层盖上去反而挡住标题输入框。）
                onPickerOpenChange(true);
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
            {exerciseCount} {isCn ? '动作' : 'ex'} · {setCount} {isCn ? '组' : 'sets'}
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
        onClose={() => onPickerOpenChange(false)}
        addedCounts={addedCounts}
        sessionAdded={sessionAdded}
        onPickExercise={onPickExercise}
        onCreateCustomExercise={onCreateCustomExercise}
        onOpenTagManage={onOpenTagManage}
        onEditExerciseTags={onEditExerciseTags}
        onRenameExercise={onRenameExercise}
        onDeleteExercise={onDeleteLibraryExercise}
      />
    </>
  );
};

export default NewWorkoutTab;
