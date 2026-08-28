/**
 * 训练活跃度热力图 —— 规格 §6.5
 *
 * 自绘替换 react-calendar-heatmap：后者靠 `!important` + `translateX(45px)`
 * 这类魔法数字硬撑版式，且颜色写死在 heatmap.css 里、不随主题走。
 *
 * ⚠️ 强度按【当日总组数】分档，不是场数。
 * 单人自用一天几乎只有 1 场，按场数分档会退化成一张二值图（有/无），
 * 那就没有「热力」可言了。
 *
 * 格子色由 --accent 派生：color-mix 一个公式盖住深浅两个主题，
 * 令牌一变它跟着变，不需要第二份调色板。
 */
import React, { useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Language } from '../../types';

export interface HeatmapDay {
  /** YYYY-MM-DD */
  date: string;
  /** 当日总组数 */
  sets: number;
  /** 当日场数，只用于提示文案 */
  sessions: number;
}

interface Props {
  days: HeatmapDay[];
  lang: Language;
  /** 往回看多少天 */
  span?: number;
  /** 收起时显示几周。「我的」页面里整张图太占纵向高度，默认只留 5 行。 */
  collapsedWeeks?: number;
  onPickDay?: (day: HeatmapDay) => void;
}

/** 0 / 1-8 / 9-16 / 17-24 / 25+ —— 一档约等于两个动作的量 */
function levelOf(sets: number): number {
  if (sets <= 0) return 0;
  if (sets <= 8) return 1;
  if (sets <= 16) return 2;
  if (sets <= 24) return 3;
  return 4;
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export const ActivityHeatmap: React.FC<Props> = ({
  days,
  lang,
  span = 91,
  collapsedWeeks = 5,
  onPickDay,
}) => {
  const isCn = lang === Language.CN;
  const [expanded, setExpanded] = useState(false);

  const { cells, streak } = useMemo(() => {
    const byDate = new Map<string, HeatmapDay>(days.map(d => [d.date, d]));
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayKey = ymd(today);

    // 让首行从周一开始：把起点往前推到最近的周一
    const start = new Date(today);
    start.setDate(start.getDate() - (span - 1));
    const dow = (start.getDay() + 6) % 7; // 0 = 周一
    start.setDate(start.getDate() - dow);

    const out: (HeatmapDay & { level: number; isToday: boolean; future: boolean })[] = [];
    for (let d = new Date(start); d <= today || out.length % 7 !== 0; d.setDate(d.getDate() + 1)) {
      const key = ymd(d);
      const hit = byDate.get(key);
      out.push({
        date: key,
        sets: hit?.sets ?? 0,
        sessions: hit?.sessions ?? 0,
        level: levelOf(hit?.sets ?? 0),
        isToday: key === todayKey,
        future: d > today,
      });
      if (d > today && out.length % 7 === 0) break;
    }

    // 连续天数：从今天（或昨天，今天还没练不算断）往回数
    let s = 0;
    const cursor = new Date(today);
    if (!byDate.get(ymd(cursor))) cursor.setDate(cursor.getDate() - 1);
    while (byDate.get(ymd(cursor))) {
      s += 1;
      cursor.setDate(cursor.getDate() - 1);
    }

    return { cells: out, streak: s };
  }, [days, span]);

  const weekdays = isCn ? ['一', '二', '三', '四', '五', '六', '日'] : ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

  // 收起时只留最近 collapsedWeeks 行（贴着今天那一端）
  const totalWeeks = Math.ceil(cells.length / 7);
  const canCollapse = totalWeeks > collapsedWeeks;
  const shown = !canCollapse || expanded ? cells : cells.slice((totalWeeks - collapsedWeeks) * 7);
  const shownWeeks = Math.ceil(shown.length / 7);
  // 统计只覆盖画出来的那几周——展开时数字跟着变，说的和看到的才是同一件事
  const inRange = shown.filter(c => !c.future && c.sets > 0);
  const activeDays = inRange.length;
  const totalSets = inRange.reduce((a, c) => a + c.sets, 0);

  return (
    <div>
      {/* 眉批式摘要：只读信息不配拥有边框（§6.3） */}
      <div className="flex items-baseline gap-4 mb-3 text-label text-secondary">
        <span>
          {isCn ? '连续' : 'Streak'}{' '}
          <span className="font-mono font-semibold text-data-md text-primary tabular-nums align-baseline">
            {streak}
          </span>{' '}
          {isCn ? '天' : 'd'}
        </span>
        <span className="text-tertiary">
          {isCn ? `近 ${shownWeeks} 周` : `Last ${shownWeeks}w`} · {activeDays}{' '}
          {isCn ? '天有训练' : 'active'} · {totalSets} {isCn ? '组' : 'sets'}
        </span>
      </div>

      <div className="grid grid-cols-7 gap-1 mb-1" aria-hidden>
        {weekdays.map((w, i) => (
          <span key={i} className="text-micro text-tertiary text-center leading-none">
            {w}
          </span>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {shown.map(c => {
          if (c.future) return <span key={c.date} />;
          const title = `${c.date} · ${c.sets} ${isCn ? '组' : 'sets'}${
            c.sessions > 1 ? ` · ${c.sessions} ${isCn ? '场' : 'sessions'}` : ''
          }`;
          return (
            <button
              key={c.date}
              type="button"
              title={title}
              aria-label={title}
              onClick={onPickDay ? () => onPickDay(c) : undefined}
              className={`aspect-square rounded-chip ${
                c.isToday ? 'ring-1 ring-accent' : ''
              }`}
              style={{
                ['--lvl' as string]: c.level,
                background:
                  c.level === 0
                    ? 'var(--bg-inset)'
                    : 'color-mix(in srgb, var(--accent) calc(var(--lvl) * 22%), var(--bg-inset))',
              }}
            />
          );
        })}
      </div>

      <div className="flex items-center gap-1.5 mt-3 text-micro text-tertiary">
        {canCollapse && (
          <button
            type="button"
            onClick={() => setExpanded(v => !v)}
            className="mr-auto inline-flex items-center gap-1 min-h-[32px] text-micro font-medium text-secondary"
            aria-expanded={expanded}
          >
            <ChevronDown
              size={13}
              strokeWidth={2}
              className={`transition-transform duration-base ease-paper ${expanded ? 'rotate-180' : ''}`}
            />
            {expanded
              ? isCn ? '收起' : 'Collapse'
              : isCn ? `展开全部 ${totalWeeks} 周` : `Show all ${totalWeeks} weeks`}
          </button>
        )}
        <span>{isCn ? '少' : 'Less'}</span>
        {[0, 1, 2, 3, 4].map(l => (
          <span
            key={l}
            className="w-3 h-3 rounded-chip"
            style={{
              ['--lvl' as string]: l,
              background:
                l === 0
                  ? 'var(--bg-inset)'
                  : 'color-mix(in srgb, var(--accent) calc(var(--lvl) * 22%), var(--bg-inset))',
            }}
          />
        ))}
        <span>{isCn ? '多' : 'More'}</span>
      </div>
    </div>
  );
};

export default ActivityHeatmap;
