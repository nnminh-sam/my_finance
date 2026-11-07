'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { parseISO } from 'date-fns';
import { Plus, Sparkles, X } from 'lucide-react';
import { useFinance } from '../contexts/FinanceContext';
import { useSettings } from '../contexts/SettingsContext';
import { errorMessage } from '../services/auth';
import { createFinanceApi } from '../services/finance';
import { isPastPeriod } from '../lib/periods';
import type { PlanPeriodSummary } from '../lib/periodSummary';
import { createPlansInOrder, earliestPlanDate, leftAfterDraft, plannerCategories, planPeriodDraft } from '../lib/periodPlan';
import type { CreateOutcome } from '../lib/periodPlan';
import type { SaveResult } from './quickEntry/useQuickEntry';
import '../styles/QuickEntry.css';
import '../styles/Plans.css';

const api = createFinanceApi();
const dayLabel = (date: string) => parseISO(date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
const money = (amount: number) => `${amount.toLocaleString('vi-VN', { maximumFractionDigits: 0 })} ₫`;
const digits = (value: string) => value.replace(/[^\d]/g, '').replace(/^0+/, '').slice(0, 12);
const amountText = (value: string) => (value ? Number(value).toLocaleString('vi-VN') : '');

interface Row { key: number; name: string; amount: string; date: string }

/**
 * "Plan this period": one screen for the budget period that contains `date`.
 * Income is read-only (it lives in Profile); bills, a daily amount and extras become plans.
 */
export function PlanPeriodGuide({ date, onClose, onDone }: { date: string; onClose: () => void; onDone: (result: SaveResult) => void }) {
  const { plans, createPlan } = useFinance();
  const { settings } = useSettings();
  const [summary, setSummary] = useState<PlanPeriodSummary | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [bills, setBills] = useState<Row[]>([{ key: 0, name: '', amount: '', date: '' }]);
  const [extras, setExtras] = useState<Row[]>([]);
  const [daily, setDaily] = useState('');
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<CreateOutcome | null>(null);
  const nextKey = useRef(1);
  const lock = useRef(false);
  const dialog = useRef<HTMLDivElement>(null);

  // Keyboard users land inside the dialog, and focus returns to the opener when it closes.
  useEffect(() => {
    const opener = document.activeElement;
    dialog.current?.focus();
    return () => { if (opener instanceof HTMLElement) opener.focus({ preventScroll: true }); };
  }, []);

  // Keep Tab inside the dialog.
  const trapTab = (event: React.KeyboardEvent) => {
    if (event.key !== 'Tab' || !dialog.current) return;
    const focusable = [...dialog.current.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select, a[href]')];
    if (focusable.length === 0) return;
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };

  // The server sums the whole period. A late answer for an older request is ignored.
  useEffect(() => {
    let latest = true;
    api.getPlanSummary(date).then(
      next => { if (latest) { setSummary(next); setLoadError(null); } },
      failure => { if (latest) setLoadError(errorMessage(failure)); },
    );
    return () => { latest = false; };
  }, [date, refresh]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && !lock.current) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const period = summary?.period ?? null;
  const past = summary && period ? isPastPeriod(period, summary.today) : false;
  const categories = useMemo(() => plannerCategories(settings.categories), [settings.categories]);

  const earliest = summary && period ? earliestPlanDate(period, summary.today) : '';
  const draft = useMemo(() => {
    if (!summary || !period) return null;
    const dayValue = Number(daily);
    return planPeriodDraft({
      period,
      today: summary.today,
      input: {
        bills: bills.map(row => ({ name: row.name, amount: Number(row.amount), date: row.date || earliest })),
        dailyAmount: dayValue > 0 ? dayValue : null,
        extras: extras.map(row => ({ name: row.name, amount: Number(row.amount), date: row.date || earliest })),
      },
      categories,
      existing: plans,
    });
  }, [summary, period, earliest, bills, extras, daily, categories, plans]);

  const left = summary && period && draft ? leftAfterDraft(summary.left, period, draft.plans) : null;
  const leftLabel = period?.mode === 'calendar' ? 'Left this month' : period ? `Left until ${dayLabel(period.nextStart)}` : 'Left';
  const total = draft?.plans.length ?? 0;

  const setRow = (set: typeof setBills, key: number, patch: Partial<Row>) => {
    setOutcome(null);
    set(rows => rows.map(row => row.key === key ? { ...row, ...patch } : row));
  };
  const addRow = (set: typeof setBills) => set(rows => [...rows, { key: nextKey.current++, name: '', amount: '', date: '' }]);
  const removeRow = (set: typeof setBills, key: number) => set(rows => rows.filter(row => row.key !== key));

  const create = async () => {
    // Nothing is created while a row is blocked.
    if (lock.current || !draft || draft.plans.length === 0 || draft.blockedDates.length > 0) return;
    lock.current = true;
    setBusy(true);
    setOutcome(null);
    try {
      const result = await createPlansInOrder(draft.plans, createPlan, errorMessage);
      if (result.created.length > 0) setRefresh(count => count + 1);
      if (result.failed) {
        setOutcome(result);
      } else {
        onDone({ message: `Planned this period: ${result.created.length} ${result.created.length === 1 ? 'item' : 'items'} added. They show on your calendar and become real when their time passes.` });
        onClose();
      }
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };

  const rowsFor = (kind: 'bills' | 'extras', rows: Row[], set: typeof setBills) => rows.map((row, index) => (
    <div key={row.key} className="qe-qrow">
      <input aria-label={`${kind === 'bills' ? 'Bill' : 'Extra'} ${index + 1} name`} placeholder={kind === 'bills' ? 'e.g. Rent' : 'e.g. Wedding gift'} value={row.name} disabled={busy} onChange={event => setRow(set, row.key, { name: event.target.value })} />
      <input aria-label={`${kind === 'bills' ? 'Bill' : 'Extra'} ${index + 1} amount`} inputMode="numeric" placeholder="Amount" value={amountText(row.amount)} disabled={busy} onChange={event => setRow(set, row.key, { amount: digits(event.target.value) })} />
      <input type="date" aria-label={`${kind === 'bills' ? 'Bill' : 'Extra'} ${index + 1} date`} min={earliest || period?.start} max={period?.end} value={row.date || earliest} disabled={busy} onChange={event => setRow(set, row.key, { date: event.target.value })} />
      <button type="button" className="qe-x" aria-label={`Remove ${kind === 'bills' ? 'bill' : 'extra'} ${index + 1}`} disabled={busy} onClick={() => removeRow(set, row.key)}><X size={15} /></button>
    </div>
  ));

  return createPortal(
    <div className="qe-layer" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <div ref={dialog} tabIndex={-1} className="qe-dialog plan-guide" role="dialog" aria-modal="true" aria-labelledby="plan-guide-title" onKeyDown={trapTab} aria-busy={busy || (!summary && !loadError)}>
        <header className="qe-d-head">
          <h2 id="plan-guide-title"><Sparkles size={18} aria-hidden="true" /> Plan this period{period ? ` · ${dayLabel(period.start)} – ${dayLabel(period.end)}` : ''}</h2>
          <button type="button" className="qe-fx" aria-label="Close" disabled={busy} onClick={onClose}><X size={18} /></button>
        </header>
        <div className="plan-guide-body">
          {loadError && <p className="qe-error" role="alert">Could not load this period: {loadError}</p>}
          {!summary && !loadError && <p className="qe-hint" role="status">Loading the period…</p>}
          {summary && period && past && <p className="qe-hint" role="status">This period is over, so it cannot be planned. Open the current or a coming period instead.</p>}
          {summary && period && !past && draft && (
            <>
              <section aria-labelledby="plan-guide-income">
                <h3 id="plan-guide-income">Income</h3>
                {summary.payments.length === 0
                  ? <p className="qe-hint">No income is due in this period.</p>
                  : <ul className="plans-payments">{summary.payments.map((payment, index) => (
                    <li key={`${payment.incomeId}-${payment.date}-${index}`}>{dayLabel(payment.date)} · {payment.name ? `${payment.source} · ${payment.name}` : payment.source} <b>{money(payment.amount)}</b></li>
                  ))}</ul>}
                <p className="qe-hint">Income is managed in Profile. <Link href="/profile#income" onClick={onClose}>Pay and income sources</Link></p>
              </section>

              <section aria-labelledby="plan-guide-bills">
                <h3 id="plan-guide-bills">Bills</h3>
                <p className="qe-hint">Fixed amounts on a known day. Each one repeats monthly as a sure plan.</p>
                <div className="qe-queue">{rowsFor('bills', bills, setBills)}</div>
                <button type="button" className="qe-btn is-plain" disabled={busy} onClick={() => addRow(setBills)}><Plus size={14} aria-hidden="true" />Add bill</button>
              </section>

              <section aria-labelledby="plan-guide-daily">
                <h3 id="plan-guide-daily">Everyday spending</h3>
                <label className="qe-field"><span>Amount per day (₫)</span>
                  <input inputMode="numeric" placeholder="e.g. 150.000" value={amountText(daily)} disabled={busy} onChange={event => { setOutcome(null); setDaily(digits(event.target.value)); }} />
                </label>
                <p className="qe-hint">An estimate for each remaining day of the period.</p>
              </section>

              <section aria-labelledby="plan-guide-extras">
                <h3 id="plan-guide-extras">Extras</h3>
                <p className="qe-hint">One-offs like a wedding gift or a trip, on their date.</p>
                <div className="qe-queue">{rowsFor('extras', extras, setExtras)}</div>
                <button type="button" className="qe-btn is-plain" disabled={busy} onClick={() => addRow(setExtras)}><Plus size={14} aria-hidden="true" />Add extra</button>
              </section>

              {draft.alreadyPlanned.length > 0 && (
                <p className="qe-hint" role="status">Already planned, not added again: {draft.alreadyPlanned.join(', ')}.</p>
              )}
              {draft.blockedDates.length > 0 && (
                <p className="qe-error" role="alert">Pick a date inside this period, after today, for: {draft.blockedDates.join(', ')}.</p>
              )}

              <div className="plan-guide-kpis" aria-live="polite">
                <div>Income in this period<b className="is-income">{money(summary.income)}</b></div>
                <div>{leftLabel}<b style={{ color: (left ?? 0) >= 0 ? 'var(--primary)' : 'var(--danger)' }}>{money(left ?? 0)}</b></div>
              </div>
            </>
          )}
          {outcome && (
            <div className="qe-error" role="alert">
              {outcome.created.length > 0 && <p>Created: {outcome.created.map(plan => plan.description).join(', ')}.</p>}
              {outcome.failed && <p>Failed: {outcome.failed.plan.description} ({outcome.failed.message}). Press Create again to retry, what was created is skipped.</p>}
            </div>
          )}
        </div>
        <footer className="qe-d-foot">
          <div className="qe-d-actions">
            <button type="button" className="qe-btn is-plain" disabled={busy} onClick={onClose}>Cancel</button>
            <span className="qe-sp" />
            <button type="button" className="qe-btn is-primary" disabled={busy || total === 0 || past || !summary || (draft?.blockedDates.length ?? 0) > 0} onClick={() => { void create(); }}>
              {busy ? 'Creating…' : `Create ${total} ${total === 1 ? 'item' : 'items'}`}
            </button>
          </div>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
