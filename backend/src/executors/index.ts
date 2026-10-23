import { complete } from "../ai/claude.js";
import { config } from "../config.js";
import { render, type TemplateContext } from "../core/template.js";
import {
  approvalConfigSchema,
  delayConfigSchema,
  httpConfigSchema,
  llmConfigSchema,
  transformConfigSchema,
  type StepDefinition,
  type StepType,
} from "../core/types.js";

export interface ExecutionContext {
  step: StepDefinition;
  template: TemplateContext;
  signal: AbortSignal;
  log: (level: "info" | "warn" | "error", message: string) => Promise<void>;
  /** Streams partial output (e.g. LLM tokens) to the dashboard. Not persisted. */
  stream: (text: string) => void;
}

export type ExecutionResult = { status: "succeeded"; output: unknown } | { status: "waiting_approval"; output: unknown };

type Executor = (ctx: ExecutionContext) => Promise<ExecutionResult>;

function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(signal.reason);
    }, { once: true });
  });
}

const renderConfig = (ctx: ExecutionContext) => render(ctx.step.config, ctx.template);

const llm: Executor = async (ctx) => {
  const cfg = llmConfigSchema.parse(renderConfig(ctx));
  const prompt = typeof cfg.prompt === "string" ? cfg.prompt : JSON.stringify(cfg.prompt);
  await ctx.log("info", `Calling ${cfg.model ?? config.llm.model}${config.llm.mode === "mock" ? " (mock)" : ""} - prompt ${prompt.length} chars`);
  const result = await complete({
    prompt,
    system: cfg.system,
    model: cfg.model,
    maxTokens: cfg.maxTokens,
    effort: cfg.effort,
    outputSchema: cfg.outputSchema,
    signal: ctx.signal,
    onText: ctx.stream,
  });
  await ctx.log(
    "info",
    `Claude finished (${result.stopReason}) - ${result.usage.inputTokens} in / ${result.usage.outputTokens} out tokens`,
  );
  if (result.stopReason === "max_tokens") await ctx.log("warn", "Output hit maxTokens and may be truncated");
  return {
    status: "succeeded",
    output: {
      text: result.text,
      ...(result.data !== undefined ? { data: result.data } : {}),
      model: result.model,
      usage: result.usage,
      mock: result.mock,
    },
  };
};

const http: Executor = async (ctx) => {
  const cfg = httpConfigSchema.parse(renderConfig(ctx));
  const url = new URL(cfg.url);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error(`Unsupported protocol ${url.protocol}`);
  if (config.http.allowedHosts.length && !config.http.allowedHosts.includes(url.hostname.toLowerCase())) {
    throw new Error(`Host ${url.hostname} is not in HTTP_STEP_ALLOWED_HOSTS`);
  }

  const headers: Record<string, string> = { "user-agent": "wfo-worker/0.1", ...cfg.headers };
  let body: string | undefined;
  if (cfg.body !== undefined && cfg.method !== "GET") {
    body = typeof cfg.body === "string" ? cfg.body : JSON.stringify(cfg.body);
    if (typeof cfg.body !== "string") headers["content-type"] ??= "application/json";
  }

  await ctx.log("info", `${cfg.method} ${url.href}`);
  const started = Date.now();
  const response = await fetch(url, { method: cfg.method, headers, body, signal: ctx.signal });
  const raw = await response.text();
  const truncated = raw.length > 1_000_000;
  const text = truncated ? raw.slice(0, 1_000_000) : raw;
  let parsed: unknown = text;
  if ((response.headers.get("content-type") ?? "").includes("json")) {
    try {
      parsed = JSON.parse(text);
    } catch {
      /* keep text */
    }
  }
  await ctx.log("info", `HTTP ${response.status} in ${Date.now() - started}ms (${raw.length} bytes${truncated ? ", truncated" : ""})`);

  const ok = cfg.expectStatus ? cfg.expectStatus.includes(response.status) : response.ok;
  if (!ok) throw new Error(`Unexpected HTTP status ${response.status}: ${text.slice(0, 300)}`);
  return {
    status: "succeeded",
    output: { status: response.status, headers: Object.fromEntries(response.headers), body: parsed },
  };
};

const delay: Executor = async (ctx) => {
  const cfg = delayConfigSchema.parse(renderConfig(ctx));
  await ctx.log("info", `Working for ${cfg.ms}ms`);
  const slices = 4;
  for (let i = 1; i <= slices; i++) {
    await abortableSleep(cfg.ms / slices, ctx.signal);
    ctx.stream(`${Math.round((i / slices) * 100)}% `);
  }
  if (cfg.failRate && Math.random() < cfg.failRate) throw new Error(`Simulated failure (failRate ${cfg.failRate})`);
  return { status: "succeeded", output: { sleptMs: cfg.ms, finishedAt: new Date().toISOString() } };
};

const transform: Executor = async (ctx) => {
  const cfg = transformConfigSchema.parse(renderConfig(ctx));
  return { status: "succeeded", output: cfg.output };
};

const approval: Executor = async (ctx) => {
  const cfg = approvalConfigSchema.parse(renderConfig(ctx));
  await ctx.log("info", `Waiting for operator approval: ${cfg.message}`);
  return { status: "waiting_approval", output: { message: cfg.message } };
};

const executors: Record<StepType, Executor> = { llm, http, delay, transform, approval };

export function execute(ctx: ExecutionContext): Promise<ExecutionResult> {
  return executors[ctx.step.type](ctx);
}
