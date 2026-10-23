import { computed, inject, Injectable, signal } from '@angular/core';
import { ApiService } from './api.service';
import { RunStatus, RunSummary, StepType, Task, TaskStatus, WorkflowListItem } from './models';
import { RealtimeService } from './realtime.service';

/** Andon lamp states: what the line board shows for a workflow or the queue. */
export type Lamp = 'run' | 'wait' | 'fail' | 'queue' | 'hold' | 'off';

export interface Station {
  stepId: string;
  name: string;
  type: StepType;
  status: TaskStatus;
  updatedAt: string;
}

export interface TrackedRun {
  run: RunSummary;
  /** Steps in definition order with their live status; empty until the run detail loads. */
  stations: Station[];
}

export interface WorkflowLamp {
  workflow: WorkflowListItem;
  lamp: Lamp;
  live: number;
  waiting: number;
  /** The run held at an approval gate, when there is one. */
  gateRunId: string | null;
  last: { status: RunStatus; at: string } | null;
}

export interface Attention {
  kind: 'approval' | 'failed' | 'paused';
  key: string;
  runId?: string;
  stepId?: string;
  title: string;
  detail: string;
  at?: string;
}

const LIVE: RunStatus[] = ['running', 'paused'];
/** Finished runs stay on the board briefly so their lamps visibly go quiet. */
const LINGER_MS = 20_000;
const FAILED_WINDOW_MS = 24 * 3600_000;

/**
 * The line: every workflow's lamp, the runs in flight with per-step status, and what needs an
 * operator. Built from one snapshot plus the broadcast run.updated / task.updated events.
 */
@Injectable({ providedIn: 'root' })
export class LineService {
  private readonly api = inject(ApiService);
  private readonly rt = inject(RealtimeService);

  readonly workflows = signal<WorkflowListItem[]>([]);
  readonly tracked = signal<Map<string, TrackedRun>>(new Map());
  private readonly lastRun = signal<Map<string, { status: RunStatus; at: string }>>(new Map());
  private readonly failed = signal<RunSummary[]>([]);
  /** Task updates that arrived before their run's detail loaded. */
  private readonly early = new Map<string, Task[]>();
  private readonly loading = new Set<string>();

  /** Running runs held at an approval gate: their lamp reads yellow, not green. */
  readonly gated = computed(
    () => new Set([...this.tracked().values()].filter((t) => t.run.status === 'running' && t.stations.some((s) => s.status === 'waiting_approval')).map((t) => t.run.id)),
  );
  readonly liveCount = computed(() => [...this.tracked().values()].filter((t) => LIVE.includes(t.run.status)).length);

  readonly inFlight = computed(() =>
    [...this.tracked().values()].sort((a, b) => b.run.createdAt.localeCompare(a.run.createdAt)),
  );

  readonly lamps = computed<WorkflowLamp[]>(() => {
    const runs = [...this.tracked().values()];
    const last = this.lastRun();
    return [...this.workflows()]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((workflow) => {
        const mine = runs.filter((t) => t.run.workflowId === workflow.id && LIVE.includes(t.run.status));
        const waiting = mine.reduce((n, t) => n + t.stations.filter((s) => s.status === 'waiting_approval').length, 0);
        const gateRunId = mine.find((t) => t.stations.some((s) => s.status === 'waiting_approval'))?.run.id ?? null;
        const lastRun = last.get(workflow.id) ?? null;
        let lamp: Lamp = 'off';
        if (waiting) lamp = 'wait';
        else if (mine.some((t) => t.run.status === 'running')) lamp = 'run';
        else if (mine.length) lamp = 'hold';
        else if (lastRun?.status === 'failed') lamp = 'fail';
        return { workflow, lamp, live: mine.length, waiting, gateRunId, last: lastRun };
      });
  });

  readonly queueLamp = computed<Lamp>(() => {
    const q = this.rt.queue();
    if (!q) return 'off';
    if (q.paused) return 'fail';
    if (q.active) return 'run';
    return q.waiting ? 'queue' : 'off';
  });

  readonly attention = computed<Attention[]>(() => {
    const items: Attention[] = [];
    if (this.rt.queue()?.paused) {
      items.push({ kind: 'paused', key: 'queue', title: 'Execution is paused', detail: 'Running steps finish; queued steps wait until you resume.' });
    }
    for (const t of this.inFlight()) {
      for (const s of t.stations) {
        if (s.status !== 'waiting_approval') continue;
        items.push({ kind: 'approval', key: `${t.run.id}:${s.stepId}`, runId: t.run.id, stepId: s.stepId, title: `${t.run.workflowName}: ${s.name}`, detail: 'Waiting for approval', at: s.updatedAt });
      }
    }
    const live = this.rt.runs();
    for (const run of this.failed()) {
      // A failed run that was retried is live again, so it no longer needs anyone.
      const now = live.get(run.id)?.status;
      if (now && now !== 'failed') continue;
      items.push({ kind: 'failed', key: run.id, runId: run.id, title: `${run.workflowName} failed`, detail: run.error ?? 'Run failed', at: run.finishedAt ?? run.createdAt });
    }
    return items;
  });

  constructor() {
    this.loadWorkflows();
    this.loadFailed();
    this.api.runs({ status: LIVE.join(','), limit: 50 }).subscribe({ next: (r) => r.runs.forEach((run) => this.track(run)), error: () => undefined });
    this.api.runs({ limit: 20 }).subscribe({
      next: (r) =>
        this.rt.seedActivity(
          r.runs.map((run) => ({ runId: run.id, label: run.workflowName, status: run.status, kind: 'run' as const, at: run.finishedAt ?? run.startedAt ?? run.createdAt })),
        ),
      error: () => undefined,
    });

    this.rt.events$.subscribe((e) => {
      if (e.type === 'run.updated') this.onRun(e.run);
      else if (e.type === 'task.updated') this.onTask(e.task);
      else if (e.type === 'workflow.updated') this.loadWorkflows();
    });
  }

  /** Status to draw for a run: a running run waiting at a gate shows the approval lamp. */
  runLamp(run: { id: string; status: string }): string {
    return this.gated().has(run.id) ? 'waiting_approval' : run.status;
  }

  private onRun(run: RunSummary): void {
    this.lastRun.update((m) => {
      const prev = m.get(run.workflowId);
      return prev && prev.at > run.createdAt ? m : new Map(m).set(run.workflowId, { status: run.status, at: run.createdAt });
    });
    if (this.tracked().has(run.id)) {
      this.tracked.update((m) => new Map(m).set(run.id, { ...m.get(run.id)!, run }));
      if (!LIVE.includes(run.status)) setTimeout(() => this.untrack(run.id), LINGER_MS);
    } else if (LIVE.includes(run.status)) {
      this.track(run);
    }
    if (run.status === 'failed') this.loadFailed();
  }

  private onTask(task: Task): void {
    const tracked = this.tracked().get(task.runId);
    if (!tracked) return;
    if (!tracked.stations.length) {
      this.early.set(task.runId, [...(this.early.get(task.runId) ?? []), task]);
      return;
    }
    this.tracked.update((m) => new Map(m).set(task.runId, { ...tracked, stations: applyTasks(tracked.stations, [task]) }));
  }

  private track(run: RunSummary): void {
    this.tracked.update((m) => new Map(m).set(run.id, { run, stations: m.get(run.id)?.stations ?? [] }));
    if (this.loading.has(run.id)) return;
    this.loading.add(run.id);
    this.api.run(run.id).subscribe({
      next: ({ run: detail, tasks }) => {
        this.loading.delete(run.id);
        const base: Station[] = detail.definition.steps.map((s) => ({ stepId: s.id, name: s.name || s.id, type: s.type, status: 'pending', updatedAt: '' }));
        const stations = applyTasks(applyTasks(base, tasks), this.early.get(run.id) ?? []);
        this.early.delete(run.id);
        this.tracked.update((m) => (m.has(run.id) ? new Map(m).set(run.id, { ...m.get(run.id)!, stations }) : m));
      },
      error: () => this.loading.delete(run.id),
    });
  }

  private untrack(runId: string): void {
    const t = this.tracked().get(runId);
    if (!t || LIVE.includes(t.run.status)) return;
    this.tracked.update((m) => {
      const next = new Map(m);
      next.delete(runId);
      return next;
    });
  }

  private loadWorkflows(): void {
    this.api.workflows().subscribe({
      next: (list) => {
        this.workflows.set(list);
        this.lastRun.update((m) => {
          const next = new Map(m);
          for (const w of list) {
            const prev = next.get(w.id);
            if (w.lastRun && (!prev || prev.at <= w.lastRun.createdAt)) next.set(w.id, { status: w.lastRun.status, at: w.lastRun.createdAt });
          }
          return next;
        });
      },
      error: () => undefined,
    });
  }

  private loadFailed(): void {
    this.api.runs({ status: 'failed', limit: 5 }).subscribe({
      next: (r) => this.failed.set(r.runs.filter((run) => Date.now() - new Date(run.createdAt).getTime() < FAILED_WINDOW_MS)),
      error: () => undefined,
    });
  }
}

/** Newer task updates win, compared by updatedAt. */
function applyTasks(stations: Station[], tasks: Task[]): Station[] {
  const latest = new Map<string, Task>();
  for (const t of tasks) {
    const prev = latest.get(t.stepId);
    if (!prev || prev.updatedAt <= t.updatedAt) latest.set(t.stepId, t);
  }
  return stations.map((s) => {
    const t = latest.get(s.stepId);
    return t && t.updatedAt >= s.updatedAt ? { ...s, status: t.status, name: t.name || s.name, updatedAt: t.updatedAt } : s;
  });
}
