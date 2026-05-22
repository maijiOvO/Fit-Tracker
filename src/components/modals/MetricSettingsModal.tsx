import React, { useState } from 'react';
import { Check, Plus, Settings as SettingsIcon } from 'lucide-react';
import { Language } from '../../../types';
import { translations } from '../../../translations';
import { STANDARD_METRICS } from '../../constants/exercises';

interface MetricSettingsModalProps {
  open: boolean;
  exerciseName: string | null;
  lang: Language;
  getActiveMetrics: (name: string) => string[];
  toggleMetric: (name: string, metricKey: string) => void;
  /** 重置到默认（应配合 confirm 弹窗使用） */
  onResetDefault: () => Promise<void> | void;
  onClose: () => void;
}

export const MetricSettingsModal: React.FC<MetricSettingsModalProps> = ({
  open,
  exerciseName,
  lang,
  getActiveMetrics,
  toggleMetric,
  onResetDefault,
  onClose,
}) => {
  const [newCustomDimension, setNewCustomDimension] = useState('');
  if (!open || !exerciseName) return null;
  const isCn = lang === Language.CN;
  const activeMetrics = getActiveMetrics(exerciseName);

  return (
    <div className="fixed inset-0 z-[80] bg-base/80 backdrop-blur-sm flex items-center justify-center p-6 animate-in fade-in">
      <div className="bg-inset border border-divider w-full max-w-sm rounded-card p-8 shadow-2xl overflow-y-auto max-h-[90vh] custom-scrollbar">
        <h2 className="text-xl font-semibold text-white mb-6 flex items-center gap-2">
          <SettingsIcon size={20} className="text-accent" />
          {translations.manageMetrics[lang]} - {exerciseName}
        </h2>

        <p className="text-[10px] font-bold text-secondary  mb-4 px-1">
          {isCn ? '选择要记录的维度' : 'Select metrics to track'}
        </p>

        <div className="space-y-3 mb-8">
          {Array.from(new Set([...STANDARD_METRICS, ...activeMetrics])).map(m => (
            <button
              key={m}
              onClick={() => toggleMetric(exerciseName, m)}
              className={`w-full p-4 rounded-2xl border flex justify-between items-center transition-all ${
                activeMetrics.includes(m)
                  ? 'bg-accent/10 border-blue-500/50 text-white'
                  : 'bg-card/50 border-divider text-secondary'
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

        <p className="text-[10px] font-bold text-secondary  mb-4 px-1">
          {translations.addDimension[lang]}
        </p>

        <div className="flex gap-2 mb-8">
          <input
            className="flex-1 bg-base border border-divider rounded-xl px-4 py-3 text-sm text-white outline-none focus:border-blue-500"
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
            className="bg-card border border-divider p-2 px-4 rounded-xl text-accent font-bold text-xs active:scale-95 transition-all"
          >
            {isCn ? '添加' : 'Add'}
          </button>
        </div>

        <div className="flex gap-3">
          <button
            onClick={onResetDefault}
            className="flex-1 py-4 rounded-2xl bg-card border border-divider text-secondary font-bold text-sm active:scale-95 transition-all hover:bg-card-hover"
          >
            {isCn ? '重置默认' : 'Reset Default'}
          </button>
          <button
            onClick={onClose}
            className="flex-[2] py-4 rounded-2xl bg-accent text-white font-semibold shadow-xl shadow-blue-600/20 active:scale-95 transition-all"
          >
            {translations.confirm[lang]}
          </button>
        </div>
      </div>
    </div>
  );
};

export default MetricSettingsModal;
