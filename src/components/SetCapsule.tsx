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
}

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
  const [expandedSubSets, setExpandedSubSets] = useState<SubSetLog[]>(set.subSets || []);
  const hasSubSets = expandedSubSets.length > 0;

  /**
   * 底稿行（§12.6）：ghost=true 的行是上次训练抄来的淡墨底稿，还不是数据。
   * 统一的转正规则走这个包装器 —— 任何一次编辑（打字 / scrub / 点竭 / 加子组）
   * 都让整行以当前值入册；点组号 = 不改值照抄（update({})）。
   * 转正瞬间播一次文字版墨色过冲（is-inkin）。
   */
  const isGhost = !!set.ghost && !readOnly;
  const [inkin, setInkin] = useState(false);
  const inkinTimerRef = React.useRef<number | null>(null);
  const update = (updates: Partial<SetLog>) => {
    if (isGhost) {
      setInkin(true);
      if (inkinTimerRef.current !== null) window.clearTimeout(inkinTimerRef.current);
      // 1500ms 盖过 useLongPress 的 hint 窗口：照抄那一击本身就是有效操作，
      // 不该再被「按住加子组」的教学提示叠一层（动画本体 520ms 播完即止）。
      inkinTimerRef.current = window.setTimeout(() => setInkin(false), 1500);
      haptic(H.tap);
      onUpdate({ ...updates, ghost: false });
    } else {
      onUpdate(updates);
    }
  };

  // 重量格横向拖动改值。hook 不能在下面的 map 里调，所以在这里调一次，
  // 再把 handlers 单独摊到 weight 那一格上。
  // 步长按【显示单位】走：kg 里的 1 就是 1kg，lbs 里的 1 就是 1lb，不做换算——
  // 调重量时脑子里想的是「加一点 / 加很多」，不是某个绝对质量。
  const weightDisplay = Number(formatWeight(Number(set.weight) || 0, unit));
  const weightScrub = useValueScrub({
    value: weightDisplay,
    // 走 update：在底稿行上横拖改值，第一档落下的同时整行描实入册
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
    const newSubSets = [...expandedSubSets];
    newSubSets[subIdx] = { ...newSubSets[subIdx], ...updates };
    setExpandedSubSets(newSubSets);
    update({ subSets: newSubSets });
  };

  const handleAddSubSet = () => {
    // 递减组的定义就是降重量再来一轮，所以默认降一档（-20%，取整到 0.5kg）。
    // 旧默认是「重量不变、次数 -5」——重量不变的话它就不是递减组了。
    // 次数保持与母组一致：递减组多半做到力竭，具体数只能现填。
    const base = set.weight || 0;
    const newSubSet: SubSetLog = {
      id: `sub_${Date.now()}`,
      weight: base > 0 ? Math.round(base * 0.8 * 2) / 2 : 0,
      reps: set.reps || 0,
    };
    const newSubSets = [...expandedSubSets, newSubSet];
    setExpandedSubSets(newSubSets);
    update({ subSets: newSubSets });
  };

  const handleRemoveSubSet = (subIdx: number) => {
    const newSubSets = expandedSubSets.filter((_, i) => i !== subIdx);
    setExpandedSubSets(newSubSets);
    update({ subSets: newSubSets });
  };

  // 长按组号＝加一条递减子组（§6.4，极低频动作）
  const addSub = useLongPress({ onLongPress: handleAddSubSet, disabled: readOnly });

  // §6.6：删除组必须长按才真删。出汗手滑场景下，只靠颜色和文案不够。
  // 400ms = 120ms 静默 + 280ms 画线。
  const removeSet = useLongPress({ onLongPress: onRemove, durationMs: 400, disabled: readOnly });

  return (
    <>
      <div
        className={`ledger-row${entering ? ' is-entering' : ''}${isGhost ? ' is-ghost' : ''}${
          inkin ? ' is-inkin' : ''
        }`}
        style={colStyle}
        onAnimationEnd={e => {
          if (e.animationName === 'row-in') setEntering(false);
        }}
      >
        {/* 组号：36×36 可长按胶囊。
            底稿行上多一个语义：点一下 = 照抄描实（§12.6 的「一组一击」）。
            与长按加子组不冲突 —— 长按达成后 update 会先把行转正，
            松手带出的 click 落在已转正的行上是空操作。 */}
        <span
          className="set-num relative w-9 h-9 flex items-center justify-center select-none font-mono font-semibold text-label text-accent tabular-nums touch-pan-y"
          onClick={() => {
            if (isGhost) update({});
          }}
          role={isGhost ? 'button' : undefined}
          aria-label={isGhost ? (isCn ? '照抄上次这一组' : 'Copy last time') : undefined}
          {...addSub.handlers}
        >
          {setIdx + 1}
          <LongPressAffordance
            active={addSub.pressing}
            hint={addSub.hinting && !isGhost && !inkin}
            label={isCn ? '加子组' : 'Drop set'}
            hintLabel={isCn ? '按住加子组' : 'Hold for drop set'}
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
                className="ledger-field min-h-[44px] font-mono font-semibold text-[22px] leading-none text-primary tabular-nums"
              >
                {pad(hms.h)}:{pad(hms.m)}:{pad(hms.s)}
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
          return (
            <label
              key={m}
              data-testid={`ledger-field-${m}`}
              className={`ledger-field${scrub ? ' is-scrubbable' : ''}${
                scrub?.scrubbing ? ' is-scrubbing' : ''
              }`}
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
                value={
                  set[m as keyof typeof set] === 0 || set[m as keyof typeof set] === undefined
                    ? ''
                    : (() => {
                        const rawValue = Number(set[m as keyof typeof set]);
                        if (m === 'weight') return formatWeight(rawValue, unit);
                        return rawValue.toFixed(2).replace(/\.?0+$/, '');
                      })()
                }
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
              haptic(next ? H.longpress : H.tap);
              update({ toFailure: next });
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

        {/* 删组：热区补到 44×44（原先是 35px 列里的 16px 图标，
            与页面其他处精心维护的 min-h-[44px] 自相矛盾）。
            §6.6：不靠颜色区分危险，靠「必须长按」这个形态。
            例外（§12.6）：底稿行一点即抹 —— 它还不是事实，抹掉不算破坏。 */}
        {!readOnly && isGhost ? (
          <button
            type="button"
            className="relative w-11 h-11 justify-self-end flex items-center justify-center text-tertiary"
            aria-label={isCn ? '抹掉这行底稿' : 'Discard this draft set'}
            onClick={() => {
              haptic(H.tap);
              onRemove();
            }}
          >
            <Minus size={18} strokeWidth={1.75} />
          </button>
        ) : !readOnly ? (
          <button
            type="button"
            className="relative w-11 h-11 justify-self-end flex items-center justify-center text-tertiary touch-pan-y"
            aria-label={isCn ? '长按删除这一组' : 'Hold to delete set'}
            {...removeSet.handlers}
          >
            <Minus size={18} strokeWidth={1.75} />
            <LongPressAffordance
              active={removeSet.pressing}
              hint={removeSet.hinting}
              label={isCn ? '删除' : 'Delete'}
              hintLabel={isCn ? '按住删除' : 'Hold to delete'}
              drawMs={removeSet.drawMs}
            />
          </button>
        ) : (
          <span />
        )}
      </div>

      {expandedSubSets.map((sub, ssi) => (
        <div key={sub.id || ssi} className="ledger-subrow" style={colStyle}>
          <span className="text-micro font-medium text-tertiary select-none">
            {isCn ? '递减' : 'Drop'}
          </span>

          {/* 与父行遍历同一个 activeMetrics，落在同一套 --cols 上——
              原先子组行写死 grid-cols-4，指标数不等于 2 时整行错位。
              递减组只承载重量与次数，其余列留空。 */}
          {activeMetrics.map(m => {
            if (m !== 'weight' && m !== 'reps') return <span key={m} />;
            const unitLabel = m === 'weight' ? unitLabels.weight : '';
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

            return (
              <label key={m} className="ledger-field">
                <input
                  type="number"
                  step={m === 'weight' ? 'any' : undefined}
                  inputMode={m === 'weight' ? 'decimal' : 'numeric'}
                  className="ledger-input ledger-input-sm"
                  aria-label={
                    m === 'weight'
                      ? isCn ? '递减组重量' : 'Drop set weight'
                      : isCn ? '递减组次数' : 'Drop set reps'
                  }
                  value={value ? display : ''}
                  onChange={e => {
                    const val = e.target.value === '' ? 0 : Number(e.target.value);
                    handleSubSetUpdate(
                      ssi,
                      m === 'weight' ? { weight: parseWeight(val, unit) } : { reps: val },
                    );
                  }}
                />
                {unitLabel && <span className="ledger-unit">{unitLabel}</span>}
              </label>
            );
          })}

          {/* 力竭列的占位：递减组按定义多半就是做到力竭的，逐档再标一遍只是噪音。
              力竭挂在母组上。这里必须留一个格，否则子组行会比父行少一列、整排错位。 */}
          <span />

          {!readOnly ? (
            <button
              type="button"
              onClick={() => {
                haptic(H.tap);
                handleRemoveSubSet(ssi);
              }}
              className="w-11 h-11 justify-self-end flex items-center justify-center text-tertiary"
              aria-label={isCn ? '删除递减组' : 'Remove drop set'}
            >
              <Minus size={16} strokeWidth={1.75} />
            </button>
          ) : (
            <span />
          )}
        </div>
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
          className="ml-6 mb-1 min-h-[36px] px-2 text-micro font-semibold text-accent text-left"
        >
          + {isCn ? '再加一档递减' : 'Add drop set'}
        </button>
      )}
    </>
  );
};

export default SetCapsule;
