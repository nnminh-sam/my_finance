import { format } from "date-fns";
import type { User } from "../auth/store";
import type { FinanceStore } from "../finance/store";
import { monthlyRepeatCost } from "../../lib/repeatRules";
import {
  buildMonthlyAnalyticsReport,
  buildSalaryCycleReport,
  enrichIncome,
  enrichRepeatRule,
  fetchAllIncomes,
} from "./data";
import {
  JsonRpcErrorCode,
  McpError,
  type McpPromptDefinition,
  type McpPromptMessage,
} from "./protocol";

export const MCP_PROMPTS: McpPromptDefinition[] = [
  {
    name: "monthly_budget_review",
    description: "Analyze monthly spending, income, category trends, outlier days, and forecast to produce actionable budget recommendations.",
    arguments: [
      {
        name: "month",
        description: "Target month in YYYY-MM format (defaults to the current month).",
        required: false,
      },
    ],
  },
  {
    name: "salary_cycle_checkup",
    description: "Review payday-to-payday spending, burn rate, remaining balance, and daily safe-to-spend budget.",
    arguments: [
      {
        name: "cycleMonth",
        description: "Cycle anchor month in YYYY-MM format (defaults to the current month).",
        required: false,
      },
      {
        name: "salaryDay",
        description: "Day of month payday occurs (1–28, default 5).",
        required: false,
      },
    ],
  },
  {
    name: "categorize_and_log_expenses",
    description: "Parse raw receipt text, bank statement rows, or natural-language expense notes using the user's exact configured categories and log them.",
    arguments: [
      {
        name: "rawText",
        description: "Raw text of expenses, receipts, or bank transactions to categorize and log.",
        required: true,
      },
    ],
  },
  {
    name: "cashflow_forecast",
    description: "Evaluate recurring income sources against repeat spending rules and variable spending patterns to forecast net cashflow.",
    arguments: [
      {
        name: "month",
        description: "Reference month in YYYY-MM format (defaults to the current month).",
        required: false,
      },
    ],
  },
];

function validMonthOrDefault(value: unknown): string {
  const fallback = format(new Date(), "yyyy-MM");
  if (typeof value !== "string" || !value.trim()) return fallback;
  if (!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(value.trim())) {
    throw new McpError(JsonRpcErrorCode.INVALID_PARAMS, "Invalid month format (expected YYYY-MM)");
  }
  return value.trim();
}

export async function getMcpPrompt(
  name: string,
  rawArgs: Record<string, unknown> | undefined,
  user: User,
  financeStore: FinanceStore,
): Promise<{ description: string; messages: McpPromptMessage[] }> {
  const args = rawArgs ?? {};

  if (name === "monthly_budget_review") {
    const month = validMonthOrDefault(args.month);
    const report = await buildMonthlyAnalyticsReport(financeStore, user.id, month);
    return {
      description: `Monthly budget review for ${month}`,
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              `Please perform a comprehensive monthly budget review for ${user.name} for the month ${month}.`,
              "Use the following live financial analytics report:",
              "```json",
              JSON.stringify(report, null, 2),
              "```",
              "Cover:",
              "1. Overall cashflow health (income vs actual & projected spending, savings rate).",
              "2. Top spending categories and significant month-over-month movers.",
              "3. Unusual/anomaly spending days and transaction concentration (Pareto/Gini).",
              "4. Concrete, actionable suggestions to optimize spending for the rest of the month.",
            ].join("\n"),
          },
        },
      ],
    };
  }

  if (name === "salary_cycle_checkup") {
    const cycleMonth = validMonthOrDefault(args.cycleMonth);
    const salaryDay = args.salaryDay !== undefined ? Number(args.salaryDay) : 5;
    const report = await buildSalaryCycleReport(financeStore, user.id, cycleMonth, {
      salaryDay: Number.isFinite(salaryDay) ? salaryDay : 5,
    });
    return {
      description: `Salary cycle checkup for ${cycleMonth}`,
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              `Please review my salary cycle (${report.dates.startDate} to ${report.dates.endDate}) anchored at ${cycleMonth}.`,
              "Here is the live salary cycle report:",
              "```json",
              JSON.stringify(report, null, 2),
              "```",
              "Please summarize:",
              "1. Total spent so far vs cycle income and remaining leftover balance.",
              "2. Daily burn rate and safe daily budget for the remaining days until next payday.",
              "3. Top categories driving spending in this pay cycle and pacing advice.",
            ].join("\n"),
          },
        },
      ],
    };
  }

  if (name === "categorize_and_log_expenses") {
    const rawText = typeof args.rawText === "string" ? args.rawText.trim() : "";
    if (!rawText) {
      throw new McpError(JsonRpcErrorCode.INVALID_PARAMS, "Missing required argument: rawText");
    }
    const settings = await financeStore.getSettings(user.id);
    const today = format(new Date(), "yyyy-MM-dd");
    return {
      description: "Categorize and log expenses from raw text",
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              `Today's date is ${today}.`,
              "Here are my configured spending categories:",
              "```json",
              JSON.stringify(settings.categories, null, 2),
              "```",
              "Please parse the following raw expense notes/receipts, map each item to the most appropriate category `id` above (or call `upsert_category` first if a new category is genuinely needed), and log them using `create_spending` or `batch_create_spendings`:",
              "",
              rawText,
            ].join("\n"),
          },
        },
      ],
    };
  }

  if (name === "cashflow_forecast") {
    const month = validMonthOrDefault(args.month);
    const [settings, incomes, repeatRules, monthlyReport] = await Promise.all([
      financeStore.getSettings(user.id),
      fetchAllIncomes(financeStore, user.id),
      financeStore.listRepeatRules(user.id),
      buildMonthlyAnalyticsReport(financeStore, user.id, month),
    ]);
    const estimatedMonthlyRepeats = Math.round(
      repeatRules.reduce((sum, r) => sum + monthlyRepeatCost(r), 0) * 100,
    ) / 100;

    return {
      description: `Cashflow forecast anchored at ${month}`,
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              `Please build a cashflow and fixed-vs-variable expense forecast based on my live financial data as of ${month}:`,
              "```json",
              JSON.stringify(
                {
                  month,
                  incomes: incomes.map(i => enrichIncome(i, month)),
                  repeatRules: {
                    estimatedMonthlyTotal: estimatedMonthlyRepeats,
                    rules: repeatRules.map(r => enrichRepeatRule(r, settings)),
                  },
                  monthlyAnalytics: monthlyReport,
                },
                null,
                2,
              ),
              "```",
              "Provide:",
              "1. Breakdown of recurring income vs committed recurring spendings (fixed costs).",
              "2. Discretionary/variable spending velocity and projected end-of-month surplus/deficit.",
              "3. Risk factors and recommendations to improve monthly savings rate.",
            ].join("\n"),
          },
        },
      ],
    };
  }

  throw new McpError(JsonRpcErrorCode.INVALID_PARAMS, `Unknown prompt: ${name}`);
}
