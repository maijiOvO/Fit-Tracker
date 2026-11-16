/**
 * 身体指标的录入 / 编辑 / 删除
 */
import React, { useCallback, useMemo, useState } from 'react';
import { Language, Measurement } from '../../types';
import { db } from '../../services/db';
import { recordTombstone } from '../../services/fitlogTombstones';
import { scheduleDebouncedFitlogPush } from '../../services/fitlogSyncScheduler';
import { FITLOG_SOLO_USER_ID } from '../../services/fitlogSolo';
import { useUiOverlay } from '../contexts/UiOverlayContext';
import { useUserSettingsContext } from '../contexts/UserSettingsContext';
import { localYmd } from '../utils/dateUtils';
import { MetricGlance, latestByMetric, moveToLocalDay } from '../utils/measurementLog';

export interface MeasurementForm {
  name: string;
  value: string;
  unit: string;
  /** 这条记在哪一天（本地日期 YYYY-MM-DD）：新记默认今天，可以往前补记 */
  date: string;
}

export interface UseMeasurementLogResult {
  showMeasureModal: boolean;
  editingMeasurementId: string | null;
  /** 弹窗里名字不给改：往已有指标里记一条、或改某一条时（改名会把这条挪到另一个指标里去） */
  measureNameFixed: boolean;
  measureForm: MeasurementForm;
  setMeasureForm: React.Dispatch<React.SetStateAction<MeasurementForm>>;
  expandedMetric: string | null;
  setExpandedMetric: React.Dispatch<React.SetStateAction<string | null>>;

  latestMetrics: MetricGlance[];

  handleSaveMeasurement: () => Promise<void>;
  /** 删掉正在改的那一条（入口只在「修改记录」弹窗里） */
  handleDeleteMeasurement: () => Promise<void>;
  triggerEditMeasurement: (item: Measurement) => void;
  openAddMeasurementEntry: (presetName?: string) => void;
  closeMeasureModal: () => void;
}

export function useMeasurementLog(): UseMeasurementLogResult {
  const settingsCtx = useUserSettingsContext();
  const { toast } = useUiOverlay();

  const lang = settingsCtx.lang;
  const isCn = lang === Language.CN;
  const measurements = settingsCtx.measurements;

  const [showMeasureModal, setShowMeasureModal] = useState(false);
  const [editingMeasurementId, setEditingMeasurementId] = useState<string | null>(null);
  const [measureNameFixed, setMeasureNameFixed] = useState(false);
  const [measureForm, setMeasureForm] = useState<MeasurementForm>({
    name: '',
    value: '',
    unit: 'cm',
    date: localYmd(new Date()),
  });
  const [expandedMetric, setExpandedMetric] = useState<string | null>(null);

  const latestMetrics = useMemo(() => latestByMetric(measurements), [measurements]);

  const handleSaveMeasurement = useCallback(async () => {
    const name = measureForm.name.trim();
    if (!name || !measureForm.value || !measureForm.date) {
      toast(isCn ? '请填写完整信息' : 'Please fill in all fields', 'error');
      return;
    }

    try {
      const now = new Date().toISOString();
      // 改某一条：日期没动就保留原来的时刻；新记：今天＝现在，补记＝那天的这个钟点
      const existing = editingMeasurementId ? measurements.find(m => m.id === editingMeasurementId) : undefined;
      const dateToUse = moveToLocalDay(existing?.date ?? now, measureForm.date);

      const entry: Measurement = {
        id: editingMeasurementId || Date.now().toString(),
        userId: FITLOG_SOLO_USER_ID,
        // 名字去掉首尾空格：「腰围 」和「腰围」原来会成两个指标
        name,
        value: parseFloat(measureForm.value),
        unit: measureForm.unit.trim(),
        date: dateToUse,
        updatedAt: now,
      };

      await db.save('custom_metrics', entry);
      await settingsCtx.reloadFromIndexedDb();
      scheduleDebouncedFitlogPush();

      setShowMeasureModal(false);
      setEditingMeasurementId(null);
    } catch (error: any) {
      toast(
        (isCn ? '保存失败: ' : 'Save failed: ') + (error?.message || error),
        'error',
      );
    }
  }, [editingMeasurementId, isCn, measureForm, measurements, settingsCtx, toast]);

  const handleDeleteMeasurement = useCallback(async () => {
    if (!editingMeasurementId) return;
    try {
      await db.delete('custom_metrics', editingMeasurementId);
      recordTombstone('customMetrics', editingMeasurementId);
      await settingsCtx.reloadFromIndexedDb();
      scheduleDebouncedFitlogPush();
      setShowMeasureModal(false);
      setEditingMeasurementId(null);
    } catch (err) {
      console.error(err);
    }
  }, [editingMeasurementId, settingsCtx]);

  const triggerEditMeasurement = useCallback((item: Measurement) => {
    setEditingMeasurementId(item.id);
    setMeasureNameFixed(true);
    setMeasureForm({ name: item.name, value: item.value.toString(), unit: item.unit, date: localYmd(new Date(item.date)) });
    setShowMeasureModal(true);
  }, []);

  /**
   * 新记一条（审查 A18）：一律清掉「正在改哪一条」——原来「改 → 取消 → 新记」会以编辑态打开、保存时把那一条覆盖掉。
   * 单位预填这个指标最近一条用的（腰围记 cm 的下次还是 cm）；没指定指标就沿用上一次表单的单位
   */
  const openAddMeasurementEntry = useCallback(
    (presetName?: string) => {
      setEditingMeasurementId(null);
      setMeasureNameFixed(!!presetName);
      const latest = presetName ? latestMetrics.find(m => m.name === presetName) : undefined;
      setMeasureForm(f => ({
        name: presetName || '',
        value: '',
        unit: latest?.unit ?? (presetName ? '' : f.unit),
        date: localYmd(new Date()),
      }));
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
    editingMeasurementId,
    measureNameFixed,
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
