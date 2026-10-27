/**
 * 刊末页 —— 规格 §5.3 / §9
 *
 * 翻到刊末页：期号（历史训练总数 + 1）、本期摘要、日期逐行 clip 揭示（stagger 60ms），
 * 总容量 count-up，底部朱砂线从中心展开＝付印。
 *
 * ⚠️ **非 PR 日也必须有收尾。** 90% 的训练不刷 PR，
 * 只为 PR 设计仪式是原方案最大的功能性空白。
 * 刊末页与 PR 盖章共用这一套组件，PR 时才升级为完整盖章序列。
 *
 * 必须可点击跳过 —— 任何位置点一下就走。
 */
import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Language } from '../../types';
import { PRHit } from '../utils/prDetect';
import { useCountUp } from '../hooks/useCountUp';
import { haptic, H } from '../utils/haptics';
import { plural } from '../utils/format';
import { useBackClose } from '../hooks/useBackClose';

interface Props {
  open: boolean;
  lang: Language;
  /** 期号：历史训练总数 + 1 */
  issueNo: number;
  title: string;
  dateISO: string;
  exerciseCount: number;
  setCount: number;
  /** 练了多少分钟；null 不显示这一项（补记的、忘了结束的） */
  durationMin: number | null;
  /** 总容量，已按当前单位换算 */
  volume: number;
  unitLabel: string;
  stamps: PRHit[];
  /** >2 枚时合并的「另 N 项刷新」 */
  extraCount: number;
  onDone: () => void;
}

const KIND_LABEL: Record<PRHit['kind'], { cn: string; en: string }> = {
  weight: { cn: '最大重量', en: 'Heaviest' },
  e1rm: { cn: '估算 1RM', en: 'Est. 1RM' },
  volume: { cn: '单组容量', en: 'Set volume' },
  reps: { cn: '次', en: 'reps' },
};

/** 次数纪录在多重的时候做的：「· 60 kg」，辅助的写「· 辅助 30 kg」 */
function atLoad(s: PRHit, isCn: boolean): string {
  if (s.atKg === undefined || s.atKg === 0) return s.atKg === 0 ? (isCn ? ' · 自重' : ' · bodyweight') : '';
  const w = trim(Math.abs(s.atKg));
  return s.atKg < 0 ? (isCn ? ` · 辅助 ${w} ${s.unitLabel}` : ` · assisted ${w} ${s.unitLabel}`) : ` · ${w} ${s.unitLabel}`;
}

function trim(n: number): string {
  return String(Number(n.toFixed(1)));
}

export const WorkoutColophon: React.FC<Props> = ({
  open,
  lang,
  issueNo,
  title,
  dateISO,
  exerciseCount,
  setCount,
  durationMin,
  volume,
  unitLabel,
  stamps,
  extraCount,
  onDone,
}) => {
  const isCn = lang === Language.CN;
  const hasPR = stamps.length > 0;
  const firedRef = useRef(false);

  // 总容量 count-up：这是「因为你刚做完这场而产生」的数字，可以动（§5.4）
  const volumeText = useCountUp(volume, { durationMs: 700, decimals: volume >= 1000 ? 1 : 0, disabled: !open });

  useEffect(() => {
    if (!open) {
      firedRef.current = false;
      return;
    }
    // §5.7 第 1 条：先发震动再启动画，马达机械启动天然落后。
    // 落章的语义时刻是印落定那一帧，所以延到落章时再来一记重的。
    if (!firedRef.current) {
      firedRef.current = true;
      if (hasPR) {
        // 印章落定约在 520ms 后
        const t = window.setTimeout(() => haptic(H.seal), 460);
        return () => window.clearTimeout(t);
      }
      haptic(H.tap);
    }
  }, [open, hasPR]);

  // 自动收尾只给非 PR：约 1900ms 后自己收（可以提前点掉）。
  // PR 那天留在这页，等用户点任意处才收——破纪录值得多看一眼。
  useEffect(() => {
    if (!open || hasPR) return;
    const t = window.setTimeout(onDone, 1900);
    return () => window.clearTimeout(t);
  }, [open, hasPR, onDone]);

  // 安卓返回键＝收起这页（审查 B11）
  useBackClose(open, onDone);

  if (!open) return null;

  const dateText = new Date(dateISO).toLocaleDateString(isCn ? 'zh-CN' : 'en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return createPortal(
    <div
      className="fixed inset-0 z-confirm bg-base flex flex-col items-center justify-center px-8 anim-fade"
      onClick={onDone}
      role="button"
      tabIndex={0}
      aria-label={isCn ? '点击继续' : 'Tap to continue'}
      data-testid="workout-colophon"
    >
      {/* 刊头：期号 */}
      <p className="anim-stagger font-mono text-label text-tertiary tabular-nums" style={{ ['--i' as string]: 0 }}>
        Vol.{issueNo}
      </p>

      <h1
        className="anim-stagger font-display text-headline text-primary text-center mt-2 break-words"
        style={{ ['--i' as string]: 1 }}
      >
        {title}
      </h1>

      <p className="anim-stagger text-body text-secondary mt-1" style={{ ['--i' as string]: 2 }}>
        {dateText}
      </p>

      {/* 本期摘要 */}
      <div className="anim-stagger flex items-baseline gap-5 mt-8" style={{ ['--i' as string]: 3 }}>
        <span className="text-center">
          <span className="block font-mono font-semibold text-data-md text-primary tabular-nums">
            {exerciseCount}
          </span>
          <span className="text-micro text-tertiary">
            {isCn ? '动作' : plural(exerciseCount, 'exercise')}
          </span>
        </span>
        <span className="text-center">
          <span className="block font-mono font-semibold text-data-md text-primary tabular-nums">{setCount}</span>
          <span className="text-micro text-tertiary">{isCn ? '组' : plural(setCount, 'set')}</span>
        </span>
        {/* 时长只在这里和时间线出现，训练中不计时（2026-10-27 批示）；数字是结束那一刻定下来的，不动画 */}
        {durationMin !== null && (
          <span className="text-center" data-testid="colophon-duration">
            <span className="block font-mono font-semibold text-data-md text-primary tabular-nums">{durationMin}</span>
            <span className="text-micro text-tertiary">{isCn ? '分' : 'min'}</span>
          </span>
        )}
        <span className="text-center">
          <span className="block font-mono font-semibold text-data-xl text-primary tabular-nums">{volumeText}</span>
          <span className="text-micro text-tertiary">
            {isCn ? '总容量' : 'volume'} {unitLabel}
          </span>
        </span>
      </div>

      {/* PR 落章。全 App 只有这里和结束训练允许盖章语汇。 */}
      {hasPR && (
        <div className="flex items-start gap-4 mt-10">
          {stamps.map((s, i) => (
            <div key={`${s.kind}-${s.exercise}`} className="flex flex-col items-center">
              {/* 「杠铃片」§1：纪录＝镁粉。白底墨框的 PB 牌（田径成绩单的写法），中英文同一个牌；
                  不借任何片子的颜色（红色已经表示 25 kg），也不再用印章字。
                  落下的动作沿用 anim-stamp-drop：签名时刻的节奏不变，换的只是材料。 */}
              <span
                className="anim-stamp-drop flex items-center justify-center w-16 h-16 rounded-stamp bg-chalk text-on-chalk border-2 border-on-chalk font-mono font-bold text-3xl leading-none tracking-[0.04em]"
                style={{ animationDelay: `${i * 140}ms` }}
                aria-hidden
              >
                PB
              </span>
              <span
                className="anim-reveal mt-2 text-micro text-secondary text-center max-w-[8rem]"
                style={{ animationDelay: `${600 + i * 140}ms` }}
              >
                {s.exercise}
                <br />
                <span className="font-mono text-primary tabular-nums">
                  {trim(s.prev)} → {trim(s.next)}
                </span>{' '}
                {KIND_LABEL[s.kind][isCn ? 'cn' : 'en']}
                {s.kind === 'reps' ? atLoad(s, isCn) : s.unitLabel ? ` ${s.unitLabel}` : ''}
              </span>
            </div>
          ))}
          {extraCount > 0 && (
            <span
              className="anim-reveal self-center text-micro text-secondary"
              style={{ animationDelay: '760ms' }}
            >
              {isCn ? `另 ${extraCount} 项刷新` : `+${extraCount} more`}
            </span>
          )}
        </div>
      )}

      {/* 付印：底部朱砂线从中心向两端展开 */}
      <span className="anim-press-line mt-12 h-px w-40 bg-accent" aria-hidden />

      <p className="mt-4 text-micro text-tertiary">
        {isCn ? '今天多记住了一点' : 'A little more remembered today'}
      </p>
    </div>,
    document.body,
  );
};
