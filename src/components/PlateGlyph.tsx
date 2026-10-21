/**
 * 器材图形 —— 「杠铃片」规格 docs/design-plates.md §3。
 *
 * 画 + 一块拖动区：改值的手势仍是 useValueScrub（组行重量格和这里的大图同一套），
 * 全 App 只有这里能用片子的颜色（--plate-*）。
 *
 * 杠铃按真实尺寸画（mm → 容器宽度，CSS 容器查询单位）：杠长、握把段、套筒、片子直径与厚度
 * 都来自 src/utils/plates.ts。片子按「登记那一组时的单位」算（磅片在 kg 显示下标 20.4）。
 *
 * 动效「上片」：外侧多出来的片从套筒外侧滑进来，拿掉的片往外滑走；
 * 共同的内层片不动（AnimatedStack 按前缀比对）。只动 transform / opacity。
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  BAR_GEOMETRY,
  BAR_LABEL,
  SHORT_BAR_DEFAULT,
  barWeight,
  convert,
  loadBarbell,
  loadSide,
  plateLabel,
  plateSpec,
  type BarChoice,
  type BarKind,
  type PlateUnit,
} from '../utils/plates';
import type { LoadKind } from '../hooks/useLoadKind';
import type { ExRounder } from '../hooks/useLoadRounder';
import { INC_CHOICES, sidePlates } from '../utils/loadable';

const fmt1 = (n: number) => (Math.round(n * 10) / 10).toString();

/* ── 一摞片：按前缀比对做进出动画 ───────────────────────────────── */

interface StackItem {
  w: number;
  key: number;
  leaving?: boolean;
}

function AnimatedStack({
  plates,
  plateUnit,
  display,
  numbers,
}: {
  plates: number[];
  plateUnit: PlateUnit;
  display: PlateUnit;
  numbers?: boolean;
}) {
  const seq = useRef(0);
  const [items, setItems] = useState<StackItem[]>(() => plates.map((w) => ({ w, key: seq.current++ })));
  const sig = `${plateUnit}:${plates.join(',')}`;

  useEffect(() => {
    setItems((prev) => {
      const live = prev.filter((i) => !i.leaving);
      let k = 0;
      while (k < live.length && k < plates.length && live[k].w === plates[k]) k++;
      if (k === live.length && k === plates.length) return prev;
      const kept = live.slice(0, k);
      const added = plates.slice(k).map((w) => ({ w, key: seq.current++ }));
      const gone = live.slice(k).map((i) => ({ ...i, leaving: true }));
      // 新上的片挨着内层，拿掉的片排在最外侧滑走：不会从新片底下穿过去
      return [...kept, ...added, ...gone];
    });
  }, [sig]);

  useEffect(() => {
    if (!items.some((i) => i.leaving)) return;
    const t = window.setTimeout(() => setItems((cur) => cur.filter((i) => !i.leaving)), 200);
    return () => window.clearTimeout(t);
  }, [items]);

  const live = items.filter((i) => !i.leaving).length;
  return (
    // --n：套筒上平分宽度用（片多时每片收窄，不挤出套筒）；6 片以上字号降一档
    <span className="plate-stack" style={{ ['--n' as string]: Math.max(1, live) }} data-crowded={live >= 6 ? '' : undefined}>
      {items.map((i) => {
        const s = plateSpec(plateUnit, i.w);
        if (!s) return null;
        return (
          <i
            key={i.key}
            className={`plate plate-${s.token}${i.leaving ? ' is-leaving' : ''}`}
            style={{ ['--thick' as string]: s.thick, ['--dia' as string]: s.dia }}
          >
            {/* 每片都印（2026-10-20 用户定）：以前只有 450 mm 的大片印字，小片要对着说明栏猜 */}
            {numbers && <b>{plateLabel(i.w, plateUnit, display)}</b>}
          </i>
        );
      })}
    </span>
  );
}

/* ── 杠铃（真实比例）───────────────────────────────────────────── */

export function BarbellGlyph({
  perSide,
  plateUnit,
  display,
  kind,
}: {
  perSide: number[];
  plateUnit: PlateUnit;
  display: PlateUnit;
  kind: BarKind;
}) {
  const g = BAR_GEOMETRY[kind];
  const half = (side: 'l' | 'r') => (
    <span className={`bar-side is-${side}`}>
      <span className="bar-collar" />
      <span className="bar-sleeve" />
      <span className="bar-load">
        <AnimatedStack plates={perSide} plateUnit={plateUnit} display={display} numbers />
      </span>
    </span>
  );
  return (
    <div className="bar-frame" aria-hidden>
      <div
        className="plate-bar"
        style={{
          ['--L' as string]: g.length,
          ['--S' as string]: g.shaft,
          ['--sleeve' as string]: g.sleeve,
          ['--shaft-dia' as string]: g.shaftDia,
          ['--sleeve-dia' as string]: g.sleeveDia,
        }}
      >
        <span className="bar-shaft" />
        {half('l')}
        {half('r')}
      </div>
    </div>
  );
}

/** 大图上改配重片刻度（这个馆这一台）：onSet(每格, 最轻一格)，最轻一格 0＝从 0 起 */
export interface StackCtl {
  /** 这场训练的馆：设置面底部「只改 X 的这一台」 */
  gym: string;
  overridden: boolean;
  onSet: (step: number, start: number) => void;
  onReset: () => void;
}

/* ── 配重片摞（器械 / 龙门架）─────────────────────────── */

export function PinStackGlyph({ value, step, start = 0 }: { value: number; step: number; start?: number }) {
  // 带起始的配重片（12.5 起、每格 5）：第 1 片就是最轻一格，往下每片 +一档
  const s0 = start > 0 ? start : 0;
  const at = s0 > 0 ? (value >= s0 - 1e-9 ? Math.round((value - s0) / step) + 1 : 0) : Math.max(0, Math.round(value / step));
  const n = Math.min(30, Math.max(16, at + 3));
  return (
    <div className="pin-stack" aria-hidden>
      {Array.from({ length: n }, (_, i) => {
        const idx = i + 1;
        // 只标插销那一格（2026-10-20 用户定：临近的数字没人看，还会和插销那格的字叠在一起）
        const label = idx === at ? fmt1(value) : '';
        return (
          <span key={idx} className={`pin-slab${idx < at ? ' is-up' : idx === at ? ' is-at' : ''}`}>
            <em>{label}</em>
            <i />
          </span>
        );
      })}
    </div>
  );
}

/* ── 哑铃：不上色，头的大小随重量 ─────────────────────────────── */

export function DumbbellGlyph({ value, unit }: { value: number; unit: PlateUnit }) {
  const max = unit === 'kg' ? 50 : 110;
  const s = 0.45 + (Math.min(Math.max(value, 0), max) / max) * 0.55;
  const head = <span className="db-head" style={{ transform: `scale(${0.6 + s * 0.5}, ${s})` }} />;
  // 每只的重量印在两头之间、握把上方（真哑铃的数字也在铃头上，这里头太窄，放握把上更好读）
  const one = (
    <span className="db-one">
      {head}
      <span className="db-grip">{value > 0 && <b className="db-num">{fmt1(value)}</b>}</span>
      {head}
    </span>
  );
  return (
    <div className="db-pair" aria-hidden>
      {one}
      {one}
    </div>
  );
}

/* ── 带符号负荷（自重）：负数画弹力带，正数挂腰片 ──────────────── */

export function SignedGlyph({ value, unit, plateUnit, belt: beltIn }: { value: number; unit: PlateUnit; plateUnit: PlateUnit; belt?: number[] }) {
  const span = unit === 'kg' ? 40 : 90;
  const pos = 50 + (Math.max(-span, Math.min(span, value)) / span) * 45;
  const belt = value > 0 ? beltIn ?? loadSide(convert(value, unit, plateUnit), plateUnit).perSide : [];
  return (
    <div className="signed-glyph" aria-hidden>
      <div className="signed-axis">
        <span className="signed-line" />
        <span className="signed-zero" />
        <span className="signed-mark" style={{ left: `${pos}%` }} />
        {/* 菱形上方写这一组的数：辅助 −20 / 自重 0 / 负重 +12.5 */}
        <b className="signed-num" style={{ left: `${pos}%` }}>
          {value > 0 ? `+${fmt1(value)}` : value < 0 ? `−${fmt1(-value)}` : '0'}
        </b>
      </div>
      <div className="signed-load">
        {value < 0 ? (
          <span className="signed-band" style={{ width: 28 + Math.min(-value, span) * (unit === 'kg' ? 2 : 0.9) }} />
        ) : value > 0 ? (
          <span className="signed-belt">
            <span className="signed-chain" />
            <span className="belt-frame">
              <AnimatedStack plates={belt} plateUnit={plateUnit} display={unit} numbers />
            </span>
          </span>
        ) : null}
      </div>
    </div>
  );
}

/* ── 一张卡顶部的器材图 + 说明 ────────────────────────────────── */

export function LoadHero({
  kind,
  value,
  unit,
  plateUnit,
  bar,
  onBarChange,
  isCn,
  pinStep,
  scrub,
  rounder,
  onPick,
  tare,
  stack,
}: {
  kind: LoadKind;
  /** 选中那一组的重量（显示单位，带符号） */
  value: number;
  /** 显示单位 */
  unit: PlateUnit;
  /** 这一组挂的是哪种片（登记时的单位） */
  plateUnit: PlateUnit;
  bar?: BarChoice;
  /** 改这个动作的杠（库里查不到的动作不传，杠名不可点） */
  onBarChange?: (bar: BarChoice) => void;
  isCn: boolean;
  pinStep: number;
  /** 大图本身也是拖动区（2026-10-18 用户定）：和数字格同一套 useValueScrub，改的是选中那一组 */
  scrub?: { handlers: Record<string, unknown>; scrubbing: boolean; step: number; axis: 'x' | 'y' };
  /**
   * 馆档案取整器（2026-10-18）：图按「这个馆的片子 + 当前单位」画；记的数挂不整时画最接近的配法，
   * 下面给上下两个能挂的重量（onPick 改成它）。绝不出现「配不出」。不传＝旧画法（标准片、按登记单位）。
   */
  rounder?: ExRounder | null;
  onPick?: (displayValue: number) => void;
  /** 挂片式器械在这个馆填过的空载（显示单位）：说明栏加「加空载共 x」，只做参考 */
  tare?: number;
  /** 配重片在这个馆这一台的「最轻一格 · 每格」：说明栏左边可点，就地改（没标馆的训练不传） */
  stack?: StackCtl;
}) {
  const [barOpen, setBarOpen] = useState(false);
  if (kind === 'plain') return null;
  if (rounder) return <GymHero {...{ kind, value, unit, bar, onBarChange, isCn, scrub, rounder, onPick, barOpen, setBarOpen, tare, stack }} />;

  const barKind: BarKind = bar?.kind ?? 'standard';
  const barW = barWeight(bar, plateUnit);
  const total = Math.round(convert(value, unit, plateUnit) * 20) / 20;
  const L = kind === 'plates' || kind === 'loaded' ? loadBarbell(total, plateUnit, kind === 'loaded' ? 0 : barW) : null;
  const u = unit === 'lbs' ? 'lb' : 'kg';

  let caption = '';
  let warn = false;
  if ((kind === 'plates' || kind === 'loaded') && L) {
    const sideTxt = L.perSide.map((w) => plateLabel(w, plateUnit, unit)).join(' + ');
    // 片子和显示单位不一致时点明挂的是哪种片（按 kg 登记的组在 lbs 下看 → 公斤片，反之磅片）
    const mixed =
      plateUnit !== unit
        ? isCn
          ? plateUnit === 'lbs' ? '（磅片）' : '（公斤片）'
          : plateUnit === 'lbs' ? ' (lb plates)' : ' (kg plates)'
        : '';
    if (L.underBar) {
      caption = isCn ? '比空杠还轻' : 'Lighter than the empty bar';
      warn = true;
    } else
      // 挂不整的余数不再报「配不出」（2026-10-18 用户定）：图上是凑得到的那部分，数照原样记
      caption = L.perSide.length
        ? isCn
          ? `每边 ${sideTxt} ${u}${mixed}`
          : `Per side ${sideTxt} ${u}${mixed}`
        : isCn
          ? '空杠'
          : 'Empty bar';
  } else if (kind === 'pin') caption = ''; // 插销那格已经写着重量，不再重复一句
  else if (kind === 'pair') caption = isCn ? `每只 ${fmt1(value)} ${u}` : `${fmt1(value)} ${u} each`;
  else if (kind === 'signed') {
    if (value < 0) caption = isCn ? `辅助 ${fmt1(-value)} ${u}` : `Assisted ${fmt1(-value)} ${u}`;
    else if (value === 0) caption = isCn ? '纯自重' : 'Bodyweight';
    else {
      const belt = loadSide(convert(value, unit, plateUnit), plateUnit).perSide.map((w) => plateLabel(w, plateUnit, unit));
      caption = isCn ? `腰挂 ${belt.join(' + ')} ${u}` : `Belt ${belt.join(' + ')} ${u}`;
    }
  }

  const barName = isCn ? BAR_LABEL[barKind].cn : BAR_LABEL[barKind].en;
  const barTxt = `${barName} ${plateLabel(barW, plateUnit, unit)} ${u}`;
  const shortU: PlateUnit = bar?.kind === 'short' ? (bar.unit ?? plateUnit) : plateUnit;
  const shortW = bar?.kind === 'short' ? (bar.weight ?? SHORT_BAR_DEFAULT[shortU]) : SHORT_BAR_DEFAULT[plateUnit];
  const pick = (k: BarKind) =>
    onBarChange?.(k === 'short' ? { kind: 'short', weight: shortW, unit: shortU } : { kind: k });

  return (
    <div className={`load-hero is-${kind}${scrub?.scrubbing ? ' is-scrubbing' : ''}`} data-testid="load-hero">
      {/* 拖动区只包图形；下面的说明栏里有按钮，不能被拖动手势吃掉 */}
      <div
        className={`load-hero-drag${scrub ? ` is-draggable is-axis-${scrub.axis}` : ''}`}
        {...(scrub ? scrub.handlers : {})}
      >
        {scrub?.scrubbing && (
          <span className="load-hero-step" aria-hidden>
            ×{scrub.step}
          </span>
        )}
        {(kind === 'plates' || kind === 'loaded') && L && <BarbellGlyph perSide={L.perSide} plateUnit={plateUnit} display={unit} kind={barKind} />}
        {kind === 'pin' && <PinStackGlyph value={value} step={pinStep} />}
        {kind === 'pair' && <DumbbellGlyph value={value} unit={unit} />}
        {kind === 'signed' && <SignedGlyph value={value} unit={unit} plateUnit={plateUnit} />}
      </div>
      <div className="load-caption-row">
        {kind === 'plates' && (
          <button
            type="button"
            className="bar-chip"
            onClick={() => onBarChange && setBarOpen((o) => !o)}
            disabled={!onBarChange}
            aria-expanded={barOpen}
            data-testid="bar-chip"
          >
            {barTxt}
          </button>
        )}
        {caption && <p className={`load-caption${warn ? ' is-warn' : ''}`}>{caption}</p>}
      </div>
      {barOpen && kind === 'plates' && onBarChange && (
        <div className="bar-menu" role="group" aria-label={isCn ? '这个动作用哪根杠' : 'Bar for this exercise'}>
          {(['standard', 'women', 'short'] as BarKind[]).map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={barKind === k}
              onClick={() => {
                pick(k);
                if (k !== 'short') setBarOpen(false);
              }}
            >
              {isCn ? BAR_LABEL[k].cn : BAR_LABEL[k].en}
              <small>
                {k === 'short'
                  ? `${fmt1(shortW)} ${shortU === 'lbs' ? 'lb' : 'kg'}`
                  : `${plateLabel(barWeight({ kind: k }, plateUnit), plateUnit, unit)} ${u}`}
              </small>
            </button>
          ))}
          {barKind === 'short' && (
            <span className="bar-short-w">
              <button
                type="button"
                aria-label={isCn ? '短杠轻一点' : 'Lighter short bar'}
                onClick={() => onBarChange({ kind: 'short', unit: shortU, weight: Math.max(1, shortW - (shortU === 'kg' ? 0.5 : 1)) })}
              >
                −
              </button>
              <b>{fmt1(shortW)}</b>
              <button
                type="button"
                aria-label={isCn ? '短杠重一点' : 'Heavier short bar'}
                onClick={() => onBarChange({ kind: 'short', unit: shortU, weight: shortW + (shortU === 'kg' ? 0.5 : 1) })}
              >
                ＋
              </button>
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * 有馆档案时的大图（docs/design-plates.md §3「馆档案」，示意 docs/demos/gym-workbench.html）：
 *   - 单位就是片子：一律按当前单位、这个馆有的片画（做完时挂的是另一种片，组行上另有标注）
 *   - 记的数挂不整（手打的 61、换算来的 132.28）：图上画最接近的配法，说明写「按 61 kg 记 · 图上是最接近的配法」，
 *     再给上下两个能挂的重量，点一下改成它
 *   - 挂片式器械（史密斯、倒蹬…）照杠铃算，只算片子（没有空杠）
 */
function GymHero({
  kind,
  value,
  unit,
  bar,
  onBarChange,
  isCn,
  scrub,
  rounder,
  onPick,
  barOpen,
  setBarOpen,
  tare,
  stack,
}: {
  kind: LoadKind;
  value: number;
  unit: PlateUnit;
  bar?: BarChoice;
  onBarChange?: (bar: BarChoice) => void;
  isCn: boolean;
  scrub?: { handlers: Record<string, unknown>; scrubbing: boolean; step: number; axis: 'x' | 'y' };
  rounder: ExRounder;
  onPick?: (displayValue: number) => void;
  barOpen: boolean;
  setBarOpen: (f: (o: boolean) => boolean) => void;
  tare?: number;
  stack?: StackCtl;
}) {
  const ctx = rounder.ctx;
  const [stackOpen, setStackOpen] = useState(false);
  const stackStart = ctx.start && ctx.start > 0 ? ctx.start : 0;
  const [startText, setStartText] = useState('');
  useEffect(() => setStartText(String(stackStart > 0 ? stackStart : ctx.inc)), [stackStart, ctx.inc, stackOpen]);
  const u = unit === 'lbs' ? 'lb' : 'kg';
  const fmt = (n: number) => (Math.round(n * 100) / 100).toString();
  // 0＝还没填：不算「挂不整」，图上画空杠 / 空着，不给两档
  const empty = Math.abs(value) < 1e-9;
  const onGrid = empty || rounder.loadableD(value);
  const v = onGrid ? value : rounder.snapD(value);
  const barKind: BarKind = bar?.kind ?? 'standard';
  const isBar = kind === 'plates' || kind === 'loaded';
  const base = kind === 'plates' ? ctx.bar : 0;
  const perSide = isBar && v > base + 1e-9 ? sidePlates((v - base) / 2, ctx.plates, unit) : [];
  const belt = kind === 'signed' && v > 0 ? sidePlates(v, ctx.plates, unit) : [];
  const near = onGrid ? null : rounder.bracketD(value);

  // 最轻一格：填的就是最轻那片的重量（也是下限）；恰好等于一档时调用方不单独存
  const commitStart = () => {
    if (!stack) return;
    const n = Number.parseFloat(startText.trim().replace(',', '.'));
    const cur = stackStart > 0 ? stackStart : ctx.inc;
    if (!Number.isFinite(n) || n <= 0 || n > 500) {
      setStartText(String(cur));
      return;
    }
    if (Math.abs(n - cur) < 1e-9) return;
    stack.onSet(ctx.inc, n);
  };
  const nudgeStart = (dir: 1 | -1) => {
    if (!stack) return;
    const cur = stackStart > 0 ? stackStart : ctx.inc;
    const next = Math.round((cur + dir * (unit === 'lbs' ? 0.5 : 0.25)) * 100) / 100;
    if (next <= 0) return;
    stack.onSet(ctx.inc, next);
  };
  const stepStack = (dir: 1 | -1) => {
    if (!stack) return;
    const list = INC_CHOICES[unit];
    const nextV = dir > 0 ? list.find(x => x > ctx.inc + 1e-9) : [...list].reverse().find(x => x < ctx.inc - 1e-9);
    if (nextV === undefined) return;
    stack.onSet(nextV, stackStart);
  };

  let caption = '';
  if (isBar) {
    caption = perSide.length
      ? isCn ? `每边 ${perSide.map(fmt).join(' + ')} ${u}` : `Per side ${perSide.map(fmt).join(' + ')} ${u}`
      : kind === 'plates'
        ? isCn ? '空杠' : 'Empty bar'
        : isCn ? '还没挂片' : 'No plates yet';
    // 记录只算片子；填过空载的，说明里给个总数做参考（design-plates.md「换馆重量」空载）
    if (kind === 'loaded')
      caption +=
        tare !== undefined
          ? isCn ? ` · 加空载共 ${fmt(v + tare)} ${u}` : ` · ${fmt(v + tare)} ${u} with the sled`
          : isCn ? ' · 只算片子' : ' · plates only';
  } else if (kind === 'pin') caption = ''; // 插销那格已经写着重量，不再重复一句（2026-10-20 用户定）
  else if (kind === 'pair') caption = isCn ? `每只 ${fmt(v)} ${u}` : `${fmt(v)} ${u} each`;
  else if (kind === 'signed') {
    if (v < 0) caption = isCn ? `辅助 ${fmt(-v)} ${u}` : `Assisted ${fmt(-v)} ${u}`;
    else if (v === 0) caption = isCn ? '纯自重' : 'Bodyweight';
    else caption = isCn ? `腰挂 ${belt.map(fmt).join(' + ')} ${u}` : `Belt ${belt.map(fmt).join(' + ')} ${u}`;
  }
  if (empty && kind !== 'signed') caption = isCn ? '还没填重量' : 'No weight yet';
  if (near) {
    const shown = kind === 'signed' && value < 0 ? `${isCn ? '辅助 ' : 'assisted '}${fmt(-value)}` : fmt(Math.abs(value));
    caption = isCn ? `按 ${shown} ${u} 记 · 图上是最接近的配法` : `Logged as ${shown} ${u} · drawn as the closest load`;
  }

  const barName = isCn ? BAR_LABEL[barKind].cn : BAR_LABEL[barKind].en;
  const barTxt = `${barName} ${fmt(ctx.bar)} ${u}`;
  const shortU: PlateUnit = bar?.kind === 'short' ? (bar.unit ?? unit) : unit;
  const shortW = bar?.kind === 'short' ? (bar.weight ?? SHORT_BAR_DEFAULT[shortU]) : SHORT_BAR_DEFAULT[unit];
  const pick = (k: BarKind) =>
    onBarChange?.(k === 'short' ? { kind: 'short', weight: shortW, unit: shortU } : { kind: k });
  const nearLabel = (n: number) => (kind === 'signed' && n < 0 ? `${isCn ? '辅助 ' : '−'}${fmt(-n)}` : fmt(n));

  const faceOpen = stackOpen && kind === 'pin' && !!stack;
  const lightest = stackStart > 0 ? stackStart : ctx.inc;

  return (
    <div className={`load-hero is-${kind}${scrub?.scrubbing ? ' is-scrubbing' : ''}${faceOpen ? ' is-face' : ''}`} data-testid="load-hero">
      {kind === 'pin' && stack && !faceOpen && (
        <div className="stack-tagrow">
          <button type="button" className="stack-tag" onClick={() => setStackOpen(() => true)} aria-expanded={false} data-testid="stack-chip">
            <svg viewBox="0 0 24 24" aria-hidden><path d="M4 20h4L19 9l-4-4L4 16v4z" /></svg>
            {isCn ? `${fmt(lightest)} 起 · 每格 ${fmt(ctx.inc)} ${u}` : `From ${fmt(lightest)} · +${fmt(ctx.inc)} ${u}`}
          </button>
        </div>
      )}
      {faceOpen && stack ? (
        <div className="stack-face" role="group" aria-label={isCn ? '这台的刻度' : 'This stack'} data-testid="stack-menu">
          <div className="stack-fhead">
            <div>
              <b>{isCn ? '这台的刻度' : 'This stack'}</b>
              <small>{isCn ? '插销能插的重量' : 'Weights the pin can select'}</small>
            </div>
            <button type="button" className="stack-done" onClick={() => setStackOpen(() => false)} data-testid="stack-done">
              {isCn ? '完成' : 'Done'}
            </button>
          </div>
          <div className="stack-stp">
            <span>{isCn ? '最轻一格' : 'Lightest'}</span>
            <span className="stack-seg">
              <button type="button" aria-label={isCn ? '最轻一格轻一点' : 'Lighter'} onClick={() => nudgeStart(-1)} data-testid="stack-start-dec">−</button>
              <input
                inputMode="decimal"
                value={startText}
                onChange={e => setStartText(e.target.value)}
                onFocus={e => e.target.select()}
                onBlur={() => commitStart()}
                onKeyDown={e => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                }}
                data-testid="stack-start"
                aria-label={isCn ? '最轻一格多重' : 'Lightest plate weight'}
              />
              <small>{u}</small>
              <button type="button" aria-label={isCn ? '最轻一格重一点' : 'Heavier'} onClick={() => nudgeStart(1)} data-testid="stack-start-inc">＋</button>
            </span>
          </div>
          <div className="stack-stp">
            <span>{isCn ? '每格' : 'Step'}</span>
            <span className="stack-seg">
              <button type="button" aria-label={isCn ? '每格轻一点' : 'Smaller step'} onClick={() => stepStack(-1)} data-testid="stack-step-dec">−</button>
              <b>{fmt(ctx.inc)}</b>
              <small>{u}</small>
              <button type="button" aria-label={isCn ? '每格重一点' : 'Bigger step'} onClick={() => stepStack(1)} data-testid="stack-step-inc">＋</button>
            </span>
          </div>
          <div className="stack-mini" aria-hidden>
            {Array.from({ length: 7 }, (_, i) => (
              <i key={i} className={i === 0 ? 'is-first' : ''}>{fmt(lightest + i * ctx.inc)}</i>
            ))}
            <span>…</span>
          </div>
          <div className="stack-foot">
            <span>{isCn ? `只改 ${stack.gym} 的这一台` : `Only this machine at ${stack.gym}`}</span>
            {stack.overridden && (
              <button type="button" onClick={() => stack.onReset()} data-testid="stack-reset">
                {isCn ? '恢复馆默认' : 'Use gym default'}
              </button>
            )}
          </div>
        </div>
      ) : (
        <>
          <div
            className={`load-hero-drag${scrub ? ` is-draggable is-axis-${scrub.axis}` : ''}`}
            {...(scrub ? scrub.handlers : {})}
          >
            {scrub?.scrubbing && (
              <span className="load-hero-step" aria-hidden>
                ×{fmt(rounder.stepD(v) * scrub.step)}
              </span>
            )}
            {isBar && <BarbellGlyph perSide={perSide} plateUnit={unit} display={unit} kind={kind === 'loaded' ? 'standard' : barKind} />}
            {kind === 'pin' && <PinStackGlyph value={v} step={ctx.inc > 0 ? ctx.inc : 1} start={stackStart} />}
            {kind === 'pair' && <DumbbellGlyph value={v} unit={unit} />}
            {kind === 'signed' && <SignedGlyph value={v} unit={unit} plateUnit={unit} belt={belt} />}
          </div>
          <div className="load-caption-row">
            {kind === 'plates' && (
              <button
                type="button"
                className="bar-chip"
                onClick={() => onBarChange && setBarOpen((o) => !o)}
                disabled={!onBarChange}
                aria-expanded={barOpen}
                data-testid="bar-chip"
              >
                {barTxt}
              </button>
            )}
            {caption && <p className="load-caption" data-testid="load-caption">{caption}</p>}
          </div>
          {near && onPick && (
            <div className="load-near" data-testid="load-near">
              <span>{isCn ? '改成能挂的：' : 'Snap to:'}</span>
              {[near.lo, ...(near.hi !== near.lo ? [near.hi] : [])].map((n) => (
                <button key={n} type="button" onClick={() => onPick(n)}>
                  {nearLabel(n)}
                </button>
              ))}
            </div>
          )}
        </>
      )}
      {barOpen && kind === 'plates' && onBarChange && (
        <div className="bar-menu" role="group" aria-label={isCn ? '这个动作用哪根杠' : 'Bar for this exercise'}>
          {(['standard', 'women', 'short'] as BarKind[]).map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={barKind === k}
              onClick={() => {
                pick(k);
                if (k !== 'short') setBarOpen(() => false);
              }}
            >
              {isCn ? BAR_LABEL[k].cn : BAR_LABEL[k].en}
              <small>
                {k === 'short'
                  ? `${fmt1(shortW)} ${shortU === 'lbs' ? 'lb' : 'kg'}`
                  : `${fmt(barWeight({ kind: k }, unit))} ${u}`}
              </small>
            </button>
          ))}
          {barKind === 'short' && (
            <span className="bar-short-w">
              <button
                type="button"
                aria-label={isCn ? '短杠轻一点' : 'Lighter short bar'}
                onClick={() => onBarChange({ kind: 'short', unit: shortU, weight: Math.max(1, shortW - (shortU === 'kg' ? 0.5 : 1)) })}
              >
                −
              </button>
              <b>{fmt1(shortW)}</b>
              <button
                type="button"
                aria-label={isCn ? '短杠重一点' : 'Heavier short bar'}
                onClick={() => onBarChange({ kind: 'short', unit: shortU, weight: shortW + (shortU === 'kg' ? 0.5 : 1) })}
              >
                ＋
              </button>
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export default LoadHero;
