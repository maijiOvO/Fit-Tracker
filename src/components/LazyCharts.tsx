import React from 'react';
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
} from 'recharts';
import { Language } from '../../types';
import { KG_TO_LBS } from '../constants';
import { type ChartRange, type LiftSummary, rangeStart, trendPoints } from '../utils/liftHistory';
import { formatSet, formatShown, metricLabel, metricUnit, toDisplay, trimNum as trim1 } from '../utils/liftDisplay';
import { useTheme } from '../hooks/useTheme';

/** 数值智能去零：80 而不是 80.00（§6.5） */
function trimNum(v: number): string {
  return String(Math.round(v * 10) / 10);
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
          fontFamily="'Barlow Condensed', 'Noto Sans SC', system-ui, sans-serif"
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
  const accent = v('--accent', '#16181B');
  return {
    accent,
    accentSoft: `color-mix(in srgb, ${accent} 18%, transparent)`,
    tick: v('--text-tertiary', '#5E636A'),
    axis: v('--divider', '#D5D8DC'),
    tooltipBg: v('--bg-card', '#F7F7F8'),
    tooltipBorder: v('--divider', '#D5D8DC'),
    tooltipText: v('--text-primary', '#16181B'),
    tooltipLabel: v('--text-tertiary', '#5E636A'),
  };
}

/**
 * 时间轴刻度：均匀取 4 个，跨度一年以内写月日，再长写年月。
 * 以前刻度只落在数据点上，疏密跟着训练频率走，读不出时间。
 */
function timeTicks(start: number, end: number, isCn: boolean) {
  const n = 4;
  const ticks = Array.from({ length: n }, (_, i) => Math.round(start + ((end - start) * (i + 0.5)) / n));
  const long = end - start > 400 * 86400000;
  const format = (ts: number) => {
    const d = new Date(ts);
    if (isCn) return long ? `${String(d.getFullYear()).slice(2)}年${d.getMonth() + 1}月` : `${d.getMonth() + 1}月${d.getDate()}日`;
    return d.toLocaleDateString('en-US', long ? { month: 'short', year: '2-digit' } : { month: 'short', day: 'numeric' });
  };
  return { ticks, format };
}

/**
 * Y 轴：取 1/2/2.5/5×10ⁿ 的整齐步长，上下各留一点空，刻度落在整数上。
 * 以前 domain='auto' 给出 111.9、121.5 这种刻度，读不出数。
 */
function niceAxis(values: number[]): { domain: [number, number]; ticks: number[] } {
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (max - min < 1e-9) {
    const pad = Math.max(Math.abs(max) * 0.05, 1);
    min -= pad;
    max += pad;
  }
  const raw = (max - min) / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map(k => k * mag).find(st => st >= raw) ?? 10 * mag;
  let lo = Math.floor(min / step) * step;
  if (values.every(v => v >= 0)) lo = Math.max(0, lo);
  let hi = Math.ceil(max / step) * step;
  // 最高点贴着上沿时，末点读数会被裁掉：再加一格
  if (hi - max < step * 0.3) hi += step;
  const ticks: number[] = [];
  for (let t = lo; t <= hi + step / 2; t += step) ticks.push(Math.round(t * 1000) / 1000);
  return { domain: [lo, hi], ticks };
}

const tickNum = (v: number) => String(Math.round(v * 10) / 10);

/** 窗口起点：'all' 从第一场稍往前一点 */
function windowStart(range: ChartRange, firstTs: number, now: number) {
  if (range !== 'all') return rangeStart(range, now);
  return firstTs - Math.max((now - firstTs) * 0.04, 86400000);
}

function TooltipBox({ palette, children }: { palette: ReturnType<typeof chartPalette>; children: React.ReactNode }) {
  return (
    <div
      style={{
        backgroundColor: palette.tooltipBg,
        borderRadius: '4px',
        border: `1px solid ${palette.tooltipBorder}`,
        padding: '8px 10px',
        fontSize: 12,
        color: palette.tooltipText,
        lineHeight: 1.5,
      }}
    >
      {children}
    </div>
  );
}

const fullDate = (ts: number, isCn: boolean) =>
  new Date(ts).toLocaleDateString(isCn ? 'zh-CN' : 'en-US', { year: 'numeric', month: 'short', day: 'numeric' });

interface LiftTrendChartProps {
  lift: LiftSummary;
  metric: string;
  range: ChartRange;
  lang: Language;
  unit: 'kg' | 'lbs';
}

/**
 * 动作趋势图：阶梯线是「截至当时的历史最好」（只升不降），圆点是每场最好的一组，
 * 实心点＝那一场破了纪录。
 *
 * 为什么不再连点成线：每场的最好成绩本来就上下波动（轻重日、换馆、状态），
 * 连成平滑曲线读出来的是噪声和并不存在的中间值；
 * 来这里看的是「纪录什么时候、怎么涨上来的」，那是阶梯线。
 * 场地（§12.11）不再画虚线段 —— 没有连线了，换馆的点只是落在线下面，tooltip 里标着馆名。
 */
export function LiftTrendChart({ lift, metric, range, lang, unit }: LiftTrendChartProps) {
  const { resolved } = useTheme();
  const p = chartPalette(resolved === 'dark');
  const isCn = lang === Language.CN;
  const now = Date.now();

  const all = trendPoints(lift.sessions, metric).map(pt => ({
    ...pt,
    val: pt.val == null ? null : toDisplay(metric, pt.val, unit),
    best: toDisplay(metric, pt.best, unit),
  }));
  if (all.length === 0) return null;

  const start = windowStart(range, all[0].ts, now);
  const inWindow = all.filter(pt => pt.ts >= start);
  const before = all.filter(pt => pt.ts < start);
  const data: typeof all = [];
  // 窗口开始前已有的纪录：阶梯线从窗口左缘就该在那个高度
  if (before.length) data.push({ ts: start, val: null, best: before[before.length - 1].best, pr: false });
  data.push(...inWindow);
  // 阶梯线延到今天：最后那段平线的长度就是「多久没破纪录了」
  data.push({ ts: now, val: null, best: all[all.length - 1].best, pr: false });

  const values = data.flatMap(d => (d.val == null ? [d.best] : [d.val, d.best]));
  const yAxis = niceAxis(values);
  const { ticks, format } = timeTicks(start, now, isCn);
  const lastIndex = data.length - 1;
  const suffix = metricUnit(metric, unit);

  return (
    <div className="w-full h-[220px] relative" data-testid="lift-trend-chart">
      {inWindow.length === 0 && (
        <p className="absolute inset-x-0 top-1 text-label text-tertiary text-center pointer-events-none">
          {isCn ? '这段时间没练过，线是之前的纪录' : 'No sessions in this range'}
        </p>
      )}
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 16, right: 40, left: 0, bottom: 0 }}>
          <XAxis
            dataKey="ts"
            type="number"
            scale="time"
            domain={[start, now]}
            ticks={ticks}
            tickFormatter={format}
            fontSize={11}
            tickMargin={8}
            tick={{ fill: p.tick }}
            axisLine={{ stroke: p.axis }}
            tickLine={false}
          />
          <YAxis
            domain={yAxis.domain}
            ticks={yAxis.ticks}
            tickFormatter={metric === 'duration' ? (v: number) => formatShown('duration', v) : tickNum}
            fontSize={11}
            tick={{ fill: p.tick }}
            axisLine={false}
            tickLine={false}
            width={40}
          />
          <Tooltip
            cursor={{ stroke: p.axis, strokeWidth: 1 }}
            content={({ active, payload }: any) => {
              const pt = payload?.[0]?.payload;
              if (!active || !pt || pt.val == null) return null;
              return (
                <TooltipBox palette={p}>
                  <div style={{ color: p.tooltipLabel }}>
                    {fullDate(pt.ts, isCn)}
                    {pt.pr && <span style={{ color: p.accent, fontWeight: 700, marginLeft: 6 }}>PR</span>}
                  </div>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>
                    {metricLabel(metric, lang)} {formatShown(metric, pt.val)}{suffix && ` ${suffix}`}
                  </div>
                  {pt.set && pt.set.reps > 0 && (
                    <div style={{ color: p.tooltipLabel }}>{formatSet(pt.set, unit, lift.signed, isCn)}</div>
                  )}
                  {pt.gym && <div style={{ color: p.tooltipLabel }}>{pt.gym}</div>}
                </TooltipBox>
              );
            }}
          />
          <Line
            type="stepAfter"
            dataKey="best"
            stroke={p.accent}
            strokeWidth={1.75}
            dot={makeEndLabel(lastIndex, p.accent, p.tooltipText)}
            activeDot={false}
            isAnimationActive={false}
          />
          <Line
            dataKey="val"
            stroke="none"
            isAnimationActive={false}
            dot={(props: any) => {
              const { cx, cy, payload, index } = props;
              if (payload?.val == null || cx == null || cy == null) return <g key={index} />;
              return payload.pr ? (
                <circle key={index} cx={cx} cy={cy} r={4} fill={p.accent} stroke="none" />
              ) : (
                <circle key={index} cx={cx} cy={cy} r={3} fill={p.tooltipBg} stroke={p.accent} strokeWidth={1.25} />
              );
            }}
            activeDot={{ r: 5, fill: p.accent, stroke: p.tooltipBg, strokeWidth: 2 }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

interface WeightTrendChartProps {
  weightEntries: { date: string; weight: number }[];
  range: ChartRange;
  lang: Language;
  unit: 'kg' | 'lbs';
}

/** 体重趋势：直线连点（体重是连续量，可以连），时间范围可切 */
export function WeightTrendChart({ weightEntries, range, lang, unit }: WeightTrendChartProps) {
  const { resolved } = useTheme();
  const p = chartPalette(resolved === 'dark');
  const isCn = lang === Language.CN;
  const now = Date.now();

  const all = weightEntries
    .map(e => ({ ts: new Date(e.date).getTime(), val: unit === 'lbs' ? e.weight * KG_TO_LBS : e.weight }))
    .sort((a, b) => a.ts - b.ts);
  if (all.length === 0) return null;

  const start = windowStart(range, all[0].ts, now);
  const data = all.filter(d => d.ts >= start);
  if (data.length === 0) {
    return (
      <p className="text-label text-tertiary text-center py-10">
        {isCn ? '这段时间没有称重记录' : 'No weigh-ins in this range'}
      </p>
    );
  }
  const yAxis = niceAxis(data.map(d => d.val));
  const { ticks, format } = timeTicks(start, now, isCn);
  const lastIndex = data.length - 1;
  const endLabel = makeEndLabel(lastIndex, p.accent, p.tooltipText);

  return (
    <div className="w-full h-[200px]" data-testid="weight-trend-chart">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 16, right: 40, left: 0, bottom: 0 }}>
          <XAxis
            dataKey="ts"
            type="number"
            scale="time"
            domain={[start, now]}
            ticks={ticks}
            tickFormatter={format}
            fontSize={11}
            tickMargin={8}
            tick={{ fill: p.tick }}
            axisLine={{ stroke: p.axis }}
            tickLine={false}
          />
          <YAxis
            domain={yAxis.domain}
            ticks={yAxis.ticks}
            tickFormatter={tickNum}
            fontSize={11}
            tick={{ fill: p.tick }}
            axisLine={false}
            tickLine={false}
            width={40}
          />
          <Tooltip
            cursor={{ stroke: p.axis, strokeWidth: 1 }}
            content={({ active, payload }: any) => {
              const pt = payload?.[0]?.payload;
              if (!active || !pt) return null;
              return (
                <TooltipBox palette={p}>
                  <div style={{ color: p.tooltipLabel }}>{fullDate(pt.ts, isCn)}</div>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{trim1(pt.val)} {unit}</div>
                </TooltipBox>
              );
            }}
          />
          <Line
            type="linear"
            dataKey="val"
            stroke={p.accent}
            strokeWidth={1.75}
            dot={(props: any) => {
              const { cx, cy, index } = props;
              if (cx == null || cy == null) return <g key={index} />;
              if (index === lastIndex) return <g key={index}>{endLabel(props)}</g>;
              return data.length > 40 ? <g key={index} /> : <circle key={index} cx={cx} cy={cy} r={2} fill={p.accent} />;
            }}
            activeDot={{ r: 4, fill: p.accent, stroke: p.tooltipBg, strokeWidth: 2 }}
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
