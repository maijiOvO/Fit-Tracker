import React from 'react';
import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
} from 'recharts';
import { Language } from '../../types';
import { KG_TO_LBS } from '../constants';

// 类型定义
interface ChartDataPoint {
  date: string;
  val: number;
  timestamp: number;
  volume?: number;
}

interface LazyChartsProps {
  // 数据
  workouts: any[];
  weightEntries: any[];
  measurements: any[];
  // 配置
  lang: Language;
  unit: 'kg' | 'lbs';
  // 工具函数
  resolveName: (name: string) => string;
  getChartMetric: (name: string) => string;
  // 图表渲染函数
  renderTrendChart: (target: string, metricKey?: string) => React.ReactNode;
  renderMetricChart: (metricName: string) => React.ReactNode;
}

// getChartDataFor 逻辑（从 App.tsx 提取）
export function getChartDataFor(
  workouts: any[],
  weightEntries: any[],
  target: string,
  metricKey?: string,
  lang?: Language,
  unit?: 'kg' | 'lbs',
  resolveName?: (name: string) => string,
  getChartMetric?: (name: string) => string
): ChartDataPoint[] {
  const l = lang || Language.EN;
  const u = unit || 'kg';
  const resolver = resolveName || ((n: string) => n);
  const metricGetter = getChartMetric || ((n: string) => 'weight');

  if (target === '__WEIGHT__') {
    return weightEntries.map(entry => ({
      date: new Date(entry.date).toLocaleDateString(l === Language.CN ? 'zh-CN' : 'en-US', { month: 'short', day: 'numeric' }),
      val: Number((u === 'kg' ? entry.weight : entry.weight * KG_TO_LBS).toFixed(2)),
      timestamp: new Date(entry.date).getTime()
    })).sort((a, b) => a.timestamp - b.timestamp);
  }

  const searchName = target.trim();
  const key = metricKey || metricGetter(searchName);

  return workouts
    .filter(w => w.exercises.some((ex: any) => resolver(ex.name).trim() === searchName))
    .map(w => {
      const ex = w.exercises.find((e: any) => resolver(e.name).trim() === searchName)!;
      
      const values = ex.sets.map((s: any) => {
        const v = s[key] || 0;
        if (key === 'weight' && u === 'lbs') return v * 2.20462;
        if (key === 'speed' && u === 'lbs') return v * 0.621371;
        return v;
      });

      const maxVal = Math.max(...values);
      return { 
        date: new Date(w.date).toLocaleDateString(l === Language.CN ? 'zh-CN' : 'en-US', { month: 'short', day: 'numeric' }), 
        val: Number(maxVal.toFixed(2)),
        timestamp: new Date(w.date).getTime() 
      };
    })
    .sort((a, b) => a.timestamp - b.timestamp);
}

// TrendChart 组件
interface TrendChartProps {
  target: string;
  metricKey?: string;
  workouts: any[];
  weightEntries: any[];
  lang: Language;
  unit: 'kg' | 'lbs';
  resolveName: (name: string) => string;
  getChartMetric: (name: string) => string;
}

export function TrendChart({ 
  target, 
  metricKey, 
  workouts, 
  weightEntries, 
  lang, 
  unit, 
  resolveName,
  getChartMetric 
}: TrendChartProps) {
  const data = getChartDataFor(
    workouts, 
    weightEntries, 
    target, 
    metricKey, 
    lang, 
    unit, 
    resolveName,
    getChartMetric
  );
  
  const isWeight = target === '__WEIGHT__';
  if (data.length === 0) return null;
  
  const timestamps = data.map(d => d.timestamp);
  const minTime = Math.min(...timestamps);
  const maxTime = Math.max(...timestamps);
  const timeRange = maxTime - minTime || 1;
  
  const timestampToDate = data.reduce((acc, d) => {
    acc[d.timestamp] = d.date;
    return acc;
  }, {} as Record<number, string>);
  
  return (
    <div className="w-full h-[250px] mt-6 animate-in fade-in slide-in-from-top-2">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
          <defs>
            <linearGradient id={`grad-${target}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={isWeight ? '#818cf8' : '#3b82f6'} stopOpacity={0.3}/>
              <stop offset="95%" stopColor={isWeight ? '#818cf8' : '#3b82f6'} stopOpacity={0}/>
            </linearGradient>
          </defs>
          <XAxis 
            dataKey="timestamp" 
            type="number" 
            scale="time" 
            domain={[minTime - timeRange * 0.05, maxTime + timeRange * 0.05]}
            tickFormatter={(ts) => timestampToDate[ts] || ''}
            stroke="#475569" 
            fontSize={10} 
            tickMargin={15} 
            interval="preserveStartEnd"
            tick={{ fill: '#94a3b8' }} 
            axisLine={false} 
            tickLine={false}
          />
          <YAxis yAxisId="left" stroke="#475569" fontSize={10} tick={{ fill: '#94a3b8' }} axisLine={false} tickLine={false} domain={['auto', 'auto']} />
          {!isWeight && <YAxis yAxisId="right" orientation="right" hide domain={['auto', 'auto']} />}
          <Tooltip 
            contentStyle={{ backgroundColor: '#0f172a', borderRadius: '16px', border: '1px solid #1e293b', padding: '12px' }} 
            itemStyle={{ fontWeight: '900', color: '#fff', fontSize: '12px' }}
            labelStyle={{ color: '#64748b', fontSize: '10px', marginBottom: '4px', textTransform: 'uppercase', fontWeight: 'bold' }}
            formatter={(value: number) => [value.toFixed(2), metricKey || 'Value']}
            labelFormatter={(ts) => {
              const d = new Date(ts as number);
              return d.toLocaleDateString(lang === Language.CN ? 'zh-CN' : 'en-US', { year: 'numeric', month: 'short', day: 'numeric' });
            }}
          />
          {!isWeight && (
            <Bar 
              yAxisId="right"
              dataKey="volume" 
              fill="#3b82f6" 
              opacity={0.15}
              radius={[4, 4, 0, 0]}
              barSize={20}
              animationDuration={1500}
            />
          )}
          <Area 
            yAxisId="left"
            type="monotone" 
            dataKey="val"
            stroke={isWeight ? '#818cf8' : '#3b82f6'} 
            strokeWidth={4} 
            fillOpacity={1} 
            fill={`url(#grad-${target})`}
            animationDuration={1500}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

// MetricChart 组件
interface MetricChartProps {
  metricName: string;
  measurements: any[];
  lang: Language;
}

export function MetricChart({ metricName, measurements, lang }: MetricChartProps) {
  const data = measurements
    .filter(m => m.name === metricName)
    .map(m => ({
      date: new Date(m.date).toLocaleDateString(lang === Language.CN ? 'zh-CN' : 'en-US', { month: 'short', day: 'numeric' }),
      val: Number(m.value.toFixed(2)),
      unit: m.unit,
      timestamp: new Date(m.date).getTime()
    }))
    .sort((a, b) => a.timestamp - b.timestamp);

  if (data.length === 0) return null;

  const timestamps = data.map(d => d.timestamp);
  const minTime = Math.min(...timestamps);
  const maxTime = Math.max(...timestamps);
  const timeRange = maxTime - minTime || 1;

  const timestampToDate = data.reduce((acc, d) => {
    acc[d.timestamp] = d.date;
    return acc;
  }, {} as Record<number, string>);

  return (
    <div className="w-full h-[180px] mt-4 animate-in fade-in slide-in-from-top-2">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
          <defs>
            <linearGradient id={`grad-metric-${metricName}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3}/>
              <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
            </linearGradient>
          </defs>
          <XAxis 
            dataKey="timestamp" 
            type="number" 
            scale="time" 
            domain={[minTime - timeRange * 0.05, maxTime + timeRange * 0.05]}
            tickFormatter={(ts) => timestampToDate[ts] || ''}
            stroke="#475569" 
            fontSize={10} 
            tickMargin={15} 
            interval="preserveStartEnd"
            tick={{ fill: '#94a3b8' }} 
            axisLine={false} 
            tickLine={false}
          />
          <YAxis stroke="#475569" fontSize={10} tick={{ fill: '#94a3b8' }} axisLine={false} tickLine={false} domain={['auto', 'auto']} />
          
          <Tooltip 
            contentStyle={{ backgroundColor: '#0f172a', borderRadius: '16px', border: '1px solid #1e293b', padding: '12px' }} 
            itemStyle={{ fontWeight: '900', color: '#fff', fontSize: '12px'}}
            labelStyle={{ display: 'none' }}
            formatter={(value: number) => [value.toFixed(2), metricName]}
          />

          <Area 
            type="monotone" 
            dataKey="val"
            stroke="#6366f1"
            strokeWidth={4} 
            fillOpacity={1} 
            fill={`url(#grad-metric-${metricName})`}
            animationDuration={1500}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
