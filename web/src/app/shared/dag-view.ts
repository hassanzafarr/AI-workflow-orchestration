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

const W = 184;
const H = 58;
const COL = 72;
const ROW = 18;
const PAD = 16;

const TYPE_ICON: Record<StepType, string> = { llm: '✦', http: '⇄', delay: '◷', transform: '⟳', approval: '✋' };

/** Left-to-right DAG layout: columns are dependency depth, nodes coloured by live status. */
@Component({
  selector: 'app-dag',
  template: `
    <div class="dag-scroll">
      <svg [attr.width]="layout().width" [attr.height]="layout().height" [attr.viewBox]="'0 0 ' + layout().width + ' ' + layout().height" role="img" aria-label="Workflow graph">
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" class="dag-arrow" />
          </marker>
        </defs>
        @for (e of layout().edges; track e.id) {
          <path [attr.d]="e.d" class="dag-edge" [class]="'dag-edge e-' + e.status" marker-end="url(#arrow)" />
        }
        @for (n of layout().nodes; track n.id) {
          <g class="dag-node" [class]="'dag-node n-' + n.status" [class.selected]="n.id === selected()" (click)="select.emit(n.id)" [attr.transform]="'translate(' + n.x + ',' + n.y + ')'">
            <rect [attr.width]="W" [attr.height]="H" rx="10" />
            <text x="14" y="24" class="dag-icon">{{ icon(n.type) }}</text>
            <text x="34" y="24" class="dag-title">{{ n.name.length > 19 ? n.name.slice(0, 18) + '…' : n.name }}</text>
            <text x="34" y="43" class="dag-sub">
              {{ n.type }}{{ n.hasWhen ? ' · conditional' : '' }}{{ n.status !== 'draft' ? ' · ' + statusLabel(n.status) : '' }}{{ n.attempt > 1 ? ' · try ' + n.attempt : '' }}
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

  protected icon(type: StepType): string {
    return TYPE_ICON[type] ?? '•';
  }

  protected statusLabel(status: string): string {
    return status === 'waiting_approval' ? 'approval' : status;
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
          const x2 = b.x - 4;
          const y2 = b.y + H / 2;
          const mid = (x1 + x2) / 2;
          return { id: `${d}->${s.id}`, d: `M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2},${y2}`, status: statusOf(d) };
        }),
    );
    return { nodes, edges, width: PAD * 2 + columns.length * W + (columns.length - 1) * COL, height };
  });
}
