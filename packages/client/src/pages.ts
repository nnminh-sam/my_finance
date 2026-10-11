export const pages = {
  home: { path: '/', html: 'index.html', title: 'Tracker', protected: false },
  login: { path: '/login', html: 'login.html', title: 'Sign in · Tracker', protected: false },
  signup: { path: '/signup', html: 'signup.html', title: 'Create account · Tracker', protected: false },
  calendar: { path: '/calendar', html: 'calendar.html', title: 'Calendar · Tracker', protected: true },
  week: { path: '/week', html: 'week.html', title: 'Week · Tracker', protected: true },
  day: { path: '/day', html: 'day.html', title: 'Day details · Tracker', protected: true },
  analytics: { path: '/analytics', html: 'analytics.html', title: 'Analytics · Tracker', protected: true },
  profile: { path: '/profile', html: 'profile.html', title: 'Profile · Tracker', protected: true },
} as const;

export type Page = keyof typeof pages;
export type FinancePage = 'calendar' | 'week' | 'day' | 'analytics' | 'profile';

export function isPage(value: string | undefined): value is Page {
  return value !== undefined && Object.hasOwn(pages, value);
}
