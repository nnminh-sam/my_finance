'use client';

import { useId, useLayoutEffect, useRef, useState } from 'react';
import { CalendarRange, Lightbulb } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useFinance } from '../contexts/FinanceContext';
import { useSettings } from '../contexts/SettingsContext';
import { errorMessage } from '../services/auth';
import { describeIncomeSchedule } from '../lib/income';
import { legacyPaydayPrefill } from '../lib/legacyPayday';
import { suggestBudgetMode } from '../lib/localeSuggestion';
import { DEFAULT_BUDGET_PERIOD, DEFAULT_SHOW_BY, PAYCHECK_FREQUENCIES, SHOW_BY } from '../lib/periods';
import type { BudgetPeriodMode, BudgetPeriodSetting, ShowBy } from '../lib/periods';
import { EditorActions } from './ProfileSection';

export interface BudgetPeriodEditorState {
  dirty: boolean;
  busy: boolean;
}

const MODE_LABELS: Record<BudgetPeriodMode, { title: string; hint: string }> = {
  calendar: { title: 'Calendar month', hint: 'A period is the 1st to the last day of each month.' },
  monthly_from_day: { title: 'Monthly on a fixed day', hint: 'You are paid on the same day every month, for example the 25th, and a period starts that day.' },
  paycheck: { title: 'Every paycheck of an income', hint: 'A period starts on each payday of one income and ends the day before the next one.' },
};

const SHOW_BY_LABELS: Record<ShowBy, { title: string; hint: string }> = {
  calendar_month: { title: 'Calendar month', hint: 'Calendar, week, day and analytics views show whole calendar months.' },
  pay_cycle: { title: 'Pay cycle', hint: 'Those views show your pay period, as set above.' },
};

interface PayDraft {
  period: BudgetPeriodSetting;
  showBy: ShowBy;
}

const sameDraft = (a: PayDraft, b: PayDraft) =>
  a.showBy === b.showBy && a.period.mode === b.period.mode && a.period.startDay === b.period.startDay && a.period.paycheckIncomeId === b.period.paycheckIncomeId;

const ORDINAL_SUFFIX: Record<number, string> = { 1: 'st', 2: 'nd', 3: 'rd' };
const ordinal = (day: number) => {
  const tens = day % 100;
  return `${day}${tens >= 11 && tens <= 13 ? 'th' : ORDINAL_SUFFIX[day % 10] ?? 'th'}`;
};

/** One line that says how the user is paid, for the profile summary. */
export function describeBudgetPeriod(setting: BudgetPeriodSetting, incomes: readonly { id: string; source: string; name: string }[]): string {
  if (setting.mode === 'monthly_from_day') return `Monthly from the ${ordinal(setting.startDay)}`;
  if (setting.mode === 'paycheck') {
    const income = incomes.find(item => item.id === setting.paycheckIncomeId);
    if (income) return `Every paycheck of ${income.name ? `${income.source} · ${income.name}` : income.source}`;
  }
  return 'Calendar month';
}

/** "How are you paid?": the budget period and Show by, saved together to the account from the pay cycle tab of the profile. */
export function BudgetPeriodSection({ disabled, onEditorStateChange }: { disabled: boolean; onEditorStateChange: (state: BudgetPeriodEditorState) => void }) {
  const { settings, updateSettings } = useSettings();
  const { user } = useAuth();
  const { incomes, settings: financeSettings, hasLoaded } = useFinance();
  const saved: PayDraft = { period: settings.budgetPeriod ?? DEFAULT_BUDGET_PERIOD, showBy: settings.showBy ?? DEFAULT_SHOW_BY };
  // A payday kept on this device by the old pay cycle page is offered once, unsaved, while the account still has the defaults.
  const [prefillDay] = useState<number | null>(() =>
    hasLoaded && typeof window !== 'undefined' ? legacyPaydayPrefill(settings, window.localStorage, user?.id) : null);
  const [draft, setDraft] = useState<PayDraft | null>(() =>
    prefillDay === null ? null : { period: { mode: 'monthly_from_day', startDay: prefillDay, paycheckIncomeId: null }, showBy: DEFAULT_SHOW_BY });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const saving = useRef(false);
  const id = useId();
  const current = draft ?? saved;
  const dirty = draft !== null && !sameDraft(draft, saved);
  const eligible = incomes.filter(income => (PAYCHECK_FREQUENCIES as readonly string[]).includes(income.frequency));
  const suggestion = suggestBudgetMode(
    typeof navigator === 'undefined' ? undefined : navigator.language,
    financeSettings.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
  );

  useLayoutEffect(() => {
    onEditorStateChange({ dirty, busy });
  }, [dirty, busy, onEditorStateChange]);

  const change = (updates: Partial<BudgetPeriodSetting>) => {
    if (disabled || saving.current) return;
    setDraft({ ...current, period: { ...current.period, ...updates } });
    setError(null);
    setNotice(null);
  };

  const changeShowBy = (showBy: ShowBy) => {
    if (disabled || saving.current) return;
    setDraft({ ...current, showBy });
    setError(null);
    setNotice(null);
  };

  const applySuggestion = (mode: BudgetPeriodMode) => {
    change(mode === 'paycheck' ? { mode, paycheckIncomeId: current.period.paycheckIncomeId ?? eligible[0]?.id ?? null } : { mode });
  };

  const cancel = () => {
    if (saving.current) return;
    setDraft(null);
    setError(null);
  };

  const save = async () => {
    if (!draft || disabled || saving.current) return;
    if (draft.period.mode === 'paycheck' && !eligible.some(income => income.id === draft.period.paycheckIncomeId)) {
      setError('Choose the weekly, twice-a-month or monthly income that pays you.');
      return;
    }
    saving.current = true;
    setBusy(true);
    setError(null);
    try {
      await updateSettings({
        // Leaving paycheck mode clears the stored paycheck income.
        budgetPeriod: { mode: draft.period.mode, startDay: draft.period.startDay, paycheckIncomeId: draft.period.mode === 'paycheck' ? draft.period.paycheckIncomeId : null },
        showBy: draft.showBy,
      });
      setDraft(null);
      setNotice('Pay cycle saved.');
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };

  const incomeLabel = (income: { source: string; name: string }) => income.name ? `${income.source} · ${income.name}` : income.source;

  return (
    <form className="profile-card budget-period" aria-labelledby={`${id}-title`} aria-busy={busy} noValidate onSubmit={event => { event.preventDefault(); void save(); }}>
      <div className="profile-panel-head">
        <div>
          <h3 id={`${id}-title`}><CalendarRange size={16} aria-hidden="true" /> How are you paid?</h3>
          <p>This is saved to your account. Plans always follow it, and Show by decides what the other views follow.</p>
        </div>
      </div>
      {prefillDay !== null && draft !== null && (
        <p className="budget-period-hint" role="note">
          <Lightbulb size={16} aria-hidden="true" />
          <span>We found your payday on this device (the {ordinal(prefillDay)}) and filled it in. Only the day is carried over, not weekend or per-month changes. Nothing is saved until you press Save.</span>
        </p>
      )}
      <fieldset className="profile-rows" disabled={disabled || busy}>
        <legend className="sr-only">How you are paid</legend>
        {(Object.keys(MODE_LABELS) as BudgetPeriodMode[]).map(mode => (
          <label key={mode} className="profile-pref">
            <span>
              <strong>{MODE_LABELS[mode].title}</strong>
              <span className="profile-hint">{MODE_LABELS[mode].hint}</span>
            </span>
            <input type="radio" name={`${id}-mode`} value={mode} checked={current.period.mode === mode} onChange={() => change({ mode })} />
          </label>
        ))}
        {current.period.mode === 'monthly_from_day' && (
          <div className="profile-pref">
            <label htmlFor={`${id}-day`}><strong>Payday</strong><span className="profile-hint">Days 1 to 28, so every month has it.</span></label>
            <select id={`${id}-day`} value={current.period.startDay} onChange={event => change({ startDay: Number(event.target.value) })}>
              {Array.from({ length: 28 }, (_, index) => index + 1).map(day => <option key={day} value={day}>Day {day}</option>)}
            </select>
          </div>
        )}
        {current.period.mode === 'paycheck' && (
          <div className="profile-pref">
            {eligible.length === 0 ? (
              <div><strong>Paycheck income</strong><span className="profile-hint">Add a weekly, twice-a-month or monthly income first.</span></div>
            ) : (
              <>
              <label htmlFor={`${id}-income`}><strong>Paycheck income</strong><span className="profile-hint">Only weekly, twice-a-month and monthly incomes can start a period.</span></label>
              <select id={`${id}-income`} value={current.period.paycheckIncomeId ?? ''} onChange={event => change({ paycheckIncomeId: event.target.value || null })}>
                <option value="">Choose an income</option>
                {eligible.map(income => <option key={income.id} value={income.id}>{incomeLabel(income)} ({describeIncomeSchedule(income)})</option>)}
              </select>
              </>
            )}
          </div>
        )}
      </fieldset>
      <fieldset className="profile-rows" disabled={disabled || busy}>
        <legend className="sr-only">Show by</legend>
        <div className="profile-pref"><div><strong>Show by</strong><span className="profile-hint">Which period the calendar, week, day and analytics views and the phone screens use.</span></div></div>
        {SHOW_BY.map(option => (
          <label key={option} className="profile-pref">
            <span>
              <strong>{SHOW_BY_LABELS[option].title}</strong>
              <span className="profile-hint">{SHOW_BY_LABELS[option].hint}</span>
            </span>
            <input type="radio" name={`${id}-show-by`} value={option} checked={current.showBy === option} onChange={() => changeShowBy(option)} />
          </label>
        ))}
      </fieldset>
      {suggestion && suggestion !== current.period.mode && (
        <p className="budget-period-hint" role="note">
          <Lightbulb size={16} aria-hidden="true" />
          <span>Based on your region, “{MODE_LABELS[suggestion].title}” is common.</span>
          <button type="button" className="profile-button" disabled={disabled || busy} onClick={() => applySuggestion(suggestion)}>Use this</button>
        </p>
      )}
      {error && <p className="profile-error" role="alert">{error}</p>}
      {notice && <p className="profile-notice" role="status">{notice}</p>}
      {dirty && <EditorActions busy={busy} onCancel={cancel} />}
    </form>
  );
}
