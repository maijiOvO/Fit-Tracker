/**
 * 体重日志的录入 / 编辑 / 删除
 */
import React, { useCallback, useState } from 'react';
import { Language, WeightEntry } from '../../types';
import { db } from '../../services/db';
import { KG_TO_LBS } from '../constants';
import { clampBodyweightD } from '../utils/load';
import { scheduleDebouncedFitlogPush } from '../../services/fitlogSyncScheduler';
import { FITLOG_SOLO_USER_ID } from '../../services/fitlogSolo';
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
  const settingsCtx = useUserSettingsContext();
  const { toast } = useUiOverlay();

  const lang = settingsCtx.lang;
  const isCn = lang === Language.CN;
  const unit = settingsCtx.unit;
  const weightEntries = settingsCtx.weightEntries;

  const [showWeightInput, setShowWeightInput] = useState(false);
  const [weightInputValue, setWeightInputValue] = useState('');
  const [editingWeightId, setEditingWeightId] = useState<string | null>(null);

  const parseWeightToKg = (val: number) => (unit === 'kg' ? val : val / KG_TO_LBS);

  const handleLogWeight = useCallback(async () => {
    if (!weightInputValue) return;
    const w = Number(weightInputValue);
    if (!Number.isFinite(w)) return;
    let dateToUse = new Date().toISOString();
    if (editingWeightId) {
      const old = weightEntries.find(we => we.id === editingWeightId);
      if (old) dateToUse = old.date;
    }

    const entry: WeightEntry = {
      id: editingWeightId || Date.now().toString(),
      userId: FITLOG_SOLO_USER_ID,
      // 20~300 kg（显示单位下的等值）以外的不是体重，是手滑：输入框失焦也夹，这里是写进库前的最后一道
      weight: parseWeightToKg(clampBodyweightD(w, unit === 'lbs' ? 'lbs' : 'kg')),
      date: dateToUse,
      unit,
      updatedAt: new Date().toISOString(),
    };
    await db.save('weightLogs', entry);

    // 体重目标的当前值在目标卡上现算（goalProgress.weightGoalCurrent），不再写回 goals
    await settingsCtx.refreshWeightEntries();
    scheduleDebouncedFitlogPush();
    setEditingWeightId(null);
    setShowWeightInput(false);
    setWeightInputValue('');
    onWeightSaved?.();
  }, [
    editingWeightId,
    onWeightSaved,
    settingsCtx,
    unit,
    weightEntries,
    weightInputValue,
  ]);

  const handleDeleteWeightEntry = useCallback(
    async (e: React.MouseEvent, id: string) => {
      e.stopPropagation();
      const entry = weightEntries.find(w => w.id === id);
      if (!entry) return;
      // 不确认、不给撤销条：点错了用顶栏的全局撤销（2026-10-25）
      try {
        await settingsCtx.deleteWeightEntry(id);
      } catch (error) {
        console.error('Delete failed', error);
        toast(isCn ? '删除失败' : 'Delete failed', 'error');
      }
    },
    [isCn, settingsCtx, toast, weightEntries],
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
