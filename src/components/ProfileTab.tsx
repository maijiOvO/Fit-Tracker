import React, { useRef, lazy } from 'react';
import CalendarHeatmap from 'react-calendar-heatmap';
import { 
  Camera, ShieldAlert, LogOut, Trash2, Globe, ChevronRight, 
  ChevronUp, Plus, Edit2, History, Ruler, Scale, Activity, Sun, Moon, Smartphone,
  Beaker,
} from 'lucide-react';
import { markPrefsUpdated } from '../../services/fitlogRemote';
import { scheduleDebouncedFitlogPush } from '../../services/fitlogSyncScheduler';
import { useTheme, ThemePreference } from '../hooks/useTheme';
import { User, WorkoutSession, Measurement, Language } from '../../types';
import { translations } from '../../translations';
import { db } from '../../services/db';
import { useUiOverlay } from '../contexts/UiOverlayContext';
import { storage } from '../../services/appStorage';

// 懒加载 MetricChart（包含 recharts）
const MetricChart = lazy(() => import('./LazyCharts').then(m => ({ default: m.MetricChart })));

interface HeatmapValue {
  date: string;
  count: number;
}

interface ProfileTabProps {
  user: User;
  workouts: WorkoutSession[];
  measurements: Measurement[];
  lang: Language;
  heatmapData: HeatmapValue[];
  latestMetrics: Array<{ name: string; value: string; unit: string; date: string }>;
  expandedMetric: string | null;
  onAvatarUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onToggleLanguage: () => void;
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
  onToggleLanguage,
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
}) => {
  const { toast } = useUiOverlay();
  const monthLabels: Record<string, { cn: string; en: string }> = {
    'Jan': { cn: '1月', en: 'Jan' },
    'Feb': { cn: '2月', en: 'Feb' },
    'Mar': { cn: '3月', en: 'Mar' },
    'Apr': { cn: '4月', en: 'Apr' },
    'May': { cn: '5月', en: 'May' },
    'Jun': { cn: '6月', en: 'Jun' },
    'Jul': { cn: '7月', en: 'Jul' },
    'Aug': { cn: '8月', en: 'Aug' },
    'Sep': { cn: '9月', en: 'Sep' },
    'Oct': { cn: '10月', en: 'Oct' },
    'Nov': { cn: '11月', en: 'Nov' },
    'Dec': { cn: '12月', en: 'Dec' },
  };

  const weekdayLabels = lang === Language.CN 
    ? ['', '一', '', '三', '', '五', ''] 
    : ['', 'Mon', '', 'Wed', '', 'Fri', ''];

  const { preference, setPreference } = useTheme();
  const themeOptions: { id: ThemePreference; icon: React.ReactNode; label: string }[] = [
    { id: 'auto', icon: <Smartphone size={18} strokeWidth={1.75} />, label: lang === Language.CN ? '跟随系统' : 'System' },
    { id: 'light', icon: <Sun size={18} strokeWidth={1.75} />, label: lang === Language.CN ? '浅色' : 'Light' },
    { id: 'dark', icon: <Moon size={18} strokeWidth={1.75} />, label: lang === Language.CN ? '深色' : 'Dark' },
  ];

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Profile Header */}
      <div className="flex flex-col items-center justify-center py-10 relative overflow-hidden">
        <div className="absolute inset-0 bg-accent/5 rounded-full blur-3xl scale-150" />

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
        <div className="flex justify-between items-center mb-4 px-1">
          <h3 className="text-xs font-semibold text-secondary uppercase tracking-widest flex items-center gap-2">
            <Activity size={12} className="text-accent" />
            {lang === Language.CN ? '训练活跃度' : 'Activity'}
          </h3>
          <span className="text-[10px] font-bold text-tertiary bg-card px-2 py-1 rounded-lg">
            {lang === Language.CN ? '近3个月' : 'Last 90 Days'}
          </span>
        </div>
        
        <div className="w-full pt-8 pb-4"> 
          <CalendarHeatmap
            startDate={new Date(new Date().setDate(new Date().getDate() - 100))}
            endDate={new Date()}
            values={heatmapData}
            classForValue={(value) => {
              if (!value || value.count === 0) return 'color-empty';
              return `color-scale-${Math.min(value.count, 4)}`;
            }}
            showMonthLabels={true}
            transformMonthLabels={(month) => {
              return monthLabels[month as keyof typeof monthLabels]?.[lang === Language.CN ? 'cn' : 'en'] || month;
            }}
            showWeekdayLabels={true}
            weekdayLabels={weekdayLabels}
            gutterSize={4}
            onClick={value => {
              if (!value) return;
              toast(
                `${value.date}: ${value.count} ${lang === Language.CN ? '场训练' : 'Workouts'}`,
                'info',
              );
            }}
          />
        </div>
      </div>

      {/* Guest Mode Warning */}
      {user.id === 'u_guest' && (
        <div className="mx-2 p-5 bg-warning/10 border border-warning/20 rounded-card flex items-start gap-4 anim-reveal">
          <div className="p-3 bg-warning/20 text-warning rounded-2xl flex-shrink-0">
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
                className="mt-2 text-[10px] font-semibold text-primary bg-warning/40 hover:bg-warning/60 px-3 py-1.5 rounded-lg self-start transition-colors"
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
          <span className="text-3xl font-semibold text-primary">{workouts.length}</span>
          <span className="text-[10px] font-semibold uppercase text-secondary tracking-widest">
            {lang === Language.CN ? '累计训练' : 'Workouts'}
          </span>
        </div>
      </div>

      {/* Log Weight Button */}
      <button 
        onClick={onShowWeightInput} 
        className="w-full bg-card border border-divider p-5 rounded-card flex items-center justify-between group active:scale-95 transition-all shadow-lg"
      >
        <div className="flex items-center gap-4">
          <div className="p-4 bg-accent/20 text-accent rounded-2xl group-hover:bg-accent group-hover:text-primary transition-colors">
            <Scale size={24} />
          </div>
          <div className="text-left">
            <h3 className="font-semibold text-xl text-primary">{translations.logWeight[lang]}</h3>
            <p className="text-xs text-secondary font-bold uppercase tracking-wider">
              {lang === Language.CN ? '记录当前数据' : 'Track Progress'}
            </p>
          </div>
        </div>
        <div className="bg-inset p-3 rounded-full text-secondary group-hover:text-accent transition-colors">
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
                className={`bg-card border border-divider rounded-card transition-all duration-300 overflow-hidden cursor-pointer
                  ${isExpanded ? 'col-span-2 ring-1 ring-accent/25 bg-card-hover' : 'col-span-1 active:scale-95 hover:bg-card-hover'}`}
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
                            <div key={historyItem.id} className="flex justify-between items-center bg-inset/30 p-3 rounded-xl border border-divider group">
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
                                  className="p-2 bg-accent/10 text-accent rounded-lg hover:bg-accent/20 active:scale-90 transition-all"
                                >
                                  <Edit2 size={12} />
                                </button>
                                <button 
                                  onClick={(e) => onDeleteMeasurement(e, historyItem.id)} 
                                  className="p-2 bg-danger/10 text-danger rounded-lg hover:bg-danger/20 active:scale-90 transition-all"
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
                          className="ui-btn-primary flex items-center gap-2 text-xs active:scale-95"
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
            className="bg-card border-2 border-dashed border-divider p-4 rounded-card flex flex-col items-center justify-center gap-2 hover:bg-card transition-all min-h-[100px]"
          >
            <div className="p-2 bg-card rounded-full text-secondary">
              <Plus size={16} />
            </div>
            <span className="text-[10px] font-bold text-secondary">
              {lang === Language.CN ? '新指标' : 'New Metric'}
            </span>
          </button>
        </div>
      </div>

      {/* Settings List */}
      <div className="ui-card p-5 space-y-4">
        {/* Theme */}
        <div className="space-y-2">
          <p className="ui-section-label px-1">
            {lang === Language.CN ? '外观' : 'Appearance'}
          </p>
          <div className="grid grid-cols-3 gap-2 p-1 bg-inset rounded-control border border-divider">
            {themeOptions.map(opt => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setPreference(opt.id)}
                className={`flex flex-col items-center gap-1 py-2.5 rounded-chip text-xs font-medium transition-colors ${
                  preference === opt.id
                    ? 'bg-accent text-on-accent'
                    : 'text-secondary hover:text-primary hover:bg-card-hover'
                }`}
              >
                {opt.icon}
                <span>{opt.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Language Toggle */}
        <button 
          onClick={onToggleLanguage} 
          className="w-full p-4 flex justify-between items-center rounded-control hover:bg-inset transition-colors"
        >
          <div className="flex items-center gap-4">
            <div className="p-3 bg-accent/10 text-accent rounded-xl">
              <Globe size={20} />
            </div>
            <span className="font-bold text-primary">{translations.languageLabel[lang]}</span>
          </div>
          <span className="font-semibold text-secondary text-sm px-3 py-1 bg-card rounded-lg">
            {lang === Language.CN ? '中文' : 'EN'}
          </span>
        </button>

        {/* Logout（单机版可省略） */}
        {onLogout && (
          <button
            onClick={onLogout}
            className="w-full p-4 flex justify-between items-center rounded-2xl hover:bg-danger/10 transition-colors group mt-4 border-t border-divider"
          >
            <div className="flex items-center gap-4">
              <div className="p-3 bg-danger/10 text-danger rounded-xl group-hover:opacity-90 group-hover:text-primary transition-colors">
                <LogOut size={20} />
              </div>
              <span className="font-bold text-danger group-hover:text-danger transition-colors">
                {translations.logout[lang]}
              </span>
            </div>
            <ChevronRight size={18} className="text-tertiary" />
          </button>
        )}

        {/* Reset Account */}
        <button 
          onClick={() => setShowResetAccountModal(true)} 
          className="w-full p-4 flex justify-between items-center rounded-2xl hover:bg-danger/10 transition-colors group border-t border-divider"
        >
          <div className="flex items-center gap-4">
            <div className="p-3 bg-danger/10 text-danger rounded-xl group-hover:opacity-90 group-hover:text-primary transition-colors">
              <Trash2 size={20} />
            </div>
            <span className="font-bold text-danger group-hover:text-danger transition-colors">
              {translations.resetAccount[lang]}
            </span>
          </div>
          <ChevronRight size={18} className="text-tertiary" />
        </button>

        {/* 数据环境切换（仅未锁定的构建可见：手机 APK / release 包永远不渲染） */}
        {onToggleDevMode && (
          <button
            onClick={onToggleDevMode}
            className="w-full p-4 flex justify-between items-center rounded-2xl transition-colors group border-t border-divider"
          >
            <div className="flex items-center gap-4">
              <div className={`p-3 rounded-xl transition-colors ${
                devMode ? 'bg-warning/10 text-warning' : 'bg-card text-secondary'
              }`}>
                <Beaker size={20} strokeWidth={1.75} />
              </div>
              <div className="text-left">
                <span className="font-bold text-primary text-sm">
                  {lang === Language.CN ? '数据环境' : 'Data Environment'}
                </span>
                <p className="text-[10px] text-tertiary mt-0.5">
                  {devMode
                    ? (lang === Language.CN
                        ? 'state-dev · FitLogDB-dev · 与真实数据完全隔离'
                        : 'state-dev · FitLogDB-dev · fully isolated')
                    : (lang === Language.CN
                        ? 'state · FitLogDB · 真实用户数据'
                        : 'state · FitLogDB · real user data')}
                </p>
              </div>
            </div>
            <span className={`text-xs font-semibold px-3 py-1 rounded-lg shrink-0 ${
              devMode ? 'bg-warning/15 text-warning' : 'bg-card text-secondary'
            }`}>
              {devMode ? (lang === Language.CN ? '开发' : 'Dev') : (lang === Language.CN ? '用户' : 'User')}
            </span>
          </button>
        )}
      </div>
    </div>
  );
};

export default ProfileTab;
