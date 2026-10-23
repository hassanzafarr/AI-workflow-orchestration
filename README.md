# AI Workflow Orchestration Platform

A central dashboard to manage, monitor and scale automated AI workflows. Workflows are DAGs of
steps (Claude prompts, HTTP calls, transforms, delays, human approvals). An Angular dashboard
shows every run live, streams Claude's output token by token, and lets operators override
anything: pause, resume, cancel, retry, skip, approve or reject, pause all execution, or move
the autoscaler's bounds. The backend runs as Kubernetes microservices; worker pods scale on queue
depth during heavy jobs and drain gracefully when load drops.

**Stack:** Angular 21 (standalone, signals, zoneless) · Node.js 22 + TypeScript · Express 5 +
WebSocket · BullMQ on Redis · PostgreSQL · Claude API (`@anthropic-ai/sdk`) · Docker ·
Kubernetes + KEDA.

## Architecture

```
                   ┌─────────────────────────── Kubernetes namespace: wfo ───────────────────────────┐
 Browser           │                                                                                 │
 Angular  ──HTTP──▶│ Ingress ─┬─ /      ─▶ wfo-web (nginx, static Angular)                           │
 dashboard ◀──WS───│          └─ /api,/ws ─▶ wfo-api  ×N  (REST, WebSocket fan-out, overrides,       │
                   │                         │   ▲           reconciler, K8s scaling API)            │
                   │                 enqueue │   │ pub/sub events                                    │
                   │                         ▼   │                                                   │
                   │                     Redis (BullMQ queue `tasks` + `triggers`, pub/sub, heartbeats)│
                   │                         │   ▲                                                   │
                   │                 consume │   │ results, logs, token stream, heartbeats           │
                   │                         ▼   │                                                   │
                   │   KEDA ──scales──▶ wfo-worker ×1..30 ──▶ Claude API / HTTP targets              │
                   │  (bull:tasks:wait)       │                                                      │
                   │                          ▼                                                      │
                   │                     PostgreSQL (workflows, runs, tasks, logs, audit log)        │
                   └─────────────────────────────────────────────────────────────────────────────────┘
```

| Service | What it does | Scales on |
|---|---|---|
| `wfo-api` | REST API, WebSocket event stream, manual overrides, AI workflow generation, scaling overrides via the Kubernetes API, reconciler that recovers lost work | replicas (stateless) |
| `wfo-worker` | Pulls step executions from the queue, runs executors (Claude, HTTP, ...), streams logs/tokens, heart-beats | **KEDA on queue depth** (+ CPU) |
| `wfo-web` | nginx serving the Angular dashboard | replicas |
| Postgres | Source of truth for all state | managed DB in prod |
| Redis | BullMQ queues, pub/sub, worker registry | managed Redis in prod |

API and worker are two deployables built from one image (`backend/`), so they share the engine
code but deploy and scale independently.

### How a run executes

1. `POST /api/workflows/:id/runs` snapshots the workflow definition into a run and creates one
   task per step (`pending`).
2. The engine **advances** the run: every pending step whose dependencies succeeded (or were
   skipped) becomes `queued` and is pushed to BullMQ. Steps without a shared dependency run in
   parallel on different workers.
3. A worker **claims** the task (`running`), renders `{{templates}}` against the run input and
   upstream outputs, executes it, and **completes** it. Failures retry automatically with
   exponential backoff (`retries` per step); exhausted retries fail the run fast and cancel
   the rest.
4. Every transition runs in a Postgres transaction holding the run's row lock, so any number of
   API replicas and workers can drive the same run safely. Side effects (enqueue, events) are
   flushed after commit.
5. Each re-queue bumps a task `generation`; a stale queue job (from before a pause, cancel or
   skip) is recognised and dropped. A reconciler re-queues tasks whose job vanished (crash
   between commit and enqueue) or whose worker died after BullMQ gave up on the stalled job.

### Step types

| Type | Config | Output |
|---|---|---|
| `llm` | `prompt`, `system?`, `model?`, `maxTokens?`, `effort?`, `outputSchema?` (JSON Schema → structured output) | `{ text, data?, model, usage }` |
| `http` | `url`, `method?`, `headers?`, `body?`, `expectStatus?` | `{ status, headers, body }` |
| `transform` | `output` (any JSON with templates) | the rendered value |
| `delay` | `ms`, `failRate?` (simulate flaky work) | `{ sleptMs }` |
| `approval` | `message` | waits for an operator; `{ approved, by, comment }` |

Every step also takes `dependsOn`, `retries`, `timeoutMs` and `when` (a template; falsy skips the
step, which is how branching works). Templates: `{{input.x}}`, `{{steps.<id>.output.text}}`,
`{{steps.<id>.output.data.items[0]}}`, `{{run.id}}`. They are property paths, never evaluated
as code.

### Claude integration

* LLM steps stream from the Claude API (`claude-opus-5-5` by default, `CLAUDE_MODEL` to change)
  and the dashboard shows the tokens live. `outputSchema` uses structured outputs so downstream
  steps get typed JSON. Server-side refusal fallbacks are enabled for models that support them.
* **Generate with Claude** turns a plain-English description into a validated workflow DAG
  (structured output, one self-repair round on validation errors).
* **Ask Claude why** on a failed step diagnoses the error from its config and logs.
* Without `ANTHROPIC_API_KEY` everything runs in **mock mode**: deterministic local output,
  streamed like the real thing, so the platform can be demoed and load-tested for free.

### Manual overrides

| Scope | Overrides |
|---|---|
| Run | pause (finish running steps, start nothing new) · resume · cancel (aborts in-flight steps on workers) · retry failed steps |
| Step | retry · skip (continue downstream) · approve / reject with comment · ask Claude for a diagnosis |
| Platform | pause / resume all execution (BullMQ global pause) · move autoscaler min/max (KEDA ScaledObject or HPA) or set replicas |

Every override is written to the audit log with the operator name from the dashboard settings.

## Run it locally

Prerequisites: Node.js 22, Docker.

```bash
npm install
```

```bash
npm run setup
```

```bash
npm run infra
```

```bash
npm run dev
```

Open http://localhost:4200. Four demo workflows are seeded on first start (content pipeline with
an approval gate, a 12-way parallel load test, ticket triage with structured output and a
conditional branch, and a scheduled health check). To call the real Claude API:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

Compose datastores listen on host ports **55432** (Postgres) and **56379** (Redis) to avoid
clashing with local installs; override with `PG_HOST_PORT` / `REDIS_HOST_PORT` and
`DATABASE_URL` / `REDIS_URL`.

### Whole stack in Docker

```bash
docker compose up --build --scale worker=3
```

Dashboard on http://localhost:8080, API on http://localhost:3000.

## Tests

```bash
npm test
```

Unit tests: DAG validation (cycles, references, per-type config), templating, mock structured
output.

```bash
npm run test:integration
```

Engine integration tests against real Postgres + Redis (`npm run infra` first; they use the
`wfo_test` database and Redis DB 15): diamond DAG data flow, retries + fail-fast + skip
override, approval approve/reject, `when` branching, pause/resume with stale-job rejection,
cancel + retry, audit trail.

```bash
npm run smoke
```

End-to-end against a running stack: every demo workflow, approvals, overrides, metrics, AI
generation, and the WebSocket event stream.

```bash
npm run load -- 20
```

Floods the queue with parallel batch runs; watch **Workers & scaling** react.

## Deploy to Kubernetes

Manifests are Kustomize: `deploy/k8s/base` (API, worker, web, ingress, RBAC, PDBs) plus
components for `datastores` (in-cluster Postgres/Redis), `keda` (queue-depth autoscaling) and
`hpa` (CPU fallback), combined by `overlays/local` and `overlays/production`.

```bash
helm repo add kedacore https://kedacore.github.io/charts
```

```bash
helm install keda kedacore/keda --namespace keda --create-namespace
```

```bash
docker build -t wfo-backend:local ./backend
```

```bash
docker build -t wfo-web:local ./web
```

```bash
kubectl apply -k deploy/k8s/overlays/local
```

The dashboard is served at http://wfo.localhost through ingress-nginx (or
`kubectl -n wfo port-forward svc/wfo-web 8080:80`). Set your Claude key with:

```bash
kubectl -n wfo create secret generic wfo-secrets --from-literal=ANTHROPIC_API_KEY=sk-ant-... --from-literal=DATABASE_URL=postgres://wfo:wfo-local@wfo-postgres:5432/wfo --from-literal=POSTGRES_PASSWORD=wfo-local --from-literal=API_TOKEN= --dry-run=client -o yaml | kubectl apply -f -
```

No KEDA? Swap `components/keda` for `components/hpa` in the overlay.

### How scaling works

* **Pods:** KEDA watches the BullMQ wait list (`bull:tasks:wait`) and targets ~8 waiting steps
  per worker (2× `WORKER_CONCURRENCY`). Scale-up is immediate (+100% or +5 pods per 15 s);
  scale-down waits 3 minutes and halves at most once a minute so bursty DAGs don't thrash.
* **Nodes:** workers prefer (and tolerate) a dedicated `wfo.dev/pool=workers` node pool. When new
  worker pods don't fit, the cluster autoscaler or Karpenter adds nodes to that pool, and removes
  them once the pods scale back in.
* **Safe scale-in:** SIGTERM stops a worker from taking new jobs and waits for in-flight steps
  (`terminationGracePeriodSeconds: 300`). Anything still running when the pod dies is recovered
  by BullMQ stall detection and the API reconciler on another pod. PodDisruptionBudgets cap
  voluntary disruption.
* **Overrides:** the API's service account may only `get`/`patch` the worker Deployment scale,
  its HPA and its ScaledObject. The dashboard uses that to pre-warm workers before a known batch
  (raise min) or cap spend / protect a rate-limited API (lower max).

## Configuration

| Variable | Default | Used by |
|---|---|---|
| `DATABASE_URL` | `postgres://wfo:wfo@127.0.0.1:55432/wfo` | api, worker |
| `REDIS_URL` | `redis://127.0.0.1:56379` | api, worker |
| `ANTHROPIC_API_KEY` | - | api, worker |
| `LLM_MODE` | `auto` (live if a key is set) | api, worker |
| `CLAUDE_MODEL` | `claude-opus-5-5` | api, worker |
| `API_TOKEN` | - (auth off) | api |
| `WORKER_CONCURRENCY` | `4` | worker |
| `STEP_DEFAULT_TIMEOUT_MS` | `600000` | worker |
| `STEP_RETRY_BACKOFF_MS` | `2000` | worker |
| `HTTP_STEP_ALLOWED_HOSTS` | - (any) | worker |
| `SCALER_KIND` | `keda` in-cluster, `none` locally | api |
| `SEED_DEMO` | `true` | api |

## Project layout

```
backend/            Node.js + TypeScript (one image, two services)
  src/core/         engine (state machine), DAG validation, templates, Postgres, BullMQ, pub/sub
  src/executors/    llm, http, transform, delay, approval
  src/ai/           Claude client, workflow generator, failure diagnosis
  src/api/          REST routes, WebSocket fan-out, Kubernetes scaler, seed data
  src/worker/       queue consumer, heartbeats, graceful drain
  test/             unit + engine integration tests
web/                Angular dashboard (overview, workflows + editor, runs, run detail, workers, audit)
deploy/k8s/         Kustomize base, components (datastores, keda, hpa), overlays (local, production)
scripts/            smoke and load tests
docker-compose.yml  local stack
```

## Security notes

* Set `API_TOKEN` anywhere beyond your laptop: it guards every `/api` route and the WebSocket.
  The dashboard asks for it on the first 401.
* `http` steps can call any URL by default; set `HTTP_STEP_ALLOWED_HOSTS` to restrict them
  (SSRF protection) when workflow authors aren't fully trusted.
* Containers run as non-root with read-only root filesystems and all capabilities dropped.
