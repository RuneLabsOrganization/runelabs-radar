# MCP Opportunity Generation Ladder — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace a shared, convergent, self-starving opportunity pool with a three-rung generation ladder that gives every MCP caller an effectively unbounded supply of openings that are unique to them.

**Architecture:** Ownership moves onto the existing `opportunities` table via a nullable `owner_user_id` (`NULL` = canonical public radar). A new deterministic composition layer (Rung 0) crosses intelligence primitives against an admin-editable wedge taxonomy to produce unlimited zero-LLM "leads"; one metered LLM call refines a caller's leads into scored opportunities (Rung 1); an explicit, quota-checked multi-call pass forges a single opening into a plan-grade dossier (Rung 2). Quota counters move from in-memory `Map`s to SQLite so the ladder survives restarts and multiple replicas.

**Tech Stack:** TypeScript, Next.js 15, Drizzle ORM 0.44 + better-sqlite3 (SQLite/WAL), `@modelcontextprotocol/sdk` 1.30, Zod 3, Vitest 3, MiniMax (`MiniMax-M2`) for LLM calls.

---

## Context for a fresh agent

You have no memory of the discussion that produced this plan. Read this section before Task 1; it explains *why* each change exists, so you can make good judgement calls when reality differs from the plan.

### What this repo is

Runelabs Radar ingests AI-industry news, curates it with an LLM, and sells the result as decision-ready intelligence. There are three processes sharing one SQLite file:

- **worker** (`npm run worker`) — cron ingestion, curation, daily brief.
- **web** (`npm run dev`) — Next.js hub, and the OAuth 2.1 authorization server for MCP clients.
- **mcp** (`npm run mcp`, port 3122) — the agent-facing product. This is the main product and the subject of this plan.

The MCP server registers ~25 tool modules from `mcp/tools/*.ts` through `mcp/build.ts`. Read [`mcp/build.ts`](../../../mcp/build.ts) first — it is the index of the whole surface.

### The three defects this plan fixes

**Defect 1 — `scout_opportunities` poisons the global pool, then starves itself.**

`opportunities` ([`src/lib/db/schema.ts:272`](../../../src/lib/db/schema.ts)) has no owner column. But `scout_opportunities` — the *personalized* tool — calls `persistScoutDrafts()` ([`src/lib/opportunities/persist-scout.ts`](../../../src/lib/opportunities/persist-scout.ts)), which writes each caller's private, constraint-fitted openings into that shared table with `status: 'active'`. Two things follow:

1. Every user's private openings leak into *everyone else's* `get_opportunities`.
2. Scout filters its own drafts against `activeSlugs()` ([`mcp/tools/scout.ts:47`](../../../mcp/tools/scout.ts)) to keep results "fresh". Once the shared pool saturates, later callers get `openings: []` with the message *"every one is already tracked"*. **The feature returns nothing precisely because it worked for someone else.**

**Defect 2 — generation is caller-invariant, so the LLM converges.**

`buildContext()` ([`src/lib/opportunities/engine.ts:161`](../../../src/lib/opportunities/engine.ts)) builds an identical prompt block for every caller: top 12 pains, 8 patterns, 10 entities, 10 stories, all with fixed `ORDER BY`. Identical context + identical prompt + `MAX_PROPOSALS = 6` produces the same handful of ideas for everybody. The existing anti-homogeneity machinery in `mcp/tools/opportunities.ts` (`saltHash`, `SECTOR_QUOTA`, `CROWDED_PENALTY`, `fitBonus`) is **ordering-only** — it shuffles a thin deck rather than dealing more cards.

**Defect 3 — quota and rate state is in-memory.**

`buckets` ([`mcp/server.ts:33`](../../../mcp/server.ts)) and `scoutUsage` ([`mcp/tools/scout.ts:17`](../../../mcp/tools/scout.ts)) are module-level `Map`s. They reset on every deploy, do not work across replicas, and `scoutUsage` never garbage-collects. A paid spend ladder that a restart resets is not a real ladder.

### The design being implemented

**Rung 0 — Compose · 0 LLM calls.** Deterministic. Crosses *primitives* (pains, patterns, entities, stories) against a *wedge* (business model × delivery form × buyer × moat play) drawn from an admin-editable taxonomy. Each caller receives a **seeded, non-overlapping slice** of the combination space, so two callers structurally cannot receive the same leads. Output is a `LeadDraft`: title, thesis skeleton, evidence refs, heuristic score. Unlimited and free.

**Rung 1 — Refine · 1 LLM call.** Turns a caller's top leads into real theses with sub-scores and KPIs, reusing the existing `sanitizeOpportunities` + `applyGate` pipeline. Seeded from the caller's unique slice — *this* is what kills convergence, not the ordering jitter.

**Rung 2 — Forge · multi-call, explicit.** Deep adversarial pass on one opening, reusing `runCritique`/`runDebate` from `src/lib/opportunities/critic.ts`. Quota-checked and invoked by its own tool so the spend is never a surprise.

**Tier mapping.** Free: unlimited Rung 0 + 3 Rung-1/month. Builder: unlimited Rung 0 + 50 Rung-1 + 5 Rung-2. Factory: unlimited Rung 0/1 + 30 Rung-2.

**Leads are labeled distinctly.** Rung-0 output is heuristic and never LLM-reviewed. It returns as a **lead**, with no `verdict` and no `flip_score`, so an agent cannot mistake an unreviewed cross-product for a reviewed dossier. This distinction is load-bearing for trust — do not collapse leads and opportunities into one shape.

**Anonymous callers** (self-host default, `MCP_AUTH_REQUIRED` unset) get an ephemeral Rung-0 pool keyed by `auth.rateKey` with a 7-day expiry, and no Rung 1/2. Persistent private pools require a `userId`.

### Conventions you must follow

- **Path aliases:** app code imports use `@/lib/...`; files under `mcp/` use relative imports (`../../src/lib/db`). Match the file you are editing.
- **Every MCP tool** returns via `respond(data, { summary, next, economy })` from [`mcp/lib/payload.ts`](../../../mcp/lib/payload.ts). `summary` is a one-sentence natural-language result; `next` is prefilled follow-up calls; `economy` comes from `withUserEconomy(auth.userId, kind)`. Spread `...envelopeSchema` into every `outputSchema`.
- **Migrations:** edit `src/lib/db/schema.ts`, then run `npm run db:generate`. Some steps below require hand-written SQL — those say so explicitly.
- **Tests:** Vitest. `useTestDb()` from [`tests/helpers/db.ts`](../../../tests/helpers/db.ts) installs a migrated in-memory DB as the process singleton. Wire MCP tools with `InMemoryTransport` and register **only the tools under test** — never `buildServer`. Copy the pattern in [`tests/debate-scout.test.ts`](../../../tests/debate-scout.test.ts).
- **Never call a real LLM in a test.** Either `vi.mock('@/lib/opportunities/critic', ...)` or inject a fake fetch with `_setFetch` from `@/lib/llm/minimax`.
- **Commit after every task.** Conventional commits (`feat:`, `fix:`, `refactor:`, `test:`).

### Verification baseline

Before starting, confirm the suite is green so later failures are attributable to your changes:

```bash
npm test
```

Expected: all tests pass. If anything is already red, note which and tell the user before proceeding.

---

## File structure

| File | Responsibility | Task |
|---|---|---|
| `src/lib/usage/counters.ts` | **Create.** Persisted quota/rate windows, replacing in-memory `Map`s. | 1 |
| `src/lib/db/schema.ts` | **Modify.** Add `usageCounters`, `wedgeValues`, `leads`; add `ownerUserId` to `opportunities`. | 1, 3, 6, 11 |
| `mcp/server.ts` | **Modify.** Rate limiter reads `counters.ts`. | 2 |
| `mcp/tools/opportunities.ts` | **Modify.** Owner-scoped reads, SQL limit, cursor pagination. | 4 |
| `src/lib/opportunities/persist-scout.ts` | **Modify.** Write owner-scoped rows. | 5 |
| `src/lib/opportunities/wedges.ts` | **Create.** Taxonomy loading + `isCompatible`. Pure logic, DB read only. | 7 |
| `src/lib/opportunities/seed.ts` | **Create.** Deterministic `(ownerKey, day, cursor) → slice`. Pure: no DB, no LLM. | 8 |
| `src/lib/opportunities/primitives.ts` | **Create.** Extract + tag intelligence primitives for composition. | 9 |
| `src/lib/opportunities/compose.ts` | **Create.** Rung 0: primitives × wedges → `LeadDraft[]`. Pure. | 10 |
| `src/lib/opportunities/leads.ts` | **Create.** Lead repository (insert/list/get/dismiss/expire). | 11 |
| `mcp/tools/leads.ts` | **Create.** `get_leads`, `dismiss_opportunity`. | 12, 18 |
| `src/lib/opportunities/refine.ts` | **Create.** Rung 1: leads → `OppDraft[]` in one call. | 13 |
| `mcp/tools/scout.ts` | **Modify.** Becomes compose→refine; gains `refine_lead`. | 14 |
| `src/lib/entitlements.ts` | **Modify.** Add `forge` + `lead_refine` capabilities and tier caps. | 15 |
| `src/lib/opportunities/forge.ts` | **Create.** Rung 2: multi-call deep pass. | 16 |
| `mcp/tools/forge.ts` | **Create.** `forge_opportunity`. | 17 |
| `mcp/build.ts`, `mcp/prompts.ts`, `mcp/resources.ts`, `README.md` | **Modify.** Register and document the new surface. | 19 |

`seed.ts` and `compose.ts` deliberately have no I/O — they are where the "nonsense pairing" risk lives, so they must be exhaustively unit-testable without fixtures.

---

# Phase 0 — Persisted counters

Nothing user-visible changes here. This phase makes metering trustworthy so the ladder above it can be enforced.

## Task 1: Persisted usage counters

**Files:**
- Modify: `src/lib/db/schema.ts`
- Create: `src/lib/usage/counters.ts`
- Create: `tests/usage-counters.test.ts`

- [ ] **Step 1: Add the table to the schema**

Append to `src/lib/db/schema.ts`. No import changes are needed — `index`, `primaryKey`, `sqliteTable`, `text` and `integer` are all already imported at the top of the file.

```ts
/**
 * Durable replacement for the in-memory rate/quota Maps in mcp/server.ts and
 * the per-tool daily caps. Keyed by (bucket, feature, windowStart) so a fixed
 * window is a single upsert-and-read. Survives deploys; correct across replicas.
 */
export const usageCounters = sqliteTable(
  'usage_counters',
  {
    // 'user:123' or 'ip:1.2.3.4' — the AuthContext.rateKey, verbatim
    bucket: text('bucket').notNull(),
    // 'rate' | 'scout' | 'debate' | 'lead_refine' | 'forge' | ...
    feature: text('feature').notNull(),
    // start of the fixed window, epoch ms — hour/day granularity
    windowStart: integer('window_start', { mode: 'timestamp' }).notNull(),
    count: integer('count').notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.bucket, t.feature, t.windowStart] }),
    index('usage_counters_window').on(t.windowStart),
  ],
);
```

- [ ] **Step 2: Generate the migration**

```bash
npm run db:generate
```

Expected: a new `drizzle/0029_*.sql` containing `CREATE TABLE \`usage_counters\``. Open it and confirm it creates the table and the `usage_counters_window` index, and touches nothing else. If it contains unrelated `ALTER`/`DROP` statements, stop and report — the schema file has drifted from the migration history.

- [ ] **Step 3: Write the failing test**

Create `tests/usage-counters.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { bump, peek, gcCounters } from '@/lib/usage/counters';
import { useTestDb } from './helpers/db';

describe('usage counters', () => {
  beforeEach(() => {
    useTestDb();
  });

  it('counts within a window and resets in the next one', () => {
    const t1 = new Date('2026-08-25T10:15:00Z');
    expect(bump('ip:1.2.3.4', 'rate', 'hour', t1)).toBe(1);
    expect(bump('ip:1.2.3.4', 'rate', 'hour', t1)).toBe(2);
    expect(peek('ip:1.2.3.4', 'rate', 'hour', t1)).toBe(2);

    // same hour, later minute — still the same bucket
    const t2 = new Date('2026-08-25T10:59:59Z');
    expect(bump('ip:1.2.3.4', 'rate', 'hour', t2)).toBe(3);

    // next hour — fresh window
    const t3 = new Date('2026-08-25T11:00:00Z');
    expect(peek('ip:1.2.3.4', 'rate', 'hour', t3)).toBe(0);
    expect(bump('ip:1.2.3.4', 'rate', 'hour', t3)).toBe(1);
  });

  it('isolates buckets and features', () => {
    const t = new Date('2026-08-25T10:00:00Z');
    bump('ip:1.1.1.1', 'rate', 'hour', t);
    bump('ip:1.1.1.1', 'rate', 'hour', t);
    bump('ip:2.2.2.2', 'rate', 'hour', t);
    bump('ip:1.1.1.1', 'scout', 'day', t);

    expect(peek('ip:1.1.1.1', 'rate', 'hour', t)).toBe(2);
    expect(peek('ip:2.2.2.2', 'rate', 'hour', t)).toBe(1);
    expect(peek('ip:1.1.1.1', 'scout', 'day', t)).toBe(1);
  });

  it('uses UTC day boundaries for day windows', () => {
    const late = new Date('2026-08-25T23:30:00Z');
    const early = new Date('2026-08-26T00:30:00Z');
    bump('user:7', 'scout', 'day', late);
    expect(peek('user:7', 'scout', 'day', late)).toBe(1);
    expect(peek('user:7', 'scout', 'day', early)).toBe(0);
  });

  it('gc removes only windows older than the retention cutoff', () => {
    const old = new Date('2026-08-01T10:00:00Z');
    const now = new Date('2026-08-25T10:00:00Z');
    bump('ip:9.9.9.9', 'rate', 'hour', old);
    bump('ip:9.9.9.9', 'rate', 'hour', now);

    const removed = gcCounters(now);
    expect(removed).toBe(1);
    expect(peek('ip:9.9.9.9', 'rate', 'hour', now)).toBe(1);
  });
});
```

- [ ] **Step 4: Run it and watch it fail**

```bash
npx vitest run tests/usage-counters.test.ts
```

Expected: FAIL — `Failed to resolve import "@/lib/usage/counters"`.

- [ ] **Step 5: Implement the counters**

Create `src/lib/usage/counters.ts`:

```ts
/**
 * Durable fixed-window counters for rate limits and per-feature caps.
 *
 * Replaces the module-level Maps that previously lived in mcp/server.ts and
 * mcp/tools/scout.ts: those reset on deploy and are wrong the moment a second
 * replica exists. One row per (bucket, feature, windowStart); reads and writes
 * are a single statement each.
 *
 * Windows are UTC-aligned so a quota never wobbles with the server timezone.
 */
import { and, eq, lt, sql } from 'drizzle-orm';
import { getDb } from '../db';
import { usageCounters } from '../db/schema';

export type CounterWindow = 'hour' | 'day';

/** Rows older than this are garbage — no window in use is longer than a day. */
const RETENTION_MS = 2 * 864e5;

/** UTC-aligned start of the window containing `now`. */
export function windowStart(window: CounterWindow, now: Date = new Date()): Date {
  if (window === 'hour') {
    return new Date(Date.UTC(
      now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours(),
    ));
  }
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** Increment and return the new count for this bucket/feature/window. */
export function bump(
  bucket: string,
  feature: string,
  window: CounterWindow,
  now: Date = new Date(),
): number {
  const db = getDb();
  const start = windowStart(window, now);
  db.insert(usageCounters)
    .values({ bucket, feature, windowStart: start, count: 1 })
    .onConflictDoUpdate({
      target: [usageCounters.bucket, usageCounters.feature, usageCounters.windowStart],
      set: { count: sql`${usageCounters.count} + 1` },
    })
    .run();
  return peek(bucket, feature, window, now);
}

/** Current count without incrementing. Zero when the window has rolled over. */
export function peek(
  bucket: string,
  feature: string,
  window: CounterWindow,
  now: Date = new Date(),
): number {
  const row = getDb()
    .select({ count: usageCounters.count })
    .from(usageCounters)
    .where(
      and(
        eq(usageCounters.bucket, bucket),
        eq(usageCounters.feature, feature),
        eq(usageCounters.windowStart, windowStart(window, now)),
      ),
    )
    .get();
  return row?.count ?? 0;
}

/** Drop expired rows so a flood of unique buckets cannot grow the table forever. */
export function gcCounters(now: Date = new Date()): number {
  const cutoff = new Date(now.getTime() - RETENTION_MS);
  const res = getDb().delete(usageCounters).where(lt(usageCounters.windowStart, cutoff)).run();
  return res.changes;
}
```

- [ ] **Step 6: Run the tests**

```bash
npx vitest run tests/usage-counters.test.ts
```

Expected: PASS, 4 tests.

- [ ] **Step 7: Commit**

```bash
git add src/lib/db/schema.ts src/lib/usage/counters.ts tests/usage-counters.test.ts drizzle/
git commit -m "feat(usage): durable fixed-window counters for rate limits and caps"
```

---

## Task 2: Move the MCP rate limiter and scout cap onto counters

**Files:**
- Modify: `mcp/server.ts:31-48`
- Modify: `mcp/tools/scout.ts:15-30`
- Create: `tests/mcp-rate-persist.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/mcp-rate-persist.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { bump, peek } from '@/lib/usage/counters';
import { rateLimited, _resetRateLimitForTest } from '../mcp/lib/rate';
import { useTestDb } from './helpers/db';

describe('mcp rate limiting is durable', () => {
  beforeEach(() => {
    useTestDb();
    _resetRateLimitForTest(3);
  });

  it('blocks after the limit and survives a simulated process restart', () => {
    const now = new Date('2026-08-25T10:00:00Z');
    expect(rateLimited('ip:5.5.5.5', now)).toBe(false); // 1
    expect(rateLimited('ip:5.5.5.5', now)).toBe(false); // 2
    expect(rateLimited('ip:5.5.5.5', now)).toBe(false); // 3
    expect(rateLimited('ip:5.5.5.5', now)).toBe(true);  // 4 — over

    // a restart clears module state but NOT the database
    _resetRateLimitForTest(3);
    expect(rateLimited('ip:5.5.5.5', now)).toBe(true);
    expect(peek('ip:5.5.5.5', 'rate', 'hour', now)).toBeGreaterThanOrEqual(4);
  });

  it('lets a different bucket through', () => {
    const now = new Date('2026-08-25T10:00:00Z');
    for (let i = 0; i < 4; i++) rateLimited('ip:5.5.5.5', now);
    expect(rateLimited('ip:6.6.6.6', now)).toBe(false);
  });

  it('resets in the next hour window', () => {
    const t1 = new Date('2026-08-25T10:00:00Z');
    for (let i = 0; i < 4; i++) rateLimited('ip:7.7.7.7', t1);
    expect(rateLimited('ip:7.7.7.7', t1)).toBe(true);

    const t2 = new Date('2026-08-25T11:00:00Z');
    expect(rateLimited('ip:7.7.7.7', t2)).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run tests/mcp-rate-persist.test.ts
```

Expected: FAIL — `Failed to resolve import "../mcp/lib/rate"`.

- [ ] **Step 3: Extract the limiter into its own module**

Create `mcp/lib/rate.ts`:

```ts
/**
 * Request rate limiting for the MCP endpoint, backed by usage_counters.
 *
 * Previously a module-level Map in server.ts: it reset on every deploy and
 * counted independently in each replica, so the advertised limit was really
 * "limit x replicas, until the next restart". Now a fixed hour window in
 * SQLite, shared by every process pointed at the same database file.
 */
import { bump } from '../../src/lib/usage/counters';

let limitPerHour = Number(process.env.MCP_RATE_LIMIT ?? 300);

/** True when this bucket has exceeded its hourly allowance. */
export function rateLimited(bucket: string, now: Date = new Date()): boolean {
  return bump(bucket, 'rate', 'hour', now) > limitPerHour;
}

export function rateLimitPerHour(): number {
  return limitPerHour;
}

/** Test seam: re-read the env limit (or force one) without reimporting. */
export function _resetRateLimitForTest(limit?: number): void {
  limitPerHour = limit ?? Number(process.env.MCP_RATE_LIMIT ?? 300);
}
```

- [ ] **Step 4: Run the tests**

```bash
npx vitest run tests/mcp-rate-persist.test.ts
```

Expected: PASS, 3 tests.

- [ ] **Step 5: Use it in the server**

In `mcp/server.ts`, delete the `buckets` map, the `rateLimited` function, and the `setInterval` GC block (currently lines 31–48). Add to the imports near `import { buildServer } from './build';`:

```ts
import { rateLimited, rateLimitPerHour } from './lib/rate';
import { gcCounters } from '../src/lib/usage/counters';
```

Delete the now-unused `RATE_LIMIT_PER_HOUR` constant. Replace the rate-limit block in the request handler with:

```ts
  if (rateLimited(auth.rateKey)) {
    res.writeHead(429, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'rate limit exceeded', limit_per_hour: rateLimitPerHour() }));
    return;
  }
```

And add a periodic GC near the bottom, just before `httpServer.listen(...)`:

```ts
// prune expired counter rows hourly; unref so it never holds the process open
setInterval(() => {
  try {
    gcCounters();
  } catch {
    /* best-effort — a failed GC must never take the server down */
  }
}, 36e5).unref();
```

- [ ] **Step 6: Move the scout daily cap onto counters**

In `mcp/tools/scout.ts`, delete the `scoutUsage` map and both `scoutCapExceeded` / `recordScout` functions (lines 15–30). Replace the `SCOUT_DAILY_CAP` block with:

```ts
import { bump, peek } from '../../src/lib/usage/counters';

// Per-caller daily cap for anonymous callers: every scout run is a fresh LLM
// call, so every call counts. Signed-in callers go through entitlements
// instead (can(user, 'scout')). Persisted, so a deploy no longer grants
// everyone a fresh allowance.
const SCOUT_DAILY_CAP = Number(process.env.MCP_SCOUT_DAILY_CAP ?? 10);

function scoutCapExceeded(key: string): boolean {
  return peek(key, 'scout', 'day') >= SCOUT_DAILY_CAP;
}

function recordScout(key: string): void {
  bump(key, 'scout', 'day');
}
```

The call sites (`if (auth.userId == null) recordScout(auth.rateKey)` and the `scoutCapExceeded(auth.rateKey)` guard) keep working unchanged.

- [ ] **Step 7: Run the full suite**

```bash
npm test
```

Expected: all pass. `tests/debate-scout.test.ts` exercises the anonymous scout cap via `MCP_SCOUT_DAILY_CAP=1` and calls `useTestDb()` in `beforeEach`, so the persisted counter is present. If it fails with a missing-table error, the test file is missing `useTestDb()` before the tool call — add it rather than reverting this task.

- [ ] **Step 8: Commit**

```bash
git add mcp/lib/rate.ts mcp/server.ts mcp/tools/scout.ts tests/mcp-rate-persist.test.ts
git commit -m "refactor(mcp): persist rate limits and scout caps in SQLite"
```

---

# Phase 1 — Ownership split

This phase fixes Defect 1. After it, a caller's private openings are invisible to everyone else, and scout can never again starve because someone else's scout succeeded.

## Task 3: Add `owner_user_id` to opportunities

**Files:**
- Modify: `src/lib/db/schema.ts:272-312`
- Create: `drizzle/0030_opportunity_owner.sql` (hand-written)
- Create: `tests/opportunity-ownership.test.ts`

- [ ] **Step 1: Add the column and indexes to the schema**

In `src/lib/db/schema.ts`, change the `opportunities` table. Remove `.unique()` from the `slug` column and add `ownerUserId` plus an index config. The `slug` line becomes:

```ts
  // stable kebab identity — re-detection across days upserts by (owner, slug)
  slug: text('slug').notNull(),
```

Add this column immediately after `slug`:

```ts
  /**
   * NULL = the canonical public radar, written only by the daily engine.
   * Non-null = a private opening owned by one user (Rung 1/2 output).
   * Every read must scope with: owner_user_id IS NULL OR owner_user_id = :me
   */
  ownerUserId: integer('owner_user_id'),
```

Then convert the table's third argument from nothing to an index config. The closing of the table becomes:

```ts
    firstSeenAt: integer('first_seen_at', { mode: 'timestamp' }).notNull(),
    lastSeenAt: integer('last_seen_at', { mode: 'timestamp' }).notNull(),
  },
  (t) => [
    // Two users may legitimately compose the same slug, so uniqueness is
    // per-owner. SQLite treats NULLs as DISTINCT in unique indexes, so this
    // index does NOT constrain public rows — the partial index below does.
    uniqueIndex('opportunities_owner_slug').on(t.ownerUserId, t.slug),
    uniqueIndex('opportunities_public_slug').on(t.slug).where(sql`${t.ownerUserId} is null`),
    index('opportunities_owner_status').on(t.ownerUserId, t.status),
  ],
);
```

Note you must open the table body with `{` and close with `}` before the `(t) => [...]` argument — match the shape of `llmCalls` at line 366.

`index`, `uniqueIndex` and `primaryKey` are already imported at the top of `schema.ts`. `sql` is **not** — schema.ts has no `drizzle-orm` root import at all. Add one as the second line of the file:

```ts
import { sql } from 'drizzle-orm';
```

- [ ] **Step 2: Hand-write the migration**

Do **not** trust `db:generate` for the partial index — drizzle-kit's SQLite dialect has historically dropped the `WHERE` clause, which would silently make public slugs non-unique and break the daily job's upsert.

The existing uniqueness is a standalone index (`drizzle/0006_fearless_ares.sql:19`), not an inline table constraint, so this needs **no table rebuild**. Create `drizzle/0030_opportunity_owner.sql`:

```sql
ALTER TABLE `opportunities` ADD `owner_user_id` integer;--> statement-breakpoint
DROP INDEX `opportunities_slug_unique`;--> statement-breakpoint
CREATE UNIQUE INDEX `opportunities_owner_slug` ON `opportunities` (`owner_user_id`,`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `opportunities_public_slug` ON `opportunities` (`slug`) WHERE `owner_user_id` is null;--> statement-breakpoint
CREATE INDEX `opportunities_owner_status` ON `opportunities` (`owner_user_id`,`status`);
```

- [ ] **Step 3: Register the migration in the journal**

Open `drizzle/meta/_journal.json` and append an entry to the `entries` array, matching the shape of the last entry and incrementing `idx`:

```json
    {
      "idx": 30,
      "version": "6",
      "when": 1787654400000,
      "tag": "0030_opportunity_owner",
      "breakpoints": true
    }
```

Set `idx` to one more than the previous entry's `idx`, and `when` to any epoch-ms value greater than the previous entry's. If Task 1's generated migration already consumed index 29, this is 30; adjust if not.

- [ ] **Step 4: Write the failing test**

Create `tests/opportunity-ownership.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { opportunities } from '@/lib/db/schema';
import { useTestDb } from './helpers/db';
import type { Db } from '@/lib/db';

function seedOpp(db: Db, slug: string, ownerUserId: number | null) {
  const now = new Date();
  db.insert(opportunities)
    .values({
      slug,
      ownerUserId,
      title: `Title for ${slug}`,
      thesis: 'A sufficiently long thesis to satisfy any downstream validation rules.',
      sector: 'devtools',
      status: 'active',
      flipScore: 60,
      holdScore: 40,
      scores: '{}',
      evidence: '[]',
      firstSeenAt: now,
      lastSeenAt: now,
    })
    .run();
}

describe('opportunity ownership', () => {
  let db: Db;
  beforeEach(() => {
    db = useTestDb();
  });

  it('allows the same slug for two different owners', () => {
    seedOpp(db, 'bulk-bg-removal', 1);
    expect(() => seedOpp(db, 'bulk-bg-removal', 2)).not.toThrow();
    const rows = db.select().from(opportunities).all();
    expect(rows).toHaveLength(2);
  });

  it('allows a private row alongside a public row with the same slug', () => {
    seedOpp(db, 'shared-slug', null);
    expect(() => seedOpp(db, 'shared-slug', 7)).not.toThrow();
  });

  it('still rejects two public rows with the same slug', () => {
    seedOpp(db, 'canonical-opening', null);
    expect(() => seedOpp(db, 'canonical-opening', null)).toThrow(/UNIQUE/i);
  });

  it('still rejects a duplicate slug for the same owner', () => {
    seedOpp(db, 'my-opening', 3);
    expect(() => seedOpp(db, 'my-opening', 3)).toThrow(/UNIQUE/i);
  });
});
```

- [ ] **Step 5: Run it**

```bash
npx vitest run tests/opportunity-ownership.test.ts
```

Expected: PASS, 4 tests. The third test is the one that proves the partial index survived — if it fails with "expected to throw", the `WHERE owner_user_id is null` clause did not apply and the migration needs fixing before you continue.

- [ ] **Step 6: Confirm the schema and migrations agree**

```bash
npm run db:generate
```

Expected: `No schema changes, nothing to migrate`. If it wants to generate a migration, the schema in Step 1 does not match the SQL in Step 2 — reconcile them, and keep the hand-written SQL as the source of truth for the partial index.

- [ ] **Step 7: Run the full suite**

```bash
npm test
```

Expected: all pass. Existing code never sets `ownerUserId`, so every current row and insert is public — behavior is unchanged.

- [ ] **Step 8: Commit**

```bash
git add src/lib/db/schema.ts drizzle/ tests/opportunity-ownership.test.ts
git commit -m "feat(db): owner-scoped opportunities with per-owner slug uniqueness"
```

---

## Task 4: Scope opportunity reads to the caller

**Files:**
- Modify: `mcp/tools/opportunities.ts`
- Create: `tests/opportunity-scoping.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/opportunity-scoping.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { AuthContext } from '../mcp/lib/auth';
import { registerOpportunityTools } from '../mcp/tools/opportunities';
import { opportunities } from '@/lib/db/schema';
import { useTestDb } from './helpers/db';
import type { Db } from '@/lib/db';

function seedOpp(db: Db, slug: string, ownerUserId: number | null, flip = 60) {
  const now = new Date();
  db.insert(opportunities)
    .values({
      slug,
      ownerUserId,
      title: `Title for ${slug}`,
      thesis: 'A sufficiently long thesis to satisfy any downstream validation rules.',
      sector: 'devtools',
      status: 'active',
      flipScore: flip,
      holdScore: 40,
      scores: '{}',
      evidence: '[]',
      firstSeenAt: now,
      lastSeenAt: now,
    })
    .run();
}

function authFor(userId: number | null): AuthContext {
  return {
    authed: userId != null,
    userId,
    scopes: new Set(['read', 'plans']),
    rateKey: userId != null ? `user:${userId}` : 'ip:test',
  };
}

async function wire(userId: number | null): Promise<Client> {
  const server = new McpServer({ name: 'opp-scope-test', version: '0.0.1' });
  registerOpportunityTools(server, authFor(userId));
  const client = new Client({ name: 'test', version: '0.0.1' });
  const [c, s] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(c), server.connect(s)]);
  return client;
}

async function listSlugs(client: Client, args: Record<string, unknown> = {}): Promise<string[]> {
  const res = await client.callTool({ name: 'get_opportunities', arguments: { limit: 25, ...args } });
  const structured = res.structuredContent as { opportunities: { slug: string }[] };
  return structured.opportunities.map((o) => o.slug);
}

describe('opportunity read scoping', () => {
  let db: Db;
  beforeEach(() => {
    db = useTestDb();
    seedOpp(db, 'public-one', null, 90);
    seedOpp(db, 'public-two', null, 80);
    seedOpp(db, 'alice-private', 1, 95);
    seedOpp(db, 'bob-private', 2, 95);
  });

  it('shows a user the public radar plus only their own private openings', async () => {
    const slugs = await listSlugs(await wire(1));
    expect(slugs).toContain('public-one');
    expect(slugs).toContain('alice-private');
    expect(slugs).not.toContain('bob-private');
  });

  it('shows anonymous callers only the public radar', async () => {
    const slugs = await listSlugs(await wire(null));
    expect(slugs).toEqual(expect.arrayContaining(['public-one', 'public-two']));
    expect(slugs).not.toContain('alice-private');
    expect(slugs).not.toContain('bob-private');
  });

  it('refuses to fetch another owner private dossier by slug', async () => {
    const client = await wire(1);
    const res = await client.callTool({
      name: 'get_opportunity',
      arguments: { opportunity: 'bob-private' },
    });
    expect((res.structuredContent as { found: boolean }).found).toBe(false);
  });

  it('returns a cursor when more results exist and advances past them', async () => {
    for (let i = 0; i < 10; i++) seedOpp(db, `filler-${i}`, null, 50 - i);
    const client = await wire(1);
    const first = await client.callTool({ name: 'get_opportunities', arguments: { limit: 3 } });
    const page1 = first.structuredContent as { opportunities: { slug: string }[]; next_cursor: number | null };
    expect(page1.opportunities).toHaveLength(3);
    expect(page1.next_cursor).toBe(3);

    const second = await client.callTool({
      name: 'get_opportunities',
      arguments: { limit: 3, cursor: page1.next_cursor },
    });
    const page2 = second.structuredContent as { opportunities: { slug: string }[] };
    const overlap = page2.opportunities
      .map((o) => o.slug)
      .filter((s) => page1.opportunities.some((p) => p.slug === s));
    expect(overlap).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run tests/opportunity-scoping.test.ts
```

Expected: FAIL — the first test finds `bob-private` in Alice's list, because reads are not yet scoped.

- [ ] **Step 3: Add the owner predicate and cursor to `get_opportunities`**

In `mcp/tools/opportunities.ts`, add `isNull` to the drizzle import:

```ts
import { and, desc, eq, gte, isNull, like, or } from 'drizzle-orm';
```

Add this helper above `registerOpportunityTools`:

```ts
/**
 * Rows this caller may see: the canonical public radar (owner NULL) plus
 * their own private openings. Anonymous callers get the public radar only —
 * their Rung-0 leads live in the `leads` table, not here.
 */
function visibleTo(userId: number | null) {
  return userId == null
    ? isNull(opportunities.ownerUserId)
    : or(isNull(opportunities.ownerUserId), eq(opportunities.ownerUserId, userId));
}
```

In the `get_opportunities` input schema, add a cursor:

```ts
        cursor: z
          .number()
          .int()
          .min(0)
          .default(0)
          .describe('offset into the ranked list — pass next_cursor from a prior call for more'),
```

Add `next_cursor` to its output schema, next to `count`:

```ts
        next_cursor: z.number().nullable(),
```

Change the handler signature to `async ({ limit, sector, verdict, min_flip, cursor })`, and add the owner predicate to the conditions:

```ts
      const conds = [eq(opportunities.status, 'active'), visibleTo(auth.userId)];
```

- [ ] **Step 4: Bound the query and paginate the ranked list**

Replace the comment and query that currently read "no SQL limit — the quota walk and exploration slot below choose from the full filtered list" with:

```ts
      // Bounded scan. This table was once a small curated set, but private
      // Rung-1 rows now live here too, so an unbounded .all() would scan every
      // opening ever refined by this user. RANK_WINDOW is the widest slice the
      // quota walk can meaningfully reorder.
      const RANK_WINDOW = 200;
      const rows = db
        .select()
        .from(opportunities)
        .where(and(...conds))
        .orderBy(desc(opportunities.flipScore))
        .limit(RANK_WINDOW)
        .all();
```

After the existing `ranked` computation, apply the cursor before the quota walk:

```ts
      const offset = cursor ?? 0;
      const page = ranked.slice(offset);
```

Then change the quota walk to iterate `page` instead of `ranked` (`for (const row of page) {`).

After the exploration-slot block, compute the cursor to hand back:

```ts
      // Only advertise more when there is genuinely more to serve.
      const consumed = offset + picked.length;
      const nextCursor = consumed < ranked.length ? consumed : null;
```

Add `next_cursor: nextCursor` to the `respond` data object alongside `count` and `opportunities`, and append a paging suggestion to the non-empty `next` array:

```ts
                  ...(nextCursor !== null
                    ? [
                        {
                          tool: 'get_opportunities',
                          arguments: { limit, cursor: nextCursor },
                          reason: 'next page of openings — the list continues',
                        },
                      ]
                    : []),
```

- [ ] **Step 5: Scope `get_opportunity` too**

In the `get_opportunity` handler, replace the two lookup queries so a private slug belonging to someone else is simply not found:

```ts
      const row = asId
        ? db
            .select()
            .from(opportunities)
            .where(and(eq(opportunities.id, asId), visibleTo(auth.userId)))
            .get()
        : db
            .select()
            .from(opportunities)
            .where(and(eq(opportunities.slug, opportunity), visibleTo(auth.userId)))
            .get();
```

Also scope the typo-suggestion helper, so it cannot leak another owner's slugs. Change `closestSlugs` to take the caller:

```ts
function closestSlugs(ref: string, userId: number | null): string[] {
  const db = getDb();
  const needle = `%${ref.toLowerCase().replace(/[%_]/g, '').slice(0, 40)}%`;
  if (needle === '%%') return [];
  return db
    .select({ slug: opportunities.slug })
    .from(opportunities)
    .where(
      and(
        or(like(opportunities.slug, needle), like(opportunities.title, needle)),
        visibleTo(userId),
      ),
    )
    .limit(3)
    .all()
    .map((r) => r.slug);
}
```

and update its call site to `closestSlugs(opportunity, auth.userId)`.

- [ ] **Step 6: Run the tests**

```bash
npx vitest run tests/opportunity-scoping.test.ts
```

Expected: PASS, 4 tests.

- [ ] **Step 7: Run the full suite**

```bash
npm test
```

Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add mcp/tools/opportunities.ts tests/opportunity-scoping.test.ts
git commit -m "feat(mcp): scope opportunity reads to owner, bound the scan, add cursor"
```

---

## Task 5: Make scout persist privately, and evict the legacy leakage

**Files:**
- Modify: `src/lib/opportunities/persist-scout.ts`
- Modify: `mcp/tools/scout.ts`
- Create: `drizzle/0031_archive_leaked_scout_rows.sql` (hand-written)
- Create: `tests/persist-scout-owner.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/persist-scout-owner.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { and, eq, isNull } from 'drizzle-orm';
import { persistScoutDrafts } from '@/lib/opportunities/persist-scout';
import { opportunities } from '@/lib/db/schema';
import { SUB_KEYS } from '@/lib/opportunities/engine';
import type { OppDraft } from '@/lib/opportunities/engine';
import { useTestDb } from './helpers/db';
import type { Db } from '@/lib/db';

function draft(slug: string): OppDraft {
  const sub = Object.fromEntries(SUB_KEYS.map((k) => [k, 12])) as OppDraft['sub'];
  return {
    slug,
    title: `Title for ${slug}`,
    thesis: 'A sufficiently long thesis to satisfy the sanitizer and the gate.',
    sector: 'devtools',
    window: '6 months',
    windowMonths: 6,
    sub,
    kpis: {
      initialCostUsd: 100, monthlyCostUsd: 50, priceUsd: 30, timeToMvpDays: 14,
      breakEvenCustomers: 5, competitorCount: 3, competitionNote: null, regulatoryNote: null,
    },
    evidenceRefs: ['P1'],
  };
}

describe('scout persistence is owner-scoped', () => {
  let db: Db;
  beforeEach(() => {
    db = useTestDb();
  });

  it('writes private rows that never appear on the public radar', () => {
    persistScoutDrafts([draft('alice-opening')], 1);
    const publicRows = db
      .select()
      .from(opportunities)
      .where(isNull(opportunities.ownerUserId))
      .all();
    expect(publicRows).toHaveLength(0);

    const mine = db
      .select()
      .from(opportunities)
      .where(eq(opportunities.ownerUserId, 1))
      .all();
    expect(mine).toHaveLength(1);
    expect(mine[0].slug).toBe('alice-opening');
  });

  it('lets two owners hold the same slug without collision', () => {
    const a = persistScoutDrafts([draft('same-idea')], 1);
    const b = persistScoutDrafts([draft('same-idea')], 2);
    expect(a.persisted[0].created).toBe(true);
    expect(b.persisted[0].created).toBe(true);
    expect(a.persisted[0].id).not.toBe(b.persisted[0].id);
  });

  it('upserts within one owner rather than duplicating', () => {
    persistScoutDrafts([draft('repeat-idea')], 1);
    const second = persistScoutDrafts([draft('repeat-idea')], 1);
    expect(second.persisted[0].created).toBe(false);
    const mine = db.select().from(opportunities).where(eq(opportunities.ownerUserId, 1)).all();
    expect(mine).toHaveLength(1);
  });

  it('drops drafts for anonymous callers instead of writing them publicly', () => {
    const res = persistScoutDrafts([draft('anon-opening')], null);
    expect(res.persisted).toHaveLength(0);
    expect(db.select().from(opportunities).all()).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run tests/persist-scout-owner.test.ts
```

Expected: FAIL — `persistScoutDrafts` takes one argument and writes public rows.

- [ ] **Step 3: Add the owner parameter**

In `src/lib/opportunities/persist-scout.ts`, update the module docstring and signature:

```ts
/**
 * Persist scout drafts as the caller's PRIVATE opportunities so generate_plan
 * can find them. Uses the unverified critic + gate (same path as a thin daily
 * refresh) — no extra critique LLM calls; scout already spent one proposer call.
 *
 * Owner-scoped by design: these are openings fitted to one builder's skills,
 * capital and hours. Writing them to the public radar (owner NULL) would both
 * pollute everyone else's list and, because scout skips slugs already tracked,
 * starve the next caller who proposes something similar.
 *
 * Anonymous callers have no durable identity to own a row, so their drafts are
 * returned but not persisted.
 */
export function persistScoutDrafts(drafts: OppDraft[], ownerUserId: number | null): PersistScoutResult {
  const db = getDb();
  const now = new Date();
  const persisted: PersistScoutResult['persisted'] = [];
  if (ownerUserId == null) return { persisted };
```

Add `ownerUserId` to the `values` object:

```ts
    const values = {
      title: d.title,
      thesis: d.thesis,
      sector: d.sector,
      ownerUserId,
      status: 'active' as const,
```

And scope the upsert lookup by owner as well as slug — add `and` to the drizzle import (`import { and, eq } from 'drizzle-orm';`), then:

```ts
    const prior = db
      .select()
      .from(opportunities)
      .where(and(eq(opportunities.slug, slug), eq(opportunities.ownerUserId, ownerUserId)))
      .get();
```

- [ ] **Step 4: Update the scout call site and stop cross-owner starvation**

In `mcp/tools/scout.ts`, `activeSlugs()` currently returns *every* active slug, which is exactly what starves later callers. Scope it to the caller:

```ts
/** Active opportunity slugs visible to this caller, normalized as the engine keys them. */
function activeSlugs(userId: number | null): Set<string> {
  const db = getDb();
  // Only the caller's own openings suppress a draft. Another builder having
  // already been shown this idea is not a reason to withhold it — that is the
  // bug that made scout return nothing once the shared pool saturated.
  const where =
    userId == null
      ? and(eq(opportunities.status, 'active'), isNull(opportunities.ownerUserId))
      : and(eq(opportunities.status, 'active'), eq(opportunities.ownerUserId, userId));
  return new Set(
    db.select({ slug: opportunities.slug }).from(opportunities).where(where).all()
      .map((r) => normalizeSlug(r.slug)),
  );
}
```

Update the drizzle import in that file to `import { and, eq, isNull } from 'drizzle-orm';`, then update the two call sites in the handler:

```ts
      const existing = activeSlugs(auth.userId);
      const fresh = drafts.filter((d) => !existing.has(normalizeSlug(d.slug)));
      const skipped = drafts.length - fresh.length;

      const { persisted } = persistScoutDrafts(fresh, auth.userId);
```

- [ ] **Step 5: Run the tests**

```bash
npx vitest run tests/persist-scout-owner.test.ts
```

Expected: PASS, 4 tests.

- [ ] **Step 6: Evict the rows that already leaked**

Existing deployments have scout output sitting on the public radar. Those rows are identifiable: `persistScoutDrafts` stamps `review.flags` with `'scout-persisted'`. Archive them rather than guessing, leaving the canonical pool as the daily engine intended.

Create `drizzle/0031_archive_leaked_scout_rows.sql`:

```sql
-- Rows written to the public radar by scout_opportunities before ownership
-- existed. They were fitted to one builder's constraints and were never meant
-- to be canonical. Archive (never delete) so the audit trail survives.
UPDATE `opportunities`
SET `status` = 'archived'
WHERE `owner_user_id` IS NULL
  AND `review` IS NOT NULL
  AND `review` LIKE '%scout-persisted%';
```

Append the journal entry for `0031_archive_leaked_scout_rows` to `drizzle/meta/_journal.json`, incrementing `idx` and `when` exactly as in Task 3 Step 3.

- [ ] **Step 7: Verify the migration is inert on a fresh database**

```bash
npx vitest run tests/opportunity-ownership.test.ts tests/persist-scout-owner.test.ts
```

Expected: PASS. Both use `useTestDb()`, which runs every migration including this one against an empty table — it must apply cleanly and change nothing.

- [ ] **Step 8: Run the full suite**

```bash
npm test
```

Expected: all pass. If `tests/debate-scout.test.ts` asserts on persisted scout rows, it will need `auth.userId` set or its assertion updated to expect no persistence for anonymous callers — that is the intended new behavior, so update the test rather than the source.

- [ ] **Step 9: Commit**

```bash
git add src/lib/opportunities/persist-scout.ts mcp/tools/scout.ts drizzle/ tests/persist-scout-owner.test.ts
git commit -m "fix(scout): persist openings privately and stop cross-owner starvation"
```

---

# Phase 2 — Rung 0: unlimited zero-LLM composition

This phase fixes Defect 2. The output is *leads*, not opportunities: heuristic, unreviewed, and labeled as such.

**The core idea.** The candidate space is the cross-product `primitives × business_model × delivery_form × buyer × moat_play`. With ~100 primitives and the shipped taxonomy that is over 100,000 combinations — far more than any caller will consume. Each caller enumerates that space through a *bijective index permutation* seeded by their own key, so:

- two callers walk the same space in completely different orders,
- one caller paging forward never repeats a combination,
- nothing is stored to achieve either property, and it costs no LLM calls.

## Task 6: Wedge taxonomy table and seed data

**Files:**
- Modify: `src/lib/db/schema.ts`
- Create: `src/lib/opportunities/wedges.ts`
- Modify: `scripts/seed.ts`
- Create: `tests/wedges-seed.test.ts`

- [ ] **Step 1: Add the table to the schema**

Append to `src/lib/db/schema.ts`:

```ts
/**
 * The wedge taxonomy: the four axes Rung-0 composition crosses against
 * intelligence primitives. Admin-editable rows rather than a hardcoded module
 * so the combination space can grow without a deploy — the same reasoning that
 * makes `sources` a table.
 *
 * requiresTags / excludesTags are JSON string arrays matched against a
 * primitive's derived tags; they are what stop the cross-product from emitting
 * incoherent pairings ("compliance certification moat" on a hobbyist toy).
 */
export const wedgeValues = sqliteTable(
  'wedge_values',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    // 'business_model' | 'delivery_form' | 'buyer' | 'moat_play'
    axis: text('axis').notNull(),
    slug: text('slug').notNull(),
    label: text('label').notNull(),
    // JSON string[] — primitive must carry ALL of these tags
    requiresTags: text('requires_tags').notNull().default('[]'),
    // JSON string[] — primitive must carry NONE of these tags
    excludesTags: text('excludes_tags').notNull().default('[]'),
    // 0..20 nudge into the heuristic score; higher = generally stronger wedge
    weight: integer('weight').notNull().default(10),
    active: integer('active', { mode: 'boolean' }).notNull().default(true),
  },
  (t) => [
    uniqueIndex('wedge_values_axis_slug').on(t.axis, t.slug),
    index('wedge_values_axis_active').on(t.axis, t.active),
  ],
);
```

- [ ] **Step 2: Generate the migration**

```bash
npm run db:generate
```

Expected: a new `drizzle/0032_*.sql` creating `wedge_values` and its two indexes, and nothing else.

- [ ] **Step 3: Write the failing test**

Create `tests/wedges-seed.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { seedWedges, WEDGE_AXES } from '@/lib/opportunities/wedges';
import { wedgeValues } from '@/lib/db/schema';
import { useTestDb } from './helpers/db';
import type { Db } from '@/lib/db';

describe('wedge taxonomy seed', () => {
  let db: Db;
  beforeEach(() => {
    db = useTestDb();
  });

  it('seeds every axis with at least four values', () => {
    seedWedges();
    for (const axis of WEDGE_AXES) {
      const rows = db.select().from(wedgeValues).where(eq(wedgeValues.axis, axis)).all();
      expect(rows.length, `axis ${axis}`).toBeGreaterThanOrEqual(4);
    }
  });

  it('is idempotent — re-seeding does not duplicate', () => {
    seedWedges();
    const first = db.select().from(wedgeValues).all().length;
    seedWedges();
    expect(db.select().from(wedgeValues).all().length).toBe(first);
  });

  it('stores tag arrays as parseable JSON arrays', () => {
    seedWedges();
    for (const row of db.select().from(wedgeValues).all()) {
      expect(Array.isArray(JSON.parse(row.requiresTags))).toBe(true);
      expect(Array.isArray(JSON.parse(row.excludesTags))).toBe(true);
    }
  });
});
```

- [ ] **Step 4: Run it and watch it fail**

```bash
npx vitest run tests/wedges-seed.test.ts
```

Expected: FAIL — `Failed to resolve import "@/lib/opportunities/wedges"`.

- [ ] **Step 5: Create the taxonomy module with its seed data**

Create `src/lib/opportunities/wedges.ts`:

```ts
/**
 * The wedge taxonomy — the four axes Rung-0 composition crosses against
 * intelligence primitives, plus the compatibility rules that keep the
 * cross-product coherent.
 *
 * Rows live in the database (admin-editable); DEFAULT_WEDGES below is the
 * shipped starting set, installed idempotently by seedWedges().
 */
import { eq } from 'drizzle-orm';
import { getDb } from '../db';
import { wedgeValues } from '../db/schema';

export const WEDGE_AXES = ['business_model', 'delivery_form', 'buyer', 'moat_play'] as const;
export type WedgeAxis = (typeof WEDGE_AXES)[number];

export interface WedgeValue {
  id: number;
  axis: WedgeAxis;
  slug: string;
  label: string;
  requiresTags: string[];
  excludesTags: string[];
  weight: number;
}

/** One point in wedge space: exactly one value per axis. */
export type Wedge = Record<WedgeAxis, WedgeValue>;

interface WedgeSeed {
  axis: WedgeAxis;
  slug: string;
  label: string;
  requiresTags?: string[];
  excludesTags?: string[];
  weight?: number;
}

/**
 * Shipped taxonomy. Tags are matched against primitive tags derived in
 * primitives.ts — keep the vocabularies in sync when editing either file.
 * Current tag vocabulary: agentic, consumer, regulated, infra, creative,
 * data, devtools, commerce, enterprise, general.
 */
export const DEFAULT_WEDGES: WedgeSeed[] = [
  // --- how it makes money ---
  { axis: 'business_model', slug: 'subscription-saas', label: 'monthly subscription', weight: 12 },
  { axis: 'business_model', slug: 'usage-api', label: 'metered API', requiresTags: ['infra'], weight: 14 },
  { axis: 'business_model', slug: 'marketplace-take-rate', label: 'marketplace take-rate', excludesTags: ['infra'], weight: 8 },
  { axis: 'business_model', slug: 'one-off-tool', label: 'one-off paid tool', weight: 9 },
  { axis: 'business_model', slug: 'done-for-you-service', label: 'productized service', weight: 11 },
  { axis: 'business_model', slug: 'data-subscription', label: 'data feed subscription', requiresTags: ['data'], weight: 13 },

  // --- what the buyer actually touches ---
  { axis: 'delivery_form', slug: 'hosted-dashboard', label: 'hosted dashboard', weight: 10 },
  { axis: 'delivery_form', slug: 'cli-tool', label: 'CLI tool', requiresTags: ['devtools'], excludesTags: ['consumer'], weight: 12 },
  { axis: 'delivery_form', slug: 'api-endpoint', label: 'API endpoint', requiresTags: ['infra'], weight: 13 },
  { axis: 'delivery_form', slug: 'browser-extension', label: 'browser extension', excludesTags: ['infra'], weight: 9 },
  { axis: 'delivery_form', slug: 'mcp-server', label: 'MCP server', requiresTags: ['agentic'], weight: 15 },
  { axis: 'delivery_form', slug: 'batch-report', label: 'recurring batch report', requiresTags: ['data'], weight: 10 },

  // --- who pays ---
  { axis: 'buyer', slug: 'solo-builder', label: 'solo builders', excludesTags: ['enterprise'], weight: 10 },
  { axis: 'buyer', slug: 'small-agency', label: 'small agencies', weight: 12 },
  { axis: 'buyer', slug: 'mid-market-ops', label: 'mid-market ops teams', weight: 13 },
  { axis: 'buyer', slug: 'enterprise-platform-team', label: 'enterprise platform teams', excludesTags: ['consumer'], weight: 11 },
  { axis: 'buyer', slug: 'creator', label: 'creators', requiresTags: ['creative'], weight: 9 },
  { axis: 'buyer', slug: 'ecommerce-seller', label: 'ecommerce sellers', requiresTags: ['commerce'], weight: 11 },

  // --- why it survives contact with a competitor ---
  { axis: 'moat_play', slug: 'proprietary-dataset', label: 'proprietary dataset', requiresTags: ['data'], weight: 15 },
  { axis: 'moat_play', slug: 'workflow-lock-in', label: 'workflow lock-in', weight: 12 },
  { axis: 'moat_play', slug: 'distribution-channel', label: 'owned distribution channel', weight: 13 },
  { axis: 'moat_play', slug: 'speed-to-market', label: 'speed to market', weight: 8 },
  { axis: 'moat_play', slug: 'compliance-cert', label: 'compliance certification', requiresTags: ['regulated'], weight: 14 },
  { axis: 'moat_play', slug: 'community', label: 'community moat', excludesTags: ['enterprise'], weight: 10 },
];

/** Install the shipped taxonomy. Idempotent: existing rows are left alone. */
export function seedWedges(): number {
  const db = getDb();
  let inserted = 0;
  for (const w of DEFAULT_WEDGES) {
    const prior = db
      .select({ id: wedgeValues.id })
      .from(wedgeValues)
      .where(eq(wedgeValues.slug, w.slug))
      .get();
    if (prior) continue;
    db.insert(wedgeValues)
      .values({
        axis: w.axis,
        slug: w.slug,
        label: w.label,
        requiresTags: JSON.stringify(w.requiresTags ?? []),
        excludesTags: JSON.stringify(w.excludesTags ?? []),
        weight: w.weight ?? 10,
      })
      .run();
    inserted += 1;
  }
  return inserted;
}
```

- [ ] **Step 6: Run the tests**

```bash
npx vitest run tests/wedges-seed.test.ts
```

Expected: PASS, 3 tests.

- [ ] **Step 7: Wire seeding into the main seed script**

Open `scripts/seed.ts`, add `import { seedWedges } from '../src/lib/opportunities/wedges';`, and call it during setup alongside the other idempotent steps:

```ts
const wedgeCount = seedWedges();
console.log(`[seed] wedge taxonomy: ${wedgeCount} value(s) installed`);
```

- [ ] **Step 8: Commit**

```bash
git add src/lib/db/schema.ts src/lib/opportunities/wedges.ts scripts/seed.ts tests/wedges-seed.test.ts drizzle/
git commit -m "feat(opportunities): admin-editable wedge taxonomy with shipped defaults"
```

---

## Task 7: Wedge loading, index decoding and compatibility

**Files:**
- Modify: `src/lib/opportunities/wedges.ts`
- Create: `tests/wedges-compat.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/wedges-compat.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import {
  isCompatible, loadWedges, wedgeAt, wedgeSpaceSize, seedWedges, WEDGE_AXES,
} from '@/lib/opportunities/wedges';
import type { WedgeValue } from '@/lib/opportunities/wedges';
import { useTestDb } from './helpers/db';

function value(slug: string, requires: string[], excludes: string[]): WedgeValue {
  return {
    id: 1, axis: 'moat_play', slug, label: slug,
    requiresTags: requires, excludesTags: excludes, weight: 10,
  };
}

describe('wedge compatibility', () => {
  it('accepts a value with no rules', () => {
    expect(isCompatible(value('plain', [], []), ['devtools'])).toBe(true);
  });

  it('requires ALL requiresTags to be present', () => {
    const v = value('needs-both', ['data', 'regulated'], []);
    expect(isCompatible(v, ['data'])).toBe(false);
    expect(isCompatible(v, ['data', 'regulated'])).toBe(true);
  });

  it('rejects when ANY excludesTag is present', () => {
    const v = value('no-consumer', [], ['consumer']);
    expect(isCompatible(v, ['devtools'])).toBe(true);
    expect(isCompatible(v, ['devtools', 'consumer'])).toBe(false);
  });

  it('lets excludes win over requires', () => {
    const v = value('contradictory', ['data'], ['consumer']);
    expect(isCompatible(v, ['data', 'consumer'])).toBe(false);
  });
});

describe('wedge space', () => {
  beforeEach(() => {
    useTestDb();
    seedWedges();
  });

  it('loads values grouped by axis', () => {
    const space = loadWedges();
    for (const axis of WEDGE_AXES) {
      expect(space[axis].length, `axis ${axis}`).toBeGreaterThanOrEqual(4);
    }
  });

  it('reports the full cross-product size', () => {
    const space = loadWedges();
    const expected = WEDGE_AXES.reduce((n, a) => n * space[a].length, 1);
    expect(wedgeSpaceSize(space)).toBe(expected);
    expect(wedgeSpaceSize(space)).toBeGreaterThan(1000);
  });

  it('decodes every index in range to a distinct wedge', () => {
    const space = loadWedges();
    const n = Math.min(wedgeSpaceSize(space), 500);
    const seen = new Set<string>();
    for (let i = 0; i < n; i++) {
      const w = wedgeAt(space, i);
      const key = WEDGE_AXES.map((a) => w[a].slug).join('|');
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run tests/wedges-compat.test.ts
```

Expected: FAIL — `isCompatible`, `loadWedges`, `wedgeAt`, `wedgeSpaceSize` are not exported.

- [ ] **Step 3: Implement loading, decoding and compatibility**

Append to `src/lib/opportunities/wedges.ts`:

```ts
/** Active taxonomy values grouped by axis, in stable id order. */
export type WedgeSpace = Record<WedgeAxis, WedgeValue[]>;

function parseTags(raw: string): string[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((t): t is string => typeof t === 'string') : [];
  } catch {
    return [];
  }
}

/** Load the active taxonomy, grouped by axis. */
export function loadWedges(): WedgeSpace {
  const rows = getDb()
    .select()
    .from(wedgeValues)
    .where(eq(wedgeValues.active, true))
    .orderBy(wedgeValues.id)
    .all();
  const space = { business_model: [], delivery_form: [], buyer: [], moat_play: [] } as WedgeSpace;
  for (const r of rows) {
    if (!(WEDGE_AXES as readonly string[]).includes(r.axis)) continue;
    space[r.axis as WedgeAxis].push({
      id: r.id,
      axis: r.axis as WedgeAxis,
      slug: r.slug,
      label: r.label,
      requiresTags: parseTags(r.requiresTags),
      excludesTags: parseTags(r.excludesTags),
      weight: r.weight,
    });
  }
  return space;
}

/** Total number of distinct wedges — the size of the axis cross-product. */
export function wedgeSpaceSize(space: WedgeSpace): number {
  return WEDGE_AXES.reduce((n, axis) => n * space[axis].length, 1);
}

/**
 * Mixed-radix decode: index → exactly one wedge. Bijective over
 * [0, wedgeSpaceSize), which is what lets composition enumerate the space by
 * integer without materialising it.
 */
export function wedgeAt(space: WedgeSpace, index: number): Wedge {
  let rest = index;
  const out = {} as Wedge;
  for (const axis of WEDGE_AXES) {
    const values = space[axis];
    out[axis] = values[rest % values.length];
    rest = Math.floor(rest / values.length);
  }
  return out;
}

/**
 * Does this wedge value make sense for a primitive carrying these tags?
 * All requiresTags must be present; any excludesTag disqualifies. Excludes are
 * checked first so a contradictory rule fails closed.
 */
export function isCompatible(value: WedgeValue, primitiveTags: string[]): boolean {
  const tags = new Set(primitiveTags);
  if (value.excludesTags.some((t) => tags.has(t))) return false;
  return value.requiresTags.every((t) => tags.has(t));
}

/** True when every axis of the wedge is compatible with the primitive. */
export function wedgeCompatible(wedge: Wedge, primitiveTags: string[]): boolean {
  return WEDGE_AXES.every((axis) => isCompatible(wedge[axis], primitiveTags));
}
```

- [ ] **Step 4: Run the tests**

```bash
npx vitest run tests/wedges-compat.test.ts
```

Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/opportunities/wedges.ts tests/wedges-compat.test.ts
git commit -m "feat(opportunities): wedge space loading, index decoding and tag compatibility"
```

---

## Task 8: Deterministic per-caller slicing

**Files:**
- Create: `src/lib/opportunities/seed.ts`
- Create: `tests/opportunity-seed.test.ts`

This module is pure — no DB, no LLM, no clock. It is the reason two callers cannot receive the same leads, so test it hard.

- [ ] **Step 1: Write the failing test**

Create `tests/opportunity-seed.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { seedFor, permuteIndex, sliceFor } from '@/lib/opportunities/seed';

describe('seedFor', () => {
  it('is deterministic for the same inputs', () => {
    expect(seedFor('user:1', '2026-08-25')).toBe(seedFor('user:1', '2026-08-25'));
  });

  it('differs across callers and across days', () => {
    expect(seedFor('user:1', '2026-08-25')).not.toBe(seedFor('user:2', '2026-08-25'));
    expect(seedFor('user:1', '2026-08-25')).not.toBe(seedFor('user:1', '2026-08-26'));
  });
});

describe('permuteIndex', () => {
  it('is a bijection over the whole range', () => {
    for (const n of [1, 2, 7, 64, 1000]) {
      const seen = new Set<number>();
      for (let i = 0; i < n; i++) {
        const p = permuteIndex(i, n, 12345);
        expect(p).toBeGreaterThanOrEqual(0);
        expect(p).toBeLessThan(n);
        seen.add(p);
      }
      expect(seen.size, `n=${n}`).toBe(n);
    }
  });

  it('produces different orderings for different seeds', () => {
    const n = 500;
    const a = Array.from({ length: n }, (_, i) => permuteIndex(i, n, 111));
    const b = Array.from({ length: n }, (_, i) => permuteIndex(i, n, 222));
    expect(a).not.toEqual(b);
  });

  it('handles n = 0 without dividing by zero', () => {
    expect(permuteIndex(0, 0, 42)).toBe(0);
  });
});

describe('sliceFor', () => {
  it('never repeats an index while paging through the space', () => {
    const seen = new Set<number>();
    for (let cursor = 0; cursor < 100; cursor += 10) {
      for (const idx of sliceFor('user:1', '2026-08-25', 1000, cursor, 10)) {
        expect(seen.has(idx)).toBe(false);
        seen.add(idx);
      }
    }
    expect(seen.size).toBe(100);
  });

  it('gives two callers largely disjoint first pages', () => {
    const a = sliceFor('user:1', '2026-08-25', 5000, 0, 20);
    const b = sliceFor('user:2', '2026-08-25', 5000, 0, 20);
    expect(a.filter((i) => b.includes(i)).length).toBeLessThanOrEqual(2);
  });

  it('stops at the end of the space instead of wrapping', () => {
    expect(sliceFor('user:1', '2026-08-25', 15, 10, 10)).toHaveLength(5);
    expect(sliceFor('user:1', '2026-08-25', 15, 20, 10)).toHaveLength(0);
  });

  it('returns nothing for an empty space', () => {
    expect(sliceFor('user:1', '2026-08-25', 0, 0, 10)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run tests/opportunity-seed.test.ts
```

Expected: FAIL — `Failed to resolve import "@/lib/opportunities/seed"`.

- [ ] **Step 3: Implement the seeding**

Create `src/lib/opportunities/seed.ts`:

```ts
/**
 * Deterministic per-caller enumeration of the composition space.
 *
 * Pure module: no DB, no LLM, no clock. Given a caller key and a day, it yields
 * a stable permutation of [0, spaceSize) that differs from every other caller's.
 * Paging forward through it never repeats a combination, so a caller can keep
 * asking for more openings until the space is genuinely exhausted.
 *
 * The permutation is an affine map i -> (a*i + b) mod n with gcd(a, n) = 1,
 * which is bijective by construction. Chosen over a shuffled array because the
 * space is ~10^5 entries and never needs materialising.
 */

/** FNV-1a 32-bit — the hash family already used for ordering salt in mcp/tools/opportunities.ts. */
function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Stable seed for one caller on one UTC day. */
export function seedFor(ownerKey: string, day: string): number {
  return fnv1a(`${ownerKey}:${day}`);
}

function gcd(a: number, b: number): number {
  while (b !== 0) [a, b] = [b, a % b];
  return a;
}

/** Smallest multiplier >= start that is coprime with n. Always terminates. */
function coprimeFor(start: number, n: number): number {
  if (n <= 1) return 1;
  let a = start % n || 1;
  for (let tries = 0; tries < n; tries++) {
    if (gcd(a, n) === 1) return a;
    a = (a % n) + 1;
  }
  return 1;
}

/**
 * Bijective index permutation over [0, n). Products stay well under 2^53 for
 * any realistic space size, so plain number arithmetic is exact.
 */
export function permuteIndex(i: number, n: number, seed: number): number {
  if (n <= 0) return 0;
  const a = coprimeFor(seed, n);
  const b = seed % n;
  return (a * (i % n) + b) % n;
}

/**
 * The caller's indices for one page. `cursor` is an offset into their personal
 * permutation, so consecutive pages are disjoint and order is stable all day.
 */
export function sliceFor(
  ownerKey: string,
  day: string,
  spaceSize: number,
  cursor: number,
  count: number,
): number[] {
  if (spaceSize <= 0 || count <= 0 || cursor >= spaceSize) return [];
  const seed = seedFor(ownerKey, day);
  const end = Math.min(cursor + count, spaceSize);
  const out: number[] = [];
  for (let i = cursor; i < end; i++) out.push(permuteIndex(i, spaceSize, seed));
  return out;
}

/** UTC day key — the unit a caller's ordering is stable for. */
export function dayKey(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}
```

- [ ] **Step 4: Run the tests**

```bash
npx vitest run tests/opportunity-seed.test.ts
```

Expected: PASS, 9 tests. The bijection test is the critical one — if it fails, composition will silently serve duplicates.

- [ ] **Step 5: Commit**

```bash
git add src/lib/opportunities/seed.ts tests/opportunity-seed.test.ts
git commit -m "feat(opportunities): deterministic per-caller enumeration of the composition space"
```

---

## Task 9: Primitive extraction and tagging

**Files:**
- Create: `src/lib/opportunities/primitives.ts`
- Create: `tests/opportunity-primitives.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/opportunity-primitives.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { deriveTags, loadPrimitives } from '@/lib/opportunities/primitives';
import { painPoints } from '@/lib/db/schema';
import { useTestDb } from './helpers/db';
import type { Db } from '@/lib/db';

describe('deriveTags', () => {
  it('tags agentic language', () => {
    expect(deriveTags('teams cannot get their MCP agent to call tools reliably', null))
      .toContain('agentic');
  });

  it('tags regulated language', () => {
    expect(deriveTags('SOC2 compliance evidence collection is manual', null)).toContain('regulated');
  });

  it('tags from the sector when the text is quiet', () => {
    expect(deriveTags('nothing specific here at all', 'devtools')).toContain('devtools');
  });

  it('de-duplicates repeated keyword hits', () => {
    expect(deriveTags('API api Api infrastructure', null).filter((t) => t === 'infra')).toHaveLength(1);
  });

  it('always returns at least one tag', () => {
    expect(deriveTags('', null).length).toBeGreaterThan(0);
  });
});

describe('loadPrimitives', () => {
  let db: Db;
  beforeEach(() => {
    db = useTestDb();
  });

  it('returns an empty list when the stream is empty', () => {
    expect(loadPrimitives()).toEqual([]);
  });

  it('extracts pains with normalized intensity and refs', () => {
    const now = new Date();
    db.insert(painPoints)
      .values({
        summary: 'Bulk background removal for product photos is painfully manual',
        sector: 'commerce',
        intensity: 9,
        firstSeenAt: now,
        lastSeenAt: now,
      })
      .run();

    const prims = loadPrimitives();
    expect(prims).toHaveLength(1);
    expect(prims[0].type).toBe('pain');
    expect(prims[0].ref).toMatch(/^P\d+$/);
    expect(prims[0].intensity).toBeGreaterThan(0);
    expect(prims[0].intensity).toBeLessThanOrEqual(100);
    expect(prims[0].tags).toContain('commerce');
  });

  it('gives every primitive a unique ref', () => {
    const now = new Date();
    for (let i = 0; i < 5; i++) {
      db.insert(painPoints)
        .values({
          summary: `A distinct recurring pain number ${i} that teams keep reporting`,
          sector: 'devtools',
          intensity: 5,
          firstSeenAt: now,
          lastSeenAt: now,
        })
        .run();
    }
    const refs = loadPrimitives().map((p) => p.ref);
    expect(new Set(refs).size).toBe(refs.length);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run tests/opportunity-primitives.test.ts
```

Expected: FAIL — `Failed to resolve import "@/lib/opportunities/primitives"`.

If instead it fails on a NOT NULL constraint from the `painPoints` insert, open the `painPoints` table in `src/lib/db/schema.ts` and add the missing required fields to the fixture. Do not change the schema to suit the test.

- [ ] **Step 3: Implement primitives**

Create `src/lib/opportunities/primitives.ts`:

```ts
/**
 * Intelligence primitives for Rung-0 composition: the raw "something is
 * happening here" units that get crossed against the wedge taxonomy.
 *
 * Deliberately wider than engine.ts's buildContext() (12 pains / 8 patterns /
 * 10 stories). That narrow, fixed window is exactly why the LLM proposer
 * converges on the same handful of ideas for everyone; composition wants the
 * broadest defensible pool so the permutation has room to differentiate.
 */
import { and, desc, eq, gte } from 'drizzle-orm';
import { latestPatterns, topEntities } from '../analytics';
import { getDb } from '../db';
import { painPoints, stories } from '../db/schema';
import { promptLine } from '../prompt-hygiene';

export type PrimitiveType = 'pain' | 'pattern' | 'entity' | 'story';

export interface Primitive {
  /** Stable evidence ref within one load: P1, A2, E3, S4 */
  ref: string;
  type: PrimitiveType;
  label: string;
  sector: string | null;
  tags: string[];
  /** 0..100 — how loudly the stream is signalling this */
  intensity: number;
}

/** Keyword → tag. Kept in sync with the tag vocabulary used in wedges.ts. */
const TAG_LEXICON: Record<string, string[]> = {
  agentic: ['agent', 'agentic', 'mcp', 'tool call', 'tool-call', 'autonomous', 'copilot'],
  infra: ['api', 'infrastructure', 'latency', 'throughput', 'pipeline', 'deploy', 'server', 'sdk'],
  data: ['dataset', 'data', 'benchmark', 'scrape', 'index', 'embedding', 'analytics', 'telemetry'],
  regulated: ['compliance', 'soc2', 'hipaa', 'gdpr', 'audit', 'regulation', 'legal', 'privacy'],
  creative: ['image', 'video', 'design', 'render', 'creative', 'music', 'art', 'copywriting'],
  commerce: ['ecommerce', 'shopify', 'storefront', 'checkout', 'product photo', 'marketplace', 'seller'],
  devtools: ['ide', 'editor', 'lint', 'ci', 'repo', 'code review', 'debug', 'refactor', 'devtool'],
  consumer: ['consumer', 'personal', 'hobby', 'everyday', 'mobile app'],
  enterprise: ['enterprise', 'sso', 'procurement', 'on-prem', 'rbac', 'tenant'],
};

/**
 * Tags for one primitive: lexicon hits over the text, plus the sector itself.
 * Never returns empty — an untagged primitive would match only rule-free wedge
 * values and skew the space.
 */
export function deriveTags(text: string, sector: string | null): string[] {
  const hay = text.toLowerCase();
  const tags = new Set<string>();
  for (const [tag, keywords] of Object.entries(TAG_LEXICON)) {
    if (keywords.some((k) => hay.includes(k))) tags.add(tag);
  }
  if (sector) tags.add(sector.toLowerCase());
  if (tags.size === 0) tags.add('general');
  return [...tags];
}

const LOOKBACK_DAYS = 21;
const MAX_PAINS = 40;
const MAX_STORIES = 30;

/** Clamp an unbounded count into 1..100. */
function normalize(value: number, ceiling: number): number {
  return Math.max(1, Math.min(100, Math.round((value / ceiling) * 100)));
}

/** The composable primitive pool. Empty when the stream has nothing recent. */
export function loadPrimitives(): Primitive[] {
  const db = getDb();
  const since = new Date(Date.now() - LOOKBACK_DAYS * 864e5);
  const out: Primitive[] = [];

  const pains = db
    .select()
    .from(painPoints)
    .where(gte(painPoints.lastSeenAt, since))
    .orderBy(desc(painPoints.intensity), desc(painPoints.lastSeenAt))
    .limit(MAX_PAINS)
    .all();
  pains.forEach((p, i) => {
    const label = promptLine(p.summary, 160);
    out.push({
      ref: `P${i + 1}`,
      type: 'pain',
      label,
      sector: p.sector ?? null,
      tags: deriveTags(label, p.sector ?? null),
      intensity: normalize(p.intensity, 20),
    });
  });

  latestPatterns(15).forEach((p, i) => {
    const label = promptLine(p.headline, 160);
    out.push({
      ref: `A${i + 1}`,
      type: 'pattern',
      label,
      sector: null,
      tags: deriveTags(label, null),
      intensity: 60,
    });
  });

  topEntities(20).forEach((e, i) => {
    const label = `${promptLine(e.name, 60)} (${e.count} mentions)`;
    out.push({
      ref: `E${i + 1}`,
      type: 'entity',
      label,
      sector: null,
      tags: deriveTags(label, null),
      intensity: normalize(e.count, 50),
    });
  });

  const topStories = db
    .select()
    .from(stories)
    .where(and(eq(stories.status, 'curated'), gte(stories.createdAt, since)))
    .orderBy(desc(stories.topScore))
    .limit(MAX_STORIES)
    .all();
  topStories.forEach((s, i) => {
    const label = promptLine(s.title, 160);
    out.push({
      ref: `S${i + 1}`,
      type: 'story',
      label,
      sector: null,
      tags: deriveTags(`${label} ${s.tldr ?? ''}`, null),
      intensity: normalize(s.topScore ?? 0, 100),
    });
  });

  return out;
}
```

- [ ] **Step 4: Run the tests**

```bash
npx vitest run tests/opportunity-primitives.test.ts
```

Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/opportunities/primitives.ts tests/opportunity-primitives.test.ts
git commit -m "feat(opportunities): wide primitive pool with lexicon-derived tags"
```

---

## Task 10: The composer (Rung 0)

**Files:**
- Create: `src/lib/opportunities/compose.ts`
- Create: `tests/opportunity-compose.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/opportunity-compose.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { composeLeads } from '@/lib/opportunities/compose';
import { loadWedges, seedWedges, wedgeCompatible, wedgeAt } from '@/lib/opportunities/wedges';
import type { Primitive } from '@/lib/opportunities/primitives';
import { useTestDb } from './helpers/db';

function prim(ref: string, label: string, tags: string[], intensity = 50): Primitive {
  return { ref, type: 'pain', label, sector: null, tags, intensity };
}

const PRIMITIVES: Primitive[] = [
  prim('P1', 'Bulk product photo editing is manual for storefront sellers', ['commerce', 'creative']),
  prim('P2', 'Agents cannot call internal tools without bespoke glue', ['agentic', 'infra']),
  prim('P3', 'SOC2 evidence collection eats a week each quarter', ['regulated', 'data']),
  prim('P4', 'Code review backlogs block small teams', ['devtools']),
];

describe('composeLeads', () => {
  beforeEach(() => {
    useTestDb();
    seedWedges();
  });

  it('returns the requested number of leads', () => {
    const res = composeLeads({
      primitives: PRIMITIVES, space: loadWedges(),
      ownerKey: 'user:1', day: '2026-08-25', cursor: 0, limit: 5,
    });
    expect(res.leads).toHaveLength(5);
  });

  it('only emits compatible pairings', () => {
    const space = loadWedges();
    const res = composeLeads({
      primitives: PRIMITIVES, space,
      ownerKey: 'user:1', day: '2026-08-25', cursor: 0, limit: 20,
    });
    for (const lead of res.leads) {
      const primitive = PRIMITIVES.find((p) => lead.primitiveRefs.includes(p.ref));
      expect(primitive, `lead ${lead.slug} has no source primitive`).toBeDefined();
      const wedgeIndex = Math.floor(lead.combinationIndex / PRIMITIVES.length);
      expect(wedgeCompatible(wedgeAt(space, wedgeIndex), primitive!.tags)).toBe(true);
    }
  });

  it('gives two callers different leads from the same inputs', () => {
    const space = loadWedges();
    const args = { primitives: PRIMITIVES, space, day: '2026-08-25', cursor: 0, limit: 10 };
    const a = composeLeads({ ...args, ownerKey: 'user:1' }).leads.map((l) => l.slug);
    const b = composeLeads({ ...args, ownerKey: 'user:2' }).leads.map((l) => l.slug);
    expect(a.filter((s) => b.includes(s)).length).toBeLessThanOrEqual(2);
  });

  it('never repeats a lead while paging', () => {
    const space = loadWedges();
    const seen = new Set<string>();
    let cursor = 0;
    for (let page = 0; page < 5; page++) {
      const res = composeLeads({
        primitives: PRIMITIVES, space, ownerKey: 'user:1',
        day: '2026-08-25', cursor, limit: 8,
      });
      for (const lead of res.leads) {
        expect(seen.has(lead.slug), `repeat: ${lead.slug}`).toBe(false);
        seen.add(lead.slug);
      }
      expect(res.nextCursor).not.toBeNull();
      cursor = res.nextCursor!;
    }
    expect(seen.size).toBe(40);
  });

  it('is deterministic for the same caller, day and cursor', () => {
    const space = loadWedges();
    const args = {
      primitives: PRIMITIVES, space, ownerKey: 'user:1',
      day: '2026-08-25', cursor: 0, limit: 6,
    };
    expect(composeLeads(args).leads.map((l) => l.slug))
      .toEqual(composeLeads(args).leads.map((l) => l.slug));
  });

  it('honours avoided sectors', () => {
    const withSector = [prim('P9', 'Storefront sellers drown in returns', ['commerce'], 80)];
    withSector[0].sector = 'commerce';
    const res = composeLeads({
      primitives: withSector, space: loadWedges(), ownerKey: 'user:1',
      day: '2026-08-25', cursor: 0, limit: 5, avoidSectors: ['commerce'],
    });
    expect(res.leads).toHaveLength(0);
  });

  it('skips slugs the caller has already seen', () => {
    const space = loadWedges();
    const first = composeLeads({
      primitives: PRIMITIVES, space, ownerKey: 'user:1',
      day: '2026-08-25', cursor: 0, limit: 3,
    });
    const exclude = new Set(first.leads.map((l) => l.slug));
    const second = composeLeads({
      primitives: PRIMITIVES, space, ownerKey: 'user:1',
      day: '2026-08-25', cursor: 0, limit: 3, excludeSlugs: exclude,
    });
    expect(second.leads.every((l) => !exclude.has(l.slug))).toBe(true);
  });

  it('returns nothing when there are no primitives', () => {
    const res = composeLeads({
      primitives: [], space: loadWedges(), ownerKey: 'user:1',
      day: '2026-08-25', cursor: 0, limit: 5,
    });
    expect(res.leads).toEqual([]);
    expect(res.spaceSize).toBe(0);
  });

  it('scores every lead within 0..100', () => {
    const res = composeLeads({
      primitives: PRIMITIVES, space: loadWedges(), ownerKey: 'user:1',
      day: '2026-08-25', cursor: 0, limit: 15,
    });
    for (const lead of res.leads) {
      expect(lead.heuristicScore).toBeGreaterThanOrEqual(0);
      expect(lead.heuristicScore).toBeLessThanOrEqual(100);
    }
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run tests/opportunity-compose.test.ts
```

Expected: FAIL — `Failed to resolve import "@/lib/opportunities/compose"`.

- [ ] **Step 3: Implement the composer**

Create `src/lib/opportunities/compose.ts`:

```ts
/**
 * Rung 0 — deterministic, zero-LLM composition.
 *
 * The candidate space is primitives x wedges. A caller walks it through their
 * own bijective permutation (seed.ts), skipping combinations whose wedge is
 * incompatible with the primitive's tags. The result is a LeadDraft: an
 * explicitly UNVALIDATED hypothesis, never a scored opportunity.
 *
 * Pure: no DB, no LLM, no clock. Everything it needs is passed in.
 */
import { normalizeSlug } from './engine';
import type { Primitive } from './primitives';
import { sliceFor } from './seed';
import { wedgeAt, wedgeCompatible, wedgeSpaceSize, WEDGE_AXES } from './wedges';
import type { WedgeAxis, WedgeSpace } from './wedges';

export interface LeadDraft {
  slug: string;
  title: string;
  /** Honest skeleton — a shape to refine, not a claim to act on. */
  thesisSkeleton: string;
  sector: string | null;
  primitiveRefs: string[];
  /** axis → wedge value slug */
  wedge: Record<WedgeAxis, string>;
  /** 0..100 heuristic only. Deliberately NOT called a flip score. */
  heuristicScore: number;
  /** Position in the primitives x wedges space; lets callers verify decoding. */
  combinationIndex: number;
}

export interface ComposeResult {
  leads: LeadDraft[];
  /** Feed back as `cursor` for the next page; null when the space is exhausted. */
  nextCursor: number | null;
  spaceSize: number;
  /** Combinations examined, including those rejected — for observability. */
  scanned: number;
}

export interface ComposeOptions {
  primitives: Primitive[];
  space: WedgeSpace;
  ownerKey: string;
  day: string;
  cursor: number;
  limit: number;
  avoidSectors?: string[];
  excludeSlugs?: Set<string>;
}

/** Candidate indices requested per scan batch. */
const SCAN_WINDOW = 64;
/** Hard ceiling on work per call, so a hostile taxonomy cannot spin the CPU. */
const MAX_SCAN = 4000;

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'their', 'they',
  'are', 'was', 'were', 'has', 'have', 'not', 'but', 'its', 'out', 'off',
  'cannot', 'without', 'each', 'every', 'keeps', 'keep', 'still', 'when',
]);

/** Two or three meaningful words from a primitive label — the slug/title stem. */
function keywords(label: string, count: number): string[] {
  return label
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 3 && !STOPWORDS.has(w))
    .slice(0, count);
}

/** Title-case a keyword phrase for display. */
function phrase(words: string[]): string {
  if (words.length === 0) return 'an emerging gap';
  return words.join(' ');
}

export function composeLeads(opts: ComposeOptions): ComposeResult {
  const { primitives, space, ownerKey, day, cursor, limit } = opts;
  const avoid = new Set((opts.avoidSectors ?? []).map((s) => s.toLowerCase()));
  const exclude = opts.excludeSlugs ?? new Set<string>();

  const wedgeCount = wedgeSpaceSize(space);
  const spaceSize = primitives.length * wedgeCount;
  if (spaceSize === 0 || limit <= 0) {
    return { leads: [], nextCursor: null, spaceSize, scanned: 0 };
  }

  const leads: LeadDraft[] = [];
  const emitted = new Set<string>();
  let pos = Math.max(0, cursor);
  let scanned = 0;

  while (leads.length < limit && pos < spaceSize && scanned < MAX_SCAN) {
    const window = sliceFor(ownerKey, day, spaceSize, pos, SCAN_WINDOW);
    if (window.length === 0) break;

    for (const index of window) {
      pos += 1;
      scanned += 1;

      // decode: primitive varies fastest so adjacent positions differ visibly
      const primitive = primitives[index % primitives.length];
      const wedge = wedgeAt(space, Math.floor(index / primitives.length));

      if (primitive.sector && avoid.has(primitive.sector.toLowerCase())) continue;
      if (!wedgeCompatible(wedge, primitive.tags)) continue;

      const stem = keywords(primitive.label, 3);
      const slug = normalizeSlug(
        `${stem.join('-')}-${wedge.delivery_form.slug}-${wedge.buyer.slug}-${index.toString(36)}`,
      );
      if (!slug || exclude.has(slug) || emitted.has(slug)) continue;

      // primitive loudness (0..50) + average wedge weight (0..50)
      const avgWeight =
        WEDGE_AXES.reduce((n, axis) => n + wedge[axis].weight, 0) / WEDGE_AXES.length;
      const heuristicScore = Math.max(
        0,
        Math.min(100, Math.round(primitive.intensity * 0.5 + avgWeight * 2.5)),
      );

      emitted.add(slug);
      leads.push({
        slug,
        title: `${phrase(stem)} as ${wedge.delivery_form.label} for ${wedge.buyer.label}`,
        thesisSkeleton:
          `${wedge.buyer.label} are hit by: ${primitive.label} ` +
          `Deliver it as ${wedge.delivery_form.label} on a ${wedge.business_model.label}, ` +
          `defended by ${wedge.moat_play.label}. ` +
          `Composed from live signal and not yet validated — refine it to get scores and KPIs.`,
        sector: primitive.sector,
        primitiveRefs: [primitive.ref],
        wedge: {
          business_model: wedge.business_model.slug,
          delivery_form: wedge.delivery_form.slug,
          buyer: wedge.buyer.slug,
          moat_play: wedge.moat_play.slug,
        },
        heuristicScore,
        combinationIndex: index,
      });

      if (leads.length >= limit) break;
    }
  }

  return {
    leads,
    nextCursor: pos < spaceSize ? pos : null,
    spaceSize,
    scanned,
  };
}
```

- [ ] **Step 4: Run the tests**

```bash
npx vitest run tests/opportunity-compose.test.ts
```

Expected: PASS, 9 tests.

If "only emits compatible pairings" fails, the decode in the test and the decode in `composeLeads` disagree — both must use `index % primitives.length` for the primitive and `Math.floor(index / primitives.length)` for the wedge. Fix whichever drifted.

- [ ] **Step 5: Commit**

```bash
git add src/lib/opportunities/compose.ts tests/opportunity-compose.test.ts
git commit -m "feat(opportunities): zero-LLM composer over the primitive x wedge space"
```

---

## Task 11: Lead storage

**Files:**
- Modify: `src/lib/db/schema.ts`
- Create: `src/lib/opportunities/leads.ts`
- Create: `tests/leads-repo.test.ts`

- [ ] **Step 1: Add the table to the schema**

Append to `src/lib/db/schema.ts`:

```ts
/**
 * Rung-0 composed leads, owner-scoped.
 *
 * Separate from `opportunities` on purpose: a lead is a heuristic hypothesis
 * with no verdict and no flip score, and an agent must never be able to mistake
 * one for a reviewed dossier. Refining a lead creates an `opportunities` row
 * and back-links it via opportunityId.
 *
 * ownerUserId NULL + ownerKey set = anonymous caller; those rows carry an
 * expiresAt and are swept periodically.
 */
export const leads = sqliteTable(
  'leads',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    // AuthContext.rateKey — 'user:123' or 'ip:1.2.3.4'
    ownerKey: text('owner_key').notNull(),
    ownerUserId: integer('owner_user_id'),
    slug: text('slug').notNull(),
    title: text('title').notNull(),
    thesisSkeleton: text('thesis_skeleton').notNull(),
    sector: text('sector'),
    // JSON string[] of primitive refs (P1, A2, ...)
    primitiveRefs: text('primitive_refs').notNull().default('[]'),
    // JSON Record<axis, wedge value slug>
    wedge: text('wedge').notNull().default('{}'),
    heuristicScore: integer('heuristic_score').notNull().default(0),
    combinationIndex: integer('combination_index').notNull().default(0),
    // 'composed' → 'refined'
    stage: text('stage', { enum: ['composed', 'refined'] }).notNull().default('composed'),
    opportunityId: integer('opportunity_id'),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
    // set for anonymous callers only; NULL means keep
    expiresAt: integer('expires_at', { mode: 'timestamp' }),
    dismissedAt: integer('dismissed_at', { mode: 'timestamp' }),
    dismissReason: text('dismiss_reason'),
  },
  (t) => [
    uniqueIndex('leads_owner_slug').on(t.ownerKey, t.slug),
    index('leads_owner_created').on(t.ownerKey, t.createdAt),
    index('leads_expires').on(t.expiresAt),
  ],
);
```

- [ ] **Step 2: Generate the migration**

```bash
npm run db:generate
```

Expected: a new migration creating `leads` and its three indexes.

- [ ] **Step 3: Write the failing test**

Create `tests/leads-repo.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import {
  dismissLead, expireLeads, getLead, insertLeads, listLeads, markRefined,
} from '@/lib/opportunities/leads';
import type { LeadDraft } from '@/lib/opportunities/compose';
import { useTestDb } from './helpers/db';

function draft(slug: string, score = 50): LeadDraft {
  return {
    slug,
    title: `Title for ${slug}`,
    thesisSkeleton: 'A composed skeleton awaiting refinement.',
    sector: 'devtools',
    primitiveRefs: ['P1'],
    wedge: {
      business_model: 'subscription-saas', delivery_form: 'cli-tool',
      buyer: 'solo-builder', moat_play: 'workflow-lock-in',
    },
    heuristicScore: score,
    combinationIndex: 42,
  };
}

const ALICE = { ownerKey: 'user:1', userId: 1 };
const ANON = { ownerKey: 'ip:9.9.9.9', userId: null };

describe('lead repository', () => {
  beforeEach(() => {
    useTestDb();
  });

  it('inserts and lists a caller own leads', () => {
    insertLeads(ALICE, [draft('a'), draft('b')]);
    const page = listLeads(ALICE, { limit: 10 });
    expect(page.leads).toHaveLength(2);
  });

  it('never leaks leads across owners', () => {
    insertLeads(ALICE, [draft('mine')]);
    insertLeads({ ownerKey: 'user:2', userId: 2 }, [draft('theirs')]);
    expect(listLeads(ALICE, { limit: 10 }).leads.map((l) => l.slug)).toEqual(['mine']);
    expect(getLead(ALICE, 'theirs')).toBeNull();
  });

  it('is idempotent on re-insert of the same slug', () => {
    insertLeads(ALICE, [draft('dupe')]);
    insertLeads(ALICE, [draft('dupe')]);
    expect(listLeads(ALICE, { limit: 10 }).leads).toHaveLength(1);
  });

  it('orders by heuristic score descending', () => {
    insertLeads(ALICE, [draft('low', 10), draft('high', 90), draft('mid', 50)]);
    expect(listLeads(ALICE, { limit: 10 }).leads.map((l) => l.slug))
      .toEqual(['high', 'mid', 'low']);
  });

  it('paginates with a cursor', () => {
    insertLeads(ALICE, Array.from({ length: 7 }, (_, i) => draft(`s${i}`, 100 - i)));
    const first = listLeads(ALICE, { limit: 3 });
    expect(first.leads).toHaveLength(3);
    expect(first.nextCursor).toBe(3);
    const second = listLeads(ALICE, { limit: 3, cursor: first.nextCursor! });
    expect(second.leads.map((l) => l.slug))
      .not.toEqual(expect.arrayContaining(first.leads.map((l) => l.slug)));
  });

  it('hides dismissed leads and records the reason', () => {
    insertLeads(ALICE, [draft('nope')]);
    expect(dismissLead(ALICE, 'nope', 'too capital heavy')).toBe(true);
    expect(listLeads(ALICE, { limit: 10 }).leads).toHaveLength(0);
    expect(getLead(ALICE, 'nope')?.dismissReason).toBe('too capital heavy');
  });

  it('marks a lead refined and back-links the opportunity', () => {
    const [row] = insertLeads(ALICE, [draft('promote-me')]);
    markRefined(row.id, 555);
    const after = getLead(ALICE, 'promote-me');
    expect(after?.stage).toBe('refined');
    expect(after?.opportunityId).toBe(555);
  });

  it('expires anonymous leads but keeps signed-in ones', () => {
    insertLeads(ANON, [draft('ephemeral')]);
    insertLeads(ALICE, [draft('durable')]);
    const later = new Date(Date.now() + 8 * 864e5);
    expect(expireLeads(later)).toBe(1);
    expect(listLeads(ALICE, { limit: 10 }).leads.map((l) => l.slug)).toEqual(['durable']);
  });
});
```

- [ ] **Step 4: Run it and watch it fail**

```bash
npx vitest run tests/leads-repo.test.ts
```

Expected: FAIL — `Failed to resolve import "@/lib/opportunities/leads"`.

- [ ] **Step 5: Implement the repository**

Create `src/lib/opportunities/leads.ts`:

```ts
/**
 * Lead repository — storage for Rung-0 composed hypotheses.
 *
 * Every function takes an Owner and scopes by ownerKey. There is deliberately
 * no "list all leads" call: leads are private by construction, and a helper
 * that forgets the owner is how private pools leak.
 */
import { and, desc, eq, isNotNull, isNull, lt } from 'drizzle-orm';
import { getDb } from '../db';
import { leads } from '../db/schema';
import type { LeadDraft } from './compose';

export interface Owner {
  /** AuthContext.rateKey — the stable identity of this pool. */
  ownerKey: string;
  /** Null for anonymous callers; their leads expire. */
  userId: number | null;
}

export interface LeadRow {
  id: number;
  slug: string;
  title: string;
  thesisSkeleton: string;
  sector: string | null;
  primitiveRefs: string[];
  wedge: Record<string, string>;
  heuristicScore: number;
  combinationIndex: number;
  stage: 'composed' | 'refined';
  opportunityId: number | null;
  createdAt: Date;
  dismissedAt: Date | null;
  dismissReason: string | null;
}

/** Anonymous pools are ephemeral — no durable identity owns them. */
const ANON_TTL_DAYS = 7;

function parse<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

type Row = typeof leads.$inferSelect;

function toLead(r: Row): LeadRow {
  return {
    id: r.id,
    slug: r.slug,
    title: r.title,
    thesisSkeleton: r.thesisSkeleton,
    sector: r.sector,
    primitiveRefs: parse<string[]>(r.primitiveRefs, []),
    wedge: parse<Record<string, string>>(r.wedge, {}),
    heuristicScore: r.heuristicScore,
    combinationIndex: r.combinationIndex,
    stage: r.stage,
    opportunityId: r.opportunityId,
    createdAt: r.createdAt,
    dismissedAt: r.dismissedAt,
    dismissReason: r.dismissReason,
  };
}

/** Persist drafts for this owner. Existing slugs are left untouched. */
export function insertLeads(owner: Owner, drafts: LeadDraft[]): LeadRow[] {
  const db = getDb();
  const now = new Date();
  const expiresAt = owner.userId == null ? new Date(now.getTime() + ANON_TTL_DAYS * 864e5) : null;
  const out: LeadRow[] = [];

  for (const d of drafts) {
    const prior = db
      .select()
      .from(leads)
      .where(and(eq(leads.ownerKey, owner.ownerKey), eq(leads.slug, d.slug)))
      .get();
    if (prior) {
      out.push(toLead(prior));
      continue;
    }
    const inserted = db
      .insert(leads)
      .values({
        ownerKey: owner.ownerKey,
        ownerUserId: owner.userId,
        slug: d.slug,
        title: d.title,
        thesisSkeleton: d.thesisSkeleton,
        sector: d.sector,
        primitiveRefs: JSON.stringify(d.primitiveRefs),
        wedge: JSON.stringify(d.wedge),
        heuristicScore: d.heuristicScore,
        combinationIndex: d.combinationIndex,
        createdAt: now,
        expiresAt,
      })
      .returning()
      .get();
    if (inserted) out.push(toLead(inserted));
  }
  return out;
}

export interface LeadPage {
  leads: LeadRow[];
  nextCursor: number | null;
}

/** This owner's undismissed leads, strongest heuristic first. */
export function listLeads(
  owner: Owner,
  opts: { limit: number; cursor?: number; sector?: string },
): LeadPage {
  const db = getDb();
  const cursor = opts.cursor ?? 0;
  const conds = [eq(leads.ownerKey, owner.ownerKey), isNull(leads.dismissedAt)];
  if (opts.sector) conds.push(eq(leads.sector, opts.sector));

  // fetch one extra to decide whether another page exists
  const rows = db
    .select()
    .from(leads)
    .where(and(...conds))
    .orderBy(desc(leads.heuristicScore), desc(leads.id))
    .limit(opts.limit + 1)
    .offset(cursor)
    .all();

  const page = rows.slice(0, opts.limit);
  return {
    leads: page.map(toLead),
    nextCursor: rows.length > opts.limit ? cursor + page.length : null,
  };
}

/** One lead by slug, scoped to the owner. Null when it is not theirs. */
export function getLead(owner: Owner, slug: string): LeadRow | null {
  const row = getDb()
    .select()
    .from(leads)
    .where(and(eq(leads.ownerKey, owner.ownerKey), eq(leads.slug, slug)))
    .get();
  return row ? toLead(row) : null;
}

/** Hide a lead and record why. False when the slug is not this owner's. */
export function dismissLead(owner: Owner, slug: string, reason: string): boolean {
  const res = getDb()
    .update(leads)
    .set({ dismissedAt: new Date(), dismissReason: reason.slice(0, 200) })
    .where(and(eq(leads.ownerKey, owner.ownerKey), eq(leads.slug, slug)))
    .run();
  return res.changes > 0;
}

/** Promote: link the lead to the opportunity Rung 1 produced from it. */
export function markRefined(leadId: number, opportunityId: number): void {
  getDb()
    .update(leads)
    .set({ stage: 'refined', opportunityId })
    .where(eq(leads.id, leadId))
    .run();
}

/** Sweep expired anonymous leads. Signed-in leads have a NULL expiry and survive. */
export function expireLeads(now: Date = new Date()): number {
  const res = getDb()
    .delete(leads)
    .where(and(isNotNull(leads.expiresAt), lt(leads.expiresAt, now)))
    .run();
  return res.changes;
}
```

- [ ] **Step 6: Run the tests**

```bash
npx vitest run tests/leads-repo.test.ts
```

Expected: PASS, 8 tests.

- [ ] **Step 7: Commit**

```bash
git add src/lib/db/schema.ts src/lib/opportunities/leads.ts tests/leads-repo.test.ts drizzle/
git commit -m "feat(opportunities): owner-scoped lead storage with cursor paging and expiry"
```

---

## Task 12: The `get_leads` MCP tool

**Files:**
- Create: `mcp/tools/leads.ts`
- Modify: `mcp/build.ts`
- Create: `tests/mcp-leads.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/mcp-leads.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { AuthContext } from '../mcp/lib/auth';
import { registerLeadTools } from '../mcp/tools/leads';
import { seedWedges } from '@/lib/opportunities/wedges';
import { painPoints } from '@/lib/db/schema';
import { useTestDb } from './helpers/db';
import type { Db } from '@/lib/db';

function authFor(userId: number | null, rateKey: string): AuthContext {
  return { authed: userId != null, userId, scopes: new Set(['read']), rateKey };
}

async function wire(auth: AuthContext): Promise<Client> {
  const server = new McpServer({ name: 'leads-test', version: '0.0.1' });
  registerLeadTools(server, auth);
  const client = new Client({ name: 'test', version: '0.0.1' });
  const [c, s] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(c), server.connect(s)]);
  return client;
}

interface LeadsPayload {
  count: number;
  leads: { slug: string; title: string; heuristic_score: number; stage: string }[];
  next_cursor: number | null;
  space_size: number;
  summary: string;
  next: { tool: string }[];
}

function seedPains(db: Db, n: number) {
  const now = new Date();
  const topics = [
    'Bulk product photo editing is manual for storefront sellers',
    'Agents cannot call internal tools without bespoke glue code',
    'SOC2 evidence collection eats a week each quarter for ops teams',
    'Code review backlogs block small engineering teams every sprint',
    'Video render pipelines cost more than the creative work itself',
  ];
  for (let i = 0; i < n; i++) {
    db.insert(painPoints)
      .values({
        summary: `${topics[i % topics.length]} (variant ${i})`,
        sector: 'devtools',
        intensity: 10 - (i % 5),
        firstSeenAt: now,
        lastSeenAt: now,
      })
      .run();
  }
}

describe('get_leads', () => {
  let db: Db;
  beforeEach(() => {
    db = useTestDb();
    seedWedges();
    seedPains(db, 6);
  });

  it('returns composed leads with no verdict or flip score', async () => {
    const client = await wire(authFor(1, 'user:1'));
    const res = await client.callTool({ name: 'get_leads', arguments: { limit: 5 } });
    const p = res.structuredContent as unknown as LeadsPayload;
    expect(p.count).toBe(5);
    expect(p.leads[0].stage).toBe('composed');
    expect(p.leads[0]).not.toHaveProperty('verdict');
    expect(p.leads[0]).not.toHaveProperty('flip_score');
    expect(p.space_size).toBeGreaterThan(1000);
  });

  it('gives two callers different leads', async () => {
    const a = (await (await wire(authFor(1, 'user:1')))
      .callTool({ name: 'get_leads', arguments: { limit: 8 } }))
      .structuredContent as unknown as LeadsPayload;
    const b = (await (await wire(authFor(2, 'user:2')))
      .callTool({ name: 'get_leads', arguments: { limit: 8 } }))
      .structuredContent as unknown as LeadsPayload;
    const overlap = a.leads.map((l) => l.slug).filter((s) => b.leads.some((l) => l.slug === s));
    expect(overlap.length).toBeLessThanOrEqual(2);
  });

  it('pages without repeating', async () => {
    const client = await wire(authFor(1, 'user:1'));
    const first = (await client.callTool({ name: 'get_leads', arguments: { limit: 5 } }))
      .structuredContent as unknown as LeadsPayload;
    expect(first.next_cursor).not.toBeNull();
    const second = (await client.callTool({
      name: 'get_leads',
      arguments: { limit: 5, cursor: first.next_cursor },
    })).structuredContent as unknown as LeadsPayload;
    const overlap = second.leads.map((l) => l.slug)
      .filter((s) => first.leads.some((l) => l.slug === s));
    expect(overlap).toEqual([]);
  });

  it('serves anonymous callers too', async () => {
    const client = await wire(authFor(null, 'ip:1.2.3.4'));
    const p = (await client.callTool({ name: 'get_leads', arguments: { limit: 3 } }))
      .structuredContent as unknown as LeadsPayload;
    expect(p.count).toBe(3);
  });

  it('explains itself when the stream is too thin', async () => {
    useTestDb();
    seedWedges();
    const client = await wire(authFor(1, 'user:1'));
    const p = (await client.callTool({ name: 'get_leads', arguments: { limit: 5 } }))
      .structuredContent as unknown as LeadsPayload;
    expect(p.count).toBe(0);
    expect(p.summary).toMatch(/no primitives|too thin|nothing/i);
    expect(p.next.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run tests/mcp-leads.test.ts
```

Expected: FAIL — `Failed to resolve import "../mcp/tools/leads"`.

- [ ] **Step 3: Implement the tool**

Create `mcp/tools/leads.ts`:

```ts
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { composeLeads } from '../../src/lib/opportunities/compose';
import { insertLeads, type Owner } from '../../src/lib/opportunities/leads';
import { loadPrimitives } from '../../src/lib/opportunities/primitives';
import { dayKey } from '../../src/lib/opportunities/seed';
import { loadWedges } from '../../src/lib/opportunities/wedges';
import { getProfile } from '../../src/lib/personalization';
import { can } from '../../src/lib/entitlements';
import { envelopeSchema, respond, withUserEconomy, type NextAction } from '../lib/payload';
import type { AuthContext } from '../lib/auth';

/** The pool identity for this caller. */
export function ownerFor(auth: AuthContext): Owner {
  return { ownerKey: auth.rateKey, userId: auth.userId };
}

const leadSchema = z.object({
  slug: z.string(),
  title: z.string(),
  thesis_skeleton: z.string(),
  sector: z.string().nullable(),
  wedge: z.record(z.string(), z.string()),
  evidence_refs: z.array(z.string()),
  heuristic_score: z.number(),
  stage: z.string(),
});

export function registerLeadTools(server: McpServer, auth: AuthContext): void {
  server.registerTool(
    'get_leads',
    {
      description:
        'Unlimited, free, instantly-generated business LEADS composed for you alone from the live intelligence stream crossed with a business-wedge taxonomy. Leads are UNVALIDATED hypotheses — they carry a heuristic score but deliberately no verdict, flip score or KPIs. Two callers never get the same leads, and paging with `cursor` keeps producing new ones until the space is exhausted. Costs no LLM budget. Call refine_lead to turn a promising one into a scored opportunity, or get_opportunities for the reviewed canonical radar.',
      inputSchema: {
        limit: z.number().int().min(1).max(25).default(8),
        cursor: z
          .number()
          .int()
          .min(0)
          .default(0)
          .describe('position in YOUR combination space — pass next_cursor from a prior call'),
        sector: z.string().max(60).optional().describe('sector slug filter, e.g. devtools'),
      },
      outputSchema: {
        ...envelopeSchema,
        count: z.number(),
        leads: z.array(leadSchema),
        next_cursor: z.number().nullable(),
        space_size: z.number().describe('total combinations available to you'),
      },
    },
    async ({ limit, cursor, sector }) => {
      const owner = ownerFor(auth);
      const primitives = loadPrimitives();
      const space = loadWedges();

      // Builder+ personalization steers away from sectors the user rejected
      let avoidSectors: string[] = [];
      if (auth.userId != null && can({ id: auth.userId }, 'personalize').ok) {
        avoidSectors = getProfile(auth.userId)?.avoidedSectors ?? [];
      }

      const filtered = sector
        ? primitives.filter((p) => (p.sector ?? '').toLowerCase() === sector.toLowerCase())
        : primitives;

      const composed = composeLeads({
        primitives: filtered,
        space,
        ownerKey: owner.ownerKey,
        day: dayKey(),
        cursor: cursor ?? 0,
        limit,
        avoidSectors,
      });

      if (composed.leads.length === 0) {
        const reason =
          primitives.length === 0
            ? 'the intelligence stream has no recent primitives to compose from'
            : composed.spaceSize === 0
              ? 'the wedge taxonomy is empty — run the seed script'
              : 'you have reached the end of your combination space for today';
        return respond(
          { count: 0, leads: [], next_cursor: null, space_size: composed.spaceSize },
          {
            summary: `No leads: ${reason}.`,
            economy: withUserEconomy(auth.userId, 'read'),
            next: [
              {
                tool: 'get_opportunities',
                arguments: { limit: 10 },
                reason: 'the reviewed canonical radar costs nothing to browse',
              },
            ],
          },
        );
      }

      // persist so refine_lead can find them by slug later
      insertLeads(owner, composed.leads);

      const top = composed.leads[0];
      const next: NextAction[] = [
        {
          tool: 'refine_lead',
          arguments: { lead: top.slug },
          reason: 'score the strongest lead into a real opportunity with KPIs',
        },
      ];
      if (composed.nextCursor !== null) {
        next.push({
          tool: 'get_leads',
          arguments: { limit, cursor: composed.nextCursor },
          reason: 'more leads — your space is far from exhausted',
        });
      }

      return respond(
        {
          count: composed.leads.length,
          leads: composed.leads.map((l) => ({
            slug: l.slug,
            title: l.title,
            thesis_skeleton: l.thesisSkeleton,
            sector: l.sector,
            wedge: l.wedge,
            evidence_refs: l.primitiveRefs,
            heuristic_score: l.heuristicScore,
            stage: 'composed',
          })),
          next_cursor: composed.nextCursor,
          space_size: composed.spaceSize,
        },
        {
          summary: `${composed.leads.length} unvalidated leads composed for you (of ${composed.spaceSize.toLocaleString()} combinations) — strongest: "${top.title}" (heuristic ${top.heuristicScore}). Refine one to get real scores.`,
          economy: withUserEconomy(auth.userId, 'read'),
          next,
        },
      );
    },
  );
}
```

- [ ] **Step 4: Register the tool**

In `mcp/build.ts`, add the import and the registration call next to the other opportunity tools:

```ts
import { registerLeadTools } from './tools/leads';
```

```ts
  registerLeadTools(server, auth);
```

- [ ] **Step 5: Run the tests**

```bash
npx vitest run tests/mcp-leads.test.ts
```

Expected: PASS, 5 tests.

- [ ] **Step 6: Run the full suite**

```bash
npm test
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add mcp/tools/leads.ts mcp/build.ts tests/mcp-leads.test.ts
git commit -m "feat(mcp): get_leads serves unlimited per-caller composed leads"
```

---

# Phase 3 — Rung 1: metered refinement

A lead becomes a real, scored opportunity through exactly one LLM call, reusing the sanitizer and gate the daily engine already trusts.

## Task 13: The refiner

**Files:**
- Create: `src/lib/opportunities/refine.ts`
- Create: `tests/opportunity-refine.test.ts`

`chatJSON(system, user, { feature, userId })` from `src/lib/llm/minimax.ts` writes its own `llm_calls` row using `feature`, which is what `countFeature()` in `src/lib/entitlements.ts` reads. Passing `feature: 'lead_refine'` therefore makes quota accounting automatic — do not hand-roll a counter here.

- [ ] **Step 1: Write the failing test**

Create `tests/opportunity-refine.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { refineLeads } from '@/lib/opportunities/refine';
import type { LeadRow } from '@/lib/opportunities/leads';
import type { Primitive } from '@/lib/opportunities/primitives';
import { SUB_KEYS } from '@/lib/opportunities/engine';
import { _setFetch } from '@/lib/llm/minimax';
import { useTestDb } from './helpers/db';

function lead(slug: string): LeadRow {
  return {
    id: 1, slug, title: `Title for ${slug}`,
    thesisSkeleton: 'A composed skeleton awaiting refinement.',
    sector: 'devtools', primitiveRefs: ['P1'],
    wedge: {
      business_model: 'subscription-saas', delivery_form: 'cli-tool',
      buyer: 'solo-builder', moat_play: 'workflow-lock-in',
    },
    heuristicScore: 60, combinationIndex: 7, stage: 'composed',
    opportunityId: null, createdAt: new Date(), dismissedAt: null, dismissReason: null,
  };
}

const PRIMITIVES: Primitive[] = [
  { ref: 'P1', type: 'pain', label: 'Code review backlogs block small teams', sector: 'devtools', tags: ['devtools'], intensity: 70 },
];

/** Reply the model would send for one opening. */
function modelReply(slug: string) {
  const subScores = Object.fromEntries(SUB_KEYS.map((k) => [k, 12]));
  return {
    openings: [
      {
        slug,
        title: 'Review queue triage for small teams',
        thesis: 'Small engineering teams lose a day a week to review backlogs; triage it automatically and charge per seat.',
        sector: 'devtools',
        window: '6 months',
        windowMonths: 6,
        subScores,
        kpis: {
          initialCostUsd: 200, monthlyCostUsd: 80, priceUsd: 25, timeToMvpDays: 21,
          breakEvenCustomers: 6, competitorCount: 4,
          competitionNote: 'Several adjacent tools, none focused.',
          regulatoryNote: null,
        },
        evidenceRefs: ['P1'],
      },
    ],
  };
}

function stubLlm(payload: unknown) {
  _setFetch(async () =>
    new Response(
      JSON.stringify({
        choices: [{ message: { content: JSON.stringify(payload) } }],
        usage: { prompt_tokens: 100, completion_tokens: 200 },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ),
  );
}

describe('refineLeads', () => {
  beforeEach(() => {
    useTestDb();
    vi.stubEnv('MINIMAX_API_KEY', 'test-key');
  });

  it('turns a lead into a scored draft', async () => {
    stubLlm(modelReply('review-queue-triage'));
    const drafts = await refineLeads({
      leads: [lead('review-queue-triage')], primitives: PRIMITIVES, userId: 1,
    });
    expect(drafts).toHaveLength(1);
    expect(drafts[0].title).toBe('Review queue triage for small teams');
    expect(drafts[0].kpis.priceUsd).toBe(25);
    for (const k of SUB_KEYS) expect(drafts[0].sub[k]).toBeGreaterThan(0);
  });

  it('drops openings whose evidence refs are not real', async () => {
    const bad = modelReply('bogus-refs');
    bad.openings[0].evidenceRefs = ['Z99'];
    stubLlm(bad);
    const drafts = await refineLeads({
      leads: [lead('bogus-refs')], primitives: PRIMITIVES, userId: 1,
    });
    expect(drafts[0]?.evidenceRefs ?? []).not.toContain('Z99');
  });

  it('returns nothing rather than throwing when the model returns junk', async () => {
    stubLlm({ openings: 'not an array' });
    const drafts = await refineLeads({
      leads: [lead('junk')], primitives: PRIMITIVES, userId: 1,
    });
    expect(drafts).toEqual([]);
  });

  it('makes no LLM call for an empty lead list', async () => {
    let called = false;
    _setFetch(async () => {
      called = true;
      return new Response('{}', { status: 200 });
    });
    const drafts = await refineLeads({ leads: [], primitives: PRIMITIVES, userId: 1 });
    expect(drafts).toEqual([]);
    expect(called).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run tests/opportunity-refine.test.ts
```

Expected: FAIL — `Failed to resolve import "@/lib/opportunities/refine"`.

- [ ] **Step 3: Implement the refiner**

Create `src/lib/opportunities/refine.ts`:

```ts
/**
 * Rung 1 — one metered LLM call turns composed leads into scored opportunity
 * drafts.
 *
 * The prompt is seeded from THIS caller's leads, which came from THIS caller's
 * slice of the composition space. That is what breaks the convergence the old
 * scout suffered: engine.ts's buildContext() handed every caller an identical
 * block, so the model proposed identical openings.
 *
 * Output goes through the same sanitizeOpportunities() the daily engine uses,
 * so a hallucinated evidence ref or an out-of-range score is dropped here
 * rather than persisted.
 */
import { getIdentity } from '../identity';
import { chatJSON } from '../llm/minimax';
import { promptLine } from '../prompt-hygiene';
import { sanitizeOpportunities, type OppDraft, type ScoutConstraints } from './engine';
import type { LeadRow } from './leads';
import type { Primitive } from './primitives';

export interface RefineOptions {
  leads: LeadRow[];
  primitives: Primitive[];
  constraints?: ScoutConstraints;
  userId: number | null;
}

function renderConstraints(c: ScoutConstraints): string {
  const lines = [
    c.skills ? `skills: ${promptLine(c.skills, 200)}` : null,
    c.capital ? `capital: ${promptLine(c.capital, 80)}` : null,
    c.hoursPerWeek !== undefined
      ? `hours per week: ${Math.max(0, Math.min(80, Math.round(c.hoursPerWeek)))}`
      : null,
    c.sector ? `sector focus: ${promptLine(c.sector, 60)}` : null,
    c.b2b !== undefined ? `market: ${c.b2b ? 'B2B' : 'B2C'}` : null,
    c.riskAppetite ? `risk appetite: ${c.riskAppetite}` : null,
  ].filter((l): l is string => l !== null);
  return lines.length ? `<builder-constraints>\n${lines.join('\n')}\n</builder-constraints>` : '';
}

/**
 * Refine leads into drafts. One LLM call regardless of lead count; zero calls
 * when there are no leads. Never throws on a malformed reply — returns [].
 */
export async function refineLeads(opts: RefineOptions): Promise<OppDraft[]> {
  const { leads, primitives, constraints, userId } = opts;
  if (leads.length === 0) return [];

  const validRefs = new Set(primitives.map((p) => p.ref));
  const evidence = primitives
    .map((p) => `[${p.ref}] (${p.type}) ${promptLine(p.label, 200)}`)
    .join('\n');

  const leadBlock = leads
    .map(
      (l) =>
        `- slug: ${l.slug}\n  angle: ${promptLine(l.title, 120)}\n` +
        `  wedge: ${Object.entries(l.wedge).map(([k, v]) => `${k}=${v}`).join(', ')}\n` +
        `  evidence: ${l.primitiveRefs.join(', ')}`,
    )
    .join('\n');

  const identity = getIdentity();
  const system =
    `You are the opportunity analyst for ${identity.productName}. You are given candidate ` +
    `angles that were composed mechanically from live market signal, and the evidence they ` +
    `were composed from. Your job is to judge each one honestly and score it.\n\n` +
    `Rules:\n` +
    `- Keep each candidate's slug EXACTLY as given.\n` +
    `- Rewrite title and thesis into something a builder would actually recognise as a business.\n` +
    `- Drop any candidate that is incoherent or has no real demand behind it. Returning fewer ` +
    `openings than you were given is correct and expected.\n` +
    `- evidenceRefs must only cite refs from the evidence block.\n` +
    `- subScores: every key 0-20, honest, not uniformly generous.\n` +
    `- kpis: concrete numbers or null. Never invent precision you do not have.\n\n` +
    `Reply with JSON: {"openings":[{"slug","title","thesis","sector","window","windowMonths",` +
    `"subScores":{...},"kpis":{...},"evidenceRefs":[...]}]}`;

  const user =
    `<evidence>\n${evidence}\n</evidence>\n\n` +
    `<candidates>\n${leadBlock}\n</candidates>` +
    (constraints ? `\n\n${renderConstraints(constraints)}` : '');

  let raw: { openings?: unknown };
  try {
    raw = await chatJSON<{ openings?: unknown }>(system, user, {
      feature: 'lead_refine',
      userId,
      maxTokens: 4000,
    });
  } catch {
    // An LLM outage must degrade to "no refined openings", never to a 500.
    return [];
  }

  return sanitizeOpportunities(raw?.openings, validRefs);
}
```

- [ ] **Step 4: Export `ScoutConstraints` if it is not already exported**

`refine.ts` imports `ScoutConstraints` from `./engine`. Confirm the interface is exported there:

```bash
grep -n "export interface ScoutConstraints" src/lib/opportunities/engine.ts
```

Expected: one match. If it is missing the `export` keyword, add it.

- [ ] **Step 5: Run the tests**

```bash
npx vitest run tests/opportunity-refine.test.ts
```

Expected: PASS, 4 tests.

- [ ] **Step 6: Commit**

```bash
git add src/lib/opportunities/refine.ts tests/opportunity-refine.test.ts
git commit -m "feat(opportunities): one-call lead refiner seeded from the caller's own slice"
```

---

## Task 14: `refine_lead` and the reworked `scout_opportunities`

**Files:**
- Modify: `mcp/tools/leads.ts`
- Modify: `mcp/tools/scout.ts`
- Create: `tests/mcp-refine-lead.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/mcp-refine-lead.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { AuthContext } from '../mcp/lib/auth';
import { registerLeadTools } from '../mcp/tools/leads';
import { insertLeads } from '@/lib/opportunities/leads';
import type { LeadDraft } from '@/lib/opportunities/compose';
import { SUB_KEYS } from '@/lib/opportunities/engine';
import { opportunities } from '@/lib/db/schema';
import { _setFetch } from '@/lib/llm/minimax';
import { useTestDb } from './helpers/db';
import type { Db } from '@/lib/db';

function draft(slug: string): LeadDraft {
  return {
    slug, title: `Title for ${slug}`,
    thesisSkeleton: 'A composed skeleton awaiting refinement.',
    sector: 'devtools', primitiveRefs: ['P1'],
    wedge: {
      business_model: 'subscription-saas', delivery_form: 'cli-tool',
      buyer: 'solo-builder', moat_play: 'workflow-lock-in',
    },
    heuristicScore: 60, combinationIndex: 7,
  };
}

function stubLlm(slug: string) {
  const subScores = Object.fromEntries(SUB_KEYS.map((k) => [k, 12]));
  _setFetch(async () =>
    new Response(
      JSON.stringify({
        choices: [{ message: { content: JSON.stringify({
          openings: [{
            slug, title: 'Review queue triage for small teams',
            thesis: 'Small engineering teams lose a day a week to review backlogs; triage it and charge per seat.',
            sector: 'devtools', window: '6 months', windowMonths: 6, subScores,
            kpis: {
              initialCostUsd: 200, monthlyCostUsd: 80, priceUsd: 25, timeToMvpDays: 21,
              breakEvenCustomers: 6, competitorCount: 4, competitionNote: null, regulatoryNote: null,
            },
            evidenceRefs: [],
          }],
        }) } }],
        usage: { prompt_tokens: 100, completion_tokens: 200 },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ),
  );
}

function authFor(userId: number | null, rateKey: string): AuthContext {
  return { authed: userId != null, userId, scopes: new Set(['read', 'plans']), rateKey };
}

async function wire(auth: AuthContext): Promise<Client> {
  const server = new McpServer({ name: 'refine-test', version: '0.0.1' });
  registerLeadTools(server, auth);
  const client = new Client({ name: 'test', version: '0.0.1' });
  const [c, s] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(c), server.connect(s)]);
  return client;
}

describe('refine_lead', () => {
  let db: Db;
  beforeEach(() => {
    db = useTestDb();
    vi.stubEnv('MINIMAX_API_KEY', 'test-key');
  });

  it('promotes a lead into the caller private opportunity', async () => {
    insertLeads({ ownerKey: 'user:1', userId: 1 }, [draft('review-queue')]);
    stubLlm('review-queue');

    const res = await (await wire(authFor(1, 'user:1')))
      .callTool({ name: 'refine_lead', arguments: { lead: 'review-queue' } });
    const p = res.structuredContent as { ok: boolean; opportunity?: { slug: string } };
    expect(p.ok).toBe(true);

    const rows = db.select().from(opportunities).where(eq(opportunities.ownerUserId, 1)).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].ownerUserId).toBe(1);
  });

  it('refuses a lead that belongs to someone else', async () => {
    insertLeads({ ownerKey: 'user:2', userId: 2 }, [draft('not-yours')]);
    const res = await (await wire(authFor(1, 'user:1')))
      .callTool({ name: 'refine_lead', arguments: { lead: 'not-yours' } });
    expect((res.structuredContent as { ok: boolean }).ok).toBe(false);
  });

  it('requires sign-in', async () => {
    insertLeads({ ownerKey: 'ip:1.2.3.4', userId: null }, [draft('anon-lead')]);
    const res = await (await wire(authFor(null, 'ip:1.2.3.4')))
      .callTool({ name: 'refine_lead', arguments: { lead: 'anon-lead' } });
    const p = res.structuredContent as { ok: boolean; error?: string };
    expect(p.ok).toBe(false);
    expect(p.error).toMatch(/sign in/i);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run tests/mcp-refine-lead.test.ts
```

Expected: FAIL — `Tool refine_lead not found`.

- [ ] **Step 3: Implement `refine_lead`**

Append inside `registerLeadTools` in `mcp/tools/leads.ts`, after the `get_leads` registration.

First widen the existing leads import rather than adding a second statement from the same module — change the line you wrote in Task 12 to:

```ts
import { getLead, insertLeads, markRefined, type Owner } from '../../src/lib/opportunities/leads';
```

Then add:

```ts
import { refineLeads } from '../../src/lib/opportunities/refine';
import { persistScoutDrafts } from '../../src/lib/opportunities/persist-scout';
```

```ts
  server.registerTool(
    'refine_lead',
    {
      description:
        'Spend one LLM call to turn a composed lead into a real, scored opportunity: rewritten thesis, 10-axis sub-scores, KPIs, flip/hold scores and a verdict. The result is saved as YOUR private opportunity and is immediately usable with generate_plan. Requires sign-in and consumes your monthly refine quota. Get lead slugs from get_leads.',
      inputSchema: {
        lead: z.string().describe('lead slug from get_leads'),
      },
      outputSchema: {
        ...envelopeSchema,
        ok: z.boolean(),
        error: z.string().optional(),
        opportunity: z
          .object({
            slug: z.string(),
            title: z.string(),
            thesis: z.string(),
            flip_score: z.number(),
            hold_score: z.number(),
            verdict: z.string(),
            confidence: z.number(),
          })
          .optional(),
      },
    },
    async ({ lead }) => {
      if (auth.userId == null) {
        return respond(
          { ok: false, error: 'Refining a lead requires sign in — anonymous leads stay unvalidated.' },
          {
            summary: 'Sign in to refine leads into scored opportunities.',
            economy: withUserEconomy(auth.userId, 'read'),
            next: [
              { tool: 'get_leads', arguments: { limit: 10 }, reason: 'browsing leads stays free and unlimited' },
            ],
          },
        );
      }

      const gate = can({ id: auth.userId }, 'lead_refine');
      if (!gate.ok) {
        const hint = gate.upgradeHint ? ` — ${gate.upgradeHint}` : '';
        return respond(
          { ok: false, error: `${gate.reason ?? 'refine quota reached'}${hint}` },
          {
            summary: `Refine quota reached (${gate.used}/${gate.quota}, tier "${gate.tier}")${hint}.`,
            economy: withUserEconomy(auth.userId, 'read'),
            next: [
              { tool: 'get_leads', arguments: { limit: 10 }, reason: 'leads remain free and unlimited' },
            ],
          },
        );
      }

      const owner = ownerFor(auth);
      const row = getLead(owner, lead);
      if (!row) {
        return respond(
          { ok: false, error: `No lead "${lead}" in your pool.` },
          {
            summary: `Lead "${lead}" is not in your pool.`,
            economy: withUserEconomy(auth.userId, 'read'),
            next: [{ tool: 'get_leads', arguments: { limit: 10 }, reason: 'list your current leads' }],
          },
        );
      }

      const drafts = await refineLeads({
        leads: [row],
        primitives: loadPrimitives(),
        userId: auth.userId,
      });
      if (drafts.length === 0) {
        return respond(
          { ok: false, error: 'The analyst rejected this lead as not genuinely actionable.' },
          {
            summary: `"${row.title}" did not survive refinement — that is an honest answer, not a failure.`,
            economy: withUserEconomy(auth.userId, 'scout'),
            next: [{ tool: 'get_leads', arguments: { limit: 10 }, reason: 'try a different angle' }],
          },
        );
      }

      const { persisted } = persistScoutDrafts(drafts, auth.userId);
      if (persisted[0]) markRefined(row.id, persisted[0].id);

      const db = getDb();
      const saved = db
        .select()
        .from(opportunities)
        .where(eq(opportunities.id, persisted[0]!.id))
        .get()!;

      return respond(
        {
          ok: true,
          opportunity: {
            slug: saved.slug,
            title: saved.title,
            thesis: saved.thesis,
            flip_score: saved.flipScore,
            hold_score: saved.holdScore,
            verdict: saved.verdict,
            confidence: saved.confidence,
          },
        },
        {
          summary: `"${saved.title}" refined — flip ${saved.flipScore}/hold ${saved.holdScore}, verdict ${saved.verdict} (${saved.confidence}% confidence). Saved as your private opportunity.`,
          economy: withUserEconomy(auth.userId, 'scout'),
          next: [
            {
              tool: 'forge_opportunity',
              arguments: { opportunity: saved.slug },
              reason: 'adversarial deep pass before you commit real time',
            },
            {
              tool: 'generate_plan',
              arguments: { opportunity: saved.slug },
              reason: 'turn it into an executable plan',
            },
          ],
        },
      );
    },
  );
```

Add the remaining imports at the top of `mcp/tools/leads.ts`:

```ts
import { eq } from 'drizzle-orm';
import { getDb } from '../../src/lib/db';
import { opportunities } from '../../src/lib/db/schema';
```

- [ ] **Step 4: Run the tests**

```bash
npx vitest run tests/mcp-refine-lead.test.ts
```

Expected: FAIL on the quota gate — `can()` does not yet know the `lead_refine` capability. That is Task 15; it is the next task deliberately, so the gate exists before the tool ships. Leave this test red and proceed.

- [ ] **Step 5: Point `scout_opportunities` at the composer**

`scout_opportunities` keeps its name and contract (prompts and agent instructions reference it) but changes its engine: instead of `proposeOpportunities()` over the identical global context, it composes a caller-unique slice and refines it. In `mcp/tools/scout.ts`, replace the `proposeOpportunities` call block:

```ts
      let drafts;
      let signalCount;
      try {
        const primitives = loadPrimitives();
        signalCount = primitives.length;
        if (signalCount >= 5) {
          const composed = composeLeads({
            primitives,
            space: loadWedges(),
            ownerKey: auth.rateKey,
            day: dayKey(),
            cursor: 0,
            limit: 8,
          });
          const stored = insertLeads({ ownerKey: auth.rateKey, userId: auth.userId }, composed.leads);
          drafts = await refineLeads({
            leads: stored,
            primitives,
            ...(hasConstraints ? { constraints } : {}),
            userId: auth.userId,
          });
        } else {
          drafts = [];
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return respond(
          { ok: false, error: `scout failed: ${msg}`, openings: [], skipped_existing: 0 },
          { summary: `The scout could not run: ${msg}.` },
        );
      }
```

Add these imports to `mcp/tools/scout.ts`:

```ts
import { composeLeads } from '../../src/lib/opportunities/compose';
import { insertLeads } from '../../src/lib/opportunities/leads';
import { loadPrimitives } from '../../src/lib/opportunities/primitives';
import { refineLeads } from '../../src/lib/opportunities/refine';
import { dayKey } from '../../src/lib/opportunities/seed';
import { loadWedges } from '../../src/lib/opportunities/wedges';
```

`proposeOpportunities` is still used by the daily job in `engine.ts`, so leave that export alone — only the MCP scout path changes.

- [ ] **Step 6: Commit (tests still red pending Task 15)**

```bash
git add mcp/tools/leads.ts mcp/tools/scout.ts tests/mcp-refine-lead.test.ts
git commit -m "feat(mcp): refine_lead promotes a lead, scout composes a caller-unique slice"
```

---

# Phase 4 — Rung 2 and the feedback loop

## Task 15: Entitlements for the ladder

**Files:**
- Modify: `src/lib/entitlements.ts`
- Create: `tests/entitlements-ladder.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/entitlements-ladder.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { can } from '@/lib/entitlements';
import { llmCalls, planEntitlements } from '@/lib/db/schema';
import { useTestDb } from './helpers/db';
import type { Db } from '@/lib/db';

function setTier(db: Db, userId: number, tier: 'free' | 'builder' | 'factory') {
  db.insert(planEntitlements)
    .values({ userId, tier, plansPerMonth: 30, resetDay: 1 })
    .run();
}

function burn(db: Db, userId: number, feature: string, n: number) {
  for (let i = 0; i < n; i++) {
    db.insert(llmCalls)
      .values({
        ts: new Date(), feature, userId, model: 'test',
        promptTokens: 1, completionTokens: 1, durationMs: 1, estCostUsd: 0,
      })
      .run();
  }
}

describe('ladder entitlements', () => {
  let db: Db;
  beforeEach(() => {
    db = useTestDb();
  });

  it('gives free tier a small refine quota', () => {
    const gate = can({ id: 1 }, 'lead_refine');
    expect(gate.ok).toBe(true);
    expect(gate.quota).toBe(3);
  });

  it('blocks free tier once the refine quota is spent', () => {
    burn(db, 1, 'lead_refine', 3);
    const gate = can({ id: 1 }, 'lead_refine');
    expect(gate.ok).toBe(false);
    expect(gate.upgradeHint).toBeTruthy();
  });

  it('gives builder a much larger refine quota', () => {
    setTier(db, 2, 'builder');
    burn(db, 2, 'lead_refine', 10);
    const gate = can({ id: 2 }, 'lead_refine');
    expect(gate.ok).toBe(true);
    expect(gate.quota).toBe(50);
  });

  it('denies forge on free tier', () => {
    const gate = can({ id: 1 }, 'forge');
    expect(gate.ok).toBe(false);
  });

  it('allows forge on builder within quota and blocks past it', () => {
    setTier(db, 3, 'builder');
    expect(can({ id: 3 }, 'forge').ok).toBe(true);
    // each forge writes 4 llm_calls rows (advocate/skeptic/realist/judge)
    burn(db, 3, 'forge', 5 * 4);
    expect(can({ id: 3 }, 'forge').ok).toBe(false);
  });

  it('gives factory unlimited refines', () => {
    setTier(db, 4, 'factory');
    burn(db, 4, 'lead_refine', 500);
    expect(can({ id: 4 }, 'lead_refine').ok).toBe(true);
  });

  it('refuses both capabilities for a signed-out caller', () => {
    expect(can(null, 'lead_refine').ok).toBe(false);
    expect(can(null, 'forge').ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run tests/entitlements-ladder.test.ts
```

Expected: FAIL — `can()` returns "Unknown capability" for `lead_refine` and `forge`.

- [ ] **Step 3: Extend the capability matrix**

In `src/lib/entitlements.ts`, add the two capabilities to the union:

```ts
export type Capability =
  | 'vote'
  | 'verdict'
  | 'debate'
  | 'plan'
  | 'scout'
  | 'ask'
  | 'batch_create'
  | 'batch_run'
  | 'personalize'
  | 'lead_refine'
  | 'forge';
```

Add the caps to the `TIER_CAPS` type and to all three tier entries:

```ts
    leadRefinesPerMonth: number; // -1 = unlimited; Rung 1
    forgesPerMonth: number;      // 0 = unavailable; Rung 2 (4 llm calls each)
```

Then replace the whole `TIER_CAPS` literal with this (the non-ladder values are unchanged from what is there today — verify they still match before overwriting):

```ts
> = {
  free: {
    plansPerMonth: 3,
    debatesPerMonth: 3,
    asksPerMonth: 10,
    workspaceBatches: 1,
    batchRuns: false,
    personalize: false,
    leadRefinesPerMonth: 3,
    forgesPerMonth: 0,
  },
  builder: {
    plansPerMonth: 30,
    debatesPerMonth: -1,
    asksPerMonth: 100,
    workspaceBatches: 10,
    batchRuns: true,
    personalize: true,
    leadRefinesPerMonth: 50,
    forgesPerMonth: 5,
  },
  factory: {
    plansPerMonth: 100,
    debatesPerMonth: -1,
    asksPerMonth: -1,
    workspaceBatches: -1,
    batchRuns: true,
    personalize: true,
    leadRefinesPerMonth: -1,
    forgesPerMonth: 30,
  },
};
```

Add the two cases inside the `switch (capability)` block, before `default`:

```ts
    case 'lead_refine': {
      if (caps.leadRefinesPerMonth < 0) return { ok: true, tier };
      const used = countFeature(user.id, 'lead_refine', ent.resetDay, now);
      const quota = caps.leadRefinesPerMonth;
      return used < quota
        ? { ok: true, tier, used, quota }
        : {
            ok: false, tier, used, quota,
            reason: `Refine quota reached (${used}/${quota} this cycle).`,
            upgradeHint:
              tier === 'factory'
                ? 'Quota resets next cycle.'
                : 'Upgrade for more refines — composed leads stay free and unlimited.',
          };
    }

    case 'forge': {
      const quota = caps.forgesPerMonth;
      if (quota === 0) {
        return {
          ok: false, tier, used: 0, quota,
          reason: 'The adversarial deep pass requires Builder.',
          upgradeHint: 'Upgrade to Builder to forge openings before you commit.',
        };
      }
      // 4 llm_calls (feature='forge') per forge, same accounting as debates
      const used = Math.floor(countFeature(user.id, 'forge', ent.resetDay, now) / 4);
      return used < quota
        ? { ok: true, tier, used, quota }
        : {
            ok: false, tier, used, quota,
            reason: `Forge quota reached (${used}/${quota} this cycle).`,
            upgradeHint: tier === 'factory' ? 'Quota resets next cycle.' : 'Upgrade for more forges.',
          };
    }
```

- [ ] **Step 4: Run the tests**

```bash
npx vitest run tests/entitlements-ladder.test.ts
```

Expected: PASS, 7 tests.

- [ ] **Step 5: Confirm Task 14 is now green**

```bash
npx vitest run tests/mcp-refine-lead.test.ts
```

Expected: PASS, 3 tests. The gate that left it red now exists.

- [ ] **Step 6: Commit**

```bash
git add src/lib/entitlements.ts tests/entitlements-ladder.test.ts
git commit -m "feat(entitlements): lead_refine and forge capabilities across the tier ladder"
```

---

## Task 16: The forge (Rung 2)

**Files:**
- Modify: `src/lib/opportunities/critic.ts`
- Create: `src/lib/opportunities/forge.ts`
- Create: `tests/opportunity-forge.test.ts`

`runDebate()` hardcodes `feature: 'debate'` on its four `chatJSON` calls. Forge must record `feature: 'forge'` or its spend lands in the debate quota, so this task first makes the label a parameter.

- [ ] **Step 1: Make the debate feature label a parameter**

In `src/lib/opportunities/critic.ts`, change the `runDebate` signature and the `turn` helper:

```ts
export async function runDebate(
  oppId: number | null,
  ideaText?: string,
  feature: string = 'debate',
): Promise<DebateResult> {
```

```ts
  const turn = async (system: string, user: string): Promise<Record<string, unknown>> =>
    stripCjkDeep(await chatJSON<Record<string, unknown>>(system, user, { feature }));
```

Existing callers pass no third argument and keep `feature: 'debate'` — behavior is unchanged.

- [ ] **Step 2: Write the failing test**

Create `tests/opportunity-forge.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';

vi.mock('@/lib/opportunities/critic', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/opportunities/critic')>();
  return { ...actual, runDebate: vi.fn() };
});

import { forgeOpportunity } from '@/lib/opportunities/forge';
import { runDebate, type DebateResult } from '@/lib/opportunities/critic';
import { opportunities } from '@/lib/db/schema';
import { SUB_KEYS } from '@/lib/opportunities/engine';
import { useTestDb } from './helpers/db';
import type { Db } from '@/lib/db';

const debateMock = vi.mocked(runDebate);

const PINNED: DebateResult = {
  transcript: [
    { role: 'advocate', text: 'Demand is recurring in the pains stream.' },
    { role: 'skeptic', text: 'An incumbent ships this inside two releases.' },
    { role: 'realist', text: 'Comps say the niche clears $20k MRR but no more.' },
    { role: 'judge', text: 'Watch: real opening, named platform risk.' },
  ],
  verdict: 'watch',
  confidence: 55,
  killRisks: ['Platform absorbs the feature natively'],
  conditionsToSucceed: ['own one niche distribution channel'],
  strengthenedVariants: ['niche down to Plus sellers', 'usage-based API instead of a dashboard'],
};

function seedOpp(db: Db, slug: string, ownerUserId: number): number {
  const now = new Date();
  const sub = Object.fromEntries(SUB_KEYS.map((k) => [k, 14]));
  return db
    .insert(opportunities)
    .values({
      slug, ownerUserId, title: `Title for ${slug}`,
      thesis: 'A sufficiently long thesis for the forge to work against.',
      sector: 'devtools', status: 'active', flipScore: 70, holdScore: 50,
      scores: JSON.stringify(sub), evidence: '[]',
      firstSeenAt: now, lastSeenAt: now,
    })
    .returning({ id: opportunities.id })
    .get()!.id;
}

describe('forgeOpportunity', () => {
  let db: Db;
  beforeEach(() => {
    db = useTestDb();
    debateMock.mockReset();
    debateMock.mockResolvedValue(PINNED);
  });

  it('re-scores the opportunity from the debate outcome', async () => {
    const id = seedOpp(db, 'forge-me', 1);
    const res = await forgeOpportunity(id, 1);
    expect(res.ok).toBe(true);

    const row = db.select().from(opportunities).where(eq(opportunities.id, id)).get()!;
    expect(row.verdict).toBe('watch');
    expect(row.confidence).toBe(55);
    const review = JSON.parse(row.review!);
    expect(review.killRisks).toContain('Platform absorbs the feature natively');
    expect(review.flags).toContain('forged');
  });

  it('bills the debate calls to the forge feature', async () => {
    const id = seedOpp(db, 'billed', 1);
    await forgeOpportunity(id, 1);
    expect(debateMock).toHaveBeenCalledWith(id, undefined, 'forge');
  });

  it('refuses an opportunity the caller does not own', async () => {
    const id = seedOpp(db, 'theirs', 2);
    const res = await forgeOpportunity(id, 1);
    expect(res.ok).toBe(false);
    expect(debateMock).not.toHaveBeenCalled();
  });

  it('allows forging a public radar opening', async () => {
    const now = new Date();
    const sub = Object.fromEntries(SUB_KEYS.map((k) => [k, 14]));
    const id = db
      .insert(opportunities)
      .values({
        slug: 'public-one', ownerUserId: null, title: 'Public opening',
        thesis: 'A canonical radar opening anybody may pressure-test.',
        sector: 'devtools', status: 'active', flipScore: 70, holdScore: 50,
        scores: JSON.stringify(sub), evidence: '[]', firstSeenAt: now, lastSeenAt: now,
      })
      .returning({ id: opportunities.id })
      .get()!.id;
    expect((await forgeOpportunity(id, 1)).ok).toBe(true);
  });

  it('reports failure instead of throwing when the debate errors', async () => {
    debateMock.mockRejectedValue(new Error('upstream 503'));
    const id = seedOpp(db, 'flaky', 1);
    const res = await forgeOpportunity(id, 1);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/503/);
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

```bash
npx vitest run tests/opportunity-forge.test.ts
```

Expected: FAIL — `Failed to resolve import "@/lib/opportunities/forge"`.

- [ ] **Step 4: Implement the forge**

Create `src/lib/opportunities/forge.ts`:

```ts
/**
 * Rung 2 — the adversarial deep pass.
 *
 * Four sequential LLM calls (advocate → skeptic → realist → judge) run against
 * one opening, then the deterministic gate re-scores it from the debate
 * outcome. Expensive and explicit: it is only ever reached through the
 * forge_opportunity tool, never implicitly.
 *
 * Reuses runDebate() and applyGate() rather than growing a parallel pipeline —
 * a forged verdict must be explainable by exactly the same trail as a daily one.
 */
import { and, eq, isNull, or } from 'drizzle-orm';
import { getDb } from '../db';
import { opportunities } from '../db/schema';
import { SUB_KEYS, type SubScores } from './axes';
import { runDebate } from './critic';
import { applyGate, type CriticResult, type GateKpis } from './gate';

export interface ForgeResult {
  ok: boolean;
  error?: string;
  flipScore?: number;
  holdScore?: number;
  verdict?: string;
  confidence?: number;
  killRisks?: string[];
  conditionsToSucceed?: string[];
  strengthenedVariants?: string[];
}

function parseSub(raw: string): SubScores {
  const out = {} as SubScores;
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    /* fall through to zeros */
  }
  for (const k of SUB_KEYS) {
    const v = parsed[k];
    out[k] = typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(20, v)) : 0;
  }
  return out;
}

/**
 * Forge one opening. The caller must own it, or it must be a public radar row
 * — anyone may pressure-test the canonical radar, nobody may touch someone
 * else's private opening.
 */
export async function forgeOpportunity(
  opportunityId: number,
  userId: number,
): Promise<ForgeResult> {
  const db = getDb();
  const row = db
    .select()
    .from(opportunities)
    .where(
      and(
        eq(opportunities.id, opportunityId),
        or(isNull(opportunities.ownerUserId), eq(opportunities.ownerUserId, userId)),
      ),
    )
    .get();
  if (!row) return { ok: false, error: 'No such opportunity in your scope.' };

  let debate;
  try {
    debate = await runDebate(opportunityId, undefined, 'forge');
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  // The judge's outcome IS the critic result — same shape the gate already consumes.
  const critic: CriticResult = {
    slug: row.slug,
    verdict: debate.verdict,
    confidence: debate.confidence,
    killRisks: debate.killRisks,
    adjustments: [],
    flags: ['forged'],
  };

  const gate = applyGate(
    {
      sub: parseSub(row.scores),
      kpis: row.kpis ? (JSON.parse(row.kpis) as GateKpis) : null,
      windowMonths: row.windowMonths,
      evidenceCount: (() => {
        try {
          const e = JSON.parse(row.evidence) as unknown[];
          return Array.isArray(e) ? e.length : 0;
        } catch {
          return 0;
        }
      })(),
      legacy: false,
    },
    critic,
  );

  const review = {
    ...gate.review,
    flags: [...gate.review.flags, 'forged'],
    conditionsToSucceed: debate.conditionsToSucceed,
    strengthenedVariants: debate.strengthenedVariants,
  };

  db.update(opportunities)
    .set({
      flipScore: gate.flipScore,
      holdScore: gate.holdScore,
      verdict: gate.verdict,
      confidence: gate.confidence,
      review: JSON.stringify(review),
      reviewedAt: new Date(),
    })
    .where(eq(opportunities.id, opportunityId))
    .run();

  return {
    ok: true,
    flipScore: gate.flipScore,
    holdScore: gate.holdScore,
    verdict: gate.verdict,
    confidence: gate.confidence,
    killRisks: debate.killRisks,
    conditionsToSucceed: debate.conditionsToSucceed,
    strengthenedVariants: debate.strengthenedVariants,
  };
}
```

- [ ] **Step 5: Run the tests**

```bash
npx vitest run tests/opportunity-forge.test.ts
```

Expected: PASS, 5 tests.

- [ ] **Step 6: Run the full suite**

```bash
npm test
```

Expected: all pass, including the existing `tests/debate.test.ts` and `tests/debate-scout.test.ts` — `runDebate`'s third parameter is optional and defaults to the old behavior.

- [ ] **Step 7: Commit**

```bash
git add src/lib/opportunities/critic.ts src/lib/opportunities/forge.ts tests/opportunity-forge.test.ts
git commit -m "feat(opportunities): adversarial forge pass with gate re-scoring"
```

---

## Task 17: The `forge_opportunity` tool

**Files:**
- Create: `mcp/tools/forge.ts`
- Modify: `mcp/build.ts`
- Create: `tests/mcp-forge.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/mcp-forge.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/opportunities/forge', () => ({ forgeOpportunity: vi.fn() }));

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { AuthContext } from '../mcp/lib/auth';
import { registerForgeTools } from '../mcp/tools/forge';
import { forgeOpportunity } from '@/lib/opportunities/forge';
import { opportunities, planEntitlements } from '@/lib/db/schema';
import { useTestDb } from './helpers/db';
import type { Db } from '@/lib/db';

const forgeMock = vi.mocked(forgeOpportunity);

function authFor(userId: number | null): AuthContext {
  return {
    authed: userId != null, userId, scopes: new Set(['read', 'plans']),
    rateKey: userId != null ? `user:${userId}` : 'ip:test',
  };
}

async function wire(userId: number | null): Promise<Client> {
  const server = new McpServer({ name: 'forge-test', version: '0.0.1' });
  registerForgeTools(server, authFor(userId));
  const client = new Client({ name: 'test', version: '0.0.1' });
  const [c, s] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(c), server.connect(s)]);
  return client;
}

function seedOpp(db: Db, slug: string, ownerUserId: number | null) {
  const now = new Date();
  db.insert(opportunities)
    .values({
      slug, ownerUserId, title: `Title for ${slug}`,
      thesis: 'A sufficiently long thesis for the forge tool to reference.',
      sector: 'devtools', status: 'active', flipScore: 70, holdScore: 50,
      scores: '{}', evidence: '[]', firstSeenAt: now, lastSeenAt: now,
    })
    .run();
}

describe('forge_opportunity', () => {
  let db: Db;
  beforeEach(() => {
    db = useTestDb();
    forgeMock.mockReset();
    forgeMock.mockResolvedValue({
      ok: true, flipScore: 62, holdScore: 48, verdict: 'watch', confidence: 55,
      killRisks: ['Platform absorbs it'], conditionsToSucceed: ['own a channel'],
      strengthenedVariants: ['niche down'],
    });
    db.insert(planEntitlements)
      .values({ userId: 1, tier: 'builder', plansPerMonth: 30, resetDay: 1 })
      .run();
    seedOpp(db, 'forge-me', 1);
  });

  it('forges and returns the debate outcome', async () => {
    const res = await (await wire(1))
      .callTool({ name: 'forge_opportunity', arguments: { opportunity: 'forge-me' } });
    const p = res.structuredContent as { ok: boolean; kill_risks: string[]; verdict: string };
    expect(p.ok).toBe(true);
    expect(p.verdict).toBe('watch');
    expect(p.kill_risks).toContain('Platform absorbs it');
  });

  it('blocks free tier with an upgrade hint and spends nothing', async () => {
    seedOpp(db, 'free-attempt', 9);
    const res = await (await wire(9))
      .callTool({ name: 'forge_opportunity', arguments: { opportunity: 'free-attempt' } });
    const p = res.structuredContent as { ok: boolean; error: string };
    expect(p.ok).toBe(false);
    expect(p.error).toMatch(/builder/i);
    expect(forgeMock).not.toHaveBeenCalled();
  });

  it('requires sign-in', async () => {
    const res = await (await wire(null))
      .callTool({ name: 'forge_opportunity', arguments: { opportunity: 'forge-me' } });
    expect((res.structuredContent as { ok: boolean }).ok).toBe(false);
    expect(forgeMock).not.toHaveBeenCalled();
  });

  it('reports an unknown slug without spending', async () => {
    const res = await (await wire(1))
      .callTool({ name: 'forge_opportunity', arguments: { opportunity: 'nope' } });
    expect((res.structuredContent as { ok: boolean }).ok).toBe(false);
    expect(forgeMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run tests/mcp-forge.test.ts
```

Expected: FAIL — `Failed to resolve import "../mcp/tools/forge"`.

- [ ] **Step 3: Implement the tool**

Create `mcp/tools/forge.ts`:

```ts
import { and, eq, isNull, or } from 'drizzle-orm';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getDb } from '../../src/lib/db';
import { opportunities } from '../../src/lib/db/schema';
import { forgeOpportunity } from '../../src/lib/opportunities/forge';
import { can } from '../../src/lib/entitlements';
import { envelopeSchema, respond, withUserEconomy } from '../lib/payload';
import type { AuthContext } from '../lib/auth';

export function registerForgeTools(server: McpServer, auth: AuthContext): void {
  server.registerTool(
    'forge_opportunity',
    {
      description:
        'The deep pass: run a four-role adversarial debate (advocate, skeptic, realist, judge) against one opening, then re-score it through the deterministic gate. Returns kill risks, the conditions it would need to succeed, and stronger variants of the idea. Costs four LLM calls and consumes your monthly forge quota — call it deliberately, on an opening you are seriously considering, not on every result. Requires Builder or Factory.',
      inputSchema: {
        opportunity: z.string().describe('opportunity slug or numeric id'),
      },
      outputSchema: {
        ...envelopeSchema,
        ok: z.boolean(),
        error: z.string().optional(),
        flip_score: z.number().optional(),
        hold_score: z.number().optional(),
        verdict: z.string().optional(),
        confidence: z.number().optional(),
        kill_risks: z.array(z.string()).optional(),
        conditions_to_succeed: z.array(z.string()).optional(),
        strengthened_variants: z.array(z.string()).optional(),
      },
    },
    async ({ opportunity }) => {
      if (auth.userId == null) {
        return respond(
          { ok: false, error: 'Forging requires sign in.' },
          {
            summary: 'Sign in to run the adversarial deep pass.',
            economy: withUserEconomy(auth.userId, 'read'),
            next: [{ tool: 'get_opportunities', arguments: { limit: 10 }, reason: 'browsing stays free' }],
          },
        );
      }

      // Gate BEFORE any lookup work, so a blocked caller never triggers spend.
      const gate = can({ id: auth.userId }, 'forge');
      if (!gate.ok) {
        const hint = gate.upgradeHint ? ` — ${gate.upgradeHint}` : '';
        return respond(
          { ok: false, error: `${gate.reason ?? 'forge unavailable'}${hint}` },
          {
            summary: `Forge unavailable on tier "${gate.tier}"${hint}.`,
            economy: withUserEconomy(auth.userId, 'read'),
            next: [
              {
                tool: 'debate_idea',
                arguments: { idea: opportunity },
                reason: 'a lighter pressure-test that may fit your tier',
              },
            ],
          },
        );
      }

      const db = getDb();
      const asId = /^\d+$/.test(opportunity) ? Number(opportunity) : null;
      const scope = or(isNull(opportunities.ownerUserId), eq(opportunities.ownerUserId, auth.userId));
      const row = db
        .select({ id: opportunities.id, title: opportunities.title })
        .from(opportunities)
        .where(
          asId
            ? and(eq(opportunities.id, asId), scope)
            : and(eq(opportunities.slug, opportunity), scope),
        )
        .get();
      if (!row) {
        return respond(
          { ok: false, error: `No opportunity "${opportunity}" in your scope.` },
          {
            summary: `No opportunity "${opportunity}" available to you.`,
            economy: withUserEconomy(auth.userId, 'read'),
            next: [{ tool: 'get_opportunities', arguments: { limit: 10 }, reason: 'list valid slugs' }],
          },
        );
      }

      const res = await forgeOpportunity(row.id, auth.userId);
      if (!res.ok) {
        return respond(
          { ok: false, error: res.error ?? 'forge failed' },
          {
            summary: `The forge could not complete: ${res.error ?? 'unknown error'}.`,
            economy: withUserEconomy(auth.userId, 'debate'),
          },
        );
      }

      return respond(
        {
          ok: true,
          flip_score: res.flipScore,
          hold_score: res.holdScore,
          verdict: res.verdict,
          confidence: res.confidence,
          kill_risks: res.killRisks ?? [],
          conditions_to_succeed: res.conditionsToSucceed ?? [],
          strengthened_variants: res.strengthenedVariants ?? [],
        },
        {
          summary: `"${row.title}" forged — verdict ${res.verdict} at ${res.confidence}% confidence, flip ${res.flipScore}/hold ${res.holdScore}. ${(res.killRisks ?? []).length} kill risk(s) named.`,
          economy: withUserEconomy(auth.userId, 'debate'),
          next: [
            {
              tool: 'generate_plan',
              arguments: { opportunity },
              reason: 'the opening survived review — turn it into an executable plan',
            },
          ],
        },
      );
    },
  );
}
```

- [ ] **Step 4: Register the tool**

In `mcp/build.ts`:

```ts
import { registerForgeTools } from './tools/forge';
```

```ts
  registerForgeTools(server, auth);
```

- [ ] **Step 5: Run the tests**

```bash
npx vitest run tests/mcp-forge.test.ts
```

Expected: PASS, 4 tests.

- [ ] **Step 6: Commit**

```bash
git add mcp/tools/forge.ts mcp/build.ts tests/mcp-forge.test.ts
git commit -m "feat(mcp): forge_opportunity runs the quota-gated adversarial deep pass"
```

---

## Task 18: `dismiss_opportunity` — the feedback loop

**Files:**
- Modify: `mcp/tools/leads.ts`
- Create: `tests/mcp-dismiss.test.ts`

Dismissal is what makes the private pool sharpen over time instead of repeating: a dismissed sector feeds the profile's avoid list, which `get_leads` already passes to the composer.

- [ ] **Step 1: Write the failing test**

Create `tests/mcp-dismiss.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { AuthContext } from '../mcp/lib/auth';
import { registerLeadTools } from '../mcp/tools/leads';
import { insertLeads, listLeads } from '@/lib/opportunities/leads';
import type { LeadDraft } from '@/lib/opportunities/compose';
import { getProfile, setProfile } from '@/lib/personalization';
import { planEntitlements } from '@/lib/db/schema';
import { useTestDb } from './helpers/db';
import type { Db } from '@/lib/db';

function draft(slug: string, sector: string): LeadDraft {
  return {
    slug, title: `Title for ${slug}`, thesisSkeleton: 'A composed skeleton.',
    sector, primitiveRefs: ['P1'],
    wedge: {
      business_model: 'subscription-saas', delivery_form: 'cli-tool',
      buyer: 'solo-builder', moat_play: 'workflow-lock-in',
    },
    heuristicScore: 60, combinationIndex: 7,
  };
}

function authFor(userId: number | null): AuthContext {
  return {
    authed: userId != null, userId, scopes: new Set(['read']),
    rateKey: userId != null ? `user:${userId}` : 'ip:test',
  };
}

async function wire(userId: number | null): Promise<Client> {
  const server = new McpServer({ name: 'dismiss-test', version: '0.0.1' });
  registerLeadTools(server, authFor(userId));
  const client = new Client({ name: 'test', version: '0.0.1' });
  const [c, s] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(c), server.connect(s)]);
  return client;
}

describe('dismiss_opportunity', () => {
  let db: Db;
  beforeEach(() => {
    db = useTestDb();
    db.insert(planEntitlements)
      .values({ userId: 1, tier: 'builder', plansPerMonth: 30, resetDay: 1 })
      .run();
  });

  it('hides the lead from future listings', async () => {
    insertLeads({ ownerKey: 'user:1', userId: 1 }, [draft('nope', 'devtools')]);
    const res = await (await wire(1)).callTool({
      name: 'dismiss_opportunity',
      arguments: { target: 'nope', reason: 'too capital heavy' },
    });
    expect((res.structuredContent as { ok: boolean }).ok).toBe(true);
    expect(listLeads({ ownerKey: 'user:1', userId: 1 }, { limit: 10 }).leads).toHaveLength(0);
  });

  it('adds the sector to the avoid list when asked', async () => {
    setProfile(1, { interests: ['devtools'] });
    insertLeads({ ownerKey: 'user:1', userId: 1 }, [draft('wrong-sector', 'adtech')]);
    await (await wire(1)).callTool({
      name: 'dismiss_opportunity',
      arguments: { target: 'wrong-sector', reason: 'not my market', avoid_sector: true },
    });
    expect(getProfile(1)?.avoidedSectors).toContain('adtech');
  });

  it('leaves the avoid list alone by default', async () => {
    insertLeads({ ownerKey: 'user:1', userId: 1 }, [draft('one-off', 'fintech')]);
    await (await wire(1)).callTool({
      name: 'dismiss_opportunity',
      arguments: { target: 'one-off', reason: 'just this one' },
    });
    expect(getProfile(1)?.avoidedSectors ?? []).not.toContain('fintech');
  });

  it('reports an unknown target honestly', async () => {
    const res = await (await wire(1)).callTool({
      name: 'dismiss_opportunity',
      arguments: { target: 'ghost', reason: 'n/a' },
    });
    expect((res.structuredContent as { ok: boolean }).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run tests/mcp-dismiss.test.ts
```

Expected: FAIL — `Tool dismiss_opportunity not found`.

- [ ] **Step 3: Implement the tool**

Append inside `registerLeadTools` in `mcp/tools/leads.ts`, and add `dismissLead` plus `setProfile` to the imports:

```ts
import { dismissLead, getLead, insertLeads, markRefined, type Owner } from '../../src/lib/opportunities/leads';
import { getProfile, setProfile } from '../../src/lib/personalization';
```

```ts
  server.registerTool(
    'dismiss_opportunity',
    {
      description:
        'Tell Radar a lead or opportunity is not for you, and why. Dismissed items stop appearing in your results. With avoid_sector=true the sector is added to your profile avoid list, so future composed leads steer away from it — this is how your private pool gets sharper instead of repeating itself.',
      inputSchema: {
        target: z.string().describe('lead slug (from get_leads) or opportunity slug'),
        reason: z.string().max(200).describe('why it is not for you — kept on the record'),
        avoid_sector: z
          .boolean()
          .default(false)
          .describe('also add this item sector to your profile avoid list'),
      },
      outputSchema: {
        ...envelopeSchema,
        ok: z.boolean(),
        error: z.string().optional(),
        avoided_sectors: z.array(z.string()).optional(),
      },
    },
    async ({ target, reason, avoid_sector }) => {
      if (auth.userId == null) {
        return respond(
          { ok: false, error: 'Dismissing requires sign in — anonymous pools are ephemeral anyway.' },
          {
            summary: 'Sign in to keep dismissals across sessions.',
            economy: withUserEconomy(auth.userId, 'read'),
          },
        );
      }

      const owner = ownerFor(auth);
      const row = getLead(owner, target);
      if (!row) {
        return respond(
          { ok: false, error: `No lead "${target}" in your pool.` },
          {
            summary: `Nothing called "${target}" in your pool to dismiss.`,
            economy: withUserEconomy(auth.userId, 'read'),
            next: [{ tool: 'get_leads', arguments: { limit: 10 }, reason: 'list your current leads' }],
          },
        );
      }

      dismissLead(owner, target, reason);

      let avoided: string[] = getProfile(auth.userId)?.avoidedSectors ?? [];
      if (avoid_sector && row.sector && can({ id: auth.userId }, 'personalize').ok) {
        if (!avoided.some((s) => s.toLowerCase() === row.sector!.toLowerCase())) {
          avoided = [...avoided, row.sector];
          setProfile(auth.userId, { avoidedSectors: avoided });
        }
      }

      return respond(
        { ok: true, avoided_sectors: avoided },
        {
          summary: `Dismissed "${row.title}".${
            avoid_sector && row.sector ? ` Future leads will steer away from ${row.sector}.` : ''
          }`,
          economy: withUserEconomy(auth.userId, 'read'),
          next: [
            { tool: 'get_leads', arguments: { limit: 8 }, reason: 'fresh leads, now better targeted' },
          ],
        },
      );
    },
  );
```

- [ ] **Step 4: Run the tests**

```bash
npx vitest run tests/mcp-dismiss.test.ts
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add mcp/tools/leads.ts tests/mcp-dismiss.test.ts
git commit -m "feat(mcp): dismiss_opportunity feeds the profile avoid list"
```

---

# Phase 5 — Wiring and documentation

## Task 19: Prompts, resources, sweeps and docs

**Files:**
- Modify: `mcp/prompts.ts`
- Modify: `mcp/tools/meta.ts`
- Modify: `worker/index.ts`
- Modify: `README.md`

- [ ] **Step 1: Add a lead-first workflow prompt**

Open `mcp/prompts.ts` and read the existing `find_and_plan` prompt registration to match its shape. Add one alongside it:

```ts
  server.registerPrompt(
    'explore_unlimited',
    {
      title: 'Explore unlimited openings',
      description: 'Browse composed leads unique to you, refine the best, then plan it.',
      argsSchema: {},
    },
    () => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text:
              'Call get_leads to pull business leads composed for me alone (free, unlimited — ' +
              'page with next_cursor for more). Leads are UNVALIDATED hypotheses: they have a ' +
              'heuristic score but no verdict, so do not plan against one directly. Pick the ' +
              'strongest two or three, tell me why, then call refine_lead on the single best to ' +
              'get real scores and KPIs. If it survives, call forge_opportunity to pressure-test ' +
              'it, then generate_plan with format=markdown and save the result as PLAN.md. Use ' +
              'dismiss_opportunity on anything that is clearly not for me so future leads improve.',
          },
        },
      ],
    }),
  );
```

- [ ] **Step 2: Teach the server guide about the ladder**

`get_server_guide` in `mcp/tools/meta.ts` is what an agent calls to orient itself. Find the guide text and add a section describing the three rungs. Keep the existing tone and structure:

```
THREE WAYS TO FIND SOMETHING TO BUILD
  1. get_opportunities — the curated public radar. Reviewed, scored, shared by everyone. Free.
  2. get_leads — unlimited hypotheses composed for you alone from live signal. No verdict,
     no flip score: these are unvalidated by design. Free, page forever with next_cursor.
  3. refine_lead — one LLM call turns a lead into a real scored opportunity (yours, private).
     Then forge_opportunity for the adversarial deep pass, then generate_plan to execute.
```

- [ ] **Step 3: Sweep expired leads and counters on the worker**

Open `worker/index.ts`, find where the existing cron jobs are registered, and add a daily sweep following the same pattern the file already uses:

```ts
// Daily 03:20 UTC: drop expired anonymous leads and stale usage counters.
cron.schedule('20 3 * * *', () => {
  try {
    const leads = expireLeads();
    const counters = gcCounters();
    console.log(`[sweep] expired ${leads} lead(s), pruned ${counters} counter row(s)`);
  } catch (err) {
    console.error('[sweep] failed', err);
  }
});
```

with imports:

```ts
import { expireLeads } from '../src/lib/opportunities/leads';
import { gcCounters } from '../src/lib/usage/counters';
```

- [ ] **Step 4: Update the README**

In `README.md`, replace the "The flagship workflow" paragraph in the **Connect your agent (MCP)** section with:

```markdown
**Finding something to build.** Three rungs, cheapest first:

1. `get_opportunities` — the curated public radar: reviewed, scored, the same for everyone. Free.
2. `get_leads` — unlimited openings composed *for you alone* by crossing live signal against a business-wedge taxonomy. Deliberately unvalidated (heuristic score, no verdict), free, and pageable with `next_cursor` until the combination space runs out. Two callers never see the same leads.
3. `refine_lead` → `forge_opportunity` → `generate_plan` — one LLM call scores a lead into your private opportunity; the forge runs a four-role adversarial debate over it; the plan makes it executable.

`dismiss_opportunity` teaches your pool what not to show you again. Call `get_my_usage` for quota and tokens saved.
```

Add to the environment table:

| Var | Notes |
|---|---|
| `MCP_SCOUT_DAILY_CAP` | anonymous scout runs/day per IP; default 10 (signed-in callers use tier quotas) |

- [ ] **Step 5: Run the full suite**

```bash
npm test
```

Expected: all pass.

- [ ] **Step 6: Verify the server actually boots and lists the new tools**

```bash
npm run mcp
```

Expected: `[mcp] ... MCP server on :3122`. In another shell:

```bash
curl -s -X POST http://127.0.0.1:3122/mcp \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | grep -o '"name":"[a-z_]*"' | sort
```

Expected: the list includes `get_leads`, `refine_lead`, `dismiss_opportunity`, and `forge_opportunity`. Stop the server with Ctrl-C.

- [ ] **Step 7: Commit**

```bash
git add mcp/prompts.ts mcp/tools/meta.ts worker/index.ts README.md
git commit -m "docs(mcp): document the generation ladder and sweep expired leads"
```

---

## Done criteria

The work is complete when all of these hold:

- [ ] `npm test` passes with no skipped tests.
- [ ] Two different `AuthContext.userId` values calling `get_leads` receive near-disjoint results (covered by `tests/mcp-leads.test.ts`).
- [ ] Paging `get_leads` with `next_cursor` never repeats a slug (covered by `tests/opportunity-compose.test.ts` and `tests/mcp-leads.test.ts`).
- [ ] A user's refined openings are invisible to every other user (covered by `tests/opportunity-scoping.test.ts`).
- [ ] `scout_opportunities` no longer returns zero because *another* caller was served first — `activeSlugs()` is owner-scoped.
- [ ] Rate limits and scout caps survive a process restart (covered by `tests/mcp-rate-persist.test.ts`).
- [ ] `get_leads` costs zero LLM calls: it never imports `chatJSON`, directly or transitively.

## Notes for whoever executes this

- **If a step's code does not match what you find in the file**, the repo has moved on. Prefer the repo's current shape and adapt — but do not silently drop a behavior the tests assert.
- **Do not weaken a test to make it pass.** If a test is wrong, say so and explain why before changing it.
- **Task 14's tests are deliberately red until Task 15.** That is the only place in this plan where a task ends with a failing test; everywhere else, red means something is wrong.
- **The riskiest work is Task 10.** If composed leads read as nonsense in practice, the fix is the tag lexicon in `primitives.ts` and the `requiresTags`/`excludesTags` in `wedges.ts` — both are data, not logic. Tighten them and re-run `tests/opportunity-compose.test.ts`.
