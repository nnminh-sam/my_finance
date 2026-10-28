import { format } from "date-fns";
import type { User } from "../auth/store";
import { CATEGORY_ICONS } from "../finance/model";
import type { FinanceStore } from "../finance/store";
import { getMonthIncome } from "../../lib/income";
import { monthlyRepeatCost } from "../../lib/repeatRules";
import {
  buildDateRangeSummary,
  buildMonthlyAnalyticsReport,
  buildSalaryCycleReport,
  enrichIncome,
  enrichRepeatRule,
  fetchAllIncomes,
  fetchAllSpendings,
} from "./data";
import {
  JsonRpcErrorCode,
  McpError,
  type McpResourceDefinition,
  type McpResourceTemplateDefinition,
} from "./protocol";

export const MCP_RESOURCES: McpResourceDefinition[] = [
  {
    uri: "finance://profile",
    name: "User Profile & Categories",
    description: "Authenticated user profile, configured spending categories (ID, name, color, icon), and avatar.",
    mimeType: "application/json",
  },
  {
    uri: "finance://overview/current-month",
    name: "Current Month Financial Overview",
    description: "Complete financial snapshot for the current calendar month, including income, spending, forecast, category breakdown, anomalies, and insights.",
    mimeType: "application/json",
  },
  {
    uri: "finance://incomes",
    name: "Income Sources",
    description: "All recurring and one-time income sources configured by the user, plus current month income totals.",
    mimeType: "application/json",
  },
  {
    uri: "finance://repeat-rules",
    name: "Recurring Spending Rules",
    description: "All active repeat spending rules, schedules, and estimated monthly recurring cost.",
    mimeType: "application/json",
  },
];

export const MCP_RESOURCE_TEMPLATES: McpResourceTemplateDefinition[] = [
  {
    uriTemplate: "finance://analytics/{month}",
    name: "Monthly Analytics by Month (YYYY-MM)",
    description: "Detailed statistical monthly analytics, category shares, MoM comparison, forecast, and insights for any YYYY-MM month.",
    mimeType: "application/json",
  },
  {
    uriTemplate: "finance://salary-cycle/{month}",
    name: "Salary Cycle Report by Month (YYYY-MM)",
    description: "Pay-cycle spending, anchor month income, leftover balance, and daily burn rate for any YYYY-MM cycle month.",
    mimeType: "application/json",
  },
  {
    uriTemplate: "finance://spendings/{startDate}/{endDate}",
    name: "Spendings by Date Range",
    description: "All spending transactions and summary statistics between startDate (YYYY-MM-DD) and endDate (YYYY-MM-DD) inclusive.",
    mimeType: "application/json",
  },
];

function jsonContent(uri: string, payload: unknown) {
  return {
    contents: [
      {
        uri,
        mimeType: "application/json",
        text: JSON.stringify(payload, null, 2),
      },
    ],
  };
}

export async function readMcpResource(
  uri: string,
  user: User,
  financeStore: FinanceStore,
): Promise<{ contents: Array<{ uri: string; mimeType: string; text: string }> }> {
  if (uri === "finance://profile") {
    const settings = await financeStore.getSettings(user.id);
    return jsonContent(uri, {
      user,
      settings,
      availableIcons: [...CATEGORY_ICONS],
    });
  }

  if (uri === "finance://overview/current-month") {
    const month = format(new Date(), "yyyy-MM");
    const report = await buildMonthlyAnalyticsReport(financeStore, user.id, month);
    return jsonContent(uri, report);
  }

  if (uri === "finance://incomes") {
    const month = format(new Date(), "yyyy-MM");
    const incomes = await fetchAllIncomes(financeStore, user.id);
    const monthBreakdown = getMonthIncome(month, incomes);
    return jsonContent(uri, {
      currentMonth: month,
      monthlyTotal: monthBreakdown.totalIncome,
      recurringIncome: monthBreakdown.recurringIncome,
      oneTimeIncome: monthBreakdown.oneTimeIncome,
      incomes: incomes.map(inc => enrichIncome(inc, month)),
    });
  }

  if (uri === "finance://repeat-rules") {
    const [settings, rules] = await Promise.all([
      financeStore.getSettings(user.id),
      financeStore.listRepeatRules(user.id),
    ]);
    const estimatedMonthlyTotal = Math.round(
      rules.reduce((sum, rule) => sum + monthlyRepeatCost(rule), 0) * 100,
    ) / 100;
    return jsonContent(uri, {
      estimatedMonthlyTotal,
      count: rules.length,
      repeatRules: rules.map(rule => enrichRepeatRule(rule, settings)),
    });
  }

  const analyticsMatch = /^finance:\/\/analytics\/(\d{4}-(?:0[1-9]|1[0-2]))$/.exec(uri);
  if (analyticsMatch) {
    const report = await buildMonthlyAnalyticsReport(financeStore, user.id, analyticsMatch[1]);
    return jsonContent(uri, report);
  }

  const cycleMatch = /^finance:\/\/salary-cycle\/(\d{4}-(?:0[1-9]|1[0-2]))$/.exec(uri);
  if (cycleMatch) {
    const report = await buildSalaryCycleReport(financeStore, user.id, cycleMatch[1]);
    return jsonContent(uri, report);
  }

  const spendingsRangeMatch = /^finance:\/\/spendings\/(\d{4}-\d{2}-\d{2})\/(\d{4}-\d{2}-\d{2})$/.exec(uri);
  if (spendingsRangeMatch) {
    const [, startDate, endDate] = spendingsRangeMatch;
    if (endDate < startDate) {
      throw new McpError(JsonRpcErrorCode.INVALID_PARAMS, "endDate cannot be before startDate");
    }
    const [summary, spendings] = await Promise.all([
      buildDateRangeSummary(financeStore, user.id, startDate, endDate),
      fetchAllSpendings(financeStore, user.id, startDate, endDate),
    ]);
    return jsonContent(uri, { ...summary, spendings });
  }

  throw new McpError(JsonRpcErrorCode.INVALID_PARAMS, `Resource not found: ${uri}`);
}
