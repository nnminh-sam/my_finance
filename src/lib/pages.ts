export const pages = {
  home: { path: '/', html: 'index.html', title: 'MyFinance', protected: false },
  login: { path: '/login', html: 'login.html', title: 'Sign in · MyFinance', protected: false },
  signup: { path: '/signup', html: 'signup.html', title: 'Create account · MyFinance', protected: false },
  calendar: { path: '/calendar', html: 'calendar.html', title: 'Calendar · MyFinance', protected: true },
  week: { path: '/week', html: 'week.html', title: 'Week · MyFinance', protected: true },
  day: { path: '/day', html: 'day.html', title: 'Day details · MyFinance', protected: true },
  analytics: { path: '/analytics', html: 'analytics.html', title: 'Analytics · MyFinance', protected: true },
  profile: { path: '/profile', html: 'profile.html', title: 'Profile · MyFinance', protected: true },
} as const;

export type Page = keyof typeof pages;
export type FinancePage = 'calendar' | 'week' | 'day' | 'analytics' | 'profile';

export function isPage(value: string | undefined): value is Page {
  return value !== undefined && Object.hasOwn(pages, value);
}
