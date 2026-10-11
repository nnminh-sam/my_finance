import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import type { UserSettings } from '../types';
import { useAuth } from './AuthContext';
import { useFinance } from './FinanceContext.tsx';
import { useTheme } from './ThemeContext';

type FinanceSettings = Pick<UserSettings, 'income' | 'avatar' | 'categories'>;

interface SettingsContextType {
  settings: UserSettings;
  updateSettings: (newSettings: Partial<UserSettings>) => Promise<void>;
}

const SettingsContext = createContext<SettingsContextType | undefined>(undefined);

interface SettingsProviderProps {
  userId?: string;
  children: ReactNode;
}

export function SettingsProvider({ children }: SettingsProviderProps) {
  const finance = useFinance();
  const { user } = useAuth();
  const { theme, setTheme } = useTheme();
  const settings: UserSettings = {
    ...finance.settings,
    theme,
    name: user?.name ?? '',
    email: user?.email ?? '',
  };

  const updateSettings = async (updates: Partial<UserSettings>): Promise<void> => {
    if (updates.theme !== undefined) setTheme(updates.theme);
    const financial: Partial<FinanceSettings> = {};
    if (updates.income !== undefined) financial.income = updates.income;

    if (updates.avatar !== undefined) financial.avatar = updates.avatar;
    if (updates.categories !== undefined) financial.categories = updates.categories;
    if (Object.keys(financial).length > 0) await finance.updateSettings(financial);
  };

  return <SettingsContext.Provider value={{ settings, updateSettings }}>{children}</SettingsContext.Provider>;
}

export function useSettings() {
  const context = useContext(SettingsContext);
  if (!context) throw new Error('useSettings must be used within a SettingsProvider');
  return context;
}
