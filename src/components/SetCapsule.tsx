/**
 * 训练组＝账本上的一行（规格 §6.1）
 *
 * 行不再是填充盒：去掉背景与边框，只留 border-bottom，min-height 52px。
 * 从「一堆灰色胶囊」变成账本横线，同屏噪音直接减半。
 *
 * 网格列宽由父卡片通过 --cols 下发，父行与子组行共用同一个变量，
 * 根治原先「表头 px-2、行 p-3」的 4px 错位。
 */
import React, { useState } from 'react';
import { Minus } from 'lucide-react';
import { Language, SubSetLog, SetLog } from '../../types';
import { ledgerCols, metricUnitLabel, LoadMode } from '../utils/exerciseConfig';
import { useLongPress } from '../hooks/useLongPress';
import { useValueScrub, SCRUB_STEPS_REPS, SCRUB_STEPS_WEIGHT } from '../hooks/useValueScrub';
import { LongPressAffordance } from './LongPressAffordance';
import { haptic, H } from '../utils/haptics';

interface SetCapsuleProps {
  set: any;
  setIdx: number;
  activeMetrics: string[];
  /** 负重/辅助标记，影响 weight 列的单位符号（+kg / −kg）。只读历史视图可不传。 */
  loadMode?: LoadMode;
  /** 这一行是刚添加出来的 → 播「写下一组」入场（§5.3） */
  isNew?: boolean;
  unit: string;
  lang: Language;
  readOnly?: boolean;
  onUpdate: (updates: Partial<SetLog>) => void;
  onRemove: () => void;
  onDurationClick?: () => void;
  /**
   * 选中（2026-10 指针）：组号实心，这一组的整块之后露出 −5 / +5。全场至多一行。
   * 默认选中的是指针下面那一组；点别的组号先选中它。
   */
  selected?: boolean;
  /**
   * 点组号交给工作台（选中 / 做完 / 退回由 workbench 判）。只读历史视图不传。
   * 长按组号仍是加一档递减，这里只收「点」。
   */
  onNumTap?: () => void;
  /** 显示的组号（交替组里按动作各数各的）；不传＝setIdx + 1 */
  displayNo?: number;
  /** 交替组：组号前的动作简称，点它＝改记到组里另一个动作名下 */
  badge?: { label: string; onClick: () => void; title: string };
  /** 首列宽（交替组放宽到能放下简称） */
  firstCol?: number;
  /**
   * 带正负的负荷（变体第二层）：重量格按「辅助为负、自重 0、负重为正」记，±5 / 横拖可以跨过 0；
   * 单位前的 + / − 可点，换号。sign 给出旧数据（组上没写号）时的号。
   */
  signed?: { sign: (s: { weight: number; bodyweightMode?: SetLog['bodyweightMode'] }) => -1 | 1 };
  /** 删一档递减：交给工作台做（要挂撤销条，撤销必须按最新状态插回去） */
  onRemoveSub?: (subIdx: number) => void;
}

/**
 * 值字段。待做行上改了其中任何一个，就记进 touched（「改过但没点完成」）——
 * 改值只改值，不再顺手描实（第 4 条）；touched 只给结束训练时的提醒和格子墨色用。
 */
const VALUE_KEYS: (keyof SetLog)[] = [
  'weight', 'reps', 'duration', 'score', 'time', 'timeUnit',
  'distance', 'distanceUnit', 'bodyweightMode', 'subSets',
];
const touchedKeys = (updates: Partial<SetLog>) => VALUE_KEYS.filter(k => k in updates);

function secondsToHMS(seconds: number): { h: number; m: number; s: number } {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return { h, m, s };
}

function formatWeight(kg: number, targetUnit: string): string {
  if (targetUnit === 'lbs') {
    return (kg * 2.20462).toFixed(2).replace(/\.?0+$/, '');
  }
  return kg.toFixed(2).replace(/\.?0+$/, '');
}

function parseWeight(displayValue: number, sourceUnit: string): number {
  if (sourceUnit === 'lbs') {
    return displayValue / 2.20462;
  }
  return displayValue;
}

export const SetCapsule: React.FC<SetCapsuleProps> = ({
  set,
  setIdx,
  activeMetrics,
  loadMode,
  isNew = false,
  unit,
  lang,
  readOnly = false,
  onUpdate,
  onRemove,
  onDurationClick,
  selected = false,
  onNumTap,
  displayNo,
  badge,
  firstCol = 36,
  signed,
  onRemoveSub,
}) => {
  const isCn = lang === Language.CN;
  // §11 坑 1：动画跑完必须摘掉入场类，否则它会盖住后续的反馈动画，
  // 且 fill:both 会把 height 钉死在 52px。
  const [entering, setEntering] = useState(isNew);
  // 显式标注：解构默认值会被本项目的宽松 tsconfig 拓宽成 string
  const mode: LoadMode = loadMode ?? 'none';
  // 自带一份列宽：ExerciseCard 会在卡片上设同样的值（表头要用），
  // 但只读历史视图没有那个父级，行必须自己兜住。
  const colStyle = { ['--cols' as string]: ledgerCols(activeMetrics.length, firstCol) };
  // 直接读 props，不留本地副本：原先的 useState(set.subSets) 只在挂载时读一次，
  // 之后外部改了这一组（底稿预填、撤销、同步回来）子组行不会跟着变。
  const subSets: SubSetLog[] = set.subSets || [];
  const hasSubSets = subSets.length > 0;

  /**
   * 带正负的负荷：号按组算（组上没写按动作实例），显示的是绝对值，号在单位前（+kg / −kg）；
   * 运算（±5、横拖、递减）在带符号的数上做，所以能从 −5 走到 0 再走到 +5。
   */
  const signOf = (
    x: { weight: number; bodyweightMode?: SetLog['bodyweightMode'] },
    parent?: { weight: number; bodyweightMode?: SetLog['bodyweightMode'] },
  ): -1 | 1 => {
    if (!signed) return 1;
    if (x.bodyweightMode === 'assisted') return -1;
    if (x.bodyweightMode === 'weighted') return 1;
    return parent ? signOf(parent) : signed.sign(x);
  };
  const rowSign = signOf(set);
  // 组上写了号（带正负的负荷记下来的）：历史视图没传 signed 也照样显示 + / −
  const ownMode: LoadMode | null =
    set.bodyweightMode === 'assisted' || set.bodyweightMode === 'weighted' ? set.bodyweightMode : null;
  const rowMode: LoadMode = signed
    ? Number(set.weight) > 0
      ? rowSign < 0 ? 'assisted' : 'weighted'
      : 'none'
    : ownMode ?? mode;
  // 单位内嵌在每个数值右下角（§6.1：10px 表头副行已删），所以标签在行内算
  const unitLabels = Object.fromEntries(
    activeMetrics.map(m => [m, metricUnitLabel(m, unit, isCn, rowMode)]),
  ) as Record<string, string>;

  /**
   * 组行三种状态（2026-10 指针）：待做（ghost）/ 跳过（ghost + skipped）/ 做完。
   * 做完没做完看指针位置和数字墨色；组号平时一律空心细框，选中才实心（用户定：只两种样子）。
   * 点组号交给工作台：没选中＝选中；选中的再点＝做完（或刚做完那组＝退回）。改值只改值。
   */
  const isGhost = !!set.ghost && !readOnly;
  const isSkipped = isGhost && !!set.skipped;
  const update = (updates: Partial<SetLog>) => {
    const keys = isGhost ? touchedKeys(updates) : [];
    if (!keys.length) {
      onUpdate(updates);
      return;
    }
    const touched = { ...(set.touched || {}) };
    for (const k of keys) touched[k] = true;
    onUpdate({ ...updates, touched });
  };

  /** 长按加递减达成后，松手带出的那次 click 不能再被读成「点组号」 */
  const longPressAtRef = React.useRef(0);
  const onSetNumClick = () => {
    // 只吞松手带出的那一次：吞完立即作废，否则紧跟着的一次正常点击也会被吃掉
    if (performance.now() - longPressAtRef.current < 600) {
      longPressAtRef.current = 0;
      return;
    }
    onNumTap?.();
  };

  /** 显示单位下的带符号重量 ⇄ 存储（kg，非负 + 号） */
  const toDisplay = (kg: number, sign: -1 | 1) => sign * Number(formatWeight(Number(kg) || 0, unit));
  const fromDisplay = (v: number): Pick<SetLog, 'weight' | 'bodyweightMode'> => {
    const kg = parseWeight(Math.abs(v), unit);
    if (!signed) return { weight: kg };
    return { weight: kg, bodyweightMode: v < 0 ? 'assisted' : v > 0 ? 'weighted' : 'normal' };
  };

  // 重量格横向拖动改值。hook 不能在下面的 map 里调，所以在这里调一次，
  // 再把 handlers 单独摊到 weight 那一格上。
  // 步长按【显示单位】走：kg 里的 1 就是 1kg，lbs 里的 1 就是 1lb，不做换算——
  // 调重量时脑子里想的是「加一点 / 加很多」，不是某个绝对质量。
  const weightDisplay = toDisplay(set.weight, rowSign);
  const weightScrub = useValueScrub({
    value: weightDisplay,
    // 走 update：待做行上横拖只改值、记 touched，不描实
    onChange: next => update(fromDisplay(next)),
    steps: SCRUB_STEPS_WEIGHT,
    disabled: readOnly,
    // 带正负的负荷可以拖过 0（辅助 → 自重 → 负重）
    ...(signed ? { min: -9999 } : {}),
  });
  // 次数格同一套手势（§12.6 提到的一致性补全）：档位 1/2/5，没有 ×10 ——
  // 一次训练里 reps 的动态范围比重量小得多，最高档给到 5 就够跨一整个区间。
  const repsScrub = useValueScrub({
    value: Number(set.reps) || 0,
    onChange: next => update({ reps: next }),
    steps: SCRUB_STEPS_REPS,
    disabled: readOnly,
  });
  const scrubFor = (m: string) =>
    m === 'weight' ? weightScrub : m === 'reps' ? repsScrub : null;

  const handleSubSetUpdate = (subIdx: number, updates: Partial<SubSetLog>) => {
    const newSubSets = [...subSets];
    const cur = newSubSets[subIdx];
    newSubSets[subIdx] = {
      ...cur,
      ...updates,
      // 格子墨色要按格算：哪一格改过，哪一格变实墨
      ...(isGhost ? { touched: { ...(cur.touched || {}), ...Object.fromEntries(Object.keys(updates).filter(k => k === 'weight' || k === 'reps').map(k => [k, true])) } } : {}),
    };
    update({ subSets: newSubSets });
  };

  /**
   * 加一档子组（组型：递减 / 递增，变体第三层）。
   * 上次练过、带着子组的组，底稿里已经原样抄来了（toGhostSets），不经过这里。
   * 这里只管手动加一档：从【上一行】（最后一档，没有就是母组）按当前单位 ∓5（磅就 5 磅，kg 就 5kg），
   * 跟换片的手感一致。上一行若是换算残留（132.28）先取整再走，新档落在整数上。
   * 带正负的负荷在带符号的数上走：+10 → +5 → 0 → −5（递减可以一路降进辅助）。普通重量下限 0。
   * 次数跟上一行一致：递减组多半做到力竭，具体数只能现填。
   */
  const handleAddSubSet = (dir: -1 | 1 = -1) => {
    const prev = subSets.length > 0 ? subSets[subSets.length - 1] : set;
    const prevSign = subSets.length > 0 ? signOf(prev, set) : rowSign;
    const shown = toDisplay(prev.weight, prevSign);
    const residue = Math.abs(shown * 2 - Math.round(shown * 2)) > 1e-6;
    const base = residue ? (dir < 0 ? Math.floor(shown) : Math.ceil(shown)) : shown;
    let next = base + dir * 5;
    if (!signed) next = Math.max(0, next);
    const newSubSet: SubSetLog = {
      id: `sub_${Date.now()}`,
      ...(shown !== 0 || signed ? fromDisplay(next) : { weight: 0 }),
      reps: Number(prev.reps) || 0,
    };
    update({ subSets: [...subSets, newSubSet] });
  };

  const handleRemoveSubSet = (subIdx: number) => {
    haptic(H.tap);
    if (onRemoveSub) {
      onRemoveSub(subIdx);
      return;
    }
    onUpdate({ subSets: subSets.filter((_, i) => i !== subIdx) });
  };

  // 长按组号＝加一档递减（§6.4，极低频动作）。轻点有了自己的意思（选中 / 做完），
  // 所以不再闪「按住加子组」的提示。
  const addSub = useLongPress({
    onLongPress: () => {
      longPressAtRef.current = performance.now();
      handleAddSubSet(-1);
    },
    disabled: readOnly,
  });

  /** −5 / +5：按当前单位；普通重量下限 0，带正负的负荷可以跨过 0。换算残留不取整（只有拖动才取整） */
  const bump = (d: number) => {
    haptic(H.tap);
    let next = Math.round((weightDisplay + d) * 100) / 100;
    if (!signed) next = Math.max(0, next);
    update(fromDisplay(next));
  };

  /** 换号（点单位前的 + / −）：辅助 ⇄ 负重，绝对值不动 */
  const flipSign = () => {
    if (!signed || !(Number(set.weight) > 0)) return;
    haptic(H.tap);
    update({ bodyweightMode: rowSign < 0 ? 'weighted' : 'assisted' });
  };

  /** 子组行的标签：比上一行轻＝递减，重＝递增（按带符号的数比） */
  const subLabel = (i: number): 'drop' | 'up' => {
    const prev = i === 0 ? set : subSets[i - 1];
    const a = toDisplay(prev.weight, i === 0 ? rowSign : signOf(prev, set));
    const b = toDisplay(subSets[i].weight, signOf(subSets[i], set));
    return b > a ? 'up' : 'drop';
  };

  /** 待做 → 做完的那一下渗一次墨（ink-text 与组号同拍）。状态由工作台改，这里只看前后两次的 ghost */
  const [inkin, setInkin] = useState(false);
  const wasGhostRef = React.useRef(!!set.ghost);
  React.useEffect(() => {
    const was = wasGhostRef.current;
    wasGhostRef.current = !!set.ghost;
    if (!was || set.ghost || readOnly) return;
    setInkin(true);
    const t = window.setTimeout(() => setInkin(false), 700);
    return () => window.clearTimeout(t);
  }, [set.ghost, readOnly]);

  const no = displayNo ?? setIdx + 1;

  return (
    <>
      <div
        className={`ledger-row${entering ? ' is-entering' : ''}${isGhost ? ' is-ghost' : ''}${
          isSkipped ? ' is-skipped' : ''
        }${inkin ? ' is-inkin' : ''}${!isGhost && !readOnly ? ' is-inked' : ''}${selected ? ' is-selected' : ''}`}
        style={colStyle}
        data-set-idx={setIdx}
        data-set-id={set.id}
        onAnimationEnd={e => {
          if (e.animationName === 'row-in') setEntering(false);
        }}
      >
        {/* 组号：36×36 胶囊。点 = 选中，选中的再点 = 做完（指针移到它下面）；
            长按 = 加一档递减（达成后吞掉松手那次 click）。交替组在前面加一个动作简称。 */}
        <span className="flex items-center gap-1 min-w-0">
          {badge && (
            <button
              type="button"
              onClick={badge.onClick}
              title={badge.title}
              aria-label={badge.title}
              className="marginalia flex-none min-w-[16px] text-center text-label font-semibold text-secondary"
              data-testid="set-badge"
            >
              {badge.label}
            </button>
          )}
          <span
            className={`set-num relative ${badge ? 'w-[30px] h-[30px]' : 'w-9 h-9'} flex-none flex items-center justify-center select-none font-mono font-semibold text-label text-accent tabular-nums touch-pan-y`}
            onClick={readOnly ? undefined : onSetNumClick}
            role={readOnly ? undefined : 'button'}
            aria-pressed={readOnly ? undefined : selected}
            aria-label={
              readOnly
                ? undefined
                : selected
                  ? isGhost
                    ? isCn ? `第 ${no} 组做完了` : `Set ${no} done`
                    : isCn ? `第 ${no} 组` : `Set ${no}`
                  : isCn ? `选中第 ${no} 组` : `Select set ${no}`
            }
            {...addSub.handlers}
          >
            {no}
            <LongPressAffordance
              active={addSub.pressing}
              label={isCn ? '加子组' : 'Drop set'}
              drawMs={addSub.drawMs}
            />
          </span>
        </span>

        {activeMetrics.map(m => {
          const unitLabel = unitLabels[m] || '';

          if (m === 'duration') {
            const hms = secondsToHMS(set.duration || 0);
            const pad = (n: number) => n.toString().padStart(2, '0');
            return (
              <button
                key={m}
                type="button"
                onClick={onDurationClick}
                disabled={readOnly}
                className={`ledger-field min-h-[44px] font-mono font-semibold text-[22px] leading-none text-primary tabular-nums${
                  readOnly ? '' : ' ledger-fit'
                }`}
                // 居中而不是 .ledger-field 的 baseline：按钮 44px 高、只有一段文字，
                // baseline 会把它顶到格子上沿，比同排的数字高出一截。
                style={{ ['--ledger-chars' as string]: 8, alignItems: 'center' }}
              >
                <span className="ledger-fit-text">
                  {pad(hms.h)}:{pad(hms.m)}:{pad(hms.s)}
                </span>
              </button>
            );
          }

          if (readOnly) {
            const raw = set[m as keyof SetLog];
            const display =
              m === 'weight'
                ? formatWeight(Number(raw) || 0, unit)
                : raw === 0 || raw === undefined
                  ? '—'
                  : String(raw);
            return (
              <span key={m} className="ledger-field">
                <span className="font-mono font-semibold text-data-lg text-primary tabular-nums">
                  {display}
                </span>
                {/* 空值不带单位——「—次」读起来像个错字 */}
                {unitLabel && display !== '—' && <span className="ledger-unit">{unitLabel}</span>}
              </span>
            );
          }

          const scrub = scrubFor(m);
          /**
           * 显示串先算出来，因为它的**长度**要喂给 --ledger-chars。
           * 26px 的等宽数字在 384px 手机上，两指标布局的输入框只有 88px 宽，
           * 而 lbs 下 kg 换算出来的「154.32」是 6 个字符 = 93.6px，装不下（§6.1）。
           * 带正负的负荷显示绝对值，号在单位前（+kg / −kg）。
           */
          const raw = set[m as keyof typeof set];
          const display =
            raw === 0 || raw === undefined
              ? ''
              : m === 'weight'
                ? formatWeight(Number(raw), unit)
                : Number(raw).toFixed(2).replace(/\.?0+$/, '');
          const unitTap = m === 'weight' && signed && Number(set.weight) > 0;
          return (
            <label
              key={m}
              data-testid={`ledger-field-${m}`}
              className={`ledger-field ledger-fit${scrub ? ' is-scrubbable' : ''}${
                scrub?.scrubbing ? ' is-scrubbing' : ''
              }${isGhost && set.touched?.[m] ? ' is-edited' : ''}`}
              style={{
                ['--ledger-chars' as string]: Math.max(display.length, 1),
                ['--ledger-unit-w' as string]: `${Math.max(20, unitLabel.length * 6.5 + 4)}px`,
              }}
              {...(scrub ? scrub.handlers : {})}
            >
              {/* 档位角标只在拖动时出现：不拖的时候这一格必须是干净的数字。 */}
              {scrub?.scrubbing && (
                <span className="scrub-step" aria-hidden>
                  ×{scrub.step}
                </span>
              )}
              <input
                type="number"
                step="any"
                inputMode="decimal"
                className="ledger-input"
                placeholder="0"
                aria-label={unitLabel ? `${m} (${unitLabel})` : m}
                value={display}
                onChange={e => {
                  const inputValue = e.target.value === '' ? 0 : Number(e.target.value);
                  if (m === 'weight') {
                    // 带正负：打负数＝辅助；打正数沿用这一组现在的号（辅助的组改数还是辅助）
                    const v = signed && inputValue >= 0 ? inputValue * rowSign : inputValue;
                    update(fromDisplay(signed ? v : Math.max(0, v)));
                    return;
                  }
                  update({ [m]: inputValue });
                }}
              />
              {unitLabel &&
                (unitTap ? (
                  <button
                    type="button"
                    onClick={e => {
                      e.preventDefault();
                      flipSign();
                    }}
                    className="ledger-unit marginalia pointer-events-auto"
                    aria-label={isCn ? (rowSign < 0 ? '改成负重' : '改成辅助') : rowSign < 0 ? 'Switch to weighted' : 'Switch to assisted'}
                    data-testid="load-sign"
                  >
                    {unitLabel}
                  </button>
                ) : (
                  <span className="ledger-unit">{unitLabel}</span>
                ))}
            </label>
          );
        })}

        {/* 力竭：可见开关，不做隐藏手势。只标力竭，不顺带算做完（2026-10 指针：做完只看指针）。
            再点一次取消。§5.7 两档触感：标记＝确认感，取消＝点击感。
            字形用 font-display（Noto Serif SC）而不是 font-seal：印章字体的子集没有「竭」，
            而且印章字体留给印章本身，别稀释掉 PR 那一处仪式。 */}
        {!readOnly ? (
          <button
            type="button"
            onClick={() => {
              const next = !set.toFailure;
              haptic(next ? H.longpress : H.tap);
              onUpdate({ toFailure: next });
            }}
            aria-pressed={!!set.toFailure}
            aria-label={
              set.toFailure
                ? isCn ? '取消力竭标记' : 'Clear failure mark'
                : isCn ? '标记这一组做到力竭' : 'Mark set to failure'
            }
            className={`w-9 h-11 justify-self-center flex items-center justify-center
              font-display font-semibold leading-none transition-ui active:scale-press-sm
              ${set.toFailure ? 'text-accent text-[19px]' : 'text-tertiary/35 text-[17px]'}`}
          >
            {isCn ? '竭' : 'F'}
          </button>
        ) : set.toFailure ? (
          <span
            className="w-9 justify-self-center flex items-center justify-center
              font-display font-semibold text-[19px] leading-none text-accent"
            title={isCn ? '做到力竭' : 'To failure'}
          >
            {isCn ? '竭' : 'F'}
          </span>
        ) : (
          <span />
        )}

        {/* 删组：热区 44×44，一律单击。撤销条看设置（2.6，默认关）—— 由工作台决定给不给。 */}
        {!readOnly ? (
          <button
            type="button"
            className="relative w-11 h-11 justify-self-end flex items-center justify-center text-tertiary"
            aria-label={isCn ? '删除这一组' : 'Delete set'}
            data-testid="set-remove"
            onClick={() => {
              haptic(H.tap);
              onRemove();
            }}
          >
            <Minus size={18} strokeWidth={1.75} />
          </button>
        ) : (
          <span />
        )}
      </div>

      {subSets.map((sub, ssi) => {
        const sign = signOf(sub, set);
        const subOwn: LoadMode | null =
          sub.bodyweightMode === 'assisted' || sub.bodyweightMode === 'weighted' ? sub.bodyweightMode : null;
        const subMode: LoadMode = signed
          ? Number(sub.weight) > 0 ? (sign < 0 ? 'assisted' : 'weighted') : 'none'
          : subOwn ?? rowMode;
        return (
          <SubSetRow
            key={sub.id || ssi}
            sub={sub}
            setIdx={setIdx}
            activeMetrics={activeMetrics}
            unitLabels={{ ...unitLabels, weight: metricUnitLabel('weight', unit, isCn, subMode) }}
            colStyle={colStyle}
            unit={unit}
            isCn={isCn}
            readOnly={readOnly}
            ghost={isGhost}
            label={subLabel(ssi)}
            weightDisplay={toDisplay(sub.weight, sign)}
            signed={!!signed}
            edited={isGhost ? sub.touched : undefined}
            onWeight={v => {
              const vv = signed && v >= 0 ? v * sign : v;
              handleSubSetUpdate(ssi, fromDisplay(signed ? vv : Math.max(0, vv)));
            }}
            onUpdate={updates => handleSubSetUpdate(ssi, updates)}
            onRemove={() => handleRemoveSubSet(ssi)}
          />
        );
      })}

      {/* 母组有子组时，补「再加一档」的入口（组型：递减 / 递增）——
          子组本身是低频的，但已经开了头之后再加一档是顺手的事，不该逼用户再长按一次。 */}
      {!readOnly && hasSubSets && (
        <div className="ledger-subrow-add text-micro font-semibold gap-4" data-set-idx={setIdx}>
          <button
            type="button"
            onClick={() => {
              haptic(H.tap);
              handleAddSubSet(-1);
            }}
            className="min-h-[44px]"
            data-testid="subset-add-drop"
          >
            + {isCn ? '递减一档' : 'Drop'}
          </button>
          <button
            type="button"
            onClick={() => {
              haptic(H.tap);
              handleAddSubSet(1);
            }}
            className="min-h-[44px]"
            data-testid="subset-add-up"
          >
            + {isCn ? '递增一档' : 'Step up'}
          </button>
        </div>
      )}

      {/* −5 / +5：跟着选中的那一组（2026-10 指针；原先跟着休息书签）。整行两颗宽键，出汗的手也按得准。 */}
      {!readOnly && selected && !isSkipped && activeMetrics.includes('weight') && (
        <div className="ledger-step" data-set-idx={setIdx} data-testid="weight-step">
          <button type="button" onClick={() => bump(-5)} aria-label={isCn ? `重量减 5 ${unit}` : `Weight −5 ${unit}`}>
            −5 <span className="ledger-unit">{unit}</span>
          </button>
          <button type="button" onClick={() => bump(5)} aria-label={isCn ? `重量加 5 ${unit}` : `Weight +5 ${unit}`}>
            +5 <span className="ledger-unit">{unit}</span>
          </button>
        </div>
      )}
    </>
  );
};


interface SubSetRowProps {
  sub: SubSetLog;
  setIdx: number;
  activeMetrics: string[];
  unitLabels: Record<string, string>;
  colStyle: React.CSSProperties;
  unit: string;
  isCn: boolean;
  readOnly: boolean;
  /** 母组还是待做 → 子组跟着显示淡墨 */
  ghost: boolean;
  /** 比上一档轻＝递减，重＝递增 */
  label: 'drop' | 'up';
  /** 显示单位下的带符号重量（普通重量就是非负的显示值） */
  weightDisplay: number;
  signed: boolean;
  /** 待做时改过的格子（变实墨） */
  edited?: SubSetLog['touched'];
  /** 改重量（显示单位，带符号） */
  onWeight: (v: number) => void;
  onUpdate: (updates: Partial<SubSetLog>) => void;
  onRemove: () => void;
}

/**
 * 子组（递减 / 递增）的一行。手势与母组逐项对齐：
 *   - 重量 / 次数格横向拖动改值（同一套档位；带正负的负荷可以拖过 0）
 *   - 删除单击（撤销看设置）
 * 提成组件是因为 useValueScrub / useLongPress 不能在 map 里调。
 */
const SubSetRow: React.FC<SubSetRowProps> = ({
  sub,
  setIdx,
  activeMetrics,
  unitLabels,
  colStyle,
  unit,
  isCn,
  readOnly,
  ghost,
  label,
  weightDisplay,
  signed,
  edited,
  onWeight,
  onUpdate,
  onRemove,
}) => {
  const weightScrub = useValueScrub({
    value: weightDisplay,
    onChange: next => onWeight(next),
    steps: SCRUB_STEPS_WEIGHT,
    disabled: readOnly,
    ...(signed ? { min: -9999 } : {}),
  });
  const repsScrub = useValueScrub({
    value: Number(sub.reps) || 0,
    onChange: next => onUpdate({ reps: next }),
    steps: SCRUB_STEPS_REPS,
    disabled: readOnly,
  });

  return (
    <div
      className={`ledger-subrow${ghost ? ' is-ghost' : ''}`}
      style={colStyle}
      data-set-idx={setIdx}
    >
      <span className="text-micro font-medium text-tertiary select-none">
        {label === 'up' ? (isCn ? '递增' : 'Up') : isCn ? '递减' : 'Drop'}
      </span>

      {/* 与父行遍历同一个 activeMetrics，落在同一套 --cols 上——
          原先子组行写死 grid-cols-4，指标数不等于 2 时整行错位。
          子组只承载重量与次数，其余列留空。 */}
      {activeMetrics.map(m => {
        if (m !== 'weight' && m !== 'reps') return <span key={m} />;
        /* 单位必须跟父行取同一份（原来这里 reps 硬写成 ''）。
           .ledger-field 是 justify-content:center 的 flex：居中的是
           「数字＋单位」这一对，不是数字。父行有「次」、子组行没有，
           同一列里两个数字就差了半个单位宽 —— 账本读不成一列。 */
        const unitLabel = unitLabels[m] || '';
        const value = m === 'weight' ? sub.weight : sub.reps;
        const display =
          m === 'weight' ? formatWeight(sub.weight || 0, unit) : String(sub.reps || '');

        if (readOnly) {
          return (
            <span key={m} className="ledger-field">
              <span className="font-mono font-semibold text-[22px] leading-none text-primary tabular-nums">
                {value ? display : '—'}
              </span>
              {unitLabel && <span className="ledger-unit">{unitLabel}</span>}
            </span>
          );
        }

        const scrub = m === 'weight' ? weightScrub : repsScrub;
        return (
          <label
            key={m}
            data-testid={`subset-field-${m}`}
            className={`ledger-field is-scrubbable${scrub.scrubbing ? ' is-scrubbing' : ''}${
              edited?.[m as 'weight' | 'reps'] ? ' is-edited' : ''
            }`}
            {...scrub.handlers}
          >
            {/* 档位角标只在拖动时出现，与母组同 */}
            {scrub.scrubbing && (
              <span className="scrub-step" aria-hidden>
                ×{scrub.step}
              </span>
            )}
            <input
              type="number"
              step={m === 'weight' ? 'any' : undefined}
              inputMode={m === 'weight' ? 'decimal' : 'numeric'}
              className="ledger-input ledger-input-sm"
              placeholder="0"
              aria-label={
                m === 'weight'
                  ? isCn ? '子组重量' : 'Sub-set weight'
                  : isCn ? '子组次数' : 'Sub-set reps'
              }
              value={value ? display : ''}
              onChange={e => {
                const val = e.target.value === '' ? 0 : Number(e.target.value);
                if (m === 'weight') onWeight(val);
                else onUpdate({ reps: val });
              }}
            />
            {unitLabel && <span className="ledger-unit">{unitLabel}</span>}
          </label>
        );
      })}

      {/* 力竭列的占位：子组按定义多半就是做到力竭的，逐档再标一遍只是噪音。
          力竭挂在母组上。这里必须留一个格，否则子组行会比父行少一列、整排错位。 */}
      <span />

      {readOnly ? (
        <span />
      ) : (
        <button
          type="button"
          onClick={onRemove}
          className="w-11 h-11 justify-self-end flex items-center justify-center text-tertiary"
          aria-label={isCn ? '删除这一档' : 'Remove this step'}
          data-testid="subset-remove"
        >
          <Minus size={16} strokeWidth={1.75} />
        </button>
      )}
    </div>
  );
};

export default SetCapsule;
