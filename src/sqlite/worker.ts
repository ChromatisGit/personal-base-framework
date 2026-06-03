// SharedWorker entry point for SQLite.
//
// One SharedWorker instance is shared across all tabs for the same origin.
// This gives a single SQLite connection point — no concurrent write conflicts.
//
// Initialization sequence:
//   1. First port connects and sends { type: "init", name, migrations }.
//   2. Worker opens the OPFS database and runs pending migrations.
//   3. All subsequent ports (other tabs) share the same open database.
//   4. Each port handles its own messages independently.
//
// All SQLite APIs used here are synchronous — valid in a Worker context.
// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference lib="webworker" />

import type { WorkerRequest, WorkerReply, SqliteMigration } from "./types.js";

// @sqlite.org/sqlite-wasm does not ship TS declarations; use dynamic import.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sqlite3 = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type OO1DB = any;

declare const self: SharedWorkerGlobalScope;

let db: OO1DB | null = null;
let initPromise: Promise<void> | null = null;

// ─── SQLite helpers ──────────────────────────────────────────────────────────

function runQuery(
  database: OO1DB,
  text: string,
  params: unknown[],
): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  database.exec({
    sql: text,
    bind: params,
    rowMode: "object",
    callback: (row: Record<string, unknown>) => rows.push(row),
  });
  return rows;
}

function runMutate(
  database: OO1DB,
  text: string,
  params: unknown[],
): number {
  database.exec({ sql: text, bind: params });
  return database.changes();
}

function runTransaction(
  database: OO1DB,
  queries: Array<{ sql: string; params: unknown[] }>,
): void {
  database.exec("BEGIN");
  try {
    for (const q of queries) {
      database.exec({ sql: q.sql, bind: q.params });
    }
    database.exec("COMMIT");
  } catch (err) {
    database.exec("ROLLBACK");
    throw err;
  }
}

// ─── Migration runner ────────────────────────────────────────────────────────

function applyMigrations(database: OO1DB, migrations: SqliteMigration[]): void {
  // user_version is a SQLite-managed integer, perfect for migration tracking.
  const [{ user_version }] = runQuery(database, "PRAGMA user_version", []) as
    [{ user_version: number }];

  const pending = migrations
    .filter((m) => m.version > user_version)
    .sort((a, b) => a.version - b.version);

  for (const migration of pending) {
    database.exec("BEGIN");
    try {
      database.exec(migration.sql);
      // PRAGMA inside a transaction must use exec directly (not parameterized).
      database.exec(`PRAGMA user_version = ${migration.version}`);
      database.exec("COMMIT");
    } catch (err) {
      database.exec("ROLLBACK");
      throw err;
    }
  }
}

// ─── Database initialization ─────────────────────────────────────────────────

async function initDB(name: string, migrations: SqliteMigration[]): Promise<void> {
  // Dynamic import avoids bundling the WASM module into the main chunk.
  // Vite resolves this correctly for Worker contexts.
  const { default: sqlite3InitModule } = await import("@sqlite.org/sqlite-wasm");

  const sqlite3: Sqlite3 = await sqlite3InitModule({
    print: () => {},
    printErr: (msg: string) => console.error("[sqlite]", msg),
  });

  // Prefer OPFS SAH pool — synchronous, persistent, no COOP/COEP headers needed.
  if (sqlite3.installOpfsSAHPoolVfs) {
    const poolUtil = await sqlite3.installOpfsSAHPoolVfs({
      name: "opfs-sahpool",
      directory: "/",
    });
    db = new poolUtil.OpfsSAHPoolDb(`/${name}.sqlite3`);
  } else if (sqlite3.oo1?.OpfsDb) {
    // Fallback: standard OPFS (requires COOP/COEP headers).
    db = new sqlite3.oo1.OpfsDb(`/${name}.sqlite3`);
  } else {
    // Fallback: in-memory (dev / unsupported browsers). Data lost on reload.
    console.warn("[sqlite] OPFS not available — using in-memory database");
    db = new sqlite3.oo1.DB(":memory:");
  }

  applyMigrations(db, migrations);
}

// ─── Port message handler ────────────────────────────────────────────────────

function handlePort(port: MessagePort): void {
  port.addEventListener("message", async (event: MessageEvent<WorkerRequest>) => {
    const msg = event.data;

    // init is handled separately — it blocks until the DB is ready.
    if (msg.type === "init") {
      try {
        if (!initPromise) {
          initPromise = initDB(msg.name, msg.migrations);
        }
        await initPromise;
        port.postMessage({ id: msg.id, rows: [] } satisfies WorkerReply);
      } catch (err) {
        port.postMessage({
          id: msg.id,
          error: err instanceof Error ? err.message : String(err),
        } satisfies WorkerReply);
      }
      return;
    }

    // All other messages require the DB to be initialized.
    if (!db) {
      if (initPromise) {
        try {
          await initPromise;
        } catch {
          port.postMessage({ id: msg.id, error: "Database failed to initialize" } satisfies WorkerReply);
          return;
        }
      } else {
        port.postMessage({ id: msg.id, error: "Database not initialized — send init first" } satisfies WorkerReply);
        return;
      }
    }

    try {
      let reply: WorkerReply;
      switch (msg.type) {
        case "query":
          reply = { id: msg.id, rows: runQuery(db, msg.sql, msg.params) };
          break;
        case "mutate":
          reply = { id: msg.id, changes: runMutate(db, msg.sql, msg.params) };
          break;
        case "transaction":
          runTransaction(db, msg.queries);
          reply = { id: msg.id, changes: 0 };
          break;
      }
      port.postMessage(reply);
    } catch (err) {
      port.postMessage({
        id: msg.id,
        error: err instanceof Error ? err.message : String(err),
      } satisfies WorkerReply);
    }
  });

  port.start();
}

// ─── SharedWorker entry ──────────────────────────────────────────────────────

self.addEventListener("connect", (event: MessageEvent) => {
  const port = event.ports[0];
  if (port) handlePort(port);
});
