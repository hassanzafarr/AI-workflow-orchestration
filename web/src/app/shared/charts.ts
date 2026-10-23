import { Component, computed, inject, input } from '@angular/core';
import { ThroughputPoint } from '../core/models';
import { QueueSample, RealtimeService } from '../core/realtime.service';
import { timeAgo } from './format';

/** Stacked per-minute bars: succeeded steps with failures on top. */
@Component({
  selector: 'app-throughput-chart',
  template: `
    @if (peak() === 0) {
      <p class="chart-idle"><i class="lamp s-pending"></i>No steps finished in this window. Run a workflow and its steps land here minute by minute.</p>
    } @else {
      <svg class="chart" [attr.viewBox]="'0 0 ' + width + ' ' + height" preserveAspectRatio="none" role="img" aria-label="Steps completed per minute">
        @for (line of grid(); track line.y) {
          <line class="chart-grid" x1="0" [attr.x2]="width" [attr.y1]="line.y" [attr.y2]="line.y" />
        }
        <line class="chart-base" x1="0" [attr.x2]="width" [attr.y1]="height" [attr.y2]="height" />
        @for (b of bars(); track b.x) {
          <rect class="bar-ok" [attr.x]="b.x" [attr.y]="b.yOk" [attr.width]="b.w" [attr.height]="b.hOk"><title>{{ b.label }}</title></rect>
          @if (b.hFail > 0) {
            <rect class="bar-fail" [attr.x]="b.x" [attr.y]="b.yFail" [attr.width]="b.w" [attr.height]="b.hFail"><title>{{ b.label }}</title></rect>
          }
        }
      </svg>
      <div class="chart-legend">
        <span><i class="key key-done"></i>Succeeded</span><span><i class="key key-fail"></i>Failed</span>
        <span class="muted num">Peak {{ peak() }}/min</span>
      </div>
    }
  `,
})
export class ThroughputChart {
  readonly points = input.required<ThroughputPoint[]>();
  protected readonly width = 600;
  protected readonly height = 140;

  protected readonly peak = computed(() => Math.max(0, ...this.points().map((p) => p.succeeded + p.failed)));
  protected readonly grid = computed(() => [0.25, 0.5, 0.75].map((f) => ({ y: this.height * f })));
  protected readonly bars = computed(() => {
    const pts = this.points();
    const max = Math.max(1, this.peak());
    const slot = this.width / Math.max(1, pts.length);
    return pts.map((p, i) => {
      const hOk = (p.succeeded / max) * (this.height - 4);
      const hFail = (p.failed / max) * (this.height - 4);
      return {
        x: i * slot + 1,
        w: Math.max(1, slot - 2),
        hOk,
        yOk: this.height - hOk,
        hFail,
        yFail: this.height - hOk - hFail,
        label: `${new Date(p.minute).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}: ${p.succeeded} ok, ${p.failed} failed`,
      };
    });
  });
}

/** Queue depth (area) against live worker count (line) - shows autoscaling reacting to load. */
@Component({
  selector: 'app-scaling-chart',
  template: `
    @if (paths().maxQueue === 0) {
      <p class="chart-idle">
        <i class="lamp s-pending"></i>Nothing queued or running{{ lastActivity() ? '; last activity ' + lastActivity() : '' }}. {{ workersNow() }} {{ workersNow() === 1 ? 'worker' : 'workers' }} standing by.
      </p>
    } @else {
      <svg class="chart" [attr.viewBox]="'0 0 ' + width + ' ' + height" preserveAspectRatio="none" role="img" aria-label="Queue depth and workers over time">
        <line class="chart-base" x1="0" [attr.x2]="width" [attr.y1]="height" [attr.y2]="height" />
        <path class="area-queue" [attr.d]="paths().area" />
        <path class="line-workers" [attr.d]="paths().workers" />
      </svg>
      <div class="chart-legend">
        <span><i class="key key-queue"></i>Waiting + active steps <span class="num">(max {{ paths().maxQueue }})</span></span>
        <span><i class="key key-workers"></i>Workers <span class="num">(max {{ paths().maxWorkers }})</span></span>
        <span class="muted">Last 10 min</span>
      </div>
    }
  `,
})
export class ScalingChart {
  readonly samples = input.required<QueueSample[]>();
  private readonly rt = inject(RealtimeService);
  protected readonly width = 600;
  protected readonly height = 140;

  protected readonly workersNow = computed(() => this.samples().at(-1)?.workers ?? 0);
  /** Idle time is read from the newest real event, not from when this page started sampling. */
  protected readonly lastActivity = computed(() => {
    const newest = this.rt.activity()[0]?.at;
    return newest ? timeAgo(newest, this.samples().at(-1)?.at) : '';
  });

  protected readonly paths = computed(() => {
    const s = this.samples();
    const maxQueue = Math.max(0, ...s.map((p) => p.waiting + p.active));
    const maxWorkers = Math.max(0, ...s.map((p) => p.workers));
    if (s.length < 2) return { area: '', workers: '', maxQueue, maxWorkers };
    const t0 = s[0].at;
    const span = Math.max(1, s[s.length - 1].at - t0);
    const x = (at: number) => ((at - t0) / span) * this.width;
    const yQ = (v: number) => this.height - (v / Math.max(1, maxQueue)) * (this.height - 6);
    const yW = (v: number) => this.height - (v / Math.max(1, maxWorkers)) * (this.height - 10) - 2;
    const line = s.map((p, i) => `${i ? 'L' : 'M'}${x(p.at).toFixed(1)},${yQ(p.waiting + p.active).toFixed(1)}`).join(' ');
    return {
      area: `${line} L${this.width},${this.height} L0,${this.height} Z`,
      workers: s.map((p, i) => `${i ? 'L' : 'M'}${x(p.at).toFixed(1)},${yW(p.workers).toFixed(1)}`).join(' '),
      maxQueue,
      maxWorkers,
    };
  });
}
