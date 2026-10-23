/**
 * 「按动作」列表：一行看懂一个动作 —— 纪录（重量×次数）、上次练是什么时候、练了几场。
 * 走势只在详情里看（迷你折线口径是每场原值，跟详情的「历史最好」阶梯线对不上，已去掉）。
 *
 * 以前是按字母排的长列表，每行只有一个最大重量，要点开、再点开「历史」才看得到东西。
 * 现在：收藏在前，其余按最近练过排；点一行直接打开详情（LiftDetailSheet）。
 */
import React, { useMemo, useState } from 'react';
import { Search, Star, X } from 'lucide-react';
import { Language } from '../../types';
import { E1RM, type LiftSummary, chartMetricsFor, sessionMetric } from '../utils/liftHistory';
import { agoLabel, formatMetric, formatSet, metricUnit } from '../utils/liftDisplay';

/** 动作多到要翻屏时才出搜索框 */
const SEARCH_THRESHOLD = 8;

interface LiftListProps {
  lifts: LiftSummary[];
  lang: Language;
  unit: 'kg' | 'lbs';
  starred: Record<string, number>;
  onToggleStar: (baseName: string) => void;
  onOpen: (key: string) => void;
  getActiveMetrics: (baseName: string) => string[];
}

export const LiftList: React.FC<LiftListProps> = ({
  lifts,
  lang,
  unit,
  starred,
  onToggleStar,
  onOpen,
  getActiveMetrics,
}) => {
  const isCn = lang === Language.CN;
  const [query, setQuery] = useState('');

  const sorted = useMemo(
    () =>
      [...lifts].sort((a, b) => {
        // 收藏按动作，不分练法；收藏之间按收藏时间（与原先一致）
        const sa = starred[a.baseName] || 0;
        const sb = starred[b.baseName] || 0;
        if (sa !== sb) return sb - sa;
        return b.lastTs - a.lastTs;
      }),
    [lifts, starred],
  );

  const q = query.trim().toLowerCase();
  const shown = q ? sorted.filter(l => l.key.toLowerCase().includes(q)) : sorted;

  return (
    <div className="ui-card px-4 py-1" data-testid="lift-list">
      {lifts.length > SEARCH_THRESHOLD && (
        <div className="relative pt-3 pb-1">
          <Search size={15} strokeWidth={1.75} className="absolute left-3 top-1/2 mt-1 -translate-y-1/2 text-tertiary pointer-events-none" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={isCn ? '搜索动作' : 'Search exercises'}
            className="w-full h-10 pl-9 pr-9 rounded-control bg-inset text-small text-primary placeholder:text-tertiary outline-none"
            data-testid="lift-search"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="absolute right-1 top-1/2 mt-1 -translate-y-1/2 w-9 h-9 flex items-center justify-center text-tertiary"
              aria-label={isCn ? '清空' : 'Clear'}
            >
              <X size={15} />
            </button>
          )}
        </div>
      )}

      {shown.length === 0 && (
        <p className="py-6 text-center text-small text-tertiary">{isCn ? '没有匹配的动作' : 'No matching exercises'}</p>
      )}

      {shown.map(lift => {
        const isStarred = !!starred[lift.baseName];
        const metric = chartMetricsFor(lift, getActiveMetrics(lift.baseName))[0];

        // 右边的大数：力量动作写最重那组「90×3」，其余写主指标的最好值
        let headline: string;
        if (lift.hasWeight && lift.best.weight?.set) {
          headline = formatSet(lift.best.weight.set, unit, lift.signed, isCn);
        } else {
          const m = metric === E1RM ? 'weight' : metric;
          const best = Math.max(...lift.sessions.map(s => sessionMetric(s, m) ?? -Infinity));
          headline = Number.isFinite(best) ? formatMetric(m, best, unit) : '—';
        }
        const headUnit = lift.hasWeight && lift.best.weight
          ? (lift.signed && Math.round(lift.best.weight.value * 10) === 0 ? '' : unit)
          : metricUnit(metric, unit);

        return (
          <div
            key={lift.key}
            className="flex items-center gap-2 border-b border-divider last:border-0"
            data-testid="lift-row"
          >
            <button
              type="button"
              onClick={() => onToggleStar(lift.baseName)}
              className={`-ml-2 w-9 h-12 flex-shrink-0 flex items-center justify-center ${isStarred ? 'text-accent' : 'text-tertiary'}`}
              aria-label={isCn ? (isStarred ? '取消收藏' : '收藏') : isStarred ? 'Unstar' : 'Star'}
            >
              <Star size={16} fill={isStarred ? 'currentColor' : 'none'} strokeWidth={1.75} />
            </button>
            <button
              type="button"
              onClick={() => onOpen(lift.key)}
              className="flex-1 min-w-0 flex items-center gap-3 py-3 text-left active:opacity-70"
            >
              <span className="flex-1 min-w-0">
                <span className="block font-semibold text-primary truncate">{lift.key}</span>
                <span className="block text-label text-tertiary">
                  {isCn ? '上次 ' : 'Last '}
                  {agoLabel(lift.lastTs, isCn)}
                  <span className="mx-1">·</span>
                  {lift.sessions.length} {isCn ? '场' : lift.sessions.length === 1 ? 'session' : 'sessions'}
                </span>
              </span>
              <span className="w-[76px] flex-shrink-0 text-right">
                <span className="block font-mono font-semibold text-primary tabular-nums leading-tight">{headline}</span>
                {headUnit && <span className="block text-micro font-normal text-tertiary uppercase leading-tight">{headUnit}</span>}
              </span>
            </button>
          </div>
        );
      })}
    </div>
  );
};
