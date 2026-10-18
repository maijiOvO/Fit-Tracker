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

  return (
    <span className="plate-stack">
      {items.map((i) => {
        const s = plateSpec(plateUnit, i.w);
        if (!s) return null;
        return (
          <i
            key={i.key}
            className={`plate plate-${s.token}${i.leaving ? ' is-leaving' : ''}`}
            style={{ ['--thick' as string]: s.thick, ['--dia' as string]: s.dia }}
          >
            {numbers && s.dia >= 400 && <b>{plateLabel(i.w, plateUnit, display)}</b>}
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

/* ── 配重片摞（器械 / 龙门架 / 绳索）─────────────────────────── */

export function PinStackGlyph({ value, step }: { value: number; step: number }) {
  const at = Math.max(0, Math.round(value / step));
  const n = Math.min(30, Math.max(16, at + 3));
  const every = n > 20 ? 4 : 3;
  return (
    <div className="pin-stack" aria-hidden>
      {Array.from({ length: n }, (_, i) => {
        const idx = i + 1;
        return (
          <span key={idx} className={`pin-slab${idx < at ? ' is-up' : idx === at ? ' is-at' : ''}`}>
            <em>{idx % every === 0 ? idx * step : ''}</em>
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
  const one = (
    <span className="db-one">
      {head}
      <span className="db-grip" />
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

export function SignedGlyph({ value, unit, plateUnit }: { value: number; unit: PlateUnit; plateUnit: PlateUnit }) {
  const span = unit === 'kg' ? 40 : 90;
  const pos = 50 + (Math.max(-span, Math.min(span, value)) / span) * 45;
  const belt = value > 0 ? loadSide(convert(value, unit, plateUnit), plateUnit).perSide : [];
  return (
    <div className="signed-glyph" aria-hidden>
      <div className="signed-axis">
        <span className="signed-line" />
        <span className="signed-zero" />
        <span className="signed-mark" style={{ left: `${pos}%` }} />
      </div>
      <div className="signed-load">
        {value < 0 ? (
          <span className="signed-band" style={{ width: 28 + Math.min(-value, span) * (unit === 'kg' ? 2 : 0.9) }} />
        ) : value > 0 ? (
          <span className="signed-belt">
            <span className="signed-chain" />
            <span className="belt-frame">
              <AnimatedStack plates={belt} plateUnit={plateUnit} display={unit} />
            </span>
          </span>
        ) : null}
      </div>
    </div>
  );
}

/* ── 一张卡顶部的器材图 + 说明 ────────────────────────────────── */

const fmt1 = (n: number) => (Math.round(n * 10) / 10).toString();

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
}) {
  const [barOpen, setBarOpen] = useState(false);
  if (kind === 'plain') return null;

  const barKind: BarKind = bar?.kind ?? 'standard';
  const barW = barWeight(bar, plateUnit);
  const total = Math.round(convert(value, unit, plateUnit) * 20) / 20;
  const L = kind === 'plates' ? loadBarbell(total, plateUnit, barW) : null;
  const u = unit === 'lbs' ? 'lb' : 'kg';

  let caption = '';
  let warn = false;
  if (kind === 'plates' && L) {
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
    } else if (L.remainder > 0) {
      caption = isCn
        ? `配不出：每边还差 ${plateLabel(L.remainder, plateUnit, unit)} ${u}`
        : `Can't load: ${plateLabel(L.remainder, plateUnit, unit)} ${u} short per side`;
      warn = true;
    } else
      caption = L.perSide.length
        ? isCn
          ? `每边 ${sideTxt} ${u}${mixed}`
          : `Per side ${sideTxt} ${u}${mixed}`
        : isCn
          ? '空杠'
          : 'Empty bar';
  } else if (kind === 'pin') caption = isCn ? `插销插在 ${fmt1(value)} ${u}` : `Pin at ${fmt1(value)} ${u}`;
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
        {kind === 'plates' && L && <BarbellGlyph perSide={L.perSide} plateUnit={plateUnit} display={unit} kind={barKind} />}
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

export default LoadHero;
