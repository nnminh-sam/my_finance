// The old device-local pay cycle: one JSON blob per user in localStorage, written by an earlier
// version of the profile page. Only its payday is carried over (as an unsaved suggestion for the
// saved budget period); the blob itself is never changed or deleted.

import { DEFAULT_BUDGET_PERIOD, DEFAULT_SHOW_BY, type BudgetPeriodSetting, type ShowBy } from './periods';

export type StorageReader = Pick<Storage, 'getItem'>;
export type StorageAccess = Pick<Storage, 'getItem' | 'setItem'>;

export const legacyPaydayKey = (userId?: string) => `tracker_salary_cycle_v1_${userId || 'default'}`;
export const payCycleHintDismissedKey = (userId?: string) => `tracker_pay_cycle_hint_dismissed_v1_${userId || 'default'}`;

/** The payday day (1-28) saved on this device, or null when missing, unreadable or out of range. */
export function readLegacyPayday(storage: StorageReader | null | undefined, userId?: string): number | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(legacyPaydayKey(userId));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const day = (parsed as { salaryDay?: unknown }).salaryDay;
    return typeof day === 'number' && Number.isInteger(day) && day >= 1 && day <= 28 ? day : null;
  } catch {
    return null;
  }
}

/** True while the server settings are still the defaults, so a device payday can be offered. */
export function isDefaultPaySettings(settings: { budgetPeriod?: BudgetPeriodSetting; showBy?: ShowBy }): boolean {
  const period = settings.budgetPeriod ?? DEFAULT_BUDGET_PERIOD;
  return period.mode === DEFAULT_BUDGET_PERIOD.mode
    && period.startDay === DEFAULT_BUDGET_PERIOD.startDay
    && period.paycheckIncomeId === DEFAULT_BUDGET_PERIOD.paycheckIncomeId
    && (settings.showBy ?? DEFAULT_SHOW_BY) === DEFAULT_SHOW_BY;
}

/** The payday to suggest on the pay cycle form: only for default settings and a valid device payday. */
export function legacyPaydayPrefill(
  settings: { budgetPeriod?: BudgetPeriodSetting; showBy?: ShowBy },
  storage: StorageReader | null | undefined,
  userId?: string,
): number | null {
  return isDefaultPaySettings(settings) ? readLegacyPayday(storage, userId) : null;
}

function wasDismissed(storage: StorageReader, userId?: string): boolean {
  try {
    return storage.getItem(payCycleHintDismissedKey(userId)) !== null;
  } catch {
    return false;
  }
}

/** Calendar hint: legacy payday present, settings still default and the hint not dismissed. */
export function shouldShowPayCycleHint(
  settings: { budgetPeriod?: BudgetPeriodSetting; showBy?: ShowBy },
  userId: string | undefined,
  storage: StorageReader | null | undefined,
): boolean {
  if (!storage || !isDefaultPaySettings(settings)) return false;
  return readLegacyPayday(storage, userId) !== null && !wasDismissed(storage, userId);
}

/** Remember that the user dismissed the hint. Storage errors are ignored: the hint just stays. */
export function dismissPayCycleHint(storage: StorageAccess | null | undefined, userId?: string): void {
  try {
    storage?.setItem(payCycleHintDismissedKey(userId), '1');
  } catch {
    // Storage blocked or full: the hint stays visible, nothing else depends on the flag.
  }
}
