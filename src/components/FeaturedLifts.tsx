/**
 * 「按动作」顶上的特别关注：最在乎的几个动作（默认三大项），用来回顾成绩、给人成就感。
 *
 * 收藏管「常练、排前面」，会有很多；这里只放最多 4 个，每张卡片讲三件事：
 *   - 最好成绩（大字，只升不降）
 *   - 相比第一次练涨了多少（跟当初的自己比，不跟别人比）
 *   - 最近破纪录了没有：30 天内破过就高亮；很久没破只写灰字的「上次破纪录 N 前」，
 *     不写「已经 N 个月没进步」这种泄气话
 * 三大项都在、都练过时，顶上再给三项总和、体重倍数和半年前的总和。
 */
import React, { useMemo, useState } from 'react';
import { Check, Flame } from 'lucide-react';
import { Modal } from './Modal';
import { Language, WeightEntry } from '../../types';
import { MAX_FEATURED } from '../../services/appPrefs';
import {
  BIG_THREE,
  E1RM,
  type FeaturedStats,
  type LiftSummary,
  bestAsOf,
  chartMetricsFor,
  featuredStats,
} from '../utils/liftHistory';
import { agoLabel, formatLoad, formatSet, metricLabel, shortDate, toDisplay, trimNum } from '../utils/liftDisplay';
import { KG_TO_LBS } from '../constants';

const DAY = 86400000;
/** 多少天内破过纪录算「最近」（高亮） */
const HOT_DAYS = 30;
/** 三项总和跟多久之前比 */
const COMPARE_DAYS = 183;

/** 阶梯纪录线缩略图 */
function StepSpark({ steps }: { steps: FeaturedStats['steps'] }) {
  const w = 96;
  const h = 34;
  if (steps.length < 2) return <span style={{ width: w }} aria-hidden />;
  const t0 = steps[0].ts;
  const t1 = Date.now();
  const lo = steps[0].best;
  const hi = steps[steps.length - 1].best;
  const x = (t: number) => ((t - t0) / (t1 - t0 || 1)) * (w - 4) + 1;
  const y = (v: number) => h - 3 - ((v - lo) / (hi - lo || 1)) * (h - 8);
  let d = `M${x(steps[0].ts)},${y(steps[0].best)}`;
  for (let i = 1; i < steps.length; i++) d += ` H${x(steps[i].ts)} V${y(steps[i].best)}`;
  d += ` H${x(t1)}`;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="flex-shrink-0 text-accent" aria-hidden>
      <path d={d} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" />
      <circle cx={x(t1)} cy={y(hi)} r={2.5} fill="currentColor" />
    </svg>
  );
}

interface FeaturedLiftsProps {
  lifts: LiftSummary[];
  /** 用户选过的稳定键；null＝没设过，用三大项 */
  chosen: string[] | null;
  onChange: (ids: string[]) => void;
  /** 按最重的一组算，还是按估算 1RM 算 */
  mode: 'weight' | 'e1rm';
  onModeChange: (mode: 'weight' | 'e1rm') => void;
  onOpen: (key: string) => void;
  getActiveMetrics: (baseName: string) => string[];
  weightEntries: WeightEntry[];
  lang: Language;
  unit: 'kg' | 'lbs';
}

export const FeaturedLifts: React.FC<FeaturedLiftsProps> = ({
  lifts,
  chosen,
  onChange,
  mode,
  onModeChange,
  onOpen,
  getActiveMetrics,
  weightEntries,
  lang,
  unit,
}) => {
  const isCn = lang === Language.CN;
  const [editing, setEditing] = useState(false);
  const ids = chosen ?? BIG_THREE;

  const byId = useMemo(() => new Map(lifts.map(l => [l.stableId, l])), [lifts]);
  const featured = ids.map(id => byId.get(id)).filter((l): l is LiftSummary => !!l);

  // 1RM 模式下能估的（普通负重动作）换成估算 1RM；自重 / 带号的动作估不了，照旧按默认指标
  const canE1rm = (l: LiftSummary) => l.hasWeight && !l.signed && !!l.best.e1rm;
  const cards = featured
    .map(lift => {
      const metric = mode === 'e1rm' && canE1rm(lift) ? E1RM : chartMetricsFor(lift, getActiveMetrics(lift.baseName))[0];
      const stats = featuredStats(lift, metric);
      return stats ? { lift, stats } : null;
    })
    .filter((c): c is { lift: LiftSummary; stats: FeaturedStats } => !!c);

  // 三项总和：三大项都在特别关注里、都练过，才有意义。1RM 模式加的是三项各自的估算 1RM
  const total = useMemo(() => {
    if (!BIG_THREE.every(id => ids.includes(id))) return null;
    const three = BIG_THREE.map(id => byId.get(id));
    const metric = mode === 'e1rm' ? E1RM : 'weight';
    const rec = (l: LiftSummary) => (mode === 'e1rm' ? l.best.e1rm : l.best.weight);
    if (three.some(l => !l || l.signed || !rec(l))) return null;
    const now = three.reduce((n, l) => n + rec(l!)!.value, 0);
    const then = Date.now() - COMPARE_DAYS * DAY;
    const past = three.map(l => bestAsOf(l!, metric, then));
    const pastTotal = past.every(v => v != null) ? past.reduce((n, v) => n + v!, 0) : null;
    const latestBw = [...weightEntries].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0];
    return {
      now,
      pastTotal: pastTotal != null && pastTotal < now ? pastTotal : null,
      ratio: latestBw?.weight ? now / latestBw.weight : null,
    };
  }, [ids, byId, weightEntries, mode]);

  const toUnit = (kg: number) => trimNum(unit === 'lbs' ? kg * KG_TO_LBS : kg);

  // 一个都没有（默认三大项都还没练过 / 选的动作都删光了）：只留一条入口，别占一大块
  if (cards.length === 0) {
    if (lifts.length === 0) return null;
    return (
      <>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="ui-card w-full px-4 py-3 text-left text-sm text-secondary active:opacity-70"
          data-testid="featured-empty"
        >
          <span className="font-semibold text-primary">{isCn ? '特别关注' : 'Spotlight'}</span>
          <span className="mx-2">·</span>
          {isCn ? '挑几个最在乎的动作，放在这里看成绩' : 'Pick the lifts you care about most'}
        </button>
        <FeaturedEditor
          open={editing}
          onClose={() => setEditing(false)}
          lifts={lifts}
          ids={ids}
          onSave={onChange}
          lang={lang}
          unit={unit}
        />
      </>
    );
  }

  return (
    <div className="ui-card px-4 pt-3 pb-1" data-testid="featured-lifts">
      <div className="flex items-center justify-between gap-2">
        <span className="ui-section-label">{isCn ? '特别关注' : 'Spotlight'}</span>
        <span className="flex-1" />
        <div className="flex gap-0.5 bg-inset rounded-control p-0.5" role="group" data-testid="featured-mode">
          {(['weight', 'e1rm'] as const).map(m => (
            <button
              key={m}
              type="button"
              onClick={() => onModeChange(m)}
              aria-pressed={mode === m}
              className={`px-2 py-0.5 rounded-chip text-xs font-semibold ${mode === m ? 'seg-on' : 'text-tertiary'}`}
            >
              {m === 'weight' ? (isCn ? '最重' : 'Heaviest') : isCn ? '估算 1RM' : 'Est. 1RM'}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="-mr-2 px-2 py-1 text-xs font-semibold text-tertiary active:opacity-70"
          data-testid="featured-edit"
        >
          {isCn ? '编辑' : 'Edit'}
        </button>
      </div>

      {total && (
        <div className="pt-1 pb-3" data-testid="featured-total">
          <div className="flex items-baseline gap-2">
            <span className="font-mono font-bold text-[30px] leading-none text-primary tabular-nums">{toUnit(total.now)}</span>
            <span className="text-sm text-secondary">
              {unit} · {mode === 'e1rm' ? (isCn ? '三项 1RM 总和' : 'Big 3 est. 1RM total') : isCn ? '三项总和' : 'Big 3 total'}
            </span>
          </div>
          {(total.ratio || total.pastTotal) && (
            <div className="text-xs text-secondary mt-1.5">
              {total.ratio && (isCn ? `体重的 ${trimNum(total.ratio)} 倍` : `${trimNum(total.ratio)}× bodyweight`)}
              {total.ratio && total.pastTotal && <span className="mx-1">·</span>}
              {total.pastTotal && (isCn ? `半年前是 ${toUnit(total.pastTotal)} ${unit}` : `${toUnit(total.pastTotal)} ${unit} six months ago`)}
            </div>
          )}
        </div>
      )}

      {cards.map(({ lift, stats }) => {
        const isE1rm = stats.metric === E1RM;
        const isLoad = stats.metric === 'weight' || isE1rm;
        const gain = stats.best - stats.first;
        const hot = stats.lastPrTs != null && Date.now() - stats.lastPrTs <= HOT_DAYS * DAY;
        const big = isLoad
          ? formatLoad(stats.best, unit, lift.signed, isCn)
          : trimNum(toDisplay(stats.metric, stats.best, unit));
        // 大数后面的小字：重量写「kg ×5」，次数写「次」，其他指标写指标名
        // 估算 1RM 后面带上它是从哪一组推出来的（「kg · 85×8」），知道这个数的来历
        const bigSuffix = isE1rm
          ? `${unit}${stats.bestSet ? ` · ${formatSet(stats.bestSet, unit, false, isCn)}` : ''}`
          : isLoad
          ? `${lift.signed && Math.round(stats.best * 10) === 0 ? '' : unit}${stats.bestSet && stats.bestSet.reps > 0 ? ` ×${stats.bestSet.reps}` : ''}`
          : stats.metric === 'reps'
            ? (isCn ? '次' : 'reps')
            : metricLabel(stats.metric, lang);
        const firstLabel = isLoad ? formatLoad(stats.first, unit, lift.signed, isCn) : trimNum(toDisplay(stats.metric, stats.first, unit));
        const gainLabel = isLoad
          ? `+${toUnit(gain)} ${unit}`
          : `+${trimNum(toDisplay(stats.metric, gain, unit))}${stats.metric === 'reps' ? (isCn ? ' 次' : ' reps') : ''}`;

        return (
          <button
            key={lift.key}
            type="button"
            onClick={() => onOpen(lift.key)}
            className="w-full flex items-center gap-3 py-3 border-t border-divider text-left active:opacity-70"
            data-testid="featured-card"
          >
            <span className="flex-1 min-w-0">
              <span className="block text-sm text-secondary truncate">{lift.key}</span>
              <span className="flex items-baseline gap-1">
                <span className="font-mono font-bold text-2xl leading-tight text-primary tabular-nums">{big}</span>
                <span className="text-xs text-secondary">{bigSuffix}</span>
              </span>
              <span className="block text-xs mt-0.5">
                {gain > 0 ? (
                  <>
                    <span className="font-semibold text-accent tabular-nums">{gainLabel}</span>
                    <span className="text-tertiary"> · {isCn ? '起步' : 'from'} {firstLabel}</span>
                  </>
                ) : (
                  <span className="text-tertiary">
                    {isCn ? '首次记录 ' : 'First logged '}
                    {shortDate(stats.firstTs, isCn)}
                  </span>
                )}
              </span>
              {stats.lastPrTs != null && (
                <span className={`flex items-center gap-1 text-[11px] mt-1 ${hot ? 'text-warning font-semibold' : 'text-tertiary'}`}>
                  {hot && <Flame size={12} strokeWidth={2} />}
                  {hot
                    ? isCn
                      ? Date.now() - stats.lastPrTs <= 7 * DAY
                        ? `${agoLabel(stats.lastPrTs, isCn)}刚破纪录`
                        : `${agoLabel(stats.lastPrTs, isCn)}破了纪录`
                      : `New PR ${agoLabel(stats.lastPrTs, isCn)}`
                    : isCn
                      ? `上次破纪录 ${agoLabel(stats.lastPrTs, isCn)}`
                      : `Last PR ${agoLabel(stats.lastPrTs, isCn)}`}
                  {stats.prCount > 1 && (
                    <span className="text-tertiary font-normal">
                      {' · '}
                      {isCn ? `共破 ${stats.prCount} 次` : `${stats.prCount} PRs`}
                    </span>
                  )}
                </span>
              )}
            </span>
            <StepSpark steps={stats.steps} />
          </button>
        );
      })}

      {mode === 'e1rm' && (
        <p className="text-[11px] text-tertiary leading-snug border-t border-divider py-2.5">
          {isCn
            ? '估算 1RM＝重量 ×（1 + 次数 / 30），只看 12 次以内的组。是推算出来的上限，不是真测过的。'
            : 'Est. 1RM = weight × (1 + reps / 30), using sets of 12 reps or fewer. An estimate, not a tested max.'}
        </p>
      )}

      <FeaturedEditor
        open={editing}
        onClose={() => setEditing(false)}
        lifts={lifts}
        ids={ids}
        onSave={onChange}
        lang={lang}
        unit={unit}
      />
    </div>
  );
};

interface FeaturedEditorProps {
  open: boolean;
  onClose: () => void;
  lifts: LiftSummary[];
  ids: string[];
  onSave: (ids: string[]) => void;
  lang: Language;
  unit: 'kg' | 'lbs';
}

/** 选特别关注：勾选顺序就是显示顺序，最多 MAX_FEATURED 个 */
function FeaturedEditor({ open, onClose, lifts, ids, onSave, lang, unit }: FeaturedEditorProps) {
  const isCn = lang === Language.CN;
  const [draft, setDraft] = useState<string[]>(ids);
  const [lastOpen, setLastOpen] = useState(false);
  // 每次打开都从当前值起草
  if (open && !lastOpen) {
    setLastOpen(true);
    setDraft(ids);
  } else if (!open && lastOpen) {
    setLastOpen(false);
  }

  // 已选的排前面（按选择顺序），其余按最近练过
  const sorted = useMemo(() => {
    const rest = lifts.filter(l => !draft.includes(l.stableId)).sort((a, b) => b.lastTs - a.lastTs);
    const picked = draft.map(id => lifts.find(l => l.stableId === id)).filter((l): l is LiftSummary => !!l);
    return [...picked, ...rest];
    // 只在打开时排一次，勾选时不跳行
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lifts, open]);

  const full = draft.length >= MAX_FEATURED;
  const toggle = (id: string) =>
    setDraft(d => (d.includes(id) ? d.filter(x => x !== id) : d.length >= MAX_FEATURED ? d : [...d, id]));

  return (
    <Modal
      isOpen={open}
      onClose={onClose}
      variant="sheet"
      size="full"
      title={isCn ? '特别关注' : 'Spotlight'}
      subtitle={isCn ? `最多 ${MAX_FEATURED} 个，按勾选的顺序排列` : `Up to ${MAX_FEATURED}, shown in the order you pick`}
      className="max-h-[85dvh] flex flex-col"
      bodyClassName="flex-1 min-h-0 overflow-y-auto custom-scrollbar"
      testId="featured-editor"
      footer={
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setDraft(BIG_THREE.filter(id => lifts.some(l => l.stableId === id)))}
            className="flex-1 min-h-[44px] rounded-control bg-inset text-sm font-semibold text-secondary"
          >
            {isCn ? '恢复三大项' : 'Reset to Big 3'}
          </button>
          <button
            type="button"
            onClick={() => {
              onSave(draft);
              onClose();
            }}
            className="flex-1 min-h-[44px] ui-btn-primary text-sm"
            data-testid="featured-save"
          >
            {isCn ? '保存' : 'Save'}
          </button>
        </div>
      }
    >
      {sorted.map(l => {
        const order = draft.indexOf(l.stableId);
        const on = order >= 0;
        return (
          <button
            key={l.stableId}
            type="button"
            onClick={() => toggle(l.stableId)}
            disabled={!on && full}
            className={`w-full flex items-center gap-3 py-3 border-b border-divider last:border-0 text-left ${!on && full ? 'opacity-40' : 'active:opacity-70'}`}
          >
            <span
              className={`w-6 h-6 flex-shrink-0 rounded-chip flex items-center justify-center text-xs font-bold ${
                on ? 'bg-accent text-on-accent' : 'border border-divider text-transparent'
              }`}
            >
              {on ? order + 1 : <Check size={12} />}
            </span>
            <span className="flex-1 min-w-0 truncate text-primary">{l.key}</span>
            {l.best.weight?.set && l.hasWeight && (
              <span className="font-mono text-sm text-tertiary tabular-nums">
                {formatSet(l.best.weight.set, unit, l.signed, isCn)}
              </span>
            )}
          </button>
        );
      })}
    </Modal>
  );
}
