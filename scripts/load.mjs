#!/usr/bin/env node
// Floods the queue with parallel batch runs to demonstrate autoscaling.
//   node scripts/load.mjs [runs=10] [http://localhost:3000]
// Watch Workers & scaling in the dashboard (or `kubectl get pods -n wfo -w`) while it runs.

const runs = Number(process.argv[2] ?? 10);
const base = (process.argv[3] ?? process.env.API_URL ?? "http://localhost:3000").replace(/\/$/, "");
const headers = {
  "content-type": "application/json",
  "x-actor": "load-test",
  ...(process.env.API_TOKEN ? { authorization: `Bearer ${process.env.API_TOKEN}` } : {}),
};

const workflows = await (await fetch(`${base}/api/workflows`, { headers })).json();
const batch = workflows.find((w) => w.name === "Batch Enrichment (load test)");
if (!batch) throw new Error("Demo workflow 'Batch Enrichment (load test)' not found");

const started = await Promise.all(
  Array.from({ length: runs }, (_, i) =>
    fetch(`${base}/api/workflows/${batch.id}/runs`, {
      method: "POST",
      headers,
      body: JSON.stringify({ input: { batch: `load-${i + 1}` } }),
    }).then((r) => r.json()),
  ),
);
console.log(`started ${started.length} runs (${started.length * batch.definition.steps.length} steps)`);

const t0 = Date.now();
for (;;) {
  const [summary, queue] = await Promise.all([
    fetch(`${base}/api/metrics/summary`, { headers }).then((r) => r.json()),
    fetch(`${base}/api/queue`, { headers }).then((r) => r.json()),
  ]);
  const elapsed = ((Date.now() - t0) / 1000).toFixed(0).padStart(4);
  console.log(`${elapsed}s  waiting=${queue.waiting}  active=${queue.active}  workers=${summary.workers.count}  runs in flight=${summary.runs.running}`);
  if (summary.runs.running === 0 && queue.waiting === 0 && queue.active === 0) break;
  await new Promise((r) => setTimeout(r, 2000));
}
console.log("queue drained");
