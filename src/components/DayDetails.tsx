'use client';

import React, { useRef, useState } from 'react';
import { format } from 'date-fns';
import { useDialog } from '../contexts/DialogContext';
import { getSpendingsForDate, getTotalForDate, formatCompactSpending } from '../lib/spendings';
import { DEFAULT_BUDGET_PERIOD, DEFAULT_SHOW_BY, viewPeriodIncome } from '../lib/periods';
import { expectedPaydays } from '../lib/income';
import { IncomeRecordSheet } from './IncomeRecordSheet';
import {
  ArrowDown,
  ArrowDownLeft,
  ArrowUp,
  Briefcase,
  Car,
  ChevronLeft,
  CircleDollarSign,
  Coffee,
  Film,
  Gift,
  Heart,
  Home,
  Phone,
  Plus,
  Receipt,
  Repeat,
  ShoppingBag,
  Trash2,
  Utensils,
  CalendarRange,
  Check,
  Settings2,
  Pencil,
  SkipForward,
  Undo2,
} from 'lucide-react';
import type { PlanOccurrence } from '../lib/plans';
import { useRouter } from 'next/navigation';
import { pages } from '../lib/pages';
import { useSettings } from '../contexts/SettingsContext';
import { useFinance } from '../contexts/FinanceContext';
import type { Spending, Transaction } from '../types';
import { errorMessage } from '../services/auth';
import '../styles/ExpenseForm.css';

const ICONS = {
  Utensils,
  Car,
  Film,
  ShoppingBag,
  Receipt,
  CircleDollarSign,
  Coffee,
  Home,
  Heart,
  Briefcase,
  Gift,
  Phone,
};

function formatTime12h(time24: string): string {
  const parts = time24.split(':');
  if (parts.length < 2) return time24;
  const h = Number(parts[0]);
  const m = parts[1];
  if (!Number.isFinite(h)) return time24;
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m} ${period}`;
}

interface DayDetailsProps {
  date: Date;
  onBack: () => void;
  onAddExpense: () => void;
  onEditExpense: (spending: Spending) => void;
}

export const DayDetails: React.FC<DayDetailsProps> = (props) => (
  <DayDetailsContent key={format(props.date, 'yyyy-MM-dd')} {...props} />
);

const DayDetailsContent: React.FC<DayDetailsProps> = ({ date, onBack, onAddExpense, onEditExpense }) => {
  const { settings } = useSettings();
  const { spendings, incomes, received, plans, deleteSpending, deleteReceived, projectedBetween, setPlanException, clearPlanException, completePlanOccurrence } = useFinance();
  const router = useRouter();
  const { confirm } = useDialog();
  const daySpendings = getSpendingsForDate(date, spendings);
  const totalSpent = getTotalForDate(date, spendings);
  const dayKey = format(date, 'yyyy-MM-dd');
  // Money received on this day, and paydays on it that have not come yet.
  const dayReceived = received.filter(record => record.date === dayKey).sort((a, b) => a.time.localeCompare(b.time));
  const totalReceived = dayReceived.reduce((sum, record) => sum + record.amount, 0);
  const dayExpected = expectedPaydays(incomes, dayKey, dayKey);
  // The period line follows Show by: the calendar month, or the pay period that contains the day.
  const showBy = settings.showBy ?? DEFAULT_SHOW_BY;
  const periodIncome = viewPeriodIncome(settings.budgetPeriod ?? DEFAULT_BUDGET_PERIOD, showBy, incomes, dayKey, received);
  // One list in time order: a payment is recorded at the start of its day, so it comes first.
  const dayRows: ({ kind: 'expense'; item: Spending } | { kind: 'income'; item: Transaction })[] = [
    ...dayReceived.map(item => ({ kind: 'income' as const, item })),
    ...daySpendings.map(item => ({ kind: 'expense' as const, item })),
  ].sort((a, b) => a.item.time.localeCompare(b.item.time));
  const [editingReceived, setEditingReceived] = useState<Transaction | null>(null);
  const planned = projectedBetween(dayKey, dayKey);
  const plannedTotal = planned.reduce((sum, item) => sum + item.amount, 0);
  // Skipped days are hidden from projections, so list them here to allow undoing.
  const skipped = plans.filter(plan => plan.exceptions.some(item => item.date === dayKey && item.kind === 'skip')
    && `${dayKey}T${plan.time}` > plan.materializedThrough);
  const [changing, setChanging] = useState<{ planId: string; amount: string } | null>(null);
  const [planBusy, setPlanBusy] = useState(false);

  const runPlanAction = async (action: () => Promise<void>, done: string) => {
    if (mutationLock.current) return;
    mutationLock.current = true;
    setPlanBusy(true);
    setError(null);
    setNotice('');
    try {
      await action();
      setNotice(done);
      setChanging(null);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      mutationLock.current = false;
      setPlanBusy(false);
    }
  };

  const saveChangedAmount = (occurrence: PlanOccurrence) => {
    if (!changing) return;
    const amount = Number(changing.amount.replace(/[\s,._]/g, ''));
    if (!Number.isFinite(amount) || amount <= 0 || amount > 1e12) {
      setError('Enter an amount above 0 ₫.');
      return;
    }
    const plan = plans.find(item => item.id === occurrence.planId);
    const description = plan && occurrence.description !== plan.description ? occurrence.description : null;
    void runPlanAction(
      () => setPlanException(occurrence.planId, dayKey, { kind: 'override', amount, description }),
      `Planned ${occurrence.description || 'spending'} changed to ${amount.toLocaleString('vi-VN')} ₫ for this day.`,
    );
  };

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const mutationLock = useRef(false);
  const busy = deletingId !== null || planBusy;

  const removeExpense = async (spending: Spending) => {
    if (mutationLock.current) return;
    const confirmed = await confirm({
      title: 'Delete expense?',
      message: `“${spending.description}” (${spending.amount.toLocaleString('vi-VN')} ₫) will be deleted. This cannot be undone.`,
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!confirmed || mutationLock.current) return;
    mutationLock.current = true;
    setDeletingId(spending.id);
    setError(null);
    setNotice('');
    try {
      await deleteSpending(spending.id);
      setNotice('Expense deleted.');
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      mutationLock.current = false;
      setDeletingId(null);
    }
  };

  const removeReceived = async (record: Transaction) => {
    if (mutationLock.current) return;
    const label = record.description || record.category;
    const confirmed = await confirm({
      title: 'Delete this payment?',
      message: `${label} (${record.amount.toLocaleString('vi-VN')} ₫) will be removed. The schedule keeps its other paydays.`,
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!confirmed || mutationLock.current) return;
    mutationLock.current = true;
    setDeletingId(record.id);
    setError(null);
    setNotice('');
    try {
      await deleteReceived(record.id);
      setNotice(`${label} deleted.`);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      mutationLock.current = false;
      setDeletingId(null);
    }
  };

  return (
    <div className="day-details animate-slide-up hide-scrollbar">
      <div className="day-details-inner">
        {/* Top Navigation Row */}
        <div className="day-details-header">
          <button
            type="button"
            className="day-details-back-btn"
            aria-label="Back to calendar"
            disabled={busy}
            onClick={onBack}
          >
            <ChevronLeft size={22} aria-hidden="true" />
          </button>
          <h2 className="day-details-date-title">
            {format(date, 'EEEE, MMMM d, yyyy')}
          </h2>
          <button
            type="button"
            className="expense-button expense-button-primary day-details-add-desktop"
            disabled={busy}
            onClick={onAddExpense}
          >
            <Plus size={16} aria-hidden="true" /> Add expense
          </button>
        </div>

        {/* Daily Summary Card */}
        <section className="day-summary-card glass" aria-label="Daily summary">
          <h3 className="day-summary-heading">Daily Summary</h3>
          <div className="day-summary-grid">
            <div className="day-summary-col">
              <div className="day-summary-label-row">
                <span className="day-summary-label">Total Spent</span>
                <ArrowDown size={14} className="day-summary-arrow is-spent" aria-hidden="true" />
              </div>
              <div className="day-summary-value is-spent">
                <span className="hide-mobile">{totalSpent.toLocaleString('vi-VN')} ₫</span>
                <span className="show-mobile">{formatCompactSpending(totalSpent)}</span>
              </div>
            </div>

            <div className="day-summary-col">
              <div className="day-summary-label-row">
                <span className="day-summary-label">Received</span>
                <ArrowUp size={14} className="day-summary-arrow is-income" aria-hidden="true" />
              </div>
              <div className="day-summary-value is-income">
                <span className="hide-mobile">{totalReceived > 0 ? '+' : ''}{totalReceived.toLocaleString('vi-VN')} ₫</span>
                <span className="show-mobile">{totalReceived > 0 ? '+' : ''}{formatCompactSpending(totalReceived)}</span>
              </div>
            </div>

            {plannedTotal > 0 && (
              <div className="day-summary-col">
                <div className="day-summary-label-row">
                  <span className="day-summary-label">Still planned</span>
                  <CalendarRange size={14} className="day-summary-arrow is-planned" aria-hidden="true" />
                </div>
                <div className="day-summary-value is-planned">
                  <span className="hide-mobile">{plannedTotal.toLocaleString('vi-VN')} ₫</span>
                  <span className="show-mobile">{formatCompactSpending(plannedTotal)}</span>
                </div>
              </div>
            )}
          </div>
          <p className="day-summary-period">
            <ArrowDownLeft size={13} aria-hidden="true" />
            <span>{showBy === 'pay_cycle' ? 'This pay cycle' : format(date, 'MMMM')}</span>
            <b>+{periodIncome.receivedIncome.toLocaleString('vi-VN')} ₫</b>
            <span>received</span>
            {periodIncome.expectedIncome > 0 && <span className="is-expected">· ~{periodIncome.expectedIncome.toLocaleString('vi-VN')} ₫ expected</span>}
          </p>
        </section>

        {error && <p className="expense-error" role="alert">{error}</p>}
        {notice && <p className="expense-notice" role="status">{notice}</p>}

        {/* Transactions Section */}
        <section className="day-tx-section" aria-busy={busy}>
          <h3 className="day-tx-section-label">Transactions</h3>

          {dayRows.length === 0 ? (
            <div className="day-tx-card day-tx-empty glass">
              Nothing in or out on this day.
            </div>
          ) : (
            <div className="day-tx-card glass">
              {dayRows.map((row) => {
                if (row.kind === 'income') {
                  const record = row.item;
                  const label = record.description || record.category;
                  return (
                    <div
                      key={record.id}
                      className="day-tx-row is-income"
                      role="button"
                      tabIndex={0}
                      aria-label={`Edit payment ${label}`}
                      onClick={() => { if (!busy) setEditingReceived(record); }}
                      onKeyDown={(event) => {
                        if ((event.key === 'Enter' || event.key === ' ') && !busy) {
                          event.preventDefault();
                          setEditingReceived(record);
                        }
                      }}
                    >
                      <div className="day-tx-icon-circle is-income" aria-hidden="true"><ArrowDownLeft size={18} /></div>
                      <div className="day-tx-info">
                        <span className="day-tx-title">{label}</span>
                        <div className="day-tx-sub">
                          <span className="day-tx-repeat-badge is-income">{record.category}</span>
                        </div>
                      </div>
                      <div className="day-tx-right">
                        <span className="day-tx-amount is-income">
                          <span className="hide-mobile">+{record.amount.toLocaleString('vi-VN')} ₫</span>
                          <span className="show-mobile">+{formatCompactSpending(record.amount)}</span>
                        </span>
                        <button
                          type="button"
                          className="day-tx-delete-btn"
                          aria-label={`Delete payment ${label}`}
                          disabled={busy}
                          onClick={(event) => {
                            event.stopPropagation();
                            void removeReceived(record);
                          }}
                        >
                          <Trash2 size={15} aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                  );
                }
                const spending = row.item;
                const category = settings.categories.find(item => item.id === spending.category);
                const categoryColor = category?.color ?? 'var(--primary)';
                const IconComp = (category && ICONS[category.icon as keyof typeof ICONS]) || CircleDollarSign;

                return (
                  <div
                    key={spending.id}
                    className="day-tx-row"
                    role="button"
                    tabIndex={0}
                    aria-label={`Edit ${spending.description}`}
                    onClick={() => {
                      if (!busy) onEditExpense(spending);
                    }}
                    onKeyDown={(event) => {
                      if ((event.key === 'Enter' || event.key === ' ') && !busy) {
                        event.preventDefault();
                        onEditExpense(spending);
                      }
                    }}
                  >
                    <div
                      className="day-tx-icon-circle"
                      style={{
                        backgroundColor: `color-mix(in srgb, ${categoryColor} 18%, transparent)`,
                        color: categoryColor,
                      }}
                      aria-hidden="true"
                    >
                      <IconComp size={18} />
                    </div>

                    <div className="day-tx-info">
                      <span className="day-tx-title">{spending.description}</span>
                      <div className="day-tx-sub">
                        <span>{formatTime12h(spending.time)}</span>
                        {spending.repeatRuleId && (
                          <span className="day-tx-repeat-badge" title="Recurring spending">
                            <Repeat size={11} aria-hidden="true" />
                            <span>Repeating</span>
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="day-tx-right">
                      <span className="day-tx-amount is-spent">
                        <span className="hide-mobile">-{spending.amount.toLocaleString('vi-VN')} ₫</span>
                        <span className="show-mobile">-{formatCompactSpending(spending.amount)}</span>
                      </span>
                      <button
                        type="button"
                        className="day-tx-delete-btn"
                        aria-label={`Delete ${spending.description}`}
                        disabled={busy}
                        onClick={(event) => {
                          event.stopPropagation();
                          void removeExpense(spending);
                        }}
                      >
                        <Trash2 size={15} aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {(planned.length > 0 || skipped.length > 0 || dayExpected.length > 0) && (
          <section className="day-tx-section" aria-busy={busy} aria-labelledby="day-planned-heading">
            <h3 id="day-planned-heading" className="day-tx-section-label">Planned</h3>
            <p className="day-planned-help">Each one becomes a real transaction once its time passes. Skip it or change the amount if this day is different.</p>
            <div className="day-tx-card glass">
              {dayExpected.map((payday) => (
                <div key={`payday-${payday.incomeId}`} className="day-tx-row is-planned is-income">
                  <div className="day-tx-icon-circle is-income" aria-hidden="true"><ArrowDownLeft size={18} /></div>
                  <div className="day-tx-info">
                    <span className="day-tx-title">{payday.name ? `${payday.source} · ${payday.name}` : payday.source}</span>
                    <div className="day-tx-sub">
                      <span className="day-tx-repeat-badge is-income" title="Income expected, not received yet">
                        <CalendarRange size={11} aria-hidden="true" />
                        <span>Expected payday</span>
                      </span>
                    </div>
                  </div>
                  <div className="day-tx-right">
                    <span className="day-tx-amount is-income is-expected">
                      <span className="hide-mobile">~+{payday.amount.toLocaleString('vi-VN')} ₫</span>
                      <span className="show-mobile">~+{formatCompactSpending(payday.amount)}</span>
                    </span>
                    <button type="button" className="day-planned-btn" disabled={busy} aria-label={`Edit the ${payday.source} income schedule`}
                      onClick={() => router.push(`${pages.profile.path}#income`)}>
                      <Settings2 size={13} aria-hidden="true" /><span className="hide-mobile">Schedule</span>
                    </button>
                  </div>
                </div>
              ))}
              {planned.map((occurrence) => {
                const category = settings.categories.find(item => item.id === occurrence.category);
                const categoryColor = category?.color ?? 'var(--primary)';
                const IconComp = (category && ICONS[category.icon as keyof typeof ICONS]) || CircleDollarSign;
                const label = occurrence.description || category?.name || 'Planned spending';
                const isChanging = changing?.planId === occurrence.planId;
                return (
                  <div key={occurrence.planId} className={`day-tx-row is-planned${occurrence.sure ? ' is-sure' : ''}`}>
                    <div className="day-tx-icon-circle" style={{ backgroundColor: `color-mix(in srgb, ${categoryColor} 12%, transparent)`, color: categoryColor }} aria-hidden="true">
                      <IconComp size={18} />
                    </div>
                    <div className="day-tx-info">
                      <span className="day-tx-title">{label}</span>
                      <div className="day-tx-sub">
                        <span>{formatTime12h(occurrence.time)}</span>
                        <span className="day-tx-repeat-badge is-planned" title="Planned spending, not real yet">
                          <CalendarRange size={11} aria-hidden="true" />
                          <span>{occurrence.overridden ? 'Planned · changed' : 'Planned'}</span>
                        </span>
                      </div>
                    </div>
                    {isChanging ? (
                      <form className="day-planned-change" onSubmit={(event) => { event.preventDefault(); saveChangedAmount(occurrence); }}>
                        <input
                          type="text" inputMode="numeric" autoFocus aria-label={`Amount for ${label} on this day`}
                          value={changing.amount} disabled={busy}
                          onChange={(event) => setChanging({ planId: occurrence.planId, amount: event.target.value })}
                          onKeyDown={(event) => { if (event.key === 'Escape') setChanging(null); }}
                        />
                        <button type="submit" className="day-planned-btn" disabled={busy}>Save</button>
                        <button type="button" className="day-planned-btn" disabled={busy} onClick={() => setChanging(null)}>Cancel</button>
                      </form>
                    ) : (
                      <div className="day-tx-right">
                        <span className="day-tx-amount is-planned">
                          <span className="hide-mobile">{occurrence.amount.toLocaleString('vi-VN')} ₫</span>
                          <span className="show-mobile">{formatCompactSpending(occurrence.amount)}</span>
                        </span>
                        <button type="button" className="day-planned-btn" disabled={busy} aria-label={`Record ${label} as spent now`} title="Paid early or logged it yourself? Record it now so it's never counted twice."
                          onClick={() => void runPlanAction(async () => { await completePlanOccurrence(occurrence.planId, dayKey); }, `${label} recorded as spent. This day's plan is fulfilled.`)}>
                          <Check size={13} aria-hidden="true" /><span className="hide-mobile">Done</span>
                        </button>
                        <button type="button" className="day-planned-btn" disabled={busy} aria-label={`Change amount of ${label} for this day`}
                          onClick={() => setChanging({ planId: occurrence.planId, amount: String(occurrence.amount) })}>
                          <Pencil size={13} aria-hidden="true" /><span className="hide-mobile">Change</span>
                        </button>
                        {occurrence.overridden && (
                          <button type="button" className="day-planned-btn" disabled={busy} aria-label={`Restore the usual amount of ${label}`}
                            onClick={() => void runPlanAction(() => clearPlanException(occurrence.planId, dayKey), `${label} is back to its usual amount.`)}>
                            <Undo2 size={13} aria-hidden="true" /><span className="hide-mobile">Usual</span>
                          </button>
                        )}
                        <button type="button" className="day-planned-btn" disabled={busy} aria-label={`Skip ${label} on this day`}
                          onClick={() => void runPlanAction(() => setPlanException(occurrence.planId, dayKey, { kind: 'skip', amount: null, description: null }), `${label} skipped for this day.`)}>
                          <SkipForward size={13} aria-hidden="true" /><span className="hide-mobile">Skip</span>
                        </button>
                        <button type="button" className="day-planned-btn" disabled={busy} aria-label={`Edit the ${label} plan from this day on`}
                          onClick={() => router.push(`${pages.plans.path}?edit=${encodeURIComponent(occurrence.planId)}&from=${dayKey}`)}>
                          <Settings2 size={13} aria-hidden="true" /><span className="hide-mobile">Series</span>
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
              {skipped.map((plan) => {
                const label = plan.description || 'Planned spending';
                return (
                  <div key={`skip-${plan.id}`} className="day-tx-row is-planned is-skipped">
                    <div className="day-tx-icon-circle" aria-hidden="true"><SkipForward size={16} /></div>
                    <div className="day-tx-info">
                      <span className="day-tx-title">{label}</span>
                      <div className="day-tx-sub"><span>Skipped this day</span></div>
                    </div>
                    <div className="day-tx-right">
                      <span className="day-tx-amount is-planned">{plan.amount.toLocaleString('vi-VN')} ₫</span>
                      <button type="button" className="day-planned-btn" disabled={busy} aria-label={`Undo skipping ${label}`}
                        onClick={() => void runPlanAction(() => clearPlanException(plan.id, dayKey), `${label} is planned again for this day.`)}>
                        <Undo2 size={13} aria-hidden="true" /><span className="hide-mobile">Undo</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}
      </div>
      {editingReceived && (
        <IncomeRecordSheet
          record={editingReceived}
          onClose={() => setEditingReceived(null)}
          onDone={(message) => { setEditingReceived(null); setError(null); setNotice(message); }}
        />
      )}
    </div>
  );
};
