'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { parseISO } from 'date-fns';
import { useFinance } from '../contexts/FinanceContext';
import { useUnsavedChanges } from '../hooks/useUnsavedChanges';
import { errorMessage } from '../services/auth';
import { createFinanceApi } from '../services/finance';
import { adjacentPeriodDate, isPastPeriod, parsePeriodParam } from '../lib/periods';
import type { PlanPeriodSummary } from '../lib/periodSummary';
import { PeriodRunway } from './PeriodRunway';
import { PlannedSpendings } from './PlannedSpendings';
import type { PlanEditorState } from './PlannedSpendings';
import '../styles/UserProfile.css';
import '../styles/Plans.css';

const api = createFinanceApi();
const dayLabel = (date: string) => parseISO(date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
const money = (amount: number) => `${amount.toLocaleString('vi-VN', { maximumFractionDigits: 0 })} ₫`;

/**
 * Everything expected to come in or go out in one budget period: income, commitments and estimates.
 * `?period=YYYY-MM-DD` selects the period containing that date (default: the current one).
 * `?edit=<planId>&from=<date>` opens a plan's editor (the day view's "Series" button).
 */
export function PlansPage() {
  const { incomes, spendings, plans, settings } = useFinance();
  const search = useSearchParams();
  const router = useRouter();
  const [planEditor, setPlanEditor] = useState<PlanEditorState>({ dirty: false, busy: false });
  useUnsavedChanges(planEditor.dirty || planEditor.busy);
  const onPlanEditor = useCallback((state: PlanEditorState) => setPlanEditor(state), []);

  // A bad or missing ?period= means the current period.
  const periodDate = parsePeriodParam(search.get('period'));

  const editId = search.get('edit');
  const from = search.get('from');

  // The server sums the whole budget period (it may straddle two months), so the page does not
  // depend on which months other pages happened to load. A late response for older data is ignored.
  const [loaded, setLoaded] = useState<{ for: string | null; summary: PlanPeriodSummary } | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  // A summary of another period is not shown while the wanted one loads.
  const summary = loaded && loaded.for === periodDate ? loaded.summary : null;
  useEffect(() => {
    let latest = true;
    api.getPlanSummary(periodDate ?? undefined).then(
      next => { if (latest) { setLoaded({ for: periodDate, summary: next }); setSummaryError(null); } },
      failure => { if (latest) setSummaryError(errorMessage(failure)); },
    );
    return () => { latest = false; };
  }, [periodDate, plans, incomes, spendings, settings.budgetPeriod]);

  const period = summary?.period;
  const past = summary ? isPastPeriod(summary.period, summary.today) : false;
  // The editor deep link waits for the period, so a past period never opens it.
  const initialEdit = useMemo(() => (editId && summary && !past ? { id: editId, from: from ?? undefined } : null), [editId, from, summary, past]);
  // Neighbouring periods come from the summary's own boundaries, so the page and the server agree.
  const goTo = (direction: 'previous' | 'next') => {
    if (planEditor.dirty && !window.confirm('Discard unsaved plan changes?')) return;
    if (summary) router.replace(`/plans?period=${adjacentPeriodDate(summary.period, direction)}`);
  };
  const periodLabel = period ? `${dayLabel(period.start)} – ${dayLabel(period.end)}` : null;
  const label = (payment: { source: string; name: string }) => payment.name ? `${payment.source} · ${payment.name}` : payment.source;
  // Paycheck mode lists each payday of the chosen income. Other modes list one line per income, not every payment.
  const paymentLines = useMemo(() => {
    if (!summary) return [];
    if (summary.period.mode === 'paycheck') {
      const chosen = settings.budgetPeriod?.paycheckIncomeId;
      return summary.payments.filter(payment => payment.incomeId === chosen)
        .map((payment, index) => ({ key: `${payment.incomeId}-${payment.date}-${index}`, label: `${dayLabel(payment.date)} · ${label(payment)}`, total: payment.amount }));
    }
    const byIncome = new Map<string, { key: string; label: string; total: number; count: number; amount: number }>();
    for (const payment of summary.payments) {
      const line = byIncome.get(payment.incomeId) ?? { key: payment.incomeId, label: label(payment), total: 0, count: 0, amount: payment.amount };
      line.total = Math.round((line.total + payment.amount) * 100) / 100;
      line.count += 1;
      byIncome.set(payment.incomeId, line);
    }
    return [...byIncome.values()].map(line => ({ key: line.key, label: line.count > 1 ? `${line.label} · ${line.count} × ${money(line.amount)}` : line.label, total: line.total }));
  }, [summary, settings.budgetPeriod?.paycheckIncomeId]);

  return (
    <div className="user-profile hide-scrollbar animate-fade-in">
      <section className="profile-panel" aria-labelledby="plans-heading">
        <div className="profile-panel-head">
          <div>
            <h2 id="plans-heading">Plans{periodLabel && <span className="plans-period"> · {periodLabel}</span>}</h2>
            <p>Everything you expect to receive or spend. Planned spending becomes a real transaction when its time passes, and past transactions never change.</p>
          </div>
          <div className="plans-page-tools">
            <button type="button" className="profile-icon-button" aria-label="Previous period" disabled={!summary} onClick={() => goTo('previous')}><ChevronLeft size={18} aria-hidden="true" /></button>
            <button type="button" className="profile-icon-button" aria-label="Next period" disabled={!summary} onClick={() => goTo('next')}><ChevronRight size={18} aria-hidden="true" /></button>          </div>
        </div>
        {summaryError && <p className="profile-error" role="alert">Could not load the period summary: {summaryError}</p>}
        {!summary && !summaryError && <p className="profile-card profile-empty" role="status">Loading the period summary…</p>}
        {summary && (
          <>
            <PeriodRunway
              className="profile-card plans-runway"
              income={summary.income}
              spent={summary.spent}
              committed={summary.committed}
              estimates={summary.tentative}
              start={summary.period.start}
              end={summary.period.end}
              today={summary.today}
              heading={<><b>{period?.mode === 'paycheck' ? `Until ${dayLabel(summary.period.nextStart)}` : 'This period'}</b> · {periodLabel}</>}
            />
            {paymentLines.length > 0 && (
              <ul className="profile-card plans-payments" aria-label={period?.mode === 'paycheck' ? 'Paychecks in this period' : 'Income in this period'}>
                {paymentLines.map(line => <li key={line.key}>{line.label} <b>{money(line.total)}</b></li>)}
              </ul>
            )}
          </>
        )}
        {past && <p className="profile-card profile-empty" role="status">This period is over. You can look at it, but plans are changed in the current or a coming period.</p>}
        <div className="profile-card plans-explain">
          <div><b>Sure</b>: a fixed amount and date, like rent, bills and subscriptions. It carries a Sure badge and a solid outline.</div>
          <div><b>Estimate</b>: roughly this much, like food, coffee and fuel. Dashed and prefixed with ~; adjust single days freely.</div>
          <div>Pay and income sources are managed in Profile. <Link href="/profile#income">Pay and income sources</Link></div>
        </div>
      </section>
      <PlannedSpendings disabled={false} onEditorStateChange={onPlanEditor} initialEdit={initialEdit} period={summary?.period ?? null} today={summary?.today} readOnly={past} />
    </div>
  );
}
