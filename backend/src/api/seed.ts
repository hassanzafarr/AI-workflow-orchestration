import { pool } from "../core/db.js";
import { logger } from "../core/logger.js";
import { createWorkflow, type WorkflowInput } from "../core/queries.js";

/** Demo workflows installed on first start (SEED_DEMO=false disables). */
export const DEMO_WORKFLOWS: WorkflowInput[] = [
  {
    name: "AI Content Pipeline",
    description: "Research and outline in parallel with Claude, draft an article, pause for editorial approval, then package it.",
    definition: {
      exampleInput: { topic: "How Kubernetes autoscaling works", audience: "backend engineers" },
      steps: [
        {
          id: "research",
          name: "Research topic",
          type: "llm",
          retries: 2,
          config: {
            system: "You are a meticulous technical researcher.",
            prompt: "List the 5 most important facts about \"{{input.topic}}\" for {{input.audience}}. One line each.",
          },
        },
        {
          id: "outline",
          name: "Structured outline",
          type: "llm",
          retries: 2,
          config: {
            prompt: "Create an article outline about \"{{input.topic}}\" for {{input.audience}}.",
            outputSchema: {
              type: "object",
              additionalProperties: false,
              required: ["title", "sections"],
              properties: {
                title: { type: "string" },
                sections: { type: "array", items: { type: "string" } },
              },
            },
          },
        },
        {
          id: "draft",
          name: "Write draft",
          type: "llm",
          dependsOn: ["research", "outline"],
          retries: 1,
          config: {
            prompt:
              "Write a ~400 word article titled \"{{steps.outline.output.data.title}}\".\nSections: {{steps.outline.output.data.sections}}\nFacts to use:\n{{steps.research.output.text}}",
          },
        },
        {
          id: "editor_review",
          name: "Editorial approval",
          type: "approval",
          dependsOn: ["draft"],
          config: { message: "Review the draft for \"{{input.topic}}\" before publishing" },
        },
        {
          id: "publish",
          name: "Package for CMS",
          type: "transform",
          dependsOn: ["editor_review"],
          config: {
            output: {
              title: "{{steps.outline.output.data.title}}",
              body: "{{steps.draft.output.text}}",
              approvedBy: "{{steps.editor_review.output.by}}",
            },
          },
        },
      ],
    },
  },
  {
    name: "Batch Enrichment (load test)",
    description: "Fans out 12 parallel jobs with simulated latency and a 15% failure rate, then fans in. Run it several times to watch the queue grow and workers scale.",
    definition: {
      exampleInput: { batch: "demo" },
      steps: [
        ...Array.from({ length: 12 }, (_, i) => ({
          id: `shard_${i + 1}`,
          name: `Enrich shard ${i + 1}`,
          type: "delay",
          retries: 2,
          config: { ms: 2000 + ((i * 937) % 4000), failRate: 0.15 },
        })),
        {
          id: "aggregate",
          name: "Aggregate results",
          type: "transform",
          dependsOn: Array.from({ length: 12 }, (_, i) => `shard_${i + 1}`),
          config: { output: { batch: "{{input.batch}}", shards: 12, completedAt: "{{steps.shard_12.output.finishedAt}}" } },
        },
      ],
    },
  },
  {
    name: "Support Ticket Triage",
    description: "Claude classifies a ticket with structured output; urgent tickets branch to a human escalation step.",
    definition: {
      exampleInput: { ticket: "Our production dashboard has been down for 20 minutes and customers are complaining." },
      steps: [
        {
          id: "classify",
          name: "Classify ticket",
          type: "llm",
          retries: 2,
          config: {
            prompt: "Classify this support ticket:\n\n{{input.ticket}}",
            effort: "low",
            outputSchema: {
              type: "object",
              additionalProperties: false,
              required: ["category", "urgency", "escalate", "summary"],
              properties: {
                category: { type: "string", enum: ["billing", "bug", "outage", "how-to", "other"] },
                urgency: { type: "string", enum: ["low", "medium", "high"] },
                escalate: { type: "boolean" },
                summary: { type: "string" },
              },
            },
          },
        },
        {
          id: "escalate",
          name: "On-call escalation",
          type: "approval",
          dependsOn: ["classify"],
          when: "{{steps.classify.output.data.escalate}}",
          config: { message: "Escalate: {{steps.classify.output.data.summary}}" },
        },
        {
          id: "reply",
          name: "Draft reply",
          type: "llm",
          dependsOn: ["classify", "escalate"],
          config: {
            prompt: "Write a short, empathetic reply to this {{steps.classify.output.data.category}} ticket:\n\n{{input.ticket}}",
            effort: "low",
          },
        },
      ],
    },
  },
  {
    name: "Website Health Check",
    description: "Fetches a URL, asks Claude to assess the response, and records the verdict. Scheduled every 15 minutes (disabled by default).",
    schedule: "*/15 * * * *",
    enabled: false,
    definition: {
      exampleInput: { url: "https://example.com" },
      steps: [
        { id: "fetch", name: "Fetch page", type: "http", retries: 2, timeoutMs: 15000, config: { url: "{{input.url}}" } },
        {
          id: "assess",
          name: "Assess health",
          type: "llm",
          dependsOn: ["fetch"],
          config: {
            prompt: "HTTP status {{steps.fetch.output.status}}. Is this endpoint healthy? Answer in one sentence.",
            effort: "low",
          },
        },
        {
          id: "record",
          name: "Record verdict",
          type: "transform",
          dependsOn: ["assess"],
          config: { output: { url: "{{input.url}}", status: "{{steps.fetch.output.status}}", verdict: "{{steps.assess.output.text}}" } },
        },
      ],
    },
  },
];

export async function seedDemoWorkflows(): Promise<void> {
  if (process.env.SEED_DEMO === "false") return;
  // Advisory lock so concurrent API replicas don't seed twice.
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(712002)");
    const { rows } = await client.query("SELECT count(*) AS n FROM workflows");
    if (rows[0].n > 0) return;
    for (const workflow of DEMO_WORKFLOWS) await createWorkflow(workflow, "seed");
    logger.info("seeded demo workflows", { count: DEMO_WORKFLOWS.length });
  } finally {
    await client.query("SELECT pg_advisory_unlock(712002)").catch(() => undefined);
    client.release();
  }
}
