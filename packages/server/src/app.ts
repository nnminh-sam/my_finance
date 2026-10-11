import { config } from "./config";
import { createStore } from "./auth/store";
import { requireAuth as createAuthMiddleware } from "./auth/http";
import { createApplication } from "./application";
import { createFinanceStore } from "./finance/store";

const store = createStore(config.databaseUrl);

// Protected routes use this middleware and read res.locals.user.
export const requireAuth = createAuthMiddleware(store);
const app = createApplication(config, store, createFinanceStore(config.databaseUrl));
export default app;
