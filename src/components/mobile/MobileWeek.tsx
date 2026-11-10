'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, TouchEvent as ReactTouchEvent } from 'react';
import { useRouter } from 'next/navigation';
import {
  addDays, differenceInCalendarWeeks, eachDayOfInterval, endOfWeek, format, isAfter, isSameDay, startOfDay, startOfWeek,
} from 'date-fns';
import { ArrowDownLeft, ChevronLeft, ChevronRight } from 'lucide-react';
import { useFinance } from '../../contexts/FinanceContext';
import { useFinanceShell } from '../../contexts/FinanceShellContext';
import { useSettings } from '../../contexts/SettingsContext';
import { useUnsavedChanges } from '../../hooks/useUnsavedChanges';
import { pageHref } from '../../lib/navigation';
import { pages } from '../../lib/pages';
import { getSpendingsForDate } from '../../lib/spendings';
import { fmtVND } from '../../lib/analytics';
import { expectedPaydays } from '../../lib/income';
import { IncomeRecordSheet } from '../IncomeRecordSheet';
import { errorMessage } from '../../services/auth';
import type { Spending, Transaction } from '../../types';
import type { PlanOccurrence } from '../../lib/plans';
import { CategoryIcon, Toast, categoryMeta, haptic, useToast } from './MobileUi';
import { QuickEntryDock } from '../quickEntry/QuickEntryDock';
import { useQuickEntry } from '../quickEntry/useQuickEntry';
import type { SaveResult } from '../quickEntry/useQuickEntry';
import { SystemAlert } from '../SystemAlert';
import { useDialog } from '../../contexts/DialogContext';
import type { AlertButton } from '../SystemAlert';
import '../../styles/Mobile.css';

const WEEK = { weekStartsOn: 1 as const };

function dayLabel(day: Date, today: Date) {
  return isSameDay(day, today) ? `Today, ${format(day, 'd MMM')}` : format(day, 'EEEE, d MMM');
}

function weekTitle(offset: number) {
  if (offset === 0) return 'This week';
  if (offset === -1) return 'Last week';
  if (offset === 1) return 'Next week';
  return offset < 0 ? `${-offset} weeks ago` : `In ${offset} weeks`;
}

/** F · Week: B's ledger — seven-bar chart, day strip, that day's expenses and a closable keypad. */
export function MobileWeek() {
  const { currentDate, keypadOpen, setKeypadOpen, keypadPulse } = useFinanceShell();
  const { spendings, plans, incomes, received, createSpending, deleteSpending, projectedBetween, setPlanException, clearPlanException, completePlanOccurrence } = useFinance();
  const { settings } = useSettings();
  const router = useRouter();
  const today = startOfDay(new Date());

  const [selected, setSelected] = useState(() => startOfDay(currentDate));
  const currentKey = format(currentDate, 'yyyy-MM-dd');
  useEffect(() => { setSelected(startOfDay(currentDate)); }, [currentKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const weekStart = startOfWeek(selected, WEEK);
  const days = useMemo(() => eachDayOfInterval({ start: weekStart, end: endOfWeek(weekStart, WEEK) }), [weekStart.getTime()]); // eslint-disable-line react-hooks/exhaustive-deps
  const totals = days.map(day => getSpendingsForDate(day, spendings).reduce((sum, s) => sum + s.amount, 0));
  const weekPlanned = projectedBetween(format(days[0], 'yyyy-MM-dd'), format(days[6], 'yyyy-MM-dd'));
  const plannedTotals = days.map(day => {
    const key = format(day, 'yyyy-MM-dd');
    return weekPlanned.filter(item => item.date === key).reduce((sum, item) => sum + item.amount, 0);
  });
  const max = Math.max(1, ...totals, ...plannedTotals);
  const weekTotal = totals.reduce((a, b) => a + b, 0);
  const weekPlannedTotal = plannedTotals.reduce((a, b) => a + b, 0);
  const offset = differenceInCalendarWeeks(weekStart, today, WEEK);
  const daySpendings = getSpendingsForDate(selected, spendings);
  const dayTotal = daySpendings.reduce((sum, s) => sum + s.amount, 0);
  const selectedKey = format(selected, 'yyyy-MM-dd');
  const dayPlanned = weekPlanned.filter(item => item.date === selectedKey);
  const daySkipped = plans.filter(plan => plan.exceptions.some(item => item.date === selectedKey && item.kind === 'skip')
    && `${selectedKey}T${plan.time}` > plan.materializedThrough);
  const selectedLabel = dayLabel(selected, today);
  // Money in on this day (green, tap to fix one payment) and paydays on it that have not come yet.
  const dayReceived = received.filter(record => record.date === selectedKey);
  const dayIncome = dayReceived.reduce((sum, record) => sum + record.amount, 0);
  const dayExpected = expectedPaydays(incomes, selectedKey, selectedKey);
  const [editingReceived, setEditingReceived] = useState<Transaction | null>(null);

  const { toast, show: showToast, hide: hideToast } = useToast();
  const [alert, setAlert] = useState<{ title: string; message?: string; buttons: AlertButton[] } | null>(null);

  // ----- quick entry (direction A) -----
  const qe = useQuickEntry(format(selected, 'yyyy-MM-dd'));
  const [pulse, setPulse] = useState(false);
  useUnsavedChanges(qe.dirty);
  const { prompt } = useDialog();

  useEffect(() => {
    if (keypadPulse === 0) return;
    setPulse(true);
    const timer = setTimeout(() => setPulse(false), 650);
    return () => clearTimeout(timer);
  }, [keypadPulse]);

  const report = useCallback((result: SaveResult | null) => {
    if (!result) { haptic(30); return; }
    haptic(15);
    showToast(result.message, result.undo ? () => { void result.undo!().catch(cause => showToast(`Could not undo: ${errorMessage(cause)}`)); } : undefined);
  }, [showToast]);

  const add = useCallback(async () => report(await qe.save()), [qe, report]);
  const next = useCallback(() => {
    if (qe.queueCurrent()) { haptic(10); showToast('Queued · type the next one'); } else haptic(30);
  }, [qe, showToast]);
  const removeEdited = useCallback(async () => report(await qe.removeEditing()), [qe, report]);

  const confirmDiscard = useCallback((onDiscard: () => void) => {
    if (!qe.dirty) { onDiscard(); return; }
    setAlert({
      title: qe.editing ? 'Discard your changes?' : 'Discard this entry?',
      message: qe.editing
        ? `Changes to ${qe.editing.description} aren’t saved.`
        : `${qe.queue.length ? `${qe.queue.length} queued ${qe.queue.length === 1 ? 'entry' : 'entries'}${qe.amount ? ' and ' : ''}` : ''}${qe.amount ? fmtVND(qe.amount) : ''} not saved yet.`,
      buttons: [
        { label: 'Keep editing', onPress: () => setAlert(null) },
        { label: 'Discard', destructive: true, onPress: () => { setAlert(null); qe.reset(); onDiscard(); } },
      ],
    });
  }, [qe]);

  const closeKeypad = useCallback(() => {
    confirmDiscard(() => {
      if (qe.editing) qe.reset(); else setKeypadOpen(false);
    });
  }, [confirmDiscard, qe, setKeypadOpen]);

  const editRow = (spending: Spending) => {
    confirmDiscard(() => { qe.loadExpense(spending); setKeypadOpen(true); });
  };

  // Hardware keys: digits, k, Backspace, Enter (⇧ queues); Escape stands in for Android back and closes the keypad first.
  useEffect(() => {
    if (!keypadOpen || alert) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]') || document.querySelector('.qe-layer')) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (/^\d$/.test(event.key)) { event.preventDefault(); qe.press(event.key); }
      else if ((event.key === 'k' || event.key === 'K') && qe.amount > 0) { event.preventDefault(); qe.press('000'); }
      else if (event.key === 'Backspace') { event.preventDefault(); qe.press('del'); }
      else if (event.key === 'Enter' && !(target instanceof HTMLButtonElement)) { event.preventDefault(); if (event.shiftKey) next(); else void add(); }
      else if (event.key === 'Escape') { event.preventDefault(); if (qe.panel) qe.togglePanel(null); else closeKeypad(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [keypadOpen, alert, qe, add, next, closeKeypad]);

  // ----- week navigation -----
  const goWeek = (by: number) => {
    router.replace(pageHref('week', addDays(selected, by * 7)));
  };
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const onTouchStart = (event: ReactTouchEvent) => { swipe.current = { x: event.touches[0].clientX, y: event.touches[0].clientY }; };
  const onTouchEnd = (event: ReactTouchEvent) => {
    if (!swipe.current) return;
    const dx = event.changedTouches[0].clientX - swipe.current.x;
    const dy = event.changedTouches[0].clientY - swipe.current.y;
    swipe.current = null;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.4) goWeek(dx < 0 ? 1 : -1);
  };

  const select = (day: Date) => { haptic(5); setSelected(day); };

  // ----- planned rows: skip, change the amount, or undo for just this day -----
  const planAction = async (action: () => Promise<void>, done: string) => {
    try {
      await action();
      haptic(10);
      showToast(done);
    } catch (cause) {
      showToast(`Could not update plan: ${errorMessage(cause)}`);
    }
  };
  const openPlanned = (occurrence: PlanOccurrence) => {
    const label = occurrence.description || categoryMeta(settings.categories, occurrence.category).name;
    const buttons: AlertButton[] = [
      {
        label: 'Done now', onPress: () => {
          setAlert(null);
          void planAction(async () => { await completePlanOccurrence(occurrence.planId, selectedKey); }, `${label} recorded as spent`);
        },
      },
      {
        label: 'Change amount', onPress: async () => {
          setAlert(null);
          const typed = await prompt({
            title: `Amount for ${label}`,
            message: `Only ${format(selected, 'EEE d MMM')} changes; other days keep the usual amount.`,
            defaultValue: String(occurrence.amount),
            inputMode: 'numeric',
            confirmLabel: 'Save',
          });
          if (typed === null) return;
          const amount = Number(typed.replace(/[\s,._]/g, ''));
          if (!Number.isFinite(amount) || amount <= 0 || amount > 1e12) { showToast('Enter an amount above 0 ₫'); return; }
          const plan = plans.find(item => item.id === occurrence.planId);
          const description = plan && occurrence.description !== plan.description ? occurrence.description : null;
          void planAction(() => setPlanException(occurrence.planId, selectedKey, { kind: 'override', amount, description }), `${label} · ${fmtVND(amount)} on this day`);
        },
      },
    ];
    if (occurrence.overridden) {
      buttons.push({ label: 'Use usual amount', onPress: () => { setAlert(null); void planAction(() => clearPlanException(occurrence.planId, selectedKey), `${label} back to its usual amount`); } });
    }
    buttons.push({ label: 'Skip this day', destructive: true, onPress: () => { setAlert(null); void planAction(() => setPlanException(occurrence.planId, selectedKey, { kind: 'skip', amount: null, description: null }), `${label} skipped`); } });
    buttons.push({ label: 'Edit series', onPress: () => { setAlert(null); router.push(`${pages.plans.path}?edit=${encodeURIComponent(occurrence.planId)}&from=${selectedKey}`); } });
    buttons.push({ label: 'Cancel', onPress: () => setAlert(null) });
    setAlert({ title: `Planned ${label}`, message: `${occurrence.sure ? '' : '~'}${fmtVND(occurrence.amount)} at ${occurrence.time} · ${occurrence.sure ? 'sure' : 'estimate'}. It becomes a real expense once that time passes. “Done now” records it right away so it's never counted twice.`, buttons });
  };

  // ----- rows -----
  const remove = async (spending: Spending) => {
    haptic(20);
    try {
      await deleteSpending(spending.id);
      const meta = categoryMeta(settings.categories, spending.category);
      showToast(`Deleted ${spending.description || meta.name} · ${fmtVND(spending.amount)}`, () => {
        const { amount: a, description, category: c, date, time } = spending;
        void createSpending({ amount: a, description, category: c, date, time }).catch(cause => showToast(`Could not undo: ${errorMessage(cause)}`));
      });
    } catch (cause) {
      showToast(`Could not delete: ${errorMessage(cause)}`);
    }
  };

  return (
    <div className="m-screen m-week">
      <header className="m-nav m-nav-tight">
        <div>
          <div className="m-sub">
            {format(weekStart, 'd MMM')} – {format(endOfWeek(weekStart, WEEK), 'd MMM')} · {fmtVND(weekTotal)}
            {weekPlannedTotal > 0 && <span className="m-planned-text"> · ~{fmtVND(weekPlannedTotal)} planned</span>}
          </div>
          <h1>{weekTitle(offset)}</h1>
        </div>
        <div className="m-wnav">
          <button type="button" aria-label="Previous week" onClick={() => goWeek(-1)}><ChevronLeft size={20} /></button>
          <button type="button" aria-label="Next week" onClick={() => goWeek(1)}><ChevronRight size={20} /></button>
        </div>
      </header>

      <div onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        <div className="m-wbars" role="group" aria-label="Spending per day this week">
          {days.map((day, i) => (
            <div key={day.toISOString()}>
              <button
                type="button"
                className={`${isSameDay(day, selected) ? 'is-sel' : ''}${isSameDay(day, today) ? ' is-today' : ''}${isAfter(day, today) ? ' is-future' : ''}${!totals[i] && plannedTotals[i] ? ' is-planned' : ''}`}
                style={{ height: `${(totals[i] || plannedTotals[i]) ? Math.max(10, (100 * (totals[i] || plannedTotals[i])) / max) : 10}%` }}
                aria-label={`${format(day, 'EEE d MMM')}, ${fmtVND(totals[i])}${plannedTotals[i] ? `, ${fmtVND(plannedTotals[i])} planned` : ''}`}
                onClick={() => select(day)}
              />
            </div>
          ))}
        </div>
        <div className="m-strip" role="tablist" aria-label="Day">
          {days.map(day => {
            const isSel = isSameDay(day, selected);
            return (
              <button
                key={day.toISOString()}
                type="button"
                role="tab"
                aria-selected={isSel}
                className={`${isSel ? 'is-on' : ''}${isSameDay(day, today) ? ' is-today' : ''}${isAfter(day, today) ? ' is-future' : ''}`}
                aria-label={format(day, 'EEEE d MMMM')}
                onClick={() => select(day)}
              >
                <small>{format(day, 'EEE')}</small>
                <b>{format(day, 'd')}</b>
              </button>
            );
          })}
        </div>
      </div>

      <div className="m-ledger">
        <div className="m-ledger-h">
          <span className="m-muted">{selectedLabel}</span>
          <span className="m-ledger-totals">
            {dayIncome > 0 && <b className="m-in-text">+{fmtVND(dayIncome)}</b>}
            <b>{fmtVND(dayTotal)}</b>
          </span>
        </div>
        {dayReceived.length > 0 && (
          <div className="m-list">
            {dayReceived.map(record => (
              <button key={record.id} type="button" className="m-row m-row-income" aria-label={`${record.description || record.category}, received ${fmtVND(record.amount)}. Opens edit.`} onClick={() => setEditingReceived(record)}>
                <span className="m-ic" style={{ ['--c' as string]: 'var(--success)' }}><ArrowDownLeft size={16} /></span>
                <span className="m-rt">
                  <b>{record.description || record.category}</b>
                  <small>{record.category}</small>
                </span>
                <span className="m-amt">+{fmtVND(record.amount)}</span>
              </button>
            ))}
          </div>
        )}
        {daySpendings.length === 0 ? (
          dayPlanned.length === 0 && dayReceived.length === 0 && dayExpected.length === 0 && <p className="m-empty">Nothing in or out yet.</p>
        ) : (
          <div className="m-list">
            {daySpendings.map(spending => (
              <SwipeRow
                key={spending.id}
                spending={spending}
                categories={settings.categories}
                onOpen={() => editRow(spending)}
                onDelete={() => { void remove(spending); }}
              />
            ))}
          </div>
        )}
        {daySpendings.length > 0 && <p className="m-hint">Swipe left to delete · tap to edit</p>}
        {(dayPlanned.length > 0 || daySkipped.length > 0 || dayExpected.length > 0) && (
          <>
            <div className="m-ledger-h m-planned-h">
              <span className="m-muted">Planned</span>
              <b className="m-planned-text">~{fmtVND(dayPlanned.reduce((sum, item) => sum + item.amount, 0))}</b>
            </div>
            <div className="m-list">
              {dayExpected.map(payday => (
                <button key={`payday-${payday.incomeId}`} type="button" className="m-row m-row-planned m-row-income"
                  aria-label={`${payday.source} payday expected, ${fmtVND(payday.amount)}. Opens the income schedule.`}
                  onClick={() => router.push(`${pages.profile.path}#income`)}>
                  <span className="m-ic" style={{ ['--c' as string]: 'var(--success)' }}><ArrowDownLeft size={16} /></span>
                  <span className="m-rt">
                    <b>{payday.name ? `${payday.source} · ${payday.name}` : payday.source}</b>
                    <small>Expected payday</small>
                  </span>
                  <span className="m-amt">~+{fmtVND(payday.amount)}</span>
                </button>
              ))}
              {dayPlanned.map(occurrence => {
                const meta = categoryMeta(settings.categories, occurrence.category);
                return (
                  <button key={occurrence.planId} type="button" className={`m-row m-row-planned${occurrence.sure ? ' is-sure' : ''}`} aria-label={`Planned ${occurrence.description || meta.name} at ${occurrence.time}, ${fmtVND(occurrence.amount)}. Opens options.`} onClick={() => openPlanned(occurrence)}>
                    <span className="m-ic" style={{ ['--c' as string]: meta.color }}><CategoryIcon icon={meta.icon} size={16} /></span>
                    <span className="m-rt">
                      <b>{occurrence.description || meta.name}</b>
                      <small>{occurrence.overridden ? 'Planned · changed' : 'Planned'} · {occurrence.time}</small>
                    </span>
                    <span className="m-amt">~{fmtVND(occurrence.amount)}</span>
                  </button>
                );
              })}
              {daySkipped.map(plan => {
                const meta = categoryMeta(settings.categories, plan.category);
                const label = plan.description || meta.name;
                return (
                  <button key={`skip-${plan.id}`} type="button" className="m-row m-row-planned is-skipped" aria-label={`${label} skipped this day. Undo skip.`}
                    onClick={() => { void planAction(() => clearPlanException(plan.id, selectedKey), `${label} planned again`); }}>
                    <span className="m-ic" style={{ ['--c' as string]: meta.color }}><CategoryIcon icon={meta.icon} size={16} /></span>
                    <span className="m-rt">
                      <b>{label}</b>
                      <small>Skipped · tap to undo</small>
                    </span>
                    <span className="m-amt">{fmtVND(plan.amount)}</span>
                  </button>
                );
              })}
            </div>
            <p className="m-hint">Planned items become real expenses once their time passes · tap to skip or change</p>
          </>
        )}
        {!keypadOpen && (
          <button type="button" className="m-btn m-btn-ghost" onClick={() => setKeypadOpen(true)}>+ Add expense</button>
        )}
      </div>

      {editingReceived && (
        <IncomeRecordSheet
          record={editingReceived}
          onClose={() => setEditingReceived(null)}
          onDone={(message) => { setEditingReceived(null); showToast(message); }}
        />
      )}

      {keypadOpen && (
        <QuickEntryDock
          qe={qe}
          dayLabel={selectedLabel}
          pulse={pulse}
          onSave={() => { void add(); }}
          onNext={next}
          onClose={closeKeypad}
          onDelete={() => { void removeEdited(); }}
        />
      )}

      <Toast toast={toast} onHide={hideToast} top={keypadOpen} />
      {alert && <SystemAlert title={alert.title} message={alert.message} buttons={alert.buttons} vertical={alert.buttons.length > 2} onDismiss={() => setAlert(null)} />}
    </div>
  );
}

const DELETE_WIDTH = 84;

function SwipeRow({ spending, categories, onOpen, onDelete }: {
  spending: Spending;
  categories: Parameters<typeof categoryMeta>[0];
  onOpen: () => void;
  onDelete: () => void;
}) {
  const meta = categoryMeta(categories, spending.category);
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const start = useRef<{ x: number; y: number; base: number; moved: boolean; horizontal: boolean | null } | null>(null);

  const onPointerDown = (event: ReactPointerEvent) => {
    start.current = { x: event.clientX, y: event.clientY, base: dx, moved: false, horizontal: null };
  };
  const onPointerMove = (event: ReactPointerEvent) => {
    const s = start.current;
    if (!s) return;
    const mx = event.clientX - s.x;
    const my = event.clientY - s.y;
    if (s.horizontal === null && (Math.abs(mx) > 6 || Math.abs(my) > 6)) {
      s.horizontal = Math.abs(mx) > Math.abs(my);
      if (s.horizontal) {
        try { (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId); } catch { /* released */ }
        setDragging(true);
      }
    }
    if (s.horizontal) {
      s.moved = true;
      setDx(Math.max(-DELETE_WIDTH * 1.4, Math.min(0, s.base + mx)));
    }
  };
  const onPointerUp = () => {
    const s = start.current;
    start.current = null;
    setDragging(false);
    if (!s) return;
    if (!s.moved) {
      if (dx !== 0) setDx(0); else onOpen();
      return;
    }
    if (dx < -DELETE_WIDTH * 1.25) { setDx(0); onDelete(); return; }
    setDx(dx < -DELETE_WIDTH / 2 ? -DELETE_WIDTH : 0);
  };

  return (
    <div className="m-swipe">
      <button type="button" className="m-del" tabIndex={dx === 0 ? -1 : 0} onClick={onDelete}>Delete</button>
      <div
        className={`m-row${dragging ? ' is-drag' : ''}`}
        style={{ transform: `translateX(${dx}px)` }}
        role="button"
        tabIndex={0}
        aria-label={`${spending.description || meta.name}, ${meta.name} at ${spending.time}, ${fmtVND(spending.amount)}. Opens editor.`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => { start.current = null; setDragging(false); setDx(0); }}
        onKeyDown={event => {
          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onOpen(); }
          if (event.key === 'Delete') { event.preventDefault(); onDelete(); }
        }}
      >
        <span className="m-ic" style={{ ['--c' as string]: meta.color }}><CategoryIcon icon={meta.icon} size={16} /></span>
        <span className="m-rt">
          <b>{spending.description || meta.name}</b>
          <small>{meta.name} · {spending.time}</small>
        </span>
        <span className="m-amt">−{fmtVND(spending.amount)}</span>
      </div>
    </div>
  );
}
