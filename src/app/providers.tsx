'use client';

import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { AuthProvider } from '../contexts/AuthContext';
import { initializeTheme, ThemeProvider } from '../contexts/ThemeContext';

export function Providers({ children }: { children: ReactNode }) {
  useEffect(() => {
    initializeTheme();
    // A cached document must recheck auth/data after back navigation, especially after logout.
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) {
        document.body.style.visibility = 'hidden';
        window.location.reload();
      }
    };
    window.addEventListener('pageshow', onPageShow);
    return () => window.removeEventListener('pageshow', onPageShow);
  }, []);

  return (
    <ThemeProvider>
      <AuthProvider>
        {children}
      </AuthProvider>
    </ThemeProvider>
  );
}
