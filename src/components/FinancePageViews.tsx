'use client';

import { CalendarView } from './CalendarView';
import { WeekView } from './WeekView';
import { DayDetails } from './DayDetails';
import { AnalyticsView } from './AnalyticsView';
import { UserProfile } from './UserProfile';
import { useFinanceShell } from '../contexts/FinanceShellContext';
import { incomeMonth } from '../lib/income';

import { useRouter } from 'next/navigation';
import { pageHref } from '../lib/navigation';

export function CalendarPageView() {
  const { currentDate, onActiveDateChange, openDate, openIncomeModal } = useFinanceShell();
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
      onAddExpense={() => openExpense()}
      onEditExpense={openExpense}
    />
  );
}

export function AnalyticsPageView() {
  const { currentDate } = useFinanceShell();
  return <AnalyticsView currentDate={currentDate} />;
}

export function ProfilePageView() {
  return <UserProfile />;
}
