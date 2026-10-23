import { describe, expect, it } from "vitest";
import { mockFromSchema } from "../src/ai/claude.js";
import { isTruthy, render, renderString, type TemplateContext } from "../src/core/template.js";

const ctx: TemplateContext = {
  input: { topic: "autoscaling", count: 3 },
  steps: {
    fetch: { status: "succeeded", output: { body: { items: [{ id: "first" }, { id: "second" }] } } },
    sum: { status: "succeeded", output: { text: "short summary" } },
  },
  run: { id: "run-1", workflowId: "wf-1", trigger: "manual" },
};

describe("templates", () => {
  it("returns raw values for whole-string templates", () => {
    expect(renderString("{{ input.count }}", ctx)).toBe(3);
    expect(renderString("{{steps.fetch.output.body}}", ctx)).toEqual({ items: [{ id: "first" }, { id: "second" }] });
  });

  it("interpolates mixed strings and supports indexes", () => {
    expect(renderString("Topic: {{input.topic}} / {{steps.fetch.output.body.items[1].id}}", ctx)).toBe("Topic: autoscaling / second");
    expect(renderString("obj={{steps.fetch.output.body.items[0]}}", ctx)).toBe('obj={"id":"first"}');
  });

  it("renders missing paths as empty / undefined", () => {
    expect(renderString("x{{steps.nope.output.text}}y", ctx)).toBe("xy");
    expect(renderString("{{steps.nope.output.text}}", ctx)).toBeUndefined();
  });

  it("renders nested structures", () => {
    expect(render({ a: ["{{input.topic}}", { b: "{{run.id}}" }], n: 5 }, ctx)).toEqual({ a: ["autoscaling", { b: "run-1" }], n: 5 });
  });

  it("does not evaluate code", () => {
    expect(renderString("{{ process.exit() }}", ctx)).toBeUndefined();
  });

  it("treats string falsy values as false", () => {
    expect(["", "false", "0", "no", "null"].every((v) => !isTruthy(v))).toBe(true);
    expect([true, "yes", 1, [1]].every(isTruthy)).toBe(true);
    expect(isTruthy([])).toBe(false);
  });
});

describe("mockFromSchema", () => {
  it("builds values that match the schema shape", () => {
    const value = mockFromSchema({
      type: "object",
      properties: {
        category: { type: "string", enum: ["billing", "bug"] },
        urgency: { type: "integer" },
        escalate: { type: "boolean" },
        tags: { type: "array", items: { type: "string" } },
      },
    });
    expect(value).toEqual({ category: "billing", urgency: 3, escalate: false, tags: ["mock tags"] });
  });
});
