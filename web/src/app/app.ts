import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { ApiService } from './core/api.service';
import { PlatformInfo } from './core/models';
import { RealtimeService } from './core/realtime.service';
import { SettingsService } from './core/settings.service';
import { ToastService } from './core/toast.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, FormsModule],
  template: `
    <div class="shell">
      <aside class="sidebar">
        <div class="brand">
          <div class="brand-mark">◆</div>
          <div>
            <div class="brand-name">Orchestrator</div>
            <div class="brand-sub">AI workflow platform</div>
          </div>
        </div>
        <nav>
          <a routerLink="/overview" routerLinkActive="active"><span>▦</span>Overview</a>
          <a routerLink="/workflows" routerLinkActive="active"><span>⧉</span>Workflows</a>
          <a routerLink="/runs" routerLinkActive="active">
            <span>▶</span>Runs
            @if (liveRuns() > 0) {
              <em class="nav-count">{{ liveRuns() }}</em>
            }
          </a>
          <a routerLink="/workers" routerLinkActive="active">
            <span>⚙</span>Workers &amp; scaling
            <em class="nav-count muted-count">{{ rt.workerList().length }}</em>
          </a>
          <a routerLink="/audit" routerLinkActive="active"><span>☰</span>Audit log</a>
        </nav>
        <div class="sidebar-foot">
          @if (info(); as i) {
            <div class="pill" [class.pill-warn]="i.llmMode === 'mock'" [title]="i.llmMode === 'mock' ? 'No ANTHROPIC_API_KEY: LLM steps return local mock output' : 'LLM steps call the Claude API'">
              {{ i.llmMode === 'mock' ? 'Claude: mock mode' : 'Claude: ' + i.model }}
            </div>
            <div class="pill">scaling: {{ i.scalingKind }}</div>
          }
        </div>
      </aside>

      <div class="main">
        <header class="topbar">
          <div class="conn" [class.on]="rt.connected()">
            <i></i>{{ rt.connected() ? 'Live' : 'Reconnecting…' }}
          </div>
          @if (rt.queue(); as q) {
            <div class="topbar-stat"><b>{{ q.waiting }}</b> waiting</div>
            <div class="topbar-stat"><b>{{ q.active }}</b> running</div>
            @if (q.paused) {
              <div class="pill pill-danger">queue paused</div>
            }
          }
          <div class="topbar-stat"><b>{{ rt.busy() }}/{{ rt.capacity() }}</b> worker slots</div>
          <span class="spacer"></span>
          <button class="btn ghost" (click)="openSettings()">👤 {{ settings.actor() }}</button>
        </header>
        <main class="content">
          <router-outlet />
        </main>
      </div>
    </div>

    @if (settings.settingsOpen()) {
      <div class="modal-backdrop" (click)="settings.settingsOpen.set(false)">
        <div class="modal" (click)="$event.stopPropagation()">
          <h3>Operator settings</h3>
          <label>Your name <small>(recorded in the audit log for overrides)</small>
            <input [(ngModel)]="actorDraft" placeholder="operator" />
          </label>
          <label>API token <small>(only if the server sets API_TOKEN)</small>
            <input [(ngModel)]="tokenDraft" type="password" autocomplete="off" />
          </label>
          <div class="modal-actions">
            <button class="btn ghost" (click)="settings.settingsOpen.set(false)">Cancel</button>
            <button class="btn primary" (click)="saveSettings()">Save</button>
          </div>
        </div>
      </div>
    }

    <div class="toasts">
      @for (t of toast.toasts(); track t.id) {
        <div class="toast" [class]="'toast toast-' + t.kind" (click)="toast.dismiss(t.id)">{{ t.message }}</div>
      }
    </div>
  `,
})
export class App {
  protected readonly rt = inject(RealtimeService);
  protected readonly settings = inject(SettingsService);
  protected readonly toast = inject(ToastService);
  private readonly api = inject(ApiService);

  protected readonly info = signal<PlatformInfo | null>(null);
  protected readonly liveRuns = computed(() => [...this.rt.runs().values()].filter((r) => r.status === 'running').length);
  protected actorDraft = '';
  protected tokenDraft = '';

  constructor() {
    this.api.info().subscribe({ next: (i) => this.info.set(i), error: () => undefined });
  }

  protected openSettings(): void {
    this.actorDraft = this.settings.actor();
    this.tokenDraft = this.settings.token();
    this.settings.settingsOpen.set(true);
  }

  protected saveSettings(): void {
    this.settings.save(this.actorDraft, this.tokenDraft);
    this.settings.settingsOpen.set(false);
    this.api.info().subscribe({ next: (i) => this.info.set(i), error: () => undefined });
    this.toast.success('Settings saved');
  }
}
