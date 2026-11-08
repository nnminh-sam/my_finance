'use client';

import { useMemo, useState } from 'react';
import { CalendarDays, Clock, Delete, NotebookPen, Pencil, Repeat, Search, Square, X } from 'lucide-react';
import { useFinance } from '../../contexts/FinanceContext';
import { CategoryIcon, categoryMeta, haptic } from '../mobile/MobileUi';
import {
  INCOME_FREQUENCY_SHORT, INCOME_SOURCES, WEEKDAY_ORDER, dayLabel, defaultSure, entryAmount, formatVnd, incomeSummary, isPlanEntry, isoDate, nowStamp, nowTime, repeatSummary,
} from '../../lib/quickEntry';
import { describePlanSchedule } from '../../lib/plans';
import type { QuickEntry } from '../../lib/quickEntry';
import type { CategoryData, IncomeFrequency, RepeatEndType, RepeatFrequency } from '../../types';
import type { QuickEntryController, QuickPanel, QueuedEntry } from './useQuickEntry';
import '../../styles/QuickEntry.css';

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const SOURCE_COLORS: Record<string, string> = {
  Salary: '#10b981', Freelance: '#3b82f6', Bonus: '#f59e0b', Allowance: '#8b5cf6', Gift: '#ec4899', Investment: '#06b6d4', Other: '#71717a',
};
const SOURCE_ICONS: Record<string, string> = {
  Salary: 'Briefcase', Freelance: 'Coffee', Bonus: 'Gift', Allowance: 'Heart', Gift: 'Gift', Investment: 'CircleDollarSign', Other: 'CircleDollarSign',
};

export const PANEL_TITLES: Record<QuickPanel, string> = {
  date: 'Date', time: 'Time', note: 'Description', repeat: 'Repeat & plan', queue: 'Queued', freq: 'How often', start: 'Start date', end: 'End date', name: 'Source & name',
};

const MODE_LABELS = { spending: 'Spending', income: 'Income' } as const;

/** Spending · Income. A spending that repeats or is dated ahead is saved as a plan. */
export function ModeToggle({ qe, small }: { qe: QuickEntryController; small?: boolean }) {
  if (qe.editing) return null;
  const current = qe.entry.mode;
  return (
    <div className={`qe-seg qe-mode${small ? ' is-small' : ''}`} role="radiogroup" aria-label="Transaction type">
      {(['spending', 'income'] as const).map(mode => (
        <button key={mode} type="button" role="radio" aria-checked={current === mode} data-mode={mode} className={current === mode ? 'is-on' : undefined} onClick={() => qe.setMode(mode)}>
          {MODE_LABELS[mode]}
        </button>
      ))}
    </div>
  );
}

export function AmountDisplay({ qe }: { qe: QuickEntryController }) {
  const income = qe.entry.mode === 'income';
  return (
    <div
      key={qe.shake}
      className={`qe-amount${qe.amount ? '' : ' is-zero'}${income && qe.amount ? ' is-income' : ''}${qe.shake ? ' is-shake' : ''}`}
      aria-live="polite"
      aria-label={`Amount ${formatVnd(qe.amount)}`}
    >
      {income && qe.amount ? '+' : ''}{qe.amount.toLocaleString('vi-VN')} <small>₫</small>
    </div>
  );
}

/** Digits on the left; the right column is ⌫, + Next, then ✓ spanning two rows. Editing leaves the + Next slot empty so ✓ never moves. */
export function Keypad({ qe, onSave, onNext, saveLabel }: { qe: QuickEntryController; onSave: () => void; onNext: () => void; saveLabel: string }) {
  const press = (key: string) => { haptic(5); qe.press(key); };
  const digits = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '000', '0'];
  const showNext = !qe.editing;
  return (
    <div className="qe-keys">
      {digits.map(key => (
        <button key={key} type="button" className={key === '0' ? 'qe-key-wide' : undefined} style={{ gridArea: `k${key}` }} onClick={() => press(key)}>{key}</button>
      ))}
      <button type="button" style={{ gridArea: 'del' }} aria-label="Delete digit" onClick={() => press('del')}><Delete size={20} /></button>
      <button type="button" className={`qe-key-ok${qe.entry.mode === 'income' ? ' is-income' : ''}`} style={{ gridArea: 'ok' }} disabled={qe.busy} aria-label={saveLabel} onClick={onSave}>
        <span aria-hidden="true">✓</span>{saveLabel}
      </button>
      {showNext && (
        <button type="button" className="qe-key-next" style={{ gridArea: 'next' }} disabled={qe.busy} aria-label="Queue this entry and start the next" onClick={onNext}>
          + Next
        </button>
      )}
    </div>
  );
}

export function saveLabelFor(qe: QuickEntryController) {
  if (qe.editing) return 'Save';
  const count = qe.queue.length + (qe.amount > 0 ? 1 : 0);
  return qe.queue.length ? `Save ${count}` : isPlanEntry(qe.entry) ? 'Add plan' : 'Add';
}

export function CategoryChips({ qe }: { qe: QuickEntryController }) {
  return (
    <div className="qe-chips" role="radiogroup" aria-label="Category">
      {qe.pickable.map(c => (
        <button key={c.id} type="button" role="radio" aria-checked={c.id === qe.entry.category} className={`qe-chip${c.id === qe.entry.category ? ' is-on' : ''}`} style={{ ['--c' as string]: c.color }} onClick={() => { haptic(5); qe.patch({ category: c.id }); }}>
          <CategoryIcon icon={c.icon} size={14} /> {c.name}
        </button>
      ))}
      {qe.pickable.length === 0 && <span className="qe-hint">No categories yet — add one in Profile.</span>}
    </div>
  );
}

export function CategoryGrid({ qe }: { qe: QuickEntryController }) {
  const [query, setQuery] = useState('');
  const shown = qe.pickable.filter(c => !query.trim() || c.name.toLowerCase().includes(query.trim().toLowerCase()));
  return (
    <div className="qe-stack">
      {qe.pickable.length > 8 && (
        <label className="qe-search">
          <Search size={16} aria-hidden="true" />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder={`Search ${qe.pickable.length} categories`} aria-label="Search categories" />
        </label>
      )}
      <div className="qe-cgrid" role="radiogroup" aria-label="Category">
        {shown.map(c => (
          <button key={c.id} type="button" role="radio" aria-checked={c.id === qe.entry.category} className={`qe-chip${c.id === qe.entry.category ? ' is-on' : ''}`} style={{ ['--c' as string]: c.color }} onClick={() => qe.patch({ category: c.id })}>
            <CategoryIcon icon={c.icon} size={15} /><span>{c.name}</span>
          </button>
        ))}
        {shown.length === 0 && <span className="qe-hint">No matching categories</span>}
      </div>
    </div>
  );
}

export function SourceChips({ qe, wrap }: { qe: QuickEntryController; wrap?: boolean }) {
  const current = qe.entry.income.source;
  const sources: string[] = INCOME_SOURCES.includes(current as typeof INCOME_SOURCES[number]) || !current ? [...INCOME_SOURCES] : [current, ...INCOME_SOURCES];
  return (
    <div className={`qe-chips${wrap ? ' is-wrap' : ''}`} role="radiogroup" aria-label="Income source">
      {sources.map(s => (
        <button key={s} type="button" role="radio" aria-checked={s === current} className={`qe-chip${s === current ? ' is-on' : ''}`} style={{ ['--c' as string]: SOURCE_COLORS[s] ?? '#10b981' }} onClick={() => qe.patchIncome({ source: s })}>
          <CategoryIcon icon={SOURCE_ICONS[s] ?? 'CircleDollarSign'} size={14} /> {s}
        </button>
      ))}
    </div>
  );
}

/** One chip per detail, showing its current value; tapping opens that detail's panel in place of the keypad. */
export function DetailChips({ qe }: { qe: QuickEntryController }) {
  const { entry, panel } = qe;
  const today = isoDate(new Date());
  const chip = (key: QuickPanel, Icon: typeof Clock, label: string, set: boolean) => (
    <button key={key} type="button" className={`qe-dchip${set ? ' is-set' : ''}${panel === key ? ' is-open' : ''}`} aria-expanded={panel === key} onClick={() => qe.togglePanel(key)}>
      <Icon size={14} aria-hidden="true" />{label}
    </button>
  );
  const chips = entry.mode === 'spending'
    ? [
      chip('date', CalendarDays, dayLabel(entry.date), entry.date !== today),
      chip('time', Clock, entry.time, false),
      chip('note', NotebookPen, entry.description || 'Note', Boolean(entry.description)),
      ...(qe.editing ? [] : [chip('repeat', Repeat, entry.repeat.on ? repeatSummary(entry.repeat) : isPlanEntry(entry) ? 'Planned' : 'Repeat / plan', entry.repeat.on || isPlanEntry(entry))]),
    ]
    : [
      chip('freq', Repeat, INCOME_FREQUENCY_SHORT[entry.income.frequency], true),
      chip('start', CalendarDays, `${entry.income.frequency === 'once' ? 'On' : 'From'} ${dayLabel(entry.income.startDate)}`, true),
      ...(entry.income.frequency === 'once' ? [] : [chip('end', Square, entry.income.endDate ? `To ${dayLabel(entry.income.endDate)}` : 'No end', Boolean(entry.income.endDate))]),
      chip('name', NotebookPen, entry.income.name || 'Name', Boolean(entry.income.name)),
    ];
  return <div className="qe-dchips">{chips}</div>;
}

function DateShortcuts({ value, onPick }: { value: string; onPick: (date: string) => void }) {
  const today = new Date();
  const days = [-1, 0, 1].map(offset => { const d = new Date(today); d.setDate(d.getDate() + offset); return isoDate(d); });
  return (
    <div className="qe-chips">
      {days.map(d => <button key={d} type="button" className={`qe-chip${value === d ? ' is-on' : ''}`} onClick={() => onPick(d)}>{dayLabel(d)}</button>)}
    </div>
  );
}

export function DatePanel({ qe }: { qe: QuickEntryController }) {
  return (
    <div className="qe-stack">
      <DateShortcuts value={qe.entry.date} onPick={date => qe.patch({ date })} />
      <label className="qe-field"><span>Date</span><input type="date" value={qe.entry.date} onChange={e => e.target.value && qe.patch({ date: e.target.value })} /></label>
    </div>
  );
}

export function TimePanel({ qe }: { qe: QuickEntryController }) {
  const presets: [string, string][] = [['Morning', '08:00'], ['Lunch', '12:30'], ['Evening', '19:00']];
  return (
    <div className="qe-stack">
      <div className="qe-chips">
        <button type="button" className="qe-chip" onClick={() => qe.patch({ time: nowTime() })}>Now</button>
        {presets.map(([label, time]) => <button key={label} type="button" className={`qe-chip${qe.entry.time === time ? ' is-on' : ''}`} onClick={() => qe.patch({ time })}>{label}</button>)}
      </div>
      <label className="qe-field"><span>Time</span><input type="time" value={qe.entry.time} onChange={e => e.target.value && qe.patch({ time: e.target.value })} /></label>
    </div>
  );
}

/** Recent descriptions for the chosen category, most frequent first. */
function useRecentDescriptions(category: string, limit = 6) {
  const { spendings } = useFinance();
  return useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of spendings) if (s.category === category && s.description) counts.set(s.description, (counts.get(s.description) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([text]) => text);
  }, [spendings, category, limit]);
}

export function NotePanel({ qe, autoFocus }: { qe: QuickEntryController; autoFocus?: boolean }) {
  const recent = useRecentDescriptions(qe.entry.category);
  const fallback = categoryMeta(qe.categories, qe.entry.category).name;
  return (
    <div className="qe-stack">
      <label className="qe-field">
        <span>Description</span>
        <input value={qe.entry.description} maxLength={500} autoFocus={autoFocus} placeholder={`${fallback} (default)`} onChange={e => qe.patch({ description: e.target.value })} />
      </label>
      {recent.length > 0 && (
        <div className="qe-recent" aria-label="Recent descriptions">
          {recent.map(text => <button key={text} type="button" className={qe.entry.description === text ? 'is-on' : undefined} onClick={() => qe.patch({ description: text })}>{text}</button>)}
        </div>
      )}
    </div>
  );
}

const REPEAT_FREQUENCIES: [RepeatFrequency, string][] = [['weekdays', 'Weekdays'], ['weekly', 'Weekly'], ['monthly', 'Monthly'], ['daily', 'Every N days']];
const REPEAT_ENDS: [RepeatEndType, string][] = [['unlimited', 'Never'], ['until_date', 'On a date']];

/** Repeat & plan: repeating, future-dated or Plan-tab entries are saved as plans that become real when their time passes. */
export function RepeatPanel({ qe }: { qe: QuickEntryController }) {
  const r = qe.entry.repeat;
  const day = Number(qe.entry.date.slice(8, 10));
  const planned = isPlanEntry(qe.entry);
  const sure = qe.entry.sure ?? defaultSure(categoryMeta(qe.categories, qe.entry.category).name);
  return (
    <div className="qe-stack">
      <button type="button" className="qe-trow" role="switch" aria-checked={r.on} onClick={() => qe.patchRepeat({ on: !r.on })}>
        <span>Repeat</span><span className={`qe-switch${r.on ? ' is-on' : ''}`} aria-hidden="true" />
      </button>
      {r.on && (
        <>
          <div className="qe-seg is-small" role="radiogroup" aria-label="Repeat frequency">
            {REPEAT_FREQUENCIES.map(([value, label]) => (
              <button key={value} type="button" role="radio" aria-checked={r.frequency === value} className={r.frequency === value ? 'is-on' : undefined} onClick={() => qe.patchRepeat({ frequency: value })}>{label}</button>
            ))}
          </div>
          {r.frequency === 'daily' && (
            <div className="qe-trow">
              <span>Every</span>
              <span className="qe-stepper">
                <button type="button" aria-label="Fewer days" onClick={() => qe.patchRepeat({ interval: Math.max(1, r.interval - 1) })}>−</button>
                <b>{r.interval}</b>
                <button type="button" aria-label="More days" onClick={() => qe.patchRepeat({ interval: Math.min(365, r.interval + 1) })}>+</button>
                {r.interval === 1 ? 'day' : 'days'}
              </span>
            </div>
          )}
          {r.frequency === 'weekly' && (
            <div className="qe-days" role="group" aria-label="Repeat on">
              {WEEKDAY_ORDER.map(d => {
                const on = r.daysOfWeek.includes(d);
                return (
                  <button key={d} type="button" aria-pressed={on} className={on ? 'is-on' : undefined} onClick={() => qe.patchRepeat({ daysOfWeek: on ? r.daysOfWeek.filter(x => x !== d) : [...r.daysOfWeek, d] })}>
                    {WEEKDAY_SHORT[d]}
                  </button>
                );
              })}
            </div>
          )}
          {r.frequency === 'monthly' && <span className="qe-hint">On day {day} of each month, starting from the entry’s date.</span>}
          {r.frequency === 'weekdays' && <span className="qe-hint">Monday to Friday, starting from the entry’s date.</span>}
          <div className="qe-field">
            <span>Ends</span>
            <div className="qe-seg is-small" role="radiogroup" aria-label="Repeat ends">
              {REPEAT_ENDS.map(([value, label]) => (
                <button key={value} type="button" role="radio" aria-checked={r.endType === value} className={r.endType === value ? 'is-on' : undefined} onClick={() => qe.patchRepeat({ endType: value })}>{label}</button>
              ))}
            </div>
          </div>
          {r.endType === 'until_date' && (
            <label className="qe-field"><span>Until</span><input type="date" min={qe.entry.date} value={r.endDate} onChange={e => qe.patchRepeat({ endDate: e.target.value })} /></label>
          )}
        </>
      )}
      {planned && (
        <div className="qe-field">
          <span>How sure is it?</span>
          <div className="qe-seg is-small qe-sure" role="radiogroup" aria-label="How sure is it">
            <button type="button" role="radio" aria-checked={sure} className={sure ? 'is-on' : undefined} onClick={() => qe.patch({ sure: true })}>Sure<small>fixed: rent, bills</small></button>
            <button type="button" role="radio" aria-checked={!sure} className={!sure ? 'is-on' : undefined} onClick={() => qe.patch({ sure: false })}>Estimate<small>about: food, coffee</small></button>
          </div>
        </div>
      )}
      <PlanStatus qe={qe} />
    </div>
  );
}

/** One line saying whether the entry is recorded now or planned, and when a plan becomes real. */
export function PlanStatus({ qe }: { qe: QuickEntryController }) {
  const { entry } = qe;
  if (entry.mode !== 'spending') return null;
  const r = entry.repeat;
  const ahead = `${entry.date}T${entry.time}` > nowStamp();
  if (!isPlanEntry(entry)) {
    return <p className="qe-status" role="status">Recorded as a real expense on {dayLabel(entry.date)} at {entry.time}.</p>;
  }
  const meta = categoryMeta(qe.categories, entry.category);
  const sure = entry.sure ?? defaultSure(meta.name);
  const amount = qe.amount ? `${sure ? '' : '~'}${formatVnd(qe.amount)}` : 'It';
  const when = r.on
    ? `${describePlanSchedule({ startDate: entry.date, frequency: r.frequency, interval: r.interval, daysOfWeek: r.daysOfWeek, endDate: null }).toLowerCase()} at ${entry.time} from ${dayLabel(entry.date)}${r.endType === 'until_date' && r.endDate ? ` until ${dayLabel(r.endDate)}` : ', no end'}`
    : `on ${dayLabel(entry.date)} at ${entry.time}`;
  return (
    <p className="qe-status is-plan" role="status">
      <b>Planned.</b> {amount} {when}. {r.on ? 'Each one becomes' : 'It becomes'} a real expense when its time passes.
    </p>
  );
}

const INCOME_FREQUENCIES = Object.entries(INCOME_FREQUENCY_SHORT) as [IncomeFrequency, string][];

export function IncomeFrequencyPanel({ qe }: { qe: QuickEntryController }) {
  const f = qe.entry.income.frequency;
  return (
    <div className="qe-stack">
      <div className="qe-seg is-small" role="radiogroup" aria-label="How often">
        {INCOME_FREQUENCIES.map(([value, label]) => (
          <button key={value} type="button" role="radio" aria-checked={f === value} className={f === value ? 'is-on' : undefined} onClick={() => qe.patchIncome({ frequency: value, ...(value === 'once' ? { endDate: '' } : {}) })}>{label}</button>
        ))}
      </div>
      <span className="qe-hint">{incomeSummary(qe.entry.income)}</span>
    </div>
  );
}

export function IncomeDatePanel({ qe, which }: { qe: QuickEntryController; which: 'start' | 'end' }) {
  const income = qe.entry.income;
  if (which === 'start') {
    return (
      <div className="qe-stack">
        <DateShortcuts value={income.startDate} onPick={startDate => qe.patchIncome({ startDate })} />
        <label className="qe-field"><span>{income.frequency === 'once' ? 'Paid on' : 'Starts'}</span><input type="date" value={income.startDate} onChange={e => e.target.value && qe.patchIncome({ startDate: e.target.value })} /></label>
      </div>
    );
  }
  return (
    <div className="qe-stack">
      <label className="qe-field"><span>Ends (optional)</span><input type="date" min={income.startDate} value={income.endDate} onChange={e => qe.patchIncome({ endDate: e.target.value })} /></label>
      {income.endDate && <button type="button" className="qe-link" onClick={() => qe.patchIncome({ endDate: '' })}>No end date</button>}
    </div>
  );
}

export function IncomeNamePanel({ qe }: { qe: QuickEntryController }) {
  const income = qe.entry.income;
  return (
    <div className="qe-stack">
      <label className="qe-field">
        <span>Source</span>
        <input value={income.source} maxLength={100} list="qe-income-sources" onChange={e => qe.patchIncome({ source: e.target.value })} />
        <datalist id="qe-income-sources">{INCOME_SOURCES.map(s => <option key={s} value={s} />)}</datalist>
      </label>
      <label className="qe-field">
        <span>Name (employer, client…)</span>
        <input value={income.name} maxLength={500} placeholder="e.g., Performance bonus, freelance" onChange={e => qe.patchIncome({ name: e.target.value })} />
      </label>
    </div>
  );
}

export function PanelBody({ qe, panel }: { qe: QuickEntryController; panel: QuickPanel }) {
  switch (panel) {
    case 'date': return <DatePanel qe={qe} />;
    case 'time': return <TimePanel qe={qe} />;
    case 'note': return <NotePanel qe={qe} autoFocus />;
    case 'repeat': return <RepeatPanel qe={qe} />;
    case 'freq': return <IncomeFrequencyPanel qe={qe} />;
    case 'start': return <IncomeDatePanel qe={qe} which="start" />;
    case 'end': return <IncomeDatePanel qe={qe} which="end" />;
    case 'name': return <IncomeNamePanel qe={qe} />;
    case 'queue': return <QueueList qe={qe} />;
  }
}

function entryTitle(entry: QuickEntry, categories: readonly CategoryData[]) {
  if (entry.mode === 'income') return `${entry.income.source}${entry.income.name ? ` · ${entry.income.name}` : ''}`;
  return entry.description || categoryMeta(categories, entry.category).name;
}

function entrySubtitle(entry: QuickEntry, categories: readonly CategoryData[]) {
  if (entry.mode === 'income') return incomeSummary(entry.income);
  return `${categoryMeta(categories, entry.category).name} · ${dayLabel(entry.date)} ${entry.time}${entry.repeat.on ? ` · ↻ ${repeatSummary(entry.repeat)}` : ''}`;
}

export function QueueList({ qe }: { qe: QuickEntryController }) {
  if (qe.queue.length === 0) return <p className="qe-hint">Nothing queued. Press + Next to queue an entry and type the next one.</p>;
  return (
    <div className="qe-queue">
      <div className="qe-queue-h"><span>Queued · {qe.queue.length}</span><span>{formatVnd(qe.queueTotal)}</span></div>
      {qe.queue.map((item: QueuedEntry) => {
        const income = item.entry.mode === 'income';
        const meta = income
          ? { color: SOURCE_COLORS[item.entry.income.source] ?? '#10b981', icon: SOURCE_ICONS[item.entry.income.source] ?? 'CircleDollarSign' }
          : categoryMeta(qe.categories, item.entry.category);
        return (
          <div key={item.key} className="qe-qrow">
            <span className="qe-ic" style={{ ['--c' as string]: meta.color }}><CategoryIcon icon={meta.icon} size={15} /></span>
            <span className="qe-rt"><b>{entryTitle(item.entry, qe.categories)}</b><small>{entrySubtitle(item.entry, qe.categories)}</small></span>
            <span className={`qe-amt${income ? ' is-income' : ''}`}>{income ? '+' : '−'}{formatVnd(entryAmount(item.entry))}</span>
            <button type="button" className="qe-x" aria-label={`Edit queued ${entryTitle(item.entry, qe.categories)}`} onClick={() => qe.editQueued(item.key)}><Pencil size={14} /></button>
            <button type="button" className="qe-x" aria-label={`Remove queued ${entryTitle(item.entry, qe.categories)}`} onClick={() => qe.removeQueued(item.key)}><X size={15} /></button>
          </div>
        );
      })}
    </div>
  );
}

export function QuickError({ qe }: { qe: QuickEntryController }) {
  return qe.error ? <p className="qe-error" role="alert">{qe.error}</p> : null;
}
