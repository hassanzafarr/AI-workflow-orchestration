import { Component, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { ApiService } from '../core/api.service';
import { AuditEntry } from '../core/models';
import { RealtimeService } from '../core/realtime.service';
import { AgoPipe, PrettyJsonPipe, ShortIdPipe } from '../shared/format';

@Component({
  selector: 'app-audit',
  imports: [RouterLink, AgoPipe, PrettyJsonPipe, ShortIdPipe],
  template: `
    <div class="page-head">
      <div>
        <h1>Audit log</h1>
        <p class="muted">Every manual override - who paused, approved, skipped, retried or rescaled what, and when.</p>
      </div>
      <button class="btn ghost" (click)="load()">↻ Refresh</button>
    </div>
    <div class="card flush">
      <table class="table">
        <thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Target</th><th>Details</th></tr></thead>
        <tbody>
          @for (a of entries(); track a.id) {
            <tr>
              <td class="small" [title]="a.createdAt">{{ a.createdAt | ago }}</td>
              <td><b>{{ a.actor }}</b></td>
              <td><span class="tag" [class]="'tag act-' + a.action.split('.')[0]">{{ a.action }}</span></td>
              <td class="mono small">
                @if (a.targetType === 'run') {
                  <a [routerLink]="['/runs', a.targetId]">run #{{ a.targetId | short }}</a>
                } @else if (a.targetType === 'task' && runOf(a)) {
                  <a [routerLink]="['/runs', runOf(a)]">step {{ stepOf(a) }} · run #{{ runOf(a) | short }}</a>
                } @else if (a.targetType === 'workflow') {
                  <a [routerLink]="['/workflows', a.targetId]">workflow #{{ a.targetId | short }}</a>
                } @else {
                  {{ a.targetType }} {{ a.targetId }}
                }
              </td>
              <td class="mono small muted details">{{ a.details ? (a.details | json2) : '' }}</td>
            </tr>
          } @empty {
            <tr><td colspan="5" class="empty">No overrides recorded yet.</td></tr>
          }
        </tbody>
      </table>
    </div>
  `,
})
export class AuditPage {
  private readonly api = inject(ApiService);
  protected readonly entries = signal<AuditEntry[]>([]);

  constructor() {
    this.load();
    // Overrides change run state, so refresh when runs change (debounced).
    let timer: ReturnType<typeof setTimeout> | undefined;
    inject(RealtimeService).events$.pipe(takeUntilDestroyed()).subscribe((e) => {
      if (e.type !== 'run.updated' && e.type !== 'workflow.updated') return;
      clearTimeout(timer);
      timer = setTimeout(() => this.load(), 1000);
    });
  }

  protected runOf(a: AuditEntry): string | null {
    return (a.details as { runId?: string } | null)?.runId ?? null;
  }

  protected stepOf(a: AuditEntry): string {
    return (a.details as { stepId?: string } | null)?.stepId ?? '';
  }

  load(): void {
    this.api.audit(200).subscribe({ next: (e) => this.entries.set(e), error: () => undefined });
  }
}
