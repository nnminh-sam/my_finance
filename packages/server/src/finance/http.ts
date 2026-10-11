import { Router } from "express";
import { asyncHandler, HttpError, requireAuth } from "../auth/http";
import type { AuthStore } from "../auth/store";
import type { FinanceStore } from "./store";
import { incomeEntryInput, pagination, repeatRuleInput, settingsPatch, spendingInput, uuid } from "./validation";

function incomeEntryId(value: unknown): string {
  try { return uuid(value); }
  catch { throw new HttpError(404, "Income entry not found"); }
}

function repeatRuleId(value: unknown): string {
  try { return uuid(value); }
  catch { throw new HttpError(404, "Repeat rule not found"); }
}

export function financeRouter(authStore: AuthStore, store: FinanceStore): Router {
  const router = Router();
  router.use((_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
  router.use(requireAuth(authStore));
  router.get("/settings", asyncHandler(async (_req, res) => {
    res.json({ settings: await store.getSettings(res.locals.user.id) });
  }));
  router.put("/settings", asyncHandler(async (req, res) => {
    res.json({ settings: await store.updateSettings(res.locals.user.id, settingsPatch(req.body)) });
  }));
  router.get("/spendings", asyncHandler(async (req, res) => {
    const { limit, cursor } = pagination(req.query);
    res.json(await store.listSpendings(res.locals.user.id, limit, cursor));
  }));
  router.post("/spendings", asyncHandler(async (req, res) => {
    const spending = await store.createSpending(res.locals.user.id, spendingInput(req.body));
    if (!spending) throw new HttpError(400, "Category must exist in current settings");
    res.status(201).json({ spending });
  }));
  router.put("/spendings/:id", asyncHandler(async (req, res) => {
    const spending = await store.updateSpending(res.locals.user.id, uuid(req.params.id), spendingInput(req.body));
    if (spending === "not-found") throw new HttpError(404, "Spending not found");
    if (spending === "invalid-category") throw new HttpError(400, "Category must exist in current settings");
    res.json({ spending });
  }));
  router.delete("/spendings/:id", asyncHandler(async (req, res) => {
    if (!await store.deleteSpending(res.locals.user.id, uuid(req.params.id))) throw new HttpError(404, "Spending not found");
    res.status(204).end();
  }));
  router.get("/income-entries", asyncHandler(async (req, res) => {
    const { limit, cursor } = pagination(req.query);
    res.json(await store.listIncomeEntries(res.locals.user.id, limit, cursor));
  }));
  router.post("/income-entries", asyncHandler(async (req, res) => {
    const incomeEntry = await store.createIncomeEntry(res.locals.user.id, incomeEntryInput(req.body));
    res.status(201).json({ incomeEntry });
  }));
  router.put("/income-entries/:id", asyncHandler(async (req, res) => {
    const incomeEntry = await store.updateIncomeEntry(res.locals.user.id, incomeEntryId(req.params.id), incomeEntryInput(req.body));
    if (!incomeEntry) throw new HttpError(404, "Income entry not found");
    res.json({ incomeEntry });
  }));
  router.delete("/income-entries/:id", asyncHandler(async (req, res) => {
    if (!await store.deleteIncomeEntry(res.locals.user.id, incomeEntryId(req.params.id))) throw new HttpError(404, "Income entry not found");
    res.status(204).end();
  }));
  router.get("/repeat-rules", asyncHandler(async (_req, res) => {
    res.json({ repeatRules: await store.listRepeatRules(res.locals.user.id) });
  }));
  router.post("/repeat-rules", asyncHandler(async (req, res) => {
    const result = await store.createRepeatRule(res.locals.user.id, repeatRuleInput(req.body));
    if (!result) throw new HttpError(400, "Category must exist in current settings");
    res.status(201).json(result);
  }));
  router.delete("/repeat-rules/:id", asyncHandler(async (req, res) => {
    const deleteFuture = req.query.deleteFuture !== "false";
    if (!await store.deleteRepeatRule(res.locals.user.id, repeatRuleId(req.params.id), deleteFuture)) {
      throw new HttpError(404, "Repeat rule not found");
    }
    res.status(204).end();
  }));
  router.post("/repeat-rules/sync", asyncHandler(async (req, res) => {
    const asOfDate = typeof req.body?.asOfDate === "string" ? req.body.asOfDate : undefined;
    const spendingsCreated = await store.syncRepeatSpendings(res.locals.user.id, asOfDate);
    res.json({ spendingsCreated });
  }));
  return router;
}

