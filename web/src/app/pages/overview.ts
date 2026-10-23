import { Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { ApiService } from '../core/api.service';
import { LineService, WorkflowLamp } from '../core/line.service';
import { MetricsSummary, ThroughputPoint } from '../core/models';
import { RealtimeService } from '../core/realtime.service';
import { ToastService } from '../core/toast.service';
import { ScalingChart, ThroughputChart } from '../shared/charts';
import { AgoPipe, DurationPipe, ShortIdPipe } from '../shared/format';
import { Icon } from '../shared/icon';
import { Stations } from '../shared/stations';
import { StatusBadge } from '../shared/status-badge';

const LAMP_LABEL: Record<WorkflowLamp['lamp'], string> = {
  run: 'Running',
  wait: 'Awaiting approval',
  fail: 'Last run failed',
  hold: 'Paused',
  queue: 'Queued',
  off: 'Idle',
};
const LAMP_STATUS: Record<WorkflowLamp['lamp'], string> = {
  run: 'running',
  wait: 'waiting_approval',
  fail: 'failed',
  hold: 'paused',
  queue: 'queued',
  off: 'pending',
};

@Component({
  selector: 'app-overview',
  imports: [RouterLink, StatusBadge, Stations, ThroughputChart, ScalingChart, Icon, AgoPipe, DurationPipe, ShortIdPipe],
  template: `
    <div class="page-head">
      <div>
        <h1>Overview</h1>
        <p class="lede">Every workflow, queue and worker, live. Lamps light up only where something is running or needs you.</p>
      </div>
      <div class="actions">
        <a class="btn primary" routerLink="/workflows"><app-icon name="play" />Start a workflow</a>
      </div>
    </div>

    <div class="ov-top">
      <section class="panel" aria-labelledby="needs-title">
        <header class="panel-head">
          <h2 id="needs-title">Needs you</h2>
          <span class="panel-meta">{{ line.attention().length ? line.attention().length + ' open' : 'All clear' }}</span>
        </header>
        @if (line.attention().length) {
          <ul class="attn-list">
            @for (a of line.attention(); track a.key) {
              <li class="attn" [class]="'attn s-' + (a.kind === 'approval' ? 'waiting_approval' : 'failed')">
                <i class="lamp"></i>
                <div class="grow">
                  <div class="attn-title">{{ a.title }}</div>
                  <div class="attn-detail">
                    {{ a.detail }}
                    @if (a.runId) {
                      · <span class="mono">#{{ a.runId | short }}</span>
                    }
                    @if (a.at) {
                      · {{ a.at | ago: tick() }}
                    }
                  </div>
                </div>
                @switch (a.kind) {
                  @case ('approval') {
                    <a class="btn sm" [routerLink]="['/runs', a.runId]" [queryParams]="{ step: a.stepId }">Review</a>
                  }
                  @case ('failed') {
                    <a class="btn sm" [routerLink]="['/runs', a.runId]">Inspect</a>
                  }
                  @default {
                    <button class="btn sm" (click)="resumeQueue()"><app-icon name="play" />Resume</button>
                  }
                }
              </li>
            }
          </ul>
        } @else {
          <p class="empty">Nothing needs you. Approval gates and failed runs land here the moment they happen.</p>
        }
      </section>

      <section class="panel" aria-labelledby="flight-title">
        <header class="panel-head">
          <h2 id="flight-title">Runs in flight</h2>
          <a routerLink="/runs" class="panel-link">All runs <app-icon name="next" /></a>
        </header>
        @if (line.inFlight().length) {
          <ul class="flight-list">
            @for (t of line.inFlight(); track t.run.id) {
              <li>
                <a class="flight" [routerLink]="['/runs', t.run.id]">
                  <div class="flight-main">
                    <div class="flight-title">{{ t.run.workflowName }} <span class="mono id">#{{ t.run.id | short }}</span></div>
                    <app-stations [stations]="t.stations" />
                    <div class="flight-step">{{ currentStep(t.stations) }}</div>
                  </div>
                  <div class="flight-meta">
                    <app-status [status]="line.runLamp(t.run)" />
                    <span class="num">{{ t.run.progress.done }}/{{ t.run.progress.total }} steps · {{ t.run.startedAt | ago: tick() }}</span>
                  </div>
                </a>
              </li>
            }
          </ul>
        } @else {
          <p class="empty">No runs in flight. Run a workflow below and watch its stations light up one by one.</p>
        }
      </section>
    </div>

    <section class="panel flush" aria-labelledby="line-title">
      <header class="panel-head pad">
        <h2 id="line-title">Workflows</h2>
        <span class="panel-meta">Run starts immediately with the workflow's example input</span>
      </header>
      <div class="table-wrap">
        <table class="table">
          <thead>
            <tr><th>Workflow</th><th>State</th><th class="hide-sm">Steps</th><th class="hide-sm">Last run</th><th class="num hide-sm">Runs</th><th><span class="sr-only">Actions</span></th></tr>
          </thead>
          <tbody>
            @for (w of line.lamps(); track w.workflow.id) {
              <tr>
                <td><a class="strong-link" [routerLink]="['/workflows', w.workflow.id]">{{ w.workflow.name }}</a></td>
                <td><span class="badge" [class]="'badge s-' + lampStatus(w)"><i class="lamp"></i>{{ lampLabel(w) }}</span></td>
                <td class="hide-sm">
                  <span class="types">
                    @for (type of stepTypes(w); track type) {
                      <span class="type" [title]="type"><app-icon [name]="type" /><span class="sr-only">{{ type }}</span></span>
                    }
                    <span class="num muted">{{ w.workflow.definition.steps.length }}</span>
                  </span>
                </td>
                <td class="muted hide-sm">
                  @if (w.last) {
                    {{ w.last.status[0].toUpperCase() + w.last.status.slice(1) }} · {{ w.last.at | ago: tick() }}
                  } @else {
                    Never
                  }
                </td>
                <td class="num hide-sm">{{ w.workflow.runCount }}</td>
                <td class="row-actions">
                  <button class="btn sm primary" [disabled]="starting() === w.workflow.id" (click)="start(w)">
                    <app-icon name="play" />{{ starting() === w.workflow.id ? 'Starting…' : 'Run' }}
                  </button>
                </td>
              </tr>
            } @empty {
              <tr><td colspan="6" class="empty">Loading workflows…</td></tr>
            }
          </tbody>
        </table>
      </div>
    </section>

    <div class="ov-lower">
      <section class="panel" aria-labelledby="tp-title">
        <header class="panel-head">
          <h2 id="tp-title">Throughput</h2>
          <span class="panel-meta">Steps finished per minute, last 30 min</span>
        </header>
        <app-throughput-chart [points]="throughput()" />
        <dl class="figures">
          <div><dt>Success, 24h</dt><dd class="num">{{ successRate() }}</dd></div>
          <div><dt>Runs started, 24h</dt><dd class="num">{{ summary()?.runs?.started24h ?? '–' }}</dd></div>
          <div><dt>Step time, avg</dt><dd class="num">{{ summary()?.taskDuration?.avgMs | duration }}</dd></div>
          <div><dt>Step time, p95</dt><dd class="num">{{ summary()?.taskDuration?.p95Ms | duration }}</dd></div>
        </dl>
      </section>
      <section class="panel" aria-labelledby="load-title">
        <header class="panel-head">
          <h2 id="load-title">Load vs. workers</h2>
          <a routerLink="/workers" class="panel-link">Scaling <app-icon name="next" /></a>
        </header>
        @if (rt.history().length > 1) {
          <app-scaling-chart [samples]="rt.history()" />
        } @else {
          <p class="empty">Sampling the queue every two seconds. The chart draws after the first few readings.</p>
        }
        <dl class="figures">
          <div><dt>Worker slots busy</dt><dd class="num">{{ rt.busy() }}/{{ rt.capacity() }}</dd></div>
          <div><dt>Workers</dt><dd class="num">{{ rt.workerList().length }}</dd></div>
          <div><dt>Retrying later</dt><dd class="num">{{ rt.queue()?.delayed ?? 0 }}</dd></div>
        </dl>
      </section>
      <section class="panel" aria-labelledby="feed-title">
        <header class="panel-head">
          <h2 id="feed-title">Live activity</h2>
          <span class="panel-meta">{{ rt.connected() ? 'Streaming' : 'Offline' }}</span>
        </header>
        @if (rt.activity().length) {
          <ul class="feed">
            @for (a of rt.activity(); track a.id) {
              <li>
                <span class="feed-time mono">{{ a.at.slice(11, 19) }}</span>
                <a [routerLink]="['/runs', a.runId]" class="feed-label">{{ a.kind === 'run' ? 'Run: ' : '' }}{{ a.label }}</a>
                <app-status [status]="a.status" />
              </li>
            }
          </ul>
        } @else {
          <p class="empty">Step and run events stream in here as workers pick up work.</p>
        }
      </section>
    </div>
  `,
})
export class OverviewPage {
  protected readonly rt = inject(RealtimeService);
  protected readonly line = inject(LineService);
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);

  protected readonly summary = signal<MetricsSummary | null>(null);
  protected readonly throughput = signal<ThroughputPoint[]>([]);
  protected readonly starting = signal<string | null>(null);
  protected readonly tick = signal(0);

  protected readonly successRate = computed(() => {
    const rate = this.summary()?.runs?.successRate24h;
    return rate === null || rate === undefined ? '–' : `${(rate * 100).toFixed(rate === 1 ? 0 : 1)}%`;
  });

  constructor() {
    this.refresh();
    const interval = setInterval(() => {
      this.tick.update((t) => t + 1);
      if (this.tick() % 3 === 0) this.refresh();
    }, 2000);
    inject(DestroyRef).onDestroy(() => clearInterval(interval));
  }

  protected lampLabel(w: WorkflowLamp): string {
    return LAMP_LABEL[w.lamp];
  }

  protected lampStatus(w: WorkflowLamp): string {
    return LAMP_STATUS[w.lamp];
  }

  protected stepTypes(w: WorkflowLamp) {
    return [...new Set(w.workflow.definition.steps.map((s) => s.type))];
  }

  protected currentStep(stations: { name: string; status: string }[]): string {
    const waiting = stations.find((s) => s.status === 'waiting_approval');
    if (waiting) return `${waiting.name}: awaiting approval`;
    const running = stations.filter((s) => s.status === 'running');
    if (running.length) return running.length > 1 ? `${running.length} steps running in parallel` : `${running[0].name}: running`;
    const failed = stations.find((s) => s.status === 'failed');
    if (failed) return `${failed.name}: failed`;
    return stations.length && stations.every((s) => ['succeeded', 'skipped'].includes(s.status)) ? 'All steps finished' : 'Waiting for a worker';
  }

  protected start(w: WorkflowLamp): void {
    this.starting.set(w.workflow.id);
    this.api.startRun(w.workflow.id, w.workflow.definition.exampleInput ?? {}).subscribe({
      next: (run) => {
        this.starting.set(null);
        this.router.navigate(['/runs', run.id]);
      },
      error: (e) => {
        this.starting.set(null);
        this.toast.error(e);
      },
    });
  }

  protected resumeQueue(): void {
    this.api.queueAction('resume').subscribe({
      next: (q) => {
        this.rt.queue.set(q);
        this.toast.success('Execution resumed');
      },
      error: (e) => this.toast.error(e),
    });
  }

  private refresh(): void {
    this.api.summary().subscribe({ next: (s) => this.summary.set(s), error: () => undefined });
    this.api.throughput(30).subscribe({ next: (t) => this.throughput.set(t), error: () => undefined });
  }
}
