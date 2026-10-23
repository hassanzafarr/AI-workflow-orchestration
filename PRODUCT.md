# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary (confirmed): portfolio and demo viewers: recruiters, hiring managers and prospective clients judging the author's engineering and product craft. They arrive cold, usually from a link, and spend a few minutes clicking through. They should understand what the platform does without reading the README, see it working live, and leave with a sense of quality.

Simulated persona (inferred from the repository): the operator the product is built for, an ops or platform engineer who runs AI pipelines in production. They watch runs, unblock approval gates, retry or skip failing steps, pause execution during incidents, and move autoscaler bounds before a heavy batch. The demo has to stay credible to this person, because the viewers above judge it as if they were them.

## Product Purpose

A central dashboard to manage, monitor and scale automated AI workflows. Workflows are DAGs of steps (Claude prompts, HTTP calls, transforms, delays, human approvals). The dashboard shows every run live, streams Claude's output token by token, and lets an operator override anything. Success for this product: a viewer watches a workflow execute across workers, sees a human approval gate stop it, acts on it, and believes the system underneath is real.

## Positioning

The control surface and the engine are one product: every override (pause, resume, cancel, retry, skip, approve, reject, global queue pause, autoscaler bounds) is a real state transition in a Postgres-backed DAG state machine, executed by queue workers that scale on queue depth in Kubernetes, and recorded in an audit log with the operator's name. LLM steps stream live tokens into the run view.

## Operating Context

- Runs locally with `npm run dev` (API, worker, Angular dashboard) against Postgres and Redis, or as a Docker Compose stack, or on Kubernetes with KEDA.
- Without `ANTHROPIC_API_KEY` everything runs in mock mode: deterministic, streamed output, so the demo is free to show. The UI says when it is in mock mode.
- Four demo workflows are seeded on first start: AI Content Pipeline (parallel research and outline, draft, editorial approval, package), Support Ticket Triage (structured output, conditional escalation), Batch Enrichment (12-way parallel load test with simulated failures), Website Health Check (scheduled, disabled by default).
- Operator identity is a name typed into the dashboard settings; an optional API token guards the API.

## Capabilities and Constraints

- Screens: Overview, Workflows, Workflow editor (JSON definition with live validation and graph preview, AI generation from a description), Runs, Run detail (live DAG, step table, step inspector with output, live token stream, logs, config, approval, AI diagnosis), Workers and scaling, Audit log.
- Step types: `llm`, `http`, `transform`, `delay`, `approval`. Statuses: pending, queued, running, waiting for approval, succeeded, failed, skipped, cancelled, paused.
- Frontend: Angular 21, standalone components, signals, zoneless; plain global CSS, no UI library. Must keep working behavior, routes and API contracts unchanged.
- The dashboard is served by nginx in the container image; `/api` and `/ws` are proxied to the API.

## Brand Commitments

- Product name in the UI: "Orchestrator" (confirmed).

## Evidence on Hand

- Real demo data comes from the seeded workflows and the smoke and load scripts (`scripts/smoke.mjs`, `scripts/load.mjs`). No customers, testimonials, benchmarks or production metrics exist; none may be invented.

## Product Principles

1. Show the machine working: live state, streamed output and real transitions beat descriptions of them.
2. Every override is consequential and attributable; the interface makes that weight legible without making it scary.
3. A cold visitor understands the product in one screen and can trigger something real in one click.
4. Credible to an operator under pressure: dense, scannable and calm, never decorative at the cost of reading state.
