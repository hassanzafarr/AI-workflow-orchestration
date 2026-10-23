import type { Server } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { logger } from "../core/logger.js";
import { getQueueStats } from "../core/queue.js";
import { EVENTS_CHANNEL, listWorkers, subscribe } from "../core/redis.js";
import type { OrchestratorEvent } from "../core/types.js";
import { tokenMatches } from "./auth.js";

/**
 * WebSocket fan-out. Every API replica subscribes to the Redis event channel and forwards
 * events to its own browser connections, so replicas scale horizontally without sticky routing.
 * High-volume run-scoped events (logs, token streams) only go to clients watching that run.
 */

interface Client {
  socket: WebSocket;
  runIds: Set<string>;
  alive: boolean;
}

const log = logger.child({ service: "api", component: "realtime" });

export async function attachRealtime(server: Server): Promise<() => Promise<void>> {
  const wss = new WebSocketServer({ noServer: true });
  const clients = new Set<Client>();

  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname !== "/ws") return socket.destroy();
    if (!tokenMatches(url.searchParams.get("token"))) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      return socket.destroy();
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws));
  });

  wss.on("connection", (socket: WebSocket) => {
    const client: Client = { socket, runIds: new Set(), alive: true };
    clients.add(client);
    socket.on("pong", () => (client.alive = true));
    socket.on("close", () => clients.delete(client));
    socket.on("message", (raw) => {
      try {
        const msg = JSON.parse(String(raw)) as { type: string; runId?: string };
        if (msg.type === "subscribe" && msg.runId) client.runIds.add(msg.runId);
        if (msg.type === "unsubscribe" && msg.runId) client.runIds.delete(msg.runId);
      } catch {
        /* ignore malformed client messages */
      }
    });
    socket.send(JSON.stringify({ type: "hello", at: new Date().toISOString() }));
  });

  const send = (event: OrchestratorEvent | { type: string; [k: string]: unknown }, runId?: string) => {
    const payload = JSON.stringify(event);
    for (const client of clients) {
      if (client.socket.readyState !== client.socket.OPEN) continue;
      if (runId && !client.runIds.has(runId)) continue;
      client.socket.send(payload);
    }
  };

  const unsubscribe = await subscribe<OrchestratorEvent>(EVENTS_CHANNEL, (event) => {
    if (event.type === "task.log") send(event, event.log.runId);
    else if (event.type === "task.stream") send(event, event.runId);
    else send(event);
  });

  // Queue depth and worker liveness are polled per replica and pushed to local clients only.
  let knownWorkers = new Set<string>();
  const poll = setInterval(async () => {
    if (!clients.size) return;
    try {
      send({ type: "queue.updated", queue: await getQueueStats() });
      const workers = new Set((await listWorkers()).map((w) => w.id));
      for (const id of knownWorkers) if (!workers.has(id)) send({ type: "worker.offline", workerId: id });
      knownWorkers = workers;
    } catch (err) {
      log.warn("realtime poll failed", { err: (err as Error).message });
    }
  }, 2000);

  const ping = setInterval(() => {
    for (const client of clients) {
      if (!client.alive) {
        client.socket.terminate();
        clients.delete(client);
        continue;
      }
      client.alive = false;
      client.socket.ping();
    }
  }, 30_000);

  return async () => {
    clearInterval(poll);
    clearInterval(ping);
    await unsubscribe();
    for (const client of clients) client.socket.close(1001, "server shutting down");
    wss.close();
  };
}
