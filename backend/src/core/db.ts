import pg from "pg";
import { config } from "../config.js";
import { logger } from "./logger.js";
import type { Run, RunSummary, Task, TaskLog, Workflow } from "./types.js";

// Return bigint counts as numbers and timestamps as ISO strings for JSON-friendly rows.
pg.types.setTypeParser(20, (v) => Number.parseInt(v, 10));
pg.types.setTypeParser(1184, (v) => new Date(v).toISOString());

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: Number.parseInt(process.env.DB_POOL_SIZE ?? "10", 10),
});
pool.on("error", (err) => logger.error("postgres pool error", { err }));

export type Db = pg.Pool | pg.PoolClient;

export async function tx<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

const MIGRATIONS: string[] = [
  `
  CREATE TABLE IF NOT EXISTS workflows (
    id          uuid PRIMARY KEY,
    name        text NOT NULL,
    description text NOT NULL DEFAULT '',
    definition  jsonb NOT NULL,
    schedule    text,
    enabled     boolean NOT NULL DEFAULT true,
    version     int NOT NULL DEFAULT 1,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS runs (
    id               uuid PRIMARY KEY,
    workflow_id      uuid NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
    workflow_name    text NOT NULL,
    workflow_version int NOT NULL,
    definition       jsonb NOT NULL,
    status           text NOT NULL,
    trigger          text NOT NULL DEFAULT 'manual',
    input            jsonb NOT NULL DEFAULT '{}',
    output           jsonb,
    error            text,
    created_at       timestamptz NOT NULL DEFAULT now(),
    started_at       timestamptz,
    finished_at      timestamptz
  );
  CREATE INDEX IF NOT EXISTS runs_status_idx ON runs (status);
  CREATE INDEX IF NOT EXISTS runs_created_idx ON runs (created_at DESC);
  CREATE INDEX IF NOT EXISTS runs_workflow_idx ON runs (workflow_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS tasks (
    id           uuid PRIMARY KEY,
    run_id       uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    step_id      text NOT NULL,
    name         text NOT NULL,
    type         text NOT NULL,
    status       text NOT NULL,
    depends_on   text[] NOT NULL DEFAULT '{}',
    attempt      int NOT NULL DEFAULT 0,
    retries_left int NOT NULL DEFAULT 0,
    generation   int NOT NULL DEFAULT 0,
    output       jsonb,
    error        text,
    worker_id    text,
    queued_at    timestamptz,
    started_at   timestamptz,
    finished_at  timestamptz,
    updated_at   timestamptz NOT NULL DEFAULT now(),
    UNIQUE (run_id, step_id)
  );
  CREATE INDEX IF NOT EXISTS tasks_status_idx ON tasks (status);
  CREATE INDEX IF NOT EXISTS tasks_finished_idx ON tasks (finished_at);

  CREATE TABLE IF NOT EXISTS task_logs (
    id         bigserial PRIMARY KEY,
    task_id    uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    run_id     uuid NOT NULL,
    level      text NOT NULL,
    message    text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS task_logs_run_idx ON task_logs (run_id, id);

  CREATE TABLE IF NOT EXISTS audit_log (
    id          bigserial PRIMARY KEY,
    actor       text NOT NULL,
    action      text NOT NULL,
    target_type text NOT NULL,
    target_id   text NOT NULL,
    details     jsonb,
    created_at  timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS audit_created_idx ON audit_log (created_at DESC);
  `,
];

/** Applies pending migrations. Safe to call from every replica: an advisory lock serializes them. */
export async function migrate(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(712001)");
    await client.query("CREATE TABLE IF NOT EXISTS schema_migrations (version int PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
    const { rows } = await client.query<{ version: number }>("SELECT version FROM schema_migrations");
    const applied = new Set(rows.map((r) => r.version));
    for (const [index, sql] of MIGRATIONS.entries()) {
      const version = index + 1;
      if (applied.has(version)) continue;
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (version) VALUES ($1)", [version]);
      await client.query("COMMIT");
      logger.info("applied migration", { version });
    }
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    await client.query("SELECT pg_advisory_unlock(712001)").catch(() => undefined);
    client.release();
  }
}

/* ---------- row mappers ---------- */

type Row = Record<string, any>;

export const toWorkflow = (r: Row): Workflow => ({
  id: r.id,
  name: r.name,
  description: r.description,
  definition: r.definition,
  schedule: r.schedule,
  enabled: r.enabled,
  version: r.version,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export const toRun = (r: Row): Run => ({
  id: r.id,
  workflowId: r.workflow_id,
  workflowName: r.workflow_name,
  workflowVersion: r.workflow_version,
  definition: r.definition,
  status: r.status,
  trigger: r.trigger,
  input: r.input,
  output: r.output,
  error: r.error,
  createdAt: r.created_at,
  startedAt: r.started_at,
  finishedAt: r.finished_at,
});

export const toTask = (r: Row): Task => ({
  id: r.id,
  runId: r.run_id,
  stepId: r.step_id,
  name: r.name,
  type: r.type,
  status: r.status,
  dependsOn: r.depends_on,
  attempt: r.attempt,
  retriesLeft: r.retries_left,
  generation: r.generation,
  output: r.output,
  error: r.error,
  workerId: r.worker_id,
  queuedAt: r.queued_at,
  startedAt: r.started_at,
  finishedAt: r.finished_at,
  updatedAt: r.updated_at,
});

export const toTaskLog = (r: Row): TaskLog => ({
  id: r.id,
  taskId: r.task_id,
  runId: r.run_id,
  level: r.level,
  message: r.message,
  createdAt: r.created_at,
});

/** Run columns plus task progress counters, used by list views and live events. */
export const RUN_SUMMARY_SQL = `
  SELECT r.id, r.workflow_id, r.workflow_name, r.workflow_version, r.status, r.trigger, r.input, r.output,
         r.error, r.created_at, r.started_at, r.finished_at,
         count(t.id)                                                        AS total,
         count(t.id) FILTER (WHERE t.status IN ('succeeded','skipped'))     AS done,
         count(t.id) FILTER (WHERE t.status = 'running')                    AS running_count,
         count(t.id) FILTER (WHERE t.status = 'failed')                     AS failed_count
  FROM runs r LEFT JOIN tasks t ON t.run_id = r.id`;

export const toRunSummary = (r: Row): RunSummary => {
  const { definition: _definition, ...run } = toRun(r);
  return {
    ...run,
    progress: { total: r.total, done: r.done, running: r.running_count, failed: r.failed_count },
  };
};

export async function getRunSummary(db: Db, runId: string): Promise<RunSummary | null> {
  const { rows } = await db.query(`${RUN_SUMMARY_SQL} WHERE r.id = $1 GROUP BY r.id`, [runId]);
  return rows[0] ? toRunSummary(rows[0]) : null;
}
