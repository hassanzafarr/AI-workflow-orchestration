import { Component, computed, input } from '@angular/core';

const LABELS: Record<string, string> = { waiting_approval: 'Awaiting approval' };

/** Status as an andon lamp plus its label. Lamp colour comes from the `s-<status>` class. */
@Component({
  selector: 'app-status',
  template: `<span class="badge" [class]="'badge s-' + status()"><i class="lamp"></i>{{ label() }}</span>`,
})
export class StatusBadge {
  readonly status = input.required<string>();
  readonly label = computed(() => LABELS[this.status()] ?? this.status()[0].toUpperCase() + this.status().slice(1));
}
