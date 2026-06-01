import { getDbUrl } from "./config.ts";
import { ensureDockerDb } from "./dbDocker.ts";
import { runDbMigrations } from "./dbMigrations.ts";

const url = getDbUrl("local");
ensureDockerDb(url, "start");
await runDbMigrations(url, { seeds: true });
