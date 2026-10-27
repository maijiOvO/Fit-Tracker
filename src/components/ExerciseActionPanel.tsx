/**
 * 动作面板（2026-10-27 添加动作重构，demo：docs/demos/picker-layout-a.html）
 *
 * 两个入口共用这一张：添加动作普通态「长按动作」、整理态「点动作」。由原来的长按管理菜单扩出来，
 * 归类和别的设置铺在同一张上，不分二级（2026-10-27 用户：「改名 · 器材 · 做法 · 删除」不要再收成二级菜单）：
 *   - 名称：就是一个输入框，改完回车 / 失焦即存；右边 ★
 *   - 用途：训练 / 热身可以都开，至少留一个（蝴蝶机夹胸＝内侧的训练动作，也在胸部热身里）
 *   - 训练：属性表（类型 · 部位 · 细分 · 器材 · 阻力），即点即存；细分多选、选两个以上多一行「主练」（RegionChooser）
 *   - 热身：热身部位多选＝出现在哪几个部位的热身里；只当热身时属性表只剩器材 / 阻力
 *   - 做法 / 备注 / 记录项：打开现有的同一批弹窗；并入另一个动作就地展开；从动作库删除：先执行 + 撤销
 *
 * 长按满 500ms 时面板就弹出来了，手指还按着：松手补发的那次 click 不带新的 pointerdown，
 * 会落到面板里正好在指下的按钮上（无头触摸模拟里必现：直接点中「删除」）。
 * 面板里任何真点击都先有一次 pointerdown，所以「下一次 pointerdown 之前的 click 一律吞掉」——
 * 这是吞一次就作废的条件版，不会把以后的正常点击吃掉。
 */
import React, { useEffect, useRef, useState } from 'react';
import { FileText, GitMerge, ListChecks, Search, Shuffle, Star, Trash2 } from 'lucide-react';
import { ExerciseDefinition, Language } from '../../types';
import { BODY_PARTS } from '../constants/exercises';
import { useExercisePrefs } from '../contexts/ExercisePrefsContext';
import { useUiOverlay } from '../contexts/UiOverlayContext';
import { buildSearchEntry, scoreEntry, tokenize } from '../utils/exerciseSearch';
import { regionList } from '../utils/exerciseAttrs';
import { ExerciseAttrFields, type AttrValue } from './ExerciseAttrFields';
import { hasRegionSection } from './RegionChooser';

interface Props {
  ex: ExerciseDefinition;
  lang: Language;
  onClose: () => void;
  /** 打开热身时默认挂的部位（弹层眼下停的部位）；动作自己有部位时用它自己的 */
  focusPart: string | null;
  onVariants: (name: string) => void;
  onNote: (name: string) => void;
  onMetrics: (name: string) => void;
  onDelete: (id: string) => void;
  /** 并入候选：动作库里还在的动作（已合并覆盖层） */
  library: ExerciseDefinition[];
}

const btn =
  'w-full min-h-[48px] px-4 rounded-card bg-card border border-divider text-small font-bold text-primary flex items-center gap-2.5 active:bg-card-hover transition-colors';
const cap = 'px-2 pt-2 text-micro font-bold tracking-[0.2em] text-secondary';
const chipCls = (on: boolean) =>
  `min-h-[38px] px-3 rounded-control text-xs font-bold transition-colors ${on ? 'bg-accent text-on-accent' : 'bg-card text-secondary active:bg-card-hover'}`;

export const ExerciseActionPanel: React.FC<Props> = ({
  ex,
  lang,
  onClose,
  focusPart,
  onVariants,
  onNote,
  onMetrics,
  onDelete,
  library,
}) => {
  const {
    resolveName,
    effectivePart,
    getTagName,
    customTags,
    sortParts,
    starredExercises,
    toggleStarExercise,
    renameExercise,
    mergeExerciseInto,
    saveExerciseAttrs,
    clearSignedLoad,
    setWarmUse,
  } = useExercisePrefs();
  const { toast } = useUiOverlay();
  const isCn = lang === Language.CN;
  const name = resolveName(ex.name[lang]);
  const [draft, setDraft] = useState(name);
  useEffect(() => setDraft(name), [name]);
  /** 并入另一个动作：null＝没打开；字符串＝搜索词 */
  const [mergeQ, setMergeQ] = useState<string | null>(null);
  const ghostRef = useRef(true);

  const starred = Object.keys(starredExercises).some(k => k.toLowerCase() === name.toLowerCase());
  const warmParts = ex.warmParts ?? [];
  const warm = warmParts.length > 0;
  const train = !(warm && ex.warmOnly);
  const parts = sortParts([...BODY_PARTS, ...customTags.filter(t => t.category === 'bodyPart').map(t => t.id)]);

  const commitRename = () => {
    const v = draft.trim();
    if (!v || v === name) {
      setDraft(name);
      return;
    }
    // 重名会被拒（已 toast），输入框留着让人改
    if (renameExercise(ex.id, v)) toast(isCn ? '已保存' : 'Saved', 'success');
  };

  const attrs: AttrValue = {
    category: ex.category || 'STRENGTH',
    bodyPart: ex.bodyPart || '',
    regions: regionList(ex),
    equipment: ex.equipment ?? '',
    resistance: ex.resistance,
  };
  const saveAttrs = (nv: AttrValue) => {
    // 部位换了、细分没跟着选：存成未细分（细分只认当前部位下的，同属性弹窗）
    saveExerciseAttrs(ex.id, { ...nv, regions: hasRegionSection(nv.bodyPart, nv.category) ? nv.regions : [] });
    // 改了器材 / 阻力：旧的「负荷记法」开关作废，以后跟着阻力走（同动作设置）
    if (nv.equipment !== attrs.equipment || nv.resistance !== attrs.resistance) clearSignedLoad(name);
  };
  const defaultWarmPart = effectivePart(ex) || focusPart || BODY_PARTS[0];
  const toggleUse = (k: 'train' | 'warm') => {
    if (k === 'warm') {
      if (warm && train) setWarmUse(ex.id, [], false);
      else if (!warm) setWarmUse(ex.id, [defaultWarmPart], false);
    } else if (train && warm) setWarmUse(ex.id, warmParts, true);
    else if (!train) setWarmUse(ex.id, warmParts, false);
  };
  const toggleWarmPart = (p: string) => {
    if (warmParts.includes(p)) {
      if (warmParts.length > 1) setWarmUse(ex.id, warmParts.filter(x => x !== p), !train);
    } else setWarmUse(ex.id, [...warmParts, p], !train);
  };

  /** 关面板再开别的弹窗：面板和弹窗不叠在一起 */
  const then = (fn: () => void) => () => {
    onClose();
    fn();
  };

  return (
    <div
      className="absolute inset-0 z-10 bg-scrim flex items-end sm:items-center justify-center p-0 sm:p-6 anim-fade"
      onPointerDownCapture={() => {
        ghostRef.current = false;
      }}
      onClickCapture={e => {
        if (!ghostRef.current) return;
        ghostRef.current = false;
        e.stopPropagation();
        e.preventDefault();
      }}
      onClick={onClose}
      data-testid="row-action-menu"
    >
      <div
        className="bg-inset border-t sm:border border-divider w-full sm:max-w-sm max-h-[88%] overflow-y-auto rounded-t-sheet sm:rounded-card p-4 space-y-2 shadow-2xl"
        style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-2">
          <input
            className="ui-input flex-1 min-w-0 font-semibold"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            }}
            onBlur={commitRename}
            aria-label={isCn ? '动作名称' : 'Exercise name'}
            data-testid="action-panel-name"
          />
          <button
            type="button"
            onClick={() => toggleStarExercise(name)}
            aria-pressed={starred}
            aria-label={isCn ? '收藏' : 'Star'}
            className="w-11 h-11 flex-shrink-0 flex items-center justify-center rounded-control bg-card border border-divider text-accent"
            data-testid="action-panel-star"
          >
            <Star size={19} strokeWidth={2} className={starred ? 'fill-current' : ''} />
          </button>
        </div>

        <div className={cap}>{isCn ? '用途' : 'USE'}</div>
        <div className="grid grid-cols-2 gap-1 p-1 rounded-control bg-card border border-divider" data-testid="action-panel-use">
          {(['train', 'warm'] as const).map(k => {
            const on = k === 'train' ? train : warm;
            return (
              <button
                key={k}
                type="button"
                aria-pressed={on}
                onClick={() => toggleUse(k)}
                className={`min-h-[36px] rounded-control text-small font-bold transition-colors ${on ? 'bg-accent text-on-accent' : 'text-tertiary'}`}
              >
                {k === 'train' ? (isCn ? '训练' : 'Training') : isCn ? '热身' : 'Warm-up'}
              </button>
            );
          })}
        </div>

        {warm && (
          <>
            <div className={cap}>{isCn ? '热身部位' : 'WARM-UP FOR'}</div>
            <div className="flex flex-wrap gap-1.5" data-testid="action-panel-warm-parts">
              {parts.map(p => (
                <button key={p} type="button" aria-pressed={warmParts.includes(p)} onClick={() => toggleWarmPart(p)} className={chipCls(warmParts.includes(p))}>
                  {getTagName(p)}
                </button>
              ))}
            </div>
          </>
        )}

        <div className={cap}>{train ? (isCn ? '训练' : 'TRAINING') : isCn ? '器材' : 'GEAR'}</div>
        <ExerciseAttrFields
          lang={lang}
          value={attrs}
          onChange={saveAttrs}
          rows={train ? undefined : ['equipment', 'resistance']}
          testId="action-panel-attrs"
        />

        <div className="pt-2 space-y-2">
          <button type="button" className={btn} onClick={then(() => onVariants(name))}>
            <Shuffle size={16} className="text-accent" />
            {isCn ? '做法' : 'Variants'}
          </button>
          {mergeQ === null ? (
            <button type="button" className={btn} onClick={() => setMergeQ('')} data-testid="merge-open">
              <GitMerge size={16} className="text-accent" />
              {isCn ? '并入另一个动作…' : 'Merge into another…'}
            </button>
          ) : (
            (() => {
              // 同部位的排前面；搜名字（中英、曾用名）——和添加动作的搜索同一套打分（拼音、pushup 这类写法都认，审查 C）
              const tokens = tokenize(mergeQ);
              const myPart = (effectivePart(ex) || '').toLowerCase();
              const list = library
                .filter(d => d.id !== ex.id)
                .map(d => ({
                  d,
                  score: tokens.length
                    ? scoreEntry(buildSearchEntry(d.name.cn ?? '', d.name.en ?? '', d.aliases ?? []), tokens)
                    : (d.bodyPart || '').toLowerCase() === myPart ? 1 : 0,
                }))
                .filter(r => r.score > 0)
                .sort((a, b) => b.score - a.score)
                .map(r => r.d)
                .slice(0, 12);
              return (
                <div className="rounded-card border border-divider bg-card p-2 space-y-1.5" data-testid="merge-panel">
                  <div className="px-1 text-xs font-medium text-tertiary">
                    {isCn ? `把「${name}」并入哪个动作？它会成为该动作的一个做法，历史和纪录一并带过去` : `Merge "${name}" into which exercise? It becomes a variant; history follows.`}
                  </div>
                  <div className="relative">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-tertiary" />
                    <input
                      className="ui-input w-full pl-8"
                      value={mergeQ}
                      onChange={e => setMergeQ(e.target.value)}
                      placeholder={isCn ? '搜动作名' : 'Search'}
                      aria-label={isCn ? '搜动作名' : 'Search'}
                    />
                  </div>
                  {list.map(d => (
                    <button
                      key={d.id}
                      type="button"
                      onClick={() => {
                        if (mergeExerciseInto(ex.id, d.id)) onClose();
                      }}
                      className="w-full min-h-[44px] px-3 rounded-control text-left text-small font-semibold text-primary active:bg-card-hover flex items-center gap-2"
                      data-testid="merge-target"
                    >
                      {resolveName(d.name[lang])}
                      {d.bodyPart && <span className="ml-auto text-xs font-medium text-tertiary">{getTagName(d.bodyPart)}</span>}
                    </button>
                  ))}
                  {!list.length && <div className="px-1 py-2 text-xs text-tertiary">{isCn ? '没有匹配的动作' : 'No match'}</div>}
                </div>
              );
            })()
          )}
          <button type="button" className={btn} onClick={then(() => onNote(name))}>
            <FileText size={16} className="text-accent" />
            {isCn ? '备注' : 'Note'}
          </button>
          <button type="button" className={btn} onClick={then(() => onMetrics(name))}>
            <ListChecks size={16} className="text-accent" />
            {isCn ? '记录项' : 'Metrics'}
          </button>
          <button
            type="button"
            onClick={then(() => onDelete(ex.id))}
            className="w-full min-h-[48px] px-4 rounded-card bg-danger/10 text-small font-bold text-danger flex items-center gap-2.5 active:bg-danger/20 transition-colors"
          >
            <Trash2 size={16} />
            {isCn ? '从动作库删除' : 'Delete from library'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="w-full min-h-[48px] px-4 rounded-card text-small font-bold text-secondary flex items-center justify-center active:bg-card-hover transition-colors"
          >
            {isCn ? '完成' : 'Done'}
          </button>
        </div>
      </div>
    </div>
  );
};
