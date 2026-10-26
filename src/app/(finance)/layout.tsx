'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { format, addMonths, subMonths, addWeeks, subWeeks } from 'date-fns';
import { ChevronLeft, ChevronRight, LayoutGrid, CalendarClock, List, User, Sun, Moon, ChartColumn, Plus, RefreshCw } from 'lucide-react';
import { ExpenseModal } from '../../components/ExpenseModal';
import { MonthlyIncomeModal } from '../../components/MonthlyIncomeModal';
import type { Spending } from '../../types';
import { SettingsProvider } from '../../contexts/SettingsContext';
import { useAuth } from '../../contexts/AuthContext';
import { FinanceProvider, useFinance } from '../../contexts/FinanceContext';
import { useTheme } from '../../contexts/ThemeContext';
import { FinanceShellContext } from '../../contexts/FinanceShellContext';
import { errorMessage } from '../../services/auth';
import { pages } from '../../lib/pages';
import type { FinancePage } from '../../lib/pages';
import { authHref, pageHref, readPageDate } from '../../lib/navigation';
import '../../styles/AuthScreen.css';

function resolveFinancePage(pathname: string): FinancePage {
  const clean = pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
  if (clean === '/cycle') return 'cycle';
  if (clean === '/week') return 'week';
  if (clean === '/day') return 'day';
  if (clean === '/analytics') return 'analytics';
  if (clean === '/profile') return 'profile';
  return 'calendar';
}

function FinanceLayoutContent({ children }: { children: ReactNode }) {
  const { user, loading, error } = useAuth();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const page = resolveFinancePage(pathname);
  const searchStr = searchParams.toString();
  const fullSearch = searchStr ? `?${searchStr}` : '';

  let destination: string | null = null;
  if (!loading && !user) {
    destination = authHref('login', `${pages[page].path}${fullSearch}`);
    if (error?.startsWith('Signed out locally')) destination += '&notice=logout-unconfirmed';
  }

  useEffect(() => {
    if (destination) router.replace(destination);
  }, [destination, router]);

  if (loading || destination) {
    return (
      <main className="auth-screen" role="status">
        {loading ? 'Restoring your session…' : 'Opening your page…'}
      </main>
    );
  }

  if (!user) return null;

  return (
    <FinanceProvider key={user.id} userId={user.id}>
      <FinanceGate page={page} fullSearch={fullSearch}>
        {children}
      </FinanceGate>
    </FinanceProvider>
  );
}

function FinanceGate({
  page,
  fullSearch,
  children,
}: {
  page: FinancePage;
  fullSearch: string;
  children: ReactNode;
}) {
  const { loading, hasLoaded, error, reload } = useFinance();
  const { logout } = useAuth();
  const { theme, setTheme } = useTheme();
  const [actionError, setActionError] = useState<string | null>(null);

  if (!hasLoaded && !(loading && page === 'calendar')) {
    return (
      <main className="auth-screen">
        <section className="auth-card glass" aria-busy={loading}>
          <h1>{loading ? 'Loading your finances…' : 'Unable to load your finances'}</h1>
          {loading && <p role="status" className="auth-subtitle">Fetching your records from Neon.</p>}
          {!loading && error && <p role="alert" className="auth-error">{error}</p>}
          {actionError && <p role="alert" className="auth-error">{actionError}</p>}
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginTop: '24px' }}>
            {!loading && <button className="auth-submit" onClick={() => { void reload().catch(() => {}); }}>Retry</button>}
            <button onClick={() => { void logout().catch(cause => setActionError(errorMessage(cause))); }}>Sign out</button>
            <button aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
              {theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
            </button>
          </div>
        </section>
      </main>
    );
  }

  return (
    <SettingsProvider>
      <FinanceDocument page={page} fullSearch={fullSearch}>
        {children}
      </FinanceDocument>
    </SettingsProvider>
  );
}

function FinanceDocument({
  page,
  fullSearch,
  children,
}: {
  page: FinancePage;
  fullSearch: string;
  children: ReactNode;
}) {
  const { theme, setTheme } = useTheme();
  const { error, reload, fetchWeeksSpendings } = useFinance();
  const router = useRouter();

  const [expenseDialog, setExpenseDialog] = useState<{ expense?: Spending } | null>(null);
  const [expenseNotice, setExpenseNotice] = useState('');
  const [incomeDialogMonth, setIncomeDialogMonth] = useState<string | null>(null);

  const openExpense = useCallback((expense?: Spending) => {
    setExpenseNotice('');
    setExpenseDialog({ expense });
  }, []);

  const openIncomeModal = useCallback((month: string) => {
    setIncomeDialogMonth(month);
  }, []);

  const urlDate = useMemo(() => readPageDate(fullSearch), [fullSearch]);
  const [calendarDate, setCalendarDate] = useState<Date>(() => new Date());
  const currentDate = page === 'calendar' ? calendarDate : urlDate;
  const [activeDate, setActiveDate] = useState<Date>(() => (page === 'calendar' ? new Date() : urlDate));

  useEffect(() => {
    if (page === 'calendar') {
      const now = new Date();
      setCalendarDate(now);
      setActiveDate(now);
      if (typeof window !== 'undefined' && window.location.search) {
        window.history.replaceState(null, '', pages.calendar.path);
      }
    } else {
      setActiveDate(urlDate);
      if (page === 'cycle' || page === 'week' || page === 'day' || page === 'analytics') {
        const rangeStart = format(subMonths(urlDate, 1), 'yyyy-MM-01');
        const rangeEnd = format(addMonths(urlDate, 2), 'yyyy-MM-01');
        void fetchWeeksSpendings(rangeStart, rangeEnd).catch(() => []);
      }
    }
  }, [page, urlDate, fetchWeeksSpendings]);

  const onActiveDateChange = useCallback((date: Date) => {
    setActiveDate(date);
    if (page !== 'calendar' && typeof window !== 'undefined') {
      const newHref = pageHref(page, date);
      window.history.replaceState(null, '', newHref);
    }
  }, [page]);

  const previousDate = page === 'week' ? subWeeks(activeDate, 1) : subMonths(activeDate, 1);
  const nextDate = page === 'week' ? addWeeks(activeDate, 1) : addMonths(activeDate, 1);
  const dateNavigation = page === 'calendar' || page === 'cycle' || page === 'week' || page === 'analytics';

  const openDate = useCallback((date: Date) => {
    router.push(pageHref('day', date));
  }, [router]);

  const openBackToCalendar = useCallback(() => {
    router.push(pages.calendar.path);
  }, [router]);

  const shellValue = useMemo(() => ({
    currentDate,
    activeDate,
    onActiveDateChange,
    openDate,
    openBackToCalendar,
    openExpense,
    openIncomeModal,
  }), [currentDate, activeDate, onActiveDateChange, openDate, openBackToCalendar, openExpense, openIncomeModal]);

  const navigation = [
    { page: 'calendar', label: 'Calendar', Icon: LayoutGrid },
    { page: 'cycle', label: 'Pay Cycle', Icon: CalendarClock },
    { page: 'week', label: 'Week', Icon: List },
    { page: 'analytics', label: 'Analytics', Icon: ChartColumn },
    { page: 'profile', label: 'Profile', Icon: User },
  ] as const;

  const bottomTabsLeft = [
    { page: 'calendar', label: 'Calendar', Icon: LayoutGrid },
    { page: 'cycle', label: 'Pay Cycle', Icon: CalendarClock },
  ] as const;

  const bottomTabsRight = [
    { page: 'week', label: 'Week', Icon: List },
    { page: 'analytics', label: 'Analytics', Icon: ChartColumn },
  ] as const;

  const resetCalendarToCurrentMonth = useCallback(() => {
    if (page === 'calendar') {
      const now = new Date();
      setCalendarDate(now);
      setActiveDate(now);
    }
  }, [page]);

  const periodLabel = page === 'profile' ? 'User Profile' : format(activeDate, page === 'day' ? 'MMMM d, yyyy' : 'MMMM yyyy');
  const mobilePeriodLabel = page === 'profile' ? 'User Profile' : format(activeDate, page === 'day' ? 'MMM d, yyyy' : 'MMMM yyyy');

  const renderPrevAction = (extraClass = '') => {
    const className = `document-action${extraClass ? ` ${extraClass}` : ''}`;
    if (!dateNavigation) return null;
    if (page === 'calendar') {
      return (
        <button
          type="button"
          className={className}
          title="Previous period"
          aria-label="Previous period"
          onClick={() => {
            setCalendarDate(previousDate);
            setActiveDate(previousDate);
          }}
        >
          <ChevronLeft size={20} />
        </button>
      );
    }
    return (
      <Link href={pageHref(page, previousDate)} className={className} title="Previous period" aria-label="Previous period">
        <ChevronLeft size={20} />
      </Link>
    );
  };

  const renderNextAction = (extraClass = '') => {
    const className = `document-action${extraClass ? ` ${extraClass}` : ''}`;
    if (!dateNavigation) return null;
    if (page === 'calendar') {
      return (
        <button
          type="button"
          className={className}
          title="Next period"
          aria-label="Next period"
          onClick={() => {
            setCalendarDate(nextDate);
            setActiveDate(nextDate);
          }}
        >
          <ChevronRight size={20} />
        </button>
      );
    }
    return (
      <Link href={pageHref(page, nextDate)} className={className} title="Next period" aria-label="Next period">
        <ChevronRight size={20} />
      </Link>
    );
  };

  return (
    <FinanceShellContext.Provider value={shellValue}>
      <div className="finance-document">
        <header className="document-header glass">
          <Link
            href={pages.calendar.path}
            onClick={resetCalendarToCurrentMonth}
            className="document-brand"
            aria-label="MyFinance calendar"
          >
            <span className="document-brand-icon"><img src="/favicon.svg" width={40} height={40} alt="" /></span>
            <span className="document-brand-text">
              <span className="document-title">MyFinance</span>
              <span className="document-subtitle">{periodLabel}</span>
            </span>
          </Link>

          <div className="document-mobile-period">
            {renderPrevAction('document-period-chevron')}
            <span className="document-mobile-period-label" aria-live="polite">
              {mobilePeriodLabel}
            </span>
            {renderNextAction('document-period-chevron')}
          </div>

          <nav aria-label="Main navigation" className="document-nav">
            {navigation.map(item => (
              <Link
                key={item.page}
                href={item.page === 'calendar' ? pages.calendar.path : pageHref(item.page, activeDate)}
                onClick={item.page === 'calendar' ? resetCalendarToCurrentMonth : undefined}
                className="document-nav-link"
                aria-current={page === item.page ? 'page' : undefined}
              >
                <item.Icon size={16} aria-hidden="true" /><span>{item.label}</span>
              </Link>
            ))}
          </nav>

          <div className="document-actions">
            {renderPrevAction('document-desktop-only')}
            {renderNextAction('document-desktop-only')}
            <button type="button" className="document-action document-add document-desktop-only" title="Add expense" aria-label="Add expense" onClick={() => openExpense()}><Plus size={20} /></button>
            <button className="document-action document-desktop-only" title="Refresh records" aria-label="Refresh records" onClick={() => { void reload().catch(() => {}); }}><RefreshCw size={20} /></button>
            <button className="document-action document-desktop-only" title="Toggle theme" aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}</button>
            <Link
              href={pages.profile.path}
              className="document-action document-profile-btn"
              title="Profile"
              aria-label="Profile"
              aria-current={page === 'profile' ? 'page' : undefined}
            >
              <User size={20} aria-hidden="true" />
            </Link>
          </div>
        </header>
        {error && (
          <div role="alert" className="document-error">
            Could not refresh your records: {error} Displaying the last successfully loaded data.{' '}
            <button onClick={() => { void reload().catch(() => {}); }}>Retry</button>
          </div>
        )}
        {expenseNotice && (
          <p role="status" className="expense-notice" style={{ padding: '12px 24px', backgroundColor: 'var(--bg-card)' }}>
            {expenseNotice}
          </p>
        )}
        <main className="document-content">
          {children}
        </main>

        <nav aria-label="Mobile bottom navigation" className="document-bottom-nav glass">
          {bottomTabsLeft.map(item => (
            <Link
              key={item.page}
              href={item.page === 'calendar' ? pages.calendar.path : pageHref(item.page, activeDate)}
              onClick={item.page === 'calendar' ? resetCalendarToCurrentMonth : undefined}
              className="document-bottom-link"
              aria-current={page === item.page ? 'page' : undefined}
            >
              <item.Icon size={20} aria-hidden="true" />
              <span>{item.label}</span>
            </Link>
          ))}
          <button
            type="button"
            className="document-bottom-add"
            title="Add transaction"
            aria-label="Add transaction"
            onClick={() => openExpense()}
          >
            <span className="document-bottom-add-circle">
              <Plus size={24} aria-hidden="true" />
            </span>
            <span className="document-bottom-add-label">Add</span>
          </button>
          {bottomTabsRight.map(item => (
            <Link
              key={item.page}
              href={pageHref(item.page, activeDate)}
              className="document-bottom-link"
              aria-current={page === item.page ? 'page' : undefined}
            >
              <item.Icon size={20} aria-hidden="true" />
              <span>{item.label}</span>
            </Link>
          ))}
        </nav>

        {incomeDialogMonth && <MonthlyIncomeModal month={incomeDialogMonth} onClose={() => setIncomeDialogMonth(null)} />}
        {expenseDialog && (
          <ExpenseModal
            expense={expenseDialog.expense}
            onClose={() => setExpenseDialog(null)}
            onSaved={(input, count) => setExpenseNotice(count > 1 ? `${count} expenses added.` : `Expense ${expenseDialog.expense ? 'updated' : 'added'} for ${input.date} at ${input.time}.`)}
            onIncomeSaved={(input) => setExpenseNotice(`Income “${input.source}${input.name ? ` · ${input.name}` : ''}” added.`)}
          />
        )}
      </div>
    </FinanceShellContext.Provider>
  );
}

export default function FinanceLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense
      fallback={
        <main className="auth-screen" role="status">
          Restoring your session…
        </main>
      }
    >
      <FinanceLayoutContent>{children}</FinanceLayoutContent>
    </Suspense>
  );
}
