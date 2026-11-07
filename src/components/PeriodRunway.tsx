'use client';

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import Link from 'next/link';
import { clsx } from 'clsx';
import { periodDayLabel } from '../lib/periods';
import { placeLabels, runwayModel, type RunwayModel, type RunwaySegmentKey } from '../lib/runway';
import '../styles/PeriodRunway.css';

const NAMES: Record<RunwaySegmentKey, string> = { spent: 'Spent so far', committed: 'Committed', estimates: 'Estimates', left: 'Left' };
const EMPTY: Record<Exclude<RunwaySegmentKey, 'left'>, string> = { spent: 'Nothing spent yet', committed: 'Nothing committed', estimates: 'No estimates' };
const LABEL_GAP = 18;

export const whole = (amount: number) => Math.abs(amount).toLocaleString('vi-VN', { maximumFractionDigits: 0 });

export function Money({ amount, className }: { amount: number; className?: string }) {
  return <span className={clsx('runway-money', className)}>{amount < 0 ? '−' : ''}{whole(amount)}<span className="runway-currency">₫</span></span>;
}

/** 8.197.000 → "8,2M", 820.000 → "820k": for places too narrow for the full amount. */
export function shortMoney(amount: number): string {
  const abs = Math.abs(amount);
  if (abs >= 1e6) return `${(abs / 1e6).toLocaleString('vi-VN', { maximumFractionDigits: abs >= 1e7 ? 1 : 2 })}M`;
  if (abs >= 1e3) return `${Math.round(abs / 1e3).toLocaleString('vi-VN')}k`;
  return `${whole(abs)} ₫`;
}

export const percentOf = (amount: number, income: number) => (income > 0 ? `${Math.round((amount / income) * 100)}%` : null);
const edgeClass = (at: number) => (at < 15 ? 'runway-mark-start' : at > 85 ? 'runway-mark-end' : undefined);

/** The headline wording for what is left, shared by every period summary layout. */
export function runwayHeadline(model: RunwayModel, income: number, start: string, end: string) {
  const noIncome = income <= 0;
  const over = !noIncome && model.left < 0;
  const label = noIncome ? 'Left this period'
    : over ? (model.planned > 0 ? 'Plans go over income by' : 'Spent more than income by')
    : model.planned > 0 ? 'Left after plans' : 'Left this period';
  let side: ReactNode = null;
  if (noIncome) side = <Link href="/profile#income">Add your pay to see what’s left</Link>;
  else if (over && model.planned > 0 && model.status !== 'past') side = <>Cut <b><Money amount={-model.left} /></b> from plans to break even</>;
  else if (model.perDay !== null && model.daysLeft !== null) side = <><b><Money amount={model.perDay} /></b> a day for {model.daysLeft} {model.daysLeft === 1 ? 'day' : 'days'}</>;
  else if (model.status === 'upcoming') side = `Starts ${periodDayLabel(start)}`;
  else if (model.status === 'past') side = `Ended ${periodDayLabel(end)}`;
  return { noIncome, over, label, side };
}

/** The bar on its own. With `markLabels`, the pace and income marks carry a caption above the bar. */
export function RunwayBar({ model, income, markLabels = true, className }: { model: RunwayModel; income: number; markLabels?: boolean; className?: string }) {
  const describe = [
    ...model.segments.filter(segment => segment.key !== 'left').map(segment => `${segment.key} ${whole(segment.amount)} ₫`),
    income <= 0 ? 'income not set' : model.left < 0 ? `${whole(model.left)} ₫ over income` : `${whole(model.left)} ₫ left of ${whole(income)} ₫ income`,
  ].join(', ');
  const paceTitle = model.day !== null ? `Spending evenly, you would have spent ${whole((income * model.day) / model.totalDays)} ₫ by the end of today` : undefined;
  return (
    <div className={clsx('runway-bar-wrap', !markLabels && 'runway-bar-wrap-bare', className)}>
      <div className="runway-bar" role="img" aria-label={describe}>
        {model.segments.filter(segment => segment.width > 0).map(segment => (
          <span key={segment.key} data-seg={segment.key} className={`runway-seg runway-seg-${segment.key}`} style={{ width: `${segment.width}%` }} />
        ))}
        {model.incomeAt !== null && <span className="runway-over" style={{ left: `${model.incomeAt}%` }} />}
      </div>
      {model.paceAt !== null && (
        <span className={clsx('runway-mark', edgeClass(model.paceAt))} style={{ left: `${model.paceAt}%` }} title={paceTitle}>
          {markLabels && <span>Even pace today</span>}
        </span>
      )}
      {model.incomeAt !== null && (
        <span className={clsx('runway-mark runway-mark-income', edgeClass(model.incomeAt))} style={{ left: `${model.incomeAt}%` }}>
          {markLabels && <span>Income</span>}
        </span>
      )}
    </div>
  );
}

type LabelMode = 'full' | 'compact' | 'stack';

export interface PeriodRunwayProps {
  income: number;
  spent: number;
  committed: number; // planned and marked sure
  estimates: number; // planned as estimates
  recurringIncome?: number;
  oneTimeIncome?: number;
  start: string; // YYYY-MM-DD
  end: string; // YYYY-MM-DD
  today: string; // YYYY-MM-DD
  heading: ReactNode; // e.g. "Pay cycle · 5 Nov – 4 Dec"; "Day 3 of 30" is added for the current period
  tools?: ReactNode;
  children?: ReactNode; // shown at the bottom of the card
  className?: string;
}

/**
 * What is left in a budget period as one headline number, with a bar splitting income into spent,
 * committed, estimated and left. Each amount is labelled under its own part of the bar.
 */
export function PeriodRunway({ income, spent, committed, estimates, recurringIncome, oneTimeIncome, start, end, today, heading, tools, children, className }: PeriodRunwayProps) {
  const model = runwayModel({ income, spent, committed, estimates, start, end, today });
  const { noIncome, over, label, side } = runwayHeadline(model, income, start, end);

  const labels = model.segments.filter(segment => segment.key !== 'left' && segment.amount > 0);
  const empties = (['spent', 'committed', 'estimates'] as const).filter(key => model.segments.find(segment => segment.key === key)!.amount === 0);

  // Labels sit under their segment. Measure them at full length, then shortened, and stack them as a list
  // when even the short ones cannot share one row. The row width and the web font both change the fit.
  const rowRef = useRef<HTMLDivElement>(null);
  const [rowWidth, setRowWidth] = useState(0);
  const [fontsVersion, setFontsVersion] = useState(0);
  useLayoutEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    const update = () => setRowWidth(Math.round(row.getBoundingClientRect().width));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(row);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    let live = true;
    document.fonts?.ready.then(() => { if (live) setFontsVersion(version => version + 1); });
    return () => { live = false; };
  }, []);
  const labelKey = `${rowWidth}|${fontsVersion}|${labels.map(segment => `${segment.key}:${segment.amount}:${segment.start.toFixed(3)}`).join(',')}`;
  const [fit, setFit] = useState<{ key: string; mode: LabelMode; left: number[] | null }>({ key: '', mode: 'full', left: null });
  const layout = fit.key === labelKey ? fit : { key: labelKey, mode: 'full' as LabelMode, left: null };
  useLayoutEffect(() => {
    if (layout.left || layout.mode === 'stack' || !rowWidth || !labels.length) return;
    const row = rowRef.current;
    if (!row) return;
    const widths = Array.from(row.querySelectorAll<HTMLElement>('.runway-label'), element => element.offsetWidth);
    const left = placeLabels(labels.map(segment => (segment.start / 100) * rowWidth), widths, rowWidth, LABEL_GAP);
    setFit(left
      ? { key: labelKey, mode: layout.mode, left }
      : { key: labelKey, mode: layout.mode === 'full' ? 'compact' : 'stack', left: null });
  });

  return (
    <section className={clsx('runway', className)} aria-label="Period summary">
      <div className="runway-top">
        <div className="runway-eyebrow">
          {heading}
          {model.day !== null && <> · Day {model.day} of {model.totalDays}</>}
        </div>
        {tools}
      </div>

      <div className="runway-hero">
        <div>
          <div className="runway-hero-label">
            <span className={clsx('runway-swatch', noIncome ? 'runway-swatch-none' : over ? 'runway-swatch-over' : 'runway-seg-left')} aria-hidden="true" />
            {label}
          </div>
          <div className="runway-hero-value" data-seg="left">
            {noIncome ? <span className="runway-muted">Income not set</span> : <Money amount={Math.abs(model.left)} className={over ? 'runway-negative' : 'runway-left'} />}
          </div>
        </div>
        {side && <div className="runway-hero-side">{side}</div>}
      </div>

      <RunwayBar model={model} income={income} />

      <div ref={rowRef} className={clsx('runway-labels', layout.mode === 'stack' && 'runway-labels-stack')}>
        {labels.map((segment, index) => (
          <div key={segment.key} data-seg={segment.key} className="runway-label"
            style={{ '--runway-color': `var(--runway-${segment.key})`, left: layout.mode === 'stack' ? undefined : `${layout.left?.[index] ?? 0}px` } as CSSProperties}>
            <span className="runway-label-name">
              {NAMES[segment.key]}
              {percentOf(segment.amount, income) && <span className="runway-label-pct">{percentOf(segment.amount, income)}</span>}
            </span>
            <span className="runway-label-amount">
              {layout.mode === 'compact' ? shortMoney(segment.amount) : <Money amount={segment.amount} />}
            </span>
          </div>
        ))}
      </div>

      <div className="runway-foot">
        <span>Income <b className="runway-income"><Money amount={income} /></b></span>
        {recurringIncome !== undefined && oneTimeIncome !== undefined && income > 0 && (
          <>
            <span>Recurring <Money amount={recurringIncome} /></span>
            <span>One-time <Money amount={oneTimeIncome} /></span>
          </>
        )}
        {empties.map(key => <span key={key}>{EMPTY[key]}</span>)}
      </div>

      {children}
    </section>
  );
}
