import { Component, computed, DestroyRef, effect, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { ApiService } from '../core/api.service';
import { RUN_STATUSES, RunStatus, RunSummary } from '../core/models';
import { RealtimeService } from '../core/realtime.service';
import { ToastService } from '../core/toast.service';
import { AgoPipe, DurationPipe, elapsed, ShortIdPipe } from '../shared/format';
import { Icon } from '../shared/icon';
import { StatusBadge } from '../shared/status-badge';

const PAGE = 50;

@Component({
  selector: 'app-runs',
  imports: [RouterLink, StatusBadge, Icon, AgoPipe, DurationPipe, ShortIdPipe],
  template: `
    <div class="page-head">
      <div>
        <h1>Runs</h1>
        <p class="lede">{{ total() }} {{ total() === 1 ? 'run' : 'runs' }}{{ workflowId() ? ' of this workflow' : '' }}. New runs and status changes stream in live.</p>
      </div>
    </div>

    <div class="toolbar">
      <div class="segmented" role="group" aria-label="Filter by status">
        <button [class.active]="!status()" [attr.aria-pressed]="!status()" (click)="setStatus(null)">All</button>
        @for (s of statuses; track s) {
          <button [class.active]="status() === s" [attr.aria-pressed]="status() === s" (click)="setStatus(s)">{{ s[0].toUpperCase() + s.slice(1) }}</button>
        }
      </div>
      @if (workflowId()) {
        <button class="chip active" (click)="clearWorkflow()">One workflow <app-icon name="close" /><span class="sr-only">Clear workflow filter</span></button>
      }
    </div>

    <section class="panel flush">
      <div class="table-wrap">
        <table class="table">
          <thead>
            <tr><th>Run</th><th>Status</th><th>Progress</th><th class="hide-sm">Trigger</th><th class="hide-sm">Started</th><th class="num hide-sm">Duration</th></tr>
          </thead>
          <tbody>
            @for (run of visible(); track run.id) {
              <tr class="clickable" (click)="open(run.id)">
                <td class="run-cell">
                  <a class="strong-link" [routerLink]="['/runs', run.id]" (click)="$event.stopPropagation()">{{ run.workflowName }}</a>
                  <div class="muted small"><span class="mono">#{{ run.id | short }}</span> · v{{ run.workflowVersion }}</div>
                </td>
                <td><app-status [status]="run.status" /></td>
                <td class="w-progress">
                  <div class="progress" role="img" [attr.aria-label]="run.progress.done + ' of ' + run.progress.total + ' steps done'">
                    <span class="p-done" [style.width.%]="pct(run.progress.done, run.progress.total)"></span><span class="p-run" [style.width.%]="pct(run.progress.running, run.progress.total)"></span><span class="p-fail" [style.width.%]="pct(run.progress.failed, run.progress.total)"></span>
                  </div>
                  <span class="small muted num">{{ run.progress.done }}/{{ run.progress.total }}</span>
                </td>
                <td class="hide-sm"><span class="tag">{{ run.trigger }}</span></td>
                <td class="small hide-sm">{{ run.createdAt | ago: tick() }}</td>
                <td class="small num hide-sm">{{ duration(run) | duration }}</td>
              </tr>
            } @empty {
              <tr><td colspan="6" class="empty">{{ loading() ? 'Loading runs…' : status() ? 'No ' + status() + ' runs.' : 'No runs yet. Start one from Workflows.' }}</td></tr>
            }
          </tbody>
        </table>
      </div>
    </section>
    @if (rows().length < total()) {
      <div class="center"><button class="btn" (click)="loadMore()">Load more</button></div>
    }
  `,
})
export class RunsPage {
  /** Query params, bound by the router. */
  readonly statusParam = input<string | undefined>(undefined, { alias: 'status' });
  readonly workflowId = input<string | undefined>();

  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly rt = inject(RealtimeService);
  private readonly toast = inject(ToastService);

  protected readonly statuses = RUN_STATUSES;
  protected readonly status = computed(() => (this.statusParam() as RunStatus | undefined) ?? null);
  protected readonly rows = signal<RunSummary[]>([]);
  protected readonly total = signal(0);
  protected readonly loading = signal(true);
  protected readonly tick = signal(0);
  private readonly now = signal(Date.now());

  /** Server page merged with live run.updated events; new runs appear at the top. */
  protected readonly visible = computed(() => {
    const live = this.rt.runs();
    const status = this.status();
    const wf = this.workflowId();
    const byId = new Map(this.rows().map((r) => [r.id, r]));
    for (const r of live.values()) {
      if (byId.has(r.id)) byId.set(r.id, r);
      else if ((!wf || r.workflowId === wf) && new Date(r.createdAt) > this.loadedAt) byId.set(r.id, r);
    }
    return [...byId.values()]
      .filter((r) => !status || r.status === status)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  });

  private loadedAt = new Date();

  constructor() {
    effect(() => {
      this.status();
      this.workflowId();
      this.load(true);
    });
    const timer = setInterval(() => {
      this.now.set(Date.now());
      this.tick.update((t) => t + 1);
    }, 1000);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

  protected pct(n: number, total: number): number {
    return total ? (n / total) * 100 : 0;
  }

  protected duration(run: RunSummary): number | null {
    return elapsed(run.startedAt, run.finishedAt, this.now());
  }

  protected setStatus(status: RunStatus | null): void {
    this.router.navigate([], { queryParams: { status }, queryParamsHandling: 'merge' });
  }

  protected clearWorkflow(): void {
    this.router.navigate([], { queryParams: { workflowId: null }, queryParamsHandling: 'merge' });
  }

  protected open(id: string): void {
    this.router.navigate(['/runs', id]);
  }

  protected loadMore(): void {
    this.load(false);
  }

  private load(reset: boolean): void {
    this.loading.set(true);
    const offset = reset ? 0 : this.rows().length;
    this.api.runs({ status: this.status() ?? undefined, workflowId: this.workflowId(), limit: PAGE, offset }).subscribe({
      next: (res) => {
        if (reset) this.loadedAt = new Date();
        this.rows.set(reset ? res.runs : [...this.rows(), ...res.runs]);
        this.total.set(res.total);
        this.loading.set(false);
      },
      error: (e) => {
        this.loading.set(false);
        this.toast.error(e);
      },
    });
  }
}
