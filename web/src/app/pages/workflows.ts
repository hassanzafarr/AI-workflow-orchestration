import { Component, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ApiService } from '../core/api.service';
import { WorkflowListItem } from '../core/models';
import { RealtimeService } from '../core/realtime.service';
import { ToastService } from '../core/toast.service';
import { AgoPipe } from '../shared/format';
import { StatusBadge } from '../shared/status-badge';

@Component({
  selector: 'app-workflows',
  imports: [RouterLink, FormsModule, StatusBadge, AgoPipe],
  template: `
    <div class="page-head">
      <div>
        <h1>Workflows</h1>
        <p class="muted">DAGs of LLM, HTTP, transform, delay and approval steps. Independent steps run in parallel across workers.</p>
      </div>
      <div class="actions">
        <button class="btn ai" (click)="aiOpen.set(true)">✦ Generate with Claude</button>
        <a class="btn primary" routerLink="/workflows/new">+ New workflow</a>
      </div>
    </div>

    @if (loading()) {
      <div class="empty">Loading…</div>
    } @else if (!workflows().length) {
      <div class="empty">No workflows yet. Create one or let Claude draft it from a description.</div>
    } @else {
      <div class="wf-grid">
        @for (wf of workflows(); track wf.id) {
          <article class="card wf-card">
            <div class="wf-top">
              <a [routerLink]="['/workflows', wf.id]" class="wf-name">{{ wf.name }}</a>
              <span class="muted small">v{{ wf.version }}</span>
            </div>
            <p class="wf-desc">{{ wf.description || 'No description' }}</p>
            <div class="wf-tags">
              <span class="tag">{{ wf.definition.steps.length }} steps</span>
              @for (t of stepTypes(wf); track t) {
                <span class="tag tag-type">{{ t }}</span>
              }
              @if (wf.schedule) {
                <span class="tag" [class.tag-off]="!wf.enabled" [title]="wf.enabled ? 'Scheduled' : 'Schedule disabled'">⏱ {{ wf.schedule }}{{ wf.enabled ? '' : ' (off)' }}</span>
              }
            </div>
            <div class="wf-foot">
              <div class="small muted">
                @if (wf.lastRun) {
                  <a [routerLink]="['/runs', wf.lastRun.id]"><app-status [status]="wf.lastRun.status" /></a>
                  {{ wf.lastRun.createdAt | ago }} · {{ wf.runCount }} runs
                } @else {
                  never run
                }
              </div>
              <div class="actions">
                <a class="btn ghost sm" [routerLink]="['/runs']" [queryParams]="{ workflowId: wf.id }">History</a>
                <a class="btn ghost sm" [routerLink]="['/workflows', wf.id]">Edit</a>
                <button class="btn primary sm" (click)="openRun(wf)">▶ Run</button>
              </div>
            </div>
          </article>
        }
      </div>
    }

    @if (runTarget(); as wf) {
      <div class="modal-backdrop" (click)="runTarget.set(null)">
        <div class="modal" (click)="$event.stopPropagation()">
          <h3>Run “{{ wf.name }}”</h3>
          <label>Input (JSON) <small>available to steps as <code ngNonBindable>{{input.field}}</code></small>
            <textarea class="code" rows="8" [(ngModel)]="runInput" spellcheck="false"></textarea>
          </label>
          @if (runError()) {
            <div class="error-text">{{ runError() }}</div>
          }
          <div class="modal-actions">
            <button class="btn ghost" (click)="runTarget.set(null)">Cancel</button>
            <button class="btn primary" [disabled]="busy()" (click)="startRun(wf)">▶ Start run</button>
          </div>
        </div>
      </div>
    }

    @if (aiOpen()) {
      <div class="modal-backdrop" (click)="!busy() && aiOpen.set(false)">
        <div class="modal wide" (click)="$event.stopPropagation()">
          <h3>✦ Generate a workflow with Claude</h3>
          <p class="muted small">Describe the automation. Claude designs the DAG (parallel steps, retries, approval gates) and the platform validates it before you save.</p>
          <textarea rows="5" [(ngModel)]="aiPrompt" placeholder="e.g. Every morning fetch our status page, summarize incidents with Claude, and ask the on-call engineer to approve before posting to Slack"></textarea>
          <div class="chips">
            @for (ex of examples; track ex) {
              <button class="chip" (click)="aiPrompt = ex">{{ ex }}</button>
            }
          </div>
          <div class="modal-actions">
            <button class="btn ghost" [disabled]="busy()" (click)="aiOpen.set(false)">Cancel</button>
            <button class="btn ai" [disabled]="busy() || aiPrompt.trim().length < 10" (click)="generate()">
              {{ busy() ? 'Claude is designing…' : 'Generate' }}
            </button>
          </div>
        </div>
      </div>
    }
  `,
})
export class WorkflowsPage {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);

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

  protected stepTypes(wf: WorkflowListItem): string[] {
    return [...new Set(wf.definition.steps.map((s) => s.type))];
  }

  protected openRun(wf: WorkflowListItem): void {
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
        this.toast.success(draft.mock ? 'Draft generated (mock mode - set ANTHROPIC_API_KEY for real designs)' : 'Claude drafted a workflow - review and save it');
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
