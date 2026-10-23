import { Component, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { ApiService } from '../core/api.service';
import { AuditEntry } from '../core/models';
import { RealtimeService } from '../core/realtime.service';
import { AgoPipe, PrettyJsonPipe, ShortIdPipe } from '../shared/format';
import { Icon } from '../shared/icon';

@Component({
  selector: 'app-audit',
  imports: [RouterLink, Icon, AgoPipe, PrettyJsonPipe, ShortIdPipe],
  template: `
    <div class="page-head">
      <div>
        <h1>Audit log</h1>
        <p class="lede">Every manual override: who paused, approved, skipped, retried or rescaled what, and when.</p>
      </div>
      <div class="actions"><button class="btn" (click)="load()"><app-icon name="refresh" />Refresh</button></div>
    </div>
    <section class="panel flush">
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>When</th><th>Operator</th><th>Action</th><th>Target</th><th class="hide-sm">Details</th></tr></thead>
          <tbody>
            @for (a of entries(); track a.id) {
              <tr>
                <td class="small" [title]="a.createdAt">{{ a.createdAt | ago }}</td>
                <td><span class="strong">{{ a.actor }}</span></td>
                <td><span class="badge" [class]="'badge s-' + actionStatus(a.action)"><i class="lamp"></i><span class="mono">{{ a.action }}</span></span></td>
                <td class="small">
                  @if (a.targetType === 'run') {
                    <a [routerLink]="['/runs', a.targetId]">Run <span class="mono">#{{ a.targetId | short }}</span></a>
                  } @else if (a.targetType === 'task' && runOf(a)) {
                    <a [routerLink]="['/runs', runOf(a)]">Step{{ stepOf(a) ? ' ' + stepOf(a) : '' }} in run <span class="mono">#{{ runOf(a) | short }}</span></a>
                  } @else if (a.targetType === 'workflow') {
                    <a [routerLink]="['/workflows', a.targetId]">Workflow <span class="mono">#{{ a.targetId | short }}</span></a>
                  } @else {
                    {{ a.targetType }} <span class="mono">{{ a.targetId }}</span>
                  }
                </td>
                <td class="details mono hide-sm" [title]="a.details ? (a.details | json2) : ''">
                  @for (d of fields(a); track d.key) {
                    <div><span class="k">{{ d.key }}</span> {{ d.value }}</div>
                  }
                </td>
              </tr>
            } @empty {
              <tr><td colspan="5" class="empty">No overrides yet. Pausing, approving, skipping or retrying anything records a row here with your operator name.</td></tr>
            }
          </tbody>
        </table>
      </div>
    </section>
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

  /** Overrides that stop work read red, ones that let it continue read green, re-queues read blue. */
  protected actionStatus(action: string): string {
    const verb = action.split('.').pop() ?? '';
    if (['reject', 'cancel', 'pause', 'delete'].includes(verb)) return 'failed';
    if (['approve', 'resume', 'start'].includes(verb)) return 'running';
    if (verb === 'retry' || action.startsWith('scaling.')) return 'queued';
    return 'succeeded';
  }

  /** Details as short key/value lines; ids shortened like everywhere else, full JSON in the tooltip. */
  protected fields(a: AuditEntry): { key: string; value: string }[] {
    if (!a.details || typeof a.details !== 'object') return a.details ? [{ key: 'details', value: String(a.details) }] : [];
    return Object.entries(a.details as Record<string, unknown>).map(([key, v]) => {
      const value = typeof v === 'string' ? v : JSON.stringify(v);
      return { key, value: /^[0-9a-f]{8}-[0-9a-f-]{27}$/.test(value) ? value.slice(0, 8) : value };
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
