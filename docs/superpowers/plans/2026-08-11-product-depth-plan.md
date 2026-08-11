# Runelabs Radar — Product Depth Plan (Sprints A–E)

**Date:** 2026-08-11 · **Status:** Approved by Specter · **Executor:** AI agent (Hermes)
**North star:** maps and picks for the AI gold rush — digested, decision-ready intelligence for indie builders, on web + MCP.

**Premises verified against the codebase (2026-08-11):**
- Embeddings: `src/lib/embed.ts` — MiniLM-L6 (384-dim, L2-normalized), runs in worker only. Web-safe helpers in `src/lib/vec.ts` (`cosine`, `bufferToVec`, `vecToBuffer`). **Never import `lib/embed` from Next pages/components** (drags ONNX into the web bundle).
- Clustering today: `src/lib/curate/cluster.ts` — title Jaccard ≥0.55, 72h window.
- Time series: `metric_points` table (source/entity/metric/value/date) — helpers `src/lib/metrics.ts` (`seriesFor`, `recordMetrics`).
- Analytics: `src/lib/analytics.ts` — `entityDailySeries`, `topEntities`, `echoStats`, `latestPatterns`, `topicHierarchy`, etc. **Client components must never import `lib/analytics`** (pulls the DB).
- Schema: `src/lib/db/schema.ts` (21 tables). Migrations: `npm run db:generate` (drizzle-kit) → applied automatically by `openDb()` at boot.
- LLM: `chatJSON` from `src/lib/llm/minimax.ts`. Identity: `getIdentity()` from `src/lib/identity.ts` (never hardcode "Runelabs" in new prompts).
- Tests: `npm test` (139 tests) + `npm run build` must stay green after every task.
- Design system: `.interface-design/system.md` — font floor 10px, `--ink-4` decoration-only, phosphor = signal only, no shadows.

**Conventions for every task below:**
1. Work on `main` directly (solo project, CI green-gated).
2. After each task: `npm test && npm run build`. Commit per task with `feat:`/`fix:` prefix.
3. New LLM calls MUST respect the daily cap pattern used in `curate.ts` (check `llmUsage` before spending).
4. New server-side data flows to components as plain serializable props (no DB imports in client components).

---

## SPRINT A — Feed intelligence (the daily habit)

### A1. Semantic dedup (merge pass after embed)

**Problem:** Jaccard misses same-news-different-title ("OpenAI launches GPT-5.6" vs "GPT-5.6 is here"). Duplicates pollute the feed.

**Design:** new job step `mergeSimilarStories()` in `src/lib/curate/dedup.ts`, called from `runEmbed` (worker) AFTER embeddings are written. Stories are only embedded when curated, so the pass runs on curated stories created in the last 72h that have embeddings.

**Spec:**
1. Load curated stories with `embedding IS NOT NULL`, `created_at >= now-72h`.
2. Pairwise cosine (Float32Array dot — vectors are normalized). O(n²) fine: ~100 stories.
3. Pair cosine ≥ **0.87** → merge younger into older:
   - `UPDATE items SET story_id = older WHERE story_id = younger`
   - `UPDATE votes SET story_id = older WHERE story_id = younger` — **skip conflicts** (same user voted both): delete the younger's conflicting vote rows first (`DELETE FROM votes WHERE story_id = younger AND user_id IN (SELECT user_id FROM votes WHERE story_id = older)`).
   - If younger has `top_score > older.top_score`, copy the higher score/domain_scores/tldr/why_it_matters to older (better curated data wins).
   - `DELETE FROM stories WHERE id = younger`.
4. Return `{ pairs, merged }` for job stats. Log each merge (title pairs) to console.
5. Threshold 0.87 is conservative (normalized MiniLM: true dupes land 0.90+, related-but-distinct ~0.75-0.85). Add a unit test with synthetic vectors: near-identical titles merge, different stories don't.

**Files:** NEW `src/lib/curate/dedup.ts`; EDIT `src/lib/embed.ts` (call merge pass at end of `runEmbed`, stats include merges); NEW test in `tests/dedup.test.ts` (use in-memory DB pattern from `tests/helpers/db.ts`).
**AC:** `npm test` green incl. new test; `npm run job -- embed` on dev DB reports `merged: N`; feed shows no visible dupes.

### A2. "Why am I seeing this" (score reasoning)

**Design:** curation prompt gains one field; schema gains one column; SignalEntry renders it.

**Spec:**
1. **Migration:** `ALTER TABLE stories ADD COLUMN why_shown TEXT` via drizzle-kit: add `whyShown: text('why_shown')` to the stories table in `schema.ts`, run `npm run db:generate`.
2. **Prompt** (`src/lib/curate/curate.ts` buildCurationPrompts): append to the JSON instruction:
   `"- \"why_shown\": 3-8 words naming the tracked interest this story serves (e.g. \"cheaper coding agents\", \"video gen quality jump\"). No filler."`
   and add `,\"why_shown\":\"...\"` to the JSON shape line. Parse + persist on the story (validate: string, max 80 chars, else null).
3. **UI:** `SignalEntry.tsx` — under the why-it-matters block, one readout line: `scoped because · {whyShown}` in `--ink-4`, phosphor `·` separator. Only when non-null. Also add to `FeedEntry` plumbing (hub page `toFeedEntry`) and the story page.
**AC:** curate on dev DB populates `why_shown` for new stories; feed + story page render it; build+tests green.

### A3. Sector digest (2-line weekly summary per domain)

**Design:** daily job writes one digest per domain into a new table; domain page shows it on top.

**Spec:**
1. **Schema:** new table `domain_digests`: `domain TEXT NOT NULL`, `date TEXT NOT NULL` (YYYY-MM-DD), `text TEXT NOT NULL`, PK `(domain, date)`. Generate migration.
2. **Generation:** extend `runBrief` (`src/lib/brief/brief.ts`) — after the main brief, ONE extra `chatJSON` call: input = per-domain top 5 stories of the last 72h (title+tldr+score). Output: `{"coding":"…","copy":"…",…}` each ≤ 240 chars, analytical not summary ("video gen is consolidating around…"). Respect daily cap: skip digests if cap reached (main brief has priority). Upsert per (domain, date).
3. **UI:** `domain/[slug]/page.tsx` — below the H1, a card-less block: readout `sector digest · {date}` + text in `--ink-2`, 13.5px.
**AC:** brief job writes 6 digests; domain pages render them; cap-respecting skip path tested.

---

## SPRINT B — Charts: decision in 3 seconds + shareable

### B1. PNG export with watermark (citation flywheel)

**Design:** pure client util — serialize the chart's SVG → canvas → PNG → clipboard/download. Watermark = product name + site URL.

**Spec:**
1. NEW `src/lib/export-png.ts` (client-safe, no deps):
   - `exportSvgAsPng(svgEl: SVGSVGElement, opts: { title: string; filename: string })`.
   - Clone node, inline computed styles for critical attrs (fill/stroke/font-family are attributes already in these charts — verify per chart), add background rect `--scope-1`, add bottom bar: `${title} · ${productName} · ${siteUrl}` mono 10px `--ink-3`.
   - `XMLSerializer` → `Blob` → objectURL → `Image` → canvas 2× scale → `toBlob('image/png')` → `navigator.clipboard.write([new ClipboardItem(...)])` with download fallback (`a[download]`).
2. NEW `src/components/ExportButton.tsx` (client): mono readout button `png ⤓`, `title="copy chart as PNG"`. Props: `targetId` (DOM id of the wrapper div), `title`, `filename`.
3. Wire into `ModelScatter`, `ActivityTrace`, `FrontierTimeline`, `ValueBars`, `ForecastChart`: wrap chart in `<div id={...}>` and render ExportButton top-right of the section (absolute positioned, opacity 0.5 → 1 on hover).
**AC:** clicking export on /board and / downloads a legible PNG with watermark (verify manually in browser); no new npm deps.

### B2. ModelScatter polish + time-lapse

**Spec:**
1. Quadrant labels on the scatter: faint mono 10px `--ink-4` text at 4 corners: `cheap + smart` (top-left), `premium` (top-right), `budget` (bottom-left), `avoid` (bottom-right).
2. Hover: richer tooltip card — model name, org, intelligence, blended price, speed if present. (Extend existing tooltip.)
3. **Time-lapse:** `metric_points` has daily `aa` rows (`intelligence`, `price_blended` per model). Add metric toggle `play` button: steps day-by-day over last 30 days (`seriesFor('aa', model, metric, 30)`), re-positions points with 300ms CSS transition. Server component passes the full per-model-per-day matrix as a prop (compact: `{model, points: [[date, intel, price], …]}`); client steps through it. Play → pause on click; loop.
**Files:** `src/components/ModelScatter.tsx`, `src/app/(hub)/board/page.tsx` (data plumbing).
**AC:** play animates through ≥10 days without layout jump; labels don't collide more than before; mobile: play hidden (`hidden sm:block`) if too cramped.

### B3. ActivityTrace: anomaly markers + weekend shading

**Spec:**
1. Weekend shading: for each Sat/Sun in the 14-day window, a `grat-soft` vertical band (SVG rect, opacity 0.5).
2. Anomaly markers: `latestPatterns(6)` subjects that are sector-spikes → map to (date, domain) → phosphor diamond at that point on the polyline. Plumb from home page (already loads `noticed`).
**AC:** visual check: weekends shaded, spike days marked.

---

## SPRINT C — Data science: the defensible asset

### C1. Hindsight re-score (calibration flywheel)

**Design:** new job `rescore` (worker, daily after science): stories 36–60h old get a hindsight score 0–100 computed from *observed* signals — no LLM needed.

**Spec:**
1. **Schema:** `stories` += `hindsight INTEGER` (nullable), `hindsight_at INTEGER` (timestamp, nullable). Migration.
2. **Signals per story:**
   - Entity echo: each extracted entity's mention count in stories created AFTER this story (same entities, other stories) — from `stories.entities` JSON.
   - Launch materialization: any `launches` row whose title shares an entity with the story, launched after story creation (+25).
   - Follow-through: count of later stories with title Jaccard 0.3–0.55 (developments, not dupes).
   - Team votes: up−down net (×5, capped ±15).
3. Score = clamp(weighted sum, 0, 100). Weights documented in code comment. Write `hindsight`, `hindsight_at`.
4. Register job in `worker/run.ts` jobs map + `worker/index.ts` schedule (daily 08:00).
**AC:** `npm run job -- rescore` populates values on dev DB; unit test with fabricated stories.

### C2. Accuracy page (`/accuracy`) — public track record

**Design:** the moat made visible. Two panels:
1. **Score calibration:** bucket curated+hindsighted stories by topScore (40-59, 60-79, 80-100); per bucket show mean hindsight. Bar list pattern (like ValueBars). Caption: "hindsight = what actually mattered 2 days later (echoes, launches, follow-ups)".
2. **Forecast vs realized:** `forecastFrontierPrice()` prediction history vs realized `metric_points` — if forecast history isn't stored, START storing it: `forecasts` table (date, metric, predicted, horizon_days). Nightly job appends; page shows predicted-vs-actual overlay once data exists, "collecting data since {date}" until then.
**Files:** NEW `src/app/(hub)/accuracy/page.tsx`, NEW `src/lib/science/accuracy.ts`; nav link `Accuracy`.
**AC:** page renders with dev data; empty state honest when no hindsight yet.

### C3. Hype-vs-substance index

**Design:** per top entity: `hype = mentions_7d / (1 + artifacts_7d)` where artifacts = GitHub release events + HF download delta (both in `metric_points` via velocity job; entities matched by name, case-insensitive).
1. NEW `src/lib/science/hype.ts`: `hypeIndex(): { name, mentions, artifacts, ratio }[]` — ratio normalized 0–100 (log scale, document formula).
2. UI: `EntityBars` gains an optional `hype` badge per entity: `H/S 73` — amber when ratio >70, phosphor <30, ink-4 otherwise. Wire on home (already loads `topEntities`).
**AC:** badge renders on dev DB; formula unit-tested.

### C4. Weekday-aware anomaly baseline

**Spec:** read `src/lib/science/anomaly.ts`; wherever a rolling mean/threshold is computed for daily counts, compute baseline per weekday (e.g. compare Saturday to last 4 Saturdays). Keep the existing flat baseline as fallback when <4 same-weekday samples. Unit test: synthetic weekend dip no longer flags as anomaly; real spike still flags.
**AC:** science tests green + new weekday test.

---

## SPRINT D — UX depth

### D1. Search (SQLite FTS5)

**Spec:**
1. Migration: `CREATE VIRTUAL TABLE stories_fts USING fts5(title, tldr, why_it_matters, content='stories', content_rowid='id')` + triggers `stories_ai/au/ad` (after insert/update/delete). Backfill in the same migration (`INSERT INTO stories_fts(stories_fts) VALUES('rebuild')`).
2. NEW `src/app/(hub)/search/page.tsx`: `?q=` → FTS query `stories_fts MATCH ?` with `bm25` ranking, scope to curated, 50 max. Input + results (reuse ScanRow). Escape user input (quote each token; strip special FTS chars).
3. Header: search icon link (mono `search`) before the user cluster; keyboard `/` focuses it (client component on search page reads keydown on hub pages — add tiny `SearchShortcut` client comp in hub layout).
**AC:** search "comfyui" on dev DB returns the ComfyUI story; injection attempts (`" OR 1=1`) return empty, not 500.

### D2. "New since your visit" for anonymous

**Spec:** `SignalEntry`/`ScanRow` already receive `isNew` (logged users). For anonymous: server renders `data-created={story.createdAt epoch}` on each entry; NEW tiny client comp `AnonFresh.tsx` mounted on the feed: reads `localStorage['radar_last_visit']`, adds a phosphor `●` to entries newer than it, then sets it to now. Zero server changes.
**AC:** second visit in incognito shows no dots; after new story arrives (or localStorage cleared + older date), dots appear.

### D3. Nav clarity rename

`Briefing → Today`, `Brief → Daily Brief`, `Log → Changelog`. Labels only (`NavLinks.tsx buildLinks`). Also update the hub page H1 "Briefing" → "Today".
**AC:** visual check; no other references break (grep for 'Briefing' after).

---

## SPRINT E — Depth pages

### E1. Entity watch pages (`/entity/[name]`)

**Design:** auto-generated SEO pages per tracked entity.
1. Route `src/app/(hub)/entity/[name]/page.tsx`. Slug = lowercase, spaces→`-`. Lookup: case-insensitive match against `stories.entities` JSON (store/lookup normalized). Unknown name → notFound.
2. Content: name + kind; 14-day mention series (reuse `entityDailySeries` → MiniTrend chart); hype badge (C3); related metric series from `metric_points` (github stars / hf downloads when entity matches); list of stories mentioning it (title→/story/[id], score, timeAgo), 20 max.
3. `generateMetadata`: `{name} — watch · {productName}` + description with mention count.
4. Sitemap: add top 200 entities by 7d mentions.
5. Links: `EntityBars` names become links to the watch page; story page entity chips link too.
**AC:** `/entity/comfyui` renders on dev DB with series + stories; in sitemap.

### E2. BubbleMap drill-down

**Spec:** `BubbleMap.tsx` — click a category bubble → zoom to its children (scale transform to the bubble's bounds, fade others); click child → list its stories in a side panel (title → /story/[id]). Breadcrumb readout `topic map / {category}` to reset. Keep the existing pack layout (d3-hierarchy); implement zoom with the standard d3 zoom-to-view pattern.
**AC:** click drills in, stories listed, reset works; mobile: side panel becomes bottom sheet (full-width, max-h 50%).

---

## Execution order & commits

```
A1 dedup → A2 why_shown → A3 digests → B1 png export → B2 scatter → B3 trace
→ C1 hindsight → C2 accuracy → C3 hype → C4 weekday → D1 search → D2 anon-fresh
→ D3 rename → E1 watch pages → E2 drill-down
```
One commit per task. Deploy to Hetzner after each sprint (tar sync + `docker compose up -d --build`).

## Kill criteria / honesty notes

- If semantic merge shows false positives on real data (wrong merges), raise threshold to 0.90 — check merge logs before deploying A1 widely.
- Hindsight weights are heuristic v1 — document as such; the accuracy page is what justifies tuning them later.
- FTS5 in better-sqlite3: bundled and enabled by default (verify with a quick `SELECT fts5_source_id()` — if missing, fall back to `LIKE` search and note it).
