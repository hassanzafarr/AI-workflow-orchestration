import { HttpClient, HttpInterceptorFn, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { tap } from 'rxjs';
import {
  AuditEntry,
  MetricsSummary,
  PlatformInfo,
  QueueStats,
  Run,
  RunSummary,
  ScalingState,
  Task,
  TaskLog,
  ThroughputPoint,
  ValidationIssue,
  WorkerInfo,
  Workflow,
  WorkflowDefinition,
  WorkflowListItem,
} from './models';
import { SettingsService } from './settings.service';

export interface WorkflowPayload {
  name: string;
  description: string;
  definition: unknown;
  schedule: string | null;
  enabled: boolean;
}

/** Adds the API token and operator name (for the audit log) to every API call. */
export const apiAuthInterceptor: HttpInterceptorFn = (req, next) => {
  const settings = inject(SettingsService);
  const headers: Record<string, string> = { 'x-actor': settings.actor() };
  if (settings.token()) headers['authorization'] = `Bearer ${settings.token()}`;
  return next(req.clone({ setHeaders: headers })).pipe(
    tap({
      error: (err) => {
        if (err?.status === 401) settings.settingsOpen.set(true);
      },
    }),
  );
};

@Injectable({ providedIn: 'root' })
export class ApiService {
  private http = inject(HttpClient);
  private base = '/api';

  info() {
    return this.http.get<PlatformInfo>(`${this.base}/info`);
  }

  // workflows
  workflows() {
    return this.http.get<WorkflowListItem[]>(`${this.base}/workflows`);
  }
  workflow(id: string) {
    return this.http.get<Workflow>(`${this.base}/workflows/${id}`);
  }
  createWorkflow(body: WorkflowPayload) {
    return this.http.post<Workflow>(`${this.base}/workflows`, body);
  }
  updateWorkflow(id: string, body: WorkflowPayload) {
    return this.http.put<Workflow>(`${this.base}/workflows/${id}`, body);
  }
  deleteWorkflow(id: string) {
    return this.http.delete<void>(`${this.base}/workflows/${id}`);
  }
  validate(definition: unknown) {
    return this.http.post<{ ok: boolean; issues: ValidationIssue[]; levels?: string[][] }>(`${this.base}/workflows/validate`, { definition });
  }
  startRun(workflowId: string, input: Record<string, unknown>) {
    return this.http.post<RunSummary>(`${this.base}/workflows/${workflowId}/runs`, { input });
  }
  generateWorkflow(description: string) {
    return this.http.post<{ name: string; description: string; definition: WorkflowDefinition; mock: boolean }>(
      `${this.base}/ai/generate-workflow`,
      { description },
    );
  }

  // runs
  runs(filter: { status?: string; workflowId?: string; limit?: number; offset?: number } = {}) {
    let params = new HttpParams();
    for (const [k, v] of Object.entries(filter)) if (v !== undefined && v !== '') params = params.set(k, String(v));
    return this.http.get<{ runs: RunSummary[]; total: number }>(`${this.base}/runs`, { params });
  }
  run(id: string) {
    return this.http.get<{ run: Run; tasks: Task[] }>(`${this.base}/runs/${id}`);
  }
  runLogs(id: string, after = 0) {
    return this.http.get<TaskLog[]>(`${this.base}/runs/${id}/logs`, { params: { after } });
  }
  runAction(id: string, action: 'pause' | 'resume' | 'cancel' | 'retry') {
    return this.http.post<Run>(`${this.base}/runs/${id}/${action}`, {});
  }

  // tasks
  task(id: string) {
    return this.http.get<{ task: Task; logs: TaskLog[] }>(`${this.base}/tasks/${id}`);
  }
  taskAction(id: string, action: 'retry' | 'skip' | 'approve' | 'reject', comment?: string) {
    return this.http.post<Task>(`${this.base}/tasks/${id}/${action}`, comment ? { comment } : {});
  }
  diagnose(id: string) {
    return this.http.post<{ analysis: string; mock: boolean }>(`${this.base}/tasks/${id}/diagnose`, {});
  }

  // workers, queue, scaling
  workers() {
    return this.http.get<WorkerInfo[]>(`${this.base}/workers`);
  }
  queue() {
    return this.http.get<QueueStats>(`${this.base}/queue`);
  }
  queueAction(action: 'pause' | 'resume') {
    return this.http.post<QueueStats>(`${this.base}/queue/${action}`, {});
  }
  scaling() {
    return this.http.get<ScalingState>(`${this.base}/scaling`);
  }
  setScaling(body: { min?: number; max?: number; replicas?: number }) {
    return this.http.put<ScalingState>(`${this.base}/scaling`, body);
  }

  // metrics
  summary() {
    return this.http.get<MetricsSummary>(`${this.base}/metrics/summary`);
  }
  throughput(minutes = 30) {
    return this.http.get<ThroughputPoint[]>(`${this.base}/metrics/throughput`, { params: { minutes } });
  }
  audit(limit = 100) {
    return this.http.get<AuditEntry[]>(`${this.base}/audit`, { params: { limit } });
  }
}
