import { useEffect, useState } from 'react';
import { CalendarView } from './components/CalendarView';
import { WeekView } from './components/WeekView';
import { DayDetails } from './components/DayDetails';

import { ExpenseModal } from './components/ExpenseModal';
import { MonthlyIncomeModal } from './components/MonthlyIncomeModal';
import { incomeMonth } from './income';
import type { Spending } from './types';
import { UserProfile } from './components/UserProfile';
import { AnalyticsView } from './components/AnalyticsView';
import { SettingsProvider } from './contexts/SettingsContext';
import { useAuth } from './contexts/AuthContext';
import { AuthScreen } from './components/AuthScreen';
import { FinanceProvider, useFinance } from './contexts/FinanceContext';
import { useTheme } from './contexts/ThemeContext';
import { errorMessage } from './auth';
import { pages } from './pages';
import type { FinancePage, Page } from './pages';
import { authHref, pageHref, readPageDate, safeReturnPath } from './navigation';
import { format, addMonths, subMonths, addWeeks, subWeeks } from 'date-fns';
import { ChevronLeft, ChevronRight, LayoutGrid, List, User, Sun, Moon, ChartColumn, Plus, RefreshCw } from 'lucide-react';
import './index.css';
import './navigation.css';

function App({ page }: { page: Page }) {
  const { user, loading, error } = useAuth();
  const isAuthPage = page === 'login' || page === 'signup';
  let destination: string | null = null;
  if (!loading) {
    if (page === 'home') destination = user ? pages.calendar.path : pages.login.path;
    else if (isAuthPage && user) destination = safeReturnPath(new URLSearchParams(window.location.search).get('next'));
    else if (pages[page].protected && !user) {
      destination = authHref('login', `${pages[page].path}${window.location.search}`);
      if (error?.startsWith('Signed out locally')) destination += '&notice=logout-unconfirmed';
    }
  }
  useEffect(() => {
    if (destination) window.location.replace(destination);
  }, [destination]);

  if (loading || destination) {
    return <main className="auth-screen" role="status">{loading ? 'Restoring your session…' : 'Opening your page…'}</main>;
  }
  if (page === 'login' || page === 'signup') return <AuthScreen mode={page} />;
  if (!user) return null;
  return (
    <FinanceProvider key={user.id} userId={user.id}>
      <FinanceGate page={page as FinancePage} />
    </FinanceProvider>
  );
}

function FinanceGate({ page }: { page: FinancePage }) {
  const { loading, hasLoaded, error, reload } = useFinance();
  const { logout } = useAuth();
  const { theme, setTheme } = useTheme();
  const [actionError, setActionError] = useState<string | null>(null);
  if (!hasLoaded) {
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
            <button aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}</button>
          </div>
        </section>
      </main>
    );
  }
  return <SettingsProvider><FinanceDocument page={page} /></SettingsProvider>;
}

function FinanceDocument({ page }: { page: FinancePage }) {

  const { theme, setTheme } = useTheme();
  const { error, reload } = useFinance();

  const [expenseDialog, setExpenseDialog] = useState<{ expense?: Spending } | null>(null);
  const [expenseNotice, setExpenseNotice] = useState('');
  const [incomeDialogMonth, setIncomeDialogMonth] = useState<string | null>(null);
  const openExpense = (expense?: Spending) => {
    setExpenseNotice('');
    setExpenseDialog({ expense });
  };
  const currentDate = readPageDate(window.location.search);
  const previousDate = page === 'week' ? subWeeks(currentDate, 1) : subMonths(currentDate, 1);
  const nextDate = page === 'week' ? addWeeks(currentDate, 1) : addMonths(currentDate, 1);
  const dateNavigation = page === 'calendar' || page === 'week' || page === 'analytics';
  const openDate = (date: Date) => { window.location.assign(pageHref('day', date)); };
  const navigation = [
    { page: 'calendar', label: 'Calendar', Icon: LayoutGrid },
    { page: 'week', label: 'Week', Icon: List },
    { page: 'analytics', label: 'Analytics', Icon: ChartColumn },
    { page: 'profile', label: 'Profile', Icon: User },
  ] as const;

  return (
    <div className="finance-document">
      <header className="document-header glass">
        <a href={pageHref('calendar', currentDate)} className="document-brand" aria-label="MyFinance calendar">
          <span className="document-brand-icon"><img src="/favicon.svg" width={40} height={40} alt="" /></span>
          <span>
            <span className="document-title">MyFinance</span>
            <span className="document-subtitle">{page === 'profile' ? 'User Profile' : format(currentDate, page === 'day' ? 'MMMM d, yyyy' : 'MMMM yyyy')}</span>
          </span>
        </a>
        <nav aria-label="Main navigation" className="document-nav">
          {navigation.map(item => (
            <a key={item.page} href={pageHref(item.page, currentDate)} className="document-nav-link" aria-current={page === item.page ? 'page' : undefined}>
              <item.Icon size={16} aria-hidden="true" /><span>{item.label}</span>
            </a>
          ))}
        </nav>
        <div className="document-actions">
          {dateNavigation && (
            <>
              <a href={pageHref(page, previousDate)} className="document-action" title="Previous period" aria-label="Previous period"><ChevronLeft size={20} /></a>
              <a href={pageHref(page, nextDate)} className="document-action" title="Next period" aria-label="Next period"><ChevronRight size={20} /></a>
            </>
          )}
          <button type="button" className="document-action document-add" title="Add expense" aria-label="Add expense" onClick={() => openExpense()}><Plus size={20} /></button>
          <button className="document-action" title="Refresh records" aria-label="Refresh records" onClick={() => { void reload().catch(() => {}); }}><RefreshCw size={20} /></button>
          <button className="document-action" title="Toggle theme" aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}</button>

        </div>
      </header>
      {error && <div role="alert" className="document-error">Could not refresh your records: {error} Displaying the last successfully loaded data. <button onClick={() => { void reload().catch(() => {}); }}>Retry</button></div>}
      {expenseNotice && <p role="status" className="expense-notice" style={{ padding: '12px 24px', backgroundColor: 'var(--bg-card)' }}>{expenseNotice}</p>}
      <main className="document-content">
        {page === 'calendar' && <CalendarView currentDate={currentDate} onDateClick={openDate} onEditIncome={() => setIncomeDialogMonth(incomeMonth(currentDate))} />}
        {page === 'week' && <WeekView currentDate={currentDate} onDateClick={openDate} onEditIncome={() => setIncomeDialogMonth(incomeMonth(currentDate))} />}
        {page === 'profile' && <UserProfile />}
        {page === 'analytics' && <AnalyticsView currentDate={currentDate} />}
        {page === 'day' && <DayDetails date={currentDate} onBack={() => window.location.assign(pageHref('calendar', currentDate))} onAddExpense={() => openExpense()} onEditExpense={openExpense} />}
      </main>

      {incomeDialogMonth && <MonthlyIncomeModal month={incomeDialogMonth} onClose={() => setIncomeDialogMonth(null)} />}
      {expenseDialog && <ExpenseModal expense={expenseDialog.expense} onClose={() => setExpenseDialog(null)} onSaved={(input, count) => setExpenseNotice(count > 1 ? `${count} expenses added.` : `Expense ${expenseDialog.expense ? 'updated' : 'added'} for ${input.date} at ${input.time}.`)} />}
    </div>
  );
}

export default App;
