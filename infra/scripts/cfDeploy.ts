import { spawnSync } from "node:child_process";

import { loadConfig, configToEnv } from "./config.ts";

function run(cmd: string, args: string[], opts?: { env?: NodeJS.ProcessEnv }): void {
  const result = spawnSync(cmd, args, {
    env: opts?.env ?? process.env,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function runWithInput(cmd: string, args: string[], input: string): void {
  const result = spawnSync(cmd, args, {
    input,
    stdio: ["pipe", "inherit", "inherit"],
    shell: process.platform === "win32",
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const config = loadConfig("production");
const env = configToEnv(config);

// 1. Sync all production config values to Cloudflare as secrets
console.info("[cf:deploy] Syncing secrets to Cloudflare Workers...");
for (const [key, value] of Object.entries(env)) {
  if (!value) {
    console.warn(`  [!] ${key} is empty in CONFIG.yaml production profile — skipping`);
    continue;
  }
  console.info(`  Setting ${key}...`);
  runWithInput("bun", ["x", "wrangler", "secret", "put", key], value + "\n");
}

// 2. Build the Cloudflare Workers bundle
console.info("\n[cf:deploy] Building Cloudflare Workers bundle...");
run("bun", ["x", "react-router", "build"], { env: { ...process.env, WRANGLER: "1" } });

// 3. Deploy
console.info("\n[cf:deploy] Deploying to Cloudflare Workers...");
run("bun", ["x", "wrangler", "deploy", "--config", "build/server/wrangler.json"]);

console.info("\n[cf:deploy] Done.");
