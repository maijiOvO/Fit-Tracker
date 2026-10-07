/**
 * 拖到细分（添加动作弹层的细分格；2026-10 第三版：docs/demos/region-board-v3.html）
 *
 * 只在「整理」里生效（2026-10-06 用户定：普通态长按只出动作面板，不能拖；整理是低频需求，所有整理的事都在这里）。
 *
 * 手势：
 *   - 按住即拖：按下就接管，手指一动（> 6px）浮起；不动松手＝普通点击（弹层据此打开动作面板）。
 *   - 拖拽中：手指下那一列（两条栏线之间）整列亮起 + 表头反白；列里虚线落位跟着手指高度走
 *     （放第几个就是第几个）；浮卡被吸向落位（磁吸「中」）；跨列震一下。拖到「未细分」那一片＝放回未细分。
 *     靠近列表上下缘自动滚；横滑时（细分多于 4 个 / 英文）靠近左右缘自动横滚。
 *   - 松手：浮卡滑进落位后回调 onDrop；放回原位 / 拖到格子外＝原样放回。
 *
 * 格子是行对齐的 grid（卡片带显式 grid-column / grid-row），落位不能像 flex 列那样插节点：
 * 按显式行号把目标列里落位之后的卡往下挪一行，空出来的那一格放虚线落位。
 *
 * 为什么整个拖拽走 DOM 命令式：拖拽期间每帧都在算命中与落位，走 React state 每帧重渲染整张格子。
 * React 只在落下之后重渲染一次。
 * ⚠️ 落位节点、改过的行号是外来 DOM：必须在任何 setState（onDrop）之前复原，否则 React 对账会乱。
 *
 * 与弹层整张下拉关闭的关系：按下即 activeRef = true，弹层的 touchmove 看到它就让路；
 * 这边用原生非被动 touchmove preventDefault，列表不滚、弹层不被拉下来（sheet-swipe-close-touch）。
 * 吞掉拖完补发的 click 用时间戳（见 patterns「吞掉手势补发的 click：要限时，也要吞一次就作废」）。
 */
import { useEffect, useRef } from 'react';
import type React from 'react';
import { haptic, H } from '../utils/haptics';

const START_PX = 6;
const EDGE_PX = 56;
/** 磁吸强度「中」（demo 里定的）：离落位 160px 内，越近吸得越多，最多吸过去一半 */
const MAGNET = 0.5;
const MAGNET_RANGE = 160;

interface Options {
  resultsRef: React.RefObject<HTMLElement | null>;
  sheetRef: React.RefObject<HTMLElement | null>;
  /** 整理态、细分格正在显示 */
  enabled: boolean;
  /** 拖拽接管中为 true：弹层的下拉关闭看到它就让路 */
  activeRef: React.MutableRefObject<boolean>;
  /** 吞掉拖完补发的 click（时间戳） */
  suppressClickRef: React.MutableRefObject<number>;
  /** 落下：target = 细分 id，'' = 未细分；idx = 列内落位下标（未细分时为 null） */
  onDrop: (id: string, target: string, idx: number | null) => void;
}

interface Gesture {
  el: HTMLElement;
  id: string;
  pid: number;
  x0: number;
  y0: number;
  x: number;
  y: number;
  dragging: boolean;
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

interface Band {
  id: string;
  ci: number;
  left: number;
  right: number;
}

export function useRegionDrag(opts: Options): void {
  // 每次渲染刷新，事件回调里永远读到最新的
  const o = useRef(opts);
  o.current = opts;

  useEffect(() => {
    const R = opts.resultsRef.current;
    if (!R) return;
    let g: Gesture | null = null;

    const sheetRect = () => o.current.sheetRef.current!.getBoundingClientRect();
    /** 某一列格子里的卡，按显式行号排 */
    const colCards = (col: string, exceptId?: string) =>
      [...R.querySelectorAll<HTMLElement>(`.region-grid [data-region-col="${CSS.escape(col)}"][data-drag-id]`)]
        .filter(k => k.dataset.dragId !== exceptId)
        .sort((a, b) => Number(a.dataset.r) - Number(b.dataset.r));

    /** 复原格子：行号回到 React 给的值、去掉落位 / 高亮 */
    const clearTargets = () => {
      R.querySelectorAll('.is-target').forEach(n => n.classList.remove('is-target'));
      R.querySelectorAll('.region-slot').forEach(n => n.remove());
      R.querySelector('.region-band')?.classList.remove('is-on');
      R.querySelectorAll<HTMLElement>('.region-grid [data-r]').forEach(c => {
        c.style.gridRow = c.dataset.r!;
        c.style.display = '';
      });
      R.querySelectorAll<HTMLElement>('.region-grid .region-card.is-empty').forEach(n => (n.style.display = ''));
    };

    const end = (keepFloater = false, keepSource = false) => {
      if (!g) return;
      if (g.raf) cancelAnimationFrame(g.raf);
      // 原卡片的淡化留到浮卡落定：命令式加的 class，React 复用节点时不会替我们清，落定时手动摘
      if (!keepSource) g.el.classList.remove('is-drag-source');
      if (!keepFloater) g.floater?.remove();
      clearTargets();
      o.current.activeRef.current = false;
      g = null;
    };

    /** 每一列的范围＝两条栏线之间（第一列从左边缘起，最后一列到右边缘） */
    const bands = (): Band[] => {
      const heads = [...R.querySelectorAll<HTMLElement>('.region-heads [data-region-head]')];
      const rs = heads.map(h => h.getBoundingClientRect());
      return heads.map((h, i) => ({
        id: h.dataset.regionHead!,
        ci: i + 1,
        left: i === 0 ? rs[i].left - 6 : (rs[i - 1].right + rs[i].left) / 2,
        right: i === rs.length - 1 ? rs[i].right + 4 : (rs[i].right + rs[i + 1].left) / 2,
      }));
    };

    const onDown = (ev: PointerEvent) => {
      if (!o.current.enabled) return;
      const el = (ev.target as HTMLElement).closest<HTMLElement>('[data-drag-id]');
      if (!el || !R.contains(el) || (ev.pointerType === 'mouse' && ev.button !== 0)) return;
      end();
      const fromCol = el.dataset.regionCol ?? '';
      g = {
        el,
        id: el.dataset.dragId!,
        pid: ev.pointerId,
        x0: ev.clientX,
        y0: ev.clientY,
        x: ev.clientX,
        y: ev.clientY,
        dragging: false,
        grabX: 0,
        grabY: 0,
        fromCol,
        fromIdx: fromCol ? colCards(fromCol).indexOf(el) : -1,
      };
      o.current.activeRef.current = true;
    };

    // 按下即接管：拦住滚动与弹层下拉（非被动才拦得住）
    const onTouchMove = (ev: TouchEvent) => {
      if (g) ev.preventDefault();
    };

    const place = (x: number, y: number) => {
      g!.floater!.style.setProperty('--fx', `${x}px`);
      g!.floater!.style.setProperty('--fy', `${y}px`);
    };

    const startDrag = () => {
      const cur = g!;
      cur.dragging = true;
      const host = cur.el;
      const r = host.getBoundingClientRect();
      const f = document.createElement('div');
      f.className = 'region-card region-floater';
      f.style.setProperty('--fw', `${r.width}px`);
      f.style.setProperty('--fh', `${r.height}px`);
      // 名字原样搬过去（含按词断行的 <wbr> 与右上角的星）
      host.querySelectorAll('.region-card-name, .region-card-star').forEach(n => f.appendChild(n.cloneNode(true)));
      o.current.sheetRef.current!.appendChild(f);
      cur.floater = f;
      cur.grabX = cur.x0 - r.left;
      cur.grabY = cur.y0 - r.top;
      host.classList.add('is-drag-source');
      cur.target = undefined;
      const sr = sheetRect();
      place(cur.x - sr.left - cur.grabX, cur.y - sr.top - cur.grabY);
      haptic(H.tap);
      autoScroll();
    };

    /** 手指下的落点：某一列 / ''（未细分那一片）/ null（格子外） */
    const hitTarget = (x: number, y: number): { t: string | null; band?: Band } => {
      const heads = R.querySelector('.region-heads');
      const gw = R.querySelector('.region-gwrap');
      if (!heads || !gw) return { t: null };
      // 「未细分」只从它的卡片开始算；它的小标题那一条归格子末尾 ——
      // 最长那一列的尾巴紧贴着它，不留这一条的话，往最长的列末尾放会被判成「放回未细分」（走查实测）
      const body = R.querySelector('[data-region-col=""] [data-drop-body]') ?? R.querySelector('.region-unzone');
      const bodyTop = body ? body.getBoundingClientRect().top : Infinity;
      if (y >= bodyTop - 4) return { t: '' };
      const top = heads.getBoundingClientRect().top - 4;
      if (y < top) return { t: null };
      const band = bands().find(b => x >= b.left && x < b.right);
      return band ? { t: band.id, band } : { t: null };
    };

    /** 在目标列里按显式行号让出一格给落位 */
    const layoutSlot = (t: string, idx: number, ci: number) => {
      const cur = g!;
      const grid = R.querySelector<HTMLElement>('.region-grid');
      if (!grid) return;
      const kids = colCards(t, cur.id);
      // 拖的卡在本列时先藏起来（它的位置交给落位）
      if (cur.fromCol === t) cur.el.style.display = 'none';
      kids.forEach((k, i) => (k.style.gridRow = String(i < idx ? i + 1 : i + 2)));
      grid.querySelectorAll<HTMLElement>('.region-card.is-empty').forEach(n => {
        if (n.dataset.ci === String(ci)) n.style.display = 'none';
      });
      const slot = document.createElement('div');
      slot.className = 'region-slot';
      slot.style.gridColumn = String(ci);
      slot.style.gridRow = String(idx + 1);
      grid.appendChild(slot);
    };

    const moveDrag = () => {
      const cur = g!;
      const { t, band } = hitTarget(cur.x, cur.y);
      let idx: number | null = null;
      if (t) {
        const kids = colCards(t, cur.id);
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
        if (t && band) {
          // clearTargets 把源卡的 display 也复原了；离开本列时它照常淡化着留在原位
          layoutSlot(t, idx!, band.ci);
          R.querySelector(`[data-region-head="${CSS.escape(t)}"]`)?.classList.add('is-target');
          const bd = R.querySelector<HTMLElement>('.region-band');
          const gw = R.querySelector('.region-gwrap');
          if (bd && gw) {
            const gl = gw.getBoundingClientRect().left;
            bd.style.left = `${band.left - gl}px`;
            bd.style.width = `${band.right - band.left}px`;
            bd.classList.add('is-on');
          }
        } else if (t === '') {
          R.querySelector('.region-unzone')?.classList.add('is-target');
        }
        if (colChanged && t !== null) haptic(H.tap);
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
      const b = R.querySelector<HTMLElement>('.region-board.is-scroll .region-bscroll');
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
      const tray = R.querySelector('[data-region-col=""] [data-drop-body]') ?? R.querySelector('.region-unzone');
      const dest = unchanged ? null : (slot ?? tray)?.getBoundingClientRect() ?? null;
      const id = cur.id;
      const idx = t ? cur.idx ?? null : null;
      const source = cur.el;
      // 先复原外来 DOM（落位、行号、高亮），再量原位、再让 React 重渲染
      end(true, true);
      const back = source.getBoundingClientRect();
      const to = dest ?? back;
      land(f, to.left - sr.left, to.top - sr.top, () => {
        source.classList.remove('is-drag-source');
        if (!unchanged) o.current.onDrop(id, t as string, idx);
      });
    };

    const onMove = (ev: PointerEvent) => {
      if (!g || ev.pointerId !== g.pid) return;
      g.x = ev.clientX;
      g.y = ev.clientY;
      if (!g.dragging) {
        if (Math.hypot(g.x - g.x0, g.y - g.y0) <= START_PX) return;
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
      // 没动就松手＝点击，交给卡片自己的 onClick（整理态＝打开动作面板）
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
