'use client';

import { useState } from 'react';
import { SystemAlert } from './SystemAlert';
import { useDialog } from '../contexts/DialogContext';
import { useFinance } from '../contexts/FinanceContext';
import { errorMessage } from '../services/auth';
import type { Transaction } from '../types';

/**
 * Edits one received payment (late, short, wrong day) or deletes it. Only this row changes:
 * its income schedule and every other payday stay as they are.
 */
export function IncomeRecordSheet({ record, onClose, onDone }: {
  record: Transaction;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const { updateReceived, deleteReceived } = useFinance();
  const { confirm } = useDialog();
  const [amount, setAmount] = useState(record.amount.toLocaleString('vi-VN'));
  const [date, setDate] = useState(record.date);
  const [note, setNote] = useState(record.description);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const title = record.description || record.category;

  const run = async (action: () => Promise<void>, message: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await action();
      onDone(message);
    } catch (cause) {
      setError(errorMessage(cause));
      setBusy(false);
    }
  };

  const save = () => {
    const value = Number(amount.replace(/[\s,._]/g, ''));
    if (!Number.isFinite(value) || value <= 0 || value > 1e12) { setError('Enter an amount above 0 ₫.'); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { setError('Pick the day it was received.'); return; }
    void run(
      () => updateReceived(record.id, { amount: value, description: note.trim(), category: record.category, date, time: record.time }),
      `${title} saved. Its schedule is unchanged.`,
    );
  };

  const remove = async () => {
    const confirmed = await confirm({
      title: 'Delete this payment?',
      message: `${title} (${record.amount.toLocaleString('vi-VN')} ₫) on ${record.date} will be removed. The schedule keeps its other paydays.`,
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (confirmed) void run(() => deleteReceived(record.id), `${title} deleted.`);
  };

  return (
    <SystemAlert
      title={title}
      message={<span className="income-sheet-source">{record.category}</span>}
      vertical
      onDismiss={() => { if (!busy) onClose(); }}
      buttons={[
        { label: busy ? 'Saving…' : 'Save', primary: true, onPress: save },
        { label: 'Delete payment', destructive: true, onPress: () => { if (!busy) void remove(); } },
        { label: 'Cancel', onPress: () => { if (!busy) onClose(); } },
      ]}
    >
      <div className="income-sheet-fields">
        <label>
          <span>Amount</span>
          <input data-autofocus className="m-alert-input" inputMode="numeric" value={amount} disabled={busy}
            onChange={event => setAmount(event.target.value)}
            onKeyDown={event => { if (event.key === 'Enter') save(); }} />
        </label>
        <label>
          <span>Received on</span>
          <input className="m-alert-input" type="date" value={date} disabled={busy} onChange={event => setDate(event.target.value)} />
        </label>
        <label>
          <span>Note</span>
          <input className="m-alert-input" value={note} maxLength={1000} disabled={busy} onChange={event => setNote(event.target.value)} />
        </label>
        {error && <p className="income-sheet-error" role="alert">{error}</p>}
      </div>
    </SystemAlert>
  );
}
