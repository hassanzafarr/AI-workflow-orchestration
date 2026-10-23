import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'overview' },
  { path: 'overview', title: 'Overview · Orchestrator', loadComponent: () => import('./pages/overview').then((m) => m.OverviewPage) },
  { path: 'workflows', title: 'Workflows · Orchestrator', loadComponent: () => import('./pages/workflows').then((m) => m.WorkflowsPage) },
  { path: 'workflows/new', title: 'New workflow · Orchestrator', loadComponent: () => import('./pages/workflow-editor').then((m) => m.WorkflowEditorPage) },
  { path: 'workflows/:id', title: 'Edit workflow · Orchestrator', loadComponent: () => import('./pages/workflow-editor').then((m) => m.WorkflowEditorPage) },
  { path: 'runs', title: 'Runs · Orchestrator', loadComponent: () => import('./pages/runs').then((m) => m.RunsPage) },
  { path: 'runs/:id', title: 'Run · Orchestrator', loadComponent: () => import('./pages/run-detail').then((m) => m.RunDetailPage) },
  { path: 'workers', title: 'Workers · Orchestrator', loadComponent: () => import('./pages/workers').then((m) => m.WorkersPage) },
  { path: 'audit', title: 'Audit log · Orchestrator', loadComponent: () => import('./pages/audit').then((m) => m.AuditPage) },
  { path: '**', redirectTo: 'overview' },
];
