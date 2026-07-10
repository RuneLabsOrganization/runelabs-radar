# Runelabs Radar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Self-hosted AI intelligence hub (news ingestion → MiniMax curation → web hub with votes, cost-benefit board, daily brief) per `docs/superpowers/specs/2026-07-10-runelabs-radar-design.md`.

**Architecture:** One TypeScript repo. Next.js App Router serves UI + API routes; a separate node-cron worker runs ingest/curate/board/brief jobs; both share one SQLite database (WAL) via Drizzle ORM. Deployed via Docker Compose on the Hetzner box.

**Tech Stack:** Next.js 15, React 19, TypeScript, better-sqlite3 + Drizzle, node-cron, tsx, bcryptjs, fast-xml-parser, Tailwind v4, vitest.

**Execution mode:** Autonomous single session. Phases A–C are foundational (sequential, done by lead). Phases D–I build against the contracts below and run as parallel subagents with disjoint file sets. J–K integrate and verify. Commit after each phase.

---

## File structure (locked)

```
package.json tsconfig.json next.config.ts postcss.config.mjs drizzle.config.ts vitest.config.ts
.env.example .gitignore README.md Dockerfile docker-compose.yml
drizzle/                      (generated SQL migrations — drizzle-kit generate)
src/lib/config.ts             env access, defaults
src/lib/domains.ts            DOMAINS const, labels, colors
src/lib/db/schema.ts          full Drizzle schema (contract below)
src/lib/db/index.ts           getDb() singleton, WAL, runs migrations on open
src/lib/db/seed-data.ts       initial sources + board tasks
src/lib/auth/session.ts       HMAC cookie token sign/verify (pure, testable)
src/lib/auth/user.ts          getCurrentUser()/requireUser()/requireAdmin() (server-only)
src/lib/llm/minimax.ts        chatJSON() with retries + daily cap
src/lib/jobs.ts               withJobRun() wrapper + getStaleness()
src/lib/ingest/types.ts       FetchedItem, SourceAdapter (contract below)
src/lib/ingest/adapters/{rss,hn,reddit,arxiv,huggingface,github}.ts
src/lib/ingest/ingest.ts      runIngest()
src/lib/curate/cluster.ts     titleSimilarity(), clusterNewItems()
src/lib/curate/curate.ts      runCurate()
src/lib/board/sync.ts         runBoardSync() → snapshots + proposals
src/lib/board/apply.ts        applyProposal()/rejectProposal()
src/lib/brief/brief.ts        runBrief()
worker/index.ts               cron schedules; worker/run.ts manual job trigger
scripts/seed.ts               create admin user + seed sources/board
src/app/globals.css           design tokens (written in Phase A — shared style contract)
src/app/layout.tsx            root layout
src/app/login/page.tsx
src/app/api/auth/{login,logout}/route.ts
src/app/api/{votes,verdicts,seen,sources}/route.ts
src/app/api/sources/[id]/route.ts
src/app/api/proposals/[id]/route.ts
src/app/(hub)/layout.tsx      auth gate + nav + staleness banner + unread counts
src/app/(hub)/page.tsx        Today
src/app/(hub)/domain/[slug]/page.tsx
src/app/(hub)/board/page.tsx
src/app/(hub)/brief/page.tsx  latest + ?date= archive
src/app/(hub)/admin/page.tsx  sources CRUD + health, job runs, proposals queue
src/components/{StoryCard,VoteButtons,DomainChips,BoardTable,VerdictEditor,ProposalCard,SourcesPanel,JobsPanel}.tsx
tests/fixtures/{rss2.xml,atom.xml,arxiv.xml,hn.json,reddit.json,hf-models.json,hf-papers.json,github-trending.html}
tests/{session,cluster,adapters,curate,board-apply}.test.ts
```

## Contract 1 — Domains (`src/lib/domains.ts`)

```ts
export const DOMAINS = ['coding', 'copy', 'image', 'video', 'ads', 'agentic'] as const;
export type Domain = (typeof DOMAINS)[number];
export const DOMAIN_LABELS: Record<Domain, string> = {
  coding: 'Coding', copy: 'Copy', image: 'Image Gen',
  video: 'Video Gen', ads: 'Ads', agentic: 'Agentic',
};
// Domain accent colors (CSS var names defined in globals.css)
export const DOMAIN_COLORS: Record<Domain, string> = {
  coding: 'var(--d-coding)', copy: 'var(--d-copy)', image: 'var(--d-image)',
  video: 'var(--d-video)', ads: 'var(--d-ads)', agentic: 'var(--d-agentic)',
};
export const DOMAIN_MEMBERSHIP_THRESHOLD = 40; // score >= 40 → story belongs to domain
```

## Contract 2 — Drizzle schema (`src/lib/db/schema.ts`, complete)

```ts
import { sqliteTable, text, integer, primaryKey, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: text('role', { enum: ['admin', 'member'] }).notNull().default('member'),
  lastSeenAt: integer('last_seen_at', { mode: 'timestamp' }),
});

export const sources = sqliteTable('sources', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  type: text('type', { enum: ['rss', 'hn', 'reddit', 'arxiv', 'huggingface', 'github'] }).notNull(),
  name: text('name').notNull(),
  config: text('config').notNull().default('{}'),        // JSON, see adapter contract
  domainHints: text('domain_hints').notNull().default('[]'), // JSON Domain[]
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  lastFetchedAt: integer('last_fetched_at', { mode: 'timestamp' }),
  lastStatus: text('last_status'),
  consecutiveFailures: integer('consecutive_failures').notNull().default(0),
});

export const stories = sqliteTable('stories', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  title: text('title').notNull(),
  tldr: text('tldr'),
  whyItMatters: text('why_it_matters'),
  domainScores: text('domain_scores'),                  // JSON Record<Domain, number> | null
  topScore: integer('top_score').notNull().default(0),
  status: text('status', { enum: ['raw', 'curated'] }).notNull().default('raw'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

export const items = sqliteTable('items', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  sourceId: integer('source_id').notNull().references(() => sources.id),
  url: text('url').notNull().unique(),
  title: text('title').notNull(),
  excerpt: text('excerpt'),
  publishedAt: integer('published_at', { mode: 'timestamp' }),
  fetchedAt: integer('fetched_at', { mode: 'timestamp' }).notNull(),
  storyId: integer('story_id').references(() => stories.id), // null = unclustered
});

export const votes = sqliteTable('votes', {
  userId: integer('user_id').notNull().references(() => users.id),
  storyId: integer('story_id').notNull().references(() => stories.id),
  value: integer('value').notNull(), // 1 | -1
}, (t) => [primaryKey({ columns: [t.userId, t.storyId] })]);

export const boardEntries = sqliteTable('board_entries', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  domain: text('domain').notNull(),
  task: text('task').notNull(),
  bestOverall: text('best_overall'),
  bestValue: text('best_value'),
  cheapestViable: text('cheapest_viable'),
  costNote: text('cost_note'),
  runelabsVerdict: text('runelabs_verdict'),
  verdictAuthor: text('verdict_author'),
  updatedAt: integer('updated_at', { mode: 'timestamp' }),
}, (t) => [uniqueIndex('board_domain_task').on(t.domain, t.task)]);

export const boardProposals = sqliteTable('board_proposals', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  domain: text('domain').notNull(),
  task: text('task').notNull(),
  proposed: text('proposed').notNull(), // JSON {bestOverall,bestValue,cheapestViable,costNote}
  rationale: text('rationale').notNull(),
  status: text('status', { enum: ['pending', 'approved', 'rejected'] }).notNull().default('pending'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

export const boardHistory = sqliteTable('board_history', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  domain: text('domain').notNull(),
  task: text('task').notNull(),
  change: text('change').notNull(),
  appliedAt: integer('applied_at', { mode: 'timestamp' }).notNull(),
});

export const benchmarkSnapshots = sqliteTable('benchmark_snapshots', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  source: text('source').notNull(),
  raw: text('raw').notNull(),
  fetchedAt: integer('fetched_at', { mode: 'timestamp' }).notNull(),
});

export const briefs = sqliteTable('briefs', {
  date: text('date').primaryKey(), // YYYY-MM-DD
  markdown: text('markdown').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

export const jobRuns = sqliteTable('job_runs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  job: text('job').notNull(), // 'ingest' | 'curate' | 'board' | 'brief'
  startedAt: integer('started_at', { mode: 'timestamp' }).notNull(),
  finishedAt: integer('finished_at', { mode: 'timestamp' }),
  status: text('status', { enum: ['running', 'ok', 'error'] }).notNull(),
  error: text('error'),
  stats: text('stats'), // JSON
});

export const llmUsage = sqliteTable('llm_usage', {
  date: text('date').primaryKey(), // YYYY-MM-DD
  calls: integer('calls').notNull().default(0),
});
```

Note: spec mentioned a `story_items` join table — implemented instead as nullable `items.storyId` FK (equivalent, simpler; an item belongs to at most one story).

## Contract 3 — Ingest adapter (`src/lib/ingest/types.ts`)

```ts
import type { sources } from '../db/schema';
export type Source = typeof sources.$inferSelect;

export interface FetchedItem {
  url: string;
  title: string;
  excerpt: string | null;      // plain text, <= 500 chars
  publishedAt: Date | null;
}

export interface SourceAdapter {
  type: Source['type'];
  fetchItems(source: Source): Promise<FetchedItem[]>;
}
```

Adapter configs (`sources.config` JSON) and endpoints:
- **rss** `{url}` — fetch URL, parse with fast-xml-parser; support both RSS 2.0 (`rss.channel.item[]`: title/link/description/pubDate) and Atom (`feed.entry[]`: title/link@href/summary|content/updated|published). Strip HTML tags from excerpt.
- **hn** `{query, minPoints}` — `https://hn.algolia.com/api/v1/search_by_date?query=<query>&tags=story&numericFilters=points>=<minPoints>&hitsPerPage=30`; map `hits[]`: title, url (fallback `https://news.ycombinator.com/item?id=<objectID>`), excerpt null, publishedAt from `created_at`.
- **reddit** `{subreddit}` — `https://www.reddit.com/r/<subreddit>/top.json?t=day&limit=25` with User-Agent `runelabs-radar/1.0`; map `data.children[].data`: title, `https://www.reddit.com<permalink>`, excerpt from selftext (truncated), publishedAt from `created_utc*1000`.
- **arxiv** `{query, maxResults}` — `http://export.arxiv.org/api/query?search_query=<query>&sortBy=submittedDate&sortOrder=descending&max_results=<maxResults>`; Atom parse: entry title (whitespace-collapsed), entry.id as url, summary as excerpt, published.
- **huggingface** `{kind: 'models' | 'papers'}` — models: `https://huggingface.co/api/models?sort=trendingScore&direction=-1&limit=20` → title=modelId, url=`https://huggingface.co/<modelId>`, publishedAt from lastModified; papers: `https://huggingface.co/api/daily_papers?limit=20` → paper.title, `https://huggingface.co/papers/<paper.id>`, excerpt from paper.summary, publishedAt from publishedAt.
- **github** `{language?}` — scrape `https://github.com/trending/<language?>?since=daily` HTML; regex `<h2 class="h3 lh-condensed">` blocks / `href="/owner/repo"` article links; title `owner/repo`, url `https://github.com/owner/repo`, excerpt from the description `<p>`. Any parse failure → return `[]` (log, never throw past adapter).

All adapters: 15s AbortController timeout, single fetch, no retries (next cron tick retries naturally).

`runIngest()` (`src/lib/ingest/ingest.ts`): for each enabled source → adapter → `INSERT OR IGNORE` items by unique url (`onConflictDoNothing`), set fetchedAt=now; per-source try/catch updating lastStatus/lastFetchedAt/consecutiveFailures (0 on success, +1 on failure). Returns `{sourcesOk, sourcesFailed, newItems}`.

## Contract 4 — Session token (`src/lib/auth/session.ts`)

```ts
// Token format: "<uid>.<expiresEpochMs>.<hmacHex>"
// hmac = HMAC-SHA256(`${uid}.${expires}`, SESSION_SECRET)
export function signSession(userId: number, ttlMs?: number): string;   // default 30d
export function verifySession(token: string | undefined): number | null; // userId | null (bad sig/expired/malformed)
export const SESSION_COOKIE = 'radar_session';
```
Uses `node:crypto` createHmac + timingSafeEqual. No deps.

`src/lib/auth/user.ts` (server-only): `getCurrentUser()` reads cookie via `next/headers`, verifies, loads user row; `requireUser()` redirects to `/login` when null; `requireAdmin()` also 403s non-admins. API routes use `getCurrentUser()` and return 401/403 JSON.

## Contract 5 — MiniMax client (`src/lib/llm/minimax.ts`)

```ts
// POST {MINIMAX_BASE_URL}/chat/completions  (OpenAI-compatible)
// body: { model: MINIMAX_MODEL, messages: [{role:'system',...},{role:'user',...}], temperature: 0.2 }
// Auth: Authorization: Bearer MINIMAX_API_KEY
export class LlmError extends Error { retryable: boolean }
export async function chatJSON<T>(system: string, user: string): Promise<T>;
```
Behavior: checks/increments `llm_usage` daily counter first — throws non-retryable LlmError when `calls >= MINIMAX_DAILY_CALL_CAP`. 3 attempts, backoff 1s/4s (429/5xx/network retryable; 4xx not). Extracts first `{...}` JSON block from `choices[0].message.content` (handles code fences). Injectable fetch for tests: `export function _setFetch(f: typeof fetch)`.

Env (`src/lib/config.ts`, all read lazily): `DATABASE_PATH` (default `./data/radar.db`), `SESSION_SECRET` (required in prod, dev default `dev-secret`), `MINIMAX_API_KEY`, `MINIMAX_BASE_URL` (default `https://api.minimax.io/v1`), `MINIMAX_MODEL` (default `MiniMax-M2`), `MINIMAX_DAILY_CALL_CAP` (default 500), `AA_API_KEY` (optional).

## Contract 6 — API routes (JSON bodies; UI phase codes against these)

| Route | Method | Body | Auth | Response |
|---|---|---|---|---|
| /api/auth/login | POST | `{name, password}` | — | 200 + Set-Cookie / 401 |
| /api/auth/logout | POST | — | user | 200, clears cookie |
| /api/votes | POST | `{storyId, value: 1\|-1\|0}` (0 = remove) | user | `{ok:true, up, down}` |
| /api/verdicts | POST | `{entryId, verdict}` | user | `{ok:true}` (sets verdictAuthor=user.name, updatedAt) |
| /api/seen | POST | — | user | `{ok:true}` (users.lastSeenAt=now) |
| /api/proposals/[id] | POST | `{action:'approve'\|'reject'}` | admin | `{ok:true}` |
| /api/sources | POST | `{type,name,config,domainHints,enabled}` | admin | `{ok:true,id}` |
| /api/sources/[id] | PATCH / DELETE | partial fields / — | admin | `{ok:true}` |

## Contract 7 — Curation & jobs

`cluster.ts`:
```ts
export function normalizeTitle(t: string): string[]; // lowercase, strip punct, drop stopwords, tokens
export function titleSimilarity(a: string, b: string): number; // Jaccard 0..1
// For each unclustered item: attach to an existing story from the last 72h when
// similarity(item.title, story.title) >= 0.55, else create a new story (status 'raw',
// title = item title, createdAt = item.publishedAt ?? fetchedAt). Sets items.storyId.
export async function clusterNewItems(): Promise<{ newStories: number; merged: number }>;
```

`curate.ts` — `runCurate()`: cluster first, then for up to `CURATE_BATCH_LIMIT` (50) oldest `raw` stories: one `chatJSON` call each. System prompt: Runelabs context (vibecoding startup farm; six domains defined), scoring rubric, output shape `{"domain_scores":{"coding":0-100,...all six...},"tldr":"...","why_it_matters":"..."}`. User prompt: story title + up to 5 member item titles/excerpts + up to 10 recent votes as calibration lines (`[UP|DOWN] <story title>`). On success: update story (scores, tldr, whyItMatters, topScore=max score, status 'curated'). On LlmError: leave `raw`, continue; abort batch early if non-retryable cap error.

`board/sync.ts` — `runBoardSync()`: (1) snapshots: Artificial Analysis `GET https://artificialanalysis.ai/api/v2/data/llms/models` header `x-api-key: AA_API_KEY` (skip if unset); aider leaderboard best-effort raw fetch; each stored in benchmark_snapshots, individually try/caught. (2) one `chatJSON` call per domain: latest snapshots (truncated to ~8k chars) + top 15 stories of the week + current board rows for that domain → `{"proposals":[{"task","bestOverall","bestValue","cheapestViable","costNote","rationale"}]}` → insert pending board_proposals. No benchmark data → still propose from news, rationale prefixed `[news-derived]`.

`board/apply.ts` — `applyProposal(id, adminUserId)`: upsert board_entries by (domain,task) with proposed fields, mark proposal approved, append board_history (`change` = human-readable diff summary, e.g. `bestOverall: GPT-5.2 → Claude Fable 5`). `rejectProposal(id)`: mark rejected.

`brief/brief.ts` — `runBrief()`: top 10 curated stories of last 24h (topScore desc) + board_history last 7d → one `chatJSON` `{"markdown":"..."}` → upsert briefs[today]. Fewer than 3 stories → write a short "quiet day" brief without LLM.

`jobs.ts` — `withJobRun(name, fn)`: inserts running row, runs fn, records ok/error + stats. `getStaleness()`: hours since last ok run of ingest/curate → layout banner shows warning when ingest > 2h or curate > 3h.

## Contract 8 — UI style (globals.css written in Phase A)

Dark, dense, tool-like. CSS vars: `--bg:#0b0e14; --panel:#121722; --panel-2:#171d2b; --border:#232b3d; --text:#e8ebf3; --muted:#8b93a7; --accent:#7c5cff; --up:#3fb67d; --down:#e05252;` domain colors `--d-coding:#5b9dff; --d-copy:#ffb454; --d-image:#ff6ec7; --d-video:#b48bff; --d-ads:#3fd2c7; --d-agentic:#9ccc3d;`. Layout: fixed left sidebar nav (200px) + content max-width 980px. Cards: panel bg, 1px border, 8px radius, 14px/13px type scale.

Initial seed data (`db/seed-data.ts`): sources — RSS: OpenAI News, Anthropic News, Google DeepMind Blog, Mistral News, MiniMax Blog, Runway Research, Black Forest Labs, ElevenLabs Blog, Hugging Face Blog, Simon Willison; hn: query "AI OR LLM OR GPT OR Claude OR Gemini" minPoints 50; reddit: LocalLLaMA, StableDiffusion, aivideo; arxiv: `cat:cs.AI OR cat:cs.CL` max 40; huggingface: models + papers; github: (no language). Board tasks — coding: agentic-coding, autocomplete, code-review; copy: long-form, ad-copy, social; image: product-shots, illustration, photoreal; video: text-to-video, image-to-video, avatar/talking-head; ads: creative-generation, campaign-management; agentic: browser-automation, computer-use, orchestration.

---

## Phases

### Phase A — Scaffold & tooling
**Files:** package.json, tsconfig.json, next.config.ts, postcss.config.mjs, drizzle.config.ts, vitest.config.ts, .gitignore, .env.example, src/app/globals.css, src/app/layout.tsx, src/lib/config.ts, src/lib/domains.ts
- [ ] Write all config files; deps (exact): next@^15, react@^19, react-dom@^19, better-sqlite3, drizzle-orm, bcryptjs, fast-xml-parser, node-cron; dev: typescript, @types/node, @types/react, @types/react-dom, @types/better-sqlite3, @types/bcryptjs, @types/node-cron, drizzle-kit, tsx, vitest, tailwindcss@^4, @tailwindcss/postcss
- [ ] `npm install` — expect clean install
- [ ] Commit `chore: scaffold Next.js + tooling`

### Phase B — Database
**Files:** src/lib/db/schema.ts (Contract 2 verbatim), src/lib/db/index.ts, src/lib/db/seed-data.ts, scripts/seed.ts, drizzle/ migrations
- [ ] Write schema + getDb() (singleton, WAL pragma, `migrate()` on open, mkdir data dir)
- [ ] `npx drizzle-kit generate` — expect one migration SQL file
- [ ] Write seed-data.ts + scripts/seed.ts (`npm run seed -- --admin <name> <password>`: upserts admin, sources, board entries)
- [ ] `npm run seed -- --admin specter test123` then `sqlite3`-free verify via a tsx one-liner counting rows
- [ ] Commit `feat: database schema, migrations, seed`

### Phase C — Core libs
**Files:** src/lib/auth/session.ts, src/lib/auth/user.ts, src/lib/llm/minimax.ts, src/lib/jobs.ts, tests/session.test.ts
- [ ] Write session sign/verify (Contract 4) + tests: round-trip, tampered sig → null, expired → null, garbage → null
- [ ] `npx vitest run tests/session.test.ts` — PASS
- [ ] Write user.ts, minimax.ts (Contract 5), jobs.ts
- [ ] Commit `feat: auth session, MiniMax client, job wrapper`

### Phase D — Ingestion (parallel agent)
**Files:** src/lib/ingest/types.ts, adapters/*.ts, ingest.ts, tests/adapters.test.ts, tests/fixtures/*
- [ ] Fixtures for all 6 adapter types; tests assert mapped FetchedItem fields (mock global fetch)
- [ ] Implement adapters per Contract 3 + runIngest()
- [ ] `npx vitest run tests/adapters.test.ts` — PASS
- [ ] Commit `feat: ingestion adapters + ingest job`

### Phase E — Curation (parallel agent)
**Files:** src/lib/curate/cluster.ts, curate.ts, tests/cluster.test.ts, tests/curate.test.ts
- [ ] cluster tests: near-duplicate titles ≥0.55, unrelated <0.3, clusterNewItems() merges into in-memory sqlite
- [ ] curate tests: mocked chatJSON → story updated (scores/tldr/status); LLM failure → stays raw
- [ ] Implement per Contract 7
- [ ] `npx vitest run tests/cluster.test.ts tests/curate.test.ts` — PASS
- [ ] Commit `feat: clustering + MiniMax curation`

### Phase F — Board & brief (parallel agent)
**Files:** src/lib/board/sync.ts, apply.ts, src/lib/brief/brief.ts, tests/board-apply.test.ts
- [ ] apply tests: approve upserts entry + history row + proposal status; reject only flips status
- [ ] Implement per Contract 7
- [ ] `npx vitest run tests/board-apply.test.ts` — PASS
- [ ] Commit `feat: board sync, proposals, daily brief`

### Phase G — API routes (parallel agent)
**Files:** src/app/api/** per Contract 6
- [ ] Implement all routes; zod-free manual validation (small payloads); consistent `{error}` JSON on 4xx
- [ ] Commit `feat: API routes`

### Phase H — UI core (parallel agent)
**Files:** src/app/login/page.tsx, src/app/(hub)/layout.tsx, (hub)/page.tsx, (hub)/domain/[slug]/page.tsx, components/{StoryCard,VoteButtons,DomainChips}.tsx
- [ ] Login form → POST /api/auth/login → redirect /
- [ ] Hub layout: requireUser(), sidebar nav (Today/domains/Board/Brief/Admin-if-admin), staleness banner, per-domain unread badges (stories since lastSeenAt with domainScore ≥ 40)
- [ ] Today: curated stories last 72h by topScore desc + "since your last visit" divider (lastSeenAt) + raw-stories fallback section; visiting updates lastSeenAt AFTER computing divider. StoryCard: title (link to first item url), source count, TLDR, why-it-matters, domain score chips, votes
- [ ] Domain page: same list where domainScores[slug] ≥ 40, sorted by that domain's score
- [ ] Commit `feat: hub UI core`

### Phase I — UI board/brief/admin (parallel agent)
**Files:** (hub)/board/page.tsx, brief/page.tsx, admin/page.tsx, components/{BoardTable,VerdictEditor,ProposalCard,SourcesPanel,JobsPanel}.tsx
- [ ] Board: grouped by domain; columns Task / Best overall / Best value / Cheapest viable / Cost note / Verdict (inline-editable → POST /api/verdicts, shows author); "changed this week" list from board_history
- [ ] Brief: latest markdown rendered (simple md→html, no dep — headings/bold/lists/links) + date archive nav
- [ ] Admin (requireAdmin): pending proposals (approve/reject), sources table (health: lastStatus, failures, enable/disable/add/edit/delete), job runs table
- [ ] Commit `feat: board, brief, admin UI`

### Phase J — Worker, Docker, docs
**Files:** worker/index.ts, worker/run.ts, Dockerfile, docker-compose.yml, README.md, .env.example (final)
- [ ] worker: node-cron — ingest `*/30 * * * *`, curate `5 * * * *`, board `0 6 * * 1`, brief `0 7 * * *`; ingest once on boot; graceful SIGTERM
- [ ] run.ts: `npm run job -- ingest|curate|board|brief`
- [ ] Dockerfile (node:22-slim, multi-stage; web: `next start`; worker: `tsx worker/index.ts`), compose with shared ./data volume, README: setup, env, seed, Hetzner + Caddy snippet
- [ ] Commit `feat: worker schedules + deployment`

### Phase K — Verify & review
- [ ] `npx vitest run` — ALL PASS
- [ ] `npm run build` (next build) — succeeds, no type errors
- [ ] Seed dev DB, `npm run job -- ingest` against real internet — expect items > 0
- [ ] Boot dev server, login, verify Today/Board/Admin render
- [ ] Code-review agents (bugs/security/consistency) → fix confirmed findings → re-run tests + build
- [ ] Final commit + `<promise>COMPLETE</promise>`

## Self-review notes
- Spec coverage: ingestion (D), curation+votes calibration (E), board hybrid+proposals (F,G,I), brief (F,I), unread/last-visit (H), health panel (I), staleness banner (C,H), auth roles (C,G), Docker (J), tests (C–F,K). Push digests intentionally absent (out of scope).
- `story_items` divergence documented at Contract 2.
- Type names in later phases match Contracts 1–7.
