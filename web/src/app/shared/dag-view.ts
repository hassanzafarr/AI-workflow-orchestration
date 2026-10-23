import { Component, computed, input, output } from '@angular/core';
import { StepDefinition, StepType, TaskStatus } from '../core/models';

interface NodeBox {
  id: string;
  name: string;
  type: StepType;
  x: number;
  y: number;
  status: TaskStatus | 'draft';
  attempt: number;
  hasWhen: boolean;
}

interface Edge {
  id: string;
  d: string;
  status: TaskStatus | 'draft';
}

const W = 196;
const H = 56;
const COL = 64;
const ROW = 16;
const PAD = 12;
const BEND = 8;
/** Wide graphs shrink to fit, but never below this; past it the graph scrolls sideways. */
const MIN_SCALE = 0.72;

/** Orthogonal connector with rounded elbows, like a conveyor between stations. */
function connector(x1: number, y1: number, x2: number, y2: number): string {
  if (Math.abs(y2 - y1) < 1) return `M${x1},${y1} H${x2}`;
  const mid = (x1 + x2) / 2;
  const dir = y2 > y1 ? 1 : -1;
  const r = Math.min(BEND, Math.abs(y2 - y1) / 2, (x2 - x1) / 4);
  return `M${x1},${y1} H${mid - r} Q${mid},${y1} ${mid},${y1 + dir * r} V${y2 - dir * r} Q${mid},${y2} ${mid + r},${y2} H${x2}`;
}

/** Left-to-right DAG layout: columns are dependency depth, nodes coloured by live status. */
/** Left-to-right DAG layout: columns are dependency depth; each step is a station plate with a lamp. */
@Component({
  selector: 'app-dag',
  template: `
    <div class="dag-scroll">
      <svg [attr.width]="layout().width" [attr.height]="layout().height" [style.min-width.px]="layout().width * MIN_SCALE" [attr.viewBox]="'0 0 ' + layout().width + ' ' + layout().height" role="group" aria-label="Workflow graph">
        <defs>
          <marker id="dag-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 1 L 8 5 L 0 9 z" class="dag-arrow" />
          </marker>
        </defs>
        @for (e of layout().edges; track e.id) {
          <path [attr.d]="e.d" [class]="'dag-edge s-' + e.status" marker-end="url(#dag-arrow)" />
        }
        @for (n of layout().nodes; track n.id) {
          <g [class]="'dag-node s-' + n.status" [class.selected]="n.id === selected()" (click)="select.emit(n.id)" (keydown.enter)="select.emit(n.id)" (keydown.space)="select.emit(n.id); $event.preventDefault()"
             tabindex="0" role="button" [attr.aria-pressed]="n.id === selected()" [attr.aria-label]="n.name + ', ' + n.type + (n.status !== 'draft' ? ', ' + statusLabel(n.status) : '')" [attr.transform]="'translate(' + n.x + ',' + n.y + ')'">
            <rect class="dag-plate" [attr.width]="W" [attr.height]="H" rx="3" />
            <rect class="dag-lamp" x="12" y="14" width="10" height="10" rx="2" />
            <text x="32" y="23" class="dag-title">{{ n.name.length > 21 ? n.name.slice(0, 20) + '…' : n.name }}</text>
            <text x="32" y="42" class="dag-sub">
              {{ n.type.toUpperCase() }}{{ n.hasWhen ? ' · IF' : '' }}{{ n.status !== 'draft' ? ' · ' + statusLabel(n.status) : '' }}{{ n.attempt > 1 ? ' · TRY ' + n.attempt : '' }}
            </text>
          </g>
        }
      </svg>
    </div>
  `,
})
export class DagView {
  readonly steps = input.required<StepDefinition[]>();
  readonly statuses = input<Record<string, { status: TaskStatus; attempt: number }>>({});
  readonly selected = input<string | null>(null);
  readonly select = output<string>();

  protected readonly W = W;
  protected readonly H = H;
  protected readonly MIN_SCALE = MIN_SCALE;

  protected statusLabel(status: string): string {
    return status === 'waiting_approval' ? 'APPROVAL' : status.toUpperCase();
  }

  protected readonly layout = computed(() => {
    const steps = this.steps();
    const statuses = this.statuses();
    const ids = new Set(steps.map((s) => s.id));
    const depth = new Map<string, number>();
    const byId = new Map(steps.map((s) => [s.id, s]));
    const visiting = new Set<string>();
    const resolve = (id: string): number => {
      if (depth.has(id)) return depth.get(id)!;
      if (visiting.has(id)) return 0; // cycle in an unsaved draft; draw it flat
      visiting.add(id);
      const deps = (byId.get(id)?.dependsOn ?? []).filter((d) => ids.has(d));
      const d = deps.length ? Math.max(...deps.map(resolve)) + 1 : 0;
      visiting.delete(id);
      depth.set(id, d);
      return d;
    };
    steps.forEach((s) => resolve(s.id));

    const columns: string[][] = [];
    for (const s of steps) (columns[depth.get(s.id)!] ??= []).push(s.id);
    const tallest = Math.max(1, ...columns.map((c) => c?.length ?? 0));
    const height = PAD * 2 + tallest * H + (tallest - 1) * ROW;

    const pos = new Map<string, { x: number; y: number }>();
    columns.forEach((col, ci) => {
      const colHeight = col.length * H + (col.length - 1) * ROW;
      const top = (height - colHeight) / 2;
      col.forEach((id, ri) => pos.set(id, { x: PAD + ci * (W + COL), y: top + ri * (H + ROW) }));
    });

    const statusOf = (id: string) => statuses[id]?.status ?? 'draft';
    const nodes: NodeBox[] = steps.map((s) => ({
      id: s.id,
      name: s.name || s.id,
      type: s.type,
      ...pos.get(s.id)!,
      status: statusOf(s.id),
      attempt: statuses[s.id]?.attempt ?? 0,
      hasWhen: Boolean(s.when),
    }));
    const edges: Edge[] = steps.flatMap((s) =>
      s.dependsOn
        .filter((d) => pos.has(d))
        .map((d) => {
          const a = pos.get(d)!;
          const b = pos.get(s.id)!;
          const x1 = a.x + W;
          const y1 = a.y + H / 2;
          const x2 = b.x - 3;
          const y2 = b.y + H / 2;
          return { id: `${d}->${s.id}`, d: connector(x1, y1, x2, y2), status: statusOf(d) };
        }),
    );
    return { nodes, edges, width: PAD * 2 + columns.length * W + (columns.length - 1) * COL, height };
  });
}
