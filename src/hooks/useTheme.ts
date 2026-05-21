import { useCallback, useEffect, useState } from 'react';

export type ThemePreference = 'auto' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'theme-pref';

function getSystemDark(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function readPreference(): ThemePreference {
  if (typeof window === 'undefined') return 'auto';
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === 'light' || stored === 'dark' || stored === 'auto') return stored;
  return 'auto';
}

function resolveTheme(pref: ThemePreference): ResolvedTheme {
  if (pref === 'dark') return 'dark';
  if (pref === 'light') return 'light';
  return getSystemDark() ? 'dark' : 'light';
}

function applyThemeClass(resolved: ResolvedTheme) {
  const root = document.documentElement;
  root.classList.toggle('dark', resolved === 'dark');
  const color = resolved === 'dark' ? '#0F0F11' : '#FAFAF7';
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
  applyThemeClass(resolveTheme(pref));
}

export function useTheme() {
  const [preference, setPreferenceState] = useState<ThemePreference>(readPreference);
  const [systemDark, setSystemDark] = useState(getSystemDark);

  const resolved: ResolvedTheme =
    preference === 'auto' ? (systemDark ? 'dark' : 'light') : preference;

  useEffect(() => {
    applyThemeClass(resolved);
  }, [resolved]);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const setPreference = useCallback((pref: ThemePreference) => {
    localStorage.setItem(STORAGE_KEY, pref);
    setPreferenceState(pref);
  }, []);

  return { preference, setPreference, resolved };
}
