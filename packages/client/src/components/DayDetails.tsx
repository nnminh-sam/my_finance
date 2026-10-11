import React, { useRef, useState } from 'react';
import { format } from 'date-fns';
import { getSpendingsForDate, getTotalForDate } from '../spendings';
import { ArrowLeft, Clock, Plus, Repeat } from 'lucide-react';
import { useSettings } from '../contexts/SettingsContext';
import { useFinance } from '../contexts/FinanceContext.tsx';
import type { Spending } from '../types';
import { errorMessage } from '../auth';
import './ExpenseForm.css';

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
  const { spendings, deleteSpending } = useFinance();
  const daySpendings = getSpendingsForDate(date, spendings);
  const total = getTotalForDate(date, spendings);
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
    <div className="day-details animate-slide-up" style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: '16px', gap: '24px', overflowY: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
        <button
          type="button"
          aria-label="Back to calendar"
          disabled={busy}
          onClick={onBack}
          style={{
            width: '40px', height: '40px', borderRadius: '50%',
            backgroundColor: 'var(--bg-card)', display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 4px 6px rgba(0,0,0,0.1)'
          }}
        >
          <ArrowLeft size={20} aria-hidden="true" />
        </button>
        <div style={{ flex: 1 }}>
          <h2 style={{ fontSize: '1.5rem', fontWeight: 700 }}>{format(date, 'EEEE')}</h2>
          <p style={{ color: 'var(--text-muted)' }}>{format(date, 'MMMM d, yyyy')}</p>
        </div>
        <button type="button" className="expense-button expense-button-primary" disabled={busy} onClick={onAddExpense}>
          <Plus size={16} aria-hidden="true" /> Add expense
        </button>
      </div>

      <div className="glass" style={{ borderRadius: 'var(--radius-lg)', padding: '24px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
        <span style={{ color: 'var(--text-muted)', fontSize: '0.875rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Total Spent</span>
        <span style={{ fontSize: '3rem', fontWeight: 800, color: 'var(--danger)', lineHeight: 1 }}>{total.toLocaleString('vi-VN')} ₫</span>
      </div>

      {error && <p className="expense-error" role="alert">{error}</p>}
      {notice && <p className="expense-notice" role="status">{notice}</p>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }} aria-busy={busy}>
        <h3 style={{ fontSize: '1.125rem', fontWeight: 600, paddingBottom: '8px', borderBottom: '1px solid var(--border-color)' }}>Transactions</h3>
        {daySpendings.length === 0 ? (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '32px 0' }}>No spending recorded for this day. Use Add expense to record your first expense.</div>
        ) : (
          daySpendings.map((spending, idx) => {
            const category = settings.categories.find(item => item.id === spending.category);
            const categoryName = category?.name ?? spending.category;
            const categoryColor = category?.color ?? 'var(--primary)';
            return (
              <div key={spending.id} className="expense-transaction glass" style={{ animationDelay: `${idx * 50}ms` }}>
                <div className="expense-transaction-details">
                  <div aria-hidden="true" style={{
                    width: '48px', height: '48px', borderRadius: '12px', flexShrink: 0,
                    backgroundColor: categoryColor, opacity: 0.8,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: 'var(--bg-main)', fontWeight: 700, fontSize: '1.25rem'
                  }}>{categoryName.charAt(0)}</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', minWidth: 0 }}>
                    <span style={{ fontWeight: 600, fontSize: '1rem', overflowWrap: 'anywhere' }}>{spending.description}</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--text-muted)', fontSize: '0.75rem', flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 500 }}>{categoryName}</span><span aria-hidden="true">•</span><Clock size={12} aria-hidden="true" /><span>{spending.time}</span>
                      {spending.repeatRuleId && (
                        <>
                          <span aria-hidden="true">•</span>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', color: 'var(--primary)', fontWeight: 600 }} title="Recurring spending">
                            <Repeat size={12} aria-hidden="true" />
                            <span>Repeating</span>
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
                <span style={{ fontWeight: 700, fontSize: '1.125rem' }}>{spending.amount.toLocaleString('vi-VN')} ₫</span>
                <div className="expense-actions">
                  <button type="button" className="expense-button" aria-label={`Edit ${spending.description}`} disabled={busy} onClick={() => onEditExpense(spending)}>Edit</button>
                  <button type="button" className="expense-button expense-button-danger" aria-label={`Delete ${spending.description}`} disabled={busy} onClick={() => void removeExpense(spending)}>{deletingId === spending.id ? 'Deleting…' : 'Delete'}</button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
