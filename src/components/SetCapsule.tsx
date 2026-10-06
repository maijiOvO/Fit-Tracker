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
   * 休息书签正下方那一行（「下一组」）：在这一组的整块之后露出 −5 / +5（第 2 条）。
   * 全场只有一行是 true。
   */
  showStep?: boolean;
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
  showStep = false,
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
  const colStyle = { ['--cols' as string]: ledgerCols(activeMetrics.length) };
  // 单位内嵌在每个数值右下角（§6.1：10px 表头副行已删），所以标签在行内算
  const unitLabels = Object.fromEntries(
    activeMetrics.map(m => [m, metricUnitLabel(m, unit, isCn, mode)]),
  ) as Record<string, string>;
  // 直接读 props，不留本地副本：原先的 useState(set.subSets) 只在挂载时读一次，
  // 之后外部改了这一组（底稿预填、撤销、同步回来）子组行不会跟着变。
  const subSets: SubSetLog[] = set.subSets || [];
  const hasSubSets = subSets.length > 0;

  /**
   * 组行只有两种状态（第 4 条）：待做（ghost=true，虚线印）/ 做完（实心印）。
   * 底稿、「添加组」新长出来的行、新动作的第一行，一律从待做开始。
   *
   * **只有点组号（或点「竭」）才算做完**；改值只改值。原先「任何编辑都让整行入册」
   * 导致新动作第一行、添加组的新行一出现就是实心印，实心印就不再区分任何东西。
   * 做完 ⇄ 待做 随时点着切（不再限「没改过值才能退回」—— 那条退回凭据 fromGhost 已停写，读到忽略）。
   */
  const isGhost = !!set.ghost && !readOnly;
  const [inkin, setInkin] = useState(false);
  const inkinTimerRef = React.useRef<number | null>(null);
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

  /** 全零的行点不实：一组什么都没填，做完也记不下任何东西 */
  const hasValue =
    ['weight', 'reps', 'duration', 'distance', 'score', 'time'].some(k => Number(set[k]) > 0) ||
    subSets.some(sub => Number(sub.weight) > 0 || Number(sub.reps) > 0);
  const [nope, setNope] = useState(false);
  const nopeTimerRef = React.useRef<number | null>(null);
  const refuse = () => {
    haptic(H.tap);
    setNope(false);
    // 下一帧再挂，连点时摆动能重播
    window.requestAnimationFrame(() => setNope(true));
    if (nopeTimerRef.current !== null) window.clearTimeout(nopeTimerRef.current);
    nopeTimerRef.current = window.setTimeout(() => setNope(false), 1400);
  };

  /** 做完：落印（seal-cut 与 ink-text 同拍）；改过的标记随之作废 */
  const markDone = (extra: Partial<SetLog> = {}) => {
    setInkin(true);
    if (inkinTimerRef.current !== null) window.clearTimeout(inkinTimerRef.current);
    inkinTimerRef.current = window.setTimeout(() => setInkin(false), 700);
    haptic(H.tap);
    onUpdate({
      ...extra,
      ghost: false,
      touched: undefined,
      fromGhost: undefined,
      ...(hasSubSets ? { subSets: subSets.map(({ touched: _t, ...sub }) => sub) } : {}),
    });
  };

  /** 长按加递减达成后，松手带出的那次 click 不能再被读成「点组号」 */
  const longPressAtRef = React.useRef(0);
  const onSetNumClick = () => {
    // 只吞松手带出的那一次：吞完立即作废，否则紧跟着的一次正常点击也会被吃掉
    if (performance.now() - longPressAtRef.current < 600) {
      longPressAtRef.current = 0;
      return;
    }
    if (isGhost) {
      if (hasValue) markDone();
      else refuse();
    } else {
      haptic(H.tap);
      onUpdate({ ghost: true });
    }
  };

  // 重量格横向拖动改值。hook 不能在下面的 map 里调，所以在这里调一次，
  // 再把 handlers 单独摊到 weight 那一格上。
  // 步长按【显示单位】走：kg 里的 1 就是 1kg，lbs 里的 1 就是 1lb，不做换算——
  // 调重量时脑子里想的是「加一点 / 加很多」，不是某个绝对质量。
  const weightDisplay = Number(formatWeight(Number(set.weight) || 0, unit));
  const weightScrub = useValueScrub({
    value: weightDisplay,
    // 走 update：待做行上横拖只改值、记 touched，不描实
    onChange: next => update({ weight: parseWeight(next, unit) }),
    steps: SCRUB_STEPS_WEIGHT,
    disabled: readOnly,
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
      ...(isGhost ? { touched: { ...(cur.touched || {}), ...Object.fromEntries(Object.keys(updates).map(k => [k, true])) } } : {}),
    };
    update({ subSets: newSubSets });
  };

  const handleAddSubSet = () => {
    // 上次练过、带着递减档的组，底稿里已经原样抄来了子组（toGhostSets），不经过这里。
    // 这里只管「没有记录可抄」时的手动加一档：递减组的定义就是降重量再来一轮，
    // 所以从【上一行】降一档。上一行＝最后一档递减，没有就是母组；
    // 原先永远拿母组算，第二档会和第一档一模一样。
    // 降多少按【当前单位】减 5（磅就 −5 磅，kg 就 −5kg），跟换片的手感一致；
    // 原先 −20% 取整到 0.5kg 与单位无关，lbs 下会落出 105.82 这种数。
    // 上一行若是换算残留（132.28）先 floor 再减，新档落在整数上。下限 0。
    // 次数跟上一行一致：递减组多半做到力竭，具体数只能现填。
    const prev = subSets.length > 0 ? subSets[subSets.length - 1] : set;
    const shown = Number(formatWeight(Number(prev.weight) || 0, unit));
    const residue = Math.abs(shown * 2 - Math.round(shown * 2)) > 1e-6;
    const dropped = Math.max(0, (residue ? Math.floor(shown) : shown) - 5);
    const newSubSet: SubSetLog = {
      id: `sub_${Date.now()}`,
      weight: shown > 0 ? parseWeight(dropped, unit) : 0,
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

  // 长按组号＝加一条递减子组（§6.4，极低频动作）。轻点有了自己的意思（做完 ⇄ 待做），
  // 所以不再闪「按住加子组」的提示。
  const addSub = useLongPress({
    onLongPress: () => {
      longPressAtRef.current = performance.now();
      handleAddSubSet();
    },
    disabled: readOnly,
  });

  /** −5 / +5：按当前单位，下限 0；换算残留不取整（132.28 → 137.28，只有拖动才取整） */
  const bump = (d: number) => {
    haptic(H.tap);
    const next = Math.max(0, Math.round((weightDisplay + d) * 100) / 100);
    update({ weight: parseWeight(next, unit) });
  };

  return (
    <>
      <div
        className={`ledger-row${entering ? ' is-entering' : ''}${isGhost ? ' is-ghost' : ''}${
          inkin ? ' is-inkin' : ''
        }${!isGhost && !readOnly ? ' is-inked' : ''}`}
        style={colStyle}
        data-set-idx={setIdx}
        onAnimationEnd={e => {
          if (e.animationName === 'row-in') setEntering(false);
        }}
      >
        {/* 组号：36×36 胶囊。点 = 做完 ⇄ 待做（第 4 条：唯一的「这组做完了」）；
            长按 = 加一档递减（达成后吞掉松手那次 click）。 */}
        <span
          className={`set-num relative w-9 h-9 flex items-center justify-center select-none font-mono font-semibold text-label text-accent tabular-nums touch-pan-y${
            nope ? ' is-nope' : ''
          }`}
          onClick={readOnly ? undefined : onSetNumClick}
          role={readOnly ? undefined : 'button'}
          aria-pressed={readOnly ? undefined : !isGhost}
          aria-label={
            readOnly
              ? undefined
              : isGhost
                ? isCn ? `第 ${setIdx + 1} 组做完了` : `Set ${setIdx + 1} done`
                : isCn ? `第 ${setIdx + 1} 组退回待做` : `Set ${setIdx + 1} back to to-do`
          }
          {...addSub.handlers}
        >
          {setIdx + 1}
          {/* 全零点不实时闪一下原因（瞬时反馈，不是常驻文字） */}
          <LongPressAffordance
            active={addSub.pressing}
            hint={nope}
            label={isCn ? '加子组' : 'Drop set'}
            hintLabel={isCn ? '没填数' : 'Nothing entered'}
            drawMs={addSub.drawMs}
          />
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
           */
          const raw = set[m as keyof typeof set];
          const display =
            raw === 0 || raw === undefined
              ? ''
              : m === 'weight'
                ? formatWeight(Number(raw), unit)
                : Number(raw).toFixed(2).replace(/\.?0+$/, '');
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
                  let storageValue = inputValue;
                  if (m === 'weight') storageValue = parseWeight(inputValue, unit);
                  update({ [m]: storageValue });
                }}
              />
              {unitLabel && <span className="ledger-unit">{unitLabel}</span>}
            </label>
          );
        })}

        {/* 力竭：可见开关，不做隐藏手势。
            它是用户主动上报的数据，本来就该像别的字段一样看得见；
            而且这一行的两个长按（组号加子组、减号删组）都已占用，
            再叠第三个长按语义会打架。

            再点一次取消 —— 误触必须有退路，这是它和「删组」的关键差别：
            删组不可逆所以必须长按 400ms，力竭可逆所以点一下就够。
            §5.7 两档触感：标记＝确认感，取消＝点击感。

            字形用 font-display（Noto Serif SC）而不是 font-seal：
            Ma Shan Zheng 的子集只切了 SEAL_CHARS（'记破新纪录今天多住了一点'），
            没有「竭」；而且印章字体留给印章本身，别稀释掉 PR 那一处仪式。 */}
        {!readOnly ? (
          <button
            type="button"
            onClick={() => {
              const next = !set.toFailure;
              // 点竭 = 这组做完了（做到力竭当然是做完）；取消竭只清竭，不退回待做
              if (next && isGhost) {
                if (!hasValue) {
                  refuse();
                  return;
                }
                haptic(H.longpress);
                markDone({ toFailure: true });
                return;
              }
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

        {/* 删组：热区 44×44。一律单击，删完弹撤销条（第 4 条）——
            原先待做行单击、做完行长按 400ms，两套规矩混在一起；
            §12.5 通则 3：破坏性操作用「先执行 + 撤销」，而不是靠手势设门槛。 */}
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

      {subSets.map((sub, ssi) => (
        <SubSetRow
          key={sub.id || ssi}
          sub={sub}
          setIdx={setIdx}
          activeMetrics={activeMetrics}
          unitLabels={unitLabels}
          colStyle={colStyle}
          unit={unit}
          isCn={isCn}
          readOnly={readOnly}
          ghost={isGhost}
          edited={isGhost ? sub.touched : undefined}
          onUpdate={updates => handleSubSetUpdate(ssi, updates)}
          onRemove={() => handleRemoveSubSet(ssi)}
        />
      ))}

      {/* 母组有子组时，补一条「再加一档」的入口——
          子组本身是低频的，但已经开了头之后再加一档是顺手的事，
          不该逼用户再长按一次。 */}
      {!readOnly && hasSubSets && (
        <button
          type="button"
          onClick={() => {
            haptic(H.tap);
            handleAddSubSet();
          }}
          className="ledger-subrow-add text-micro font-semibold"
          data-set-idx={setIdx}
        >
          + {isCn ? '再加一档递减' : 'Add drop set'}
        </button>
      )}

      {/* −5 / +5（第 2 条）：只在休息书签正下方那一行露出 —— 休息时调的就是下一组。
          整行两颗宽键，热区够大，出汗的手也按得准。 */}
      {!readOnly && showStep && activeMetrics.includes('weight') && (
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
  /** 待做时改过的格子（变实墨） */
  edited?: SubSetLog['touched'];
  onUpdate: (updates: Partial<SubSetLog>) => void;
  onRemove: () => void;
}

/**
 * 递减子组的一行。手势与母组逐项对齐：
 *   - 重量 / 次数格横向拖动改值（同一套档位）
 *   - 删除单击 + 撤销条
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
  edited,
  onUpdate,
  onRemove,
}) => {
  const weightScrub = useValueScrub({
    value: Number(formatWeight(Number(sub.weight) || 0, unit)),
    onChange: next => onUpdate({ weight: parseWeight(next, unit) }),
    steps: SCRUB_STEPS_WEIGHT,
    disabled: readOnly,
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
        {isCn ? '递减' : 'Drop'}
      </span>

      {/* 与父行遍历同一个 activeMetrics，落在同一套 --cols 上——
          原先子组行写死 grid-cols-4，指标数不等于 2 时整行错位。
          递减组只承载重量与次数，其余列留空。 */}
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
                  ? isCn ? '递减组重量' : 'Drop set weight'
                  : isCn ? '递减组次数' : 'Drop set reps'
              }
              value={value ? display : ''}
              onChange={e => {
                const val = e.target.value === '' ? 0 : Number(e.target.value);
                onUpdate(m === 'weight' ? { weight: parseWeight(val, unit) } : { reps: val });
              }}
            />
            {unitLabel && <span className="ledger-unit">{unitLabel}</span>}
          </label>
        );
      })}

      {/* 力竭列的占位：递减组按定义多半就是做到力竭的，逐档再标一遍只是噪音。
          力竭挂在母组上。这里必须留一个格，否则子组行会比父行少一列、整排错位。 */}
      <span />

      {/* 删除规矩与母组相同：单击 + 撤销条 */}
      {readOnly ? (
        <span />
      ) : (
        <button
          type="button"
          onClick={onRemove}
          className="w-11 h-11 justify-self-end flex items-center justify-center text-tertiary"
          aria-label={isCn ? '删除这档递减' : 'Remove drop set'}
          data-testid="subset-remove"
        >
          <Minus size={16} strokeWidth={1.75} />
        </button>
      )}
    </div>
  );
};

export default SetCapsule;
