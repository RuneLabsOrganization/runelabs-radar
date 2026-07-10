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

## Patterns

- Top bar console (h-12, sticky, blur) — no sidebar. NavLinks: mono uppercase, phosphor
  bottom-border active state.
- Votes: quiet inline `.vote-btn` mono arrows — never boxed buttons.
- Empty states: one mono ink-4 line, no cards ("No strong signals on the scope yet — …").
- New-contact marker: small phosphor ● before timestamp/title (replaces divider).
- Tables: `.table` — mono uppercase th, grat-soft row hairlines.
