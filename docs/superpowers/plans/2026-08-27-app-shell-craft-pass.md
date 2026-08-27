# /app Shell Craft Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the craft gaps the `/critique` pass found across the authenticated `/app` shell — one page-header treatment instead of two, numeric table columns that actually line up, no nested landmarks, and the Agents tables readable on a phone.

**Architecture:** Three defect classes, each fixed once and then locked by a guard test. `tests/app-chrome.test.ts` walks every `src/app/app/**/page.tsx` and asserts the invariants, so the next page someone adds cannot silently reintroduce the drift. All changes are markup and CSS class changes in `src/app/**` and `src/components/**` — no data, schema, or job code is touched.

**Tech Stack:** TypeScript, Next.js 15 (App Router, RSC), Tailwind v4 (`@theme` tokens in `src/app/globals.css`), vitest. Tests in this repo assert against page **source text** (`readFileSync` + `toContain`) — see `tests/connect-copy.test.ts` for the house pattern. There is no DOM-rendering test harness; do not add one for this work.

---

## ⚠️ Concurrency warning — read before starting

Another session is executing `docs/superpowers/plans/2026-08-27-source-hardening-verdict-accuracy.md` on this same branch (`feat/source-hardening-verdict-accuracy`). It owns `src/lib/**`, `worker/**`, and **`src/app/(site)/trust/page.tsx`** (its Task 9 publishes verdict numbers there).

- Tasks 1–4, 6, 7 below touch none of those files. Safe to run now.
- **Task 5 touches `trust/page.tsx`.** Do it last, and only after `git log --oneline | grep verdict-accuracy` shows that work has landed. If it has not landed, skip Task 5 and leave its checkbox unticked.

---

## Existing context the implementer must read first

- `src/components/PageHeader.tsx` — the shared header component. Its docstring already claims "Every hub page uses this"; nine pages disagree. This plan makes the claim true.
- `src/app/globals.css:566-600` — the `.table` rules. **The critical fact:** `.table th { text-align: left }` has specificity (0,1,1) and out-specifies the Tailwind `.text-right` utility (0,1,0). A `<th className="text-right">` therefore does **nothing**, while `text-right` on a `<td>` works (there is no competing `.table td` text-align rule). This is why 22 numeric headers across the app sit left of their own right-aligned figures.
- `src/app/globals.css:595-640` — `.table-cards`, the responsive strategy: below 640px each `<tr>` becomes a card and each `<td>` grows a label from its `data-label` attribute. A `<td>` with no `data-label` renders a blank label gutter, so **every** `td` in a `table-cards` table needs one.
- `src/app/app/decide/tools/page.tsx:173-200` — the reference implementation of `table table-cards` with `data-label` on every cell. Copy this idiom.
- `src/app/app/decide/kits/[persona]/page.tsx` — already converted in the critique pass; second reference.

## Conventions to follow

- Spacing values are multiples of 4 (Tailwind `1` = 4px). `mt-1.5` (6px) and `mt-2.5` (10px) are the sanctioned half-steps already in use; do not introduce new ones.
- Colour comes from `@theme` tokens only (`ink`, `ink-2..4`, `grat*`, `phosphor`, `amber`, `alert`, `scope-*`). Never invent a token name — `border-line` was used on two pages for weeks and rendered as *no border at all*, because Tailwind silently emits nothing for an undefined token.
- Run `npm test` before every commit. Run `npx tsc --noEmit` after any component signature change.
- The full suite takes ~21s. Run a single file with `npx vitest run tests/<name>.test.ts`.

---

## File Structure

| File | Responsibility |
|---|---|
| `tests/app-chrome.test.ts` (create) | The guard: walks every app page and asserts the three shell invariants |
| `src/components/PageHeader.tsx` (modify) | Gains a `tone` prop; becomes the single header treatment |
| `src/app/app/build/batches/page.tsx` (modify) | Migrate inline header → `PageHeader` |
| `src/app/app/build/debates/page.tsx` (modify) | Migrate inline header → `PageHeader` |
| `src/app/app/build/opportunities/page.tsx` (modify) | Migrate inline header → `PageHeader` |
| `src/app/app/decide/metrics/page.tsx` (modify) | Migrate inline header → `PageHeader` |
| `src/app/app/decide/tools/page.tsx` (modify) | Migrate inline header → `PageHeader` |
| `src/app/app/decide/stacks/page.tsx` (modify) | Migrate inline header → `PageHeader` |
| `src/app/app/account/page.tsx` (modify) | Migrate inline header → `PageHeader` |
| `src/app/app/decide/agents/page.tsx` (modify) | Hoist one page header above the tabs; `.num` headers; `table-cards` |
| `src/app/app/admin/usage/page.tsx` (modify) | `.num` headers (15) |
| `src/app/(site)/trust/page.tsx` (modify, **gated**) | `.num` headers (3) |
| `src/app/app/connect/page.tsx` (modify) | Remove the nested `<main>` landmark |

---

## The header rule this plan establishes

Two treatments exist today and they disagree on four measurements. Twelve pages already use `PageHeader` (`/app`, brief, map, search, connect, decide, build, kits, admin, and the domain/entity detail routes); eight hold out with the inline version:

| | Inline (8 pages) | `PageHeader` (12 pages) |
|---|---|---|
| kicker | `readout text-phosphor` | `readout` (ink-4) |
| description top margin | `mt-2` | `mt-1.5` |
| description width | `max-w-xl` (576px) | `max-w-[640px]` |
| description size | `text-[13.5px]` | `text-[13px]` |

**Settled:** `PageHeader`'s measurements win, and the phosphor kicker becomes meaningful rather than default — it marks a **workspace overview** (`/app/decide`, `/app/build`), and a neutral kicker marks a **leaf page**. That keeps phosphor obeying the system's own stated rule in `globals.css:5` ("Color means signal — never decoration") while preserving the hub/leaf distinction a reader actually uses.

---

# Phase 1 — One page header

> **Execution log:** Tasks 1–4, 6, 7 landed 2026-08-27 via subagent-driven-development, commits `0276f32`, `899a808`, `fd6771f`, `e1bd89b`, `4e0b2e5`, `8384acc`. Task 5 remains gated — see its section below.

## Task 1: The guard test and the `tone` prop

**Files:**
- Create: `tests/app-chrome.test.ts`
- Modify: `src/components/PageHeader.tsx`

- [ ] **Step 1: Write the failing guard test**

Create `tests/app-chrome.test.ts`:

```ts
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const APP_DIR = fileURLToPath(new URL('../src/app/app/', import.meta.url));
const SRC_DIR = fileURLToPath(new URL('../src/', import.meta.url));

/** Every `page.tsx` under the authenticated app shell. */
function pageFiles(dir: string = APP_DIR): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return pageFiles(full);
    return entry.name === 'page.tsx' ? [full] : [];
  });
}

/** Every `.tsx` under src/, for rules that also cover the marketing shell. */
function tsxFiles(dir: string = SRC_DIR): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return tsxFiles(full);
    return entry.name.endsWith('.tsx') ? [full] : [];
  });
}

const rel = (p: string) => p.slice(SRC_DIR.length).replace(/\\/g, '/');

/**
 * The inline header trio: a readout div immediately followed by the page h1.
 * Deliberately narrow — a standalone `readout` label inside a card is fine.
 */
const INLINE_HEADER = /<div className="readout[^"]*">[\s\S]{0,160}?<\/div>\s*<h1 className="type-h1/;

/**
 * Detail routes (`[persona]`, `[slug]`, `[id]`) are exempt: their headers carry
 * back links, badges and dynamic titles, so they compose from the same
 * primitives rather than from the fixed PageHeader shape. The rule is for the
 * hub and leaf pages a first-time visitor lands on.
 */
const hubAndLeafPages = () => pageFiles().filter((p) => !p.includes('['));

describe('app shell chrome', () => {
  it('states page identity through PageHeader, not a hand-rolled trio', () => {
    const offenders = hubAndLeafPages()
      .filter((p) => INLINE_HEADER.test(readFileSync(p, 'utf8')))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it('right-aligns numeric table headers with .num, which .table th cannot override', () => {
    // `.table th { text-align: left }` (0,1,1) beats the `.text-right` utility
    // (0,1,0), so a `<th className="text-right">` is a silent no-op.
    const offenders = tsxFiles()
      .filter((p) => /<th className="[^"]*text-right/.test(readFileSync(p, 'utf8')))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it('nests no second <main> inside the shell layout', () => {
    const offenders = pageFiles()
      .filter((p) => readFileSync(p, 'utf8').includes('<main'))
      .map(rel);
    expect(offenders).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and confirm all three fail with the expected offender lists**

Run: `npx vitest run tests/app-chrome.test.ts`

Expected: 3 failed. These offender arrays are the verified output as of 2026-08-27:

- header trio (8): `app/app/account/page.tsx`, `app/app/build/batches/page.tsx`, `app/app/build/debates/page.tsx`, `app/app/build/opportunities/page.tsx`, `app/app/decide/agents/page.tsx`, `app/app/decide/metrics/page.tsx`, `app/app/decide/stacks/page.tsx`, `app/app/decide/tools/page.tsx`
- numeric headers (3): `app/(site)/trust/page.tsx`, `app/app/admin/usage/page.tsx`, `app/app/decide/agents/page.tsx`
- nested main (1): `app/app/connect/page.tsx`

If the lists differ, stop and reconcile — someone has changed these files since the plan was written.

- [ ] **Step 3: Add the `tone` prop to PageHeader**

Replace the whole of `src/components/PageHeader.tsx` with:

```tsx
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Shared page header: kicker readout (the flavor line) + h1 + one-line
 * plain-English description. Every page under /app uses this so a first-time
 * visitor always gets "what is this page" in the same spot, at the same size.
 *
 * `tone="phosphor"` marks a workspace OVERVIEW (/app/decide, /app/build). Leaf
 * pages take the neutral kicker, so the phosphor keeps meaning "you are at the
 * top of a workspace" instead of meaning nothing at all.
 */
export default function PageHeader({
  kicker,
  title,
  description,
  tone,
}: {
  kicker?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  tone?: 'phosphor';
}) {
  return (
    <div>
      {kicker && (
        <div className={cn('readout', tone === 'phosphor' && 'text-phosphor')}>{kicker}</div>
      )}
      <h1 className="type-h1 mt-1">{title}</h1>
      {description && (
        <p className="mt-1.5 max-w-[640px] text-[13px] leading-relaxed text-ink-3">{description}</p>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no output (exit 0). `tone` is optional, so no existing call site breaks.

- [ ] **Step 5: Commit**

```bash
git add tests/app-chrome.test.ts src/components/PageHeader.tsx
git commit -m "test(app): guard the shell's header, table and landmark invariants"
```

---

## Task 2: Migrate the seven leaf pages

**Files:**
- Modify: `src/app/app/build/batches/page.tsx:25-29`
- Modify: `src/app/app/build/debates/page.tsx:29-32`
- Modify: `src/app/app/build/opportunities/page.tsx:32-39`
- Modify: `src/app/app/decide/metrics/page.tsx:179-183`
- Modify: `src/app/app/decide/tools/page.tsx:132-138`
- Modify: `src/app/app/decide/stacks/page.tsx:73-79`
- Modify: `src/app/app/account/page.tsx:28-30`
- Test: `tests/app-chrome.test.ts` (already written)

Each page keeps its exact copy — only the markup changes. Add `import PageHeader from '@/components/PageHeader';` to each file if it is not already imported.

- [ ] **Step 1: batches**

Replace:

```tsx
      <div className="readout text-phosphor">Build · Batches</div>
      <h1 className="type-h1 mt-1">Batches</h1>
      <p className="mt-2 max-w-xl text-[13.5px] text-ink-3">
        Collect opportunities and ideas into a working set, or browse the weekly Radar Batch drop. Bulk debate and
        plan runs are a Builder feature.
      </p>
```

with:

```tsx
      <PageHeader
        kicker="Build · Batches"
        title="Batches"
        description="Collect opportunities and ideas into a working set, or browse the weekly Radar Batch drop. Bulk debate and plan runs are a Builder feature."
      />
```

- [ ] **Step 2: debates**

Replace:

```tsx
      <div className="readout text-phosphor">Build · Debates</div>
      <h1 className="type-h1 mt-1">Debates</h1>
      <p className="mt-2 max-w-xl text-[13.5px] text-ink-3">
        Advocate → Skeptic → Market Realist → Judge. Pressure-test ideas before you commit a plan.
      </p>
```

with:

```tsx
      <PageHeader
        kicker="Build · Debates"
        title="Debates"
        description="Advocate → Skeptic → Market Realist → Judge. Pressure-test ideas before you commit a plan."
      />
```

- [ ] **Step 3: opportunities**

This description contains markup, so it stays a fragment rather than a string:

```tsx
      <PageHeader
        kicker="Build · Opportunities"
        title="Opportunities"
        description={
          <>
            Business gaps the scanner found in the news: real user pain, AI that just made the fix cheap, and nobody
            good shipping it yet. Each opening is scored two ways — <span className="mono text-[11px]">flip</span> favors
            building fast and selling into the window, <span className="mono text-[11px]">hold</span> favors keeping it for
            monthly revenue. Open a card for the full dossier: costs, risks, evidence, launch brief.
          </>
        }
      />
```

- [ ] **Step 4: metrics**

```tsx
      <PageHeader
        kicker="Decide · Pulse"
        title="Pulse"
        description="What’s moving in the builder market — launch heat, rising adoption, plan prices. Explore any series below."
      />
```

- [ ] **Step 5: tools**

```tsx
      <PageHeader
        kicker="Decide · Best tools"
        title="Best Right Now"
        description={
          <>
            For every job: what to use if quality matters most, what to use if you are paying for it yourself, and the
            cheapest thing that still works. With the reasoning, what to skip, and roughly what it costs. Where we
            don&rsquo;t have evidence we trust, the cell stays blank and says so.
          </>
        }
      />
```

- [ ] **Step 6: stacks**

```tsx
      <PageHeader
        kicker="Decide · Stacks"
        title="Stacks"
        description="Skip the week of deciding what to build it on. For each kind of product: the stack that gets you to a working MVP fastest, stays cheap to run, and that a model can actually write — because it has seen enough of it. Which editor and coding agent to use is a different question, answered on Agent stacks."
      />
```

- [ ] **Step 7: account**

The account description is the email, which sits tighter than a prose line. Keep it as the `description` slot so the shape stays uniform:

```tsx
      <PageHeader
        kicker="Account"
        title={user.name}
        description={user.email ?? 'Legacy operator account'}
      />
```

- [ ] **Step 8: Run the guard**

Run: `npx vitest run tests/app-chrome.test.ts -t 'states page identity'`
Expected: still FAILS, with exactly one offender left: `app/app/decide/agents/page.tsx` (Task 3 handles it).

- [ ] **Step 9: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/app/app/build src/app/app/decide/metrics src/app/app/decide/tools src/app/app/decide/stacks src/app/app/account
git commit -m "refactor(app): one page-header treatment across the leaf pages"
```

---

## Task 3: Give the Agents page a stable title

**Files:**
- Modify: `src/app/app/decide/agents/page.tsx:38-59` and `:255-262`
- Test: `tests/app-chrome.test.ts`

`agents/page.tsx` renders an `<h1>` **inside each tab panel** — one at line 41 ("Agent stacks"), another at line 258 ("Coding-agent plans"). Radix unmounts the inactive panel, so the page's own title changes when you click a tab, while `metadata.title` says one thing regardless. The header belongs above the tabs; the per-tab prose belongs to the tab.

- [ ] **Step 1: Add the page header above the tabs**

In the component's returned JSX, immediately before `<AgentsTabs`, insert:

```tsx
      <PageHeader
        kicker="Decide · Agents"
        title="Agents"
        description="What people who code all day are actually running, what it costs them in practice, and which subscription plan stops hurting first. Two views: the stacks people run, and the plans they run them on."
      />
```

Add `import PageHeader from '@/components/PageHeader';` to the imports.

- [ ] **Step 2: Demote the stacks-tab header to a section**

In the `stacks` fragment, replace:

```tsx
      <div className="readout text-phosphor">Decide · Agents · Stacks</div>
      <h1 className="type-h1 mt-1">Agent stacks</h1>
      <p className="mt-2 max-w-xl text-[13.5px] leading-relaxed text-ink-3">
```

with:

```tsx
      <h2 className="type-h2">Agent stacks</h2>
      <p className="mt-1.5 max-w-[640px] text-[13px] leading-relaxed text-ink-3">
```

- [ ] **Step 3: Demote the plans-tab header to a section**

In the `plans` fragment, replace:

```tsx
      <div className="readout text-phosphor">Decide · Agents · Plans</div>
      <h1 className="type-h1 mt-1">Coding-agent plans</h1>
```

with:

```tsx
      <h2 className="type-h2">Coding-agent plans</h2>
```

- [ ] **Step 4: Run the guard**

Run: `npx vitest run tests/app-chrome.test.ts -t 'states page identity'`
Expected: PASS (offender list now empty).

- [ ] **Step 5: Commit**

```bash
npx tsc --noEmit
git add src/app/app/decide/agents/page.tsx
git commit -m "fix(agents): one page title above the tabs, not one per tab panel"
```

---

# Phase 2 — Numeric columns that line up

## Task 4: `.num` on the app's numeric headers

**Files:**
- Modify: `src/app/app/decide/agents/page.tsx:68,120,121,276`
- Modify: `src/app/app/admin/usage/page.tsx:126-130,173-177,207-211`
- Test: `tests/app-chrome.test.ts`

The `.num` class already exists in `src/app/globals.css` (added during the critique pass):

```css
/* Numeric columns hang off the right edge so monospace figures line up. */
.table th.num,
.table td.num {
  text-align: right;
}
```

- [ ] **Step 1: Swap the agents headers**

Four one-line edits in `src/app/app/decide/agents/page.tsx`:

```tsx
<th className="num">Typical $</th>
<th className="num">Loved %</th>
<th className="num">7d mentions</th>
<th className="num">$/mo</th>
```

The matching `<td>`s already carry `text-right`, which works on `td`. Leave them; they now agree with their headers.

- [ ] **Step 2: Swap the admin/usage headers**

Fifteen one-line edits in `src/app/app/admin/usage/page.tsx` — every `<th className="text-right">X</th>` becomes `<th className="num">X</th>`. The full list, by line: 126 `Price/mo`, 127 `Quota (plans)`, 128 `Est. LLM cost/mo`, 129 `Margin`, 130 `Margin %`, 173 `Calls`, 174 `Prompt tok`, 175 `Completion tok`, 176 `Est. cost`, 177 `Avg ms`, 207 `Calls`, 208 `Prompt tok`, 209 `Completion tok`, 210 `Est. cost`, 211 `Avg ms`.

Do it with a checked search-and-replace across that file only:

```bash
git diff --stat src/app/app/admin/usage/page.tsx
```
Expected after editing: `15 insertions(+), 15 deletions(-)`.

- [ ] **Step 3: Run the guard**

Run: `npx vitest run tests/app-chrome.test.ts -t 'right-aligns numeric'`
Expected: still FAILS with one offender: `app/(site)/trust/page.tsx` (Task 5, gated).

- [ ] **Step 4: Commit**

```bash
git add src/app/app/decide/agents/page.tsx src/app/app/admin/usage/page.tsx
git commit -m "fix(tables): right-align numeric headers, which text-right never did"
```

---

## Task 5 (GATED): `.num` on the trust page

**Do not start this task until the verdict-accuracy work has landed** — see the concurrency warning at the top. Check with:

```bash
git log --oneline -5 -- src/app/\(site\)/trust/page.tsx
```

**Files:**
- Modify: `src/app/(site)/trust/page.tsx:387-389`
- Test: `tests/app-chrome.test.ts`

- [ ] **Step 1: Swap the three headers**

```tsx
<th className="num">Predicted</th>
<th className="num">Realized</th>
<th className="num">Error</th>
```

- [ ] **Step 2: Run the guard**

Run: `npx vitest run tests/app-chrome.test.ts -t 'right-aligns numeric'`
Expected: PASS (offender list empty).

- [ ] **Step 3: Commit**

```bash
git add src/app/\(site\)/trust/page.tsx
git commit -m "fix(trust): right-align the calibration table's numeric headers"
```

---

# Phase 3 — Landmarks

## Task 6: Remove the nested `<main>` on Connect

**Files:**
- Modify: `src/app/app/connect/page.tsx:39` and its closing tag
- Test: `tests/app-chrome.test.ts`

`src/app/app/layout.tsx:92` already renders `<main className="mx-auto w-full max-w-[1200px] flex-1 px-4 py-6 sm:px-6">`. Connect renders a second `<main>` inside it, which is an invalid duplicate landmark (screen-reader users get two "main" regions) and re-applies horizontal centering the shell has already done.

- [ ] **Step 1: Swap the element**

Replace line 39:

```tsx
    <main className="mx-auto max-w-[760px] space-y-6">
```

with:

```tsx
    <div className="mx-auto max-w-[760px] space-y-6">
```

- [ ] **Step 2: Close it as a div**

Find the matching `</main>` at the end of the returned JSX and change it to `</div>`. There is exactly one `</main>` in the file:

```bash
grep -n '</main>' src/app/app/connect/page.tsx
```
Expected: one line. Change it.

- [ ] **Step 3: Run the guard and the existing connect test**

Run: `npx vitest run tests/app-chrome.test.ts tests/connect-copy.test.ts`
Expected: all PASS. `tests/app-chrome.test.ts` is now fully green except the gated Task 5 assertion, if that is still outstanding.

- [ ] **Step 4: Commit**

```bash
npx tsc --noEmit
git add src/app/app/connect/page.tsx
git commit -m "fix(connect): one main landmark, not two"
```

---

# Phase 4 — The Agents tables on a phone

## Task 7: Convert the four Agents tables to `table-cards`

**Files:**
- Modify: `src/app/app/decide/agents/page.tsx` — four tables at ~63, ~115, ~177, ~272
- Test: `tests/app-chrome.test.ts` (no new assertion; this is a judgement change, not an invariant)

All four tables are wrapped in `<div className="overflow-x-auto">`. Sideways scroll is a defensible strategy for a 3-column table; it is a bad one for the 6-column "what developers actually love" table, where a phone shows two columns and the reader has no idea what they are scrolling toward. The rest of Decide (`tools`, `stacks`, `kits`) already uses `table-cards`, so these four are the odd ones out.

**The transformation, applied to each table:**
1. Delete the wrapping `<div className="overflow-x-auto">` and its `</div>`.
2. Change `<table className="table">` to `<table className="table table-cards">`.
3. Give **every** `<td>` a `data-label` equal to its column's header text, lowercased. A `td` without one renders a blank label gutter below 640px.

- [ ] **Step 1: Worked example — the "who should use what" table (~line 62)**

Replace:

```tsx
      <div className="overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>You are</th>
              <th>Run this</th>
              <th className="num">Typical $</th>
              <th>Skip</th>
            </tr>
          </thead>
          <tbody>
            {personas.map((p) => (
              <tr key={p.slug} id={p.slug}>
                <td className="whitespace-nowrap">
                  <span className="text-ink">{p.label}</span>
                </td>
                <td className="text-[11.5px] leading-snug text-ink-2">
                  {p.stack}
                </td>
                <td className="mono whitespace-nowrap text-right text-[11.5px]">{costBand(p)}</td>
                <td className="text-[11.5px] leading-snug text-ink-3">
                  {p.skip}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
```

with:

```tsx
      <table className="table table-cards">
        <thead>
          <tr>
            <th>You are</th>
            <th>Run this</th>
            <th className="num">Typical $</th>
            <th>Skip</th>
          </tr>
        </thead>
        <tbody>
          {personas.map((p) => (
            <tr key={p.slug} id={p.slug}>
              <td data-label="you are" className="whitespace-nowrap">
                <span className="text-ink">{p.label}</span>
              </td>
              <td data-label="run this" className="text-[11.5px] leading-snug text-ink-2">
                {p.stack}
              </td>
              <td data-label="typical $" className="num mono whitespace-nowrap text-[11.5px]">
                {costBand(p)}
              </td>
              <td data-label="skip" className="text-[11.5px] leading-snug text-ink-3">
                {p.skip}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
```

Note `text-right` became `num` on the price cell, so the column is right-aligned by one rule instead of two.

- [ ] **Step 2: "what developers actually love" table (~line 114)**

Same three-step transformation. Its `data-label` values, in column order:
`harness`, `kind`, `loved %`, `7d mentions`, `kept for`, `loses`.

The `loved %` and `7d mentions` cells carry `text-right` today — replace that with `num` on both, matching their headers from Task 4.

- [ ] **Step 3: "model + harness pairing" table (~line 176)**

Same transformation. `data-label` values in column order: `job`, `model people reach for`, `where they run it`.

This table is only three columns, so the win is smaller — do it anyway, so a reader moving between the tables on this page does not meet two different mobile behaviours.

- [ ] **Step 4: "the landscape" plans table (~line 271)**

Same transformation. `data-label` values in column order: `plan`, `$/mo`, `the limit that bites`, `verdict`.

The `$/mo` cell carries `mono text-right` — replace `text-right` with `num`.

- [ ] **Step 5: Confirm no wrapper survived and every cell is labelled**

```bash
grep -c 'overflow-x-auto' src/app/app/decide/agents/page.tsx
```
Expected: `0`.

```bash
grep -c 'data-label' src/app/app/decide/agents/page.tsx
```
Expected: `17` (4 + 6 + 3 + 4).

- [ ] **Step 6: Verify in the browser at phone width**

```bash
npm run dev
```

Open `http://localhost:3000/app/decide/agents` and narrow the window below 640px. Each row should read as a card with an uppercase label to the left of each value, and no empty label gutters. Switch to the Plans tab and check that table too.

- [ ] **Step 7: Full suite and commit**

```bash
npm test
npx tsc --noEmit
git add src/app/app/decide/agents/page.tsx
git commit -m "fix(agents): tables fold into cards on phones like the rest of Decide"
```

---

# Final verification

- [ ] `npm test` — expect 111 test files, all passing (108 before this plan, plus `app-chrome`; the concurrent verdict work adds its own).
- [ ] `npx tsc --noEmit` — expect no output.
- [ ] `npm run build` — expect a clean build with every `/app/**` route listed.
- [ ] Walk the shell at 1280px and at 375px: `/app`, `/app/decide`, `/app/decide/tools`, `/app/decide/kits`, `/app/decide/agents`, `/app/build`, `/app/build/opportunities`, `/app/connect`, `/app/account`. Every page should open with the same header shape in the same place, and no numeric column should sit under a left-aligned label.

---

# Explicitly out of scope

- **`src/app/app/admin/usage/page.tsx` mobile tables.** Five-column internal dashboards read by one admin on a desktop. `overflow-x-auto` is the right call there; only the header alignment (Task 4) is a defect.
- **`CostMatrix.tsx`, `JobsPanel.tsx`, `SourcesPanel.tsx`, `ProposalCard.tsx`, `AssessmentMatrix.tsx` tables.** They use `.table` without `table-cards`, but each is either admin-only or already inside a horizontally-scrolling frame with an explicit `minWidth`. Revisit only if a user reports it.
- **Anything under `src/lib/**`, `worker/**`.** Owned by the concurrent verdict-accuracy plan.
- **`.claude/launch.json`.** Created during the critique pass to run the dev server. Decide separately whether to commit it or add it to `.gitignore`; it is not a craft defect either way.
