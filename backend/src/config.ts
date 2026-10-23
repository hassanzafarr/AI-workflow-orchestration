import os from "node:os";

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n)) throw new Error(`Env ${name} must be an integer, got "${raw}"`);
  return n;
}

function str(name: string, fallback: string): string {
  const raw = process.env[name];
  return raw === undefined || raw === "" ? fallback : raw;
}

function hasClaudeCredentials(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

const llmModeRaw = str("LLM_MODE", "auto");
if (!["auto", "live", "mock"].includes(llmModeRaw)) {
  throw new Error(`LLM_MODE must be auto|live|mock, got "${llmModeRaw}"`);
}

export const config = {
  env: str("NODE_ENV", "development"),
  databaseUrl: str("DATABASE_URL", "postgres://wfo:wfo@127.0.0.1:55432/wfo"),
  redisUrl: str("REDIS_URL", "redis://127.0.0.1:56379"),

  api: {
    port: int("PORT", 3000),
    // Optional shared secret. When set, every /api request and the WebSocket must present it.
    token: process.env.API_TOKEN || "",
    corsOrigin: str("CORS_ORIGIN", "*"),
  },

  worker: {
    id: str("WORKER_ID", `${os.hostname()}-${process.pid}`),
    concurrency: int("WORKER_CONCURRENCY", 4),
    healthPort: int("WORKER_HEALTH_PORT", 9100),
    heartbeatMs: int("WORKER_HEARTBEAT_MS", 3000),
  },

  engine: {
    defaultTimeoutMs: int("STEP_DEFAULT_TIMEOUT_MS", 10 * 60_000),
    retryBackoffMs: int("STEP_RETRY_BACKOFF_MS", 2_000),
    // Tasks left in "queued" longer than this without a BullMQ job get re-enqueued.
    reconcileAfterMs: int("RECONCILE_AFTER_MS", 60_000),
  },

  llm: {
    // auto = live when Claude credentials exist, otherwise a local mock so the platform runs offline.
    mode: (llmModeRaw === "auto" ? (hasClaudeCredentials() ? "live" : "mock") : llmModeRaw) as "live" | "mock",
    model: str("CLAUDE_MODEL", "claude-opus-5-5"),
    maxTokens: int("CLAUDE_MAX_TOKENS", 16000),
  },

  http: {
    // Comma-separated host allowlist for "http" steps. Empty = allow all.
    allowedHosts: str("HTTP_STEP_ALLOWED_HOSTS", "")
      .split(",")
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean),
  },

  scaling: {
    // keda | hpa | deployment | none. "none" means scaling is managed outside the platform (local dev).
    kind: str("SCALER_KIND", process.env.KUBERNETES_SERVICE_HOST ? "keda" : "none") as
      | "keda"
      | "hpa"
      | "deployment"
      | "none",
    namespace: str("K8S_NAMESPACE", "wfo"),
    workerDeployment: str("WORKER_DEPLOYMENT", "wfo-worker"),
    scaledObject: str("WORKER_SCALEDOBJECT", "wfo-worker"),
    hpa: str("WORKER_HPA", "wfo-worker"),
  },
} as const;

export type AppConfig = typeof config;
