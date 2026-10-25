'use client';

import { createContext, useContext, useEffect, useLayoutEffect, useState } from 'react';
import type { ReactNode } from 'react';

type Theme = 'light' | 'dark';
interface ThemeContextValue {
  theme: Theme;
  /** The saved choice for this device; null follows the system setting. */
  preference: Theme | null;
  setTheme: (theme: Theme | null) => void;
}

const STORAGE_KEY = 'tracker_theme';
const SYSTEM_QUERY = '(prefers-color-scheme: dark)';
const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

function storedTheme(): Theme | null {
  if (typeof window === 'undefined') return null;
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === 'light' || value === 'dark' ? value : null;
  } catch {
    return null;
  }
}

function systemTheme(): Theme {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'dark';
  return window.matchMedia(SYSTEM_QUERY).matches ? 'dark' : 'light';
}

function applyTheme(theme: Theme) {
  if (typeof document === 'undefined') return;
  document.body.classList.toggle('light-mode', theme === 'light');
  document.body.style.colorScheme = theme;
  document.documentElement.style.colorScheme = theme;
}

// Apply before React mounts so session restoration also uses the chosen theme.
export function initializeTheme() {
  applyTheme(storedTheme() ?? systemTheme());
}

const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreference] = useState<Theme | null>(storedTheme);
  const [system, setSystem] = useState<Theme>(systemTheme);
  const theme = preference ?? system;

  useIsomorphicLayoutEffect(() => { applyTheme(theme); }, [theme]);

  useEffect(() => {
    setPreference(storedTheme());
    const media = window.matchMedia(SYSTEM_QUERY);
    const onSystemChange = () => setSystem(media.matches ? 'dark' : 'light');
    const onStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY || event.key === null) setPreference(storedTheme());
    };
    onSystemChange();
    media.addEventListener('change', onSystemChange);
    window.addEventListener('storage', onStorage);
    return () => {
      media.removeEventListener('change', onSystemChange);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  const setTheme = (next: Theme | null) => {
    setPreference(next);
    applyTheme(next ?? systemTheme());
    try {
      if (next) localStorage.setItem(STORAGE_KEY, next);
      else localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Theme selection still works for this session when browser storage is blocked.
    }
  };

  return <ThemeContext.Provider value={{ theme, preference, setTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used within a ThemeProvider');
  return context;
}
