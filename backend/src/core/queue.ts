import { Queue } from "bullmq";
import { bullConnection } from "./redis.js";
import type { QueueStats, TaskJobData } from "./types.js";

/** Step executions. KEDA scales workers on the length of this queue's wait list (`bull:tasks:wait`). */
export const TASK_QUEUE = "tasks";
/** Cron-triggered workflow starts, produced by BullMQ job schedulers. */
export const TRIGGER_QUEUE = "triggers";

export interface TriggerJobData {
  workflowId: string;
}

let taskQueue: Queue<TaskJobData> | null = null;
let triggerQueue: Queue<TriggerJobData> | null = null;

export function getTaskQueue(): Queue<TaskJobData> {
  return (taskQueue ??= new Queue<TaskJobData>(TASK_QUEUE, {
    connection: bullConnection,
    defaultJobOptions: { removeOnComplete: { age: 3600, count: 5000 }, removeOnFail: { age: 24 * 3600 } },
  }));
}

export function getTriggerQueue(): Queue<TriggerJobData> {
  return (triggerQueue ??= new Queue<TriggerJobData>(TRIGGER_QUEUE, {
    connection: bullConnection,
    defaultJobOptions: { removeOnComplete: 100, removeOnFail: 500 },
  }));
}

export const taskJobId = (taskId: string, generation: number) => `${taskId}.${generation}`;

export async function enqueueTask(data: TaskJobData, delayMs = 0): Promise<void> {
  // Deterministic job id: re-enqueueing the same generation is a no-op while the job exists.
  await getTaskQueue().add("task", data, {
    jobId: taskJobId(data.taskId, data.generation),
    delay: delayMs,
    attempts: 1,
  });
}

export async function getQueueStats(): Promise<QueueStats> {
  const queue = getTaskQueue();
  const [counts, paused] = await Promise.all([
    queue.getJobCounts("waiting", "active", "delayed", "completed", "failed", "prioritized"),
    queue.isPaused(),
  ]);
  return {
    waiting: (counts.waiting ?? 0) + (counts.prioritized ?? 0),
    active: counts.active ?? 0,
    delayed: counts.delayed ?? 0,
    completed: counts.completed ?? 0,
    failed: counts.failed ?? 0,
    paused,
  };
}

export async function syncSchedule(workflowId: string, schedule: string | null, enabled: boolean): Promise<void> {
  const queue = getTriggerQueue();
  const schedulerId = `workflow:${workflowId}`;
  if (!schedule || !enabled) {
    await queue.removeJobScheduler(schedulerId);
    return;
  }
  await queue.upsertJobScheduler(schedulerId, { pattern: schedule }, { name: "trigger", data: { workflowId } });
}

export async function closeQueues(): Promise<void> {
  await Promise.all([taskQueue?.close(), triggerQueue?.close()]);
  taskQueue = null;
  triggerQueue = null;
}
