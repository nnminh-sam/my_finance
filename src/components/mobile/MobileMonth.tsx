'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { addMonths, eachDayOfInterval, endOfMonth, format, getDay, isAfter, isSameDay, startOfDay, startOfMonth } from 'date-fns';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useFinance } from '../../contexts/FinanceContext';
import { useFinanceShell } from '../../contexts/FinanceShellContext';
import { pageHref } from '../../lib/navigation';
import { fmtCompact, fmtVND } from '../../lib/analytics';
import '../../styles/Mobile.css';

const WEEKDAY_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

/** F · Month: a plain calendar of dates; daily spending lives in the bar chart above it. */
export function MobileMonth() {
  const { currentDate, onActiveDateChange } = useFinanceShell();
  const { spendings, fetchWeeksSpendings } = useFinance();
  const router = useRouter();
  const [month, setMonth] = useState(() => startOfMonth(currentDate));
  const today = startOfDay(new Date());

  useEffect(() => {
    const start = format(month, 'yyyy-MM-dd');
    const end = format(addMonths(month, 1), 'yyyy-MM-dd');
    void fetchWeeksSpendings(start, end).catch(() => []);
  }, [month, fetchWeeksSpendings]);

  const days = useMemo(() => eachDayOfInterval({ start: month, end: endOfMonth(month) }), [month]);
  const totals = useMemo(() => {
    const byDate = new Map<string, number>();
    const prefix = format(month, 'yyyy-MM');
    for (const s of spendings) {
      if (s.date.startsWith(prefix)) byDate.set(s.date, (byDate.get(s.date) ?? 0) + s.amount);
    }
    return byDate;
  }, [spendings, month]);

  const max = Math.max(1, ...totals.values());
  const monthTotal = [...totals.values()].reduce((sum, value) => sum + value, 0);
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
        <span className="m-muted">Daily spending · <b className="m-strong">{fmtCompact(monthTotal)} ₫</b></span>
        <button type="button" className="m-icon-btn" aria-label="Next month" onClick={() => changeMonth(1)}><ChevronRight size={22} /></button>
      </div>

      <div className="m-fbars" role="group" aria-label={`Daily spending in ${format(month, 'MMMM yyyy')}`}>
        {days.map(day => {
          const key = format(day, 'yyyy-MM-dd');
          const total = totals.get(key) ?? 0;
          const future = isAfter(day, today);
          const isToday = isSameDay(day, today);
          return (
            <button
              key={key}
              type="button"
              className={`${isToday ? 'is-today' : ''}${future ? ' is-future' : ''}`}
              style={{ height: `${total ? Math.max(6, (100 * total) / max) : 6}%` }}
              aria-label={`${format(day, 'EEE d MMM')}, ${fmtVND(total)}`}
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
          return (
            <button
              key={day.toISOString()}
              type="button"
              className={`m-dc${isToday ? ' is-today' : ''}${future ? ' is-future' : ''}`}
              aria-label={format(day, 'EEEE d MMMM')}
              aria-current={isToday ? 'date' : undefined}
              onClick={() => openDay(day)}
            >
              <b>{format(day, 'd')}</b>
            </button>
          );
        })}
      </div>
      <p className="m-hint">Tap a date or a bar to open that day in Week</p>
    </div>
  );
}
