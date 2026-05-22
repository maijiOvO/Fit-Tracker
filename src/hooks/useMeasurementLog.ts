/**
 * 身体指标的录入 / 编辑 / 删除
 */
import React, { useCallback, useMemo, useState } from 'react';
import { Language, Measurement } from '../../types';
import { db } from '../../services/db';
import { recordTombstone } from '../../services/fitlogTombstones';
import { scheduleDebouncedFitlogPush } from '../../services/fitlogSyncScheduler';
import { useAuthContext } from '../contexts/AuthContext';
import { useUiOverlay } from '../contexts/UiOverlayContext';
import { useUserSettingsContext } from '../contexts/UserSettingsContext';

export interface MeasurementForm {
  name: string;
  value: string;
  unit: string;
}

export interface UseMeasurementLogResult {
  showMeasureModal: boolean;
  setShowMeasureModal: React.Dispatch<React.SetStateAction<boolean>>;
  editingMeasurementId: string | null;
  setEditingMeasurementId: React.Dispatch<React.SetStateAction<string | null>>;
  measureForm: MeasurementForm;
  setMeasureForm: React.Dispatch<React.SetStateAction<MeasurementForm>>;
  expandedMetric: string | null;
  setExpandedMetric: React.Dispatch<React.SetStateAction<string | null>>;

  latestMetrics: {
    name: string;
    value: string;
    unit: string;
    date: string;
  }[];

  handleSaveMeasurement: () => Promise<void>;
  handleDeleteMeasurement: (e: React.MouseEvent, id: string) => Promise<void>;
  triggerEditMeasurement: (item: Measurement) => void;
  openAddMeasurementEntry: (presetName?: string) => void;
}

export function useMeasurementLog(): UseMeasurementLogResult {
  const authCtx = useAuthContext();
  const settingsCtx = useUserSettingsContext();
  const { toast } = useUiOverlay();

  const lang = settingsCtx.lang;
  const isCn = lang === Language.CN;
  const measurements = settingsCtx.measurements;
  const user = authCtx.user;

  const [showMeasureModal, setShowMeasureModal] = useState(false);
  const [editingMeasurementId, setEditingMeasurementId] = useState<string | null>(null);
  const [measureForm, setMeasureForm] = useState<MeasurementForm>({
    name: '',
    value: '',
    unit: 'cm',
  });
  const [expandedMetric, setExpandedMetric] = useState<string | null>(null);

  /** 每个指标的最新数据（用于 Profile 展示） */
  const latestMetrics = useMemo(() => {
    const map = new Map<string, Measurement>();
    const sorted = [...measurements].sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
    );
    sorted.forEach(m => map.set(m.name, m));
    return Array.from(map.values()).map(m => ({
      name: m.name,
      value: String(m.value),
      unit: m.unit,
      date: m.date,
    }));
  }, [measurements]);

  const handleSaveMeasurement = useCallback(async () => {
    if (!measureForm.name || !measureForm.value || !user) {
      toast(isCn ? '请填写完整信息' : 'Please fill in all fields', 'error');
      return;
    }

    try {
      let dateToUse = new Date().toISOString();
      if (editingMeasurementId) {
        const existing = measurements.find(m => m.id === editingMeasurementId);
        if (existing) dateToUse = existing.date;
      }

      const entry: Measurement = {
        id: editingMeasurementId || Date.now().toString(),
        userId: user.id,
        name: measureForm.name,
        value: parseFloat(measureForm.value.toString()),
        unit: measureForm.unit,
        date: dateToUse,
      };

      await db.save('custom_metrics', entry);
      await settingsCtx.reloadFromIndexedDb();
      scheduleDebouncedFitlogPush();

      setShowMeasureModal(false);
      setMeasureForm({ name: '', value: '', unit: measureForm.unit });
      setEditingMeasurementId(null);
    } catch (error: any) {
      toast(
        (isCn ? '保存失败: ' : 'Save failed: ') + (error?.message || error),
        'error',
      );
    }
  }, [editingMeasurementId, isCn, measureForm, measurements, settingsCtx, toast, user]);

  const handleDeleteMeasurement = useCallback(
    async (e: React.MouseEvent, id: string) => {
      e.stopPropagation();
      try {
        await db.delete('custom_metrics', id);
        recordTombstone('customMetrics', id);
        await settingsCtx.reloadFromIndexedDb();
        scheduleDebouncedFitlogPush();
      } catch (err) {
        console.error(err);
      }
    },
    [settingsCtx],
  );

  const triggerEditMeasurement = useCallback((item: Measurement) => {
    setEditingMeasurementId(item.id);
    setMeasureForm({ name: item.name, value: item.value.toString(), unit: item.unit });
    setShowMeasureModal(true);
  }, []);

  const openAddMeasurementEntry = useCallback((presetName?: string) => {
    setEditingMeasurementId(null);
    setMeasureForm({ name: presetName || '', value: '', unit: '' });
    setShowMeasureModal(true);
  }, []);

  return {
    showMeasureModal,
    setShowMeasureModal,
    editingMeasurementId,
    setEditingMeasurementId,
    measureForm,
    setMeasureForm,
    expandedMetric,
    setExpandedMetric,
    latestMetrics,
    handleSaveMeasurement,
    handleDeleteMeasurement,
    triggerEditMeasurement,
    openAddMeasurementEntry,
  };
}
