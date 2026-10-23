import React, { useEffect, useRef, useState } from 'react';
import { Check, ChevronRight, Plus } from 'lucide-react';
import { Language } from '../../../types';
import { translations } from '../../../translations';
import { Modal } from '../Modal';
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
  /**
   * 负荷记法（变体第二层）：普通重量，还是带正负（自重类：辅助负、自重 0、负重正，±5 可以跨过 0）。
   * 按动作存（动作库里的设置），不传＝不显示这一节（动作不在库里）。
   */
  signedLoad?: boolean;
  onChangeSignedLoad?: (on: boolean) => void;
  /**
   * 名称、部位与器械：练的时候发现动作建错了（比如「提踵」其实是杠铃动作），在这里就能改，
   * 不用退出去翻动作库。打开的是动作库里同一个改名 / 改标签弹窗。动作不在库里时不传，不显示这一节。
   */
  onRename?: () => void;
  onEditTags?: () => void;
  /** 「小腿 · 杠铃」这样的一行摘要 */
  tagSummary?: string;
  /**
   * 2026-10-22 合并入口：训练里打开时，弹窗末尾留一段「在 X · 只改这一台」，
   * 那张卡把这台器械的设置行 portal 进来（状态都在卡上）。没有器械设置的动作这段是空的，不显示。
   */
  gymSlotRef?: (el: HTMLElement | null) => void;
  /** 从大图的小药丸进来：打开后滚到那一段 */
  focusGym?: boolean;
}

export const MetricSettingsModal: React.FC<MetricSettingsModalProps> = ({
  open,
  exerciseName,
  lang,
  getActiveMetrics,
  toggleMetric,
  onResetDefault,
  onClose,
  signedLoad,
  onChangeSignedLoad,
  onRename,
  onEditTags,
  tagSummary,
  gymSlotRef,
  focusGym,
}) => {
  const [newCustomDimension, setNewCustomDimension] = useState('');
  const isCn = lang === Language.CN;
  const activeMetrics = exerciseName ? getActiveMetrics(exerciseName) : [];
  const slotEl = useRef<HTMLDivElement | null>(null);
  const isOpen = open && !!exerciseName;
  useEffect(() => {
    if (!isOpen || !focusGym) return;
    // 卡片拿到挂载点后下一轮才渲染进来，弹窗还在进场动画里（滚了也被吞），所以等内容到了、动画过了再滚
    let tries = 0;
    let t = window.setTimeout(function tick() {
      const el = slotEl.current;
      if (el?.childElementCount) el.scrollIntoView({ block: 'start', behavior: 'smooth' });
      else if (++tries < 10) t = window.setTimeout(tick, 60);
    }, 260);
    return () => window.clearTimeout(t);
  }, [isOpen, focusGym]);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isCn ? '动作设置' : 'Exercise settings'}
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
            data-testid="metric-modal-done"
            className="flex-[2] min-h-[52px] rounded-control bg-accent text-on-accent font-semibold transition-opacity duration-tap ease-paper"
          >
            {translations.confirm[lang]}
          </button>
        </div>
      }
    >
      <div className="metric-modal">
        {/* 下面有「在 X」那一段时才出现，两段对照着看 */}
        <p className="metric-scope-head">
          <b>{isCn ? '这个动作' : 'This exercise'}</b>
          <small>{isCn ? '所有馆通用' : 'Every gym'}</small>
        </p>
        {(onRename || onEditTags) && (
          <div className="mb-6 rounded-card border border-divider divide-y divide-divider" data-testid="exercise-identity">
            {onRename && (
              <button
                type="button"
                onClick={onRename}
                className="w-full min-h-[52px] px-4 flex items-center gap-3 text-left active:bg-card-hover"
                data-testid="settings-rename"
              >
                <span className="text-label text-secondary w-16 flex-shrink-0">{isCn ? '名称' : 'Name'}</span>
                <span className="flex-1 min-w-0 truncate font-semibold text-primary">{exerciseName}</span>
                <ChevronRight size={16} className="text-tertiary flex-shrink-0" />
              </button>
            )}
            {onEditTags && (
              <button
                type="button"
                onClick={onEditTags}
                className="w-full min-h-[52px] px-4 flex items-center gap-3 text-left active:bg-card-hover"
                data-testid="settings-edit-tags"
              >
                <span className="text-label text-secondary w-16 flex-shrink-0">{isCn ? '部位器械' : 'Tags'}</span>
                <span className="flex-1 min-w-0 truncate text-primary">{tagSummary || (isCn ? '未设置' : 'None')}</span>
                <ChevronRight size={16} className="text-tertiary flex-shrink-0" />
              </button>
            )}
          </div>
        )}

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

        {onChangeSignedLoad && (
          <>
            <p className="text-micro font-bold text-secondary  mb-4 px-1">
              {isCn ? '负荷记法' : 'Load'}
            </p>
            <div className="flex gap-1 p-1 mb-8 bg-card/50 border border-divider rounded-control" data-testid="signed-load-toggle">
              {([false, true] as const).map(on => (
                <button
                  key={String(on)}
                  type="button"
                  onClick={() => onChangeSignedLoad(on)}
                  aria-pressed={!!signedLoad === on}
                  className={`flex-1 py-2.5 rounded-chip text-xs font-bold transition-colors ${
                    !!signedLoad === on ? 'seg-on' : 'text-secondary hover:text-primary'
                  }`}
                >
                  {on ? (isCn ? '辅助 − / 自重 / 负重 +' : 'Assisted − / BW / Weighted +') : isCn ? '普通重量' : 'Plain weight'}
                </button>
              ))}
            </div>
          </>
        )}

        <p className="text-micro font-bold text-secondary  mb-4 px-1">
          {translations.addDimension[lang]}
        </p>

        <div className="flex gap-2 mb-8">
          <input
            className="flex-1 bg-base border border-divider rounded-control px-4 py-3 text-small text-primary outline-none focus:border-accent"
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

        <div
          className="metric-gym-slot"
          ref={el => {
            slotEl.current = el;
            gymSlotRef?.(el);
          }}
        />
      </div>
    </Modal>
  );
};

export default MetricSettingsModal;
