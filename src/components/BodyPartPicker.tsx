/**
 * 训练部位选择 —— 进入训练页、还没有任何动作时的第一步。
 *
 * 选完即自动填入训练名称并打开动作弹层，此后本界面不再出现
 * （见 NewWorkoutTab 的 partChosenFor）。
 * 「其他」不填名、也不开弹层：那条路的下一步是把名字打出来，
 * 弹层盖上去反而挡住标题输入框。
 *
 * 图标＝【人体轮廓 + 目标肌群高亮】，解剖路径取自 react-native-body-highlighter
 * （MIT，见 utils/bodyPaths.ts 的来源注释）。
 *
 * 为什么不自己画：手绘的五个部位在小尺寸下靠「几根示意线」区分，
 * 胸和背几乎只能靠一条脊柱线分辨，实测就是「能认出来」而不是「设计过」。
 * 真实解剖轮廓把这件事一次解决 —— 而且肌群位置本身就是最强的区分信号，
 * 不需要额外的隐喻。
 */
import React from 'react';
import { Pencil } from 'lucide-react';
import { Language } from '../../types';
import { translations } from '../../translations';
import { BODY_VIEWBOX, BODY_OUTLINE, BODY_GROUPS, type BodyGroupKey } from '../utils/bodyPaths';

export type BodyPartKey = BodyGroupKey | 'other';

/**
 * 人体图标。视框 724×1448，而实际渲染只有 60px 宽 —— 缩了 12 倍。
 *
 * 尺寸取 60 是量出来的：40px 时肌群只剩几像素的红点，轮廓反客为主
 * （高 DPR 只解决清晰度，不解决尺寸）；68px 最清楚但三行会顶到 638px，
 * 在 812px 的机器上要滚动。60 是「读得清」和「一屏放得下」的交点。
 *
 * ⚠️ 所以描边必须用 vectorEffect="non-scaling-stroke"：
 * 普通 stroke-width 会跟着一起缩，2 会变成 0.11px，屏幕上什么都看不见。
 * 用它之后 strokeWidth 直接就是 CSS 像素，1.75 正是 §6.5 的墨线宽度。
 */
const BodyGlyph: React.FC<{ part: BodyGroupKey }> = ({ part }) => {
  const { side, d } = BODY_GROUPS[part];
  return (
    <svg
      viewBox={BODY_VIEWBOX[side]}
      width="60"
      height="120"
      aria-hidden
      focusable="false"
      className="text-primary"
    >
      <path
        d={BODY_OUTLINE[side]}
        fill="none"
        stroke="currentColor"
        strokeOpacity={0.22}
        strokeWidth={1.75}
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      {/* 肌群用朱砂实填而不是描边：这个尺寸下细线会糊成一团，
          实填的色块反而读得出「就是这块」，且像纸上盖下的一记印。

          ⚠️ 每条路径必须【各自成 path】，不能拼成一条复合路径 ——
          nonzero 填充规则下互相重叠的子路径会彼此抵消，
          实测「练背」只剩一道细边、「练胸」的色块跑到锁骨上去了。 */}
      {d.map((seg, i) => (
        <path key={i} d={seg} style={{ fill: 'var(--accent)' }} />
      ))}
    </svg>
  );
};

const PARTS: { key: BodyGroupKey; tk: keyof typeof translations }[] = [
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
              className="anim-reveal min-h-[168px] rounded-card border border-divider bg-base
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
          className="anim-reveal min-h-[168px] rounded-card border border-dashed border-rule
                     bg-base flex flex-col items-center justify-center gap-2 text-secondary
                     hover:border-accent hover:text-accent active:scale-press transition-ui"
        >
          <Pencil size={24} strokeWidth={1.75} />
          <span className="text-sm font-semibold">{translations.partOther[lang]}</span>
          <span className="text-[11px] text-tertiary">{translations.partOtherHint[lang]}</span>
        </button>
      </div>
    </section>
  );
};

export default BodyPartPicker;
