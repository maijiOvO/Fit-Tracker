/**
 * 首选项弹层的积木（demo 是 docs/demos/prefs-sheet.html，2026-10-26 用户拍板第二版结构）。
 *
 * 卡里只有一种行：名称在左，控件在右（Line / Go / Toggle）；控件放不下（带图标的三档、4 档数字、多选）才落到名称下面整宽（Stack）。
 * 行与行之间用分隔线（Group 里的 divide-y），不再混用间距和分隔线。
 * 层级：组标题 12px 600 灰在卡外；行名 14px 500；值和副文字 12px 三级灰。
 */
import React from 'react';
import { ChevronRight } from 'lucide-react';

export type Opt<T> = { v: T; label: React.ReactNode; icon?: React.ReactNode; aria?: string };

/** 分段块：单选传 value，多选传 values；inline＝放在行右侧的紧凑版 */
export function Seg<T extends string | number>({
  opts,
  value,
  values,
  onPick,
  num,
  inline,
  testId,
}: {
  opts: Opt<T>[];
  value?: T;
  values?: T[];
  onPick: (v: T) => void;
  /** 数字 / 单位：窄体数字族 */
  num?: boolean;
  inline?: boolean;
  testId?: string;
}) {
  return (
    <div
      className={`gap-0.5 p-[3px] bg-inset rounded-control ${inline ? 'inline-grid grid-flow-col auto-cols-[minmax(44px,auto)] flex-shrink-0' : 'grid'}`}
      style={inline ? undefined : { gridTemplateColumns: `repeat(${opts.length}, minmax(0, 1fr))` }}
      data-testid={testId}
    >
      {opts.map(o => {
        const on = values ? values.includes(o.v) : value === o.v;
        return (
          <button
            key={String(o.v)}
            type="button"
            aria-pressed={on}
            aria-label={o.aria}
            onClick={() => onPick(o.v)}
            className={`rounded-chip flex flex-col items-center justify-center gap-1 transition-colors duration-tap ease-paper ${
              inline ? 'min-h-[30px] px-3 py-1' : o.icon ? 'min-h-[52px] py-1.5' : 'min-h-[34px] py-1.5'
            } ${num ? 'font-mono text-body font-semibold tabular-nums' : 'text-label font-medium'} ${
              on ? 'seg-on' : 'text-secondary hover:text-primary'
            }`}
          >
            {o.icon}
            <span>{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/** 名称 + 可选副文字 */
export const Name: React.FC<{ name: React.ReactNode; sub?: React.ReactNode; bad?: boolean; tone?: 'danger' | 'accent' }> = ({ name, sub, bad, tone }) => (
  <span className="min-w-0 flex flex-col gap-0.5 text-left">
    <span className={`text-small font-medium ${tone === 'danger' ? 'text-danger' : tone === 'accent' ? 'text-accent' : 'text-primary'}`}>{name}</span>
    {sub && <span className={`text-label font-normal ${bad ? 'text-danger' : 'text-tertiary'}`}>{sub}</span>}
  </span>
);

const ROW = 'w-full min-h-[52px] py-2.5 flex justify-between items-center gap-3';
// 按下的底色铺满卡片左右内边距（卡 px-4）
const PRESS = 'transition-colors duration-tap ease-paper active:bg-card-hover -mx-4 px-4 w-[calc(100%+2rem)]';

/** 名称 … 控件 */
export const Line: React.FC<{ name: React.ReactNode; children: React.ReactNode }> = ({ name, children }) => (
  <div className={ROW}>
    <Name name={name} />
    {children}
  </div>
);

/** 名称在上，整宽控件在下 */
export const Stack: React.FC<{ name: React.ReactNode; children: React.ReactNode; testId?: string }> = ({ name, children, testId }) => (
  <div className="py-3 pb-3.5 flex flex-col gap-2.5" data-testid={testId}>
    {typeof name === 'string' ? <Name name={name} /> : name}
    {children}
  </div>
);

/** 点了做事 / 跳二级页的行：名称 … 值 › */
export const Go: React.FC<{
  name: React.ReactNode;
  sub?: React.ReactNode;
  bad?: boolean;
  value?: React.ReactNode;
  tone?: 'danger' | 'accent';
  chevron?: boolean;
  onClick?: () => void;
  disabled?: boolean;
  testId?: string;
}> = ({ name, sub, bad, value, tone, chevron = true, onClick, disabled, testId }) => (
  <button type="button" onClick={onClick} disabled={disabled} data-testid={testId} className={`${ROW} ${PRESS} disabled:opacity-50`}>
    <Name name={name} sub={sub} bad={bad} tone={tone} />
    {(value || chevron) && (
      <span className="flex-shrink-0 flex items-center gap-1.5 text-label font-medium text-tertiary whitespace-nowrap">
        {value}
        {chevron && <ChevronRight size={16} strokeWidth={2} className="text-tertiary" />}
      </span>
    )}
  </button>
);

/** 开关行 */
export const Toggle: React.FC<{ name: React.ReactNode; on: boolean; onChange: (on: boolean) => void; testId?: string }> = ({ name, on, onChange, testId }) => (
  <button type="button" role="switch" aria-checked={on} onClick={() => onChange(!on)} data-testid={testId} className={`${ROW} ${PRESS}`}>
    <Name name={name} />
    <span
      className={`relative flex-shrink-0 w-11 h-[26px] rounded-full transition-colors duration-tap ease-paper ${on ? 'bg-accent' : 'bg-inset ring-1 ring-inset ring-divider'}`}
      aria-hidden
    >
      <span
        className={`absolute top-[3px] left-[3px] w-5 h-5 rounded-full shadow-sm transition-transform duration-base ease-paper ${on ? 'translate-x-[18px] bg-white' : 'bg-[var(--seg-pill)]'}`}
      />
    </span>
  </button>
);

/** 组：标题在卡外（可省），卡里一行一条分隔线 */
export const Group: React.FC<{ title?: string; children: React.ReactNode; testId?: string }> = ({ title, children, testId }) => (
  <section className="space-y-2" data-testid={testId}>
    {title && <h3 className="px-1 text-label font-semibold text-secondary">{title}</h3>}
    <div className="ui-card px-4 divide-y divide-divider overflow-hidden">{children}</div>
  </section>
);

/** 全页唯一的实心主按钮 */
export const Primary: React.FC<{ children: React.ReactNode; onClick: () => void; wide?: boolean; testId?: string }> = ({ children, onClick, wide, testId }) => (
  <button
    type="button"
    onClick={onClick}
    data-testid={testId}
    className={`ui-btn-primary flex-shrink-0 text-small flex items-center justify-center gap-1.5 active:scale-press-sm ${wide ? 'w-full py-3' : 'px-3.5 py-2'}`}
  >
    {children}
  </button>
);
