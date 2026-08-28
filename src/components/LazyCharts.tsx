import React from 'react';
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  Area,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
} from 'recharts';
import { Language } from '../../types';
import { KG_TO_LBS } from '../constants';
import { translations } from '../../translations';
import { useTheme } from '../hooks/useTheme';

/** 数值智能去零：80 而不是 80.00（§6.5） */
function trimNum(v: number): string {
  return String(Number(v.toFixed(2)));
}

/** metricKey 本地化。原先 tooltip 直接显示英文 key。 */
function metricLabel(key: string | undefined, lang: Language): string {
  if (!key) return lang === Language.CN ? '数值' : 'Value';
  const t = translations[key as keyof typeof translations];
  return (t && (t as Record<string, string>)[lang]) || key.replace('custom_', '');
}

/**
 * 版画插图的两样零件：45° 斜线 pattern（取代渐变面积填充 —— 那是塑料感的来源），
 * 与末点常驻读数（6px 实心方块 + 右侧 mono 13px）。
 *
 * 末点标签是本节最实用的一条：以前读任何数值都必须点 tooltip，
 * 出汗手滑场景下那是最差的读数路径。
 */
function HatchDefs({ id, color }: { id: string; color: string }) {
  return (
    <defs>
      <pattern id={id} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <line x1="0" y1="0" x2="0" y2="6" stroke={color} strokeWidth="1" strokeOpacity="0.08" />
      </pattern>
    </defs>
  );
}

function makeEndLabel(lastIndex: number, color: string, textColor: string, suffix = '') {
  return function EndLabel(props: any) {
    const { cx, cy, index, value } = props;
    if (index !== lastIndex || cx == null || cy == null) return null;
    return (
      <g>
        <rect x={cx - 3} y={cy - 3} width={6} height={6} fill={color} />
        <text
          x={cx + 8}
          y={cy + 4}
          fill={textColor}
          fontSize={13}
          fontWeight={600}
          fontFamily="'IBM Plex Mono', ui-monospace, monospace"
          textAnchor="end"
          transform={`translate(-4, -14)`}
        >
          {trimNum(Number(value))}
          {suffix}
        </text>
      </g>
    );
  };
}

/**
 * recharts 把颜色当 SVG 属性写下去，SVG 属性不认 CSS 变量，
 * 所以这里必须在运行时把令牌读成实际值（规格 §6.5）。
 *
 * `dark` 参数不再用于选值，只作为主题切换时的重算依据：
 * 调用方传的是 useTheme().resolved，主题一变就重渲染、重读一次。
 */
function chartPalette(_dark: boolean) {
  const cs = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
  const accent = v('--accent', '#B23A28');
  return {
    accent,
    accentSoft: `color-mix(in srgb, ${accent} 18%, transparent)`,
    tick: v('--text-tertiary', '#665E53'),
    axis: v('--divider', '#D9D0BC'),
    tooltipBg: v('--bg-card', '#FBF8F1'),
    tooltipBorder: v('--divider', '#D9D0BC'),
    tooltipText: v('--text-primary', '#1A1714'),
    tooltipLabel: v('--text-tertiary', '#665E53'),
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
  
  const lastIndex = data.length - 1;
  const best = Math.max(...data.map(d => d.val));
  const isCn = lang === Language.CN;
  const hatchId = `hatch-${target.replace(/[^a-zA-Z0-9]/g, '')}`;

  return (
    <div className="w-full h-[250px] mt-6 anim-reveal">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 16, right: 44, left: -22, bottom: 0 }}>
          <HatchDefs id={hatchId} color={p.accent} />
          <XAxis
            dataKey="timestamp"
            type="number"
            scale="time"
            domain={[minTime - timeRange * 0.05, maxTime + timeRange * 0.05]}
            tickFormatter={ts => timestampToDate[ts] || ''}
            stroke={p.axis}
            fontSize={12}
            tickMargin={12}
            interval="preserveStartEnd"
            tick={{ fill: p.tick }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            yAxisId="left"
            stroke={p.axis}
            fontSize={12}
            tick={{ fill: p.tick }}
            axisLine={false}
            tickLine={false}
            domain={['auto', 'auto']}
          />
          {!isWeight && <YAxis yAxisId="right" orientation="right" hide domain={['auto', 'auto']} />}
          <Tooltip
            contentStyle={{
              backgroundColor: p.tooltipBg,
              borderRadius: '4px',
              border: `1px solid ${p.tooltipBorder}`,
              padding: '10px 12px',
            }}
            itemStyle={{ fontWeight: '600', color: p.tooltipText, fontSize: '13px' }}
            labelStyle={{ color: p.tooltipLabel, fontSize: '12px', marginBottom: '4px', fontWeight: '500' }}
            formatter={(value: number) => [trimNum(value), metricLabel(metricKey, lang)]}
            labelFormatter={ts => {
              const d = new Date(ts as number);
              return d.toLocaleDateString(isCn ? 'zh-CN' : 'en-US', {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
              });
            }}
          />
          {!isWeight && (
            <Bar
              yAxisId="right"
              dataKey="volume"
              fill={`url(#${hatchId})`}
              stroke={p.accent}
              strokeOpacity={0.25}
              barSize={20}
              isAnimationActive={false}
            />
          )}
          {/* PR 参考线。chart 数据是全量历史（getChartDataFor 不做窗口截断），
              所以序列最大值就是这个动作该指标的历史最好成绩。 */}
          {data.length > 1 && (
            <ReferenceLine
              yAxisId="left"
              y={best}
              stroke={p.accent}
              strokeDasharray="2 4"
              strokeWidth={1}
              label={{
                value: `${isCn ? '最好' : 'PR'} ${trimNum(best)}`,
                position: 'right',
                fill: p.accent,
                fontSize: 11,
                fontWeight: 600,
              }}
            />
          )}
          {/* 面积填充改斜线版画，线本身是 1.75px 墨线 */}
          <Area
            yAxisId="left"
            type="monotone"
            dataKey="val"
            stroke="none"
            fill={`url(#${hatchId})`}
            fillOpacity={1}
            isAnimationActive={false}
          />
          <Line
            yAxisId="left"
            type="monotone"
            dataKey="val"
            stroke={p.accent}
            strokeWidth={1.75}
            dot={makeEndLabel(lastIndex, p.accent, p.tooltipText)}
            activeDot={{ r: 3, fill: p.accent, stroke: 'none' }}
            isAnimationActive={false}
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

  const lastIndex = data.length - 1;
  const best = Math.max(...data.map(d => d.val));
  const isCn = lang === Language.CN;
  const hatchId = `hatch-metric-${metricName.replace(/[^a-zA-Z0-9]/g, '')}`;
  const unitSuffix = data[lastIndex]?.unit ? ` ${data[lastIndex].unit}` : '';

  return (
    <div className="w-full h-[180px] mt-4 anim-reveal">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 16, right: 44, left: -22, bottom: 0 }}>
          <HatchDefs id={hatchId} color={p.accent} />
          <XAxis
            dataKey="timestamp"
            type="number"
            scale="time"
            domain={[minTime - timeRange * 0.05, maxTime + timeRange * 0.05]}
            tickFormatter={ts => timestampToDate[ts] || ''}
            stroke={p.axis}
            fontSize={12}
            tickMargin={12}
            interval="preserveStartEnd"
            tick={{ fill: p.tick }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            stroke={p.axis}
            fontSize={12}
            tick={{ fill: p.tick }}
            axisLine={false}
            tickLine={false}
            domain={['auto', 'auto']}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: p.tooltipBg,
              borderRadius: '4px',
              border: `1px solid ${p.tooltipBorder}`,
              padding: '10px 12px',
            }}
            itemStyle={{ fontWeight: '600', color: p.tooltipText, fontSize: '13px' }}
            labelStyle={{ display: 'none' }}
            formatter={(value: number) => [trimNum(value), metricName]}
          />
          {data.length > 1 && (
            <ReferenceLine
              y={best}
              stroke={p.accent}
              strokeDasharray="2 4"
              strokeWidth={1}
              label={{
                value: `${isCn ? '最好' : 'PR'} ${trimNum(best)}`,
                position: 'right',
                fill: p.accent,
                fontSize: 11,
                fontWeight: 600,
              }}
            />
          )}
          <Area
            type="monotone"
            dataKey="val"
            stroke="none"
            fill={`url(#${hatchId})`}
            fillOpacity={1}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="val"
            stroke={p.accent}
            strokeWidth={1.75}
            dot={makeEndLabel(lastIndex, p.accent, p.tooltipText, unitSuffix)}
            activeDot={{ r: 3, fill: p.accent, stroke: 'none' }}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
