/**
 * 热力图组件
 */
import React, { useMemo } from 'react';
import CalendarHeatmap from 'react-calendar-heatmap';
import 'react-calendar-heatmap/dist/styles.css';

interface HeatmapChartProps {
  workouts: { date: string; count: number }[];
  onDateClick?: (date: string) => void;
}

export const HeatmapChart: React.FC<HeatmapChartProps> = ({ workouts, onDateClick }) => {
  const heatmapData = useMemo(() => {
    if (!workouts || workouts.length === 0) return [];
    
    const map = new Map<string, number>();
    workouts.forEach(w => {
      try {
        if (!w || !w.date || typeof w.date !== 'string') return;
        
        const d = new Date(w.date);
        if (isNaN(d.getTime())) return;
        
        const dayString = d.toISOString().split('T')[0];
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dayString)) return;
        
        map.set(dayString, (map.get(dayString) || 0) + (w.count || 1));
      } catch (e) {
        // Skip invalid entries
      }
    });
    
    return Array.from(map.entries()).map(([date, count]) => ({ date, count }));
  }, [workouts]);

  const today = new Date();
  const startDate = new Date(today);
  startDate.setFullYear(startDate.getFullYear() - 1);

  const getClassForValue = (value: { date: string; count: number } | null) => {
    if (!value || value.count === 0) return 'color-empty';
    if (value.count === 1) return 'color-1';
    if (value.count === 2) return 'color-2';
    if (value.count === 3) return 'color-3';
    return 'color-4';
  };

  return (
    <div className="w-full overflow-x-auto">
      <div className="min-w-[700px]">
        <CalendarHeatmap
          startDate={startDate}
          endDate={today}
          values={heatmapData}
          classForValue={getClassForValue}
          showWeekdayLabels
          onClick={(value) => {
            if (value && onDateClick) {
              onDateClick(value.date);
            }
          }}
        />
      </div>
      
      {/* Legend */}
      <div className="flex items-center justify-end gap-1 mt-2 text-xs text-slate-500">
        <span>Less</span>
        <div className="w-3 h-3 rounded-sm bg-slate-800" />
        <div className="w-3 h-3 rounded-sm bg-blue-900" />
        <div className="w-3 h-3 rounded-sm bg-blue-700" />
        <div className="w-3 h-3 rounded-sm bg-blue-500" />
        <div className="w-3 h-3 rounded-sm bg-blue-300" />
        <span>More</span>
      </div>
    </div>
  );
};

export default HeatmapChart;
