import { Injectable, signal } from '@angular/core';

export interface Toast {
  id: number;
  kind: 'success' | 'error' | 'info';
  message: string;
}

@Injectable({ providedIn: 'root' })
export class ToastService {
  readonly toasts = signal<Toast[]>([]);
  private nextId = 1;

  show(message: string, kind: Toast['kind'] = 'info', ms = 4000): void {
    const toast = { id: this.nextId++, kind, message };
    this.toasts.update((list) => [...list.slice(-4), toast]);
    setTimeout(() => this.dismiss(toast.id), ms);
  }

  success(message: string): void {
    this.show(message, 'success');
  }

  error(err: unknown): void {
    this.show(errorMessage(err), 'error', 7000);
  }

  dismiss(id: number): void {
    this.toasts.update((list) => list.filter((t) => t.id !== id));
  }
}

export function errorMessage(err: unknown): string {
  const e = err as { error?: { error?: string; details?: { issues?: { path: string; message: string }[] } }; message?: string };
  const issues = e?.error?.details?.issues;
  if (issues?.length) return `${e.error?.error}: ${issues.map((i) => `${i.path} ${i.message}`).join('; ')}`;
  return e?.error?.error ?? e?.message ?? 'Something went wrong';
}
