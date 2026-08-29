/**
 * 休息标记 §12.13 —— 夹在两组之间的书签。
 *
 * 旧的 .is-next 铺在**行**上，读作「下一组做哪个」。但真正会去看它的时刻是组间休息，
 * 那时问的是「我这次休息在哪两组中间」。落点在缝上，不在行上。
 *
 * ⚠️ 静止时**不做任何测量**：本组件在 .ledger-paper 的正常流里，
 * 夹在两个组块之间，高度 0，靠 CSS 自己贴在缝上。行怎么长高（递减子组、
 * 「＋再加一档」）缝都跟着走 —— 规格 §12.6 当年放弃平移方案就是怕这个。
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
  /** 视口坐标 */
  vy: number;
  /** 所属卡片组区的左缘与宽度，浮起的丝带要对齐它 */
  left: number;
  width: number;
  label: string;
}

interface Props {
  lang: Language;
  /** 落定后把新位置交回去（全场唯一，所以 exId 也可能变） */
  onMove: (exId: string, gap: number) => void;
}

/** 起拖阈值：低于它当没拖过，避免手指一抖就跳格 */
const DRAG_TOL = 6;

/**
 * 扫出全场所有可停的缝。只在 pointerdown 那一帧跑一次。
 *
 * 递减档之间不算缝 —— 递减组的定义就是**不休息**地往下掉档，
 * 那几个位置永远不会有人停。所以一组的缝只取整块（母行 + 全部递减档 +
 * 「再加一档」）的下边缘。
 */
function scanSeams(): Seam[] {
  const out: Seam[] = [];
  document.querySelectorAll<HTMLElement>('[data-ledger-paper]').forEach(paper => {
    const exId = paper.dataset.ledgerPaper || '';
    const name = paper.dataset.exName || '';
    const box = paper.getBoundingClientRect();
    const rows = [...paper.querySelectorAll<HTMLElement>('[data-set-idx]')];
    if (!rows.length) return;

    const total = rows.reduce((m, el) => Math.max(m, Number(el.dataset.setIdx) + 1), 0);
    out.push({ exId, gap: 0, vy: box.top, left: box.left, width: box.width,
               label: `${name} · 第 1 组之前` });

    for (let si = 0; si < total; si++) {
      const parts = rows.filter(el => Number(el.dataset.setIdx) === si);
      if (!parts.length) continue;
      const bottom = parts[parts.length - 1].getBoundingClientRect().bottom;
      out.push({
        exId, gap: si + 1, vy: bottom, left: box.left, width: box.width,
        label: si + 1 === total
          ? `${name} · 第 ${total} 组之后`
          : `${name} · 第 ${si + 1} 组 ↔ 第 ${si + 2} 组`,
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

    const seams = scanSeams();
    const startY = e.clientY;
    const baseVY = seam.getBoundingClientRect().top;
    let moved = false;
    let pick: Seam | null = null;

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

    const onMoveEv = (ev: PointerEvent) => {
      const dy = ev.clientY - startY;
      if (!moved && Math.abs(dy) < DRAG_TOL) return;
      if (!moved) {
        moved = true;
        seam.classList.add('is-dragging');
        spawnFloaters();
      }
      const f = floatRef.current;
      if (!f) return;

      const vy = baseVY + dy;
      // 吸附：全场最近的缝，落点在松手前就亮出来
      pick = seams.reduce((a, b) => (Math.abs(b.vy - vy) < Math.abs(a.vy - vy) ? b : a));

      const half = parseFloat(getComputedStyle(seam).getPropertyValue('--rest-h') || '18') / 2;
      f.tab.style.transform = `translate(${pick.left}px, ${vy - half}px)`;
      f.line.style.width = `${pick.width}px`;
      f.line.style.transform = `translate(${pick.left}px, ${pick.vy - 1}px)`;
      f.cap.textContent = pick.label;
      f.cap.style.transform = `translate(${pick.left + 14}px, ${pick.vy - 10}px)`;
    };

    const onUpEv = () => {
      window.removeEventListener('pointermove', onMoveEv);
      window.removeEventListener('pointerup', onUpEv);
      window.removeEventListener('pointercancel', onUpEv);
      killFloaters();
      seam.classList.remove('is-dragging');
      if (moved && pick) {
        haptic(H.longpress);
        onMove(pick.exId, pick.gap);
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

export default RestBookmark;
