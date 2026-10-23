import { z } from "zod";

export const STEP_TYPES = ["llm", "http", "delay", "transform", "approval"] as const;
export type StepType = (typeof STEP_TYPES)[number];

export const RUN_STATUSES = ["running", "paused", "succeeded", "failed", "cancelled"] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const TASK_STATUSES = [
  "pending",
  "queued",
  "running",
  "waiting_approval",
  "succeeded",
  "failed",
  "skipped",
  "cancelled",
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

/** Task states after which a dependent step may start. */
export const SATISFIED: ReadonlySet<TaskStatus> = new Set(["succeeded", "skipped"]);
export const TERMINAL_TASK: ReadonlySet<TaskStatus> = new Set(["succeeded", "failed", "skipped", "cancelled"]);
export const TERMINAL_RUN: ReadonlySet<RunStatus> = new Set(["succeeded", "failed", "cancelled"]);

const stepId = z
  .string()
  .regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/, "Step id must start with a letter and use letters, digits, - or _");

export const llmConfigSchema = z.object({
  prompt: z.string().min(1),
  system: z.string().optional(),
  model: z.string().optional(),
  maxTokens: z.number().int().positive().max(128_000).optional(),
  effort: z.enum(["low", "medium", "high", "xhigh", "max"]).optional(),
  /** JSON Schema; when present Claude must answer with JSON matching it (structured outputs). */
  outputSchema: z.record(z.string(), z.unknown()).optional(),
});

export const httpConfigSchema = z.object({
  url: z.string().min(1),
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).default("GET"),
  headers: z.record(z.string(), z.string()).optional(),
  body: z.unknown().optional(),
  /** Fail the step unless the response status is in this list. Default: any 2xx. */
  expectStatus: z.array(z.number().int()).optional(),
});

export const delayConfigSchema = z.object({
  ms: z.number().int().min(0).max(24 * 3600_000),
  /** Probability (0-1) that the step fails. Used to exercise retries and overrides. */
  failRate: z.number().min(0).max(1).optional(),
});

export const transformConfigSchema = z.object({
  /** Any JSON value; string leaves may contain {{templates}}. */
  output: z.unknown(),
});

export const approvalConfigSchema = z.object({
  message: z.string().default("Approval required"),
});

export const stepConfigSchemas = {
  llm: llmConfigSchema,
  http: httpConfigSchema,
  delay: delayConfigSchema,
  transform: transformConfigSchema,
  approval: approvalConfigSchema,
} satisfies Record<StepType, z.ZodType>;

export const stepSchema = z.object({
  id: stepId,
  name: z.string().min(1).max(120).optional(),
  type: z.enum(STEP_TYPES),
  config: z.record(z.string(), z.unknown()).default({}),
  dependsOn: z.array(stepId).default([]),
  /** Automatic retries after the first failed attempt. */
  retries: z.number().int().min(0).max(10).default(0),
  timeoutMs: z.number().int().positive().max(6 * 3600_000).optional(),
  /** Template evaluated when the step becomes ready; falsy result skips the step. */
  when: z.string().optional(),
});

export const definitionSchema = z.object({
  steps: z.array(stepSchema).min(1).max(200),
  /** Pre-fills the run dialog in the dashboard. */
  exampleInput: z.record(z.string(), z.unknown()).optional(),
});

export type StepDefinition = z.infer<typeof stepSchema>;
export type WorkflowDefinition = z.infer<typeof definitionSchema>;

export interface Workflow {
  id: string;
  name: string;
  description: string;
  definition: WorkflowDefinition;
  schedule: string | null;
  enabled: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface Run {
  id: string;
  workflowId: string;
  workflowName: string;
  workflowVersion: number;
  definition: WorkflowDefinition;
  status: RunStatus;
  trigger: string;
  input: Record<string, unknown>;
  output: unknown;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface RunSummary extends Omit<Run, "definition"> {
  progress: { total: number; done: number; running: number; failed: number };
}

export interface Task {
  id: string;
  runId: string;
  stepId: string;
  name: string;
  type: StepType;
  status: TaskStatus;
  dependsOn: string[];
  /** Executions started so far (shown to operators). */
  attempt: number;
  retriesLeft: number;
  /** Bumped on every (re)enqueue; identifies the live queue job so stale jobs are ignored. */
  generation: number;
  output: unknown;
  error: string | null;
  workerId: string | null;
  queuedAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  updatedAt: string;
}

export interface TaskLog {
  id: number;
  taskId: string;
  runId: string;
  level: "info" | "warn" | "error";
  message: string;
  createdAt: string;
}

export interface WorkerInfo {
  id: string;
  hostname: string;
  concurrency: number;
  active: number;
  processed: number;
  failed: number;
  startedAt: string;
  lastSeen: string;
  activeTasks: string[];
  draining: boolean;
}

export interface TaskJobData {
  taskId: string;
  runId: string;
  generation: number;
}

export type OrchestratorEvent =
  | { type: "run.updated"; run: RunSummary }
  | { type: "task.updated"; task: Task }
  | { type: "task.log"; log: TaskLog }
  | { type: "task.stream"; taskId: string; runId: string; text: string }
  | { type: "worker.heartbeat"; worker: WorkerInfo }
  | { type: "worker.offline"; workerId: string }
  | { type: "queue.updated"; queue: QueueStats }
  | { type: "workflow.updated"; workflowId: string };

export interface QueueStats {
  waiting: number;
  active: number;
  delayed: number;
  completed: number;
  failed: number;
  paused: boolean;
}

export type ControlMessage = { type: "abort"; runId?: string; taskIds?: string[]; reason: string };

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}
