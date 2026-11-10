import { authenticateRequest, HttpError } from "../auth/http";
import type { AuthStore } from "../auth/store";
import { loadPlanPeriodSummary } from "./periodSummary";
import type { FinanceStore } from "./store";
import { categoryMerge, incomeInput, pagination, planDate, planExceptionInput, planInput, planSummaryDate, repeatRuleInput, settingsPatch, spendingInput, transactionInput, transactionKind, uuid } from "./validation";

function planId(value: unknown): string {
  try { return uuid(value); }
  catch { throw new HttpError(404, "Plan not found"); }
}

function incomeId(value: unknown): string {
  try { return uuid(value); }
  catch { throw new HttpError(404, "Income not found"); }
}

function repeatRuleId(value: unknown): string {
  try { return uuid(value); }
  catch { throw new HttpError(404, "Repeat rule not found"); }
}

function parseQuery(searchParams: URLSearchParams): Record<string, unknown> {
  const query: Record<string, unknown> = {};
  const keys = new Set<string>();
  for (const [key] of searchParams.entries()) {
    keys.add(key);
  }
  for (const key of keys) {
    const bracketMatch = /^([^[\]]+)\[/.exec(key);
    if (bracketMatch) {
      query[bracketMatch[1]] = {};
      continue;
    }
    const all = searchParams.getAll(key);
    query[key] = all.length > 1 ? all : all[0];
  }
  return query;
}

export async function handleFinanceRequest(
  request: Request,
  subpath: string,
  url: URL,
  body: unknown,
  authStore: AuthStore,
  store: FinanceStore,
  responseHeaders: Headers,
): Promise<Response> {
  responseHeaders.set("Cache-Control", "no-store");
  const user = await authenticateRequest(request, authStore);
  const method = request.method.toUpperCase();
  const query = parseQuery(url.searchParams);

  function jsonResponse(payload: unknown, status = 200): Response {
    responseHeaders.set("Content-Type", "application/json; charset=utf-8");
    return new Response(method === "HEAD" ? null : JSON.stringify(payload), {
      status,
      headers: responseHeaders,
    });
  }

  if (subpath === "/settings") {
    if (method === "GET" || method === "HEAD") {
      return jsonResponse({ settings: await store.getSettings(user.id) });
    }
    if (method === "PUT") {
      const settings = await store.updateSettings(user.id, settingsPatch(body));
      if (settings === "invalid-budget-period") throw new HttpError(400, "Paycheck period needs one of your weekly, twice-a-month or monthly incomes");
      return jsonResponse({ settings });
    }
  }

  if (subpath === "/settings/categories/merge" && method === "POST") {
    const { from, into } = categoryMerge(body);
    const result = await store.mergeCategory(user.id, from, into);
    if (result === "invalid-category") throw new HttpError(400, "Both categories must exist, and the one to merge into must not be archived");
    return jsonResponse(result);
  }

  if (subpath === "/spendings") {
    if (method === "GET" || method === "HEAD") {
      const { limit, cursor, startDate, endDate } = pagination(query);
      return jsonResponse(
        startDate || endDate
          ? await store.listSpendings(user.id, limit, cursor, startDate, endDate)
          : await store.listSpendings(user.id, limit, cursor),
      );
    }
    if (method === "POST") {
      const spending = await store.createSpending(user.id, spendingInput(body));
      if (!spending) throw new HttpError(400, "Category must exist in current settings");
      return jsonResponse({ spending }, 201);
    }
  }

  const spendingMatch = /^\/spendings\/([^/]+)$/.exec(subpath);
  if (spendingMatch) {
    const rawId = decodeURIComponent(spendingMatch[1]);
    if (method === "PUT") {
      const spending = await store.updateSpending(user.id, uuid(rawId), spendingInput(body));
      if (spending === "not-found") throw new HttpError(404, "Spending not found");
      if (spending === "invalid-category") throw new HttpError(400, "Category must exist in current settings");
      return jsonResponse({ spending });
    }
    if (method === "DELETE") {
      if (!await store.deleteSpending(user.id, uuid(rawId))) throw new HttpError(404, "Spending not found");
      return new Response(null, { status: 204, headers: responseHeaders });
    }
  }

  // Every real money movement: spendings (kind expense) and income received (kind income).
  if (subpath === "/transactions" && (method === "GET" || method === "HEAD")) {
    const { limit, cursor, startDate, endDate } = pagination(query);
    return jsonResponse(await store.listTransactions(user.id, limit, cursor, startDate, endDate, transactionKind(query)));
  }

  const transactionMatch = /^\/transactions\/([^/]+)$/.exec(subpath);
  if (transactionMatch) {
    const rawId = decodeURIComponent(transactionMatch[1]);
    if (method === "PUT") {
      const transaction = await store.updateTransaction(user.id, uuid(rawId), transactionInput(body));
      if (transaction === "not-found") throw new HttpError(404, "Transaction not found");
      if (transaction === "invalid-category") throw new HttpError(400, "Category must exist in current settings");
      return jsonResponse({ transaction });
    }
    if (method === "DELETE") {
      if (!await store.deleteTransaction(user.id, uuid(rawId))) throw new HttpError(404, "Transaction not found");
      return new Response(null, { status: 204, headers: responseHeaders });
    }
  }

  if (subpath === "/incomes") {
    if (method === "GET" || method === "HEAD") {
      const { limit, cursor } = pagination(query);
      return jsonResponse(await store.listIncomes(user.id, limit, cursor));
    }
    if (method === "POST") {
      const income = await store.createIncome(user.id, incomeInput(body));
      return jsonResponse({ income }, 201);
    }
  }

  const incomeMatch = /^\/incomes\/([^/]+)$/.exec(subpath);
  if (incomeMatch) {
    const rawId = decodeURIComponent(incomeMatch[1]);
    if (method === "PUT") {
      const income = await store.updateIncome(user.id, incomeId(rawId), incomeInput(body));
      if (!income) throw new HttpError(404, "Income not found");
      if (income === "paycheck-in-use") throw new HttpError(400, "This income sets the paycheck budget period, so it must stay weekly, twice a month or monthly");
      return jsonResponse({ income });
    }
    if (method === "DELETE") {
      if (!await store.deleteIncome(user.id, incomeId(rawId))) throw new HttpError(404, "Income not found");
      return new Response(null, { status: 204, headers: responseHeaders });
    }
  }

  if (subpath === "/repeat-rules") {
    if (method === "GET" || method === "HEAD") {
      return jsonResponse({ repeatRules: await store.listRepeatRules(user.id) });
    }
    if (method === "POST") {
      const result = await store.createRepeatRule(user.id, repeatRuleInput(body));
      if (!result) throw new HttpError(400, "Category must exist in current settings");
      return jsonResponse(result, 201);
    }
  }

  if (subpath === "/repeat-rules/sync" && method === "POST") {
    const recordBody = body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : undefined;
    const asOfDate = typeof recordBody?.asOfDate === "string" ? recordBody.asOfDate : undefined;
    const spendingsCreated = await store.syncRepeatSpendings(user.id, asOfDate);
    return jsonResponse({ spendingsCreated });
  }

  const repeatMatch = /^\/repeat-rules\/([^/]+)$/.exec(subpath);
  if (repeatMatch && method === "DELETE") {
    const rawId = decodeURIComponent(repeatMatch[1]);
    const deleteFuture = url.searchParams.get("deleteFuture") !== "false";
    if (!await store.deleteRepeatRule(user.id, repeatRuleId(rawId), deleteFuture)) {
      throw new HttpError(404, "Repeat rule not found");
    }
    return new Response(null, { status: 204, headers: responseHeaders });
  }

  if (subpath === "/plans") {
    if (method === "GET" || method === "HEAD") {
      return jsonResponse({ plans: await store.listPlans(user.id) });
    }
    if (method === "POST") {
      const plan = await store.createPlan(user.id, planInput(body));
      if (plan === "invalid-category") throw new HttpError(400, "Category must exist in current settings");
      return jsonResponse({ plan }, 201);
    }
  }

  // Before the /plans/<id> matcher below, otherwise "summary" would be read as a plan id.
  if (subpath === "/plans/summary" && (method === "GET" || method === "HEAD")) {
    return jsonResponse({ summary: await loadPlanPeriodSummary(store, user.id, planSummaryDate(query)) });
  }

  const planSplitMatch = /^\/plans\/([^/]+)\/split$/.exec(subpath);
  if (planSplitMatch && method === "POST") {
    const result = await store.splitPlan(user.id, planId(decodeURIComponent(planSplitMatch[1])), planInput(body));
    if (result === "not-found") throw new HttpError(404, "Plan not found");
    if (result === "invalid-category") throw new HttpError(400, "Category must exist in current settings");
    if (result === "invalid-date") throw new HttpError(400, "Invalid startDate (a split must start after the plan's start date)");
    return jsonResponse(result, 201);
  }

  const planDoneMatch = /^\/plans\/([^/]+)\/occurrences\/([^/]+)\/done$/.exec(subpath);
  if (planDoneMatch && method === "POST") {
    const result = await store.completePlanOccurrence(user.id, planId(decodeURIComponent(planDoneMatch[1])), planDate(decodeURIComponent(planDoneMatch[2])));
    if (result === "not-found") throw new HttpError(404, "Plan not found");
    if (result === "invalid-date") throw new HttpError(400, "Invalid date (must be an upcoming occurrence of this plan)");
    return jsonResponse({ spending: result }, 201);
  }

  const planExceptionMatch = /^\/plans\/([^/]+)\/exceptions\/([^/]+)$/.exec(subpath);
  if (planExceptionMatch && (method === "PUT" || method === "DELETE")) {
    const id = planId(decodeURIComponent(planExceptionMatch[1]));
    const date = planDate(decodeURIComponent(planExceptionMatch[2]));
    const plan = method === "PUT"
      ? await store.setPlanException(user.id, id, date, planExceptionInput(body))
      : await store.deletePlanException(user.id, id, date);
    if (plan === "not-found") throw new HttpError(404, "Plan not found");
    if (plan === "invalid-date") throw new HttpError(400, "Invalid date (must be an upcoming occurrence of this plan)");
    return jsonResponse({ plan });
  }

  const planMatch = /^\/plans\/([^/]+)$/.exec(subpath);
  if (planMatch && (method === "PUT" || method === "DELETE")) {
    const id = planId(decodeURIComponent(planMatch[1]));
    if (method === "DELETE") {
      if (!await store.deletePlan(user.id, id)) throw new HttpError(404, "Plan not found");
      return new Response(null, { status: 204, headers: responseHeaders });
    }
    const plan = await store.updatePlan(user.id, id, planInput(body));
    if (plan === "not-found") throw new HttpError(404, "Plan not found");
    if (plan === "invalid-category") throw new HttpError(400, "Category must exist in current settings");
    return jsonResponse({ plan });
  }

  throw new HttpError(404, "Not found");
}
