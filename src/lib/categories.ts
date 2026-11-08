import type { CategoryData, Spending } from '../types';

/** Saved categories, archived ones included. Mirrored by the server's settings validation. */
export const MAX_CATEGORIES = 150;
export const CATEGORY_SWATCHES = ['#f43f5e', '#f97316', '#eab308', '#10b981', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899', '#64748b'] as const;
export const CATEGORY_ICON_NAMES = ['Utensils', 'Car', 'Film', 'ShoppingBag', 'Receipt', 'CircleDollarSign', 'Coffee', 'Home', 'Heart', 'Briefcase', 'Gift', 'Phone'] as const;

export type CategoryLook = Pick<CategoryData, 'color' | 'icon'>;
export type CategorySort = 'use' | 'az' | 'new';
export interface CategoryUsage { count: number; total: number }

/** Lowercase without accents, so "an trua" finds "Ăn trưa" and "di cho" finds "Đi chợ". */
export function foldText(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase().trim();
}

/** The color and icon pair fewest active categories use, preferring the least used color, then icon. */
export function nextCategoryLook(categories: readonly CategoryLook[]): CategoryLook {
  const pair = new Map<string, number>(), colors = new Map<string, number>(), icons = new Map<string, number>();
  for (const { color, icon } of categories) {
    const c = color.toLowerCase();
    pair.set(`${c}|${icon}`, (pair.get(`${c}|${icon}`) ?? 0) + 1);
    colors.set(c, (colors.get(c) ?? 0) + 1);
    icons.set(icon, (icons.get(icon) ?? 0) + 1);
  }
  let best: CategoryLook = { color: CATEGORY_SWATCHES[0], icon: CATEGORY_ICON_NAMES[0] };
  let bestScore = Infinity;
  for (const color of CATEGORY_SWATCHES) {
    for (const icon of CATEGORY_ICON_NAMES) {
      const score = (pair.get(`${color}|${icon}`) ?? 0) * 10_000 + (colors.get(color) ?? 0) * 100 + (icons.get(icon) ?? 0);
      if (score < bestScore) { best = { color, icon }; bestScore = score; }
    }
  }
  return best;
}

/** Count and total per category for spendings dated in [from, to] (YYYY-MM-DD, inclusive). */
export function categoryUsage(spendings: readonly Pick<Spending, 'category' | 'amount' | 'date'>[], from: string, to: string): Map<string, CategoryUsage> {
  const usage = new Map<string, CategoryUsage>();
  for (const spending of spendings) {
    if (spending.date < from || spending.date > to) continue;
    const current = usage.get(spending.category) ?? { count: 0, total: 0 };
    usage.set(spending.category, { count: current.count + 1, total: current.total + spending.amount });
  }
  return usage;
}

/** "Most used" (count, then total, then name), "A–Z" (Vietnamese collation) or "Newest" (last added first). */
export function sortCategories<T extends Pick<CategoryData, 'id' | 'name'>>(categories: readonly T[], sort: CategorySort, usage: ReadonlyMap<string, CategoryUsage>): T[] {
  const byName = (a: T, b: T) => a.name.localeCompare(b.name, 'vi');
  if (sort === 'az') return [...categories].sort(byName);
  if (sort === 'new') return [...categories].reverse();
  return [...categories].sort((a, b) => {
    const ua = usage.get(a.id), ub = usage.get(b.id);
    return (ub?.count ?? 0) - (ua?.count ?? 0) || (ub?.total ?? 0) - (ua?.total ?? 0) || byName(a, b);
  });
}

/** Same rules as the server: 1–100 character names, unique ignoring case, a known color and icon, at most MAX_CATEGORIES. */
export function validateCategories(categories: readonly CategoryData[]): CategoryData[] {
  const normalized = categories.map(category => ({ ...category, name: category.name.trim() }));
  if (normalized.length > MAX_CATEGORIES) throw new Error(`You can keep up to ${MAX_CATEGORIES} categories, archived ones included.`);
  const names = new Set<string>();
  for (const category of normalized) {
    if (!category.name || category.name.length > 100) throw new Error('Give the category a name of 1–100 characters.');
    const name = category.name.toLowerCase();
    if (names.has(name)) throw new Error(`Another category is already called “${category.name}”.`);
    names.add(name);
    if (!/^#[0-9a-f]{6}$/i.test(category.color) || !(CATEGORY_ICON_NAMES as readonly string[]).includes(category.icon)) {
      throw new Error('Choose a valid color and icon.');
    }
  }
  return normalized;
}

/** 25.000 → "25k", 1.250.000 → "1,3tr" (Vietnamese short form). */
export function compactVnd(amount: number): string {
  if (amount >= 1_000_000) return `${(amount / 1_000_000).toLocaleString('vi-VN', { maximumFractionDigits: 1 })}tr`;
  if (amount >= 1_000) return `${Math.round(amount / 1_000)}k`;
  return `${Math.round(amount)}`;
}
