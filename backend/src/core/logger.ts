type Level = "debug" | "info" | "warn" | "error";
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = ORDER[(process.env.LOG_LEVEL as Level) ?? "info"] ?? ORDER.info;
const pretty = process.env.LOG_FORMAT ? process.env.LOG_FORMAT === "pretty" : process.env.NODE_ENV !== "production";

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
  child(fields: Record<string, unknown>): Logger;
}

function serializeError(value: unknown): unknown {
  return value instanceof Error ? { message: value.message, stack: value.stack } : value;
}

export function createLogger(base: Record<string, unknown> = {}): Logger {
  const write = (level: Level, msg: string, fields: Record<string, unknown> = {}) => {
    if (ORDER[level] < threshold) return;
    const all = Object.fromEntries(Object.entries({ ...base, ...fields }).map(([k, v]) => [k, serializeError(v)]));
    const out = level === "error" || level === "warn" ? process.stderr : process.stdout;
    if (pretty) {
      const extra = Object.keys(all).length ? ` ${JSON.stringify(all)}` : "";
      out.write(`${new Date().toISOString().slice(11, 23)} ${level.toUpperCase().padEnd(5)} ${msg}${extra}\n`);
    } else {
      out.write(`${JSON.stringify({ time: new Date().toISOString(), level, msg, ...all })}\n`);
    }
  };
  return {
    debug: (m, f) => write("debug", m, f),
    info: (m, f) => write("info", m, f),
    warn: (m, f) => write("warn", m, f),
    error: (m, f) => write("error", m, f),
    child: (fields) => createLogger({ ...base, ...fields }),
  };
}

export const logger = createLogger();
