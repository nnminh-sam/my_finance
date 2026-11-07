// A hint for the budget period setting, based on where the user probably is.
// It only suggests; nothing is saved until the user presses Save.

import type { BudgetPeriodMode } from './periods';

const TIME_ZONE_REGIONS: Record<string, string> = {
  'Asia/Ho_Chi_Minh': 'VN',
  'Asia/Saigon': 'VN',
  'Asia/Tokyo': 'JP',
  'America/New_York': 'US',
  'America/Chicago': 'US',
  'America/Denver': 'US',
  'America/Los_Angeles': 'US',
  'America/Phoenix': 'US',
  'America/Anchorage': 'US',
  'Pacific/Honolulu': 'US',
};

const REGION_MODES: Record<string, BudgetPeriodMode> = {
  VN: 'monthly_from_day',
  JP: 'monthly_from_day',
  US: 'paycheck',
};

function localeRegion(locale: string | undefined): string | undefined {
  if (!locale) return undefined;
  try {
    return new Intl.Locale(locale).maximize().region;
  } catch {
    return undefined; // an unparsable locale falls back to the time zone
  }
}

/** `monthly_from_day` for Vietnam and Japan, `paycheck` for the United States, otherwise null. */
export function suggestBudgetMode(locale: string | undefined, timeZone: string | undefined): BudgetPeriodMode | null {
  const region = localeRegion(locale) ?? (timeZone ? TIME_ZONE_REGIONS[timeZone] : undefined);
  return region ? REGION_MODES[region] ?? null : null;
}
