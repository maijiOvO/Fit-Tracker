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
  loadSide,
  plateLabel,
  plateSpec,
  type BarChoice,
  type BarKind,
  type PlateUnit,
} from '../utils/plates';
import type { LoadKind } from '../hooks/useLoadKind';
import type { ExRounder } from '../hooks/useLoadRounder';
import { ADDON_MAX, RIG_STEPS, baseOf, sidePlates, splitStack, type Rig } from '../utils/loadable';
import { ScrubNumber, listStepFn } from './ScrubNumber';
import { STACK_PITCH } from '../utils/scrubFeel';
import { RIG_NUM_MAX, SHORT_BAR_MAX, loadCapD } from '../utils/load';


const fmt1 = (n: number) => (Math.round(n * 10) / 10).toString();
/** 加片常见 1.25：保留两位 */
const fmt2 = (n: number) => (Math.round(n * 100) / 100).toString();

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

function BarbellGlyph({
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
  /** 配重片的最重一格（null＝不设限） */
  onStackEnd?: (end: number | null) => void;
  /** 配重片的加片：每块多重、几块（0 块＝没有） */
  onAddons?: (each: number, count: number) => void;
  /** 一档（哑铃 / 壶铃 / 固定杠铃 / 辅助）。onReset：按动作单独设过（辅助）才有，恢复馆默认 */
  inc?: { onSet: (n: number) => void; onReset?: () => void };
  /**
   * 这件器材在这个馆存的几台（2026-11-10）：list 第一格是馆默认（id ''），sel 是这个动作眼下用的。
   * 改刻度改的是选中那台（在默认上改＝另存一台）；onName / onRemove 只有选中的是存下来的一台才有。
   */
  rigs?: {
    list: Rig[];
    sel: string;
    /** 选中的这种别的动作也在用（配重片形式）：改刻度会另存一种，删除只是这个动作不用了 */
    shared?: boolean;
    onPick: (id: string) => void;
    onAdd: () => void;
    onName?: (n: string) => void;
    onRemove?: () => void;
  };
  /** 挂片式器械的自重（馆的片子单位；null＝不知道）；counted＝算进记录（否则只在说明里做参考） */
  tare?: { value: number | null; onSet: (n: number | null) => void; counted: boolean; onCounted: (on: boolean) => void };
  /** 挂片式器械只有一边能挂（T 杠、地雷架）：总重＝一边的片 */
  oneSide?: { on: boolean; onSet: (on: boolean) => void };
  /** 这一台的片子单位（配重片 / 哑铃 / 壶铃 / 固定杠铃）：格子按它算，整张卡也按它写（D1，见 useLoadRounder.cardUnitOf） */
  onUnit?: (u: PlateUnit) => void;
  /** 动作库里的形式（所有馆的默认）：「加重方式」行写明这一台是跟着它，还是改过 */
  libKind?: 'pin' | 'loaded';
  /**
   * 2026-10-22 合并入口：这几行设置渲染进「动作设置」弹窗里「在 X」那一段（React portal），
   * 小药丸打开那个弹窗（onOpen）。交替组卡没有大图，自己把 MachineFace portal 进 slot。
   */
  slot?: HTMLElement | null;
  onOpen?: () => void;
}

/* ── 配重片摞（器械 / 龙门架）─────────────────────────── */

/**
 * 配重片：导杆 + 顶板 + 一摞有厚度的片 + 插销，右侧一条刻度轨（2026-10-25 用户选定，示意
 * docs/demos/weight-stack-directions.html 方向 B）。只有轨能竖拖改重量，图本身和两侧照常滚页面
 * （原来正中 40% 一条 pan-x，翻页的拇指正好走那里）。
 * 固定 STACK_WIN 片高的窗口：重量再大图也不长高（原来画 max(16, at+3) 片、封顶 30，拖重时卡片一路长高，
 * 超过 30 格插销那片根本没画）。窗口按页翻：插销离下沿不到 3 片才往下挪，手指往下、插销也往下。
 */
const STACK_WIN = 9;

export function PinStackGlyph({
  value,
  step,
  start = 0,
  end = 0,
  unit,
  label,
  rail,
  addons = [],
}: {
  value: number;
  step: number;
  start?: number;
  /** 最重一格（和 value 同单位）：摞子画到它为止，底下一道线；0＝不设限 */
  end?: number;
  /** 插销那格写的单位：这张卡的单位，即这台器械自己的单位（2026-11-13 用户定，顶栏切单位不再换它） */
  unit?: PlateUnit;
  /** 插销那格写的数（这张卡的单位）；不传＝value。value 按器械上印的单位定位插销 */
  label?: number;
  /** 刻度轨的拖动手势（useValueScrub）；不传＝没有轨。idle：轨照画但不接手势（这张卡上没有能改的组） */
  rail?: { handlers: Record<string, unknown>; idle: boolean };
  /** 这一下挂着的加片（每块的重量）：画成顶板上的小片。value 只是插销那一格，不含它们 */
  addons?: number[];
}) {
  // 带起始的配重片（12.5 起、每格 5）：第 1 片就是最轻一格，往下每片 +一档
  const s0 = start > 0 ? start : 0;
  const at = s0 > 0 ? (value >= s0 - 1e-9 ? Math.round((value - s0) / step) + 1 : 0) : Math.max(0, Math.round(value / step));
  // 最重一格是第几片（不在格子上的按它以下最近的一格，同 loadable.bracket）
  // 比最轻一格还轻的（后来把最轻一格调到它上面了）同 bracket：当没设
  const firstAt = s0 > 0 ? s0 : step;
  const last = end >= firstAt - 1e-9 ? (s0 > 0 ? Math.floor((end - s0) / step + 1e-9) + 1 : Math.floor(end / step + 1e-9)) : Infinity;
  const topRef = useRef(1);
  let top = topRef.current;
  if (at > 0 && at < top + 1) top = Math.max(1, at - 1);
  if (at > top + STACK_WIN - 4) top = at - STACK_WIN + 4;
  if (at === 0) top = 1;
  topRef.current = top;
  const P = STACK_PITCH;
  // 插销那一排在窗口里的纵坐标（片的中线）；0＝还没插，插销停在顶板下
  const pinY = at > 0 ? (at - top) * P + 5 : -4;
  const plates = [];
  for (let i = Math.max(1, top - 2); i <= Math.min(last, top + STACK_WIN + 1); i++)
    plates.push(<span key={i} className={`pin-slab${i < at ? ' is-up' : i === at ? ' is-at' : ''}`} style={{ top: (i - 1) * P }} />);
  return (
    <div className="pin-stack" aria-hidden style={{ ['--pin-y' as string]: `${pinY}px` }}>
      <span className="pin-head" />
      {addons.map((w, i) => (
        <span key={i} className="pin-addon" style={{ ['--i' as string]: i }} data-testid="pin-addon">
          {fmt2(w)}
        </span>
      ))}
      <span className="pin-rod is-l" />
      <span className="pin-rod is-r" />
      <span className={`pin-win${top > 1 ? ' is-more-up' : ''}`}>
        <span className="pin-plates" style={{ transform: `translateY(${-(top - 1) * P}px)` }}>
          {plates}
          {last < Infinity && last > 0 && <span className="pin-floor" style={{ top: (last - 1) * P + 11 }} data-testid="pin-floor" />}
        </span>
        {/* 中间的选重杆只穿过被提起来的那几片 */}
        <span className="pin-sel" style={{ height: Math.max(0, pinY + 5) }} />
      </span>
      {at > 0 && (
        <em className="pin-label">
          {fmt1(label ?? value)}
          {unit && <small>{unit === 'lbs' ? 'lb' : 'kg'}</small>}
        </em>
      )}
      <span className="pin-pin" />
      {rail && (
        <span className={`pin-rail${rail.idle ? ' is-idle' : ''}`} data-testid="hero-rail" {...rail.handlers}>
          {Array.from({ length: STACK_WIN }, (_, i) => (
            <i key={i} style={{ top: i * P + 5 }} />
          ))}
          <b />
        </span>
      )}
    </div>
  );
}

/* ── 哑铃：不上色，头的大小随重量 ─────────────────────────────── */

function DumbbellGlyph({ value, unit }: { value: number; unit: PlateUnit }) {
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

function KettlebellGlyph({ value, unit }: { value: number; unit: PlateUnit }) {
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

function FixedBarGlyph({ value, unit }: { value: number; unit: PlateUnit }) {
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

function SignedGlyph({ value, unit, plateUnit, belt: beltIn }: { value: number; unit: PlateUnit; plateUnit: PlateUnit; belt?: number[] }) {
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

/** 大图的拖动手势；live＝这张卡上有能改的组（待做的或选中的），否则图和刻度轨照画、不接手势（scrubFeel.heroFocus） */
interface HeroScrub {
  handlers: Record<string, unknown>;
  scrubbing: boolean;
  step: number;
  axis: 'x' | 'y';
  live: boolean;
}
/** 横拖挂在整块图上，竖拖（配重片）只挂刻度轨 */
const dragProps = (scrub: HeroScrub | undefined) => ({
  className: `load-hero-drag${scrub?.live ? ` is-draggable is-axis-${scrub.axis}` : ''}`,
  ...(scrub?.live && scrub.axis === 'x' ? scrub.handlers : {}),
});
const railOf = (scrub: HeroScrub | undefined) =>
  scrub?.axis === 'y' ? { handlers: scrub.live ? scrub.handlers : {}, idle: !scrub.live } : undefined;

/**
 * 显示单位 ↔ 这台器械的片子单位（gu）的换算小工具（2026-10-23 用户：调重量的界面都要能实时切单位）。
 * 存的仍是这台器械上印的单位（gu）——只在显示和输入时换算，切来切去不丢精度，和杠铃片说明（plateLabel）一个做法。
 * 大图（LoadHero）和设置行（MachineFace）共用。
 */
function displayConv(rounder: ExRounder, unit: PlateUnit) {
  const u = unit === 'lbs' ? 'lb' : 'kg';
  /**
   * 这个馆的片子单位（审查 A9）：片子、空杠、器械一档、配重片刻度都按它（那台器械上印的就是它）；
   * 记的数、说明里的总重按显示单位。两者不一样时，说明里点明挂的是哪种片
   */
  const gu = rounder.unit;
  const toG = (d: number) => (gu === unit ? d : Math.round(convert(d, unit, gu) * 100) / 100);
  const fmt = (n: number) => (Math.round(n * 100) / 100).toString();
  /**
   * 设置面里的器械自重、说明里的总重按显示单位（2026-10-23 用户：调重量的界面都要能实时切单位）；
   * 存的仍是这台器械上印的单位（gu）。每格 / 最轻一格不换算（见 MachineFace）。
   */
  const conv = gu !== unit;
  // 换算过来的数留一位小数（10 lb → 4.5 kg）：两位在输入框里放不下，也不比一位更有用
  const toD = (g: number) => (conv ? Math.round(convert(g, gu, unit) * 10) / 10 : g);
  const fromD = (d: number) => (conv ? Math.round(convert(d, unit, gu) * 20) / 20 : d);
  const fmtD = (g: number) => fmt(toD(g));
  return { u, gu, toG, fmt, toD, fromD, fmtD };
}

/**
 * 药丸上的字：起了名的只写名字，否则写刻度（按这台器械上印的单位，一台 kg 一台 lb 靠它分辨），馆默认在刻度前加「默认」。
 * 配重片写成「最轻一格 + 每格」：每枚都写「起 · 每格」太宽，多一台就挤出屏幕，完整说法在设置里。
 */
export function rigLabel(r: Rig, kind: LoadKind, isCn: boolean): string {
  if (r.n) return r.n;
  const f = (n: number) => String(Math.round(n * 100) / 100);
  const u = r.u === 'lbs' ? 'lb' : 'kg';
  // 加片写在后面：「5 + 5 lb · 加 2.5×2」
  const add = r.a?.length ? ` · ${isCn ? '加' : 'add'} ${f(r.a[0])}${r.a.length > 1 ? `×${r.a.length}` : ''}` : '';
  const spec = kind === 'pin' ? `${f(r.s && r.s > 0 ? r.s : r.v)} + ${f(r.v)} ${u}${add}` : `+${f(r.v)} ${u}`;
  return r.id === '' ? `${isCn ? '默认' : 'Default'} · ${spec}` : spec;
}

/**
 * 这件器材在这个馆存的几台，一排可横滚的药丸（2026-11-10 用户定：切哪一台要在一级界面，不进 ⋯ 或动作设置）。
 * 卡片大图上方、动作设置「这一台」、新建动作弹窗三处共用。点没选中的＝切过去；
 * onEdit（只有大图给）：点选中的那台＝打开它的设置。onAdd 不给就没有「＋」。
 */
export function RigChips({ kind, isCn, list, sel, onPick, onAdd, onEdit }: {
  kind: LoadKind;
  isCn: boolean;
  list: Rig[];
  sel: string;
  onPick: (id: string) => void;
  onAdd?: () => void;
  onEdit?: () => void;
}) {
  const stripRef = useRef<HTMLDivElement>(null);
  // 选中的那台不在视野里就滚到中间：组重量按它的刻度取整，看不见就不知道眼下是哪台。
  // 只动这一排的 scrollLeft：scrollIntoView 会连带滚页面
  useEffect(() => {
    const strip = stripRef.current;
    const on = strip?.querySelector('[aria-pressed="true"]');
    if (!strip || !on) return;
    const a = on.getBoundingClientRect();
    const b = strip.getBoundingClientRect();
    if (a.left < b.left || a.right > b.right) strip.scrollLeft += a.left - b.left - (b.width - a.width) / 2;
  }, [sel, list.length]);
  return (
    <div ref={stripRef} className="stack-rigs" role="group" aria-label={kind === 'pin' ? (isCn ? '用哪种配重片' : 'Which stack') : isCn ? '用哪一台' : 'Which machine'} data-testid="rig-chips">
      {list.map(r => {
        const on = r.id === sel;
        return (
          <button
            key={r.id}
            type="button"
            className={`stack-tag${on ? ' is-on' : ''}`}
            aria-pressed={on}
            onClick={() => (on ? onEdit?.() : onPick(r.id))}
            data-testid={on ? 'stack-chip' : 'rig-chip'}
          >
            {on && onEdit && <svg viewBox="0 0 24 24" aria-hidden><path d="M4 20h4L19 9l-4-4L4 16v4z" /></svg>}
            {rigLabel(r, kind, isCn)}
          </button>
        );
      })}
      {onAdd && (
        <button type="button" className="stack-tag is-add" aria-label={kind === 'pin' ? (isCn ? '加一种配重片' : 'Add a stack') : isCn ? '加一台' : 'Add a machine'} onClick={onAdd} data-testid="rig-add">
          ＋
        </button>
      )}
    </div>
  );
}

/** 给一台起名：失焦才存（每打一个字存一次会一直推同步） */
const RigName: React.FC<{ name: string; isCn: boolean; onName: (n: string) => void }> = ({ name, isCn, onName }) => {
  const [text, setText] = useState(name);
  return (
    <input
      className="stack-name"
      value={text}
      maxLength={12}
      placeholder={isCn ? '不填就用刻度当名字' : 'Optional'}
      aria-label={isCn ? '这一台的名字' : 'Machine name'}
      onChange={e => setText(e.target.value)}
      onBlur={() => onName(text.trim())}
      onKeyDown={e => e.key === 'Enter' && e.currentTarget.blur()}
      data-testid="rig-name"
    />
  );
};

/**
 * 「这台器械」的设置行：用哪一台 / 加重方式 / 这台的片子 / 最轻一格 · 每格 + 预设 / 单边 / 器械自重 / 每档 / 删掉这一台。
 * 单卡的大图、交替组卡（没有大图，只有这几行）都把它渲染进「动作设置」弹窗（slot），共用一份。
 * 状态都在 machine（useMachineSettings）里，这里只画。
 */
export function MachineFace({ kind, unit, isCn, rounder, machine }: { kind: LoadKind; unit: PlateUnit; isCn: boolean; rounder: ExRounder; machine: MachineCtl }) {
  const ctx = rounder.ctx;
  const stackStart = ctx.start && ctx.start > 0 ? ctx.start : 0;
  const { u, gu, toD, fromD } = displayConv(rounder, unit);
  /**
   * 每格 / 最轻一格按这台器械上印的单位写，不换算成显示单位（2026-11-10，原来 10-23 定的是跟显示单位）：
   * 一台 kg、一台 lb 靠它分辨，下方的预设（1 · 2.5 · 5…）也只有在器械自己的单位下才是整数。
   */
  const gl = gu === 'lbs' ? 'lb' : 'kg';
  const oneSide = kind === 'loaded' && !!ctx.oneSide;
  const lightest = stackStart > 0 ? stackStart : ctx.inc;
  // 预设填进哪一格（2026-11-10 用户定）：点一下那一行就选中，默认是「每格」
  const [field, setField] = useState<'start' | 'step'>('step');
  // 横划和 − / ＋ 也只在预设这几格里跳（下方那排不动、只挪高亮）；别的数手打
  const presetFn = listStepFn(RIG_STEPS);
  // 传的是图上显示的最轻一格：没设过时它等于一档，按 stackStart(=0) 传会让它跟着「每格」一起变
  const setStart = (n: number) => { if (n > 0 && n <= RIG_NUM_MAX && Math.abs(n - lightest) > 1e-9) machine.onStack?.(ctx.inc, n); };
  const setStep = (n: number) => {
    if (n <= 0 || n > RIG_NUM_MAX || Math.abs(n - ctx.inc) < 1e-9) return;
    if (kind === 'pin') machine.onStack?.(n, lightest);
    else machine.inc?.onSet(n);
  };
  const numRow = (id: 'start' | 'step', label: string, value: number, set: (n: number) => void, testId: string) => (
    <div className={`stack-stp${kind === 'pin' && field === id ? ' is-on' : ''}`} onPointerDownCapture={() => setField(id)} data-testid={`${testId}-row`}>
      <span>{label}</span>
      <span className="stack-seg">
        <button type="button" aria-label={isCn ? `${label}轻一点` : `${label} down`} onClick={() => set(presetFn(value, -1, 1))} data-testid={`${testId}-dec`}>−</button>
        <ScrubNumber
          value={value}
          onCommit={n => n !== null && set(n)}
          min={0.1}
          max={RIG_NUM_MAX}
          stepFn={presetFn}
          steps={[1, 2, 3]}
          testId={testId}
          ariaLabel={label}
        />
        <small>{gl}</small>
        <button type="button" aria-label={isCn ? `${label}重一点` : `${label} up`} onClick={() => set(presetFn(value, 1, 1))} data-testid={`${testId}-inc`}>＋</button>
      </span>
    </div>
  );
  const presets = (value: number, set: (n: number) => void, target?: string) => (
    <>
      {target && <small className="stack-presets-to" data-testid="stack-presets-target">{isCn ? `填入${target}` : `Fill: ${target}`}</small>}
      <div className="stack-presets" role="group" aria-label={isCn ? '常见的一格' : 'Common steps'} data-testid="stack-presets">
        {RIG_STEPS.map(x => (
          <button key={x} type="button" aria-pressed={Math.abs(x - value) < 1e-9} onClick={() => set(x)} data-testid={`stack-preset-${x}`}>
            {x}
          </button>
        ))}
        <small>{gl}</small>
      </div>
    </>
  );
  const startLabel = isCn ? '最轻一格' : 'Lightest';
  const stepLabel = isCn ? '每格' : 'Step';
  const rigs = machine.rigs;
  // 加片在界面上按「每块一样重 × 几块」设（存的是一块一项，见 IncSpec.a）
  const addEach = ctx.addons?.[0] ?? 0;
  const addCount = ctx.addons?.length ?? 0;
  return (
    <>
      {rigs && (
        <>
          <RigChips kind={kind} isCn={isCn} list={rigs.list} sel={rigs.sel} onPick={rigs.onPick} onAdd={rigs.onAdd} />
          <p className="stack-note" data-testid="rig-note">
            {kind === 'pin'
              ? rigs.shared
                ? isCn ? '这个馆的配重片形式，别的动作也在用：在这上面改刻度会另存一种，别的动作不跟着变。' : 'Shared with other exercises here: editing saves a copy, the others stay as they are.'
                : rigs.onName
                  ? isCn ? '这个馆的配重片形式：别的插销器械也能直接选它。' : 'A stack format for this gym: any pin-loaded exercise can pick it.'
                  : isCn ? '在这上面改刻度会另存一种，默认还留着。' : 'Editing saves a new format; the default stays.'
              : rigs.onName
                ? isCn ? '改的是这一台：选了它的动作一起变。' : 'Edits apply to this machine, for every exercise that uses it.'
                : isCn ? '在这上面改刻度会另存成一台，默认还留着。' : 'Editing saves a new machine; the default stays.'}
          </p>
          {rigs.onName && (
            <div className="stack-stp">
              <span>{isCn ? '名字' : 'Name'}</span>
              <RigName key={rigs.sel} name={rigs.list.find(r => r.id === rigs.sel)?.n ?? ''} isCn={isCn} onName={rigs.onName} />
            </div>
          )}
        </>
      )}
      {machine.canSwitch && (
        <div className="stack-stp">
          {/* 写明和做法（所有馆的默认）的关系：两层说的是同一件事，以前看不出这一台改没改过（2026-10-22；10-23 起默认在做法那层） */}
          <span>
            {isCn ? '加重方式' : 'Loading'}
            {machine.libKind && (
              <small className="block text-label text-tertiary" data-testid="gym-kind-lib">
                {kind === machine.libKind
                  ? isCn ? `跟默认一样：${machine.libKind === 'pin' ? '配重片' : '杠铃片'}` : 'Same as the default'
                  : isCn
                    ? `这一台改过 · 默认是${machine.libKind === 'pin' ? '配重片' : '杠铃片'}`
                    : `Changed here; the default is ${machine.libKind === 'pin' ? 'pin stack' : 'plate-loaded'}`}
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
      {machine.onUnit && (
        <div className="stack-stp">
          <span>
            {isCn ? '这台的片子' : 'Marked in'}
            <small className="block text-label text-tertiary">{isCn ? '格子和卡上的数都按它' : 'Steps and numbers follow it'}</small>
          </span>
          <span className="gym-seg" role="group" data-testid="gym-machine-unit">
            {(['kg', 'lbs'] as const).map(x => (
              <button
                key={x}
                type="button"
                className={`min-h-[36px] px-3 text-small font-semibold ${gu === x ? 'seg-on' : 'text-secondary'}`}
                aria-pressed={gu === x}
                onClick={() => machine.onUnit!(x)}
                data-testid={`gym-machine-unit-${x}`}
              >
                {x === 'kg' ? 'kg' : 'lb'}
              </button>
            ))}
          </span>
        </div>
      )}
      {kind === 'pin' && machine.onStack && (
        <>
          {numRow('start', startLabel, lightest, setStart, 'stack-start')}
          {numRow('step', stepLabel, ctx.inc, setStep, 'stack-step')}
          {field === 'start' ? presets(lightest, setStart, startLabel) : presets(ctx.inc, setStep, stepLabel)}
        </>
      )}
      {kind === 'pin' && machine.onStackEnd && (
        <div className="stack-stp">
          <span>{isCn ? '最重一格' : 'Heaviest'}</span>
          <span className="stack-seg">
            <ScrubNumber
              value={ctx.end ?? null}
              onCommit={n => (n === null ? ctx.end && machine.onStackEnd!(null) : n >= lightest && Math.abs(n - (ctx.end ?? 0)) > 1e-9 && machine.onStackEnd!(n))}
              allowEmpty
              min={lightest}
              max={loadCapD(gu, false)}
              stepFn={(v, d, m) => lightest + Math.max(0, Math.round((v - lightest) / ctx.inc) + d * m) * ctx.inc}
              steps={[1, 2, 5]}
              placeholder="—"
              testId="stack-end"
              ariaLabel={isCn ? '最重一格' : 'Heaviest'}
            />
            <small>{gl}</small>
          </span>
        </div>
      )}
      {kind === 'pin' && machine.onAddons && (
        <>
          <div className="stack-stp" data-testid="stack-addon-row">
            <span>
              {isCn ? '加片' : 'Add-on plates'}
              <small className="block text-label text-tertiary">{isCn ? '另挂在摞子上的小片，每块多重' : 'Small plates added on top: weight each'}</small>
            </span>
            <span className="stack-seg">
              <ScrubNumber
                value={addEach || null}
                onCommit={n => (n === null ? addEach && machine.onAddons!(0, 0) : Math.abs(n - addEach) > 1e-9 && machine.onAddons!(n, Math.max(1, addCount)))}
                allowEmpty
                min={0.25}
                max={ctx.inc}
                stepFn={(v, d) => Math.max(0.25, Math.round((v + d * (gu === 'kg' ? 0.25 : 0.5)) * 100) / 100)}
                steps={[1]}
                placeholder="—"
                testId="stack-addon"
                ariaLabel={isCn ? '每块加片多重' : 'Add-on plate weight'}
              />
              <small>{gl}</small>
            </span>
          </div>
          {addEach > 0 && (
            <div className="stack-stp">
              <span>{isCn ? '有几块' : 'How many'}</span>
              <span className="gym-seg" role="group" data-testid="stack-addon-count">
                {Array.from({ length: ADDON_MAX }, (_, i) => i + 1).map(n => (
                  <button
                    key={n}
                    type="button"
                    className={`min-h-[36px] px-3 text-small font-semibold ${addCount === n ? 'seg-on' : 'text-secondary'}`}
                    aria-pressed={addCount === n}
                    aria-label={isCn ? `${n} 块` : `${n} plates`}
                    onClick={() => addCount !== n && machine.onAddons!(addEach, n)}
                  >
                    {n}
                  </button>
                ))}
              </span>
            </div>
          )}
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
                value={machine.tare.value == null ? null : toD(machine.tare.value)}
                onCommit={n => machine.tare!.onSet(n === null ? null : fromD(n))}
                allowEmpty
                min={-500}
                max={500}
                steps={unit === 'kg' ? [0.5, 1, 2.5, 5] : [1, 2.5, 5, 10]}
                placeholder="—"
                testId="gym-tare"
                ariaLabel={isCn ? '器械自重' : 'Machine weight'}
              />
              <small>{u}</small>
            </span>
          </div>
          {machine.tare.value != null && (
            <div className="stack-stp">
              <span>{isCn ? '自重' : 'Machine weight'}</span>
              <span className="gym-seg" role="group" data-testid="gym-tare-counted">
                {([false, true] as const).map(on => (
                  <button
                    key={String(on)}
                    type="button"
                    className={`min-h-[36px] px-3 text-small font-semibold ${machine.tare!.counted === on ? 'seg-on' : 'text-secondary'}`}
                    aria-pressed={machine.tare!.counted === on}
                    onClick={() => machine.tare!.onCounted(on)}
                    data-testid={on ? 'gym-tare-counted-on' : 'gym-tare-counted-off'}
                  >
                    {on ? (isCn ? '算进记录' : 'Count it') : isCn ? '只做参考' : 'Reference only'}
                  </button>
                ))}
              </span>
            </div>
          )}
          {/* 填了值之后下面的「只做参考 | 算进记录」自己说明白了，这句只在没填时有用 */}
          {machine.tare.value == null && <p className="stack-note">{isCn ? '默认不计入记录' : 'Not counted in the log by default'}</p>}
        </>
      )}
      {kind !== 'pin' && machine.inc && (
        <>
          {numRow('step', isCn ? '每档' : 'Step', ctx.inc, setStep, 'gym-inc')}
          {presets(ctx.inc, setStep)}
        </>
      )}
      {(machine.inc?.onReset || rigs?.onRemove) && (
        <div className="stack-foot">
          <span />
          {machine.inc?.onReset && (
            <button type="button" onClick={machine.inc.onReset} data-testid="stack-reset">
              {isCn ? '每格恢复成馆默认' : 'Use gym default step'}
            </button>
          )}
          {rigs?.onRemove && (
            <button type="button" onClick={rigs.onRemove} data-testid="rig-remove">
              {kind === 'pin'
                ? rigs.shared
                  ? isCn ? '这个动作不用这种了' : 'Stop using this format'
                  : isCn ? '删掉这种形式' : 'Delete this format'
                : isCn ? '删掉这一台' : 'Delete this machine'}
            </button>
          )}
        </div>
      )}
    </>
  );
}

/**
 * 重量大图（docs/design-plates.md §3「馆档案」，示意 docs/demos/gym-workbench.html）：
 *   - 单位就是片子：一律按当前单位、这个馆有的片画（做完时挂的是另一种片，组行上另有标注）
 *   - 记的数挂不整（手打的 61、换算来的 132.28）：图上画最接近的配法，说明写「按 61 kg 记 · 图上是最接近的配法」，
 *     再给上下两个能挂的重量，点一下改成它
 *   - 挂片式器械（史密斯、倒蹬…）照杠铃算，只算片子（没有空杠）
 * 没有取整器（纯数字的动作）不画：卡片只在有重量这一项时渲染它，那时取整器只在 plain 时为 null，
 * 原来那套「按标准片、登记单位」的旧画法走不到，2026-11-13 删掉（审查 B10）。
 */
export function LoadHero({
  kind,
  value,
  unit,
  bar,
  onBarChange,
  isCn,
  scrub,
  rounder,
  onPick,
  machine,
}: {
  kind: LoadKind;
  /** 选中那一组的重量（这张卡的单位，带符号） */
  value: number;
  /** 这张卡的单位（rounder.display：器械有自己的单位就是它） */
  unit: PlateUnit;
  bar?: BarChoice;
  /** 改这个动作的杠（库里查不到的动作不传，杠名不可点） */
  onBarChange?: (bar: BarChoice) => void;
  isCn: boolean;
  /** 大图本身也是拖动区（2026-10-18 用户定）：和数字格同一套 useValueScrub，改的是选中那一组 */
  scrub?: HeroScrub;
  /** 馆档案取整器（2026-10-18）：图按「这个馆的片子 + 当前单位」画 */
  rounder: ExRounder | null;
  onPick?: (displayValue: number) => void;
  /** 这台器械在这个馆的设置（大图上方的药丸，点开是「动作设置」弹窗里「在 X」那一段）；没标馆的训练不传 */
  machine?: MachineCtl;
}) {
  const [barOpen, setBarOpen] = useState(false);
  if (kind === 'plain' || !rounder) return null;
  const ctx = rounder.ctx;
  const stackStart = ctx.start && ctx.start > 0 ? ctx.start : 0;
  const { u, gu, toG, fmt, fmtD } = displayConv(rounder, unit);
  // 0＝还没填：不算「挂不整」，图上画空杠 / 空着，不给两档
  const empty = Math.abs(value) < 1e-9;
  const onGrid = empty || rounder.loadableD(value);
  const v = onGrid ? value : rounder.snapD(value);
  const vG = toG(v);
  const barKind: BarKind = bar?.kind ?? 'standard';
  const isBar = kind === 'plates' || kind === 'loaded';
  const oneSide = kind === 'loaded' && !!ctx.oneSide;
  // 杠铃的空杠 / 挂片器械填过的自重都算在总重里，片子是总重减去它
  const base = baseOf(kind, ctx);
  const perSide = isBar && vG > base + 1e-9 ? sidePlates((vG - base) / (oneSide ? 1 : 2), ctx.plates, gu) : [];
  const belt = kind === 'signed' && vG > 0 ? sidePlates(vG, ctx.plates, gu) : [];
  const near = onGrid ? null : rounder.bracketD(value);
  // 配重片：这个重量是「插销哪一格 + 哪几块加片」
  const stack = kind === 'pin' ? splitStack(vG, ctx) : { pin: vG, add: [] };
  const plateTxt = (ps: number[]) => ps.map(w => plateLabel(w, gu, unit)).join(' + ');
  const mixed = gu !== unit ? (isCn ? (gu === 'lbs' ? '（磅片）' : '（公斤片）') : gu === 'lbs' ? ' (lb plates)' : ' (kg plates)') : '';

  let caption = '';
  if (isBar) {
    caption = perSide.length
      ? oneSide
        ? isCn ? `单边 ${plateTxt(perSide)} ${u}${mixed}` : `One side ${plateTxt(perSide)} ${u}${mixed}`
        : isCn ? `每边 ${plateTxt(perSide)} ${u}${mixed}` : `Per side ${plateTxt(perSide)} ${u}${mixed}`
      : kind === 'plates'
        ? isCn ? '空杠' : 'Empty bar'
        : isCn ? '还没挂片' : 'No plates yet';
    // 自重算进记录的（ctx.tare），记的数已经连它一起算，说明里点明含了多少；只做参考的，给个「连器械共」的总数；没填的只算片子
    if (kind === 'loaded') {
      const ref = machine?.tare?.value;
      caption +=
        ctx.tare !== undefined
          ? isCn ? ` · 含器械自重 ${fmtD(ctx.tare)} ${u}` : ` · incl. machine ${fmtD(ctx.tare)} ${u}`
          : ref != null
            ? isCn ? ` · 连器械共 ${fmtD(vG + ref)} ${u}` : ` · ${fmtD(vG + ref)} ${u} with the machine`
            : isCn ? ' · 只算片子' : ' · plates only';
    }
  } else if (kind === 'pin') {
    // 插销那格已经写着重量，不再重复一句（2026-10-20 用户定）；挂了加片才写怎么凑的
    caption = stack.add.length
      ? isCn ? `插销 ${fmt2(stack.pin)} + 加片 ${stack.add.map(fmt2).join(' + ')} ${gu === 'lbs' ? 'lb' : 'kg'}` : `Pin ${fmt2(stack.pin)} + add-on ${stack.add.map(fmt2).join(' + ')} ${gu === 'lbs' ? 'lb' : 'kg'}`
      : '';
  }
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

  // 存的是一块一项、每块一样重（见 IncSpec.a）
  const addEach = ctx.addons?.[0] ?? 0;
  const addCount = ctx.addons?.length ?? 0;
  const hasMachine = !!machine && (kind === 'pin' || kind === 'loaded' || kind === 'pair' || kind === 'bell' || kind === 'fixed' || kind === 'signed');
  // 设置行一律在「动作设置」弹窗里（machine.slot），药丸只负责打开它
  const openFace = () => machine?.onOpen?.();
  // 有自己器材的（配重片 / 哑铃 / 壶铃 / 固定杠铃）药丸是一排台子（RigChips）；这里只剩挂片和辅助
  const pillText = !machine
    ? ''
    : kind === 'loaded'
      ? (oneSide ? (isCn ? '单边' : 'One side') : isCn ? '挂片' : 'Plate-loaded') +
        (machine.tare?.value != null
          ? isCn ? ` · 器械自重 ${fmtD(machine.tare.value)} ${u}` : ` · machine ${fmtD(machine.tare.value)} ${u}`
          : isCn ? ' · 自重没填' : ' · weight unknown')
      : isCn ? `辅助 · 每档 ${fmtD(ctx.inc)} ${u}` : `Assist · +${fmtD(ctx.inc)} ${u}`;
  return (
    <div className={`load-hero is-${kind}${scrub?.scrubbing ? ' is-scrubbing' : ''}`} data-testid="load-hero">
      {hasMachine && (
        <div className="stack-tagrow">
          {machine?.rigs ? (
            <RigChips
              kind={kind}
              isCn={isCn}
              list={machine.rigs.list}
              sel={machine.rigs.sel}
              onPick={machine.rigs.onPick}
              onEdit={openFace}
              onAdd={() => { machine.rigs!.onAdd(); openFace(); }}
            />
          ) : (
            <button type="button" className="stack-tag" onClick={openFace} aria-expanded={false} data-testid="stack-chip">
              <svg viewBox="0 0 24 24" aria-hidden><path d="M4 20h4L19 9l-4-4L4 16v4z" /></svg>
              {pillText}
            </button>
          )}
          {/* 加片有几块在一级界面直接改（2026-11-24 用户定）：每块多重还在设置里；钉在药丸排右边，不跟着横滚 */}
          {kind === 'pin' && machine?.onAddons && addEach > 0 && (
            <span className="stack-addn" role="group" aria-label={isCn ? '加片有几块' : 'Add-on plates'} data-testid="hero-addon-count">
              <button type="button" disabled={addCount <= 1} aria-label={isCn ? '加片少一块' : 'One fewer add-on'} onClick={() => machine.onAddons!(addEach, addCount - 1)} data-testid="hero-addon-dec">−</button>
              <b>{isCn ? `加片×${addCount}` : `Add×${addCount}`}</b>
              <button type="button" disabled={addCount >= ADDON_MAX} aria-label={isCn ? '加片多一块' : 'One more add-on'} onClick={() => machine.onAddons!(addEach, addCount + 1)} data-testid="hero-addon-inc">＋</button>
            </span>
          )}
        </div>
      )}
      {/* 合并入口：设置行渲染进「动作设置」弹窗的「在 X」一段（状态还在这张卡上，所以用 portal） */}
      {hasMachine && machine && machine.slot &&
        createPortal(
          // 段标题（在 X 的这一台）和单位开关在弹窗那边（2026-10-23 三层）
          <div className="stack-face is-sheet" role="group" aria-label={isCn ? '这台器械' : 'This machine'} data-testid="stack-menu">
            <MachineFace kind={kind} unit={unit} isCn={isCn} rounder={rounder} machine={machine} />
          </div>,
          machine.slot,
        )}
      <div {...dragProps(scrub)}>
        {scrub?.scrubbing && (
          <span className="load-hero-step" aria-hidden>
            ×{fmt(rounder.stepD(v) * scrub.step)}
          </span>
        )}
        {isBar && <BarbellGlyph perSide={perSide} plateUnit={gu} display={unit} kind={kind === 'loaded' ? 'standard' : barKind} oneSide={oneSide} machine={kind === 'loaded'} />}
        {kind === 'pin' && (
          <PinStackGlyph value={stack.pin} step={ctx.inc > 0 ? ctx.inc : 1} start={stackStart} end={ctx.end ?? 0} unit={unit} label={Math.round(v * 10) / 10} rail={railOf(scrub)} addons={stack.add} />
        )}
        {kind === 'pair' && <DumbbellGlyph value={v} unit={unit} />}
        {kind === 'bell' && <KettlebellGlyph value={v} unit={unit} />}
        {kind === 'fixed' && <FixedBarGlyph value={v} unit={unit} />}
        {kind === 'signed' && <SignedGlyph value={v} unit={unit} plateUnit={gu} belt={belt} />}
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
                onCommit={n => n !== null && n >= 1 && n <= SHORT_BAR_MAX[shortU] && onBarChange({ kind: 'short', unit: shortU, weight: n })}
                min={1}
                max={SHORT_BAR_MAX[shortU]}
                steps={shortU === 'kg' ? [0.5, 1, 2.5] : [1, 2, 5]}
                ariaLabel={isCn ? '短杠多重' : 'Short bar weight'}
                inputClassName="bar-short-num"
              />
              <button
                type="button"
                aria-label={isCn ? '短杠重一点' : 'Heavier short bar'}
                onClick={() => onBarChange({ kind: 'short', unit: shortU, weight: Math.min(SHORT_BAR_MAX[shortU], shortW + (shortU === 'kg' ? 0.5 : 1)) })}
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

/** 「动作设置」开着、这张卡又给不出这台器械的设置：在「这一台」那段写明缺什么（2026-10-23，原来整段消失、找不到入口）。单卡、交替组成员共用 */
export function MachineMissingNote({ isCn, hasWeight, gym, hasSet, loadKind }: { isCn: boolean; hasWeight: boolean; gym?: string; hasSet: boolean; loadKind: LoadKind }) {
  return (
    <p className="metric-note" data-testid="gym-missing">
      {!hasWeight
        ? isCn ? '记录项里开了「重量」，才有这台器械的设置。' : 'Turn on Weight above to set up this machine.'
        : !gym
          ? isCn ? '这场训练还没选馆。在训练页顶上选了馆，这台器械的设置才记得住。' : 'Pick a gym at the top of the workout first, so this machine can be remembered.'
          : !hasSet
            ? isCn ? '加一组之后就能设。' : 'Add a set first.'
            : loadKind === 'plates'
              ? isCn ? '杠铃按这个馆的片子算，这里不用单独设。' : "Barbells use this gym's plates; nothing to set here."
              : isCn ? '这种阻力没有器械刻度要设。' : 'Nothing to set for this load type.'}
    </p>
  );
}
