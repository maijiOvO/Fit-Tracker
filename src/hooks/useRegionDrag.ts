/**
 * 拖到细分（添加动作弹层的细分格，2026-10，demo：docs/demos/region-drag.html 第二版）
 *
 * 手势：
 *   - 长按小卡 / 「未细分」里的动作行满 500ms（浮起）→ 手指一动就进入拖拽；不动直接松手＝管理菜单。
 *     长按满之前手指移动 > 10px＝在滚列表，手势作废（与训练卡拖动排序同一套语言，§12.7）。
 *   - 「整理」模式：按下即可拖，不用等长按；点卡片不再是添加。
 *   - 拖拽中：手指下那一列整列亮起 + 表头变色；列里虚线落位跟着手指高度走（放第几个就是第几个）；
 *     浮卡被吸向落位（磁吸，强度「中」）；跨列震一下。拖到「未细分」那一片＝放回未细分。
 *     靠近列表上下缘自动滚；细分横滑时靠近左右缘自动横滚。
 *   - 松手：浮卡滑进落位后回调 onDrop；放回原位 / 拖到格子外＝原样放回。
 *
 * 为什么整个拖拽走 DOM 命令式：拖拽期间每帧都在算命中与落位，走 React state 每帧重渲染整张格子，
 * 而且落位（.region-slot）要插在列里、浮卡要跨列跟手。React 只在落下之后重渲染一次。
 * ⚠️ 落位节点是外来 DOM：必须在任何 setState（onDrop / onMenu）之前摘掉，否则 React 对账会乱。
 *
 * 与弹层整张下拉关闭的关系：长按满之后 activeRef = true，弹层的 touchmove 看到它就让路；
 * 这边用原生非被动 touchmove preventDefault，列表不滚、弹层不被拉下来（sheet-swipe-close-touch）。
 * 吞掉手势后补发的 click 用时间戳（见 patterns「吞掉手势补发的 click：要限时，也要吞一次就作废」）。
 */
import { useEffect, useRef } from 'react';
import type React from 'react';
import { haptic, H } from '../utils/haptics';
import { LONGPRESS_DELAY_MS, LONGPRESS_DRAW_MS } from './useLongPress';

const LP_MS = LONGPRESS_DELAY_MS + LONGPRESS_DRAW_MS;
const CANCEL_PX = 10;
const START_PX = 6;
const EDGE_PX = 56;
/** 磁吸强度「中」（demo 里定的）：离落位 160px 内，越近吸得越多，最多吸过去一半 */
const MAGNET = 0.5;
const MAGNET_RANGE = 160;

interface Options {
  resultsRef: React.RefObject<HTMLElement | null>;
  sheetRef: React.RefObject<HTMLElement | null>;
  /** 细分格正在显示（选了有细分的部位、没在搜索） */
  enabled: boolean;
  arranging: boolean;
  /** 长按满 / 拖拽中为 true：弹层的下拉关闭看到它就让路 */
  activeRef: React.MutableRefObject<boolean>;
  /** 吞掉手势后补发的 click（时间戳） */
  suppressClickRef: React.MutableRefObject<number>;
  /** 浮卡上显示的名字 / 是否收藏 */
  describe: (id: string) => { name: string; starred: boolean } | null;
  /** 长按不动松手 */
  onMenu: (id: string) => void;
  /** 落下：target = 细分 id，'' = 未细分；idx = 列内落位下标（未细分时为 null） */
  onDrop: (id: string, target: string, idx: number | null) => void;
  /** 浮起时标签文字 */
  liftLabel: string;
}

interface Gesture {
  el: HTMLElement;
  id: string;
  pid: number;
  x0: number;
  y0: number;
  x: number;
  y: number;
  armed: boolean;
  dragging: boolean;
  t1?: number;
  t2?: number;
  raf?: number;
  floater?: HTMLDivElement;
  grabX: number;
  grabY: number;
  target?: string | null;
  idx?: number | null;
  /** 起手所在列与下标：落回原位＝不算改动 */
  fromCol: string;
  fromIdx: number;
}

export function useRegionDrag(opts: Options): void {
  // 每次渲染刷新，事件回调里永远读到最新的
  const o = useRef(opts);
  o.current = opts;

  useEffect(() => {
    const R = opts.resultsRef.current;
    if (!R) return;
    let g: Gesture | null = null;

    const hostOf = (el: HTMLElement) => (el.closest('[data-drag-host]') as HTMLElement) || el;
    const sheetRect = () => o.current.sheetRef.current!.getBoundingClientRect();

    const addAffordance = (el: HTMLElement, label: string, drawing: boolean) => {
      removeAffordance(el);
      if (drawing) {
        const line = document.createElement('span');
        line.className = 'longpress-line region-lp';
        line.style.animationDuration = `${LONGPRESS_DRAW_MS}ms`;
        el.appendChild(line);
      }
      const lab = document.createElement('span');
      lab.className = 'longpress-label is-down region-lp';
      lab.textContent = label;
      el.appendChild(lab);
    };
    const removeAffordance = (el: HTMLElement) => el.querySelectorAll('.region-lp').forEach(n => n.remove());

    const clearTargets = () => {
      R.querySelectorAll('.is-target').forEach(n => n.classList.remove('is-target'));
      R.querySelectorAll('.region-slot').forEach(n => n.remove());
      R.querySelectorAll('.region-card.is-empty[hidden]').forEach(n => ((n as HTMLElement).hidden = false));
    };

    const end = (keepFloater = false, keepSource = false) => {
      if (!g) return;
      window.clearTimeout(g.t1);
      window.clearTimeout(g.t2);
      if (g.raf) cancelAnimationFrame(g.raf);
      removeAffordance(g.el);
      // 原卡片的淡化留到浮卡落定：命令式加的 class，React 复用节点时不会替我们清，落定时手动摘
      if (!keepSource) hostOf(g.el).classList.remove('is-drag-source');
      if (!keepFloater) g.floater?.remove();
      clearTargets();
      o.current.activeRef.current = false;
      g = null;
    };

    const colOf = (el: HTMLElement) => (el.closest('[data-region-col]') as HTMLElement | null)?.dataset.regionCol ?? null;
    const cardsIn = (col: HTMLElement, exceptId?: string) =>
      [...col.querySelectorAll<HTMLElement>('[data-drag-id]')].filter(k => k.dataset.dragId !== exceptId);

    const onDown = (ev: PointerEvent) => {
      if (!o.current.enabled) return;
      const el = (ev.target as HTMLElement).closest<HTMLElement>('[data-drag-id]');
      if (!el || !R.contains(el) || (ev.pointerType === 'mouse' && ev.button !== 0)) return;
      end();
      const fromCol = colOf(el) ?? '';
      const colEl = fromCol ? R.querySelector<HTMLElement>(`[data-region-col="${fromCol}"]`) : null;
      g = {
        el,
        id: el.dataset.dragId!,
        pid: ev.pointerId,
        x0: ev.clientX,
        y0: ev.clientY,
        x: ev.clientX,
        y: ev.clientY,
        armed: o.current.arranging,
        dragging: false,
        grabX: 0,
        grabY: 0,
        fromCol,
        fromIdx: colEl ? cardsIn(colEl).indexOf(el) : -1,
      };
      if (g.armed) {
        o.current.activeRef.current = true;
        return;
      }
      const cur = g;
      cur.t1 = window.setTimeout(() => {
        if (g === cur && !cur.armed) addAffordance(hostOf(cur.el), o.current.liftLabel, true);
      }, LONGPRESS_DELAY_MS);
      cur.t2 = window.setTimeout(() => {
        if (g !== cur || cur.armed) return;
        cur.armed = true;
        o.current.activeRef.current = true;
        haptic(H.longpress);
        addAffordance(hostOf(cur.el), o.current.liftLabel, false);
      }, LP_MS);
    };

    // 长按满 / 整理模式：拦住滚动与弹层下拉（非被动才拦得住）
    const onTouchMove = (ev: TouchEvent) => {
      if (g && (g.armed || g.dragging)) ev.preventDefault();
    };

    const place = (x: number, y: number) => {
      g!.floater!.style.setProperty('--fx', `${x}px`);
      g!.floater!.style.setProperty('--fy', `${y}px`);
    };

    const startDrag = () => {
      const cur = g!;
      cur.dragging = true;
      removeAffordance(hostOf(cur.el));
      const host = hostOf(cur.el);
      const r = host.getBoundingClientRect();
      const isCard = host.classList.contains('region-card');
      // 「未细分」的长条行浮起时收成一张小卡，宽度跟格子的一列一样，不然吸不进列里
      const colW = R.querySelector('[data-region-col]')?.getBoundingClientRect().width || 118;
      const fw = isCard ? r.width : colW;
      const info = o.current.describe(cur.id);
      const f = document.createElement('div');
      f.className = 'region-card region-floater';
      f.style.setProperty('--fw', `${fw}px`);
      const nm = document.createElement('span');
      nm.className = 'region-card-name';
      nm.textContent = (info?.starred ? '★ ' : '') + (info?.name ?? '');
      f.appendChild(nm);
      o.current.sheetRef.current!.appendChild(f);
      cur.floater = f;
      cur.grabX = Math.min(cur.x0 - r.left, fw - 12);
      cur.grabY = Math.min(cur.y0 - r.top, 40);
      host.classList.add('is-drag-source');
      cur.target = undefined;
      const sr = sheetRect();
      place(cur.x - sr.left - cur.grabX, cur.y - sr.top - cur.grabY);
      haptic(H.tap);
      autoScroll();
    };

    /** 手指下的落点：细分 id / ''（未细分那一片）/ null（格子外） */
    const hitTarget = (x: number, y: number): string | null => {
      const board = R.querySelector('[data-region-board]');
      const un = R.querySelector('[data-region-col=""]');
      if (!board) return null;
      const br = board.getBoundingClientRect();
      if (un && y >= un.getBoundingClientRect().top - 8) return '';
      if (y < br.top - 4 || y > br.bottom + 8) return null;
      for (const c of R.querySelectorAll<HTMLElement>('[data-region-board] [data-region-col]')) {
        const cr = c.getBoundingClientRect();
        if (x >= cr.left - 3 && x <= cr.right + 3) return c.dataset.regionCol!;
      }
      return null;
    };

    const moveDrag = () => {
      const cur = g!;
      const t = hitTarget(cur.x, cur.y);
      let idx: number | null = null;
      let colEl: HTMLElement | null = null;
      if (t) {
        colEl = R.querySelector<HTMLElement>(`[data-region-board] [data-region-col="${t}"]`);
        const kids = colEl ? cardsIn(colEl, cur.id) : [];
        idx = kids.findIndex(k => {
          const kr = k.getBoundingClientRect();
          return cur.y < kr.top + kr.height / 2;
        });
        if (idx < 0) idx = kids.length;
      }
      if (t !== cur.target || idx !== cur.idx) {
        const colChanged = t !== cur.target;
        cur.target = t;
        cur.idx = idx;
        clearTargets();
        if (t !== null) {
          if (t && colEl) {
            colEl.classList.add('is-target');
            R.querySelector(`[data-region-head="${t}"]`)?.classList.add('is-target');
            const slot = document.createElement('div');
            slot.className = 'region-slot';
            colEl.querySelectorAll<HTMLElement>('.region-card.is-empty').forEach(n => (n.hidden = true));
            const kids = cardsIn(colEl, cur.id);
            if (kids[idx!]) colEl.insertBefore(slot, kids[idx!]);
            else colEl.appendChild(slot);
          } else {
            R.querySelector('[data-region-col=""]')?.classList.add('is-target');
          }
          if (colChanged) haptic(H.tap);
        }
      }
      const sr = sheetRect();
      let x = cur.x - sr.left - cur.grabX;
      let y = cur.y - sr.top - cur.grabY;
      const slot = R.querySelector('.region-slot');
      if (slot) {
        const s = slot.getBoundingClientRect();
        const sx = s.left - sr.left;
        const sy = s.top - sr.top;
        const pull = MAGNET * Math.max(0, 1 - Math.hypot(sx - x, sy - y) / MAGNET_RANGE);
        x += (sx - x) * pull;
        y += (sy - y) * pull;
      }
      place(x, y);
    };

    const autoScroll = () => {
      if (!g || !g.dragging) return;
      const rr = R.getBoundingClientRect();
      let dy = 0;
      if (g.y < rr.top + EDGE_PX) dy = -Math.ceil((rr.top + EDGE_PX - g.y) / 6);
      else if (g.y > rr.bottom - EDGE_PX) dy = Math.ceil((g.y - (rr.bottom - EDGE_PX)) / 6);
      if (dy) {
        R.scrollTop += dy;
        moveDrag();
      }
      const b = R.querySelector<HTMLElement>('[data-region-board].is-scroll');
      if (b) {
        const br = b.getBoundingClientRect();
        if (g.x < br.left + 40) {
          b.scrollLeft -= 6;
          moveDrag();
        } else if (g.x > br.right - 40) {
          b.scrollLeft += 6;
          moveDrag();
        }
      }
      g.raf = requestAnimationFrame(autoScroll);
    };

    /** 浮卡滑进落位；收尾回调幂等（transitionend + 兜底 timer 只许进一个） */
    const land = (f: HTMLDivElement, x: number, y: number, done: () => void) => {
      f.classList.add('is-landing');
      f.style.setProperty('--fx', `${x}px`);
      f.style.setProperty('--fy', `${y}px`);
      let fired = false;
      const fin = () => {
        if (fired) return;
        fired = true;
        f.remove();
        done();
      };
      f.addEventListener('transitionend', fin, { once: true });
      window.setTimeout(fin, 320);
    };

    const drop = () => {
      const cur = g!;
      const f = cur.floater!;
      const t = cur.target;
      const sr = sheetRect();
      const unchanged =
        t === null || t === undefined || (t === cur.fromCol && (t === '' || cur.idx === cur.fromIdx));
      const slot = R.querySelector('.region-slot');
      const dest = unchanged
        ? hostOf(cur.el).getBoundingClientRect()
        : (slot ?? R.querySelector('[data-region-col=""]') ?? hostOf(cur.el)).getBoundingClientRect();
      const id = cur.id;
      const idx = t ? cur.idx ?? null : null;
      const source = hostOf(cur.el);
      // 先摘外来节点（落位、高亮），再让 React 重渲染
      end(true, true);
      land(f, dest.left - sr.left, dest.top - sr.top, () => {
        source.classList.remove('is-drag-source');
        if (!unchanged) o.current.onDrop(id, t as string, idx);
      });
    };

    const onMove = (ev: PointerEvent) => {
      if (!g || ev.pointerId !== g.pid) return;
      g.x = ev.clientX;
      g.y = ev.clientY;
      const d = Math.hypot(g.x - g.x0, g.y - g.y0);
      if (!g.armed) {
        if (d > CANCEL_PX) end(); // 长按满之前动了＝在滚
        return;
      }
      if (!g.dragging) {
        if (d <= START_PX) return;
        startDrag();
      }
      moveDrag();
    };

    const onUp = (ev: PointerEvent) => {
      if (!g || ev.pointerId !== g.pid) return;
      if (g.dragging) {
        o.current.suppressClickRef.current = performance.now();
        drop();
        return;
      }
      if (g.armed && !o.current.arranging) {
        o.current.suppressClickRef.current = performance.now();
        const id = g.id;
        end();
        o.current.onMenu(id);
        return;
      }
      end();
    };

    const onCancel = () => end();

    R.addEventListener('pointerdown', onDown);
    R.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    return () => {
      end();
      R.removeEventListener('pointerdown', onDown);
      R.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
    };
    // 只挂一次：回调都从 o.current 读
  }, []);
}
