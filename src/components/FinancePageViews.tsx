'use client';

import { CalendarView } from './CalendarView';
import { WeekView } from './WeekView';
import { DayDetails } from './DayDetails';
import { AnalyticsView } from './AnalyticsView';
import { UserProfile } from './UserProfile';
import { PlansPage } from './PlansPage';
import { MobileMonth } from './mobile/MobileMonth';
import { MobileWeek } from './mobile/MobileWeek';
import { MobileAnalytics } from './mobile/MobileAnalytics';
import { useFinanceShell } from '../contexts/FinanceShellContext';
import { useIsMobile } from '../hooks/useIsMobile';
import { incomeMonth } from '../lib/income';

import { useRouter } from 'next/navigation';
import { format } from 'date-fns';
import { pageHref } from '../lib/navigation';

// Phones get direction F (Ledger Month): a plain Month, a Week ledger with a keypad, segmented Analytics.
export function CalendarPageView() {
  const { currentDate, onActiveDateChange, openDate, openIncomeModal } = useFinanceShell();
  if (useIsMobile()) return <MobileMonth />;
  return (
    <CalendarView
      currentDate={currentDate}
      onActiveMonthChange={onActiveDateChange}
      onDateClick={openDate}
      onEditIncome={(month?: string) => openIncomeModal(month || incomeMonth(currentDate))}
    />
  );
}

export function WeekPageView() {
  const { currentDate, openDate, openIncomeModal } = useFinanceShell();
  const router = useRouter();
  if (useIsMobile()) return <MobileWeek />;
  return (
    <WeekView
      currentDate={currentDate}
      onDateClick={openDate}
      onNavigateDate={(date) => router.push(pageHref('week', date))}
      onEditIncome={() => openIncomeModal(incomeMonth(currentDate))}
    />
  );
}

export function DayPageView() {
  const { currentDate, openBackToCalendar, openExpense } = useFinanceShell();
  return (
    <DayDetails
      date={currentDate}
      onBack={openBackToCalendar}
      onAddExpense={() => openExpense(undefined, { date: format(currentDate, 'yyyy-MM-dd') })}
      onEditExpense={openExpense}
    />
  );
}

export function AnalyticsPageView() {
  const { currentDate } = useFinanceShell();
  if (useIsMobile()) return <MobileAnalytics />;
  return <AnalyticsView currentDate={currentDate} />;
}

export function PlansPageView() {
  return <PlansPage />;
}

export function ProfilePageView() {
  return <UserProfile />;
}
