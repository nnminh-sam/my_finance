'use client';

import { useId, useLayoutEffect, useRef, useState } from 'react';
import { Briefcase, CalendarClock, ChevronLeft, ChevronRight, CircleDollarSign, Gift, Laptop, Pencil, Plus, Trash2, TrendingUp, Wallet, X } from 'lucide-react';
import { addMonths, format, parseISO } from 'date-fns';
import { errorMessage } from '../services/auth';
import { useFinance } from '../contexts/FinanceContext';
import { describeIncomeSchedule, getMonthIncome, INCOME_FREQUENCY_LABELS, INCOME_SOURCE_SUGGESTIONS, incomeMonth } from '../lib/income';
import { createIncomeDraft, describeIncomeDraft, isIncomeDraftDirty, validateIncomeDraft } from '../lib/incomeDraft';
import type { IncomeDraft } from '../lib/incomeDraft';
import type { Income, IncomeFrequency } from '../types';

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
const shiftMonth = (month: string, by: number) => format(addMonths(parseISO(`${month}-01`), by), 'yyyy-MM');
const SOURCE_ICONS: Record<string, typeof CircleDollarSign> = {
  salary: Briefcase,
  freelance: Laptop,
  bonus: Gift,
  gift: Gift,
  allowance: Wallet,
  investment: TrendingUp,
};
const knownSourceFor = (source: string) => INCOME_SOURCE_SUGGESTIONS.find(item => item.toLowerCase() === source.trim().toLowerCase());
// Accept pasted grouping such as "32,000,000" or "32.000.000"; a single dot with 1–2 digits stays a decimal point.
const normalizeAmount = (value: string) => {
  const compact = value.replace(/[\s,_]/g, '');
  return /^\d{1,3}(?:\.\d{3})+$/.test(compact) ? compact.replace(/\./g, '') : compact;
};

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
  const [customSource, setCustomSource] = useState(false);
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
    setCustomSource(draft.source.trim() !== '' && !knownSourceFor(draft.source));
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

  const pickSource = (source: string | null) => {
    setCustomSource(source === null);
    // Switching to Custom keeps a typed source but clears a preset one.
    change('source', source ?? (editor && !knownSourceFor(editor.draft.source) ? editor.draft.source : ''));
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
  const adding = editor?.snapshot.id === undefined;
  const knownSource = editor ? knownSourceFor(editor.draft.source) : undefined;
  const schedule = editor ? describeIncomeDraft(editor.draft) : null;

  return (
    <section className="profile-panel" aria-labelledby={`${id}-heading`} aria-busy={busy}>
      <div className="profile-panel-head">
        <div>
          <h2 id={`${id}-heading`}>Income sources</h2>
          <p id={`${id}-help`}>Salary, freelance work, allowance, gifts and other payments. Each one is paid once or repeats daily, weekly, monthly or yearly; a month’s income is the sum of every payment that falls in it.</p>
        </div>
        <div className="profile-panel-tools">
          {restrictToMonth ? (
            <p className="profile-income-month">Income month: <time dateTime={selectedMonth}>{monthLabel}</time></p>
          ) : (
            <div className="profile-month-switch" role="group" aria-label="Viewed month">
              <button type="button" className="profile-icon-button" disabled={blocked} aria-label="Previous month" onClick={() => changeSelectedMonth(shiftMonth(selectedMonth, -1))}><ChevronLeft size={16} aria-hidden="true" /></button>
              <input type="month" min="0001-01" max="9999-12" value={selectedMonth} disabled={blocked} aria-label="View month" aria-describedby={`${id}-help`} onChange={event => changeSelectedMonth(event.target.value)} />
              <button type="button" className="profile-icon-button" disabled={blocked} aria-label="Next month" onClick={() => changeSelectedMonth(shiftMonth(selectedMonth, 1))}><ChevronRight size={16} aria-hidden="true" /></button>
            </div>
          )}
          {!editor && (
            <button type="button" className="profile-button profile-button-primary" disabled={blocked} onClick={() => openEditor()}><Plus size={16} aria-hidden="true" />Add income</button>
          )}
        </div>
      </div>
      <dl className="profile-card profile-summary" aria-label={`Income breakdown for ${monthLabel}`}>
        <div><dt>Total for {monthLabel}</dt><dd className="profile-positive">{money(breakdown.totalIncome)}</dd></div>
        <div><dt>Recurring</dt><dd>{money(breakdown.recurringIncome)}</dd></div>
        <div><dt>One-time</dt><dd>{money(breakdown.oneTimeIncome)}</dd></div>
      </dl>
      {editor && (
        <form className="profile-card income-form" noValidate aria-labelledby={`${id}-form-title`} aria-busy={busy} onSubmit={event => { event.preventDefault(); void save(); }}>
          <div className="income-form-head">
            <h3 id={`${id}-form-title`}>{adding ? 'Add income' : `Edit ${incomeLabel(editor.snapshot)}`}</h3>
            <button type="button" className="profile-icon-button" disabled={blocked} aria-label="Close without saving" onClick={cancel}><X size={18} aria-hidden="true" /></button>
          </div>
          <fieldset className="income-form-body" disabled={blocked}>
            <div className="income-form-group" role="group" aria-labelledby={`${id}-source-label`}>
              <span id={`${id}-source-label`} className="income-form-label">Source</span>
              <div className="income-chips">
                {INCOME_SOURCE_SUGGESTIONS.map(source => {
                  const Icon = SOURCE_ICONS[source.toLowerCase()] ?? CircleDollarSign;
                  return (
                    <button key={source} type="button" className="income-chip" aria-pressed={!customSource && knownSource === source} onClick={() => pickSource(source)}>
                      <Icon size={15} aria-hidden="true" />{source}
                    </button>
                  );
                })}
                <button type="button" className="income-chip" aria-pressed={customSource} onClick={() => pickSource(null)}>
                  <Pencil size={15} aria-hidden="true" />Custom
                </button>
              </div>
              {customSource && (
                <input type="text" className="income-input" autoFocus maxLength={100} aria-label="Custom source" placeholder="Name the source, e.g. Rental" value={editor.draft.source} onChange={event => change('source', event.target.value)} />
              )}
            </div>

            <label className="income-form-group">
              <span className="income-form-label">From <span className="income-optional">optional</span></span>
              <input type="text" className="income-input" maxLength={500} value={editor.draft.name} placeholder="Employer, client or person" onChange={event => change('name', event.target.value)} />
            </label>

            <label className="income-form-group">
              <span className="income-form-label">Amount per payment</span>
              <span className="income-amount">
                <input type="text" inputMode="decimal" autoComplete="off" required value={editor.draft.amount} placeholder="0" aria-describedby={`${id}-schedule`} onChange={event => change('amount', normalizeAmount(event.target.value))} />
                <span aria-hidden="true">₫</span>
              </span>
            </label>

            <fieldset className="income-form-group">
              <legend className="income-form-label">How often</legend>
              <div className="income-segmented">
                {frequencyOptions.map(([value, label]) => (
                  <label key={value} className="income-segment">
                    <input type="radio" name={`${id}-frequency`} value={value} checked={editor.draft.frequency === value} onChange={() => change('frequency', value)} />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="income-dates">
              <label className="income-form-group">
                <span className="income-form-label">{once ? 'Received on' : 'First payment'}</span>
                <input type="date" className="income-input" min="0001-01-01" max="9999-12-31" required value={editor.draft.startDate} onChange={event => change('startDate', event.target.value)} />
              </label>
              {!once && (
                <label className="income-form-group">
                  <span className="income-form-label">Last payment <span className="income-optional">optional</span></span>
                  <span className="income-date-clear">
                    <input type="date" className="income-input" min={editor.draft.startDate || '0001-01-01'} max="9999-12-31" value={editor.draft.endDate} onChange={event => change('endDate', event.target.value)} />
                    {editor.draft.endDate && <button type="button" className="profile-icon-button" aria-label="Remove last payment date" onClick={() => change('endDate', '')}><X size={16} aria-hidden="true" /></button>}
                  </span>
                </label>
              )}
            </div>
          </fieldset>

          <p id={`${id}-schedule`} className={`income-schedule${schedule ? '' : ' income-schedule-empty'}`} aria-live="polite">
            <CalendarClock size={18} aria-hidden="true" />
            <span>{schedule ?? 'Enter an amount to see when this income is paid.'}</span>
          </p>
          {error && <p id={`${id}-error`} className="profile-error" role="alert">{error}</p>}
          <div className="income-form-foot">
            <button type="button" className="profile-button profile-button-ghost" disabled={blocked} onClick={cancel}>Cancel</button>
            <button type="submit" className="profile-button profile-button-primary" disabled={blocked}>
              {operation === 'save' ? 'Saving…' : adding ? 'Add income' : 'Save changes'}
            </button>
          </div>
        </form>
      )}
      {error && !editor && <p id={`${id}-error`} className="profile-error" role="alert">{error}</p>}
      {notice && <p className="profile-notice" role="status">{notice}</p>}
      {listed.length === 0 ? (
        <p className="profile-card profile-empty">{restrictToMonth ? `No income received in ${monthLabel}.` : 'No income sources yet.'} Add income to record a salary, freelance payment, gift, or other income.</p>
      ) : (
        <ul className="profile-card profile-list" aria-label={restrictToMonth ? `Income received in ${monthLabel}` : 'All income sources'}>
          {listed.map(income => {
            const item = contribution.get(income.id);
            const Icon = SOURCE_ICONS[income.source.trim().toLowerCase()] ?? CircleDollarSign;
            return (
              <li className={`profile-list-item${item ? '' : ' profile-list-item-muted'}`} key={income.id}>
                <span className="profile-glyph profile-glyph-income" aria-hidden="true"><Icon size={18} /></span>
                <div className="profile-list-main">
                  <strong>{incomeLabel(income)}</strong>
                  <span className="profile-meta">
                    <span className={`profile-pill${item ? ' profile-pill-on' : ''}`}>{describeIncomeSchedule(income)}</span>
                    <span>{money(income.amount)} per payment</span>
                  </span>
                </div>
                <div className="profile-amount">
                  {item ? money(item.total) : '—'}
                  <small>{item
                    ? (item.occurrences > 1 ? `${item.occurrences} × ${money(income.amount)}` : `in ${monthLabel}`)
                    : `Nothing in ${monthLabel}`}</small>
                </div>
                <div className="profile-row-actions">
                  <button type="button" className="profile-icon-button" disabled={blocked} aria-label={`Edit ${incomeLabel(income)}`} onClick={() => openEditor(income)}><Pencil size={16} aria-hidden="true" /></button>
                  <button type="button" className="profile-icon-button profile-icon-button-danger" disabled={blocked || editor !== null} aria-label={deletingId === income.id ? `Deleting ${incomeLabel(income)}` : `Delete ${incomeLabel(income)}`} onClick={() => { void remove(income); }}><Trash2 size={16} aria-hidden="true" /></button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
