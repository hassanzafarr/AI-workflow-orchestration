import { DecimalPipe } from '@angular/common';
import { Component, DestroyRef, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../core/api.service';
import { ScalingState } from '../core/models';
import { RealtimeService } from '../core/realtime.service';
import { ToastService } from '../core/toast.service';
import { ScalingChart } from '../shared/charts';
import { AgoPipe, DurationPipe, elapsed } from '../shared/format';
import { Icon } from '../shared/icon';
import { StatusBadge } from '../shared/status-badge';

@Component({
  selector: 'app-workers',
  imports: [FormsModule, DecimalPipe, ScalingChart, Icon, StatusBadge, AgoPipe, DurationPipe],
  template: `
    <div class="page-head">
      <div>
        <h1>Workers &amp; scaling</h1>
        <p class="lede">Worker pods pull steps from the queue. Kubernetes adds pods as the queue grows and drains them gracefully on scale-in.</p>
      </div>
    </div>

    <div class="workers-top">
      <section class="panel" aria-labelledby="queue-title">
        <header class="panel-head">
          <h2 id="queue-title">Queue</h2>
          <app-status [status]="rt.queue()?.paused ? 'paused' : 'running'" />
        </header>
        @if (rt.queue(); as q) {
          <dl class="stat-row">
            <div><dt>Waiting</dt><dd class="num">{{ q.waiting }}</dd></div>
            <div><dt>Running</dt><dd class="num">{{ q.active }}</dd></div>
            <div><dt>Retry backoff</dt><dd class="num">{{ q.delayed }}</dd></div>
            <div><dt>Job errors</dt><dd class="num">{{ q.failed }}</dd></div>
          </dl>
        }
        <div class="actions">
          @if (rt.queue()?.paused) {
            <button class="btn primary" (click)="queue('resume')"><app-icon name="play" />Resume execution</button>
          } @else {
            <button class="btn danger-outline" (click)="queue('pause')"><app-icon name="pause" />Pause all execution</button>
          }
        </div>
        <p class="hint">Pausing stops every worker from starting new steps; steps already running finish. Use it during incidents or downstream outages.</p>
      </section>

      <section class="panel" aria-labelledby="scale-title">
        <header class="panel-head">
          <h2 id="scale-title">Autoscaling</h2>
          <span class="tag">{{ scaling()?.kind ?? '…' }}</span>
        </header>
        @if (scaling(); as s) {
          <p class="hint">{{ s.note }}</p>
          @if (s.error) {
            <p class="error-text"><app-icon name="alert" />{{ s.error }}</p>
          }
          @if (s.available) {
            <dl class="stat-row">
              <div><dt>Desired pods</dt><dd class="num">{{ s.deployment.desired ?? '–' }}</dd></div>
              <div><dt>Ready pods</dt><dd class="num">{{ s.deployment.ready ?? '–' }}</dd></div>
              @if (s.autoscaler) {
                <div><dt>Min</dt><dd class="num">{{ s.autoscaler.min }}</dd></div>
                <div><dt>Max</dt><dd class="num">{{ s.autoscaler.max }}</dd></div>
              }
            </dl>
            <div class="form-row">
              @if (s.kind === 'deployment') {
                <label>Replicas <input type="number" min="0" [(ngModel)]="replicas" /></label>
              } @else {
                <label>Min pods <input type="number" min="0" [(ngModel)]="min" /></label>
                <label>Max pods <input type="number" min="1" [(ngModel)]="max" /></label>
              }
              <button class="btn primary" (click)="applyScaling(s)">Apply override</button>
            </div>
            <p class="hint">Raise <strong>min</strong> to pre-warm workers before a known heavy batch; lower <strong>max</strong> to cap spend or protect a rate-limited API.</p>
          }
        } @else {
          <p class="empty small">Reading the autoscaler…</p>
        }
      </section>

      <section class="panel" aria-labelledby="cap-title">
        <header class="panel-head"><h2 id="cap-title">Capacity</h2></header>
        <dl class="stat-row">
          <div><dt>Workers</dt><dd class="num">{{ rt.workerList().length }}</dd></div>
          <div><dt>Slots</dt><dd class="num">{{ rt.capacity() }}</dd></div>
          <div><dt>Busy</dt><dd class="num">{{ rt.busy() }}</dd></div>
          <div><dt>Utilization</dt><dd class="num">{{ rt.capacity() ? ((rt.busy() / rt.capacity()) * 100 | number: '1.0-0') + '%' : '–' }}</dd></div>
        </dl>
        @if (rt.history().length > 1) {
          <app-scaling-chart [samples]="rt.history()" />
        } @else {
          <p class="empty small">Load history draws after a few live samples.</p>
        }
      </section>
    </div>

    <section class="panel flush" aria-label="Workers">
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>Worker</th><th>State</th><th>Slots</th><th class="num hide-sm">Processed</th><th class="num hide-sm">Failed</th><th class="hide-sm">Uptime</th><th>Heartbeat</th></tr></thead>
          <tbody>
            @for (w of rt.workerList(); track w.id) {
              <tr>
                <td><span class="mono strong">{{ w.id }}</span><div class="muted small">{{ w.hostname }}</div></td>
                <td>
                  @if (w.draining) {
                    <span class="badge s-paused"><i class="lamp"></i>Draining</span>
                  } @else if (w.active) {
                    <span class="badge s-running"><i class="lamp"></i>Busy</span>
                  } @else {
                    <span class="badge s-pending"><i class="lamp"></i>Idle</span>
                  }
                </td>
                <td>
                  <div class="slots" role="img" [attr.aria-label]="w.active + ' of ' + w.concurrency + ' slots busy'">
                    @for (slot of slots(w.concurrency); track $index) {
                      <i class="lamp" [class.on]="$index < w.active"></i>
                    }
                    <span class="small muted num">{{ w.active }}/{{ w.concurrency }}</span>
                  </div>
                </td>
                <td class="num hide-sm">{{ w.processed }}</td>
                <td class="num hide-sm">{{ w.failed }}</td>
                <td class="small num hide-sm">{{ uptime(w.startedAt) | duration }}</td>
                <td class="small">{{ w.lastSeen | ago: tick() }}</td>
              </tr>
            } @empty {
              <tr><td colspan="7" class="empty">No workers are reporting. Start one with <code>npm run dev:worker</code> or scale the deployment.</td></tr>
            }
          </tbody>
        </table>
      </div>
    </section>
  `,
})
export class WorkersPage {
  protected readonly rt = inject(RealtimeService);
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);

  protected readonly scaling = signal<ScalingState | null>(null);
  protected readonly tick = signal(0);
  private readonly now = signal(Date.now());
  protected min = 1;
  protected max = 10;
  protected replicas = 1;

  constructor() {
    this.loadScaling();
    this.rt.refreshWorkers();
    this.api.queue().subscribe({ next: (q) => this.rt.queue.set(q), error: () => undefined });
    const timer = setInterval(() => {
      this.now.set(Date.now());
      this.tick.update((t) => t + 1);
      if (this.tick() % 10 === 0) this.loadScaling(false);
    }, 1000);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

  protected slots(n: number): number[] {
    return Array.from({ length: n });
  }

  protected uptime(startedAt: string): number | null {
    return elapsed(startedAt, null, this.now());
  }

  protected queue(action: 'pause' | 'resume'): void {
    this.api.queueAction(action).subscribe({
      next: (q) => {
        this.rt.queue.set(q);
        this.toast.success(action === 'pause' ? 'Execution paused' : 'Execution resumed');
      },
      error: (e) => this.toast.error(e),
    });
  }

  protected applyScaling(s: ScalingState): void {
    const body = s.kind === 'deployment' ? { replicas: this.replicas } : { min: this.min, max: this.max };
    this.api.setScaling(body).subscribe({
      next: (state) => {
        this.scaling.set(state);
        this.toast.success('Scaling override applied');
      },
      error: (e) => this.toast.error(e),
    });
  }

  private loadScaling(syncForm = true): void {
    this.api.scaling().subscribe({
      next: (s) => {
        this.scaling.set(s);
        if (syncForm) {
          this.min = s.autoscaler?.min ?? 1;
          this.max = s.autoscaler?.max ?? 10;
          this.replicas = s.deployment.desired ?? 1;
        }
      },
      error: () => undefined,
    });
  }
}
