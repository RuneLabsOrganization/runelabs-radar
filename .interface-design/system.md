# Runelabs Radar — Design System

**Direction:** A radar operator's scope console. The product is a radar for AI news; the
interface is the instrument. Calm, precise, editorial — a 5-minute morning briefing, not a
social feed. Color means signal, never decoration.

## Tokens (globals.css)

- **Surfaces (scope glass):** `--scope-0` canvas → `--scope-1` panel → `--scope-2` raised;
  `--scope-inset` for inputs (inset, darker). Whisper-quiet elevation jumps.
- **Borders (graticule):** `--grat-soft` / `--grat` / `--grat-strong` — low-opacity blue-gray
  rgba; hairlines that disappear unless you look.
- **Ink:** 4 levels `--ink` → `--ink-4`.
- **Signal:** `--phosphor` (green-teal) is the ONLY accent; `--amber` warnings; `--alert` faults.
- **Sector ticks:** `--sector-*` — six desaturated hues used ONLY as 2px identification ticks.
- Legacy aliases (`--bg`, `--panel`, `--accent`, `--d-*`…) map old names onto these.

## Typography

- **Readouts** (labels, timestamps, scores, nav, section headers): `--font-readout`
  (ui-monospace stack), 10–11px, uppercase, letter-spacing 0.08–0.16em → `.readout` / `.mono`.
- **Prose** (titles, TLDRs): system sans; titles 15px/600/-0.01em, body 13–13.5px relaxed.

## Depth & shape

Borders-only (no shadows). Radius: 3–4px controls, 5–6px panels. Spacing base 4px.
Content column: 760px (reading pages), 860px (tables/admin).

## Signature elements

- **SignalMeter** — 4 ascending bars, phosphor-lit by score (80+=4 bars … <40=1). On every contact.
- **Feed split** (`src/lib/feed.ts`): Top signals (score ≥70, max 8, full entries) → Scan log
  (≥40, one-line rows, newest first) → archive count line. Never an undifferentiated card wall.
- **SectorStrip** — six sector cells (tick, count, phosphor `+fresh`), doubles as domain nav.
- **SectionHeader** — readout label ── hairline ── count.
- **Sweep status** — top-bar readout dot: phosphor nominal, amber stale.
- **Why-it-matters** — phosphor left-border callout inside entries, not a filled panel.

## Analytics deck (briefing)

- **ActivityTrace** — hand-rolled SVG (no chart lib): graticule grid, total volume as
  grat-soft area, sector polylines in `--sector-*`, hover crosshair + mono tooltip
  (scope-2 panel), clickable legend ticks (aria-pressed, 0.35 opacity when hidden).
  `focus` prop pre-isolates one sector (domain pages).
- **EntityBars** — mono name + 3px phosphor bar + count + delta (`new` / `+n` phosphor,
  `-n` ink-4). Data: entities extracted at curation, counted once per story.
- **AnalystNotes** — direction glyph (▲ phosphor / ▼ alert / ◆ amber) + bold headline +
  ink-2 detail + optional sector tick. Written daily by the brief job.
- Momentum: w/w % in SectorStrip cells (phosphor positive, ink-4 negative; hidden when
  no prior-week data). Charts stay ≤180px tall; briefing container is 860px.
- **ModelScatter** (board) — AA quality-vs-price: log-price x-axis, pareto frontier
  phosphor-lit + labeled + faint connective trace, metric toggle (intelligence/coding),
  mono attribution line ("data: Artificial Analysis"). Pure math lives in client-safe
  `lib/pareto.ts` — client components must NEVER import `lib/analytics` (it pulls the DB).
- **Bar-list pattern** (TaskCostExplorer, ValueBars, EloBars, EntityBars): name row
  (mono 11px, org muted) + right-aligned mono value, 3px track (`--grat-soft`) with
  phosphor/grat-strong fill. Winner/frontier = phosphor. Caption line states
  assumptions (e.g. token budgets from `lib/costs.ts` TASK_ARCHETYPES).
- **Ops deck** (admin): PipelineFunnel (stage bars + conversion %), LlmBudget (gauge,
  amber ≥60% / alert ≥90%, 14d columns), JobTimeline (7px status blocks: ok phosphor
  0.45, error alert, running amber), SourceVolume (100×16 sparkline polylines).

## Identity layer (three.js)

- **RadarField** — WebGL scope backdrop: polar graticule, 380 sweep-lit contacts
  (additive shader points), rotating beam, mouse parallax. Rules: DPR ≤1.5,
  `preserveDrawingBuffer: true` (capture interop), static frame under
  prefers-reduced-motion, RAF paused when hidden, always `pointer-events: none`.
  Intensity discipline: **0.5 login / 0.06 behind data pages** — any louder and the
  blips read as stray datapoints under charts. Loaded via RadarBackdrop
  (next/dynamic, ssr:false) so three.js never blocks the critical path.

## Motion

`bar-grow` (scaleX, 700ms cubic-bezier(0.22,1,0.36,1)) on every `.anim-bar` chart
fill — re-key the fill element to replay on data switch; `fade-up` (`.anim-in`) for
cards; `.hover-raise` (−1px) on sector cells; `.row-hover` tint on dense rows.
All guarded by prefers-reduced-motion. Frontier chart labels alternate above/below
the point to avoid collisions in tight clusters.

## Patterns

- Top bar console (h-12, sticky, blur) — no sidebar. NavLinks: mono uppercase, phosphor
  bottom-border active state.
- Votes: quiet inline `.vote-btn` mono arrows — never boxed buttons.
- Empty states: one mono ink-4 line, no cards ("No strong signals on the scope yet — …").
- New-contact marker: small phosphor ● before timestamp/title (replaces divider).
- Tables: `.table` — mono uppercase th, grat-soft row hairlines.
