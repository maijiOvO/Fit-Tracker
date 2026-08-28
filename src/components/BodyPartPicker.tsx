/**
 * 训练部位选择 —— 进入训练页、还没有任何动作时的第一步。
 *
 * 选完即自动填入训练名称，此后本界面不再出现（见 NewWorkoutTab 的 partChosenFor）。
 * 「其他」不填名，只把焦点交给顶部标题输入框，保持原来的手写流程。
 *
 * 图标用【同一个人形轮廓 + 朱砂高亮目标部位】，不是五个各画各的部位图：
 *  - 小尺寸下「孤立的胸肌」和「孤立的背肌」几乎无法区分，放进人形里立刻就清楚了
 *  - 一套轮廓五种高亮，风格天然统一，符合 §6.5 自绘版画的路线
 *  - 胸与背的轮廓相同，靠脊柱线区分正面／背面（健身语境里的通用约定）
 */
import React from 'react';
import { Pencil } from 'lucide-react';
import { Language } from '../../types';
import { translations } from '../../translations';

export type BodyPartKey = 'chest' | 'shoulders' | 'back' | 'legs' | 'arms' | 'other';

/** 墨线：底图。§6.5 的 1.75px 墨线在 44×56 视框下按比例收到 1.5。 */
const BASE = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

/** 朱砂：高亮。比底图粗一档，读得出「就是这块」。 */
const MARK: React.CSSProperties = {
  fill: 'none',
  stroke: 'var(--accent)',
  strokeWidth: 2.4,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
};

const BodyGlyph: React.FC<{ part: Exclude<BodyPartKey, 'other'> }> = ({ part }) => (
  <svg viewBox="0 0 44 56" width="40" height="51" aria-hidden focusable="false">
    {/* ── 底图：始终整个人 ───────────────────────── */}
    <g {...BASE} opacity={0.26}>
      <circle cx="22" cy="7" r="4.6" />
      <path d="M13 14.5 L31 14.5 L28.6 33 L15.4 33 Z" />
      <path d="M12.6 16 L9 27.5 L7.2 38" />
      <path d="M31.4 16 L35 27.5 L36.8 38" />
      <path d="M18.2 33 L16.4 52" />
      <path d="M25.8 33 L27.6 52" />
    </g>

    {/* ── 朱砂：只标目标部位 ─────────────────────── */}
    {part === 'chest' && (
      <g style={MARK}>
        <path d="M14.6 17.5 Q22 22.4 29.4 17.5" />
        <path d="M14.9 22.6 Q22 27.2 29.1 22.6" />
      </g>
    )}

    {part === 'shoulders' && (
      <g style={MARK}>
        <path d="M12.4 16.4 A4.6 4.6 0 0 1 17.8 13.6" />
        <path d="M31.6 16.4 A4.6 4.6 0 0 0 26.2 13.6" />
      </g>
    )}

    {part === 'back' && (
      <g style={MARK}>
        {/* 脊柱线＝这是背面。没有它，背和胸的轮廓完全一样。 */}
        <path d="M22 15.6 L22 31.4" strokeWidth={1.6} />
        {/* 背阔：从腋下向外张、往腰收的翼形。
            早先画成两条斜线交于中心，整体读起来是个「Y」，不像背。 */}
        <path d="M14.2 17 Q13 23.6 17.6 29.2" />
        <path d="M29.8 17 Q31 23.6 26.4 29.2" />
      </g>
    )}

    {part === 'legs' && (
      <g style={MARK}>
        <path d="M18.2 33.5 L16.4 51.6" />
        <path d="M25.8 33.5 L27.6 51.6" />
      </g>
    )}

    {part === 'arms' && (
      <g style={MARK}>
        <path d="M12.6 16.4 L9 27.4" />
        <path d="M31.4 16.4 L35 27.4" />
        {/* 二头肌隆起，把「手臂」和「肩」区分开 */}
        <path d="M12.2 19.4 Q9.4 21.6 10.4 24.4" strokeWidth={1.8} />
        <path d="M31.8 19.4 Q34.6 21.6 33.6 24.4" strokeWidth={1.8} />
      </g>
    )}
  </svg>
);

const PARTS: { key: Exclude<BodyPartKey, 'other'>; tk: keyof typeof translations }[] = [
  { key: 'chest', tk: 'partChest' },
  { key: 'shoulders', tk: 'partShoulders' },
  { key: 'back', tk: 'partBack' },
  { key: 'legs', tk: 'partLegs' },
  { key: 'arms', tk: 'partArms' },
];

export interface BodyPartPickerProps {
  lang: Language;
  /** 选中某个部位：把 label 当作训练名称填进去 */
  onPick: (title: string) => void;
  /** 选「其他」：不填名，交给顶部标题输入框 */
  onPickOther: () => void;
}

export const BodyPartPicker: React.FC<BodyPartPickerProps> = ({ lang, onPick, onPickOther }) => {
  const isCn = lang === Language.CN;

  return (
    <section className="bg-card border border-divider rounded-card p-5">
      <h2 className="font-display font-semibold text-[17px] text-primary text-center">
        {translations.pickBodyPartTitle[lang]}
      </h2>
      <p className="mt-1 mb-5 text-center text-xs text-tertiary">
        {isCn ? '选完自动作为训练名称，之后仍可改' : 'Becomes the session title; editable later'}
      </p>

      <div className="grid grid-cols-2 gap-3">
        {PARTS.map(({ key, tk }, i) => {
          const label = translations[tk][lang] as string;
          return (
            <button
              key={key}
              type="button"
              onClick={() => onPick(label)}
              data-testid={`body-part-${key}`}
              /* §5.3 列表 stagger：delay = min(i,6) × 32ms，封顶第 7 项 */
              style={{ animationDelay: `${Math.min(i, 6) * 32}ms` }}
              className="anim-reveal min-h-[104px] rounded-card border border-divider bg-base
                         flex flex-col items-center justify-center gap-2 text-primary
                         hover:border-accent active:scale-press transition-ui"
            >
              <BodyGlyph part={key} />
              <span className="text-sm font-semibold">{label}</span>
            </button>
          );
        })}

        <button
          type="button"
          onClick={onPickOther}
          data-testid="body-part-other"
          style={{ animationDelay: `${5 * 32}ms` }}
          className="anim-reveal min-h-[104px] rounded-card border border-dashed border-rule
                     bg-base flex flex-col items-center justify-center gap-2 text-secondary
                     hover:border-accent hover:text-accent active:scale-press transition-ui"
        >
          <Pencil size={22} strokeWidth={1.75} />
          <span className="text-sm font-semibold">{translations.partOther[lang]}</span>
          <span className="text-[11px] text-tertiary">{translations.partOtherHint[lang]}</span>
        </button>
      </div>
    </section>
  );
};

export default BodyPartPicker;
