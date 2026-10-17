import type { RepeatFrequency, RepeatRuleInput } from "./model";

export function parseDateUtc(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function formatDateUtc(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function addDaysUtc(date: Date, days: number): Date {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

export function daysBetweenUtc(fromStr: string, toStr: string): number {
  const from = parseDateUtc(fromStr);
  const to = parseDateUtc(toStr);
  return Math.round((to.getTime() - from.getTime()) / 86400000);
}

function daysInMonthUtc(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

export interface RecurrenceState {
  startDate: string;
  frequency: RepeatFrequency;
  interval?: number;
  daysOfWeek?: number[];
  endType: "unlimited" | "occurrences" | "until_date";
  totalOccurrences?: number;
  endDate?: string;
  occurrencesCreated: number;
  lastGeneratedDate: string | null;
}

export interface GeneratedBatch {
  dates: string[];
  newLastGeneratedDate: string | null;
  newOccurrencesCreated: number;
  isComplete: boolean;
}

export function isRuleDueForSync(rule: RecurrenceState, asOfDate: string): boolean {
  if (rule.endType === "occurrences" && rule.occurrencesCreated >= (rule.totalOccurrences ?? 100)) {
    return false;
  }
  if (rule.endType === "until_date" && rule.lastGeneratedDate !== null && rule.endDate && rule.lastGeneratedDate >= rule.endDate) {
    return false;
  }
  if (rule.lastGeneratedDate === null) {
    return true;
  }
  // If the last generated date is within 14 days of asOfDate (or in the past), it is near the repeat time.
  const diffDays = daysBetweenUtc(asOfDate, rule.lastGeneratedDate);
  return diffDays <= 14;
}

export function generateOccurrences(rule: RecurrenceState, maxBatch = 100): GeneratedBatch {
  const cap = Math.max(1, Math.min(maxBatch, 100));
  let remainingCap = cap;

  if (rule.endType === "occurrences") {
    const totalAllowed = Math.min(100, rule.totalOccurrences ?? 100);
    const left = totalAllowed - rule.occurrencesCreated;
    if (left <= 0) {
      return {
        dates: [],
        newLastGeneratedDate: rule.lastGeneratedDate,
        newOccurrencesCreated: rule.occurrencesCreated,
        isComplete: true,
      };
    }
    remainingCap = Math.min(remainingCap, left);
  }

  const interval = Math.max(1, rule.interval ?? 1);
  const dates: string[] = [];
  const startUtc = parseDateUtc(rule.startDate);
  const lastUtc = rule.lastGeneratedDate ? parseDateUtc(rule.lastGeneratedDate) : null;
  const endUtc = rule.endType === "until_date" && rule.endDate ? parseDateUtc(rule.endDate) : null;

  if (rule.frequency === "daily") {
    let curr = lastUtc ? addDaysUtc(lastUtc, interval) : startUtc;
    while (dates.length < remainingCap) {
      if (endUtc && curr.getTime() > endUtc.getTime()) break;
      dates.push(formatDateUtc(curr));
      curr = addDaysUtc(curr, interval);
    }
  } else if (rule.frequency === "weekdays") {
    let curr = lastUtc ? addDaysUtc(lastUtc, 1) : startUtc;
    while (dates.length < remainingCap) {
      const day = curr.getUTCDay();
      if (day !== 0 && day !== 6) {
        if (endUtc && curr.getTime() > endUtc.getTime()) break;
        dates.push(formatDateUtc(curr));
      }
      curr = addDaysUtc(curr, 1);
    }
  } else if (rule.frequency === "weekly") {
    const daysSet = new Set(
      rule.daysOfWeek && rule.daysOfWeek.length > 0
        ? rule.daysOfWeek
        : [startUtc.getUTCDay()]
    );
    // Anchor Monday to compute week offset from start date
    // Monday = 1, Sunday = 0 -> in ISO: Mon=0, Tue=1, ..., Sun=6
    const toIsoDay = (d: Date) => (d.getUTCDay() + 6) % 7;
    const startMonday = addDaysUtc(startUtc, -toIsoDay(startUtc));

    let curr = lastUtc ? addDaysUtc(lastUtc, 1) : startUtc;
    while (dates.length < remainingCap) {
      if (endUtc && curr.getTime() > endUtc.getTime()) break;
      const currMonday = addDaysUtc(curr, -toIsoDay(curr));
      const weeksDiff = Math.round((currMonday.getTime() - startMonday.getTime()) / (7 * 86400000));
      if (weeksDiff >= 0 && weeksDiff % interval === 0) {
        if (daysSet.has(curr.getUTCDay()) && curr.getTime() >= startUtc.getTime()) {
          dates.push(formatDateUtc(curr));
        }
      }
      curr = addDaysUtc(curr, 1);
    }
  } else if (rule.frequency === "monthly") {
    const startDay = startUtc.getUTCDate();
    let monthStep = 0;

    if (lastUtc) {
      // Find the next month step strictly after lastUtc
      const yearsDiff = lastUtc.getUTCFullYear() - startUtc.getUTCFullYear();
      const monthsDiff = lastUtc.getUTCMonth() - startUtc.getUTCMonth();
      const totalMonths = yearsDiff * 12 + monthsDiff;
      monthStep = Math.floor(totalMonths / interval) * interval + interval;
    }

    while (dates.length < remainingCap) {
      const targetMonthTotal = startUtc.getUTCMonth() + monthStep;
      const targetYear = startUtc.getUTCFullYear() + Math.floor(targetMonthTotal / 12);
      const targetMonth = ((targetMonthTotal % 12) + 12) % 12;
      const maxDay = daysInMonthUtc(targetYear, targetMonth);
      const day = Math.min(startDay, maxDay);
      const curr = new Date(Date.UTC(targetYear, targetMonth, day));

      if (endUtc && curr.getTime() > endUtc.getTime()) break;
      dates.push(formatDateUtc(curr));
      monthStep += interval;
    }
  }

  const newOccurrencesCreated = rule.occurrencesCreated + dates.length;
  const newLastGeneratedDate = dates.length > 0 ? dates[dates.length - 1] : rule.lastGeneratedDate;
  let isComplete = false;

  if (rule.endType === "occurrences") {
    const totalAllowed = Math.min(100, rule.totalOccurrences ?? 100);
    isComplete = newOccurrencesCreated >= totalAllowed;
  } else if (rule.endType === "until_date") {
    if (rule.endDate && newLastGeneratedDate && newLastGeneratedDate >= rule.endDate) {
      isComplete = true;
    }
  }

  return {
    dates,
    newLastGeneratedDate,
    newOccurrencesCreated,
    isComplete,
  };
}
