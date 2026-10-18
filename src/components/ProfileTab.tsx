import React, { useRef, useState, lazy } from 'react';
import { ActivityHeatmap, HeatmapDay } from './ActivityHeatmap';
import {
  Camera, ShieldAlert, Trash2, ChevronRight,
  ChevronUp, Plus, Edit2, History, Ruler, Scale, Activity,
} from 'lucide-react';
import { PrefsSheet } from './PrefsSheet';
import type { SyncStatus } from '../hooks/useFitlogSync';
import { useUserSettingsContext } from '../contexts/UserSettingsContext';
import { User, WorkoutSession, Measurement, Language } from '../../types';
import { hasDoneSets } from '../contexts/WorkoutContext';
import { translations } from '../../translations';
import { db } from '../../services/db';
import { useUiOverlay } from '../contexts/UiOverlayContext';
import { storage } from '../../services/appStorage';
import { plural } from '../utils/format';

// 懒加载 MetricChart（包含 recharts）
const MetricChart = lazy(() => import('./LazyCharts').then(m => ({ default: m.MetricChart })));

type HeatmapValue = HeatmapDay;

interface ProfileTabProps {
  user: User;
  workouts: WorkoutSession[];
  measurements: Measurement[];
  lang: Language;
  heatmapData: HeatmapValue[];
  latestMetrics: Array<{ name: string; value: string; unit: string; date: string }>;
  expandedMetric: string | null;
  onAvatarUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onLogout?: () => void;
  onShowWeightInput: () => void;
  onShowMeasureModal: () => void;
  onToggleMetric: (metricName: string | null) => void;
  onEditMeasurement: (measurement: Measurement) => void;
  onDeleteMeasurement: (e: React.MouseEvent, id: string) => void;
  onAddMeasurementEntry: (name: string) => void;
  setShowResetAccountModal: (show: boolean) => void;
  onCreateAccount?: () => void;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  /** 开发模式隔离开关，仅开发机可见 */
  devMode?: boolean;
  onToggleDevMode?: () => void;
  onToggleLanguage: () => void;
  /** 首选项「数据」组 */
  syncStatus: SyncStatus;
  lastSyncedAt: number | null;
  onSync?: () => void;
  onExportData: () => void;
  onImportData: () => void;
  /** 首选项「动作库与标签 ›」：打开只管动作库的弹层（整理态） */
  onOpenLibrary: () => void;
}

export const ProfileTab: React.FC<ProfileTabProps> = ({
  user,
  workouts,
  measurements,
  lang,
  heatmapData,
  latestMetrics,
  expandedMetric,
  onAvatarUpload,
  onLogout,
  onShowWeightInput,
  onShowMeasureModal,
  onToggleMetric,
  onEditMeasurement,
  onDeleteMeasurement,
  onAddMeasurementEntry,
  setShowResetAccountModal,
  onCreateAccount,
  fileInputRef,
  devMode,
  onToggleDevMode,
  onToggleLanguage,
  syncStatus,
  lastSyncedAt,
  onSync,
  onExportData,
  onImportData,
  onOpenLibrary,
}) => {
  const { toast } = useUiOverlay();
  const isCn = lang === Language.CN;
  const { unit, appPrefs } = useUserSettingsContext();
  const [prefsOpen, setPrefsOpen] = useState(false);

  return (
    <div className="space-y-6 anim-tab-enter">
      {/* Profile Header */}
      <div className="flex flex-col items-center justify-center py-10 relative overflow-hidden">
        <div className="absolute inset-0 bg-accent/5 rounded-control blur-3xl scale-150" />

        {/* Avatar Container */}
        <div 
          className="relative group cursor-pointer" 
          onClick={() => fileInputRef.current?.click()}
        >
          <input 
            type="file" 
            ref={fileInputRef} 
            onChange={onAvatarUpload} 
            className="hidden" 
            accept="image/*"
          />
          
          <div className="w-28 h-28 bg-accent rounded-full flex items-center justify-center shadow-elevated mb-6 ring-4 ring-base overflow-hidden relative">
            {user.avatarUrl ? (
              <img src={user.avatarUrl} alt="Avatar" className="w-full h-full object-cover" />
            ) : (
              <span className="text-4xl font-display font-semibold text-on-accent">
                {user.username?.charAt(0)?.toUpperCase() || 'U'}
              </span>
            )}
            
            <div className="absolute inset-0 bg-black/25 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
              <Camera className="text-on-accent" size={28} strokeWidth={1.75} />
            </div>
          </div>

          <div className="absolute bottom-6 right-0 bg-accent text-on-accent p-2 rounded-full ring-4 ring-base shadow-elevated">
            <Camera size={16} />
          </div>
        </div>

        <h2 className="font-display text-display-sm text-primary">{user.username}</h2>
        <p className="text-secondary font-medium mt-1">{user.email}</p>
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

      {/* Guest Mode Warning */}
      {user.id === 'u_guest' && (
        <div className="mx-2 p-5 bg-warning/10 border border-warning/20 rounded-card flex items-start gap-4 anim-reveal">
          <div className="p-3 bg-warning/20 text-warning rounded-card flex-shrink-0">
            <ShieldAlert size={24} />
          </div>
          <div className="flex flex-col gap-1">
            <h4 className="text-sm font-semibold text-warning uppercase tracking-wide">
              {translations.guestWarningTitle[lang]}
            </h4>
            <p className="text-[11px] font-bold text-warning leading-relaxed">
              {translations.guestWarningDesc[lang]}
            </p>
            {onCreateAccount && (
              <button
                onClick={onCreateAccount}
                className="mt-2 text-[10px] font-semibold text-primary bg-warning/40 hover:bg-warning/60 px-3 py-1.5 rounded-chip self-start transition-colors"
              >
                {translations.createAccount[lang]}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Stats Overview */}
      <div className="w-full">
        <div className="bg-card p-6 rounded-card border border-divider flex flex-col items-center justify-center gap-2 w-full">
          {/* 一组都没做完的空场不算一场 */}
          <span className="text-3xl font-semibold text-primary">{workouts.filter(hasDoneSets).length}</span>
          <span className="text-[10px] font-semibold uppercase text-secondary tracking-widest">
            {lang === Language.CN ? '累计训练' : 'Workouts'}
          </span>
        </div>
      </div>

      {/* Log Weight Button */}
      <button 
        onClick={onShowWeightInput} 
        className="w-full bg-card border border-divider p-5 rounded-card flex items-center justify-between group active:scale-press-sm transition-ui shadow-lg"
      >
        <div className="flex items-center gap-4">
          <div className="p-4 bg-accent/20 text-accent rounded-card group-hover:bg-accent group-hover:text-on-accent transition-colors">
            <Scale size={24} />
          </div>
          <div className="text-left">
            <h3 className="font-semibold text-xl text-primary">{translations.logWeight[lang]}</h3>
            <p className="text-xs text-secondary font-bold uppercase tracking-wider">
              {lang === Language.CN ? '记录当前数据' : 'Track Progress'}
            </p>
          </div>
        </div>
        <div className="bg-inset p-3 rounded-control text-secondary group-hover:text-accent transition-colors">
          <Plus size={20} />
        </div>
      </button>

      {/* Body Metrics Section */}
      <div className="space-y-4">
        <div className="flex justify-between items-center px-2">
          <h3 className="text-xs font-semibold text-secondary uppercase tracking-widest">
            {lang === Language.CN ? '身体数据 & 指标' : 'Body Metrics'}
          </h3>
          <button 
            onClick={onShowMeasureModal} 
            className="text-accent text-xs font-semibold flex items-center gap-1 hover:text-accent"
          >
            <Plus size={14} /> {lang === Language.CN ? '添加' : 'Add'}
          </button>
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
                    {isExpanded && <ChevronUp size={16} className="text-secondary" />}
                  </div>
                  
                  {/* Value */}
                  <div className="flex items-baseline gap-1 mt-1">
                    <span className="text-2xl font-semibold text-primary">{metric.value}</span>
                    <span className="text-[10px] font-bold text-tertiary uppercase">{metric.unit}</span>
                  </div>
                  <p className="text-[9px] text-tertiary mt-1">
                    {new Date(metric.date).toLocaleDateString(lang === Language.CN ? 'zh-CN' : 'en-US', { month: 'short', day: 'numeric' })}
                  </p>

                  {/* Expanded Content */}
                  {isExpanded && (
                    <div className="mt-4 border-t border-divider pt-4" onClick={(e) => e.stopPropagation()}>
                      {/* Chart */}
                      <div className="mb-6">
                        <MetricChart
                          metricName={metric.name}
                          measurements={measurements}
                          lang={lang}
                        />
                      </div>

                      {/* History List */}
                      <div className="mb-6 space-y-2 max-h-[200px] overflow-y-auto custom-scrollbar pr-1">
                        <h4 className="text-[10px] font-semibold text-secondary uppercase tracking-wider mb-3 flex items-center gap-2">
                          <History size={10} /> {lang === Language.CN ? '历史记录' : 'History'}
                        </h4>
                        {measurements
                          .filter(m => m.name === metric.name)
                          .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
                          .map((historyItem) => (
                            <div key={historyItem.id} className="flex justify-between items-center bg-inset/30 p-3 rounded-control border border-divider group">
                              <div className="flex items-center gap-3">
                                <div className="flex flex-col">
                                  <span className="text-sm font-bold text-primary">
                                    {historyItem.value} <span className="text-[10px] text-secondary uppercase">{historyItem.unit}</span>
                                  </span>
                                  <span className="text-[9px] text-tertiary">
                                    {new Date(historyItem.date).toLocaleDateString(lang === Language.CN ? 'zh-CN' : 'en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                  </span>
                                </div>
                              </div>
                              
                              {/* Action Buttons */}
                              <div className="flex gap-2">
                                <button 
                                  onClick={(e) => { e.stopPropagation(); onEditMeasurement(historyItem); }} 
                                  className="p-2 bg-accent/10 text-accent rounded-chip hover:bg-accent/20 active:scale-press-sm transition-ui"
                                >
                                  <Edit2 size={12} />
                                </button>
                                <button 
                                  onClick={(e) => onDeleteMeasurement(e, historyItem.id)} 
                                  className="p-2 bg-danger/10 text-danger rounded-chip hover:bg-danger/20 active:scale-press-sm transition-ui"
                                >
                                  <Trash2 size={12} />
                                </button>
                              </div>
                            </div>
                          ))}
                      </div>
                      
                      {/* Add Entry Button */}
                      <div className="flex justify-end pt-2 border-t border-divider">
                        <button 
                          onClick={() => onAddMeasurementEntry(metric.name)} 
                          className="ui-btn-primary flex items-center gap-2 text-xs active:scale-press-sm"
                        >
                          <Plus size={14} />
                          {lang === Language.CN ? '记录新数据' : 'Add Entry'}
                        </button>
                      </div>
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
            <span className="text-[10px] font-bold text-secondary">
              {lang === Language.CN ? '新指标' : 'New Metric'}
            </span>
          </button>
        </div>
      </div>

      {/* 首选项入口（原设置卡和时间线底部的备份卡都搬进了弹层）。右侧是当前值摘要，是状态不是说明 */}
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
        onSync={onSync}
        onExportData={onExportData}
        onImportData={onImportData}
        onOpenLibrary={() => {
          setPrefsOpen(false);
          onOpenLibrary();
        }}
        onToggleLanguage={onToggleLanguage}
        onResetAccount={() => setShowResetAccountModal(true)}
        onLogout={onLogout}
        devMode={devMode}
        onToggleDevMode={onToggleDevMode}
      />
    </div>
  );
};

export default ProfileTab;
