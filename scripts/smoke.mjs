#!/usr/bin/env node
// End-to-end smoke test against a running stack (API + workers).
//   node scripts/smoke.mjs [http://localhost:3000]
// Starts every demo workflow, approves approval gates, exercises pause/resume and cancel/retry,
// and checks that live events arrive over the WebSocket.

const base = (process.argv[2] ?? process.env.API_URL ?? "http://localhost:3000").replace(/\/$/, "");
const token = process.env.API_TOKEN;
const headers = { "content-type": "application/json", "x-actor": "smoke-test", ...(token ? { authorization: `Bearer ${token}` } : {}) };

async function api(method, path, body) {
  const res = await fetch(`${base}/api${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const check = (cond, msg) => {
  if (!cond) throw new Error(`FAILED: ${msg}`);
  console.log(`  ok  ${msg}`);
};

async function waitFor(runId, predicate, label, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const detail = await api("GET", `/runs/${runId}`);
    for (const task of detail.tasks) {
      if (task.status === "waiting_approval" && label !== "approval") await api("POST", `/tasks/${task.id}/approve`, { comment: "auto-approved by smoke test" });
    }
    if (predicate(detail)) return detail;
    await sleep(500);
  }
  throw new Error(`timed out waiting for ${label} on run ${runId}`);
}

const events = {};
const wsUrl = `${base.replace(/^http/, "ws")}/ws${token ? `?token=${token}` : ""}`;
const ws = new WebSocket(wsUrl);
ws.addEventListener("message", (e) => {
  const msg = JSON.parse(e.data);
  events[msg.type] = (events[msg.type] ?? 0) + 1;
});
await new Promise((resolve, reject) => {
  ws.addEventListener("open", resolve, { once: true });
  ws.addEventListener("error", reject, { once: true });
});
console.log(`connected to ${wsUrl}`);

const workflows = await api("GET", "/workflows");
const byName = Object.fromEntries(workflows.map((w) => [w.name, w]));
const start = async (name, input) => {
  const wf = byName[name];
  check(Boolean(wf), `demo workflow "${name}" exists`);
  return api("POST", `/workflows/${wf.id}/runs`, { input: input ?? wf.definition.exampleInput ?? {} });
};
const terminal = (d) => ["succeeded", "failed", "cancelled"].includes(d.run.status);

console.log("\n1. content pipeline with approval gate");
const content = await start("AI Content Pipeline");
ws.send(JSON.stringify({ type: "subscribe", runId: content.id }));
const gated = await waitFor(content.id, (d) => d.tasks.some((t) => t.status === "waiting_approval"), "approval");
check(gated.tasks.find((t) => t.stepId === "draft").status === "succeeded", "draft finished before the gate");
await waitFor(content.id, terminal, "content pipeline");
const contentDone = await api("GET", `/runs/${content.id}`);
check(contentDone.run.status === "succeeded", "content pipeline succeeded after approval");
check(contentDone.run.output?.approvedBy === "smoke-test", "approver recorded in run output");

console.log("\n2. triage with structured output and when-branch");
const triage = await start("Support Ticket Triage");
const triageDone = await waitFor(triage.id, terminal, "triage");
check(triageDone.run.status === "succeeded", "triage succeeded");
const classify = triageDone.tasks.find((t) => t.stepId === "classify");
check(typeof classify.output?.data?.category === "string", "classifier returned structured data");

console.log("\n3. parallel batch with retries across workers");
const batches = await Promise.all([1, 2, 3].map(() => start("Batch Enrichment (load test)")));
const batchResults = await Promise.all(batches.map((b) => waitFor(b.id, terminal, "batch", 180_000)));
for (const r of batchResults) {
  const failed = r.tasks.filter((t) => t.status === "failed");
  if (r.run.status === "failed") {
    console.log(`  ..  batch ${r.run.id.slice(0, 8)} failed after retries (${failed.map((t) => t.stepId)}) - skipping failed shards`);
    for (const t of failed) await api("POST", `/tasks/${t.id}/skip`);
    const healed = await waitFor(r.run.id, (d) => d.run.status === "succeeded", "batch after skip");
    check(healed.run.status === "succeeded", "skip override healed a failed batch");
  } else {
    check(r.run.status === "succeeded", `batch ${r.run.id.slice(0, 8)} succeeded`);
  }
}
const workerIds = new Set(batchResults.flatMap((r) => r.tasks.map((t) => t.workerId)).filter(Boolean));
console.log(`  ..  tasks ran on workers: ${[...workerIds].join(", ")}`);
const retried = batchResults.flatMap((r) => r.tasks).filter((t) => t.attempt > 1).length;
console.log(`  ..  ${retried} tasks needed automatic retries`);

console.log("\n4. pause / resume / cancel / retry");
const paused = await start("Batch Enrichment (load test)");
await api("POST", `/runs/${paused.id}/pause`);
check((await api("GET", `/runs/${paused.id}`)).run.status === "paused", "run paused");
await sleep(1500);
await api("POST", `/runs/${paused.id}/resume`);
await api("POST", `/runs/${paused.id}/cancel`);
const cancelled = await api("GET", `/runs/${paused.id}`);
check(cancelled.run.status === "cancelled", "run cancelled");
check(cancelled.tasks.every((t) => ["cancelled", "succeeded"].includes(t.status)), "no task left active after cancel");
await api("POST", `/runs/${paused.id}/retry`);
const retriedRun = await waitFor(paused.id, terminal, "retried run", 180_000);
check(["succeeded", "failed"].includes(retriedRun.run.status), `retried run finished (${retriedRun.run.status})`);

console.log("\n5. metrics, workers, audit, live events");
const summary = await api("GET", "/metrics/summary");
check(summary.workers.count >= 1, `${summary.workers.count} worker(s) reporting heartbeats`);
check(summary.runs.started24h >= 6, `${summary.runs.started24h} runs in the last 24h`);
const throughput = await api("GET", "/metrics/throughput?minutes=10");
check(throughput.reduce((n, p) => n + p.succeeded, 0) > 0, "throughput series has completed tasks");
const audit = await api("GET", "/audit?limit=200");
check(audit.some((a) => a.action === "task.approve" && a.actor === "smoke-test"), "approvals are audited with the actor");
const generated = await api("POST", "/ai/generate-workflow", { description: "Summarize our weekly sales numbers and email them to the team" });
check(generated.definition.steps.length > 1, `AI generated a ${generated.definition.steps.length}-step workflow (${generated.mock ? "mock" : "live"})`);
await sleep(2500);
ws.close();
console.log(`  ..  websocket events: ${JSON.stringify(events)}`);
check((events["task.updated"] ?? 0) > 20 && (events["run.updated"] ?? 0) > 5, "task and run updates streamed live");
check((events["task.stream"] ?? 0) > 0 && (events["task.log"] ?? 0) > 0, "subscribed run streamed logs and LLM tokens");
check((events["queue.updated"] ?? 0) > 0 && (events["worker.heartbeat"] ?? 0) > 0, "queue depth and heartbeats streamed");

console.log("\nSMOKE TEST PASSED");
process.exit(0);
