import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { pages } from '../lib/pages';
import { Providers } from './providers';
import '../styles/globals.css';
import '../styles/navigation.css';

export const metadata: Metadata = {
  title: pages.home.title,
  icons: {
    icon: '/favicon.svg',
  },
};

const themeInitScript = `
(function() {
  try {
    var stored = localStorage.getItem('tracker_theme');
    var theme = (stored === 'light' || stored === 'dark')
      ? stored
      : (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    document.body.classList.toggle('light-mode', theme === 'light');
    document.body.style.colorScheme = theme;
    document.documentElement.style.colorScheme = theme;
  } catch (e) {}
})();
`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <noscript>MyFinance requires JavaScript. Please enable JavaScript to use this app.</noscript>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
