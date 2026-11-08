'use client';

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { addMonths, endOfMonth, format, parseISO, startOfMonth } from 'date-fns';
import {
  Briefcase, CalendarClock, Car, CircleDollarSign, Coffee, Film, Gift, Heart, Home, Pencil, Phone, Plus,
  Receipt, ShoppingBag, Trash2, Utensils, X,
} from 'lucide-react';
import { errorMessage } from '../services/auth';
import { useFinance } from '../contexts/FinanceContext';
import { addDays, describePlanSchedule, planOccurrences, type PlanFrequency } from '../lib/plans';
import { DEFAULT_BUDGET_PERIOD, periodOf, type BudgetPeriod } from '../lib/periods';
import {
  createPlanDraft, describePlanDraft, isPlanDraftDirty, PLAN_FREQUENCY_LABELS, PLAN_PRESETS, validatePlanDraft,
  type PlanDraft,
} from '../lib/planDraft';
import type { Plan } from '../types';

export interface PlanEditorState {
  dirty: boolean;
  busy: boolean;
}

interface Props {
  disabled: boolean;
  onEditorStateChange: (state: PlanEditorState) => void;
  /** Open this plan's editor on mount; `from` pre-selects "change from this date". */
  initialEdit?: { id: string; from?: string } | null;
  /** The budget period shown on the page. Without it the totals cover the current calendar month. */
  period?: BudgetPeriod | null;
  /** Today in the user's time zone, from the same summary as `period`. */
  today?: string;
  /** A past period: the list and totals stay, plan create, edit and delete controls are hidden. */
  readOnly?: boolean;
}

type Editor = { draft: PlanDraft; snapshot: PlanDraft };
const ICONS = { Utensils, Car, Film, ShoppingBag, Receipt, CircleDollarSign, Coffee, Home, Heart, Briefcase, Gift, Phone };
const DAY_LABELS = [['Mon', 1], ['Tue', 2], ['Wed', 3], ['Thu', 4], ['Fri', 5], ['Sat', 6], ['Sun', 0]] as const;
const money = (amount: number) => `${amount.toLocaleString('vi-VN', { maximumFractionDigits: 2 })} ₫`;
const iso = (date: Date) => format(date, 'yyyy-MM-dd');
const UNIT: Partial<Record<PlanFrequency, string>> = { daily: 'days', weekly: 'weeks', monthly: 'months' };

export function PlannedSpendings({ disabled, onEditorStateChange, initialEdit, period = null, today: serverToday, readOnly = false }: Props) {
  const { plans, incomes, settings, projectedBetween, createPlan, updatePlan, splitPlan, deletePlan } = useFinance();
  const [editor, setEditor] = useState<Editor | null>(null);
  const [operation, setOperation] = useState<'save' | 'delete' | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const requestLock = useRef(false);
  const id = useId();
  const dirty = editor !== null && isPlanDraftDirty(editor.draft, editor.snapshot);
  const busy = operation !== null;
  const blocked = disabled || busy || readOnly;
  const categories = settings.categories;
  // New plans use active categories; a plan on an archived one still shows it.
  const active = categories.filter(item => !item.archived);

  const now = new Date();
  const today = serverToday ?? iso(now);
  // Totals cover the period on the page. Calendar-month periods keep the "month" wording.
  const nextMonthStart = startOfMonth(addMonths(now, 1));
  const restFrom = period ? (today > period.start ? today : period.start) : today;
  const restTo = period ? period.end : iso(endOfMonth(now));
  const restOfMonth = restFrom > restTo ? [] : projectedBetween(restFrom, restTo);
  const following = period ? periodOf(settings.budgetPeriod ?? DEFAULT_BUDGET_PERIOD, incomes, period.nextStart) : null;
  const nextMonth = following ? projectedBetween(following.start, following.end) : projectedBetween(iso(nextMonthStart), iso(endOfMonth(nextMonthStart)));
  const calendarWording = !period || period.mode === 'calendar';
  const restLabel = calendarWording ? `Rest of ${format(period ? parseISO(period.start) : now, 'MMMM')}` : 'Rest of period';
  const nextLabel = calendarWording ? format(following ? parseISO(following.start) : nextMonthStart, 'MMMM') : 'Next period';
  const periodWord = calendarWording ? 'month' : 'period';
  const sum = (items: { amount: number }[]) => items.reduce((total, item) => total + item.amount, 0);
  const remainingByPlan = useMemo(() => {
    const byPlan = new Map<string, { count: number; total: number }>();
    for (const item of restOfMonth) {
      const entry = byPlan.get(item.planId) ?? { count: 0, total: 0 };
      byPlan.set(item.planId, { count: entry.count + 1, total: entry.total + item.amount });
    }
    return byPlan;
  }, [restOfMonth]);

  // Moving to a past period closes the editor, so its unsaved-changes guard cannot stay on.
  useEffect(() => {
    if (readOnly) setEditor(null);
  }, [readOnly]);

  useLayoutEffect(() => {
    onEditorStateChange({ dirty, busy });
  }, [dirty, busy, onEditorStateChange]);

  // Deep link from a day's planned item ("Series"): open that plan, changing from that date when possible.
  const openedInitial = useRef(false);
  useEffect(() => {
    if (openedInitial.current || !initialEdit) return;
    const plan = plans.find(item => item.id === initialEdit.id);
    if (!plan) return;
    openedInitial.current = true;
    const draft = createPlanDraft(today, active[0]?.id ?? '', plan);
    const from = initialEdit.from;
    if (from && plan.frequency !== 'once' && from > today && from > plan.startDate) draft.effectiveFrom = from;
    setEditor({ draft, snapshot: { ...draft, daysOfWeek: [...draft.daysOfWeek] } });
  }, [initialEdit, plans, today, categories]);

  const canDiscard = () => !dirty || window.confirm('Discard unsaved plan changes?');

  const openEditor = (plan?: Plan) => {
    if (disabled || requestLock.current || !canDiscard()) return;
    const draft = createPlanDraft(today, active[0]?.id ?? '', plan);
    setEditor({ draft, snapshot: { ...draft, daysOfWeek: [...draft.daysOfWeek] } });
    setError(null);
    setNotice(null);
  };

  const cancel = () => {
    if (disabled || requestLock.current || !canDiscard()) return;
    setEditor(null);
    setError(null);
  };

  const change = (patch: Partial<PlanDraft>) => {
    if (disabled || requestLock.current) return;
    setEditor(current => current && { ...current, draft: { ...current.draft, ...patch } });
    setError(null);
    setNotice(null);
  };

  const applyPreset = (preset: typeof PLAN_PRESETS[number]) => {
    const category = categories.some(item => item.id === preset.category) ? preset.category : (editor?.draft.category ?? '');
    change({ description: preset.description, amount: String(preset.amount), time: preset.time, frequency: preset.frequency, category, daysOfWeek: [], sure: false });
  };

  const toggleDay = (day: number) => {
    if (!editor) return;
    const days = editor.draft.daysOfWeek.includes(day)
      ? editor.draft.daysOfWeek.filter(item => item !== day)
      : [...editor.draft.daysOfWeek, day];
    change({ daysOfWeek: days });
  };

  const save = async () => {
    if (!editor || disabled || requestLock.current) return;
    const { draft, snapshot } = editor;
    let input;
    try {
      input = validatePlanDraft(draft);
      if (snapshot.id && draft.effectiveFrom) {
        if (draft.effectiveFrom <= today) throw new Error('Choose a future date for the changes to start, or apply them to every upcoming occurrence.');
        if (draft.effectiveFrom <= snapshot.startDate) throw new Error('The changes must start after the plan’s first day. Apply them to every upcoming occurrence instead.');
      }
    } catch (failure) {
      setError(errorMessage(failure));
      return;
    }
    requestLock.current = true;
    setOperation('save');
    setError(null);
    setNotice(null);
    try {
      const label = input.description || 'Plan';
      if (!snapshot.id) {
        await createPlan(input);
        setNotice(`Planned “${label}”: ${money(input.amount)}, ${describePlanSchedule(input).toLowerCase()}.`);
      } else if (draft.effectiveFrom) {
        // "This and future": the current plan ends the day before; a new one starts on that date.
        await splitPlan(snapshot.id, { ...input, startDate: draft.effectiveFrom });
        setNotice(`“${label}” changes from ${draft.effectiveFrom}; earlier days keep the old plan.`);
      } else {
        await updatePlan(snapshot.id, input);
        setNotice(`Updated “${label}”. Past spendings are unchanged.`);
      }
      setEditor(null);
    } catch (failure) {
      setError(`Could not save plan: ${errorMessage(failure)}`);
    } finally {
      requestLock.current = false;
      setOperation(null);
    }
  };

  const remove = async (plan: Plan) => {
    if (disabled || requestLock.current || editor) return;
    if (!window.confirm(`Stop planning “${plan.description || 'this plan'}” (${money(plan.amount)}, ${describePlanSchedule(plan).toLowerCase()})? Upcoming planned days disappear; spendings that already happened are kept.`)) return;
    requestLock.current = true;
    setOperation('delete');
    setDeletingId(plan.id);
    setError(null);
    setNotice(null);
    try {
      await deletePlan(plan.id);
      setNotice(`Stopped “${plan.description || 'plan'}”. Its past spendings are kept.`);
    } catch (failure) {
      setError(`Could not delete plan: ${errorMessage(failure)}`);
    } finally {
      requestLock.current = false;
      setOperation(null);
      setDeletingId(null);
    }
  };

  const draft = editor?.draft;
  const adding = editor !== null && editor.snapshot.id === undefined;
  const summary = draft ? describePlanDraft(draft) : null;
  const sorted = [...plans].sort((a, b) => Number(b.sure) - Number(a.sure) || a.time.localeCompare(b.time) || a.description.localeCompare(b.description));

  return (
    <section className="profile-panel" aria-labelledby={`${id}-heading`} aria-busy={busy}>
      <div className="profile-panel-head">
        <div>
          <h2 id={`${id}-heading`}>Spending plans</h2>
          <p id={`${id}-help`}>What you expect to spend: <b>commitments</b> like rent and bills, and <b>estimates</b> like breakfast and lunch every weekday. Planned days show on the calendar and count in projected totals; each one becomes a real spending once its date and time pass.</p>
        </div>
        <div className="profile-panel-tools">
          {!editor && !readOnly && (
            <button type="button" className="profile-button profile-button-primary" disabled={blocked || active.length === 0} onClick={() => openEditor()}>
              <Plus size={16} aria-hidden="true" />Add plan
            </button>
          )}
        </div>
      </div>

      <dl className="profile-card profile-summary" aria-label="Planned spending totals">
        <div><dt>{restLabel}</dt><dd>{money(sum(restOfMonth))}</dd></div>
        <div><dt>{nextLabel}</dt><dd>{money(sum(nextMonth))}</dd></div>
        <div><dt>Active plans</dt><dd>{plans.length}</dd></div>
      </dl>

      {editor && draft && !readOnly && (
        <form className="profile-card income-form" noValidate aria-labelledby={`${id}-form-title`} aria-busy={busy} onSubmit={event => { event.preventDefault(); void save(); }}>
          <div className="income-form-head">
            <h3 id={`${id}-form-title`}>{adding ? 'Add plan' : `Edit ${editor.snapshot.description || 'plan'}`}</h3>
            <button type="button" className="profile-icon-button" disabled={blocked} aria-label="Close without saving" onClick={cancel}><X size={18} aria-hidden="true" /></button>
          </div>
          <fieldset className="income-form-body" disabled={blocked}>
            {adding && (
              <div className="income-form-group" role="group" aria-labelledby={`${id}-preset-label`}>
                <span id={`${id}-preset-label`} className="income-form-label">Quick start</span>
                <div className="income-chips">
                  {PLAN_PRESETS.map(preset => (
                    <button key={preset.label} type="button" className="income-chip" aria-pressed={draft.description === preset.description && draft.amount === String(preset.amount)} onClick={() => applyPreset(preset)}>
                      {preset.label} · {preset.amount / 1000}k
                    </button>
                  ))}
                </div>
              </div>
            )}

            <label className="income-form-group income-field-full">
              <span className="income-form-label">What</span>
              <input type="text" className="income-input" maxLength={1000} value={draft.description} placeholder="e.g. Lunch" onChange={event => change({ description: event.target.value })} />
            </label>

            <div className="income-dates">
              <label className="income-form-group">
                <span className="income-form-label">Amount each time</span>
                <span className="income-amount">
                  <input type="text" inputMode="decimal" autoComplete="off" required value={draft.amount} placeholder="0" aria-describedby={`${id}-schedule`} onChange={event => change({ amount: event.target.value.replace(/[\s,_]/g, '') })} />
                  <span aria-hidden="true">₫</span>
                </span>
              </label>
              <label className="income-form-group">
                <span className="income-form-label">Category</span>
                <select className="income-input" value={draft.category} onChange={event => change({ category: event.target.value })}>
                  {active.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                  {!active.some(item => item.id === draft.category) && <option value={draft.category}>{categories.find(item => item.id === draft.category)?.name ?? (draft.category || 'Choose…')}</option>}
                </select>
              </label>
            </div>

            <fieldset className="income-form-group">
              <legend className="income-form-label">How sure is it?</legend>
              <div className="income-segmented">
                <label className="income-segment">
                  <input type="radio" name={`${id}-sure`} checked={draft.sure} onChange={() => change({ sure: true })} />
                  <span>Sure · fixed amount and date</span>
                </label>
                <label className="income-segment">
                  <input type="radio" name={`${id}-sure`} checked={!draft.sure} onChange={() => change({ sure: false })} />
                  <span>Estimate · roughly this much</span>
                </label>
              </div>
            </fieldset>

            <fieldset className="income-form-group">
              <legend className="income-form-label">How often</legend>
              <div className="income-segmented">
                {(Object.entries(PLAN_FREQUENCY_LABELS) as [PlanFrequency, string][]).map(([value, label]) => (
                  <label key={value} className="income-segment">
                    <input type="radio" name={`${id}-frequency`} value={value} checked={draft.frequency === value} onChange={() => change({ frequency: value })} />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            {draft.frequency === 'weekly' && (
              <div className="income-form-group" role="group" aria-labelledby={`${id}-days-label`}>
                <span id={`${id}-days-label`} className="income-form-label">On <span className="income-optional">defaults to the start date’s weekday</span></span>
                <div className="income-chips">
                  {DAY_LABELS.map(([label, day]) => (
                    <button key={day} type="button" className="income-chip" aria-pressed={draft.daysOfWeek.includes(day)} onClick={() => toggleDay(day)}>{label}</button>
                  ))}
                </div>
              </div>
            )}

            <div className="income-dates">
              {UNIT[draft.frequency] && (
                <label className="income-form-group">
                  <span className="income-form-label">Every</span>
                  <span className="income-amount">
                    <input type="number" min={1} max={365} step={1} value={draft.interval} onChange={event => change({ interval: event.target.value })} />
                    <span aria-hidden="true">{UNIT[draft.frequency]}</span>
                  </span>
                </label>
              )}
              <label className="income-form-group">
                <span className="income-form-label">{draft.frequency === 'once' ? 'On' : 'Starts'}</span>
                <input type="date" className="income-input" min="0001-01-01" max="9999-12-31" required value={draft.startDate} onChange={event => change({ startDate: event.target.value })} />
              </label>
              {draft.frequency !== 'once' && (
                <label className="income-form-group">
                  <span className="income-form-label">Ends <span className="income-optional">optional, open-ended by default</span></span>
                  <span className="income-date-clear">
                    <input type="date" className="income-input" min={draft.startDate || '0001-01-01'} max="9999-12-31" value={draft.endDate} onChange={event => change({ endDate: event.target.value })} />
                    {draft.endDate && <button type="button" className="profile-icon-button" aria-label="Remove end date" onClick={() => change({ endDate: '' })}><X size={16} aria-hidden="true" /></button>}
                  </span>
                </label>
              )}
              <label className="income-form-group">
                <span className="income-form-label">At</span>
                <input type="time" className="income-input" required value={draft.time} onChange={event => change({ time: event.target.value })} />
              </label>
            </div>

            {!adding && editor.snapshot.frequency !== 'once' && (
              <fieldset className="income-form-group">
                <legend className="income-form-label">Apply changes to</legend>
                <div className="income-segmented">
                  <label className="income-segment">
                    <input type="radio" name={`${id}-scope`} checked={!draft.effectiveFrom} onChange={() => change({ effectiveFrom: '' })} />
                    <span>All upcoming</span>
                  </label>
                  <label className="income-segment">
                    <input type="radio" name={`${id}-scope`} checked={Boolean(draft.effectiveFrom)} onChange={() => change({ effectiveFrom: addDays(today, 1) })} />
                    <span>From a date</span>
                  </label>
                </div>
                {draft.effectiveFrom && (
                  <input type="date" className="income-input" aria-label="Changes start on" min={addDays(today, 1)} max="9999-12-31" value={draft.effectiveFrom} onChange={event => change({ effectiveFrom: event.target.value })} />
                )}
              </fieldset>
            )}
          </fieldset>

          <p id={`${id}-schedule`} className={`income-schedule${summary ? '' : ' income-schedule-empty'}`} aria-live="polite">
            <CalendarClock size={18} aria-hidden="true" />
            <span>{summary ?? 'Enter an amount to see the plan.'}</span>
          </p>
          {error && <p className="profile-error" role="alert">{error}</p>}
          <div className="income-form-foot">
            <button type="button" className="profile-button profile-button-ghost" disabled={blocked} onClick={cancel}>Cancel</button>
            <button type="submit" className="profile-button profile-button-primary" disabled={blocked}>
              {operation === 'save' ? 'Saving…' : adding ? 'Add plan' : 'Save changes'}
            </button>
          </div>
        </form>
      )}
      {error && !editor && <p className="profile-error" role="alert">{error}</p>}
      {notice && <p className="profile-notice" role="status">{notice}</p>}

      {sorted.length === 0 ? (
        <p className="profile-card profile-empty">No plans yet. Add one to forecast regular costs, like a 15,000 ₫ breakfast and a 35,000 ₫ lunch every weekday.</p>
      ) : (
        <div className="profile-stack">
        <ul className="profile-card profile-list" aria-label="Spending plans">
          {sorted.map(plan => {
            const category = categories.find(item => item.id === plan.category);
            const color = category?.color ?? '#64748b';
            const Icon = (category && ICONS[category.icon as keyof typeof ICONS]) || CircleDollarSign;
            const remaining = remainingByPlan.get(plan.id);
            const ended = plan.endDate !== null && plan.endDate < today;
            const nextUp = ended ? undefined : planOccurrences(plan, today, addDays(today, 400))
              .find(item => `${item.date}T${item.time}` > plan.materializedThrough);
            return (
              <li key={plan.id} className={`profile-list-item${ended ? ' profile-list-item-muted' : ''}`}>
                <span className="profile-glyph" style={{ color, background: `color-mix(in srgb, ${color} 15%, transparent)` }} aria-hidden="true"><Icon size={18} /></span>
                <div className="profile-list-main">
                  <strong>{plan.description || category?.name || 'Plan'}</strong>
                  <span className="profile-meta">
                    {plan.sure && <span className="profile-pill">Sure</span>}
                    <span className="profile-pill profile-pill-on">{describePlanSchedule(plan)}</span>
                    <span>{plan.time}</span>
                    <span>{category?.name ?? plan.category}</span>
                    <span>{ended ? `Ended ${plan.endDate}` : plan.endDate ? `Until ${plan.endDate}` : 'No end date'}</span>
                    {plan.exceptions.length > 0 && <span>{plan.exceptions.length} day{plan.exceptions.length === 1 ? '' : 's'} changed</span>}
                  </span>
                </div>
                <div className="profile-amount">
                  {money(plan.amount)}
                  <small>{remaining
                    ? `${remaining.count} left this ${periodWord} · ${money(remaining.total)}`
                    : nextUp ? `Next on ${nextUp.date}` : 'Nothing upcoming'}</small>
                </div>
                {!readOnly && (
                <div className="profile-row-actions">
                  <button type="button" className="profile-icon-button" disabled={blocked} aria-label={`Edit ${plan.description || 'plan'}`} onClick={() => openEditor(plan)}><Pencil size={16} aria-hidden="true" /></button>
                  <button type="button" className="profile-icon-button profile-icon-button-danger" disabled={blocked || editor !== null} aria-label={deletingId === plan.id ? `Deleting ${plan.description}` : `Delete ${plan.description || 'plan'}`} onClick={() => { void remove(plan); }}><Trash2 size={16} aria-hidden="true" /></button>
                </div>
                )}
              </li>
            );
          })}
        </ul>
        </div>
      )}
    </section>
  );
}

