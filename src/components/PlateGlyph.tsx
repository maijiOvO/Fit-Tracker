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
import { createPortal } from 'react-dom';
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
import { ScrubNumber, listStepFn } from './ScrubNumber';


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
  oneSide,
  machine,
}: {
  perSide: number[];
  plateUnit: PlateUnit;
  display: PlateUnit;
  kind: BarKind;
  /** 单边挂片：左边的套筒空着 */
  oneSide?: boolean;
  /**
   * 挂片器械（悍马、倒蹬、史密斯这类）：中间画一块机身、两边伸出挂片杆，不画横穿的杠子和卡箍。
   * 原来和杠铃同一张图，用户看着就是一根杠铃（2026-10-22）。杆长、片子比例照旧按标准杠的尺寸。
   */
  machine?: boolean;
}) {
  const g = BAR_GEOMETRY[kind];
  const half = (side: 'l' | 'r') => (
    <span className={`bar-side is-${side}`}>
      {!machine && <span className="bar-collar" />}
      <span className="bar-sleeve" />
      <span className="bar-load">
        <AnimatedStack plates={oneSide && side === 'l' ? [] : perSide} plateUnit={plateUnit} display={display} numbers />
      </span>
    </span>
  );
  return (
    <div className="bar-frame" aria-hidden>
      <div
        className={`plate-bar${machine ? ' is-machine' : ''}`}
        style={{
          ['--L' as string]: g.length,
          ['--S' as string]: g.shaft,
          ['--sleeve' as string]: g.sleeve,
          ['--shaft-dia' as string]: g.shaftDia,
          ['--sleeve-dia' as string]: g.sleeveDia,
        }}
      >
        {machine ? <span className="bar-machine" /> : <span className="bar-shaft" />}
        {half('l')}
        {half('r')}
      </div>
    </div>
  );
}

/**
 * 「这台器械」在这个馆的设置（2026-10-21 用户定：都收进大图上方的小药丸，⋯ 菜单只留对动作的操作）：
 * 插销 / 挂片、配重片的最轻一格与每格、挂片器械的空载、哑铃 / 壶铃 / 辅助的每档。没标馆的训练不传。
 */
export interface MachineCtl {
  /** 这场训练的馆：底部「只改 X 的这一台」 */
  gym: string;
  /** 库里是配重片或挂片式器械：可以在这个馆改成另一种 */
  canSwitch: boolean;
  onKind: (k: 'pin' | 'loaded') => void;
  /** 配重片：每格 + 最轻一格一起改（最轻一格 0＝没设） */
  onStack?: (step: number, start: number) => void;
  /** 一档（配重片 / 哑铃 / 壶铃 / 辅助）：恢复馆默认用 */
  inc?: { overridden: boolean; onSet: (n: number) => void; onReset: () => void };
  /** 挂片式器械的空载（馆的片子单位；null＝不知道） */
  tare?: { value: number | null; onSet: (n: number | null) => void };
  /** 挂片式器械只有一边能挂（T 杠、地雷架）：总重＝一边的片 */
  oneSide?: { on: boolean; onSet: (on: boolean) => void };
  /** 动作库里的形式（所有馆的默认）：「加重方式」行写明这一台是跟着它，还是改过 */
  libKind?: 'pin' | 'loaded';
  /**
   * 2026-10-22 合并入口：这几行设置渲染进「动作设置」弹窗里「在 X」那一段（React portal），
   * 小药丸改成打开那个弹窗。不传（交替组等）就照旧在大图位置原地展开。
   */
  slot?: HTMLElement | null;
  onOpen?: () => void;
}

/* ── 配重片摞（器械 / 龙门架）─────────────────────────── */

/**
 * 竖拖只认大图中间一条（2026-10-23 用户：整块配重片都能竖拖，翻页时手指划过就改了重量）。
 * 方向不变（配重片竖着排就竖着滑，见 heroScrubAxis）；两边照常滚页面。
 */
function DragLane({ scrub }: { scrub: { handlers: Record<string, unknown> } }) {
  return <span className="load-hero-lane" data-testid="hero-lane" aria-hidden {...scrub.handlers} />;
}

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

/* ── 壶铃：单只定重，铃身大小随重量，不上色（同哑铃，片子的颜色只给杠铃） ──
   以前没有图形，只写「壶铃 16 kg」（design-plates §3 单只定重，阶段二补上）。
   形状按缩放画，数字不跟着缩：钉在铃身底部，最轻的也读得清。 */

export function KettlebellGlyph({ value, unit }: { value: number; unit: PlateUnit }) {
  const max = unit === 'kg' ? 48 : 106;
  const s = 0.6 + (Math.min(Math.max(value, 0), max) / max) * 0.4;
  return (
    <div className="kb-wrap" aria-hidden>
      <span className="kb-shape" style={{ transform: `scale(${s})` }}>
        <span className="kb-handle" />
        <span className="kb-body" />
      </span>
      {value > 0 && <b className="kb-num">{fmt1(value)}</b>}
    </div>
  );
}

/* ── 固定杠铃：一根焊死的成品杠，头的大小随重量，总重印在杆中间 ─────── */

export function FixedBarGlyph({ value, unit }: { value: number; unit: PlateUnit }) {
  const max = unit === 'kg' ? 50 : 110;
  const s = 0.45 + (Math.min(Math.max(value, 0), max) / max) * 0.55;
  const head = <span className="fb-head" style={{ transform: `scale(${0.6 + s * 0.5}, ${s})` }} />;
  return (
    <div className="fb-bar" aria-hidden>
      {head}
      <span className="fb-shaft">{value > 0 && <b className="db-num">{fmt1(value)}</b>}</span>
      {head}
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
  machine,
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
  /** 这台器械在这个馆的设置（大图上方小药丸，点开原地换成设置面）；没标馆的训练不传 */
  machine?: MachineCtl;
}) {
  const [barOpen, setBarOpen] = useState(false);
  if (kind === 'plain') return null;
  if (rounder) return <GymHero {...{ kind, value, unit, bar, onBarChange, isCn, scrub, rounder, onPick, barOpen, setBarOpen, tare, machine }} />;

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
  else if (kind === 'bell') caption = isCn ? `壶铃 ${fmt1(value)} ${u}` : `Kettlebell ${fmt1(value)} ${u}`;
  // 固定杠铃是一根的总重，不写「每只」
  else if (kind === 'fixed') caption = isCn ? `固定杠铃 ${fmt1(value)} ${u}` : `Fixed barbell ${fmt1(value)} ${u}`;
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
        {...(scrub?.axis === 'x' ? scrub.handlers : {})}
      >
        {scrub?.scrubbing && (
          <span className="load-hero-step" aria-hidden>
            ×{scrub.step}
          </span>
        )}
        {(kind === 'plates' || kind === 'loaded') && L && <BarbellGlyph perSide={L.perSide} plateUnit={plateUnit} display={unit} kind={barKind} machine={kind === 'loaded'} />}
        {kind === 'pin' && <PinStackGlyph value={value} step={pinStep} />}
        {kind === 'pair' && <DumbbellGlyph value={value} unit={unit} />}
        {kind === 'bell' && <KettlebellGlyph value={value} unit={unit} />}
        {kind === 'fixed' && <FixedBarGlyph value={value} unit={unit} />}
        {kind === 'signed' && <SignedGlyph value={value} unit={unit} plateUnit={plateUnit} />}
        {scrub?.axis === 'y' && <DragLane scrub={scrub} />}
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
              <ScrubNumber
                value={shortW}
                onCommit={n => n !== null && n >= 1 && onBarChange({ kind: 'short', unit: shortU, weight: n })}
                min={1}
                steps={shortU === 'kg' ? [0.5, 1, 2.5] : [1, 2, 5]}
                ariaLabel={isCn ? '短杠多重' : 'Short bar weight'}
                inputClassName="bar-short-num"
              />
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
  machine,
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
  machine?: MachineCtl;
}) {
  const ctx = rounder.ctx;
  const [stackOpen, setStackOpen] = useState(false);
  const stackStart = ctx.start && ctx.start > 0 ? ctx.start : 0;
  const u = unit === 'lbs' ? 'lb' : 'kg';
  /**
   * 这个馆的片子单位（审查 A9）：片子、空杠、器械一档、配重片刻度都按它（那台器械上印的就是它）；
   * 记的数、说明里的总重按显示单位。两者不一样时，说明里点明挂的是哪种片
   */
  const gu = rounder.unit;
  const gl = gu === 'lbs' ? 'lb' : 'kg';
  const toG = (d: number) => (gu === unit ? d : Math.round(convert(d, unit, gu) * 100) / 100);
  const fmt = (n: number) => (Math.round(n * 100) / 100).toString();
  // 0＝还没填：不算「挂不整」，图上画空杠 / 空着，不给两档
  const empty = Math.abs(value) < 1e-9;
  const onGrid = empty || rounder.loadableD(value);
  const v = onGrid ? value : rounder.snapD(value);
  const vG = toG(v);
  const barKind: BarKind = bar?.kind ?? 'standard';
  const isBar = kind === 'plates' || kind === 'loaded';
  const oneSide = kind === 'loaded' && !!ctx.oneSide;
  const base = kind === 'plates' ? ctx.bar : 0;
  const perSide = isBar && vG > base + 1e-9 ? sidePlates((vG - base) / (oneSide ? 1 : 2), ctx.plates, gu) : [];
  const belt = kind === 'signed' && vG > 0 ? sidePlates(vG, ctx.plates, gu) : [];
  const near = onGrid ? null : rounder.bracketD(value);
  const plateTxt = (ps: number[]) => ps.map(w => plateLabel(w, gu, unit)).join(' + ');
  const mixed = gu !== unit ? (isCn ? (gu === 'lbs' ? '（磅片）' : '（公斤片）') : gu === 'lbs' ? ' (lb plates)' : ' (kg plates)') : '';

  const nudgeStart = (dir: 1 | -1) => {
    if (!machine?.onStack) return;
    const cur = stackStart > 0 ? stackStart : ctx.inc;
    // 最轻一格的颗粒度 kg / lb 都是 0.5（2026-10-21 用户定：用不着更细）
    const next = Math.round((cur + dir * 0.5) * 100) / 100;
    if (next < 0.5) return;
    machine.onStack(ctx.inc, next);
  };
  const stepStack = (dir: 1 | -1) => {
    if (!machine?.onStack) return;
    const list = INC_CHOICES[gu];
    const nextV = dir > 0 ? list.find(x => x > ctx.inc + 1e-9) : [...list].reverse().find(x => x < ctx.inc - 1e-9);
    if (nextV === undefined) return;
    // 传的是图上显示的最轻一格：没设过时它等于一档，按 stackStart(=0) 传会让它跟着「每格」一起变
    machine.onStack(nextV, stackStart > 0 ? stackStart : ctx.inc);
  };

  let caption = '';
  if (isBar) {
    caption = perSide.length
      ? oneSide
        ? isCn ? `单边 ${plateTxt(perSide)} ${u}${mixed}` : `One side ${plateTxt(perSide)} ${u}${mixed}`
        : isCn ? `每边 ${plateTxt(perSide)} ${u}${mixed}` : `Per side ${plateTxt(perSide)} ${u}${mixed}`
      : kind === 'plates'
        ? isCn ? '空杠' : 'Empty bar'
        : isCn ? '还没挂片' : 'No plates yet';
    // 记录只算片子；填过空载的，说明里给个总数做参考（design-plates.md「换馆重量」空载）。空载按馆的片子单位记
    if (kind === 'loaded')
      caption +=
        tare !== undefined
          ? isCn ? ` · 连器械共 ${fmt(vG + tare)} ${gl}` : ` · ${fmt(vG + tare)} ${gl} with the machine`
          : isCn ? ' · 只算片子' : ' · plates only';
  } else if (kind === 'pin') caption = ''; // 插销那格已经写着重量，不再重复一句（2026-10-20 用户定）
  else if (kind === 'pair') caption = isCn ? `每只 ${fmt(v)} ${u}` : `${fmt(v)} ${u} each`;
  else if (kind === 'bell') caption = isCn ? `壶铃 ${fmt(v)} ${u}` : `Kettlebell ${fmt(v)} ${u}`;
  // 固定杠铃是一根的总重，不写「每只」
  else if (kind === 'fixed') caption = isCn ? `固定杠铃 ${fmt(v)} ${u}` : `Fixed barbell ${fmt(v)} ${u}`;
  else if (kind === 'signed') {
    if (v < 0) caption = isCn ? `辅助 ${fmt(-v)} ${u}` : `Assisted ${fmt(-v)} ${u}`;
    else if (v === 0) caption = isCn ? '纯自重' : 'Bodyweight';
    else caption = isCn ? `腰挂 ${plateTxt(belt)} ${u}${mixed}` : `Belt ${plateTxt(belt)} ${u}${mixed}`;
  }
  if (empty && kind !== 'signed') caption = isCn ? '还没填重量' : 'No weight yet';
  if (near) {
    const shown = kind === 'signed' && value < 0 ? `${isCn ? '辅助 ' : 'assisted '}${fmt(-value)}` : fmt(Math.abs(value));
    caption = isCn ? `按 ${shown} ${u} 记 · 图上是最接近的配法` : `Logged as ${shown} ${u} · drawn as the closest load`;
  }

  const barName = isCn ? BAR_LABEL[barKind].cn : BAR_LABEL[barKind].en;
  const barTxt = `${barName} ${plateLabel(ctx.bar, gu, unit)} ${u}`;
  const shortU: PlateUnit = bar?.kind === 'short' ? (bar.unit ?? gu) : gu;
  const shortW = bar?.kind === 'short' ? (bar.weight ?? SHORT_BAR_DEFAULT[shortU]) : SHORT_BAR_DEFAULT[gu];
  const pick = (k: BarKind) =>
    onBarChange?.(k === 'short' ? { kind: 'short', weight: shortW, unit: shortU } : { kind: k });
  const nearLabel = (n: number) => (kind === 'signed' && n < 0 ? `${isCn ? '辅助 ' : '−'}${fmt(-n)}` : fmt(n));

  const lightest = stackStart > 0 ? stackStart : ctx.inc;
  const hasMachine = !!machine && (kind === 'pin' || kind === 'loaded' || kind === 'pair' || kind === 'bell' || kind === 'fixed' || kind === 'signed');
  // 有弹窗位置（slot）时不在原地展开：设置行渲染进「动作设置」里
  const faceOpen = stackOpen && hasMachine && !machine?.slot;
  const incName =
    kind === 'pair' ? (isCn ? '哑铃' : 'Dumbbells')
    : kind === 'bell' ? (isCn ? '壶铃' : 'Kettlebells')
    : kind === 'fixed' ? (isCn ? '固定杠铃' : 'Fixed bars')
    : isCn ? '辅助' : 'Assist';
  const pillText = !machine
    ? ''
    : kind === 'pin'
      ? isCn ? `${fmt(lightest)} 起 · 每格 ${fmt(ctx.inc)} ${gl}` : `From ${fmt(lightest)} · +${fmt(ctx.inc)} ${gl}`
      : kind === 'loaded'
        ? (oneSide ? (isCn ? '单边' : 'One side') : isCn ? '挂片' : 'Plate-loaded') +
          (machine.tare?.value != null
            ? isCn ? ` · 器械自重 ${fmt(machine.tare.value)} ${gl}` : ` · machine ${fmt(machine.tare.value)} ${gl}`
            : isCn ? ' · 自重没填' : ' · weight unknown')
        : isCn ? `${incName} · 每档 ${fmt(ctx.inc)} ${gl}` : `${incName} · +${fmt(ctx.inc)} ${gl}`;
  const incRow = (label: string) =>
    machine?.inc && (
      <div className="stack-stp">
        <span>{label}</span>
        <span className="stack-seg">
          <button type="button" aria-label={isCn ? '一档轻一点' : 'Smaller step'} onClick={() => { const n = listStepFn(INC_CHOICES[gu])(ctx.inc, -1, 1); if (n !== ctx.inc) machine.inc!.onSet(n); }} data-testid="gym-inc-dec">−</button>
          <ScrubNumber
            value={ctx.inc}
            onCommit={n => n !== null && n > 0 && Math.abs(n - ctx.inc) > 1e-9 && machine.inc!.onSet(n)}
            min={0.25}
            stepFn={listStepFn(INC_CHOICES[gu])}
            steps={[1, 2, 4]}
            testId="gym-inc-value"
            ariaLabel={label}
          />
          <small>{gl}</small>
          <button type="button" aria-label={isCn ? '一档重一点' : 'Bigger step'} onClick={() => { const n = listStepFn(INC_CHOICES[gu])(ctx.inc, 1, 1); if (n !== ctx.inc) machine.inc!.onSet(n); }} data-testid="gym-inc-inc">＋</button>
        </span>
      </div>
    );

  /** 「这台器械」的设置行：原地展开（交替组等）和渲染进「动作设置」弹窗（slot）共用一份 */
  const faceRows = machine && (
    <>
      {machine.canSwitch && (
        <div className="stack-stp">
          {/* 写明和动作设置（所有馆的默认）的关系：两层说的是同一件事，以前看不出这一台改没改过（2026-10-22） */}
          <span>
            {isCn ? '加重方式' : 'Loading'}
            {machine.libKind && (
              <small className="block text-label text-tertiary" data-testid="gym-kind-lib">
                {kind === machine.libKind
                  ? isCn ? '跟动作设置一样' : 'Same as the exercise'
                  : isCn
                    ? `这一台改过，动作设置是${machine.libKind === 'pin' ? '插销' : '挂片'}`
                    : `Changed here; the exercise says ${machine.libKind === 'pin' ? 'pin stack' : 'plate-loaded'}`}
              </small>
            )}
          </span>
          <span className="gym-seg" role="group" data-testid="gym-kind">
            {(['pin', 'loaded'] as const).map(k => (
              <button
                key={k}
                type="button"
                className={`min-h-[36px] px-3 text-small font-semibold ${kind === k ? 'seg-on' : 'text-secondary'}`}
                aria-pressed={kind === k}
                onClick={() => machine.onKind(k)}
                data-testid={`gym-kind-${k}`}
              >
                {k === 'pin' ? (isCn ? '插销' : 'Pin stack') : isCn ? '挂片' : 'Plate-loaded'}
              </button>
            ))}
          </span>
        </div>
      )}
      {kind === 'pin' && machine.onStack && (
        <>
          <div className="stack-stp">
            <span>{isCn ? '最轻一格' : 'Lightest'}</span>
            <span className="stack-seg">
              <button type="button" aria-label={isCn ? '最轻一格轻一点' : 'Lighter'} onClick={() => nudgeStart(-1)} data-testid="stack-start-dec">−</button>
              <ScrubNumber
                value={lightest}
                onCommit={n => n !== null && n > 0 && Math.abs(n - lightest) > 1e-9 && machine.onStack!(ctx.inc, n)}
                min={0.5}
                steps={[0.5, 1, 2.5, 5]}
                testId="stack-start"
                ariaLabel={isCn ? '最轻一格多重' : 'Lightest plate weight'}
              />
              <small>{gl}</small>
              <button type="button" aria-label={isCn ? '最轻一格重一点' : 'Heavier'} onClick={() => nudgeStart(1)} data-testid="stack-start-inc">＋</button>
            </span>
          </div>
          <div className="stack-stp">
            <span>{isCn ? '每格' : 'Step'}</span>
            <span className="stack-seg">
              <button type="button" aria-label={isCn ? '每格轻一点' : 'Smaller step'} onClick={() => stepStack(-1)} data-testid="stack-step-dec">−</button>
              <ScrubNumber
                value={ctx.inc}
                onCommit={n => n !== null && n > 0 && Math.abs(n - ctx.inc) > 1e-9 && machine.onStack!(n, lightest)}
                min={0.25}
                stepFn={listStepFn(INC_CHOICES[gu])}
                steps={[1, 2, 4]}
                testId="stack-step"
                ariaLabel={isCn ? '每格多重' : 'Step'}
              />
              <small>{gl}</small>
              <button type="button" aria-label={isCn ? '每格重一点' : 'Bigger step'} onClick={() => stepStack(1)} data-testid="stack-step-inc">＋</button>
            </span>
          </div>
          <div className="stack-mini" aria-hidden>
            {Array.from({ length: 7 }, (_, i) => (
              <i key={i} className={i === 0 ? 'is-first' : ''}>{fmt(lightest + i * ctx.inc)}</i>
            ))}
            <span>…</span>
          </div>
        </>
      )}
      {kind === 'loaded' && machine.oneSide && (
        <div className="stack-stp">
          <span>{isCn ? '挂片' : 'Sides'}</span>
          <span className="gym-seg" role="group" data-testid="gym-one-side">
            {([false, true] as const).map(on => (
              <button
                key={String(on)}
                type="button"
                className={`min-h-[36px] px-3 text-small font-semibold ${oneSide === on ? 'seg-on' : 'text-secondary'}`}
                aria-pressed={oneSide === on}
                onClick={() => oneSide !== on && machine.oneSide!.onSet(on)}
                data-testid={on ? 'gym-one-side-on' : 'gym-one-side-off'}
              >
                {on ? (isCn ? '单边' : 'One side') : isCn ? '两边' : 'Both sides'}
              </button>
            ))}
          </span>
        </div>
      )}
      {kind === 'loaded' && machine.tare && (
        <>
          <div className="stack-stp">
            {/* 原来叫「空载」、占位「不知道」：行话看不懂，占位字还被 18px 数字字体截成「不矢」（2026-10-22 用户指出） */}
            <span>{isCn ? '器械自重' : 'Machine weight'}</span>
            <span className="stack-seg">
              <ScrubNumber
                value={machine.tare.value}
                onCommit={machine.tare.onSet}
                allowEmpty
                min={-500}
                max={500}
                steps={gu === 'kg' ? [0.5, 1, 2.5, 5] : [1, 2.5, 5, 10]}
                placeholder="—"
                testId="gym-tare"
                ariaLabel={isCn ? '器械自重' : 'Machine weight'}
              />
              <small>{gl}</small>
            </span>
          </div>
          <p className="stack-note">
            {isCn
              ? '不挂片时这台器械本身多重（倒蹬的滑台、史密斯的杠）。填了只在上面说明里加一句「连器械共多少」，记录照旧只算片子；不知道就空着。'
              : 'What the machine weighs with no plates (leg-press sled, Smith bar). Only adds a "with the machine" total to the caption; the log still counts plates only. Leave empty if unsure.'}
          </p>
        </>
      )}
      {(kind === 'pair' || kind === 'bell' || kind === 'fixed' || kind === 'signed') && incRow(isCn ? '每档' : 'Step')}
      {machine.inc?.overridden && (
        <div className="stack-foot">
          <span />
          <button type="button" onClick={() => machine.inc!.onReset()} data-testid="stack-reset">
            {isCn ? '恢复馆默认' : 'Use gym default'}
          </button>
        </div>
      )}
    </>
  );

  return (
    <div className={`load-hero is-${kind}${scrub?.scrubbing ? ' is-scrubbing' : ''}${faceOpen ? ' is-face' : ''}`} data-testid="load-hero">
      {hasMachine && !faceOpen && (
        <div className="stack-tagrow">
          <button
            type="button"
            className="stack-tag"
            onClick={() => (machine?.onOpen ? machine.onOpen() : setStackOpen(() => true))}
            aria-expanded={false}
            data-testid="stack-chip"
          >
            <svg viewBox="0 0 24 24" aria-hidden><path d="M4 20h4L19 9l-4-4L4 16v4z" /></svg>
            {pillText}
          </button>
        </div>
      )}
      {faceOpen && machine ? (
        <div className="stack-face" role="group" aria-label={isCn ? '这台器械' : 'This machine'} data-testid="stack-menu">
          <div className="stack-fhead">
            <div>
              <b>{isCn ? '这台器械' : 'This machine'}</b>
              <small>{isCn ? `只改 ${machine.gym} 的这一台` : `Only this one at ${machine.gym}`}</small>
            </div>
            <button type="button" className="stack-done" onClick={() => setStackOpen(() => false)} data-testid="stack-done">
              {isCn ? '完成' : 'Done'}
            </button>
          </div>
          {faceRows}
        </div>
      ) : (
        <>
          {/* 合并入口：设置行渲染进「动作设置」弹窗的「在 X」一段（状态还在这张卡上，所以用 portal） */}
          {hasMachine && machine?.slot &&
            createPortal(
              <div className="stack-face is-sheet" role="group" aria-label={isCn ? '这台器械' : 'This machine'} data-testid="stack-menu">
                <div className="sheet-sec-head">
                  <b>{isCn ? `在 ${machine.gym}` : `At ${machine.gym}`}</b>
                  <small>{isCn ? '只改这个馆的这一台' : 'Only this machine at this gym'}</small>
                </div>
                {faceRows}
              </div>,
              machine.slot,
            )}
          <div
            className={`load-hero-drag${scrub ? ` is-draggable is-axis-${scrub.axis}` : ''}`}
            {...(scrub?.axis === 'x' ? scrub.handlers : {})}
          >
            {scrub?.scrubbing && (
              <span className="load-hero-step" aria-hidden>
                ×{fmt(rounder.stepD(v) * scrub.step)}
              </span>
            )}
            {isBar && <BarbellGlyph perSide={perSide} plateUnit={gu} display={unit} kind={kind === 'loaded' ? 'standard' : barKind} oneSide={oneSide} machine={kind === 'loaded'} />}
            {kind === 'pin' && <PinStackGlyph value={vG} step={ctx.inc > 0 ? ctx.inc : 1} start={stackStart} />}
            {kind === 'pair' && <DumbbellGlyph value={v} unit={unit} />}
            {kind === 'bell' && <KettlebellGlyph value={v} unit={unit} />}
            {kind === 'fixed' && <FixedBarGlyph value={v} unit={unit} />}
            {kind === 'signed' && <SignedGlyph value={v} unit={unit} plateUnit={gu} belt={belt} />}
            {scrub?.axis === 'y' && <DragLane scrub={scrub} />}
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
                  : `${plateLabel(barWeight({ kind: k }, gu), gu, unit)} ${u}`}
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
              <ScrubNumber
                value={shortW}
                onCommit={n => n !== null && n >= 1 && onBarChange({ kind: 'short', unit: shortU, weight: n })}
                min={1}
                steps={shortU === 'kg' ? [0.5, 1, 2.5] : [1, 2, 5]}
                ariaLabel={isCn ? '短杠多重' : 'Short bar weight'}
                inputClassName="bar-short-num"
              />
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
