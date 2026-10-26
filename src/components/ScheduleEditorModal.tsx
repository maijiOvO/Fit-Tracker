/**
 * 训练计划编辑器：新增 / 编辑 一条 ScheduledWorkout
 */
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Library, Plus, Trash2 } from 'lucide-react';
import { ExerciseDefinition, Language, ScheduledExercise, ScheduledWorkout } from '../../types';
import { translations } from '../../translations';
import { useExercisePrefs, useScheduleContext } from '../contexts';
import { FITLOG_SOLO_USER_ID } from '../../services/fitlogSolo';
import { ExerciseCategory } from '../constants/exercises';
import { parseWeight } from '../utils/format';
import Modal from './Modal';
import { ExercisePickerSheet } from './ExercisePickerSheet';
import { ScrubNumber } from './ScrubNumber';
import { formatWeight } from './SetCapsule';

type CustomTag = { id: string; name: string; category: 'bodyPart' | 'equipment'; parentCategory?: string };

/**
 * 计划编辑器里的选动作弹层要用到的 App 层弹窗（和训练页弹层是同一批）。
 * 新建动作带回调：建好的动作加进计划，不进训练。
 */
export interface PlanPickerHost {
  onCreateCustomExercise: (
    prefilledName: string | undefined,
    onCreated: (ex: ExerciseDefinition) => void,
    preset?: { bodyPart?: string; category?: string; regions?: string[] },
  ) => void;
  onEditExerciseTags: (ex: ExerciseDefinition) => void;
  onDeleteExercise: (id: string) => void;
  onOpenNote: (name: string) => void;
  onOpenMetrics: (name: string) => void;
}

interface ScheduleEditorModalProps {
  lang: Language;
  unit: 'kg' | 'lbs';
  customTags: CustomTag[];
  defaultDate: string;          // 'YYYY-MM-DD'
  editingSchedule: ScheduledWorkout | null;
  onClose: () => void;
  pickerHost: PlanPickerHost;
}

function makeId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

const ScheduleEditorModal: React.FC<ScheduleEditorModalProps> = ({
  lang,
  unit,
  customTags,
  defaultDate,
  editingSchedule,
  onClose,
  pickerHost,
}) => {
  const { addSchedule, updateSchedule } = useScheduleContext();
  const { resolveName } = useExercisePrefs();
  const isEdit = !!editingSchedule;
  const isCn = lang === Language.CN;

  const [title, setTitle] = useState<string>(editingSchedule?.title ?? '');
  const [date, setDate] = useState<string>(editingSchedule?.date ?? defaultDate);
  // 编辑中的目标重量是当前单位下的数（plan-target-weight-unit：库里存 kg，进来换算、保存时换回去）。
  // 换算到一位小数（60 kg 显示 132.3 lb，不是 132.28）；没改过的保存时原样写回 kg，来回存不会越存越漂（审查 C）
  const shownWeight = (kg: number) => Math.round(Number(formatWeight(kg, unit)) * 10) / 10;
  const [exercises, setExercises] = useState<ScheduledExercise[]>(() =>
    (editingSchedule?.exercises ?? []).map(e =>
      e.targetWeight != null ? { ...e, targetWeight: shownWeight(e.targetWeight) } : e,
    ),
  );
  const [notes, setNotes] = useState<string>(editingSchedule?.notes ?? '');
  const [saving, setSaving] = useState(false);

  // 当前已选动作里出现过的 bodyPart 集合 —— 自动聚合，无需用户单独勾选
  const inferredBodyParts = useMemo(() => {
    const set = new Set<string>();
    for (const ex of exercises) {
      if (ex.bodyPart) set.add(ex.bodyPart);
    }
    return [...set];
  }, [exercises]);

  const labelOf = (tagId: string) => {
    const builtin = (translations as Record<string, Record<string, string>>)[tagId]?.[lang];
    if (builtin) return builtin;
    const custom = customTags.find(c => c.id === tagId);
    return custom?.name ?? tagId;
  };

  const addExercise = () => {
    setExercises(prev => [
      ...prev,
      {
        id: makeId('sex'),
        name: '',
        category: 'STRENGTH' as ExerciseCategory,
        targetSets: 3,
        targetReps: 10,
      },
    ]);
  };

  /** 库里的动作加成计划里的一行，返回行 id */
  const appendFromLibrary = useCallback(
    (ex: ExerciseDefinition): string => {
      const id = makeId('sex');
      const cat = (ex.category as ExerciseCategory) || 'STRENGTH';
      const name = ex.name[lang] || ex.name.cn || ex.name.en || '';
      // 把所选动作的标签信息（部位/器材）携带进来，便于聚合显示
      setExercises(prev => [
        ...prev,
        {
          id,
          name,
          category: cat,
          targetSets: 3,
          targetReps: 10,
          ...(ex.bodyPart ? { bodyPart: ex.bodyPart } : {}),
          ...(ex.equipment ? { tags: [ex.equipment] } : {}),
        },
      ]);
      return id;
    },
    [lang],
  );

  // ===== 选动作弹层（和训练页同一个，plan-picker-legacy-library） =====
  const [pickerOpen, setPickerOpen] = useState(false);
  const [sessionAdded, setSessionAdded] = useState(0);
  /** 本次打开里每次点选加出的行 id（按「动作::做法」分组、后进先出）：再点一下＝取消这次添加（同训练页 B2） */
  const picksRef = useRef<Map<string, string[]>>(new Map());

  const openPicker = () => {
    picksRef.current = new Map();
    setSessionAdded(0);
    setPickerOpen(true);
  };

  const handlePick = useCallback(
    (ex: ExerciseDefinition, variantId?: string): boolean => {
      const key = variantId ? `${ex.id}::${variantId}` : ex.id;
      const stack = picksRef.current.get(key) ?? [];
      const prev = stack.pop();
      if (prev) {
        setExercises(list => list.filter(e => e.id !== prev));
        picksRef.current.set(key, stack);
        setSessionAdded(n => Math.max(0, n - 1));
        return false;
      }
      // 计划行不记做法：点做法小卡按动作本身加
      stack.push(appendFromLibrary(ex));
      picksRef.current.set(key, stack);
      setSessionAdded(n => n + 1);
      return true;
    },
    [appendFromLibrary],
  );

  const handleCreateCustom = useCallback(
    (prefilledName?: string, preset?: { bodyPart?: string; category?: string; regions?: string[] }) => {
      pickerHost.onCreateCustomExercise(prefilledName, ex => {
        appendFromLibrary(ex);
        setSessionAdded(n => n + 1);
      }, preset);
    },
    [appendFromLibrary, pickerHost],
  );

  /** 小写显示名 -> 计划里出现次数（弹层「已添加 ×N」） */
  const addedCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const ex of exercises) {
      if (!ex.name.trim()) continue;
      const key = resolveName(ex.name.trim()).toLowerCase();
      counts[key] = (counts[key] || 0) + 1;
    }
    return counts;
  }, [exercises, resolveName]);

  const updateExercise = (id: string, patch: Partial<ScheduledExercise>) => {
    setExercises(prev => prev.map(e => (e.id === id ? { ...e, ...patch } : e)));
  };

  const removeExercise = (id: string) => {
    setExercises(prev => prev.filter(e => e.id !== id));
  };

  const handleSave = async () => {
    if (!date) return;
    setSaving(true);
    try {
      const now = new Date().toISOString();
      const origKg = new Map<string, number | undefined>((editingSchedule?.exercises ?? []).map(e => [e.id, e.targetWeight]));
      const toKg = (id: string, shown: number) => {
        const o = origKg.get(id);
        return o != null && shownWeight(o) === shown ? o : parseWeight(shown, unit);
      };
      const cleaned = exercises
        .map(e => ({
          ...e,
          name: e.name.trim(),
          ...(e.targetWeight != null ? { targetWeight: toKg(e.id, e.targetWeight) } : {}),
        }))
        .filter(e => e.name.length > 0);
      const payload: ScheduledWorkout = {
        id: editingSchedule?.id ?? makeId('sw'),
        userId: editingSchedule?.userId ?? FITLOG_SOLO_USER_ID,
        date,
        title: title.trim() || undefined,
        // bodyParts 不再由用户在编辑器外层勾选，统一由动作的 bodyPart 自动聚合
        bodyParts: inferredBodyParts,
        exercises: cleaned,
        notes: notes.trim() || undefined,
        // 跳过的计划改了日期＝改天再练（审查 A21）：回到「计划中」
        status:
          editingSchedule?.status === 'skipped' && date !== editingSchedule.date ? 'planned' : (editingSchedule?.status ?? 'planned'),
        linkedWorkoutId: editingSchedule?.linkedWorkoutId,
        createdAt: editingSchedule?.createdAt ?? now,
        updatedAt: now,
      };
      if (isEdit) await updateSchedule(payload);
      else await addSchedule(payload);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
    <Modal
      isOpen
      onClose={onClose}
      title={translations.scheduleEditTitle[lang]}
      size="lg"
      // 加到 3–4 个动作后保存按钮会被挤出屏：按钮放 footer 常驻，正文区限高自己滚
      bodyClassName="max-h-[calc(100dvh-12rem)] overflow-y-auto overscroll-contain custom-scrollbar"
      footer={
        <div className="flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-control border border-divider text-secondary hover:text-primary hover:bg-card-hover transition text-small"
          >
            {isCn ? '取消' : 'Cancel'}
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !date}
            data-testid="schedule-save-btn"
            className="px-4 py-2 rounded-control bg-accent text-on-accent text-small font-medium hover:opacity-90 active:scale-press-sm transition disabled:opacity-50"
          >
            {saving ? '...' : (isCn ? '保存' : 'Save')}
          </button>
        </div>
      }
    >
      <div className="space-y-4" data-testid="schedule-editor">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block">
            <span className="text-xs text-secondary">{translations.scheduleTitleLabel[lang]}</span>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              data-testid="schedule-title-input"
              className="mt-1 w-full px-3 py-2 rounded-control bg-inset border border-divider text-primary text-small focus:outline-none focus:border-accent"
              placeholder={lang === Language.CN ? '如：上肢日' : 'e.g. Upper body day'}
            />
          </label>
          <label className="block">
            <span className="text-xs text-secondary">{translations.scheduleDateLabel[lang]}</span>
            <input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              data-testid="schedule-date-input"
              className="mt-1 w-full px-3 py-2 rounded-control bg-inset border border-divider text-primary text-small focus:outline-none focus:border-accent font-mono"
            />
          </label>
        </div>

        {/* 训练部位：来自动作库选中的动作 bodyPart 自动聚合，不再由用户单独勾选 */}
        {inferredBodyParts.length > 0 && (
          <div>
            <div className="text-xs text-secondary mb-1.5">
              {translations.scheduleBodyPartsLabel[lang]}
            </div>
            <div className="flex flex-wrap gap-1.5" data-testid="schedule-inferred-bodyparts">
              {inferredBodyParts.map(id => (
                <span
                  key={id}
                  className="text-xs px-2.5 py-1 rounded-chip bg-inset text-secondary border border-divider"
                >
                  {labelOf(id)}
                </span>
              ))}
            </div>
          </div>
        )}

        <div>
          <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
            <span className="text-xs text-secondary">{translations.scheduleExercisesLabel[lang]}</span>
            <div className="flex items-center gap-1.5">
              <button
                onClick={openPicker}
                data-testid="schedule-pick-library"
                className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-chip bg-accent text-on-accent hover:opacity-90 active:scale-press-sm transition"
              >
                <Library size={14} strokeWidth={1.75} />
                {translations.scheduleFromLibrary[lang]}
              </button>
              <button
                onClick={addExercise}
                data-testid="schedule-add-exercise"
                className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-chip border border-divider text-secondary hover:text-primary hover:bg-card-hover transition"
              >
                <Plus size={14} strokeWidth={1.75} />
                {translations.scheduleManualRow[lang]}
              </button>
            </div>
          </div>
          <div className="space-y-2">
            {exercises.length === 0 && (
              <p className="text-xs text-tertiary">{translations.scheduleNoExercises[lang]}</p>
            )}
            {exercises.map(ex => (
              <div
                key={ex.id}
                className="border border-divider rounded-control p-3 space-y-2"
                data-testid="schedule-exercise-row"
              >
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={ex.name}
                    onChange={e => updateExercise(ex.id, { name: e.target.value })}
                    placeholder={lang === Language.CN ? '动作名称' : 'Exercise name'}
                    data-testid="schedule-exercise-name"
                    className="flex-1 min-w-0 px-2.5 py-1.5 rounded-chip bg-inset border border-divider text-primary text-small focus:outline-none focus:border-accent"
                  />
                  <select
                    value={ex.category}
                    onChange={e =>
                      updateExercise(ex.id, { category: e.target.value as ExerciseCategory })
                    }
                    className="px-2 py-1.5 rounded-chip bg-inset border border-divider text-primary text-xs"
                  >
                    <option value="STRENGTH">{lang === Language.CN ? '力量' : 'Strength'}</option>
                    <option value="CARDIO">{lang === Language.CN ? '有氧' : 'Cardio'}</option>
                    <option value="FREE">{lang === Language.CN ? '自由' : 'Free'}</option>
                    <option value="OTHER">{lang === Language.CN ? '其他' : 'Other'}</option>
                  </select>
                  <button
                    onClick={() => removeExercise(ex.id)}
                    className="p-1.5 text-tertiary hover:text-danger hover:bg-danger/10 rounded-chip transition-colors"
                    aria-label="remove-exercise"
                  >
                    <Trash2 size={14} strokeWidth={1.75} />
                  </button>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <label className="block">
                    <span className="text-micro font-normal text-tertiary">{translations.scheduleTargetSets[lang]}</span>
                    <ScrubNumber
                      value={ex.targetSets ?? null}
                      onCommit={n => updateExercise(ex.id, { targetSets: n ?? undefined })}
                      allowEmpty
                      live
                      steps={[1, 2, 5]}
                      decimals={0}
                      inputMode="numeric"
                      ariaLabel="targetSets"
                      fill
                      className="mt-0.5 w-full px-2 py-1 rounded-chip bg-inset border border-divider text-primary text-small font-mono"
                    />
                  </label>
                  <label className="block">
                    <span className="text-micro font-normal text-tertiary">{translations.scheduleTargetReps[lang]}</span>
                    <ScrubNumber
                      value={ex.targetReps ?? null}
                      onCommit={n => updateExercise(ex.id, { targetReps: n ?? undefined })}
                      allowEmpty
                      live
                      steps={[1, 2, 5]}
                      decimals={0}
                      inputMode="numeric"
                      ariaLabel="targetReps"
                      fill
                      className="mt-0.5 w-full px-2 py-1 rounded-chip bg-inset border border-divider text-primary text-small font-mono"
                    />
                  </label>
                  <label className="block">
                    <span className="text-micro font-normal text-tertiary">
                      {translations.scheduleTargetWeight[lang]} ({unit})
                    </span>
                    <ScrubNumber
                      value={ex.targetWeight ?? null}
                      onCommit={n => updateExercise(ex.id, { targetWeight: n ?? undefined })}
                      allowEmpty
                      live
                      steps={[0.5, 1, 2.5, 5]}
                      decimals={2}
                      inputMode="decimal"
                      ariaLabel="targetWeight"
                      testId="schedule-exercise-weight"
                      fill
                      className="mt-0.5 w-full px-2 py-1 rounded-chip bg-inset border border-divider text-primary text-small font-mono"
                    />
                  </label>
                </div>
              </div>
            ))}
          </div>
        </div>

        <label className="block">
          <span className="text-xs text-secondary">{translations.scheduleNotesLabel[lang]}</span>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            rows={2}
            className="mt-1 w-full px-3 py-2 rounded-control bg-inset border border-divider text-primary text-small focus:outline-none focus:border-accent resize-none"
          />
        </label>

      </div>
    </Modal>

    {/* 挂到 body：编辑器面板带入场 transform，fixed 的弹层放在里面会被框住；层级 modal-2 压过编辑器 */}
    {createPortal(
      <ExercisePickerSheet
        open={pickerOpen}
        layer="modal-2"
        targetLabel={title.trim() || (isCn ? '计划' : 'plan')}
        onClose={() => setPickerOpen(false)}
        addedCounts={addedCounts}
        sessionAdded={sessionAdded}
        onPickExercise={handlePick}
        onCreateCustomExercise={handleCreateCustom}
        onEditExerciseTags={pickerHost.onEditExerciseTags}
        onDeleteExercise={pickerHost.onDeleteExercise}
        onOpenNote={pickerHost.onOpenNote}
        onOpenMetrics={pickerHost.onOpenMetrics}
      />,
      document.body,
    )}
    </>
  );
};

export default ScheduleEditorModal;
