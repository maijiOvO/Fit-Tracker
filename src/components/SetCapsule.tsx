/**
 * 训练组＝账本上的一行（规格 §6.1）
 *
 * 行不再是填充盒：去掉背景与边框，只留 border-bottom，min-height 52px。
 * 从「一堆灰色胶囊」变成账本横线，同屏噪音直接减半。
 *
 * 网格列宽由父卡片通过 --cols 下发，父行与子组行共用同一个变量，
 * 根治原先「表头 px-2、行 p-3」的 4px 错位。
 */
import { translations } from '../../translations';
import React, { useContext, useState } from 'react';
import { Minus } from 'lucide-react';
import { Language, SubSetLog, SetLog } from '../../types';
import { ledgerCols, metricUnitLabel, LoadMode, distToDisplay, distFromDisplay } from '../utils/exerciseConfig';
import { useLongPress } from '../hooks/useLongPress';
import { useValueScrub, SCRUB_STEPS_REPS, SCRUB_STEPS_WEIGHT, SCRUB_MULTS } from '../hooks/useValueScrub';
import { LongPressAffordance } from './LongPressAffordance';
import { haptic, H } from '../utils/haptics';
import type { SetUpdate } from '../utils/workbench';
import { fromSignedKg } from '../utils/load';
import { pad2, parseWeight, secondsToHMS } from '../utils/format';
import { KG_TO_LBS } from '../constants';
import { heroScrubAxis, STACK_PITCH, STACK_ENGAGE_PX } from '../utils/scrubFeel';
import { UserSettingsContext } from '../contexts/UserSettingsContext';
import { appPrefsNow } from '../../services/appPrefs';
import type { LoadKind } from '../hooks/useLoadKind';
import type { ExRounder } from '../hooks/useLoadRounder';

/**
 * 「杠铃片」§3 + 馆档案：拖一格多少，跟着「这个馆、这件器材」的一档走（交互只有一套，变的只是落点）。
 * 杠铃 / 挂片器械一格＝最小一对片；配重片、哑铃一格＝馆档案里的一档（或这个动作单独设的）。
 * 第一格先吸到那个方向最近能挂的重量（ExRounder.stepToD），之后一格一档，甩起来两档 / 四档。
 * 纯数字的动作（rounder 为 null）照旧 1/2/5/10。
 * axis 只给顶部大图用：配重片的大图竖拖（heroScrubAxis，纵向排布就竖着滑，2026-10-21 用户纠正后改回）。
 * 组行的重量格一律横拖 —— 格子竖拖会和页面滚动抢手势（2026-10-18 审查后用户定）。
 */
export function weightScrubFor(
  rounder: ExRounder | null | undefined,
): {
  steps: number[];
  axis: 'x' | 'y';
  stepFn?: (v: number, dir: 1 | -1, mult: number) => number;
  px?: number;
  engagePx?: number;
} {
  if (!rounder) return { steps: SCRUB_STEPS_WEIGHT, axis: 'x' };
  const axis = heroScrubAxis(rounder.info.kind);
  const stepFn = (v: number, dir: 1 | -1, mult: number) => rounder.stepToD(v, dir, mult);
  // 配重片刻度轨：一档一片、跟手、不跳档（scrubFeel.STACK_PITCH）
  if (axis === 'y') return { steps: [1], axis, stepFn, px: STACK_PITCH, engagePx: STACK_ENGAGE_PX };
  return { steps: SCRUB_MULTS, axis, stepFn };
}

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
  /** 删一档递减：交给工作台做 */
  onRemoveSub?: (subIdx: number) => void;
  /** 「杠铃片」§3：这个动作的重量怎么画、怎么拖。不传＝纯数字（只读历史视图） */
  loadKind?: LoadKind;
  /** 这一组破了历史纪录（单组最重）→ 铺镁粉、标 PB */
  isPR?: boolean;
  /**
   * 馆档案取整器（useLoadRounder）：± / 拖动 / 加递减档按这个馆这件器材的一档走。
   * 不传或 null（纯数字的动作、只读历史）＝首选项的步长。
   */
  rounder?: ExRounder | null;
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

/**
 * 点进格子即全选（2026-10-11 用户定：底稿一半时候要改、一半时候照用）：打字直接替换，不打字旧值留着。
 * 选中放到下一帧：触屏上 focus 之后还有一次 mouseup，同步选会被它收掉。
 */
const selectOnFocus = (e: React.FocusEvent<HTMLInputElement>) => {
  const el = e.currentTarget;
  requestAnimationFrame(() => {
    if (document.activeElement === el) el.select();
  });
};

/** 回车 / 键盘上的「下一步」：跳到同一行的下一格，没有下一格就收键盘 */
const focusNextOnEnter = (e: React.KeyboardEvent<HTMLInputElement>) => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  const cur = e.currentTarget;
  const row = cur.closest('.ledger-row, .ledger-subrow');
  const inputs: HTMLInputElement[] = row ? Array.prototype.slice.call(row.querySelectorAll('input.ledger-input')) : [];
  const next = inputs[inputs.indexOf(cur) + 1];
  if (next) next.focus();
  else cur.blur();
};

export function formatWeight(kg: number, targetUnit: string): string {
  if (targetUnit === 'lbs') {
    return (kg * KG_TO_LBS).toFixed(2).replace(/\.?0+$/, '');
  }
  return kg.toFixed(2).replace(/\.?0+$/, '');
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
  isPR = false,
  rounder,
}) => {
  const isCn = lang === Language.CN;
  // 首选项：±步长、递减每档（当前单位下的数，kg / lbs 共用）。只读历史视图里也拿得到，拿不到用存储里的值
  const { weightStep, dropStep } = useContext(UserSettingsContext)?.appPrefs ?? appPrefsNow();
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
   * 组行两种状态（2026-10 指针；10-15 删了跳过）：待做（ghost）/ 做完。
   * 做完没做完看指针位置和数字墨色；组号平时一律空心细框，选中才实心（用户定：只两种样子）。
   * 点组号交给工作台：一下＝选中 + 指针挪到这一组正下方（刚做完那组再点＝退回）。改值只改值。
   */
  const isGhost = !!set.ghost && !readOnly;
  /**
   * 打字改重量：聚焦时记下带符号的 kg，离开时按总差值让后面的组平移一次（workbench.SetUpdate）。
   * 逐键平移会让后面的组跟着 1、15、150 一路跳，减到 0 以下还会被截掉。
   */
  const rowSignedKg = (Number(set.weight) || 0) * rowSign;
  const typeBaseRef = React.useRef<number | null>(null);
  const commitTypedWeight = () => {
    const base = typeBaseRef.current;
    typeBaseRef.current = null;
    if (base !== null && base !== rowSignedKg) onUpdate({ followFrom: { kg: base } } as SetUpdate);
  };
  const subTypeBaseRef = React.useRef<{ sub: number; kg: number } | null>(null);
  const commitTypedSubWeight = (subIdx: number, nowKg: number) => {
    const base = subTypeBaseRef.current;
    subTypeBaseRef.current = null;
    if (base && base.sub === subIdx && base.kg !== nowKg) onUpdate({ followFrom: base } as SetUpdate);
  };

  const update = (updates: SetUpdate) => {
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
  const longPressAtRef = React.useRef(-Infinity);
  const onSetNumClick = () => {
    // 只吞松手带出的那一次：吞完立即作废，否则紧跟着的一次正常点击也会被吃掉
    if (performance.now() - longPressAtRef.current < 600) {
      longPressAtRef.current = -Infinity;
      return;
    }
    onNumTap?.();
  };

  /** 显示单位下的带符号重量 ⇄ 存储（kg，非负 + 号） */
  const toDisplay = (kg: number, sign: -1 | 1) => sign * Number(formatWeight(Number(kg) || 0, unit));
  // 「杠铃片」：改重量就记下这一组挂的是哪种片 —— 有馆档案的器材按这个馆的片子（审查 A8；显示单位只是换算着看），
  // 纯数字的动作按显示单位
  const plateUnitNow: SetLog['plateUnit'] = rounder ? rounder.unit : unit === 'lbs' ? 'lbs' : 'kg';
  const fromDisplay = (v: number): Pick<SetLog, 'weight' | 'bodyweightMode' | 'plateUnit'> => {
    // 有取整器：落在格子上的存格子的精确 kg（显示的两位小数换回去会差一点，见 ExRounder.kgOfD）
    const kg = rounder ? Math.abs(rounder.kgOfD(v)) : parseWeight(Math.abs(v), unit === 'lbs' ? 'lbs' : 'kg');
    if (!signed) return { weight: kg, plateUnit: plateUnitNow };
    return { weight: kg, plateUnit: plateUnitNow, bodyweightMode: v < 0 ? 'assisted' : v > 0 ? 'weighted' : 'normal' };
  };

  // 重量格横向拖动改值。hook 不能在下面的 map 里调，所以在这里调一次，
  // 再把 handlers 单独摊到 weight 那一格上。
  // 步长按【显示单位】走：kg 里的 1 就是 1kg，lbs 里的 1 就是 1lb，不做换算——
  // 调重量时脑子里想的是「加一点 / 加很多」，不是某个绝对质量。
  const weightDisplay = toDisplay(set.weight, rowSign);
  const weightFeel = weightScrubFor(rounder);
  const weightScrub = useValueScrub({
    value: weightDisplay,
    // 走 update：待做行上横拖只改值、记 touched，不描实
    onChange: next => update(fromDisplay(next)),
    steps: weightFeel.steps,
    // 组行格子一律横拖（见 weightScrubFor 注释），竖拖只给配重片的大图
    axis: 'x',
    stepFn: weightFeel.stepFn,
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

  const handleSubSetUpdate = (subIdx: number, updates: Partial<SubSetLog>, holdFollow = false) => {
    const newSubSets = [...subSets];
    const cur = newSubSets[subIdx];
    newSubSets[subIdx] = {
      ...cur,
      ...updates,
      // 格子墨色要按格算：哪一格改过，哪一格变实墨
      ...(isGhost ? { touched: { ...(cur.touched || {}), ...Object.fromEntries(Object.keys(updates).filter(k => k === 'weight' || k === 'reps').map(k => [k, true])) } } : {}),
    };
    update({ subSets: newSubSets, ...(holdFollow ? { holdFollow } : {}) });
  };

  /**
   * 加一档子组（组型：递减 / 递增，变体第三层）。
   * 上次练过、带着子组的组，底稿里已经原样抄来了（toGhostSets），不经过这里。
   * 这里只管手动加一档：从【上一行】（最后一档，没有就是母组）走一档 ——
   * 有馆档案的器材（rounder）：∓ 这件器材的一档，再吸到最近能挂的（片子不规则时按能挂的下一个走）；
   * 纯数字的动作：∓「递减每档」（首选项，默认 5），上一行是换算残留（132.28）先取整再走。
   * 带正负的负荷在带符号的数上走：+10 → +5 → 0 → −5（递减可以一路降进辅助）。普通重量下限 0。
   * 次数跟上一行一致：递减组多半做到力竭，具体数只能现填。
   */
  const handleAddSubSet = (dir: -1 | 1 = -1) => {
    const prev = subSets.length > 0 ? subSets[subSets.length - 1] : set;
    const prevSign = subSets.length > 0 ? signOf(prev, set) : rowSign;
    const shown = toDisplay(prev.weight, prevSign);
    let next: number;
    if (rounder) {
      next = rounder.snapD(shown + dir * rounder.stepD(shown));
      // 吸回了原处（空杠再往下、片子太粗）：按「能挂的下一个」走
      if (Math.abs(next - shown) < 0.01) next = rounder.stepToD(shown, dir);
      // 已经是最轻的一档（哑铃最小那对、空杠）：不降到 0，和上一档一样，自己再改
      if (!signed && next <= 0 && shown > 0) next = shown;
    } else {
      const residue = Math.abs(shown * 2 - Math.round(shown * 2)) > 1e-6;
      const base = residue ? (dir < 0 ? Math.floor(shown) : Math.ceil(shown)) : shown;
      next = base + dir * dropStep;
    }
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

  /**
   * − / +：有馆档案的器材走这个馆这件器材的一档（第一下先吸到那个方向最近能挂的）；
   * 纯数字的动作走首选项的步长（默认 5），换算残留不取整。普通重量下限 0，带正负的负荷可以跨过 0。
   */
  // 标签按方向各算：带正负的在 0 上往下走的是辅助一档、往上走的是最小一片，两边不一样
  const stepShownFor = (dir: 1 | -1) => {
    if (!rounder) return weightStep;
    const moved = Math.abs(rounder.stepToD(weightDisplay, dir) - weightDisplay);
    return Math.round((rounder.loadableD(weightDisplay) && moved > 0 ? moved : rounder.stepD(weightDisplay) || weightStep) * 100) / 100;
  };
  const stepDown = stepShownFor(-1);
  const stepUp = stepShownFor(1);
  const bump = (dir: 1 | -1) => {
    haptic(H.tap);
    let next = rounder ? rounder.stepToD(weightDisplay, dir) : Math.round((weightDisplay + dir * weightStep) * 100) / 100;
    if (!signed) next = Math.max(0, next);
    update(fromDisplay(next));
  };

  /** 次数 ±1（走同一条改值路径：后面原值一样、没改过的待做组跟着变） */
  const bumpReps = (dir: 1 | -1) => {
    haptic(H.tap);
    const next = Math.max(0, (Number(set.reps) || 0) + dir);
    if (next !== (Number(set.reps) || 0)) update({ reps: next });
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

  /**
   * 「上次 x」：底稿是从上一次抄来再按今天的馆 / 单位取整的 —— 上一次挂的片子单位不同、或取整改了数，
   * 就在重量格角上标出上一次的原值（按当时的单位）。
   *
   * 一键恢复（2026-10-21 用户定）：这一组现在的重量和默认值（上一次的重量按今天的馆取整，计划的就是计划目标）
   * 不一样时，它变成按钮，点一下改回默认值——横划误触改了重量不用再自己拖回去。走正常的改值路径，
   * 被带着一起变的后面几组也跟着回来。第一次练（没有 prefillRef）就没有这个标。
   */
  const refTag = ((): { text: string; restoreKg?: number } => {
    const none = { text: '' };
    if (readOnly) return none;
    // 做完的组不跟着切单位重算（2026-10-18 用户定）：挂的是另一种片就标出来，免得以为那个数是换算残留
    const curU = unit === 'lbs' ? 'lbs' : 'kg';
    if (!set.ghost && (set.plateUnit === 'kg' || set.plateUnit === 'lbs') && set.plateUnit !== curU) {
      return { text: isCn ? (set.plateUnit === 'lbs' ? '做完时挂的是磅片' : '做完时挂的是公斤片') : set.plateUnit === 'lbs' ? 'done on lb plates' : 'done on kg plates' };
    }
    // 换了做法、新做法没练过：底稿是按新器材硬取整的，提醒确认（改过重量就不再提醒）
    if (set.ghost && set.checkWeight && !set.touched?.weight) return { text: isCn ? '换了做法，确认一下重量' : 'New variant — check weight' };
    const ref = set.prefillRef as SetLog['prefillRef'];
    if (!ref || !(Math.abs(ref.kg) > 0)) return none;
    const inRef = Math.round((ref.unit === 'lbs' ? Math.abs(ref.kg) * KG_TO_LBS : Math.abs(ref.kg)) * 100) / 100;
    const lab = ref.unit === 'lbs' ? 'lb' : 'kg';
    const assisted = !!signed && ref.kg < 0;
    const what = ref.plan ? (isCn ? '计划' : 'Plan') : isCn ? '上次' : 'Last';
    const text = isCn
      ? `${what} ${assisted ? '辅助 ' : ''}${inRef} ${lab}`
      : `${what} ${assisted ? 'assisted ' : ''}${inRef} ${lab}`;
    // 默认值：上一次的重量按今天的馆 / 单位取整（底稿当初就是这么来的）；按显示单位比，换算的零头不算改过
    // 还是上一次的原重量（切过单位：60 kg 显示成 132.28 lb，没取整）也不算改过——那是同一个重量
    const defKg = rounder ? rounder.snapKg(ref.kg) : ref.kg;
    const curD = toDisplay(Number(set.weight) || 0, rowSign);
    const offBy = (kg: number) => Math.abs(toDisplay(Math.abs(kg), kg < 0 ? -1 : 1) - curD) >= 0.01;
    const moved = offBy(defKg) && offBy(ref.kg);
    // 一键改回只给待做的组（审查 B1）：做完的组改回去等于改历史，那里的「上次」只做参考
    if (moved) return set.ghost ? { text, restoreKg: defKg } : { text };
    const same = ref.unit === (unit === 'lbs' ? 'lbs' : 'kg') && Math.abs(inRef - Math.abs(weightDisplay)) < 0.01;
    return same ? none : { text };
  })();
  /** 点「上次 x」改回默认值：待做的组顺手把「改过重量」也撤掉（回到底稿，之后照常被前面带着走） */
  const restoreRef = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const kg = refTag.restoreKg;
    if (kg === undefined) return;
    haptic(H.tap);
    const w = signed ? fromSignedKg(kg) : { weight: Math.abs(kg) };
    if (isGhost && set.touched?.weight) {
      const { weight: _w, bodyweightMode: _b, ...touched } = set.touched as Record<string, boolean>;
      onUpdate({ ...w, touched } as SetUpdate);
    } else onUpdate(w as SetUpdate);
  };

  return (
    <>
      <div
        className={`ledger-row${entering ? ' is-entering' : ''}${isGhost ? ' is-ghost' : ''}${inkin ? ' is-inkin' : ''}${!isGhost && !readOnly ? ' is-inked' : ''}${selected ? ' is-selected' : ''}${isPR && !isGhost ? ' is-pr' : ''}`}
        style={colStyle}
        data-set-idx={setIdx}
        data-set-id={set.id}
        // 休息书签的说明按组号写：交替组里是「卧推 2」这种（组行显示的那个号，不是第几行）
        data-set-no={no}
        data-set-badge={badge?.label ?? ''}
        onAnimationEnd={e => {
          if (e.animationName === 'row-in') setEntering(false);
        }}
      >
        {/* 组号：36×36 胶囊。点 = 选中，选中的再点 = 做完（指针移到它下面）；
            长按 = 加一档递减（达成后吞掉松手那次 click）。
            交替组在组号上方叠一行动作简称（「卧推」「飞鸟」，2026-10-21 起一个词；原来一个字、放在组号左边） */}
        <span className={badge ? 'flex flex-col items-center min-w-0' : 'flex items-center gap-1 min-w-0'}>
          {badge && (
            <button
              type="button"
              onClick={badge.onClick}
              title={badge.title}
              aria-label={badge.title}
              className="set-badge marginalia"
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
            return (
              <button
                key={m}
                type="button"
                onClick={onDurationClick}
                disabled={readOnly}
                className={`ledger-field min-h-[44px] font-mono font-semibold text-xl leading-none text-primary tabular-nums${
                  readOnly ? '' : ' ledger-fit'
                }`}
                // 居中而不是 .ledger-field 的 baseline：按钮 44px 高、只有一段文字，
                // baseline 会把它顶到格子上沿，比同排的数字高出一截。
                style={{ ['--ledger-chars' as string]: 8, alignItems: 'center' }}
              >
                <span className="ledger-fit-text">
                  {pad2(hms.h)}:{pad2(hms.m)}:{pad2(hms.s)}
                </span>
              </button>
            );
          }

          if (readOnly) {
            const raw = set[m as keyof SetLog];
            // 只读（历史）保留 1 位：换算出来的 41.89 / 308.65 读起来乱；编辑态仍保留 2 位，换算来回不丢数。
            // 数字靠右：同一列的个位、单位各自排成一条竖线，不再随位数左右跳（2026-10-22 界面审查）
            const display =
              m === 'weight'
                ? (Math.round(Number(formatWeight(Number(raw) || 0, unit)) * 10) / 10).toString()
                : raw === 0 || raw === undefined
                  ? '—'
                  : String(Math.round(distToDisplay(m, Number(raw)) * 100) / 100);
            return (
              <span key={m} className="ledger-field" style={{ justifyContent: 'flex-end' }}>
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
                : distToDisplay(m, Number(raw)).toFixed(2).replace(/\.?0+$/, '');
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
                // 整数部分的位数：重量数字按它定位，十位 / 个位钉住不动，小数往右长（2026-10-18 用户定：
                // 居中对齐时 60 → 62.5 一路左右飘）
                ['--int-chars' as string]: Math.max(display.split('.')[0].replace('-', '').length, 1),
                // 收字号用：从中线往右要放下几个数字宽。小数点只有数字宽的约 2/3（Barlow 实测 0.325 vs 0.475 em），
                // 按整字算会把 102.5 收到 24px，掉到 §0「≥26px」底线以下
                ['--fit-chars' as string]: (() => {
                  const int = Math.max(display.split('.')[0].replace('-', '').length, 1);
                  return Math.max(1, display.length - int / 2 - (display.includes('.') ? 0.32 : 0));
                })(),
                ['--ledger-unit-w' as string]: `${Math.max(20, unitLabel.length * 6.5 + 4)}px`,
              }}
              {...(scrub ? scrub.handlers : {})}
            >
              {/* 档位角标只在拖动时出现：不拖的时候这一格必须是干净的数字。 */}
              {scrub?.scrubbing && (
                <span className="scrub-step" aria-hidden>
                  {/* 有馆档案时档位表是倍数（1/2/4），角标换成这一下实际走多少 */}
                  ×{m === 'weight' && rounder ? Math.round(rounder.stepD(weightDisplay) * scrub.step * 100) / 100 : scrub.step}
                </span>
              )}
              {m === 'weight' && refTag.text && !(isPR && !isGhost) && (
                refTag.restoreKg !== undefined ? (
                  <button
                    type="button"
                    className="ref-tag is-restore"
                    data-testid="prefill-ref"
                    // 别让按下这一下被当成横划的起点，也别让 label 把焦点转给输入框
                    onPointerDown={e => e.stopPropagation()}
                    onClick={restoreRef}
                    aria-label={
                      isCn
                        ? `改回 ${formatWeight(Math.abs(refTag.restoreKg), unit)} ${unit === 'lbs' ? 'lb' : 'kg'}`
                        : `Restore ${formatWeight(Math.abs(refTag.restoreKg), unit)} ${unit === 'lbs' ? 'lb' : 'kg'}`
                    }
                  >
                    <span aria-hidden>↺ </span>
                    {refTag.text}
                  </button>
                ) : (
                  <span className="ref-tag" data-testid="prefill-ref">{refTag.text}</span>
                )
              )}
              {m === 'weight' && isPR && !isGhost && (
                <span className="pb-tag" aria-label={isCn ? '新纪录' : 'Personal best'}>
                  PB
                </span>
              )}
              <input
                type="number"
                step="any"
                inputMode={m === 'reps' ? 'numeric' : 'decimal'}
                enterKeyHint={activeMetrics.indexOf(m) < activeMetrics.length - 1 ? 'next' : 'done'}
                className={`ledger-input${m === 'weight' ? ' is-int-anchored' : ''}`}
                placeholder="0"
                aria-label={unitLabel ? `${m} (${unitLabel})` : m}
                data-undo-label={`${isCn ? `第 ${setIdx + 1} 组` : `Set ${setIdx + 1} `}${translations[m as keyof typeof translations]?.[lang] ?? m}`}
                value={display}
                onFocus={e => {
                  selectOnFocus(e);
                  if (m === 'weight') typeBaseRef.current = rowSignedKg;
                }}
                onBlur={m === 'weight' ? commitTypedWeight : undefined}
                onKeyDown={focusNextOnEnter}
                onChange={e => {
                  const inputValue = e.target.value === '' ? 0 : Number(e.target.value);
                  if (m === 'weight') {
                    // 带正负：打负数＝辅助；打正数沿用这一组现在的号（辅助的组改数还是辅助）
                    const v = signed && inputValue >= 0 ? inputValue * rowSign : inputValue;
                    // 打字中途只改这一格，离开输入框时再按总差值带后面（commitTypedWeight）
                    update({ ...fromDisplay(signed ? v : Math.max(0, v)), holdFollow: true });
                    return;
                  }
                  // 距离 / 速度按首选项的距离单位打，存回 km、km/h
                  update({ [m]: distFromDisplay(m, inputValue) });
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
            字形用正文字体（原来的印章体子集里没有「竭」，印章体已于 2026-10-22 退役），
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
              text-lg`}
          >
            {/* 标了力竭＝墨底反白的小方块：换装后强调色是墨，单靠颜色已经和数字分不开（2026-10-18 审查）。
                没标＝同尺寸的空心框 + 实色三级字：开关两态靠「实心 / 空心」区分。
                以前没标时是 tertiary/35，对比度约 1.6:1，健身房里看不见这一列能点（2026-10-22 界面审查 P0）。 */}
            <span className={`w-7 h-7 flex items-center justify-center rounded-chip ${set.toFailure ? 'bg-accent text-on-accent' : 'border border-divider text-tertiary'}`}>
              {isCn ? '竭' : 'F'}
            </span>
          </button>
        ) : set.toFailure ? (
          <span
            className="w-9 justify-self-center flex items-center justify-center
              font-display font-semibold text-lg leading-none"
            title={isCn ? '做到力竭' : 'To failure'}
          >
            <span className="w-7 h-7 flex items-center justify-center rounded-chip bg-accent text-on-accent">{isCn ? '竭' : 'F'}</span>
          </span>
        ) : (
          <span />
        )}

        {/* 删组：热区 44×44，一律单击；点错了用顶栏的全局撤销。 */}
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
            rounder={rounder}
            edited={isGhost ? sub.touched : undefined}
            onWeight={(v, typed) => {
              const vv = signed && v >= 0 ? v * sign : v;
              handleSubSetUpdate(ssi, fromDisplay(signed ? vv : Math.max(0, vv)), typed);
            }}
            onTypeStart={() => {
              subTypeBaseRef.current = { sub: ssi, kg: (Number(sub.weight) || 0) * sign };
            }}
            onTypeEnd={() => commitTypedSubWeight(ssi, (Number(sub.weight) || 0) * sign)}
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

      {/* −5 / +5：跟着选中的那一组（2026-10 指针；原先跟着休息书签）。整行两颗宽键，出汗的手也按得准。
          右端「递减」＝加一档递减（2026-10-11）：长按组号那条路没人知道，这里给一次点击的入口；长按保留。
          次数 −1 / +1（审查 B2）：差一两次是最常见的改法，不用再去横划次数格。 */}
      {!readOnly && selected && (activeMetrics.includes('weight') || activeMetrics.includes('reps')) && (
        <div className="ledger-step" data-set-idx={setIdx} data-testid="weight-step">
          {activeMetrics.includes('weight') && (
            <>
              <button type="button" onClick={() => bump(-1)} aria-label={isCn ? `重量减 ${stepDown} ${unit}` : `Weight −${stepDown} ${unit}`}>
                −{stepDown} <span className="ledger-unit">{unit}</span>
              </button>
              <button type="button" onClick={() => bump(1)} aria-label={isCn ? `重量加 ${stepUp} ${unit}` : `Weight +${stepUp} ${unit}`}>
                +{stepUp} <span className="ledger-unit">{unit}</span>
              </button>
            </>
          )}
          {activeMetrics.includes('reps') && (
            <>
              <button type="button" onClick={() => bumpReps(-1)} aria-label={isCn ? '次数减 1' : 'Reps −1'} data-testid="reps-dec">
                −1 <span className="ledger-unit">{isCn ? '次' : 'rep'}</span>
              </button>
              <button type="button" onClick={() => bumpReps(1)} aria-label={isCn ? '次数加 1' : 'Reps +1'} data-testid="reps-inc">
                +1 <span className="ledger-unit">{isCn ? '次' : 'rep'}</span>
              </button>
            </>
          )}
          {activeMetrics.includes('weight') && (
            <button
              type="button"
              className="ledger-step-drop"
              onClick={() => {
                haptic(H.tap);
                handleAddSubSet(-1);
              }}
              aria-label={isCn ? '加一档递减' : 'Add a drop set'}
              data-testid="add-drop-set"
            >
              {isCn ? '递减' : 'Drop'}
            </button>
          )}
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
  /** 馆档案取整器：拖动按这件器材的一档走（同母组） */
  rounder?: ExRounder | null;
  /** 改重量（显示单位，带符号）；typed＝打字中途，后面的组先不跟 */
  onWeight: (v: number, typed?: boolean) => void;
  /** 重量格开始 / 结束打字：结束时按总差值带后面各组的同一档 */
  onTypeStart: () => void;
  onTypeEnd: () => void;
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
  rounder,
  onWeight,
  onTypeStart,
  onTypeEnd,
  onUpdate,
  onRemove,
}) => {
  const subFeel = weightScrubFor(rounder);
  const weightScrub = useValueScrub({
    value: weightDisplay,
    onChange: next => onWeight(next),
    steps: subFeel.steps,
    stepFn: subFeel.stepFn,
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
              <span className="font-mono font-semibold text-xl leading-none text-primary tabular-nums">
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
                ×{m === 'weight' && rounder ? Math.round(rounder.stepD(weightDisplay) * scrub.step * 100) / 100 : scrub.step}
              </span>
            )}
            <input
              type="number"
              step={m === 'weight' ? 'any' : undefined}
              inputMode={m === 'weight' ? 'decimal' : 'numeric'}
              enterKeyHint={m === 'weight' ? 'next' : 'done'}
              className="ledger-input ledger-input-sm"
              placeholder="0"
              data-undo-label={`${label === 'up' ? (isCn ? '递增' : 'Step-up') : isCn ? '递减' : 'Drop'}${isCn ? (m === 'weight' ? '重量' : '次数') : m === 'weight' ? ' weight' : ' reps'}`}
              onFocus={e => {
                selectOnFocus(e);
                if (m === 'weight') onTypeStart();
              }}
              onBlur={m === 'weight' ? onTypeEnd : undefined}
              onKeyDown={focusNextOnEnter}
              aria-label={
                m === 'weight'
                  ? isCn ? '子组重量' : 'Sub-set weight'
                  : isCn ? '子组次数' : 'Sub-set reps'
              }
              value={value ? display : ''}
              onChange={e => {
                const val = e.target.value === '' ? 0 : Number(e.target.value);
                if (m === 'weight') onWeight(val, true);
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
