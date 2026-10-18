/**
 * 器材图形 —— 「杠铃片」规格 docs/design-plates.md §3。
 *
 * 只负责「画」，不负责改值：改值仍然是组行里那一格的横拖 / 竖拖（useValueScrub）。
 * 全 App 只有这里能用片子的颜色（--plate-*）。
 *
 * 动效「上片」：外侧多出来的片从套筒外侧滑进来，拿掉的片往外滑走；
 * 共同的内层片不动（AnimatedStack 按前缀比对）。只动 transform / opacity。
 */
import React, { useEffect, useRef, useState } from 'react';
import { loadBarbell, loadSide, plateSpec, describeSide, type PlateUnit } from '../utils/plates';
import type { LoadKind } from '../hooks/useLoadKind';

/* ── 一摞片：按前缀比对做进出动画 ───────────────────────────────── */

interface StackItem {
  w: number;
  key: number;
  leaving?: boolean;
}

function AnimatedStack({
  plates,
  unit,
  height,
  thick,
  numbers,
}: {
  plates: number[];
  unit: PlateUnit;
  /** 大片的高度（px） */
  height: number;
  /** 最重那档的厚度（px） */
  thick: number;
  /** 大片上印重量 */
  numbers?: boolean;
}) {
  const seq = useRef(0);
  const [items, setItems] = useState<StackItem[]>(() => plates.map((w) => ({ w, key: seq.current++ })));
  const sig = plates.join(',');

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
        const s = plateSpec(unit, i.w);
        if (!s) return null;
        return (
          <i
            key={i.key}
            className={`plate plate-${s.token}${i.leaving ? ' is-leaving' : ''}`}
            style={{ height: Math.round(height * s.h), width: Math.max(2, Math.round(thick * s.t)) }}
          >
            {numbers && s.h === 1 && <b>{i.w}</b>}
          </i>
        );
      })}
    </span>
  );
}

/* ── 杠铃 ───────────────────────────────────────────────────────── */

export function BarbellGlyph({
  total,
  unit,
  bar,
  disabled,
}: {
  total: number;
  unit: PlateUnit;
  bar?: number;
  disabled?: readonly number[];
}) {
  const { perSide } = loadBarbell(total, unit, bar, disabled);
  const half = (side: 'l' | 'r') => (
    <span className={`plate-half is-${side}`}>
      <span className="plate-collar" />
      <AnimatedStack plates={perSide} unit={unit} height={60} thick={14} numbers />
    </span>
  );
  return (
    <div className="plate-bar" aria-hidden>
      <span className="plate-rod" />
      <span className="plate-grip" />
      {half('l')}
      {half('r')}
    </div>
  );
}

/** 组行里重量数字下面那条迷你半边杠铃（只画外侧一边） */
export function BarbellMini({ total, unit, bar }: { total: number; unit: PlateUnit; bar?: number }) {
  const { perSide } = loadBarbell(total, unit, bar);
  if (!perSide.length) return null;
  return (
    <span className="plate-mini" aria-hidden>
      <span className="plate-mini-rod" />
      <AnimatedStack plates={perSide} unit={unit} height={4} thick={11} />
    </span>
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

export function SignedGlyph({ value, unit }: { value: number; unit: PlateUnit }) {
  const span = unit === 'kg' ? 40 : 90;
  const pos = 50 + (Math.max(-span, Math.min(span, value)) / span) * 45;
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
            <AnimatedStack plates={loadSide(value, unit).perSide} unit={unit} height={36} thick={10} />
          </span>
        ) : null}
      </div>
    </div>
  );
}

/* ── 一张卡顶部的器材图 + 说明 ────────────────────────────────── */

export function loadCaption(kind: LoadKind, value: number, unit: PlateUnit, isCn: boolean, pinStep: number, bar?: number): {
  text: string;
  warn?: boolean;
} {
  if (kind === 'plates') {
    const L = loadBarbell(value, unit, bar);
    const barW = bar ?? (unit === 'kg' ? 20 : 45);
    if (L.underBar) return { text: isCn ? `比空杆（${barW} ${unit}）还轻` : `Lighter than the empty bar (${barW} ${unit})`, warn: true };
    if (L.remainder > 0)
      return {
        text: isCn ? `配不出：每边还差 ${L.remainder} ${unit}` : `Can't load: ${L.remainder} ${unit} short per side`,
        warn: true,
      };
    if (!L.perSide.length) return { text: isCn ? `空杆 ${barW} ${unit}` : `Empty bar ${barW} ${unit}` };
    return { text: isCn ? `每边 ${describeSide(L.perSide)} · 杆 ${barW}` : `Per side ${describeSide(L.perSide)} · bar ${barW}` };
  }
  if (kind === 'pin') return { text: isCn ? `插销插在 ${value} ${unit} · 上下拖动换位置` : `Pin at ${value} ${unit} · drag up / down` };
  if (kind === 'pair') return { text: isCn ? `每只 ${value} ${unit}` : `${value} ${unit} each` };
  if (kind === 'signed') {
    if (value < 0) return { text: isCn ? `辅助 ${-value} ${unit}` : `Assisted ${-value} ${unit}` };
    if (value === 0) return { text: isCn ? '纯自重' : 'Bodyweight' };
    return { text: isCn ? `腰挂 ${describeSide(loadSide(value, unit).perSide)}` : `Belt ${describeSide(loadSide(value, unit).perSide)}` };
  }
  return { text: '' };
}

export function LoadHero({
  kind,
  value,
  unit,
  isCn,
  pinStep,
}: {
  kind: LoadKind;
  value: number;
  unit: PlateUnit;
  isCn: boolean;
  pinStep: number;
}) {
  if (kind === 'plain') return null;
  const cap = loadCaption(kind, value, unit, isCn, pinStep);
  return (
    <div className={`load-hero is-${kind}`} data-testid="load-hero">
      {kind === 'plates' && <BarbellGlyph total={value} unit={unit} />}
      {kind === 'pin' && <PinStackGlyph value={value} step={pinStep} />}
      {kind === 'pair' && <DumbbellGlyph value={value} unit={unit} />}
      {kind === 'signed' && <SignedGlyph value={value} unit={unit} />}
      {cap.text && <p className={`load-caption${cap.warn ? ' is-warn' : ''}`}>{cap.text}</p>}
    </div>
  );
}

export default LoadHero;
