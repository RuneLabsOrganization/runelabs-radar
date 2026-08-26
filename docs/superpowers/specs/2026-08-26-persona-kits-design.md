# Persona Kits — Design Spec

**Date:** 2026-08-26
**Status:** Approved (decisions locked via brainstorming Q&A)
**Owner:** Specter / Runelabs

## Problem

Radar answers "what happened" (stories, briefs) and "what should I build" (opportunities, plans). It does not answer **"what should I actually be running, and what does it cost me."**

Three surfaces gesture at this and none deliver it:

| Surface | State |
|---|---|
| `board_entries` — "Best Right Now" | **17 rows, every `best_overall` / `best_value` / `cheapest_viable` is NULL.** Empty scaffolding, and it is the first thing the README promises. |
| `stacks` — venture playbooks | 7 rows with content, but scoped to "what do I build a SaaS with" |
| `AGENT_STACKS` — coding harness personas | Hand-seeded const, `review quarterly`, coding-only |

The gap is the **customization/integration layer**: which MCP servers and connectors to run, which BaaS/hosting backend for which use case, and the same question for non-dev roles (design, video, UGC, marketing). Users burn hours tracking releases and re-deciding this.

### Research findings that shaped the design

1. **The MCP loadout-audit space is already crowded** — AgentSeal (1,808 servers scanned, trust scores), mcp-vet, SkillsIndex (maintenance badges), McPick, one-mcp, lunar.dev. The token-bloat problem also has a converging structural fix (progressive-disclosure proxies), so an audit product is transitional. Rejected as the spine.
2. **"Best MCP servers 2026" catalogs are commodity SEO content** — seven competing listicles, all converging on the same handful of servers. Rejected.
3. **Tool fatigue is a headwind, not a tailwind.** BCG: workers using 4+ AI tools show a measurable productivity *drop*. The 2026 counter-trend is commit-and-stop-evaluating. A product selling "know the frontier" sells more of the disease; the demand is for a decided answer.
4. **No public data gives the *composition* of AI users by role** — only adoption rates within roles, and everything is saturated (devs 84–90%, marketers 91%, education 86%). Anthropic's Economic Index shows usage *dispersing* (top-10 tasks 24% → 19% of conversations, Nov 2025 → Feb 2026). Conclusion: you cannot pick the right five personas, so personas must be cheap enough to be wrong about.
5. **Radar's own `AGENT_PERSONAS` segment by spend and intensity, not role** — five of six (`budget`, `power`, `indie`, `daily`, `enterprise`) are constraint bands; only `nocoder` is role-shaped. Role does not predict the answer; job × constraint does.
6. **The quantified money pain is usage-priced infra** — documented Vercel bills of $23,000 (DDoS traffic billed as bandwidth), $4,700 (project estimated at $200), $1,141 (one viral HN post); Firebase four-figure overnight bills from a looping query; Vercel at 2.8/5 on Trustpilot. Existing comparison content is vendor-owned. There is no neutral at-your-scale cost model.
7. **Radar's corpus is currently blind to this layer** — of 2,908 stories, 11 mention MCP (all vendor announcements, all scored 0) and **zero** mention Supabase, Vercel or Firebase. No source feeds dev-infra, vendor changelogs or pricing pages. New sources are required, not optional.
8. **Evidence extraction already works, but only for creators** — all 10 extracted `pain_points` came from r/StableDiffusion. The subjective domains are where Radar already has signal.

## Goal

A **costed kit** per persona: the complete set of tools someone in a given role should be running, with a monthly total, a reason per pick, honest gaps, and a record of what changed — served on the web hub and through MCP.

## Locked decisions (from brainstorming Q&A)

| Decision | Choice |
|---|---|
| Persona structure | **Routing preset → costed kit.** A persona is ~15 lines of config: ordered `(category, task)` routes + default tier. Not a content type. |
| Segmentation axis | **Job × cost tier is the grid; persona is a preset over it.** Answers written once, shared by every persona that routes to them. |
| Fill engine | **Two engines, evidence-graded.** Benchmarks + pricing auto-fill measurable cells; scraped user reports fill subjective cells. The LLM summarizes evidence, never opines from priors. |
| Coverage | **All 11 personas from day one**, shipping partially filled with honest per-cell confidence rather than waiting for full coverage. |
| Taxonomy | **Board grid decoupled from `DOMAINS`.** Kit cells get their own `category` field; story curation keeps its six domains untouched. |
| Cell shape | **One row per `(category, task, tier)`**, superseding the three-columns-per-cell shape of `board_entries`. |
| Usage-priced infra | **Excluded from the kit total**, surfaced as a separate risk line. Real cost modelling is out of scope. |

## The grid — 9 categories, 28 cells

| Category | Tasks |
|---|---|
| `coding` | `agentic-coding` · `autocomplete` · `code-review` |
| `agentic` | `orchestration` · `browser-automation` · `computer-use` |
| `copy` | `long-form` · `social` · `ad-copy` |
| `image` | `illustration` · `photoreal` · `product-shots` |
| `video` | `text-to-video` · `image-to-video` · `avatar` |
| `ads` | `creative-generation` · `campaign-management` |
| `audio` *(new)* | `voice-tts` · `music` · `transcription` |
| `infra` *(new)* | `hosting` · `database-baas` · `auth` · `payments` |
| `connectors` *(new)* | `code-repo` · `data` · `browser` · `design` |

The first six categories and their 17 tasks are exactly the existing `board_entries` rows, migrated. Three tiers per cell → **84 picks at full coverage**.

`audio` exists because UGC and filmmaker personas cannot have a kit without voice and music picks, and `r/aivideo` signal is already arriving with nowhere to land.

## The roster — 11 personas

| Persona | Routes | Default tier |
|---|---|---|
| `indie-dev` | coding ×3 · connectors/code-repo · infra ×4 | `value` |
| `nocode-founder` | coding/agentic-coding · infra/hosting · infra/database-baas · copy/long-form · image/illustration | `cheapest` |
| `entrepreneur` | infra ×4 · coding/agentic-coding · copy/ad-copy · ads/campaign-management | `value` |
| `product-designer` | image/illustration · image/photoreal · connectors/design · coding/agentic-coding | `value` |
| `brand-designer` | image/illustration · image/product-shots · copy/social | `value` |
| `ugc-creator` | video ×3 · audio/voice-tts · audio/music · image/photoreal | `cheapest` |
| `filmmaker` | video/text-to-video · video/image-to-video · audio ×3 · image/photoreal | `best` |
| `perf-marketer` | ads ×2 · copy/ad-copy · image/product-shots · video/avatar | `value` |
| `content-marketer` | copy/long-form · copy/social · image/illustration · audio/transcription | `value` |
| `automation` | agentic ×3 · connectors/data · connectors/browser | `value` |
| `agency` | image ×3 · video ×3 · copy ×3 · ads ×2 | `best` |

Every cell is claimed by at least one persona. `image/product-shots` is written once and served to four.

## Architecture

```
sources ──▶ [evidence engine] ──▶ kit_evidence ──▶ [proposal + human approve] ──▶ kit_picks
                  │                                                                  │
       ┌──────────┴──────────┐                                                        │
  Feeder A                Feeder B                        personas.ts ──▶ [composer] ──▶ kit
  benchmark/price         user reports                      (config)          │
  (AA API, pricing)       (Reddit/HN/forums)                            web /kits/[slug]
                                                                        MCP get_kit
```

Four units with clean seams:

- **Evidence engine** — two feeders, one table. Neither writes a verdict; both write evidence rows.
- **Proposal layer** — the LLM summarizes `kit_evidence` into a draft pick. Reuses the existing `board_proposals` approve/reject flow and admin queue.
- **Composer** — a pure function `(persona, tier, overrides) → Kit`. No I/O, no LLM, no DB access beyond an injected pick lookup. Trivially unit-testable.
- **Personas** — a config module. Adding one is a PR, not a migration.

## Data model

New tables, additive. Nothing existing is dropped in the same phase it is replaced.

- **`kit_picks`** — `id`, `category`, `task`, `tier` (`best` | `value` | `cheapest`), `pick_name`, `pick_url`, `price_model` (`seat` | `usage` | `free`), `price_usd_month`, `price_note`, `risk_flag`, `why`, `skip`, `confidence` (`high` | `med` | `low`), `evidence_count`, `distinct_sources`, `verified_at`, `updated_at`. Unique on `(category, task, tier)`.
- **`kit_evidence`** — `id`, `pick_id`, `kind` (`benchmark` | `price` | `report`), `source_url`, `excerpt`, `sentiment` (`-1` | `0` | `1`), `observed_at`. The receipts behind every verdict.
- **`kit_pick_history`** — `id`, `category`, `task`, `tier`, `from_pick`, `to_pick`, `reason`, `changed_at`. Powers `whats_changed` and "since your last visit"; it is the longitudinal asset that cannot be scraped.

`kit_picks` supersedes `board_entries`: the existing board page renders from `kit_picks` filtered to the six story categories, so there is one board rather than two.

Personas live in `src/lib/kits/personas.ts` — `slug`, `label`, `blurb`, ordered `routes: Array<{ category, task }>`, `defaultTier`.

## Composer output

Illustrative render — `<pick>` stands for whatever the evidence engine has approved for that cell; the composer never hardcodes names.

```
UGC creator — cheapest viable kit                        $42/mo · 4 of 6 covered

  video/text-to-video   ▸ <pick>          $20   high   · 34 reports · verified 3d ago
  audio/voice-tts       ▸ <pick>          $12   high   · 51 reports · verified 5d ago
  audio/music           ▸ <pick>          free   med   ·  9 reports · verified 3w ago
  image/photoreal       ▸ <pick>          $10   high   · 47 reports · verified 2d ago
  video/avatar          ▸ not yet covered        —
  video/image-to-video  ▸ not yet covered        —

  ⚠ usage-priced, excluded from total: none
  ✎ changed since you last looked: text-to-video moved on Aug 14 — <reason>
```

The `Kit` object carries: `persona`, `tier`, `lines[]` (each with pick, price, why, skip, confidence, evidence_count, verified_at, risk_flag), `total_usd_month` (seat + free only), `usage_risk[]`, `gaps[]`, `changed_since[]`, and the standard `economy` receipt.

## MCP surface

| Tool | Job |
|---|---|
| `list_kits` | the persona roster |
| `get_kit({ persona, tier?, exclude? })` | the costed kit |
| `set_my_kit({ persona, tier? })` | save the caller's persona + tier (authenticated) |
| `get_my_kit()` | the caller's saved persona + overrides |
| `explain_pick({ category, task, tier })` | the evidence receipts behind one verdict |
| `whats_changed({ since })` | history diff since a date |

`get_my_kit` carries the quality-of-execution claim: an agent that reads the caller's committed stack stops re-litigating settled decisions and stops proposing the wrong backend. That saves tokens on every prompt, not only research prompts.

Web surface: `/kits` (roster) and `/kits/[persona]` (costed kit), plus the existing board page re-pointed at `kit_picks`.

## Evidence engine

**Feeder A — measurable.** Extends `src/lib/board/sync.ts`. AA API + `benchmark_snapshots` fill `coding` and `agentic` picks; a structured price scraper (no LLM) fills `price_usd_month` / `price_model` / `risk_flag` on every cell. Weekly, on the existing board-sync cron.

**Feeder B — reports.** Rides the existing ingest and extraction path, extended to emit **pick-attributed** evidence — `(tool, task, sentiment, excerpt, url)` — rather than the unattributed pain summaries it emits today. New sources required: Brave queries for audio / infra / MCP (mirroring the existing `Brave — Coding AI` rows), dev-infra subreddits, and vendor changelog + pricing feeds. Hourly with curation; graded weekly.

**Confidence is computed, not asserted:**

- `high` — ≥20 reports from ≥3 distinct sources, `verified_at` ≤ 14 days
- `med` — ≥5 reports, `verified_at` ≤ 45 days
- `low` — otherwise
- **Decay:** a pick drops one tier at 45 days and another at 90 days since `verified_at`, so staleness surfaces itself without anyone remembering to audit.

## Error handling

- An unfilled cell renders as **"not yet covered"** with no confidence. Never back-filled with a weak pick.
- Usage-priced picks are **never** included in `total_usd_month`; they appear on the risk line.
- If MiniMax is capped or down, no proposals are drafted; existing picks stand with aging confidence. Same never-blackhole principle as the story pipeline.
- A persona route pointing at a nonexistent cell is a **test failure**, not a runtime gap.

## Testing

- **Composer** — pure unit tests over fixtures; all 11 personas × 3 tiers resolve or report gaps.
- **Coverage** — every persona route resolves to an existing `(category, task)`; catches roster/grid drift.
- **Confidence grader** — table-driven, including both decay thresholds.
- **Evidence extractor** — canned scrape fixtures → expected `kit_evidence` rows.
- **Honesty regressions** — usage-priced picks excluded from totals; unfilled cells never back-filled. These are the product, so they get explicit tests.
- **Migration** — `board_entries` → `kit_picks` preserves all 17 cells.

## Rollout

Six independently shippable phases:

1. Schema + composer + personas config + MCP tools against an **empty grid** — proves the architecture end-to-end, ships "not yet covered" everywhere.
2. Migrate `board_entries` → `kit_picks`; board page renders from `kit_picks`.
3. Feeder A — benchmarks + price scraper.
4. New sources + Feeder B — pick-attributed report extraction.
5. `infra` + `connectors` cells with usage-price risk flags.
6. `kit_pick_history` + `whats_changed` + "since your last visit".

## Out of scope

- Real usage-based cost modelling (traffic inputs → bill estimate). Risk flags only.
- MCP server security scanning or trust scoring — AgentSeal and mcp-vet own that.
- Promoting `audio` / `infra` / `connectors` to story-curation `DOMAINS`.
- Stripe-backed gating of kit access; entitlements reuse the existing tier system unchanged.
