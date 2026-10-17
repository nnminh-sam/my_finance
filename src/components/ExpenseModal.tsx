'use client';

import { useId, useLayoutEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { Plus, Repeat, Trash2, X } from 'lucide-react';
import { useSettings } from '../contexts/SettingsContext';
import { useFinance } from '../contexts/FinanceContext';
import { createExpenseDraft, isExpenseDraftDirty, validateExpenseDraft, validateRepeatDraft } from '../lib/expenseDraft';
import type { ExpenseDraft } from '../lib/expenseDraft';
import { nextExpenseDraft, prepareExpenseBatch, saveExpenseBatch, stageExpenseDraft } from '../lib/expenseBatch';
import type { PreparedExpense, QueuedExpense } from '../lib/expenseBatch';
import type { Spending } from '../types';
import { useUnsavedChanges } from '../hooks/useUnsavedChanges';
import '../styles/ExpenseForm.css';

export interface ExpenseModalProps {
  expense?: Spending;
  onClose: () => void;
  onSaved?: (input: Omit<Spending, 'id'>, count: number) => void;
}

// Mount only while open: each mount captures fresh local defaults and the opening trigger.
export function ExpenseModal({ expense, onClose, onSaved }: ExpenseModalProps) {
  const { settings } = useSettings();
  const { createSpending, updateSpending, createRepeatRule } = useFinance();
  const [initial] = useState(() => ({
    draft: createExpenseDraft(settings.categories, expense),
    trigger: document.activeElement,
  }));
  const [draft, setDraft] = useState(initial.draft);
  const [baseline, setBaseline] = useState(initial.draft);
  const [queue, setQueue] = useState<QueuedExpense[]>([]);
  const [activeKey, setActiveKey] = useState<number | null>(null);
  const [savedCount, setSavedCount] = useState(0);
  const nextKey = useRef(0);
  const confirmedCount = useRef(0);
  const newEditorDraft = useRef<ExpenseDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  const saveLock = useRef(false);
  const mounted = useRef(false);
  const formId = useId();
  const dirty = queue.length > 0 || isExpenseDraftDirty(draft, baseline);
  const editing = initial.draft.id !== undefined;
  const displayedQueue = queue.map(entry => entry.key === activeKey ? { ...entry, draft } : entry);
  const queuedTotal = displayedQueue.reduce((total, entry) => {
    const amount = Number(entry.draft.amount);
    return total + (Number.isFinite(amount) && amount > 0 ? amount : 0);
  }, 0);

  const presets = [
    { label: 'Breakfast', desc: 'Breakfast', category: 'Food', time: '08:00', icon: '🍳', freq: 'daily' as const },
    { label: 'Lunch', desc: 'Lunch', category: 'Food', time: '12:30', icon: '🍱', freq: 'weekdays' as const },
    { label: 'Coffee', desc: 'Coffee', category: 'Food', time: '09:00', icon: '☕', freq: 'daily' as const },
    { label: 'Gas', desc: 'Gas', category: 'Transport', time: '08:30', icon: '⛽', freq: 'weekly' as const },
    { label: 'Rent / Bills', desc: 'Bills', category: 'Bills', time: '09:00', icon: '📄', freq: 'monthly' as const },
  ];

  const applyPreset = (preset: typeof presets[number]) => {
    if (saveLock.current) return;
    const targetCategory = settings.categories.find(c => c.name.toLowerCase() === preset.category.toLowerCase() || c.id.toLowerCase() === preset.category.toLowerCase())?.id ?? settings.categories[0]?.id ?? '';
    setDraft(curr => ({
      ...curr,
      description: preset.desc,
      category: targetCategory,
      time: preset.time,
      isRepeat: true,
      repeatFrequency: preset.freq,
      repeatEndType: 'unlimited',
    }));
    amountRef.current?.focus({ preventScroll: true });
  };

  useUnsavedChanges(dirty || busy);

  useLayoutEffect(() => {
    const dialog = dialogRef.current!;
    mounted.current = true;
    dialog.showModal();
    amountRef.current?.focus({ preventScroll: true });
    return () => {
      mounted.current = false;
      if (dialog.open) dialog.close();
      if (initial.trigger instanceof HTMLElement && initial.trigger.isConnected && document.activeElement !== initial.trigger) {
        initial.trigger.focus({ preventScroll: true });
      }
    };
  }, [initial]);

  useLayoutEffect(() => {
    if (!busy) amountRef.current?.focus({ preventScroll: true });
  }, [busy]);

  const requestClose = () => {
    if (saveLock.current) return;
    if (dirty && !window.confirm('Discard your unsaved expense changes?')) return;
    onClose();
  };

  const changeField = (field: keyof Omit<ExpenseDraft, 'id'>, value: string) => {
    if (saveLock.current) return;
    setDraft(current => ({ ...current, [field]: value }));
  };

  const resetEditor = (source: ExpenseDraft) => {
    const fresh = newEditorDraft.current ?? nextExpenseDraft(source);
    newEditorDraft.current = null;
    setDraft(fresh);
    setBaseline(fresh);
    setActiveKey(null);
    amountRef.current?.focus({ preventScroll: true });
  };

  const stageCurrent = () => {
    validateExpenseDraft(draft, settings.categories);
    return stageExpenseDraft(queue, draft, activeKey ?? nextKey.current++);
  };

  const addMore = () => {
    if (saveLock.current) return;
    setError(null);
    try {
      setQueue(stageCurrent());
      resetEditor(draft);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Check the expense details and try again.');
    }
  };

  const editQueued = (key: number) => {
    if (saveLock.current) return;
    if (key === activeKey) {
      amountRef.current?.focus({ preventScroll: true });
      return;
    }
    setError(null);
    try {
      const staged = activeKey !== null || draft.amount !== '' || draft.description !== '' ? stageCurrent() : queue;
      if (activeKey === null && draft.amount === '' && draft.description === '') {
        newEditorDraft.current = { ...draft };
      }
      const selected = staged.find(entry => entry.key === key)!;
      setQueue(staged);
      setActiveKey(key);
      setDraft({ ...selected.draft });
      setBaseline({ ...selected.draft });
      amountRef.current?.focus({ preventScroll: true });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Check the current expense before switching.');
    }
  };

  const removeQueued = (key: number) => {
    if (saveLock.current) return;
    setQueue(current => current.filter(entry => entry.key !== key));
    setError(null);
    if (key === activeKey) resetEditor(draft);
  };

  const saveExpense = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saveLock.current) return;
    setError(null);

    if (!editing && draft.isRepeat) {
      let repeatInput;
      try {
        repeatInput = validateRepeatDraft(draft, settings.categories);
      } catch (cause) {
        setError(cause instanceof Error && cause.message ? cause.message : 'Check the repeat spending details and try again.');
        return;
      }
      saveLock.current = true;
      setBusy(true);
      try {
        const savedRule = await createRepeatRule(repeatInput);
        if (!mounted.current) return;
        onSaved?.({
          amount: repeatInput.amount,
          description: repeatInput.description,
          category: repeatInput.category,
          date: repeatInput.startDate,
          time: repeatInput.time,
        }, savedRule.occurrencesCreated);
        onClose();
        return;
      } catch (cause) {
        saveLock.current = false;
        if (mounted.current) {
          setBusy(false);
          setError(cause instanceof Error && cause.message ? cause.message : 'Unable to save repeat spending.');
        }
        return;
      }
    }

    let input: Omit<Spending, 'id'>;
    let batch: PreparedExpense[] = [];
    try {
      if (editing) input = validateExpenseDraft(draft, settings.categories);
      else {
        batch = prepareExpenseBatch(queue, draft, activeKey, nextKey.current, settings.categories);
        input = batch[batch.length - 1].input;
      }
    } catch (cause) {
      setError(cause instanceof Error && cause.message ? cause.message : 'Check the expense details and try again.');
      return;
    }
    saveLock.current = true;
    setBusy(true);
    try {
      if (initial.draft.id !== undefined) await updateSpending(initial.draft.id, input);
      else {
        nextKey.current = Math.max(nextKey.current, ...batch.map(entry => entry.key + 1));
        const result = await saveExpenseBatch(batch, createSpending);
        confirmedCount.current += result.saved.length;
        if (!mounted.current) return;
        setSavedCount(confirmedCount.current);
        if (result.remaining.length > 0) {
          setQueue(result.remaining.map(entry => ({ key: entry.key, draft: entry.draft })));
          resetEditor(draft);
          saveLock.current = false;
          setBusy(false);
          const detail = result.error instanceof Error && result.error.message ? result.error.message : 'Unable to save the expense. Please try again.';
          setError(`${confirmedCount.current} saved; ${result.remaining.length} still pending. ${detail} Only pending expenses will be submitted on retry.`);
          return;
        }
      }
    } catch (cause) {
      saveLock.current = false;
      if (mounted.current) {
        setBusy(false);
        setError(cause instanceof Error && cause.message ? cause.message : 'Unable to save the expense. Please try again.');
      }
      return;
    }
    if (!mounted.current) return;
    try {
      onSaved?.(input, editing ? 1 : confirmedCount.current);
    } finally {
      onClose();
    }
  };

  return createPortal(
    <dialog
      ref={dialogRef}
      className={`expense-modal${editing ? '' : ' expense-modal-batch'}`}
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
        {savedCount > 0 && <p className="expense-notice" role="status">{savedCount} expense{savedCount === 1 ? '' : 's'} saved. The sidebar contains only unsaved expenses.</p>}
        <fieldset disabled={busy}>
          <legend className="expense-sr-only">Expense details</legend>
          <div className={editing ? undefined : 'expense-batch-layout'}>
          <div className="expense-editor">
          {!editing && (
            <div className="expense-presets-bar">
              <span className="expense-presets-label">Quick repeat:</span>
              <div className="expense-presets-list">
                {presets.map(p => (
                  <button
                    key={p.label}
                    type="button"
                    className="expense-preset-chip"
                    disabled={busy || settings.categories.length === 0}
                    onClick={() => applyPreset(p)}
                  >
                    <span aria-hidden="true">{p.icon}</span>
                    <span>{p.label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {!editing && <p className="expense-editor-heading">{activeKey === null ? 'New expense' : `Editing queued expense ${queue.findIndex(entry => entry.key === activeKey) + 1}`}</p>}
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

          {!editing && (
            <div className="expense-repeat-section">
              <label className="expense-repeat-toggle" htmlFor={`${formId}-is-repeat`}>
                <input
                  id={`${formId}-is-repeat`}
                  type="checkbox"
                  checked={Boolean(draft.isRepeat)}
                  onChange={e => setDraft(curr => ({
                    ...curr,
                    isRepeat: e.target.checked,
                    repeatFrequency: curr.repeatFrequency ?? 'daily',
                    repeatInterval: curr.repeatInterval ?? 1,
                    repeatDaysOfWeek: curr.repeatDaysOfWeek ?? [],
                    repeatEndType: curr.repeatEndType ?? 'unlimited',
                    repeatCount: curr.repeatCount ?? 10,
                  }))}
                />
                <Repeat size={16} aria-hidden="true" />
                <span>Repeat this spending</span>
              </label>

              {draft.isRepeat && (
                <div className="expense-repeat-options glass">
                  <div className="expense-form-grid">
                    <div className="expense-field">
                      <label htmlFor={`${formId}-repeat-freq`}>Frequency</label>
                      <select
                        id={`${formId}-repeat-freq`}
                        value={draft.repeatFrequency ?? 'daily'}
                        onChange={e => setDraft(curr => ({ ...curr, repeatFrequency: e.target.value as any }))}
                      >
                        <option value="daily">Every day</option>
                        <option value="weekdays">Weekdays (Mon–Fri)</option>
                        <option value="weekly">Weekly (specific days)</option>
                        <option value="monthly">Monthly</option>
                      </select>
                    </div>

                    {draft.repeatFrequency === 'daily' && (
                      <div className="expense-field">
                        <label htmlFor={`${formId}-repeat-interval`}>Every N days</label>
                        <input
                          id={`${formId}-repeat-interval`}
                          type="number"
                          min={1}
                          max={365}
                          value={draft.repeatInterval ?? 1}
                          onChange={e => setDraft(curr => ({ ...curr, repeatInterval: Math.max(1, Math.min(365, Number(e.target.value))) }))}
                        />
                      </div>
                    )}

                    {draft.repeatFrequency === 'weekly' && (
                      <div className="expense-field expense-field-wide">
                        <label>Repeat on specific days</label>
                        <div className="expense-weekday-picker">
                          {[
                            { day: 1, label: 'Mon' }, { day: 2, label: 'Tue' }, { day: 3, label: 'Wed' },
                            { day: 4, label: 'Thu' }, { day: 5, label: 'Fri' }, { day: 6, label: 'Sat' }, { day: 0, label: 'Sun' },
                          ].map(item => {
                            const selected = (draft.repeatDaysOfWeek ?? []).includes(item.day);
                            return (
                              <button
                                key={item.day}
                                type="button"
                                className={`expense-weekday-btn${selected ? ' is-selected' : ''}`}
                                onClick={() => {
                                  const current = draft.repeatDaysOfWeek ?? [];
                                  const next = selected ? current.filter(d => d !== item.day) : [...current, item.day];
                                  setDraft(curr => ({ ...curr, repeatDaysOfWeek: next }));
                                }}
                              >
                                {item.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    <div className="expense-field">
                      <label htmlFor={`${formId}-repeat-end-type`}>Duration</label>
                      <select
                        id={`${formId}-repeat-end-type`}
                        value={draft.repeatEndType ?? 'unlimited'}
                        onChange={e => setDraft(curr => ({ ...curr, repeatEndType: e.target.value as any }))}
                      >
                        <option value="unlimited">Keep repeating (unlimited)</option>
                        <option value="occurrences">Certain amount of times (cap 100)</option>
                        <option value="until_date">Until specific date</option>
                      </select>
                    </div>

                    {draft.repeatEndType === 'occurrences' && (
                      <div className="expense-field">
                        <label htmlFor={`${formId}-repeat-count`}>Number of repeats (1–100)</label>
                        <input
                          id={`${formId}-repeat-count`}
                          type="number"
                          min={1}
                          max={100}
                          value={draft.repeatCount ?? 10}
                          onChange={e => setDraft(curr => ({ ...curr, repeatCount: Math.min(100, Math.max(1, Number(e.target.value))) }))}
                        />
                        <small>System cap is 100 repeats.</small>
                      </div>
                    )}

                    {draft.repeatEndType === 'until_date' && (
                      <div className="expense-field">
                        <label htmlFor={`${formId}-repeat-end-date`}>End Date</label>
                        <input
                          id={`${formId}-repeat-end-date`}
                          type="date"
                          min={draft.date}
                          max="9999-12-31"
                          value={draft.repeatEndDate ?? ''}
                          onChange={e => setDraft(curr => ({ ...curr, repeatEndDate: e.target.value }))}
                        />
                      </div>
                    )}
                  </div>
                  <p className="expense-repeat-hint">
                    {draft.repeatEndType === 'unlimited'
                      ? '⚡ Generates 100 entries initially. As time nears the repeat horizon, the system automatically applies the next batch of repeats without you needing to re-apply.'
                      : 'Generates recurring entries up to the cap of 100.'}
                  </p>
                </div>
              )}
            </div>
          )}

          {!editing && !draft.isRepeat && <div className="expense-editor-actions">
            <button type="button" className="expense-button" disabled={busy || settings.categories.length === 0} onClick={addMore}><Plus size={16} aria-hidden="true" />Add more</button>
            <p className="expense-batch-help">Queue this expense and start another. Nothing is saved until you press Add.</p>
          </div>}
          </div>

          {!editing && !draft.isRepeat && <aside className="expense-queue" aria-labelledby={`${formId}-queue-title`}>
            <div className="expense-queue-header">
              <h3 id={`${formId}-queue-title`}>Queued expenses</h3>
              <span aria-label={`${queue.length} queued expenses`}>{queue.length}</span>
            </div>
            {queue.length === 0 ? <p className="expense-queue-empty">Use Add more to build your list. You can edit or remove entries here before saving.</p> : <ol className="expense-queue-list">
              {displayedQueue.map((entry, index) => (
                <li key={entry.key} className={`expense-queue-item${entry.key === activeKey ? ' is-active' : ''}`}>
                  <button type="button" className="expense-queue-edit" disabled={busy} aria-label={`Edit queued expense ${index + 1}: ${entry.draft.description}`} aria-pressed={entry.key === activeKey} onClick={() => editQueued(entry.key)}>
                    <span className="expense-queue-item-heading">
                      <strong title={entry.draft.description}>{entry.draft.description || 'Untitled expense'}</strong>
                      <span className="expense-queue-amount">{Number.isFinite(Number(entry.draft.amount)) ? Number(entry.draft.amount).toLocaleString('vi-VN') : '—'} ₫</span>
                    </span>
                    <span className="expense-queue-meta">{settings.categories.find(category => category.id === entry.draft.category)?.name ?? entry.draft.category}</span>
                    <span className="expense-queue-meta">{entry.draft.date} · {entry.draft.time}</span>
                  </button>
                  <button type="button" className="expense-button expense-queue-remove" disabled={busy} aria-label={`Remove queued expense ${index + 1}: ${entry.draft.description}`} onClick={() => removeQueued(entry.key)}><Trash2 size={16} aria-hidden="true" /></button>
                </li>
              ))}
            </ol>}
            <div className="expense-queue-total"><span>Queued total</span><strong>{queuedTotal.toLocaleString('vi-VN')} ₫</strong></div>
          </aside>}
          </div>
          {!editing && !draft.isRepeat && <p className="expense-batch-help">Add saves all queued expenses and the current filled-in form. Click a queued expense to edit it; Add more returns you to a new entry.</p>}
          <div className="expense-actions">
            <button type="submit" className="expense-button expense-button-primary" disabled={busy || settings.categories.length === 0}>
              {busy ? 'Saving…' : editing ? 'Save expense' : draft.isRepeat ? 'Set repeat spending' : 'Add'}
            </button>
            <button type="button" className="expense-button" disabled={busy} onClick={requestClose}>Cancel</button>
          </div>
        </fieldset>
      </form>
    </dialog>,
    document.body,
  );
}

