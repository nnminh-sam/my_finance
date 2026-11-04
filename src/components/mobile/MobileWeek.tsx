'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, TouchEvent as ReactTouchEvent } from 'react';
import { useRouter } from 'next/navigation';
import {
  addDays, differenceInCalendarWeeks, eachDayOfInterval, endOfWeek, format, isAfter, isSameDay, startOfDay, startOfWeek,
} from 'date-fns';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useFinance } from '../../contexts/FinanceContext';
import { useFinanceShell } from '../../contexts/FinanceShellContext';
import { useSettings } from '../../contexts/SettingsContext';
import { useUnsavedChanges } from '../../hooks/useUnsavedChanges';
import { pageHref } from '../../lib/navigation';
import { getSpendingsForDate } from '../../lib/spendings';
import { fmtVND } from '../../lib/analytics';
import { errorMessage } from '../../services/auth';
import type { Spending } from '../../types';
import { CategoryIcon, MobileAlert, Toast, categoryMeta, haptic, useToast } from './MobileUi';
import { QuickEntryDock } from '../quickEntry/QuickEntryDock';
import { useQuickEntry } from '../quickEntry/useQuickEntry';
import type { SaveResult } from '../quickEntry/useQuickEntry';
import type { AlertButton } from './MobileUi';
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
  const { spendings, createSpending, deleteSpending } = useFinance();
  const { settings } = useSettings();
  const router = useRouter();
  const today = startOfDay(new Date());

  const [selected, setSelected] = useState(() => startOfDay(currentDate));
  const currentKey = format(currentDate, 'yyyy-MM-dd');
  useEffect(() => { setSelected(startOfDay(currentDate)); }, [currentKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const weekStart = startOfWeek(selected, WEEK);
  const days = useMemo(() => eachDayOfInterval({ start: weekStart, end: endOfWeek(weekStart, WEEK) }), [weekStart.getTime()]); // eslint-disable-line react-hooks/exhaustive-deps
  const totals = days.map(day => getSpendingsForDate(day, spendings).reduce((sum, s) => sum + s.amount, 0));
  const max = Math.max(1, ...totals);
  const weekTotal = totals.reduce((a, b) => a + b, 0);
  const offset = differenceInCalendarWeeks(weekStart, today, WEEK);
  const daySpendings = getSpendingsForDate(selected, spendings);
  const dayTotal = daySpendings.reduce((sum, s) => sum + s.amount, 0);
  const selectedLabel = dayLabel(selected, today);

  const { toast, show: showToast, hide: hideToast } = useToast();
  const [alert, setAlert] = useState<{ title: string; message?: string; buttons: AlertButton[] } | null>(null);

  // ----- quick entry (direction A) -----
  const qe = useQuickEntry(format(selected, 'yyyy-MM-dd'));
  const [pulse, setPulse] = useState(false);
  useUnsavedChanges(qe.dirty);

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
          <div className="m-sub">{format(weekStart, 'd MMM')} – {format(endOfWeek(weekStart, WEEK), 'd MMM')} · {fmtVND(weekTotal)}</div>
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
                className={`${isSameDay(day, selected) ? 'is-sel' : ''}${isSameDay(day, today) ? ' is-today' : ''}${isAfter(day, today) ? ' is-future' : ''}`}
                style={{ height: `${totals[i] ? Math.max(10, (100 * totals[i]) / max) : 10}%` }}
                aria-label={`${format(day, 'EEE d MMM')}, ${fmtVND(totals[i])}`}
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
          <b>{fmtVND(dayTotal)}</b>
        </div>
        {daySpendings.length === 0 ? (
          <p className="m-empty">No expenses yet.</p>
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
        {!keypadOpen && (
          <button type="button" className="m-btn m-btn-ghost" onClick={() => setKeypadOpen(true)}>+ Add expense</button>
        )}
      </div>

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
      {alert && <MobileAlert title={alert.title} message={alert.message} buttons={alert.buttons} onDismiss={() => setAlert(null)} />}
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
