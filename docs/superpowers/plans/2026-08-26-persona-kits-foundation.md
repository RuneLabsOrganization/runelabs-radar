# Persona Kits — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the persona-kit architecture end-to-end against an empty grid — 9 categories × 28 cells × 3 tiers, 11 personas as routing presets, a pure composer that returns a costed kit with honest gaps, MCP tools, web pages, and the `board_entries` → `kit_picks` migration.

**Architecture:** A persona is config (`src/lib/kits/personas.ts`), not a table — an ordered list of `(category, task)` routes plus a default tier. Picks live one row per `(category, task, tier)` in `kit_picks`, with evidence receipts in `kit_evidence` and change history in `kit_pick_history`. A pure `composeKit()` function turns `(persona, tier, picks[])` into a `Kit` with a monthly total, usage-price risk lines, and explicit gaps. MCP tools and web pages are thin readers over it.

**Tech Stack:** TypeScript, Drizzle ORM + better-sqlite3 (SQLite/WAL), Zod, `@modelcontextprotocol/sdk`, Next.js 15 App Router, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-26-persona-kits-design.md`

---

## Scope

**In this plan (spec phases 1–2):** grid constants, persona roster, schema + migration, confidence grader, composer, repo layer, MCP tools, board repoint, web pages.

**NOT in this plan — do not build these:**

- Feeder A (benchmark/price scraping) — spec phase 3, separate plan.
- Feeder B (pick-attributed report extraction, new sources) — spec phase 4, separate plan.
- `whats_changed` MCP tool and "since your last visit" diffing — spec phase 6. The `kit_pick_history` **table** is created here so writes can start accumulating; the read surface is deferred.
- Real usage-based cost modelling. Risk flags only.

**Result when this plan is done:** every persona kit renders and every MCP tool answers, with all 84 cells reporting "not yet covered". That is the intended state — it proves the architecture and the honesty guarantees before any content exists.

## Codebase orientation (read these first)

| File | Why it matters |
|---|---|
| `src/lib/db/schema.ts` | Drizzle table definitions. `boardEntries` at ~line 103 is the shape being superseded. `userProfiles` at ~line 499 gets two new columns. |
| `src/lib/db/index.ts` | `openDb()` / `getDb()`. Migrations run on open; `PRAGMA foreign_keys = ON`. |
| `tests/helpers/db.ts` | `useTestDb()` — fresh migrated in-memory DB installed as the process singleton. `seedUser(db, id?)` — required for any test driving an MCP tool with a non-null `userId`. |
| `mcp/lib/payload.ts` | `respond()`, `envelopeSchema`, `withUserEconomy()`, `iso()`. Every structured MCP reply goes through `respond()`. |
| `mcp/tools/stacks.ts` | The cleanest existing example of a read-only MCP tool pair. Copy its shape. |
| `mcp/build.ts` | `buildServer()` — every tool module is registered here. |
| `tests/mcp-tools.test.ts` | The `InMemoryTransport` + `Client` harness for driving MCP tools in tests. |
| `src/app/app/decide/tools/page.tsx` | The board page. Reads `boardEntries`; gets repointed in Task 10. |
| `src/lib/agent-stacks.ts` | **Name-collision hazard.** Already exports `PERSONA_SLUGS`, `AgentPersona`, `resolvePersona`. All new persona symbols are prefixed `Kit`/`KIT_` to avoid clashing. |

Run tests with `npx vitest run <path>`. Full suite: `npm test`.

## File structure (locked)

```
src/lib/kits/grid.ts          KIT_CATEGORIES, KIT_TIERS, KIT_GRID, cell helpers   (pure)
src/lib/kits/personas.ts      KIT_PERSONAS roster + getKitPersona()               (pure)
src/lib/kits/confidence.ts    gradeConfidence()                                   (pure)
src/lib/kits/compose.ts       composeKit(), PickRecord, Kit, KitLine              (pure)
src/lib/kits/repo.ts          loadPicks(), loadKit(), getPickCell()               (DB)
src/lib/db/schema.ts          + kitPicks, kitEvidence, kitPickHistory; userProfiles cols
drizzle/                      generated migration (npm run db:generate)
scripts/migrate-board-to-kits.ts   one-shot board_entries → kit_picks backfill
mcp/tools/kits.ts             list_kits, get_kit, explain_pick, get_my_kit, set_my_kit
mcp/build.ts                  + registerKitTools(server, auth)
src/app/app/decide/kits/page.tsx              roster
src/app/app/decide/kits/[persona]/page.tsx    costed kit
src/app/app/decide/tools/page.tsx             repointed to kit_picks
tests/kits-grid.test.ts  kits-personas.test.ts  kits-confidence.test.ts
tests/kits-compose.test.ts  kits-repo.test.ts  kits-migrate.test.ts  mcp-kits.test.ts
```

Each file has one responsibility. Everything under `src/lib/kits/` except `repo.ts` is pure and side-effect free — that is what makes the honesty guarantees cheap to test.

---

## Contract 1 — Grid (`src/lib/kits/grid.ts`)

```ts
export const KIT_CATEGORIES = [
  'coding', 'agentic', 'copy', 'image', 'video', 'ads', 'audio', 'infra', 'connectors',
] as const;
export type KitCategory = (typeof KIT_CATEGORIES)[number];

export const KIT_TIERS = ['best', 'value', 'cheapest'] as const;
export type KitTier = (typeof KIT_TIERS)[number];

export interface KitCell { category: KitCategory; task: string }
```

## Contract 2 — Pick + Kit (`src/lib/kits/compose.ts`)

```ts
export type PriceModel = 'seat' | 'usage' | 'free';

export interface PickRecord {
  category: string;
  task: string;
  tier: KitTier;
  pickName: string;
  pickUrl: string | null;
  priceModel: PriceModel;
  priceUsdMonth: number | null;
  priceNote: string | null;
  riskFlag: string | null;
  why: string | null;
  skip: string | null;
  confidence: Confidence;
  evidenceCount: number;
  verifiedAt: Date | null;
}

export interface KitLine { category: string; task: string; pick: PickRecord | null }

export interface Kit {
  persona: string;
  label: string;
  tier: KitTier;
  lines: KitLine[];
  totalUsdMonth: number;
  usageRisk: PickRecord[];
  gaps: KitCell[];
  coveredCount: number;
  totalCount: number;
}
```

**Three invariants the composer must never break** (each gets a regression test):
1. A pick with `priceModel === 'usage'` is **never** added to `totalUsdMonth`.
2. A missing pick yields `line.pick === null` and a `gaps` entry — never a substituted or fabricated pick.
3. Every persona route resolves to a real grid cell, or the coverage test fails.

---

### Task 1: Grid constants

**Files:**
- Create: `src/lib/kits/grid.ts`
- Test: `tests/kits-grid.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/kits-grid.test.ts
import { describe, it, expect } from 'vitest';
import { KIT_CATEGORIES, KIT_GRID, KIT_TIERS, allCells, isKitCell } from '@/lib/kits/grid';

describe('kit grid', () => {
  it('has 9 categories and 28 cells', () => {
    expect(KIT_CATEGORIES).toHaveLength(9);
    expect(allCells()).toHaveLength(28);
  });

  it('defines a task list for every category', () => {
    for (const c of KIT_CATEGORIES) {
      expect(KIT_GRID[c].length).toBeGreaterThan(0);
    }
  });

  it('has three tiers', () => {
    expect(KIT_TIERS).toEqual(['best', 'value', 'cheapest']);
  });

  it('validates cells', () => {
    expect(isKitCell('video', 'avatar')).toBe(true);
    expect(isKitCell('video', 'avatar/talking-head')).toBe(false);
    expect(isKitCell('nope', 'avatar')).toBe(false);
  });

  it('has no duplicate tasks within a category', () => {
    for (const c of KIT_CATEGORIES) {
      expect(new Set(KIT_GRID[c]).size).toBe(KIT_GRID[c].length);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/kits-grid.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/kits/grid"`

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/kits/grid.ts
/**
 * The kit grid — jobs × cost tiers.
 *
 * Deliberately decoupled from src/lib/domains.ts DOMAINS. Story curation keeps
 * its six scoring buckets; the kit grid grows independently (audio, infra,
 * connectors) without touching domain_scores, source hints or hub colours.
 */

export const KIT_CATEGORIES = [
  'coding', 'agentic', 'copy', 'image', 'video', 'ads', 'audio', 'infra', 'connectors',
] as const;
export type KitCategory = (typeof KIT_CATEGORIES)[number];

export const KIT_TIERS = ['best', 'value', 'cheapest'] as const;
export type KitTier = (typeof KIT_TIERS)[number];

export interface KitCell {
  category: KitCategory;
  task: string;
}

export const KIT_GRID: Record<KitCategory, readonly string[]> = {
  coding: ['agentic-coding', 'autocomplete', 'code-review'],
  agentic: ['orchestration', 'browser-automation', 'computer-use'],
  copy: ['long-form', 'social', 'ad-copy'],
  image: ['illustration', 'photoreal', 'product-shots'],
  video: ['text-to-video', 'image-to-video', 'avatar'],
  ads: ['creative-generation', 'campaign-management'],
  audio: ['voice-tts', 'music', 'transcription'],
  infra: ['hosting', 'database-baas', 'auth', 'payments'],
  connectors: ['code-repo', 'data', 'browser', 'design'],
};

export const KIT_CATEGORY_LABELS: Record<KitCategory, string> = {
  coding: 'Coding',
  agentic: 'Agentic',
  copy: 'Copy',
  image: 'Image',
  video: 'Video',
  ads: 'Ads',
  audio: 'Audio',
  infra: 'Infrastructure',
  connectors: 'Connectors',
};

export function isKitCategory(s: string): s is KitCategory {
  return (KIT_CATEGORIES as readonly string[]).includes(s);
}

export function isKitTier(s: string): s is KitTier {
  return (KIT_TIERS as readonly string[]).includes(s);
}

export function isKitCell(category: string, task: string): boolean {
  if (!isKitCategory(category)) return false;
  return KIT_GRID[category].includes(task);
}

/** Every cell in the grid, category order then task order. */
export function allCells(): KitCell[] {
  return KIT_CATEGORIES.flatMap((category) =>
    KIT_GRID[category].map((task) => ({ category, task })),
  );
}

export function cellKey(category: string, task: string, tier: string): string {
  return `${category}/${task}/${tier}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/kits-grid.test.ts`
Expected: PASS — 5 tests

- [ ] **Step 5: Commit**

```bash
git add src/lib/kits/grid.ts tests/kits-grid.test.ts
git commit -m "feat(kits): grid constants — 9 categories, 28 cells, 3 tiers"
```

---

### Task 2: Persona roster

**Files:**
- Create: `src/lib/kits/personas.ts`
- Test: `tests/kits-personas.test.ts`

**Naming:** every export is prefixed `KIT_`/`Kit` because `src/lib/agent-stacks.ts` already exports `PERSONA_SLUGS`, `AgentPersona` and `resolvePersona`. Do not reuse those names.

- [ ] **Step 1: Write the failing test**

```ts
// tests/kits-personas.test.ts
import { describe, it, expect } from 'vitest';
import { KIT_PERSONAS, KIT_PERSONA_SLUGS, getKitPersona } from '@/lib/kits/personas';
import { allCells, isKitCell, isKitTier } from '@/lib/kits/grid';

describe('kit personas', () => {
  it('ships 11 personas with unique slugs', () => {
    expect(KIT_PERSONAS).toHaveLength(11);
    expect(new Set(KIT_PERSONA_SLUGS).size).toBe(11);
  });

  // The invariant that keeps the roster and the grid from drifting apart.
  it('every route points at a real grid cell', () => {
    for (const p of KIT_PERSONAS) {
      expect(p.routes.length).toBeGreaterThan(0);
      for (const r of p.routes) {
        expect(isKitCell(r.category, r.task), `${p.slug} → ${r.category}/${r.task}`).toBe(true);
      }
    }
  });

  it('every persona has a valid default tier', () => {
    for (const p of KIT_PERSONAS) {
      expect(isKitTier(p.defaultTier), p.slug).toBe(true);
    }
  });

  // Any orphan cell is content nobody will ever see.
  it('every grid cell is claimed by at least one persona', () => {
    const claimed = new Set(
      KIT_PERSONAS.flatMap((p) => p.routes.map((r) => `${r.category}/${r.task}`)),
    );
    const orphans = allCells()
      .map((c) => `${c.category}/${c.task}`)
      .filter((k) => !claimed.has(k));
    expect(orphans).toEqual([]);
  });

  it('has no duplicate routes within a persona', () => {
    for (const p of KIT_PERSONAS) {
      const keys = p.routes.map((r) => `${r.category}/${r.task}`);
      expect(new Set(keys).size, p.slug).toBe(keys.length);
    }
  });

  it('resolves by slug and returns null for unknown', () => {
    expect(getKitPersona('ugc-creator')?.label).toBe('UGC creator');
    expect(getKitPersona('nope')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/kits-personas.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/kits/personas"`

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/kits/personas.ts
/**
 * Persona roster — routing presets over the kit grid, NOT a content type.
 *
 * A persona is an ordered list of (category, task) routes plus a default cost
 * tier. Answers are written once per cell and shared by every persona that
 * routes to them: image/product-shots serves four of these.
 *
 * Adding a persona is a PR, not a migration. Being wrong about one is cheap.
 *
 * Symbols are KIT_-prefixed: src/lib/agent-stacks.ts already owns
 * PERSONA_SLUGS / AgentPersona / resolvePersona for the coding-harness page.
 */
import type { KitCategory, KitTier } from './grid';

export interface KitRoute {
  category: KitCategory;
  task: string;
}

export interface KitPersona {
  slug: string;
  label: string;
  blurb: string;
  routes: KitRoute[];
  defaultTier: KitTier;
}

export const KIT_PERSONAS: KitPersona[] = [
  {
    slug: 'indie-dev',
    label: 'Indie dev / solo shipper',
    blurb: 'Ships alone, owns the whole stack, pays for it personally.',
    defaultTier: 'value',
    routes: [
      { category: 'coding', task: 'agentic-coding' },
      { category: 'coding', task: 'autocomplete' },
      { category: 'coding', task: 'code-review' },
      { category: 'connectors', task: 'code-repo' },
      { category: 'infra', task: 'hosting' },
      { category: 'infra', task: 'database-baas' },
      { category: 'infra', task: 'auth' },
      { category: 'infra', task: 'payments' },
    ],
  },
  {
    slug: 'nocode-founder',
    label: 'Non-coder founder',
    blurb: 'Getting to a live product without writing the code themselves.',
    defaultTier: 'cheapest',
    routes: [
      { category: 'coding', task: 'agentic-coding' },
      { category: 'infra', task: 'hosting' },
      { category: 'infra', task: 'database-baas' },
      { category: 'copy', task: 'long-form' },
      { category: 'image', task: 'illustration' },
    ],
  },
  {
    slug: 'entrepreneur',
    label: 'Entrepreneur / MVP',
    blurb: 'Validating and launching, watching runway rather than craft.',
    defaultTier: 'value',
    routes: [
      { category: 'infra', task: 'hosting' },
      { category: 'infra', task: 'database-baas' },
      { category: 'infra', task: 'auth' },
      { category: 'infra', task: 'payments' },
      { category: 'coding', task: 'agentic-coding' },
      { category: 'copy', task: 'ad-copy' },
      { category: 'ads', task: 'campaign-management' },
    ],
  },
  {
    slug: 'product-designer',
    label: 'Product / UI designer',
    blurb: 'Screens and systems, handing off to engineering.',
    defaultTier: 'value',
    routes: [
      { category: 'image', task: 'illustration' },
      { category: 'image', task: 'photoreal' },
      { category: 'connectors', task: 'design' },
      { category: 'coding', task: 'agentic-coding' },
    ],
  },
  {
    slug: 'brand-designer',
    label: 'Brand / graphic designer',
    blurb: 'Identity, marketing assets, client work.',
    defaultTier: 'value',
    routes: [
      { category: 'image', task: 'illustration' },
      { category: 'image', task: 'product-shots' },
      { category: 'copy', task: 'social' },
    ],
  },
  {
    slug: 'ugc-creator',
    label: 'UGC creator',
    blurb: 'High-volume short-form video for brands, on a tight budget.',
    defaultTier: 'cheapest',
    routes: [
      { category: 'video', task: 'text-to-video' },
      { category: 'video', task: 'image-to-video' },
      { category: 'video', task: 'avatar' },
      { category: 'audio', task: 'voice-tts' },
      { category: 'audio', task: 'music' },
      { category: 'image', task: 'photoreal' },
    ],
  },
  {
    slug: 'filmmaker',
    label: 'Video editor / filmmaker',
    blurb: 'Longer-form narrative work where quality beats cost.',
    defaultTier: 'best',
    routes: [
      { category: 'video', task: 'text-to-video' },
      { category: 'video', task: 'image-to-video' },
      { category: 'audio', task: 'voice-tts' },
      { category: 'audio', task: 'music' },
      { category: 'audio', task: 'transcription' },
      { category: 'image', task: 'photoreal' },
    ],
  },
  {
    slug: 'perf-marketer',
    label: 'Performance marketer',
    blurb: 'Paid acquisition — creative volume and campaign ops.',
    defaultTier: 'value',
    routes: [
      { category: 'ads', task: 'creative-generation' },
      { category: 'ads', task: 'campaign-management' },
      { category: 'copy', task: 'ad-copy' },
      { category: 'image', task: 'product-shots' },
      { category: 'video', task: 'avatar' },
    ],
  },
  {
    slug: 'content-marketer',
    label: 'Content marketer / writer',
    blurb: 'Organic content, newsletters, social, repurposing.',
    defaultTier: 'value',
    routes: [
      { category: 'copy', task: 'long-form' },
      { category: 'copy', task: 'social' },
      { category: 'image', task: 'illustration' },
      { category: 'audio', task: 'transcription' },
    ],
  },
  {
    slug: 'automation',
    label: 'Data / automation builder',
    blurb: 'Wires agents to systems — orchestration and browser work.',
    defaultTier: 'value',
    routes: [
      { category: 'agentic', task: 'orchestration' },
      { category: 'agentic', task: 'browser-automation' },
      { category: 'agentic', task: 'computer-use' },
      { category: 'connectors', task: 'data' },
      { category: 'connectors', task: 'browser' },
    ],
  },
  {
    slug: 'agency',
    label: 'Agency / multi-client',
    blurb: 'Breadth across creative disciplines, billed to clients.',
    defaultTier: 'best',
    routes: [
      { category: 'image', task: 'illustration' },
      { category: 'image', task: 'photoreal' },
      { category: 'image', task: 'product-shots' },
      { category: 'video', task: 'text-to-video' },
      { category: 'video', task: 'image-to-video' },
      { category: 'video', task: 'avatar' },
      { category: 'copy', task: 'long-form' },
      { category: 'copy', task: 'social' },
      { category: 'copy', task: 'ad-copy' },
      { category: 'ads', task: 'creative-generation' },
      { category: 'ads', task: 'campaign-management' },
    ],
  },
];

export const KIT_PERSONA_SLUGS: string[] = KIT_PERSONAS.map((p) => p.slug);

export function getKitPersona(slug: string): KitPersona | null {
  return KIT_PERSONAS.find((p) => p.slug === slug) ?? null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/kits-personas.test.ts`
Expected: PASS — 6 tests. If "every grid cell is claimed" fails, the printed `orphans` array names the unclaimed cells; add a route rather than deleting the cell.

- [ ] **Step 5: Commit**

```bash
git add src/lib/kits/personas.ts tests/kits-personas.test.ts
git commit -m "feat(kits): 11-persona roster as routing presets over the grid"
```

---

### Task 3: Schema — kit_picks, kit_evidence, kit_pick_history

**Files:**
- Modify: `src/lib/db/schema.ts` (append new tables; add two columns to `userProfiles` at ~line 499)
- Create: `drizzle/` migration (generated)
- Test: `tests/kits-repo.test.ts` (first assertion only; the repo layer lands in Task 6)

- [ ] **Step 1: Write the failing test**

```ts
// tests/kits-repo.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useTestDb } from './helpers/db';
import type { Db } from '@/lib/db';
import { kitPicks } from '@/lib/db/schema';

describe('kit_picks table', () => {
  let db: Db;
  beforeEach(() => {
    db = useTestDb();
  });

  it('stores one row per (category, task, tier)', () => {
    db.insert(kitPicks)
      .values({
        category: 'video',
        task: 'text-to-video',
        tier: 'cheapest',
        pickName: 'Example',
        priceModel: 'seat',
        priceUsdMonth: 20,
        confidence: 'high',
        evidenceCount: 34,
        distinctSources: 4,
        verifiedAt: new Date('2026-08-23T00:00:00Z'),
        updatedAt: new Date('2026-08-23T00:00:00Z'),
      })
      .run();
    const rows = db.select().from(kitPicks).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].pickName).toBe('Example');
    expect(rows[0].priceModel).toBe('seat');
  });

  it('rejects a duplicate cell+tier', () => {
    const row = {
      category: 'video',
      task: 'text-to-video',
      tier: 'cheapest' as const,
      pickName: 'A',
      updatedAt: new Date(),
    };
    db.insert(kitPicks).values(row).run();
    expect(() => db.insert(kitPicks).values({ ...row, pickName: 'B' }).run()).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/kits-repo.test.ts`
Expected: FAIL — `kitPicks` is not exported from `@/lib/db/schema`

- [ ] **Step 3: Add the tables**

Append to the end of `src/lib/db/schema.ts`. `real`, `index`, `uniqueIndex` and `integer` are already imported on line 1 — do not add imports.

```ts
/**
 * Kit picks — one row per (category, task, tier).
 *
 * Supersedes board_entries, which flattened the three tiers into columns and
 * therefore had nowhere to store per-pick price, evidence, confidence or
 * verification date. That is why it has sat empty.
 *
 * `category` is the kit grid (src/lib/kits/grid.ts), NOT domains.ts DOMAINS.
 */
export const kitPicks = sqliteTable(
  'kit_picks',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    category: text('category').notNull(),
    task: text('task').notNull(),
    tier: text('tier', { enum: ['best', 'value', 'cheapest'] }).notNull(),
    pickName: text('pick_name').notNull(),
    pickUrl: text('pick_url'),
    /** seat = flat monthly; usage = metered (never enters a kit total); free = $0 */
    priceModel: text('price_model', { enum: ['seat', 'usage', 'free'] })
      .notNull()
      .default('seat'),
    priceUsdMonth: real('price_usd_month'),
    priceNote: text('price_note'),
    /** Bill-shock warning for usage-priced picks, e.g. "no spend cap by default". */
    riskFlag: text('risk_flag'),
    why: text('why'),
    skip: text('skip'),
    confidence: text('confidence', { enum: ['high', 'med', 'low'] })
      .notNull()
      .default('low'),
    evidenceCount: integer('evidence_count').notNull().default(0),
    distinctSources: integer('distinct_sources').notNull().default(0),
    verifiedAt: integer('verified_at', { mode: 'timestamp' }),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
  },
  (t) => [uniqueIndex('kit_pick_cell').on(t.category, t.task, t.tier)],
);

/** Receipts behind a verdict. The evidence engine writes these; it never writes a verdict. */
export const kitEvidence = sqliteTable(
  'kit_evidence',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    pickId: integer('pick_id')
      .notNull()
      .references(() => kitPicks.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: ['benchmark', 'price', 'report'] }).notNull(),
    sourceUrl: text('source_url').notNull(),
    excerpt: text('excerpt'),
    /** -1 negative, 0 neutral, 1 positive */
    sentiment: integer('sentiment').notNull().default(0),
    observedAt: integer('observed_at', { mode: 'timestamp' }).notNull(),
  },
  (t) => [index('kit_evidence_pick').on(t.pickId)],
);

/**
 * Every pick change, forever. Powers "changed since you last looked" (spec
 * phase 6) and is the longitudinal asset a competitor cannot scrape — start
 * accumulating it now even though the read surface ships later.
 */
export const kitPickHistory = sqliteTable(
  'kit_pick_history',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    category: text('category').notNull(),
    task: text('task').notNull(),
    tier: text('tier', { enum: ['best', 'value', 'cheapest'] }).notNull(),
    fromPick: text('from_pick'),
    toPick: text('to_pick').notNull(),
    reason: text('reason').notNull(),
    changedAt: integer('changed_at', { mode: 'timestamp' }).notNull(),
  },
  (t) => [index('kit_history_cell').on(t.category, t.task)],
);
```

- [ ] **Step 4: Add the two persona columns to `userProfiles`**

Change the `userProfiles` definition (~line 499) from:

```ts
export const userProfiles = sqliteTable('user_profiles', {
  userId: integer('user_id').primaryKey().references(() => users.id),
  skills: text('skills').notNull().default('[]'), // JSON string[]
  interests: text('interests').notNull().default('[]'), // JSON string[] (sectors/topics)
  capitalBand: text('capital_band'), // null | 'bootstrap' | 'small' | 'comfortable' | 'funded'
  avoidedSectors: text('avoided_sectors').notNull().default('[]'), // JSON string[]
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});
```

to:

```ts
export const userProfiles = sqliteTable('user_profiles', {
  userId: integer('user_id').primaryKey().references(() => users.id),
  skills: text('skills').notNull().default('[]'), // JSON string[]
  interests: text('interests').notNull().default('[]'), // JSON string[] (sectors/topics)
  capitalBand: text('capital_band'), // null | 'bootstrap' | 'small' | 'comfortable' | 'funded'
  avoidedSectors: text('avoided_sectors').notNull().default('[]'), // JSON string[]
  /** Saved kit persona slug — src/lib/kits/personas.ts KIT_PERSONA_SLUGS. */
  kitPersona: text('kit_persona'),
  /** Saved kit tier override; null = the persona's defaultTier. */
  kitTier: text('kit_tier', { enum: ['best', 'value', 'cheapest'] }),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});
```

- [ ] **Step 5: Generate the migration**

```bash
npm run db:generate
```

Expected: a new `drizzle/NNNN_*.sql` file containing `CREATE TABLE kit_picks`, `CREATE TABLE kit_evidence`, `CREATE TABLE kit_pick_history`, and `ALTER TABLE user_profiles ADD ...` for the two columns. Open the file and confirm before continuing.

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/kits-repo.test.ts`
Expected: PASS — 2 tests

- [ ] **Step 7: Run the full suite (migration touches shared schema)**

Run: `npm test`
Expected: PASS — no regressions

- [ ] **Step 8: Commit**

```bash
git add src/lib/db/schema.ts drizzle/ tests/kits-repo.test.ts
git commit -m "feat(kits): kit_picks, kit_evidence, kit_pick_history + saved persona columns"
```

---

### Task 4: Confidence grader

**Files:**
- Create: `src/lib/kits/confidence.ts`
- Test: `tests/kits-confidence.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/kits-confidence.test.ts
import { describe, it, expect } from 'vitest';
import { gradeConfidence } from '@/lib/kits/confidence';

const NOW = new Date('2026-08-26T00:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

describe('gradeConfidence', () => {
  it('is high with volume, source spread and recency', () => {
    expect(
      gradeConfidence({ evidenceCount: 20, distinctSources: 3, verifiedAt: daysAgo(3), now: NOW }),
    ).toBe('high');
  });

  it('is med when volume is there but sources are thin', () => {
    expect(
      gradeConfidence({ evidenceCount: 40, distinctSources: 2, verifiedAt: daysAgo(3), now: NOW }),
    ).toBe('med');
  });

  it('is low below the volume floor', () => {
    expect(
      gradeConfidence({ evidenceCount: 4, distinctSources: 4, verifiedAt: daysAgo(1), now: NOW }),
    ).toBe('low');
  });

  it('demotes high to med past 14 days', () => {
    expect(
      gradeConfidence({ evidenceCount: 50, distinctSources: 9, verifiedAt: daysAgo(20), now: NOW }),
    ).toBe('med');
  });

  it('demotes a tier past 45 days', () => {
    expect(
      gradeConfidence({ evidenceCount: 50, distinctSources: 9, verifiedAt: daysAgo(60), now: NOW }),
    ).toBe('med');
    expect(
      gradeConfidence({ evidenceCount: 6, distinctSources: 2, verifiedAt: daysAgo(60), now: NOW }),
    ).toBe('low');
  });

  it('is low past 90 days no matter the volume', () => {
    expect(
      gradeConfidence({ evidenceCount: 500, distinctSources: 40, verifiedAt: daysAgo(120), now: NOW }),
    ).toBe('low');
  });

  it('is low when never verified', () => {
    expect(
      gradeConfidence({ evidenceCount: 500, distinctSources: 40, verifiedAt: null, now: NOW }),
    ).toBe('low');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/kits-confidence.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/kits/confidence"`

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/kits/confidence.ts
/**
 * Confidence is computed, never asserted.
 *
 * Volume and source spread set the ceiling; age pulls it down. A cell nobody
 * re-verifies decays on its own, so staleness surfaces without anyone
 * remembering to audit — the failure mode AGENT_STACKS_REVIEWED_AT is exposed
 * to today.
 *
 * Ladder: high needs >=20 reports from >=3 distinct sources verified <=14d;
 * med needs >=5 reports verified <=45d; past 45d drop a tier; past 90d low.
 */

export type Confidence = 'high' | 'med' | 'low';

export interface ConfidenceInput {
  evidenceCount: number;
  distinctSources: number;
  verifiedAt: Date | null;
  /** Injectable for deterministic tests. */
  now?: Date;
}

const DAY_MS = 86_400_000;

function demote(c: Confidence): Confidence {
  return c === 'high' ? 'med' : 'low';
}

export function gradeConfidence(input: ConfidenceInput): Confidence {
  const { evidenceCount, distinctSources, verifiedAt } = input;
  if (!verifiedAt) return 'low';

  const now = input.now ?? new Date();
  const ageDays = (now.getTime() - verifiedAt.getTime()) / DAY_MS;

  let tier: Confidence =
    evidenceCount >= 20 && distinctSources >= 3 ? 'high' : evidenceCount >= 5 ? 'med' : 'low';

  if (ageDays > 90) return 'low';
  if (ageDays > 45) return demote(tier);
  if (ageDays > 14 && tier === 'high') tier = 'med';
  return tier;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/kits-confidence.test.ts`
Expected: PASS — 7 tests

- [ ] **Step 5: Commit**

```bash
git add src/lib/kits/confidence.ts tests/kits-confidence.test.ts
git commit -m "feat(kits): confidence grader with age decay"
```

---

### Task 5: The composer

**Files:**
- Create: `src/lib/kits/compose.ts`
- Test: `tests/kits-compose.test.ts`

This is the heart of the feature. It is pure: no DB, no LLM, no clock beyond what is passed in.

- [ ] **Step 1: Write the failing test**

```ts
// tests/kits-compose.test.ts
import { describe, it, expect } from 'vitest';
import { composeKit, type PickRecord } from '@/lib/kits/compose';
import { KIT_PERSONAS, getKitPersona } from '@/lib/kits/personas';
import { KIT_TIERS } from '@/lib/kits/grid';

function pick(over: Partial<PickRecord> & Pick<PickRecord, 'category' | 'task'>): PickRecord {
  return {
    tier: 'cheapest',
    pickName: 'Thing',
    pickUrl: null,
    priceModel: 'seat',
    priceUsdMonth: 10,
    priceNote: null,
    riskFlag: null,
    why: null,
    skip: null,
    confidence: 'high',
    evidenceCount: 30,
    verifiedAt: new Date('2026-08-24T00:00:00Z'),
    ...over,
  };
}

const UGC = getKitPersona('ugc-creator')!;

describe('composeKit', () => {
  it('totals seat-priced picks and counts coverage', () => {
    const kit = composeKit(UGC, 'cheapest', [
      pick({ category: 'video', task: 'text-to-video', priceUsdMonth: 20 }),
      pick({ category: 'audio', task: 'voice-tts', priceUsdMonth: 12 }),
    ]);
    expect(kit.totalUsdMonth).toBe(32);
    expect(kit.coveredCount).toBe(2);
    expect(kit.totalCount).toBe(6);
  });

  it('counts free picks as zero', () => {
    const kit = composeKit(UGC, 'cheapest', [
      pick({ category: 'audio', task: 'music', priceModel: 'free', priceUsdMonth: null }),
    ]);
    expect(kit.totalUsdMonth).toBe(0);
    expect(kit.coveredCount).toBe(1);
  });

  // INVARIANT 1 — usage-priced picks never enter the total.
  it('excludes usage-priced picks from the total and lists them as risk', () => {
    const kit = composeKit(UGC, 'cheapest', [
      pick({ category: 'video', task: 'text-to-video', priceUsdMonth: 20 }),
      pick({
        category: 'audio',
        task: 'voice-tts',
        priceModel: 'usage',
        priceUsdMonth: 999,
        riskFlag: 'no spend cap by default',
      }),
    ]);
    expect(kit.totalUsdMonth).toBe(20);
    expect(kit.usageRisk).toHaveLength(1);
    expect(kit.usageRisk[0].riskFlag).toBe('no spend cap by default');
    // still rendered as a line — excluded from the total, not hidden
    expect(kit.lines.find((l) => l.task === 'voice-tts')?.pick).not.toBeNull();
  });

  // INVARIANT 2 — gaps are reported, never back-filled.
  it('reports missing cells as gaps with a null pick', () => {
    const kit = composeKit(UGC, 'cheapest', [
      pick({ category: 'video', task: 'text-to-video' }),
    ]);
    expect(kit.gaps).toHaveLength(5);
    expect(kit.lines).toHaveLength(6);
    expect(kit.lines.filter((l) => l.pick === null)).toHaveLength(5);
  });

  it('only matches picks of the requested tier', () => {
    const kit = composeKit(UGC, 'cheapest', [
      pick({ category: 'video', task: 'text-to-video', tier: 'best' }),
    ]);
    expect(kit.coveredCount).toBe(0);
    expect(kit.gaps).toHaveLength(6);
  });

  it('drops excluded cells from lines and gaps alike', () => {
    const kit = composeKit(UGC, 'cheapest', [], { exclude: ['audio/music', 'audio/voice-tts'] });
    expect(kit.lines).toHaveLength(4);
    expect(kit.totalCount).toBe(4);
    expect(kit.gaps).toHaveLength(4);
  });

  it('preserves persona route order', () => {
    const kit = composeKit(UGC, 'cheapest', []);
    expect(kit.lines.map((l) => `${l.category}/${l.task}`)).toEqual(
      UGC.routes.map((r) => `${r.category}/${r.task}`),
    );
  });

  // INVARIANT 3 — the whole roster composes against an empty grid.
  it('every persona and tier composes with no picks at all', () => {
    for (const p of KIT_PERSONAS) {
      for (const tier of KIT_TIERS) {
        const kit = composeKit(p, tier, []);
        expect(kit.lines).toHaveLength(p.routes.length);
        expect(kit.gaps).toHaveLength(p.routes.length);
        expect(kit.totalUsdMonth).toBe(0);
        expect(kit.coveredCount).toBe(0);
      }
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/kits-compose.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/kits/compose"`

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/kits/compose.ts
/**
 * The composer: (persona, tier, picks) -> costed kit.
 *
 * Pure by design — no DB, no LLM, no ambient clock. The product's three
 * honesty guarantees live here and are cheap to test because of it:
 *
 *   1. usage-priced picks NEVER enter totalUsdMonth
 *   2. a missing pick is a gap, never a substitution
 *   3. line order is the persona's route order
 */
import { cellKey, type KitCell, type KitTier } from './grid';
import type { KitPersona } from './personas';
import type { Confidence } from './confidence';

export type PriceModel = 'seat' | 'usage' | 'free';

export interface PickRecord {
  category: string;
  task: string;
  tier: KitTier;
  pickName: string;
  pickUrl: string | null;
  priceModel: PriceModel;
  priceUsdMonth: number | null;
  priceNote: string | null;
  riskFlag: string | null;
  why: string | null;
  skip: string | null;
  confidence: Confidence;
  evidenceCount: number;
  verifiedAt: Date | null;
}

export interface KitLine {
  category: string;
  task: string;
  pick: PickRecord | null;
}

export interface Kit {
  persona: string;
  label: string;
  tier: KitTier;
  lines: KitLine[];
  /** Seat- and free-priced picks only. Usage-priced spend is unbounded and unknowable here. */
  totalUsdMonth: number;
  usageRisk: PickRecord[];
  gaps: KitCell[];
  coveredCount: number;
  totalCount: number;
}

export interface ComposeOpts {
  /** "category/task" keys to drop entirely — the user already has these covered. */
  exclude?: string[];
}

export function composeKit(
  persona: KitPersona,
  tier: KitTier,
  picks: PickRecord[],
  opts: ComposeOpts = {},
): Kit {
  const byCell = new Map(picks.map((p) => [cellKey(p.category, p.task, p.tier), p]));
  const excluded = new Set(opts.exclude ?? []);

  const routes = persona.routes.filter((r) => !excluded.has(`${r.category}/${r.task}`));

  const lines: KitLine[] = [];
  const gaps: KitCell[] = [];
  const usageRisk: PickRecord[] = [];
  let totalUsdMonth = 0;

  for (const route of routes) {
    const pick = byCell.get(cellKey(route.category, route.task, tier)) ?? null;
    lines.push({ category: route.category, task: route.task, pick });

    if (!pick) {
      gaps.push({ category: route.category, task: route.task });
      continue;
    }
    if (pick.priceModel === 'usage') {
      usageRisk.push(pick);
      continue; // never billed into the total
    }
    totalUsdMonth += pick.priceUsdMonth ?? 0;
  }

  return {
    persona: persona.slug,
    label: persona.label,
    tier,
    lines,
    totalUsdMonth: Math.round(totalUsdMonth * 100) / 100,
    usageRisk,
    gaps,
    coveredCount: lines.length - gaps.length,
    totalCount: lines.length,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/kits-compose.test.ts`
Expected: PASS — 8 tests

- [ ] **Step 5: Commit**

```bash
git add src/lib/kits/compose.ts tests/kits-compose.test.ts
git commit -m "feat(kits): pure composer with usage-price and gap invariants"
```

---

### Task 6: Repo layer

**Files:**
- Create: `src/lib/kits/repo.ts`
- Modify: `tests/kits-repo.test.ts` (append)

- [ ] **Step 1: Write the failing test**

Append to `tests/kits-repo.test.ts`:

```ts
import { getKitPersona } from '@/lib/kits/personas';
import { loadKit, loadPicks, getPickCell } from '@/lib/kits/repo';

describe('kit repo', () => {
  let db: Db;
  beforeEach(() => {
    db = useTestDb();
    db.insert(kitPicks)
      .values([
        {
          category: 'video',
          task: 'text-to-video',
          tier: 'cheapest',
          pickName: 'VidThing',
          priceModel: 'seat',
          priceUsdMonth: 20,
          confidence: 'high',
          evidenceCount: 34,
          distinctSources: 4,
          verifiedAt: new Date('2026-08-23T00:00:00Z'),
          updatedAt: new Date('2026-08-23T00:00:00Z'),
        },
        {
          category: 'audio',
          task: 'voice-tts',
          tier: 'cheapest',
          pickName: 'VoiceThing',
          priceModel: 'usage',
          priceUsdMonth: 99,
          riskFlag: 'metered per character',
          confidence: 'med',
          evidenceCount: 8,
          distinctSources: 2,
          verifiedAt: new Date('2026-08-20T00:00:00Z'),
          updatedAt: new Date('2026-08-20T00:00:00Z'),
        },
      ])
      .run();
  });

  it('loads picks for a set of cells', () => {
    const picks = loadPicks([{ category: 'video', task: 'text-to-video' }], 'cheapest');
    expect(picks).toHaveLength(1);
    expect(picks[0].pickName).toBe('VidThing');
    expect(picks[0].verifiedAt).toBeInstanceOf(Date);
  });

  it('composes a kit from the database', () => {
    const kit = loadKit(getKitPersona('ugc-creator')!, 'cheapest');
    expect(kit.coveredCount).toBe(2);
    expect(kit.totalUsdMonth).toBe(20); // usage-priced voice excluded
    expect(kit.usageRisk).toHaveLength(1);
    expect(kit.gaps).toHaveLength(4);
  });

  it('returns a single cell or null', () => {
    expect(getPickCell('video', 'text-to-video', 'cheapest')?.pickName).toBe('VidThing');
    expect(getPickCell('video', 'avatar', 'cheapest')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/kits-repo.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/kits/repo"`

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/kits/repo.ts
/**
 * Database reads for kits. The only impure module under src/lib/kits — the
 * grid, roster, grader and composer stay pure so the invariants are cheap to
 * test.
 */
import { and, eq, inArray } from 'drizzle-orm';
import { getDb } from '../db';
import { kitPicks } from '../db/schema';
import { composeKit, type Kit, type PickRecord } from './compose';
import type { KitCell, KitTier } from './grid';
import type { KitPersona } from './personas';

type Row = typeof kitPicks.$inferSelect;

function toRecord(row: Row): PickRecord {
  return {
    category: row.category,
    task: row.task,
    tier: row.tier,
    pickName: row.pickName,
    pickUrl: row.pickUrl ?? null,
    priceModel: row.priceModel,
    priceUsdMonth: row.priceUsdMonth ?? null,
    priceNote: row.priceNote ?? null,
    riskFlag: row.riskFlag ?? null,
    why: row.why ?? null,
    skip: row.skip ?? null,
    confidence: row.confidence,
    evidenceCount: row.evidenceCount,
    verifiedAt: row.verifiedAt ?? null,
  };
}

/** Picks for the given cells at one tier. Cells with no row are simply absent. */
export function loadPicks(cells: KitCell[] | { category: string; task: string }[], tier: KitTier): PickRecord[] {
  if (cells.length === 0) return [];
  const db = getDb();
  const tasks = [...new Set(cells.map((c) => c.task))];
  const categories = [...new Set(cells.map((c) => c.category))];
  const wanted = new Set(cells.map((c) => `${c.category}/${c.task}`));
  // One query over the (category, task) bounding box, then filter to the exact
  // pairs — cheaper than N queries and correct for sparse route sets.
  return db
    .select()
    .from(kitPicks)
    .where(
      and(
        eq(kitPicks.tier, tier),
        inArray(kitPicks.category, categories),
        inArray(kitPicks.task, tasks),
      ),
    )
    .all()
    .filter((r) => wanted.has(`${r.category}/${r.task}`))
    .map(toRecord);
}

export function getPickCell(category: string, task: string, tier: KitTier): PickRecord | null {
  const db = getDb();
  const row = db
    .select()
    .from(kitPicks)
    .where(and(eq(kitPicks.category, category), eq(kitPicks.task, task), eq(kitPicks.tier, tier)))
    .get();
  return row ? toRecord(row) : null;
}

/** The full read path: persona + tier -> costed kit. */
export function loadKit(persona: KitPersona, tier: KitTier, exclude?: string[]): Kit {
  const picks = loadPicks(persona.routes, tier);
  return composeKit(persona, tier, picks, { exclude });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/kits-repo.test.ts`
Expected: PASS — 5 tests

- [ ] **Step 5: Commit**

```bash
git add src/lib/kits/repo.ts tests/kits-repo.test.ts
git commit -m "feat(kits): repo layer — DB picks to composed kits"
```

---

### Task 7: MCP tools — list_kits and get_kit

**Files:**
- Create: `mcp/tools/kits.ts`
- Modify: `mcp/build.ts`
- Test: `tests/mcp-kits.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/mcp-kits.test.ts
import { beforeEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildServer } from '../mcp/build';
import type { AuthContext } from '../mcp/lib/auth';
import { kitPicks } from '@/lib/db/schema';
import { useTestDb } from './helpers/db';

const AUTH: AuthContext = {
  authed: false,
  userId: null,
  scopes: new Set(['read', 'plans']),
  rateKey: 'test',
};

async function wire(auth: AuthContext = AUTH): Promise<Client> {
  const server = buildServer(auth);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'mcp-test', version: '0.0.1' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return client;
}

async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  const res = (await client.callTool({ name, arguments: args })) as {
    structuredContent?: Record<string, any>;
  };
  return res.structuredContent!;
}

describe('kit MCP tools', () => {
  beforeEach(() => {
    const db = useTestDb();
    db.insert(kitPicks)
      .values({
        category: 'video',
        task: 'text-to-video',
        tier: 'cheapest',
        pickName: 'VidThing',
        priceModel: 'seat',
        priceUsdMonth: 20,
        why: 'cheapest that holds motion',
        confidence: 'high',
        evidenceCount: 34,
        distinctSources: 4,
        verifiedAt: new Date('2026-08-23T00:00:00Z'),
        updatedAt: new Date('2026-08-23T00:00:00Z'),
      })
      .run();
  });

  it('list_kits returns the roster', async () => {
    const out = await call(await wire(), 'list_kits');
    expect(out.count).toBe(11);
    expect(out.kits.map((k: any) => k.persona)).toContain('ugc-creator');
  });

  it('get_kit returns a costed kit with gaps', async () => {
    const out = await call(await wire(), 'get_kit', { persona: 'ugc-creator' });
    expect(out.found).toBe(true);
    expect(out.tier).toBe('cheapest'); // persona default
    expect(out.total_usd_month).toBe(20);
    expect(out.covered).toBe(1);
    expect(out.total_cells).toBe(6);
    expect(out.gaps).toHaveLength(5);
    const line = out.lines.find((l: any) => l.task === 'text-to-video');
    expect(line.pick).toBe('VidThing');
    expect(line.confidence).toBe('high');
  });

  it('get_kit honours an explicit tier', async () => {
    const out = await call(await wire(), 'get_kit', { persona: 'ugc-creator', tier: 'best' });
    expect(out.tier).toBe('best');
    expect(out.covered).toBe(0);
  });

  it('get_kit on an unknown persona lists the available slugs', async () => {
    const out = await call(await wire(), 'get_kit', { persona: 'astronaut' });
    expect(out.found).toBe(false);
    expect(out.available).toContain('filmmaker');
  });

  it('get_kit excludes cells on request', async () => {
    const out = await call(await wire(), 'get_kit', {
      persona: 'ugc-creator',
      exclude: ['audio/music'],
    });
    expect(out.total_cells).toBe(5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/mcp-kits.test.ts`
Expected: FAIL — `Tool list_kits not found`

- [ ] **Step 3: Write the tools**

```ts
// mcp/tools/kits.ts
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { KIT_PERSONAS, KIT_PERSONA_SLUGS, getKitPersona } from '../../src/lib/kits/personas';
import { KIT_TIERS, type KitTier } from '../../src/lib/kits/grid';
import { loadKit } from '../../src/lib/kits/repo';
import type { Kit } from '../../src/lib/kits/compose';
import { envelopeSchema, iso, respond, withUserEconomy } from '../lib/payload';
import type { AuthContext } from '../lib/auth';

const tierSchema = z.enum(KIT_TIERS);

const lineSchema = z.object({
  category: z.string(),
  task: z.string(),
  pick: z.string().nullable(),
  url: z.string().nullable(),
  price_model: z.string().nullable(),
  price_usd_month: z.number().nullable(),
  why: z.string().nullable(),
  skip: z.string().nullable(),
  confidence: z.string().nullable(),
  evidence_count: z.number().nullable(),
  verified_at: z.string().nullable(),
  risk_flag: z.string().nullable(),
});

const kitOutput = {
  ...envelopeSchema,
  found: z.boolean(),
  available: z.array(z.string()).optional(),
  persona: z.string().optional(),
  label: z.string().optional(),
  tier: z.string().optional(),
  total_usd_month: z.number().optional(),
  covered: z.number().optional(),
  total_cells: z.number().optional(),
  lines: z.array(lineSchema).optional(),
  usage_risk: z
    .array(z.object({ pick: z.string(), category: z.string(), task: z.string(), risk: z.string().nullable() }))
    .optional(),
  gaps: z.array(z.object({ category: z.string(), task: z.string() })).optional(),
};

/** Kit -> MCP payload. Shared by get_kit and get_my_kit so the shape can't drift. */
export function kitPayload(kit: Kit): Record<string, unknown> {
  return {
    found: true,
    persona: kit.persona,
    label: kit.label,
    tier: kit.tier,
    total_usd_month: kit.totalUsdMonth,
    covered: kit.coveredCount,
    total_cells: kit.totalCount,
    lines: kit.lines.map((l) => ({
      category: l.category,
      task: l.task,
      pick: l.pick?.pickName ?? null,
      url: l.pick?.pickUrl ?? null,
      price_model: l.pick?.priceModel ?? null,
      price_usd_month: l.pick?.priceUsdMonth ?? null,
      why: l.pick?.why ?? null,
      skip: l.pick?.skip ?? null,
      confidence: l.pick?.confidence ?? null,
      evidence_count: l.pick?.evidenceCount ?? null,
      verified_at: l.pick ? iso(l.pick.verifiedAt) : null,
      risk_flag: l.pick?.riskFlag ?? null,
    })),
    usage_risk: kit.usageRisk.map((p) => ({
      pick: p.pickName,
      category: p.category,
      task: p.task,
      risk: p.riskFlag,
    })),
    gaps: kit.gaps.map((g) => ({ category: g.category, task: g.task })),
  };
}

export function kitSummary(kit: Kit): string {
  const usage = kit.usageRisk.length ? `, ${kit.usageRisk.length} usage-priced excluded` : '';
  return `${kit.label} (${kit.tier}): $${kit.totalUsdMonth}/mo across ${kit.coveredCount} of ${kit.totalCount} cells${usage}.`;
}

export function registerKitTools(server: McpServer, auth: AuthContext): void {
  server.registerTool(
    'list_kits',
    {
      description:
        'All persona kits available for get_kit — the roster of roles Radar composes a costed tool setup for.',
      inputSchema: {},
      outputSchema: {
        ...envelopeSchema,
        count: z.number(),
        kits: z.array(
          z.object({
            persona: z.string(),
            label: z.string(),
            blurb: z.string(),
            cells: z.number(),
            default_tier: z.string(),
          }),
        ),
      },
    },
    async () =>
      respond(
        {
          count: KIT_PERSONAS.length,
          kits: KIT_PERSONAS.map((p) => ({
            persona: p.slug,
            label: p.label,
            blurb: p.blurb,
            cells: p.routes.length,
            default_tier: p.defaultTier,
          })),
        },
        {
          summary: `${KIT_PERSONAS.length} persona kits available.`,
          economy: withUserEconomy(auth.userId, 'read'),
          next: [
            { tool: 'get_kit', arguments: { persona: 'indie-dev' }, reason: 'read a costed kit' },
          ],
        },
      ),
  );

  server.registerTool(
    'get_kit',
    {
      description:
        'The costed tool kit for a persona: one pick per job at the chosen cost tier, a monthly total (usage-priced picks excluded and flagged separately), and the cells not yet covered. Use for "what should I actually be running / what does it cost".',
      inputSchema: {
        persona: z.string().describe('persona slug — see list_kits'),
        tier: tierSchema.optional().describe("cost tier; defaults to the persona's own default"),
        exclude: z
          .array(z.string())
          .optional()
          .describe('"category/task" keys to drop, e.g. ["audio/music"] if you already have one'),
      },
      outputSchema: kitOutput,
    },
    async ({ persona, tier, exclude }) => {
      const p = getKitPersona(persona);
      if (!p) {
        return respond(
          { found: false, available: KIT_PERSONA_SLUGS },
          {
            summary: `No kit for persona "${persona}".`,
            economy: withUserEconomy(auth.userId, 'read'),
            next: [{ tool: 'list_kits', arguments: {}, reason: 'available personas' }],
          },
        );
      }
      const chosen: KitTier = tier ?? p.defaultTier;
      const kit = loadKit(p, chosen, exclude);
      return respond(kitPayload(kit), {
        summary: kitSummary(kit),
        economy: withUserEconomy(auth.userId, 'read'),
        // `exclude` can empty the route list, so never index lines[0] blindly.
        next: kit.lines[0]
          ? [
              {
                tool: 'explain_pick',
                arguments: { category: kit.lines[0].category, task: kit.lines[0].task, tier: chosen },
                reason: 'see the evidence behind a pick',
              },
            ]
          : [],
      });
    },
  );
}
```

- [ ] **Step 4: Register in `mcp/build.ts`**

Add the import alongside the others (after the `registerWatchTools` import on line 29):

```ts
import { registerKitTools } from './tools/kits';
```

Add the registration call after `registerWatchTools(server, auth);` (line 69):

```ts
  registerKitTools(server, auth);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/mcp-kits.test.ts`
Expected: PASS — 5 tests

- [ ] **Step 6: Commit**

```bash
git add mcp/tools/kits.ts mcp/build.ts tests/mcp-kits.test.ts
git commit -m "feat(mcp): list_kits and get_kit — costed persona kits"
```

---

### Task 8: MCP tools — explain_pick, get_my_kit, set_my_kit

**Files:**
- Modify: `mcp/tools/kits.ts`
- Modify: `tests/mcp-kits.test.ts` (append)

`get_my_kit` is the tool that carries the quality-of-execution claim: an agent reads the caller's committed stack instead of re-litigating settled decisions.

- [ ] **Step 1: Write the failing test**

Append to `tests/mcp-kits.test.ts`:

```ts
import { seedUser } from './helpers/db';
import { kitEvidence } from '@/lib/db/schema';

const AUTHED: AuthContext = {
  authed: true,
  userId: 1,
  scopes: new Set(['read', 'plans']),
  rateKey: 'test-authed',
};

describe('explain_pick and saved kits', () => {
  beforeEach(() => {
    const db = useTestDb();
    seedUser(db, 1);
    const pickId = db
      .insert(kitPicks)
      .values({
        category: 'video',
        task: 'text-to-video',
        tier: 'cheapest',
        pickName: 'VidThing',
        priceModel: 'seat',
        priceUsdMonth: 20,
        why: 'cheapest that holds motion',
        confidence: 'high',
        evidenceCount: 1,
        distinctSources: 1,
        verifiedAt: new Date('2026-08-23T00:00:00Z'),
        updatedAt: new Date('2026-08-23T00:00:00Z'),
      })
      .returning({ id: kitPicks.id })
      .get()!.id;
    db.insert(kitEvidence)
      .values({
        pickId,
        kind: 'report',
        sourceUrl: 'https://example.com/thread',
        excerpt: 'held motion better than the alternatives at this price',
        sentiment: 1,
        observedAt: new Date('2026-08-22T00:00:00Z'),
      })
      .run();
  });

  it('explain_pick returns the evidence receipts', async () => {
    const out = await call(await wire(), 'explain_pick', {
      category: 'video',
      task: 'text-to-video',
      tier: 'cheapest',
    });
    expect(out.found).toBe(true);
    expect(out.pick).toBe('VidThing');
    expect(out.evidence).toHaveLength(1);
    expect(out.evidence[0].source_url).toBe('https://example.com/thread');
  });

  it('explain_pick reports an uncovered cell honestly', async () => {
    const out = await call(await wire(), 'explain_pick', {
      category: 'video',
      task: 'avatar',
      tier: 'cheapest',
    });
    expect(out.found).toBe(false);
  });

  it('set_my_kit then get_my_kit round-trips', async () => {
    const client = await wire(AUTHED);
    const saved = await call(client, 'set_my_kit', { persona: 'ugc-creator', tier: 'cheapest' });
    expect(saved.ok).toBe(true);
    const mine = await call(client, 'get_my_kit');
    expect(mine.found).toBe(true);
    expect(mine.persona).toBe('ugc-creator');
    expect(mine.total_usd_month).toBe(20);
  });

  it('get_my_kit reports no saved persona rather than guessing', async () => {
    const out = await call(await wire(AUTHED), 'get_my_kit');
    expect(out.found).toBe(false);
  });

  it('set_my_kit requires auth', async () => {
    const out = await call(await wire(), 'set_my_kit', { persona: 'ugc-creator' });
    expect(out.ok).toBe(false);
  });

  it('set_my_kit rejects an unknown persona', async () => {
    const out = await call(await wire(AUTHED), 'set_my_kit', { persona: 'astronaut' });
    expect(out.ok).toBe(false);
    expect(out.available).toContain('agency');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/mcp-kits.test.ts`
Expected: FAIL — `Tool explain_pick not found`

- [ ] **Step 3: Add the tools**

Add these imports at the top of `mcp/tools/kits.ts`:

```ts
import { and, desc, eq } from 'drizzle-orm';
import { getDb } from '../../src/lib/db';
import { kitEvidence, kitPicks, userProfiles } from '../../src/lib/db/schema';
import { isKitCell } from '../../src/lib/kits/grid';
```

Then append inside `registerKitTools`, after the `get_kit` registration:

```ts
  server.registerTool(
    'explain_pick',
    {
      description:
        'The evidence behind one kit pick: why it won, what to skip, and the source reports or benchmarks backing it. Radar never asserts a verdict without receipts.',
      inputSchema: {
        category: z.string().describe('kit category, e.g. video, infra, connectors'),
        task: z.string().describe('job within the category, e.g. text-to-video'),
        tier: tierSchema.optional().describe('cost tier; default value'),
      },
      outputSchema: {
        ...envelopeSchema,
        found: z.boolean(),
        reason: z.string().optional(),
        pick: z.string().optional(),
        why: z.string().nullable().optional(),
        skip: z.string().nullable().optional(),
        confidence: z.string().optional(),
        verified_at: z.string().nullable().optional(),
        evidence: z
          .array(
            z.object({
              kind: z.string(),
              source_url: z.string(),
              excerpt: z.string().nullable(),
              sentiment: z.number(),
              observed_at: z.string().nullable(),
            }),
          )
          .optional(),
      },
    },
    async ({ category, task, tier }) => {
      const chosen: KitTier = tier ?? 'value';
      if (!isKitCell(category, task)) {
        return respond(
          { found: false, reason: `"${category}/${task}" is not a cell in the kit grid.` },
          {
            summary: `Unknown cell ${category}/${task}.`,
            economy: withUserEconomy(auth.userId, 'read'),
            next: [{ tool: 'list_kits', arguments: {}, reason: 'personas and their cells' }],
          },
        );
      }
      const db = getDb();
      const row = db
        .select()
        .from(kitPicks)
        .where(
          and(eq(kitPicks.category, category), eq(kitPicks.task, task), eq(kitPicks.tier, chosen)),
        )
        .get();
      if (!row) {
        return respond(
          { found: false, reason: 'not yet covered — no approved pick for this cell' },
          {
            summary: `${category}/${task} (${chosen}) is not yet covered.`,
            economy: withUserEconomy(auth.userId, 'read'),
          },
        );
      }
      const evidence = db
        .select()
        .from(kitEvidence)
        .where(eq(kitEvidence.pickId, row.id))
        .orderBy(desc(kitEvidence.observedAt))
        .limit(20)
        .all();
      return respond(
        {
          found: true,
          pick: row.pickName,
          why: row.why ?? null,
          skip: row.skip ?? null,
          confidence: row.confidence,
          verified_at: iso(row.verifiedAt),
          evidence: evidence.map((e) => ({
            kind: e.kind,
            source_url: e.sourceUrl,
            excerpt: e.excerpt ?? null,
            sentiment: e.sentiment,
            observed_at: iso(e.observedAt),
          })),
        },
        {
          summary: `${row.pickName} for ${category}/${task} (${chosen}) — ${row.confidence} confidence, ${evidence.length} receipts.`,
          economy: withUserEconomy(auth.userId, 'read'),
        },
      );
    },
  );

  server.registerTool(
    'set_my_kit',
    {
      description:
        'Save the caller persona and cost tier so get_my_kit can return their committed setup without being told again.',
      inputSchema: {
        persona: z.string().describe('persona slug — see list_kits'),
        tier: tierSchema.optional(),
      },
      outputSchema: {
        ...envelopeSchema,
        ok: z.boolean(),
        error: z.string().optional(),
        available: z.array(z.string()).optional(),
        persona: z.string().optional(),
        tier: z.string().optional(),
      },
    },
    async ({ persona, tier }) => {
      if (auth.userId == null) {
        return respond(
          { ok: false, error: 'sign in required — connect with an OAuth token that has a user' },
          {
            summary: 'Sign in required to save a kit.',
            economy: withUserEconomy(auth.userId, 'read'),
            next: [{ tool: 'get_server_guide', arguments: {}, reason: 'how to authenticate' }],
          },
        );
      }
      const p = getKitPersona(persona);
      if (!p) {
        return respond(
          { ok: false, error: `Unknown persona "${persona}".`, available: KIT_PERSONA_SLUGS },
          {
            summary: `Unknown persona "${persona}".`,
            economy: withUserEconomy(auth.userId, 'read'),
            next: [{ tool: 'list_kits', arguments: {}, reason: 'available personas' }],
          },
        );
      }
      const chosen: KitTier = tier ?? p.defaultTier;
      const db = getDb();
      const now = new Date();
      db.insert(userProfiles)
        .values({ userId: auth.userId, kitPersona: p.slug, kitTier: chosen, updatedAt: now })
        .onConflictDoUpdate({
          target: userProfiles.userId,
          set: { kitPersona: p.slug, kitTier: chosen, updatedAt: now },
        })
        .run();
      return respond(
        { ok: true, persona: p.slug, tier: chosen },
        {
          summary: `Saved kit: ${p.label} (${chosen}).`,
          economy: withUserEconomy(auth.userId, 'read'),
          next: [{ tool: 'get_my_kit', arguments: {}, reason: 'read your committed setup' }],
        },
      );
    },
  );

  server.registerTool(
    'get_my_kit',
    {
      description:
        "The caller's own saved kit — the tool decisions they have already committed to. Read this before proposing a stack so you build on their choices instead of re-litigating them.",
      inputSchema: {},
      outputSchema: kitOutput,
    },
    async () => {
      if (auth.userId == null) {
        return respond(
          { found: false, available: KIT_PERSONA_SLUGS },
          {
            summary: 'Sign in required to read a saved kit.',
            economy: withUserEconomy(auth.userId, 'read'),
            next: [{ tool: 'get_kit', arguments: { persona: 'indie-dev' }, reason: 'browse a kit anonymously' }],
          },
        );
      }
      const db = getDb();
      const profile = db
        .select()
        .from(userProfiles)
        .where(eq(userProfiles.userId, auth.userId))
        .get();
      const p = profile?.kitPersona ? getKitPersona(profile.kitPersona) : null;
      if (!p) {
        return respond(
          { found: false, available: KIT_PERSONA_SLUGS },
          {
            summary: 'No saved kit yet — call set_my_kit.',
            economy: withUserEconomy(auth.userId, 'read'),
            next: [{ tool: 'set_my_kit', arguments: { persona: 'indie-dev' }, reason: 'save your persona' }],
          },
        );
      }
      const kit = loadKit(p, (profile?.kitTier as KitTier | null) ?? p.defaultTier);
      return respond(kitPayload(kit), {
        summary: kitSummary(kit),
        economy: withUserEconomy(auth.userId, 'read'),
      });
    },
  );
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/mcp-kits.test.ts`
Expected: PASS — 11 tests

- [ ] **Step 5: Commit**

```bash
git add mcp/tools/kits.ts tests/mcp-kits.test.ts
git commit -m "feat(mcp): explain_pick, set_my_kit, get_my_kit"
```

---

### Task 9: Migrate board_entries into kit_picks

**Files:**
- Create: `scripts/migrate-board-to-kits.ts`
- Test: `tests/kits-migrate.test.ts`

On this instance all 17 `board_entries` rows have NULL picks, so the migration is a no-op here. Self-hosted instances may have filled them, so it must still be correct.

**Task rename:** `board_entries` stores the video avatar task as `avatar/talking-head`; the kit grid uses `avatar` (a slash breaks URL routing). The migration maps it.

- [ ] **Step 1: Write the failing test**

```ts
// tests/kits-migrate.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useTestDb } from './helpers/db';
import type { Db } from '@/lib/db';
import { boardEntries, kitPicks } from '@/lib/db/schema';
import { migrateBoardToKits } from '@/lib/kits/migrate-board';

describe('board_entries -> kit_picks', () => {
  let db: Db;
  beforeEach(() => {
    db = useTestDb();
  });

  it('creates one pick per non-null tier', () => {
    db.insert(boardEntries)
      .values({
        domain: 'coding',
        task: 'agentic-coding',
        bestOverall: 'Alpha',
        bestValue: 'Beta',
        cheapestViable: null,
        costNote: 'a note',
        updatedAt: new Date('2026-08-01T00:00:00Z'),
      })
      .run();

    const n = migrateBoardToKits();

    expect(n).toBe(2);
    const rows = db.select().from(kitPicks).all();
    expect(rows.map((r) => `${r.tier}:${r.pickName}`).sort()).toEqual(['best:Alpha', 'value:Beta']);
    expect(rows.every((r) => r.priceNote === 'a note')).toBe(true);
    expect(rows.every((r) => r.confidence === 'low')).toBe(true);
  });

  it('renames avatar/talking-head to avatar', () => {
    db.insert(boardEntries)
      .values({
        domain: 'video',
        task: 'avatar/talking-head',
        bestOverall: 'Alpha',
        updatedAt: new Date('2026-08-01T00:00:00Z'),
      })
      .run();
    migrateBoardToKits();
    expect(db.select().from(kitPicks).all()[0].task).toBe('avatar');
  });

  it('skips rows whose cell is not in the grid', () => {
    db.insert(boardEntries)
      .values({ domain: 'coding', task: 'not-a-real-task', bestOverall: 'Alpha', updatedAt: new Date() })
      .run();
    expect(migrateBoardToKits()).toBe(0);
  });

  it('is idempotent', () => {
    db.insert(boardEntries)
      .values({ domain: 'coding', task: 'autocomplete', bestOverall: 'Alpha', updatedAt: new Date() })
      .run();
    migrateBoardToKits();
    migrateBoardToKits();
    expect(db.select().from(kitPicks).all()).toHaveLength(1);
  });

  it('does nothing when every board pick is null', () => {
    db.insert(boardEntries)
      .values({ domain: 'copy', task: 'social', updatedAt: new Date() })
      .run();
    expect(migrateBoardToKits()).toBe(0);
    expect(db.select().from(kitPicks).all()).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/kits-migrate.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/kits/migrate-board"`

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/kits/migrate-board.ts
/**
 * One-shot backfill: board_entries -> kit_picks.
 *
 * board_entries flattened three tiers into columns with a single shared
 * cost_note and no evidence, so everything it carries lands at low confidence
 * with no verifiedAt — it has never been evidence-graded. Idempotent: an
 * existing cell+tier row is left alone.
 */
import { getDb } from '../db';
import { boardEntries, kitPicks } from '../db/schema';
import { isKitCell, type KitTier } from './grid';

/** board_entries task names that differ from the kit grid. */
const TASK_RENAMES: Record<string, string> = {
  'avatar/talking-head': 'avatar',
};

const TIER_COLUMNS: Array<{ tier: KitTier; column: 'bestOverall' | 'bestValue' | 'cheapestViable' }> = [
  { tier: 'best', column: 'bestOverall' },
  { tier: 'value', column: 'bestValue' },
  { tier: 'cheapest', column: 'cheapestViable' },
];

/** Returns the number of kit_picks rows created. */
export function migrateBoardToKits(): number {
  const db = getDb();
  const entries = db.select().from(boardEntries).all();
  const existing = new Set(
    db
      .select()
      .from(kitPicks)
      .all()
      .map((r) => `${r.category}/${r.task}/${r.tier}`),
  );

  let created = 0;
  for (const entry of entries) {
    const category = entry.domain;
    const task = TASK_RENAMES[entry.task] ?? entry.task;
    if (!isKitCell(category, task)) continue;

    for (const { tier, column } of TIER_COLUMNS) {
      const pickName = entry[column];
      if (!pickName) continue;
      const key = `${category}/${task}/${tier}`;
      if (existing.has(key)) continue;

      db.insert(kitPicks)
        .values({
          category,
          task,
          tier,
          pickName,
          priceModel: 'seat',
          priceNote: entry.costNote ?? null,
          why: entry.runelabsVerdict ?? null,
          confidence: 'low',
          evidenceCount: 0,
          distinctSources: 0,
          verifiedAt: null,
          updatedAt: entry.updatedAt ?? new Date(),
        })
        .run();
      existing.add(key);
      created += 1;
    }
  }
  return created;
}
```

```ts
// scripts/migrate-board-to-kits.ts
/**
 * Backfill kit_picks from board_entries. Safe to re-run.
 *
 * Usage: npx tsx scripts/migrate-board-to-kits.ts
 */
import { loadDotEnv } from '../src/lib/env';
import { migrateBoardToKits } from '../src/lib/kits/migrate-board';

loadDotEnv();

const created = migrateBoardToKits();
console.log(`kit_picks created from board_entries: ${created}`);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/kits-migrate.test.ts`
Expected: PASS — 5 tests

- [ ] **Step 5: Run the script against the real database**

```bash
npx tsx scripts/migrate-board-to-kits.ts
```

Expected output on this instance: `kit_picks created from board_entries: 0` — every board pick is NULL. That is correct, not a failure.

- [ ] **Step 6: Commit**

```bash
git add src/lib/kits/migrate-board.ts scripts/migrate-board-to-kits.ts tests/kits-migrate.test.ts
git commit -m "feat(kits): idempotent board_entries to kit_picks backfill"
```

---

### Task 10: Repoint the board page at kit_picks

**Files:**
- Modify: `src/app/app/decide/tools/page.tsx`

The board page currently reads `boardEntries` and renders three columns per row. Keep the visual table; change the data source so there is one board, not two.

- [ ] **Step 1: Add a board view helper**

Create `src/lib/kits/board-view.ts`:

```ts
/**
 * Board-shaped view over kit_picks — the three tiers of one cell folded back
 * into a single row, so the existing /decide/tools table renders unchanged
 * while kit_picks stays the single source of truth.
 */
import { inArray } from 'drizzle-orm';
import { getDb } from '../db';
import { kitPicks } from '../db/schema';
import { DOMAINS } from '../domains';

export interface BoardRow {
  domain: string;
  task: string;
  bestOverall: string | null;
  bestValue: string | null;
  cheapestViable: string | null;
  costNote: string | null;
  verdict: string | null;
  updatedAt: Date | null;
}

/** Only the six story domains appear on the board; audio/infra/connectors live on /decide/kits. */
export function boardRows(): BoardRow[] {
  const db = getDb();
  const rows = db
    .select()
    .from(kitPicks)
    .where(inArray(kitPicks.category, [...DOMAINS]))
    .all();

  const byCell = new Map<string, BoardRow>();
  for (const r of rows) {
    const key = `${r.category}/${r.task}`;
    let row = byCell.get(key);
    if (!row) {
      row = {
        domain: r.category,
        task: r.task,
        bestOverall: null,
        bestValue: null,
        cheapestViable: null,
        costNote: null,
        verdict: null,
        updatedAt: null,
      };
      byCell.set(key, row);
    }
    if (r.tier === 'best') row.bestOverall = r.pickName;
    if (r.tier === 'value') row.bestValue = r.pickName;
    if (r.tier === 'cheapest') row.cheapestViable = r.pickName;
    row.costNote = row.costNote ?? r.priceNote ?? null;
    row.verdict = row.verdict ?? r.why ?? null;
    if (r.updatedAt && (!row.updatedAt || r.updatedAt > row.updatedAt)) row.updatedAt = r.updatedAt;
  }
  return [...byCell.values()].sort(
    (a, b) => a.domain.localeCompare(b.domain) || a.task.localeCompare(b.task),
  );
}
```

- [ ] **Step 2: Write the failing test**

```ts
// tests/kits-board-view.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useTestDb } from './helpers/db';
import { kitPicks } from '@/lib/db/schema';
import { boardRows } from '@/lib/kits/board-view';

describe('board view over kit_picks', () => {
  beforeEach(() => {
    const db = useTestDb();
    db.insert(kitPicks)
      .values([
        { category: 'coding', task: 'autocomplete', tier: 'best', pickName: 'Alpha', updatedAt: new Date('2026-08-02') },
        { category: 'coding', task: 'autocomplete', tier: 'value', pickName: 'Beta', updatedAt: new Date('2026-08-05') },
        { category: 'infra', task: 'hosting', tier: 'best', pickName: 'Gamma', updatedAt: new Date('2026-08-05') },
      ])
      .run();
  });

  it('folds tiers into one row per cell', () => {
    const rows = boardRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].bestOverall).toBe('Alpha');
    expect(rows[0].bestValue).toBe('Beta');
    expect(rows[0].cheapestViable).toBeNull();
    expect(rows[0].updatedAt).toEqual(new Date('2026-08-05'));
  });

  it('omits categories outside the six story domains', () => {
    expect(boardRows().some((r) => r.domain === 'infra')).toBe(false);
  });
});
```

- [ ] **Step 3: Run test to verify it fails, then passes**

Run: `npx vitest run tests/kits-board-view.test.ts`
Expected first: FAIL — `Failed to resolve import "@/lib/kits/board-view"`. After Step 1's file is saved: PASS — 2 tests.

- [ ] **Step 4: Swap the page's data source**

First locate the query and the verdict references:

```bash
grep -n "boardEntries\|runelabsVerdict" src/app/app/decide/tools/page.tsx
```

Then make these four edits in `src/app/app/decide/tools/page.tsx`.

**(a)** The schema import (line 24) — drop `boardEntries`, keep `boardHistory`:

```ts
// before
import { boardEntries, boardHistory } from '@/lib/db/schema';
// after
import { boardHistory } from '@/lib/db/schema';
import { boardRows, type BoardRow } from '@/lib/kits/board-view';
```

**(b)** The row type alias (line 27):

```ts
// before
type BoardEntry = typeof boardEntries.$inferSelect;
// after
type BoardEntry = BoardRow;
```

**(c)** The board query surfaced by the grep — a `db.select().from(boardEntries)…all()` call. Replace the whole expression with:

```ts
const entries = boardRows();
```

Keep the surrounding variable name so downstream JSX is untouched. The `boardHistory` query on the same page stays exactly as it is.

**(d)** Every `runelabsVerdict` hit from the grep becomes `verdict`:

```ts
// before
entry.runelabsVerdict
// after
entry.verdict
```

Nothing else changes. `costLines()`, `cell()`, `fmtDate()` and the table markup all keep working because `BoardRow` deliberately reuses the `boardEntries` field names (`domain`, `task`, `bestOverall`, `bestValue`, `cheapestViable`, `costNote`, `updatedAt`).

- [ ] **Step 5: Verify the build**

Run: `npx tsc --noEmit`
Expected: no errors. If `boardEntries` is still referenced anywhere in the file, TypeScript names the line.

Run: `npm test`
Expected: PASS — including `tests/board-apply.test.ts`, which still exercises `boardEntries` directly and must keep passing (the table is retained; only the page stops reading it).

- [ ] **Step 6: Commit**

```bash
git add src/lib/kits/board-view.ts tests/kits-board-view.test.ts src/app/app/decide/tools/page.tsx
git commit -m "refactor(board): render Best Right Now from kit_picks"
```

---

### Task 11: Web pages — /decide/kits and /decide/kits/[persona]

**Files:**
- Create: `src/app/app/decide/kits/page.tsx`
- Create: `src/app/app/decide/kits/[persona]/page.tsx`

Server components reading `loadKit()` directly. Auth uses `requireViewer()`, matching `decide/tools/page.tsx`.

- [ ] **Step 1: Write the roster page**

```tsx
// src/app/app/decide/kits/page.tsx
import Link from 'next/link';
import { requireViewer } from '@/lib/auth/user';
import { KIT_PERSONAS } from '@/lib/kits/personas';

export const metadata = {
  title: 'Kits — what to actually run',
  description:
    'A costed tool kit per role: one pick per job, a monthly total, and the cells not yet covered.',
};

export default async function KitsPage() {
  await requireViewer();
  return (
    <main className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="text-2xl font-semibold">Kits</h1>
      <p className="mt-2 text-ink-4">
        Pick the role that fits. Each kit is one pick per job at a cost tier, with a monthly total
        and honest gaps where nothing is verified yet.
      </p>
      <ul className="mt-6 grid gap-3 sm:grid-cols-2">
        {KIT_PERSONAS.map((p) => (
          <li key={p.slug} className="rounded-lg border border-line p-4">
            <Link href={`/app/decide/kits/${p.slug}`} className="font-medium hover:underline">
              {p.label}
            </Link>
            <p className="mt-1 text-sm text-ink-4">{p.blurb}</p>
            <p className="mt-2 text-xs text-ink-4">
              {p.routes.length} jobs · default {p.defaultTier}
            </p>
          </li>
        ))}
      </ul>
    </main>
  );
}
```

- [ ] **Step 2: Write the kit page**

```tsx
// src/app/app/decide/kits/[persona]/page.tsx
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireViewer } from '@/lib/auth/user';
import { isKitTier, KIT_TIERS, type KitTier } from '@/lib/kits/grid';
import { getKitPersona } from '@/lib/kits/personas';
import { loadKit } from '@/lib/kits/repo';

export default async function KitPage({
  params,
  searchParams,
}: {
  params: Promise<{ persona: string }>;
  searchParams: Promise<{ tier?: string }>;
}) {
  await requireViewer();
  const { persona: slug } = await params;
  const { tier: rawTier } = await searchParams;

  const persona = getKitPersona(slug);
  if (!persona) notFound();

  const tier: KitTier = rawTier && isKitTier(rawTier) ? rawTier : persona.defaultTier;
  const kit = loadKit(persona, tier);

  return (
    <main className="mx-auto max-w-4xl px-4 py-8">
      <Link href="/app/decide/kits" className="text-sm text-ink-4 hover:underline">
        ← All kits
      </Link>
      <h1 className="mt-2 text-2xl font-semibold">{kit.label}</h1>
      <p className="mt-1 text-ink-4">{persona.blurb}</p>

      <div className="mt-4 flex items-baseline gap-4">
        <span className="text-3xl font-semibold">${kit.totalUsdMonth}</span>
        <span className="text-ink-4">
          /mo · {kit.coveredCount} of {kit.totalCount} covered
        </span>
      </div>

      <nav className="mt-4 flex gap-2 text-sm">
        {KIT_TIERS.map((t) => (
          <Link
            key={t}
            href={`/app/decide/kits/${persona.slug}?tier=${t}`}
            className={`rounded border border-line px-2 py-1 ${t === tier ? 'font-medium' : 'text-ink-4'}`}
          >
            {t}
          </Link>
        ))}
      </nav>

      <table className="mt-6 w-full text-sm">
        <thead className="text-left text-ink-4">
          <tr>
            <th className="py-2">Job</th>
            <th>Pick</th>
            <th>Price</th>
            <th>Confidence</th>
          </tr>
        </thead>
        <tbody>
          {kit.lines.map((l) => (
            <tr key={`${l.category}/${l.task}`} className="border-t border-line">
              <td className="py-2">
                {l.category}/{l.task}
              </td>
              <td>{l.pick ? l.pick.pickName : <span className="text-ink-4">not yet covered</span>}</td>
              <td>
                {!l.pick
                  ? '—'
                  : l.pick.priceModel === 'usage'
                    ? 'usage-priced'
                    : l.pick.priceModel === 'free'
                      ? 'free'
                      : `$${l.pick.priceUsdMonth ?? 0}`}
              </td>
              <td className="text-ink-4">{l.pick ? l.pick.confidence : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {kit.usageRisk.length > 0 && (
        <section className="mt-6 rounded-lg border border-line p-4">
          <h2 className="font-medium">Usage-priced — excluded from the total</h2>
          <ul className="mt-2 space-y-1 text-sm text-ink-4">
            {kit.usageRisk.map((p) => (
              <li key={`${p.category}/${p.task}`}>
                {p.pickName} ({p.category}/{p.task}) — {p.riskFlag ?? 'metered; set a spend cap'}
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
```

- [ ] **Step 3: Verify types and build**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm run build`
Expected: build succeeds; `/app/decide/kits` and `/app/decide/kits/[persona]` appear in the route list.

- [ ] **Step 4: Check it by eye**

```bash
npm run dev
```

Visit `http://localhost:3000/app/decide/kits/ugc-creator`. Expected: `$0/mo · 0 of 6 covered`, six rows all reading "not yet covered". That is the correct end state for this plan — the grid is empty until the feeder plans land.

- [ ] **Step 5: Commit**

```bash
git add src/app/app/decide/kits/
git commit -m "feat(kits): roster and costed-kit pages"
```

---

## Final verification

- [ ] Run the full suite: `npm test` — expected PASS, no regressions
- [ ] Run the type check: `npx tsc --noEmit` — expected no errors
- [ ] Run the production build: `npm run build` — expected success
- [ ] Drive the MCP server end to end:

```bash
npm run mcp
```

Then from another shell, confirm `list_kits` returns 11 personas and `get_kit` on `ugc-creator` returns `total_usd_month: 0` with six gaps.

- [ ] Update `README.md` — add `list_kits`, `get_kit`, `get_my_kit`, `set_my_kit`, `explain_pick` to the MCP tool list in the "Connect your agent" section.

```bash
git add README.md
git commit -m "docs: document the kit MCP tools"
```

## Follow-on plans

Write these as separate plans once this one is merged. Each needs its own spec section review.

| Plan | Spec phase | Scope |
|---|---|---|
| **Feeders — measurable** | 3 | Extend `src/lib/board/sync.ts` to write `kit_picks` + `kit_evidence` (kind `benchmark`/`price`) for `coding` and `agentic`; structured price scraper filling `priceModel`/`priceUsdMonth`/`riskFlag` on every cell. Wire `gradeConfidence()` into the write path. |
| **Feeders — reports** | 4 | New sources (Brave queries for audio/infra/MCP, dev-infra subreddits, vendor changelog + pricing feeds); extend extraction to emit pick-attributed evidence; LLM drafts `board_proposals` from `kit_evidence` only. |
| **History surface** | 6 | Write `kit_pick_history` on every approved change; `whats_changed` MCP tool; "changed since your last visit" on the kit page using `users.prevSeenAt`. |
