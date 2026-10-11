import { useCallback, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { format, parseISO } from 'date-fns';
import { X } from 'lucide-react';
import { useUnsavedChanges } from '../useUnsavedChanges';
import { MonthlyIncomeEntries } from './MonthlyIncomeEntries';
import type { IncomeEditorState } from './MonthlyIncomeEntries';
import './UserProfile.css';
import './MonthlyIncomeModal.css';

export interface MonthlyIncomeModalProps {
  month: string;
  onClose: () => void;
}

// Mount only while open so each opening captures its displayed month and trigger.
export function MonthlyIncomeModal({ month, onClose }: MonthlyIncomeModalProps) {
  const [initial] = useState(() => ({ month, trigger: document.activeElement }));
  const [editorState, setEditorState] = useState<IncomeEditorState>({ dirty: false, busy: false });
  const editorStateRef = useRef(editorState);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const id = useId();
  const monthLabel = format(parseISO(`${initial.month}-01`), 'MMMM yyyy');

  const onEditorStateChange = useCallback((state: IncomeEditorState) => {
    editorStateRef.current = state;
    setEditorState(state);
  }, []);

  useUnsavedChanges(editorState.dirty || editorState.busy);

  useLayoutEffect(() => {
    const dialog = dialogRef.current!;
    dialog.showModal();
    dialog.querySelector<HTMLInputElement>('input[inputmode="decimal"]')?.focus({ preventScroll: true });
    return () => {
      if (dialog.open) dialog.close();
      // Native close restores focus; provide a fallback for a surviving trigger.
      if (initial.trigger instanceof HTMLElement && initial.trigger.isConnected && document.activeElement !== initial.trigger) {
        initial.trigger.focus({ preventScroll: true });
      }
    };
  }, [initial]);

  const requestClose = () => {
    const { dirty, busy } = editorStateRef.current;
    if (busy) return;
    if (dirty && !window.confirm('Discard unsaved additional income changes?')) return;
    onClose();
  };

  return createPortal(
    <dialog
      ref={dialogRef}
      className="monthly-income-modal"
      aria-labelledby={`${id}-title`}
      aria-busy={editorState.busy}
      onCancel={event => { event.preventDefault(); requestClose(); }}
    >
      <div className="monthly-income-modal-header">
        <h2 id={`${id}-title`}>Income for {monthLabel}</h2>
        <button type="button" className="monthly-income-modal-close" aria-label="Close income dialog" disabled={editorState.busy} onClick={requestClose}>
          <X size={20} aria-hidden="true" />
        </button>
      </div>
      <div className="user-profile monthly-income-modal-content">
        <MonthlyIncomeEntries
          disabled={false}
          onEditorStateChange={onEditorStateChange}
          initialMonth={initial.month}
          initiallyAdding
          restrictToMonth
        />
      </div>
    </dialog>,
    document.body,
  );
}
