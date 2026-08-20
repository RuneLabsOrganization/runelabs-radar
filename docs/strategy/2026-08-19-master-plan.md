# Runelabs Radar — Master Plan

> **This is the single canonical plan.** It fuses and supersedes `2026-08-19-competitive-strategy-vs-artificial-analysis.md` (deleted; its reference content lives in §2) and the session-side MCP plan. Strategy in Part 1, executable specs in Part 2.
>
> **Status (2026-08-19)**: MCP-first product SHIPPED and live at radar.runelabs.org — 26 tools, `radar://` resources, 5 workflow prompts, OAuth 2.1 (hub = authorization server), plan engine, summary+next envelope, `/connect` install page, progress notifications, CJK-leak sanitization. Commits `948d222`, `8070b61`, `f14e9cf`, `574254d` on `main`. Verification: 337 unit tests, live suite 44/44 (public endpoint), Playwright OAuth e2e 31/31.
>
> **Forward plan**: Phases 6-11 in Part 2 — first-party data, margin observability, artifact monetization, idea-engine overhaul, data-surface parity, persona expansion.
>
> **Status (2026-08-20)**: Wave 1 data foundations LIVE — `llm_calls` metering on every chatJSON call (7a/7b/7c), provider-pricing (6a) + open-bench/openrouter (6b) weekly ingests registered and deployed. 367 unit tests green. Commits `6adcd47`..`d84487c`. From here prices, benchmarks, and per-call costs accumulate for Waves 2+.
>
> **Status (2026-08-20, Wave 2)**: Readers + surfaces LIVE — merged first-party market reader (6d; AA now fallback-only), Radar Score running dark nightly with `aa_divergence` calibration logging (6e; `RADAR_SCORE_CONSUMERS` flips consumers after 2-4 weeks of low divergence), `/admin/usage` margin dashboard + admin-scoped `get_usage` (7d/7e; 27 tools), entitlements + monthly plan-quota enforcement for authed users (8a; anonymous path unchanged). 429 unit tests + live 44/44 + oauth-e2e 31/31 green. Commits `ba6d51a`, `0356eaf`, `17ec315`. **Watch**: first nightly science run after this deploy writes `radar-speed` + `radar-score` series — check `job_runs` stats for the science job tomorrow.
>
> **Status (2026-08-20, Wave 3)**: Idea engine LIVE — multi-role debates (9a; Advocate → Skeptic → Market Realist → Judge, auto-run on top-2 new opportunities daily, transcripts on dossiers), `debate_idea` + `scout_opportunities` tools (9b/9c; 29 tools total, per-caller daily caps), anti-homogeneity ordering (9d; sector quota + per-caller salting + exploration slot), crowdedness signal (9e; `plan_runs` + `exploring_count` + ranking penalty), `/pricing` page (8b). 451 unit tests green. Commits `25c7832`..`b98daad`. **`MCP_AUTH_REQUIRED=true` flipped on the box** — anonymous MCP access is off; OAuth via `/connect` is the only path in; entitlements default to free (3 plans/mo, manual grants until 8c). 9f personalization stays gated on Phase 8 data.
>
> **Status (2026-08-20, Wave 4)**: Parity + distribution LIVE — `/metrics` explorer + daily public dataset dump (`/api/dataset`), coding-agent plan tracker (`/agent-plans`), weekly State of the Builder Market report (`/reports` + `get_weekly_report`, 30 tools), public read-only `/api/v1/*` (IP-limited), trust page with freshness metric (`/accuracy`), `/connect` health check + 5-minute first-plan guide. 505 unit tests green. Commits `f141bd3`..`c7c242b`. **Note**: live suite against prod now needs `SMOKE_TOKEN=<bearer>` (mint a short-lived `oauth_tokens` row). Phase 11 personas remain gated on Phase 7 margin data.

---

# Part 1 — Strategy

## 1.1 What we are

Agent-native AI intelligence for builders. The MCP server is the product: an agent can browse signals, launches, board picks, stacks, pains, patterns, market prices, forecasts, entities, comps — and run the flagship **opportunity → dossier → execution plan** flow that a local coding agent executes end-to-end. The web hub is the back office, showcase, and (soon) billing surface.

## 1.2 Competitive frame (vs Artificial Analysis — reference inventory)

AA is the **benchmark authority**: self-run benchmarks (Intelligence Index, proprietary evals, arenas, provider analysis), data playground/API/reports, at **$417/mo per seat** (yearly) with no free trial. ~4.4M visits/mo (July 2026, +54% MoM), ~$1-5M ARR est., tiny team, ~$250K raised. Revenue-funded proof that enterprises pay for AI decision data.

**What AA does NOT have**: no official MCP/agent surface, no opportunity layer, no pain mining, no execution plans, no personalization, no accuracy self-tracking, no debate/validation workflow. Pure data → human eyeballs.

**Positioning**: *AA is the Bloomberg terminal for model performance; Radar is the copilot for people building businesses with those models.* Target: indie founders, solopreneurs, small product teams. *"AA tells you which model wins. Radar tells you what to build — and hands your agent the plan."* We undercut 10-20× on price and own the discover → debate → decide → plan → build loop.

**Deliberately not chasing**: proprietary benchmark suites, arenas, hardware/inference benchmarking, compute-market forecasting, enterprise services (workshops/advisory) — years + millions + trust moat, or simply not our game. Our own micro-eval (Phase 6c) is deliberately modest. **Second-pass gap review (2026-08-19, against the live AA site)**: speed data, cache pricing, media arenas, provider-level throughput, agent-plan tracking, and trust-page freshness/independence assets were missing — all now folded into Phases 6/7/8/10 as first-party-cheap items.

## 1.3 Hard rules (user-locked decisions)

1. **MCP is the product.** Agents are the primary audience.
2. **No dataset copying/republication.** AA's terms treat republication as redistribution; Mobbin's library is copyrighted. We build first-party pipelines instead — most already exist.
3. **No BYOK. No raw-token resale.** We offer limits and take our margin on top of LLM usage — packaged as **artifact pricing** (plans/credits), not metered tokens. The user's unit is a plan or a debate; our unit economics are enforced by Phase 7 observability.
4. **Margin observability precedes monetization.** No pricing launch until per-call cost tracking + the admin dashboard prove what an artifact costs.
5. **Solopreneur vertical first.** Persona expansion (designers, devs, …) only after the dashboard proves per-vertical margins.
6. **Self-host stays source-available** (BSL 1.1) and fully capable; we monetize the hosted convenience, budget, and network effects (crowdedness, personalization).

## 1.4 Unit economics (measured + researched, 2026-08-19)

**Measured production baseline** (last 14 days): 122–258 LLM calls/day (avg ~196), ~5,900/mo; ~2.1k in / ~1.5k out tokens per call. At MiniMax-M2 list ($0.30/M in, $1.20/M out — [MiniMax token-plan docs](https://platform.minimax.io/docs/guides/pricing-token-plan), [china-llm](https://china-llm.com/blog/minimax-m2-pricing)) the **entire always-on pipeline ≈ $0.47/day ≈ $14/mo — flat, independent of users**.

**Per-artifact cost**: execution plan ≈ **$0.03–0.05** (6-7 calls); opportunity brief ≈ $0.005; daily brief ≈ $0.005-0.01. MCP reads hit SQLite: **$0**.

**Subscription capacity**: current $10 legacy Coding Plan (Token Plan tiers: Plus $20 / Max $50 / Ultra $120; 5-hour rolling + weekly windows, quota deducts at list price). Empirically we use a fraction of it. Conservative model (~$60/mo list-value quota): ~$45/mo headroom ≈ **~1,100 plan generations/mo ≈ 35 Builder or ~22 Factory users on $10**. Binding constraint is the 5-hour window under bursts — mitigate: queue generate_plan, nightly pre-generation of top opportunities (cache hits = $0), then tier up.

**Scenarios** (LLM+sub COGS; Hetzner infra ~$10-20/mo separate):
- 25 users (20 Builder $19 / 5 Factory $49): **$625 MRR / $7.5k ARR**, ~97% margin — fits the $10 plan.
- 100 users (70/30): **$2,800 MRR / $33.6k ARR** — ~5,100 plans ≈ $204 PAYG-equiv → Ultra $120 → ~95% margin.
- 500 users (350/150): **$14k MRR / $168k ARR** — PAYG ~$1,020 → ~93% margin.

**Subscription → PAYG migration triggers**: weekly-window 429s in `job_runs`; 5h-window queue latency on `generate_plan`; PAYG-equivalent ≈ next tier price (~5k plans/mo → Ultra; ~10-15k → PAYG wins). MiniMax Credits (1,000=$1) bridge spikes. **ToS flag**: subscription keys are marketed for agent/coding tools — multi-tenant SaaS backend use is a gray zone; verify acceptable use before charging on subscription quota. Clean scale path = PAYG or Team plan.

---

# Part 2 — Execution specs

*Each phase is self-contained for a contextless agent: goal, exact files, schema, snippets, checklist, verification. Conventions in §3.1 apply everywhere.*

## 3.1 Standing conventions (read first)

- **Stack**: Next.js 15 (App Router, `src/app`), SQLite WAL via drizzle-orm + better-sqlite3, worker = node-cron (`worker/index.ts`), MCP server (`mcp/`, streamable HTTP, stateless). TS strict-ish; ESM-style imports with `@/` = `src/`.
- **Migrations**: edit `src/lib/db/schema.ts`, then `npm run db:generate` (drizzle-kit → `drizzle/00XX_*.sql`). All processes auto-migrate at boot (`openDb` in `src/lib/db/index.ts`).
- **Tests**: `npx vitest run` (currently 337). Test DB helper: `useTestDb()` in `tests/helpers/db.ts` (in-memory, migrated). New lib logic gets a test file in `tests/`.
- **LLM calls**: always via `chatJSON(system, user, opts?)` in `src/lib/llm/minimax.ts` (daily cap + token accounting live there). All untrusted text into prompts via `promptLine()`; all LLM output for English artifacts through `stripCjkDeep()` — both in `src/lib/prompt-hygiene.ts`.
- **MCP tool pattern**: see `mcp/tools/signals.ts` (exemplar). Every structured response uses `respond(data, { summary, next })` from `mcp/lib/payload.ts` and spreads `...envelopeSchema` into the zod `outputSchema`. Tools register in `mcp/build.ts`.
- **Worker job pattern**: export `runX()` from `src/lib/<area>/x.ts`, register in `worker/index.ts` as `cron.schedule('<cron>', () => void withJobRun('<name>', runX))`, ad-hoc run via `worker/run.ts` (`npm run job -- <name>`).
- **Verification before any commit**: `npx vitest run`, `npx tsc --noEmit` (4 known pre-existing errors in `tests/adapters.test.ts` + `tests/feed.test.ts` — not yours), `npm run build`.
- **Deploy** (until box↔GitHub auth is fixed): commit → push → `git bundle create /tmp/r.bundle main` → `scp` to box → on box `cd /opt/runelabs-radar && git fetch /tmp/r.bundle main && git merge --ff-only FETCH_HEAD && docker compose build && docker compose up -d`.

## Phase 6 — First-party data independence

**Goal**: board sync, market tools, and plan grounding run on our own series; AA becomes optional fallback. No AA-sourced series is ever publicly exposed.

### 6a. Provider price pipeline
- **Create** `src/lib/ingest/pricing.ts`: `export async function runPricingSync(): Promise<{ recorded: number }>`.
  - Static provider table (in-file const): OpenAI, Anthropic, Google, DeepSeek, Moonshot, MiniMax, Qwen — each with a pricing-page URL + a deterministic parser (regex/HTML-table scrape via `fetchJson`/`fetchText` patterns in `src/lib/ingest/adapters/shared.ts`). Manual-fallback map for unparseable pages.
  - Write via `recordMetrics()` (`src/lib/metrics.ts`): `{ source: 'provider-pricing', entity: <model>, metric: 'price_in' | 'price_out' | 'price_cache_hit', value }` — lands in `metric_points` (schema: `src/lib/db/schema.ts:163`). Cache-hit/write prices are a first-class series (AA segments them; builders' real bills depend on them).
  - Keep the raw page/snapshot in `benchmarkSnapshots` (`source: 'pricing-<provider>'`) for audit.
- **Register** in `worker/index.ts`: weekly, e.g. `cron.schedule('10 5 * * 2', () => void withJobRun('pricing', runPricingSync))`, and in `worker/run.ts` job map.
- [x] implement pricing.ts + worker registration + `npm run job -- pricing` smoke ✅ 2026-08-20 (`47d5f4c`, `d84487c`; first live smoke: 29 points, 6/7 providers on fallback map — expected, JS-rendered pages)
- [x] `tests/pricing.test.ts`: parsers against fixture HTML in `tests/fixtures/` (15 tests)

### 6b. Open benchmark + media + provider ingest
- **Create** `src/lib/ingest/openbench.ts`: `runOpenBenchSync()` pulling capability scores from public sources (LMArena exports, official model cards) into `metric_points` (`source: 'open-bench'`, `metric: 'intelligence' | 'elo'`). Weekly cron, same pattern as 6a.
- Media coverage matters to us (two of six domains are image/video): include open image/video arena exports where published; speech only if a clean public source exists.
- Optional, cheap: per-provider throughput/price for major open models from OpenRouter's public model endpoints (`source: 'openrouter'`) — the builder-facing slice of AA's provider-level analysis.
- [x] implement + register + fixture tests ✅ 2026-08-20 (`b86cc76`, `d84487c`; first live smoke: 818 openrouter + 45 open-bench points; LiveBench live export wired, seed table is the primary path; extra metric keys `image_elo`/`video_elo`/`livebench` — 6d reader must know)

### 6c. Radar micro-eval (stretch; do 6a/6b first)
- **Create** `src/lib/science/eval.ts`: `runRadarEval()` — a small fixed suite (~12 tasks: 4 coding, 4 extraction, 4 copy) run weekly against the top ~8 models via `chatJSON`-compatible provider calls; deterministic graders (exact-match/regex/rubric-lite); scores → `metric_points` (`source: 'radar-eval'`).
- [ ] suite defined in-file as data; one retry; failures logged not fatal

### 6d. Rewire consumers to first-party series
- `src/lib/analytics.ts` `aaModels()` (~line 313): add a first-party reader that assembles the `AaModel` shape from `metric_points` (`provider-pricing` + `open-bench` series); use AA snapshot only when first-party coverage for a model is missing AND `AA_API_KEY` set.
- `src/lib/board/sync.ts` (`aaPromptLines`) and `src/lib/plans/generate.ts` (market grounding block): consume the merged reader — no call-site shape changes.
- `mcp/tools/market.ts` `get_market_models`: payload rows gain `source: 'first_party' | 'artificial_analysis'`.
- **Sunset rule** (documented in code comment on the reader): when first-party covers ≥90% of board-referenced models for 2 consecutive weekly syncs, AA defaults to disabled.
- [x] merged reader + tests (`tests/market-firstparty.test.ts`: seed metric_points, assert shape + fallback) ✅ 2026-08-20 (`ba6d51a`; `marketModels()` in analytics.ts — AA snapshot only for uncovered models; fallback gate is snapshot-existence, not API-key, so the seeded-snapshot suite stays green)
- [x] live check: `npx tsx mcp/test/live.ts` still 44/44 ✅ post-deploy

### 6e. Radar Score — our own composite, feeding the sorting algo

**Why**: every ranking surface (board picks, `get_market_models` sort, plan grounding) currently leans on AA's intelligence number. We need our own defensible composite computed only from series we own, versioned and charted over time.

- **Create** `src/lib/science/score.ts`: `export function computeRadarScores(date = utcDay()): { scored: number }`.
  - **Inputs** (all from `metric_points` + our story graph): `capability` (open-bench intelligence, blended with `radar-eval` when present), `price` (`provider-pricing` blended in/out), `speed` (`radar-speed` from `llm_calls.durationMs`, Phase 7), `momentum` (mention-heat delta for the model entity from `entityDailySeries`/`topEntities` in `src/lib/analytics.ts` — models the conversation is moving toward).
  - **Math**: min-max or percentile-normalize each input within the day's cohort; composite = weighted sum, weights in one tunable const with a comment:
    ```ts
    // v1 weights — tunable after calibration (§6e checklist)
    const WEIGHTS = { capability: 0.45, costEfficiency: 0.25, speed: 0.15, momentum: 0.15 } as const;
    // costEfficiency = capability / max(price_blended, floor) — floored to avoid div-by-zero on free models
    ```
  - **Output**: per model write `metric_points` rows (`source: 'radar-score'`, `metric: 'composite' | 'capability' | 'cost_efficiency' | 'speed' | 'momentum'`) — sub-scores stored separately so the explorer can chart components and the weights can be re-evaluated historically.
  - **Register**: nightly inside the existing `science` job (`worker/index.ts`, cron `50 6 * * *`) — after sources sync, before the brief.
- **Consumers (the sorting algo)**:
  - `src/lib/board/sync.ts`: rank candidates by `radar-score.composite` instead of AA intelligence; keep the AA value in the proposal rationale for comparison during transition.
  - `mcp/tools/market.ts`: `sort: 'value'` uses `cost_efficiency`; add `sort: 'radar'` using composite; payload rows gain `radar_score` when present.
  - `src/lib/plans/generate.ts` market grounding block: order by composite.
- **Calibration (before weights are trusted)**: for overlapping models, log divergence between our composite and AA intelligence as a nightly metric (`source: 'radar-score', metric: 'aa_divergence'`); review on `/admin` for 2-4 weeks; only then flip `sort: 'radar'` to the default. Big divergences get investigated, not silently accepted.
- [x] score.ts + normalization helpers + `tests/radar-score.test.ts` (cohort normalization, weight math, missing-input fallbacks — a model with no speed data must still score) ✅ 2026-08-20 (`ba6d51a`)
- [x] science-job registration + consumers rewired behind the calibration flag ✅ 2026-08-20 (end of `runScience`: `rollupModelSpeed` + `computeRadarScores`; consumers gated on `RADAR_SCORE_CONSUMERS=true`, default off; `sort: 'radar'` opt-in available unflagged)
- [x] divergence dashboard note on `/admin/usage` (Phase 7d page) ✅ 2026-08-20 (calibration panel; divergence rows appear after the first nightly science run)

## Phase 7 — Consumption tracking + margin dashboard

**Goal**: every LLM call attributed (feature, user/token, tokens, est. cost); admin visibility into per-artifact margins. This is the monetization prerequisite (rule 1.3.4).

### 7a. Schema (one migration)
```ts
// src/lib/db/schema.ts — new table
export const llmCalls = sqliteTable('llm_calls', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  ts: integer('ts', { mode: 'timestamp' }).notNull(),
  feature: text('feature').notNull(),        // 'curate'|'brief'|'plan'|'stack'|'pain'|'opportunity'|'debate'|'scout'|'digest'|'second-look'|...
  job: text('job'),                          // worker job name when applicable
  userId: integer('user_id'),                // oauth user when MCP-triggered; null = pipeline/anonymous
  model: text('model').notNull(),
  promptTokens: integer('prompt_tokens').notNull().default(0),
  completionTokens: integer('completion_tokens').notNull().default(0),
  durationMs: integer('duration_ms').notNull().default(0), // wall time — also powers first-party speed data
  estCostUsd: real('est_cost_usd').notNull().default(0),
});
```
- `durationMs` is deliberate double-duty: `completionTokens / durationMs` per model = our own measured output-speed series (AA sells speed data; we generate it as a by-product of running). Roll it into `metric_points` (`source: 'radar-speed'`, `metric: 'output_toks_per_s'`) via a nightly rollup in the science job.
- [x] schema + `npm run db:generate` ✅ 2026-08-20 (`6adcd47`, migration `0018_minor_speed.sql`)

### 7b. Instrument chatJSON (single funnel)
- `src/lib/llm/minimax.ts`: `chatJSON(system, user, opts?: { job?, maxTokens?, feature?, userId? })`. Time the fetch (`Date.now()` around the await), and after a successful response (it already reads `data.usage`) insert one `llm_calls` row incl. `durationMs`. Cost via `src/lib/llm/pricing.ts` (new): static map `{ 'MiniMax-M2': { in: 0.30, out: 1.20 } }` per 1M tokens; fall back to zeros for unknown models. Insert must never break the caller: wrap in try/catch.
- Feature tags at call sites: curate.ts (`feature: 'curate'`), brief/brief.ts (`'brief'` + `'digest'`), opportunities/brief.ts (`'opportunity-brief'`), plans/generate.ts (`'plan'` — plus `userId` threaded from the MCP tool), stacks/generate.ts (`'stack'`), pain.ts (`'pain'`), engine.ts (`'opportunity'`), critic.ts (`'critic'`).
- [x] implement + `tests/llm-calls.test.ts` (mock `_setFetch` w/ usage payload → assert row + cost math) ✅ 2026-08-20 (`f8842c1`; all 17 call sites feature-tagged, metering insert is fail-safe)

### 7c. Thread userId through MCP plan generation
- `mcp/tools/plans.ts`: `generatePlan(opp.id, { force, includeMarket, onProgress, userId: auth.userId })`; `src/lib/plans/generate.ts` forwards it into every `chatJSON` call (incl. the brief bootstrap via `generateBrief(oppId, { userId })` — extend its signature too).
- [x] implement; unit test asserts `userId` lands on all 6-7 rows of one generation ✅ 2026-08-20 (`f8842c1`; both brief-bootstrap and cached-brief scenarios covered)

### 7d. Admin dashboard `/admin/usage`
- **Create** `src/app/(hub)/admin/usage/page.tsx` (server component, `requireAdmin()`): daily cost chart (aggregate `llm_calls` by day), per-feature table (calls, tokens, cost), per-user table, "cost per plan" card (plan rows ÷ count), margin view (reads tier prices from a `const TIER_PRICES` in `src/lib/billing.ts` — placeholder constants until Phase 8). Reuse chart idioms from `src/components/LlmBudget.tsx`/`JobTimeline.tsx`.
- Add the query helpers to `src/lib/analytics.ts` (follow `llmUsageHistory` style). Link from `src/app/(hub)/admin/page.tsx`.
- [x] page + helpers + link; build green; screenshot check with Playwright ✅ 2026-08-20 (`17ec315`; helpers in `src/lib/usage.ts` instead of analytics.ts — parallel-ownership split; cost-per-plan is avg-per-call × 6 estimate, rows carry no run id)

### 7e. `get_usage` MCP tool (admin-scoped)
- **Create** `mcp/tools/usage.ts`: returns the same aggregates. Gate: `auth.userId` must map to `users.role === 'admin'` (query `users` table); else a polite restricted payload. Register in `mcp/build.ts`.
- [x] tool + registration + admin-gate test ✅ 2026-08-20 (`17ec315`; gate test lives in `tests/usage.test.ts`; 27th tool registered in `mcp/build.ts`)

## Phase 8 — Artifact monetization

**Goal**: entitlements + quota enforcement + pricing page; flip production auth. The financial model lives in §1.4 — these tiers implement it.

### 8a. Entitlements (one migration)
```ts
// src/lib/db/schema.ts — new table
export const planEntitlements = sqliteTable('plan_entitlements', {
  userId: integer('user_id').primaryKey().references(() => users.id),
  tier: text('tier', { enum: ['free', 'builder', 'factory'] }).notNull().default('free'),
  plansPerMonth: integer('plans_per_month').notNull().default(3), // free=3, builder=30, factory=100
  resetDay: integer('reset_day').notNull().default(1),            // day of month the quota resets
});
```
- `src/lib/billing.ts` (new): `TIER_PRICES = { free: 0, builder: 19, factory: 49 }`, `quotaFor(tier)`, `usageThisCycle(userId)` (count `llm_calls` where `feature='plan'` and `userId=?` within the current reset cycle), `canGeneratePlan(userId)`.
- `mcp/tools/plans.ts`: for authed users replace `planCapExceeded` with `canGeneratePlan`; anonymous mode keeps the flat `MCP_PLAN_DAILY_CAP`. Error payload includes the tier + upgrade hint.
- [x] migration + billing.ts + enforcement + tests (quota window edges, anonymous path unchanged) ✅ 2026-08-20 (`0356eaf`; migration `0019_confused_gunslinger.sql`; authed gate counts in-flight pending too; **units fix**: phase calls re-tagged `plan-phase` so `feature='plan'` = one row per generation — without it tiers were 1/5/16 generations, not 3/30/100)

### 8b. `/pricing` page + flip auth
- **Create** `src/app/(hub)/pricing/page.tsx` (public): three tier cards from `TIER_PRICES`, "what's a plan" explainer, self-host note. Add to `NavLinks.tsx` (`buildLinks`).
- Ops step (documented in README): set `MCP_AUTH_REQUIRED=true` in box `.env`, `docker compose up -d mcp`. OAuth + `/connect` already handle onboarding.
- [x] page + nav + README ops note + build + Playwright render check ✅ 2026-08-20 (`b98daad`; auth flip itself pending — deliberate ops step, done with the user watching)

### 8c. Later (not this phase)
- **Team tier (~$99/mo)**: shared verdicts/votes, multiple seats, shared idea history — the seat model is AA's single-seat pain point; ours should be explicitly multi-seat. Needs seat management UX first.
- Stripe checkout/webhooks, invoices, annual pricing.

## Phase 9 — Idea-engine overhaul

**Goal**: fix the two stated pains — "everyone gets the same top-5" and "we're weak at debating/generating ideas on demand."

### 9a. Multi-role debate pipeline
- `src/lib/opportunities/critic.ts`: add `runDebate(oppId: number | null, ideaText?: string)`. Roles as separate `chatJSON` calls (`feature: 'debate'`): **Advocate** → **Skeptic** → **Market Realist** (grounded in pains/comps/launches/market series via the same query helpers the brief/plan generators use) → **Judge** (verdict, conditions-to-succeed, confidence).
- New `debates` table (migration): `id, opportunityId nullable FK, ideaText nullable, transcript JSON, verdict, confidence, createdAt`.
- Auto-run for top-K new opportunities in `runOpportunities()` (`src/lib/opportunities/engine.ts`, cron `10 7 * * *`); render transcript on the dossier page `src/app/(hub)/opportunities/[id]/page.tsx`.
- [x] pipeline + table + dossier section + `tests/debate.test.ts` (mocked chatJSON per role) ✅ 2026-08-20 (`25c7832`, `78d2b55`; TOP_K_DEBATES=2 per daily run, judge turn carries kill-risks/variants as JSON superset)

### 9b. `debate_idea` MCP tool
- **Create** `mcp/tools/debate.ts`: input `{ idea: string }`; grounding block = sector pains (`painPoints`), comps, launches (`launches`), market (`get_market_models` reader), closest existing opportunities (FTS/embedding similarity on title/thesis). Returns verdict + kill risks + **2-3 strengthened variants**. Register in `mcp/build.ts`. Rewrite the `validate_idea` prompt (`mcp/prompts.ts`) to a thin wrapper that calls the tool.
- [x] tool + prompt wrapper + envelope + test ✅ 2026-08-20 (`ebc6878`; gate tests in `tests/debate-scout.test.ts`; MCP_DEBATE_DAILY_CAP=10)

### 9c. `scout_opportunities` MCP tool
- **Create** `mcp/tools/scout.ts`: input `{ skills?, capital?, hoursPerWeek?, sector?, b2b?, riskAppetite? }`; runs the proposer half of `runOpportunities()` seeded with the constraints; returns fresh personal openings (never the global top-5). Chain hint in `next`: `debate_idea` / `generate_plan`.
- [x] tool + registration + test ✅ 2026-08-20 (`664207e` proposer extraction + `ebc6878`; MCP_SCOUT_DAILY_CAP=10; active slugs filtered so responses are never the global top-5)

### 9d. Anti-homogeneity in `get_opportunities`
- `mcp/tools/opportunities.ts`: (1) sector quota — max 2 per sector in one response; (2) per-caller salting — deterministic order jitter keyed by `auth.rateKey` hash (two builders same morning → different orders); (3) one exploration slot — the last slot is the highest-scored item from a sector not already present. Pass `auth` into `registerOpportunityTools` (signature change in `mcp/build.ts`).
- [x] implement + ordering tests ✅ 2026-08-20 (`90a75e5`; pipeline: filter → crowdedness penalty → FNV-1a salt on rateKey → sector quota 2 → exploration slot; auth was already threaded by the hardening commit)

### 9e. Crowdedness signal
- `src/lib/db/schema.ts`: `opportunities.planRuns integer('plan_runs').notNull().default(0)` (migration); increment in `generatePlan` on successful generation.
- Surface as `exploring_count` in `get_opportunities`/`get_opportunity` payloads + a ranking penalty for `planRuns` above a threshold; dossier page shows "N builders exploring this".
- [x] migration + increment + payload + ranking tweak + tests ✅ 2026-08-20 (`23041f9`, `78d2b55`, `90a75e5`; increment on successful generation only — cache hits don't crowd; penalty −10 ordering-only at planRuns ≥ 3)

### 9f. Personalization profile (after 8 lands, hosted mode)
- `user_profiles` table (userId, skills[], interests[], capitalBand, avoidedSectors[]): a `set_profile`/`get_profile` MCP pair; fit-score reranking applied in `get_opportunities`/`scout_opportunities` when a profile exists.
- [ ] gated on Phase 8 — do not start earlier

## Phase 10 — Data-surface parity + distribution

Cheap wins on data we already store; each is independent.

- [x] **Metrics explorer** `/metrics` ✅ 2026-08-20 (`f141bd3`) — chart/compare any `metric_points` series, CSV + PNG export, daily public dump at `/api/dataset` (gzip JSONL, first-party only unless `AA_PUBLIC`; daily 05:20 cron).
- [x] **Coding-agent subscription tracker** ✅ 2026-08-20 (`19046ff`) — 12 plans across 7 vendors as `metric_points` series (`source: 'agent-plans'`, quarterly-reviewed manual seed) + public `/agent-plans` comparison page; weekly sync cron Thursdays.
- [x] **Weekly "State of the Builder Market" report** ✅ 2026-08-20 (`d978450`, `0362b57`) — `runWeeklyReport()` Sunday 08:00 cron → `reports` table → public `/reports` archive + `get_weekly_report` MCP tool (30th). First local smoke wrote the 2026-08-16 issue (221 words, 1 LLM call).
- [x] **Public read-only JSON API** ✅ 2026-08-20 (`46a1383`) — `/api/v1/{signals,board,opportunities,metrics}`, thin handlers over the lib functions, 60 req/min/IP (`API_RATE_LIMIT`), first-party metrics only unless `AA_PUBLIC`.
- [x] **Trust page** ✅ 2026-08-20 (`9b2b142`) — `/accuracy` extended with forecast-grades section, "how we score ourselves" narrative, independence note, and the freshness metric (story→board median lag via entity matching + story→merge median; methodology documented on the page). NB: page copy renders the real 15-minute ingest cadence — the "30-min" phrase in this plan text was stale.
- [x] **Onboarding polish on `/connect`** ✅ 2026-08-20 (`5730a55`) — connection health check (real client-side initialize + tools/list; treats 401 auth-required as healthy post-flip) + "first plan in 5 minutes" guided steps.

## Phase 11 — Persona expansion (only after Phase 7 data says so)

- One persona = one config pack: `radar.config.json` identity fields (`src/lib/identity.ts`), source pack appended to `SEED_SOURCES` (`src/lib/db/seed-data.ts`), curation/pain/opportunity prompt context (sources: `src/lib/curate/curate.ts`, `src/lib/pain.ts`, `src/lib/opportunities/engine.ts`), venture playbooks (`VENTURES` in `src/lib/stacks/generate.ts`).
- Designers pack first (image/video/design-tool sources), devs second. Each persona is an editorial product: expect prompt iteration, not just config.
- The dashboard (7d) decides whether a persona's artifact margins justify its pipeline cost.

---

## Standing verification & ops

- Per phase: `npx vitest run` green (new suites per spec), `npx tsc --noEmit` no new errors, `npm run build` green (catches Docker-only issues like undeclared deps).
- MCP regressions: `npx tsx mcp/test/live.ts` (44 checks) and, when auth/flow changes touch OAuth, `npx tsx mcp/test/oauth-e2e.ts` (31 checks; needs `:3125` auth instance + seeded `mcptest` admin — see file header).
- Deploy: §3.1 bundle protocol; verify `https://radar.runelabs.org/connect` + a `tools/list` on `https://radar.runelabs.org/mcp` after each deploy.
- Open ops item: box↔GitHub auth (deploy key rejected, org disables deploy keys) — fix with a fine-grained read-only PAT in the box's git credential store, or re-enable org deploy keys.

## Out of scope (explicit)

- Scraping/copying third-party datasets for republication (AA, Mobbin). Proprietary benchmark suites/arenas at AA scale.
- BYOK, per-token billing, raw-token resale. Stripe/billing UI in Phase 8 (scaffolding only).
- stdio/npm MCP bridge, server-side plan execution tracking, write/feedback tools.

## Sources

- [artificialanalysis.ai](https://artificialanalysis.ai/) + [pricing](https://artificialanalysis.ai/pricing) · [Semrush traffic (Jul 2026)](https://www.semrush.com/website/artificialanalysis.ai/overview/) · [PitchBook](https://pitchbook.com/profiles/company/680302-90) · [latent.space AA interview](https://www.latent.space/p/artificialanalysis)
- [MiniMax Token Plan docs](https://platform.minimax.io/docs/token-plan/intro) + [pricing](https://platform.minimax.io/docs/guides/pricing-token-plan) · [MiniMax-M2 API pricing (china-llm)](https://china-llm.com/blog/minimax-m2-pricing) · [pricepertoken M2](https://pricepertoken.com/pricing-page/model/minimax-minimax-m2)
- MiniMax-M2 CJK leakage: issues [#55](https://github.com/MiniMax-AI/MiniMax-M2/issues/55), [#100](https://github.com/MiniMax-AI/MiniMax-M2/issues/100), [#110](https://github.com/MiniMax-AI/MiniMax-M2/issues/110) — remediated in `src/lib/prompt-hygiene.ts` (`stripCjkLeak`/`stripCjkDeep`)
- Production usage: `llm_usage` + `job_runs` tables on the box, queried 2026-08-19.
