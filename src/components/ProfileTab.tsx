import React, { useRef } from 'react';
import CalendarHeatmap from 'react-calendar-heatmap';
import { 
  Camera, ShieldAlert, LogOut, Trash2, Globe, ChevronRight, 
  ChevronUp, Plus, Edit2, History, Ruler, Scale, Activity 
} from 'lucide-react';
import { User, WorkoutSession, Measurement, Language } from '../../types';
import { translations } from '../../translations';

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
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onAvatarUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onToggleLanguage: () => void;
  onLogout: () => void;
  onShowWeightInput: () => void;
  onShowMeasureModal: () => void;
  onToggleMetric: (metricName: string | null) => void;
  onEditMeasurement: (measurement: Measurement) => void;
  onDeleteMeasurement: (e: React.MouseEvent, id: string) => void;
  onAddMeasurementEntry: (name: string) => void;
  renderMetricChart: (metricName: string) => React.ReactNode;
  setShowResetAccountModal: (show: boolean) => void;
  onCreateAccount: () => void;
}

export const ProfileTab: React.FC<ProfileTabProps> = ({
  user,
  workouts,
  measurements,
  lang,
  heatmapData,
  latestMetrics,
  expandedMetric,
  fileInputRef,
  onAvatarUpload,
  onToggleLanguage,
  onLogout,
  onShowWeightInput,
  onShowMeasureModal,
  onToggleMetric,
  onEditMeasurement,
  onDeleteMeasurement,
  onAddMeasurementEntry,
  renderMetricChart,
  setShowResetAccountModal,
  onCreateAccount,
}) => {
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

  return (
    <div className="space-y-6 animate-in slide-in-from-bottom-5">
      {/* Profile Header */}
      <div className="flex flex-col items-center justify-center py-10 relative overflow-hidden">
        <div className="absolute inset-0 bg-blue-600/5 rounded-full blur-3xl scale-150" />

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
          
          <div className="w-28 h-28 bg-gradient-to-br from-blue-600 to-indigo-600 rounded-full flex items-center justify-center shadow-2xl shadow-blue-500/30 mb-6 border-4 border-slate-900 overflow-hidden relative">
            {user.avatarUrl ? (
              <img src={user.avatarUrl} alt="Avatar" className="w-full h-full object-cover" />
            ) : (
              <span className="text-4xl font-black text-white">
                {user.username?.charAt(0)?.toUpperCase() || 'U'}
              </span>
            )}
            
            {/* Hover Overlay */}
            <div className="absolute inset-0 bg-black/30 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
              <Camera className="text-white opacity-80" size={32} />
            </div>
          </div>

          {/* Camera Badge */}
          <div className="absolute bottom-6 right-0 bg-blue-500 text-white p-2 rounded-full border-4 border-slate-900 shadow-lg">
            <Camera size={16} />
          </div>
        </div>

        <h2 className="text-3xl font-black tracking-tight">{user.username}</h2>
        <p className="text-slate-500 font-medium mt-1">{user.email}</p>
      </div>

      {/* Training Heatmap */}
      <div className="w-full bg-slate-800/20 border border-slate-700/30 rounded-[2rem] p-5">
        <div className="flex justify-between items-center mb-4 px-1">
          <h3 className="text-xs font-black text-slate-500 uppercase tracking-widest flex items-center gap-2">
            <Activity size={12} className="text-blue-500" />
            {lang === Language.CN ? '训练活跃度' : 'Activity'}
          </h3>
          <span className="text-[10px] font-bold text-slate-600 bg-slate-800 px-2 py-1 rounded-lg">
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
              alert(`${value.date}: ${value.count} ${lang === Language.CN ? '场训练' : 'Workouts'}`);
            }}
          />
        </div>
      </div>

      {/* Guest Mode Warning */}
      {user.id === 'u_guest' && (
        <div className="mx-2 p-5 bg-amber-500/10 border border-amber-500/20 rounded-[2rem] flex items-start gap-4 animate-in slide-in-from-top-2">
          <div className="p-3 bg-amber-500/20 text-amber-500 rounded-2xl flex-shrink-0">
            <ShieldAlert size={24} />
          </div>
          <div className="flex flex-col gap-1">
            <h4 className="text-sm font-black text-amber-500 uppercase tracking-wide">
              {translations.guestWarningTitle[lang]}
            </h4>
            <p className="text-[11px] font-bold text-amber-200/70 leading-relaxed">
              {translations.guestWarningDesc[lang]}
            </p>
            <button 
              onClick={onCreateAccount}
              className="mt-2 text-[10px] font-black text-white bg-amber-600/40 hover:bg-amber-600/60 px-3 py-1.5 rounded-lg self-start transition-colors"
            >
              {translations.createAccount[lang]}
            </button>
          </div>
        </div>
      )}

      {/* Stats Overview */}
      <div className="w-full">
        <div className="bg-slate-800/40 p-6 rounded-[2rem] border border-slate-700/50 flex flex-col items-center justify-center gap-2 w-full">
          <span className="text-3xl font-black text-white">{workouts.length}</span>
          <span className="text-[10px] font-black uppercase text-slate-500 tracking-widest">
            {lang === Language.CN ? '累计训练' : 'Workouts'}
          </span>
        </div>
      </div>

      {/* Log Weight Button */}
      <button 
        onClick={onShowWeightInput} 
        className="w-full bg-slate-800 border border-slate-700/50 p-5 rounded-[2rem] flex items-center justify-between group active:scale-95 transition-all shadow-lg"
      >
        <div className="flex items-center gap-4">
          <div className="p-4 bg-indigo-500/20 text-indigo-400 rounded-2xl group-hover:bg-indigo-500 group-hover:text-white transition-colors">
            <Scale size={24} />
          </div>
          <div className="text-left">
            <h3 className="font-black text-xl text-white">{translations.logWeight[lang]}</h3>
            <p className="text-xs text-slate-500 font-bold uppercase tracking-wider">
              {lang === Language.CN ? '记录当前数据' : 'Track Progress'}
            </p>
          </div>
        </div>
        <div className="bg-slate-900 p-3 rounded-full text-slate-500 group-hover:text-indigo-400 transition-colors">
          <Plus size={20} />
        </div>
      </button>

      {/* Body Metrics Section */}
      <div className="space-y-4">
        <div className="flex justify-between items-center px-2">
          <h3 className="text-xs font-black text-slate-500 uppercase tracking-widest">
            {lang === Language.CN ? '身体数据 & 指标' : 'Body Metrics'}
          </h3>
          <button 
            onClick={onShowMeasureModal} 
            className="text-blue-500 text-xs font-black flex items-center gap-1 hover:text-blue-400"
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
                className={`bg-slate-800/40 border border-slate-700/50 rounded-[1.5rem] transition-all duration-300 overflow-hidden cursor-pointer
                  ${isExpanded ? 'col-span-2 ring-1 ring-indigo-500/30 bg-slate-800/60' : 'col-span-1 active:scale-95 hover:bg-slate-800/60'}`}
                onClick={() => onToggleMetric(isExpanded ? null : metric.name)}
              >
                <div className="p-4">
                  {/* Header */}
                  <div className="flex justify-between items-start mb-1">
                    <div className="flex items-center gap-2 overflow-hidden">
                      <Ruler size={14} className="text-indigo-500 flex-shrink-0" />
                      <span className="text-xs font-bold text-slate-400 truncate">{metric.name}</span>
                    </div>
                    {isExpanded && <ChevronUp size={16} className="text-slate-500" />}
                  </div>
                  
                  {/* Value */}
                  <div className="flex items-baseline gap-1 mt-1">
                    <span className="text-2xl font-black text-white">{metric.value}</span>
                    <span className="text-[10px] font-bold text-slate-600 uppercase">{metric.unit}</span>
                  </div>
                  <p className="text-[9px] text-slate-600 mt-1">
                    {new Date(metric.date).toLocaleDateString(lang === Language.CN ? 'zh-CN' : 'en-US', { month: 'short', day: 'numeric' })}
                  </p>

                  {/* Expanded Content */}
                  {isExpanded && (
                    <div className="mt-4 border-t border-slate-700/30 pt-4" onClick={(e) => e.stopPropagation()}>
                      {/* Chart */}
                      <div className="mb-6">
                        {renderMetricChart(metric.name)}
                      </div>

                      {/* History List */}
                      <div className="mb-6 space-y-2 max-h-[200px] overflow-y-auto custom-scrollbar pr-1">
                        <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-wider mb-3 flex items-center gap-2">
                          <History size={10} /> {lang === Language.CN ? '历史记录' : 'History'}
                        </h4>
                        {measurements
                          .filter(m => m.name === metric.name)
                          .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
                          .map((historyItem) => (
                            <div key={historyItem.id} className="flex justify-between items-center bg-slate-900/30 p-3 rounded-xl border border-slate-700/30 group">
                              <div className="flex items-center gap-3">
                                <div className="flex flex-col">
                                  <span className="text-sm font-bold text-slate-200">
                                    {historyItem.value} <span className="text-[10px] text-slate-500 uppercase">{historyItem.unit}</span>
                                  </span>
                                  <span className="text-[9px] text-slate-600">
                                    {new Date(historyItem.date).toLocaleDateString(lang === Language.CN ? 'zh-CN' : 'en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                  </span>
                                </div>
                              </div>
                              
                              {/* Action Buttons */}
                              <div className="flex gap-2">
                                <button 
                                  onClick={(e) => { e.stopPropagation(); onEditMeasurement(historyItem); }} 
                                  className="p-2 bg-indigo-500/10 text-indigo-400 rounded-lg hover:bg-indigo-500/20 active:scale-90 transition-all"
                                >
                                  <Edit2 size={12} />
                                </button>
                                <button 
                                  onClick={(e) => onDeleteMeasurement(e, historyItem.id)} 
                                  className="p-2 bg-red-500/10 text-red-500 rounded-lg hover:bg-red-500/20 active:scale-90 transition-all"
                                >
                                  <Trash2 size={12} />
                                </button>
                              </div>
                            </div>
                          ))}
                      </div>
                      
                      {/* Add Entry Button */}
                      <div className="flex justify-end pt-2 border-t border-slate-700/30">
                        <button 
                          onClick={() => onAddMeasurementEntry(metric.name)} 
                          className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 rounded-2xl text-xs font-bold text-white shadow-lg shadow-indigo-600/20 active:scale-95 transition-all"
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
            className="bg-slate-800/20 border-2 border-dashed border-slate-700/50 p-4 rounded-[1.5rem] flex flex-col items-center justify-center gap-2 hover:bg-slate-800/40 transition-all min-h-[100px]"
          >
            <div className="p-2 bg-slate-800 rounded-full text-slate-500">
              <Plus size={16} />
            </div>
            <span className="text-[10px] font-bold text-slate-500">
              {lang === Language.CN ? '新指标' : 'New Metric'}
            </span>
          </button>
        </div>
      </div>

      {/* Settings List */}
      <div className="bg-slate-800/30 border border-slate-700/30 rounded-[2.5rem] p-6 space-y-2">
        {/* Language Toggle */}
        <button 
          onClick={onToggleLanguage} 
          className="w-full p-4 flex justify-between items-center rounded-2xl hover:bg-slate-700/50 transition-colors"
        >
          <div className="flex items-center gap-4">
            <div className="p-3 bg-blue-500/10 text-blue-500 rounded-xl">
              <Globe size={20} />
            </div>
            <span className="font-bold text-slate-200">{translations.languageLabel[lang]}</span>
          </div>
          <span className="font-black text-slate-500 text-sm px-3 py-1 bg-slate-800 rounded-lg">
            {lang === Language.CN ? '中文' : 'EN'}
          </span>
        </button>

        {/* Logout */}
        <button 
          onClick={onLogout} 
          className="w-full p-4 flex justify-between items-center rounded-2xl hover:bg-red-500/10 transition-colors group mt-4 border-t border-slate-700/50"
        >
          <div className="flex items-center gap-4">
            <div className="p-3 bg-red-500/10 text-red-500 rounded-xl group-hover:bg-red-500 group-hover:text-white transition-colors">
              <LogOut size={20} />
            </div>
            <span className="font-bold text-red-500 group-hover:text-red-400 transition-colors">
              {translations.logout[lang]}
            </span>
          </div>
          <ChevronRight size={18} className="text-slate-600" />
        </button>

        {/* Reset Account */}
        <button 
          onClick={() => setShowResetAccountModal(true)} 
          className="w-full p-4 flex justify-between items-center rounded-2xl hover:bg-red-500/10 transition-colors group border-t border-slate-700/50"
        >
          <div className="flex items-center gap-4">
            <div className="p-3 bg-red-500/10 text-red-500 rounded-xl group-hover:bg-red-500 group-hover:text-white transition-colors">
              <Trash2 size={20} />
            </div>
            <span className="font-bold text-red-500 group-hover:text-red-400 transition-colors">
              {translations.resetAccount[lang]}
            </span>
          </div>
          <ChevronRight size={18} className="text-slate-600" />
        </button>
      </div>
    </div>
  );
};

export default ProfileTab;
