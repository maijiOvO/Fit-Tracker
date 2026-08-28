import React, { useState } from 'react';
import { Check, Plus } from 'lucide-react';
import { Language } from '../../../types';
import { translations } from '../../../translations';
import { Modal } from '../Modal';
import { STANDARD_METRICS } from '../../constants/exercises';
import { LoadMode } from '../../utils/exerciseConfig';

interface MetricSettingsModalProps {
  open: boolean;
  exerciseName: string | null;
  lang: Language;
  getActiveMetrics: (name: string) => string[];
  toggleMetric: (name: string, metricKey: string) => void;
  /** 重置到默认（应配合 confirm 弹窗使用） */
  onResetDefault: () => Promise<void> | void;
  onClose: () => void;
  /** 当前动作实例的负重/辅助标记（从训练页打开时才有） */
  loadMode?: LoadMode;
  onChangeLoadMode?: (mode: LoadMode) => void;
}

export const MetricSettingsModal: React.FC<MetricSettingsModalProps> = ({
  open,
  exerciseName,
  lang,
  getActiveMetrics,
  toggleMetric,
  onResetDefault,
  onClose,
  loadMode,
  onChangeLoadMode,
}) => {
  const [newCustomDimension, setNewCustomDimension] = useState('');
  const isCn = lang === Language.CN;
  const activeMetrics = exerciseName ? getActiveMetrics(exerciseName) : [];

  return (
    <Modal
      isOpen={open && !!exerciseName}
      onClose={onClose}
      title={translations.manageMetrics[lang]}
      subtitle={exerciseName || undefined}
      size="sm"
      layer="modal-2"
      bodyClassName="overflow-y-auto max-h-[70vh] custom-scrollbar"
      footer={
        <div className="flex gap-3">
          <button
            type="button"
            onClick={onResetDefault}
            className="flex-1 min-h-[52px] rounded-control border border-divider text-secondary font-medium transition-colors duration-tap ease-paper active:bg-card-hover"
          >
            {isCn ? '重置默认' : 'Reset Default'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="flex-[2] min-h-[52px] rounded-control bg-accent text-on-accent font-semibold transition-opacity duration-tap ease-paper"
          >
            {translations.confirm[lang]}
          </button>
        </div>
      }
    >
      <div>
        {/* 原来是 10px——低于 §3 的 11px 下限 */}
        <p className="text-label font-medium text-secondary mb-3">
          {isCn ? '选择要记录的维度' : 'Select metrics to track'}
        </p>

        <div className="space-y-3 mb-8">
          {Array.from(new Set([...STANDARD_METRICS, ...activeMetrics])).map(m => (
            <button
              key={m}
              onClick={() => toggleMetric(exerciseName, m)}
              className={`w-full p-4 rounded-card border flex justify-between items-center transition-ui ${
                activeMetrics.includes(m)
                  ? 'bg-accent-soft border-accent text-accent'
                  : 'bg-inset border-divider text-secondary'
              }`}
            >
              <span className="font-bold uppercase text-xs">
                {translations[m as keyof typeof translations]?.[lang] ||
                  m.replace('custom_', '')}
              </span>
              {activeMetrics.includes(m) ? (
                <Check size={16} className="text-accent" />
              ) : (
                <Plus size={16} />
              )}
            </button>
          ))}
        </div>

        {onChangeLoadMode && (
          <>
            <p className="text-[10px] font-bold text-secondary  mb-4 px-1">
              {isCn ? '负重 / 辅助标记' : 'Load mode'}
            </p>
            <div className="flex gap-1 p-1 mb-2 bg-card/50 border border-divider rounded-control">
              {(['none', 'weighted', 'assisted'] as const).map(m => (
                <button
                  key={m}
                  onClick={() => onChangeLoadMode(m)}
                  className={`flex-1 py-2.5 rounded-chip text-xs font-bold transition-colors ${
                    (loadMode ?? 'none') === m
                      ? 'bg-accent text-on-accent'
                      : 'text-secondary hover:text-primary'
                  }`}
                >
                  {m === 'none'
                    ? isCn ? '标准' : 'Standard'
                    : m === 'weighted'
                      ? translations.modeWeighted[lang]
                      : translations.modeAssisted[lang]}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-tertiary mb-8 px-1">
              {isCn
                ? '仅作标记：重量列表头显示 + / −，不参与统计'
                : 'Label only: weight header shows + / −, excluded from stats'}
            </p>
          </>
        )}

        <p className="text-[10px] font-bold text-secondary  mb-4 px-1">
          {translations.addDimension[lang]}
        </p>

        <div className="flex gap-2 mb-8">
          <input
            className="flex-1 bg-base border border-divider rounded-control px-4 py-3 text-sm text-primary outline-none focus:border-accent"
            placeholder={translations.dimensionPlaceholder[lang]}
            value={newCustomDimension}
            onChange={e => setNewCustomDimension(e.target.value)}
          />
          <button
            onClick={() => {
              if (!newCustomDimension) return;
              toggleMetric(exerciseName, `custom_${newCustomDimension}`);
              setNewCustomDimension('');
            }}
            className="bg-card border border-divider p-2 px-4 rounded-control text-accent font-bold text-xs active:scale-press-sm transition-ui"
          >
            {isCn ? '添加' : 'Add'}
          </button>
        </div>

      </div>
    </Modal>
  );
};

export default MetricSettingsModal;
