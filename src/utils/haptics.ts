/**
 * 触觉反馈 —— 规格 §5.7
 *
 * 为什么用 navigator.vibrate 而不是 @capacitor/haptics：
 * 纯 Android 自用 App 下前者延迟更低（不走 bridge，插件约 5–20ms）、零依赖，
 * 且 VIBRATE 是 normal permission，安装即授予，Manifest 里已有。
 *
 * ⚠️ 不要设计依赖「用户能分辨轻/中/重」的触觉语言：
 * Android 绝大多数机器只有一颗马达，振幅控制要 hasAmplitudeControl()，
 * 很多中低端机返回 false —— 此时 Light/Medium/Heavy 手感完全一致。
 * 所以这里只按两档设计：一下「点击感」、一下「确认感」，靠时长区分。
 */

const KEY = 'fitlog_haptics';

/** 时长表。数组形式是 [静, 振, 静, 振…] 的节奏模式。 */
export const H = {
  tap: 8, // 点击感
  pick: 12, // 选中
  longpress: 14, // 长按达成
  threshold: 6, // 越过阈值（弹层投影判定等）
  seal: [0, 18, 40, 12], // 盖章：一记实 + 一记轻的余韵
  error: [20, 60, 20],
} as const;

/**
 * 全局开关。安静的健身房里会自己嗡嗡的 App 很讨人嫌（§5.7 第 5 条）。
 * 读一次缓存在模块作用域，避免每次振动都打一发 localStorage。
 */
let enabled: boolean | null = null;

export function hapticsEnabled(): boolean {
  if (enabled === null) {
    try {
      enabled = localStorage.getItem(KEY) !== '0';
    } catch {
      enabled = true;
    }
  }
  return enabled;
}

export function setHapticsEnabled(on: boolean): void {
  enabled = on;
  try {
    localStorage.setItem(KEY, on ? '1' : '0');
  } catch {
    /* 隐私模式等场景写不进去，内存里的开关仍然生效 */
  }
}

/**
 * 去抖窗口。§5.7 第 3 条：绝不在 rAF / 滚动回调里调，去抖 ≥50–60ms。
 * 连续输入（比如按住 +1 连点）不该变成持续嗡鸣。
 */
let lastAt = 0;
const DEBOUNCE_MS = 55;

/**
 * 触发一次触觉。
 *
 * §5.7 时间对齐：
 *   1. 先发震动再启动画 —— 马达机械启动延迟（ERM 约 10–30ms）天然落后。
 *   2. 脉冲锚在语义时刻（状态提交那一帧），不是动画起点，更不是 transitionend。
 *   4. 必须在用户手势的同一个任务里调，否则被浏览器静默丢弃。
 */
export function haptic(pattern: number | readonly number[]): void {
  if (!hapticsEnabled()) return;
  const now = performance.now();
  if (now - lastAt < DEBOUNCE_MS) return;
  lastAt = now;
  try {
    navigator.vibrate?.(pattern as number | number[]);
  } catch {
    /* 不支持 vibrate 的环境（桌面浏览器）直接忽略 */
  }
}
