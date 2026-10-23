---
version: 1
slug: "web-src"
primary_target: "web/src"
related_targets: []
---

# Dashboard surface brief

## Scope and mode

The whole Angular dashboard in `web/src`: shell, Overview, Workflows, Workflow editor, Runs, Run detail, Workers and scaling, Audit log. Visitor mode: Operate. Full redesign; every feature, route and API call stays.

## Audience, job, constraints

Cold portfolio and demo viewers land on Overview from a link and spend a few minutes. Within one screen they must see the system working live, know where something needs a human, and be able to start a workflow in one click. Avoid above all: the generic AI-generated SaaS dashboard look. Credibility test: an ops engineer would trust it during an incident.

## Chosen direction: Andon line board

Memorable moment: the andon band across the top of every screen, its lamps changing as runs move, and a run drawn as a row of station lamps that light, wait and go quiet.

## Direction contract

THESIS: Orchestrator is a production line: workers pull work, a stuck station calls for help, anyone can stop the line. The dashboard is the andon board over that line, where only what needs you lights up. It refuses the category default of a navy dashboard with a purple accent and a grid of KPI cards.

OWN-WORLD: Light shop-floor grey ground with paper-white work panels, square-cornered and hairline-ruled. A deep machine-green rail and andon band frame every screen. Lamp colours are reserved for state: green running, signal yellow awaiting approval, red failed or line stopped, blue queued, unlit pending; finished work goes quiet graphite. Barlow for all UI, Barlow Semi Condensed for board labels and table heads, tabular figures, mono only for IDs, logs and JSON. Drawn icons in one stroke.

STORY: The visitor understands that work flows through stations, sees what is running, waiting or broken, believes every override is a real state change on a real line, and acts: starts a run, approves a gate, retries a step, stops the line.

FIRST VIEWPORT: Left green rail: wordmark, five nav items (live counts on Overview for open items, Runs for runs in flight, Workers for workers), mode facts at the foot. Top: the andon band spanning the content, one lamp cell per workflow (name, lamp, live run count; a cell that needs a person sweeps its whole face yellow or red) and a line cell (queue waiting and running, worker slots as large condensed figures) ending in the Pause all execution control; a stopped line adds a red rule across the board. On phones the cells form a two-column grid. Below on the grey ground: page title with Start a workflow as the primary action; a Needs you list (approval gates, failed runs) first; runs in flight, each as a row of step lamps with progress; then throughput and load-vs-workers charts and the live activity feed.

FORM: Andon line board, position 3 of 7 on the ordered list. seed:ad1ef45a288d9bb9 (degraded roll: no challengers, roll service unreachable).

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Unresolved

- Dark scheme: follows the operating system; light is the designed default from the use scene (a viewer on a laptop in daylight).
