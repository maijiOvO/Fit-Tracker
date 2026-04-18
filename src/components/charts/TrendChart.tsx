/**
 * 趋势图表组件
 */
import React from 'react';
import { ComposedChart, Area, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

interface ChartDataPoint {
  date: string;
  val: number;
  timestamp: number;
}

interface TrendChartProps {
  data: ChartDataPoint[];
  isWeight?: boolean;
  height?: number;
  metricKey?: string;
}

const gradientColors = {
  weight: { start: '#818cf8', end: '#818cf8' },
  default: { start: '#3b82f6', end: '#3b82f6' },
};

export const TrendChart: React.FC<TrendChartProps> = ({
  data,
  isWeight = false,
  height = 250,
  metricKey,
}) => {
  if (data.length === 0) return null;

  const colors = isWeight ? gradientColors.weight : gradientColors.default;
  const gradientId = `grad-${isWeight ? 'weight' : metricKey || 'default'}`;

  return (
    <div className="w-full" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={colors.start} stopOpacity={0.3}/>
              <stop offset="95%" stopColor={colors.end} stopOpacity={0}/>
            </linearGradient>
          </defs>
          <XAxis 
            dataKey="date" 
            stroke="#475569" 
            fontSize={10} 
            tickMargin={15} 
            minTickGap={40} 
            tick={{ fill: '#94a3b8' }} 
            axisLine={false} 
            tickLine={false} 
          />
          <YAxis 
            yAxisId="left" 
            stroke="#475569" 
            fontSize={10} 
            tick={{ fill: '#94a3b8' }} 
            axisLine={false} 
            tickLine={false} 
            domain={['auto', 'auto']} 
          />
          {!isWeight && (
            <YAxis yAxisId="right" orientation="right" hide domain={['auto', 'auto']} />
          )}
          <Tooltip 
            contentStyle={{ 
              backgroundColor: '#0f172a', 
              borderRadius: '16px', 
              border: '1px solid #1e293b', 
              padding: '12px' 
            }} 
            itemStyle={{ fontWeight: '900', color: '#fff', fontSize: '12px' }}
            labelStyle={{ color: '#64748b', fontSize: '10px', marginBottom: '4px', textTransform: 'uppercase', fontWeight: 'bold' }}
            formatter={(value: number) => [value.toFixed(2), metricKey || 'Value']}
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
            stroke={colors.start} 
            strokeWidth={4} 
            fillOpacity={1} 
            fill={`url(#${gradientId})`}
            animationDuration={1500}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
};

export default TrendChart;
