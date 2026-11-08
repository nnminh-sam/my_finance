'use client';

import { useState, type ReactNode } from 'react';
import { clsx } from 'clsx';
import { runwayModel, type RunwayModel } from '../lib/runway';
import { Money, RunwayBar, percentOf, runwayHeadline, shortMoney } from './PeriodRunway';
import '../styles/PeriodRunway.css';
import '../styles/PeriodSummary.css';

export interface PeriodSummaryProps {
  income: number;
  recurringIncome: number;
  oneTimeIncome: number;
  spent: number;
  committed: number; // planned and marked sure
  estimates: number; // planned as estimates
  start: string; // YYYY-MM-DD
  end: string; // YYYY-MM-DD
  today: string; // YYYY-MM-DD
  tools: ReactNode;
  children?: ReactNode; // notes shown at the bottom, like the pay cycle hint
  className?: string;
}

function Headline({ model, income, start, end, size }: { model: RunwayModel; income: number; start: string; end: string; size: 'panel' | 'strip' }) {
  const { noIncome, over, label, side } = runwayHeadline(model, income, start, end);
  const swatch = <span className={clsx('runway-swatch', noIncome ? 'runway-swatch-none' : over ? 'runway-swatch-over' : 'runway-seg-left')} aria-hidden="true" />;
  const value = noIncome
    ? <span className="runway-muted">Income not set</span>
    : <Money amount={Math.abs(model.left)} className={over ? 'runway-negative' : 'runway-left'} />;
  if (size === 'strip') {
    return (
      <div className="period-strip-headline">
        <span className="runway-hero-label">{swatch}{noIncome ? 'Left' : over ? 'Over by' : 'Left'}</span>
        <span className="period-strip-value" data-seg="left">{value}</span>
        {!noIncome && !over && model.perDay !== null && <span className="period-strip-per"><b>{shortMoney(model.perDay)}</b>/day</span>}
      </div>
    );
  }
  return (
    <div className="period-side-headline">
      <div className="runway-hero-label">{swatch}{label}</div>
      <div className="period-side-value" data-seg="left">{value}</div>
      {side && <div className="period-side-sub">{side}</div>}
    </div>
  );
}

/** How spending so far compares with spending the income evenly across the period. */
function Pace({ model, income, spent }: { model: RunwayModel; income: number; spent: number }) {
  if (model.day === null || income <= 0) return null;
  const even = Math.round((income * model.day) / model.totalDays);
  const gap = spent - even;
  return (
    <div className="period-side-section">
      <h3>Pace</h3>
      <p>
        Spending evenly would be <b><Money amount={even} /></b> by today.{' '}
        {gap > 0 ? <>You’ve spent <b><Money amount={gap} /></b> more.</> : gap < 0 ? <>You’ve spent <b><Money amount={-gap} /></b> less.</> : 'You’re right on it.'}
      </p>
    </div>
  );
}

/** A small calendar of the other kind of period: the pay cycle in Month view, the month in Pay cycle view. */
export interface MiniCalendarSpec {
  title: ReactNode;
  start: string; // YYYY-MM-DD: only days from start to end are drawn
  end: string;
  focusStart: string; // the page in view; days outside it are muted
  focusEnd: string;
  onPick?: (date: string) => void;
}

const WEEKDAY_INITIALS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const MINI_DAY_MS = 86_400_000;
const miniDayNumber = (date: string) => Math.round(Date.parse(`${date}T00:00:00Z`) / MINI_DAY_MS);
const miniDate = (day: number) => new Date(day * MINI_DAY_MS).toISOString().slice(0, 10);

function MiniCalendar({ spec, today }: { spec: MiniCalendarSpec; today: string }) {
  const first = miniDayNumber(spec.start), last = miniDayNumber(spec.end);
  const lead = (new Date(first * MINI_DAY_MS).getUTCDay() + 6) % 7; // Monday first
  const cells: (string | null)[] = [...Array<null>(lead).fill(null)];
  for (let day = first; day <= last; day++) cells.push(miniDate(day));
  while (cells.length % 7) cells.push(null);
  return (
    <div className="period-side-section period-mini">
      <h3>{spec.title}</h3>
      <div className="period-mini-grid" role="grid">
        {WEEKDAY_INITIALS.map((initial, index) => <span key={`h${index}`} className="period-mini-head" aria-hidden="true">{initial}</span>)}
        {cells.map((date, index) => date === null ? <span key={`e${index}`} /> : (
          <button
            key={date}
            type="button"
            className={clsx(
              'period-mini-day',
              (date < spec.focusStart || date > spec.focusEnd) && 'period-mini-muted',
              date === today && 'period-mini-today',
            )}
            aria-label={`Open ${date}`}
            aria-current={date === today ? 'date' : undefined}
            onClick={() => spec.onPick?.(date)}
          >
            {Number(date.slice(8, 10))}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * The period summary as a side panel beside the calendar: what is left, the bar, every amount,
 * a small calendar of the other period kind and pace. The top bar names the period.
 */
export function PeriodSidePanel({ mini, ...props }: PeriodSummaryProps & { mini?: MiniCalendarSpec | null }) {
  const { income, recurringIncome, oneTimeIncome, spent, committed, estimates, start, end, today } = props;
  const model = runwayModel({ income, spent, committed, estimates, start, end, today });
  const rows = [
    { key: 'spent', name: 'Spent so far', amount: spent },
    { key: 'committed', name: 'Committed', amount: committed },
    { key: 'estimates', name: 'Estimates', amount: estimates },
  ];
  const over = income > 0 && model.left < 0;
  return (
    <aside className={clsx('runway period-side', props.className)} aria-label="Period summary">
      {props.tools}
      <Headline model={model} income={income} start={start} end={end} size="panel" />
      <RunwayBar model={model} income={income} markLabels={false} />

      <dl className="period-side-rows">
        {rows.map(row => (
          <div key={row.key} data-seg={row.key} className={clsx(row.amount === 0 && 'period-side-zero')}>
            <dt><span className={`runway-swatch runway-seg-${row.key}`} aria-hidden="true" />{row.name}</dt>
            <dd><Money amount={row.amount} /></dd>
            <dd className="period-side-pct">{percentOf(row.amount, income)}</dd>
          </div>
        ))}
        {income > 0 && (
          <div data-seg="left">
            <dt><span className={clsx('runway-swatch', over ? 'runway-swatch-over' : 'runway-seg-left')} aria-hidden="true" />{over ? 'Over by' : 'Left'}</dt>
            <dd><Money amount={Math.abs(model.left)} className={over ? 'runway-negative' : 'runway-left'} /></dd>
            <dd className="period-side-pct">{over ? null : percentOf(model.left, income)}</dd>
          </div>
        )}
        <div className="period-side-total">
          <dt><span className="runway-swatch period-side-income" aria-hidden="true" />Income</dt>
          <dd><Money amount={income} className="runway-income" /></dd>
          <dd className="period-side-pct" />
        </div>
        {income > 0 && (
          <>
            <div className="period-side-sub-row"><dt>Recurring</dt><dd><Money amount={recurringIncome} /></dd><dd /></div>
            <div className="period-side-sub-row"><dt>One-time</dt><dd><Money amount={oneTimeIncome} /></dd><dd /></div>
          </>
        )}
      </dl>

      {mini && <MiniCalendar spec={mini} today={today} />}

      <Pace model={model} income={income} spent={spent} />

      {props.children}
    </aside>
  );
}

/** The same summary as one slim line for narrower screens, with every amount one click away. */
export function PeriodStrip(props: PeriodSummaryProps) {
  const { income, recurringIncome, oneTimeIncome, spent, committed, estimates, start, end, today } = props;
  const model = runwayModel({ income, spent, committed, estimates, start, end, today });
  const [open, setOpen] = useState(false);
  return (
    <section className={clsx('runway period-strip', props.className)} aria-label="Period summary">
      <div className="period-strip-row">
        <Headline model={model} income={income} start={start} end={end} size="strip" />
        <RunwayBar model={model} income={income} markLabels={false} className="period-strip-bar" />
        <div className="period-strip-legend">
          <span data-seg="spent"><span className="runway-swatch runway-seg-spent" aria-hidden="true" />Spent <b>{shortMoney(spent)}</b></span>
          {committed > 0 && <span data-seg="committed"><span className="runway-swatch runway-seg-committed" aria-hidden="true" />Committed <b>{shortMoney(committed)}</b></span>}
          {estimates > 0 && <span data-seg="estimates"><span className="runway-swatch runway-seg-estimates" aria-hidden="true" />Est. <b>{shortMoney(estimates)}</b></span>}
          <span><span className="runway-swatch period-side-income" aria-hidden="true" />of <b className="runway-income">{shortMoney(income)}</b></span>
        </div>
        <div className="period-strip-tools">
          <button type="button" className="period-strip-details" aria-expanded={open} onClick={() => setOpen(value => !value)}>
            {open ? 'Hide' : 'Details'}
          </button>
          {props.tools}
        </div>
      </div>
      {open && (
        <dl className="period-strip-grid">
          <div><dt>Income</dt><dd><Money amount={income} className="runway-income" /></dd><dd>Recurring {shortMoney(recurringIncome)} · One-time {shortMoney(oneTimeIncome)}</dd></div>
          <div data-seg="spent"><dt>Spent so far</dt><dd><Money amount={spent} /></dd><dd>{percentOf(spent, income) ?? ''}{income > 0 ? ' of income' : ''}</dd></div>
          <div data-seg="committed"><dt>Committed</dt><dd><Money amount={committed} /></dd><dd>{committed === 0 ? 'Nothing yet' : `${percentOf(committed, income) ?? ''} of income`}</dd></div>
          <div data-seg="estimates"><dt>Estimates</dt><dd><Money amount={estimates} /></dd><dd>{estimates === 0 ? 'None' : `${percentOf(estimates, income) ?? ''} of income`}</dd></div>
          <div><dt>Per day</dt><dd>{runwayHeadline(model, income, start, end).side}</dd></div>
        </dl>
      )}
      {props.children}
    </section>
  );
}
