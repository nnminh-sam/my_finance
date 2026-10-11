import { config } from "./config";
import { createStore } from "./auth/store";
import { createApplication } from "./application";
import { createFinanceStore } from "./finance/store";

const store = createStore(config.databaseUrl);
const app = createApplication(config, store, createFinanceStore(config.databaseUrl));
export default app;
