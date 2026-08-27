/**
 * 新建 / 编辑训练页（从 App.tsx 抽出，减轻主文件体积）
 *
 * 添加动作走底部常驻栏唤起的 ExercisePickerSheet（弹层），页面本体只保留动作卡列表。
 * 本页隐藏全局 AppHeader，自己的 sticky 头部是唯一顶栏（含状态栏留白）。
 */
import React, { useEffect, useRef } from 'react';
import {
  ArrowLeft,
  Flag,
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
}) => {
  const isCn = lang === Language.CN;
  const flashTimerRef = useRef<number | null>(null);

  const exerciseCount = currentWorkout.exercises?.length ?? 0;
  const setCount = (currentWorkout.exercises ?? []).reduce(
    (s, ex) => s + (ex.sets?.length || 0),
    0,
  );

  // 弹层关闭后：滚到最新添加的动作卡并高亮
  useEffect(() => {
    if (!flashExerciseId) return;
    const el = document.querySelector<HTMLElement>(`[data-ex-card="${flashExerciseId}"]`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('anim-ring');
      flashTimerRef.current = window.setTimeout(() => {
        el.classList.remove('anim-ring');
        onFlashDone();
      }, 1700);
    } else {
      onFlashDone();
    }
    return () => {
      if (flashTimerRef.current !== null) window.clearTimeout(flashTimerRef.current);
    };
  }, [flashExerciseId, onFlashDone]);

  return (
    <div className="animate-in slide-in-from-bottom-5">
      {/* 本页唯一顶栏（AppHeader 在训练页隐藏），pt-14 为状态栏留白 */}
      <div className="sticky top-0 -mx-4 md:-mx-8 px-4 md:px-8 pt-14 pb-3 md:pt-[calc(env(safe-area-inset-top)+0.75rem)] bg-base/95 backdrop-blur-md z-30 border-b border-divider mb-4">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onBack}
            className="w-11 h-11 flex-shrink-0 inline-flex items-center justify-center bg-card/60 border border-divider rounded-2xl text-primary hover:bg-card active:scale-90 transition-all"
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
              <button
                type="button"
                onClick={onToggleUnit}
                className="ml-auto normal-case tracking-normal flex items-center gap-1 px-2 py-1 -my-1 rounded-lg bg-inset text-tertiary active:scale-95 hover:text-secondary transition-all"
                title={isCn ? '切换 kg / 磅显示' : 'Toggle kg / lbs'}
                aria-label={isCn ? '切换重量单位' : 'Toggle weight unit'}
                data-testid="unit-toggle"
              >
                <Scale size={10} />
                {unit}
              </button>
              {hasUnsavedChanges && (
                <span className="inline-flex items-center gap-1 text-orange-400 normal-case">
                  <span className="w-1.5 h-1.5 rounded-full bg-orange-400 animate-pulse" />
                  {isCn ? '未保存' : 'Unsaved'}
                </span>
              )}
            </div>
            <input
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
            className={`min-h-[44px] px-4 rounded-2xl font-bold text-sm flex-shrink-0 flex items-center gap-2 transition-all active:scale-95 ${
              saveStatus === 'saving'
                ? 'bg-tertiary/30 text-tertiary cursor-not-allowed'
                : saveStatus === 'saved'
                  ? 'bg-green-600 text-white shadow-md shadow-green-600/30'
                  : saveStatus === 'error'
                    ? 'bg-red-600 text-white'
                    : !(currentWorkout.exercises?.length)
                      ? 'bg-card/40 text-tertiary cursor-not-allowed'
                      : 'bg-accent text-white shadow-md shadow-blue-600/30 hover:opacity-90'
            }`}
          >
            {saveStatus === 'saving' ? (
              <>
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
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
          <div key={ex.id} data-ex-card={ex.id} className="rounded-card">
            <ExerciseCard
              exercise={ex}
              exIdx={exIdx}
              lang={lang}
              unit={unit}
              exerciseNotes={exerciseNotes}
              getActiveMetrics={getActiveMetrics}
              resolveName={resolveName}
              onUpdateExercise={(idx, updates) => {
                const exs = [...currentWorkout.exercises!];
                exs[idx] = { ...exs[idx], ...updates };
                setCurrentWorkout({ ...currentWorkout, exercises: exs });
              }}
              onDeleteExercise={onDeleteExerciseFromSession}
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
                const newSet = lastSet
                  ? { ...lastSet, id: Date.now().toString() }
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

        {exerciseCount === 0 && (
          <div className="bg-inset border border-dashed border-divider rounded-card p-10 text-center space-y-2">
            <p className="text-sm text-secondary font-semibold">
              {isCn ? '还没有动作' : 'No exercises yet'}
            </p>
            <p className="text-xs text-tertiary">
              {isCn ? '点击下方「添加动作」开始记录' : 'Tap "Add Exercise" below to start'}
            </p>
          </div>
        )}
      </div>

      {/* 底部常驻添加栏 */}
      <div
        className="fixed bottom-0 inset-x-0 z-40 bg-base/95 backdrop-blur-xl border-t border-divider"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="max-w-2xl mx-auto flex items-center gap-3 px-4 py-3">
          <span className="text-xs font-semibold text-secondary whitespace-nowrap tabular-nums">
            {exerciseCount} {isCn ? '动作' : 'ex'} · {setCount} {isCn ? '组' : 'sets'}
          </span>
          <button
            type="button"
            onClick={() => onPickerOpenChange(true)}
            className="flex-1 min-h-[52px] rounded-2xl bg-accent text-white text-[15px] font-bold flex items-center justify-center gap-2 shadow-md shadow-blue-600/30 active:scale-[0.97] transition-transform"
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
    </div>
  );
};

export default NewWorkoutTab;
