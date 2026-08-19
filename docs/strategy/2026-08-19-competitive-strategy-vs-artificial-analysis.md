# Beating Artificial Analysis: Strategy & Roadmap for Runelabs Radar

*Draft v1 — 2026-08-19 — for review and iteration, not yet for execution.*

> **Superseded in part (same day):** the data-independence and monetization sections of this
> draft were revised after review — no dataset copying/republication (ToS), no BYOK, no
> token resale; first-party pipelines + artifact-based pricing instead. The canonical,
> current plan is the MCP-first plan (phases 6-9). The AA product inventory below remains
> useful reference.

## 1. Executive summary

Artificial Analysis (AA) is the trusted **benchmark authority**: they test models themselves and
sell that data to developers and enterprises at $417/mo/seat. They are data-rich and action-poor:
they answer *"which model is smartest/cheapest/fastest"* but never *"what should I build, is this
idea good, and how do I ship it."*

Runelabs Radar already owns the layer AA lacks: news curation, pain mining, opportunity detection
with adversarial review, execution-plan generation, and an official MCP server that plugs straight
into coding agents. Our wedge is the **entrepreneur, not the ML engineer**: *AA tells you which
model wins; Radar tells you what to build, debates the idea with you, and hands your agent the plan.*

Strategy in one line: **do not fight AA on benchmarks (we already consume their API); beat them on
the decision-and-execution layer, at 1/10th the price, agent-native.**

## 2. What Artificial Analysis does (product inventory)

Sources: [home](https://artificialanalysis.ai/), [pricing](https://artificialanalysis.ai/pricing).

### Data & benchmarks (their core, all self-run)
- **Intelligence Index v4.1.1** — composite of 9 evaluations (GDPval-AA v2, τ³-Banking,
  Terminal-Bench v2.1, SciCode, Humanity's Last Exam, GPQA Diamond, CritPt, AA-Omniscience, AA-LCR).
- **Proprietary benchmarks**: AA-Briefcase (agentic knowledge work), AA-AnalystAgent (spreadsheet
  analysis, pass^5 reliability), AA-Omniscience (hallucination), GDPval-AA (economically valuable
  tasks vs human baseline).
- **Coding Agent Index** — end-to-end SWE-task performance/cost/time per agent.
- **Arenas**: Image, Video, Text-to-Speech, Speech-to-Text — crowdsourced Elo leaderboards.
- **Openness Index** — how open weights/licensing are, component-scored.
- **Cost data** — per-token prices (input/output/cache), cost per Index task.
- **Speed & latency** — output tokens/sec, TTFT, time per task, measured against first-party APIs.
- **Provider-level analysis** — Endpoint Accuracy Index (how much accuracy a hosting provider
  preserves vs reference), speed/price per provider for open models.
- Freshness promise: leading models benchmarked **within 24h of release**.

### Tools & monetized surfaces
- **Data Playground** (custom charts), **Table Builder**, **Data Export**.
- **Data API** + databook download. Free tier exists (~1,000 req/day per
  [community docs](https://smithery.ai/skills/alexfazio/artificial-analysis-compare)); Pro gets
  higher limits.
- **Reports**: State of AI Report, AI Adoption Survey, Model Deployment Report, Leaders AI Strategy
  Guide.
- **Services (Enterprise)**: custom benchmarking for your use case, compute market model with
  supply/demand forecasts, workshops, AI strategy advisory.

### Pricing
- **Pro: $417/mo per seat** billed yearly ($499 monthly). Single seat only. No free trial.
- **Enterprise: custom**, targeted at 150+ employee orgs.
- Strict independence policy: providers cannot pay for results or placement — this is their trust
  moat and the reason press and labs cite them.

### What they do NOT have
- No official MCP server or agent-facing surface (only
  [community wrappers](https://lobehub.com/mcp/kravtandr-artificialanalysis-mcp)).
- No opportunity/idea layer, no pain mining, no execution plans, no personalization, no debate or
  validation workflow. Pure data → human eyeballs.

## 3. Their scale: traffic & revenue estimates

**Traffic** ([Semrush, July 2026](https://www.semrush.com/website/artificialanalysis.ai/overview/)):
- **4.44M visits in July 2026**, up 54% MoM (Jun 2.88M, May 2.4M) — fast growth.
- Avg session 7:17 — deep engagement, people actually read charts.
- 49% direct, 40% Google — strong brand + strong SEO. 830K backlinks, 12.7K referring domains.
- Audience adjacency: openrouter.ai (23.5M visits), llm-stats.com (836K), vellum.ai (309K).
- AI referrals still small (ChatGPT ~23K/mo) — agent-channel discovery is unserved.

**Funding**: only **~$250K raised** ([PitchBook](https://pitchbook.com/profiles/company/680302-90);
AI Grant, Build Club). Tiny team — the
[cofounders' latent.space interview](https://www.latent.space/p/artificialanalysis) (Jan 2026)
confirms a lean operation.

**Revenue (speculation, treat as order-of-magnitude):** no public figure. Triangulation: 4.4M
monthly visits with a $417/seat product and no free trial means conversion is the bottleneck —
plausibly a few hundred Pro seats (~$0.5–2M ARR) plus a small number of 5–6-figure Enterprise
contracts → **rough guess $1–5M ARR**, growing fast. The signal that matters: they are
revenue-funded, small, and have proven enterprises pay for AI decision data.

**Lesson for us**: you don't need their traffic to make money; you need a niche that pays. But their
traffic shows the top-of-funnel size of "people trying to make AI decisions."

## 4. Where they win vs where we win

| Capability | AA | Radar today | Verdict |
|---|---|---|---|
| Own benchmarks & arenas | ✅ proprietary, trusted | ❌ (consumes AA API) | **Don't chase** (§8) |
| Model price/speed data | ✅ measured first-party | ✅ via AA API + metricPoints | Parity-by-consumption, keep |
| Data playground / custom charts | ✅ Pro-gated | ❌ fixed pages | **Cheap to close** (Phase 2) |
| Reports | ✅ quarterly, enterprise | ✅ daily brief (different flavor) | Close with builder-market report (Phase 2) |
| Public API | ✅ free tier + Pro | ❌ MCP only | Close with read-only JSON API (Phase 2) |
| Agent-native surface (MCP) | ❌ | ✅ official server, OAuth, 26 tools | **Our moat — deepen** |
| Opportunity detection | ❌ | ✅ engine + adversarial critic | **Our moat — overhaul** (Phase 1) |
| Pain mining | ❌ | ✅ intensity-scored | Our moat |
| Execution plans | ❌ | ✅ generate_plan task graphs | Our moat |
| Idea debate / validation | ❌ | ⚠️ single critic pass; prompt-only `validate_idea` | **Build** (Phase 1) |
| Personalization | ❌ same leaderboard for all | ❌ same top-5 for all | **Build** (Phase 1) — their flaw too |
| Accuracy self-tracking | ❌ | ✅ hindsight grades, calibration, forecast grades | Our moat — market it |
| Price | $417/seat, no trial | self-host free, hosted TBD | **Undercut 10×** (Phase 3) |

## 5. Positioning

> **AA is the Bloomberg terminal for model performance. Radar is the copilot for people building
> businesses with those models.**

- Target user: indie founders, solopreneurs, small product teams, agency builders — people whose
  question is *"what do I build and is it worth it,"* not *"which endpoint serves gpt-oss fastest."*
- The loop we own end-to-end: **discover → debate → decide → plan → build**, all from inside the
  user's IDE/agent. AA covers none of this loop; everyone downstream of AA (including us) consumes
  their data as raw material.
- Tagline candidate: *"AA tells you which model wins. Radar tells you what to build — and hands your
  agent the plan."*

## 6. Phase 0 — LLM provider abstraction (foundation + monetization lever)

Everything below multiplies LLM spend; today we are MiniMax-only (`src/lib/llm/minimax.ts`,
`MINIMAX_DAILY_CALL_CAP`, `llmUsage` table). Per user direction: **add abstraction so users hook up
whatever they want; we offer a capped default and meter it for pricing tiers.**

- New `src/lib/llm/provider.ts`: a `chatJSON` interface over MiniMax (default), OpenRouter, OpenAI,
  Anthropic, Google; per-call-site model hints (cheap model for tagging, strong model for debate).
- Key resolution order: per-user/per-OAuth-client key (hosted) → instance env/config (self-host) →
  default MiniMax budget.
- Drizzle migration: encrypted `user_llm_keys` table; extend `llmUsage` to per-principal metering.
- `radar.config.json`: provider section; keep MiniMax as zero-config default.
- Hosted tiers meter this (Phase 3): free = our MiniMax, capped; paid = BYOK or raised caps.

## 7. Phase 1 — Idea engine overhaul (the stated pain)

Pain points named by the user: (a) we feed everyone the same top-5 ideas → many people launch the
same stuff; (b) we're weak at debating and at finding new ideas when ours aren't good enough.

### 7a. Debate pipeline (replaces single critic pass)
- Extend `src/lib/opportunities/critic.ts` into a structured multi-role debate:
  **Advocate** (steelmans the thesis) ↔ **Skeptic** (red team) ↔ **Market Realist** (grounds claims
  in radar data: pains, comps, launches, market prices, similar past opportunities and their
  outcomes) → **Judge** (verdict, conditions-to-succeed, confidence).
- Persist transcripts in a new `debates` table; render on the opportunity dossier page
  (`src/app/(hub)/opportunities/[id]/page.tsx`) — the debate becomes a product artifact, not a hidden
  prompt.
- Auto-run only for top-K *new* opportunities (budget); on-demand for the rest.

### 7b. `debate_idea` MCP tool (user's own ideas)
- New tool in `mcp/tools/`: user submits any idea → same debate pipeline, grounded in live data
  (related pains, comps/exits, competing launches, market prices, existing opportunities) → verdict,
  kill risks, and **2–3 strengthened variants** that address the kill risks.
- Supersedes the prompt-only `validate_idea` (keep the prompt as a thin wrapper calling the tool).
- This is the "we're not great at debating" fix, agent-native — no AA equivalent exists anywhere.

### 7c. `scout_opportunities` MCP tool (on-demand idea generation)
- Today opportunities are a batch job (07:10 cron, ≤6/day, global). Add on-demand scouting: user
  passes constraints (skills, capital, hours/week, sector, B2B/B2C, risk appetite) → run the
  proposer (`src/lib/opportunities/engine.ts`) seeded with those constraints → fresh, *personal*
  ideas that never had to compete with the global top-5.
- Debate (7a) can chain onto results. Metered as premium calls (Phase 0/3).

### 7d. Anti-homogeneity (fix "everyone launches the same thing")
- **Diversity reranking**: MMR-style rerank of `get_opportunities` output using existing embeddings
  + sector quotas, so a top-5 list can't be 5 flavors of the same niche.
- **Exploration slot**: reserve 1 of N slots for a high-variance wildcard (novel sector, lower
  score) — serendipity as a feature.
- **Per-consumer feed salting**: feed ordering salted by OAuth client/user id so two builders
  pulling "top 5" the same morning get deliberately different lists.
- **Adjacent pivots**: each dossier carries 2–3 pivot variants ("same pain, different wedge"), so
  even two users who pick the same opportunity diverge at the plan step.

### 7e. Crowdedness signal (turn the bug into a feature)
- Count dossier expands + `generate_plan` runs per opportunity (we already log plan generation);
  display *"N builders exploring this"* and apply a crowdedness penalty in ranking.
- Honest market signal that actively pushes users toward less-contested ideas — nobody else does
  this.

### 7f. Personalization profile (deployment-dependent — see open decision §10)
- Per user/OAuth-client profile: skills, interests, capital, avoided sectors → fit-score reranking
  of feeds and scouting defaults. AA has nothing like this; it deepens the "made for you" wedge.

## 8. Phase 2 — Data-surface parity (cheap wins; the data is already in our DB)

Deliberately **not** chasing: proprietary benchmarks, arenas, hardware/inference benchmarking,
compute market forecasting. Those cost millions and years of trust; we consume AA + public data
instead. Explicit non-goals keep us focused.

- **Metrics explorer** (`/metrics`): chart/compare any series already in `metricPoints` (AA prices,
  intelligence, arena ELOs, GitHub stars, HF/npm downloads, launch counts); CSV/PNG export. Our
  answer to their Pro-gated Data Playground — free, since we already pay to store the data.
  ⚠️ First verify AA API redistribution terms before exposing AA-sourced series publicly
  (`AA_PUBLIC` flag exists; legal check is a task, not an afterthought).
- **Weekly "State of the Builder Market" report**: LLM-synthesized from the week's stories, pains,
  launches, comps, board changes; public archive for SEO. Our answer to their State of AI Report,
  aimed at builders instead of CIOs.
- **Public read-only JSON API** (`/api/v1/...`: signals, board, opportunities, metrics), free
  rate-limited tier — parity with their free API tier, and a developer acquisition channel.
- **Trust/transparency page**: extend `/accuracy` (hindsight grades, calibration, forecast grades)
  into a public "how we score ourselves" page — our version of their independence policy, and a
  differentiator they can't copy without publishing their own misses.

## 9. Phase 3 — Distribution & monetization

- **Hosted tiers** (meter = LLM budget + debate/scout credits from Phase 0):
  - **Free**: default MiniMax budget, daily caps, global feeds, no debates. The top of funnel AA
    refuses to offer.
  - **Builder (~$29/mo)**: BYOK or raised caps, `debate_idea`, `scout_opportunities`, personalization.
    10×+ cheaper than AA Pro, aimed at a buyer AA ignores.
  - **Team (~$99/mo)**: shared verdicts/votes, multiple seats, shared idea history.
  - Self-hosted stays source-available (BSL 1.1 as today); BYOK makes self-host fully capable —
    we monetize convenience and budget, not features.
- **Onboarding**: `/connect` exists — add one-click per-IDE configs (Claude Code, Cursor, ChatGPT,
  etc.), a connection health check, and a "first debated idea + first plan in 5 minutes" guided flow.
- **Growth loops**: public opportunity teaser pages (SEO), weekly report distribution, embeddable
  "opportunity of the day" widget (board embed exists as pattern), the accuracy page as a trust
  asset in every launch post.

## 10. Open decisions (to debate)

1. **Deployment model** — hosted multi-user vs self-host-first. Trade-offs:
   - *Hosted multi-user*: personalization (7f), crowdedness (7e), and per-user feeds reach full
     value; enables subscription revenue; requires auth UX, per-user metering, multi-tenant care.
   - *Self-host-first*: simpler, true to source-available roots; but crowdedness/personalization
     degrade to per-instance, and monetization leans entirely on the hosted offering anyway.
   - *Recommendation*: design tenant-aware, ship single-tenant — implement profiles keyed by OAuth
     client/user id so both modes work, hosted first.
2. **Pricing levels** — $29/$99 are placeholders; needs willingness-to-pay thinking and a decision
   on whether self-hosted stays feature-complete.
3. **Debate depth vs cost** — roles, rounds, when to auto-run; gated by Phase 0 metering.
4. **Debates as public content?** — SEO value vs leaking premium value vs user privacy for
   `debate_idea` submissions (default: private for user ideas, public for engine opportunities).
5. **AA dependency risk** — our market data rides their API; redistribution terms for the metrics
   explorer need verification; consider a fallback source (OpenRouter prices, public benchmarks).

## 11. Suggested execution order (each its own future plan)

1. Phase 0 provider abstraction (unblocks everything, ~small)
2. Phase 1a+1b debate pipeline + `debate_idea` (the flagship differentiator)
3. Phase 1d+1e anti-homogeneity + crowdedness (the stated pain)
4. Phase 1c `scout_opportunities` (on-demand ideas)
5. Phase 2 metrics explorer + weekly report (cheap parity wins)
6. Phase 3 tiers + onboarding polish
7. Phase 1f personalization once the deployment decision (§10.1) is made

## 12. Sources

- [artificialanalysis.ai — home](https://artificialanalysis.ai/)
- [artificialanalysis.ai — pricing](https://artificialanalysis.ai/pricing)
- [Semrush traffic overview — artificialanalysis.ai](https://www.semrush.com/website/artificialanalysis.ai/overview/) (July 2026)
- [PitchBook company profile](https://pitchbook.com/profiles/company/680302-90)
- [latent.space interview with AA cofounders](https://www.latent.space/p/artificialanalysis) (Jan 2026)
- [Community AA MCP wrapper (LobeHub)](https://lobehub.com/mcp/kravtandr-artificialanalysis-mcp)
- [AA free API tier reference (Smithery skill)](https://smithery.ai/skills/alexfazio/artificial-analysis-compare)
- Radar internals: `README.md`, `src/lib/db/schema.ts`, `src/lib/opportunities/*`, `mcp/tools/*`,
  `worker/index.ts` (feature inventory gathered 2026-08-19)
