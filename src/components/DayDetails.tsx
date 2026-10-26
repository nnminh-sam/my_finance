'use client';

import React, { useRef, useState } from 'react';
import { format } from 'date-fns';
import { getSpendingsForDate, getTotalForDate, formatCompactSpending } from '../lib/spendings';
import { getMonthIncome, incomeMonth } from '../lib/income';
import {
  ArrowDown,
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
} from 'lucide-react';
import { useSettings } from '../contexts/SettingsContext';
import { useFinance } from '../contexts/FinanceContext';
import type { Spending } from '../types';
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
  const { spendings, incomes, deleteSpending } = useFinance();
  const daySpendings = getSpendingsForDate(date, spendings);
  const totalSpent = getTotalForDate(date, spendings);
  const { totalIncome } = getMonthIncome(incomeMonth(date), incomes);

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const mutationLock = useRef(false);
  const busy = deletingId !== null;

  const removeExpense = async (spending: Spending) => {
    if (mutationLock.current || !window.confirm(`Delete “${spending.description}” (${spending.amount.toLocaleString('vi-VN')} ₫)? This cannot be undone.`)) return;
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
                <span className="day-summary-label">Total Income</span>
                <ArrowUp size={14} className="day-summary-arrow is-income" aria-hidden="true" />
              </div>
              <div className="day-summary-value is-income">
                <span className="hide-mobile">{totalIncome.toLocaleString('vi-VN')} ₫</span>
                <span className="show-mobile">{formatCompactSpending(totalIncome)}</span>
              </div>
            </div>
          </div>
        </section>

        {error && <p className="expense-error" role="alert">{error}</p>}
        {notice && <p className="expense-notice" role="status">{notice}</p>}

        {/* Transactions Section */}
        <section className="day-tx-section" aria-busy={busy}>
          <h3 className="day-tx-section-label">Transactions</h3>

          {daySpendings.length === 0 ? (
            <div className="day-tx-card day-tx-empty glass">
              No spending recorded for this day.
            </div>
          ) : (
            <div className="day-tx-card glass">
              {daySpendings.map((spending) => {
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
      </div>
    </div>
  );
};
