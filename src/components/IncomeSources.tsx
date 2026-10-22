'use client';

import { useId, useLayoutEffect, useRef, useState } from 'react';
import { CircleDollarSign, Edit2, Plus, Trash2 } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { errorMessage } from '../services/auth';
import { useFinance } from '../contexts/FinanceContext';
import { describeIncomeSchedule, getMonthIncome, INCOME_FREQUENCY_LABELS, INCOME_SOURCE_SUGGESTIONS, incomeMonth } from '../lib/income';
import { createIncomeDraft, isIncomeDraftDirty, validateIncomeDraft } from '../lib/incomeDraft';
import type { IncomeDraft } from '../lib/incomeDraft';
import type { Income, IncomeFrequency } from '../types';
import { EditorActions } from './ProfileSection';

export interface IncomeEditorState {
  dirty: boolean;
  busy: boolean;
}

interface Props {
  disabled: boolean;
  onEditorStateChange: (state: IncomeEditorState) => void;
  initialMonth?: string;
  initiallyAdding?: boolean;
  /** Fix the viewed month and list only income received in it (used by the month income dialog). */
  restrictToMonth?: boolean;
}

type Editor = { draft: IncomeDraft; snapshot: IncomeDraft };
const money = (amount: number) => `${amount.toLocaleString('vi-VN', { maximumFractionDigits: 2 })} ₫`;
const isValidMonth = (month: string) => /^(?!0000)\d{4}-(?:0[1-9]|1[0-2])$/.test(month);
const incomeLabel = (income: Pick<Income, 'source' | 'name'>) => income.name ? `${income.source} · ${income.name}` : income.source;

// New income defaults to today when viewing the current month, otherwise to the viewed month's first day.
function defaultStartDate(month: string): string {
  const today = new Date();
  return month === incomeMonth(today) ? format(today, 'yyyy-MM-dd') : `${month}-01`;
}

export function IncomeSources({ disabled, onEditorStateChange, initialMonth, initiallyAdding = false, restrictToMonth = false }: Props) {
  const { incomes, createIncome, updateIncome, deleteIncome } = useFinance();
  const [selectedMonth, setSelectedMonth] = useState(() => initialMonth ?? incomeMonth(new Date()));
  const [editor, setEditor] = useState<Editor | null>(() => {
    if (!initiallyAdding) return null;
    const draft = createIncomeDraft(defaultStartDate(selectedMonth));
    return { draft, snapshot: { ...draft } };
  });
  const [operation, setOperation] = useState<'save' | 'delete' | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const requestLock = useRef(false);
  const id = useId();
  const dirty = editor !== null && isIncomeDraftDirty(editor.draft, editor.snapshot);
  const busy = operation !== null;
  const blocked = disabled || busy;
  const breakdown = getMonthIncome(selectedMonth, incomes);
  const monthLabel = format(parseISO(`${selectedMonth}-01`), 'MMMM yyyy');
  const contribution = new Map(breakdown.items.map(item => [item.income.id, item]));
  // Income received in the viewed month first, then the rest; each group by source and name.
  const listed = [...incomes]
    .filter(income => !restrictToMonth || contribution.has(income.id))
    .sort((a, b) => Number(contribution.has(b.id)) - Number(contribution.has(a.id)) || incomeLabel(a).localeCompare(incomeLabel(b)));

  // The containing profile or modal owns the single navigation/unload guard.
  useLayoutEffect(() => {
    onEditorStateChange({ dirty, busy });
  }, [dirty, busy, onEditorStateChange]);

  const canDiscard = () => !dirty || window.confirm('Discard unsaved income changes?');

  const openEditor = (income?: Income) => {
    if (disabled || requestLock.current || !canDiscard()) return;
    const draft = createIncomeDraft(defaultStartDate(selectedMonth), income);
    setEditor({ draft, snapshot: { ...draft } });
    setError(null);
    setNotice(null);
  };

  const cancel = () => {
    if (disabled || requestLock.current || !canDiscard()) return;
    setEditor(null);
    setError(null);
  };

  const change = <K extends keyof IncomeDraft>(field: K, value: IncomeDraft[K]) => {
    if (disabled || requestLock.current) return;
    setEditor(current => current && { ...current, draft: { ...current.draft, [field]: value } });
    setError(null);
    setNotice(null);
  };

  const changeSelectedMonth = (month: string) => {
    if (restrictToMonth || disabled || requestLock.current || month === selectedMonth) return;
    if (!isValidMonth(month)) {
      setError('Choose a valid month in YYYY-MM format, with a year from 0001 to 9999.');
      return;
    }
    setSelectedMonth(month);
    setError(null);
    setNotice(null);
  };

  const save = async () => {
    if (!editor || disabled || requestLock.current) return;
    const { draft, snapshot } = editor;
    let input;
    try {
      input = validateIncomeDraft(draft);
    } catch (failure) {
      setError(errorMessage(failure));
      return;
    }
    requestLock.current = true;
    setOperation('save');
    setError(null);
    setNotice(null);
    try {
      if (snapshot.id !== undefined) await updateIncome(snapshot.id, input);
      else await createIncome(input);
      setEditor(null);
      setNotice(`${snapshot.id === undefined ? 'Added' : 'Updated'} “${incomeLabel(input)}” (${money(input.amount)}, ${describeIncomeSchedule(input).toLowerCase()}).`);
    } catch (failure) {
      setError(`Could not save income: ${errorMessage(failure)}`);
    } finally {
      requestLock.current = false;
      setOperation(null);
    }
  };

  const remove = async (income: Income) => {
    if (disabled || requestLock.current || editor) return;
    if (!window.confirm(`Delete “${incomeLabel(income)}” (${money(income.amount)}, ${describeIncomeSchedule(income).toLowerCase()})? It is removed from every month. This cannot be undone.`)) return;
    requestLock.current = true;
    setOperation('delete');
    setDeletingId(income.id);
    setError(null);
    setNotice(null);
    try {
      await deleteIncome(income.id);
      setNotice(`Deleted “${incomeLabel(income)}”.`);
    } catch (failure) {
      setError(`Could not delete income: ${errorMessage(failure)}`);
    } finally {
      requestLock.current = false;
      setOperation(null);
      setDeletingId(null);
    }
  };

  const frequencyOptions = Object.entries(INCOME_FREQUENCY_LABELS) as [IncomeFrequency, string][];
  const once = editor?.draft.frequency === 'once';

  return (
    <section className="profile-card profile-card-wide glass" aria-labelledby={`${id}-heading`} aria-busy={busy}>
      <h2 id={`${id}-heading`} className="profile-section-heading">
        {editor || blocked ? (
          <span className="profile-section-title"><CircleDollarSign size={20} aria-hidden="true" />Income sources</span>
        ) : (
          <button type="button" className="profile-edit-section" onClick={() => openEditor()} aria-label="Add income source">
            <span className="profile-section-title"><CircleDollarSign size={20} aria-hidden="true" />Income sources</span>
            <span className="profile-edit-label"><Plus size={15} aria-hidden="true" />Add income</span>
          </button>
        )}
      </h2>
      <p id={`${id}-help`} className="profile-hint">Record each income separately: salary, freelance work, allowance, gifts, and so on. Each is paid once or repeats daily, weekly, monthly, or yearly; a month’s income is the sum of every payment that falls in it.</p>
      {restrictToMonth ? (
        <p className="profile-income-month">Income month: <time dateTime={selectedMonth}>{monthLabel}</time></p>
      ) : (
        <label className="profile-income-month">View month
          <input type="month" min="0001-01" max="9999-12" value={selectedMonth} disabled={blocked} aria-describedby={`${id}-help`} onChange={event => changeSelectedMonth(event.target.value)} />
        </label>
      )}
      <dl className="profile-income-breakdown" aria-label={`Income breakdown for ${monthLabel}`}>
        <div><dt>Recurring income</dt><dd>{money(breakdown.recurringIncome)}</dd></div>
        <div><dt>One-time income</dt><dd>+ {money(breakdown.oneTimeIncome)}</dd></div>
        <div className="profile-income-total"><dt>Total for {monthLabel}</dt><dd>= {money(breakdown.totalIncome)}</dd></div>
      </dl>
      {editor && (
        <form className="profile-form profile-income-entry-form" noValidate aria-label={editor.snapshot.id === undefined ? 'Add income' : 'Edit income'} aria-busy={busy} onSubmit={event => { event.preventDefault(); void save(); }}>
          <h3>{editor.snapshot.id === undefined ? 'Add income' : 'Edit income'}</h3>
          <fieldset disabled={blocked} aria-describedby={`${id}-entry-help${error ? ` ${id}-error` : ''}`}>
            <div className="profile-credentials">
              <label>Source
                <input type="text" required maxLength={100} list={`${id}-sources`} autoFocus value={editor.draft.source} placeholder="e.g. Salary" onChange={event => change('source', event.target.value)} />
              </label>
              <label>Name (optional)
                <input type="text" maxLength={500} value={editor.draft.name} placeholder="e.g. Company, client, or person" onChange={event => change('name', event.target.value)} />
              </label>
            </div>
            <datalist id={`${id}-sources`}>
              {INCOME_SOURCE_SUGGESTIONS.map(source => <option key={source} value={source} />)}
            </datalist>
            <div className="profile-credentials">
              <label>Amount per payment (₫)
                <input type="text" inputMode="decimal" required value={editor.draft.amount} placeholder="e.g. 500000" onChange={event => change('amount', event.target.value)} />
              </label>
              <label>Frequency
                <select value={editor.draft.frequency} onChange={event => change('frequency', event.target.value as IncomeFrequency)}>
                  {frequencyOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
            </div>
            <div className="profile-credentials">
              <label>{once ? 'Date received' : 'Start date (first payment)'}
                <input type="date" min="0001-01-01" max="9999-12-31" required value={editor.draft.startDate} onChange={event => change('startDate', event.target.value)} />
              </label>
              {!once && (
                <label>End date (optional)
                  <input type="date" min={editor.draft.startDate || '0001-01-01'} max="9999-12-31" value={editor.draft.endDate} onChange={event => change('endDate', event.target.value)} />
                </label>
              )}
            </div>
            <p id={`${id}-entry-help`} className="profile-hint">Enter a positive amount per payment up to 1,000,000,000,000 ₫ with up to two decimal places. Weekly income repeats on the start date’s weekday; monthly and yearly income on its day of the month (moved to the last day in shorter months). Leave the end date empty if the income has no planned end.</p>
          </fieldset>
          <EditorActions busy={blocked} onCancel={cancel} />
        </form>
      )}
      {error && <p id={`${id}-error`} className="profile-error" role="alert">{error}</p>}
      {notice && <p className="profile-income-notice" role="status">{notice}</p>}
      {listed.length === 0 ? (
        <p className="profile-hint">{restrictToMonth ? `No income received in ${monthLabel}.` : 'No income sources yet.'} Add income above to record a salary, freelance payment, gift, or other income.</p>
      ) : (
        <ul className="profile-income-entries" aria-label={restrictToMonth ? `Income received in ${monthLabel}` : 'All income sources'}>
          {listed.map(income => {
            const item = contribution.get(income.id);
            return (
              <li className="profile-income-entry" key={income.id}>
                <div className="profile-income-entry-details">
                  <strong>{incomeLabel(income)}</strong>
                  <span>{money(income.amount)} · {describeIncomeSchedule(income)}</span>
                  <span>{item
                    ? `${monthLabel}: ${item.occurrences > 1 ? `${item.occurrences} × ${money(income.amount)} = ` : ''}${money(item.total)}`
                    : `Nothing received in ${monthLabel}`}</span>
                </div>
                <div className="profile-actions">
                  <button type="button" className="profile-button" disabled={blocked} aria-label={`Edit ${incomeLabel(income)}`} onClick={() => openEditor(income)}><Edit2 size={16} aria-hidden="true" />Edit</button>
                  <button type="button" className="profile-button profile-button-danger" disabled={blocked || editor !== null} aria-label={`Delete ${incomeLabel(income)}`} onClick={() => { void remove(income); }}><Trash2 size={16} aria-hidden="true" />{deletingId === income.id ? 'Deleting…' : 'Delete'}</button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
