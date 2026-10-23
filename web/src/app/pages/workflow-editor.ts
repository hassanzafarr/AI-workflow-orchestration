import { Component, computed, DestroyRef, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ApiService, WorkflowPayload } from '../core/api.service';
import { StepDefinition, StepType, ValidationIssue, WorkflowDefinition } from '../core/models';
import { ToastService } from '../core/toast.service';
import { DagView } from '../shared/dag-view';

const STEP_TEMPLATES: Record<StepType, (id: string, after: string[]) => StepDefinition> = {
  llm: (id, after) => ({
    id,
    name: 'Ask Claude',
    type: 'llm',
    dependsOn: after,
    retries: 2,
    config: { prompt: after.length ? `Summarize:\n{{steps.${after[0]}.output}}` : 'Explain {{input.topic}} in three bullet points.' },
  }),
  http: (id, after) => ({ id, name: 'Call API', type: 'http', dependsOn: after, retries: 2, timeoutMs: 30000, config: { url: 'https://example.com', method: 'GET' } }),
  delay: (id, after) => ({ id, name: 'Wait', type: 'delay', dependsOn: after, retries: 0, config: { ms: 2000 } }),
  transform: (id, after) => ({
    id,
    name: 'Shape output',
    type: 'transform',
    dependsOn: after,
    retries: 0,
    config: { output: Object.fromEntries(after.map((a) => [a, `{{steps.${a}.output}}`])) },
  }),
  approval: (id, after) => ({ id, name: 'Human approval', type: 'approval', dependsOn: after, retries: 0, config: { message: 'Please review before continuing' } }),
};

const BLANK: WorkflowDefinition = {
  exampleInput: { topic: 'event-driven architecture' },
  steps: [STEP_TEMPLATES.llm('explain', [])],
};

@Component({
  selector: 'app-workflow-editor',
  imports: [FormsModule, RouterLink, DagView],
  template: `
    <div class="page-head">
      <div>
        <a routerLink="/workflows" class="muted small">← Workflows</a>
        <h1>{{ id() ? name() || 'Edit workflow' : 'New workflow' }}</h1>
        @if (version()) {
          <p class="muted">Version {{ version() }} · saving creates a new version; running runs keep the version they started with.</p>
        }
      </div>
      <div class="actions">
        @if (id()) {
          <button class="btn danger-ghost" (click)="remove()">Delete</button>
          <button class="btn ghost" [disabled]="dirty() || saving()" (click)="run()" [title]="dirty() ? 'Save first' : ''">▶ Run</button>
        }
        <button class="btn primary" [disabled]="!canSave() || saving()" (click)="save()">{{ saving() ? 'Saving…' : 'Save' }}</button>
      </div>
    </div>

    <div class="editor">
      <div class="editor-left">
        <div class="card form">
          <label>Name <input [ngModel]="name()" (ngModelChange)="name.set($event); dirty.set(true)" placeholder="My workflow" /></label>
          <label>Description <textarea rows="2" [ngModel]="description()" (ngModelChange)="description.set($event); dirty.set(true)"></textarea></label>
          <div class="form-row">
            <label class="grow">Schedule (cron) <small>optional, e.g. <code>*/15 * * * *</code></small>
              <input [ngModel]="schedule()" (ngModelChange)="schedule.set($event); dirty.set(true)" placeholder="none" class="mono" />
            </label>
            <label class="check"><input type="checkbox" [ngModel]="enabled()" (ngModelChange)="enabled.set($event); dirty.set(true)" /> schedule enabled</label>
          </div>
        </div>

        <div class="card">
          <div class="card-head">
            <h2>Definition</h2>
            <div class="palette">
              <span class="muted small">add step:</span>
              @for (t of stepTypes; track t) {
                <button class="chip" (click)="addStep(t)">+ {{ t }}</button>
              }
            </div>
          </div>
          <textarea class="code definition" spellcheck="false" [ngModel]="source()" (ngModelChange)="onSource($event)"></textarea>
          <div class="validation">
            @if (parseError()) {
              <div class="error-text">JSON: {{ parseError() }}</div>
            } @else if (issues().length) {
              @for (i of issues(); track $index) {
                <div class="error-text"><code>{{ i.path }}</code> {{ i.message }}</div>
              }
            } @else if (validating()) {
              <div class="muted small">Validating…</div>
            } @else {
              <div class="ok-text">✓ Valid DAG · {{ parsed()?.steps?.length ?? 0 }} steps · {{ levels() }} stages</div>
            }
          </div>
          <details class="help">
            <summary>Template &amp; step reference</summary>
            <ul ngNonBindable>
              <li><code>{{input.field}}</code> run input · <code>{{steps.id.output.text}}</code> upstream output · <code>{{run.id}}</code></li>
              <li>A string that is only a template keeps the value's type (objects stay objects).</li>
              <li><b>llm</b>: prompt, system?, model?, maxTokens?, effort?, outputSchema? (JSON Schema → output.data)</li>
              <li><b>http</b>: url, method?, headers?, body?, expectStatus? · <b>delay</b>: ms, failRate? · <b>transform</b>: output · <b>approval</b>: message</li>
              <li>Per step: dependsOn, retries (auto, exponential backoff), timeoutMs, when (falsy → skipped)</li>
            </ul>
          </details>
        </div>
      </div>

      <div class="editor-right">
        <div class="card sticky">
          <div class="card-head"><h2>Graph preview</h2><span class="muted small">columns run left → right; a column's steps run in parallel</span></div>
          @if (parsed()?.steps?.length) {
            <app-dag [steps]="parsed()!.steps" />
          } @else {
            <div class="empty small">Fix the JSON to see the graph.</div>
          }
        </div>
      </div>
    </div>
  `,
})
export class WorkflowEditorPage {
  readonly id = input<string>();

  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly toast = inject(ToastService);

  protected readonly stepTypes: StepType[] = ['llm', 'http', 'transform', 'delay', 'approval'];
  protected readonly name = signal('');
  protected readonly description = signal('');
  protected readonly schedule = signal('');
  protected readonly enabled = signal(true);
  protected readonly version = signal<number | null>(null);
  protected readonly source = signal(JSON.stringify(BLANK, null, 2));
  protected readonly parsed = signal<WorkflowDefinition | null>(BLANK);
  protected readonly parseError = signal('');
  protected readonly issues = signal<ValidationIssue[]>([]);
  protected readonly levelsCount = signal(0);
  protected readonly validating = signal(false);
  protected readonly dirty = signal(false);
  protected readonly saving = signal(false);

  protected readonly levels = computed(() => this.levelsCount());
  protected readonly canSave = computed(
    () => this.name().trim().length > 0 && !this.parseError() && !this.issues().length && !this.validating() && this.parsed() !== null,
  );

  private validateTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    inject(DestroyRef).onDestroy(() => clearTimeout(this.validateTimer));
    effect(() => {
      const id = this.id();
      if (id) this.load(id);
      else this.loadDraft();
    });
  }

  protected onSource(text: string): void {
    this.source.set(text);
    this.dirty.set(true);
    try {
      const value = JSON.parse(text) as WorkflowDefinition;
      this.parseError.set('');
      this.parsed.set(value && Array.isArray(value.steps) ? value : null);
      this.scheduleValidation(value);
    } catch (e) {
      this.parseError.set((e as Error).message);
    }
  }

  protected addStep(type: StepType): void {
    const def = this.parsed() ?? { steps: [] };
    const steps = def.steps ?? [];
    let n = steps.length + 1;
    while (steps.some((s) => s.id === `${type}_${n}`)) n++;
    // Attach new steps after the current leaves so the graph grows naturally.
    const referenced = new Set(steps.flatMap((s) => s.dependsOn ?? []));
    const leaves = steps.filter((s) => !referenced.has(s.id)).map((s) => s.id);
    const next = { ...def, steps: [...steps, STEP_TEMPLATES[type](`${type}_${n}`, leaves)] };
    this.onSource(JSON.stringify(next, null, 2));
  }

  protected save(): void {
    const body: WorkflowPayload = {
      name: this.name().trim(),
      description: this.description(),
      definition: this.parsed(),
      schedule: this.schedule().trim() || null,
      enabled: this.enabled(),
    };
    this.saving.set(true);
    const id = this.id();
    (id ? this.api.updateWorkflow(id, body) : this.api.createWorkflow(body)).subscribe({
      next: (wf) => {
        this.saving.set(false);
        this.dirty.set(false);
        this.version.set(wf.version);
        this.toast.success(`Saved “${wf.name}” (v${wf.version})`);
        if (!id) this.router.navigate(['/workflows', wf.id], { replaceUrl: true });
      },
      error: (e) => {
        this.saving.set(false);
        this.toast.error(e);
      },
    });
  }

  protected run(): void {
    const id = this.id();
    if (!id) return;
    this.api.startRun(id, this.parsed()?.exampleInput ?? {}).subscribe({
      next: (run) => this.router.navigate(['/runs', run.id]),
      error: (e) => this.toast.error(e),
    });
  }

  protected remove(): void {
    const id = this.id();
    if (!id || !confirm(`Delete “${this.name()}” and its run history? This cannot be undone.`)) return;
    this.api.deleteWorkflow(id).subscribe({
      next: () => {
        this.toast.success('Workflow deleted');
        this.router.navigate(['/workflows']);
      },
      error: (e) => this.toast.error(e),
    });
  }

  private load(id: string): void {
    this.api.workflow(id).subscribe({
      next: (wf) => {
        this.name.set(wf.name);
        this.description.set(wf.description);
        this.schedule.set(wf.schedule ?? '');
        this.enabled.set(wf.enabled);
        this.version.set(wf.version);
        this.onSource(JSON.stringify(wf.definition, null, 2));
        this.dirty.set(false);
      },
      error: (e) => this.toast.error(e),
    });
  }

  private loadDraft(): void {
    if (!this.route.snapshot.queryParamMap.get('draft')) {
      this.scheduleValidation(BLANK);
      return;
    }
    try {
      const draft = JSON.parse(sessionStorage.getItem('wfo.draft') ?? 'null');
      if (draft) {
        this.name.set(draft.name);
        this.description.set(draft.description);
        this.onSource(JSON.stringify(draft.definition, null, 2));
      }
    } catch {
      /* ignore broken draft */
    }
  }

  private scheduleValidation(definition: unknown): void {
    clearTimeout(this.validateTimer);
    this.validating.set(true);
    this.validateTimer = setTimeout(() => {
      this.api.validate(definition).subscribe({
        next: (r) => {
          this.validating.set(false);
          this.issues.set(r.issues ?? []);
          this.levelsCount.set(r.levels?.length ?? 0);
        },
        error: (e) => {
          this.validating.set(false);
          this.toast.error(e);
        },
      });
    }, 350);
  }
}
