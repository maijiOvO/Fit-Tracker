import React, { useState, lazy, useMemo, Suspense } from 'react';
import { ActivityHeatmap, HeatmapDay } from './ActivityHeatmap';
import {
  Camera, ChevronRight,
  ChevronUp, Plus, Edit2, History, Ruler, Activity,
} from 'lucide-react';
import { PrefsSheet } from './PrefsSheet';
import { BackupGlance } from './data/DataSafetySection';
import type { SyncStatus } from '../hooks/useFitlogSync';
import { useUserSettingsContext } from '../contexts/UserSettingsContext';
import { WorkoutSession, Measurement, Language } from '../../types';
import type { MetricGlance } from '../utils/measurementLog';
import { FITLOG_SOLO_USER } from '../../services/fitlogSolo';
import { hasDoneSets } from '../utils/workbench';
import { useUiOverlay } from '../contexts/UiOverlayContext';
import { plural } from '../utils/format';
import { useDoneWorkouts, useLiftSummaries } from '../hooks/useLiftSummaries';
import { localYmd } from '../utils/dateUtils';
import { shortDate } from '../utils/liftDisplay';
import { RenameModal } from './modals/RenameModal';

// 懒加载 MetricChart（包含 recharts）
const MetricChart = lazy(() => import('./LazyCharts').then(m => ({ default: m.MetricChart })));

type HeatmapValue = HeatmapDay;

interface ProfileTabProps {
  avatarUrl: string | undefined;
  workouts: WorkoutSession[];
  measurements: Measurement[];
  lang: Language;
  heatmapData: HeatmapValue[];
  latestMetrics: MetricGlance[];
  expandedMetric: string | null;
  onAvatarUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onShowMeasureModal: () => void;
  onToggleMetric: (metricName: string | null) => void;
  onEditMeasurement: (measurement: Measurement) => void;
  onAddMeasurementEntry: (name: string) => void;
  /** 整项改名（新名字已有就并进去） */
  onRenameMetric: (from: string, to: string) => Promise<void>;
  setShowResetAccountModal: (show: boolean) => void;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  /** 开发模式隔离开关，仅开发机可见 */
  devMode?: boolean;
  onToggleDevMode?: () => void;
  onToggleLanguage: () => void;
  /** 首选项「数据」组 */
  syncStatus: SyncStatus;
  lastSyncedAt: number | null;
  /** 推送这一头：有改动没推 / 推送失败 / 都推上去了 */
  pushState?: 'synced' | 'pending' | 'failed';
  /** 导出 / 导入在忙（自己的状态，不借同步的） */
  dataBusy?: boolean;
  onSync?: () => void;
  onExportData: () => void;
  onImportData: () => void;
  /** 首选项「动作库与标签 ›」：打开只管动作库的弹层（整理态） */
  onOpenLibrary: () => void;
}

export const ProfileTab: React.FC<ProfileTabProps> = ({
  avatarUrl,
  workouts,
  measurements,
  lang,
  heatmapData,
  latestMetrics,
  expandedMetric,
  onAvatarUpload,
  onShowMeasureModal,
  onToggleMetric,
  onEditMeasurement,
  onAddMeasurementEntry,
  onRenameMetric,
  setShowResetAccountModal,
  fileInputRef,
  devMode,
  onToggleDevMode,
  onToggleLanguage,
  syncStatus,
  lastSyncedAt,
  pushState,
  dataBusy,
  onSync,
  onExportData,
  onImportData,
  onOpenLibrary,
}) => {
  const { toast } = useUiOverlay();
  const isCn = lang === Language.CN;
  const { unit, appPrefs } = useUserSettingsContext();
  const [prefsOpen, setPrefsOpen] = useState(false);
  /** 改名弹窗：from 是原名，value 是输入框里的。关时只收 open，退场动画里名字不清空 */
  const [renaming, setRenaming] = useState({ open: false, from: '', value: '' });

  // 「杠铃片」阶段二：热力图镁粉点，口径和「按动作」同一个钩子
  const { workouts: doneWorkouts } = useDoneWorkouts();
  const lifts = useLiftSummaries(doneWorkouts);
  const prDays = useMemo(() => {
    const out = new Set<string>();
    for (const l of lifts) for (const s of l.sessions) if (s.records.length) out.add(localYmd(new Date(s.date)));
    return out;
  }, [lifts]);

  return (
    <div className="space-y-6 anim-tab-enter">
      {/* 身份只是页头，一行就够；累计训练跟它同行，不再单占一张卡 */}
      <div className="flex items-center gap-4">
        <div className="relative flex-shrink-0 cursor-pointer" onClick={() => fileInputRef.current?.click()}>
          <input type="file" ref={fileInputRef} onChange={onAvatarUpload} className="hidden" accept="image/*" />
          <div className="w-14 h-14 bg-accent rounded-full flex items-center justify-center overflow-hidden">
            {avatarUrl ? (
              <img src={avatarUrl} alt="Avatar" className="w-full h-full object-cover" />
            ) : (
              <span className="text-data-md font-display text-on-accent">
                {FITLOG_SOLO_USER.username.charAt(0).toUpperCase()}
              </span>
            )}
          </div>
          <div className="absolute -bottom-0.5 -right-0.5 bg-card text-secondary p-1 rounded-full ring-2 ring-base">
            <Camera size={10} />
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="font-display text-display-sm text-primary truncate">{FITLOG_SOLO_USER.username}</h2>
          <p className="text-label text-secondary truncate">{FITLOG_SOLO_USER.email}</p>
        </div>
        <div className="flex-shrink-0 text-right">
          {/* 一组都没做完的空场不算一场 */}
          <div className="font-mono text-data-md text-primary tabular-nums">{workouts.filter(hasDoneSets).length}</div>
          <div className="text-micro text-tertiary">{lang === Language.CN ? '累计训练' : 'Workouts'}</div>
        </div>
      </div>

      {/* Training Heatmap */}
      <div className="w-full bg-card border border-divider rounded-card p-5">
        {/* 「近3个月」那个角标去掉了：范围随展开/收起变化，写死会说谎；
            实际范围由热力图自己的摘要行报（§3：中文不 uppercase、不加字距）。 */}
        <div className="flex items-center gap-2 mb-3 px-1">
          <Activity size={13} className="text-accent" strokeWidth={1.75} />
          <h3 className="text-label font-medium text-secondary">
            {lang === Language.CN ? '训练活跃度' : 'Activity'}
          </h3>
        </div>
        
        <ActivityHeatmap
          days={heatmapData}
          lang={lang}
          prDays={prDays}
          onPickDay={day =>
            toast(
              lang === Language.CN
                ? `${day.date}：${day.sets} 组 · ${day.sessions} 场`
                : `${day.date}: ${day.sets} ${plural(day.sets, 'set')} · ${day.sessions} ${plural(
                    day.sessions,
                    'session',
                  )}`,
              'info',
            )
          }
        />
      </div>

      {/* Body Metrics Section */}
      <div className="space-y-4">
        <div className="flex justify-between items-center px-2">
          <h3 className="text-xs font-semibold text-secondary uppercase tracking-widest">
            {lang === Language.CN ? '身体指标' : 'Body metrics'}
          </h3>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {latestMetrics.map(metric => {
            const isExpanded = expandedMetric === metric.name;
            
            return (
              <div 
                key={metric.name} 
                className={`bg-card border border-divider rounded-card transition-ui duration-300 overflow-hidden cursor-pointer
                  ${isExpanded ? 'col-span-2 ring-1 ring-accent/60 bg-card-hover' : 'col-span-1 active:scale-press-sm hover:bg-card-hover'}`}
                onClick={() => onToggleMetric(isExpanded ? null : metric.name)}
              >
                <div className="p-4">
                  {/* Header */}
                  <div className="flex justify-between items-start mb-1">
                    <div className="flex items-center gap-2 overflow-hidden">
                      <Ruler size={14} className="text-accent flex-shrink-0" />
                      <span className="text-xs font-bold text-secondary truncate">{metric.name}</span>
                    </div>
                    {/* 记一条只有这一个入口：点开卡片 → 看到曲线 → 「记录 xx」。按钮写明记的是哪个指标；
                        收起的卡面上不放 ＋（光一个加号看不出它管什么），新记和改旧的也不在同一处 */}
                    {isExpanded && (
                    <div className="flex items-center gap-3 flex-shrink-0">
                      <button
                        type="button"
                        onClick={e => { e.stopPropagation(); onAddMeasurementEntry(metric.name); }}
                        className="tap-44 text-accent text-xs font-semibold flex items-center gap-1"
                        aria-label={lang === Language.CN ? `记录${metric.name}` : `Log ${metric.name}`}
                        data-testid="metric-add"
                      >
                        <Plus size={14} />
                        <span className="truncate max-w-[10rem]">
                          {lang === Language.CN ? `记录${metric.name}` : `Log ${metric.name}`}
                        </span>
                      </button>
                      <ChevronUp size={16} className="text-secondary" />
                    </div>
                    )}
                  </div>
                  
                  {/* Value */}
                  <div className="flex items-baseline gap-1 mt-1">
                    <span className="text-2xl font-semibold text-primary">{metric.value}</span>
                    <span className="text-micro font-bold text-tertiary uppercase tracking-wider">{metric.unit}</span>
                  </div>
                  <p className="text-micro font-normal text-tertiary mt-1">
                    {/* 不是今年的带年份（审查 C89） */}
                    {shortDate(new Date(metric.date).getTime(), isCn)}
                    {/* 比上一条的变化：卡面只有最新一条，带上它才看得出以前的还在 */}
                    {!!metric.delta && (
                      <span data-testid="metric-delta"> · {metric.delta > 0 ? '+' : '−'}{Math.abs(metric.delta)}</span>
                    )}
                  </p>

                  {/* Expanded Content */}
                  {isExpanded && (
                    <div className="mt-4 border-t border-divider pt-4" onClick={(e) => e.stopPropagation()}>
                      {/* Chart */}
                      <div className="mb-6">
                        {/* 图表代码是按需加载的：占位必须包在这里、和图一样高。不包的话第一次展开会冒到
                            整页那层 Suspense，整个标签页被换成加载占位再跳回来 */}
                        <Suspense fallback={<div className="h-[180px] mt-4" />}>
                          <MetricChart
                            metricName={metric.name}
                            measurements={measurements}
                            lang={lang}
                          />
                        </Suspense>
                      </div>

                      {/* History List */}
                      <div className="space-y-2 max-h-[200px] overflow-y-auto custom-scrollbar pr-1">
                        <h4 className="text-micro font-semibold text-secondary uppercase tracking-wider mb-3 flex items-center gap-2">
                          <History size={10} /> {lang === Language.CN ? '历史记录' : 'History'}
                        </h4>
                        {measurements
                          .filter(m => m.name === metric.name)
                          .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
                          .map((historyItem) => (
                            // 整行点开「修改记录」（值、日期、删除都在那里面）；行上不放删除键
                            <button
                              type="button"
                              key={historyItem.id}
                              onClick={() => onEditMeasurement(historyItem)}
                              className="w-full flex justify-between items-center text-left bg-inset/30 p-3 rounded-control border border-divider active:bg-card-hover transition-ui"
                              data-testid="metric-entry"
                            >
                              <div className="flex flex-col">
                                <span className="text-small font-bold text-primary">
                                  {historyItem.value} <span className="text-micro font-normal text-secondary uppercase tracking-wider">{historyItem.unit}</span>
                                </span>
                                <span className="text-micro font-normal text-tertiary">
                                  {new Date(historyItem.date).toLocaleDateString(lang === Language.CN ? 'zh-CN' : 'en-US', {
                                    // 补记能跨年：不是今年的带上年份
                                    year: new Date(historyItem.date).getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
                                    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                                  })}
                                </span>
                              </div>
                              <Edit2 size={12} className="text-tertiary flex-shrink-0" />
                            </button>
                          ))}
                      </div>
                      {/* 整项改名 / 并进另一项（输入已有的名字）：次要文字按钮，放在历史列表下面 */}
                      <button
                        type="button"
                        onClick={() => setRenaming({ open: true, from: metric.name, value: metric.name })}
                        className="tap-44 mt-3 text-xs font-semibold text-secondary"
                        data-testid="metric-rename"
                      >
                        {isCn ? '改名' : 'Rename'}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {/* Add New Metric Button */}
          <button 
            onClick={onShowMeasureModal} 
            className="bg-card border-2 border-dashed border-divider p-4 rounded-card flex flex-col items-center justify-center gap-2 hover:bg-card transition-ui min-h-[100px]"
          >
            <div className="p-2 bg-card rounded-control text-secondary">
              <Plus size={16} />
            </div>
            <span className="text-micro font-bold text-secondary">
              {lang === Language.CN ? '新指标' : 'New metric'}
            </span>
          </button>
        </div>
      </div>

      {/* 备份状态留在一级页面上：数据在哪、上次备份是什么时候，一眼能看到（docs/positioning.md） */}
      <RenameModal
        open={renaming.open}
        lang={lang}
        title={isCn ? '指标改名' : 'Rename metric'}
        placeholder={renaming.from}
        value={renaming.value}
        setValue={v => setRenaming(r => ({ ...r, value: v }))}
        onClose={() => setRenaming(r => ({ ...r, open: false }))}
        onConfirm={async () => {
          if (!renaming.open) return;
          setRenaming(r => ({ ...r, open: false }));
          await onRenameMetric(renaming.from, renaming.value);
        }}
      />

      <BackupGlance />

      {/* 首选项入口（原设置卡搬进了弹层）。右侧是当前值摘要，是状态不是说明 */}
      <div className="ui-card">
        <button
          type="button"
          onClick={() => setPrefsOpen(true)}
          className="w-full p-4 flex justify-between items-center gap-3 rounded-card active:bg-card-hover transition-colors duration-tap ease-paper"
          data-testid="prefs-entry"
        >
          <span className="font-bold text-primary whitespace-nowrap">{isCn ? '首选项' : 'Preferences'}</span>
          <span className="flex items-center gap-1.5 min-w-0 text-xs font-medium text-secondary">
            <span className="truncate">
              {`±${appPrefs.weightStep} ${unit} · ${isCn ? '递减' : 'drop'} −${appPrefs.dropStep} · ${isCn ? '中文' : 'English'}`}
            </span>
            <ChevronRight size={18} className="text-tertiary flex-shrink-0" />
          </span>
        </button>
      </div>

      <PrefsSheet
        open={prefsOpen}
        onClose={() => setPrefsOpen(false)}
        syncStatus={syncStatus}
        lastSyncedAt={lastSyncedAt}
        pushState={pushState}
        dataBusy={dataBusy}
        onSync={onSync}
        onExportData={onExportData}
        onImportData={onImportData}
        onOpenLibrary={() => {
          setPrefsOpen(false);
          onOpenLibrary();
        }}
        onToggleLanguage={onToggleLanguage}
        onResetAccount={() => setShowResetAccountModal(true)}
        devMode={devMode}
        onToggleDevMode={onToggleDevMode}
      />
    </div>
  );
};

export default ProfileTab;
