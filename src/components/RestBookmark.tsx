/**
 * 休息标记 §12.13 —— 夹在两组之间的书签。
 *
 * 旧的 .is-next 铺在**行**上，读作「下一组做哪个」。但真正会去看它的时刻是组间休息，
 * 那时问的是「我这次休息在哪两组中间」。落点在缝上，不在行上。
 *
 * ⚠️ 静止时**不做任何测量**：本组件在 .ledger-paper 的正常流里，
 * 夹在两个组块之间，高度 0，靠 CSS 自己贴在缝上。行怎么长高（递减子组、
 * 「＋再加一档」）缝都跟着走 —— 不用「量好位置再平移」，就是为了这个。
 * 只有拖动开始的那一帧才量一次全场缝位。
 *
 * 作用域是**全场唯一**：全场只有一个「我现在在哪休息」。
 * 位置是「此刻」的 UI 状态，跟滚动位置同级，不进 SetLog，结束训练即弃。
 */
import React, { useRef } from 'react';
import { Language } from '../../types';
import { haptic, H } from '../utils/haptics';

/** 一条候选缝：某个动作的第 gap 组之后（gap=0 是第一组之前） */
interface Seam {
  exId: string;
  gap: number;
  /** 文档坐标（视口 y + 当时的 scrollY）：拖动中会滚页，视口坐标一滚就作废 */
  docY: number;
  /** 所属卡片组区的左缘与宽度，浮起的丝带要对齐它 */
  left: number;
  width: number;
  label: string;
}

interface Props {
  lang: Language;
  /** 落定后把新位置交回去（全场唯一，所以 exId 也可能变）；label 是缝的叫法，落定提示里念出来 */
  onMove: (exId: string, gap: number, label: string) => void;
}

/** 起拖阈值：低于它当没拖过，避免手指一抖就跳格 */
const DRAG_TOL = 6;
/**
 * 自动滚页：手指进到视口上下这么宽的边带就滚，越贴边越快。
 * 没有它，缝位只在按下那一帧量一次、手指最多到屏幕底边，下面那张卡没露出来时
 * 书签只能吸到最近的可见缝 —— 2026-10-29 练手臂那场「拖到底了」其实一组都没扫到就是这么来的。
 * 底带比顶带宽：底部还压着固定的底栏。
 */
const EDGE_TOP = 72;
const EDGE_BOTTOM = 132;
/** 贴死边时的滚速（px/s）。按时间算而不是按帧算：帧率被压低（后台页、低端机）时滚的距离不变 */
const SCROLL_MAX_SPEED = 1000;

/**
 * 扫出全场所有可停的缝。只在 pointerdown 那一帧跑一次。
 *
 * 递减档之间不算缝 —— 递减组的定义就是**不休息**地往下掉档，
 * 那几个位置永远不会有人停。所以一组的缝只取整块（母行 + 全部递减档 +
 * 「再加一档」）的下边缘。
 */
function scanSeams(isCn: boolean): Seam[] {
  const out: Seam[] = [];
  document.querySelectorAll<HTMLElement>('[data-ledger-paper]').forEach(paper => {
    const exId = paper.dataset.ledgerPaper || '';
    const name = paper.dataset.exName || '';
    const box = paper.getBoundingClientRect();
    const rows = [...paper.querySelectorAll<HTMLElement>('[data-set-idx]')];
    if (!rows.length) return;
    const sy = window.scrollY;

    const total = rows.reduce((m, el) => Math.max(m, Number(el.dataset.setIdx) + 1), 0);
    /**
     * 一组的叫法照组行上显示的号（审查 C：交替组里第 3 行显示的是「卧推 2」，原来说明写「第 3 组」）：
     * 交替组「卧推 2」，单个动作「第 2 组 / Set 2」
     */
    const nameOf = (si: number) => {
      const el = rows.find(r => Number(r.dataset.setIdx) === si && r.dataset.setNo);
      const no = el?.dataset.setNo ?? String(si + 1);
      const badge = el?.dataset.setBadge;
      return badge ? `${badge} ${no}` : isCn ? `第 ${no} 组` : `Set ${no}`;
    };
    out.push({ exId, gap: 0, docY: box.top + sy, left: box.left, width: box.width,
               label: isCn ? `${name} · ${nameOf(0)}之前` : `${name} · before ${nameOf(0)}` });

    for (let si = 0; si < total; si++) {
      const parts = rows.filter(el => Number(el.dataset.setIdx) === si);
      if (!parts.length) continue;
      const bottom = parts[parts.length - 1].getBoundingClientRect().bottom;
      out.push({
        exId, gap: si + 1, docY: bottom + sy, left: box.left, width: box.width,
        label: si + 1 === total
          ? isCn ? `${name} · ${nameOf(si)}之后` : `${name} · after ${nameOf(si)}`
          : `${name} · ${nameOf(si)} ↔ ${nameOf(si + 1)}`,
      });
    }
  });
  return out;
}

export const RestBookmark: React.FC<Props> = ({ lang, onMove }) => {
  const isCn = lang === Language.CN;
  const seamRef = useRef<HTMLDivElement | null>(null);
  const floatRef = useRef<{ tab: HTMLElement; line: HTMLElement; cap: HTMLElement } | null>(null);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    e.preventDefault();
    const seam = seamRef.current;
    if (!seam) return;

    // 捕获能把手指拖出丝带范围之后的 move 也留给我们；拿不到也不该让手势失效，
    // 所以 move/up 同时挂在 window 上兜底。
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* 没有活动指针就算了 */
    }

    const seams = scanSeams(isCn);
    const startY = e.clientY;
    // 手指按在丝带上的哪一点：浮起的丝带跟着手指走时保持这个偏移，别跳
    const grabOffset = startY - seam.getBoundingClientRect().top;
    let fingerY = startY;
    let moved = false;
    let pick: Seam | null = null;
    let raf = 0;

    const spawnFloaters = () => {
      const tab = document.createElement('div');
      tab.className = 'rest-float';
      tab.innerHTML = '<div class="tab"></div>';
      const line = document.createElement('div');
      line.className = 'rest-float-line';
      const cap = document.createElement('div');
      cap.className = 'rest-float-cap';
      document.body.append(tab, line, cap);
      floatRef.current = { tab, line, cap };
    };

    const killFloaters = () => {
      const f = floatRef.current;
      if (f) [f.tab, f.line, f.cap].forEach(el => el.remove());
      floatRef.current = null;
    };

    /** 按此刻的滚动位置重算落点、重画浮起的丝带：手指动了要算，页面滚了也要算 */
    const paint = () => {
      const f = floatRef.current;
      if (!f) return;
      const sy = window.scrollY;
      const docY = fingerY - grabOffset + sy;
      // 吸附：全场最近的缝，落点在松手前就亮出来
      pick = seams.reduce((a, b) => (Math.abs(b.docY - docY) < Math.abs(a.docY - docY) ? b : a));
      const half = parseFloat(getComputedStyle(seam).getPropertyValue('--rest-h') || '18') / 2;
      const pickVY = pick.docY - sy;
      f.tab.style.transform = `translate(${pick.left}px, ${fingerY - grabOffset - half}px)`;
      f.line.style.width = `${pick.width}px`;
      f.line.style.transform = `translate(${pick.left}px, ${pickVY - 1}px)`;
      f.cap.textContent = pick.label;
      f.cap.style.transform = `translate(${pick.left + 14}px, ${pickVY - 10}px)`;
    };

    /** 手指贴着上下边就一帧一帧滚页，滚完立刻重算落点 */
    let lastTick = 0;
    const autoScroll = (now: number) => {
      raf = 0;
      const h = window.innerHeight;
      let speed = 0;
      if (fingerY < EDGE_TOP) speed = -((EDGE_TOP - fingerY) / EDGE_TOP) * SCROLL_MAX_SPEED;
      else if (fingerY > h - EDGE_BOTTOM) speed = ((fingerY - (h - EDGE_BOTTOM)) / EDGE_BOTTOM) * SCROLL_MAX_SPEED;
      if (!speed) {
        lastTick = 0;
        return;
      }
      // 卡顿后的一帧最多按 100 ms 算，别一下跳过半屏
      const dt = lastTick ? Math.min(now - lastTick, 100) : 16;
      lastTick = now;
      const before = window.scrollY;
      window.scrollBy(0, (speed * dt) / 1000);
      if (window.scrollY !== before) paint();
      raf = requestAnimationFrame(autoScroll);
    };

    const onMoveEv = (ev: PointerEvent) => {
      const dy = ev.clientY - startY;
      if (!moved && Math.abs(dy) < DRAG_TOL) return;
      if (!moved) {
        moved = true;
        seam.classList.add('is-dragging');
        spawnFloaters();
      }
      fingerY = ev.clientY;
      paint();
      if (!raf) raf = requestAnimationFrame(autoScroll);
    };

    const onUpEv = () => {
      window.removeEventListener('pointermove', onMoveEv);
      window.removeEventListener('pointerup', onUpEv);
      window.removeEventListener('pointercancel', onUpEv);
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      killFloaters();
      seam.classList.remove('is-dragging');
      if (moved && pick) {
        haptic(H.longpress);
        onMove(pick.exId, pick.gap, pick.label);
      }
    };

    window.addEventListener('pointermove', onMoveEv);
    window.addEventListener('pointerup', onUpEv);
    window.addEventListener('pointercancel', onUpEv);
  };

  return (
    <div className="rest-seam" ref={seamRef} data-rest-seam>
      <button
        type="button"
        className="rest-grab"
        onPointerDown={onPointerDown}
        aria-label={isCn ? '休息标记 · 拖动换到别的两组之间' : 'Rest marker — drag between other sets'}
      >
        <span className="tab" />
        <span className="line" />
      </button>
    </div>
  );
};
