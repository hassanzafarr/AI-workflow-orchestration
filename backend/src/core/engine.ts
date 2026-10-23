import { randomUUID } from "node:crypto";
import type pg from "pg";
import { config } from "../config.js";
import { leafSteps } from "./dag.js";
import { getRunSummary, pool, toRun, toTask, toTaskLog, toWorkflow, tx } from "./db.js";
import { logger } from "./logger.js";
import { enqueueTask, getTaskQueue, taskJobId } from "./queue.js";
import { publishControl, publishEvent } from "./redis.js";
import { isTruthy, renderString, type TemplateContext } from "./template.js";
import {
  HttpError,
  SATISFIED,
  TERMINAL_TASK,
  type Run,
  type RunSummary,
  type StepDefinition,
  type Task,
  type TaskJobData,
  type TaskStatus,
} from "./types.js";

/**
 * The orchestration engine. All state lives in Postgres; every transition happens inside a
 * transaction holding the run's row lock (runs -> tasks lock order), so API replicas and any
 * number of workers can drive the same run concurrently. Side effects (queueing, pub/sub)
 * are collected and flushed only after commit.
 */

class Effects {
  enqueue: { data: TaskJobData; delayMs: number }[] = [];
  tasks = new Map<string, Task>();
  runs = new Set<string>();
  aborts: { runId?: string; taskIds?: string[]; reason: string }[] = [];

  track(rows: Record<string, unknown>[]): Task[] {
    const tasks = rows.map(toTask);
    for (const t of tasks) {
      this.tasks.set(t.id, t);
      this.runs.add(t.runId);
    }
    return tasks;
  }

  async flush(): Promise<void> {
    for (const { data, delayMs } of this.enqueue) await enqueueTask(data, delayMs);
    for (const abort of this.aborts) await publishControl({ type: "abort", ...abort });
    for (const task of this.tasks.values()) await publishEvent({ type: "task.updated", task });
    for (const runId of this.runs) {
      const run = await getRunSummary(pool, runId);
      if (run) await publishEvent({ type: "run.updated", run });
    }
  }
}

async function withEffects<T>(fn: (client: pg.PoolClient, fx: Effects) => Promise<T>): Promise<T> {
  const fx = new Effects();
  const result = await tx((client) => fn(client, fx));
  await fx.flush();
  return result;
}

async function lockRun(client: pg.PoolClient, runId: string, mode: "UPDATE" | "SHARE" = "UPDATE"): Promise<Run> {
  const { rows } = await client.query(`SELECT * FROM runs WHERE id = $1 FOR ${mode}`, [runId]);
  if (!rows[0]) throw new HttpError(404, `Run ${runId} not found`);
  return toRun(rows[0]);
}

async function lockTask(client: pg.PoolClient, taskId: string): Promise<Task> {
  const { rows } = await client.query("SELECT * FROM tasks WHERE id = $1 FOR UPDATE", [taskId]);
  if (!rows[0]) throw new HttpError(404, `Task ${taskId} not found`);
  return toTask(rows[0]);
}

async function runIdOfTask(taskId: string): Promise<string> {
  const { rows } = await pool.query("SELECT run_id FROM tasks WHERE id = $1", [taskId]);
  if (!rows[0]) throw new HttpError(404, `Task ${taskId} not found`);
  return rows[0].run_id;
}

async function audit(client: pg.PoolClient, actor: string, action: string, targetType: string, targetId: string, details?: unknown) {
  await client.query(
    "INSERT INTO audit_log (actor, action, target_type, target_id, details) VALUES ($1, $2, $3, $4, $5)",
    [actor, action, targetType, targetId, details === undefined ? null : JSON.stringify(details)],
  );
}

export function buildContext(run: Pick<Run, "id" | "workflowId" | "trigger" | "input">, tasks: Pick<Task, "stepId" | "status" | "output">[]): TemplateContext {
  return {
    input: run.input ?? {},
    steps: Object.fromEntries(tasks.map((t) => [t.stepId, { output: t.output, status: t.status }])),
    run: { id: run.id, workflowId: run.workflowId, trigger: run.trigger },
  };
}

const stepOf = (run: Run, stepId: string): StepDefinition => {
  const step = run.definition.steps.find((s) => s.id === stepId);
  if (!step) throw new Error(`Step ${stepId} missing from run ${run.id} definition`);
  return step;
};

/* ------------------------------------------------------------------------------------------ */
/* Core state machine                                                                         */
/* ------------------------------------------------------------------------------------------ */

/**
 * Moves a run forward: fails it fast on a failed step, skips steps whose `when` is falsy,
 * queues steps whose dependencies are satisfied, and completes the run when every step is done.
 * Caller must hold the run lock (or let this take it).
 */
async function advanceInTx(client: pg.PoolClient, runId: string, fx: Effects): Promise<void> {
  const run = await lockRun(client, runId);
  if (run.status !== "running") return;

  const { rows } = await client.query("SELECT * FROM tasks WHERE run_id = $1 ORDER BY step_id FOR UPDATE", [runId]);
  const tasks = rows.map(toTask);
  const byStep = new Map(tasks.map((t) => [t.stepId, t]));

  const failed = tasks.find((t) => t.status === "failed");
  if (failed) {
    const running = tasks.filter((t) => t.status === "running").map((t) => t.id);
    const cancelled = await client.query(
      `UPDATE tasks SET status = 'cancelled', finished_at = now(), updated_at = now(), error = 'Cancelled: another step failed'
       WHERE run_id = $1 AND status IN ('pending','queued','running','waiting_approval') RETURNING *`,
      [runId],
    );
    fx.track(cancelled.rows);
    if (running.length) fx.aborts.push({ taskIds: running, reason: "run failed" });
    await client.query(
      "UPDATE runs SET status = 'failed', error = $2, finished_at = now() WHERE id = $1",
      [runId, `Step "${failed.stepId}" failed: ${failed.error ?? "unknown error"}`],
    );
    fx.runs.add(runId);
    return;
  }

  // Repeat until stable: skipping a step can unlock its dependents in the same pass.
  let changed = true;
  while (changed) {
    changed = false;
    for (const task of byStep.values()) {
      if (task.status !== "pending") continue;
      const ready = task.dependsOn.every((dep) => SATISFIED.has(byStep.get(dep)?.status as TaskStatus));
      if (!ready) continue;

      const step = stepOf(run, task.stepId);
      if (step.when !== undefined) {
        const value = renderString(step.when, buildContext(run, [...byStep.values()]));
        if (!isTruthy(value)) {
          const res = await client.query(
            `UPDATE tasks SET status = 'skipped', output = $2, finished_at = now(), updated_at = now()
             WHERE id = $1 RETURNING *`,
            [task.id, JSON.stringify({ skipped: true, reason: `when condition was ${JSON.stringify(value ?? null)}` })],
          );
          const [updated] = fx.track(res.rows);
          byStep.set(task.stepId, updated!);
          changed = true;
          continue;
        }
      }

      const res = await client.query(
        `UPDATE tasks SET status = 'queued', generation = generation + 1, queued_at = now(), updated_at = now()
         WHERE id = $1 RETURNING *`,
        [task.id],
      );
      const [queued] = fx.track(res.rows);
      byStep.set(task.stepId, queued!);
      fx.enqueue.push({ data: { taskId: queued!.id, runId, generation: queued!.generation }, delayMs: 0 });
    }
  }

  const all = [...byStep.values()];
  if (all.every((t) => TERMINAL_TASK.has(t.status))) {
    const leaves = leafSteps(run.definition);
    const outputs = Object.fromEntries(leaves.map((id) => [id, byStep.get(id)?.output ?? null]));
    const output = leaves.length === 1 ? outputs[leaves[0]!] : outputs;
    await client.query(
      "UPDATE runs SET status = 'succeeded', output = $2, error = NULL, finished_at = now() WHERE id = $1",
      [runId, JSON.stringify(output ?? null)],
    );
    fx.runs.add(runId);
  }
}

/** Re-opens a failed or cancelled run so retried/skipped steps can continue it. */
async function reopenInTx(client: pg.PoolClient, run: Run, fx: Effects, exceptTaskId?: string): Promise<void> {
  if (run.status !== "failed" && run.status !== "cancelled") return;
  const res = await client.query(
    `UPDATE tasks SET status = 'pending', generation = generation + 1, error = NULL, output = NULL,
            started_at = NULL, finished_at = NULL, queued_at = NULL, updated_at = now()
     WHERE run_id = $1 AND status = 'cancelled' AND id IS DISTINCT FROM $2 RETURNING *`,
    [run.id, exceptTaskId ?? null],
  );
  fx.track(res.rows);
  await client.query("UPDATE runs SET status = 'running', error = NULL, finished_at = NULL WHERE id = $1", [run.id]);
  fx.runs.add(run.id);
}

async function resetTaskInTx(client: pg.PoolClient, run: Run, task: Task, fx: Effects): Promise<void> {
  const res = await client.query(
    `UPDATE tasks SET status = 'pending', generation = generation + 1, retries_left = $2, error = NULL, output = NULL,
            started_at = NULL, finished_at = NULL, queued_at = NULL, worker_id = NULL, updated_at = now()
     WHERE id = $1 RETURNING *`,
    [task.id, stepOf(run, task.stepId).retries],
  );
  fx.track(res.rows);
}

/* ------------------------------------------------------------------------------------------ */
/* Runs                                                                                       */
/* ------------------------------------------------------------------------------------------ */

export async function createRun(
  workflowId: string,
  input: Record<string, unknown>,
  trigger: string,
  actor: string,
): Promise<RunSummary> {
  const runId = randomUUID();
  await withEffects(async (client, fx) => {
    const { rows } = await client.query("SELECT * FROM workflows WHERE id = $1", [workflowId]);
    if (!rows[0]) throw new HttpError(404, `Workflow ${workflowId} not found`);
    const workflow = toWorkflow(rows[0]);

    await client.query(
      `INSERT INTO runs (id, workflow_id, workflow_name, workflow_version, definition, status, trigger, input, started_at)
       VALUES ($1, $2, $3, $4, $5, 'running', $6, $7, now())`,
      [runId, workflow.id, workflow.name, workflow.version, JSON.stringify(workflow.definition), trigger, JSON.stringify(input)],
    );
    for (const step of workflow.definition.steps) {
      await client.query(
        `INSERT INTO tasks (id, run_id, step_id, name, type, status, depends_on, retries_left)
         VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7)`,
        [randomUUID(), runId, step.id, step.name ?? step.id, step.type, step.dependsOn, step.retries],
      );
    }
    await audit(client, actor, "run.start", "run", runId, { workflowId, trigger });
    fx.runs.add(runId);
    await advanceInTx(client, runId, fx);
  });
  return (await getRunSummary(pool, runId))!;
}

export async function advanceRun(runId: string): Promise<void> {
  await withEffects((client, fx) => advanceInTx(client, runId, fx));
}

export async function pauseRun(runId: string, actor: string): Promise<void> {
  await withEffects(async (client, fx) => {
    const run = await lockRun(client, runId);
    if (run.status !== "running") throw new HttpError(409, `Cannot pause a ${run.status} run`);
    await client.query("UPDATE runs SET status = 'paused' WHERE id = $1", [runId]);
    await audit(client, actor, "run.pause", "run", runId);
    fx.runs.add(runId);
  });
}

export async function resumeRun(runId: string, actor: string): Promise<void> {
  await withEffects(async (client, fx) => {
    const run = await lockRun(client, runId);
    if (run.status !== "paused") throw new HttpError(409, `Cannot resume a ${run.status} run`);
    await client.query("UPDATE runs SET status = 'running' WHERE id = $1", [runId]);
    await audit(client, actor, "run.resume", "run", runId);
    fx.runs.add(runId);
    await advanceInTx(client, runId, fx);
  });
}

export async function cancelRun(runId: string, actor: string, reason = "Cancelled by operator"): Promise<void> {
  await withEffects(async (client, fx) => {
    const run = await lockRun(client, runId);
    if (run.status !== "running" && run.status !== "paused") throw new HttpError(409, `Cannot cancel a ${run.status} run`);
    const res = await client.query(
      `UPDATE tasks SET status = 'cancelled', error = $2, finished_at = now(), updated_at = now()
       WHERE run_id = $1 AND status IN ('pending','queued','running','waiting_approval') RETURNING *`,
      [runId, reason],
    );
    fx.track(res.rows);
    await client.query("UPDATE runs SET status = 'cancelled', error = $2, finished_at = now() WHERE id = $1", [runId, reason]);
    await audit(client, actor, "run.cancel", "run", runId, { reason });
    fx.runs.add(runId);
    fx.aborts.push({ runId, reason });
  });
}

/** Retries every failed or cancelled step of a finished run. */
export async function retryRun(runId: string, actor: string): Promise<void> {
  await withEffects(async (client, fx) => {
    const run = await lockRun(client, runId);
    if (run.status !== "failed" && run.status !== "cancelled") throw new HttpError(409, `Cannot retry a ${run.status} run`);
    const { rows } = await client.query("SELECT * FROM tasks WHERE run_id = $1 AND status IN ('failed','cancelled') FOR UPDATE", [runId]);
    for (const task of rows.map(toTask)) await resetTaskInTx(client, run, task, fx);
    await client.query("UPDATE runs SET status = 'running', error = NULL, finished_at = NULL WHERE id = $1", [runId]);
    await audit(client, actor, "run.retry", "run", runId, { tasks: rows.length });
    fx.runs.add(runId);
    await advanceInTx(client, runId, fx);
  });
}

/* ------------------------------------------------------------------------------------------ */
/* Task overrides                                                                             */
/* ------------------------------------------------------------------------------------------ */

export async function retryTask(taskId: string, actor: string): Promise<void> {
  const runId = await runIdOfTask(taskId);
  await withEffects(async (client, fx) => {
    const run = await lockRun(client, runId);
    const task = await lockTask(client, taskId);
    if (task.status !== "failed" && task.status !== "cancelled") throw new HttpError(409, `Cannot retry a ${task.status} step`);
    await resetTaskInTx(client, run, task, fx);
    await reopenInTx(client, run, fx, task.id);
    await audit(client, actor, "task.retry", "task", taskId, { runId, stepId: task.stepId });
    await advanceInTx(client, runId, fx);
  });
}

export async function skipTask(taskId: string, actor: string): Promise<void> {
  const runId = await runIdOfTask(taskId);
  await withEffects(async (client, fx) => {
    const run = await lockRun(client, runId);
    const task = await lockTask(client, taskId);
    if (task.status === "succeeded" || task.status === "skipped") throw new HttpError(409, `Step is already ${task.status}`);
    const res = await client.query(
      `UPDATE tasks SET status = 'skipped', generation = generation + 1, output = $2, error = NULL,
              finished_at = now(), updated_at = now()
       WHERE id = $1 RETURNING *`,
      [taskId, JSON.stringify({ skipped: true, reason: `Skipped by ${actor}` })],
    );
    fx.track(res.rows);
    if (task.status === "running") fx.aborts.push({ taskIds: [taskId], reason: "skipped by operator" });
    await reopenInTx(client, run, fx, task.id);
    await audit(client, actor, "task.skip", "task", taskId, { runId, stepId: task.stepId, previous: task.status });
    await advanceInTx(client, runId, fx);
  });
}

export async function decideApproval(taskId: string, approved: boolean, actor: string, comment?: string): Promise<void> {
  const runId = await runIdOfTask(taskId);
  await withEffects(async (client, fx) => {
    await lockRun(client, runId);
    const task = await lockTask(client, taskId);
    if (task.status !== "waiting_approval") throw new HttpError(409, `Step is ${task.status}, not waiting for approval`);
    const decision = { approved, by: actor, comment: comment ?? null, at: new Date().toISOString() };
    const res = approved
      ? await client.query(
          `UPDATE tasks SET status = 'succeeded', output = $2, finished_at = now(), updated_at = now() WHERE id = $1 RETURNING *`,
          [taskId, JSON.stringify({ ...(task.output as object), ...decision })],
        )
      : await client.query(
          `UPDATE tasks SET status = 'failed', error = $2, finished_at = now(), updated_at = now() WHERE id = $1 RETURNING *`,
          [taskId, `Rejected by ${actor}${comment ? `: ${comment}` : ""}`],
        );
    fx.track(res.rows);
    await audit(client, actor, approved ? "task.approve" : "task.reject", "task", taskId, { runId, comment });
    await advanceInTx(client, runId, fx);
  });
}

/* ------------------------------------------------------------------------------------------ */
/* Worker side                                                                                */
/* ------------------------------------------------------------------------------------------ */

export interface ClaimedTask {
  task: Task;
  run: Run;
  step: StepDefinition;
  context: TemplateContext;
}

/** Marks a queued task as running on this worker. Returns null for stale, cancelled or paused work. */
export async function claimTask(job: TaskJobData, workerId: string): Promise<ClaimedTask | null> {
  const claimed = await withEffects(async (client, fx) => {
    const run = await lockRun(client, job.runId, "SHARE").catch((err) => {
      if (err instanceof HttpError && err.status === 404) return null;
      throw err;
    });
    if (!run) return null;
    const { rows } = await client.query("SELECT * FROM tasks WHERE id = $1 FOR UPDATE", [job.taskId]);
    const task = rows[0] ? toTask(rows[0]) : null;
    if (!task || task.generation !== job.generation) return null;
    if (task.status !== "queued" && task.status !== "running") return null;

    if (run.status === "paused") {
      // Hand the step back; resuming the run re-queues it under a new generation.
      const res = await client.query(
        "UPDATE tasks SET status = 'pending', queued_at = NULL, updated_at = now() WHERE id = $1 RETURNING *",
        [task.id],
      );
      fx.track(res.rows);
      return null;
    }
    if (run.status !== "running") {
      const res = await client.query(
        "UPDATE tasks SET status = 'cancelled', finished_at = now(), updated_at = now() WHERE id = $1 RETURNING *",
        [task.id],
      );
      fx.track(res.rows);
      return null;
    }

    const res = await client.query(
      `UPDATE tasks SET status = 'running', attempt = attempt + 1, worker_id = $2, error = NULL,
              started_at = now(), updated_at = now()
       WHERE id = $1 RETURNING *`,
      [task.id, workerId],
    );
    const [running] = fx.track(res.rows);
    return { task: running!, run };
  });
  if (!claimed) return null;

  const { rows } = await pool.query("SELECT step_id, status, output FROM tasks WHERE run_id = $1", [claimed.run.id]);
  const context = buildContext(
    claimed.run,
    rows.map((r) => ({ stepId: r.step_id, status: r.status, output: r.output })),
  );
  return { ...claimed, step: stepOf(claimed.run, claimed.task.stepId), context };
}

export type TaskResult =
  | { status: "succeeded"; output: unknown }
  | { status: "waiting_approval"; output: unknown }
  | { status: "failed"; error: string };

/** Records the outcome of an execution, schedules automatic retries, and advances the run. */
export async function completeTask(job: TaskJobData, result: TaskResult): Promise<void> {
  await withEffects(async (client, fx) => {
    await lockRun(client, job.runId);
    const task = await lockTask(client, job.taskId);
    // The step was cancelled, skipped or re-queued while running: drop this result.
    if (task.generation !== job.generation || task.status !== "running") return;

    let res: pg.QueryResult;
    if (result.status === "succeeded") {
      res = await client.query(
        `UPDATE tasks SET status = 'succeeded', output = $2, finished_at = now(), updated_at = now() WHERE id = $1 RETURNING *`,
        [task.id, JSON.stringify(result.output ?? null)],
      );
    } else if (result.status === "waiting_approval") {
      res = await client.query(
        `UPDATE tasks SET status = 'waiting_approval', output = $2, updated_at = now() WHERE id = $1 RETURNING *`,
        [task.id, JSON.stringify(result.output ?? null)],
      );
    } else if (task.retriesLeft > 0) {
      res = await client.query(
        `UPDATE tasks SET status = 'queued', retries_left = retries_left - 1, generation = generation + 1, error = $2,
                queued_at = now(), updated_at = now()
         WHERE id = $1 RETURNING *`,
        [task.id, result.error],
      );
      const updated = toTask(res.rows[0]);
      const delayMs = config.engine.retryBackoffMs * 2 ** Math.max(0, task.attempt - 1);
      fx.enqueue.push({ data: { taskId: task.id, runId: task.runId, generation: updated.generation }, delayMs });
      await insertLog(client, task, "warn", `Attempt ${task.attempt} failed: ${result.error}. Retrying in ${Math.round(delayMs / 1000)}s (${updated.retriesLeft} retries left).`);
    } else {
      res = await client.query(
        `UPDATE tasks SET status = 'failed', error = $2, finished_at = now(), updated_at = now() WHERE id = $1 RETURNING *`,
        [task.id, result.error],
      );
    }
    fx.track(res.rows);
    await advanceInTx(client, job.runId, fx);
  });
}

async function insertLog(db: pg.PoolClient | pg.Pool, task: Pick<Task, "id" | "runId">, level: "info" | "warn" | "error", message: string) {
  const { rows } = await db.query(
    "INSERT INTO task_logs (task_id, run_id, level, message) VALUES ($1, $2, $3, $4) RETURNING *",
    [task.id, task.runId, level, message.slice(0, 10_000)],
  );
  // Published immediately; a rolled-back log line is harmless noise.
  await publishEvent({ type: "task.log", log: toTaskLog(rows[0]) });
}

export async function appendLog(task: Pick<Task, "id" | "runId">, level: "info" | "warn" | "error", message: string): Promise<void> {
  await insertLog(pool, task, level, message);
}

/* ------------------------------------------------------------------------------------------ */
/* Self-healing                                                                               */
/* ------------------------------------------------------------------------------------------ */

/**
 * Repairs work lost to crashes: queued tasks whose job vanished (process died between commit
 * and enqueue) and running tasks whose job is no longer live (worker died and BullMQ gave up on
 * the stalled job, or the result could not be recorded). Re-queued work keeps its retry budget,
 * since the failure was infrastructure, not the step.
 */
export async function reconcile(): Promise<{ requeued: number }> {
  const queue = getTaskQueue();
  const cutoff = new Date(Date.now() - config.engine.reconcileAfterMs).toISOString();
  const { rows } = await pool.query(
    `SELECT t.* FROM tasks t JOIN runs r ON r.id = t.run_id
     WHERE r.status = 'running'
       AND ((t.status = 'queued' AND t.queued_at < $1) OR (t.status = 'running' AND t.started_at < $1))`,
    [cutoff],
  );

  let requeued = 0;
  for (const task of rows.map(toTask)) {
    const job = await queue.getJob(taskJobId(task.id, task.generation));
    const state = job ? await job.getState() : "missing";
    if (["waiting", "active", "delayed", "prioritized", "waiting-children"].includes(state)) continue;

    const fx = new Effects();
    await tx(async (client) => {
      await lockRun(client, task.runId);
      const res = await client.query(
        `UPDATE tasks SET status = 'queued', generation = generation + 1, queued_at = now(), updated_at = now()
         WHERE id = $1 AND generation = $2 AND status IN ('queued','running') RETURNING *`,
        [task.id, task.generation],
      );
      const [updated] = fx.track(res.rows);
      if (updated) fx.enqueue.push({ data: { taskId: updated.id, runId: updated.runId, generation: updated.generation }, delayMs: 0 });
    });
    if (fx.enqueue.length) {
      requeued++;
      await fx.flush();
      await appendLog(task, "warn", `Recovered lost ${task.status} step (job state: ${state}); re-queued.`);
      logger.warn("reconciler re-queued task", { taskId: task.id, previous: task.status, state });
    }
  }
  return { requeued };
}
