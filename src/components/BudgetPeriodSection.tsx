'use client';

import { useId, useLayoutEffect, useRef, useState } from 'react';
import { CalendarRange, Lightbulb } from 'lucide-react';
import { useFinance } from '../contexts/FinanceContext';
import { useSettings } from '../contexts/SettingsContext';
import { errorMessage } from '../services/auth';
import { describeIncomeSchedule } from '../lib/income';
import { suggestBudgetMode } from '../lib/localeSuggestion';
import { DEFAULT_BUDGET_PERIOD, PAYCHECK_FREQUENCIES } from '../lib/periods';
import type { BudgetPeriodMode, BudgetPeriodSetting } from '../lib/periods';
import { EditorActions } from './ProfileSection';

export interface BudgetPeriodEditorState {
  dirty: boolean;
  busy: boolean;
}

const MODE_LABELS: Record<BudgetPeriodMode, { title: string; hint: string }> = {
  calendar: { title: 'Calendar month', hint: 'Plans and summaries cover the 1st to the last day of each month.' },
  monthly_from_day: { title: 'Monthly from a start day', hint: 'A period starts on the same day every month, for example the 25th.' },
  paycheck: { title: 'Paycheck to paycheck', hint: 'A period starts on each payday of one income and ends the day before the next one.' },
};

const sameSetting = (a: BudgetPeriodSetting, b: BudgetPeriodSetting) =>
  a.mode === b.mode && a.startDay === b.startDay && a.paycheckIncomeId === b.paycheckIncomeId;

/** The budget period setting: how Plans group days into periods. Shown on the pay cycle tab of the profile. */
export function BudgetPeriodSection({ disabled, onEditorStateChange }: { disabled: boolean; onEditorStateChange: (state: BudgetPeriodEditorState) => void }) {
  const { settings, updateSettings } = useSettings();
  const { incomes, settings: financeSettings } = useFinance();
  const saved = settings.budgetPeriod ?? DEFAULT_BUDGET_PERIOD;
  const [draft, setDraft] = useState<BudgetPeriodSetting | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const saving = useRef(false);
  const id = useId();
  const current = draft ?? saved;
  const dirty = draft !== null && !sameSetting(draft, saved);
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
    setDraft({ ...current, ...updates });
    setError(null);
    setNotice(null);
  };

  const applySuggestion = (mode: BudgetPeriodMode) => {
    change(mode === 'paycheck' ? { mode, paycheckIncomeId: current.paycheckIncomeId ?? eligible[0]?.id ?? null } : { mode });
  };

  const cancel = () => {
    if (saving.current) return;
    setDraft(null);
    setError(null);
  };

  const save = async () => {
    if (!draft || disabled || saving.current) return;
    if (draft.mode === 'paycheck' && !eligible.some(income => income.id === draft.paycheckIncomeId)) {
      setError('Choose the weekly, twice-a-month or monthly income that pays you.');
      return;
    }
    saving.current = true;
    setBusy(true);
    setError(null);
    try {
      await updateSettings({
        // Leaving paycheck mode clears the stored paycheck income.
        budgetPeriod: { mode: draft.mode, startDay: draft.startDay, paycheckIncomeId: draft.mode === 'paycheck' ? draft.paycheckIncomeId : null },
      });
      setDraft(null);
      setNotice('Budget period saved.');
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
          <h3 id={`${id}-title`}><CalendarRange size={16} aria-hidden="true" /> Budget period</h3>
          <p>How the Plans page groups days. This is saved to your account and does not change the calendar or analytics views.</p>
        </div>
      </div>
      <fieldset className="profile-rows" disabled={disabled || busy}>
        <legend className="sr-only">Budget period mode</legend>
        {(Object.keys(MODE_LABELS) as BudgetPeriodMode[]).map(mode => (
          <label key={mode} className="profile-pref">
            <span>
              <strong>{MODE_LABELS[mode].title}</strong>
              <span className="profile-hint">{MODE_LABELS[mode].hint}</span>
            </span>
            <input type="radio" name={`${id}-mode`} value={mode} checked={current.mode === mode} onChange={() => change({ mode })} />
          </label>
        ))}
        {current.mode === 'monthly_from_day' && (
          <div className="profile-pref">
            <label htmlFor={`${id}-day`}><strong>Start day</strong><span className="profile-hint">Days 1 to 28, so every month has it.</span></label>
            <select id={`${id}-day`} value={current.startDay} onChange={event => change({ startDay: Number(event.target.value) })}>
              {Array.from({ length: 28 }, (_, index) => index + 1).map(day => <option key={day} value={day}>Day {day}</option>)}
            </select>
          </div>
        )}
        {current.mode === 'paycheck' && (
          <div className="profile-pref">
            {eligible.length === 0 ? (
              <div><strong>Paycheck income</strong><span className="profile-hint">Add a weekly, twice-a-month or monthly income first.</span></div>
            ) : (
              <>
              <label htmlFor={`${id}-income`}><strong>Paycheck income</strong><span className="profile-hint">Only weekly, twice-a-month and monthly incomes can start a period.</span></label>
              <select id={`${id}-income`} value={current.paycheckIncomeId ?? ''} onChange={event => change({ paycheckIncomeId: event.target.value || null })}>
                <option value="">Choose an income</option>
                {eligible.map(income => <option key={income.id} value={income.id}>{incomeLabel(income)} ({describeIncomeSchedule(income)})</option>)}
              </select>
              </>
            )}
          </div>
        )}
      </fieldset>
      {suggestion && suggestion !== current.mode && (
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
