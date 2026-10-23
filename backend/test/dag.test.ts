import { describe, expect, it } from "vitest";
import { descendants, leafSteps, topologicalLevels, validateDefinition } from "../src/core/dag.js";

const step = (id: string, dependsOn: string[] = [], extra: Record<string, unknown> = {}) => ({
  id,
  type: "delay",
  config: { ms: 1 },
  dependsOn,
  ...extra,
});

describe("validateDefinition", () => {
  it("accepts a diamond DAG and fills defaults", () => {
    const result = validateDefinition({ steps: [step("a"), step("b", ["a"]), step("c", ["a"]), step("d", ["b", "c"])] });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.definition.steps[0]!.retries).toBe(0);
      expect(topologicalLevels(result.definition)).toEqual([["a"], ["b", "c"], ["d"]]);
      expect(leafSteps(result.definition)).toEqual(["d"]);
      expect([...descendants(result.definition, "b")]).toEqual(["d"]);
    }
  });

  it("rejects cycles", () => {
    const result = validateDefinition({ steps: [step("a", ["c"]), step("b", ["a"]), step("c", ["b"])] });
    expect(result.ok).toBe(false);
    expect(result.issues[0]!.message).toMatch(/cycle/i);
  });

  it("rejects unknown and self dependencies and duplicate ids", () => {
    const result = validateDefinition({ steps: [step("a", ["a"]), step("a"), step("b", ["missing"])] });
    expect(result.ok).toBe(false);
    const messages = result.issues.map((i) => i.message).join("\n");
    expect(messages).toMatch(/Duplicate step id/);
    expect(messages).toMatch(/cannot depend on itself/);
    expect(messages).toMatch(/Unknown step "missing"/);
  });

  it("validates per-type config", () => {
    const result = validateDefinition({
      steps: [
        { id: "x", type: "llm", config: {} },
        { id: "y", type: "http", config: { url: "https://example.com", method: "TRACE" } },
      ],
    });
    expect(result.ok).toBe(false);
    expect(result.issues.map((i) => i.path)).toEqual(expect.arrayContaining(["steps.0.config.prompt", "steps.1.config.method"]));
  });

  it("applies config defaults", () => {
    const result = validateDefinition({ steps: [{ id: "h", type: "http", config: { url: "https://example.com" } }] });
    expect(result.ok && result.definition.steps[0]!.config.method).toBe("GET");
  });

  it("rejects bad step ids", () => {
    expect(validateDefinition({ steps: [{ id: "1abc", type: "delay", config: { ms: 1 } }] }).ok).toBe(false);
  });
});
