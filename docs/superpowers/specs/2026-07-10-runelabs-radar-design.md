# Runelabs Radar — Design Spec

**Date:** 2026-07-10
**Status:** Approved (decisions locked via brainstorming Q&A; autonomous session)
**Owner:** Specter / Runelabs

## Problem

The Runelabs team (vibecoding startup farm) can't keep up with the pace of AI model launches and technique shifts. Existing tools (Perplexity, artificialanalysis.ai, Chrome news feed) miss image/video generation coverage, aren't tailored to Runelabs' domains, and provide no per-domain cost-benefit guidance. Things get missed.

## Goal

A self-hosted AI intelligence hub on the existing Hetzner server that:
1. Never misses relevant news (comprehensive automated ingestion).
2. Ranks and summarizes it per Runelabs domain using MiniMax (same API key as helix-claw).
3. Maintains a per-domain "Best Right Now" cost-benefit board with team verdicts.
4. Is the single destination for the team (web hub only — no push channels in v1).

## Locked decisions (from brainstorming Q&A)

| Decision | Choice |
|---|---|
| Digest delivery | Web hub only (no Discord/Telegram/email push) |
| Stack | Node/Next.js, single TypeScript repo, SQLite, Docker on Hetzner |
| Team interactivity v1 | Votes (thumbs up/down) + editable "Runelabs verdict" on board |
| Leaderboard data | Hybrid: weekly automated pulls (Artificial Analysis API + public benchmark sources) → MiniMax drafts proposals → human approves |

## Domains

Six fixed domains: `coding`, `copy`, `image`, `video`, `ads`, `agentic`.

## Architecture

Single TypeScript repo, two runtime processes plus a shared SQLite database, deployed with Docker Compose behind the server's existing reverse proxy:

- **web** — Next.js (App Router). Hub UI + API routes (auth, votes, verdicts, sources CRUD, proposal review).
- **worker** — Node process with node-cron schedules:
  - ingest: every 30 minutes
  - curate (MiniMax): hourly
  - board sync + proposals: weekly (Mon 06:00)
  - daily brief: daily 07:00
- **SQLite** (WAL mode) via Drizzle ORM, shared by both processes on a mounted volume. Backup = copy one file.

## Data model (core tables)

- `users` — id, name, password_hash, role (`admin` | `member`), last_seen_at
- `sources` — id, type (`rss` | `hn` | `reddit` | `arxiv` | `huggingface` | `github`), name, url/config, domain hints, enabled, last_fetched_at, last_status, consecutive_failures
- `items` — raw ingested units: source_id, url (unique), title, excerpt, published_at, fetched_at
- `stories` — curated clusters: canonical title, tldr, why_it_matters, domain_scores (JSON, 0–100 per domain), top_score, status (`raw` | `curated`), created_at
- `story_items` — join items → stories
- `votes` — user_id + story_id, value (±1)
- `board_entries` — domain, task, best_overall, best_value, cheapest_viable, cost_note, runelabs_verdict, verdict_author, updated_at
- `board_proposals` — drafted changes awaiting review: board_entry ref (or new), proposed JSON, rationale, status (`pending` | `approved` | `rejected`), created_at
- `board_history` — applied changes log ("what changed this week")
- `benchmark_snapshots` — source name, raw JSON, fetched_at
- `briefs` — date (unique), markdown
- `job_runs` — job name, started_at, finished_at, status, error, stats JSON

## Ingestion layer

Adapter-per-source-type; every adapter normalizes into `items`. Sources are DB rows editable from the admin UI (adding a feed is a form, not a deploy).

Initial source set:
- **RSS:** OpenAI, Anthropic, Google DeepMind, Mistral, MiniMax, Runway, Black Forest Labs, ElevenLabs, Hugging Face blog, Simon Willison's weblog
- **Hacker News:** Algolia search API, AI-related queries, points threshold
- **Reddit:** r/LocalLLaMA, r/StableDiffusion, r/aivideo (public JSON, top/day)
- **arXiv:** cs.AI + cs.CL recent (Atom API)
- **Hugging Face:** trending models + daily papers (public JSON endpoints)
- **GitHub trending:** best-effort HTML scrape, graceful failure

Politeness/resilience: conditional GETs where supported, per-run timeouts, failures recorded per source (never fatal to the batch), consecutive-failure count surfaces in a **source health panel** so dead feeds are visible.

## Curation brain (MiniMax)

Hourly batch over new `raw` items:
1. **Cluster:** normalized-title similarity (token Jaccard) merges obvious duplicates into stories; borderline pairs confirmed by one LLM call.
2. **Score & summarize:** per story, MiniMax returns domain_scores (0–100 × six domains), a two-line TLDR, and a "why it matters for Runelabs" note. Prompt includes Runelabs context and recent team votes as calibration examples (thumbs-downs reshape ranking).
3. **Failure mode:** if MiniMax is unavailable or a story fails, it remains `raw` and still appears in the feed — news is never blackholed behind the AI.

MiniMax access: OpenAI-compatible chat completions endpoint; env-configured (`MINIMAX_API_KEY`, `MINIMAX_BASE_URL`, `MINIMAX_MODEL`). Retries with backoff; per-day call cap.

## Board sync (hybrid)

Weekly job:
1. Pull Artificial Analysis API (if `AA_API_KEY` set) + public benchmark sources (aider leaderboard raw YAML from GitHub; others best-effort) into `benchmark_snapshots`.
2. MiniMax reads snapshots + the week's top stories, drafts `board_proposals` per domain/task with rationale.
3. Admin reviews proposals in the hub (approve → applied to `board_entries` + `board_history`; reject → archived).
4. If no benchmark data is available, proposals fall back to news-derived reasoning (clearly labeled).

## Hub UI (Next.js)

- **/login** — password login, session cookie.
- **/ (Today)** — stories ranked by top_score, domain filter chips, per-card TLDR + why-it-matters + vote buttons. "Since your last visit" divider and per-domain unread counts (from `users.last_seen_at`).
- **/domain/[slug]** — same feed scoped to one domain.
- **/board** — Best Right Now table grouped by domain: task, best overall, best value, cheapest viable, cost note, editable Runelabs verdict (any member? → members can vote, verdict editing is admin+member with attribution), "what changed" recent history.
- **/brief** — daily AI-written brief (top stories + board changes), archive by date.
- **/admin** — sources CRUD + health, job runs, proposal review queue. Admin role only.

Design: clean dark dashboard, Tailwind, no component library bloat. Fast and dense — a tool, not a marketing site.

## Auth & team

Seeded accounts only (script), bcrypt password hashes, signed session cookie (HMAC, `SESSION_SECRET`). Roles: `admin` (board edits, sources, proposals) and `member` (read, vote, verdicts). No public signup.

## Error handling

- Every job run recorded in `job_runs`; hub header shows a staleness warning if ingest > 2h old or curate > 3h old.
- Adapter errors are per-source and logged, never abort the batch.
- MiniMax: 3 retries exponential backoff; daily budget cap via call counter; failures leave stories `raw`.

## Testing

- **Unit (vitest):** each adapter against fixture payloads; clustering similarity; curation pipeline with mocked LLM responses; session sign/verify.
- **Build gate:** `next build` (typecheck) must pass.
- **Smoke:** seeded dev DB, dev server boots, login → Today renders.

## Deployment

Dockerfile (multi-stage) + docker-compose.yml (web + worker sharing a `data/` volume). README covers: env vars, seeding users, reverse-proxy snippet (Caddy/nginx) for `radar.<domain>` on the Hetzner box alongside helix-claw and neural-trade.

## Phasing

1. Skeleton + ingestion (raw feed visible in minimal hub)
2. Brain (curation, Today view, votes)
3. Board (weekly sync, proposals, verdicts)
4. Polish (brief, source health, archive/search)
5. Test + verification pass

## Out of scope (v1)

Push digests (email/Discord/Telegram), comments, per-user preference profiles, link submission, browser notifications, full-text semantic search, multi-tenant anything.
