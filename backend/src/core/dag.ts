import { z } from "zod";
import { definitionSchema, stepConfigSchemas, type WorkflowDefinition } from "./types.js";

export interface ValidationIssue {
  path: string;
  message: string;
}

export type ValidationResult =
  | { ok: true; definition: WorkflowDefinition; issues: [] }
  | { ok: false; issues: ValidationIssue[] };

function zodIssues(error: z.ZodError, prefix = ""): ValidationIssue[] {
  return error.issues.map((i) => ({
    path: [prefix, ...i.path.map(String)].filter(Boolean).join("."),
    message: i.message,
  }));
}

/** Parses and checks a workflow definition: schema, per-type config, references and cycles. */
export function validateDefinition(raw: unknown): ValidationResult {
  const parsed = definitionSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, issues: zodIssues(parsed.error) };

  const definition = parsed.data;
  const issues: ValidationIssue[] = [];
  const ids = new Set<string>();

  definition.steps.forEach((step, index) => {
    if (ids.has(step.id)) issues.push({ path: `steps.${index}.id`, message: `Duplicate step id "${step.id}"` });
    ids.add(step.id);

    const configResult = stepConfigSchemas[step.type].safeParse(step.config);
    if (!configResult.success) {
      issues.push(...zodIssues(configResult.error, `steps.${index}.config`));
    } else {
      step.config = configResult.data as Record<string, unknown>;
    }
  });

  definition.steps.forEach((step, index) => {
    for (const dep of step.dependsOn) {
      if (dep === step.id) issues.push({ path: `steps.${index}.dependsOn`, message: "A step cannot depend on itself" });
      else if (!ids.has(dep)) issues.push({ path: `steps.${index}.dependsOn`, message: `Unknown step "${dep}"` });
    }
  });

  if (issues.length === 0) {
    const cycle = findCycle(definition);
    if (cycle) issues.push({ path: "steps", message: `Dependency cycle: ${cycle.join(" -> ")}` });
  }

  return issues.length ? { ok: false, issues } : { ok: true, definition, issues: [] };
}

function findCycle(definition: WorkflowDefinition): string[] | null {
  const deps = new Map(definition.steps.map((s) => [s.id, s.dependsOn]));
  const state = new Map<string, "visiting" | "done">();
  const stack: string[] = [];

  const visit = (id: string): string[] | null => {
    if (state.get(id) === "done") return null;
    if (state.get(id) === "visiting") return [...stack.slice(stack.indexOf(id)), id];
    state.set(id, "visiting");
    stack.push(id);
    for (const dep of deps.get(id) ?? []) {
      const cycle = visit(dep);
      if (cycle) return cycle;
    }
    stack.pop();
    state.set(id, "done");
    return null;
  };

  for (const step of definition.steps) {
    const cycle = visit(step.id);
    if (cycle) return cycle;
  }
  return null;
}

/** Step ids grouped by depth: level 0 has no dependencies. Assumes an acyclic definition. */
export function topologicalLevels(definition: WorkflowDefinition): string[][] {
  const depth = new Map<string, number>();
  const byId = new Map(definition.steps.map((s) => [s.id, s]));
  const resolve = (id: string): number => {
    const known = depth.get(id);
    if (known !== undefined) return known;
    const step = byId.get(id)!;
    const d = step.dependsOn.length ? Math.max(...step.dependsOn.map(resolve)) + 1 : 0;
    depth.set(id, d);
    return d;
  };
  definition.steps.forEach((s) => resolve(s.id));

  const levels: string[][] = [];
  for (const step of definition.steps) (levels[depth.get(step.id)!] ??= []).push(step.id);
  return levels;
}

/** Steps nothing else depends on; their outputs form the run output. */
export function leafSteps(definition: WorkflowDefinition): string[] {
  const referenced = new Set(definition.steps.flatMap((s) => s.dependsOn));
  return definition.steps.filter((s) => !referenced.has(s.id)).map((s) => s.id);
}

/** Every step that transitively depends on `stepId`. */
export function descendants(definition: WorkflowDefinition, stepId: string): Set<string> {
  const result = new Set<string>();
  let frontier = [stepId];
  while (frontier.length) {
    const next: string[] = [];
    for (const step of definition.steps) {
      if (!result.has(step.id) && step.dependsOn.some((d) => frontier.includes(d))) {
        result.add(step.id);
        next.push(step.id);
      }
    }
    frontier = next;
  }
  return result;
}
