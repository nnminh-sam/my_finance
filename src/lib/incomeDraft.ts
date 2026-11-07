import type { Income, IncomeInput, IncomeScheduleFrequency } from '../types';

export interface IncomeDraft {
  id?: string;
  source: string;
  name: string;
  amount: string;
  frequency: IncomeScheduleFrequency;
  startDate: string;
  endDate: string; // '' = no end date
  // Pay-schedule options. Left out of drafts that do not use them; a missing field means its default.
  interval?: 1 | 2 | 4; // weekly only
  semimonthlyDay1?: string; // semimonthly only, '' = not chosen
  semimonthlyDay2?: string;
  weekendShift?: boolean;
}

const FREQUENCIES: readonly IncomeScheduleFrequency[] = ['once', 'daily', 'weekly', 'semimonthly', 'monthly', 'yearly'];
const SHIFT_FREQUENCIES: readonly IncomeScheduleFrequency[] = ['weekly', 'semimonthly', 'monthly', 'yearly'];
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

export function isValidIncomeDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const [year, month, day] = date.split('-').map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1];
}

export function createIncomeDraft(defaultStartDate: string, income?: Income): IncomeDraft {
  if (income) {
    const draft: IncomeDraft = {
      id: income.id, source: income.source, name: income.name, amount: String(income.amount),
      frequency: income.frequency, startDate: income.startDate, endDate: income.endDate ?? '',
    };
    if (income.interval) draft.interval = income.interval;
    if (income.semimonthlyDays) {
      draft.semimonthlyDay1 = String(income.semimonthlyDays[0]);
      draft.semimonthlyDay2 = String(income.semimonthlyDays[1]);
    }
    if (income.weekendShift) draft.weekendShift = true;
    return draft;
  }
  return { source: '', name: '', amount: '', frequency: 'monthly', startDate: defaultStartDate, endDate: '' };
}

export function validateIncomeDraft(draft: IncomeDraft): IncomeInput {
  const source = draft.source.trim();
  if (!source || source.length > 100 || CONTROL.test(source)) {
    throw new Error('Enter a source of 1–100 characters, such as Salary, Freelance, or Gift.');
  }
  const name = draft.name.trim();
  if (name.length > 500 || CONTROL.test(name)) {
    throw new Error('The name must be at most 500 characters without control characters.');
  }
  const amount = Number(draft.amount);
  if (draft.amount !== draft.amount.trim() || !/^\d+(?:\.\d{1,2})?$/.test(draft.amount) || !Number.isFinite(amount) || amount <= 0 || amount > 1e12) {
    throw new Error('Enter a positive amount up to 1,000,000,000,000 with at most two decimal places.');
  }
  if (!FREQUENCIES.includes(draft.frequency)) throw new Error('Choose how often this income is paid.');
  if (!isValidIncomeDate(draft.startDate)) {
    throw new Error(draft.frequency === 'once' ? 'Choose a valid date for this income.' : 'Choose a valid start date.');
  }
  let endDate: string | null = null;
  if (draft.frequency !== 'once' && draft.endDate !== '') {
    if (!isValidIncomeDate(draft.endDate)) throw new Error('Choose a valid end date, or leave it empty for no end.');
    if (draft.endDate < draft.startDate) throw new Error('The end date cannot be before the start date.');
    endDate = draft.endDate;
  }
  const result: IncomeInput = { source, name, amount, frequency: draft.frequency, startDate: draft.startDate, endDate };
  if (draft.frequency === 'weekly' && draft.interval && draft.interval !== 1) result.interval = draft.interval;
  if (draft.frequency === 'semimonthly') {
    const first = Number(draft.semimonthlyDay1 ?? '');
    const second = Number(draft.semimonthlyDay2 ?? '');
    const valid = (day: number, text: string | undefined) => text !== undefined && /^\d{1,2}$/.test(text) && day >= 1 && day <= 31;
    if (!valid(first, draft.semimonthlyDay1) || !valid(second, draft.semimonthlyDay2)) throw new Error('Choose two paydays between 1 and 31.');
    if (first >= second) throw new Error('The first payday must be earlier in the month than the second.');
    result.semimonthlyDays = [first, second];
  }
  if (draft.weekendShift && SHIFT_FREQUENCIES.includes(draft.frequency)) result.weekendShift = true;
  return result;
}

export function isIncomeDraftDirty(draft: IncomeDraft, snapshot: IncomeDraft): boolean {
  const fields: (keyof IncomeDraft)[] = ['id', 'source', 'name', 'amount', 'frequency', 'startDate', 'endDate'];
  const options = (item: IncomeDraft) => [item.interval ?? 1, item.semimonthlyDay1 ?? '', item.semimonthlyDay2 ?? '', item.weekendShift ?? false];
  const before = options(snapshot);
  return fields.some(field => draft[field] !== snapshot[field]) || options(draft).some((value, index) => value !== before[index]);
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Plain-language schedule for the income form, or null until amount and start date are valid. */
export function describeIncomeDraft(draft: Pick<IncomeDraft, 'amount' | 'frequency' | 'startDate' | 'endDate' | 'interval' | 'semimonthlyDay1' | 'semimonthlyDay2' | 'weekendShift'>): string | null {
  const amount = Number(draft.amount);
  if (!/^\d+(?:\.\d{1,2})?$/.test(draft.amount) || !(amount > 0) || !isValidIncomeDate(draft.startDate)) return null;
  const [year, month, day] = draft.startDate.split('-').map(Number);
  const dateLabel = (y: number, m: number, d: number) => `${d} ${MONTHS[m - 1]} ${y}`;
  const value = new Date(0);
  value.setUTCFullYear(year, month - 1, day);
  const money = `${amount.toLocaleString('vi-VN', { maximumFractionDigits: 2 })} ₫`;
  const start = dateLabel(year, month, day);
  if (draft.frequency === 'once') return `${money} once, on ${WEEKDAYS[value.getUTCDay()]}, ${start}.`;

  const stride = draft.frequency === 'weekly' && draft.interval && draft.interval !== 1 ? `every ${draft.interval} weeks on ${WEEKDAYS[value.getUTCDay()]}` : null;
  const every = {
    daily: 'every day',
    weekly: stride ?? `every ${WEEKDAYS[value.getUTCDay()]}`,
    semimonthly: draft.semimonthlyDay1 && draft.semimonthlyDay2 ? `on day ${draft.semimonthlyDay1} and day ${draft.semimonthlyDay2} of every month` : 'twice a month',
    monthly: `on day ${day} of every month`,
    yearly: `every year on ${day} ${MONTHS[month - 1]}`,
  }[draft.frequency];
  const validEnd = draft.endDate !== '' && isValidIncomeDate(draft.endDate) && draft.endDate >= draft.startDate;
  const end = validEnd ? `until ${dateLabel(...(draft.endDate.split('-').map(Number) as [number, number, number]))}` : 'with no end date';
  const shortMonths = draft.frequency === 'monthly' && day > 28 ? ' In shorter months it is paid on the last day.' : '';
  const shift = draft.weekendShift && SHIFT_FREQUENCIES.includes(draft.frequency) ? ' A Saturday or Sunday payday is paid on the Friday before.' : '';
  return `${money} ${every}, from ${start}, ${end}.${shortMonths}${shift}`;
}
