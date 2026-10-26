'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertCircle,
  Briefcase,
  Calendar,
  Car,
  ChevronDown,
  CircleDollarSign,
  Clock,
  Coffee,
  Film,
  Gift,
  Heart,
  Home,
  Phone,
  Plus,
  Receipt,
  Search,
  ShoppingBag,
  Trash2,
  Utensils,
} from 'lucide-react';
import { useSettings } from '../contexts/SettingsContext';
import { useFinance } from '../contexts/FinanceContext';
import { createExpenseDraft, isExpenseDraftDirty, validateExpenseDraft, validateRepeatDraft } from '../lib/expenseDraft';
import type { ExpenseDraft } from '../lib/expenseDraft';
import { nextExpenseDraft, prepareExpenseBatch, saveExpenseBatch, stageExpenseDraft } from '../lib/expenseBatch';
import type { PreparedExpense, QueuedExpense } from '../lib/expenseBatch';
import { createIncomeDraft, isIncomeDraftDirty, validateIncomeDraft } from '../lib/incomeDraft';
import type { IncomeDraft } from '../lib/incomeDraft';
import { INCOME_FREQUENCY_LABELS, INCOME_SOURCE_SUGGESTIONS } from '../lib/income';
import { formatMoneyInputDisplay, sanitizeMoneyInput } from '../lib/spendings';
import type { IncomeFrequency, IncomeInput, Spending } from '../types';
import { useUnsavedChanges } from '../hooks/useUnsavedChanges';
import '../styles/ExpenseForm.css';

const CATEGORY_ICONS = {
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

export interface ExpenseModalProps {
  expense?: Spending;
  onClose: () => void;
  onSaved?: (input: Omit<Spending, 'id'>, count: number) => void;
  onIncomeSaved?: (input: IncomeInput) => void;
}

// Mount only while open: each mount captures fresh local defaults and the opening trigger.
export function ExpenseModal({ expense, onClose, onSaved, onIncomeSaved }: ExpenseModalProps) {
  const { settings } = useSettings();
  const { createSpending, updateSpending, createRepeatRule, createIncome } = useFinance();
  const [initial] = useState(() => {
    const expenseDraft = createExpenseDraft(settings.categories, expense);
    return {
      draft: expenseDraft,
      incomeDraft: {
        ...createIncomeDraft(expenseDraft.date),
        source: 'Salary',
      },
      trigger: document.activeElement,
    };
  });

  const editing = initial.draft.id !== undefined;
  const [mode, setMode] = useState<'spending' | 'income'>('spending');

  const [draft, setDraft] = useState(initial.draft);
  const [baseline, setBaseline] = useState(initial.draft);
  const [queue, setQueue] = useState<QueuedExpense[]>([]);
  const [activeKey, setActiveKey] = useState<number | null>(null);
  const [savedCount, setSavedCount] = useState(0);

  const [incomeDraft, setIncomeDraft] = useState(initial.incomeDraft);
  const [incomeBaseline] = useState(initial.incomeDraft);

  const [categoryQuery, setCategoryQuery] = useState('');
  const [categoryOpen, setCategoryOpen] = useState(false);

  const nextKey = useRef(0);
  const confirmedCount = useRef(0);
  const newEditorDraft = useRef<ExpenseDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  const incomeAmountRef = useRef<HTMLInputElement>(null);
  const categoryDropdownRef = useRef<HTMLDivElement>(null);
  const saveLock = useRef(false);
  const mounted = useRef(false);
  const formId = useId();

  const spendingDirty = queue.length > 0 || isExpenseDraftDirty(draft, baseline);
  const incomeDirty = isIncomeDraftDirty(incomeDraft, incomeBaseline);
  const dirty = spendingDirty || incomeDirty;

  const displayedQueue = queue.map(entry => entry.key === activeKey ? { ...entry, draft } : entry);
  const queuedTotal = displayedQueue.reduce((total, entry) => {
    const amount = Number(entry.draft.amount);
    return total + (Number.isFinite(amount) && amount > 0 ? amount : 0);
  }, 0);

  const selectedCategory = settings.categories.find(c => c.id === draft.category);
  const filteredCategories = settings.categories.filter(c =>
    c.name.toLowerCase().includes(categoryQuery.trim().toLowerCase()),
  );

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
    if (!busy) {
      if (mode === 'income') {
        incomeAmountRef.current?.focus({ preventScroll: true });
      } else {
        amountRef.current?.focus({ preventScroll: true });
      }
    }
  }, [busy, mode]);

  useEffect(() => {
    if (!categoryOpen) return;
    const handleMouseDown = (event: MouseEvent) => {
      if (categoryDropdownRef.current && !categoryDropdownRef.current.contains(event.target as Node)) {
        setCategoryOpen(false);
        setCategoryQuery('');
      }
    };
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [categoryOpen]);

  const requestClose = () => {
    if (saveLock.current) return;
    if (dirty && !window.confirm('Discard your unsaved transaction changes?')) return;
    onClose();
  };

  const changeField = (field: keyof Omit<ExpenseDraft, 'id'>, value: string) => {
    if (saveLock.current) return;
    const nextValue = field === 'amount' ? sanitizeMoneyInput(value) : value;
    setDraft(current => ({ ...current, [field]: nextValue }));
  };

  const changeIncomeField = <K extends keyof Omit<IncomeDraft, 'id'>>(field: K, value: IncomeDraft[K]) => {
    if (saveLock.current) return;
    const nextValue = field === 'amount' ? sanitizeMoneyInput(String(value)) : value;
    setIncomeDraft(current => ({ ...current, [field]: nextValue }));
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

  const saveTransaction = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saveLock.current) return;
    setError(null);

    if (!editing && mode === 'income') {
      let incomeInput: IncomeInput;
      try {
        incomeInput = validateIncomeDraft(incomeDraft);
      } catch (cause) {
        setError(cause instanceof Error && cause.message ? cause.message : 'Check the income details and try again.');
        return;
      }
      saveLock.current = true;
      setBusy(true);
      try {
        await createIncome(incomeInput);
        if (!mounted.current) return;
        onIncomeSaved?.(incomeInput);
        onClose();
        return;
      } catch (cause) {
        saveLock.current = false;
        if (mounted.current) {
          setBusy(false);
          setError(cause instanceof Error && cause.message ? cause.message : 'Unable to save income.');
        }
        return;
      }
    }

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
      className="expense-modal"
      aria-labelledby={`${formId}-title`}
      aria-describedby={error ? `${formId}-error` : undefined}
      aria-busy={busy}
      onCancel={event => {
        event.preventDefault();
        if (error) {
          setError(null);
          return;
        }
        requestClose();
      }}
    >
      <form className="expense-form" onSubmit={saveTransaction} noValidate>
        <div className="expense-sheet-handle" aria-hidden="true" />
        <div className="expense-modal-header">
          <h2 id={`${formId}-title`}>{editing ? 'Edit Transaction' : 'Add Transaction'}</h2>
        </div>

        {!editing && (
          <div className="expense-mode-tabs" role="tablist" aria-label="Transaction type">
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'spending'}
              className={`expense-mode-tab${mode === 'spending' ? ' is-active' : ''}`}
              disabled={busy}
              onClick={() => { setError(null); setMode('spending'); }}
            >
              Spending
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'income'}
              className={`expense-mode-tab${mode === 'income' ? ' is-active' : ''}`}
              disabled={busy}
              onClick={() => { setError(null); setMode('income'); }}
            >
              Income
            </button>
          </div>
        )}

        {savedCount > 0 && <p className="expense-notice" role="status">{savedCount} expense{savedCount === 1 ? '' : 's'} saved.</p>}

        <fieldset disabled={busy}>
          <legend className="expense-sr-only">Transaction details</legend>

          {!editing && mode === 'income' ? (
            <div className="expense-editor">
              <div className="expense-hero-amount">
                <label htmlFor={`${formId}-income-amount`}>Amount</label>
                <div className="expense-hero-amount-input-wrap">
                  <span className="expense-hero-currency" aria-hidden="true">₫</span>
                  <input
                    ref={incomeAmountRef}
                    id={`${formId}-income-amount`}
                    type="text"
                    inputMode="numeric"
                    required
                    placeholder="0"
                    value={formatMoneyInputDisplay(incomeDraft.amount)}
                    onChange={event => changeIncomeField('amount', event.target.value)}
                  />
                </div>
              </div>

              <div className="expense-stack">
                <div className="expense-field">
                  <label htmlFor={`${formId}-income-source`}>Source</label>
                  <select
                    id={`${formId}-income-source`}
                    value={incomeDraft.source}
                    onChange={event => changeIncomeField('source', event.target.value)}
                  >
                    {INCOME_SOURCE_SUGGESTIONS.map(source => (
                      <option key={source} value={source}>{source}</option>
                    ))}
                  </select>
                </div>

                <div className="expense-field">
                  <label htmlFor={`${formId}-income-desc`}>Description</label>
                  <input
                    id={`${formId}-income-desc`}
                    type="text"
                    maxLength={500}
                    placeholder="e.g., Performance bonus, freelance"
                    value={incomeDraft.name}
                    onChange={event => changeIncomeField('name', event.target.value)}
                  />
                </div>

                <div className="expense-grid">
                  <div className="expense-field">
                    <label htmlFor={`${formId}-income-frequency`}>Frequency</label>
                    <select
                      id={`${formId}-income-frequency`}
                      value={incomeDraft.frequency}
                      onChange={event => changeIncomeField('frequency', event.target.value as IncomeFrequency)}
                    >
                      {(Object.keys(INCOME_FREQUENCY_LABELS) as IncomeFrequency[]).map(freq => (
                        <option key={freq} value={freq}>{INCOME_FREQUENCY_LABELS[freq]}</option>
                      ))}
                    </select>
                  </div>

                  <div className="expense-field">
                    <label htmlFor={`${formId}-income-date`}>
                      {incomeDraft.frequency === 'once' ? 'Date' : 'Start Date'}
                    </label>
                    <div className="expense-input-icon-wrap">
                      <Calendar size={16} className="expense-input-leading-icon" aria-hidden="true" />
                      <input
                        id={`${formId}-income-date`}
                        type="date"
                        required
                        min="0001-01-01"
                        max="9999-12-31"
                        value={incomeDraft.startDate}
                        onChange={event => changeIncomeField('startDate', event.target.value)}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="expense-editor">
              {!editing && activeKey !== null && (
                <p className="expense-editor-heading">
                  Editing queued expense {queue.findIndex(entry => entry.key === activeKey) + 1}
                </p>
              )}

              <div className="expense-hero-amount">
                <label htmlFor={`${formId}-amount`}>Amount</label>
                <div className="expense-hero-amount-input-wrap">
                  <span className="expense-hero-currency" aria-hidden="true">₫</span>
                  <input
                    ref={amountRef}
                    id={`${formId}-amount`}
                    type="text"
                    inputMode="numeric"
                    required
                    autoFocus
                    placeholder="0"
                    value={formatMoneyInputDisplay(draft.amount)}
                    onChange={event => changeField('amount', event.target.value)}
                  />
                </div>
              </div>

              <div className="expense-stack">
                <div className="expense-field" ref={categoryDropdownRef}>
                  <label htmlFor={`${formId}-category-search`}>Category</label>
                  <div className="expense-category-combobox">
                    <div
                      className={`expense-category-control${categoryOpen ? ' is-open' : ''}`}
                      onClick={() => setCategoryOpen(true)}
                    >
                      <Search size={16} className="expense-category-search-icon" aria-hidden="true" />
                      <input
                        id={`${formId}-category-search`}
                        type="text"
                        role="combobox"
                        aria-expanded={categoryOpen}
                        aria-controls={`${formId}-category-listbox`}
                        aria-autocomplete="list"
                        placeholder={selectedCategory ? selectedCategory.name : 'Search or select category'}
                        value={categoryOpen ? categoryQuery : (selectedCategory?.name ?? '')}
                        onFocus={() => {
                          setCategoryOpen(true);
                          setCategoryQuery('');
                        }}
                        onChange={event => {
                          setCategoryOpen(true);
                          setCategoryQuery(event.target.value);
                        }}
                      />
                      <button
                        type="button"
                        tabIndex={-1}
                        className="expense-category-chevron-btn"
                        aria-label="Toggle categories"
                        onClick={event => {
                          event.stopPropagation();
                          setCategoryOpen(open => !open);
                          setCategoryQuery('');
                        }}
                      >
                        <ChevronDown size={16} aria-hidden="true" />
                      </button>
                    </div>

                    {categoryOpen && (
                      <ul
                        id={`${formId}-category-listbox`}
                        role="listbox"
                        className="expense-category-dropdown"
                      >
                        {filteredCategories.length === 0 ? (
                          <li className="expense-category-empty">No matching categories</li>
                        ) : (
                          filteredCategories.map(category => {
                            const IconComp = CATEGORY_ICONS[category.icon as keyof typeof CATEGORY_ICONS] || CircleDollarSign;
                            const isSelected = category.id === draft.category;
                            return (
                              <li key={category.id} role="option" aria-selected={isSelected}>
                                <button
                                  type="button"
                                  className={`expense-category-option${isSelected ? ' is-selected' : ''}`}
                                  onClick={() => {
                                    changeField('category', category.id);
                                    setCategoryOpen(false);
                                    setCategoryQuery('');
                                  }}
                                >
                                  <span
                                    className="expense-category-option-dot"
                                    style={{ color: category.color }}
                                  >
                                    <IconComp size={15} aria-hidden="true" />
                                  </span>
                                  <span>{category.name}</span>
                                </button>
                              </li>
                            );
                          })
                        )}
                      </ul>
                    )}
                  </div>
                  {settings.categories.length === 0 && (
                    <small>Add a category in settings before saving an expense.</small>
                  )}
                </div>

                <div className="expense-field">
                  <label htmlFor={`${formId}-description`}>Description</label>
                  <input
                    id={`${formId}-description`}
                    type="text"
                    required
                    maxLength={500}
                    placeholder="e.g., Grocery shopping"
                    value={draft.description}
                    onChange={event => changeField('description', event.target.value)}
                  />
                </div>

                <div className="expense-datetime-row">
                  <div className="expense-field">
                    <label htmlFor={`${formId}-date`}>Date</label>
                    <div className="expense-input-icon-wrap">
                      <Calendar size={16} className="expense-input-leading-icon" aria-hidden="true" />
                      <input
                        id={`${formId}-date`}
                        type="date"
                        required
                        min="0001-01-01"
                        max="9999-12-31"
                        value={draft.date}
                        onChange={event => changeField('date', event.target.value)}
                      />
                    </div>
                  </div>
                  <div className="expense-field">
                    <label htmlFor={`${formId}-time`}>Time</label>
                    <div className="expense-input-icon-wrap">
                      <Clock size={16} className="expense-input-leading-icon" aria-hidden="true" />
                      <input
                        id={`${formId}-time`}
                        type="time"
                        required
                        step={60}
                        value={draft.time}
                        onChange={event => changeField('time', event.target.value)}
                      />
                    </div>
                  </div>
                </div>
              </div>

              {!editing && (
                <div className="expense-repeat-section">
                  <div className="expense-repeat-addmore-row">
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
                      <span>Repeat this spending</span>
                    </label>

                    {!draft.isRepeat && (
                      <button
                        type="button"
                        className="expense-add-more-link"
                        disabled={busy || settings.categories.length === 0}
                        onClick={addMore}
                      >
                        <Plus size={15} aria-hidden="true" />
                        <span>Add more</span>
                      </button>
                    )}
                  </div>

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
                          ? '⚡ Generates 100 entries initially. As time nears the repeat horizon, the system automatically applies the next batch of repeats.'
                          : 'Generates recurring entries up to the cap of 100.'}
                      </p>
                    </div>
                  )}
                </div>
              )}

              {!editing && !draft.isRepeat && (
                <aside className="expense-queue-card" aria-labelledby={`${formId}-queue-title`}>
                  <div className="expense-queue-card-title" id={`${formId}-queue-title`}>
                    Queued expenses
                  </div>
                  <div className="expense-queue-card-stats">
                    <span>Queued: <strong>{queue.length}</strong></span>
                    <span>Total: <strong>{queuedTotal.toLocaleString('vi-VN')} ₫</strong></span>
                  </div>
                  {queue.length > 0 && (
                    <ol className="expense-queue-list">
                      {displayedQueue.map((entry, index) => (
                        <li key={entry.key} className={`expense-queue-item${entry.key === activeKey ? ' is-active' : ''}`}>
                          <button
                            type="button"
                            className="expense-queue-edit"
                            disabled={busy}
                            aria-label={`Edit queued expense ${index + 1}: ${entry.draft.description}`}
                            aria-pressed={entry.key === activeKey}
                            onClick={() => editQueued(entry.key)}
                          >
                            <span className="expense-queue-item-heading">
                              <strong title={entry.draft.description}>{entry.draft.description || 'Untitled expense'}</strong>
                              <span className="expense-queue-amount">
                                {Number.isFinite(Number(entry.draft.amount)) ? Number(entry.draft.amount).toLocaleString('vi-VN') : '—'} ₫
                              </span>
                            </span>
                            <span className="expense-queue-meta">
                              {settings.categories.find(category => category.id === entry.draft.category)?.name ?? entry.draft.category} · {entry.draft.date} {entry.draft.time}
                            </span>
                          </button>
                          <button
                            type="button"
                            className="expense-button expense-queue-remove"
                            disabled={busy}
                            aria-label={`Remove queued expense ${index + 1}: ${entry.draft.description}`}
                            onClick={() => removeQueued(entry.key)}
                          >
                            <Trash2 size={15} aria-hidden="true" />
                          </button>
                        </li>
                      ))}
                    </ol>
                  )}
                </aside>
              )}
            </div>
          )}

          <div className="expense-modal-footer">
            <button
              type="submit"
              className="expense-button expense-button-primary expense-submit-btn"
              disabled={busy || (mode === 'spending' && settings.categories.length === 0)}
            >
              {busy
                ? 'Saving…'
                : editing
                  ? 'Save'
                  : mode === 'income'
                    ? 'Add'
                    : draft.isRepeat
                      ? 'Set repeat'
                      : 'Add'}
            </button>
            <button
              type="button"
              className="expense-button expense-cancel-btn"
              disabled={busy}
              onClick={requestClose}
            >
              Cancel
            </button>
          </div>
        </fieldset>
      </form>

      {error && (
        <div
          className="expense-error-backdrop"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby={`${formId}-error-title`}
          aria-describedby={`${formId}-error`}
          onClick={() => setError(null)}
        >
          <div
            className="expense-error-popup"
            onClick={event => event.stopPropagation()}
          >
            <div className="expense-error-popup-icon" aria-hidden="true">
              <AlertCircle size={26} />
            </div>
            <h3 id={`${formId}-error-title`} className="expense-error-popup-title">
              Invalid Input
            </h3>
            <p id={`${formId}-error`} className="expense-error-popup-message">
              {error}
            </p>
            <button
              type="button"
              className="expense-button expense-button-primary expense-error-popup-btn"
              autoFocus
              onClick={() => setError(null)}
            >
              Got it
            </button>
          </div>
        </div>
      )}
    </dialog>,
    document.body,
  );
}
