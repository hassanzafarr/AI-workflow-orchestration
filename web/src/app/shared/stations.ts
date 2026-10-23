import { Component, input } from '@angular/core';
import { Station } from '../core/line.service';

const LABELS: Record<string, string> = { waiting_approval: 'awaiting approval' };

/** A run as a row of station lamps, one per step in definition order. */
@Component({
  selector: 'app-stations',
  template: `
    <ol class="stations">
      @for (s of stations(); track s.stepId) {
        <li class="station" [class]="'station s-' + s.status" [title]="s.name + ': ' + label(s.status)">
          <i class="lamp"></i><span class="sr-only">{{ s.name }}: {{ label(s.status) }}</span>
        </li>
      }
    </ol>
  `,
})
export class Stations {
  readonly stations = input.required<Station[]>();

  protected label(status: string): string {
    return LABELS[status] ?? status;
  }
}
