import type { Spending } from '../types';

/** U+2212, a real minus sign: it lines up with "+" and avoids the double tilde that "~-" makes in Inter. */
export const MINUS = '−';

export type DayKind = 'spent' | 'received' | 'planned';
/** How an amount is drawn: `plan` forecast grey, `in` money in (jade), `over` amber, `out` plain, `zero` muted. */
export type DayTone = 'plan' | 'in' | 'over' | 'out' | 'zero';

export interface DayParts {
  /** Actual spendings. */
  spent: number;
  /** Income already received. */
  received: number;
  /** Planned spendings that have not happened yet. */
  planned: number;
  /** Income expected (a payday still to come). */
  expected: number;
}

export interface DayNet extends DayParts {
  /** received + expected − spent − planned. */
  net: number;
  /** Something real happened: a spending or received income. */
  hasActual: boolean;
  /** Something is only planned or expected. */
  hasPlan: boolean;
  hasItems: boolean;
}

/** The day's one number: money in (received and expected) minus money out (spent and planned). */
export function dayNet({ spent, received, planned, expected }: DayParts): DayNet {
  const hasActual = spent > 0 || received > 0;
  const hasPlan = planned > 0 || expected > 0;
  return {
    spent, received, planned, expected,
    net: received + expected - spent - planned,
    hasActual,
    hasPlan,
    hasItems: hasActual || hasPlan,
  };
}

/**
 * Planned only reads grey; money in reads jade; an over-budget day reads amber; otherwise plain.
 * A net of exactly 0 is `zero` (muted), so the panel can dim it.
 */
export function dayTone(day: DayNet, over: boolean): DayTone {
  if (!day.hasActual && day.hasPlan) return 'plan';
  if (day.net > 0) return 'in';
  if (over) return 'over';
  if (day.net === 0) return 'zero';
  return 'out';
}

const whole = (amount: number) => Math.abs(Math.round(amount)).toLocaleString('vi-VN');
const signOf = (amount: number) => (Math.round(amount) > 0 ? '+' : Math.round(amount) < 0 ? MINUS : '');

/** 1500000 → "+1.500.000", -85000 → "−85.000", 0 → "0". No currency sign. */
export const formatSigned = (amount: number): string => `${signOf(amount)}${whole(amount)}`;

/** The unsigned short form for narrow cells: 1500000 → "1,5tr", 25000000 → "25tr", 85000 → "85k". */
export function shortAmount(amount: number): string {
  const abs = Math.abs(amount);
  const thousands = Math.round(abs / 1e3);
  if (abs >= 1e6 || thousands >= 1000) return `${(Math.round(abs / 1e5) / 10).toLocaleString('vi-VN')}tr`;
  if (abs >= 1e3) return `${thousands.toLocaleString('vi-VN')}k`;
  return Math.round(abs).toLocaleString('vi-VN');
}

/** 1500000 → "+1,5tr", -85000 → "−85k". */
export const formatSignedShort = (amount: number): string =>
  `${signOf(amount)}${shortAmount(amount)}`;

/** One line of a day: a spending, a received payment, or something planned or expected. */
export interface DayItem {
  key: string;
  kind: DayKind;
  /** Money in (received or an expected payday) rather than out. */
  income: boolean;
  /** Always positive; `income` gives the direction. */
  amount: number;
  label: string;
  /** Planned items are drawn quieter. */
  expected?: boolean;
  /** Set on a real spending, so a click can open it for editing. */
  spending?: Spending;
}

export interface DayItemSources {
  spendings: readonly Spending[];
  received: readonly { id: string; amount: number; description: string; category: string }[];
  expected: readonly { incomeId: string; amount: number; name: string; source: string; date: string }[];
  planned: readonly { planId: string; amount: number; description: string; category: string }[];
  categoryName: (id: string) => string;
}

/** A day's items in list order: received, spent (by time), then planned. */
export function buildDayItems({ spendings, received, expected, planned, categoryName }: DayItemSources): DayItem[] {
  return [
    ...received.map((record): DayItem => ({
      key: `in-${record.id}`, kind: 'received', income: true, amount: record.amount,
      label: record.description || record.category,
    })),
    ...[...spendings].sort((a, b) => a.time.localeCompare(b.time)).map((spending): DayItem => ({
      key: `out-${spending.id}`, kind: 'spent', income: false, amount: spending.amount,
      label: spending.description || categoryName(spending.category), spending,
    })),
    ...expected.map((payday): DayItem => ({
      key: `exp-${payday.incomeId}-${payday.date}`, kind: 'planned', income: true, amount: payday.amount,
      label: payday.name || payday.source, expected: true,
    })),
    ...planned.map((item): DayItem => ({
      key: `plan-${item.planId}`, kind: 'planned', income: false, amount: item.amount,
      label: item.description || categoryName(item.category),
    })),
  ];
}

/** The four sums of a day, from its items. */
export function partsOf(items: readonly DayItem[]): DayParts {
  const parts: DayParts = { spent: 0, received: 0, planned: 0, expected: 0 };
  for (const item of items) {
    if (item.kind === 'spent') parts.spent += item.amount;
    else if (item.kind === 'received') parts.received += item.amount;
    else if (item.income) parts.expected += item.amount;
    else parts.planned += item.amount;
  }
  return parts;
}

export const KIND_LABEL: Record<DayKind, string> = { spent: 'Spent', received: 'Received', planned: 'Planned' };

export interface DayTile {
  kind: DayKind;
  label: string;
  /** Signed: spent is negative, received positive, planned is expected − planned. */
  amount: number;
  count: number;
  tone: DayTone;
}

/** One tile per kind present, in the order spent, received, planned. Only a day that mixes kinds gets tiles. */
export function dayTiles(items: readonly DayItem[], over: boolean): DayTile[] {
  const parts = partsOf(items);
  const count = (kind: DayKind) => items.filter(item => item.kind === kind).length;
  const tiles: DayTile[] = [
    { kind: 'spent' as const, label: KIND_LABEL.spent, amount: -parts.spent, count: count('spent'), tone: over ? 'over' as const : 'out' as const },
    { kind: 'received' as const, label: KIND_LABEL.received, amount: parts.received, count: count('received'), tone: 'in' as const },
    { kind: 'planned' as const, label: KIND_LABEL.planned, amount: parts.expected - parts.planned, count: count('planned'), tone: 'plan' as const },
  ].filter(tile => tile.count > 0);
  return tiles.length >= 2 ? tiles : [];
}

/** "3 transactions", "1 transaction", or "" for an empty day. */
export const transactionCount = (count: number): string =>
  count === 0 ? '' : `${count} transaction${count === 1 ? '' : 's'}`;
