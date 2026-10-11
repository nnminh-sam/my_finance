import { HttpError } from "../auth/http";
import { CATEGORY_ICONS, type Category, type FinanceSettings, type IncomeEntryInput, type SpendingInput } from "./model";

function invalid(field: string): never { throw new HttpError(400, `Invalid ${field}`); }
function object(value: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid("request body");
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some(key => !allowed.includes(key))) return invalid("request body fields");
  return record;
}
function text(value: unknown, field: string, max: number, empty = false): string {
  if (typeof value !== "string" || value.length > max || (!empty && !value.trim()) || /[\u0000-\u001f\u007f]/.test(value)) return invalid(field);
  return value;
}
function money(value: unknown, field: string, positive = false): number {
  // Validate the decimal representation, not value * 100 (which has binary rounding artifacts).
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1e12 ||
      (positive && value === 0) || !/^\d+(?:\.\d{1,2})?$/.test(String(value))) return invalid(field);
  return value;
}
function categories(value: unknown): Category[] {
  if (!Array.isArray(value) || value.length > 50) return invalid("categories");
  const ids = new Set<string>();
  return value.map(value => {
    const item = object(value, ["id", "name", "color", "icon"]);
    const id = text(item.id, "category id", 100);
    const name = text(item.name, "category name", 100);
    if (ids.has(id)) return invalid("duplicate category id");
    ids.add(id);
    if (typeof item.color !== "string" || !/^#[0-9a-f]{6}$/i.test(item.color)) return invalid("category color");
    if (typeof item.icon !== "string" || !CATEGORY_ICONS.has(item.icon)) return invalid("category icon");
    return { id, name, color: item.color, icon: item.icon };
  });
}
export function settingsPatch(value: unknown): Partial<FinanceSettings> {
  const body = object(value, ["income", "avatar", "categories"]);
  const patch: Partial<FinanceSettings> = {};
  if (Object.hasOwn(body, "income")) patch.income = money(body.income, "income");
  if (Object.hasOwn(body, "avatar")) {
    const avatar = text(body.avatar, "avatar", 2048, true);
    if (avatar !== "") {
      try {
        const url = new URL(avatar);
        if (!/^https?:\/\//i.test(avatar) || !["http:", "https:"].includes(url.protocol) || !url.hostname || url.username || url.password) return invalid("avatar");
      } catch { return invalid("avatar"); }
    }
    patch.avatar = avatar;
  }
  if (Object.hasOwn(body, "categories")) patch.categories = categories(body.categories);
  return patch;
}
export function spendingInput(value: unknown): SpendingInput {
  const body = object(value, ["amount", "description", "category", "date", "time"]);
  const amount = money(body.amount, "amount", true);
  const description = text(body.description, "description", 1000, true);
  const category = text(body.category, "category", 100);
  const date = text(body.date, "date", 10);
  const time = text(body.time, "time", 5);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return invalid("date");
  const [year, month, day] = date.split("-").map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > days[month - 1]) return invalid("date");
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) return invalid("time");
  return { amount, description, category, date, time };
}
export function incomeEntryInput(value: unknown): IncomeEntryInput {
  const body = object(value, ["month", "amount", "description"]);
  const month = text(body.month, "month", 7);
  if (!/^(?!0000)\d{4}-(?:0[1-9]|1[0-2])$/.test(month)) return invalid("month");
  const amount = money(body.amount, "amount", true);
  if (typeof body.description !== "string" || /[\u0000-\u001f\u007f-\u009f]/.test(body.description)) return invalid("description");
  const description = text(body.description.trim(), "description", 500);
  return { month, amount, description };
}
export function uuid(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) return invalid("UUID");
  return value.toLowerCase();
}
export function pagination(query: Record<string, unknown>): { limit: number; cursor?: string } {
  let limit = 500;
  if (query.limit !== undefined) {
    if (typeof query.limit !== "string" || !/^[1-9]\d{0,2}$/.test(query.limit) || Number(query.limit) > 500) return invalid("limit (1–500)");
    limit = Number(query.limit);
  }
  return { limit, cursor: query.cursor === undefined ? undefined : uuid(query.cursor) };
}
