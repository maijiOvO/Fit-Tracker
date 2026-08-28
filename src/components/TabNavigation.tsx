/**
 * 底部导航栏 — 贴底通栏 + 左侧凸起 FAB
 *
 * §12.4 FAB 印谱扇开：点按语义不变（进新训练页，页内印谱六选一）；
 * 长按 120ms 后六枚部位印从拇指下扇形摊开，滑到某枚松手＝落章开练。
 * 状态机、几何与三个实现坑见 docs/design-ink-and-paper.md §12.4，
 * 可玩的调参 demo 在 docs/demos/fab-seal-fan.html。
 */
import React, { useCallback, useRef, useState } from 'react';
import { BarChart2, CalendarDays, User as UserIcon, Plus } from 'lucide-react';
import { translations } from '../../translations';
import { Language } from '../../types';
import { FAN_PARTS, type BodyPartKey } from './BodyPartPicker';
import { haptic, H } from '../utils/haptics';

type TabType = 'dashboard' | 'new' | 'plan' | 'profile';

interface TabNavigationProps {
  activeTab: TabType;
  onTabChange: (tab: TabType) => void;
  lang: Language;
  onStartWorkout?: () => void;
  /** §12.4：印谱扇开选中某枚印。title=训练名（「制」为 null，进页后写名字） */
  onStartWorkoutWithPart?: (partKey: BodyPartKey, title: string | null) => void;
}

/* ── 扇形几何（初值定稿于 §12.4，待真机调） ── */
const OPEN_DELAY_MS = 120; // 前 120ms 什么都不出，点按不许闪印谱
const TAP_MAX_MS = 250; // 松手总时长 < 250ms 仍按点按算
const FAN_R = 175; // 半径。160 时印与印只剩 1px 缝
const FAN_START_DEG = 95; // 从近垂直……
const FAN_SPAN_DEG = 85; // ……扫到近水平
const SEAL_PX = 46; // 印面（页内印谱是 52，扇里略小）
const HIT_R = 48; // 命中=最近印中心距指尖 ≤48px，滑选目标要虚胖
const COMMIT_MS = 260; // 落章过冲播完再切页

interface FanSeal {
  key: BodyPartKey;
  seal: string;
  label: string;
  dashed?: boolean;
  x: number;
  y: number;
  dx: number;
  dy: number;
  hx: number;
  hy: number;
}

const TabNavigation: React.FC<TabNavigationProps> = ({
  activeTab,
  onTabChange,
  lang,
  onStartWorkout,
  onStartWorkoutWithPart,
}) => {
  const isCn = lang === Language.CN;

  const handleStartClick = () => {
    if (onStartWorkout) onStartWorkout();
    else onTabChange('new');
  };

  /* ── 印谱扇开状态机 ── */
  const fabRef = useRef<HTMLButtonElement | null>(null);
  const [fanState, setFanState] = useState<'idle' | 'open' | 'tapmode'>('idle');
  const [seals, setSeals] = useState<FanSeal[]>([]);
  const [inCount, setInCount] = useState(0); // stagger：前 inCount 枚已就位
  const [hovered, setHovered] = useState<number | null>(null);
  const [committing, setCommitting] = useState<number | null>(null);

  const pidRef = useRef<number | null>(null);
  const downTRef = useRef(0);
  const openTimerRef = useRef<number | null>(null);
  const staggerTimersRef = useRef<number[]>([]);
  /** 吞掉手势后的原生 click。时间戳而不是布尔（§12.3 粘滞布尔的教训）。 */
  const suppressClickAtRef = useRef(0);

  const clearStagger = () => {
    for (const t of staggerTimersRef.current) window.clearTimeout(t);
    staggerTimersRef.current = [];
  };

  const closeFan = useCallback(() => {
    if (openTimerRef.current !== null) {
      window.clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
    clearStagger();
    setFanState('idle');
    setInCount(0);
    hoveredValRef.current = null;
    setHovered(null);
    setCommitting(null);
  }, []);

  const openFan = useCallback(() => {
    openTimerRef.current = null;
    const fab = fabRef.current;
    if (!fab || !onStartWorkoutWithPart) return;
    const r = fab.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const step = FAN_SPAN_DEG / (FAN_PARTS.length - 1);
    const next: FanSeal[] = FAN_PARTS.map((p, i) => {
      const rad = ((FAN_START_DEG - step * i) * Math.PI) / 180;
      const x = cx + FAN_R * Math.cos(rad);
      const y = cy - FAN_R * Math.sin(rad);
      return {
        key: p.key,
        seal: p.seal,
        label: translations[p.tk][lang] as string,
        dashed: p.dashed,
        x,
        y,
        dx: cx - x, // 收拢态指回 FAB 圆心的向量
        dy: cy - y,
        hx: 6 * Math.cos(rad), // 悬停沿径向外浮 6px，别压在指头底下
        hy: -6 * Math.sin(rad),
      };
    });
    setSeals(next);
    setFanState('open');
    haptic(H.longpress);
    // stagger 用 setTimeout 加类，别把 transition-delay 赖在行内样式上
    next.forEach((_, i) => {
      staggerTimersRef.current.push(
        window.setTimeout(() => setInCount(c => Math.max(c, i + 1)), i * 32),
      );
    });
  }, [lang, onStartWorkoutWithPart]);

  const pickHover = (x: number, y: number, list: FanSeal[]): number | null => {
    let best: number | null = null;
    let bestD = Infinity;
    list.forEach((s, i) => {
      const d = Math.hypot(x - s.x, y - s.y);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    return bestD <= HIT_R ? best : null;
  };

  const commit = useCallback(
    (idx: number, list: FanSeal[]) => {
      const s = list[idx];
      if (!s || !onStartWorkoutWithPart) return;
      suppressClickAtRef.current = performance.now();
      hoveredValRef.current = null;
      setHovered(null);
      setCommitting(idx);
      haptic(H.seal);
      window.setTimeout(() => {
        closeFan();
        onStartWorkoutWithPart(s.key, s.key === 'other' ? null : s.label);
      }, COMMIT_MS);
    },
    [closeFan, onStartWorkoutWithPart],
  );

  const onFabPointerDown = (e: React.PointerEvent) => {
    if (!e.isPrimary || !onStartWorkoutWithPart) return;
    if (fanState !== 'idle') return;
    pidRef.current = e.pointerId;
    downTRef.current = performance.now();
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* 合成事件没有真指针 */
    }
    openTimerRef.current = window.setTimeout(openFan, OPEN_DELAY_MS);
  };

  const hoveredValRef = useRef<number | null>(null);
  const onFabPointerMove = (e: React.PointerEvent) => {
    if (e.pointerId !== pidRef.current || fanState !== 'open' || committing !== null) return;
    const h = pickHover(e.clientX, e.clientY, seals);
    if (h !== hoveredValRef.current) {
      hoveredValRef.current = h;
      if (h !== null) haptic(H.pick);
      setHovered(h);
    }
  };

  const onFabPointerUp = (e: React.PointerEvent) => {
    if (e.pointerId !== pidRef.current) return;
    pidRef.current = null;
    const t = performance.now() - downTRef.current;

    if (fanState !== 'open') {
      // 印谱还没出 → 纯点按：清 timer，放行原生 click 走原路径
      if (openTimerRef.current !== null) {
        window.clearTimeout(openTimerRef.current);
        openTimerRef.current = null;
      }
      return;
    }
    if (committing !== null) return;
    if (hovered !== null) {
      commit(hovered, seals);
      return;
    }
    if (t < TAP_MAX_MS) {
      // 手快，印谱才刚冒头 → 仍按点按算，放行原生 click
      closeFan();
      return;
    }
    // 按住又原地松手 → 宽容：留在点选模式（点印可选、点空白收回）
    suppressClickAtRef.current = performance.now();
    setFanState('tapmode');
  };

  const onFabPointerCancel = () => {
    // 来电 / 系统手势打断：干净复位，不留半开的扇面
    pidRef.current = null;
    closeFan();
  };

  const onFabClickCapture = (e: React.MouseEvent) => {
    if (performance.now() - suppressClickAtRef.current < 400) {
      suppressClickAtRef.current = 0;
      e.preventDefault();
      e.stopPropagation();
    }
  };

  const tabBtn = (active: boolean) =>
    `flex flex-col items-center justify-center gap-1 transition-colors ${
      active ? 'text-accent' : 'text-tertiary hover:text-secondary'
    }`;

  const fanVisible = fanState !== 'idle';
  const hoveredSeal = hovered !== null ? seals[hovered] : null;

  return (
    <nav
      className="fixed bottom-0 inset-x-0 z-nav bg-base/95 border-t border-divider"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {/* ── 印谱扇开层（fixed，视口坐标；scrim 在 nav 之上、弹层之下） ── */}
      <div
        className={`seal-fan-scrim${fanVisible ? ' is-on' : ''}${
          fanState === 'tapmode' ? ' is-tappable' : ''
        }`}
        onPointerDown={() => {
          if (fanState === 'tapmode') closeFan();
        }}
        aria-hidden
      />
      {fanVisible &&
        seals.map((s, i) => (
          <button
            key={s.key}
            type="button"
            className={`seal-fan-item font-seal${s.dashed ? ' is-dashed' : ''}${
              i < inCount ? ' is-in' : ''
            }${hovered === i && committing === null ? ' is-hover' : ''}${
              committing === i ? ' is-commit' : ''
            }${fanState === 'tapmode' ? ' is-tappable' : ''}`}
            style={
              {
                left: s.x - SEAL_PX / 2,
                top: s.y - SEAL_PX / 2,
                '--dx': `${s.dx}px`,
                '--dy': `${s.dy}px`,
                '--hx': `${s.hx}px`,
                '--hy': `${s.hy}px`,
              } as React.CSSProperties
            }
            aria-label={s.label}
            onClick={() => {
              if (fanState === 'tapmode' && committing === null) commit(i, seals);
            }}
          >
            {s.seal}
          </button>
        ))}
      {hoveredSeal && (
        <span
          className="seal-fan-tip"
          style={{ left: hoveredSeal.x, top: hoveredSeal.y - SEAL_PX / 2 - 8 }}
          aria-hidden
        >
          {hoveredSeal.key === 'other'
            ? isCn
              ? '其他 · 自己命名'
              : 'Other · name it'
            : hoveredSeal.label}
        </span>
      )}

      <div className="relative h-16 max-w-2xl mx-auto grid grid-cols-4">
        <div aria-hidden />

        <button onClick={() => onTabChange('dashboard')} className={tabBtn(activeTab === 'dashboard')}>
          <BarChart2 size={20} strokeWidth={1.75} />
          <span className="text-[10px] font-medium">{translations.dashboard[lang]}</span>
        </button>

        <button
          onClick={() => onTabChange('plan')}
          className={tabBtn(activeTab === 'plan')}
          data-testid="tab-plan"
        >
          <CalendarDays size={20} strokeWidth={1.75} />
          <span className="text-[10px] font-medium">{translations.trainingPlan[lang]}</span>
        </button>

        <button onClick={() => onTabChange('profile')} className={tabBtn(activeTab === 'profile')}>
          <UserIcon size={20} strokeWidth={1.75} />
          <span className="text-[10px] font-medium">{lang === Language.CN ? '我的' : 'Profile'}</span>
        </button>

        {/* FAB：点按走原路径；长按印谱扇开。touch-action:none —— 56px 圆钮上没有滚动语义 */}
        <button
          ref={fabRef}
          onClick={handleStartClick}
          onClickCapture={onFabClickCapture}
          onPointerDown={onFabPointerDown}
          onPointerMove={onFabPointerMove}
          onPointerUp={onFabPointerUp}
          onPointerCancel={onFabPointerCancel}
          onContextMenu={e => e.preventDefault()}
          aria-label={isCn ? '开始训练（按住可直接选部位）' : 'Start workout (hold to pick a body part)'}
          style={{ touchAction: 'none' }}
          className={`absolute left-[12.5%] -translate-x-1/2 -top-5 w-14 h-14 rounded-full text-on-accent bg-accent shadow-elevated ring-4 ring-base flex items-center justify-center active:scale-press-sm transition-transform ${
            activeTab === 'new' ? 'opacity-90' : ''
          }`}
        >
          <Plus size={24} strokeWidth={2.5} />
        </button>
      </div>
    </nav>
  );
};

export default TabNavigation;
