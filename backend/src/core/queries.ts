import { randomUUID } from "node:crypto";
import { validateDefinition } from "./dag.js";
import { pool, RUN_SUMMARY_SQL, toRun, toRunSummary, toTask, toTaskLog, toWorkflow, tx } from "./db.js";
import { syncSchedule } from "./queue.js";
import { publishEvent } from "./redis.js";
import { HttpError, RUN_STATUSES, type Run, type RunSummary, type Task, type TaskLog, type Workflow } from "./types.js";

/* ---------------------------------------- workflows ---------------------------------------- */

export interface WorkflowInput {
  name: string;
  description?: string;
  definition: unknown;
  schedule?: string | null;
  enabled?: boolean;
}

export interface WorkflowListItem extends Workflow {
  runCount: number;
  lastRun: { id: string; status: string; createdAt: string } | null;
}

function checkDefinition(raw: unknown) {
  const result = validateDefinition(raw);
  if (!result.ok) throw new HttpError(400, "Invalid workflow definition", { issues: result.issues });
  return result.definition;
}

async function applySchedule(workflowId: string, schedule: string | null, enabled: boolean) {
  try {
    await syncSchedule(workflowId, schedule, enabled);
  } catch (err) {
    throw new HttpError(400, `Invalid cron schedule "${schedule}": ${(err as Error).message}`);
  }
}

export async function listWorkflows(): Promise<WorkflowListItem[]> {
  const { rows } = await pool.query(`
    SELECT w.*,
           (SELECT count(*) FROM runs r WHERE r.workflow_id = w.id) AS run_count,
           (SELECT json_build_object('id', r.id, 'status', r.status, 'createdAt', r.created_at)
              FROM runs r WHERE r.workflow_id = w.id ORDER BY r.created_at DESC LIMIT 1) AS last_run
    FROM workflows w ORDER BY w.updated_at DESC`);
  return rows.map((r) => ({ ...toWorkflow(r), runCount: r.run_count, lastRun: r.last_run }));
}

export async function getWorkflow(id: string): Promise<Workflow> {
  const { rows } = await pool.query("SELECT * FROM workflows WHERE id = $1", [id]);
  if (!rows[0]) throw new HttpError(404, `Workflow ${id} not found`);
  return toWorkflow(rows[0]);
}

export async function createWorkflow(input: WorkflowInput, actor: string): Promise<Workflow> {
  const definition = checkDefinition(input.definition);
  const id = randomUUID();
  const workflow = await tx(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO workflows (id, name, description, definition, schedule, enabled)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [id, input.name, input.description ?? "", JSON.stringify(definition), input.schedule || null, input.enabled ?? true],
    );
    await client.query(
      "INSERT INTO audit_log (actor, action, target_type, target_id) VALUES ($1, 'workflow.create', 'workflow', $2)",
      [actor, id],
    );
    const created = toWorkflow(rows[0]);
    await applySchedule(created.id, created.schedule, created.enabled);
    return created;
  });
  await publishEvent({ type: "workflow.updated", workflowId: id });
  return workflow;
}

export async function updateWorkflow(id: string, input: WorkflowInput, actor: string): Promise<Workflow> {
  const definition = checkDefinition(input.definition);
  const workflow = await tx(async (client) => {
    const { rows } = await client.query(
      `UPDATE workflows SET name = $2, description = $3, definition = $4, schedule = $5, enabled = $6,
              version = version + 1, updated_at = now()
       WHERE id = $1 RETURNING *`,
      [id, input.name, input.description ?? "", JSON.stringify(definition), input.schedule || null, input.enabled ?? true],
    );
    if (!rows[0]) throw new HttpError(404, `Workflow ${id} not found`);
    await client.query(
      "INSERT INTO audit_log (actor, action, target_type, target_id) VALUES ($1, 'workflow.update', 'workflow', $2)",
      [actor, id],
    );
    const updated = toWorkflow(rows[0]);
    await applySchedule(updated.id, updated.schedule, updated.enabled);
    return updated;
  });
  await publishEvent({ type: "workflow.updated", workflowId: id });
  return workflow;
}

export async function deleteWorkflow(id: string, actor: string): Promise<void> {
  const { rows } = await pool.query("SELECT count(*) AS active FROM runs WHERE workflow_id = $1 AND status IN ('running','paused')", [id]);
  if (rows[0].active > 0) throw new HttpError(409, "Workflow has active runs; cancel them first");
  const res = await pool.query("DELETE FROM workflows WHERE id = $1", [id]);
  if (!res.rowCount) throw new HttpError(404, `Workflow ${id} not found`);
  await pool.query("INSERT INTO audit_log (actor, action, target_type, target_id) VALUES ($1, 'workflow.delete', 'workflow', $2)", [actor, id]);
  await syncSchedule(id, null, false);
  await publishEvent({ type: "workflow.updated", workflowId: id });
}

/* ------------------------------------------ runs ------------------------------------------- */

export async function listRuns(filter: { status?: string; workflowId?: string; limit?: number; offset?: number }): Promise<{ runs: RunSummary[]; total: number }> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filter.status) {
    const statuses = filter.status.split(",").filter((s) => (RUN_STATUSES as readonly string[]).includes(s));
    if (statuses.length) {
      params.push(statuses);
      where.push(`r.status = ANY($${params.length})`);
    }
  }
  if (filter.workflowId) {
    params.push(filter.workflowId);
    where.push(`r.workflow_id = $${params.length}`);
  }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200);
  const offset = Math.max(filter.offset ?? 0, 0);

  const [list, count] = await Promise.all([
    pool.query(`${RUN_SUMMARY_SQL} ${clause} GROUP BY r.id ORDER BY r.created_at DESC LIMIT ${limit} OFFSET ${offset}`, params),
    pool.query(`SELECT count(*) AS total FROM runs r ${clause}`, params),
  ]);
  return { runs: list.rows.map(toRunSummary), total: count.rows[0].total };
}

export async function getRunDetail(id: string): Promise<{ run: Run; tasks: Task[] }> {
  const [run, tasks] = await Promise.all([
    pool.query("SELECT * FROM runs WHERE id = $1", [id]),
    pool.query("SELECT * FROM tasks WHERE run_id = $1", [id]),
  ]);
  if (!run.rows[0]) throw new HttpError(404, `Run ${id} not found`);
  return { run: toRun(run.rows[0]), tasks: tasks.rows.map(toTask) };
}

export async function getRunLogs(runId: string, afterId = 0, taskId?: string): Promise<TaskLog[]> {
  const params: unknown[] = [runId, afterId];
  let sql = "SELECT * FROM task_logs WHERE run_id = $1 AND id > $2";
  if (taskId) {
    params.push(taskId);
    sql += " AND task_id = $3";
  }
  const { rows } = await pool.query(`${sql} ORDER BY id LIMIT 2000`, params);
  return rows.map(toTaskLog);
}

export async function getTask(id: string): Promise<{ task: Task; logs: TaskLog[] }> {
  const { rows } = await pool.query("SELECT * FROM tasks WHERE id = $1", [id]);
  if (!rows[0]) throw new HttpError(404, `Task ${id} not found`);
  const task = toTask(rows[0]);
  return { task, logs: await getRunLogs(task.runId, 0, id) };
}

/* ----------------------------------------- metrics ----------------------------------------- */

export async function metricsSummary() {
  const [runs, tasks, duration] = await Promise.all([
    pool.query(`
      SELECT count(*) FILTER (WHERE status = 'running')                                             AS running,
             count(*) FILTER (WHERE status = 'paused')                                              AS paused,
             count(*) FILTER (WHERE status = 'succeeded' AND finished_at > now() - interval '24 hours') AS succeeded_24h,
             count(*) FILTER (WHERE status = 'failed'    AND finished_at > now() - interval '24 hours') AS failed_24h,
             count(*) FILTER (WHERE created_at > now() - interval '24 hours')                        AS started_24h
      FROM runs`),
    pool.query(`
      SELECT count(*) FILTER (WHERE status = 'queued')           AS queued,
             count(*) FILTER (WHERE status = 'running')          AS running,
             count(*) FILTER (WHERE status = 'waiting_approval') AS waiting_approval
      FROM tasks WHERE status IN ('queued','running','waiting_approval')`),
    pool.query(`
      SELECT coalesce(avg(extract(epoch FROM finished_at - started_at)) * 1000, 0)::int AS avg_ms,
             coalesce(percentile_cont(0.95) WITHIN GROUP (ORDER BY extract(epoch FROM finished_at - started_at)) * 1000, 0)::int AS p95_ms
      FROM tasks WHERE status = 'succeeded' AND finished_at > now() - interval '1 hour'`),
  ]);
  const r = runs.rows[0];
  const t = tasks.rows[0];
  const finished = r.succeeded_24h + r.failed_24h;
  return {
    runs: {
      running: r.running,
      paused: r.paused,
      succeeded24h: r.succeeded_24h,
      failed24h: r.failed_24h,
      started24h: r.started_24h,
      successRate24h: finished ? r.succeeded_24h / finished : null,
    },
    tasks: { queued: t.queued, running: t.running, waitingApproval: t.waiting_approval },
    taskDuration: { avgMs: duration.rows[0].avg_ms, p95Ms: duration.rows[0].p95_ms },
  };
}

export async function throughput(minutes: number) {
  const window = Math.min(Math.max(minutes, 5), 24 * 60);
  const { rows } = await pool.query(
    `SELECT date_trunc('minute', finished_at) AS minute,
            count(*) FILTER (WHERE status = 'succeeded') AS succeeded,
            count(*) FILTER (WHERE status = 'failed')    AS failed
     FROM tasks WHERE finished_at > now() - make_interval(mins => $1)
     GROUP BY 1 ORDER BY 1`,
    [window],
  );
  const byMinute = new Map(rows.map((r) => [new Date(r.minute).getTime(), r]));
  const now = new Date();
  now.setSeconds(0, 0);
  const points = [];
  for (let i = window - 1; i >= 0; i--) {
    const t = now.getTime() - i * 60_000;
    const row = byMinute.get(t);
    points.push({ minute: new Date(t).toISOString(), succeeded: row?.succeeded ?? 0, failed: row?.failed ?? 0 });
  }
  return points;
}

export async function listAudit(limit = 100) {
  const { rows } = await pool.query("SELECT * FROM audit_log ORDER BY id DESC LIMIT $1", [Math.min(limit, 500)]);
  return rows.map((r) => ({
    id: r.id,
    actor: r.actor,
    action: r.action,
    targetType: r.target_type,
    targetId: r.target_id,
    details: r.details,
    createdAt: r.created_at,
  }));
}
