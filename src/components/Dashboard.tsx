import React, { lazy } from 'react';
import { 
  Trophy, PlusCircle, Plus, Trash2, Edit2, Star, Calendar,
  Scale, TrendingUp, History, ChevronDown, ChevronUp, Cloud,
  Download
} from 'lucide-react';
import { Language } from '../../types';
import { translations } from '../../translations';
import { formatWeight } from '../../src/utils/format';
import { WorkoutSession, WeightEntry, Exercise } from '../../types';

// 懒加载 TrendChart（包含 recharts）
const TrendChart = lazy(() => import('./LazyCharts').then(m => ({ default: m.TrendChart })));

interface DashboardProps {
  // 数据
  lang: Language;
  workouts: WorkoutSession[];
  weightEntries: WeightEntry[];
  bestLifts: Array<{ name: string; key: string; weight: number }>;
  starredExercises: Record<string, number>;
  
  // 状态
  selectedPRProject: string | null;
  chartMetricPreference: Record<string, string>;
  unit: 'kg' | 'lbs';
  isHistoryVisible: boolean;
  
  // 动作
  setSelectedPRProject: (key: string | null) => void;
  setChartMetricPreference: (pref: Record<string, string>) => void;
  setIsHistoryVisible: (visible: boolean) => void;
  toggleStarExercise: (key: string) => void;
  handleEditWorkout: (workoutId: string) => void;
  handleDeleteExerciseRecord: (e: React.MouseEvent, workoutId: string, exerciseId: string, exerciseName: string, date: string) => void;
  handleDeleteWeightEntry: (e: React.MouseEvent, id: string) => void;
  triggerEditWeight: (entry: WeightEntry) => void;
  setShowWeightInput: (show: boolean) => void;
  setEditingWeightId: (id: string | null) => void;
  setWeightInputValue: (value: string) => void;
  handleExportData: () => void;
  onStartNewWorkout: () => void;
  
  // 图表工具函数
  getActiveMetrics: (name: string) => string[];
  getChartMetric: (name: string) => string;
  resolveName: (name: string) => string;
  formatExerciseTime: (time: string, lang: string) => { date: string; time: string };
  updateExerciseTime: (workoutId: string, exerciseId: string, newTime: string) => Promise<void>;
  renderSetCapsule: (s: any, exerciseName: string, exercise?: Exercise) => React.ReactNode;
}

const Dashboard: React.FC<DashboardProps> = ({
  lang,
  workouts,
  weightEntries,
  bestLifts,
  starredExercises,
  selectedPRProject,
  chartMetricPreference,
  unit,
  isHistoryVisible,
  setSelectedPRProject,
  setChartMetricPreference,
  setIsHistoryVisible,
  toggleStarExercise,
  handleEditWorkout,
  handleDeleteExerciseRecord,
  handleDeleteWeightEntry,
  triggerEditWeight,
  setShowWeightInput,
  setEditingWeightId,
  setWeightInputValue,
  handleExportData,
  onStartNewWorkout,
  getActiveMetrics,
  getChartMetric,
  resolveName,
  formatExerciseTime,
  updateExerciseTime,
  renderSetCapsule
}) => {
  // 空状态
  if (workouts.length === 0 && weightEntries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center p-6 animate-in slide-in-from-bottom-10">
        <div className="bg-blue-600/10 p-10 rounded-full border border-blue-500/20 mb-8 animate-pulse shadow-2xl shadow-blue-500/10">
          <Trophy size={80} className="text-blue-500" />
        </div>
        <h2 className="text-3xl font-black mb-4 bg-gradient-to-r from-blue-400 to-indigo-400 bg-clip-text text-transparent">
          {translations.dashboardEmptyTitle[lang]}
        </h2>
        <p className="text-slate-400 max-w-sm font-medium leading-relaxed text-lg mb-10">
          {translations.dashboardEmptyDesc[lang]}
        </p>
        <div className="flex flex-col sm:flex-row gap-4">
          <button onClick={onStartNewWorkout} className="group bg-blue-600 px-10 py-5 rounded-[2rem] font-black text-xl shadow-xl shadow-blue-600/30 active:scale-95 transition-all flex items-center gap-3">
            <PlusCircle size={24} className="group-hover:rotate-90 transition-transform" />
            {translations.newWorkout[lang]}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 体重卡片 */}
      <div className="bg-gradient-to-br from-indigo-900/40 to-slate-800/40 rounded-[2.5rem] border border-indigo-500/20 p-8 shadow-xl">
        <div 
          className="flex justify-between items-center cursor-pointer" 
          onClick={() => setSelectedPRProject(selectedPRProject === '__WEIGHT__' ? null : '__WEIGHT__')}
        >
          <div className="flex flex-col">
            <h3 className="text-xs font-black text-indigo-400 uppercase tracking-widest flex items-center gap-2 mb-2">
              <Scale size={16} /> {translations.currentWeight[lang]}
            </h3>
            <div className="flex items-end">
              <span className="text-4xl font-black text-white">
                {weightEntries.length > 0 ? formatWeight(weightEntries[0].weight) : '--'}
              </span>
              <span className="text-slate-500 font-bold ml-2 uppercase text-sm mb-1">{unit}</span>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <button 
              onClick={(e) => { e.stopPropagation(); setEditingWeightId(null); setWeightInputValue(''); setShowWeightInput(true); }} 
              className="p-3 bg-indigo-600 rounded-2xl hover:bg-indigo-500 transition-colors shadow-lg shadow-indigo-600/20 active:scale-90"
            >
              <Plus size={20} />
            </button>
            <div className="p-2 text-slate-500">
              {selectedPRProject === '__WEIGHT__' ? <ChevronUp size={24} /> : <ChevronDown size={24} />}
            </div>
          </div>
        </div>
        
        {selectedPRProject === '__WEIGHT__' && (
          <div className="border-t border-indigo-500/10 mt-6 pt-6">
            <p className="text-[10px] text-indigo-400/60 font-black uppercase tracking-widest mb-4 flex items-center gap-2">
              <TrendingUp size={12} /> {translations.weightTrend[lang]}
            </p>
            <TrendChart
              target="__WEIGHT__"
              workouts={workouts}
              weightEntries={weightEntries}
              lang={lang}
              unit={unit}
              resolveName={resolveName}
              getChartMetric={getChartMetric}
            />
            
            <div className="mt-8 space-y-4 max-h-[300px] overflow-y-auto custom-scrollbar pr-2 pt-2 border-t border-indigo-500/5">
              <h4 className="text-[10px] text-slate-500 font-black uppercase tracking-widest flex items-center gap-2 mb-4 px-1">
                <History size={12} /> {lang === Language.CN ? '历史体重记录' : 'Weight History'} ({weightEntries.length})
              </h4>
              {weightEntries.map(entry => (
                <div key={entry.id} className="bg-slate-900/40 p-4 rounded-2xl border border-slate-800/50 flex justify-between items-center group">
                  <div className="flex items-center gap-3">
                    <button 
                      onClick={(e) => { e.stopPropagation(); triggerEditWeight(entry); }}
                      className="p-2 bg-indigo-500/10 text-indigo-400 rounded-xl hover:bg-indigo-500/20 transition-all active:scale-90"
                    >
                      <Edit2 size={12} />
                    </button>
                    <button 
                      onClick={(e) => handleDeleteWeightEntry(e, entry.id)}
                      className="p-2 bg-red-500/10 text-red-500 rounded-xl hover:bg-red-500/20 transition-all active:scale-90"
                    >
                      <Trash2 size={12} />
                    </button>
                    <div className="ml-1">
                      <span className="text-sm font-black text-white">{formatWeight(entry.weight)}</span>
                      <span className="text-[10px] text-slate-500 font-bold uppercase ml-1">{unit}</span>
                    </div>
                  </div>
                  <span className="text-[10px] text-slate-600 font-bold">
                    {new Date(entry.date).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* PR 管理 */}
      <div className="space-y-4">
        <h3 className="text-xs font-black text-slate-500 uppercase flex items-center gap-2 px-2">
          <Trophy className="text-amber-500" size={16} /> {translations.prManagement[lang]}
        </h3>
        
        {bestLifts.map(lift => {
          const isExpanded = selectedPRProject === lift.key;
          const isStarred = !!starredExercises[lift.key];
          const historyExs = workouts
            .flatMap(w => w.exercises.map(e => ({ ...e, date: w.date, workoutId: w.id })))
            .filter(e => e.name === lift.key)
            .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

          return (
            <div key={lift.name} className={`bg-slate-800/40 rounded-[2.5rem] border border-slate-700/50 p-6 transition-all duration-300 hover:border-slate-600 shadow-lg ${isExpanded ? 'ring-2 ring-blue-500/20' : ''}`}>
              <div className="flex justify-between items-center cursor-pointer" onClick={() => setSelectedPRProject(isExpanded ? null : lift.key)}>
                <div className="flex items-center gap-4">
                  <button 
                    onClick={(e) => { e.stopPropagation(); toggleStarExercise(lift.key); }} 
                    className={`p-3 rounded-2xl transition-all ${isStarred ? 'bg-amber-500 text-white shadow-lg shadow-amber-500/20' : 'bg-slate-900 text-slate-600 hover:text-amber-500'}`}
                  >
                    <Star size={20} fill={isStarred ? "currentColor" : "none"} />
                  </button>
                  <span className="font-black text-slate-200">{lift.name}</span>
                </div>
                <div className="flex items-center gap-6">
                  <div className="text-right">
                    <span className="block font-black text-white text-lg leading-none">{formatWeight(lift.weight)}</span>
                    <span className="text-[10px] font-bold text-slate-600 uppercase">{unit}</span>
                  </div>
                  <div className="text-slate-700">{isExpanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}</div>
                </div>
              </div>
              
              {isExpanded && (
                <div className="border-t border-slate-700/30 mt-6 pt-6 animate-in fade-in duration-200">
                  {/* 图表维度切换 */}
                  <div className="flex flex-wrap gap-2 mb-4 px-2">
                    {getActiveMetrics(lift.name).map(m => (
                      <button
                        key={m}
                        onClick={() => setChartMetricPreference({...chartMetricPreference, [lift.name]: m})}
                        className={`px-3 py-1.5 rounded-xl text-[10px] font-black uppercase transition-all ${
                          getChartMetric(lift.name) === m 
                            ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20' 
                            : 'bg-slate-900 text-slate-500 border border-slate-800'
                        }`}
                      >
                        {translations[m as keyof typeof translations]?.[lang] || m.replace('custom_', '')}
                      </button>
                    ))}
                  </div>

                  {/* 图表 */}
                  <div className="mb-8">
                    <TrendChart
                      target={lift.name}
                      metricKey={getChartMetric(lift.name)}
                      workouts={workouts}
                      weightEntries={weightEntries}
                      lang={lang}
                      unit={unit}
                      resolveName={resolveName}
                      getChartMetric={getChartMetric}
                    />
                  </div>

                  {/* 历史记录 */}
                  {historyExs.length > 0 && (
                    <div className="space-y-4 mt-4 border-t border-slate-800 pt-8">
                      <button 
                        onClick={() => setIsHistoryVisible(!isHistoryVisible)} 
                        className="w-full flex items-center justify-between px-1 group"
                      >
                        <h4 className="text-[10px] text-slate-500 font-black uppercase tracking-widest group-hover:text-blue-400 transition-colors">
                          {translations.history[lang]} ({historyExs.length})
                        </h4>
                        <div className={`p-2 rounded-xl bg-slate-900/50 text-slate-600 group-hover:text-blue-500 transition-all ${isHistoryVisible ? 'rotate-180 text-blue-500' : ''}`}>
                          <ChevronDown size={16} />
                        </div>
                      </button>
                      
                      {isHistoryVisible && (
                        <div className="space-y-6 max-h-[500px] overflow-y-auto custom-scrollbar pr-2 pt-2 animate-in fade-in slide-in-from-top-2">
                          {historyExs.map((ex, exIdx) => (
                            <div key={`${ex.workoutId}-${ex.id}-${exIdx}`} className="space-y-4 pb-6 border-b border-slate-800/30 last:border-0 last:pb-0">
                              <div className="flex justify-between items-center px-1">
                                <div className="flex items-center gap-3">
                                  <button 
                                    onClick={(e) => { e.stopPropagation(); handleEditWorkout(ex.workoutId); }} 
                                    className="p-2 bg-blue-500/10 text-blue-500 rounded-xl hover:bg-blue-500/20 transition-all active:scale-90"
                                  >
                                    <Edit2 size={14} />
                                  </button>
                                  <button 
                                    onClick={(e) => handleDeleteExerciseRecord(e, ex.workoutId, ex.id, resolveName(ex.name), ex.date)}
                                    className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                                    title="删除这个动作记录"
                                  >
                                    <Trash2 size={16} />
                                  </button>
                                  <div className="flex items-center gap-2">
                                    <Calendar size={14} className="text-slate-600" />
                                    <span className="text-[11px] text-slate-400 font-bold">
                                      {new Date(ex.date).toLocaleDateString('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' })}
                                    </span>
                                  </div>
                                  {ex.exerciseTime && (
                                    <button
                                      onClick={async (e) => {
                                        e.stopPropagation();
                                        const newTime = prompt(
                                          '请输入新的训练时间 (格式: YYYY-MM-DDTHH:MM)',
                                          new Date(ex.exerciseTime).toISOString().slice(0, 16)
                                        );
                                        if (newTime) {
                                          const timeISO = new Date(newTime).toISOString();
                                          await updateExerciseTime(ex.workoutId, ex.id, timeISO);
                                        }
                                      }}
                                      className="px-2 py-1 bg-slate-700/50 border border-slate-600/50 rounded-lg text-xs font-bold text-slate-300 hover:bg-slate-600/50 transition-colors"
                                    >
                                      {formatExerciseTime(ex.exerciseTime, 'cn').time}
                                    </button>
                                  )}
                                </div>
                                <span className="text-[10px] font-black bg-slate-800/80 text-slate-500 px-3 py-1 rounded-full uppercase tracking-wider border border-slate-700/30">
                                  {ex.sets.length} {translations.setsCount[lang]}
                                </span>
                              </div>
                              <div className="flex flex-wrap gap-2">
                                {ex.sets.map((s: any) => renderSetCapsule(s, ex.name, ex))}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* 导出区域 */}
      <div className="mt-12 mb-12 px-2 pb-20">
        <div className="bg-slate-800/30 border border-slate-700/30 rounded-[2.5rem] p-8 text-center space-y-6">
          <div className="flex justify-center">
            <div className="p-4 bg-indigo-500/10 text-indigo-500 rounded-full">
              <Cloud size={32} />
            </div>
          </div>
          <div className="space-y-2">
            <h4 className="text-lg font-black text-white">{translations.exportData[lang]}</h4>
            <p className="text-xs text-slate-500 leading-relaxed max-w-[240px] mx-auto">
              {translations.exportDesc[lang]}
            </p>
          </div>
          <button 
            onClick={handleExportData}
            className="w-full bg-slate-800 hover:bg-slate-700 text-slate-200 py-4 rounded-2xl font-black border border-slate-700 transition-all active:scale-95 flex items-center justify-center gap-3"
          >
            <Download size={20} className="text-blue-500" />
            立即导出备份
          </button>
          <p className="text-[9px] text-slate-600 font-bold uppercase tracking-widest">
            Your data is yours. Always.
          </p>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
