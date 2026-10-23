import { Component, computed, ElementRef, effect, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { ApiService } from './core/api.service';
import { LineService, WorkflowLamp } from './core/line.service';
import { PlatformInfo } from './core/models';
import { RealtimeService } from './core/realtime.service';
import { SettingsService } from './core/settings.service';
import { ToastService } from './core/toast.service';
import { AgoPipe } from './shared/format';
import { Icon } from './shared/icon';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, FormsModule, Icon, AgoPipe],
  template: `
    <a class="skip-link" href="#content">Skip to content</a>
    <div class="shell">
      <aside class="rail">
        <a class="wordmark" routerLink="/overview" aria-label="Orchestrator overview">
          <svg class="mark" viewBox="0 0 20 28" aria-hidden="true">
            <rect x="3" y="1" width="14" height="6" rx="1.5" class="mark-red" />
            <rect x="3" y="8" width="14" height="6" rx="1.5" class="mark-yellow" />
            <rect x="3" y="15" width="14" height="6" rx="1.5" class="mark-green" />
            <rect x="8.5" y="21" width="3" height="4" fill="currentColor" />
            <rect x="5" y="25" width="10" height="2" rx="1" fill="currentColor" />
          </svg>
          <span>Orchestrator</span>
        </a>
        <nav class="nav" aria-label="Main">
          <a routerLink="/overview" routerLinkActive="active"><app-icon name="overview" />Overview</a>
          <a routerLink="/workflows" routerLinkActive="active"><app-icon name="workflows" />Workflows</a>
          <a routerLink="/runs" routerLinkActive="active">
            <app-icon name="runs" />Runs
            @if (liveRuns() > 0) {
              <span class="count count-live" [attr.aria-label]="liveRuns() + ' running'">{{ liveRuns() }}</span>
            }
          </a>
          <a routerLink="/workers" routerLinkActive="active">
            <app-icon name="workers" />Workers
            <span class="count" [attr.aria-label]="rt.workerList().length + ' workers'">{{ rt.workerList().length }}</span>
          </a>
          <a routerLink="/audit" routerLinkActive="active"><app-icon name="audit" />Audit log</a>
        </nav>
        <div class="rail-foot">
          @if (info(); as i) {
            <dl class="facts">
              <div [title]="i.llmMode === 'mock' ? 'No ANTHROPIC_API_KEY: LLM steps return local mock output' : 'LLM steps call the Claude API'">
                <dt>Claude</dt><dd>{{ i.llmMode === 'mock' ? 'Mock mode' : i.model }}</dd>
              </div>
              <div><dt>Scaling</dt><dd>{{ i.scalingKind === 'none' ? 'Local' : i.scalingKind.toUpperCase() }}</dd></div>
            </dl>
          }
          <button class="operator" (click)="openSettings()" title="Operator settings">
            <app-icon name="user" /><span class="operator-name">{{ settings.actor() }}</span>
          </button>
        </div>
      </aside>

      <div class="main">
        <header class="board" aria-label="Line status">
          <ul class="board-cells">
            @for (w of line.lamps(); track w.workflow.id) {
              <li>
                <a class="cell" [class]="'cell lamp-' + w.lamp" [routerLink]="cellLink(w)" [queryParams]="cellQuery(w)">
                  <i class="board-lamp"></i>
                  <span class="cell-text">
                    <span class="cell-name">{{ w.workflow.name }}</span>
                    <span class="cell-sub">
                      @switch (w.lamp) {
                        @case ('wait') { {{ w.waiting }} awaiting approval }
                        @case ('run') { {{ w.live }} running }
                        @case ('hold') { Paused }
                        @case ('fail') { Last run failed · {{ w.last?.at | ago: tick() }} }
                        @default { {{ w.last ? 'Idle · last run ' + (w.last.at | ago: tick()) : 'Never run' }} }
                      }
                    </span>
                  </span>
                </a>
              </li>
            }
          </ul>
          <div class="cell line-cell" [class]="'cell line-cell lamp-' + line.queueLamp()">
            <i class="board-lamp"></i>
            <span class="cell-text">
              <span class="cell-name">{{ rt.queue()?.paused ? 'Line stopped' : 'Queue' }}</span>
              <span class="cell-sub">
                @if (rt.queue(); as q) {
                  {{ q.waiting }} waiting · {{ q.active }} running · {{ rt.busy() }}/{{ rt.capacity() }} slots
                } @else {
                  Connecting…
                }
              </span>
            </span>
            @if (rt.queue()?.paused) {
              <button class="btn sm board-btn" (click)="toggleQueue()"><app-icon name="play" />Resume</button>
            } @else {
              <button class="btn sm board-btn board-stop" (click)="toggleQueue()" title="Stop every worker from picking up new steps"><app-icon name="pause" />Pause all</button>
            }
          </div>
          <span class="conn" [class.on]="rt.connected()" role="status">
            <i></i>{{ rt.connected() ? 'Live' : 'Reconnecting' }}
          </span>
        </header>
        <main class="content" id="content">
          <router-outlet />
        </main>
      </div>
    </div>

    <dialog #settingsDialog class="dialog" (close)="settings.settingsOpen.set(false)" aria-labelledby="settings-title">
      <form method="dialog" class="form" (ngSubmit)="saveSettings()">
        <h2 id="settings-title">Operator settings</h2>
        <label>Your name <small>Recorded in the audit log next to every override.</small>
          <input name="actor" [(ngModel)]="actorDraft" placeholder="operator" />
        </label>
        <label>API token <small>Only needed when the server sets API_TOKEN.</small>
          <input name="token" [(ngModel)]="tokenDraft" type="password" autocomplete="off" />
        </label>
        <div class="dialog-actions">
          <button type="button" class="btn ghost" (click)="settings.settingsOpen.set(false)">Cancel</button>
          <button type="submit" class="btn primary">Save</button>
        </div>
      </form>
    </dialog>

    <div class="toasts" role="status" aria-live="polite">
      @for (t of toast.toasts(); track t.id) {
        <button class="toast" [class]="'toast toast-' + t.kind" (click)="toast.dismiss(t.id)"><i class="lamp"></i>{{ t.message }}</button>
      }
    </div>
  `,
})
export class App {
  protected readonly rt = inject(RealtimeService);
  protected readonly line = inject(LineService);
  protected readonly settings = inject(SettingsService);
  protected readonly toast = inject(ToastService);
  private readonly api = inject(ApiService);
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('settingsDialog');

  protected readonly info = signal<PlatformInfo | null>(null);
  protected readonly tick = signal(0);
  protected readonly liveRuns = computed(() => [...this.rt.runs().values()].filter((r) => r.status === 'running').length);
  protected actorDraft = '';
  protected tokenDraft = '';

  constructor() {
    this.api.info().subscribe({ next: (i) => this.info.set(i), error: () => undefined });
    setInterval(() => this.tick.update((t) => t + 1), 15_000);
    // The settings dialog also opens on any 401, so it follows the shared signal.
    effect(() => {
      const el = this.dialog().nativeElement;
      if (this.settings.settingsOpen() && !el.open) {
        this.actorDraft = this.settings.actor();
        this.tokenDraft = this.settings.token();
        el.showModal();
      } else if (!this.settings.settingsOpen() && el.open) {
        el.close();
      }
    });
  }

  /** A cell that needs you opens the run waiting at its gate; any other opens that workflow's runs. */
  protected cellLink(w: WorkflowLamp): string[] {
    return w.gateRunId ? ['/runs', w.gateRunId] : ['/runs'];
  }

  protected cellQuery(w: WorkflowLamp): Record<string, string> | null {
    return w.gateRunId ? null : { workflowId: w.workflow.id };
  }

  protected openSettings(): void {
    this.settings.settingsOpen.set(true);
  }

  protected saveSettings(): void {
    this.settings.save(this.actorDraft, this.tokenDraft);
    this.settings.settingsOpen.set(false);
    this.api.info().subscribe({ next: (i) => this.info.set(i), error: () => undefined });
    this.toast.success('Settings saved');
  }

  protected toggleQueue(): void {
    const action = this.rt.queue()?.paused ? 'resume' : 'pause';
    this.api.queueAction(action).subscribe({
      next: (q) => {
        this.rt.queue.set(q);
        this.toast.success(action === 'pause' ? 'Execution paused for all workflows' : 'Execution resumed');
      },
      error: (e) => this.toast.error(e),
    });
  }
}
