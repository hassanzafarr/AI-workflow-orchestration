---
name: Orchestrator
description: The andon board over a line of AI workflows; only what needs you lights up.
colors:
  primary: "#1d3a32"
  primary-hover: "#2a5045"
  on-primary: "#ffffff"
  rail: "#1d3a32"
  rail-hover: "#26473e"
  rail-active: "#2f5649"
  rail-ink: "#eaf1ed"
  rail-ink-2: "#a9c1b6"
  board: "#121c18"
  board-hover: "#1b2823"
  board-rule: "#2a3a33"
  board-ink: "#e9f0eb"
  board-ink-2: "#a2b5ab"
  board-lamp-off: "#2b3b34"
  board-lamp-green: "#38c873"
  board-lamp-blue: "#5592f0"
  board-red-face: "#c8352b"
  lit-green: "#35c06e"
  focus-on-dark: "#f4bf4a"
  green: "#1f9d52"
  green-ink: "#1a7240"
  yellow: "#f2a900"
  yellow-ink: "#7a5000"
  yellow-wash: "#fcf0d0"
  on-yellow: "#1d1604"
  red: "#d63b30"
  red-ink: "#ad2318"
  red-wash: "#fae4e1"
  blue: "#2f6fd0"
  blue-ink: "#1d5bb8"
  graphite: "#5a655e"
  ground: "#e4e7e1"
  panel: "#f9faf7"
  sunk: "#eef1ec"
  field: "#ffffff"
  rule: "#ccd2c9"
  rule-strong: "#a6aea3"
  ink: "#18201c"
  ink-2: "#47524b"
  ink-3: "#5f6a63"
  select: "#dce8e1"
  focus: "#1d5bb8"
typography:
  wordmark:
    fontFamily: "Barlow, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "1.27rem"
    fontWeight: 700
    letterSpacing: "-0.01em"
  headline:
    fontFamily: "Barlow, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "1.75rem"
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: "-0.01em"
  title:
    fontFamily: "Barlow, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "1.07rem"
    fontWeight: 600
    lineHeight: 1.3
  title-sm:
    fontFamily: "Barlow, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "0.94rem"
    fontWeight: 600
  body:
    fontFamily: "Barlow, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.5
    fontFeature: "tnum"
  body-sm:
    fontFamily: "Barlow, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "0.87rem"
    fontWeight: 400
    fontFeature: "tnum"
  button:
    fontFamily: "Barlow, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "0.94rem"
    fontWeight: 600
    lineHeight: 1
  label-board:
    fontFamily: "'Barlow Semi Condensed', Barlow, system-ui, sans-serif"
    fontSize: "0.92rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "0.02em"
  label-head:
    fontFamily: "'Barlow Semi Condensed', Barlow, system-ui, sans-serif"
    fontSize: "0.8rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "0.07em"
  figure:
    fontFamily: "'Barlow Semi Condensed', Barlow, system-ui, sans-serif"
    fontSize: "1.7rem"
    fontWeight: 600
    lineHeight: 1.1
    fontFeature: "tnum"
  figure-sm:
    fontFamily: "'Barlow Semi Condensed', Barlow, system-ui, sans-serif"
    fontSize: "1.4rem"
    fontWeight: 600
    lineHeight: 1.15
    fontFeature: "tnum"
  mono:
    fontFamily: "'JetBrains Mono', ui-monospace, 'SFMono-Regular', Consolas, monospace"
    fontSize: "0.86em"
    fontWeight: 400
    lineHeight: 1.6
rounded:
  sm: "2px"
  md: "3px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  panel-x: "18px"
  xl: "24px"
  gutter: "32px"
components:
  button-default:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    typography: "{typography.button}"
    rounded: "{rounded.md}"
    padding: "0 13px"
    height: "34px"
  button-default-hover:
    backgroundColor: "{colors.sunk}"
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.button}"
    rounded: "{rounded.md}"
    padding: "0 13px"
    height: "34px"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
  button-ghost-hover:
    backgroundColor: "{colors.sunk}"
  button-sm:
    padding: "0 10px"
    height: "28px"
  button-approve:
    backgroundColor: "{colors.green-ink}"
    textColor: "#ffffff"
    rounded: "{rounded.md}"
    height: "34px"
  button-danger-outline:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.red-ink}"
    rounded: "{rounded.md}"
    height: "34px"
  button-danger-outline-hover:
    backgroundColor: "{colors.red-wash}"
  button-board:
    backgroundColor: "transparent"
    textColor: "{colors.board-ink}"
    rounded: "{rounded.md}"
    height: "28px"
  input:
    backgroundColor: "{colors.field}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "8px 10px"
    height: "36px"
  chip:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.md}"
    padding: "5px 10px"
  chip-active:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
  segmented-active:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    padding: "7px 14px"
  tag:
    backgroundColor: "{colors.sunk}"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.sm}"
    padding: "0 7px"
  count:
    backgroundColor: "{colors.sunk}"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.sm}"
    padding: "2px 7px"
  count-live:
    backgroundColor: "{colors.lit-green}"
    textColor: "#0b2015"
  count-attn:
    backgroundColor: "{colors.yellow}"
    textColor: "{colors.on-yellow}"
  panel:
    backgroundColor: "{colors.panel}"
    rounded: "{rounded.md}"
    padding: "16px 18px"
  table-head:
    backgroundColor: "{colors.sunk}"
    textColor: "{colors.ink-2}"
    typography: "{typography.label-head}"
    padding: "9px 14px"
  table-cell:
    padding: "10px 14px"
  rail:
    backgroundColor: "{colors.rail}"
    textColor: "{colors.rail-ink}"
    padding: "16px 12px"
    width: "228px"
  nav-item:
    textColor: "{colors.rail-ink-2}"
    rounded: "{rounded.md}"
    padding: "8px 10px"
  nav-item-hover:
    backgroundColor: "{colors.rail-hover}"
    textColor: "{colors.rail-ink}"
  nav-item-active:
    backgroundColor: "{colors.rail-active}"
    textColor: "#ffffff"
  board:
    backgroundColor: "{colors.board}"
    textColor: "{colors.board-ink}"
    height: "62px"
  board-cell:
    textColor: "{colors.board-ink}"
    typography: "{typography.label-board}"
    padding: "10px 16px"
  board-cell-wait:
    backgroundColor: "{colors.yellow}"
    textColor: "{colors.on-yellow}"
  board-cell-fail:
    backgroundColor: "{colors.board-red-face}"
    textColor: "#ffffff"
  board-lamp:
    backgroundColor: "{colors.board-lamp-off}"
    rounded: "{rounded.sm}"
    size: "12px"
  lamp:
    rounded: "{rounded.sm}"
    size: "9px"
  station-lamp:
    rounded: "{rounded.sm}"
    size: "14px"
  attn-approval:
    backgroundColor: "{colors.yellow-wash}"
    rounded: "{rounded.md}"
    padding: "10px 12px"
  attn-failed:
    backgroundColor: "{colors.red-wash}"
    rounded: "{rounded.md}"
    padding: "10px 12px"
  notice-approval:
    backgroundColor: "{colors.yellow-wash}"
    rounded: "{rounded.md}"
    padding: "10px 14px"
  dialog:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "4px"
    padding: "20px 22px"
    width: "480px"
  toast:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.panel}"
    rounded: "{rounded.md}"
    padding: "11px 14px"
---

# Design System: Orchestrator

## Overview

**Creative North Star: "The Andon Line Board"**

Orchestrator is a production line. Workers pull work, a stuck station calls for help, and anyone can stop the line. The dashboard is the andon board hung over that line: a deep machine-green rail down the left, a near-black board band across the top, and below them a light shop-floor grey ground carrying paper-white work panels. Everything at rest is quiet. Colour comes on only where a station is running, waiting for a person, or broken, so the eye finds the problem before it reads a word.

The density is an operator's, not a brochure's: hairline-ruled tables, condensed board labels, tabular figures, step lamps in a row. Corners are nearly square, surfaces are flat, and depth comes from tone (ground, panel, sunk) instead of shadow. Motion is a lamp's: running lamps breathe, a gate waiting for a person blinks faster, and a board cell that needs you sweeps its whole face to yellow or red. Light is the designed default (a viewer on a laptop in daylight); a dark scheme follows the operating system and keeps every role.

The world was built to refuse the category default for AI dashboards: a navy ground with a purple accent and a grid of KPI cards.

**Key Characteristics:**
- Fixed frame on every screen: machine-green rail (228px) and the andon board band.
- Lamp colours are reserved for state; finished work goes quiet graphite.
- Square lamps (2px corners) are the system's atom: badges, station rows, board cells, DAG nodes, chart keys and toasts all use them.
- Barlow for UI, Barlow Semi Condensed for board labels, table heads and figures, JetBrains Mono only for machine text.
- Flat, hairline-ruled panels at 3px corners; shadows only on what floats over the floor.

## Colors

A muted green-grey shop floor framed in machine green, with four saturated lamp hues held back for state.

### Primary
- **Machine Green** (#1d3a32): the rail and the primary action are the same green. Primary buttons ("Start a workflow", "Run", "Save", "Resume"), the active chip and the active segment of a segmented filter. Hover deepens to **Machine Green Lift** (#2a5045); text on it is white (#ffffff).
- **Rail Hover / Rail Active** (#26473e / #2f5649): nav item hover and the current page. **Rail Ink** (#eaf1ed) for the wordmark and active labels, **Rail Ink Soft** (#a9c1b6) for idle nav items and the mode facts at the rail foot. Rail overlays (counts, the operator button) are white at 6-11% over the rail, not new colours.

### Secondary
- **Board Night** (#121c18): the andon board band. Cells divide on **Board Rule** (#2a3a33); hover lifts to #1b2823. Cell names in **Board Ink** (#e9f0eb), cell subtitles and line-figure units in **Board Ink Soft** (#a2b5ab).
- **Board lamps**: because the board is always dark, its lamps use brighter lit tones: **Unlit** (#2b3b34), **Running** (#38c873), **Queued** (#5592f0). A failed cell's face is **Line-Stop Red** (#c8352b), which is also the 3px rule under a stopped board. **Lit Green** (#35c06e) is the green pane of the wordmark and the live-runs count on the rail. **Amber Focus** (#f4bf4a) is the focus ring on the rail and board and the "Reconnecting" connection state.

### Tertiary
The lamp set. Each lamp has a fill, a readable ink tone for text, and (where a panel carries the state) a wash.
- **Running Green** (#1f9d52), ink #1a7240: running steps, the live token caret, the workers line in the scaling chart, occupied worker slots.
- **Signal Yellow** (#f2a900), ink #7a5000, wash #fcf0d0: awaiting approval. The "Needs you" approval row, the approval band in the step inspector, the waiting DAG node and the board cell face. Text on full yellow is **Lamp Black** (#1d1604).
- **Stop Red** (#d63b30), ink #ad2318, wash #fae4e1: failed steps and runs, failure bars in throughput, error boxes, destructive outlines.
- **Queue Blue** (#2f6fd0), ink #1d5bb8: queued steps and the queue-depth area in the scaling chart.
- **Graphite** (#5a655e): succeeded. Finished lamps, completed progress, succeeded throughput bars, finished DAG edges.

### Neutral
- **Shop Floor** (#e4e7e1): the page ground beneath every panel.
- **Work Panel** (#f9faf7): panels, default buttons, chips, DAG plates, the dialog.
- **Sunk** (#eef1ec): table heads, row hover, code and output wells, the open run form band, tags.
- **Field White** (#ffffff): text inputs, textareas and selects.
- **Hairline** (#ccd2c9) and **Strong Rule** (#a6aea3): panel and table rules; button, input and unlit lamp edges, DAG edges.
- **Ink** (#18201c), **Ink Soft** (#47524b), **Ink Faint** (#5f6a63): text, secondary text, timestamps and IDs.
- **Selected Row** (#dce8e1): the selected step in a run's step table.
- **Focus Blue** (#1d5bb8): the 2px focus ring on light surfaces.

The dark scheme (`prefers-color-scheme: dark`) remaps every role onto a near-black green floor (ground #0f1613, panel #161f1b) with lighter ink tones and darkened washes; the full map is in `.impeccable/design.json` under `extensions.darkScheme`.

### Named Rules
**The Lamp Reservation Rule.** Green, yellow, red and blue mean state and nothing else. They never decorate and never fill a primary action. Two exceptions are part of the world: the wordmark's andon tower, the one place red, yellow and green stand together at rest, and the verdict actions (Approve fills with green ink; Reject, Cancel run, Delete and Pause all execution take a red-ink outline).

**The Quiet Finish Rule.** Green means moving now. Work that has finished goes graphite, never green, so a screen of completed runs reads calm and the one running station stands out.

**The Whole Face Rule.** A board cell that needs a person lights its entire face (Signal Yellow for a gate, Line-Stop Red for a failure); every other cell carries only a small lamp. Stopping the line is the loudest state on the board: a 3px red rule across the board's foot.

## Typography

**Display Font:** none; the page title is Barlow.
**Body Font:** Barlow (with system-ui, -apple-system, Segoe UI, sans-serif)
**Label Font:** Barlow Semi Condensed (with Barlow, system-ui)
**Mono Font:** JetBrains Mono (with ui-monospace, SFMono-Regular, Consolas)

**Character:** Barlow's rounded-industrial grotesque reads like signage on a plant floor; its semi-condensed cut does the board-label work where width is tight and figures must be large. All fonts are self-hosted (Barlow 400/500/600/700, Semi Condensed 500/600, JetBrains Mono 400). The root size is 15px, and the whole UI sets tabular figures.

### Hierarchy
- **Headline** (600, 1.75rem / 26px, 1.15, -0.01em): page titles only; 1.55rem under 900px. A run's short ID rides inside at 0.6em in mono.
- **Title** (600, 1.07rem / 16px, 1.3): panel headings ("Needs you", "Runs in flight", "Execution graph"). **Title Small** (600, 0.94rem) for headings inside a panel.
- **Body** (400, 15px, 1.5): all running text. Ledes cap at 72ch, workflow descriptions at 78ch. **Body Small** (0.87rem) for meta lines, details and hints.
- **Button** (600, 0.94rem, line-height 1): buttons and tabs; 0.87rem on small buttons.
- **Board Label** (Semi Condensed 600, 0.92rem, 1.2, 0.02em): board cell names, clamped to two lines.
- **Table Head** (Semi Condensed 600, 0.8rem, 1.2, 0.07em, uppercase): table column heads; DAG stage labels use the same voice at 0.76rem.
- **Figure** (Semi Condensed 600, 1.7rem, 1.1): stat figures on Workers. **Figure Small** (1.4rem, 1.15) for figures under charts; the board's line figures sit at 1.15rem.
- **Mono** (400, 0.86em; 0.84rem/1.6 in output and logs): run and step IDs, worker IDs, feed timestamps, audit action names, logs, JSON.

### Named Rules
**The Condensed Voice Rule.** Barlow Semi Condensed speaks only for the board, table heads, figures, counts, tags and DAG sublabels. It never sets running text or a page title, and its uppercase form stays on column heads and DAG labels.

**The Machine Text Rule.** Mono is for what the machine wrote: IDs, timestamps, logs, JSON, definitions. A human-facing label never goes mono.

## Layout

A fixed two-column shell: the 228px rail on the left (sticky, full height) and a main column whose top is the sticky andon board (min 62px). Content sits below the board at 24px top, 32px sides, 64px bottom, capped at 1520px wide. Grids gap at 16px; panels pad 16px by 18px; tables pad cells 10px by 14px. Overview runs Needs you beside Runs in flight (5:7), then a full-width workflows table, then three equal panels (throughput, load vs. workers, live activity). Run detail stacks the execution graph over a two-column step table and inspector.

Breakpoints: at 1200px the three-up rows drop to two and the board wraps its line cell under the workflow cells; at 1100px run detail, I/O and the editor go single column; at 980px Overview's top row and the workflow rows stack; at 900px the rail becomes a top bar (wordmark, operator button, a horizontally scrolling nav row), the board stops being sticky, and side gutters shrink to 16px; at 640px board cells form a two-column grid, nav items stack icon over label, and station lamps shrink to 12px.

**The Frame Rule.** Rail and board are on every screen, and the board always shows every workflow plus the line cell. Pages add panels on the floor; they never replace the frame.

## Elevation & Depth

The floor is flat. Depth is tonal: ground under panel, sunk wells inside panels, the dark rail and board framing it all. Rules are 1px hairlines. Shadow exists only for things that float over the floor.

### Shadow Vocabulary
- **Float** (`box-shadow: 0 10px 28px -8px rgb(14 26 20 / 26%), 0 2px 6px rgb(14 26 20 / 10%)`): the settings dialog and toasts. The dialog backdrop dims the floor to `rgb(10 18 14 / 55%)`.

Inset 1-1.5px box-shadows draw lamp edges and the selected DAG chip's doubled border; they are outlines, not elevation.

### Named Rules
**The Flat Floor Rule.** Panels, tables, cards and the board never cast shadows. If something needs separation, give it a rule or a tone step; only a dialog or toast lifts.

## Shapes

Nearly square. Panels, buttons, inputs, chips, notices, DAG plates and toasts take 3px corners; lamps, counts, tags, code and chart keys take 2px; the progress bar 1px. The settings dialog is the one 4px corner. Station rows join square lamps with short 1.5px rules, like stations on a line. The wordmark is a drawn andon tower: red, yellow and green panes stacked on a stem.

**The Square Lamp Rule.** A lamp is a square with 2px corners: filled when lit, an inset 1.5px outline when unlit, hatched when skipped, a hollow ink outline when paused. Never a circle, never a dot, never a pill.

## Components

### Buttons
Square, firm and matter-of-fact.
- **Shape:** 3px corners, 34px tall (28px small), 13px side padding, 1px Strong Rule border, an icon leading at 7px gap.
- **Default:** Work Panel with Ink text; hover goes Sunk with an Ink Soft border.
- **Primary:** Machine Green fill, white text, hover Machine Green Lift. The page's lead action and per-row Run buttons.
- **Ghost:** transparent and borderless until hover (Sunk, hairline). Cancel, History, Edit.
- **Verdicts:** Approve fills with green ink; Reject and other destructive actions use a red-ink outline that washes red on hover.
- **States:** colour transitions at 0.15s; pressed nudges down 1px; disabled drops to 55% opacity; focus is a 2px Focus Blue ring offset 2px (Amber Focus on the rail and board).

### Chips and tags
- **Chip:** Work Panel, Strong Rule border, Ink Soft text at 0.87rem; active fills Machine Green. Used for AI prompt examples and the active workflow filter.
- **Segmented filter:** one bordered strip, hairline dividers, active segment Machine Green.
- **Tag:** Sunk with hairline, 2px corners, Semi Condensed 0.8rem: trigger type, scaling kind.
- **Count:** Semi Condensed 0.8rem in a 2px box; on the rail, Lit Green for live runs and Signal Yellow when something needs you.

### Cards / Containers
- **Corner Style:** 3px.
- **Background:** Work Panel on Shop Floor.
- **Shadow Strategy:** none (The Flat Floor Rule).
- **Border:** 1px Hairline.
- **Internal Padding:** 16px by 18px; flush panels drop padding so tables run edge to edge. A state that spans a panel (the approval gate, the open run form) is drawn as a full-width band to the panel's edges, not a box inside it.

### Inputs / Fields
- **Style:** Field White, 1px Strong Rule, 3px corners, 36px tall, 8px by 10px padding; labels above in 600 0.9rem with a 400 helper line.
- **Focus:** 2px Focus Blue outline flush to the field and a Focus Blue border.
- **Error:** red-ink text with a leading alert icon below the field; JSON definitions and code use mono.

### Navigation
The rail: wordmark, five items (Overview, Workflows, Runs, Workers, Audit log) with drawn Lucide icons, live counts at the right edge, mode facts (Claude, Scaling) and the operator button at the foot. Idle items Rail Ink Soft at 500; hover Rail Hover; active Rail Active, white, 600. Under 900px it collapses into a top bar with a scrolling nav row.

### Andon Board (signature)
The band across the top of every screen. One cell per workflow (12px lamp, name, live subtitle) and a line cell (waiting, running, slots as condensed figures) ending in Pause all / Resume, then a Live / Reconnecting connection mark. Cells that need a person sweep their whole face to Signal Yellow or Line-Stop Red over 0.45s; a stopped line adds the 3px red rule. Cells link to the waiting run or that workflow's runs.

### Status lamps and station rows (signature)
A status badge is a 9px square lamp plus a 600 0.87rem label in the state's ink tone. A run in flight is a row of 14px station lamps, one per step in order, joined by short rules. Lit lamps on the line breathe (running, 1.6s) or call (awaiting approval, 1.1s); badges in tables stay still.

### Execution graph
DAG nodes are 3px-cornered plates with a 10px lamp, a 13.5px title and a Semi Condensed uppercase sublabel (type and state). Running plates tint green and their incoming edges flow as a moving dash; waiting and failed plates take their wash; skipped and cancelled plates go dashed. Finished edges darken to graphite.

### Dialog and toasts
The settings dialog is a Work Panel at 480px max with the Float shadow. Toasts stack bottom-right on Ink with Work Panel text and a lit lamp (blue info, green success, red error), rising in over 0.22s.

### Icons
Lucide, one stroke family at 1.85 stroke width, sized 1em to the text beside them and coloured by currentColor. Step types have fixed icons: message for llm, globe for http, braces for transform, timer for delay, hand for approval.

## Do's and Don'ts

### Do:
- **Do** keep the rail and andon board on every screen, with every workflow represented as a board cell.
- **Do** reserve green, yellow, red and blue for state (The Lamp Reservation Rule) and turn finished work graphite.
- **Do** draw every status as a square lamp with 2px corners plus a label in the state's ink tone; never rely on colour alone.
- **Do** use Machine Green (#1d3a32) for the primary action, and green-ink fill or red-ink outline only for verdicts and destructive actions.
- **Do** keep panels flat, hairline-ruled and 3px-cornered on the Shop Floor ground; separate by tone and rules.
- **Do** set figures, counts and table heads in Barlow Semi Condensed with tabular numerals, and put IDs, timestamps, logs and JSON in JetBrains Mono.
- **Do** draw a state that spans a panel (approval gate, open run form) as a full-width band to the panel edges.
- **Do** honour reduced motion: lamp breathing, face sweeps and edge flow all collapse to static.

### Don't:
- **Don't** build the category default: a navy dashboard with a purple accent and a grid of KPI cards. Figures live inside the panel that owns them, next to the chart or control they explain.
- **Don't** use a lamp colour as decoration or a primary-button fill; outside the wordmark's tower, a lamp hue always names a state.
- **Don't** colour succeeded work green.
- **Don't** use circles, dots or pills for lamps, counts or tags, or round anything past the dialog's 4px.
- **Don't** add shadows to panels, tables or the board.
- **Don't** lift the uppercase table-head style above page or panel titles as a kicker or eyebrow.
- **Don't** set running text or page titles in the condensed face, or human labels in mono.
- **Don't** mix icon families or use filled or glyph icons; Lucide line icons at 1.85 stroke only.
