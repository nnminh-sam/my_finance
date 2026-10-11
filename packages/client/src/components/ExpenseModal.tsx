import { useId, useLayoutEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useSettings } from '../contexts/SettingsContext';
import { useFinance } from '../contexts/FinanceContext.tsx';
import { createExpenseDraft, isExpenseDraftDirty, validateExpenseDraft } from '../expenseDraft';
import type { ExpenseDraft } from '../expenseDraft';
import type { Spending } from '../types';
import { useUnsavedChanges } from '../useUnsavedChanges';
import './ExpenseForm.css';

export interface ExpenseModalProps {
  expense?: Spending;
  onClose: () => void;
  onSaved?: (input: Omit<Spending, 'id'>) => void;
}

// Mount only while open: each mount captures fresh local defaults and the opening trigger.
export function ExpenseModal({ expense, onClose, onSaved }: ExpenseModalProps) {
  const { settings } = useSettings();
  const { createSpending, updateSpending } = useFinance();
  const [initial] = useState(() => ({
    draft: createExpenseDraft(settings.categories, expense),
    trigger: document.activeElement,
  }));
  const [draft, setDraft] = useState(initial.draft);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  const saveLock = useRef(false);
  const mounted = useRef(false);
  const formId = useId();
  const dirty = isExpenseDraftDirty(draft, initial.draft);
  const editing = initial.draft.id !== undefined;

  useUnsavedChanges(dirty || busy);

  useLayoutEffect(() => {
    const dialog = dialogRef.current!;
    mounted.current = true;
    dialog.showModal();
    amountRef.current?.focus({ preventScroll: true });
    return () => {
      mounted.current = false;
      if (dialog.open) dialog.close();
      // close() normally restores focus; only provide a fallback for a surviving trigger.
      if (initial.trigger instanceof HTMLElement && initial.trigger.isConnected && document.activeElement !== initial.trigger) {
        initial.trigger.focus({ preventScroll: true });
      }
    };
  }, [initial]);

  const requestClose = () => {
    if (saveLock.current) return;
    if (dirty && !window.confirm('Discard your unsaved expense changes?')) return;
    onClose();
  };

  const changeField = (field: keyof Omit<ExpenseDraft, 'id'>, value: string) => {
    if (saveLock.current) return;
    setDraft(current => ({ ...current, [field]: value }));
  };

  const saveExpense = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saveLock.current) return;
    setError(null);
    let input: Omit<Spending, 'id'>;
    try {
      input = validateExpenseDraft(draft, settings.categories);
    } catch (cause) {
      setError(cause instanceof Error && cause.message ? cause.message : 'Check the expense details and try again.');
      return;
    }
    saveLock.current = true;
    setBusy(true);
    try {
      if (initial.draft.id !== undefined) await updateSpending(initial.draft.id, input);
      else await createSpending(input);
    } catch (cause) {
      saveLock.current = false;
      if (mounted.current) {
        setBusy(false);
        setError(cause instanceof Error && cause.message ? cause.message : 'Unable to save the expense. Please try again.');
      }
      return;
    }
    if (!mounted.current) return;
    // Callback failures must not be reported as failed writes or allow duplicate saves.
    try {
      onSaved?.(input);
    } finally {
      onClose();
    }
  };

  return createPortal(
    <dialog
      ref={dialogRef}
      className="expense-modal"
      aria-labelledby={`${formId}-title`}
      aria-describedby={error ? `${formId}-error` : undefined}
      aria-busy={busy}
      onCancel={event => { event.preventDefault(); requestClose(); }}
    >
      <form className="expense-form" onSubmit={saveExpense} noValidate>
        <div className="expense-modal-header">
          <h2 id={`${formId}-title`}>{editing ? 'Edit expense' : 'Add expense'}</h2>
          <button type="button" className="expense-button" aria-label="Close expense dialog" disabled={busy} onClick={requestClose}>
            <X size={20} aria-hidden="true" />
          </button>
        </div>
        {error && <p id={`${formId}-error`} className="expense-error" role="alert">{error}</p>}
        <fieldset disabled={busy}>
          <legend className="expense-sr-only">Expense details</legend>
          <div className="expense-form-grid">
            <div className="expense-field">
              <label htmlFor={`${formId}-amount`}>Amount (₫)</label>
              <input ref={amountRef} id={`${formId}-amount`} type="text" inputMode="decimal" required autoFocus value={draft.amount} onChange={event => changeField('amount', event.target.value)} aria-describedby={`${formId}-amount-help`} />
              <small id={`${formId}-amount-help`}>Positive amount, maximum 1,000,000,000,000; up to 2 decimal places.</small>
            </div>
            <div className="expense-field">
              <label htmlFor={`${formId}-category`}>Category</label>
              <select id={`${formId}-category`} required value={settings.categories.some(category => category.id === draft.category) ? draft.category : ''} onChange={event => changeField('category', event.target.value)}>
                <option value="" disabled>Choose a category</option>
                {settings.categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}
              </select>
              {settings.categories.length === 0 && <small>Add a category in settings before saving an expense.</small>}
            </div>
            <div className="expense-field expense-field-wide">
              <label htmlFor={`${formId}-description`}>Description</label>
              <textarea id={`${formId}-description`} required maxLength={500} rows={2} value={draft.description} onChange={event => changeField('description', event.target.value)} aria-describedby={`${formId}-description-help`} />
              <small id={`${formId}-description-help`}>{draft.description.length}/500 characters</small>
            </div>
            <div className="expense-field">
              <label htmlFor={`${formId}-date`}>Date</label>
              <input id={`${formId}-date`} type="date" required min="0001-01-01" max="9999-12-31" value={draft.date} onChange={event => changeField('date', event.target.value)} />
            </div>
            <div className="expense-field">
              <label htmlFor={`${formId}-time`}>Time (HH:mm)</label>
              <input id={`${formId}-time`} type="time" required step={60} value={draft.time} onChange={event => changeField('time', event.target.value)} />
            </div>
          </div>
          <div className="expense-actions">
            <button type="submit" className="expense-button expense-button-primary" disabled={busy || settings.categories.length === 0}>{busy ? 'Saving…' : 'Save expense'}</button>
            <button type="button" className="expense-button" disabled={busy} onClick={requestClose}>Cancel</button>
          </div>
        </fieldset>
      </form>
    </dialog>,
    document.body,
  );
}
