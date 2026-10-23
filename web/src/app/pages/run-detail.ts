import { Component, computed, DestroyRef, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService } from '../core/api.service';
import { Run, Task, TaskLog, TaskStatus } from '../core/models';
import { RealtimeService } from '../core/realtime.service';
import { ToastService } from '../core/toast.service';
import { DagView } from '../shared/dag-view';
import { AgoPipe, DurationPipe, elapsed, PrettyJsonPipe, ShortIdPipe } from '../shared/format';
import { Icon } from '../shared/icon';
import { StatusBadge } from '../shared/status-badge';

type Tab = 'output' | 'live' | 'logs' | 'config';

@Component({
  selector: 'app-run-detail',
  imports: [RouterLink, FormsModule, DagView, StatusBadge, Icon, AgoPipe, DurationPipe, PrettyJsonPipe, ShortIdPipe],
  template: `
    @if (run(); as run) {
      <nav class="crumbs" aria-label="Breadcrumb"><a routerLink="/runs"><app-icon name="back" />Runs</a></nav>
      <div class="page-head">
        <div>
          <h1>{{ run.workflowName }} <span class="mono id">#{{ run.id | short }}</span></h1>
          <p class="run-meta">
            <app-status [status]="waiting().length && run.status === 'running' ? 'waiting_approval' : run.status" />
            <span>{{ run.trigger }} trigger</span>
            <span>v{{ run.workflowVersion }}</span>
            <span>Started {{ run.startedAt | ago: tick() }}</span>
            <span class="num">{{ runDuration() | duration }} elapsed</span>
            <a [routerLink]="['/workflows', run.workflowId]">Workflow definition</a>
          </p>
        </div>
        <div class="actions">
          @if (run.status === 'running') {
            <button class="btn" (click)="runAction('pause')" title="Finish running steps, start nothing new"><app-icon name="pause" />Pause</button>
          }
          @if (run.status === 'paused') {
            <button class="btn primary" (click)="runAction('resume')"><app-icon name="play" />Resume</button>
          }
          @if (run.status === 'running' || run.status === 'paused') {
            <button class="btn danger-outline" (click)="runAction('cancel')"><app-icon name="stop" />Cancel run</button>
          }
          @if (run.status === 'failed' || run.status === 'cancelled') {
            <button class="btn primary" (click)="runAction('retry')"><app-icon name="retry" />Retry failed steps</button>
          }
        </div>
      </div>

      @if (run.error && run.status !== 'succeeded') {
        <div class="notice s-failed" role="alert"><app-icon name="alert" /><span>{{ run.error }}</span></div>
      }
      @if (waiting().length) {
        <div class="notice s-waiting_approval">
          <app-icon name="approval" />
          <span>{{ waiting().length }} step{{ waiting().length > 1 ? 's are' : ' is' }} waiting for your approval:</span>
          @for (t of waiting(); track t.id) {
            <button class="link" (click)="pick(t.stepId)">{{ t.name }}</button>
          }
        </div>
      }

      <section class="panel" aria-labelledby="graph-title">
        <header class="panel-head">
          <h2 id="graph-title">Execution graph</h2>
          <ul class="legend" aria-label="Legend">
            @for (s of legend; track s) {
              <li><app-status [status]="s" /></li>
            }
          </ul>
        </header>
        <app-dag [steps]="run.definition.steps" [statuses]="statusMap()" [selected]="selected()" (select)="pick($event)" />
      </section>

      <div class="detail-grid">
        <section class="panel flush" aria-label="Steps">
          <div class="table-wrap">
            <table class="table">
              <thead><tr><th>Step</th><th>Status</th><th class="hide-sm">Worker</th><th class="num">Duration</th></tr></thead>
              <tbody>
                @for (t of orderedTasks(); track t.id) {
                  <tr class="clickable" [class.row-selected]="t.stepId === selected()" (click)="pick(t.stepId)">
                    <td>
                      <button class="row-pick" (click)="pick(t.stepId); $event.stopPropagation()" [attr.aria-pressed]="t.stepId === selected()">
                        <app-icon [name]="t.type" /><span class="strong">{{ t.name }}</span>
                      </button>
                    </td>
                    <td>
                      <app-status [status]="t.status" />
                      @if (t.attempt > 1) {
                        <span class="muted small"> · try {{ t.attempt }}</span>
                      }
                    </td>
                    <td class="mono small muted hide-sm">{{ t.workerId ?? '–' }}</td>
                    <td class="num small">{{ taskDuration(t) | duration }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </section>

        <section class="panel inspector" aria-label="Step inspector">
          @if (selectedTask(); as t) {
            <header class="panel-head">
              <h2><app-icon [name]="t.type" />{{ t.name }}</h2>
              <app-status [status]="t.status" />
            </header>
            <dl class="meta">
              <div><dt>Step id</dt><dd class="mono">{{ t.stepId }}</dd></div>
              <div><dt>Type</dt><dd>{{ t.type }}</dd></div>
              <div><dt>Attempt</dt><dd>{{ t.attempt }} · {{ t.retriesLeft }} {{ t.retriesLeft === 1 ? 'retry' : 'retries' }} left</dd></div>
              <div><dt>Worker</dt><dd class="mono">{{ t.workerId ?? '–' }}</dd></div>
              <div><dt>Queued</dt><dd>{{ t.queuedAt | ago: tick() }}</dd></div>
              <div><dt>Duration</dt><dd class="num">{{ taskDuration(t) | duration }}</dd></div>
            </dl>

            @if (t.status === 'waiting_approval') {
              <div class="approval">
                <p><strong>Approval required.</strong> {{ approvalMessage(t) }}</p>
                <label class="sr-only" for="approval-comment">Comment</label>
                <textarea id="approval-comment" rows="2" [(ngModel)]="comment" placeholder="Comment (optional, recorded in the audit log)"></textarea>
                <div class="actions">
                  <button class="btn approve" (click)="taskAction(t, 'approve')"><app-icon name="approve" />Approve</button>
                  <button class="btn danger-outline" (click)="taskAction(t, 'reject')"><app-icon name="cancel" />Reject</button>
                </div>
              </div>
            }

            @if (t.status === 'failed' || t.status === 'cancelled' || canSkip(t.status)) {
              <div class="actions step-actions">
                @if (t.status === 'failed' || t.status === 'cancelled') {
                  <button class="btn sm primary" (click)="taskAction(t, 'retry')"><app-icon name="retry" />Retry step</button>
                }
                @if (canSkip(t.status)) {
                  <button class="btn sm" (click)="taskAction(t, 'skip')" title="Mark as skipped and continue downstream"><app-icon name="skip" />Skip step</button>
                }
                @if (t.status === 'failed') {
                  <button class="btn sm" [disabled]="diagnosing()" (click)="diagnose(t)"><app-icon name="diagnose" />{{ diagnosing() ? 'Asking Claude…' : 'Ask Claude why' }}</button>
                }
              </div>
            }
            @if (t.error && t.status !== 'succeeded') {
              <pre class="error-box">{{ t.error }}</pre>
            }
            @if (diagnosis()[t.id]; as d) {
              <div class="diagnosis"><h3><app-icon name="diagnose" />Claude's diagnosis</h3><p>{{ d }}</p></div>
            }

            <div class="tabs" role="tablist" aria-label="Step details">
              @for (tab of tabs; track tab) {
                <button role="tab" [attr.aria-selected]="activeTab() === tab" [class.active]="activeTab() === tab" (click)="activeTab.set(tab)">
                  {{ tabLabel(tab) }}
                  @if (tab === 'logs') {
                    <span class="count">{{ taskLogs().length }}</span>
                  }
                  @if (tab === 'live' && t.status === 'running') {
                    <i class="lamp live-lamp" aria-label="streaming"></i>
                  }
                </button>
              }
            </div>
            <div role="tabpanel">
              @switch (activeTab()) {
                @case ('output') {
                  @if (t.output !== null && t.output !== undefined) {
                    @if (outputText(t); as text) {
                      <pre class="output prose">{{ text }}</pre>
                    }
                    <pre class="output">{{ t.output | json2 }}</pre>
                  } @else {
                    <p class="empty small">No output yet. It appears here when the step finishes.</p>
                  }
                }
                @case ('live') {
                  @if (streams()[t.id]) {
                    <pre class="output prose live">{{ streams()[t.id] }}@if (t.status === 'running') {<span class="caret">▍</span>}</pre>
                  } @else {
                    <p class="empty small">{{ t.status === 'running' ? 'Waiting for the first tokens…' : 'While an LLM step runs, its tokens stream in here in real time.' }}</p>
                  }
                }
                @case ('logs') {
                  <div class="logs">
                    @for (l of taskLogs(); track l.id) {
                      <div class="log" [class]="'log log-' + l.level"><span class="mono">{{ l.createdAt.slice(11, 23) }}</span> {{ l.message }}</div>
                    } @empty {
                      <p class="empty small">No logs yet.</p>
                    }
                  </div>
                }
                @case ('config') {
                  <pre class="output">{{ stepConfig(t.stepId) | json2 }}</pre>
                }
              }
            </div>
          } @else {
            <p class="empty">Select a step in the graph or the table to inspect it and override it.</p>
          }
        </section>
      </div>

      <div class="io-grid">
        <section class="panel"><header class="panel-head"><h2>Input</h2></header><pre class="output">{{ run.input | json2 }}</pre></section>
        <section class="panel"><header class="panel-head"><h2>Output</h2></header>
          @if (run.output === null) {
            <p class="empty small">{{ run.status === 'succeeded' ? 'This run produced no output.' : 'The run output appears here when the last step finishes.' }}</p>
          } @else {
            <pre class="output">{{ run.output | json2 }}</pre>
          }
        </section>
      </div>
    } @else {
      <p class="empty">{{ notFound() ? 'Run not found. It may have been deleted with its workflow.' : 'Loading run…' }}</p>
    }
  `,
})
export class RunDetailPage {
  readonly id = input.required<string>();
  /** Query param: the step to open first, e.g. from an approval link. */
  readonly step = input<string>();

  private readonly api = inject(ApiService);
  private readonly rt = inject(RealtimeService);
  private readonly toast = inject(ToastService);

  protected readonly tabs: Tab[] = ['output', 'live', 'logs', 'config'];
  protected readonly legend: TaskStatus[] = ['pending', 'queued', 'running', 'waiting_approval', 'succeeded', 'failed', 'skipped'];
  protected readonly run = signal<Run | null>(null);
  protected readonly tasks = signal<Map<string, Task>>(new Map());
  protected readonly logs = signal<TaskLog[]>([]);
  protected readonly streams = signal<Record<string, string>>({});
  protected readonly diagnosis = signal<Record<string, string>>({});
  protected readonly selected = signal<string | null>(null);
  protected readonly activeTab = signal<Tab>('output');
  protected readonly diagnosing = signal(false);
  protected readonly notFound = signal(false);
  protected readonly tick = signal(0);
  /** Clock for live durations, advanced with the tick so a render never reads two different times. */
  private readonly now = signal(Date.now());
  protected comment = '';
  private userPicked = false;

  protected readonly statusMap = computed(() =>
    Object.fromEntries([...this.tasks().values()].map((t) => [t.stepId, { status: t.status, attempt: t.attempt }])),
  );
  protected readonly orderedTasks = computed(() => {
    const order = new Map(this.run()?.definition.steps.map((s, i) => [s.id, i]) ?? []);
    return [...this.tasks().values()].sort((a, b) => (order.get(a.stepId) ?? 0) - (order.get(b.stepId) ?? 0));
  });
  protected readonly selectedTask = computed(() => {
    const id = this.selected();
    return id ? ([...this.tasks().values()].find((t) => t.stepId === id) ?? null) : null;
  });
  protected readonly taskLogs = computed(() => {
    const t = this.selectedTask();
    return t ? this.logs().filter((l) => l.taskId === t.id) : [];
  });
  protected readonly waiting = computed(() => this.orderedTasks().filter((t) => t.status === 'waiting_approval'));
  protected readonly runDuration = computed(() => {
    const r = this.run();
    return r ? elapsed(r.startedAt, r.finishedAt, this.now()) : null;
  });

  constructor() {
    const destroy = inject(DestroyRef);
    let unwatch: (() => void) | null = null;

    effect(() => {
      const id = this.id();
      unwatch?.();
      unwatch = this.rt.watchRun(id);
      this.load(id);
    });

    const sub = this.rt.events$.subscribe((e) => {
      const runId = this.run()?.id;
      if (!runId) return;
      if (e.type === 'task.updated' && e.task.runId === runId) {
        const previous = this.tasks().get(e.task.id);
        // Pull the operator's attention to a new approval gate unless they chose a step themselves.
        if (e.task.status === 'waiting_approval' && previous?.status !== 'waiting_approval' && !this.userPicked) {
          this.selected.set(e.task.stepId);
        }
        // Fresh attempt: clear text streamed by the previous one.
        if (e.task.status === 'running' && e.task.attempt > (previous?.attempt ?? 0)) {
          this.streams.update((s) => ({ ...s, [e.task.id]: '' }));
        }
        this.tasks.update((m) => new Map(m).set(e.task.id, e.task));
      } else if (e.type === 'run.updated' && e.run.id === runId) {
        this.run.update((r) => (r ? { ...r, ...e.run, definition: r.definition } : r));
      } else if (e.type === 'task.log' && e.log.runId === runId) {
        this.logs.update((l) => (l.some((x) => x.id === e.log.id) ? l : [...l, e.log]));
      } else if (e.type === 'task.stream' && e.runId === runId) {
        this.streams.update((s) => ({ ...s, [e.taskId]: (s[e.taskId] ?? '') + e.text }));
      }
    });

    // Auto-follow: show the live tab when the selected step starts running.
    effect(() => {
      const t = this.selectedTask();
      if (t?.status === 'running' && t.type === 'llm') this.activeTab.set('live');
    });

    const timer = setInterval(() => {
      this.now.set(Date.now());
      this.tick.update((n) => n + 1);
    }, 1000);
    destroy.onDestroy(() => {
      unwatch?.();
      sub.unsubscribe();
      clearInterval(timer);
    });
  }

  protected tabLabel(tab: Tab): string {
    return { output: 'Output', live: 'Live', logs: 'Logs', config: 'Config' }[tab];
  }

  protected pick(stepId: string): void {
    this.userPicked = true;
    this.selected.set(stepId);
  }

  protected taskDuration(t: Task): number | null {
    return elapsed(t.startedAt, t.finishedAt ?? (t.status === 'running' ? null : t.updatedAt), this.now());
  }

  protected canSkip(status: TaskStatus): boolean {
    return ['pending', 'queued', 'running', 'waiting_approval', 'failed', 'cancelled'].includes(status);
  }

  protected stepConfig(stepId: string): unknown {
    return this.run()?.definition.steps.find((s) => s.id === stepId) ?? null;
  }

  protected approvalMessage(t: Task): string {
    return (t.output as { message?: string } | null)?.message ?? 'Approval required';
  }

  protected outputText(t: Task): string | null {
    const text = (t.output as { text?: unknown } | null)?.text;
    return typeof text === 'string' && t.type === 'llm' && !(t.output as { data?: unknown }).data ? text : null;
  }

  protected runAction(action: 'pause' | 'resume' | 'cancel' | 'retry'): void {
    if (action === 'cancel' && !confirm('Cancel this run? Running steps are aborted.')) return;
    this.api.runAction(this.id(), action).subscribe({
      next: (run) => {
        this.run.update((r) => (r ? { ...r, ...run } : run));
        this.toast.success(`Run ${action === 'retry' ? 'retrying' : action === 'cancel' ? 'cancelled' : action + 'd'}`);
      },
      error: (e) => this.toast.error(e),
    });
  }

  protected taskAction(t: Task, action: 'retry' | 'skip' | 'approve' | 'reject'): void {
    const comment = action === 'approve' || action === 'reject' ? this.comment.trim() || undefined : undefined;
    this.api.taskAction(t.id, action, comment).subscribe({
      next: (task) => {
        this.tasks.update((m) => new Map(m).set(task.id, task));
        this.comment = '';
        const verb = { retry: 'queued for retry', skip: 'skipped', approve: 'approved', reject: 'rejected' }[action];
        this.toast.success(`“${t.name}” ${verb}`);
      },
      error: (e) => this.toast.error(e),
    });
  }

  protected diagnose(t: Task): void {
    this.diagnosing.set(true);
    this.api.diagnose(t.id).subscribe({
      next: (r) => {
        this.diagnosing.set(false);
        this.diagnosis.update((d) => ({ ...d, [t.id]: r.analysis }));
      },
      error: (e) => {
        this.diagnosing.set(false);
        this.toast.error(e);
      },
    });
  }

  private load(id: string): void {
    this.api.run(id).subscribe({
      next: ({ run, tasks }) => {
        this.run.set(run);
        this.tasks.set(new Map(tasks.map((t) => [t.id, t])));
        if (this.step() && tasks.some((t) => t.stepId === this.step())) {
          this.selected.set(this.step()!);
          this.userPicked = true;
        } else if (!this.selected()) {
          const focus = tasks.find((t) => t.status === 'waiting_approval') ?? tasks.find((t) => t.status === 'failed') ?? tasks.find((t) => t.status === 'running');
          this.selected.set(focus?.stepId ?? run.definition.steps[0]?.id ?? null);
        }
      },
      error: () => this.notFound.set(true),
    });
    this.api.runLogs(id).subscribe({ next: (logs) => this.logs.set(logs), error: () => undefined });
  }
}
