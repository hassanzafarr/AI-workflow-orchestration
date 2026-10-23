/**
 * Minimal, side-effect-free templating for step configs.
 *
 *   "{{ input.topic }}"                 -> raw value (objects stay objects)
 *   "Summary: {{ steps.sum.output.text }}" -> string interpolation
 *   "{{ steps.list.output.items[0].id }}"  -> dot and [index] paths
 *
 * Expressions are property paths only; nothing is evaluated as code.
 */

export interface TemplateContext {
  input: Record<string, unknown>;
  steps: Record<string, { output: unknown; status: string }>;
  run: { id: string; workflowId: string; trigger: string };
}

const WHOLE = /^\s*\{\{\s*([^{}]+?)\s*\}\}\s*$/;
const ANY = /\{\{\s*([^{}]+?)\s*\}\}/g;
const SEGMENT = /[^.[\]]+|\[(\d+)\]/g;

export function resolvePath(root: unknown, path: string): unknown {
  let current: unknown = root;
  for (const match of path.matchAll(SEGMENT)) {
    if (current === null || current === undefined) return undefined;
    const key = match[1] ?? match[0];
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function stringify(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

export function renderString(template: string, ctx: TemplateContext): unknown {
  const whole = template.match(WHOLE);
  if (whole) return resolvePath(ctx, whole[1]!);
  return template.replace(ANY, (_, expr: string) => stringify(resolvePath(ctx, expr)));
}

/** Recursively renders every string leaf of a JSON-like value. */
export function render<T>(value: T, ctx: TemplateContext): T {
  if (typeof value === "string") return renderString(value, ctx) as T;
  if (Array.isArray(value)) return value.map((v) => render(v, ctx)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, render(v, ctx)])) as T;
  }
  return value;
}

export function isTruthy(value: unknown): boolean {
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    return v !== "" && v !== "false" && v !== "0" && v !== "no" && v !== "null" && v !== "undefined";
  }
  if (Array.isArray(value)) return value.length > 0;
  return Boolean(value);
}
