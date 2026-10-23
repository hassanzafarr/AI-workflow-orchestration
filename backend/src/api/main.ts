import http from "node:http";
import { config } from "../config.js";
import { migrate, pool } from "../core/db.js";
import { reconcile } from "../core/engine.js";
import { logger } from "../core/logger.js";
import { closeQueues } from "../core/queue.js";
import { closeRedis } from "../core/redis.js";
import { createApp } from "./app.js";
import { attachRealtime } from "./realtime.js";
import { seedDemoWorkflows } from "./seed.js";

/**
 * API gateway microservice: REST for workflows, runs and manual overrides, a WebSocket stream of
 * live events for the dashboard, scaling overrides through the Kubernetes API, and a reconciler
 * that repairs work lost to crashed pods. Stateless; run as many replicas as needed.
 */

const log = logger.child({ service: "api" });

async function main(): Promise<void> {
  await migrate();
  await seedDemoWorkflows();

  const server = http.createServer(createApp());
  const closeRealtime = await attachRealtime(server);
  server.listen(config.api.port, () =>
    log.info("api listening", { port: config.api.port, llmMode: config.llm.mode, model: config.llm.model, scaling: config.scaling.kind }),
  );

  const reconciler = setInterval(() => {
    reconcile()
      .then(({ requeued }) => requeued && log.warn("reconciler recovered tasks", { requeued }))
      .catch((err) => log.error("reconcile failed", { err }));
  }, 15_000);

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    log.info("shutting down", { signal });
    clearInterval(reconciler);
    await closeRealtime();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await closeQueues();
    await closeRedis();
    await pool.end();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  log.error("api failed to start", { err });
  process.exit(1);
});
