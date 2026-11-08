'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFinance } from '../../contexts/FinanceContext';
import { useSettings } from '../../contexts/SettingsContext';
import { errorMessage } from '../../services/auth';
import {
  createQuickEntry, entryAmount, entryFromSpending, formatVnd, isoDate, nextQuickEntry, nowStamp, prepareEntries, prepareEntry, pressKey, saveEntries,
} from '../../lib/quickEntry';
import type { IncomeEntry, PreparedEntry, QuickEntry, RepeatDraft } from '../../lib/quickEntry';
import type { Spending } from '../../types';

export type QuickPanel = 'date' | 'time' | 'note' | 'repeat' | 'queue' | 'freq' | 'start' | 'end' | 'name';
export interface QueuedEntry { key: number; entry: QuickEntry }
export interface SaveResult { message: string; undo?: () => Promise<void> }

function weekday(date: string) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d).getDay();
}

/**
 * State and actions for quick entry (direction A), shared by the phone dock and the web dialog.
 * `date` is the day the entry is for until the person picks another one.
 */
export function useQuickEntry(date: string) {
  const { settings } = useSettings();
  const { createSpending, createPlan, createIncome, updateSpending, deleteSpending } = useFinance();
  // Every category, archived ones included, so an old spending still validates and shows its look.
  const categories = settings.categories;
  // What new entries can use.
  const active = useMemo(() => categories.filter(c => !c.archived), [categories]);
  const [entry, setEntry] = useState<QuickEntry>(() => createQuickEntry(active, date));
  const [queue, setQueue] = useState<QueuedEntry[]>([]);
  const [editing, setEditing] = useState<{ spending: Spending; snapshot: string } | null>(null);
  const [panel, setPanel] = useState<QuickPanel | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shake, setShake] = useState(0);
  const [dateTouched, setDateTouched] = useState(false);
  const nextKey = useRef(0);
  const saving = useRef(false);

  // Follow the day chosen outside (the Week strip) until the person picks a date here.
  useEffect(() => {
    if (editing || dateTouched) return;
    setEntry(current => current.date === date ? current : {
      ...current,
      date,
      income: { ...current.income, startDate: date },
      repeat: current.repeat.on ? current.repeat : { ...current.repeat, daysOfWeek: [weekday(date)] },
    });
  }, [date, editing, dateTouched]);

  // Categories arrive after settings load and can be archived in Profile. Editing keeps the spending's own category.
  useEffect(() => {
    setEntry(current => active.some(c => c.id === current.category) || editing ? current : { ...current, category: active[0]?.id ?? '' });
  }, [active, editing]);
  // The picker lists active categories, plus an archived one while editing a spending that uses it.
  const pickable = useMemo(() => {
    const own = categories.find(c => c.id === entry.category);
    return own?.archived ? [...active, own] : active;
  }, [categories, active, entry.category]);

  const amount = entryAmount(entry);
  const dirty = editing ? JSON.stringify(entry) !== editing.snapshot : amount > 0 || queue.length > 0;

  const update = useCallback((change: (current: QuickEntry) => QuickEntry) => {
    setError(null);
    setEntry(change);
  }, []);

  const press = useCallback((key: string) => update(current => ({ ...current, amount: pressKey(current.amount, key) })), [update]);
  const patch = useCallback((fields: Partial<QuickEntry>) => {
    if (fields.date !== undefined) setDateTouched(true);
    update(current => ({ ...current, ...fields }));
  }, [update]);
  const patchRepeat = useCallback((fields: Partial<RepeatDraft>) => update(current => ({ ...current, repeat: { ...current.repeat, ...fields } })), [update]);
  const patchIncome = useCallback((fields: Partial<IncomeEntry>) => {
    if (fields.startDate !== undefined) setDateTouched(true);
    update(current => ({ ...current, income: { ...current.income, ...fields } }));
  }, [update]);
  /** Spending or Income. */
  const setMode = useCallback((mode: QuickEntry['mode']) => {
    setPanel(null);
    update(current => ({ ...current, mode }));
  }, [update]);
  const togglePanel = useCallback((next: QuickPanel | null) => setPanel(current => (next === null || current === next ? null : next)), []);

  const fail = useCallback((cause: unknown) => {
    setError(errorMessage(cause));
    setShake(count => count + 1);
  }, []);

  const queueCurrent = useCallback(() => {
    if (editing) return false;
    try {
      prepareEntry(entry, categories);
    } catch (cause) {
      fail(cause);
      return false;
    }
    setQueue(current => [...current, { key: nextKey.current++, entry }]);
    setEntry(nextQuickEntry(entry));
    setPanel(null);
    setError(null);
    return true;
  }, [editing, entry, categories, fail]);

  const editQueued = useCallback((key: number) => {
    const item = queue.find(q => q.key === key);
    if (!item) return;
    setQueue(current => {
      const rest = current.filter(q => q.key !== key);
      return entryAmount(entry) > 0 ? [...rest, { key: nextKey.current++, entry }] : rest;
    });
    setEntry(item.entry);
    setPanel(null);
    setError(null);
  }, [queue, entry]);

  const removeQueued = useCallback((key: number) => {
    setQueue(current => current.filter(q => q.key !== key));
    setError(null);
  }, []);

  const reset = useCallback(() => {
    setEditing(null);
    setQueue([]);
    setPanel(null);
    setError(null);
    setDateTouched(false);
    setEntry(createQuickEntry(active, date));
  }, [active, date]);

  const loadExpense = useCallback((spending: Spending) => {
    const loaded = entryFromSpending(spending, active);
    setEditing({ spending, snapshot: JSON.stringify(loaded) });
    setQueue([]);
    setPanel(null);
    setError(null);
    setEntry(loaded);
  }, [active]);

  /** Saves the edit, or every queued entry plus the current one. Returns null when nothing was saved. */
  const save = useCallback(async (): Promise<SaveResult | null> => {
    if (saving.current) return null;
    setError(null);

    if (editing) {
      let prepared: PreparedEntry;
      try {
        prepared = prepareEntry({ ...entry, mode: 'spending', repeat: { ...entry.repeat, on: false } }, categories, new Date(), true);
      } catch (cause) { fail(cause); return null; }
      saving.current = true;
      setBusy(true);
      try {
        if (prepared.kind !== 'spending') return null;
        await updateSpending(editing.spending.id, prepared.input);
        setEditing(null);
        setDateTouched(false);
        setEntry(createQuickEntry(active, date));
        return { message: `Saved ${prepared.input.description} · ${formatVnd(prepared.input.amount)}` };
      } catch (cause) { fail(cause); return null; } finally { saving.current = false; setBusy(false); }
    }

    const items: QueuedEntry[] = [...queue, ...(amount > 0 || queue.length === 0 ? [{ key: nextKey.current++, entry }] : [])];
    let prepared: PreparedEntry[];
    try {
      prepared = prepareEntries(items.map(item => item.entry), categories);
    } catch (cause) { fail(cause); return null; }

    saving.current = true;
    setBusy(true);
    const created: Spending[] = [];
    try {
      const result = await saveEntries(items.map((item, i) => ({ ...item, prepared: prepared[i] })), {
        spending: async input => { created.push(await createSpending(input)); },
        plan: input => createPlan(input),
        income: input => createIncome(input),
      });
      if (result.remaining.length > 0) {
        setQueue(result.remaining.map(({ key, entry: e }) => ({ key, entry: e })));
        setEntry(nextQuickEntry(entry));
        fail(new Error(`${result.saved.length} saved; ${result.remaining.length} still pending. ${errorMessage(result.error)} Only pending entries are sent on retry.`));
        return null;
      }
      setQueue([]);
      setPanel(null);
      setEntry(nextQuickEntry(entry));
      const spent = prepared.reduce((sum, p) => sum + (p.kind === 'income' ? 0 : p.input.amount), 0);
      const first = prepared[0];
      if (prepared.length > 1) return { message: `Saved ${prepared.length} entries${spent ? ` · ${formatVnd(spent)} spent` : ''}` };
      if (first.kind === 'income') return { message: `Income added · +${formatVnd(first.input.amount)} ${first.input.source}` };
      if (first.kind === 'plan') return { message: `Planned ${first.input.description} · ${first.input.sure ? '' : '~'}${formatVnd(first.input.amount)}. It becomes real when its time passes.` };
      const saved = created[0];
      return {
        message: `Added ${formatVnd(first.input.amount)} · ${first.input.description}`,
        undo: saved ? () => deleteSpending(saved.id) : undefined,
      };
    } catch (cause) { fail(cause); return null; } finally { saving.current = false; setBusy(false); }
  }, [editing, entry, queue, amount, categories, active, date, fail, updateSpending, createSpending, createPlan, createIncome, deleteSpending]);

  const removeEditing = useCallback(async (): Promise<SaveResult | null> => {
    if (!editing || saving.current) return null;
    const { spending } = editing;
    saving.current = true;
    setBusy(true);
    try {
      await deleteSpending(spending.id);
      setEditing(null);
      setDateTouched(false);
      setEntry(createQuickEntry(active, date));
      const { amount: a, description, category, date: d, time } = spending;
      return {
        message: `Deleted ${spending.description} · ${formatVnd(spending.amount)}`,
        undo: async () => { await createSpending({ amount: a, description, category, date: d, time }); },
      };
    } catch (cause) { fail(cause); return null; } finally { saving.current = false; setBusy(false); }
  }, [editing, active, date, deleteSpending, createSpending, fail]);

  const queueTotal = useMemo(() => queue.reduce((sum, q) => sum + (q.entry.mode === 'income' ? 0 : entryAmount(q.entry)), 0), [queue]);

  return {
    entry, queue, queueTotal, editing: editing?.spending ?? null, panel, busy, error, shake, amount, dirty, categories, pickable,
    press, patch, patchRepeat, patchIncome, setMode, togglePanel, queueCurrent, editQueued, removeQueued,
    reset, loadExpense, save, removeEditing, setError,
  };
}

export type QuickEntryController = ReturnType<typeof useQuickEntry>;
