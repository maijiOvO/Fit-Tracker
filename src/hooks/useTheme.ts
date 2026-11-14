import { useSyncExternalStore } from 'react';
import { storage } from '../../services/appStorage';
import { isDemo } from '../../services/appEnv';

export type ThemePreference = 'auto' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';
/** 强调色五套（docs/design-plates.md §1），贴在 <html data-accent>；深色底也跟着换 */
export type AccentPreference = 'teal' | 'rose' | 'violet' | 'orange' | 'sky';
const ACCENTS: readonly AccentPreference[] = ['teal', 'rose', 'violet', 'orange', 'sky'];

const STORAGE_KEY = 'theme-pref';
const ACCENT_KEY = 'accent-pref';

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

interface ThemeState {
  preference: ThemePreference;
  accent: AccentPreference;
  resolved: ResolvedTheme;
}

/**
 * 主题是模块级的一份（审查 F3）：useTheme 有好几个实例（App / 首选项 / 三张图表），
 * 原来各存各的 state、各自往 <html> 贴 dark 类 —— 在首选项改了主题，App 那个实例还拿着旧主题，
 * 再点强调色时它用旧主题把 dark 类摘掉。现在只有这一份状态、只在这里贴类，各实例只读。
 */
let systemDark = getSystemDark();
let state: ThemeState | null = null;
const listeners = new Set<() => void>();

function compute(preference: ThemePreference, accent: AccentPreference): ThemeState {
  return { preference, accent, resolved: preference === 'auto' ? (systemDark ? 'dark' : 'light') : preference };
}

function current(): ThemeState {
  if (!state) {
    state = compute(readPreference(), readAccent());
    applyThemeClass(state.resolved, state.accent);
  }
  return state;
}

/** 先贴类再广播给各实例：图表重渲染时要读到新的 CSS 变量 */
function commit(next: ThemeState) {
  state = next;
  applyThemeClass(next.resolved, next.accent);
  listeners.forEach(l => l());
}

function onSystem(e: MediaQueryListEvent) {
  if (e.matches === systemDark) return;
  systemDark = e.matches;
  const s = current();
  commit(compute(s.preference, s.accent));
}

function subscribe(listener: () => void) {
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  // 系统深浅只需要一个监听；第一个订阅者挂上，最后一个走时摘掉
  if (!listeners.size) mq.addEventListener('change', onSystem);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (!listeners.size) mq.removeEventListener('change', onSystem);
  };
}

const setPreference = (pref: ThemePreference) => {
  storage.setItem(STORAGE_KEY, pref);
  commit(compute(pref, current().accent));
};

const setAccent = (a: AccentPreference) => {
  storage.setItem(ACCENT_KEY, a);
  commit(compute(current().preference, a));
};

export function useTheme() {
  const { preference, resolved, accent } = useSyncExternalStore(subscribe, current);
  return { preference, setPreference, resolved, accent, setAccent };
}
