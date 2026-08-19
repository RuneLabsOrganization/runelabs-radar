# Radar MCP-First: Make MCP the Product

> **Status**: Phases 1-5 + ergonomics pack SHIPPED (commits `948d222`, `8070b61`, `f14e9cf` on `main`, live at radar.runelabs.org — 26 tools, resources, prompts, OAuth 2.1, plan engine, envelope, /connect page, progress notifications; 329 tests, live 44/44, e2e 31/31).
> Phases 6-9 are the forward plan, adapted 2026-08-19 after the strategy review: **first-party data independence, margin observability before monetization, artifact-based pricing (no BYOK, no token resale), solopreneur vertical first.**

## Context

The MCP server is now the product surface: an agent can do everything through it — browse launches, signals, board, stacks, pains, patterns, market data, forecasts, entities, comps — and run the flagship flow **opportunity → briefing → granular execution plan** that a local coding agent executes end-to-end. Next: own the data pipelines, control the margins, monetize artifacts, then expand personas.

## Decisions locked in

1. **MCP is the product itself.** Agents are the primary audience; the web hub is the back office/showcase.
2. **Auth: OAuth 2.1 per MCP spec** (PKCE + DCR). — shipped
3. **Agent-agnostic payloads** with the `summary` + `next` envelope on every structured response. — shipped
4. **Plan format: dual JSON + markdown; full lifecycle; full task graph; hybrid cache.** — shipped
5. **All data surfaces exposed; all MCP primitives (tools + resources + prompts).** — shipped
6. **Plans are stateless artifacts; MCP is read-only from the agent's perspective.** — shipped
7. **First-party data, not copied datasets.** We do NOT scrape-and-republish third-party datasets (AA's terms treat republication as redistribution; Mobbin's library is copyrighted content). We replace external dependencies with our own collection pipelines — most already exist (`metric_points`, launches, pains).
8. **No BYOK, no raw-token resale.** Pricing unit is the *artifact* (plans generated, briefs, alerts), with LLM cost as COGS. Free tier + paid tiers by volume. Usage limits enforced server-side per user.
9. **Margin observability precedes monetization.** No pricing launch until per-call consumption tracking + the admin dashboard tell us exactly what an artifact costs.
10. **Persona expansion is sequenced last.** Solopreneur is the live vertical; designers/devs come after the dashboard proves per-vertical margins. Each persona = source pack + curation prompt set + pain mining, not a config flag.

## Distribution (updated)

Remote-only, streamable HTTP at **`https://radar.runelabs.org/mcp`** (path-proxied by nginx; the `mcp.` subdomain was never DNS-wired — registry manifest matches reality). OAuth flow live but not enforced: `MCP_AUTH_REQUIRED` stays unset until Phase 8 needs entitlements. `/connect` on the hub is the install page; `GET /` on the MCP port redirects there.

---

## SHIPPED — Phases 1-5 (kept as the record)

- **Phase 1 — tools**: 26 tools across 14 modules in `mcp/tools/`, zod input+output schemas, snake_case payloads, attribution footer.
- **Phase 2 — primitives**: `radar://` resources (brief/board/stacks/opportunity/plan/map) + 5 workflow prompts (`find_and_plan` flagship).
- **Phase 3 — plan engine** (`src/lib/plans/`): opportunity → full-lifecycle task graph (validation → build → launch → GTM → revenue), 6-7 LLM calls, cached on the opportunity row (`plan`, `plan_generated_at`), dual JSON+markdown, strict sanitizer, migration `0017`.
- **Phase 4 — OAuth 2.1**: Next.js authorization server (consent page, DCR, PKCE S256, refresh rotation w/ absolute cap), MCP resource server (bearer validation, RFC 9728 metadata, per-token rate limits).
- **Phase 5 — packaging**: smoke + live + Playwright e2e suites, registry `server.json` 0.2.0, compose rw mount, README, `.env.example`.
- **Ergonomics pack** (second plan, same codebase): `summary`+`next` envelope on every tool, `generate_plan` progress notifications, `/connect` page, nav + redirect, CLI dogfooding.

---

## Phase 6 — First-party data independence (kill the AA dependency)

Goal: board, market tools, and plan grounding run on **our own** numbers; AA becomes optional enrichment, never a single point of failure.

- **Price pipeline**: worker job that snapshots per-model token prices from provider pricing pages/APIs (OpenAI, Anthropic, Google, DeepSeek, Moonshot/MiniMax, Qwen) into `metric_points` (`source: 'provider-pricing'`). Deterministic parsers per provider, manual-fallback table for hard-to-parse pages.
- **Capability pipeline**: ingest open benchmark results (LMArena leaderboard exports, official eval cards, open leaderboards) into `metric_points` (`source: 'open-bench'`) — cite sources in a `metric_provenance` note where the table allows.
- **Own micro-benchmark (stretch)**: a small fixed task suite (code gen, copy, extraction) run weekly against the top N models via our LLM plumbing; scores land in `metric_points` (`source: 'radar-eval'`). Deliberately modest — signal, not science.
- **Rewire consumers**: `src/lib/board/sync.ts` (`aaPromptLines`), `src/lib/analytics.ts` (`aaModels`), `src/lib/plans/generate.ts` (market grounding), `mcp/tools/market.ts` read from first-party series with AA as fallback when `AA_API_KEY` is set. `get_market_models` gains a `source` field per row (`first_party | artificial_analysis`).
- **Sunset rule**: when first-party coverage ≥ 90% of the board's referenced models for 2 consecutive weekly syncs, AA moves to "disabled unless explicitly enabled".

## Phase 7 — Consumption tracking + margin dashboard (prerequisite for pricing)

- **Schema**: `llm_calls` table — per-call record: `ts`, `feature` (curate/brief/plan/board/pain/opportunity/…), `user_id`/`token_id` nullable, `model`, `prompt_tokens`, `completion_tokens`, `est_cost_usd` (from the price pipeline), `job` (worker jobs) — one drizzle migration.
- **Instrumentation**: central in `chatJSON` (already the single funnel, already accumulates tokens via `drainLlmUsageStats`); feature tagged via a new `opts.feature`; MCP calls attributed via the OAuth token's `userId` (anonymous mode: `null`).
- **Dashboard**: `/admin/usage` — calls/tokens/cost per day, per feature, per user; plan-generation unit economics (avg cost per plan); margin view once a price per artifact exists; soft alerts (daily cost > threshold).
- **Exports**: usage rows queryable via MCP (`get_usage` tool, admin scope) — agents monitoring our own margins is on-brand.

## Phase 8 — Artifact-based monetization (real-data model, 2026-08-19)

**Measured baseline (production, last 14 days)**: 122–258 LLM calls/day (avg ~196), ~5,900/month. Token stats (curate job): ~2.1k in / ~1.5k out per call. At MiniMax-M2 list prices ($0.30/M in, $1.20/M out; [pricing](https://platform.minimax.io/docs/guides/pricing-token-plan), [china-llm](https://china-llm.com/blog/minimax-m2-pricing)) the whole always-on pipeline costs **≈ $0.47/day ≈ $14/month at list** — a fixed cost that does not grow with users.

**Unit economics (list prices)**: execution plan ≈ $0.03–0.05 (6–7 calls, thinking tokens included); opportunity brief ≈ $0.005; daily brief ≈ $0.005–0.01. Read tools (the bulk of MCP traffic) hit SQLite: $0. So user-driven COGS is essentially *plans only*: Builder (30 plans/mo) ≈ $1.20, Factory (100 plans/mo) ≈ $4.00.

**Pricing (artifact tiers)**: Free = unlimited reads + 3 plans/mo · Builder $19/mo = 30 plans · Factory $49/mo = 100 plans + alerts. Gross margin on LLM: 92–94% per user before the $14/mo pipeline + $10 subscription.

**Subscription capacity (the $10 legacy Coding Plan)**: quota isn't published in tokens — it's 5-hour rolling + weekly windows deducting at list prices. Empirically we use a fraction of it (multiple projects, never throttled). Modeling quota value conservatively at ~$60/mo of list usage: ~$45/mo headroom after the pipeline ≈ **~1,100 plan generations/month ≈ 35 Builder or ~22 Factory users on the current $10 plan**. The binding constraint is the 5-hour window under burst load, not the monthly value — mitigate in order: (1) server-side queue/throttle on generate_plan, (2) worker pre-generates plans for top opportunities nightly (cache hits cost $0), (3) tier up.

**Revenue scenarios** (LLM+subscription COGS only; Hetzner infra ~$10-20/mo separate):
- **25 users** (20 Builder / 5 Factory): **$625 MRR / $7.5k ARR**, COGS ~$10–20 → ~97% margin. Fits current plan.
- **100 users** (70/30): **$2,800 MRR / $33.6k ARR**, ~5,100 plans ≈ $204 PAYG-equivalent → Ultra sub ($120) covers it → ~95% margin.
- **500 users** (350/150): **$14k MRR / $168k ARR**, ~25,500 plans ≈ $1,020 → PAYG beats stacking subs at this point → ~93% margin.

**Subscription → PAYG migration triggers**: (1) weekly-window throttling visible as LlmErrors/429s in job_runs, (2) 5h-window queue latency on generate_plan, (3) PAYG-equivalent spend approaches the next tier's price (~5k plans/mo ≈ $200 vs Ultra $120 → Ultra; ~10-15k plans/mo → PAYG wins). MiniMax Credits (1,000 = $1) bridge spikes without tier jumps. **ToS flag**: a subscription key is marketed for agent/coding tools — serving a multi-tenant SaaS backend from it is a gray zone; the clean long-term scale path is PAYG or a Team plan. Verify acceptable use before charging users on subscription quota.

**Implementation (unchanged scope)**: entitlements table (tier, monthly plan quota), `generate_plan` enforces per-user quota (replaces flat cap for authed users), flip `MCP_AUTH_REQUIRED=true`, `/pricing` stub. Stripe is a later phase. **Not doing**: per-token billing, BYOK, raw-token resale.

**CJK leakage remediation (SHIPPED with this phase)**: MiniMax-M2 splices hanzi/kana/CJK punctuation into non-Chinese output (confirmed common: MiniMax-M2 issues [#55](https://github.com/MiniMax-AI/MiniMax-M2/issues/55), [#100](https://github.com/MiniMax-AI/MiniMax-M2/issues/100), [#110](https://github.com/MiniMax-AI/MiniMax-M2/issues/110) — semantic-level, ~1-in-5-10 responses in bad cases). Fix: `stripCjkLeak`/`stripCjkDeep` in `src/lib/prompt-hygiene.ts`, applied to every generated artifact (daily brief, domain digests, opportunity briefs, execution plans, stack playbooks) — ideographs/kana stripped, 。/、→ ASCII punctuation, fullwidth→ASCII, with a `[cjk]` warn-log for observability. Input side (`promptLine`) deliberately untouched: CJK in scraped stories is legitimate. Tests: `tests/cjk.test.ts` (8 cases).

## Phase 9 — Persona expansion (only after 7 proves margins)

- Solopreneur = current vertical (sources, prompts, pains all tuned).
- New persona (designers / devs / …) = a `radar.config` identity + source pack + curation-prompt set + venture playbooks; the domain system and MCP surface are already persona-agnostic.
- The dashboard decides: a persona whose artifact margins don't clear the bar gets paused, not propped up.

## Verification (standing)

- `npx vitest run` green incl. new suites per phase; `npx tsc --noEmit` no new errors; `npm run build` green (Docker build included — clean `npm ci` caught a stray import once already).
- Live: `npx tsx mcp/test/live.ts https://radar.runelabs.org` 44/44; `mcp/test/oauth-e2e.ts` 31/31; per-phase additions extend these suites.
- Deploy path until box↔GitHub auth is fixed: commit → push → `git bundle` → box `git fetch` + `merge --ff-only` → `docker compose build && up -d`.

## Out of scope (explicit)

- Scraping/copying third-party datasets (AA, Mobbin) for republication — legal/ToS exposure, and unnecessary given our pipelines.
- Raw-token resale, BYOK, per-token billing.
- stdio/npm bridge, server-side plan execution tracking, write/feedback tools.
- Stripe/billing UI in Phase 8 (scaffolding + entitlements only).
