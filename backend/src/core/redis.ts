import { Redis } from "ioredis";
import { config } from "../config.js";
import { logger } from "./logger.js";
import type { ControlMessage, OrchestratorEvent, WorkerInfo } from "./types.js";

export const EVENTS_CHANNEL = "wfo:events";
export const CONTROL_CHANNEL = "wfo:control";
const WORKER_KEY_PREFIX = "wfo:worker:";

/** BullMQ connection options. BullMQ opens its own connections; workers need maxRetriesPerRequest = null. */
export const bullConnection = { url: config.redisUrl, maxRetriesPerRequest: null };

export function createRedis(name: string): Redis {
  const client = new Redis(config.redisUrl, { maxRetriesPerRequest: null, connectionName: `wfo-${name}` });
  client.on("error", (err) => logger.warn("redis error", { name, err: err.message }));
  return client;
}

let publisher: Redis | null = null;
function pub(): Redis {
  return (publisher ??= createRedis("publisher"));
}

export async function publishEvent(event: OrchestratorEvent): Promise<void> {
  await pub().publish(EVENTS_CHANNEL, JSON.stringify(event));
}

export async function publishControl(message: ControlMessage): Promise<void> {
  await pub().publish(CONTROL_CHANNEL, JSON.stringify(message));
}

/** Subscribes to a channel on a dedicated connection. Returns an unsubscribe function. */
export async function subscribe<T>(channel: string, onMessage: (msg: T) => void): Promise<() => Promise<void>> {
  const sub = createRedis(`sub-${channel}`);
  sub.on("message", (ch: string, raw: string) => {
    if (ch !== channel) return;
    try {
      onMessage(JSON.parse(raw) as T);
    } catch (err) {
      logger.warn("dropping malformed pubsub message", { channel, err });
    }
  });
  await sub.subscribe(channel);
  return async () => {
    await sub.unsubscribe(channel).catch(() => undefined);
    sub.disconnect();
  };
}

/* ---------- worker registry (heartbeats with TTL) ---------- */

export async function writeHeartbeat(worker: WorkerInfo, ttlMs: number): Promise<void> {
  await pub().set(WORKER_KEY_PREFIX + worker.id, JSON.stringify(worker), "PX", ttlMs);
}

export async function removeHeartbeat(workerId: string): Promise<void> {
  await pub().del(WORKER_KEY_PREFIX + workerId);
}

export async function listWorkers(): Promise<WorkerInfo[]> {
  const keys: string[] = [];
  let cursor = "0";
  do {
    const [next, batch] = await pub().scan(cursor, "MATCH", `${WORKER_KEY_PREFIX}*`, "COUNT", 200);
    cursor = next;
    keys.push(...batch);
  } while (cursor !== "0");
  if (!keys.length) return [];
  const values = await pub().mget(...keys);
  return values
    .filter((v): v is string => Boolean(v))
    .map((v) => JSON.parse(v) as WorkerInfo)
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}

export async function pingRedis(): Promise<boolean> {
  return (await pub().ping()) === "PONG";
}

export async function closeRedis(): Promise<void> {
  if (publisher) {
    await publisher.quit().catch(() => undefined);
    publisher = null;
  }
}
