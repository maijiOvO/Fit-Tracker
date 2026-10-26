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
import { MoreHorizontal } from 'lucide-react';
import { Language } from '../../types';
import { translations } from '../../translations';

export type BodyPartKey = 'chest' | 'shoulders' | 'back' | 'legs' | 'arms' | 'other';

/**
 * 印文。取的是各自标签里【区别性的那个字】：
 * 练胸→胸、练肩→肩、练背→背、练腿→腿、练手臂→臂。
 *
 * 「其他」不刻字，画「⋯」图标（lucide MoreHorizontal，不依赖字体子集）：原来刻的是「制」（自制／自定），用户反馈别人看不懂是干什么的（2026-10-22）。
 * 虚线框 +「⋯」在中英文里都读作「更多 / 其他」，不用再借一个字。
 *
 * 2026-10-22 起印面是正文粗体（Noto Sans SC 700），马善政书法字退役（「杠铃片」阶段二），
 * 不再有「字必须进印章子集」的限制。
 */
const PARTS: {
  key: BodyPartKey;
  seal: string;
  /** 英文印面。取标签首字母，六枚 C S B L A O 互不相同。 */
  latin: string;
  tk: keyof typeof translations;
  /** 动作弹层里对应的部位标签（constants/exercises 的 BODY_PARTS）。选完部位，弹层直接停在这一栏。 */
  bodyPart: string;
}[] = [
  { key: 'chest', seal: '胸', latin: 'C', tk: 'partChest', bodyPart: 'subChest' },
  { key: 'shoulders', seal: '肩', latin: 'S', tk: 'partShoulders', bodyPart: 'subShoulder' },
  { key: 'back', seal: '背', latin: 'B', tk: 'partBack', bodyPart: 'subBack' },
  { key: 'legs', seal: '腿', latin: 'L', tk: 'partLegs', bodyPart: 'subLegs' },
  { key: 'arms', seal: '臂', latin: 'A', tk: 'partArms', bodyPart: 'subArms' },
];

/** 部位印 → 动作弹层的部位标签。「其他」没有对应栏，返回 null（弹层保持上次的筛选）。 */
export function bodyPartTagFor(key: BodyPartKey): string | null {
  return PARTS.find(p => p.key === key)?.bodyPart ?? null;
}

/** 部位标签（弹层里的 subChest 这种）→ 「练胸」这样的训练名；自建部位没有 */
export function partTitleFor(bodyPart: string, lang: Language): string | null {
  const p = PARTS.find(x => x.bodyPart === bodyPart);
  return p ? (translations[p.tk][lang] as string) : null;
}

/** 训练名是不是「今天练哪里」自动填的那几个（没手动改过 → 弹层里换部位可以跟着改） */
export function isPartTitle(title: string, lang: Language): boolean {
  return PARTS.some(p => translations[p.tk][lang] === title);
}

/** FAB 印谱扇开（§12.4）用的完整六枚：五部位 + 「⋯」（其他）。顺序=印谱阅读序，位置固定不按频率排。 */
export const FAN_PARTS: {
  key: BodyPartKey;
  seal: string;
  latin: string;
  tk: keyof typeof translations;
  bodyPart?: string;
  dashed?: boolean;
}[] = [
  ...PARTS,
  { key: 'other', seal: '⋯', latin: '⋯', tk: 'partOther', dashed: true },
];

/**
 * 部位印。虚线框＝「其他」，印面是「⋯」。
 *
 * 2026-10-22（「杠铃片」阶段二）：从马善政书法朱文印改成正文粗体方印 ——
 * 黑框黑字、Noto Sans SC 700，和「杠铃片」几何、器物的语言一致，也少打包一张字体。
 * 中文印面 22px，英文首字母大一档 26px（拉丁大写比汉字窄，同字号在方框里显空）。
 * 历史：书法版与英文衬线版的对比见 docs/demos/seal-latin.html，方向对比见 docs/demos/phase2-directions.html。
 */
const Seal: React.FC<{ char: string; latin: string; isCn: boolean; dashed?: boolean }> = ({
  char,
  latin,
  isCn,
  dashed,
}) => (
  <span
    aria-hidden
    className={`w-[52px] h-[52px] rounded-stamp border-2 ${
      dashed ? 'border-dashed border-tertiary text-secondary' : 'border-primary text-primary'
    } font-bold leading-none flex items-center justify-center select-none ${isCn ? 'text-xl' : 'text-2xl'}`}
  >
    {dashed ? <MoreHorizontal size={26} strokeWidth={2.5} /> : isCn ? char : latin}
  </span>
);

export interface BodyPartPickerProps {
  lang: Language;
  /** 选中某个部位：把 label 当作训练名称填进去；bodyPart 给动作弹层定位到该部位 */
  onPick: (title: string, bodyPart: string) => void;
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
      <h2 className="mb-5 font-display font-semibold text-lg text-primary text-center">
        {translations.pickBodyPartTitle[lang]}
      </h2>

      {/* 三列两行＝一页印谱。印比人形矮得多，六枚正好铺成一版。 */}
      <div className="grid grid-cols-3 gap-2.5">
        {PARTS.map(({ key, seal, latin, tk, bodyPart }, i) => {
          const label = translations[tk][lang] as string;
          return (
            <button
              key={key}
              type="button"
              onClick={() => onPick(label, bodyPart)}
              data-testid={`body-part-${key}`}
              /* §5.3 列表 stagger：delay = min(i,6) × 32ms，封顶第 7 项 */
              style={{ animationDelay: `${Math.min(i, 6) * 32}ms` }}
              className={`${TILE} text-primary hover:border-accent`}
            >
              <Seal char={seal} latin={latin} isCn={isCn} />
              <span className="text-small font-semibold">{label}</span>
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
          <Seal char="⋯" latin="⋯" isCn={isCn} dashed />
          <span className="text-small font-semibold">{translations.partOther[lang]}</span>
        </button>
      </div>
    </section>
  );
};
