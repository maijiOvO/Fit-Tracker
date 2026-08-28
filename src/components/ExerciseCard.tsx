/**
 * 一个动作＝一页稿纸（规格 §6.2）
 *
 * 头部是刊头行：左边衬线动作名，右边等宽的「第N个 · M组 · X.Xt」，下方双线分隔。
 * 组区画稿纸横纹，每条组行落在横纹上。
 * 删除动作只保留一处——刊头右侧的 ⋯ 溢出菜单（§6.6：列表里的删除入口
 * 一律降级为菜单内的墨色文字项，不靠颜色区分危险）。
 */
import React, { useEffect, useRef, useState } from 'react';
import { MoreHorizontal, StickyNote, Settings as SettingsIcon, Trash2, Plus } from 'lucide-react';
import { Exercise, Language } from '../../types';
import { translations } from '../../translations';
import { formatExerciseTime } from '../utils/dateUtils';
import { SetCapsule } from './SetCapsule';
import { LongPressAffordance } from './LongPressAffordance';
import { getLoadMode, ledgerCols } from '../utils/exerciseConfig';
import { haptic, H } from '../utils/haptics';

/** 本动作总容量 Σ(weight × reps)，含递减子组。刊头右侧那个数。
 *  底稿行（ghost）不算 —— 它还不是数据（§12.6）。 */
function totalVolumeKg(exercise: Exercise): number {
  return exercise.sets.reduce((sum, s: any) => {
    if (s.ghost) return sum;
    let v = (s.weight || 0) * (s.reps || 0);
    for (const sub of s.subSets || []) v += (sub.weight || 0) * (sub.reps || 0);
    return sum + v;
  }, 0);
}

/** 眉批用：底稿出处的短日期 */
function formatPrefillDate(iso: string, isCn: boolean): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return isCn
    ? `${d.getMonth() + 1}月${d.getDate()}日`
    : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatVolume(kg: number, unit: string): string {
  const v = unit === 'lbs' ? kg * 2.20462 : kg;
  if (v <= 0) return '—';
  if (v >= 1000) return `${(v / 1000).toFixed(1)}${unit === 'lbs' ? 'k' : 't'}`;
  return `${Math.round(v)}${unit}`;
}

interface ExerciseCardProps {
  exercise: Exercise;
  exIdx: number;
  lang: Language;
  unit: string;
  /** 本场训练的场地（§12.11）。只用来判断底稿是不是从别的馆抄来的。 */
  workoutGym?: string;
  exerciseNotes: Record<string, string>;
  getActiveMetrics: (name: string) => string[];
  resolveName: (name: string) => string;
  onUpdateExercise: (exIdx: number, updates: Partial<Exercise>) => void;
  onDeleteExercise: (exIdx: number) => void;
  onOpenTimePicker: (exIdx: number, setIdx: number, currentSeconds: number) => void;
  onToggleNote: (name: string) => void;
  onOpenMetricModal: (name: string) => void;
  onSetUpdate: (exIdx: number, setIdx: number, updates: Partial<Exercise['sets'][0]>) => void;
  onAddSet: (exIdx: number) => void;
  onRemoveSet: (exIdx: number, setIdx: number) => void;
  /** §12.7 长按刊头拖动排序：由 NewWorkoutTab 的 useCardReorder 下发，摊到刊头行上 */
  dragHandle?: {
    handlers: React.DOMAttributes<HTMLElement>;
    pressing: boolean;
    hinting: boolean;
    drawMs: number;
  };
}

export const ExerciseCard: React.FC<ExerciseCardProps> = ({
  exercise,
  exIdx,
  lang,
  unit,
  workoutGym,
  exerciseNotes,
  getActiveMetrics,
  resolveName,
  onDeleteExercise,
  onOpenTimePicker,
  onToggleNote,
  onOpenMetricModal,
  onSetUpdate,
  onAddSet,
  onRemoveSet,
  dragHandle,
}) => {
  const isCn = lang === Language.CN;
  const exerciseName = resolveName(exercise.name);
  const activeMetrics = getActiveMetrics(exerciseName);
  const hasNote = !!exerciseNotes[exerciseName];
  const loadMode = getLoadMode(exercise);
  // 底稿行不计入「M组」——它还不是数据（§12.6）
  const realSetCount = exercise.sets.filter((s: any) => !s.ghost).length;
  const ghostSetCount = exercise.sets.length - realSetCount;
  /**
   * §12.11：底稿来自别的馆时，眉批要把这件事摊开 —— 照抄的重量是按另一套
   * 刻度记的。在渲染时判而不是在预填时判：加完动作再回头改本场场地是常见操作。
   * 两边都标了场地才谈得上「不同」；有一边没标就是不知道，不知道就不说。
   */
  const draftFromOtherGym =
    !!exercise.prefillGym && !!workoutGym && exercise.prefillGym !== workoutGym;

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  /**
   * 哪些组行是「刚添加出来的」——只有它们播「写下一组」入场（§5.3）。
   *
   * 靠比对上一次渲染的 id 集合判断，而不是靠组件挂载：
   * 挂载会在切 tab、展开卡片时都发生，那时整卡一起动就成噪音了。
   * 首次渲染整卡的行都不算新（seenRef 为空 → 全部跳过）。
   */
  const seenSetIdsRef = useRef<Set<string> | null>(null);
  const currentIds = exercise.sets.map((s: any) => String(s.id));
  const newSetIds = new Set<string>();
  if (seenSetIdsRef.current) {
    for (const id of currentIds) if (!seenSetIdsRef.current.has(id)) newSetIds.add(id);
  }
  // ⚠️ 必须在 commit 之后才登记，不能在渲染期改 ref：
  // StrictMode 会把渲染跑两遍，第一遍就登记的话第二遍算出来的「新行」是空的，
  // 提交到 DOM 的就永远是 isNew=false，动画一次都不会播。
  useEffect(() => {
    seenSetIdsRef.current = new Set(currentIds);
    // currentIds 每次渲染都是新数组，用它的内容当依赖
  }, [currentIds.join('|')]);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenuOpen(false);
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const handleDurationClick = (setIdx: number) => {
    onOpenTimePicker(exIdx, setIdx, exercise.sets[setIdx].duration || 0);
  };

  // 父行与子组行共用同一份列宽，根治原先「表头 px-2 vs 行 p-3」的 4px 错位
  const cols = ledgerCols(activeMetrics.length);

  const menuItem =
    'w-full min-h-[44px] px-4 flex items-center gap-3 text-left text-body text-primary active:bg-card-hover';

  return (
    <div className="ui-card p-0 overflow-visible" style={{ ['--cols' as string]: cols }}>
      {/* ── 刊头行 ──
          §12.7：整个刊头是拖动排序的长按热区（touch-pan-y，长按满前动手指=让位给滚动）。
          热区里有按钮（⋯ 菜单），排序 hook 的 pointerdown 会自行跳过 button 目标。 */}
      <div
        className="masthead-rule relative px-3 pt-4 pb-2.5 touch-pan-y"
        {...(dragHandle?.handlers ?? {})}
      >
        {dragHandle && (
          <LongPressAffordance
            active={dragHandle.pressing}
            hint={dragHandle.hinting}
            label={isCn ? '拖动排序' : 'Drag to reorder'}
            hintLabel={isCn ? '按住拖动排序' : 'Hold to reorder'}
            drawMs={dragHandle.drawMs}
            placement="down"
          />
        )}
        <div className="flex items-baseline gap-3">
          <h3 className="font-display text-h2 text-primary leading-snug flex-1 min-w-0 break-words">
            {exerciseName}
          </h3>

          <span className="font-mono text-label text-tertiary tabular-nums whitespace-nowrap">
            {isCn ? `第${exIdx + 1}个` : `#${exIdx + 1}`} · {realSetCount}
            {isCn ? '组' : ' sets'} · {formatVolume(totalVolumeKg(exercise), unit)}
          </span>

          <div className="relative -mr-1 -my-2" ref={menuRef}>
            <button
              type="button"
              onClick={() => {
                haptic(H.tap);
                setMenuOpen(o => !o);
              }}
              className="w-11 h-11 flex items-center justify-center text-tertiary"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-label={isCn ? '动作菜单' : 'Exercise menu'}
            >
              <MoreHorizontal size={20} strokeWidth={1.75} />
            </button>

            {menuOpen && (
              <div
                role="menu"
                className="anim-reveal absolute right-0 top-full z-20 mt-1 w-44 py-1 bg-card border border-divider rounded-card shadow-overlay"
              >
                <button
                  type="button"
                  role="menuitem"
                  className={menuItem}
                  onClick={() => {
                    setMenuOpen(false);
                    onToggleNote(exerciseName);
                  }}
                >
                  <StickyNote size={16} strokeWidth={1.75} className="text-tertiary" />
                  {hasNote ? (isCn ? '编辑备注' : 'Edit note') : isCn ? '加备注' : 'Add note'}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className={menuItem}
                  onClick={() => {
                    setMenuOpen(false);
                    onOpenMetricModal(exerciseName);
                  }}
                >
                  <SettingsIcon size={16} strokeWidth={1.75} className="text-tertiary" />
                  {isCn ? '动作设置' : 'Settings'}
                </button>
                {/* §6.6：删除入口降级为墨色文字项，不靠颜色喊危险；
                    真正的危险确认在弹窗里做（全宽实心 + 明确文案）。 */}
                <button
                  type="button"
                  role="menuitem"
                  className={`${menuItem} border-t border-divider mt-1 pt-1`}
                  onClick={() => {
                    setMenuOpen(false);
                    onDeleteExercise(exIdx);
                  }}
                >
                  <Trash2 size={16} strokeWidth={1.75} className="text-tertiary" />
                  {isCn ? '删除动作' : 'Delete exercise'}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* 眉批 §12.6：底稿的出处与用法。只在还有未描实的底稿行时出现，
            全部描实（或抹掉）后自然消失。 */}
        {ghostSetCount > 0 && (
          <div className="mt-1.5 text-label text-tertiary">
            {isCn ? (
              <>
                底稿 · 上次
                {exercise.prefillFrom ? ` ${formatPrefillDate(exercise.prefillFrom, true)}` : ''}
                {draftFromOtherGym ? ` · ${exercise.prefillGym}` : ''}
                {' —— '}
                {draftFromOtherGym && <span className="text-secondary">刻度可能不同；</span>}
                <span className="text-accent font-medium">点组号照抄</span>
                ；改哪格，记哪格；没描的不入册
              </>
            ) : (
              <>
                Draft{exercise.prefillFrom ? ` · last ${formatPrefillDate(exercise.prefillFrom, false)}` : ''}
                {draftFromOtherGym ? ` · ${exercise.prefillGym}` : ''}
                {' — '}
                {draftFromOtherGym && <span className="text-secondary">different gym; </span>}
                <span className="text-accent font-medium">tap # to copy</span>
                ; edits confirm; untouched drafts are dropped
              </>
            )}
          </div>
        )}

        {/* 眉批：负重/辅助与动作时间。虚线下划线＝可点的批注，
            ::before 补 44px 热区而不撑大视觉尺寸。 */}
        {(loadMode !== 'none' || exercise.exerciseTime) && (
          <div className="flex items-center gap-4 mt-1.5">
            {loadMode !== 'none' && (
              <button
                type="button"
                onClick={() => onOpenMetricModal(exerciseName)}
                className="marginalia text-label font-medium text-accent"
              >
                {loadMode === 'weighted'
                  ? isCn ? '负重 +' : 'Weighted +'
                  : isCn ? '辅助 −' : 'Assisted −'}
              </button>
            )}
            {exercise.exerciseTime && (
              <button
                type="button"
                onClick={() => handleDurationClick(0)}
                className="marginalia font-mono text-label text-secondary tabular-nums"
              >
                {formatExerciseTime(exercise.exerciseTime, isCn ? 'cn' : 'en').time}
              </button>
            )}
          </div>
        )}
      </div>

      {hasNote && (
        <button
          type="button"
          onClick={() => onToggleNote(exerciseName)}
          className="w-full text-left px-3 py-2 bg-highlight-soft text-label text-primary flex items-start gap-2"
        >
          <StickyNote size={13} className="mt-0.5 flex-shrink-0 text-warning" strokeWidth={1.75} />
          {exerciseNotes[exerciseName]}
        </button>
      )}

      {/* ── 表头：只留列名，单位已内嵌到每行数值右下角（10px 副行已删） ── */}
      <div
        className="grid items-center px-3 pt-2.5 pb-1 text-micro font-medium text-tertiary"
        style={{ gridTemplateColumns: cols }}
      >
        <span>#</span>
        {activeMetrics.map(m => (
          <span key={m} className="text-center">
            {translations[m as keyof typeof translations]?.[lang] || m.replace('custom_', '')}
          </span>
        ))}
        {/* 力竭列的表头。给它一个列名而不是留空——这一列是全行唯一
            没有数字、也没有图标语义的控件，不写字就没人知道那个「竭」能点。 */}
        <span className="text-center">{isCn ? '竭' : 'F'}</span>
        <span />
      </div>

      {/* ── 组区：稿纸横纹 ── */}
      <div className="ledger-paper">
        {exercise.sets.map((set, setIdx) => (
          <SetCapsule
            key={set.id}
            set={set}
            setIdx={setIdx}
            activeMetrics={activeMetrics}
            loadMode={loadMode}
            isNew={newSetIds.has(String(set.id))}
            unit={unit}
            lang={lang}
            onUpdate={updates => onSetUpdate(exIdx, setIdx, updates)}
            onRemove={() => onRemoveSet(exIdx, setIdx)}
            onDurationClick={() => handleDurationClick(setIdx)}
          />
        ))}
      </div>

      {/* ── 页脚：只剩一个通栏虚线按钮 ── */}
      <div className="p-3 pt-2">
        <button
          type="button"
          onClick={() => {
            haptic(H.tap);
            onAddSet(exIdx);
          }}
          className="w-full min-h-[44px] border border-dashed border-divider rounded-control text-secondary font-medium flex items-center justify-center gap-2 transition-colors duration-tap ease-paper active:bg-card-hover"
        >
          <Plus size={16} strokeWidth={1.75} /> {isCn ? '添加组' : 'Add Set'}
        </button>
      </div>
    </div>
  );
};

export default ExerciseCard;
