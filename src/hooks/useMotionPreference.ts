/**
 * 应用内动效三态开关 —— 规格 §5.6
 *
 * 为什么不能只靠系统的 prefers-reduced-motion：
 * Android 的 prefers-reduced-motion 映射自「设置 → 无障碍 → 移除动画」，
 * 但**开发者选项里的「动画程序时长缩放 = 关闭」也会触发它**，
 * 而很多人为了「让手机更快」关掉了那个——那会静默关掉全站动效。
 * 且部分 OEM 皮肤有自己的开关，不写这个值。
 *
 * 所以必须能反向覆盖系统：'off' 这一档是「我就是要动效」。
 * CSS 侧由 :root[data-reduced-motion="0"] 承接（属性选择器权重 (0,2,0)
 * 压得过媒体查询里的 :root (0,1,0)），见 index.css。
 */
import { useCallback, useEffect, useState } from 'react';

/** auto = 跟随系统；on = 强制减弱；off = 强制保留动效 */
export type MotionPreference = 'auto' | 'on' | 'off';

const KEY = 'fitlog_reduced_motion';

function read(): MotionPreference {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'on' || v === 'off' ? v : 'auto';
  } catch {
    return 'auto';
  }
}

function apply(pref: MotionPreference) {
  const root = document.documentElement;
  if (pref === 'auto') root.removeAttribute('data-reduced-motion');
  else root.setAttribute('data-reduced-motion', pref === 'on' ? '1' : '0');
}

export function useMotionPreference() {
  const [preference, setPreferenceState] = useState<MotionPreference>(read);

  useEffect(() => {
    apply(preference);
  }, [preference]);

  const setPreference = useCallback((next: MotionPreference) => {
    setPreferenceState(next);
    try {
      localStorage.setItem(KEY, next);
    } catch {
      /* 写不进去也不影响本次会话 */
    }
  }, []);

  return { preference, setPreference };
}

/** 首屏尽早贴上属性，避免第一帧用错档位 */
export function initMotionPreference() {
  apply(read());
}
