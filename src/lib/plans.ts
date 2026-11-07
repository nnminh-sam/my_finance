// Planned (forecast) spendings: pure schedule math shared by the server and the browser.
//
// A plan's future occurrences are never stored. They are computed for whatever range is
// needed. Once an occurrence's local date+time has passed, the server materializes it into
// a real spending (linked by planId/planDate) and advances the plan's `materializedThrough`
// watermark; anything after the watermark is a projection.

export const PLAN_FREQUENCIES = ['once', 'daily', 'weekdays', 'weekly', 'monthly'] as const;
export type PlanFrequency = typeof PLAN_FREQUENCIES[number];
export type PlanExceptionKind = 'skip' | 'override';

export interface PlanSchedule {
  startDate: string; // YYYY-MM-DD, first possible occurrence and pattern anchor
  frequency: PlanFrequency;
  interval: number; // every N days/weeks/months (ignored for once/weekdays)
  daysOfWeek: number[]; // weekly only, 0=Sun..6=Sat; empty = the start date's weekday
  endDate: string | null; // inclusive, null = forever
}

export interface PlanException {
  date: string; // YYYY-MM-DD occurrence date
  kind: PlanExceptionKind;
  amount: number | null; // override only
  description: string | null; // override only, null = keep the plan's description
}

export interface PlanLike extends PlanSchedule {
  id: string;
  amount: number;
  description: string;
  category: string;
  time: string; // HH:mm
  sure?: boolean; // commitment (fixed) vs estimate
  exceptions: PlanException[];
}

export interface PlanOccurrence {
  planId: string;
  date: string;
  time: string;
  amount: number;
  description: string;
  category: string;
  overridden: boolean;
  sure: boolean;
}

/** Hard cap on a single enumeration so a bad range can never loop for long. */
export const MAX_RANGE_DAYS = 3700;

const DAY_MS = 86_400_000;

function dayNumber(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / DAY_MS);
}

function dateOf(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  return dateOf(dayNumber(date) + days);
}

function weekday(day: number): number {
  return (new Date(day * DAY_MS).getUTCDay());
}

function mondayOf(day: number): number {
  return day - ((weekday(day) + 6) % 7);
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Whether `date` is an occurrence of the schedule (ignoring exceptions). */
export function isPlanDate(schedule: PlanSchedule, date: string): boolean {
  if (date < schedule.startDate) return false;
  if (schedule.endDate && date > schedule.endDate) return false;
  const interval = Math.max(1, schedule.interval || 1);
  const start = dayNumber(schedule.startDate);
  const day = dayNumber(date);
  switch (schedule.frequency) {
    case 'once':
      return day === start;
    case 'daily':
      return (day - start) % interval === 0;
    case 'weekdays': {
      const dow = weekday(day);
      return dow !== 0 && dow !== 6;
    }
    case 'weekly': {
      const days = schedule.daysOfWeek.length ? schedule.daysOfWeek : [weekday(start)];
      if (!days.includes(weekday(day))) return false;
      return ((mondayOf(day) - mondayOf(start)) / 7) % interval === 0;
    }
    case 'monthly': {
      const [sy, sm, sd] = schedule.startDate.split('-').map(Number);
      const [y, m, d] = date.split('-').map(Number);
      const months = (y - sy) * 12 + (m - sm);
      if (months % interval !== 0) return false;
      return d === Math.min(sd, daysInMonth(y, m));
    }
    default:
      return false;
  }
}

/** All schedule dates in [from, to] (inclusive), ignoring exceptions. */
export function planDates(schedule: PlanSchedule, from: string, to: string): string[] {
  const first = from > schedule.startDate ? from : schedule.startDate;
  const last = schedule.endDate && schedule.endDate < to ? schedule.endDate : to;
  if (first > last) return [];
  if (schedule.frequency === 'once') return first === schedule.startDate ? [schedule.startDate] : [];
  const start = dayNumber(first);
  const end = Math.min(dayNumber(last), start + MAX_RANGE_DAYS);
  const dates: string[] = [];
  for (let day = start; day <= end; day++) {
    const date = dateOf(day);
    if (isPlanDate(schedule, date)) dates.push(date);
  }
  return dates;
}

/** Occurrences in [from, to] with exceptions applied (skips removed, overrides applied). */
export function planOccurrences(plan: PlanLike, from: string, to: string): PlanOccurrence[] {
  const exceptions = new Map(plan.exceptions.map(exception => [exception.date, exception]));
  const result: PlanOccurrence[] = [];
  for (const date of planDates(plan, from, to)) {
    const exception = exceptions.get(date);
    if (exception?.kind === 'skip') continue;
    const overridden = exception?.kind === 'override';
    result.push({
      planId: plan.id,
      date,
      time: plan.time,
      amount: overridden && exception.amount !== null ? exception.amount : plan.amount,
      description: overridden && exception.description !== null ? exception.description : plan.description,
      category: plan.category,
      overridden,
      sure: plan.sure === true,
    });
  }
  return result;
}

/** Local timestamp key `YYYY-MM-DDTHH:mm`, comparable as a string. */
export function stampOf(date: string, time: string): string {
  return `${date}T${time}`;
}

/**
 * Occurrences that are due to become real: strictly after `after` (the watermark, or null
 * for "never materialized") and at or before `now`. Both are local `YYYY-MM-DDTHH:mm` stamps.
 */
export function dueOccurrences(plan: PlanLike, after: string | null, now: string): PlanOccurrence[] {
  if (after !== null && after >= now) return [];
  const from = after === null ? plan.startDate : after.slice(0, 10);
  const to = now.slice(0, 10);
  return planOccurrences(plan, from, to).filter(occurrence => {
    const stamp = stampOf(occurrence.date, occurrence.time);
    return (after === null || stamp > after) && stamp <= now;
  });
}

/**
 * Projected (not yet real) occurrences of plans in [from, to]: those after each plan's
 * watermark, minus any whose real spending is already known (`realKeys` holds
 * `${planId}|${planDate}`), so a just-materialized occurrence never shows twice.
 */
export function projectPlans(
  plans: (PlanLike & { materializedThrough: string | null })[],
  from: string,
  to: string,
  realKeys: ReadonlySet<string> = new Set(),
): PlanOccurrence[] {
  const result: PlanOccurrence[] = [];
  for (const plan of plans) {
    const watermark = plan.materializedThrough;
    const start = watermark && watermark.slice(0, 10) > from ? watermark.slice(0, 10) : from;
    for (const occurrence of planOccurrences(plan, start, to)) {
      if (watermark && stampOf(occurrence.date, occurrence.time) <= watermark) continue;
      if (realKeys.has(`${occurrence.planId}|${occurrence.date}`)) continue;
      result.push(occurrence);
    }
  }
  return result.sort((a, b) => stampOf(a.date, a.time).localeCompare(stampOf(b.date, b.time)));
}

/** Current local date/time in an IANA time zone as a `YYYY-MM-DDTHH:mm` stamp. */
export function localNowStamp(timeZone: string, at: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(at);
  const get = (type: string) => parts.find(part => part.type === type)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function describePlanSchedule(schedule: PlanSchedule): string {
  const interval = Math.max(1, schedule.interval || 1);
  switch (schedule.frequency) {
    case 'once':
      return `Once on ${schedule.startDate}`;
    case 'daily':
      return interval > 1 ? `Every ${interval} days` : 'Every day';
    case 'weekdays':
      return 'Every weekday';
    case 'weekly': {
      const days = (schedule.daysOfWeek.length ? schedule.daysOfWeek : [weekday(dayNumber(schedule.startDate))])
        .map(day => DAY_NAMES[day]).join(', ');
      return `${interval > 1 ? `Every ${interval} weeks` : 'Weekly'} · ${days}`;
    }
    case 'monthly': {
      const day = Number(schedule.startDate.slice(8, 10));
      return `${interval > 1 ? `Every ${interval} months` : 'Monthly'} on day ${day}`;
    }
    default:
      return schedule.frequency;
  }
}
