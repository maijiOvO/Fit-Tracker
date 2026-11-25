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
import { useLongPress, LONGPRESS_TOTAL_MS } from '../hooks/useLongPress';
import { useTap } from '../hooks/useTap';
import { useValueScrub } from '../hooks/useValueScrub';
import { LongPressAffordance } from './LongPressAffordance';
import { haptic, H } from '../utils/haptics';
import type { SetUpdate } from '../utils/workbench';
import { loadCapD } from '../utils/load';
import { pad2, secondsToHMS } from '../utils/format';
import { altLoadLabel, formatLoad, markTouched, restoreKgOf, shownWeight, typedWeight, weightFromShown } from '../utils/setWrite';
import { parseTypedNum } from '../utils/format';
import { KG_TO_LBS } from '../constants';
import { heroScrubAxis, STACK_PITCH, STACK_ENGAGE_PX } from '../utils/scrubFeel';
import { UserSettingsContext } from '../contexts/UserSettingsContext';
import { appPrefsNow } from '../../services/appPrefs';
import type { LoadKind } from '../hooks/useLoadKind';
import type { ExRounder } from '../hooks/useLoadRounder';
import { nextDropShown } from '../utils/setStep';
import { afterRemoveTap, removeTapOk } from '../utils/tap';

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
  /** 不给＝默认档位表（useValueScrub.SCRUB_TIERS） */
  steps?: number[];
  axis: 'x' | 'y';
  stepFn?: (v: number, dir: 1 | -1, mult: number) => number;
  px?: number;
  engagePx?: number;
} {
  if (!rounder) return { axis: 'x' };
  const axis = heroScrubAxis(rounder.info.kind);
  const stepFn = (v: number, dir: 1 | -1, mult: number) => rounder.stepToD(v, dir, mult);
  // 配重片刻度轨：一档一片、跟手、不跳档（scrubFeel.STACK_PITCH）
  if (axis === 'y') return { steps: [1], axis, stepFn, px: STACK_PITCH, engagePx: STACK_ENGAGE_PX };
  return { axis, stepFn };
}

/**
 * 横拖时浮在格子上方的量规（2026-11-18 用户反馈「不知道滑多少才是一格」）：三根刻度＝上一格 / 现在 / 下一格，
 * 两头写着到了那一格是多少；朱砂游标跟手从中间往一侧走，走到刻度＝落一格、弹回中间。
 * 放在格子上方是因为手指盖着格子和下面。游标位置读 useValueScrub 写在格子上的 --scrub-acc / --scrub-px。
 */
const ScrubGauge: React.FC<{
  value: number;
  /** 这一下走几档（甩快了是 2） */
  mult: number;
  /** 按器材走一格（weightScrubFor 的 stepFn）；不给＝加减 mult */
  stepTo?: (v: number, dir: 1 | -1, mult: number) => number;
  min: number;
}> = ({ value, mult, stepTo, min }) => {
  const at = (dir: 1 | -1) => Math.round(Math.max(min, stepTo ? stepTo(value, dir, mult) : value + dir * mult) * 100) / 100;
  return (
    <span className="scrub-gauge" aria-hidden data-testid="scrub-gauge">
      <span>{at(-1)}</span>
      <span className="scrub-gauge-track">
        <i />
      </span>
      <span>{at(1)}</span>
    </span>
  );
};

interface SetCapsuleProps {
  set: any;
  setIdx: number;
  activeMetrics: string[];
  /** 负重/辅助标记，影响 weight 列的单位符号（+kg / −kg）。只读历史视图可不传。 */
  loadMode?: LoadMode;
  /** 这一行是刚添加出来的 → 播「写下一组」入场（§5.3） */
  isNew?: boolean;
  /** 顶栏的显示单位；有取整器时按 rounder.display（器械有自己的单位就整张卡按它，D1） */
  unit: string;
  lang: Language;
  readOnly?: boolean;
  onUpdate: (updates: Partial<SetLog>) => void;
  onRemove: () => void;
  onDurationClick?: () => void;
  /**
   * 选中（2026-10 指针）：组号实心；± / 递减键在底栏上方的 SetActionStrip 里改这一组。全场至多一行。
   * 只有点过的那组实心，没点过时谁都不实心（审查 A5）。
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
   * 单位前的 + / − 可点，换号。sign 给出组上没写号时的号（旧数据；重量是 0 的组沿用上一组，见 workbench.carrySign）。
   */
  signed?: { sign: (s: SetLog) => -1 | 1 };
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

/** 打进来的次数：非负整数，不设上限（D4） */
const wholeReps = (n: number) => Math.max(0, Math.round(n));


export const SetCapsule: React.FC<SetCapsuleProps> = ({
  set,
  setIdx,
  activeMetrics,
  loadMode,
  isNew = false,
  unit: shownUnit,
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
  const unit = rounder ? rounder.display : shownUnit;
  // 首选项：递减每档（当前单位下的数，kg / lbs 共用）。只读历史视图里也拿得到，拿不到用存储里的值
  const { dropStep } = useContext(UserSettingsContext)?.appPrefs ?? appPrefsNow();
  // §11 坑 1：动画跑完必须摘掉入场类，否则它会盖住后续的反馈动画，
  // 且 fill:both 会把 height 钉死在 52px。
  const [entering, setEntering] = useState(isNew);
  // 显式标注：解构默认值会被本项目的宽松 tsconfig 拓宽成 string
  const mode: LoadMode = loadMode ?? 'none';
  // 自带一份列宽：ExerciseCard 会在卡片上设同样的值（表头要用），
  // 但只读历史视图没有那个父级，行必须自己兜住。
  const colStyle = { ['--cols' as string]: ledgerCols(activeMetrics.length, firstCol) };
  // PB 小标挂在重量格；有氧 / 计时动作没有重量格，挂第一格
  const prMetric = activeMetrics.includes('weight') ? 'weight' : activeMetrics[0];
  const pbTag = (m: string) =>
    m === prMetric && isPR && !isGhost && (
      <span className="pb-tag" aria-label={isCn ? '新纪录' : 'New PR'}>
        PB
      </span>
    );
  // 直接读 props，不留本地副本：原先的 useState(set.subSets) 只在挂载时读一次，
  // 之后外部改了这一组（底稿预填、撤销、同步回来）子组行不会跟着变。
  const subSets: SubSetLog[] = set.subSets || [];
  const hasSubSets = subSets.length > 0;

  /**
   * 带正负的负荷：号按组算（组上没写按动作实例），显示的是绝对值，号在单位前（+kg / −kg）；
   * 运算（±5、横拖、递减）在带符号的数上做，所以能从 −5 走到 0 再走到 +5。
   */
  const signOf = (x: SetLog | SubSetLog, parent?: SetLog): -1 | 1 => {
    if (!signed) return 1;
    if (x.bodyweightMode === 'assisted') return -1;
    if (x.bodyweightMode === 'weighted') return 1;
    return parent ? signOf(parent) : signed.sign(x as SetLog);
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
   * 组行两种状态：指针下面（ghost，还没练到）/ 指针上面（练过的）。没有单独的「做完」（2026-11-23），
   * 练没练到看指针位置和数字墨色；组号平时一律空心细框，选中才实心（用户定：只两种样子）。
   * 点组号交给工作台：一下＝选中 + 指针挪到这一组正下方（往回点也一样；已选中的再点不变）。改值只改值。
   */
  const isGhost = !!set.ghost && !readOnly;
  /**
   * 打字改重量：聚焦时记下带符号的 kg，离开时按总差值让后面的组平移一次（workbench.SetUpdate）。
   * 逐键平移会让后面的组跟着 1、15、150 一路跳，减到 0 以下还会被截掉。
   */
  const rowSignedKg = (Number(set.weight) || 0) * rowSign;
  const typeBaseRef = React.useRef<number | null>(null);
  /** 聚焦重量格那一刻这一组的号：打字中途清空时组变成 0、号就丢了，之后的每一键按这个号写（上架审查 C37） */
  const typeSignRef = React.useRef<-1 | 1>(1);
  /**
   * 正在打的那一格显示原文、不按存下的值回填（上架审查 C38）：受控框逐键回填会把「5.0」改写成「5」，最终存成 55。
   * 一行同一时刻只有一格在打，一份就够。
   */
  const [draft, setDraft] = React.useState<{ m: string; text: string } | null>(null);
  const commitTypedWeight = () => {
    const base = typeBaseRef.current;
    typeBaseRef.current = null;
    if (base !== null && base !== rowSignedKg) onUpdate({ followFrom: { kg: base } } as SetUpdate);
  };
  const subTypeBaseRef = React.useRef<{ sub: number; kg: number; sign: -1 | 1 } | null>(null);
  const commitTypedSubWeight = (subIdx: number, nowKg: number) => {
    const base = subTypeBaseRef.current;
    subTypeBaseRef.current = null;
    if (base && base.sub === subIdx && base.kg !== nowKg) onUpdate({ followFrom: base } as SetUpdate);
  };

  const update = (updates: SetUpdate) => onUpdate(isGhost ? markTouched(set, updates) : updates);

  // 点组号不等浏览器的 click（hooks/useTap）：随手一点带出几像素滑动时 click 会被取消，表现为「点了没反应」。
  // 按满长按的时长归长按（加递减档），这里不再算点击
  const numTap = useTap(() => onNumTap?.(), LONGPRESS_TOTAL_MS);

  /** 显示单位下的带符号重量 ⇄ 存储（kg，非负 + 号）；打字、横拖、加递减档都走这里，口径在 utils/setWrite */
  const toDisplay = (kg: number, sign: -1 | 1) => shownWeight(kg, sign, unit);
  const fromDisplay = (raw: number) => weightFromShown(raw, unit, rounder, !!signed);
  const du = unit === 'lbs' ? 'lbs' : 'kg';

  // 重量格横向拖动改值。hook 不能在下面的 map 里调，所以在这里调一次，
  // 再把 handlers 单独摊到 weight 那一格上。
  // 步长按【显示单位】走：kg 里的 1 就是 1kg，lbs 里的 1 就是 1lb，不做换算——
  // 调重量时脑子里想的是「加一点 / 加很多」，不是某个绝对质量。
  const weightDisplay = toDisplay(set.weight, rowSign);
  const weightFeel = weightScrubFor(rounder);
  // 做完且没选中的组，重量格和次数格都不接横拖（审查 B1 核实：翻页时拇指带出 20px 就悄悄改了做完的数；
  // 次数格 2026-11-24 作者定，审查 C41）；打字照常。待做的组和选中的组照旧能拖
  const scrubLocked = !isGhost && !selected;
  const weightScrub = useValueScrub({
    value: weightDisplay,
    // 走 update：待做行上横拖只改值、记 touched，不描实
    onChange: next => update(fromDisplay(next)),
    steps: weightFeel.steps,
    // 组行格子一律横拖（见 weightScrubFor 注释），竖拖只给配重片的大图
    axis: 'x',
    stepFn: weightFeel.stepFn,
    disabled: readOnly || scrubLocked,
    max: loadCapD(du, !!signed),
    // 带正负的负荷可以拖过 0（辅助 → 自重 → 负重）
    ...(signed ? { min: -loadCapD(du, true) } : {}),
  });
  // 次数格同一套手势（§12.6 提到的一致性补全）
  const repsScrub = useValueScrub({
    value: Number(set.reps) || 0,
    onChange: next => update({ reps: next }),
    disabled: readOnly || scrubLocked,
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
   * 这里只管手动加一档：从【上一行】（最后一档，没有就是母组）走一档（算法在 setStep.nextDropShown，
   * 底栏上方操作条的「递减」键同一份）。次数跟上一行一致：递减组多半做到力竭，具体数只能现填。
   */
  const handleAddSubSet = (dir: -1 | 1 = -1) => {
    const prev = subSets.length > 0 ? subSets[subSets.length - 1] : set;
    const prevSign = subSets.length > 0 ? signOf(prev, set) : rowSign;
    const shown = toDisplay(prev.weight, prevSign);
    const next = nextDropShown(shown, dir, rounder, dropStep, !!signed);
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
    onLongPress: () => handleAddSubSet(-1),
    disabled: readOnly,
  });

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
   * 只是说明，不能点：改回去的键在卡片左下角（ExerciseCard「改回上次」，2026-11-23 用户定——
   * 原来这行小字自己就是按钮，看不出能点）。第一次练（没有 prefillRef）就没有这个标。
   */
  const refTag = ((): string => {
    const none = '';
    if (readOnly) return none;
    // 做完的组不跟着切单位重算（2026-10-18 用户定）：挂的是另一种片就标出来，免得以为那个数是换算残留
    const curU = unit === 'lbs' ? 'lbs' : 'kg';
    if (!set.ghost && (set.plateUnit === 'kg' || set.plateUnit === 'lbs') && set.plateUnit !== curU) {
      return isCn ? (set.plateUnit === 'lbs' ? '做完时挂的是磅片' : '做完时挂的是公斤片') : set.plateUnit === 'lbs' ? 'done on lb plates' : 'done on kg plates';
    }
    // 换了做法、新做法没练过：底稿是按新器材硬取整的，提醒确认（改过重量就不再提醒）
    if (set.ghost && set.checkWeight && !set.touched?.weight) return isCn ? '换了做法，确认一下重量' : 'New variant — check weight';
    const ref = set.prefillRef as SetLog['prefillRef'];
    if (!ref || !(Math.abs(ref.kg) > 0)) return none;
    const inRef = Math.round((ref.unit === 'lbs' ? Math.abs(ref.kg) * KG_TO_LBS : Math.abs(ref.kg)) * 100) / 100;
    const lab = ref.unit === 'lbs' ? 'lb' : 'kg';
    const assisted = !!signed && ref.kg < 0;
    const what = ref.plan ? (isCn ? '计划' : 'Plan') : isCn ? '上次' : 'Last';
    const text = isCn
      ? `${what} ${assisted ? '辅助 ' : ''}${inRef} ${lab}`
      : `${what} ${assisted ? 'assisted ' : ''}${inRef} ${lab}`;
    // 重量改离了默认值（setWrite.restoreKgOf）：标出上次的原数
    if (restoreKgOf(set, rowSign, unit, rounder?.snapKg) !== undefined) return text;
    const same = ref.unit === (unit === 'lbs' ? 'lbs' : 'kg') && Math.abs(inRef - Math.abs(weightDisplay)) < 0.01;
    return same ? none : text;
  })();
  // 换算预览：这张卡按器械单位写、顶栏是另一种单位时，重量下面标出顶栏单位下的数（只读历史本来就跟顶栏，不用）
  const altLabel = readOnly ? '' : altLoadLabel(Number(set.weight) || 0, unit, shownUnit);
  const altTag = altLabel && <span data-testid="alt-load">{altLabel}</span>;

  return (
    <>
      <div
        className={`ledger-row${entering ? ' is-entering' : ''}${isGhost ? ' is-ghost' : ''}${inkin ? ' is-inkin' : ''}${!isGhost && !readOnly ? ' is-inked' : ''}${selected ? ' is-selected' : ''}${isPR && !isGhost ? ' is-pr' : ''}${readOnly ? ' is-readonly' : ''}`}
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
        {/* 组号：36×36 胶囊。点 = 选中，指针移到它下面；
            长按 = 加一档递减。点击由 useTap 自己判，热区比看到的框各边大一圈（.set-num::before）。
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
            className={`set-num relative ${badge ? 'w-[30px] h-[30px]' : readOnly ? 'w-6 h-6' : 'w-9 h-9'} flex-none flex items-center justify-center select-none font-mono font-semibold text-label text-accent tabular-nums touch-pan-y`}
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
            {...(readOnly
              ? {}
              : {
                  ...addSub.handlers,
                  ...numTap,
                  onPointerDown: (e: React.PointerEvent) => {
                    addSub.handlers.onPointerDown(e);
                    numTap.onPointerDown(e);
                  },
                  onPointerUp: (e: React.PointerEvent) => {
                    addSub.handlers.onPointerUp();
                    numTap.onPointerUp(e);
                  },
                })}
          >
            {no}
            <LongPressAffordance
              active={addSub.pressing}
              label={isCn ? '递减' : 'Drop'}
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
                className={`ledger-field font-mono font-semibold leading-none text-primary tabular-nums ${readOnly ? 'text-h2' : 'min-h-[44px] text-xl'}${
                  readOnly ? '' : ' ledger-fit'
                }`}
                // 居中而不是 .ledger-field 的 baseline：按钮 44px 高、只有一段文字，
                // baseline 会把它顶到格子上沿，比同排的数字高出一截。
                style={{ ['--ledger-chars' as string]: 8, alignItems: 'center' }}
              >
                <span className="ledger-fit-text">
                  {pad2(hms.h)}:{pad2(hms.m)}:{pad2(hms.s)}
                </span>
                {pbTag(m)}
              </button>
            );
          }

          if (readOnly) {
            const raw = set[m as keyof SetLog];
            // 只读（历史）保留 1 位：换算出来的 41.89 / 308.65 读起来乱；编辑态仍保留 2 位，换算来回不丢数。
            // 数字靠右：同一列的个位、单位各自排成一条竖线，不再随位数左右跳（2026-10-22 界面审查）
            const display =
              m === 'weight'
                ? (Math.round(Number(formatLoad(Number(raw) || 0, unit)) * 10) / 10).toString()
                : raw === 0 || raw === undefined
                  ? '—'
                  : String(Math.round(distToDisplay(m, Number(raw)) * 100) / 100);
            return (
              <span key={m} className="ledger-field" style={{ justifyContent: 'flex-end' }}>
                <span className="font-mono font-semibold text-h2 text-primary tabular-nums">
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
                ? formatLoad(Number(raw), unit)
                : distToDisplay(m, Number(raw)).toFixed(2).replace(/\.?0+$/, '');
          const unitTap = m === 'weight' && signed && Number(set.weight) > 0;
          // 打字中显示原文；排版宽度也按它算（逗号当小数点，不然「62,05」按 5 位整数排、字会跳）
          const shown = draft?.m === m ? draft.text : display;
          const shownN = shown.replace(/[,，]/g, '.');
          return (
            <label
              key={m}
              data-testid={`ledger-field-${m}`}
              className={`ledger-field ledger-fit${scrub && !scrubLocked ? ' is-scrubbable' : ''}${
                scrub?.scrubbing ? ' is-scrubbing' : ''
              }${isGhost && set.touched?.[m] ? ' is-edited' : ''}`}
              style={{
                ['--ledger-chars' as string]: Math.max(shownN.length, 1),
                // 整数部分的位数：重量数字按它定位，十位 / 个位钉住不动，小数往右长（2026-10-18 用户定：
                // 居中对齐时 60 → 62.5 一路左右飘）
                ['--int-chars' as string]: Math.max(shownN.split('.')[0].replace('-', '').length, 1),
                // 收字号用：从中线往右要放下几个数字宽。小数点只有数字宽的约 2/3（Barlow 实测 0.325 vs 0.475 em），
                // 按整字算会把 102.5 收到 24px，掉到 §0「≥26px」底线以下
                ['--fit-chars' as string]: (() => {
                  const int = Math.max(shownN.split('.')[0].replace('-', '').length, 1);
                  return Math.max(1, shownN.length - int / 2 - (shownN.includes('.') ? 0.32 : 0));
                })(),
                ['--ledger-unit-w' as string]: `${Math.max(20, unitLabel.length * 6.5 + 4)}px`,
              }}
              {...(scrub ? scrub.handlers : {})}
            >
              {/* 量规只在拖动时出现：不拖的时候这一格必须是干净的数字。 */}
              {scrub?.scrubbing && (
                <ScrubGauge
                  value={m === 'weight' ? weightDisplay : Number(set.reps) || 0}
                  mult={scrub.step}
                  stepTo={m === 'weight' ? weightFeel.stepFn : undefined}
                  min={m === 'weight' && signed ? -Infinity : 0}
                />
              )}
              {/* 行下标：「上次 x」和换算预览排在同一行（各占一处会在窄格子里叠字）；PB 行不出「上次」，换算照出 */}
              {m === 'weight' && !(refTag && !(isPR && !isGhost)) && altTag && <span className="ref-tag">{altTag}</span>}
              {m === 'weight' && refTag && !(isPR && !isGhost) && (
                <span className="ref-tag" data-testid="prefill-ref">{refTag}{altTag && <> · {altTag}</>}</span>
              )}
              {pbTag(m)}
              {/* type=text + inputMode：type=number 会把逗号小数「62,5」清洗成 625、逐键回填把 5.0 改写成 5（C38 / live-walkthrough#1） */}
              <input
                type="text"
                autoComplete="off"
                inputMode={m === 'reps' ? 'numeric' : 'decimal'}
                enterKeyHint={activeMetrics.indexOf(m) < activeMetrics.length - 1 ? 'next' : 'done'}
                className={`ledger-input${m === 'weight' ? ' is-int-anchored' : ''}`}
                placeholder="0"
                aria-label={unitLabel ? `${m} (${unitLabel})` : m}
                data-undo-label={`${isCn ? `第 ${setIdx + 1} 组` : `Set ${setIdx + 1} `}${translations[m as keyof typeof translations]?.[lang] ?? m}`}
                value={shown}
                onFocus={e => {
                  selectOnFocus(e);
                  setDraft({ m, text: display });
                  if (m === 'weight') {
                    typeBaseRef.current = rowSignedKg;
                    // 号在这一刻定下：0 的组这时拿到的就是沿用上一组的号（审查 C6）
                    typeSignRef.current = rowSign;
                  }
                }}
                onBlur={() => {
                  setDraft(null);
                  if (m === 'weight') commitTypedWeight();
                }}
                onKeyDown={focusNextOnEnter}
                onChange={e => {
                  const text = e.target.value;
                  setDraft({ m, text });
                  if (m === 'weight') {
                    // 带正负：打负数＝辅助；打正数按聚焦时的号（辅助的组清空再打还是辅助，C37）
                    const w = typedWeight(text, typeSignRef.current, unit, rounder, !!signed);
                    // 打字中途只改这一格，离开输入框时再按总差值带后面（commitTypedWeight）
                    if (w) update({ ...w, holdFollow: true });
                    return;
                  }
                  const n = text.trim() === '' ? 0 : parseTypedNum(text);
                  if (n === null) return;
                  // 次数只夹成非负整数、不设上限（跳绳会很大）；距离 / 速度按首选项的距离单位打，存回 km、km/h
                  update({ [m]: m === 'reps' ? wholeReps(n) : distFromDisplay(m, n) });
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
            onClick={e => {
              if (!removeTapOk(e)) return;
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
            altLabel={readOnly ? '' : altLoadLabel(Number(sub.weight) || 0, unit, shownUnit)}
            isCn={isCn}
            readOnly={readOnly}
            ghost={isGhost}
            scrubLocked={scrubLocked}
            label={subLabel(ssi)}
            weightDisplay={toDisplay(sub.weight, sign)}
            signed={!!signed}
            rounder={rounder}
            edited={isGhost ? sub.touched : undefined}
            onWeight={v => {
              const vv = signed && v >= 0 ? v * sign : v;
              handleSubSetUpdate(ssi, fromDisplay(signed ? vv : Math.max(0, vv)));
            }}
            onTypeWeight={text => {
              // 按聚焦时的号写（C37，同母组）
              const w = typedWeight(text, subTypeBaseRef.current?.sign ?? sign, unit, rounder, !!signed);
              if (w) handleSubSetUpdate(ssi, w, true);
            }}
            onTypeStart={() => {
              subTypeBaseRef.current = { sub: ssi, kg: (Number(sub.weight) || 0) * sign, sign };
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
            onClick={e => {
              if (afterRemoveTap(e)) return;
              haptic(H.tap);
              handleAddSubSet(-1);
            }}
            className="min-h-[44px]"
            data-testid="subset-add-drop"
          >
            + {isCn ? '递减' : 'Drop'}
          </button>
          <button
            type="button"
            onClick={e => {
              if (afterRemoveTap(e)) return;
              haptic(H.tap);
              handleAddSubSet(1);
            }}
            className="min-h-[44px]"
            data-testid="subset-add-up"
          >
            + {isCn ? '递增' : 'Up'}
          </button>
        </div>
      )}

      {/* 选中组的 ± / 递减键不在行里：固定在底栏上方（SetActionStrip，2026-10-27 用户定），
          位置不跟着选中的组跳、不挤卡片。 */}
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
  /** 换算预览（同母组）：顶栏单位下的数，没有＝'' */
  altLabel: string;
  isCn: boolean;
  readOnly: boolean;
  /** 母组还是待做 → 子组跟着显示淡墨 */
  ghost: boolean;
  /** 母组做完且没选中：重量格、次数格不接横拖，打字照常（同母组） */
  scrubLocked: boolean;
  /** 比上一档轻＝递减，重＝递增 */
  label: 'drop' | 'up';
  /** 显示单位下的带符号重量（普通重量就是非负的显示值） */
  weightDisplay: number;
  signed: boolean;
  /** 待做时改过的格子（变实墨） */
  edited?: SubSetLog['touched'];
  /** 馆档案取整器：拖动按这件器材的一档走（同母组） */
  rounder?: ExRounder | null;
  /** 横拖改重量（显示单位，带符号） */
  onWeight: (v: number) => void;
  /** 重量格打字的一键（原文；母组按聚焦时的号解析、写回，后面的组先不跟） */
  onTypeWeight: (text: string) => void;
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
  altLabel,
  isCn,
  readOnly,
  ghost,
  scrubLocked,
  label,
  weightDisplay,
  signed,
  edited,
  rounder,
  onWeight,
  onTypeWeight,
  onTypeStart,
  onTypeEnd,
  onUpdate,
  onRemove,
}) => {
  const subFeel = weightScrubFor(rounder);
  const du = unit === 'lbs' ? 'lbs' : 'kg';
  const weightScrub = useValueScrub({
    value: weightDisplay,
    onChange: next => onWeight(next),
    steps: subFeel.steps,
    stepFn: subFeel.stepFn,
    disabled: readOnly || scrubLocked,
    max: loadCapD(du, signed),
    ...(signed ? { min: -loadCapD(du, true) } : {}),
  });
  const repsScrub = useValueScrub({
    value: Number(sub.reps) || 0,
    onChange: next => onUpdate({ reps: next }),
    disabled: readOnly || scrubLocked,
  });
  /** 正在打的那一格显示原文（同母组，C38） */
  const [draft, setDraft] = React.useState<{ m: string; text: string } | null>(null);

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
          m === 'weight' ? formatLoad(sub.weight || 0, unit) : String(sub.reps || '');

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
            className={`ledger-field${scrubLocked ? '' : ' is-scrubbable'}${scrub.scrubbing ? ' is-scrubbing' : ''}${
              edited?.[m as 'weight' | 'reps'] ? ' is-edited' : ''
            }`}
            style={{ ['--ledger-chars' as string]: Math.max(display.length, 1) }}
            {...scrub.handlers}
          >
            {scrub.scrubbing && (
              <ScrubGauge
                value={m === 'weight' ? weightDisplay : Number(sub.reps) || 0}
                mult={scrub.step}
                stepTo={m === 'weight' ? subFeel.stepFn : undefined}
                min={m === 'weight' && signed ? -Infinity : 0}
              />
            )}
            {m === 'weight' && altLabel && <span className="ref-tag" data-testid="alt-load">{altLabel}</span>}
            <input
              type="text"
              autoComplete="off"
              inputMode={m === 'weight' ? 'decimal' : 'numeric'}
              enterKeyHint={m === 'weight' ? 'next' : 'done'}
              className="ledger-input ledger-input-sm"
              placeholder="0"
              data-undo-label={`${label === 'up' ? (isCn ? '递增' : 'Up') : isCn ? '递减' : 'Drop'}${isCn ? (m === 'weight' ? '重量' : '次数') : m === 'weight' ? ' weight' : ' reps'}`}
              onFocus={e => {
                selectOnFocus(e);
                setDraft({ m, text: value ? display : '' });
                if (m === 'weight') onTypeStart();
              }}
              onBlur={() => {
                setDraft(null);
                if (m === 'weight') onTypeEnd();
              }}
              onKeyDown={focusNextOnEnter}
              aria-label={
                m === 'weight'
                  ? isCn ? `${label === 'up' ? '递增' : '递减'}重量` : `${label === 'up' ? 'Up' : 'Drop'} weight`
                  : isCn ? `${label === 'up' ? '递增' : '递减'}次数` : `${label === 'up' ? 'Up' : 'Drop'} reps`
              }
              value={draft?.m === m ? draft.text : value ? display : ''}
              onChange={e => {
                const text = e.target.value;
                setDraft({ m, text });
                if (m === 'weight') return onTypeWeight(text);
                const n = text.trim() === '' ? 0 : parseTypedNum(text);
                if (n !== null) onUpdate({ reps: wholeReps(n) });
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
          onClick={e => {
            if (removeTapOk(e)) onRemove();
          }}
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
