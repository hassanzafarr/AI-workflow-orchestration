import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.js";

/**
 * Thin wrapper over the Anthropic SDK used by LLM steps and the AI assistant features.
 * In mock mode (no credentials, or LLM_MODE=mock) it returns deterministic local output so the
 * whole platform can be demoed and load-tested offline without spending tokens.
 */

let client: Anthropic | null = null;
export const claude = () => (client ??= new Anthropic());

/** Models that accept server-side refusal fallbacks with `fallbacks: "default"`. */
const FALLBACK_MODELS = new Set(["claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"]);
export const fallbackParams = (model: string) =>
  FALLBACK_MODELS.has(model) ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {};

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export interface CompletionRequest {
  prompt: string;
  system?: string;
  model?: string;
  maxTokens?: number;
  effort?: Effort;
  outputSchema?: Record<string, unknown>;
  signal?: AbortSignal;
  /** Called with each text delta while the response streams. */
  onText?: (delta: string) => void;
}

export interface CompletionResult {
  text: string;
  data?: unknown;
  model: string;
  stopReason: string | null;
  usage: { inputTokens: number; outputTokens: number };
  mock: boolean;
}

export class ClaudeError extends Error {}

export async function complete(req: CompletionRequest): Promise<CompletionResult> {
  return config.llm.mode === "mock" ? mockComplete(req) : liveComplete(req);
}

async function liveComplete(req: CompletionRequest): Promise<CompletionResult> {
  const model = req.model ?? config.llm.model;
  const outputConfig: Anthropic.Beta.BetaOutputConfig = {};
  if (req.effort) outputConfig.effort = req.effort;
  if (req.outputSchema) outputConfig.format = { type: "json_schema", schema: req.outputSchema };

  let message: Anthropic.Beta.BetaMessage;
  try {
    // Streaming keeps long generations clear of HTTP timeouts and lets the dashboard show tokens live.
    const stream = claude().beta.messages.stream(
      {
        model,
        max_tokens: req.maxTokens ?? config.llm.maxTokens,
        ...(req.system ? { system: req.system } : {}),
        messages: [{ role: "user", content: req.prompt }],
        ...(Object.keys(outputConfig).length ? { output_config: outputConfig } : {}),
        ...fallbackParams(model),
      },
      { signal: req.signal },
    );
    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") req.onText?.(event.delta.text);
    }
    message = await stream.finalMessage();
  } catch (err) {
    if (err instanceof Anthropic.APIUserAbortError) throw err;
    if (err instanceof Anthropic.AuthenticationError) throw new ClaudeError("Claude API authentication failed - check ANTHROPIC_API_KEY");
    if (err instanceof Anthropic.RateLimitError) throw new ClaudeError("Claude API rate limited (429) - the step will retry if it has retries left");
    if (err instanceof Anthropic.BadRequestError) throw new ClaudeError(`Claude API rejected the request: ${err.message}`);
    if (err instanceof Anthropic.APIError) throw new ClaudeError(`Claude API error ${err.status ?? ""}: ${err.message}`);
    throw err;
  }

  if (message.stop_reason === "refusal") {
    const category = message.stop_details?.category ?? "unspecified";
    throw new ClaudeError(`Claude declined this request (category: ${category})`);
  }

  const text = message.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  let data: unknown;
  if (req.outputSchema) {
    try {
      data = JSON.parse(text);
    } catch {
      throw new ClaudeError(
        message.stop_reason === "max_tokens"
          ? "Structured output was truncated by max_tokens - raise maxTokens for this step"
          : "Claude returned output that is not valid JSON",
      );
    }
  }

  return {
    text,
    data,
    model: message.model,
    stopReason: message.stop_reason,
    usage: { inputTokens: message.usage.input_tokens, outputTokens: message.usage.output_tokens },
    mock: false,
  };
}

/* ---------------------------------------- mock ---------------------------------------- */

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(signal.reason);
    }, { once: true });
  });
}

/** Builds a plausible value for a JSON Schema so structured-output steps work offline. */
export function mockFromSchema(schema: Record<string, any>, key = "value"): unknown {
  if (Array.isArray(schema.enum) && schema.enum.length) return schema.enum[0];
  if ("const" in schema) return schema.const;
  const type = Array.isArray(schema.type) ? schema.type.find((t: string) => t !== "null") : schema.type;
  switch (type) {
    case "object":
      return Object.fromEntries(
        Object.entries((schema.properties ?? {}) as Record<string, Record<string, any>>).map(([k, v]) => [k, mockFromSchema(v, k)]),
      );
    case "array":
      return [mockFromSchema(schema.items ?? { type: "string" }, key)];
    case "integer":
      return 3;
    case "number":
      return 0.8;
    case "boolean":
      return key.toLowerCase().includes("escalat") ? false : true;
    default:
      return `mock ${key}`;
  }
}

async function mockComplete(req: CompletionRequest): Promise<CompletionResult> {
  const model = req.model ?? config.llm.model;
  const data = req.outputSchema ? mockFromSchema(req.outputSchema as Record<string, any>) : undefined;
  const text =
    data !== undefined
      ? JSON.stringify(data, null, 2)
      : [
          `This is a mock response from ${model} (LLM_MODE=mock; set ANTHROPIC_API_KEY for live Claude calls).`,
          "",
          `Prompt received (${req.prompt.length} chars): "${req.prompt.slice(0, 160).replace(/\s+/g, " ")}${req.prompt.length > 160 ? "..." : ""}"`,
          "",
          "Key points:",
          "1. The orchestration engine rendered this step's templates and dispatched it to a worker.",
          "2. Output streams to the dashboard token by token, exactly like a live Claude call.",
          "3. Downstream steps can reference this text via {{steps.<id>.output.text}}.",
        ].join("\n");

  for (const word of text.split(/(?<=\s)/)) {
    await sleep(18, req.signal);
    req.onText?.(word);
  }
  return {
    text,
    data,
    model,
    stopReason: "end_turn",
    usage: { inputTokens: Math.ceil(req.prompt.length / 4), outputTokens: Math.ceil(text.length / 4) },
    mock: true,
  };
}
