import { format } from "date-fns";
import { HttpError } from "../auth/http";
import type { User } from "../auth/store";
import { CATEGORY_ICONS, INCOME_FREQUENCIES, MAX_CATEGORIES, type Category } from "../finance/model";
import type { FinanceStore } from "../finance/store";
import { loadBudgetPeriod, loadPlanPeriodSummary } from "../finance/periodSummary";
import { incomeInput, planExceptionInput, planInput, settingsPatch, spendingInput, uuid } from "../finance/validation";
import { addDays, describePlanSchedule, localNowStamp, projectPlans } from "../../lib/plans";
import {
  buildDateRangeSummary,
  buildMonthlyAnalyticsReport,
  buildSalaryCycleReport,
  enrichIncome,
  fetchAllIncomes,
  fetchAllSpendings,
} from "./data";
import { JsonRpcErrorCode, McpError, type McpToolCallResult, type McpToolDefinition } from "./protocol";
import { getMonthIncome } from "../../lib/income";
import { SHOW_BY } from "../../lib/periods";

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
          description: `Complete replacement array of categories (up to ${MAX_CATEGORIES}). Keep archived ones (archived: true) so past spendings keep their name.`,
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              name: { type: "string" },
              color: { type: "string", description: "#RRGGBB hex color" },
              icon: { type: "string", enum: [...CATEGORY_ICONS] },
              archived: { type: "boolean", description: "Hidden from pickers; past spendings keep it." },
            },
            required: ["id", "name", "color", "icon"],
          },
        },
        showBy: {
          type: "string",
          enum: [...SHOW_BY],
          description: "Which period Calendar, Week, Day and Analytics show: the calendar month or the pay cycle.",
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
          description: "Payment frequency: 'once', 'daily', 'weekly', 'semimonthly' (twice a month, needs semimonthlyDays), 'monthly', or 'yearly'.",
        },
        startDate: {
          type: "string",
          description: "First payment date in YYYY-MM-DD format (the only date when frequency is 'once').",
        },
        endDate: {
          type: ["string", "null"] as unknown as "string",
          description: "Optional inclusive end date in YYYY-MM-DD format (must be null/omitted when frequency is 'once').",
        },
        interval: { type: "integer", enum: [1, 2, 4], description: "Weekly only: paid every 1, 2 or 4 weeks (default 1)." },
        semimonthlyDays: {
          type: "array",
          items: { type: "integer", minimum: 1, maximum: 31 },
          minItems: 2,
          maxItems: 2,
          description: "Required for 'semimonthly': the two paydays of the month, first before second (31 = last day of the month).",
        },
        weekendShift: { type: "boolean", description: "Pay on the Friday before when a payday falls on a Saturday or Sunday (not for 'once' or 'daily'; default false)." },
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
    description: "Update an existing income source by its UUID. This replaces the whole income: omitted interval and weekendShift reset to their defaults (every week, off), so send them again to keep them. For a semimonthly income semimonthlyDays is required on every update (omitting it is a 400); for other frequencies an omitted semimonthlyDays resets to none.",
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
        interval: { type: "integer", enum: [1, 2, 4], description: "Weekly only: every 1, 2 or 4 weeks." },
        semimonthlyDays: {
          type: "array",
          items: { type: "integer", minimum: 1, maximum: 31 },
          minItems: 2,
          maxItems: 2,
          description: "Required for 'semimonthly': the two paydays of the month, first before second.",
        },
        weekendShift: { type: "boolean", description: "Pay on the Friday before a Saturday or Sunday payday." },
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
    name: "list_plans",
    description: "List planned (forecast) spendings. A plan's future occurrences are projections, not real spendings; each becomes a real spending automatically once its local date and time pass. Includes each plan's next occurrences and projected totals for the rest of this month and next month.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { title: "List Planned Spendings", readOnlyHint: true },
  },
  {
    name: "get_plan_period_summary",
    description: "Summary of one budget period (calendar month, monthly from a start day, or paycheck to paycheck, per the user's budget period setting): payments received, spent so far, committed (sure) and estimated planned spendings, and what is left. Defaults to the period containing today.",
    inputSchema: {
      type: "object",
      properties: { date: { type: "string", description: "Any date (YYYY-MM-DD) inside the period; default today in the user's time zone." } },
      additionalProperties: false,
    },
    annotations: { title: "Plan Period Summary", readOnlyHint: true },
  },
  {
    name: "get_budget_period",
    description: "The user's budget period setting (mode, start day, paycheck income) and the period containing today.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { title: "Budget Period", readOnlyHint: true },
  },
  {
    name: "get_spending_forecast",
    description: "Forecast spending for a date range: real spendings already recorded plus planned occurrences that have not happened yet, with totals per category and per day.",
    inputSchema: {
      type: "object",
      properties: {
        startDate: { type: "string", description: "Start date (YYYY-MM-DD), inclusive." },
        endDate: { type: "string", description: "End date (YYYY-MM-DD), inclusive; at most 366 days after startDate." },
      },
      required: ["startDate", "endDate"],
      additionalProperties: false,
    },
    annotations: { title: "Get Spending Forecast", readOnlyHint: true },
  },
  {
    name: "create_plan",
    description: "Create a planned (forecast) spending, e.g. 35000 lunch every weekday. Nothing is written as a spending until each occurrence's time passes; past dates are never back-filled.",
    inputSchema: {
      type: "object",
      properties: {
        amount: { type: "number", description: "Positive amount per occurrence." },
        description: { type: "string", description: "What the spending is, e.g. 'Lunch'." },
        category: { type: "string", description: "Category ID from user settings." },
        time: { type: "string", description: "Local time HH:mm when it becomes real (defaults to '12:00')." },
        startDate: { type: "string", description: "First possible occurrence (YYYY-MM-DD); the only date for 'once'." },
        frequency: { type: "string", enum: ["once", "daily", "weekdays", "weekly", "monthly"] },
        interval: { type: "number", description: "Every N days/weeks/months (1–365, default 1)." },
        daysOfWeek: { type: "array", items: { type: "number" }, description: "Weekly only: 0=Sunday..6=Saturday (defaults to the start date's weekday)." },
        endDate: { type: "string", description: "Optional inclusive last date (YYYY-MM-DD); omit for no end." },
        sure: { type: "boolean", description: "true for a commitment with a fixed amount and date (rent, bills, subscriptions); false (default) for an estimate (food, coffee, fuel)." },
      },
      required: ["amount", "category", "startDate", "frequency"],
      additionalProperties: false,
    },
    annotations: { title: "Create Plan", readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  },
  {
    name: "update_plan",
    description: "Change a plan. By default the change applies to every upcoming occurrence (past ones are already real and never change). With effectiveFrom, the plan instead ends the day before and a new plan with these values starts on that date.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Plan UUID." },
        amount: { type: "number" },
        description: { type: "string" },
        category: { type: "string" },
        time: { type: "string", description: "HH:mm" },
        startDate: { type: "string", description: "YYYY-MM-DD" },
        frequency: { type: "string", enum: ["once", "daily", "weekdays", "weekly", "monthly"] },
        interval: { type: "number" },
        daysOfWeek: { type: "array", items: { type: "number" } },
        endDate: { type: ["string", "null"], description: "Inclusive last date, or null for no end." },
        sure: { type: "boolean", description: "Commitment (true) or estimate (false)." },
        effectiveFrom: { type: "string", description: "Optional YYYY-MM-DD after the plan's start date: split the plan here (this and future)." },
      },
      required: ["id"],
      additionalProperties: false,
    },
    annotations: { title: "Update Plan", readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  },
  {
    name: "delete_plan",
    description: "Delete a plan. Upcoming projected occurrences disappear; spendings it already created are kept as ordinary spendings.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "Plan UUID." } },
      required: ["id"],
      additionalProperties: false,
    },
    annotations: { title: "Delete Plan", readOnlyHint: false, destructiveHint: true, idempotentHint: true },
  },
  {
    name: "update_plan_occurrence",
    description: "Change one upcoming occurrence of a plan: skip it, override its amount (and optionally description), restore it to the plan's usual values, or mark it done now.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Plan UUID." },
        date: { type: "string", description: "Occurrence date (YYYY-MM-DD); must be an upcoming occurrence of the plan." },
        action: { type: "string", enum: ["skip", "override", "restore", "done"], description: "done records it as a real spending right away (paid early or already logged), so it is never counted twice." },
        amount: { type: "number", description: "Required for 'override'." },
        description: { type: "string", description: "Optional for 'override'." },
      },
      required: ["id", "date", "action"],
      additionalProperties: false,
    },
    annotations: { title: "Update Plan Occurrence", readOnlyHint: false, destructiveHint: false, idempotentHint: true },
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
    description: "Compute a pay cycle report for a cycle month (YYYY-MM): the saved budget period that contains the 1st of that month, with its start/end dates, total spending, income paid in the period, leftover balance, daily burn rate, remaining safe daily budget, and category breakdown. The period follows the saved budget period setting. The salaryDay, shiftWeekendToMonday, includeNextPaydayInCycle and delayDays parameters are accepted but ignored, and are echoed in config.ignoredParameters.",
    inputSchema: {
      type: "object",
      properties: {
        cycleMonth: {
          type: "string",
          description: "Cycle month in YYYY-MM format (defaults to current month). The cycle is the saved budget period that contains the 1st of this month.",
        },
        salaryDay: {
          type: "number",
          description: "Ignored. The cycle follows the saved budget period.",
        },
        shiftWeekendToMonday: {
          type: "boolean",
          description: "Ignored. The cycle follows the saved budget period.",
        },
        includeNextPaydayInCycle: {
          type: "boolean",
          description: "Ignored. The cycle follows the saved budget period.",
        },
        delayDays: {
          type: "number",
          description: "Ignored. The cycle follows the saved budget period.",
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

function settingsResult<T extends object>(result: T | "invalid-budget-period"): T {
  if (result === "invalid-budget-period") throw new HttpError(400, "Paycheck period needs one of your weekly, twice-a-month or monthly incomes");
  return result;
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

function lastDayOfMonth(date: string): string {
  const [year, month] = date.split("-").map(Number);
  const day = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${date.slice(0, 7)}-${String(day).padStart(2, "0")}`;
}

async function invalidCategory(financeStore: FinanceStore, userId: string, category: string): Promise<HttpError> {
  const settings = await financeStore.getSettings(userId);
  return new HttpError(400, `Category '${category}' must exist in current settings. Valid categories: ${settings.categories.map(c => c.id).join(", ")}`);
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
        const existingIndex = current.categories.findIndex(c => c.id === catId);
        // Updating an archived category keeps it archived.
        const newCat: Category = current.categories[existingIndex]?.archived
          ? { id: catId, name: catName, color, icon, archived: true }
          : { id: catId, name: catName, color, icon };
        const nextCategories = existingIndex >= 0
          ? current.categories.map((c, idx) => (idx === existingIndex ? newCat : c))
          : [...current.categories, newCat];

        const patch = settingsPatch({ categories: nextCategories });
        const updated = settingsResult(await financeStore.updateSettings(user.id, patch));
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
        const updated = settingsResult(await financeStore.updateSettings(user.id, { categories: nextCategories }));
        return toolSuccess({
          deletedCategoryId: targetId,
          settings: updated,
        });
      }

      case "update_settings": {
        const patch = settingsPatch(args);
        const settings = settingsResult(await financeStore.updateSettings(user.id, patch));
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
          interval: args.interval ?? undefined,
          semimonthlyDays: args.semimonthlyDays ?? undefined,
          weekendShift: args.weekendShift ?? undefined,
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
          interval: args.interval ?? undefined,
          semimonthlyDays: args.semimonthlyDays ?? undefined,
          weekendShift: args.weekendShift ?? undefined,
        });
        const income = await financeStore.updateIncome(user.id, id, validated);
        if (!income) throw new HttpError(404, "Income not found");
        if (income === "paycheck-in-use") throw new HttpError(400, "This income sets the paycheck budget period, so it must stay weekly, twice a month or monthly");
        return toolSuccess({ income: enrichIncome(income) });
      }

      case "delete_income": {
        const id = uuid(args.id);
        const deleted = await financeStore.deleteIncome(user.id, id);
        if (!deleted) throw new HttpError(404, "Income not found");
        return toolSuccess({ deleted: true, id });
      }

      case "list_plans": {
        const [settings, plans] = await Promise.all([financeStore.getSettings(user.id), financeStore.listPlans(user.id)]);
        const today = localNowStamp(settings.timezone).slice(0, 10);
        const monthEnd = lastDayOfMonth(today);
        const nextMonthStart = addDays(monthEnd, 1);
        const sum = (items: { amount: number }[]) => Math.round(items.reduce((total, item) => total + item.amount, 0) * 100) / 100;
        const restOfMonth = projectPlans(plans, today, monthEnd);
        const nextMonth = projectPlans(plans, nextMonthStart, lastDayOfMonth(nextMonthStart));
        return toolSuccess({
          timezone: settings.timezone,
          today,
          count: plans.length,
          plannedRestOfMonth: sum(restOfMonth),
          plannedNextMonth: sum(nextMonth),
          plans: plans.map(plan => ({
            ...plan,
            schedule: describePlanSchedule(plan),
            nextOccurrences: projectPlans([plan], today, addDays(today, 400)).slice(0, 5),
          })),
        });
      }

      case "get_plan_period_summary": {
        const date = args.date === undefined || args.date === null ? undefined : validateDateString(args.date, "date");
        return toolSuccess({ summary: await loadPlanPeriodSummary(financeStore, user.id, date) });
      }

      case "get_budget_period": {
        const { setting, showBy, today, period } = await loadBudgetPeriod(financeStore, user.id);
        return toolSuccess({ budgetPeriod: setting, showBy, today, currentPeriod: period });
      }

      case "get_spending_forecast": {
        const startDate = validateDateString(args.startDate, "startDate");
        const endDate = validateDateString(args.endDate, "endDate");
        if (endDate < startDate) throw new HttpError(400, "endDate cannot be before startDate");
        if (endDate > addDays(startDate, 366)) throw new HttpError(400, "The range can be at most 366 days");
        const [plans, spendings] = await Promise.all([
          financeStore.listPlans(user.id),
          fetchAllSpendings(financeStore, user.id, startDate, endDate),
        ]);
        const realKeys = new Set(spendings.filter(s => s.planId && s.planDate).map(s => `${s.planId}|${s.planDate}`));
        const planned = projectPlans(plans, startDate, endDate, realKeys);
        const round = (value: number) => Math.round(value * 100) / 100;
        const byCategory: Record<string, { spent: number; planned: number }> = {};
        const byDay: Record<string, { spent: number; planned: number }> = {};
        for (const s of spendings) {
          (byCategory[s.category] ??= { spent: 0, planned: 0 }).spent += s.amount;
          (byDay[s.date] ??= { spent: 0, planned: 0 }).spent += s.amount;
        }
        for (const p of planned) {
          (byCategory[p.category] ??= { spent: 0, planned: 0 }).planned += p.amount;
          (byDay[p.date] ??= { spent: 0, planned: 0 }).planned += p.amount;
        }
        for (const bucket of [...Object.values(byCategory), ...Object.values(byDay)]) {
          bucket.spent = round(bucket.spent);
          bucket.planned = round(bucket.planned);
        }
        const spent = round(spendings.reduce((total, s) => total + s.amount, 0));
        const plannedTotal = round(planned.reduce((total, p) => total + p.amount, 0));
        return toolSuccess({
          startDate, endDate, spent, planned: plannedTotal, projected: round(spent + plannedTotal),
          byCategory, byDay, plannedOccurrences: planned,
        });
      }

      case "create_plan": {
        const plan = await financeStore.createPlan(user.id, planInput({
          amount: args.amount, description: args.description ?? "", category: args.category, time: args.time ?? "12:00",
          startDate: args.startDate, frequency: args.frequency, interval: args.interval, daysOfWeek: args.daysOfWeek, endDate: args.endDate, sure: args.sure,
        }));
        if (plan === "invalid-category") throw await invalidCategory(financeStore, user.id, String(args.category));
        return toolSuccess({ plan: { ...plan, schedule: describePlanSchedule(plan) } });
      }

      case "update_plan": {
        const id = uuid(args.id);
        const current = (await financeStore.listPlans(user.id)).find(plan => plan.id === id);
        if (!current) throw new HttpError(404, "Plan not found");
        const pick = (key: string, fallback: unknown) => args[key] !== undefined ? args[key] : fallback;
        const input = planInput({
          amount: pick("amount", current.amount), description: pick("description", current.description),
          category: pick("category", current.category), time: pick("time", current.time),
          startDate: pick("startDate", current.startDate), frequency: pick("frequency", current.frequency),
          interval: pick("interval", current.interval), daysOfWeek: pick("daysOfWeek", current.daysOfWeek),
          endDate: pick("endDate", current.endDate), sure: pick("sure", current.sure),
        });
        if (args.effectiveFrom !== undefined) {
          const effectiveFrom = validateDateString(args.effectiveFrom, "effectiveFrom");
          const result = await financeStore.splitPlan(user.id, id, { ...input, startDate: effectiveFrom });
          if (result === "not-found") throw new HttpError(404, "Plan not found");
          if (result === "invalid-category") throw await invalidCategory(financeStore, user.id, input.category);
          if (result === "invalid-date") throw new HttpError(400, "effectiveFrom must be after the plan's start date (and the plan must repeat)");
          return toolSuccess(result as unknown as Record<string, unknown>);
        }
        const plan = await financeStore.updatePlan(user.id, id, input);
        if (plan === "not-found") throw new HttpError(404, "Plan not found");
        if (plan === "invalid-category") throw await invalidCategory(financeStore, user.id, input.category);
        return toolSuccess({ plan: { ...plan, schedule: describePlanSchedule(plan) } });
      }

      case "delete_plan": {
        const id = uuid(args.id);
        if (!await financeStore.deletePlan(user.id, id)) throw new HttpError(404, "Plan not found");
        return toolSuccess({ deleted: true, id });
      }

      case "update_plan_occurrence": {
        const id = uuid(args.id);
        const date = validateDateString(args.date, "date");
        let plan;
        if (args.action === "done") {
          const spending = await financeStore.completePlanOccurrence(user.id, id, date);
          if (spending === "not-found") throw new HttpError(404, "Plan not found");
          if (spending === "invalid-date") throw new HttpError(400, "date must be an upcoming occurrence of this plan that is not already recorded");
          return toolSuccess({ spending });
        }
        if (args.action === "restore") {
          plan = await financeStore.deletePlanException(user.id, id, date);
        } else if (args.action === "skip" || args.action === "override") {
          const exception = planExceptionInput(args.action === "skip"
            ? { kind: "skip" }
            : { kind: "override", amount: args.amount, description: args.description });
          plan = await financeStore.setPlanException(user.id, id, date, exception);
        } else {
          throw new HttpError(400, "Invalid action (expected skip, override or restore)");
        }
        if (plan === "not-found") throw new HttpError(404, "Plan not found");
        if (plan === "invalid-date") throw new HttpError(400, "date must be an upcoming occurrence of this plan");
        return toolSuccess({ plan });
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
