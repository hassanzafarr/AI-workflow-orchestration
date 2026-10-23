import { DecimalPipe } from '@angular/common';
import { Component, DestroyRef, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../core/api.service';
import { ScalingState } from '../core/models';
import { RealtimeService } from '../core/realtime.service';
import { ToastService } from '../core/toast.service';
import { ScalingChart } from '../shared/charts';
import { AgoPipe, DurationPipe, elapsed } from '../shared/format';

@Component({
  selector: 'app-workers',
  imports: [FormsModule, DecimalPipe, ScalingChart, AgoPipe, DurationPipe],
  template: `
    <div class="page-head">
      <div>
        <h1>Workers &amp; scaling</h1>
        <p class="muted">Worker pods pull steps from the queue. Kubernetes adds pods as the queue grows and drains them gracefully on scale-in.</p>
      </div>
    </div>

    <section class="grid-3">
      <div class="card">
        <div class="card-head"><h2>Queue</h2>
          @if (rt.queue()?.paused) { <span class="pill pill-danger">paused</span> } @else { <span class="pill pill-ok">flowing</span> }
        </div>
        @if (rt.queue(); as q) {
          <div class="stat-grid">
            <div><b>{{ q.waiting }}</b><span>waiting</span></div>
            <div><b>{{ q.active }}</b><span>running</span></div>
            <div><b>{{ q.delayed }}</b><span>retry backoff</span></div>
            <div><b>{{ q.failed }}</b><span>job errors</span></div>
          </div>
        }
        <div class="actions">
          @if (rt.queue()?.paused) {
            <button class="btn success" (click)="queue('resume')">▶ Resume execution</button>
          } @else {
            <button class="btn danger-ghost" (click)="queue('pause')">⏸ Pause all execution</button>
          }
        </div>
        <p class="muted small">Pausing stops every worker from starting new steps (in-flight steps finish). Use it during incidents or downstream outages.</p>
      </div>

      <div class="card">
        <div class="card-head"><h2>Autoscaling</h2><span class="tag">{{ scaling()?.kind ?? '…' }}</span></div>
        @if (scaling(); as s) {
          <p class="small">{{ s.note }}</p>
          @if (s.error) {
            <div class="error-text small">{{ s.error }}</div>
          }
          @if (s.available) {
            <div class="stat-grid">
              <div><b>{{ s.deployment.desired ?? '-' }}</b><span>desired pods</span></div>
              <div><b>{{ s.deployment.ready ?? '-' }}</b><span>ready pods</span></div>
              @if (s.autoscaler) {
                <div><b>{{ s.autoscaler.min }}</b><span>min</span></div>
                <div><b>{{ s.autoscaler.max }}</b><span>max</span></div>
              }
            </div>
            <div class="form-row">
              @if (s.kind === 'deployment') {
                <label>Replicas <input type="number" min="0" [(ngModel)]="replicas" /></label>
              } @else {
                <label>Min <input type="number" min="0" [(ngModel)]="min" /></label>
                <label>Max <input type="number" min="1" [(ngModel)]="max" /></label>
              }
              <button class="btn primary" (click)="applyScaling(s)">Apply override</button>
            </div>
            <p class="muted small">Raise <b>min</b> to pre-warm workers before a known heavy batch; lower <b>max</b> to cap spend or protect a rate-limited API.</p>
          }
        }
      </div>

      <div class="card">
        <div class="card-head"><h2>Capacity</h2></div>
        <div class="stat-grid">
          <div><b>{{ rt.workerList().length }}</b><span>workers</span></div>
          <div><b>{{ rt.capacity() }}</b><span>slots</span></div>
          <div><b>{{ rt.busy() }}</b><span>busy</span></div>
          <div><b>{{ rt.capacity() ? ((rt.busy() / rt.capacity()) * 100 | number: '1.0-0') + '%' : '-' }}</b><span>utilization</span></div>
        </div>
        @if (rt.history().length > 1) {
          <app-scaling-chart [samples]="rt.history()" />
        }
      </div>
    </section>

    <div class="card flush">
      <table class="table">
        <thead><tr><th>Worker</th><th>State</th><th>Load</th><th>Processed</th><th>Failed</th><th>Uptime</th><th>Heartbeat</th></tr></thead>
        <tbody>
          @for (w of rt.workerList(); track w.id) {
            <tr>
              <td class="mono">{{ w.id }}<div class="muted small">{{ w.hostname }}</div></td>
              <td>
                @if (w.draining) { <span class="pill pill-warn">draining</span> } @else if (w.active) { <span class="pill pill-ok">busy</span> } @else { <span class="pill">idle</span> }
              </td>
              <td class="w-progress">
                <div class="slots">
                  @for (slot of slots(w.concurrency); track $index) {
                    <i [class.on]="$index < w.active"></i>
                  }
                </div>
                <span class="small muted">{{ w.active }}/{{ w.concurrency }}</span>
              </td>
              <td class="mono">{{ w.processed }}</td>
              <td class="mono">{{ w.failed }}</td>
              <td class="small">{{ uptime(w.startedAt) | duration }}</td>
              <td class="small">{{ w.lastSeen | ago: tick() }}</td>
            </tr>
          } @empty {
            <tr><td colspan="7" class="empty">No workers are reporting. Start one with <code>npm run dev:worker</code> or scale the deployment.</td></tr>
          }
        </tbody>
      </table>
    </div>
  `,
})
export class WorkersPage {
  protected readonly rt = inject(RealtimeService);
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);

  protected readonly scaling = signal<ScalingState | null>(null);
  protected readonly tick = signal(0);
  protected min = 1;
  protected max = 10;
  protected replicas = 1;

  constructor() {
    this.loadScaling();
    this.rt.refreshWorkers();
    this.api.queue().subscribe({ next: (q) => this.rt.queue.set(q), error: () => undefined });
    const timer = setInterval(() => {
      this.tick.update((t) => t + 1);
      if (this.tick() % 10 === 0) this.loadScaling(false);
    }, 1000);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

  protected slots(n: number): number[] {
    return Array.from({ length: n });
  }

  protected uptime(startedAt: string): number | null {
    this.tick();
    return elapsed(startedAt);
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
