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

/**
 * 趋势图 tooltip。自定义而非用 formatter，两个原因：
 *   1. 分段绘制拆出了 solidN / crossN 派生序列，默认 payload 会把同一个数值列四遍；
 *   2. 末行要放场地（§12.11）—— 图面上默认只有一段虚线，具体在哪个馆练的
 *      靠点这一下问出来。
 */
function ChartTooltip({
  active,
  payload,
  label,
  palette,
  lang,
  metricKey,
  isCn,
}: any) {
  if (!active || !payload?.length) return null;
  const point = payload[0]?.payload;
  if (!point) return null;

  const dateStr = new Date(label ?? point.timestamp).toLocaleDateString(
    isCn ? 'zh-CN' : 'en-US',
    { year: 'numeric', month: 'short', day: 'numeric' },
  );

  return (
    <div
      style={{
        backgroundColor: palette.tooltipBg,
        borderRadius: '4px',
        border: `1px solid ${palette.tooltipBorder}`,
        padding: '10px 12px',
      }}
    >
      <div style={{ color: palette.tooltipLabel, fontSize: 12, fontWeight: 500, marginBottom: 4 }}>
        {dateStr}
      </div>
      <div style={{ color: palette.tooltipText, fontSize: 13, fontWeight: 600 }}>
        {metricLabel(metricKey, lang)} {trimNum(point.val)}
      </div>
      {point.gym && (
        <div
          style={{
            color: palette.tooltipLabel,
            fontSize: 11,
            marginTop: 5,
            paddingTop: 5,
            borderTop: `1px solid ${palette.tooltipBorder}`,
          }}
        >
          {point.gym}
        </div>
      )}
    </div>
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
  /** §12.11 这一场在哪个馆练的；没标过就是 undefined */
  gym?: string;
  /**
   * 分段绘制用的派生键（splitByGym 填）。Recharts 的 Line 只能整条线一个
   * strokeDasharray，做不到「只把跨场地那一段画虚」，所以把序列拆成几条
   * 互补的线：solid0/solid1 交替承载同场地的连续块，cross0/cross1 交替
   * 承载跨场地的那一段。交替是必须的 —— 同一个键里两个相邻的非空值会被
   * connectNulls={false} 连起来，块与块之间必须隔着一个 null。
   */
  solid0?: number | null;
  solid1?: number | null;
  cross0?: number | null;
  cross1?: number | null;
}

/**
 * 把序列按场地切成「实线块」与「跨场地段」（§12.11）。
 *
 * 判定只在两端都标了场地且不同时成立 —— 有一端没标就是不知道，不知道就不画。
 * 于是这个功能对补标场地之前的历史数据零视觉影响。
 */
function splitByGym(data: ChartDataPoint[]): { data: ChartDataPoint[]; hasCrossing: boolean } {
  if (data.length < 2) return { data, hasCrossing: false };

  const isCrossing = (i: number) => {
    const a = data[i].gym;
    const b = data[i + 1].gym;
    return !!a && !!b && a !== b;
  };

  const out = data.map(d => ({ ...d, solid0: null, solid1: null, cross0: null, cross1: null } as ChartDataPoint));
  let hasCrossing = false;

  // 实线：连续同场地的点归一块，块号奇偶决定落在 solid0 还是 solid1
  let block = 0;
  (out[0] as any)['solid0'] = out[0].val;
  for (let i = 0; i < data.length - 1; i++) {
    if (isCrossing(i)) {
      block++;
      hasCrossing = true;
    } else {
      // 同块：两端都要有值，线才连得起来
      (out[i] as any)[`solid${block % 2}`] = out[i].val;
    }
    (out[i + 1] as any)[`solid${block % 2}`] = out[i + 1].val;
  }

  // 虚线：第 k 段跨场地落在 cross{k%2}，相邻两段必然异键，不会串成一条
  let k = 0;
  for (let i = 0; i < data.length - 1; i++) {
    if (!isCrossing(i)) continue;
    const key = `cross${k % 2}`;
    (out[i] as any)[key] = out[i].val;
    (out[i + 1] as any)[key] = out[i + 1].val;
    k++;
  }

  return { data: out, hasCrossing };
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

  // 底稿行（§12.6）不入图 —— 未结束的草稿是带 ghost 行落盘的，
  // 画进去就是给一场没发生过的训练画了个点。整动作只剩底稿的直接跳过，
  // 否则 Math.max(...[]) 会得到 -Infinity。
  return workouts
    .filter(w => w.exercises.some((ex: any) => resolver(ex.name).trim() === searchName))
    .map(w => {
      const ex = w.exercises.find((e: any) => resolver(e.name).trim() === searchName)!;

      const values = (ex.sets ?? [])
        .filter((s: any) => !s.ghost)
        .map((s: any) => {
          const v = s[key] || 0;
          if (key === 'weight' && u === 'lbs') return v * 2.20462;
          if (key === 'speed' && u === 'lbs') return v * 0.621371;
          return v;
        });
      if (values.length === 0) return null;

      const maxVal = Math.max(...values);
      const point: ChartDataPoint = {
        date: new Date(w.date).toLocaleDateString(l === Language.CN ? 'zh-CN' : 'en-US', { month: 'short', day: 'numeric' }), 
        val: Number(maxVal.toFixed(2)),
        timestamp: new Date(w.date).getTime(),
        gym: w.gym,
      };
      return point;
    })
    .filter((d): d is ChartDataPoint => d !== null)
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
  const raw = getChartDataFor(
    workouts, 
    weightEntries, 
    target, 
    metricKey, 
    lang, 
    unit, 
    resolveName,
    getChartMetric
  );
  // §12.11：跨场地那一段改虚线。没标过场地时 hasCrossing 为 false，
  // 一条实线，跟改动前完全一样。
  const { data, hasCrossing } = splitByGym(raw);
  
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
          {/* 自定义内容：默认的 formatter 会把拆出来的 solid/cross 派生序列
              一并列出来（同一个数值重复四遍）。顺带把场地放进末行 —— §12.11
              说的「不那么明显的交互」就是这里：图上安静，点了才告诉你。 */}
          <Tooltip
            cursor={{ stroke: p.axis, strokeWidth: 1 }}
            content={(props: any) => (
              <ChartTooltip
                {...props}
                palette={p}
                lang={lang}
                metricKey={metricKey}
                isCn={isCn}
              />
            )}
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
          {/* 墨线。没有跨场地时就是原来那一条；有跨场地时拆成
              solid0/solid1（实）+ cross0/cross1（虚），见 splitByGym。
              点、末点读数、activeDot 始终挂在完整的 val 序列上 ——
              所有数据点一视同仁，不给客场的点做任何记号：
              断崖发生在「边」上，不在「点」上。 */}
          {!hasCrossing && (
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
          )}
          {hasCrossing && (
            <>
              {(['solid0', 'solid1'] as const).map(k => (
                <Line
                  key={k}
                  yAxisId="left"
                  type="monotone"
                  dataKey={k}
                  stroke={p.accent}
                  strokeWidth={1.75}
                  dot={false}
                  activeDot={false}
                  connectNulls={false}
                  isAnimationActive={false}
                />
              ))}
              {(['cross0', 'cross1'] as const).map(k => (
                <Line
                  key={k}
                  yAxisId="left"
                  type="linear"
                  dataKey={k}
                  stroke={p.accent}
                  strokeWidth={1.75}
                  strokeDasharray="3 4"
                  strokeOpacity={0.42}
                  dot={false}
                  activeDot={false}
                  connectNulls={false}
                  isAnimationActive={false}
                />
              ))}
              <Line
                yAxisId="left"
                type="monotone"
                dataKey="val"
                stroke="none"
                dot={makeEndLabel(lastIndex, p.accent, p.tooltipText)}
                activeDot={{ r: 3, fill: p.accent, stroke: 'none' }}
                isAnimationActive={false}
              />
            </>
          )}
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
