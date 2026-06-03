import type { WorkerRequest, WorkerReply, SqliteMigration } from "./types.js";
import type { SqlQuery } from "./sql.js";

// Client-side proxy to the SQLite SharedWorker.
// All methods are async — they send a message and wait for the reply.
export interface SqliteClient {
  /** Run a SELECT (or any read-only statement). Returns typed rows. */
  query<T = Record<string, unknown>>(q: SqlQuery): Promise<T[]>;
  /** Run an INSERT / UPDATE / DELETE. Returns number of changed rows. */
  mutate(q: SqlQuery): Promise<number>;
  /**
   * Run multiple statements atomically.
   * Wrap writes that must succeed together (e.g. update row + enqueue push).
   */
  transaction(queries: SqlQuery[]): Promise<void>;
}

// Options passed to createSqliteClient.
export interface SqliteClientOptions {
  /** Database file name (without extension). */
  name: string;
  /** Ordered migration list. Run on startup if user_version is behind. */
  migrations: SqliteMigration[];
}

// Monotonically increasing request ID — simple and collision-free per tab.
let _nextId = 0;
function nextId(): string {
  return String(++_nextId);
}

function send(port: MessagePort, msg: WorkerRequest): Promise<WorkerReply> {
  return new Promise((resolve, reject) => {
    const id = msg.id;

    function onMessage(event: MessageEvent<WorkerReply>) {
      if (event.data.id !== id) return;
      port.removeEventListener("message", onMessage);
      resolve(event.data);
    }

    port.addEventListener("message", onMessage);
    port.postMessage(msg);

    // Safety timeout — avoids hanging promises if the worker dies.
    setTimeout(() => {
      port.removeEventListener("message", onMessage);
      reject(new Error(`[sqlite] Request ${id} timed out`));
    }, 30_000);
  });
}

// Create a SqliteClient connected to the shared SQLite worker.
// Call once per app entry point (entry.client.tsx).
// The worker is shared across all tabs — createSqliteClient is safe to call
// in every tab; they all connect to the same SharedWorker instance.
export async function createSqliteClient(
  options: SqliteClientOptions,
): Promise<SqliteClient> {
  // Vite resolves `new URL(...)` statically to produce a correct worker URL
  // that points to the bundled worker chunk, even when this code runs from
  // inside node_modules/@chromatis/base.
  const workerUrl = new URL("./worker.ts", import.meta.url);
  const shared = new SharedWorker(workerUrl, { type: "module", name: "sqlite" });
  const port = shared.port;

  // Initialize the database (migrations run on first connect only).
  const initReply = await send(port, {
    id: nextId(),
    type: "init",
    name: options.name,
    migrations: options.migrations,
  });

  if ("error" in initReply) {
    throw new Error(`[sqlite] Init failed: ${initReply.error}`);
  }

  function assertSuccess(reply: WorkerReply): void {
    if ("error" in reply) throw new Error(`[sqlite] ${reply.error}`);
  }

  return {
    async query<T = Record<string, unknown>>(q: SqlQuery): Promise<T[]> {
      const reply = await send(port, { id: nextId(), type: "query", sql: q.text, params: q.params });
      assertSuccess(reply);
      return ("rows" in reply ? reply.rows : []) as T[];
    },

    async mutate(q: SqlQuery): Promise<number> {
      const reply = await send(port, { id: nextId(), type: "mutate", sql: q.text, params: q.params });
      assertSuccess(reply);
      return "changes" in reply ? reply.changes : 0;
    },

    async transaction(queries: SqlQuery[]): Promise<void> {
      const reply = await send(port, {
        id: nextId(),
        type: "transaction",
        queries: queries.map((q) => ({ sql: q.text, params: q.params })),
      });
      assertSuccess(reply);
    },
  };
}
