/**
 * 体重日志的录入 / 编辑 / 删除
 */
import React, { useCallback, useState } from 'react';
import { Language, WeightEntry } from '../../types';
import { db } from '../../services/db';
import { KG_TO_LBS } from '../constants';
import { removeTombstone } from '../../services/fitlogTombstones';
import { scheduleDebouncedFitlogPush } from '../../services/fitlogSyncScheduler';
import { useAuthContext } from '../contexts/AuthContext';
import { useGoalsContext } from '../contexts/GoalsContext';
import { useUserSettingsContext } from '../contexts/UserSettingsContext';
import { useUiOverlay } from '../contexts/UiOverlayContext';

export interface UseWeightLogResult {
  showWeightInput: boolean;
  setShowWeightInput: React.Dispatch<React.SetStateAction<boolean>>;
  weightInputValue: string;
  setWeightInputValue: React.Dispatch<React.SetStateAction<string>>;
  editingWeightId: string | null;
  setEditingWeightId: React.Dispatch<React.SetStateAction<string | null>>;

  handleLogWeight: () => Promise<void>;
  handleDeleteWeightEntry: (e: React.MouseEvent, id: string) => Promise<void>;
  triggerEditWeight: (entry: WeightEntry) => void;
}

export function useWeightLog(
  /** 触发 dashboard 切到该项目，沿用旧行为 */
  onWeightSaved?: () => void,
): UseWeightLogResult {
  const authCtx = useAuthContext();
  const goalsCtx = useGoalsContext();
  const settingsCtx = useUserSettingsContext();
  const { confirm, toast, toastUndo } = useUiOverlay();

  const lang = settingsCtx.lang;
  const isCn = lang === Language.CN;
  const unit = settingsCtx.unit;
  const weightEntries = settingsCtx.weightEntries;
  const goals = goalsCtx.goals;
  const user = authCtx.user;

  const [showWeightInput, setShowWeightInput] = useState(false);
  const [weightInputValue, setWeightInputValue] = useState('');
  const [editingWeightId, setEditingWeightId] = useState<string | null>(null);

  const parseWeightToKg = (val: number) => (unit === 'kg' ? val : val / KG_TO_LBS);

  const handleLogWeight = useCallback(async () => {
    if (!weightInputValue || !user) return;
    const w = Number(weightInputValue);
    let dateToUse = new Date().toISOString();
    if (editingWeightId) {
      const old = weightEntries.find(we => we.id === editingWeightId);
      if (old) dateToUse = old.date;
    }

    const entry: WeightEntry = {
      id: editingWeightId || Date.now().toString(),
      userId: user.id,
      weight: parseWeightToKg(w),
      date: dateToUse,
      unit,
    };
    await db.save('weightLogs', entry);

    const weightKg = entry.weight;
    const isLatest =
      weightEntries.length === 0 ||
      new Date(dateToUse).getTime() >= new Date(weightEntries[0].date).getTime();
    if (isLatest) {
      const weightGoals = goals.filter(g => g.type === 'weight');
      for (const g of weightGoals) {
        const updatedGoal = { ...g, currentValue: weightKg };
        await db.save('goals', updatedGoal);
      }
    }

    await Promise.all([
      settingsCtx.refreshWeightEntries(),
      goalsCtx.refreshFromDb(),
    ]);
    scheduleDebouncedFitlogPush();
    setEditingWeightId(null);
    setShowWeightInput(false);
    setWeightInputValue('');
    onWeightSaved?.();
  }, [
    editingWeightId,
    goals,
    goalsCtx,
    onWeightSaved,
    settingsCtx,
    unit,
    user,
    weightEntries,
    weightInputValue,
  ]);

  const handleDeleteWeightEntry = useCallback(
    async (e: React.MouseEvent, id: string) => {
      e.stopPropagation();
      const entry = weightEntries.find(w => w.id === id);
      if (!entry) return;
      const ok = await confirm({
        message: isCn ? '确定要删除这条记录吗？' : 'Delete this entry?',
        danger: true,
        confirmLabel: isCn ? '删除' : 'Delete',
      });
      if (!ok) return;
      const snapshot = structuredClone(entry);
      try {
        await settingsCtx.deleteWeightEntry(id);
        toastUndo(isCn ? '已删除体重记录' : 'Weight entry deleted', async () => {
          await db.save('weightLogs', snapshot);
          removeTombstone('weightLogs', id);
          await settingsCtx.refreshWeightEntries();
          scheduleDebouncedFitlogPush();
        });
      } catch (error) {
        console.error('Delete failed', error);
        toast(isCn ? '删除失败' : 'Delete failed', 'error');
      }
    },
    [confirm, isCn, settingsCtx, toast, toastUndo, weightEntries],
  );

  const triggerEditWeight = useCallback(
    (entry: WeightEntry) => {
      setEditingWeightId(entry.id);
      const currentVal = unit === 'kg' ? entry.weight : entry.weight * KG_TO_LBS;
      setWeightInputValue(currentVal.toFixed(1).replace(/\.0$/, ''));
      setShowWeightInput(true);
    },
    [unit],
  );

  return {
    showWeightInput,
    setShowWeightInput,
    weightInputValue,
    setWeightInputValue,
    editingWeightId,
    setEditingWeightId,
    handleLogWeight,
    handleDeleteWeightEntry,
    triggerEditWeight,
  };
}
