'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { addMonths, format, parseISO } from 'date-fns';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useFinance } from '../../contexts/FinanceContext';
import { useFinanceShell } from '../../contexts/FinanceShellContext';
import { useSettings } from '../../contexts/SettingsContext';
import { analysisPeriodFor, computeMonthlyAnalytics, fmtCompact, stepAnalysisDate, fmtPct, fmtVND, WEEKDAYS, WEEKDAYS_LONG } from '../../lib/analytics';
import { pageHref } from '../../lib/navigation';
import { DEFAULT_BUDGET_PERIOD, DEFAULT_SHOW_BY, periodRangeLabel } from '../../lib/periods';
import { CumulativeChart } from '../charts';
import { InfoCard, haptic } from './MobileUi';
import '../../styles/Mobile.css';

type Pane = 'overview' | 'categories' | 'patterns';
const PANES: { id: Pane; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'categories', label: 'Categories' },
  { id: 'patterns', label: 'Patterns' },
];
const FALLBACK_COLORS = ['#06b6d4', '#f43f5e', '#84cc16', '#a855f7', '#f97316', '#14b8a6', '#e11d48'];
/** Time-of-day buckets replace the desktop's 24 hourly columns so each cell is a usable tap target. */
const BUCKETS: { label: string; hours: number[] }[] = [
  { label: 'Morning', hours: [5, 6, 7, 8, 9, 10] },
  { label: 'Midday', hours: [11, 12, 13] },
  { label: 'Afternoon', hours: [14, 15, 16, 17] },
  { label: 'Evening', hours: [18, 19, 20, 21] },
  { label: 'Night', hours: [22, 23, 0, 1, 2, 3, 4] },
];

/** F · Analytics (as D): Overview / Categories / Patterns, at most four cards each. */
export function MobileAnalytics() {
  const { currentDate } = useFinanceShell();
  const { settings } = useSettings();
  const { spendings, incomes } = useFinance();
  const router = useRouter();
  const [pane, setPane] = useState<Pane>('overview');
  const [selectedCat, setSelectedCat] = useState<string | null>(null);
  const [selectedCell, setSelectedCell] = useState<{ b: number; w: number } | null>(null);
  const [selectedDay, setSelectedDay] = useState<number | null>(null);

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const dateKey = format(currentDate, 'yyyy-MM-dd');
  const budgetPeriod = settings.budgetPeriod ?? DEFAULT_BUDGET_PERIOD;
  const showBy = settings.showBy ?? DEFAULT_SHOW_BY;
  // A pay period follows Show by. It is undefined for a calendar month, which keeps the month analysis.
  const period = useMemo(() => analysisPeriodFor(budgetPeriod, showBy, incomes, dateKey), [budgetPeriod, showBy, incomes, dateKey]);
  const a = useMemo(
    () => computeMonthlyAnalytics(new Date(year, month, 1), settings, spendings, incomes, period),
    [year, month, settings, spendings, incomes, period],
  );

  const changeMonth = (by: number) => {
    // A pay period moves to the neighbouring period, a calendar month to the neighbouring month.
    const stepped = stepAnalysisDate(budgetPeriod, showBy, incomes, dateKey, by < 0 ? 'previous' : 'next');
    router.replace(pageHref('analytics', stepped ? parseISO(stepped) : addMonths(new Date(year, month, 1), by)));
  };
  const rangeLabel = period ? periodRangeLabel({ start: a.periodStart, end: a.periodEnd }) : null;
  const catMeta = (id: string, i: number) => {
    const c = settings.categories.find(x => x.id === id);
    return { name: c?.name ?? id, color: c?.color ?? FALLBACK_COLORS[i % FALLBACK_COLORS.length] };
  };

  const heat = useMemo(() => {
    const grid = BUCKETS.map(bucket => a.punchCard.map(row => bucket.hours.reduce(
      (acc, h) => ({ amount: acc.amount + row[h].amount, count: acc.count + row[h].count }), { amount: 0, count: 0 },
    )));
    return { grid, max: Math.max(1, ...grid.flat().map(cell => cell.amount)) };
  }, [a.punchCard]);

  const partial = a.elapsedDays < a.daysInMonth;
  const empty = a.isFutureMonth || !a.hasData;
  const maxCat = Math.max(1, ...a.categories.map(c => c.total));
  const elapsed = a.daily.slice(0, Math.max(a.elapsedDays, 0));
  const maxDay = Math.max(1, ...elapsed.map(d => d.total));

  return (
    <div className="m-screen m-scroll">
      <header className="m-nav">
        <div>
          <div className="m-sub">{format(a.monthStart, 'yyyy')}</div>
          <h1>Analytics</h1>
        </div>
        <div className="m-wnav">
          <button type="button" aria-label={period ? 'Previous period' : 'Previous month'} onClick={() => changeMonth(-1)}><ChevronLeft size={20} /></button>
          <span className="m-wnav-label">{rangeLabel ?? format(a.monthStart, 'MMM')}</span>
          <button type="button" aria-label={period ? 'Next period' : 'Next month'} onClick={() => changeMonth(1)}><ChevronRight size={20} /></button>
        </div>
      </header>

      <div className="m-pad">
        <div className="m-seg" role="tablist" aria-label="Analytics section">
          {PANES.map(p => (
            <button key={p.id} type="button" role="tab" aria-selected={pane === p.id} className={pane === p.id ? 'is-on' : undefined} onClick={() => { haptic(5); setPane(p.id); }}>
              {p.label}
            </button>
          ))}
        </div>

        {empty ? (
          <div className="m-card m-empty-card">
            <b>No spending in {rangeLabel ?? format(a.monthStart, 'MMMM yyyy')}</b>
            <p className="m-muted">{a.isFutureMonth ? `This ${period ? 'period' : 'month'} hasn’t started yet.` : 'Add some expenses and your analytics will appear here.'}</p>
          </div>
        ) : (
          <>
            {pane === 'overview' && (
              <>
                <div className="m-kpis">
                  <div className="m-kpi"><small>{rangeLabel ? 'Spent this period' : `Spent in ${format(a.monthStart, 'MMM')}`}</small><b>{fmtCompact(a.total)} ₫</b></div>
                  <div className="m-kpi"><small>Daily average</small><b>{fmtCompact(a.dailyMean)} ₫</b></div>
                  <div className="m-kpi"><small>{partial ? 'Projected' : period ? 'Period total' : 'Month total'}</small><b>{fmtCompact(a.projectedTotal)} ₫</b></div>
                  <div className="m-kpi">
                    <small>Vs. last month</small>
                    <b style={{ color: a.momChange === null ? undefined : a.momChange > 0 ? 'var(--danger)' : 'var(--success)' }}>
                      {a.momChange === null ? '—' : `${a.momChange > 0 ? '+' : '−'}${fmtPct(Math.abs(a.momChange))}`}
                    </b>
                  </div>
                </div>
                <InfoCard
                  title="Spending forecast"
                  info="Your running total this month. The dashed line is where the month will probably end if you keep your current pace; the shaded band is the likely range. Touch the chart to read any day."
                >
                  <CumulativeChart daily={a.daily} elapsedDays={a.elapsedDays} projection={a.projection} income={a.income} />
                </InfoCard>
                {a.income > 0 && (
                  <InfoCard title="Income left" info="Monthly income minus what you are projected to spend this month.">
                    <div className="m-prog"><span style={{ width: `${Math.min(1, a.projectedTotal / a.income) * 100}%`, background: a.projectedTotal > a.income ? 'var(--danger)' : undefined }} /></div>
                    <small className="m-muted">{fmtVND(Math.max(0, a.income - a.projectedTotal))} of {fmtVND(a.income)} · savings rate {fmtPct(a.savingsRate)}</small>
                  </InfoCard>
                )}
              </>
            )}

            {pane === 'categories' && (
              <InfoCard title="By category" info="How this month’s spending splits across your categories. Tap a bar to see the exact amount, its share and the change against the same days last month.">
                <div className="m-bars">
                  {a.categories.map((c, i) => {
                    const meta = catMeta(c.id, i);
                    return (
                      <button key={c.id} type="button" className={`m-bar${selectedCat === c.id ? ' is-sel' : ''}`} aria-pressed={selectedCat === c.id} onClick={() => setSelectedCat(c.id)}>
                        <span className="m-bl">{meta.name}</span>
                        <span className="m-bt"><span style={{ width: `${(100 * c.total) / maxCat}%`, background: meta.color }} /></span>
                      </button>
                    );
                  })}
                </div>
                <div className="m-legend" aria-live="polite">
                  {(() => {
                    const i = a.categories.findIndex(c => c.id === selectedCat);
                    if (i < 0) return <span className="m-muted">Tap a bar for details.</span>;
                    const c = a.categories[i];
                    return (
                      <>
                        <b>{catMeta(c.id, i).name}</b>: {fmtVND(c.total)} · {fmtPct(c.share)} of spending · {c.count} expense{c.count === 1 ? '' : 's'}
                        {c.change !== null && <> · {c.change > 0 ? '+' : '−'}{fmtPct(Math.abs(c.change))} vs last month</>}
                      </>
                    );
                  })()}
                </div>
              </InfoCard>
            )}

            {pane === 'patterns' && (
              <>
                <InfoCard title="When you spend" info="Adds up this month’s expenses by weekday and time of day. Darker means more. Tap a cell for details.">
                  <div className="m-heat" style={{ gridTemplateColumns: '72px repeat(7, 1fr)' }}>
                    <span />
                    {WEEKDAYS.map(w => <span key={w} className="m-hh">{w[0]}</span>)}
                    {heat.grid.map((row, b) => (
                      <div key={BUCKETS[b].label} style={{ display: 'contents' }}>
                        <span className="m-hl">{BUCKETS[b].label}</span>
                        {row.map((cell, w) => (
                          <button
                            key={w}
                            type="button"
                            className={selectedCell?.b === b && selectedCell.w === w ? 'is-sel' : undefined}
                            style={{ opacity: cell.amount ? 0.18 + (0.82 * cell.amount) / heat.max : 0.06 }}
                            aria-label={`${WEEKDAYS_LONG[w]} ${BUCKETS[b].label.toLowerCase()}: ${fmtVND(cell.amount)}`}
                            onClick={() => setSelectedCell({ b, w })}
                          />
                        ))}
                      </div>
                    ))}
                  </div>
                  <div className="m-legend" aria-live="polite">
                    {selectedCell ? (
                      <><b>{WEEKDAYS_LONG[selectedCell.w]} {BUCKETS[selectedCell.b].label.toLowerCase()}</b>: {fmtVND(heat.grid[selectedCell.b][selectedCell.w].amount)} · {heat.grid[selectedCell.b][selectedCell.w].count} expense{heat.grid[selectedCell.b][selectedCell.w].count === 1 ? '' : 's'}</>
                    ) : <span className="m-muted">Tap a cell for details.</span>}
                  </div>
                </InfoCard>
                <InfoCard title="Daily spending" info="One bar per day this month. Tap a bar to see that day’s total; tap again to open the day in Week.">
                  <div className="m-cols">
                    {elapsed.map((d, i) => (
                      <button
                        key={i}
                        type="button"
                        className={selectedDay === i ? 'is-sel' : undefined}
                        style={{ height: `${Math.max(4, (100 * d.total) / maxDay)}%` }}
                        aria-label={`${format(d.date, 'EEE d MMM')}: ${fmtVND(d.total)}`}
                        onClick={() => (selectedDay === i ? router.push(pageHref('week', d.date)) : setSelectedDay(i))}
                      />
                    ))}
                  </div>
                  <div className="m-legend" aria-live="polite">
                    {selectedDay !== null && elapsed[selectedDay]
                      ? <><b>{format(elapsed[selectedDay].date, 'EEE d MMM')}</b>: {fmtVND(elapsed[selectedDay].total)}</>
                      : <span className="m-muted">Average {fmtVND(a.dailyMean)} a day.</span>}
                  </div>
                </InfoCard>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
