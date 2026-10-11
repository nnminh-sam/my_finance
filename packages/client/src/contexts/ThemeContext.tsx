import { createContext, useContext, useEffect, useLayoutEffect, useState } from 'react';
import type { ReactNode } from 'react';

type Theme = 'light' | 'dark';
interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

const STORAGE_KEY = 'tracker_theme';
const SYSTEM_QUERY = '(prefers-color-scheme: dark)';
const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

function storedTheme(): Theme | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === 'light' || value === 'dark' ? value : null;
  } catch {
    return null;
  }
}

function systemTheme(): Theme {
  return window.matchMedia(SYSTEM_QUERY).matches ? 'dark' : 'light';
}

function applyTheme(theme: Theme) {
  document.body.classList.toggle('light-mode', theme === 'light');
  document.body.style.colorScheme = theme;
  document.documentElement.style.colorScheme = theme;
}

// Apply before React mounts so session restoration also uses the chosen theme.
export function initializeTheme() {
  applyTheme(storedTheme() ?? systemTheme());
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreference] = useState<Theme | null>(storedTheme);
  const [system, setSystem] = useState<Theme>(systemTheme);
  const theme = preference ?? system;

  useLayoutEffect(() => { applyTheme(theme); }, [theme]);

  useEffect(() => {
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

  const setTheme = (next: Theme) => {
    setPreference(next);
    applyTheme(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Theme selection still works for this session when browser storage is blocked.
    }
  };

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used within a ThemeProvider');
  return context;
}
