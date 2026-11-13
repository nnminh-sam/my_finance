'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { addMonths, eachDayOfInterval, endOfMonth, format, getDay, isAfter, isSameDay, startOfDay, startOfMonth } from 'date-fns';
import { CalendarRange, ChevronLeft, ChevronRight } from 'lucide-react';
import { useFinance } from '../../contexts/FinanceContext';
import { useSettings } from '../../contexts/SettingsContext';
import { useFinanceShell } from '../../contexts/FinanceShellContext';
import { pageHref } from '../../lib/navigation';
import { DEFAULT_BUDGET_PERIOD, DEFAULT_SHOW_BY, viewPeriodOf } from '../../lib/periods';
import { pages } from '../../lib/pages';
import { fmtCompact, fmtVND } from '../../lib/analytics';
import { expectedPaydays, getRangeIncome } from '../../lib/income';
import { dayFlag, everydayBudget, periodBills, splitDay } from '../../lib/dayBudget';
import '../../styles/Mobile.css';

const WEEKDAY_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

/** F · Month: a plain calendar of dates; daily spending lives in the bar chart above it. */
export function MobileMonth() {
  const { currentDate, activeDate, onActiveDateChange } = useFinanceShell();
  const { spendings, plans, incomes, received, fetchWeeksSpendings, projectedBetween } = useFinance();
  const { settings } = useSettings();
  const router = useRouter();
  const [month, setMonth] = useState(() => startOfMonth(currentDate));
  const today = startOfDay(new Date());

  // The month total and the planned row follow Show by: the calendar month, or the pay period of the month shown.
  // The anchor is the day the header or this screen moved to, else the first of the month.
  const anchor = activeDate && format(activeDate, 'yyyy-MM') === format(month, 'yyyy-MM') ? format(activeDate, 'yyyy-MM-dd') : format(month, 'yyyy-MM-dd');
  const budgetPeriod = settings.budgetPeriod ?? DEFAULT_BUDGET_PERIOD;
  const period = useMemo(
    () => viewPeriodOf(budgetPeriod, settings.showBy ?? DEFAULT_SHOW_BY, incomes, anchor),
    [budgetPeriod, settings.showBy, incomes, anchor],
  );

  useEffect(() => {
    const monthStart = format(month, 'yyyy-MM-dd');
    const monthEnd = format(addMonths(month, 1), 'yyyy-MM-dd');
    const start = period.start < monthStart ? period.start : monthStart;
    const end = period.nextStart > monthEnd ? period.nextStart : monthEnd;
    void fetchWeeksSpendings(start, end).catch(() => []);
  }, [month, period, fetchWeeksSpendings]);

  const days = useMemo(() => eachDayOfInterval({ start: month, end: endOfMonth(month) }), [month]);
  const totals = useMemo(() => {
    const byDate = new Map<string, number>();
    const prefix = format(month, 'yyyy-MM');
    for (const s of spendings) {
      if (s.date.startsWith(prefix)) byDate.set(s.date, (byDate.get(s.date) ?? 0) + s.amount);
    }
    return byDate;
  }, [spendings, month]);

  const planned = useMemo(() => {
    const byDate = new Map<string, number>();
    for (const item of projectedBetween(format(month, 'yyyy-MM-dd'), format(endOfMonth(month), 'yyyy-MM-dd'))) {
      byDate.set(item.date, (byDate.get(item.date) ?? 0) + item.amount);
    }
    return byDate;
  }, [projectedBetween, month]);

  // Days with money in get a green dot: filled when received, a ring when the payday is still to come.
  const incomeDays = useMemo(() => {
    const from = format(month, 'yyyy-MM-dd'), to = format(endOfMonth(month), 'yyyy-MM-dd');
    const byDate = new Map<string, 'received' | 'expected'>();
    for (const item of expectedPaydays(incomes, from, to)) byDate.set(item.date, 'expected');
    for (const record of received) if (record.date >= from && record.date <= to) byDate.set(record.date, 'received');
    return byDate;
  }, [incomes, received, month]);

  // Days of the shown period whose everyday spending passed (income − bills) ÷ days get an amber dot.
  const overDays = useMemo(() => {
    const over = new Set<string>();
    const rules = {
      surePlanIds: new Set(plans.filter(plan => plan.sure === true).map(plan => plan.id)),
      billCategories: new Set(settings.categories.filter(category => category.bill).map(category => category.id)),
    };
    const inPeriod = spendings.filter(s => s.date >= period.start && s.date <= period.end);
    const { totalIncome } = getRangeIncome(period.start, period.end, incomes, received);
    const days = Math.round((Date.parse(period.end) - Date.parse(period.start)) / 86_400_000) + 1;
    const budget = everydayBudget(totalIncome, periodBills(inPeriod, projectedBetween(period.start, period.end), rules), days);
    if (budget === null) return over;
    const byDate = new Map<string, typeof inPeriod>();
    for (const s of inPeriod) byDate.set(s.date, [...(byDate.get(s.date) ?? []), s]);
    for (const [date, list] of byDate) if (dayFlag(splitDay(list, rules), budget) === 'over') over.add(date);
    return over;
  }, [spendings, plans, settings.categories, incomes, received, period, projectedBetween]);

  const max = Math.max(1, ...totals.values(), ...planned.values());
  const monthTotal = spendings.filter(s => s.date >= period.start && s.date <= period.end).reduce((sum, s) => sum + s.amount, 0);
  const plannedTotal = projectedBetween(period.start, period.end).reduce((sum, item) => sum + item.amount, 0);
  const periodWord = period.mode === 'calendar' ? 'month' : 'period';
  const lead = (getDay(month) + 6) % 7;

  const changeMonth = (by: number) => {
    const next = addMonths(month, by);
    setMonth(next);
    onActiveDateChange?.(next);
  };
  const openDay = (day: Date) => router.push(pageHref('week', day));

  return (
    <div className="m-screen m-scroll">
      <header className="m-nav">
        <h1>{format(month, 'MMMM')}</h1>
        <span className="m-sub">{format(month, 'yyyy')}</span>
      </header>

      <div className="m-mhead">
        <button type="button" className="m-icon-btn" aria-label="Previous month" onClick={() => changeMonth(-1)}><ChevronLeft size={22} /></button>
        <span className="m-muted">
          Daily spending · <b className="m-strong">{fmtCompact(monthTotal)} ₫</b>
          {plannedTotal > 0 && <> · <span className="m-planned-text">~{fmtCompact(monthTotal + plannedTotal)} ₫ projected</span></>}
        </span>
        <button type="button" className="m-icon-btn" aria-label="Next month" onClick={() => changeMonth(1)}><ChevronRight size={22} /></button>
      </div>

      <div className="m-fbars" role="group" aria-label={`Daily spending in ${format(month, 'MMMM yyyy')}`}>
        {days.map(day => {
          const key = format(day, 'yyyy-MM-dd');
          const total = totals.get(key) ?? 0;
          const dayPlanned = planned.get(key) ?? 0;
          const shown = total || dayPlanned;
          const future = isAfter(day, today);
          const isToday = isSameDay(day, today);
          return (
            <button
              key={key}
              type="button"
              className={`${isToday ? 'is-today' : ''}${future ? ' is-future' : ''}${!total && dayPlanned ? ' is-planned' : ''}${overDays.has(key) ? ' is-over' : ''}`}
              style={{ height: `${shown ? Math.max(6, (100 * shown) / max) : 6}%` }}
              aria-label={`${format(day, 'EEE d MMM')}, ${fmtVND(total)}${dayPlanned ? `, ${fmtVND(dayPlanned)} planned` : ''}`}
              onClick={() => openDay(day)}
            />
          );
        })}
      </div>
      <div className="m-faxis"><span>1 {format(month, 'MMM')}</span><span>{format(endOfMonth(month), 'd MMM')}</span></div>

      <div className="m-mgrid">
        {WEEKDAY_LETTERS.map((letter, i) => <span key={i} className="m-wd" aria-hidden="true">{letter}</span>)}
        {Array.from({ length: lead }, (_, i) => <span key={`lead-${i}`} />)}
        {days.map(day => {
          const future = isAfter(day, today);
          const isToday = isSameDay(day, today);
          const key = format(day, 'yyyy-MM-dd');
          const income = incomeDays.get(key);
          const over = overDays.has(key);
          return (
            <button
              key={day.toISOString()}
              type="button"
              className={`m-dc${isToday ? ' is-today' : ''}${future ? ' is-future' : ''}`}
              aria-label={`${format(day, 'EEEE d MMMM')}${income === 'received' ? ', money received' : income === 'expected' ? ', payday expected' : ''}${over ? ', over the everyday budget' : ''}`}
              aria-current={isToday ? 'date' : undefined}
              onClick={() => openDay(day)}
            >
              <b>{format(day, 'd')}</b>
              {(income || over) && (
                <span className="m-dc-marks" aria-hidden="true">
                  {income && <i className={`m-dc-income${income === 'expected' ? ' is-expected' : ''}`} />}
                  {over && <i className="m-dc-over" />}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <p className="m-hint">Tap a date or a bar to open that day in Week</p>

      <div className="m-pad" style={{ paddingTop: 12 }}>
        <div className="m-list">
          <div className="m-row" role="button" tabIndex={0} onClick={() => router.push(pages.plans.path)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); router.push(pages.plans.path); } }}>
            <span className="m-ic" style={{ ['--c' as string]: 'var(--primary)' }}><CalendarRange size={16} /></span>
            <span className="m-rt"><b>Plans</b><small>{plans.length} {plans.length === 1 ? 'plan' : 'plans'} · ~{fmtCompact(plannedTotal)} ₫ still planned this {periodWord}</small></span>
            <ChevronRight size={18} className="m-muted" aria-hidden="true" />
          </div>
        </div>
      </div>
    </div>
  );
}
