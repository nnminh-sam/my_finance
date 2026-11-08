import assert from "node:assert/strict";
import test from "node:test";
import { CATEGORY_ICON_NAMES, CATEGORY_SWATCHES, MAX_CATEGORIES, categoryUsage, compactVnd, foldText, nextCategoryLook, sortCategories, validateCategories } from "../src/lib/categories";

test("foldText ignores case and Vietnamese accents", () => {
  assert.equal(foldText("  Ăn Trưa "), "an trua");
  assert.equal(foldText("Đi chợ"), "di cho");
  assert.equal(foldText("Hiếu hỷ"), "hieu hy");
});

test("nextCategoryLook picks an unused pair, preferring the least used color and icon", () => {
  assert.deepEqual(nextCategoryLook([]), { color: CATEGORY_SWATCHES[0], icon: CATEGORY_ICON_NAMES[0] });
  const look = nextCategoryLook([{ color: CATEGORY_SWATCHES[0], icon: "Utensils" }, { color: CATEGORY_SWATCHES[1], icon: "Car" }]);
  assert.notEqual(look.color, CATEGORY_SWATCHES[0]);
  assert.notEqual(look.color, CATEGORY_SWATCHES[1]);
  assert.ok(!["Utensils", "Car"].includes(look.icon));
  // With every pair taken once, it still returns a valid pair.
  const all = CATEGORY_SWATCHES.flatMap(color => CATEGORY_ICON_NAMES.map(icon => ({ color, icon })));
  const full = nextCategoryLook(all);
  assert.ok((CATEGORY_SWATCHES as readonly string[]).includes(full.color));
});

test("categoryUsage counts spendings in the inclusive range only", () => {
  const usage = categoryUsage([
    { category: "a", amount: 10, date: "2026-10-10" },
    { category: "a", amount: 5, date: "2026-11-08" },
    { category: "b", amount: 7, date: "2026-10-09" },
  ], "2026-10-10", "2026-11-08");
  assert.deepEqual(usage.get("a"), { count: 2, total: 15 });
  assert.equal(usage.get("b"), undefined);
});

test("sortCategories by use, name or newest", () => {
  const list = [{ id: "1", name: "Lunch" }, { id: "2", name: "Ăn trưa" }, { id: "3", name: "Coffee" }];
  const usage = new Map([["3", { count: 5, total: 1 }], ["1", { count: 5, total: 9 }]]);
  assert.deepEqual(sortCategories(list, "use", usage).map(item => item.id), ["1", "3", "2"]);
  assert.deepEqual(sortCategories(list, "az", usage).map(item => item.name), ["Ăn trưa", "Coffee", "Lunch"]);
  assert.deepEqual(sortCategories(list, "new", usage).map(item => item.id), ["3", "2", "1"]);
});

test("validateCategories trims, rejects duplicates and caps the list", () => {
  const base = { color: "#10b981", icon: "Utensils" };
  assert.deepEqual(validateCategories([{ id: "a", name: " Lunch ", ...base }]), [{ id: "a", name: "Lunch", ...base }]);
  assert.throws(() => validateCategories([{ id: "a", name: "Lunch", ...base }, { id: "b", name: "lunch", archived: true, ...base }]), /already called/);
  assert.throws(() => validateCategories([{ id: "a", name: "X", color: "#10b981", icon: "Rocket" }]), /valid color and icon/);
  const many = Array.from({ length: MAX_CATEGORIES + 1 }, (_, index) => ({ id: `${index}`, name: `C${index}`, ...base }));
  assert.throws(() => validateCategories(many), /up to/);
  assert.equal(validateCategories(many.slice(0, MAX_CATEGORIES)).length, MAX_CATEGORIES);
});

test("compactVnd shortens amounts the Vietnamese way", () => {
  assert.equal(compactVnd(25_000), "25k");
  assert.equal(compactVnd(1_250_000), "1,3tr");
  assert.equal(compactVnd(800), "800");
});
