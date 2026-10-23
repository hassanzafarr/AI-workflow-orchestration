import { Component, computed, input } from '@angular/core';

const LABELS: Record<string, string> = { waiting_approval: 'awaiting approval' };

@Component({
  selector: 'app-status',
  template: `<span class="badge" [class]="'badge s-' + status()"><i></i>{{ label() }}</span>`,
})
export class StatusBadge {
  readonly status = input.required<string>();
  readonly label = computed(() => LABELS[this.status()] ?? this.status());
}
