import { computed, effect, inject, Injectable, signal } from '@angular/core';
import { Subject } from 'rxjs';
import { ApiService } from './api.service';
import { OrchestratorEvent, QueueStats, RunSummary, TaskStatus, WorkerInfo } from './models';
import { SettingsService } from './settings.service';

export interface ActivityItem {
  id: number;
  at: string;
  runId: string;
  label: string;
  status: TaskStatus | RunSummary['status'];
  kind: 'run' | 'task';
}

export interface QueueSample {
  at: number;
  waiting: number;
  active: number;
  workers: number;
}

/**
 * Single WebSocket to the API with automatic reconnect, plus the live state every page shares:
 * workers (from heartbeats), queue depth, recent run summaries and an activity feed.
 */
@Injectable({ providedIn: 'root' })
export class RealtimeService {
  private api = inject(ApiService);
  private settings = inject(SettingsService);

  readonly events$ = new Subject<OrchestratorEvent>();
  readonly connected = signal(false);
  readonly workers = signal<Map<string, WorkerInfo>>(new Map());
  readonly queue = signal<QueueStats | null>(null);
  readonly runs = signal<Map<string, RunSummary>>(new Map());
  readonly activity = signal<ActivityItem[]>([]);
  /** Rolling 10-minute history of queue depth vs. worker count, sampled from live events. */
  readonly history = signal<QueueSample[]>([]);

  readonly workerList = computed(() => [...this.workers().values()].sort((a, b) => a.startedAt.localeCompare(b.startedAt)));
  readonly capacity = computed(() => this.workerList().reduce((n, w) => n + w.concurrency, 0));
  readonly busy = computed(() => this.workerList().reduce((n, w) => n + w.active, 0));

  private socket: WebSocket | null = null;
  private watched = new Map<string, number>();
  private retry = 0;
  private activityId = 1;
  private taskStatus = new Map<string, TaskStatus>();

  constructor() {
    // Reconnect whenever the token changes (and on first run).
    effect(() => {
      this.settings.token();
      this.connect();
    });
    this.refreshWorkers();
    setInterval(() => this.pruneWorkers(), 5000);
  }

  /** Receive logs and token streams for a run. Returns an unsubscribe function. */
  watchRun(runId: string): () => void {
    this.watched.set(runId, (this.watched.get(runId) ?? 0) + 1);
    this.send({ type: 'subscribe', runId });
    return () => {
      const n = (this.watched.get(runId) ?? 1) - 1;
      if (n > 0) this.watched.set(runId, n);
      else {
        this.watched.delete(runId);
        this.send({ type: 'unsubscribe', runId });
      }
    };
  }

  refreshWorkers(): void {
    this.api.workers().subscribe({
      next: (list) => this.workers.set(new Map(list.map((w) => [w.id, w]))),
      error: () => undefined,
    });
  }

  private send(msg: unknown): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(msg));
  }

  private connect(): void {
    this.socket?.close();
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const token = this.settings.token();
    const socket = new WebSocket(`${proto}://${location.host}/ws${token ? `?token=${encodeURIComponent(token)}` : ''}`);
    this.socket = socket;

    socket.onopen = () => {
      this.retry = 0;
      this.connected.set(true);
      for (const runId of this.watched.keys()) this.send({ type: 'subscribe', runId });
      this.refreshWorkers();
    };
    socket.onmessage = (e) => {
      const event = JSON.parse(e.data) as OrchestratorEvent;
      this.apply(event);
      this.events$.next(event);
    };
    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.connected.set(false);
      const delay = Math.min(1000 * 2 ** this.retry++, 15_000);
      setTimeout(() => this.socket === socket && this.connect(), delay);
    };
  }

  private apply(event: OrchestratorEvent): void {
    switch (event.type) {
      case 'worker.heartbeat':
        this.workers.update((m) => new Map(m).set(event.worker.id, event.worker));
        break;
      case 'worker.offline':
        this.workers.update((m) => {
          const next = new Map(m);
          next.delete(event.workerId);
          return next;
        });
        break;
      case 'queue.updated':
        this.queue.set(event.queue);
        this.history.update((h) =>
          [...h, { at: Date.now(), waiting: event.queue.waiting, active: event.queue.active, workers: this.workers().size }].filter(
            (s) => s.at > Date.now() - 10 * 60_000,
          ),
        );
        break;
      case 'run.updated': {
        const previous = this.runs().get(event.run.id);
        this.runs.update((m) => {
          const next = new Map(m).set(event.run.id, event.run);
          // Keep the cache bounded.
          if (next.size > 300) next.delete(next.keys().next().value!);
          return next;
        });
        if (!previous || previous.status !== event.run.status) {
          this.pushActivity({ runId: event.run.id, label: event.run.workflowName, status: event.run.status, kind: 'run' });
        }
        break;
      }
      case 'task.updated': {
        const t = event.task;
        if (this.taskStatus.get(t.id) !== t.status) {
          this.taskStatus.set(t.id, t.status);
          if (this.taskStatus.size > 5000) this.taskStatus.clear();
          if (t.status !== 'pending') this.pushActivity({ runId: t.runId, label: t.name, status: t.status, kind: 'task' });
        }
        break;
      }
    }
  }

  private pushActivity(item: Omit<ActivityItem, 'id' | 'at'>): void {
    this.activity.update((list) => [{ ...item, id: this.activityId++, at: new Date().toISOString() }, ...list].slice(0, 60));
  }

  private pruneWorkers(): void {
    const cutoff = Date.now() - 20_000;
    const stale = [...this.workers().values()].filter((w) => new Date(w.lastSeen).getTime() < cutoff);
    if (!stale.length) return;
    this.workers.update((m) => {
      const next = new Map(m);
      for (const w of stale) next.delete(w.id);
      return next;
    });
  }
}
