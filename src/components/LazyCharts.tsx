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
import { useTheme } from '../hooks/useTheme';

function chartPalette(dark: boolean) {
  return {
    accent: dark ? '#5b7cff' : '#1f4fff',
    accentSoft: dark ? 'rgba(91, 124, 255, 0.25)' : 'rgba(31, 79, 255, 0.15)',
    tick: dark ? '#6e6e73' : '#8a8a8e',
    axis: dark ? '#2a2a2e' : '#d8d6cf',
    tooltipBg: dark ? '#1a1a1d' : '#f2f1ed',
    tooltipBorder: dark ? '#2a2a2e' : '#d8d6cf',
    tooltipText: dark ? '#f2f1ed' : '#0e0e10',
    tooltipLabel: dark ? '#a8a8ad' : '#8a8a8e',
  };
}

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
  const { resolved } = useTheme();
  const p = chartPalette(resolved === 'dark');
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
              <stop offset="5%" stopColor={p.accent} stopOpacity={0.3}/>
              <stop offset="95%" stopColor={p.accent} stopOpacity={0}/>
            </linearGradient>
          </defs>
          <XAxis 
            dataKey="timestamp" 
            type="number" 
            scale="time" 
            domain={[minTime - timeRange * 0.05, maxTime + timeRange * 0.05]}
            tickFormatter={(ts) => timestampToDate[ts] || ''}
            stroke={p.axis} 
            fontSize={10} 
            tickMargin={15} 
            interval="preserveStartEnd"
            tick={{ fill: p.tick }} 
            axisLine={false} 
            tickLine={false}
          />
          <YAxis yAxisId="left" stroke={p.axis} fontSize={10} tick={{ fill: p.tick }} axisLine={false} tickLine={false} domain={['auto', 'auto']} />
          {!isWeight && <YAxis yAxisId="right" orientation="right" hide domain={['auto', 'auto']} />}
          <Tooltip 
            contentStyle={{ backgroundColor: p.tooltipBg, borderRadius: '12px', border: `1px solid ${p.tooltipBorder}`, padding: '12px' }} 
            itemStyle={{ fontWeight: '600', color: p.tooltipText, fontSize: '12px' }}
            labelStyle={{ color: p.tooltipLabel, fontSize: '10px', marginBottom: '4px', fontWeight: '500' }}
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
              fill={p.accent} 
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
            stroke={p.accent} 
            strokeWidth={2.5} 
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
  const { resolved } = useTheme();
  const p = chartPalette(resolved === 'dark');
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
              <stop offset="5%" stopColor={p.accent} stopOpacity={0.3}/>
              <stop offset="95%" stopColor={p.accent} stopOpacity={0}/>
            </linearGradient>
          </defs>
          <XAxis 
            dataKey="timestamp" 
            type="number" 
            scale="time" 
            domain={[minTime - timeRange * 0.05, maxTime + timeRange * 0.05]}
            tickFormatter={(ts) => timestampToDate[ts] || ''}
            stroke={p.axis} 
            fontSize={10} 
            tickMargin={15} 
            interval="preserveStartEnd"
            tick={{ fill: p.tick }} 
            axisLine={false} 
            tickLine={false}
          />
          <YAxis stroke={p.axis} fontSize={10} tick={{ fill: p.tick }} axisLine={false} tickLine={false} domain={['auto', 'auto']} />
          
          <Tooltip 
            contentStyle={{ backgroundColor: p.tooltipBg, borderRadius: '12px', border: `1px solid ${p.tooltipBorder}`, padding: '12px' }} 
            itemStyle={{ fontWeight: '600', color: p.tooltipText, fontSize: '12px'}}
            labelStyle={{ display: 'none' }}
            formatter={(value: number) => [value.toFixed(2), metricName]}
          />

          <Area 
            type="monotone" 
            dataKey="val"
            stroke={p.accent}
            strokeWidth={2.5} 
            fillOpacity={1} 
            fill={`url(#grad-metric-${metricName})`}
            animationDuration={1500}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
