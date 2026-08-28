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
 * 练胸→胸、练肩→肩、练背→背、练腿→腿、练手臂→臂。
 *
 * 「其他」取【制】（自制／自定）。原本用「他」，但那是代词，刻进印里很怪。
 * 想用的其实是「擬」（自拟其题，草案意味正好呼应虚线印框），但用不了 ——
 * ⚠️ Ma Shan Zheng 只有 7015 字，是【纯简体字库】：
 *    擬 設 別 創 約 號 題 一概没有，只有对应的简化字。
 *    强行用会掉回系统黑体，正是本文件下面警告的那个坑。
 * 制 的好处是繁简同形，和 胸肩背腿臂 一样没有简化字的时代感，
 * 整版印谱在字形上是一致的。
 *
 * ⚠️ 这几个字必须在 scripts/build-fonts.mjs 的 SEAL_CHARS 里，
 *    否则 Ma Shan Zheng 的子集里没有它们，会静默掉回系统字体。
 */
export const PARTS: {
  key: BodyPartKey;
  seal: string;
  /** 英文印面。取标签首字母，六枚 C S B L A O 互不相同。 */
  latin: string;
  tk: keyof typeof translations;
}[] = [
  { key: 'chest', seal: '胸', latin: 'C', tk: 'partChest' },
  { key: 'shoulders', seal: '肩', latin: 'S', tk: 'partShoulders' },
  { key: 'back', seal: '背', latin: 'B', tk: 'partBack' },
  { key: 'legs', seal: '腿', latin: 'L', tk: 'partLegs' },
  { key: 'arms', seal: '臂', latin: 'A', tk: 'partArms' },
];

/** FAB 印谱扇开（§12.4）用的完整六枚：五部位 + 「制」。顺序=印谱阅读序，位置固定不按频率排。 */
export const FAN_PARTS: {
  key: BodyPartKey;
  seal: string;
  latin: string;
  tk: keyof typeof translations;
  dashed?: boolean;
}[] = [
  ...PARTS,
  { key: 'other', seal: '制', latin: 'O', tk: 'partOther', dashed: true },
];

/**
 * 朱文印。虚线框＝这一枚还没刻，等你自己题名（「其他」用）。
 *
 * ── 两种刻法 ──────────────────────────────────────────
 *
 * 中文：汉字 + Ma Shan Zheng 30px。
 * 英文：标签首字母 + 衬线 700 36px（刊头同族）。
 *
 * 英文没有沿用 Ma Shan Zheng —— 它有全套拉丁字形（cmap 查过），但那不是它的主场：
 * 52px 方框内宽 47px，实测「胸」占 30.0×29，同尺下的手写体 C 只有 13.1 宽，
 * 不到方框的三成，印面明显显空，46px 扇开时更弱。
 * 换成衬线 700 后 C 占 26 宽，密度回到汉字量级；而且方框＋首字母在拉丁世界里
 * 本来就是藏书票／活字首字的语汇，不必借道汉字才成立。
 * 可玩的对比 demo：docs/demos/seal-latin.html。
 *
 * leading-none + padding-top：Ma Shan Zheng 的字面在 em 框里偏上，纯 flex 居中会往上飘，
 * 补 1px 压回来。衬线首字母反过来 —— 大写字母全在基线以上，本来就偏低，
 * 一点内边距都不能加：内高 48、墨高 29，pt-0 时上 10 / 下 9，加 2px 就变成上 12 / 下 7。
 */
const Seal: React.FC<{ char: string; latin: string; isCn: boolean; dashed?: boolean }> = ({
  char,
  latin,
  isCn,
  dashed,
}) => (
  <span
    aria-hidden
    className={`w-[52px] h-[52px] rounded-stamp border-[2.5px] ${
      dashed ? 'border-dashed' : ''
    } border-accent text-accent leading-none flex items-center justify-center select-none ${
      isCn ? 'font-seal text-[30px] pt-[1px]' : 'font-display font-bold text-[36px]'
    }`}
  >
    {isCn ? char : latin}
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
        {PARTS.map(({ key, seal, latin, tk }, i) => {
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
              <Seal char={seal} latin={latin} isCn={isCn} />
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
          <Seal char="制" latin="O" isCn={isCn} dashed />
          <span className="text-[13px] font-semibold">{translations.partOther[lang]}</span>
        </button>
      </div>

      {/* 三列下的格子太窄，塞不下两行文案，所以「其他」的说明挪到版心底下。
          写明是给哪一枚的，否则会被读成整页的通用说明。 */}
      <p className="mt-4 text-center text-[11px] text-tertiary">
        {isCn ? '「其他」——' : '"Other" — '}
        {translations.partOtherHint[lang]}
      </p>

      {/* §12.4 的自教学：手势是加速器，可见路径永远在——但得有人告诉你手势存在 */}
      <p className="mt-1.5 text-center text-[11px] text-tertiary">
        {isCn ? (
          <>
            小技巧：在任何页面<span className="text-secondary font-semibold">按住底栏加号</span>
            ，印谱会直接在拇指下摊开
          </>
        ) : (
          <>
            Tip: <span className="text-secondary font-semibold">hold the + button</span> on any
            tab to fan these out under your thumb
          </>
        )}
      </p>
    </section>
  );
};

export default BodyPartPicker;
