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
  closeMeasureModal: () => void;
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
    const name = measureForm.name.trim();
    if (!name || !measureForm.value || !user) {
      toast(isCn ? '请填写完整信息' : 'Please fill in all fields', 'error');
      return;
    }

    try {
      const now = new Date().toISOString();
      let dateToUse = now;
      if (editingMeasurementId) {
        const existing = measurements.find(m => m.id === editingMeasurementId);
        if (existing) dateToUse = existing.date;
      }

      const entry: Measurement = {
        id: editingMeasurementId || Date.now().toString(),
        userId: user.id,
        // 名字去掉首尾空格：「腰围 」和「腰围」原来会成两个指标
        name,
        value: parseFloat(measureForm.value.toString()),
        unit: measureForm.unit.trim(),
        date: dateToUse,
        updatedAt: now,
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

  /**
   * 新记一条（审查 A18）：一律清掉「正在改哪一条」——原来「改 → 取消 → 新记」会以编辑态打开、保存时把那一条覆盖掉。
   * 单位预填这个指标最近一条用的（腰围记 cm 的下次还是 cm）；没指定指标就沿用上一次表单的单位
   */
  const openAddMeasurementEntry = useCallback(
    (presetName?: string) => {
      setEditingMeasurementId(null);
      const latest = presetName ? latestMetrics.find(m => m.name === presetName) : undefined;
      setMeasureForm(f => ({ name: presetName || '', value: '', unit: latest?.unit ?? (presetName ? '' : f.unit) }));
      setShowMeasureModal(true);
    },
    [latestMetrics],
  );

  /** 关弹窗：编辑态一起清掉，下次打开不会还挂着那一条 */
  const closeMeasureModal = useCallback(() => {
    setShowMeasureModal(false);
    setEditingMeasurementId(null);
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
    closeMeasureModal,
  };
}
