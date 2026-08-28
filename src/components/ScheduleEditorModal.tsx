/**
 * 训练计划编辑器：新增 / 编辑 一条 ScheduledWorkout
 */
import React, { useMemo, useState } from 'react';
import { Library, Plus, Trash2 } from 'lucide-react';
import { ExerciseDefinition, Language, ScheduledExercise, ScheduledWorkout } from '../../types';
import { translations } from '../../translations';
import { useScheduleContext } from '../contexts';
import { FITLOG_SOLO_USER_ID } from '../../services/fitlogSolo';
import { ExerciseCategory } from '../constants/exercises';
import Modal from './Modal';

type CustomTag = { id: string; name: string; category: 'bodyPart' | 'equipment'; parentCategory?: string };

interface ScheduleEditorModalProps {
  lang: Language;
  unit: 'kg' | 'lbs';
  customTags: CustomTag[];
  defaultDate: string;          // 'YYYY-MM-DD'
  editingSchedule: ScheduledWorkout | null;
  onClose: () => void;
  onOpenLibraryForPicker: (onPick: (ex: ExerciseDefinition) => void) => void;
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
  onOpenLibraryForPicker,
}) => {
  const { addSchedule, updateSchedule } = useScheduleContext();
  const isEdit = !!editingSchedule;

  const [title, setTitle] = useState<string>(editingSchedule?.title ?? '');
  const [date, setDate] = useState<string>(editingSchedule?.date ?? defaultDate);
  const [exercises, setExercises] = useState<ScheduledExercise[]>(editingSchedule?.exercises ?? []);
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

  const pickFromLibrary = () => {
    onOpenLibraryForPicker((ex) => {
      const cat = (ex.category as ExerciseCategory) || 'STRENGTH';
      const name = ex.name?.[lang] || ex.name?.cn || ex.name?.en || '';
      // 把所选动作的标签信息（部位/器材）携带进来，便于聚合显示
      setExercises(prev => [
        ...prev,
        {
          id: makeId('sex'),
          name,
          category: cat,
          targetSets: 3,
          targetReps: 10,
          ...(ex.bodyPart ? { bodyPart: ex.bodyPart } : {}),
          ...(ex.tags?.length ? { tags: ex.tags } : {}),
        },
      ]);
    });
  };

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
      const cleaned = exercises
        .map(e => ({ ...e, name: e.name.trim() }))
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
        status: editingSchedule?.status ?? 'planned',
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
    <Modal
      isOpen
      onClose={onClose}
      title={translations.scheduleEditTitle[lang]}
      size="lg"
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
              className="mt-1 w-full px-3 py-2 rounded-control bg-inset border border-divider text-primary text-sm focus:outline-none focus:border-accent"
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
              className="mt-1 w-full px-3 py-2 rounded-control bg-inset border border-divider text-primary text-sm focus:outline-none focus:border-accent font-mono"
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
                onClick={pickFromLibrary}
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
                    className="flex-1 px-2.5 py-1.5 rounded-chip bg-inset border border-divider text-primary text-sm focus:outline-none focus:border-accent"
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
                    <span className="text-[10px] text-tertiary">{translations.scheduleTargetSets[lang]}</span>
                    <input
                      type="number"
                      min={0}
                      value={ex.targetSets ?? ''}
                      onChange={e => updateExercise(ex.id, { targetSets: e.target.value ? Number(e.target.value) : undefined })}
                      className="mt-0.5 w-full px-2 py-1 rounded-chip bg-inset border border-divider text-primary text-sm font-mono focus:outline-none focus:border-accent"
                    />
                  </label>
                  <label className="block">
                    <span className="text-[10px] text-tertiary">{translations.scheduleTargetReps[lang]}</span>
                    <input
                      type="number"
                      min={0}
                      value={ex.targetReps ?? ''}
                      onChange={e => updateExercise(ex.id, { targetReps: e.target.value ? Number(e.target.value) : undefined })}
                      className="mt-0.5 w-full px-2 py-1 rounded-chip bg-inset border border-divider text-primary text-sm font-mono focus:outline-none focus:border-accent"
                    />
                  </label>
                  <label className="block">
                    <span className="text-[10px] text-tertiary">
                      {translations.scheduleTargetWeight[lang]} ({unit})
                    </span>
                    <input
                      type="number"
                      min={0}
                      step="0.5"
                      value={ex.targetWeight ?? ''}
                      onChange={e => updateExercise(ex.id, { targetWeight: e.target.value ? Number(e.target.value) : undefined })}
                      className="mt-0.5 w-full px-2 py-1 rounded-chip bg-inset border border-divider text-primary text-sm font-mono focus:outline-none focus:border-accent"
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
            className="mt-1 w-full px-3 py-2 rounded-control bg-inset border border-divider text-primary text-sm focus:outline-none focus:border-accent resize-none"
          />
        </label>

        <div className="flex items-center justify-end gap-2 pt-2">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-control border border-divider text-secondary hover:text-primary hover:bg-card-hover transition text-sm"
          >
            {lang === Language.CN ? '取消' : 'Cancel'}
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !date}
            data-testid="schedule-save-btn"
            className="px-4 py-2 rounded-control bg-accent text-on-accent text-sm font-medium hover:opacity-90 active:scale-press-sm transition disabled:opacity-50"
          >
            {saving ? '...' : (lang === Language.CN ? '保存' : 'Save')}
          </button>
        </div>
      </div>
    </Modal>
  );
};

export default ScheduleEditorModal;
