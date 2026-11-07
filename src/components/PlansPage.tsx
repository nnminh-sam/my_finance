'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Sparkles } from 'lucide-react';
import { parseISO } from 'date-fns';
import { useFinance } from '../contexts/FinanceContext';
import { useFinanceShell } from '../contexts/FinanceShellContext';
import { useUnsavedChanges } from '../hooks/useUnsavedChanges';
import { errorMessage } from '../services/auth';
import { createFinanceApi } from '../services/finance';
import type { PlanPeriodSummary } from '../lib/periodSummary';
import { IncomeSources } from './IncomeSources';
import type { IncomeEditorState } from './IncomeSources';
import { PlannedSpendings } from './PlannedSpendings';
import type { PlanEditorState } from './PlannedSpendings';
import '../styles/UserProfile.css';
import '../styles/Plans.css';

const api = createFinanceApi();
const dayLabel = (date: string) => parseISO(date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
const money = (amount: number) => `${amount.toLocaleString('vi-VN', { maximumFractionDigits: 0 })} ₫`;

/**
 * Everything expected to come in or go out: income sources, commitments and estimates.
 * `?edit=<planId>&from=<date>` opens a plan's editor (the day view's "Series" button).
 */
export function PlansPage() {
  const { incomes, spendings, plans, settings } = useFinance();
  const { openPlanGuide } = useFinanceShell();
  const search = useSearchParams();
  const [planEditor, setPlanEditor] = useState<PlanEditorState>({ dirty: false, busy: false });
  const [incomeEditor, setIncomeEditor] = useState<IncomeEditorState>({ dirty: false, busy: false });
  useUnsavedChanges(planEditor.dirty || planEditor.busy || incomeEditor.dirty || incomeEditor.busy);
  const onPlanEditor = useCallback((state: PlanEditorState) => setPlanEditor(state), []);
  const onIncomeEditor = useCallback((state: IncomeEditorState) => setIncomeEditor(state), []);

  const editId = search.get('edit');
  const from = search.get('from');
  const initialEdit = useMemo(() => (editId ? { id: editId, from: from ?? undefined } : null), [editId, from]);

  // The server sums the whole budget period (it may straddle two months), so the page does not
  // depend on which months other pages happened to load. A late response for older data is ignored.
  const [summary, setSummary] = useState<PlanPeriodSummary | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  useEffect(() => {
    let latest = true;
    api.getPlanSummary().then(
      next => { if (latest) { setSummary(next); setSummaryError(null); } },
      failure => { if (latest) setSummaryError(errorMessage(failure)); },
    );
    return () => { latest = false; };
  }, [plans, incomes, spendings, settings.budgetPeriod]);

  const period = summary?.period;
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
  const leftLabel = period?.mode === 'paycheck' ? `Left until ${dayLabel(period.nextStart)}` : 'Left this period';

  return (
    <div className="user-profile hide-scrollbar animate-fade-in">
      <section className="profile-panel" aria-labelledby="plans-heading">
        <div className="profile-panel-head">
          <div>
            <h2 id="plans-heading">Plans{periodLabel && <span className="plans-period"> · {periodLabel}</span>}</h2>
            <p>Everything you expect to receive or spend. Planned spending becomes a real transaction when its time passes, and past transactions never change.</p>
          </div>
          <div className="plans-page-tools">
            <button type="button" className="profile-button profile-button-primary" onClick={() => openPlanGuide()}><Sparkles size={16} aria-hidden="true" />Plan your month</button>
          </div>
        </div>
        {summaryError && <p className="profile-error" role="alert">Could not load the period summary: {summaryError}</p>}
        {!summary && !summaryError && <p className="profile-card profile-empty" role="status">Loading the period summary…</p>}
        {summary && (
          <>
            <dl className="profile-card profile-summary" aria-label={`${periodLabel} at a glance`}>
              <div><dt>Income this period</dt><dd className="profile-positive">{money(summary.income)}</dd></div>
              <div><dt>Spent so far</dt><dd>{money(summary.spent)}</dd></div>
              <div><dt>Committed</dt><dd>{money(summary.committed)}</dd></div>
              <div><dt>Estimates</dt><dd>{money(summary.tentative)}</dd></div>
              <div><dt>{leftLabel}</dt><dd style={{ color: summary.left >= 0 ? 'var(--primary)' : 'var(--danger)' }}>{money(summary.left)}</dd></div>
            </dl>
            {paymentLines.length > 0 && (
              <ul className="profile-card plans-payments" aria-label={period?.mode === 'paycheck' ? 'Paychecks in this period' : 'Income in this period'}>
                {paymentLines.map(line => <li key={line.key}>{line.label} <b>{money(line.total)}</b></li>)}
              </ul>
            )}
          </>
        )}
        <div className="profile-card plans-explain">
          <div><b>Sure</b>: a fixed amount and date, like rent, bills and subscriptions. Drawn with a solid outline.</div>
          <div><b>Estimate</b>: roughly this much, like food, coffee and fuel. Dashed and prefixed with ~; adjust single days freely.</div>
        </div>
      </section>
      <PlannedSpendings disabled={false} onEditorStateChange={onPlanEditor} initialEdit={initialEdit} />
      <IncomeSources disabled={false} onEditorStateChange={onIncomeEditor} />
    </div>
  );
}
