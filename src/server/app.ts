import { config } from "./config";
import { createStore, type AuthStore } from "./auth/store";
import { createApplication, type Application } from "./application";
import { createFinanceStore, type FinanceStore } from "./finance/store";

let cachedApp: Application | undefined;

export function getApp(): Application {
  if (!cachedApp) {
    const authStore: AuthStore = createStore(config.databaseUrl);
    const financeStore: FinanceStore = createFinanceStore(config.databaseUrl);
    cachedApp = createApplication(config, authStore, financeStore);
  }
  return cachedApp;
}

const app: Application = {
  fetch(request: Request) {
    return getApp().fetch(request);
  },
  listen(port?: number, hostname?: string, listeningListener?: () => void) {
    return getApp().listen(port, hostname, listeningListener);
  },
};

export default app;
