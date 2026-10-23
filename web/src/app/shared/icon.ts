import { Component, effect, ElementRef, inject, input } from '@angular/core';
import {
  ArrowLeft,
  Ban,
  Braces,
  Check,
  ChevronRight,
  CircleAlert,
  CirclePlay,
  Clock,
  Gauge,
  Globe,
  Hand,
  History,
  IconNode,
  createElement,
  Lightbulb,
  MessageSquareText,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  ScrollText,
  ServerCog,
  SkipForward,
  Timer,
  Trash2,
  UserRound,
  Workflow,
  X,
} from 'lucide';
import { StepType } from '../core/models';

const ICONS = {
  overview: Gauge,
  workflows: Workflow,
  runs: CirclePlay,
  workers: ServerCog,
  audit: ScrollText,
  play: Play,
  pause: Pause,
  cancel: X,
  close: X,
  stop: Ban,
  retry: RotateCcw,
  refresh: RefreshCw,
  skip: SkipForward,
  approve: Check,
  check: Check,
  add: Plus,
  edit: Pencil,
  delete: Trash2,
  history: History,
  back: ArrowLeft,
  next: ChevronRight,
  user: UserRound,
  schedule: Clock,
  alert: CircleAlert,
  diagnose: Lightbulb,
  llm: MessageSquareText,
  http: Globe,
  transform: Braces,
  delay: Timer,
  approval: Hand,
} satisfies Record<string, IconNode>;

/** Step types double as icon names. */
export type IconName = keyof typeof ICONS | StepType;

/** Drawn Lucide icon, sized by the surrounding font (1.15em) and coloured by currentColor. */
@Component({
  selector: 'app-icon',
  template: '',
  host: { class: 'icon', 'aria-hidden': 'true' },
})
export class Icon {
  readonly name = input.required<IconName>();
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  constructor() {
    effect(() => {
      const svg = createElement(ICONS[this.name()], { width: '1em', height: '1em', 'stroke-width': 1.85 });
      this.host.nativeElement.replaceChildren(svg);
    });
  }
}
