'use client';

import { useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Sparkles, X } from 'lucide-react';
import { useFinance } from '../contexts/FinanceContext';
import { useSettings } from '../contexts/SettingsContext';
import { errorMessage } from '../services/auth';
import { getMonthIncome } from '../lib/income';
import { projectPlans, type PlanFrequency } from '../lib/plans';
import { isoDate, nowStamp } from '../lib/quickEntry';
import type { CategoryData, IncomeInput, PlanInput } from '../types';
import { CategoryIcon, categoryMeta } from './mobile/MobileUi';
import type { SaveResult } from './quickEntry/useQuickEntry';
import '../styles/QuickEntry.css';
import '../styles/Plans.css';

/**
 * "Plan your month": income → fixed costs → daily habits → one-offs → review.
 * Income becomes income sources; costs and habits become plans (fixed costs are commitments).
 */
interface Item {
  key: string;
  label: string;
  kind: 'income' | 'plan';
  on: boolean;
  done: boolean; // already planned: shown, not created again
  amount: string;
  freq: PlanFrequency;
  day: number; // monthly items: day of month
  days: number[]; // weekly items
  time: string;
  category: string; // plans: category id; income: source
  sure: boolean;
}
interface OneOff { date: string; name: string; amount: string }

const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const STEPS = [
  { key: 'income', title: 'Income', help: 'What comes in this month? Each one is added to your income sources.' },
  { key: 'fixed', title: 'Fixed costs', help: 'Bills and subscriptions with a known amount and day. They are planned as commitments.' },
  { key: 'habits', title: 'Daily habits', help: 'Rough, repeating spending. Turn on the ones you do and adjust the amounts.' },
  { key: 'oneoffs', title: 'One-offs', help: 'Weddings, birthdays, trips. Tap a date, then name it.' },
  { key: 'review', title: 'Review', help: 'Your month if things go as planned. Nothing is saved until you create the plans.' },
] as const;
const money = (amount: number) => `${amount.toLocaleString('vi-VN', { maximumFractionDigits: 0 })} ₫`;
const digits = (value: string) => value.replace(/[^\d]/g, '').replace(/^0+/, '').slice(0, 12);
const ordinal = (n: number) => n + (n % 10 > 3 || [11, 12, 13].includes(n % 100) || n % 10 === 0 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10]);

function pickCategory(categories: readonly CategoryData[], ...patterns: RegExp[]): string {
  for (const pattern of patterns) {
    const found = categories.find(c => pattern.test(c.name) || pattern.test(c.id));
    if (found) return found.id;
  }
  return categories.find(c => /other/i.test(c.name))?.id ?? categories[0]?.id ?? '';
}

function schedule(item: Item): string {
  if (item.freq === 'monthly') return `Monthly on the ${ordinal(item.day)}`;
  if (item.freq === 'weekly') return `Weekly · ${item.days.map(d => WD[d]).join(', ')}`;
  return item.freq === 'weekdays' ? 'Every weekday' : 'Every day';
}

export function PlanMonthGuide({ month, onClose, onDone }: { month: string; onClose: () => void; onDone: (result: SaveResult) => void }) {
  const { plans, incomes, spendings, projectedBetween, createPlan, createIncome } = useFinance();
  const { settings } = useSettings();
  const categories = settings.categories;
  const today = isoDate(new Date());
  const [year, monthNumber] = month.split('-').map(Number);
  const lastDay = new Date(year, monthNumber, 0).getDate();
  const monthStart = `${month}-01`, monthEnd = `${month}-${String(lastDay).padStart(2, '0')}`;
  const monthLabel = new Date(year, monthNumber - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lock = useRef(false);

  const [items, setItems] = useState<Item[]>(() => {
    const planned = (name: string) => plans.some(p => p.description.trim().toLowerCase() === name.toLowerCase() && (!p.endDate || p.endDate >= today));
    const earning = (source: string) => incomes.some(i => i.source.toLowerCase() === source.toLowerCase() && (!i.endDate || i.endDate >= today));
    const income = (label: string, day: number, sure: boolean): Item => ({ key: `income:${label}`, label, kind: 'income', on: earning(label), done: earning(label), amount: '', freq: 'monthly', day, days: [], time: '09:00', category: label, sure });
    const plan = (label: string, amount: number | '', freq: PlanFrequency, time: string, category: string, sure: boolean, extra: Partial<Item> = {}): Item =>
      ({ key: `plan:${label}`, label, kind: 'plan', on: planned(label), done: planned(label), amount: amount ? String(amount) : '', freq, day: 1, days: [], time, category, sure, ...extra });
    const bills = pickCategory(categories, /bill/i, /utilit/i);
    const food = pickCategory(categories, /breakfast|lunch|food|meal|ăn/i);
    return [
      income('Salary', 5, true), income('Allowance', 10, true), income('Freelance', 25, false),
      plan('Rent', '', 'monthly', '08:00', pickCategory(categories, /rent|home|house|nhà/i, /bill/i), true, { day: 5 }),
      plan('Electricity', '', 'monthly', '08:00', bills, true, { day: 10 }),
      plan('Internet', '', 'monthly', '08:00', bills, true, { day: 12 }),
      plan('Phone', '', 'monthly', '08:00', bills, true, { day: 20 }),
      plan('Streaming', '', 'monthly', '08:00', pickCategory(categories, /subscri/i, /entertain|film/i, /bill/i), true, { day: 15 }),
      plan('Breakfast', 15000, 'weekdays', '07:30', food, false),
      plan('Lunch', 35000, 'weekdays', '12:00', food, false),
      plan('Coffee', 25000, 'weekdays', '09:30', pickCategory(categories, /coffee|cà phê|cafe/i, /food|eat|ăn/i), false),
      plan('Dinner', 50000, 'daily', '19:00', pickCategory(categories, /eat out|dinner|food|meal/i), false),
      plan('Gas', 100000, 'weekly', '08:00', pickCategory(categories, /gas|fuel|xăng|transport/i), false, { days: [1] }),
      plan('Groceries', 300000, 'weekly', '10:00', pickCategory(categories, /grocer|shop|siêu thị/i), false, { days: [6] }),
    ];
  });
  const [oneOffs, setOneOffs] = useState<OneOff[]>([]);
  const groupOf = (item: Item) => item.kind === 'income' ? 'income' : item.sure ? 'fixed' : 'habits';
  const patch = (key: string, fields: Partial<Item>) => { setError(null); setItems(list => list.map(item => item.key === key ? { ...item, ...fields } : item)); };

  // What "Create" will send.
  const draft = useMemo(() => {
    const incomesToAdd: IncomeInput[] = [];
    const plansToAdd: PlanInput[] = [];
    for (const item of items) {
      const amount = Number(item.amount);
      if (!item.on || item.done || !(amount > 0)) continue;
      const start = item.freq === 'monthly' ? `${month}-${String(Math.min(item.day, lastDay)).padStart(2, '0')}` : (today > monthStart ? today : monthStart);
      if (item.kind === 'income') incomesToAdd.push({ source: item.label, name: '', amount, frequency: 'monthly', startDate: start, endDate: null });
      else plansToAdd.push({ amount, description: item.label, category: item.category, time: item.time, startDate: start, frequency: item.freq, interval: 1, daysOfWeek: item.freq === 'weekly' ? item.days : [], endDate: null, sure: item.sure });
    }
    const gift = pickCategory(categories, /gift|quà|parent/i);
    for (const one of oneOffs) {
      const amount = Number(one.amount);
      if (amount > 0) plansToAdd.push({ amount, description: one.name.trim() || 'One-off', category: gift, time: '12:00', startDate: one.date, frequency: 'once', interval: 1, daysOfWeek: [], endDate: null, sure: false });
    }
    return { incomesToAdd, plansToAdd };
  }, [items, oneOffs, month, lastDay, today, monthStart, categories]);

  const review = useMemo(() => {
    const income = getMonthIncome(month, [...incomes, ...draft.incomesToAdd.map((input, i) => ({ ...input, id: `draft-${i}` }))]).totalIncome;
    const spent = spendings.filter(s => s.date >= monthStart && s.date <= monthEnd).reduce((sum, s) => sum + s.amount, 0);
    const planned = projectedBetween(monthStart, monthEnd).reduce((sum, o) => sum + o.amount, 0);
    const now = nowStamp();
    const added = projectPlans(draft.plansToAdd.map((p, i) => ({ ...p, id: `draft-${i}`, exceptions: [], materializedThrough: now })), monthStart, monthEnd)
      .reduce((sum, o) => sum + o.amount, 0);
    return { income, spent, planned: planned + added, left: income - spent - planned - added };
  }, [draft, incomes, spendings, projectedBetween, month, monthStart, monthEnd]);

  const missingAmount = items.some(item => item.on && !item.done && !(Number(item.amount) > 0)) || oneOffs.some(o => !(Number(o.amount) > 0));
  const total = draft.incomesToAdd.length + draft.plansToAdd.length;

  const create = async () => {
    if (lock.current || total === 0) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    let made = 0;
    try {
      for (const input of draft.incomesToAdd) { await createIncome(input); made++; }
      for (const input of draft.plansToAdd) { await createPlan(input); made++; }
      onDone({ message: `Planned ${monthLabel}: ${made} ${made === 1 ? 'item' : 'items'} added. They show on your calendar and become real when their time passes.` });
      onClose();
    } catch (cause) {
      // Stop at the first failure; items already created stay and show as "already planned" next time.
      setError(`${made} created, then: ${errorMessage(cause)}`);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };

  const current = STEPS[step];
  const rows = (group: 'income' | 'fixed' | 'habits') => items.filter(item => groupOf(item) === group).map(item => {
    const meta = item.kind === 'income' ? { color: '#10b981', icon: 'Briefcase' } : categoryMeta(categories, item.category);
    return (
      <div key={item.key} className={`plan-guide-row${item.done ? ' is-done' : ''}`}>
        <button type="button" role="switch" aria-checked={item.on} aria-label={item.label} disabled={item.done} className={`qe-switch${item.on ? ' is-on' : ''}`} onClick={() => patch(item.key, { on: !item.on })} />
        <div className="plan-guide-name">
          <b><span className="qe-ic" style={{ ['--c' as string]: meta.color }}><CategoryIcon icon={meta.icon} size={14} /></span>{item.label}</b>
          <small>{item.done ? 'Already planned' : `${item.sure ? 'Sure' : 'Estimate'} · ${schedule(item)} · ${item.time}`}</small>
        </div>
        <label className="qe-field"><span>Amount (₫)</span>
          <input inputMode="numeric" value={item.amount ? Number(item.amount).toLocaleString('vi-VN') : ''} placeholder={item.kind === 'income' ? 'e.g. 12.000.000' : '0'} disabled={item.done}
            onChange={e => patch(item.key, { amount: digits(e.target.value), on: item.on || digits(e.target.value) !== '' })} />
        </label>
        {item.freq === 'monthly'
          ? <label className="qe-field"><span>Day</span><input type="number" min={1} max={31} value={item.day} disabled={item.done} onChange={e => patch(item.key, { day: Math.min(31, Math.max(1, Number(e.target.value) || 1)) })} /></label>
          : <span />}
      </div>
    );
  });

  let body: React.ReactNode;
  if (current.key === 'income' || current.key === 'fixed' || current.key === 'habits') body = rows(current.key);
  else if (current.key === 'oneoffs') {
    const lead = (new Date(year, monthNumber - 1, 1).getDay() + 6) % 7;
    const days = Array.from({ length: lastDay }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
    body = (
      <>
        <div className="plan-guide-cal" role="group" aria-label={`Days in ${monthLabel}`}>
          {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => <span key={i}>{d}</span>)}
          {Array.from({ length: lead }, (_, i) => <span key={`lead-${i}`} />)}
          {days.map(date => {
            const on = oneOffs.some(o => o.date === date);
            return (
              <button key={date} type="button" disabled={date <= today} aria-pressed={on} className={on ? 'is-on' : undefined}
                onClick={() => setOneOffs(list => on ? list.filter(o => o.date !== date) : [...list, { date, name: '', amount: '' }].sort((a, b) => a.date.localeCompare(b.date)))}>
                {Number(date.slice(8))}
              </button>
            );
          })}
        </div>
        {oneOffs.length === 0 ? <p className="qe-hint">No one-offs yet. Tap a date above.</p> : (
          <div className="qe-queue">
            {oneOffs.map((one, i) => (
              <div key={one.date} className="qe-qrow">
                <span className="plan-guide-date">{new Date(`${one.date}T00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}</span>
                <input aria-label={`What on ${one.date}`} placeholder="What? e.g. Wedding gift" value={one.name} onChange={e => setOneOffs(list => list.map((o, j) => j === i ? { ...o, name: e.target.value } : o))} />
                <input aria-label={`Amount on ${one.date}`} inputMode="numeric" placeholder="Amount" value={one.amount ? Number(one.amount).toLocaleString('vi-VN') : ''} onChange={e => setOneOffs(list => list.map((o, j) => j === i ? { ...o, amount: digits(e.target.value) } : o))} />
                <button type="button" className="qe-x" aria-label={`Remove ${one.date}`} onClick={() => setOneOffs(list => list.filter((_, j) => j !== i))}><X size={15} /></button>
              </div>
            ))}
          </div>
        )}
      </>
    );
  } else {
    body = (
      <>
        <div className="plan-guide-kpis">
          <div>Income in {monthLabel}<b className="is-income">{money(review.income)}</b></div>
          <div>Spent so far<b className="is-spent">{money(review.spent)}</b></div>
          <div>Still planned<b className="is-planned">{money(review.planned)}</b></div>
          <div>Projected left over<b style={{ color: review.left >= 0 ? 'var(--primary)' : 'var(--danger)' }}>{money(review.left)}</b></div>
        </div>
        <p className="qe-hint">
          {total === 0 ? 'Nothing new selected. Go back to turn items on.' : `Creating ${draft.incomesToAdd.length ? `${draft.incomesToAdd.length} income ${draft.incomesToAdd.length === 1 ? 'source' : 'sources'} and ` : ''}${draft.plansToAdd.length} ${draft.plansToAdd.length === 1 ? 'plan' : 'plans'}: ${[...draft.incomesToAdd.map(i => i.source), ...draft.plansToAdd.map(p => p.description)].join(', ')}.`}
        </p>
        {missingAmount && <p className="qe-error">Some items you turned on have no amount; they will be skipped.</p>}
      </>
    );
  }

  return createPortal(
    <div className="qe-layer" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <div className="qe-dialog plan-guide" role="dialog" aria-modal="true" aria-labelledby="plan-guide-title">
        <header className="qe-d-head">
          <h2 id="plan-guide-title"><Sparkles size={18} aria-hidden="true" /> Plan your month · {monthLabel}</h2>
          <button type="button" className="qe-fx" aria-label="Close" disabled={busy} onClick={onClose}><X size={18} /></button>
        </header>
        <div className="plan-guide-steps" aria-hidden="true">{STEPS.map((s, i) => <span key={s.key} className={i <= step ? 'is-on' : undefined} />)}</div>
        <div className="plan-guide-body">
          <h3>{step + 1}. {current.title}</h3>
          <p>{current.help}</p>
          {body}
        </div>
        <footer className="qe-d-foot">
          {error && <p className="qe-error" role="alert">{error}</p>}
          <div className="qe-d-actions">
            <button type="button" className="qe-btn is-plain" disabled={step === 0 || busy} onClick={() => setStep(s => s - 1)}>Back</button>
            <span className="qe-sp" />
            {step < STEPS.length - 1
              ? <button type="button" className="qe-btn is-primary" onClick={() => setStep(s => s + 1)}>Next</button>
              : <button type="button" className="qe-btn is-primary" disabled={busy || total === 0} onClick={() => { void create(); }}>{busy ? 'Creating…' : `Create ${total} ${total === 1 ? 'item' : 'items'}`}</button>}
          </div>
        </footer>
      </div>
    </div>,
    document.body,
  );
}

