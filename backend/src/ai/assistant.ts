import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { config } from "../config.js";
import { validateDefinition, type ValidationIssue } from "../core/dag.js";
import { HttpError, STEP_TYPES, type Task, type TaskLog, type WorkflowDefinition } from "../core/types.js";
import { claude, ClaudeError, complete, fallbackParams } from "./claude.js";

/* ------------------------------ natural language -> workflow ------------------------------ */

const SYSTEM_PROMPT = `You design workflows for an orchestration platform that runs steps as a DAG on autoscaled workers.

Step types and their config:
- llm: { prompt: string, system?: string, maxTokens?: number, outputSchema?: JSON Schema object }
  Calls Claude. Output: { text, data? }. With outputSchema the answer is JSON in output.data; every object in
  the schema needs "additionalProperties": false and a "required" array listing all its properties.
- http: { url: string, method?: "GET"|"POST"|"PUT"|"PATCH"|"DELETE", headers?: object, body?: any }
  Output: { status, headers, body }.
- delay: { ms: number } - waits; useful to model slow external work or rate limits.
- transform: { output: any } - builds a JSON value from templates; use it to merge or reshape data.
- approval: { message: string } - pauses until a human approves in the dashboard. Output: { approved, by, comment }.

Templates: string values may reference {{input.<field>}}, {{steps.<stepId>.output...}} and {{run.id}}.
A string that is exactly one template keeps the referenced value's type.
Each step: id (letters, digits, - or _; starts with a letter), name, type, dependsOn (step ids), retries (0-3),
optional when (a template; falsy skips the step). Steps with no shared dependency run in parallel - prefer
parallel fan-out where the task allows it. Add an approval step before anything irreversible.
Return configJson as a JSON string encoding the config object.`;

const generatedSchema = z.object({
  name: z.string(),
  description: z.string(),
  exampleInputJson: z.string().describe("JSON object string with example run input"),
  steps: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      type: z.enum(STEP_TYPES),
      dependsOn: z.array(z.string()),
      retries: z.number().int(),
      when: z.string().nullable(),
      configJson: z.string(),
    }),
  ),
});
type Generated = z.infer<typeof generatedSchema>;

export interface GeneratedWorkflow {
  name: string;
  description: string;
  definition: WorkflowDefinition;
  mock: boolean;
}

function toDefinition(generated: Generated): { raw: unknown; parseErrors: ValidationIssue[] } {
  const parseErrors: ValidationIssue[] = [];
  const parseJson = (text: string, path: string) => {
    try {
      return JSON.parse(text);
    } catch {
      parseErrors.push({ path, message: "configJson is not valid JSON" });
      return {};
    }
  };
  const exampleInput = parseJson(generated.exampleInputJson || "{}", "exampleInputJson");
  return {
    raw: {
      exampleInput: exampleInput && typeof exampleInput === "object" && !Array.isArray(exampleInput) ? exampleInput : {},
      steps: generated.steps.map((s, i) => ({
        id: s.id,
        name: s.name,
        type: s.type,
        dependsOn: s.dependsOn,
        retries: Math.min(Math.max(s.retries, 0), 10),
        ...(s.when ? { when: s.when } : {}),
        config: parseJson(s.configJson, `steps.${i}.configJson`),
      })),
    },
    parseErrors,
  };
}

export async function generateWorkflow(description: string): Promise<GeneratedWorkflow> {
  if (config.llm.mode === "mock") return mockWorkflow(description);

  const model = config.llm.model;
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: `Design a workflow for:\n\n${description}` }];

  // One repair round: feed validation errors back and let Claude fix its own draft.
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await claude().beta.messages.parse({
      model,
      max_tokens: 16000,
      system: SYSTEM_PROMPT,
      messages,
      output_config: { effort: "medium", format: betaZodOutputFormat(generatedSchema) },
      ...fallbackParams(model),
    });
    if (response.stop_reason === "refusal") throw new ClaudeError("Claude declined to generate this workflow");
    const generated = response.parsed_output;
    if (!generated) throw new ClaudeError("Claude did not return a parseable workflow");

    const { raw, parseErrors } = toDefinition(generated);
    const result = validateDefinition(raw);
    const issues = [...parseErrors, ...(result.ok ? [] : result.issues)];
    if (result.ok && !parseErrors.length) {
      return { name: generated.name, description: generated.description, definition: result.definition, mock: false };
    }
    messages.push(
      { role: "assistant", content: response.content },
      {
        role: "user",
        content: `The workflow failed validation:\n${issues.map((i) => `- ${i.path}: ${i.message}`).join("\n")}\nReturn a corrected workflow.`,
      },
    );
  }
  throw new HttpError(422, "Claude could not produce a valid workflow for this description; try rephrasing it");
}

function mockWorkflow(description: string): GeneratedWorkflow {
  const words = description.toLowerCase();
  const needsApproval = /(publish|send|deploy|email|post|delete|pay)/.test(words);
  const topic = description.slice(0, 80);
  const steps: WorkflowDefinition["steps"] = [
    {
      id: "research",
      name: "Research",
      type: "llm",
      dependsOn: [],
      retries: 1,
      config: { prompt: "Research the following request and list the key facts:\n{{input.request}}" },
    },
    {
      id: "risks",
      name: "Identify risks",
      type: "llm",
      dependsOn: [],
      retries: 1,
      config: { prompt: "List risks and open questions for:\n{{input.request}}" },
    },
    {
      id: "plan",
      name: "Draft result",
      type: "llm",
      dependsOn: ["research", "risks"],
      retries: 1,
      config: {
        prompt: "Using these facts:\n{{steps.research.output.text}}\n\nand these risks:\n{{steps.risks.output.text}}\n\nproduce the final deliverable.",
      },
    },
  ];
  if (needsApproval) {
    steps.push({ id: "review", name: "Human review", type: "approval", dependsOn: ["plan"], retries: 0, config: { message: "Review the draft before it goes out" } });
  }
  steps.push({
    id: "result",
    name: "Package result",
    type: "transform",
    dependsOn: [needsApproval ? "review" : "plan"],
    retries: 0,
    config: { output: { request: "{{input.request}}", deliverable: "{{steps.plan.output.text}}" } },
  });
  const result = validateDefinition({ steps, exampleInput: { request: description } });
  if (!result.ok) throw new Error("mock workflow invalid");
  return {
    name: `AI: ${topic.length > 40 ? `${topic.slice(0, 40)}...` : topic}`,
    description: `Generated offline (mock mode) from: ${description}`,
    definition: result.definition,
    mock: true,
  };
}

/* ---------------------------------- failure diagnosis ---------------------------------- */

export async function diagnoseTask(task: Task, stepConfig: unknown, logs: TaskLog[]): Promise<{ analysis: string; mock: boolean }> {
  const prompt = [
    `A workflow step failed. Explain the most likely root cause in 2-4 sentences, then give concrete fixes as a short list.`,
    `Say which fix an operator can apply from the dashboard (retry, skip, edit the step config) and which needs code or infra changes.`,
    "",
    `Step: ${task.stepId} (${task.type}), attempt ${task.attempt}`,
    `Error: ${task.error ?? "none recorded"}`,
    `Config: ${JSON.stringify(stepConfig).slice(0, 4000)}`,
    `Logs:\n${logs.slice(-40).map((l) => `[${l.level}] ${l.message}`).join("\n").slice(0, 8000)}`,
  ].join("\n");
  const result = await complete({ prompt, effort: "low", maxTokens: 4000 });
  return { analysis: result.text, mock: result.mock };
}
