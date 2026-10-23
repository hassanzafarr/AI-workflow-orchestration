import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { diagnoseTask, generateWorkflow } from "../ai/assistant.js";
import { ClaudeError } from "../ai/claude.js";
import { config } from "../config.js";
import { topologicalLevels, validateDefinition } from "../core/dag.js";
import { pool } from "../core/db.js";
import * as engine from "../core/engine.js";
import { logger } from "../core/logger.js";
import * as q from "../core/queries.js";
import { getQueueStats, getTaskQueue } from "../core/queue.js";
import { listWorkers, pingRedis } from "../core/redis.js";
import { HttpError } from "../core/types.js";
import { actorOf, requireToken } from "./auth.js";
import { getScaling, setScaling } from "./scaler.js";

const log = logger.child({ service: "api" });

const workflowBody = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().max(2000).optional(),
  definition: z.unknown(),
  schedule: z.string().trim().max(120).nullable().optional(),
  enabled: z.boolean().optional(),
});
const runBody = z.object({ input: z.record(z.string(), z.unknown()).default({}) });
const decisionBody = z.object({ comment: z.string().max(2000).optional() });
const scalingBody = z.object({
  min: z.number().int().min(0).max(500).optional(),
  max: z.number().int().min(1).max(500).optional(),
  replicas: z.number().int().min(0).max(500).optional(),
});
const generateBody = z.object({ description: z.string().trim().min(10).max(4000) });

function parse<T extends z.ZodType>(schema: T, body: unknown): z.infer<T> {
  const result = schema.safeParse(body ?? {});
  if (!result.success) {
    throw new HttpError(400, "Invalid request body", {
      issues: result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    });
  }
  return result.data;
}

const uuid = z.uuid();
function idParam(req: Request): string {
  const id = String(req.params.id);
  if (!uuid.safeParse(id).success) throw new HttpError(404, "Not found");
  return id;
}

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.use(cors({ origin: config.api.corsOrigin === "*" ? true : config.api.corsOrigin.split(",") }));
  app.use(express.json({ limit: "1mb" }));

  app.get("/healthz", (_req, res) => {
    res.send("ok");
  });
  app.get("/readyz", async (_req, res) => {
    const [db, redis] = await Promise.all([
      pool.query("SELECT 1").then(() => true, () => false),
      pingRedis().catch(() => false),
    ]);
    res.status(db && redis ? 200 : 503).json({ db, redis });
  });

  const api = express.Router();
  api.use(requireToken);

  api.get("/info", (_req, res) => {
    res.json({
      llmMode: config.llm.mode,
      model: config.llm.model,
      scalingKind: config.scaling.kind,
      authRequired: Boolean(config.api.token),
      version: process.env.APP_VERSION ?? "dev",
    });
  });

  /* ------------------------------- workflows ------------------------------- */
  api.get("/workflows", async (_req, res) => {
    res.json(await q.listWorkflows());
  });
  api.post("/workflows", async (req, res) => {
    res.status(201).json(await q.createWorkflow(parse(workflowBody, req.body), actorOf(req)));
  });
  api.post("/workflows/validate", async (req, res) => {
    const result = validateDefinition(req.body?.definition);
    res.json(result.ok ? { ok: true, issues: [], levels: topologicalLevels(result.definition) } : result);
  });
  api.get("/workflows/:id", async (req, res) => {
    res.json(await q.getWorkflow(idParam(req)));
  });
  api.put("/workflows/:id", async (req, res) => {
    res.json(await q.updateWorkflow(idParam(req), parse(workflowBody, req.body), actorOf(req)));
  });
  api.delete("/workflows/:id", async (req, res) => {
    await q.deleteWorkflow(idParam(req), actorOf(req));
    res.status(204).end();
  });
  api.post("/workflows/:id/runs", async (req, res) => {
    const { input } = parse(runBody, req.body);
    res.status(201).json(await engine.createRun(idParam(req), input, "manual", actorOf(req)));
  });

  /* ---------------------------------- AI ----------------------------------- */
  api.post("/ai/generate-workflow", async (req, res) => {
    res.json(await generateWorkflow(parse(generateBody, req.body).description));
  });
  api.post("/tasks/:id/diagnose", async (req, res) => {
    const { task, logs } = await q.getTask(idParam(req));
    const { run } = await q.getRunDetail(task.runId);
    const step = run.definition.steps.find((s) => s.id === task.stepId);
    res.json(await diagnoseTask(task, step?.config ?? {}, logs));
  });

  /* ---------------------------------- runs --------------------------------- */
  api.get("/runs", async (req, res) => {
    res.json(
      await q.listRuns({
        status: req.query.status ? String(req.query.status) : undefined,
        workflowId: req.query.workflowId ? String(req.query.workflowId) : undefined,
        limit: req.query.limit ? Number(req.query.limit) : undefined,
        offset: req.query.offset ? Number(req.query.offset) : undefined,
      }),
    );
  });
  api.get("/runs/:id", async (req, res) => {
    res.json(await q.getRunDetail(idParam(req)));
  });
  api.get("/runs/:id/logs", async (req, res) => {
    res.json(await q.getRunLogs(idParam(req), Number(req.query.after ?? 0) || 0));
  });
  const runAction = (action: (id: string, actor: string) => Promise<void>) => async (req: Request, res: Response) => {
    const id = idParam(req);
    await action(id, actorOf(req));
    res.json((await q.getRunDetail(id)).run);
  };
  api.post("/runs/:id/pause", runAction(engine.pauseRun));
  api.post("/runs/:id/resume", runAction(engine.resumeRun));
  api.post("/runs/:id/cancel", runAction((id, actor) => engine.cancelRun(id, actor, `Cancelled by ${actor}`)));
  api.post("/runs/:id/retry", runAction(engine.retryRun));

  /* --------------------------------- tasks --------------------------------- */
  api.get("/tasks/:id", async (req, res) => {
    res.json(await q.getTask(idParam(req)));
  });
  const taskAction = (action: (id: string, actor: string, req: Request) => Promise<void>) => async (req: Request, res: Response) => {
    const id = idParam(req);
    await action(id, actorOf(req), req);
    res.json((await q.getTask(id)).task);
  };
  api.post("/tasks/:id/retry", taskAction((id, actor) => engine.retryTask(id, actor)));
  api.post("/tasks/:id/skip", taskAction((id, actor) => engine.skipTask(id, actor)));
  api.post("/tasks/:id/approve", taskAction((id, actor, req) => engine.decideApproval(id, true, actor, parse(decisionBody, req.body).comment)));
  api.post("/tasks/:id/reject", taskAction((id, actor, req) => engine.decideApproval(id, false, actor, parse(decisionBody, req.body).comment)));

  /* -------------------------- workers, queue, scaling -------------------------- */
  api.get("/workers", async (_req, res) => {
    res.json(await listWorkers());
  });
  api.get("/queue", async (_req, res) => {
    res.json(await getQueueStats());
  });
  api.post("/queue/pause", async (req, res) => {
    await getTaskQueue().pause();
    log.warn("task queue paused", { actor: actorOf(req) });
    await pool.query("INSERT INTO audit_log (actor, action, target_type, target_id) VALUES ($1, 'queue.pause', 'queue', 'tasks')", [actorOf(req)]);
    res.json(await getQueueStats());
  });
  api.post("/queue/resume", async (req, res) => {
    await getTaskQueue().resume();
    await pool.query("INSERT INTO audit_log (actor, action, target_type, target_id) VALUES ($1, 'queue.resume', 'queue', 'tasks')", [actorOf(req)]);
    res.json(await getQueueStats());
  });
  api.get("/scaling", async (_req, res) => {
    res.json(await getScaling());
  });
  api.put("/scaling", async (req, res) => {
    const body = parse(scalingBody, req.body);
    const state = await setScaling(body);
    await pool.query(
      "INSERT INTO audit_log (actor, action, target_type, target_id, details) VALUES ($1, 'scaling.override', 'deployment', $2, $3)",
      [actorOf(req), state.deployment.name, JSON.stringify(body)],
    );
    res.json(state);
  });

  /* -------------------------------- metrics -------------------------------- */
  api.get("/metrics/summary", async (_req, res) => {
    const [summary, queue, workers] = await Promise.all([q.metricsSummary(), getQueueStats(), listWorkers()]);
    res.json({
      ...summary,
      queue,
      workers: {
        count: workers.length,
        capacity: workers.reduce((n, w) => n + w.concurrency, 0),
        busy: workers.reduce((n, w) => n + w.active, 0),
      },
    });
  });
  api.get("/metrics/throughput", async (req, res) => {
    res.json(await q.throughput(Number(req.query.minutes ?? 30) || 30));
  });
  api.get("/audit", async (req, res) => {
    res.json(await q.listAudit(Number(req.query.limit ?? 100) || 100));
  });

  app.use("/api", api);
  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  // Express 5 forwards rejected promises from async handlers here.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message, ...(err.details ? { details: err.details } : {}) });
      return;
    }
    if (err instanceof ClaudeError) {
      res.status(502).json({ error: err.message });
      return;
    }
    if (err instanceof SyntaxError && "body" in err) {
      res.status(400).json({ error: "Malformed JSON body" });
      return;
    }
    log.error("unhandled request error", { err });
    res.status(500).json({ error: "Internal server error" });
  });

  return app;
}
