import { Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiService } from '../core/api.service';
import { MetricsSummary, RunSummary, ThroughputPoint } from '../core/models';
import { RealtimeService } from '../core/realtime.service';
import { ToastService } from '../core/toast.service';
import { ScalingChart, ThroughputChart } from '../shared/charts';
import { AgoPipe, DurationPipe, ShortIdPipe } from '../shared/format';
import { StatusBadge } from '../shared/status-badge';

@Component({
  selector: 'app-overview',
  imports: [RouterLink, StatusBadge, ThroughputChart, ScalingChart, AgoPipe, DurationPipe, ShortIdPipe],
  template: `
    <div class="page-head">
      <div>
        <h1>Overview</h1>
        <p class="muted">Live state of every workflow, queue and worker.</p>
      </div>
      <div class="actions">
        @if (rt.queue()?.paused) {
          <button class="btn success" (click)="toggleQueue()">▶ Resume queue</button>
        } @else {
          <button class="btn danger-ghost" (click)="toggleQueue()" title="Stop all workers from picking up new steps">⏸ Pause all execution</button>
        }
        <a class="btn primary" routerLink="/workflows">Start a workflow</a>
      </div>
    </div>

    @if (rt.queue()?.paused) {
      <div class="banner danger">Execution is paused globally. Running steps finish; queued steps wait until you resume.</div>
    }

    <section class="kpis">
      <div class="kpi">
        <div class="kpi-label">Active runs</div>
        <div class="kpi-value">{{ liveCounts().running }}</div>
        <div class="kpi-sub">{{ liveCounts().paused }} paused · {{ summary()?.runs?.started24h ?? 0 }} started today</div>
      </div>
      <div class="kpi">
        <div class="kpi-label">Queue depth</div>
        <div class="kpi-value">{{ rt.queue()?.waiting ?? summary()?.queue?.waiting ?? '–' }}</div>
        <div class="kpi-sub">{{ rt.queue()?.active ?? 0 }} running · {{ rt.queue()?.delayed ?? 0 }} retrying later</div>
      </div>
      <div class="kpi">
        <div class="kpi-label">Worker utilization</div>
        <div class="kpi-value">{{ utilization() }}</div>
        <div class="kpi-sub">{{ rt.busy() }} of {{ rt.capacity() }} slots · {{ rt.workerList().length }} workers</div>
        <div class="meter"><span [style.width.%]="utilizationPct()"></span></div>
      </div>
      <div class="kpi">
        <div class="kpi-label">Success rate (24h)</div>
        <div class="kpi-value">{{ successRate() }}</div>
        <div class="kpi-sub">{{ summary()?.runs?.succeeded24h ?? 0 }} ok · {{ summary()?.runs?.failed24h ?? 0 }} failed</div>
      </div>
      <a class="kpi kpi-link" routerLink="/runs" [queryParams]="{ status: 'running' }" [class.kpi-attn]="(summary()?.tasks?.waitingApproval ?? 0) > 0">
        <div class="kpi-label">Awaiting approval</div>
        <div class="kpi-value">{{ summary()?.tasks?.waitingApproval ?? '–' }}</div>
        <div class="kpi-sub">manual gates blocking runs</div>
      </a>
      <div class="kpi">
        <div class="kpi-label">Step duration (1h)</div>
        <div class="kpi-value">{{ summary()?.taskDuration?.avgMs | duration }}</div>
        <div class="kpi-sub">p95 {{ summary()?.taskDuration?.p95Ms | duration }}</div>
      </div>
    </section>

    <section class="grid-2">
      <div class="card">
        <div class="card-head"><h2>Throughput</h2><span class="muted">steps finished per minute, last 30 min</span></div>
        <app-throughput-chart [points]="throughput()" />
      </div>
      <div class="card">
        <div class="card-head"><h2>Load vs. workers</h2><a routerLink="/workers" class="muted">scaling →</a></div>
        @if (rt.history().length > 1) {
          <app-scaling-chart [samples]="rt.history()" />
        } @else {
          <div class="empty small">Collecting live samples…</div>
        }
      </div>
    </section>

    <section class="grid-2">
      <div class="card">
        <div class="card-head"><h2>Active runs</h2><a routerLink="/runs" class="muted">all runs →</a></div>
        @if (activeRuns().length) {
          <div class="list">
            @for (run of activeRuns(); track run.id) {
              <a class="list-row" [routerLink]="['/runs', run.id]">
                <div class="grow">
                  <div class="row-title">{{ run.workflowName }} <span class="mono muted">#{{ run.id | short }}</span></div>
                  <div class="progress"><span class="p-done" [style.width.%]="pct(run.progress.done, run.progress.total)"></span><span class="p-run" [style.width.%]="pct(run.progress.running, run.progress.total)"></span></div>
                </div>
                <div class="row-meta">
                  <app-status [status]="run.status" />
                  <span class="muted small">{{ run.progress.done }}/{{ run.progress.total }} · {{ run.startedAt | ago: tick() }}</span>
                </div>
              </a>
            }
          </div>
        } @else {
          <div class="empty">No runs in flight. <a routerLink="/workflows">Start one</a> to watch it here live.</div>
        }
      </div>
      <div class="card">
        <div class="card-head"><h2>Live activity</h2><span class="muted">{{ rt.connected() ? 'streaming' : 'offline' }}</span></div>
        @if (rt.activity().length) {
          <ul class="feed">
            @for (a of rt.activity(); track a.id) {
              <li>
                <span class="feed-time mono">{{ a.at.slice(11, 19) }}</span>
                <a [routerLink]="['/runs', a.runId]" class="feed-label">{{ a.kind === 'run' ? 'Run · ' : '' }}{{ a.label }}</a>
                <app-status [status]="a.status" />
              </li>
            }
          </ul>
        } @else {
          <div class="empty">Events appear here as workers pick up steps.</div>
        }
      </div>
    </section>
  `,
})
export class OverviewPage {
  protected readonly rt = inject(RealtimeService);
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);

  protected readonly summary = signal<MetricsSummary | null>(null);
  protected readonly throughput = signal<ThroughputPoint[]>([]);
  private readonly initialRuns = signal<RunSummary[]>([]);
  protected readonly tick = signal(0);

  /** Server snapshot merged with live run.updated events. */
  private readonly inFlight = computed(() => {
    const merged = new Map(this.initialRuns().map((r) => [r.id, r]));
    for (const r of this.rt.runs().values()) merged.set(r.id, r);
    return [...merged.values()].filter((r) => r.status === 'running' || r.status === 'paused');
  });
  protected readonly activeRuns = computed(() =>
    [...this.inFlight()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 8),
  );
  protected readonly liveCounts = computed(() => ({
    running: this.inFlight().filter((r) => r.status === 'running').length,
    paused: this.inFlight().filter((r) => r.status === 'paused').length,
  }));
  protected readonly utilizationPct = computed(() => (this.rt.capacity() ? (this.rt.busy() / this.rt.capacity()) * 100 : 0));
  protected readonly utilization = computed(() => (this.rt.capacity() ? `${Math.round(this.utilizationPct())}%` : '–'));
  protected readonly successRate = computed(() => {
    const rate = this.summary()?.runs?.successRate24h;
    return rate === null || rate === undefined ? '–' : `${(rate * 100).toFixed(rate === 1 ? 0 : 1)}%`;
  });

  constructor() {
    this.refresh();
    this.api.runs({ status: 'running,paused', limit: 200 }).subscribe((r) => this.initialRuns.set(r.runs));
    const interval = setInterval(() => {
      this.tick.update((t) => t + 1);
      if (this.tick() % 3 === 0) this.refresh();
    }, 2000);
    inject(DestroyRef).onDestroy(() => clearInterval(interval));
  }

  protected pct(n: number, total: number): number {
    return total ? (n / total) * 100 : 0;
  }

  protected toggleQueue(): void {
    const action = this.rt.queue()?.paused ? 'resume' : 'pause';
    this.api.queueAction(action).subscribe({
      next: (q) => {
        this.rt.queue.set(q);
        this.toast.success(action === 'pause' ? 'Execution paused for all workflows' : 'Execution resumed');
      },
      error: (e) => this.toast.error(e),
    });
  }

  private refresh(): void {
    this.api.summary().subscribe({ next: (s) => this.summary.set(s), error: () => undefined });
    this.api.throughput(30).subscribe({ next: (t) => this.throughput.set(t), error: () => undefined });
  }
}
