/**
 * 横拖改数的手感（首选项「滑动手感」，审查 2026-10-06 第一节第 3 点）：细 / 中 / 粗 ＝ 每档 14 / 10 / 7 px，
 * 速度阈值梯按同比例缩放（每档越宽，跳档要甩得越快）。起拖阈值 12 px 不跟着变。
 *
 * 跟设备走（同振动、撤销开关），不进同步：屏幕密度和手指是这台手机自己的事。
 */
export type ScrubFeel = 'fine' | 'mid' | 'coarse';

export const SCRUB_FEEL_PX: Record<ScrubFeel, number> = { fine: 14, mid: 10, coarse: 7 };

const KEY = 'fitlog_scrub_feel';
let cached: ScrubFeel | null = null;

export function scrubFeel(): ScrubFeel {
  if (cached === null) {
    try {
      const v = localStorage.getItem(KEY);
      cached = v === 'fine' || v === 'coarse' ? v : 'mid';
    } catch {
      cached = 'mid';
    }
  }
  return cached;
}

export function setScrubFeel(v: ScrubFeel): void {
  cached = v;
  try {
    localStorage.setItem(KEY, v);
  } catch {
    /* 写不进去时内存里的值仍然生效 */
  }
}
