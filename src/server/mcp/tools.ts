import { format } from "date-fns";
import { HttpError } from "../auth/http";
import type { User } from "../auth/store";
import { CATEGORY_ICONS, INCOME_FREQUENCIES, type Category } from "../finance/model";
import type { FinanceStore } from "../finance/store";
import { incomeInput, repeatRuleInput, settingsPatch, spendingInput, uuid } from "../finance/validation";
import {
  buildDateRangeSummary,
  buildMonthlyAnalyticsReport,
  buildSalaryCycleReport,
  enrichIncome,
  enrichRepeatRule,
  fetchAllIncomes,
  fetchAllSpendings,
} from "./data";
import { JsonRpcErrorCode, McpError, type McpToolCallResult, type McpToolDefinition } from "./protocol";
import { getMonthIncome } from "../../lib/income";
import { monthlyRepeatCost } from "../../lib/repeatRules";

export const MCP_TOOLS: McpToolDefinition[] = [
  {
    name: "get_profile_and_settings",
    description: "Get the authenticated user's profile and financial settings, including all configured spending categories (id, name, color, icon) and avatar.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    annotations: {
      title: "Get Profile & Settings",
      readOnlyHint: true,
    },
  },
  {
    name: "upsert_category",
    description: "Create a new spending category or update an existing category by ID without overwriting other categories.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Unique category identifier (1–100 chars, e.g. 'Groceries' or 'Food'). Defaults to `name` if omitted.",
        },
        name: {
          type: "string",
          description: "Display name of the category (1–100 chars).",
        },
        color: {
          type: "string",
          description: "Hex color code in #RRGGBB format (e.g. '#10b981'). Defaults to '#10b981'.",
        },
        icon: {
          type: "string",
          enum: [...CATEGORY_ICONS],
          description: "Lucide icon name for the category.",
        },
      },
      required: ["name"],
      additionalProperties: false,
    },
    annotations: {
      title: "Create or Update Category",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  {
    name: "delete_category",
    description: "Remove a spending category from settings by ID. Past spendings keep their historical category string.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Category ID to remove.",
        },
      },
      required: ["id"],
      additionalProperties: false,
    },
    annotations: {
      title: "Delete Category",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
    },
  },
  {
    name: "update_settings",
    description: "Update finance settings (replace full category list and/or avatar URL).",
    inputSchema: {
      type: "object",
      properties: {
        avatar: {
          type: "string",
          description: "HTTP/HTTPS URL for the user's avatar, or empty string to clear.",
        },
        categories: {
          type: "array",
          description: "Complete replacement array of categories (up to 50).",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              name: { type: "string" },
              color: { type: "string", description: "#RRGGBB hex color" },
              icon: { type: "string", enum: [...CATEGORY_ICONS] },
            },
            required: ["id", "name", "color", "icon"],
          },
        },
      },
      additionalProperties: false,
    },
    annotations: {
      title: "Update Settings",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  {
    name: "list_spendings",
    description: "Query and filter spending transactions by date range, category, search text, or amount range.",
    inputSchema: {
      type: "object",
      properties: {
        startDate: {
          type: "string",
          description: "Optional inclusive start date in YYYY-MM-DD format.",
        },
        endDate: {
          type: "string",
          description: "Optional inclusive end date in YYYY-MM-DD format.",
        },
        category: {
          type: "string",
          description: "Optional category ID filter (exact match).",
        },
        search: {
          type: "string",
          description: "Optional case-insensitive substring filter on transaction description.",
        },
        minAmount: {
          type: "number",
          description: "Optional minimum spending amount (inclusive).",
        },
        maxAmount: {
          type: "number",
          description: "Optional maximum spending amount (inclusive).",
        },
        limit: {
          type: "number",
          description: "Maximum number of transactions to return (1–500, default 100).",
        },
      },
      additionalProperties: false,
    },
    annotations: {
      title: "List Spendings",
      readOnlyHint: true,
    },
  },
  {
    name: "create_spending",
    description: "Record a new spending transaction. The `category` must exist in the user's configured categories.",
    inputSchema: {
      type: "object",
      properties: {
        amount: {
          type: "number",
          description: "Positive transaction amount (up to 1,000,000,000,000, max 2 decimal places).",
        },
        description: {
          type: "string",
          description: "Description or merchant note (up to 1,000 characters).",
        },
        category: {
          type: "string",
          description: "Category ID from user settings (e.g. 'Food', 'Transport', 'Shopping', 'Bills', 'Entertainment', 'Other').",
        },
        date: {
          type: "string",
          description: "Transaction date in YYYY-MM-DD format (defaults to today if omitted).",
        },
        time: {
          type: "string",
          description: "Transaction time in 24-hour HH:mm format (defaults to current time or '12:00' if omitted).",
        },
      },
      required: ["amount", "description", "category"],
      additionalProperties: false,
    },
    annotations: {
      title: "Create Spending",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
    },
  },
  {
    name: "batch_create_spendings",
    description: "Create multiple spending transactions in a single request (up to 50 items). Ideal for logging receipts, bank statements, or multi-item expenses.",
    inputSchema: {
      type: "object",
      properties: {
        spendings: {
          type: "array",
          description: "List of spending transactions to create (1–50 items).",
          items: {
            type: "object",
            properties: {
              amount: { type: "number" },
              description: { type: "string" },
              category: { type: "string" },
              date: { type: "string", description: "YYYY-MM-DD" },
              time: { type: "string", description: "HH:mm" },
            },
            required: ["amount", "description", "category"],
          },
        },
      },
      required: ["spendings"],
      additionalProperties: false,
    },
    annotations: {
      title: "Batch Create Spendings",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
    },
  },
  {
    name: "update_spending",
    description: "Update an existing spending transaction by its UUID.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "UUID of the spending transaction to update.",
        },
        amount: {
          type: "number",
          description: "Updated positive amount.",
        },
        description: {
          type: "string",
          description: "Updated description.",
        },
        category: {
          type: "string",
          description: "Updated category ID (must exist in user settings).",
        },
        date: {
          type: "string",
          description: "Updated date in YYYY-MM-DD format.",
        },
        time: {
          type: "string",
          description: "Updated time in HH:mm format.",
        },
      },
      required: ["id", "amount", "description", "category", "date", "time"],
      additionalProperties: false,
    },
    annotations: {
      title: "Update Spending",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  {
    name: "delete_spending",
    description: "Delete a spending transaction by its UUID.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "UUID of the spending transaction to delete.",
        },
      },
      required: ["id"],
      additionalProperties: false,
    },
    annotations: {
      title: "Delete Spending",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
    },
  },
  {
    name: "list_incomes",
    description: "List all income sources for the user, optionally calculating income totals and payment occurrences for a target month (YYYY-MM).",
    inputSchema: {
      type: "object",
      properties: {
        month: {
          type: "string",
          description: "Optional month in YYYY-MM format (defaults to current month) to compute monthly income breakdown.",
        },
      },
      additionalProperties: false,
    },
    annotations: {
      title: "List Incomes",
      readOnlyHint: true,
    },
  },
  {
    name: "create_income",
    description: "Create a new recurring or one-time income source.",
    inputSchema: {
      type: "object",
      properties: {
        source: {
          type: "string",
          description: "Income source category/type (1–100 chars, e.g. 'Salary', 'Freelance', 'Bonus', 'Investment', 'Gift').",
        },
        name: {
          type: "string",
          description: "Optional description, employer, or client name (up to 500 chars).",
        },
        amount: {
          type: "number",
          description: "Positive amount received per payment.",
        },
        frequency: {
          type: "string",
          enum: [...INCOME_FREQUENCIES],
          description: "Payment frequency: 'once', 'daily', 'weekly', 'monthly', or 'yearly'.",
        },
        startDate: {
          type: "string",
          description: "First payment date in YYYY-MM-DD format (the only date when frequency is 'once').",
        },
        endDate: {
          type: ["string", "null"] as unknown as "string",
          description: "Optional inclusive end date in YYYY-MM-DD format (must be null/omitted when frequency is 'once').",
        },
      },
      required: ["source", "amount", "frequency", "startDate"],
      additionalProperties: false,
    },
    annotations: {
      title: "Create Income",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
    },
  },
  {
    name: "update_income",
    description: "Update an existing income source by its UUID.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "UUID of the income source to update.",
        },
        source: { type: "string" },
        name: { type: "string" },
        amount: { type: "number" },
        frequency: { type: "string", enum: [...INCOME_FREQUENCIES] },
        startDate: { type: "string", description: "YYYY-MM-DD" },
        endDate: { type: ["string", "null"] as unknown as "string", description: "YYYY-MM-DD or null" },
      },
      required: ["id", "source", "amount", "frequency", "startDate"],
      additionalProperties: false,
    },
    annotations: {
      title: "Update Income",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  {
    name: "delete_income",
    description: "Delete an income source by its UUID.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "UUID of the income source to delete.",
        },
      },
      required: ["id"],
      additionalProperties: false,
    },
    annotations: {
      title: "Delete Income",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
    },
  },
  {
    name: "list_repeat_rules",
    description: "List all recurring spending rules with their schedule, progress, and estimated monthly cost.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    annotations: {
      title: "List Repeat Rules",
      readOnlyHint: true,
    },
  },
  {
    name: "create_repeat_rule",
    description: "Create a recurring spending rule and automatically generate due spending occurrences.",
    inputSchema: {
      type: "object",
      properties: {
        amount: { type: "number", description: "Positive amount per occurrence." },
        description: { type: "string", description: "Description of the recurring expense." },
        category: { type: "string", description: "Category ID from user settings." },
        startDate: { type: "string", description: "Start date in YYYY-MM-DD format." },
        time: { type: "string", description: "Time in HH:mm format (defaults to '09:00')." },
        frequency: {
          type: "string",
          enum: ["daily", "weekdays", "weekly", "monthly"],
          description: "Recurrence frequency.",
        },
        interval: {
          type: "number",
          description: "Recurrence interval (1–365, default 1).",
        },
        daysOfWeek: {
          type: "array",
          items: { type: "number" },
          description: "Optional days of week for weekly frequency (0=Sunday .. 6=Saturday).",
        },
        endType: {
          type: "string",
          enum: ["unlimited", "occurrences", "until_date"],
          description: "How the recurrence ends (defaults to 'unlimited').",
        },
        totalOccurrences: {
          type: "number",
          description: "Total occurrences (1–100) when endType is 'occurrences'.",
        },
        endDate: {
          type: "string",
          description: "Inclusive end date (YYYY-MM-DD) when endType is 'until_date'.",
        },
      },
      required: ["amount", "description", "category", "startDate", "frequency"],
      additionalProperties: false,
    },
    annotations: {
      title: "Create Repeat Rule",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
    },
  },
  {
    name: "delete_repeat_rule",
    description: "Stop and delete a recurring spending rule by its UUID.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "UUID of the repeat rule to delete.",
        },
        deleteFuture: {
          type: "boolean",
          description: "Whether to also delete generated spendings from today onward (defaults to true).",
        },
      },
      required: ["id"],
      additionalProperties: false,
    },
    annotations: {
      title: "Delete Repeat Rule",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
    },
  },
  {
    name: "sync_repeat_rules",
    description: "Synchronize and materialize any due recurring spending transactions up to a given date.",
    inputSchema: {
      type: "object",
      properties: {
        asOfDate: {
          type: "string",
          description: "Optional reference date in YYYY-MM-DD format (defaults to today).",
        },
      },
      additionalProperties: false,
    },
    annotations: {
      title: "Sync Repeat Rules",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  {
    name: "get_date_range_summary",
    description: "Compute a financial summary for any custom date range [startDate, endDate], including total spending, income received, net cashflow, daily average, category breakdown, and largest transactions.",
    inputSchema: {
      type: "object",
      properties: {
        startDate: {
          type: "string",
          description: "Start date in YYYY-MM-DD format (inclusive).",
        },
        endDate: {
          type: "string",
          description: "End date in YYYY-MM-DD format (inclusive).",
        },
      },
      required: ["startDate", "endDate"],
      additionalProperties: false,
    },
    annotations: {
      title: "Get Date Range Summary",
      readOnlyHint: true,
    },
  },
  {
    name: "get_monthly_analytics",
    description: "Compute comprehensive statistical analytics for a calendar month (YYYY-MM), including spending totals, monthly income, savings rate, end-of-month OLS forecast with 95% confidence interval, Tukey outlier/anomaly days, category MoM changes, Pareto/Gini concentration, 6-month trend, and natural-language insights.",
    inputSchema: {
      type: "object",
      properties: {
        month: {
          type: "string",
          description: "Target month in YYYY-MM format (defaults to current month).",
        },
      },
      additionalProperties: false,
    },
    annotations: {
      title: "Get Monthly Analytics",
      readOnlyHint: true,
    },
  },
  {
    name: "get_salary_cycle_summary",
    description: "Compute a salary (pay) cycle report for a cycle month (YYYY-MM), including cycle start/end dates, payday adjustments, total spending, anchor month income, leftover balance, daily burn rate, remaining safe daily budget, and category breakdown.",
    inputSchema: {
      type: "object",
      properties: {
        cycleMonth: {
          type: "string",
          description: "Cycle anchor month in YYYY-MM format (defaults to current month).",
        },
        salaryDay: {
          type: "number",
          description: "Configured payday of the month (1–28, default 5).",
        },
        shiftWeekendToMonday: {
          type: "boolean",
          description: "Shift weekend paydays to the following Monday (default true).",
        },
        includeNextPaydayInCycle: {
          type: "boolean",
          description: "Include next month's payday as the final day of the cycle (default true).",
        },
        delayDays: {
          type: "number",
          description: "Optional payday delay/early payout adjustment in days for this month (-7 to +14, default 0).",
        },
      },
      additionalProperties: false,
    },
    annotations: {
      title: "Get Salary Cycle Summary",
      readOnlyHint: true,
    },
  },
];

function toolSuccess(payload: Record<string, unknown>): McpToolCallResult {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(payload, null, 2),
      },
    ],
    structuredContent: payload,
    isError: false,
  };
}

function toolError(message: string): McpToolCallResult {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({ error: message }, null, 2),
      },
    ],
    structuredContent: { error: message },
    isError: true,
  };
}

function validateMonthString(value: unknown, fallbackMonth?: string): string {
  if (value === undefined || value === null || value === "") {
    if (fallbackMonth) return fallbackMonth;
    throw new HttpError(400, "Invalid month (expected YYYY-MM)");
  }
  if (typeof value !== "string" || !/^\d{4}-(?:0[1-9]|1[0-2])$/.test(value)) {
    throw new HttpError(400, "Invalid month (expected YYYY-MM)");
  }
  return value;
}

function validateDateString(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new HttpError(400, `Invalid ${field} (expected YYYY-MM-DD)`);
  }
  const [year, month, day] = value.split("-").map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > days[month - 1]) {
    throw new HttpError(400, `Invalid ${field}`);
  }
  return value;
}

export async function executeMcpTool(
  name: string,
  rawArgs: Record<string, unknown> | undefined,
  user: User,
  financeStore: FinanceStore,
): Promise<McpToolCallResult> {
  const args = rawArgs ?? {};
  const toolExists = MCP_TOOLS.some(t => t.name === name);
  if (!toolExists) {
    throw new McpError(JsonRpcErrorCode.INVALID_PARAMS, `Unknown tool: ${name}`);
  }

  try {
    switch (name) {
      case "get_profile_and_settings": {
        const settings = await financeStore.getSettings(user.id);
        return toolSuccess({
          user,
          settings,
          availableIcons: [...CATEGORY_ICONS],
        });
      }

      case "upsert_category": {
        const current = await financeStore.getSettings(user.id);
        const catName = typeof args.name === "string" ? args.name.trim() : "";
        const catId = typeof args.id === "string" && args.id.trim() ? args.id.trim() : catName;
        const color = typeof args.color === "string" ? args.color : "#10b981";
        const icon = typeof args.icon === "string" ? args.icon : "CircleDollarSign";
        const newCat: Category = { id: catId, name: catName, color, icon };

        const existingIndex = current.categories.findIndex(c => c.id === catId);
        const nextCategories = existingIndex >= 0
          ? current.categories.map((c, idx) => (idx === existingIndex ? newCat : c))
          : [...current.categories, newCat];

        const patch = settingsPatch({ categories: nextCategories });
        const updated = await financeStore.updateSettings(user.id, patch);
        return toolSuccess({
          action: existingIndex >= 0 ? "updated" : "created",
          category: newCat,
          settings: updated,
        });
      }

      case "delete_category": {
        const targetId = typeof args.id === "string" ? args.id.trim() : "";
        if (!targetId) throw new HttpError(400, "Provide a valid category id");
        const current = await financeStore.getSettings(user.id);
        const exists = current.categories.some(c => c.id === targetId);
        if (!exists) throw new HttpError(404, `Category '${targetId}' not found in settings`);
        const nextCategories = current.categories.filter(c => c.id !== targetId);
        const updated = await financeStore.updateSettings(user.id, { categories: nextCategories });
        return toolSuccess({
          deletedCategoryId: targetId,
          settings: updated,
        });
      }

      case "update_settings": {
        const patch = settingsPatch(args);
        const settings = await financeStore.updateSettings(user.id, patch);
        return toolSuccess({ settings });
      }

      case "list_spendings": {
        const startDate = args.startDate !== undefined ? validateDateString(args.startDate, "startDate") : undefined;
        const endDate = args.endDate !== undefined ? validateDateString(args.endDate, "endDate") : undefined;
        if (startDate && endDate && endDate < startDate) {
          throw new HttpError(400, "endDate cannot be before startDate");
        }
        const limit = args.limit !== undefined ? Number(args.limit) : 100;
        if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
          throw new HttpError(400, "Invalid limit (1–500)");
        }
        const all = await fetchAllSpendings(financeStore, user.id, startDate, endDate);
        const categoryFilter = typeof args.category === "string" ? args.category.trim() : undefined;
        const searchFilter = typeof args.search === "string" ? args.search.trim().toLowerCase() : undefined;
        const minAmount = typeof args.minAmount === "number" ? args.minAmount : undefined;
        const maxAmount = typeof args.maxAmount === "number" ? args.maxAmount : undefined;

        const filtered = all
          .filter(s => {
            if (categoryFilter && s.category !== categoryFilter) return false;
            if (searchFilter && !s.description.toLowerCase().includes(searchFilter)) return false;
            if (minAmount !== undefined && s.amount < minAmount) return false;
            if (maxAmount !== undefined && s.amount > maxAmount) return false;
            return true;
          })
          .sort((a, b) => b.date.localeCompare(a.date) || b.time.localeCompare(a.time));

        const totalAmount = Math.round(filtered.reduce((sum, s) => sum + s.amount, 0) * 100) / 100;
        const returned = filtered.slice(0, limit);
        return toolSuccess({
          spendings: returned,
          totalMatched: filtered.length,
          returnedCount: returned.length,
          totalAmount,
        });
      }

      case "create_spending": {
        const now = new Date();
        const payload = {
          amount: args.amount,
          description: args.description,
          category: args.category,
          date: args.date ?? format(now, "yyyy-MM-dd"),
          time: args.time ?? format(now, "HH:mm"),
        };
        const validated = spendingInput(payload);
        const spending = await financeStore.createSpending(user.id, validated);
        if (!spending) {
          const settings = await financeStore.getSettings(user.id);
          const validIds = settings.categories.map(c => c.id).join(", ");
          throw new HttpError(400, `Category '${validated.category}' must exist in current settings. Valid categories: ${validIds}`);
        }
        return toolSuccess({ spending });
      }

      case "batch_create_spendings": {
        if (!Array.isArray(args.spendings) || args.spendings.length === 0 || args.spendings.length > 50) {
          throw new HttpError(400, "Provide between 1 and 50 spendings in `spendings` array");
        }
        const now = new Date();
        const defaultDate = format(now, "yyyy-MM-dd");
        const defaultTime = format(now, "HH:mm");
        const settings = await financeStore.getSettings(user.id);
        const validCategories = new Set(settings.categories.map(c => c.id));

        const validatedItems = args.spendings.map((item, idx) => {
          if (!item || typeof item !== "object" || Array.isArray(item)) {
            throw new HttpError(400, `Item at index ${idx} is not a valid object`);
          }
          const rec = item as Record<string, unknown>;
          const validated = spendingInput({
            amount: rec.amount,
            description: rec.description,
            category: rec.category,
            date: rec.date ?? defaultDate,
            time: rec.time ?? defaultTime,
          });
          if (!validCategories.has(validated.category)) {
            throw new HttpError(
              400,
              `Item at index ${idx}: category '${validated.category}' does not exist in settings. Valid categories: ${[...validCategories].join(", ")}`,
            );
          }
          return validated;
        });

        const created = [];
        for (const item of validatedItems) {
          const s = await financeStore.createSpending(user.id, item);
          if (!s) throw new HttpError(400, `Category '${item.category}' must exist in current settings`);
          created.push(s);
        }
        const totalAmount = Math.round(created.reduce((sum, s) => sum + s.amount, 0) * 100) / 100;
        return toolSuccess({
          createdCount: created.length,
          totalAmount,
          spendings: created,
        });
      }

      case "update_spending": {
        const id = uuid(args.id);
        const { id: _id, ...rest } = args;
        const validated = spendingInput(rest);
        const result = await financeStore.updateSpending(user.id, id, validated);
        if (result === "not-found") throw new HttpError(404, "Spending not found");
        if (result === "invalid-category") {
          const settings = await financeStore.getSettings(user.id);
          const validIds = settings.categories.map(c => c.id).join(", ");
          throw new HttpError(400, `Category '${validated.category}' must exist in current settings. Valid categories: ${validIds}`);
        }
        return toolSuccess({ spending: result });
      }

      case "delete_spending": {
        const id = uuid(args.id);
        const deleted = await financeStore.deleteSpending(user.id, id);
        if (!deleted) throw new HttpError(404, "Spending not found");
        return toolSuccess({ deleted: true, id });
      }

      case "list_incomes": {
        const currentMonth = format(new Date(), "yyyy-MM");
        const month = validateMonthString(args.month, currentMonth);
        const incomes = await fetchAllIncomes(financeStore, user.id);
        const monthBreakdown = getMonthIncome(month, incomes);
        return toolSuccess({
          month,
          monthlyTotal: monthBreakdown.totalIncome,
          recurringIncome: monthBreakdown.recurringIncome,
          oneTimeIncome: monthBreakdown.oneTimeIncome,
          incomes: incomes.map(inc => enrichIncome(inc, month)),
        });
      }

      case "create_income": {
        const validated = incomeInput({
          source: args.source,
          name: args.name ?? "",
          amount: args.amount,
          frequency: args.frequency,
          startDate: args.startDate,
          endDate: args.endDate ?? null,
        });
        const income = await financeStore.createIncome(user.id, validated);
        return toolSuccess({ income: enrichIncome(income) });
      }

      case "update_income": {
        const id = uuid(args.id);
        const validated = incomeInput({
          source: args.source,
          name: args.name ?? "",
          amount: args.amount,
          frequency: args.frequency,
          startDate: args.startDate,
          endDate: args.endDate ?? null,
        });
        const income = await financeStore.updateIncome(user.id, id, validated);
        if (!income) throw new HttpError(404, "Income not found");
        return toolSuccess({ income: enrichIncome(income) });
      }

      case "delete_income": {
        const id = uuid(args.id);
        const deleted = await financeStore.deleteIncome(user.id, id);
        if (!deleted) throw new HttpError(404, "Income not found");
        return toolSuccess({ deleted: true, id });
      }

      case "list_repeat_rules": {
        const [settings, repeatRules] = await Promise.all([
          financeStore.getSettings(user.id),
          financeStore.listRepeatRules(user.id),
        ]);
        const estimatedMonthlyTotal = Math.round(
          repeatRules.reduce((sum, rule) => sum + monthlyRepeatCost(rule), 0) * 100,
        ) / 100;
        return toolSuccess({
          estimatedMonthlyTotal,
          count: repeatRules.length,
          repeatRules: repeatRules.map(rule => enrichRepeatRule(rule, settings)),
        });
      }

      case "create_repeat_rule": {
        const payload: Record<string, unknown> = {
          amount: args.amount,
          description: args.description,
          category: args.category,
          startDate: args.startDate,
          time: args.time ?? "09:00",
          frequency: args.frequency,
          endType: args.endType ?? "unlimited",
        };
        if (args.interval !== undefined) payload.interval = args.interval;
        if (args.daysOfWeek !== undefined) payload.daysOfWeek = args.daysOfWeek;
        if (args.totalOccurrences !== undefined) payload.totalOccurrences = args.totalOccurrences;
        if (args.endDate !== undefined) payload.endDate = args.endDate;

        const validated = repeatRuleInput(payload);
        const created = await financeStore.createRepeatRule(user.id, validated);
        if (!created) {
          const settings = await financeStore.getSettings(user.id);
          const validIds = settings.categories.map(c => c.id).join(", ");
          throw new HttpError(400, `Category '${validated.category}' must exist in current settings. Valid categories: ${validIds}`);
        }
        const settings = await financeStore.getSettings(user.id);
        return toolSuccess({
          repeatRule: enrichRepeatRule(created.repeatRule, settings),
          spendingsGenerated: created.spendings.length,
          spendings: created.spendings,
        });
      }

      case "delete_repeat_rule": {
        const id = uuid(args.id);
        const deleteFuture = args.deleteFuture !== false;
        const deleted = await financeStore.deleteRepeatRule(user.id, id, deleteFuture);
        if (!deleted) throw new HttpError(404, "Repeat rule not found");
        return toolSuccess({ deleted: true, id, deleteFuture });
      }

      case "sync_repeat_rules": {
        const asOfDate = args.asOfDate !== undefined ? validateDateString(args.asOfDate, "asOfDate") : undefined;
        const spendingsCreated = await financeStore.syncRepeatSpendings(user.id, asOfDate);
        return toolSuccess({ spendingsCreated, asOfDate: asOfDate ?? format(new Date(), "yyyy-MM-dd") });
      }

      case "get_date_range_summary": {
        const startDate = validateDateString(args.startDate, "startDate");
        const endDate = validateDateString(args.endDate, "endDate");
        if (endDate < startDate) {
          throw new HttpError(400, "endDate cannot be before startDate");
        }
        const summary = await buildDateRangeSummary(financeStore, user.id, startDate, endDate);
        return toolSuccess(summary);
      }

      case "get_monthly_analytics": {
        const currentMonth = format(new Date(), "yyyy-MM");
        const month = validateMonthString(args.month, currentMonth);
        const report = await buildMonthlyAnalyticsReport(financeStore, user.id, month);
        return toolSuccess(report);
      }

      case "get_salary_cycle_summary": {
        const currentMonth = format(new Date(), "yyyy-MM");
        const cycleMonth = validateMonthString(args.cycleMonth, currentMonth);
        const report = await buildSalaryCycleReport(financeStore, user.id, cycleMonth, {
          salaryDay: typeof args.salaryDay === "number" ? args.salaryDay : undefined,
          shiftWeekendToMonday: typeof args.shiftWeekendToMonday === "boolean" ? args.shiftWeekendToMonday : undefined,
          includeNextPaydayInCycle: typeof args.includeNextPaydayInCycle === "boolean" ? args.includeNextPaydayInCycle : undefined,
          delayDays: typeof args.delayDays === "number" ? args.delayDays : undefined,
        });
        return toolSuccess(report);
      }

      default:
        throw new McpError(JsonRpcErrorCode.INVALID_PARAMS, `Unknown tool: ${name}`);
    }
  } catch (error) {
    if (error instanceof HttpError) {
      return toolError(error.message);
    }
    throw error;
  }
}
