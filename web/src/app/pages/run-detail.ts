import { Component, computed, DestroyRef, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService } from '../core/api.service';
import { Run, Task, TaskLog, TaskStatus } from '../core/models';
import { RealtimeService } from '../core/realtime.service';
import { ToastService } from '../core/toast.service';
import { DagView } from '../shared/dag-view';
import { AgoPipe, DurationPipe, elapsed, PrettyJsonPipe, ShortIdPipe } from '../shared/format';
import { StatusBadge } from '../shared/status-badge';

type Tab = 'output' | 'live' | 'logs' | 'config';

@Component({
  selector: 'app-run-detail',
  imports: [RouterLink, FormsModule, DagView, StatusBadge, AgoPipe, DurationPipe, PrettyJsonPipe, ShortIdPipe],
  template: `
    @if (run(); as run) {
      <div class="page-head">
        <div>
          <a routerLink="/runs" class="muted small">← Runs</a>
          <h1>{{ run.workflowName }} <span class="mono muted">#{{ run.id | short }}</span></h1>
          <p class="muted">
            <app-status [status]="run.status" />
            · {{ run.trigger }} · v{{ run.workflowVersion }} · started {{ run.startedAt | ago: tick() }}
            · {{ runDuration() | duration }}
            · <a [routerLink]="['/workflows', run.workflowId]">workflow</a>
          </p>
        </div>
        <div class="actions">
          @if (run.status === 'running') {
            <button class="btn ghost" (click)="runAction('pause')" title="Finish running steps, start nothing new">⏸ Pause</button>
          }
          @if (run.status === 'paused') {
            <button class="btn success" (click)="runAction('resume')">▶ Resume</button>
          }
          @if (run.status === 'running' || run.status === 'paused') {
            <button class="btn danger-ghost" (click)="runAction('cancel')">✕ Cancel run</button>
          }
          @if (run.status === 'failed' || run.status === 'cancelled') {
            <button class="btn primary" (click)="runAction('retry')">↻ Retry failed steps</button>
          }
        </div>
      </div>

      @if (run.error && run.status !== 'succeeded') {
        <div class="banner danger">{{ run.error }}</div>
      }
      @if (waiting().length) {
        <div class="banner attn">
          ✋ {{ waiting().length }} step{{ waiting().length > 1 ? 's' : '' }} waiting for approval:
          @for (t of waiting(); track t.id) {
            <button class="link" (click)="pick(t.stepId)">{{ t.name }}</button>
          }
        </div>
      }

      <div class="card">
        <div class="card-head">
          <h2>Execution graph</h2>
          <div class="legend small">
            @for (s of legend; track s) {
              <span><i class="dot" [class]="'dot d-' + s"></i>{{ s === 'waiting_approval' ? 'approval' : s }}</span>
            }
          </div>
        </div>
        <app-dag [steps]="run.definition.steps" [statuses]="statusMap()" [selected]="selected()" (select)="pick($event)" />
      </div>

      <div class="detail-grid">
        <div class="card flush">
          <table class="table">
            <thead><tr><th>Step</th><th>Status</th><th>Try</th><th>Worker</th><th>Duration</th></tr></thead>
            <tbody>
              @for (t of orderedTasks(); track t.id) {
                <tr class="clickable" [class.row-selected]="t.stepId === selected()" (click)="pick(t.stepId)">
                  <td><b>{{ t.name }}</b><span class="muted small step-type">{{ t.type }}</span></td>
                  <td><app-status [status]="t.status" /></td>
                  <td class="mono small">{{ t.attempt || '-' }}</td>
                  <td class="mono small muted">{{ t.workerId ?? '-' }}</td>
                  <td class="mono small">{{ taskDuration(t) | duration }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>

        <div class="card task-panel">
          @if (selectedTask(); as t) {
            <div class="card-head">
              <h2>{{ t.name }}</h2>
              <app-status [status]="t.status" />
            </div>
            <dl class="meta">
              <div><dt>Step id</dt><dd class="mono">{{ t.stepId }}</dd></div>
              <div><dt>Type</dt><dd>{{ t.type }}</dd></div>
              <div><dt>Attempt</dt><dd>{{ t.attempt }} · {{ t.retriesLeft }} retries left</dd></div>
              <div><dt>Worker</dt><dd class="mono">{{ t.workerId ?? '-' }}</dd></div>
              <div><dt>Queued</dt><dd>{{ t.queuedAt | ago: tick() }}</dd></div>
              <div><dt>Duration</dt><dd>{{ taskDuration(t) | duration }}</dd></div>
            </dl>

            <div class="actions wrap">
              @if (t.status === 'failed' || t.status === 'cancelled') {
                <button class="btn primary sm" (click)="taskAction(t, 'retry')">↻ Retry step</button>
              }
              @if (canSkip(t.status)) {
                <button class="btn ghost sm" (click)="taskAction(t, 'skip')" title="Mark as skipped and continue downstream">⤼ Skip step</button>
              }
              @if (t.status === 'failed') {
                <button class="btn ai sm" [disabled]="diagnosing()" (click)="diagnose(t)">{{ diagnosing() ? 'Asking Claude…' : '✦ Ask Claude why' }}</button>
              }
            </div>

            @if (t.status === 'waiting_approval') {
              <div class="approval">
                <div><b>Approval required:</b> {{ approvalMessage(t) }}</div>
                <textarea rows="2" [(ngModel)]="comment" placeholder="Comment (optional, recorded in the audit log)"></textarea>
                <div class="actions">
                  <button class="btn success sm" (click)="taskAction(t, 'approve')">✓ Approve</button>
                  <button class="btn danger sm" (click)="taskAction(t, 'reject')">✕ Reject</button>
                </div>
              </div>
            }
            @if (t.error && t.status !== 'succeeded') {
              <div class="error-box">{{ t.error }}</div>
            }
            @if (diagnosis()[t.id]; as d) {
              <div class="ai-box"><div class="ai-box-head">✦ Claude's diagnosis</div><pre>{{ d }}</pre></div>
            }

            <div class="tabs">
              @for (tab of tabs; track tab) {
                <button [class.active]="activeTab() === tab" (click)="activeTab.set(tab)">
                  {{ tab }}{{ tab === 'logs' ? ' (' + taskLogs().length + ')' : '' }}{{ tab === 'live' && t.status === 'running' ? ' ●' : '' }}
                </button>
              }
            </div>
            @switch (activeTab()) {
              @case ('output') {
                @if (t.output !== null && t.output !== undefined) {
                  @if (outputText(t); as text) {
                    <pre class="output prose">{{ text }}</pre>
                  }
                  <pre class="output">{{ t.output | json2 }}</pre>
                } @else {
                  <div class="empty small">No output yet.</div>
                }
              }
              @case ('live') {
                @if (streams()[t.id]) {
                  <pre class="output prose live">{{ streams()[t.id] }}@if (t.status === 'running') {<span class="caret">▍</span>}</pre>
                } @else {
                  <div class="empty small">{{ t.status === 'running' ? 'Waiting for output…' : 'Live output appears here while the step runs (LLM tokens stream in real time).' }}</div>
                }
              }
              @case ('logs') {
                <div class="logs">
                  @for (l of taskLogs(); track l.id) {
                    <div class="log" [class]="'log log-' + l.level"><span class="mono">{{ l.createdAt.slice(11, 23) }}</span> {{ l.message }}</div>
                  } @empty {
                    <div class="empty small">No logs yet.</div>
                  }
                </div>
              }
              @case ('config') {
                <pre class="output">{{ stepConfig(t.stepId) | json2 }}</pre>
              }
            }
          } @else {
            <div class="empty">Select a step in the graph or table to inspect and override it.</div>
          }
        </div>
      </div>

      <div class="grid-2">
        <div class="card"><div class="card-head"><h2>Input</h2></div><pre class="output">{{ run.input | json2 }}</pre></div>
        <div class="card"><div class="card-head"><h2>Output</h2></div><pre class="output">{{ run.output === null ? '-' : (run.output | json2) }}</pre></div>
      </div>
    } @else {
      <div class="empty">{{ notFound() ? 'Run not found.' : 'Loading run…' }}</div>
    }
  `,
})
export class RunDetailPage {
  readonly id = input.required<string>();

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
    this.tick();
    const r = this.run();
    return r ? elapsed(r.startedAt, r.finishedAt) : null;
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

    const timer = setInterval(() => this.tick.update((n) => n + 1), 1000);
    destroy.onDestroy(() => {
      unwatch?.();
      sub.unsubscribe();
      clearInterval(timer);
    });
  }

  protected pick(stepId: string): void {
    this.userPicked = true;
    this.selected.set(stepId);
  }

  protected taskDuration(t: Task): number | null {
    this.tick();
    return elapsed(t.startedAt, t.finishedAt ?? (t.status === 'running' ? null : t.updatedAt));
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
        if (!this.selected()) {
          const focus = tasks.find((t) => t.status === 'waiting_approval') ?? tasks.find((t) => t.status === 'failed') ?? tasks.find((t) => t.status === 'running');
          this.selected.set(focus?.stepId ?? run.definition.steps[0]?.id ?? null);
        }
      },
      error: () => this.notFound.set(true),
    });
    this.api.runLogs(id).subscribe({ next: (logs) => this.logs.set(logs), error: () => undefined });
  }
}
