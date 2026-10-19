import { useCallback, useEffect, useState } from 'react';
import { storage } from '../../services/appStorage';
import { isDemo } from '../../services/appEnv';

export type ThemePreference = 'auto' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';
/** 强调色五套（docs/design-plates.md §1），贴在 <html data-accent>；深色底也跟着换 */
export type AccentPreference = 'teal' | 'rose' | 'violet' | 'orange' | 'sky';
const ACCENTS: readonly AccentPreference[] = ['teal', 'rose', 'violet', 'orange', 'sky'];

const STORAGE_KEY = 'theme-pref';
const ACCENT_KEY = 'accent-pref';
/** useTheme 有好几个实例（App / 设置页 / 图表），换强调色时广播给其它实例，图表才会重读颜色 */
const ACCENT_EVENT = 'fitlog:accent-change';

/** 状态栏 / 闪屏底色 = 各组合的 --bg-base，和 index.css 保持一致 */
const BASE_COLOR: Record<ResolvedTheme, Record<AccentPreference, string>> = {
  light: { teal: '#FFFFFF', rose: '#FFFFFF', violet: '#FFFFFF', orange: '#FFFFFF', sky: '#FFFFFF' },
  dark: { teal: '#0D1216', rose: '#0A0A0C', violet: '#0A0A0C', orange: '#0A0A0C', sky: '#0D1216' },
};

function getSystemDark(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function readPreference(): ThemePreference {
  const fallback = isDemo() ? 'light' : 'auto';
  if (typeof window === 'undefined') return fallback;
  const stored = storage.getItem(STORAGE_KEY);
  if (stored === 'light' || stored === 'dark' || stored === 'auto') return stored;
  return fallback;
}

function readAccent(): AccentPreference {
  if (typeof window === 'undefined') return 'teal';
  const v = storage.getItem(ACCENT_KEY) as AccentPreference | null;
  return v && ACCENTS.includes(v) ? v : 'teal';
}

function resolveTheme(pref: ThemePreference): ResolvedTheme {
  if (pref === 'dark') return 'dark';
  if (pref === 'light') return 'light';
  return getSystemDark() ? 'dark' : 'light';
}

function applyThemeClass(resolved: ResolvedTheme, accent: AccentPreference) {
  const root = document.documentElement;
  root.classList.toggle('dark', resolved === 'dark');
  root.setAttribute('data-accent', accent);
  const color = BASE_COLOR[resolved][accent];
  let meta = document.querySelector('meta[name="theme-color"][data-dynamic]') as HTMLMetaElement | null;
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = 'theme-color';
    meta.setAttribute('data-dynamic', 'true');
    document.head.appendChild(meta);
  }
  meta.content = color;
}

/** Apply before React paint — called from index.html inline script too */
export function applyThemeFromStorage() {
  const pref = readPreference();
  applyThemeClass(resolveTheme(pref), readAccent());
}

export function useTheme() {
  const [preference, setPreferenceState] = useState<ThemePreference>(readPreference);
  const [accent, setAccentState] = useState<AccentPreference>(readAccent);
  const [systemDark, setSystemDark] = useState(getSystemDark);

  const resolved: ResolvedTheme =
    preference === 'auto' ? (systemDark ? 'dark' : 'light') : preference;

  useEffect(() => {
    applyThemeClass(resolved, accent);
  }, [resolved, accent]);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    const onAccent = () => setAccentState(readAccent());
    window.addEventListener(ACCENT_EVENT, onAccent);
    return () => window.removeEventListener(ACCENT_EVENT, onAccent);
  }, []);

  const setPreference = useCallback((pref: ThemePreference) => {
    storage.setItem(STORAGE_KEY, pref);
    setPreferenceState(pref);
  }, []);

  const setAccent = useCallback((a: AccentPreference) => {
    storage.setItem(ACCENT_KEY, a);
    setAccentState(a);
    // 先贴属性再广播：其它实例收到事件就重渲染，图表要读到新的 CSS 变量
    document.documentElement.setAttribute('data-accent', a);
    window.dispatchEvent(new Event(ACCENT_EVENT));
  }, []);

  return { preference, setPreference, resolved, accent, setAccent };
}
