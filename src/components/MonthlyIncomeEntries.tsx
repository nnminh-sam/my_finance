'use client';

import { useId, useLayoutEffect, useRef, useState } from 'react';
import { CircleDollarSign, Edit2, Plus, Trash2 } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { errorMessage } from '../services/auth';
import { useFinance } from '../contexts/FinanceContext';
import { useSettings } from '../contexts/SettingsContext';
import { getMonthIncome, incomeMonth } from '../lib/income';
import { createIncomeEntryDraft, isIncomeEntryDraftDirty, isValidIncomeMonth, validateIncomeEntryDraft } from '../lib/incomeEntryDraft';
import type { IncomeEntryDraft } from '../lib/incomeEntryDraft';
import type { IncomeEntry } from '../types';
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
  restrictToMonth?: boolean;
}

type Editor = { draft: IncomeEntryDraft; snapshot: IncomeEntryDraft };
const money = (amount: number) => `${amount.toLocaleString('vi-VN', { maximumFractionDigits: 2 })} ₫`;

export function MonthlyIncomeEntries({ disabled, onEditorStateChange, initialMonth, initiallyAdding = false, restrictToMonth = false }: Props) {
  const { incomeEntries, createIncomeEntry, updateIncomeEntry, deleteIncomeEntry } = useFinance();
  const { settings } = useSettings();
  const [selectedMonth, setSelectedMonth] = useState(() => initialMonth ?? incomeMonth(new Date()));
  const [editor, setEditor] = useState<Editor | null>(() => {
    if (!initiallyAdding) return null;
    const draft = createIncomeEntryDraft(selectedMonth);
    return { draft, snapshot: { ...draft } };
  });
  const [operation, setOperation] = useState<'save' | 'delete' | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const requestLock = useRef(false);
  const id = useId();
  const dirty = editor !== null && isIncomeEntryDraftDirty(editor.draft, editor.snapshot);
  const busy = operation !== null;
  const blocked = disabled || busy;
  const breakdown = getMonthIncome(settings.income, selectedMonth, incomeEntries);

  const monthLabel = restrictToMonth ? format(parseISO(`${selectedMonth}-01`), 'MMMM yyyy') : selectedMonth;

  // The containing profile or modal owns the single navigation/unload guard.
  useLayoutEffect(() => {
    onEditorStateChange({ dirty, busy });
  }, [dirty, busy, onEditorStateChange]);

  const canDiscard = () => !dirty || window.confirm('Discard unsaved additional income changes?');

  const openEditor = (entry?: IncomeEntry) => {
    if (disabled || requestLock.current || !canDiscard()) return;
    const draft = createIncomeEntryDraft(selectedMonth, entry);
    setEditor({ draft, snapshot: { ...draft } });
    setError(null);
    setNotice(null);
  };

  const cancel = () => {
    if (disabled || requestLock.current || !canDiscard()) return;
    setEditor(null);
    setError(null);
  };

  const change = (field: 'month' | 'amount' | 'description', value: string) => {
    if (disabled || requestLock.current || (restrictToMonth && field === 'month')) return;
    setEditor(current => current && { ...current, draft: { ...current.draft, [field]: value } });
    setError(null);
    setNotice(null);
  };

  const changeSelectedMonth = (month: string) => {
    if (restrictToMonth || disabled || requestLock.current || month === selectedMonth) return;
    if (!isValidIncomeMonth(month)) {
      setError('Choose a valid month in YYYY-MM format, with a year from 0001 to 9999.');
      return;
    }
    if (!canDiscard()) return;
    setSelectedMonth(month);
    setEditor(null);
    setError(null);
    setNotice(null);
  };

  const save = async () => {
    if (!editor || disabled || requestLock.current) return;
    const { draft, snapshot } = editor;
    let input;
    try {
      input = validateIncomeEntryDraft(draft);
    } catch (failure) {
      setError(errorMessage(failure));
      return;
    }
    requestLock.current = true;
    setOperation('save');
    setError(null);
    setNotice(null);
    try {
      if (snapshot.id !== undefined) await updateIncomeEntry(snapshot.id, input);
      else await createIncomeEntry(input);
      setEditor(null);
      setSelectedMonth(input.month);
      setNotice(snapshot.id === undefined
        ? `Added “${input.description}” for ${input.month}.`
        : snapshot.month === input.month
          ? `Updated “${input.description}” for ${input.month}.`
          : `Moved “${input.description}” from ${snapshot.month} to ${input.month}. Other entries are unchanged.`);
    } catch (failure) {
      setError(`Could not save additional income for ${draft.month}: ${errorMessage(failure)}`);
    } finally {
      requestLock.current = false;
      setOperation(null);
    }
  };

  const remove = async (entry: IncomeEntry) => {
    if (disabled || requestLock.current || editor) return;
    if (!window.confirm(`Delete “${entry.description}” (${money(entry.amount)}) from ${entry.month}? This cannot be undone.`)) return;
    requestLock.current = true;
    setOperation('delete');
    setDeletingId(entry.id);
    setError(null);
    setNotice(null);
    try {
      await deleteIncomeEntry(entry.id);
      setNotice(`Deleted “${entry.description}” from ${entry.month}.`);
    } catch (failure) {
      setError(`Could not delete additional income for ${entry.month}: ${errorMessage(failure)}`);
    } finally {
      requestLock.current = false;
      setOperation(null);
      setDeletingId(null);
    }
  };

  return (
    <section className="profile-card profile-card-wide glass" aria-labelledby={`${id}-heading`} aria-busy={busy}>
      <h2 id={`${id}-heading`} className="profile-section-heading">
        {editor || blocked ? (
          <span className="profile-section-title"><CircleDollarSign size={20} aria-hidden="true" />Additional income by month</span>
        ) : (
          <button type="button" className="profile-edit-section" onClick={() => openEditor()} aria-label="Add additional income by month">
            <span className="profile-section-title"><CircleDollarSign size={20} aria-hidden="true" />Additional income by month</span>
            <span className="profile-edit-label"><Plus size={15} aria-hidden="true" />Add income</span>
          </button>
        )}
      </h2>
      <p id={`${id}-help`} className="profile-hint">Add one-off income, such as a bonus, to a specific month and year. It adds to—not overrides—your recurring monthly income, does not recur, and leaves other months unaffected.</p>
      {restrictToMonth ? (
        <p className="profile-income-month">Income month: <time dateTime={selectedMonth}>{monthLabel}</time></p>
      ) : (
        <label className="profile-income-month">View month
          <input type="month" min="0001-01" max="9999-12" value={selectedMonth} disabled={blocked} aria-describedby={`${id}-help`} onChange={event => changeSelectedMonth(event.target.value)} />
        </label>
      )}
      <dl className="profile-income-breakdown" aria-label={`Income breakdown for ${selectedMonth}`}>
        <div><dt>Recurring monthly income</dt><dd>{money(breakdown.baseIncome)}</dd></div>
        <div><dt>Additional income for {selectedMonth}</dt><dd>+ {money(breakdown.additionalIncome)}</dd></div>
        <div className="profile-income-total"><dt>Total for {selectedMonth}</dt><dd>= {money(breakdown.totalIncome)}</dd></div>
      </dl>
      {editor && (
        <form className="profile-form profile-income-entry-form" noValidate aria-label={editor.snapshot.id === undefined ? 'Add additional income' : 'Edit additional income'} aria-busy={busy} onSubmit={event => { event.preventDefault(); void save(); }}>
          <h3>{editor.snapshot.id === undefined ? 'Add income' : 'Edit income'}</h3>
          <fieldset disabled={blocked} aria-describedby={`${id}-entry-help${error ? ` ${id}-error` : ''}`}>
            <div className="profile-credentials">
              <label>Income month<input type="month" min="0001-01" max="9999-12" required readOnly={restrictToMonth} value={editor.draft.month} onChange={event => change('month', event.target.value)} /></label>
              <label>Amount (₫)<input type="text" inputMode="decimal" required autoFocus value={editor.draft.amount} placeholder="e.g. 500000" onChange={event => change('amount', event.target.value)} /></label>
            </div>
            <label>Description / reason<input type="text" required maxLength={500} value={editor.draft.description} placeholder="e.g. Performance bonus" onChange={event => change('description', event.target.value)} /></label>
            <p id={`${id}-entry-help`} className="profile-hint">Enter a positive amount up to 1,000,000,000,000 ₫ with up to two decimal places and a description of 1–500 characters. {restrictToMonth ? 'The income month is fixed for this dialog.' : 'Changing the income month moves only this entry.'}</p>
          </fieldset>
          <EditorActions busy={blocked} onCancel={cancel} />
        </form>
      )}
      {error && <p id={`${id}-error`} className="profile-error" role="alert">{error}</p>}
      {notice && <p className="profile-income-notice" role="status">{notice}</p>}
      {breakdown.entries.length === 0 ? (
        <p className="profile-hint">No additional income for {selectedMonth}. Add income above to record a bonus or other one-off payment.</p>
      ) : (
        <ul className="profile-income-entries" aria-label={`Additional income for ${selectedMonth}`}>
          {breakdown.entries.map(entry => (
            <li className="profile-income-entry" key={entry.id}>
              <div className="profile-income-entry-details"><strong>{entry.description}</strong><span><time dateTime={entry.month}>{entry.month}</time> · {money(entry.amount)}</span></div>
              <div className="profile-actions">
                <button type="button" className="profile-button" disabled={blocked} aria-label={`Edit ${entry.description} for ${entry.month}`} onClick={() => openEditor(entry)}><Edit2 size={16} aria-hidden="true" />Edit</button>
                <button type="button" className="profile-button profile-button-danger" disabled={blocked || editor !== null} aria-label={`Delete ${entry.description} for ${entry.month}`} onClick={() => { void remove(entry); }}><Trash2 size={16} aria-hidden="true" />{deletingId === entry.id ? 'Deleting…' : 'Delete'}</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
