'use client';

import { useCallback, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Sparkles } from 'lucide-react';
import { useFinance } from '../contexts/FinanceContext';
import { useFinanceShell } from '../contexts/FinanceShellContext';
import { useUnsavedChanges } from '../hooks/useUnsavedChanges';
import { getMonthIncome, incomeMonth } from '../lib/income';
import { isoDate } from '../lib/quickEntry';
import { IncomeSources } from './IncomeSources';
import type { IncomeEditorState } from './IncomeSources';
import { PlannedSpendings } from './PlannedSpendings';
import type { PlanEditorState } from './PlannedSpendings';
import '../styles/UserProfile.css';
import '../styles/Plans.css';

const money = (amount: number) => `${amount.toLocaleString('vi-VN', { maximumFractionDigits: 0 })} ₫`;

/**
 * Everything expected to come in or go out: income sources, commitments and estimates.
 * `?edit=<planId>&from=<date>` opens a plan's editor (the day view's "Series" button).
 */
export function PlansPage() {
  const { incomes, spendings, projectedBetween } = useFinance();
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

  const now = new Date();
  const month = incomeMonth(now);
  const monthStart = `${month}-01`;
  const monthEnd = isoDate(new Date(now.getFullYear(), now.getMonth() + 1, 0));
  const income = getMonthIncome(month, incomes).totalIncome;
  const spent = spendings.filter(s => s.date >= monthStart && s.date <= monthEnd).reduce((sum, s) => sum + s.amount, 0);
  const planned = projectedBetween(monthStart, monthEnd);
  const commitments = planned.filter(o => o.sure).reduce((sum, o) => sum + o.amount, 0);
  const estimates = planned.filter(o => !o.sure).reduce((sum, o) => sum + o.amount, 0);
  const left = income - spent - commitments - estimates;
  const monthLabel = now.toLocaleDateString('en-US', { month: 'long' });

  return (
    <div className="user-profile hide-scrollbar animate-fade-in">
      <section className="profile-panel" aria-labelledby="plans-heading">
        <div className="profile-panel-head">
          <div>
            <h2 id="plans-heading">Plans</h2>
            <p>Everything you expect to receive or spend. Planned spending becomes a real transaction when its time passes, and past transactions never change.</p>
          </div>
          <div className="plans-page-tools">
            <button type="button" className="profile-button profile-button-primary" onClick={() => openPlanGuide()}><Sparkles size={16} aria-hidden="true" />Plan your month</button>
          </div>
        </div>
        <dl className="profile-card profile-summary" aria-label={`${monthLabel} at a glance`}>
          <div><dt>Income in {monthLabel}</dt><dd className="profile-positive">{money(income)}</dd></div>
          <div><dt>Spent so far</dt><dd>{money(spent)}</dd></div>
          <div><dt>Still planned</dt><dd>{money(commitments + estimates)}</dd></div>
          <div><dt>Projected left over</dt><dd style={{ color: left >= 0 ? 'var(--primary)' : 'var(--danger)' }}>{money(left)}</dd></div>
        </dl>
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
