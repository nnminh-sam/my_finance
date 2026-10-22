import { authenticateRequest, HttpError } from "../auth/http";
import type { AuthStore } from "../auth/store";
import type { FinanceStore } from "./store";
import { incomeInput, pagination, repeatRuleInput, settingsPatch, spendingInput, uuid } from "./validation";

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
      return jsonResponse({ settings: await store.updateSettings(user.id, settingsPatch(body)) });
    }
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

  throw new HttpError(404, "Not found");
}
