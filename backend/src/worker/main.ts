import http from "node:http";
import os from "node:os";
import { Worker, type Job } from "bullmq";
import { config } from "../config.js";
import { migrate, pool } from "../core/db.js";
import { appendLog, claimTask, completeTask, createRun } from "../core/engine.js";
import { logger as rootLogger } from "../core/logger.js";
import { getWorkflow } from "../core/queries.js";
import { closeQueues, syncSchedule, TASK_QUEUE, TRIGGER_QUEUE, type TriggerJobData } from "../core/queue.js";
import {
  bullConnection,
  closeRedis,
  CONTROL_CHANNEL,
  pingRedis,
  publishEvent,
  removeHeartbeat,
  subscribe,
  writeHeartbeat,
} from "../core/redis.js";
import { HttpError, type ControlMessage, type TaskJobData, type WorkerInfo } from "../core/types.js";
import { execute } from "../executors/index.js";

/**
 * Worker microservice: pulls step executions from the BullMQ `tasks` queue, runs them with the
 * matching executor, and reports results back through the engine. Stateless and horizontally
 * scalable - Kubernetes adds replicas when the queue backs up (KEDA) and SIGTERM drains in-flight
 * work before the pod exits.
 */

const workerId = config.worker.id;
const log = rootLogger.child({ service: "worker", workerId });
const startedAt = new Date().toISOString();
const active = new Map<string, { controller: AbortController; runId: string }>();
let processed = 0;
let failed = 0;
let draining = false;

async function processTask(job: Job<TaskJobData>): Promise<void> {
  const claimed = await claimTask(job.data, workerId);
  if (!claimed) return;
  const { task, step } = claimed;

  const controller = new AbortController();
  active.set(task.id, { controller, runId: task.runId });
  const timeoutMs = step.timeoutMs ?? config.engine.defaultTimeoutMs;
  const timer = setTimeout(() => controller.abort(new Error(`Timed out after ${timeoutMs}ms`)), timeoutMs);

  let buffer = "";
  let flushTimer: NodeJS.Timeout | null = null;
  const flushStream = () => {
    flushTimer = null;
    if (!buffer) return;
    const text = buffer;
    buffer = "";
    void publishEvent({ type: "task.stream", taskId: task.id, runId: task.runId, text });
  };

  const started = Date.now();
  try {
    await appendLog(task, "info", `Attempt ${task.attempt} started on ${workerId}`);
    const result = await execute({
      step,
      template: claimed.context,
      signal: controller.signal,
      log: (level, message) => appendLog(task, level, message),
      stream: (text) => {
        buffer += text;
        flushTimer ??= setTimeout(flushStream, 150);
      },
    });
    flushStream();
    await completeTask(job.data, result);
    if (result.status === "succeeded") await appendLog(task, "info", `Succeeded in ${Date.now() - started}ms`);
    processed++;
  } catch (err) {
    flushStream();
    const reason = controller.signal.aborted ? controller.signal.reason : err;
    const message = reason instanceof Error ? reason.message : String(reason);
    failed++;
    await appendLog(task, "error", message).catch(() => undefined);
    await completeTask(job.data, { status: "failed", error: message });
  } finally {
    if (flushTimer) clearTimeout(flushTimer);
    clearTimeout(timer);
    active.delete(task.id);
  }
}

async function processTrigger(job: Job<TriggerJobData>): Promise<void> {
  try {
    // Scheduled runs have no caller, so they run with the workflow's example input.
    const workflow = await getWorkflow(job.data.workflowId);
    const run = await createRun(workflow.id, workflow.definition.exampleInput ?? {}, "schedule", "scheduler");
    log.info("scheduled run started", { workflowId: job.data.workflowId, runId: run.id });
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) {
      // Workflow was deleted; drop its orphaned schedule.
      await syncSchedule(job.data.workflowId, null, false);
      return;
    }
    throw err;
  }
}

function info(): WorkerInfo {
  return {
    id: workerId,
    hostname: os.hostname(),
    concurrency: config.worker.concurrency,
    active: active.size,
    processed,
    failed,
    startedAt,
    lastSeen: new Date().toISOString(),
    activeTasks: [...active.keys()],
    draining,
  };
}

async function heartbeat(): Promise<void> {
  const worker = info();
  await writeHeartbeat(worker, config.worker.heartbeatMs * 3);
  await publishEvent({ type: "worker.heartbeat", worker });
}

function onControl(msg: ControlMessage): void {
  if (msg.type !== "abort") return;
  for (const [taskId, entry] of active) {
    if (msg.runId === entry.runId || msg.taskIds?.includes(taskId)) {
      log.info("aborting task", { taskId, reason: msg.reason });
      entry.controller.abort(new Error(`Aborted: ${msg.reason}`));
    }
  }
}

async function main(): Promise<void> {
  await migrate();
  const unsubscribe = await subscribe<ControlMessage>(CONTROL_CHANNEL, onControl);

  const taskWorker = new Worker<TaskJobData>(TASK_QUEUE, processTask, {
    connection: bullConnection,
    concurrency: config.worker.concurrency,
    lockDuration: 60_000,
    maxStalledCount: 2,
  });
  const triggerWorker = new Worker<TriggerJobData>(TRIGGER_QUEUE, processTrigger, { connection: bullConnection, concurrency: 2 });
  for (const w of [taskWorker, triggerWorker]) w.on("error", (err) => log.error("bullmq worker error", { err }));

  await heartbeat();
  const beat = setInterval(() => heartbeat().catch((err) => log.warn("heartbeat failed", { err })), config.worker.heartbeatMs);

  const health = http.createServer(async (req, res) => {
    if (req.url === "/healthz") {
      res.writeHead(200).end("ok");
    } else if (req.url === "/readyz") {
      const ready = !draining && (await pingRedis().catch(() => false)) && (await pool.query("SELECT 1").then(() => true, () => false));
      res.writeHead(ready ? 200 : 503).end(ready ? "ready" : "not ready");
    } else {
      res.writeHead(404).end();
    }
  });
  health.listen(config.worker.healthPort);
  log.info("worker started", { concurrency: config.worker.concurrency, llmMode: config.llm.mode, healthPort: config.worker.healthPort });

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    draining = true;
    log.info("draining before shutdown", { signal, active: active.size });
    await heartbeat().catch(() => undefined);
    // close() stops pulling new jobs and waits for in-flight ones, so scale-in never drops work.
    await Promise.all([taskWorker.close(), triggerWorker.close()]);
    clearInterval(beat);
    await removeHeartbeat(workerId).catch(() => undefined);
    await publishEvent({ type: "worker.offline", workerId }).catch(() => undefined);
    await unsubscribe();
    health.close();
    await closeQueues();
    await closeRedis();
    await pool.end();
    log.info("worker stopped");
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  log.error("worker failed to start", { err });
  process.exit(1);
});
