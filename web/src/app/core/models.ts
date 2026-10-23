// Mirrors backend/src/core/types.ts.

export type StepType = 'llm' | 'http' | 'delay' | 'transform' | 'approval';
export type RunStatus = 'running' | 'paused' | 'succeeded' | 'failed' | 'cancelled';
export type TaskStatus =
  | 'pending'
  | 'queued'
  | 'running'
  | 'waiting_approval'
  | 'succeeded'
  | 'failed'
  | 'skipped'
  | 'cancelled';

export const RUN_STATUSES: RunStatus[] = ['running', 'paused', 'succeeded', 'failed', 'cancelled'];

export interface StepDefinition {
  id: string;
  name?: string;
  type: StepType;
  config: Record<string, unknown>;
  dependsOn: string[];
  retries: number;
  timeoutMs?: number;
  when?: string;
}

export interface WorkflowDefinition {
  steps: StepDefinition[];
  exampleInput?: Record<string, unknown>;
}

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

export interface WorkflowListItem extends Workflow {
  runCount: number;
  lastRun: { id: string; status: RunStatus; createdAt: string } | null;
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

export interface RunSummary extends Omit<Run, 'definition'> {
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
  attempt: number;
  retriesLeft: number;
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
  level: 'info' | 'warn' | 'error';
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

export interface QueueStats {
  waiting: number;
  active: number;
  delayed: number;
  completed: number;
  failed: number;
  paused: boolean;
}

export interface MetricsSummary {
  runs: {
    running: number;
    paused: number;
    succeeded24h: number;
    failed24h: number;
    started24h: number;
    successRate24h: number | null;
  };
  tasks: { queued: number; running: number; waitingApproval: number };
  taskDuration: { avgMs: number; p95Ms: number };
  queue: QueueStats;
  workers: { count: number; capacity: number; busy: number };
}

export interface ThroughputPoint {
  minute: string;
  succeeded: number;
  failed: number;
}

export interface ScalingState {
  kind: 'keda' | 'hpa' | 'deployment' | 'none';
  available: boolean;
  error?: string;
  deployment: { name: string; desired: number | null; ready: number | null };
  autoscaler: { min: number | null; max: number | null } | null;
  note: string;
}

export interface AuditEntry {
  id: number;
  actor: string;
  action: string;
  targetType: string;
  targetId: string;
  details: unknown;
  createdAt: string;
}

export interface PlatformInfo {
  llmMode: 'live' | 'mock';
  model: string;
  scalingKind: ScalingState['kind'];
  authRequired: boolean;
  version: string;
}

export interface ValidationIssue {
  path: string;
  message: string;
}

export type OrchestratorEvent =
  | { type: 'hello'; at: string }
  | { type: 'run.updated'; run: RunSummary }
  | { type: 'task.updated'; task: Task }
  | { type: 'task.log'; log: TaskLog }
  | { type: 'task.stream'; taskId: string; runId: string; text: string }
  | { type: 'worker.heartbeat'; worker: WorkerInfo }
  | { type: 'worker.offline'; workerId: string }
  | { type: 'queue.updated'; queue: QueueStats }
  | { type: 'workflow.updated'; workflowId: string };
