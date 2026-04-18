/**
 * 图表数据 Hook
 * 提取 App.tsx 中的图表数据处理逻辑
 */
import { useMemo } from 'react';
import { WorkoutSession, Language } from '../../types';
import { KG_TO_LBS } from '../constants';

interface ChartDataPoint {
  date: string;
  val: number;
  timestamp: number;
}

/**
 * 获取图表数据
 * @param workouts 训练记录
 * @param target 目标动作名称，'__WEIGHT__' 表示体重
 * @param metricKey 指标键（如 'weight', 'distance', 'speed'）
 * @param unit 单位 'kg' | 'lbs'
 * @param lang 语言
 * @param resolveName 名称解析函数
 */
export const useChartData = (
  workouts: WorkoutSession[],
  weightEntries: { date: string; weight: number }[],
  target: string,
  metricKey: string | undefined,
  unit: 'kg' | 'lbs',
  lang: Language,
  resolveName: (name: string) => string
): ChartDataPoint[] => {
  return useMemo(() => {
    if (target === '__WEIGHT__') {
      // 体重数据
      return weightEntries.map(entry => ({
        date: new Date(entry.date).toLocaleDateString(
          lang === Language.CN ? 'zh-CN' : 'en-US',
          { month: 'short', day: 'numeric' }
        ),
        val: Number((unit === 'kg' ? entry.weight : entry.weight * KG_TO_LBS).toFixed(2)),
        timestamp: new Date(entry.date).getTime()
      })).sort((a, b) => a.timestamp - b.timestamp);
    }

    // 训练动作数据
    const searchName = target.trim();

    return workouts
      .filter(w => w.exercises.some(ex => resolveName(ex.name).trim() === searchName))
      .map(w => {
        const ex = w.exercises.find(e => resolveName(e.name).trim() === searchName)!;
        
        // 提取该维度在本次训练中的最大值 (Max Effort)
        const values = ex.sets.map(s => {
          const v = (s as any)[metricKey || 'weight'] || 0;
          // 单位转换
          if (metricKey === 'weight' && unit === 'lbs') return v * 2.20462;
          if (metricKey === 'speed' && unit === 'lbs') return v * 0.621371;
          return v;
        });

        const maxVal = Math.max(...values);
        return {
          date: new Date(w.date).toLocaleDateString(
            lang === Language.CN ? 'zh-CN' : 'en-US',
            { month: 'short', day: 'numeric' }
          ),
          val: Number(maxVal.toFixed(2)),
          timestamp: new Date(w.date).getTime()
        };
      })
      .sort((a, b) => a.timestamp - b.timestamp);
  }, [workouts, weightEntries, target, metricKey, unit, lang, resolveName]);
};

/**
 * 计算图表时间范围
 */
export const getChartTimeRange = (data: ChartDataPoint[]): { min: number; max: number } | null => {
  if (data.length === 0) return null;
  
  const timestamps = data.map(d => d.timestamp);
  const minTime = Math.min(...timestamps);
  const maxTime = Math.max(...timestamps);
  
  return { min: minTime, max: maxTime };
};

export type { ChartDataPoint };
