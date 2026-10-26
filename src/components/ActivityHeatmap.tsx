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
import { plural } from '../utils/format';
import { localYmd, dayOfWeekIndex, rotateWeekdays } from '../utils/dateUtils';
import { appPrefsNow } from '../../services/appPrefs';

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
  onPickDay?: (day: HeatmapDay) => void;
  /** 破了纪录的日子（本地日期 YYYY-MM-DD）：格子中间画一颗镁粉白点（「杠铃片」阶段二，纪录 = 镁粉） */
  prDays?: Set<string>;
}

/** 0 / 1-8 / 9-16 / 17-24 / 25+ —— 一档约等于两个动作的量 */
function levelOf(sets: number): number {
  if (sets <= 0) return 0;
  if (sets <= 8) return 1;
  if (sets <= 16) return 2;
  if (sets <= 24) return 3;
  return 4;
}

/** 网格、连续天数与 heatmapData 的日键必须同一个函数（本地日期） */
const ymd = localYmd;

/** 往回看多少天 */
const SPAN = 91;
/** 收起时显示几周。「我的」页面里整张图太占纵向高度，只留 5 行。 */
const COLLAPSED_WEEKS = 5;

export const ActivityHeatmap: React.FC<Props> = ({
  days,
  lang,
  onPickDay,
  prDays,
}) => {
  const isCn = lang === Language.CN;
  const [expanded, setExpanded] = useState(false);
  const weekStart = appPrefsNow().weekStart;

  const { cells, streak } = useMemo(() => {
    const byDate = new Map<string, HeatmapDay>(days.map(d => [d.date, d]));
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayKey = ymd(today);

    // 让每行从一周的第一天开始（首选项「每周开始于」）：把起点往前推到最近的那一天
    const start = new Date(today);
    start.setDate(start.getDate() - (SPAN - 1));
    start.setDate(start.getDate() - dayOfWeekIndex(start));

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

    // 连续周数（审查 B10：按天数，休息一天就断，一周练三次的人永远是 1）：
    // 每周（按「每周开始于」）至少练过一次就算这周没断；这周还没练不算断，从上周往回数
    const weekOf = (d: Date) => {
      const w = new Date(d);
      w.setHours(0, 0, 0, 0);
      w.setDate(w.getDate() - dayOfWeekIndex(w));
      return ymd(w);
    };
    const weeks = new Set(days.filter(d => d.sessions > 0).map(d => weekOf(new Date(`${d.date}T12:00:00`))));
    let s = 0;
    const cursor = new Date(today);
    cursor.setDate(cursor.getDate() - dayOfWeekIndex(cursor));
    if (!weeks.has(ymd(cursor))) cursor.setDate(cursor.getDate() - 7);
    while (weeks.has(ymd(cursor))) {
      s += 1;
      cursor.setDate(cursor.getDate() - 7);
    }

    return { cells: out, streak: s };
  }, [days, weekStart]);

  const weekdays = rotateWeekdays(isCn ? ['日', '一', '二', '三', '四', '五', '六'] : ['S', 'M', 'T', 'W', 'T', 'F', 'S']);

  // 收起时只留最近 COLLAPSED_WEEKS 行（贴着今天那一端）
  const totalWeeks = Math.ceil(cells.length / 7);
  const canCollapse = totalWeeks > COLLAPSED_WEEKS;
  const shown = !canCollapse || expanded ? cells : cells.slice((totalWeeks - COLLAPSED_WEEKS) * 7);
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
          {isCn ? '周' : 'wk'}
        </span>
        <span className="text-tertiary">
          {isCn ? `近 ${shownWeeks} 周` : `Last ${shownWeeks}w`} · {activeDays}{' '}
          {isCn ? '天有训练' : 'active'} · {totalSets} {isCn ? '组' : plural(totalSets, 'set')}
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
          const isPr = !!prDays?.has(c.date);
          const title = `${c.date} · ${c.sets} ${isCn ? '组' : plural(c.sets, 'set')}${
            c.sessions > 1 ? ` · ${c.sessions} ${isCn ? '场' : plural(c.sessions, 'session')}` : ''
          }${isPr ? (isCn ? ' · 破纪录' : ' · PR') : ''}`;
          return (
            <button
              key={c.date}
              type="button"
              title={title}
              aria-label={title}
              onClick={onPickDay ? () => onPickDay(c) : undefined}
              className={`relative aspect-square rounded-chip${isPr ? ' heat-pr' : ''} ${
                c.isToday ? 'ring-1 ring-accent ring-offset-1 ring-offset-card' : ''
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
        {prDays && prDays.size > 0 && (
          <span className="ml-2 inline-flex items-center gap-1">
            <span className="heat-pr-dot" aria-hidden />
            {isCn ? '破纪录' : 'PR'}
          </span>
        )}
      </div>
    </div>
  );
};
