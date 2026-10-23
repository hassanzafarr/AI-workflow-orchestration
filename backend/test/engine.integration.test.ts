import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool, migrate } from "../src/core/db.js";
import * as engine from "../src/core/engine.js";
import { closeQueues, getTaskQueue } from "../src/core/queue.js";
import { createWorkflow } from "../src/core/queries.js";
import { closeRedis } from "../src/core/redis.js";
import type { RunStatus, TaskStatus } from "../src/core/types.js";
import { execute } from "../src/executors/index.js";

/**
 * Drives the real engine against Postgres + Redis, standing in for the worker: it claims every
 * queued task, runs the real executor (LLM in mock mode) and records the result.
 * Run with `npm run test:integration` after `docker compose up -d postgres redis`.
 */

const enabled = process.env.INTEGRATION === "1";

async function drain(runId: string, maxRounds = 50): Promise<void> {
  for (let round = 0; round < maxRounds; round++) {
    const { rows } = await pool.query("SELECT id, generation FROM tasks WHERE run_id = $1 AND status = 'queued'", [runId]);
    if (!rows.length) return;
    for (const row of rows) {
      const job = { taskId: row.id, runId, generation: row.generation };
      const claimed = await engine.claimTask(job, "test-worker");
      if (!claimed) continue;
      try {
        const result = await execute({
          step: claimed.step,
          template: claimed.context,
          signal: new AbortController().signal,
          log: async () => undefined,
          stream: () => undefined,
        });
        await engine.completeTask(job, result);
      } catch (err) {
        await engine.completeTask(job, { status: "failed", error: (err as Error).message });
      }
    }
  }
  throw new Error("drain did not settle");
}

async function state(runId: string) {
  const run = await pool.query("SELECT status, output, error FROM runs WHERE id = $1", [runId]);
  const tasks = await pool.query("SELECT step_id, status, attempt, output FROM tasks WHERE run_id = $1", [runId]);
  return {
    status: run.rows[0].status as RunStatus,
    output: run.rows[0].output,
    error: run.rows[0].error as string | null,
    tasks: Object.fromEntries(
      tasks.rows.map((t) => [t.step_id, { status: t.status as TaskStatus, attempt: t.attempt as number, output: t.output as unknown }]),
    ) as Record<string, { status: TaskStatus; attempt: number; output: unknown }>,
  };
}

async function workflow(steps: unknown[], exampleInput?: Record<string, unknown>) {
  return createWorkflow({ name: `test ${Math.random().toString(36).slice(2, 8)}`, definition: { steps, exampleInput } }, "test");
}

const taskId = async (runId: string, stepId: string) =>
  (await pool.query("SELECT id FROM tasks WHERE run_id = $1 AND step_id = $2", [runId, stepId])).rows[0].id as string;

describe.skipIf(!enabled)("engine (integration)", () => {
  beforeAll(async () => {
    await migrate();
    await pool.query("TRUNCATE workflows, runs, tasks, task_logs, audit_log CASCADE");
    await getTaskQueue().obliterate({ force: true });
  });

  afterAll(async () => {
    await getTaskQueue().obliterate({ force: true });
    await closeQueues();
    await closeRedis();
    await pool.end();
  });

  it("runs a diamond DAG, passes data between steps and sets the run output", async () => {
    const wf = await workflow([
      { id: "a", type: "transform", config: { output: { n: "{{input.n}}" } } },
      { id: "b", type: "transform", dependsOn: ["a"], config: { output: "left-{{steps.a.output.n}}" } },
      { id: "c", type: "llm", dependsOn: ["a"], config: { prompt: "Say hi to {{input.name}}" } },
      { id: "d", type: "transform", dependsOn: ["b", "c"], config: { output: { left: "{{steps.b.output}}", mock: "{{steps.c.output.mock}}" } } },
    ]);
    const run = await engine.createRun(wf.id, { n: 7, name: "Ada" }, "manual", "test");
    // Only the root is queued at first.
    expect((await state(run.id)).tasks.a!.status).toBe("queued");
    expect((await state(run.id)).tasks.b!.status).toBe("pending");

    await drain(run.id);
    const s = await state(run.id);
    expect(s.status).toBe("succeeded");
    expect(s.output).toEqual({ left: "left-7", mock: true });
  });

  it("retries a failing step, fails the run fast, and lets an operator skip it", async () => {
    const wf = await workflow([
      { id: "flaky", type: "delay", retries: 2, config: { ms: 1, failRate: 1 } },
      { id: "slow", type: "delay", config: { ms: 1 } },
      { id: "after", type: "transform", dependsOn: ["flaky", "slow"], config: { output: "done" } },
    ]);
    const run = await engine.createRun(wf.id, {}, "manual", "test");
    await drain(run.id);

    let s = await state(run.id);
    expect(s.status).toBe("failed");
    expect(s.tasks.flaky!.status).toBe("failed");
    expect(s.tasks.flaky!.attempt).toBe(3);
    expect(s.tasks.after!.status).toBe("cancelled");
    expect(s.error).toMatch(/Simulated failure/);

    await engine.skipTask(await taskId(run.id, "flaky"), "test");
    await drain(run.id);
    s = await state(run.id);
    expect(s.status).toBe("succeeded");
    expect(s.tasks.flaky!.status).toBe("skipped");
    expect(s.tasks.after!.status).toBe("succeeded");
  });

  it("waits for approval and continues or fails on the decision", async () => {
    const wf = await workflow([
      { id: "gate", type: "approval", config: { message: "ok?" } },
      { id: "ship", type: "transform", dependsOn: ["gate"], config: { output: "{{steps.gate.output.by}}" } },
    ]);
    const approved = await engine.createRun(wf.id, {}, "manual", "test");
    await drain(approved.id);
    expect((await state(approved.id)).tasks.gate!.status).toBe("waiting_approval");
    await engine.decideApproval(await taskId(approved.id, "gate"), true, "alice", "lgtm");
    await drain(approved.id);
    expect((await state(approved.id)).output).toBe("alice");

    const rejected = await engine.createRun(wf.id, {}, "manual", "test");
    await drain(rejected.id);
    await engine.decideApproval(await taskId(rejected.id, "gate"), false, "bob", "not yet");
    const s = await state(rejected.id);
    expect(s.status).toBe("failed");
    expect(s.error).toMatch(/Rejected by bob: not yet/);
  });

  it("skips steps whose when-condition is falsy", async () => {
    const wf = await workflow([
      { id: "check", type: "transform", config: { output: { escalate: "{{input.urgent}}" } } },
      { id: "page", type: "transform", dependsOn: ["check"], when: "{{steps.check.output.escalate}}", config: { output: "paged" } },
      { id: "reply", type: "transform", dependsOn: ["page"], config: { output: "replied" } },
    ]);
    const calm = await engine.createRun(wf.id, { urgent: false }, "manual", "test");
    await drain(calm.id);
    let s = await state(calm.id);
    expect(s.tasks.page!.status).toBe("skipped");
    expect(s.tasks.reply!.status).toBe("succeeded");

    const urgent = await engine.createRun(wf.id, { urgent: true }, "manual", "test");
    await drain(urgent.id);
    s = await state(urgent.id);
    expect(s.tasks.page!.status).toBe("succeeded");
  });

  it("hands queued work back on pause and re-queues it on resume", async () => {
    const wf = await workflow([{ id: "only", type: "delay", config: { ms: 1 } }]);
    const run = await engine.createRun(wf.id, {}, "manual", "test");
    const { rows } = await pool.query("SELECT id, generation FROM tasks WHERE run_id = $1", [run.id]);
    const staleJob = { taskId: rows[0].id, runId: run.id, generation: rows[0].generation };

    await engine.pauseRun(run.id, "test");
    expect(await engine.claimTask(staleJob, "w")).toBeNull();
    expect((await state(run.id)).tasks.only!.status).toBe("pending");

    await engine.resumeRun(run.id, "test");
    // The pre-pause job is now stale and must be ignored.
    expect(await engine.claimTask(staleJob, "w")).toBeNull();
    await drain(run.id);
    expect((await state(run.id)).status).toBe("succeeded");
  });

  it("cancels a run and can retry it afterwards", async () => {
    const wf = await workflow([
      { id: "one", type: "delay", config: { ms: 1 } },
      { id: "two", type: "delay", dependsOn: ["one"], config: { ms: 1 } },
    ]);
    const run = await engine.createRun(wf.id, {}, "manual", "test");
    await engine.cancelRun(run.id, "test");
    let s = await state(run.id);
    expect(s.status).toBe("cancelled");
    expect(Object.values(s.tasks).every((t) => t.status === "cancelled")).toBe(true);

    await engine.retryRun(run.id, "test");
    await drain(run.id);
    s = await state(run.id);
    expect(s.status).toBe("succeeded");
  });

  it("records every override in the audit log", async () => {
    const { rows } = await pool.query("SELECT DISTINCT action FROM audit_log");
    expect(rows.map((r) => r.action)).toEqual(
      expect.arrayContaining(["run.start", "task.skip", "task.approve", "task.reject", "run.pause", "run.resume", "run.cancel", "run.retry"]),
    );
  });
});
