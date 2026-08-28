/**
 * 训练部位选择 —— 进入训练页、还没有任何动作时的第一步。
 *
 * 选完即自动填入训练名称并打开动作弹层，此后本界面不再出现
 * （见 NewWorkoutTab 的 partChosenFor）。
 * 「其他」不填名、也不开弹层：那条路的下一步是把名字打出来，
 * 弹层盖上去反而挡住标题输入框。
 *
 * ── 为什么是印，不是图标 ──────────────────────────────
 *
 * 先做过解剖人形（真实肌群高亮，react-native-body-highlighter 的路径）。
 * 那版专业、准确，但在 60px 下人形只是一层灰底噪，朱砂块浮在上面，
 * 读起来是「一张医学示意图」而不是这个 App 自己的东西。
 * 印章是这套语言里已经存在的符号，用它说话不需要翻译。
 * （人形那版在 git 里，commit 00da68a。）
 *
 * ── 和 PR 那枚印章怎么区分 ────────────────────────────
 *
 * 印章原本是「签名时刻」的专属符号，让它出现第二处就有稀释的风险。
 * 靠刻法分开 —— 这是刻印里真实存在的阴刻／阳刻之别：
 *
 *   PR 落章：白文（实心朱砂底、字挖成纸色）、64×64、旋转 -4°、带落章过冲、极罕见
 *   部位印：朱文（纸底、朱砂框、朱砂字）、52×52、正置、静止、每次开练都有
 *
 * 形制不同、姿态不同、频率不同，两者不会互相顶。
 */
import React from 'react';
import { Language } from '../../types';
import { translations } from '../../translations';

export type BodyPartKey = 'chest' | 'shoulders' | 'back' | 'legs' | 'arms' | 'other';

/**
 * 印文。取的是各自标签里【区别性的那个字】：
 * 练胸→胸、练肩→肩、练背→背、练腿→腿、练手臂→臂、其他→他。
 * 规则一致，所以不用逐个解释。
 *
 * ⚠️ 这几个字必须在 scripts/build-fonts.mjs 的 SEAL_CHARS 里，
 *    否则 Ma Shan Zheng 的子集里没有它们，会静默掉回系统字体。
 */
const PARTS: { key: BodyPartKey; seal: string; tk: keyof typeof translations }[] = [
  { key: 'chest', seal: '胸', tk: 'partChest' },
  { key: 'shoulders', seal: '肩', tk: 'partShoulders' },
  { key: 'back', seal: '背', tk: 'partBack' },
  { key: 'legs', seal: '腿', tk: 'partLegs' },
  { key: 'arms', seal: '臂', tk: 'partArms' },
];

/**
 * 朱文印。虚线框＝这一枚还没刻，等你自己题名（「其他」用）。
 *
 * leading-none + 2px padding-top：Ma Shan Zheng 的字面在 em 框里偏上，
 * 纯 flex 居中会看着往上飘。2 是量出来的 —— 真机实测框内上下留白
 * 3px 上 / 3.2px 下，基本对称；3px 时是 4.9 / 2.3，方印上这点偏斜看得出来。
 */
const Seal: React.FC<{ char: string; dashed?: boolean }> = ({ char, dashed }) => (
  <span
    aria-hidden
    className={`w-[52px] h-[52px] rounded-stamp border-[2.5px] ${
      dashed ? 'border-dashed' : ''
    } border-accent text-accent font-seal text-[30px] leading-none
       flex items-center justify-center pt-[1px] select-none`}
  >
    {char}
  </span>
);

export interface BodyPartPickerProps {
  lang: Language;
  /** 选中某个部位：把 label 当作训练名称填进去 */
  onPick: (title: string) => void;
  /** 选「其他」：不填名，交给顶部标题输入框 */
  onPickOther: () => void;
}

const TILE =
  'anim-reveal min-h-[112px] rounded-card border border-divider bg-base ' +
  'flex flex-col items-center justify-center gap-2.5 active:scale-press transition-ui';

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

      {/* 三列两行＝一页印谱。印比人形矮得多，六枚正好铺成一版。 */}
      <div className="grid grid-cols-3 gap-2.5">
        {PARTS.map(({ key, seal, tk }, i) => {
          const label = translations[tk][lang] as string;
          return (
            <button
              key={key}
              type="button"
              onClick={() => onPick(label)}
              data-testid={`body-part-${key}`}
              /* §5.3 列表 stagger：delay = min(i,6) × 32ms，封顶第 7 项 */
              style={{ animationDelay: `${Math.min(i, 6) * 32}ms` }}
              className={`${TILE} text-primary hover:border-accent`}
            >
              <Seal char={seal} />
              <span className="text-[13px] font-semibold">{label}</span>
            </button>
          );
        })}

        <button
          type="button"
          onClick={onPickOther}
          data-testid="body-part-other"
          style={{ animationDelay: `${5 * 32}ms` }}
          className={`${TILE} text-secondary hover:border-accent hover:text-accent`}
        >
          <Seal char="他" dashed />
          <span className="text-[13px] font-semibold">{translations.partOther[lang]}</span>
        </button>
      </div>

      {/* 三列下的格子太窄，塞不下两行文案，所以「其他」的说明挪到版心底下。
          写明是给哪一枚的，否则会被读成整页的通用说明。 */}
      <p className="mt-4 text-center text-[11px] text-tertiary">
        {isCn ? '「其他」——' : '"Other" — '}
        {translations.partOtherHint[lang]}
      </p>
    </section>
  );
};

export default BodyPartPicker;
