import { Component, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ApiService } from '../core/api.service';
import { LineService } from '../core/line.service';
import { WorkflowListItem } from '../core/models';
import { RealtimeService } from '../core/realtime.service';
import { ToastService } from '../core/toast.service';
import { AgoPipe } from '../shared/format';
import { Icon } from '../shared/icon';
import { StatusBadge } from '../shared/status-badge';

@Component({
  selector: 'app-workflows',
  imports: [RouterLink, FormsModule, StatusBadge, Icon, AgoPipe],
  template: `
    <div class="page-head">
      <div>
        <h1>Workflows</h1>
        <p class="lede">DAGs of LLM, HTTP, transform, delay and approval steps. Steps that don't depend on each other run in parallel on different workers.</p>
      </div>
      <div class="actions">
        <button class="btn" [class.active]="aiOpen()" [attr.aria-expanded]="aiOpen()" (click)="aiOpen.set(!aiOpen())"><app-icon name="llm" />Generate with Claude</button>
        <a class="btn primary" routerLink="/workflows/new"><app-icon name="add" />New workflow</a>
      </div>
    </div>

    @if (aiOpen()) {
      <section class="panel compose" aria-labelledby="ai-title">
        <header class="panel-head">
          <h2 id="ai-title">Draft a workflow with Claude</h2>
          <span class="panel-meta">Claude designs the DAG; the platform validates it before you save</span>
        </header>
        <label class="sr-only" for="ai-prompt">Describe the automation</label>
        <textarea id="ai-prompt" rows="4" [(ngModel)]="aiPrompt" placeholder="e.g. Every morning fetch our status page, summarize incidents with Claude, and ask the on-call engineer to approve before posting to Slack"></textarea>
        <div class="examples">
          <span class="muted small">Try:</span>
          @for (ex of examples; track ex) {
            <button class="chip" (click)="aiPrompt = ex">{{ ex }}</button>
          }
        </div>
        <div class="form-actions">
          <button class="btn ghost" [disabled]="busy()" (click)="aiOpen.set(false)">Cancel</button>
          <button class="btn primary" [disabled]="busy() || aiPrompt.trim().length < 10" (click)="generate()">
            {{ busy() ? 'Claude is designing…' : 'Generate draft' }}
          </button>
        </div>
      </section>
    }

    <section class="panel flush" aria-label="Workflows">
      @if (loading()) {
        <p class="empty">Loading workflows…</p>
      } @else if (!workflows().length) {
        <p class="empty">No workflows yet. Create one, or describe what you want and let Claude draft it.</p>
      } @else {
        <ul class="wf-list">
          @for (wf of workflows(); track wf.id) {
            <li class="wf-row" [class.open]="runTarget()?.id === wf.id">
              <div class="wf-main">
                <div class="wf-name">
                  <a [routerLink]="['/workflows', wf.id]">{{ wf.name }}</a>
                  <span class="muted small">v{{ wf.version }}</span>
                </div>
                <p class="wf-desc">{{ wf.description || 'No description' }}</p>
                <div class="wf-facts">
                  <span class="types">
                    @for (t of stepTypes(wf); track t) {
                      <span class="type" [title]="t"><app-icon [name]="t" />{{ t }}</span>
                    }
                  </span>
                  <span class="muted">{{ wf.definition.steps.length }} steps</span>
                  @if (wf.schedule) {
                    <span class="sched" [class.off]="!wf.enabled" [title]="wf.enabled ? 'Runs on this schedule' : 'Schedule disabled'">
                      <app-icon name="schedule" /><span class="mono">{{ wf.schedule }}</span>{{ wf.enabled ? '' : ' · off' }}
                    </span>
                  }
                </div>
              </div>
              <div class="wf-last">
                @if (wf.lastRun) {
                  <a [routerLink]="['/runs', wf.lastRun.id]"><app-status [status]="line.runLamp(wf.lastRun)" /></a>
                  <span class="muted small">{{ wf.lastRun.createdAt | ago }} · {{ wf.runCount }} {{ wf.runCount === 1 ? 'run' : 'runs' }}</span>
                } @else {
                  <span class="muted small">Never run</span>
                }
              </div>
              <div class="wf-actions">
                <a class="btn ghost sm" [routerLink]="['/runs']" [queryParams]="{ workflowId: wf.id }"><app-icon name="history" />History</a>
                <a class="btn ghost sm" [routerLink]="['/workflows', wf.id]"><app-icon name="edit" />Edit</a>
                <button class="btn primary sm" [attr.aria-expanded]="runTarget()?.id === wf.id" (click)="toggleRun(wf)"><app-icon name="play" />Run</button>
              </div>
              @if (runTarget()?.id === wf.id) {
                <div class="wf-run">
                  <label>Run input (JSON) <small>Steps read it as <code ngNonBindable>{{input.field}}</code>.</small>
                    <textarea class="code" rows="6" [(ngModel)]="runInput" spellcheck="false"></textarea>
                  </label>
                  @if (runError()) {
                    <p class="error-text"><app-icon name="alert" />{{ runError() }}</p>
                  }
                  <div class="form-actions">
                    <button class="btn ghost" (click)="runTarget.set(null)">Cancel</button>
                    <button class="btn primary" [disabled]="busy()" (click)="startRun(wf)"><app-icon name="play" />{{ busy() ? 'Starting…' : 'Start run' }}</button>
                  </div>
                </div>
              }
            </li>
          }
        </ul>
      }
    </section>
  `,
})
export class WorkflowsPage {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  protected readonly line = inject(LineService);

  protected readonly workflows = signal<WorkflowListItem[]>([]);
  protected readonly loading = signal(true);
  protected readonly runTarget = signal<WorkflowListItem | null>(null);
  protected readonly runError = signal('');
  protected readonly busy = signal(false);
  protected readonly aiOpen = signal(false);
  protected runInput = '{}';
  protected aiPrompt = '';
  protected readonly examples = [
    'Research a company from its website, summarize it, and draft a personalized outreach email for human review',
    'Classify incoming invoices, extract totals as structured data, and route anything over $10k to finance approval',
    'Translate a product announcement into 5 languages in parallel, then assemble the results',
  ];

  constructor() {
    this.load();
    inject(RealtimeService).events$.pipe(takeUntilDestroyed()).subscribe((e) => {
      if (e.type === 'workflow.updated') this.load();
    });
  }

  protected stepTypes(wf: WorkflowListItem) {
    return [...new Set(wf.definition.steps.map((s) => s.type))];
  }

  protected toggleRun(wf: WorkflowListItem): void {
    if (this.runTarget()?.id === wf.id) {
      this.runTarget.set(null);
      return;
    }
    this.runInput = JSON.stringify(wf.definition.exampleInput ?? {}, null, 2);
    this.runError.set('');
    this.runTarget.set(wf);
  }

  protected startRun(wf: WorkflowListItem): void {
    let input: Record<string, unknown>;
    try {
      input = JSON.parse(this.runInput || '{}');
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Input must be a JSON object');
    } catch (e) {
      this.runError.set((e as Error).message);
      return;
    }
    this.busy.set(true);
    this.api.startRun(wf.id, input).subscribe({
      next: (run) => {
        this.busy.set(false);
        this.runTarget.set(null);
        this.router.navigate(['/runs', run.id]);
      },
      error: (e) => {
        this.busy.set(false);
        this.toast.error(e);
      },
    });
  }

  protected generate(): void {
    this.busy.set(true);
    this.api.generateWorkflow(this.aiPrompt.trim()).subscribe({
      next: (draft) => {
        this.busy.set(false);
        this.aiOpen.set(false);
        sessionStorage.setItem('wfo.draft', JSON.stringify(draft));
        this.toast.success(draft.mock ? 'Draft generated (mock mode: set ANTHROPIC_API_KEY for real designs)' : 'Claude drafted a workflow. Review it, then save.');
        this.router.navigate(['/workflows/new'], { queryParams: { draft: 1 } });
      },
      error: (e) => {
        this.busy.set(false);
        this.toast.error(e);
      },
    });
  }

  private load(): void {
    this.api.workflows().subscribe({
      next: (list) => {
        this.workflows.set(list);
        this.loading.set(false);
      },
      error: (e) => {
        this.loading.set(false);
        this.toast.error(e);
      },
    });
  }
}
