'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Trash2, X } from 'lucide-react';
import { MobileAlert } from '../mobile/MobileUi';
import { isoDate } from '../../lib/quickEntry';
import type { Spending } from '../../types';
import type { ExpenseDefaults } from '../../contexts/FinanceShellContext';
import {
  AmountDisplay, CategoryGrid, DatePanel, IncomeDatePanel, IncomeFrequencyPanel, IncomeNamePanel, Keypad, ModeToggle, NotePanel,
  QueueList, QuickError, RepeatPanel, SourceChips, TimePanel, saveLabelFor,
} from './QuickEntryParts';
import { useQuickEntry } from './useQuickEntry';
import { useUnsavedChanges } from '../../hooks/useUnsavedChanges';
import type { SaveResult } from './useQuickEntry';

/**
 * Web (direction A): keypad on the left, every field on the right, the queue under the keypad.
 * Mount only while open. The hardware keyboard types into the keypad when no field has focus.
 */
export function QuickEntryDialog({ expense, defaults, onClose, onSaved }: {
  expense?: Spending;
  defaults?: ExpenseDefaults;
  onClose: () => void;
  onSaved: (result: SaveResult) => void;
}) {
  const qe = useQuickEntry(defaults?.date ?? isoDate(new Date()));
  const [confirmClose, setConfirmClose] = useState(false);
  useUnsavedChanges(qe.dirty);
  const dialogRef = useRef<HTMLDivElement>(null);
  const trigger = useRef<Element | null>(null);
  const loaded = useRef(false);

  useEffect(() => {
    trigger.current = document.activeElement;
    if (expense && !loaded.current) qe.loadExpense(expense);
    else if (defaults && !loaded.current) qe.patch({ ...(defaults.amount ? { amount: defaults.amount.replace(/\D/g, '') } : {}), ...(defaults.category ? { category: defaults.category } : {}), ...(defaults.description ? { description: defaults.description } : {}) });
    loaded.current = true;
    dialogRef.current?.focus();
    return () => { if (trigger.current instanceof HTMLElement) trigger.current.focus({ preventScroll: true }); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const finish = (result: SaveResult | null) => {
    if (!result) return;
    onSaved(result);
    onClose();
  };
  const save = async () => finish(await qe.save());
  const remove = async () => finish(await qe.removeEditing());
  const requestClose = () => (qe.dirty ? setConfirmClose(true) : onClose());

  // Keyboard: digits/k/⌫ type the amount, Enter saves, ⇧Enter queues, Esc closes. Fields keep their own keys.
  useEffect(() => {
    if (confirmClose) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      const inField = Boolean(target?.closest('input, textarea, select'));
      if (event.key === 'Escape') { event.preventDefault(); if (inField) target?.blur(); else requestClose(); return; }
      if (event.key === 'Enter' && !(target instanceof HTMLButtonElement)) {
        event.preventDefault();
        if (event.shiftKey) qe.queueCurrent(); else void save();
        return;
      }
      if (inField || event.metaKey || event.ctrlKey || event.altKey) return;
      if (/^\d$/.test(event.key)) { event.preventDefault(); qe.press(event.key); }
      else if ((event.key === 'k' || event.key === 'K') && qe.amount > 0) { event.preventDefault(); qe.press('000'); }
      else if (event.key === 'Backspace') { event.preventDefault(); qe.press('del'); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // Keep Tab inside the dialog.
  const trapTab = (event: React.KeyboardEvent) => {
    if (event.key !== 'Tab' || !dialogRef.current) return;
    const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select, [tabindex]:not([tabindex="-1"])')];
    if (focusable.length === 0) return;
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };

  const { entry } = qe;
  const saveLabel = qe.editing ? 'Save changes' : saveLabelFor(qe);

  return createPortal(
    <div className="qe-layer" onMouseDown={event => { if (event.target === event.currentTarget) requestClose(); }}>
      <div ref={dialogRef} className="qe-dialog" role="dialog" aria-modal="true" aria-labelledby="qe-dialog-title" tabIndex={-1} onKeyDown={trapTab}>
        <header className="qe-d-head">
          <h2 id="qe-dialog-title">{qe.editing ? 'Edit expense' : 'Add transaction'}</h2>
          <ModeToggle qe={qe} />
          <button type="button" className="qe-fx" aria-label="Close" onClick={requestClose}><X size={18} /></button>
        </header>
        <div className="qe-d-body">
          <div className="qe-d-left">
            <AmountDisplay qe={qe} />
            <Keypad qe={qe} onSave={() => { void save(); }} onNext={qe.queueCurrent} saveLabel={qe.editing ? 'Save' : saveLabel} />
            <p className="qe-kbd">Type digits · <kbd>k</kbd> ×1000 · <kbd>⌫</kbd> · <kbd>Enter</kbd> save{qe.editing ? '' : <> · <kbd>⇧ Enter</kbd> next</>}</p>
          </div>
          <div className="qe-d-right">
            {entry.mode === 'spending' ? (
              <>
                <section className="qe-sec"><h3>Category</h3><CategoryGrid qe={qe} /></section>
                <NotePanel qe={qe} />
                <div className="qe-row2">
                  <section className="qe-sec"><DatePanel qe={qe} /></section>
                  <section className="qe-sec"><TimePanel qe={qe} /></section>
                </div>
                {!qe.editing && <section className="qe-box"><RepeatPanel qe={qe} /></section>}
              </>
            ) : (
              <>
                <section className="qe-sec"><h3>Source</h3><SourceChips qe={qe} wrap /></section>
                <IncomeNamePanel qe={qe} />
                <section className="qe-sec"><h3>How often</h3><IncomeFrequencyPanel qe={qe} /></section>
                <div className="qe-row2">
                  <IncomeDatePanel qe={qe} which="start" />
                  {entry.income.frequency !== 'once' && <IncomeDatePanel qe={qe} which="end" />}
                </div>
              </>
            )}
          </div>
        </div>
        <footer className="qe-d-foot">
          {!qe.editing && qe.queue.length > 0 && <div className="qe-d-queue"><QueueList qe={qe} /></div>}
          <QuickError qe={qe} />
          <div className="qe-d-actions">
            <button type="button" className="qe-btn is-plain" onClick={requestClose}>Cancel</button>
            {qe.editing && <button type="button" className="qe-btn is-plain is-danger" disabled={qe.busy} onClick={() => { void remove(); }}><Trash2 size={16} />Delete</button>}
            <span className="qe-sp" />
            {!qe.editing && <button type="button" className="qe-btn is-ghost" disabled={qe.busy} onClick={qe.queueCurrent}>+ Add &amp; next</button>}
            <button type="button" className={`qe-btn ${entry.mode === 'income' ? 'is-income' : 'is-primary'}`} disabled={qe.busy} onClick={() => { void save(); }}>
              {qe.busy ? 'Saving…' : saveLabel}
            </button>
          </div>
        </footer>
      </div>
      {confirmClose && (
        <MobileAlert
          title="Discard this entry?"
          message={qe.queue.length ? `${qe.queue.length} queued ${qe.queue.length === 1 ? 'entry' : 'entries'} and the current one are not saved yet.` : 'Your changes are not saved yet.'}
          buttons={[
            { label: 'Keep editing', onPress: () => setConfirmClose(false) },
            { label: 'Discard', destructive: true, onPress: () => { setConfirmClose(false); onClose(); } },
          ]}
          onDismiss={() => setConfirmClose(false)}
        />
      )}
    </div>,
    document.body,
  );
}
