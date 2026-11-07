// The period runway: one bar that splits a period's income into spent, committed, estimated and left,
// plus where to put the labels under it. Pure, so the numbers and the label placement are testable.

export type RunwaySegmentKey = 'spent' | 'committed' | 'estimates' | 'left';

export interface RunwaySegment {
  key: RunwaySegmentKey;
  amount: number;
  start: number; // percent of the bar where the segment starts
  width: number; // percent of the bar
}

export interface RunwayInput {
  income: number;
  spent: number;
  committed: number;
  estimates: number;
  start: string; // YYYY-MM-DD, inclusive
  end: string; // YYYY-MM-DD, inclusive
  today: string; // YYYY-MM-DD
}

export interface RunwayModel {
  planned: number; // committed + estimates
  out: number; // spent + planned
  left: number; // income - out; negative when plans go over income
  /** Segments in bar order. The bar spans max(income, out), so an overspend fills it and `incomeAt` marks income. */
  segments: RunwaySegment[];
  status: 'upcoming' | 'current' | 'past';
  totalDays: number;
  day: number | null; // 1-based day of the period, current periods only
  daysLeft: number | null; // days from today to the end, today included, current periods only
  perDay: number | null; // left spread over daysLeft, only when something is left
  /** Where even spending would be by the end of today (percent of the bar). Current periods with room to spare. */
  paceAt: number | null;
  /** Where income ends (percent of the bar), only when spending and plans go over it. */
  incomeAt: number | null;
}

const DAY_MS = 86_400_000;
const dayNumber = (date: string) => {
  const [y, m, d] = date.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
};
const cents = (amount: number) => Math.round(amount * 100);

export function runwayModel(input: RunwayInput): RunwayModel {
  const income = cents(input.income), spent = cents(input.spent), committed = cents(input.committed), estimates = cents(input.estimates);
  const planned = committed + estimates, out = spent + planned, left = income - out;
  const span = Math.max(income, out);
  const pct = (amount: number) => (span > 0 ? (Math.max(0, amount) / span) * 100 : 0);

  let at = 0;
  const segments = ([
    ['spent', spent],
    ['committed', committed],
    ['estimates', estimates],
    ['left', Math.max(0, left)],
  ] as const).map(([key, amount]) => {
    const segment: RunwaySegment = { key, amount: amount / 100, start: at, width: pct(amount) };
    at += segment.width;
    return segment;
  });

  const first = dayNumber(input.start), last = dayNumber(input.end), today = dayNumber(input.today);
  const totalDays = last - first + 1;
  const status = today < first ? 'upcoming' : today > last ? 'past' : 'current';
  const day = status === 'current' ? today - first + 1 : null;
  const daysLeft = day === null ? null : totalDays - day + 1;
  const perDay = daysLeft && left > 0 ? Math.floor(left / daysLeft) / 100 : null;
  const paceAt = day !== null && income > 0 && out <= income ? pct(income * (day / totalDays)) : null;
  const incomeAt = income > 0 && out > income ? pct(income) : null;

  return { planned: planned / 100, out: out / 100, left: left / 100, segments, status, totalDays, day, daysLeft, perDay, paceAt, incomeAt };
}

/**
 * Left edges (px) for labels that should sit under their segments in one row: each label starts at its
 * segment if it can, is pushed right past the label before it, then pulled back left to stay inside the row.
 * Returns null when the labels cannot share one row at all.
 */
export function placeLabels(starts: readonly number[], widths: readonly number[], rowWidth: number, gap: number): number[] | null {
  const n = widths.length;
  if (!n) return [];
  if (widths.reduce((sum, width) => sum + width, 0) + gap * (n - 1) > rowWidth) return null;
  const left = starts.map(start => Math.max(0, start));
  for (let i = 1; i < n; i++) left[i] = Math.max(left[i], left[i - 1] + widths[i - 1] + gap);
  for (let i = n - 1; i >= 0; i--) left[i] = Math.min(left[i], (i === n - 1 ? rowWidth : left[i + 1] - gap) - widths[i]);
  return left.map(value => Math.max(0, value));
}
