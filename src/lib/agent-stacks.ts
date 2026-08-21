/**
 * Coding-agent stack tracker — IDE + harness + model, not the venture
 * playbooks on /stacks.
 *
 * /stacks answers "what do I build a SaaS with." This answers "which editor,
 * agent harness, and model do builders actually run" — the gap between
 * list-price seats (/agent-plans) and the product stack (Next/Supabase).
 *
 * Hand-seeded from survey + user-report synthesis (not LLM-regenerated:
 * love-rate percentages must not be hallucinated weekly). A weekly job
 * logs those numbers plus first-party 7-day mention heat from the story
 * graph into metric_points:
 *   source 'agent-stacks' · entity '<Harness|persona>' · metric
 *     'loved_pct' | 'mentions_7d' | 'typical_cost_usd'
 *
 * The public /agent-stacks page renders the const directly; mention heat
 * is read live from the entity graph so the radar half stays current
 * between editorial reviews.
 *
 * last manual review: 2026-08-21 — review quarterly
 */

import { entityDailySeries } from './analytics';
import { canonicalEntityKey } from './entity';
import { recordMetrics, type MetricInput } from './metrics';

export const AGENT_STACKS_REVIEWED_AT = '2026-08-21';
export const AGENT_STACKS_SOURCE = 'agent-stacks';

export const PERSONA_SLUGS = [
  'indie',
  'daily',
  'budget',
  'power',
  'nocoder',
  'enterprise',
] as const;

export type PersonaSlug = (typeof PERSONA_SLUGS)[number];

export interface AgentPersona {
  slug: PersonaSlug;
  label: string;
  /** One-line stack: IDE + harness + default model. */
  stack: string;
  ide: string;
  harness: string;
  model: string;
  /** Typical monthly spend band, USD. */
  costLowUsd: number;
  costHighUsd: number;
  why: string;
  skip: string;
}

export type HarnessKind = 'ide' | 'cli' | 'builder' | 'addon';

export interface HarnessRow {
  name: string;
  kind: HarnessKind;
  /** Pragmatic Engineer Feb 2026 "most loved" share, or null if not in that survey. */
  lovedPct: number | null;
  role: string;
  loses: string;
  sticker: string;
  /** Names to look up in the story-entity graph for mention heat. */
  aliases: string[];
}

export interface ModelPairing {
  job: string;
  model: string;
  harness: string;
}

/**
 * Persona playbooks. Cost bands are what heavy users report paying, not
 * sticker prices — see /agent-plans for the seat table.
 */
export const AGENT_PERSONAS: AgentPersona[] = [
  {
    slug: 'indie',
    label: 'Indie / senior shipping',
    stack: 'Claude Code in VS Code or Cursor · Claude Pro, Max 5x if the window bites',
    ide: 'VS Code or Cursor',
    harness: 'Claude Code',
    model: 'Claude Sonnet daily, Opus for hard jobs',
    costLowUsd: 20,
    costHighUsd: 100,
    why: 'Pragmatic Engineer: 46% most-loved, ~75% of tiny-company usage. One $20 Claude Pro seat covers agent + chat with no credit pool.',
    skip: 'Do not stack Cursor Ultra and Claude Max unless you are dual-wielding all day.',
  },
  {
    slug: 'daily',
    label: 'Editor-first daily coding',
    stack: 'Cursor Pro (Tab + Composer/Auto) + Claude Pro for repo-wide jobs',
    ide: 'Cursor',
    harness: 'Cursor Agent + Claude Code',
    model: 'Composer/Auto in-editor, Claude for cross-cutting work',
    costLowUsd: 40,
    costHighUsd: 40,
    why: 'The most common two-tool setup in 2026 surveys. Cursor Tab is still the best inline feel; Claude Code wins when a task spans the repo.',
    skip: 'Skip a second VS Code fork (Windsurf). People who tried both keep Cursor and add a CLI agent.',
  },
  {
    slug: 'budget',
    label: 'Budget / light use',
    stack: 'Cursor Auto, GitHub Copilot, or ChatGPT Plus + Codex',
    ide: 'Whatever you already have',
    harness: 'Copilot or Codex',
    model: 'Whatever the $10–$20 plan includes — not Opus',
    costLowUsd: 10,
    costHighUsd: 20,
    why: 'Copilot is the cheap Tab pick. Cursor Auto is unlimited but weaker. Codex on Plus is the $20 plan users most often call most juice per dollar.',
    skip: 'Do not run Opus inside Cursor Pro. That is how $20 becomes $60+ mid-month.',
  },
  {
    slug: 'power',
    label: 'Heavy agent user',
    stack: 'Codex daily + Claude Max for ambiguous design',
    ide: 'Whatever the harness plugins into',
    harness: 'Codex + Claude Code',
    model: 'GPT-5.6 Sol daily, Claude Opus/Fable for design',
    costLowUsd: 100,
    costHighUsd: 200,
    why: 'Field reports (all-day agent use, Aug 2026): Codex is faster and cheaper; Claude is better on underspecified design. Native harness + native model.',
    skip: 'Mixing Claude models inside Cursor Agent is the expensive path users dumped after surprise overage weeks.',
  },
  {
    slug: 'nocoder',
    label: 'Non-coder MVP',
    stack: 'Lovable + Supabase, export to GitHub, rebuild later',
    ide: 'None — browser builder',
    harness: 'Lovable (Bolt for speed, v0 for React UI)',
    model: 'Whatever the builder defaults to',
    costLowUsd: 25,
    costHighUsd: 50,
    why: 'Non-coder threads pick Lovable for polish and GitHub sync. Bolt is fastest to a live URL. v0 if you already think in React.',
    skip: 'Do not scale on these. Credit burn, security holes, and collapse past ~15 screens are consistent reports. Do not buy Cursor hoping it is a no-code builder.',
  },
  {
    slug: 'enterprise',
    label: 'Enterprise / procured',
    stack: 'GitHub Copilot Business, then Claude Code if policy allows',
    ide: 'Whatever IT already approved',
    harness: 'Copilot, optionally Claude Code',
    model: 'Whatever the Copilot seat includes',
    costLowUsd: 19,
    costHighUsd: 39,
    why: 'Pragmatic Engineer: 10k+ companies still default Copilot (56%). Preference and procurement diverged — directors love Claude Code; IT buys Copilot.',
    skip: 'Windsurf/Devin Desktop only if you already need that governance story. Brand changed hands twice.',
  },
];

/**
 * Harness landscape. lovedPct is the Pragmatic Engineer Jan–Feb 2026
 * single-choice favorite (n=906), not market share. Copilot's install base
 * is much larger than 9%.
 */
export const HARNESS_LANDSCAPE: HarnessRow[] = [
  {
    name: 'Claude Code',
    kind: 'cli',
    lovedPct: 46,
    role: 'Repo-wide agents, CLAUDE.md, tests/CI, multi-file refactors',
    loses: 'No Tab. Slow/careful. Max plan if you are on it all day',
    sticker: '$20 / $100 / $200',
    aliases: ['Claude Code'],
  },
  {
    name: 'Cursor',
    kind: 'ide',
    lovedPct: 19,
    role: 'Best GUI + Tab + Composer. Multi-model. Review diffs in-editor',
    loses: 'Frontier models drain the $20 credit pool. Surprise overage bills',
    sticker: '$20 / $60 / ~$200',
    aliases: ['Cursor'],
  },
  {
    name: 'Codex',
    kind: 'cli',
    lovedPct: null,
    role: 'Fast daily agent, cheap tokens, unattended parallel runs',
    loses: 'Weaker on fuzzy design vs Claude. Lives outside the IDE',
    sticker: '$20 Plus / $200 Pro',
    aliases: ['Codex', 'OpenAI Codex'],
  },
  {
    name: 'GitHub Copilot',
    kind: 'addon',
    lovedPct: 9,
    role: 'Cheapest Tab, JetBrains/VS/Xcode, IT already approved it',
    loses: '9% most-loved. Weak multi-file. Credits since Jun 2026',
    sticker: '$10 / $39',
    aliases: ['GitHub Copilot', 'Copilot'],
  },
  {
    name: 'Windsurf',
    kind: 'ide',
    lovedPct: null,
    role: 'Cascade flow, predictable quotas, Devin cloud story',
    loses: 'Original team left. Smaller community. Third pick',
    sticker: '~$15–$20',
    aliases: ['Windsurf', 'Devin Desktop'],
  },
  {
    name: 'Lovable',
    kind: 'builder',
    lovedPct: null,
    role: 'Non-coder MVPs, UI polish, prompt-to-URL in an hour',
    loses: 'Breaks on real backends. Credits. Rebuild before scale',
    sticker: '$20–$50 real',
    aliases: ['Lovable'],
  },
];

export const MODEL_PAIRINGS: ModelPairing[] = [
  {
    job: 'Daily feature work, well-specified',
    model: 'GPT-5.6 Sol or Claude Sonnet / Cursor Composer',
    harness: 'Codex CLI or Cursor Auto',
  },
  {
    job: 'Ambiguous design, architecture, "why is this wrong"',
    model: 'Claude Opus / Fable',
    harness: 'Claude Code (not Cursor, if you care about $)',
  },
  {
    job: 'Mechanical bugfix, well-specified PR',
    model: 'Grok 4.5/4.6 or Composer — fast, then CI will nag',
    harness: 'Cursor or Grok Build',
  },
  {
    job: 'Frontend polish / UI',
    model: 'GPT family or Kimi K3',
    harness: 'v0, Cursor, or a one-off swap',
  },
  {
    job: 'Huge repo / long context',
    model: 'Claude or Kimi (1M-class windows)',
    harness: 'Claude Code',
  },
];

/** The product stack models generate most reliably — distinct from /stacks playbooks. */
export const DEFAULT_APP_STACK = {
  title: 'Next.js + Tailwind + shadcn + Supabase + Vercel',
  note: 'Training-data gravity, not architecture purity. Leave it when you already know another stack or when a $6 VPS + Postgres is cheaper than usage-priced BaaS. Vibe coding fails first on auth, RLS, and payments.',
};

export function isPersonaSlug(raw: string): raw is PersonaSlug {
  return (PERSONA_SLUGS as readonly string[]).includes(raw);
}

/** Resolve a slug or a label fragment (e.g. "indie", "non-coder", "budget"). */
export function resolvePersona(raw: string): AgentPersona | null {
  const q = raw.trim().toLowerCase();
  if (!q) return null;
  const exact = AGENT_PERSONAS.find((p) => p.slug === q);
  if (exact) return exact;
  return (
    AGENT_PERSONAS.find((p) => p.label.toLowerCase() === q) ??
    AGENT_PERSONAS.find((p) => p.label.toLowerCase().includes(q) || p.slug.includes(q)) ??
    null
  );
}

export function costBand(p: AgentPersona): string {
  if (p.costLowUsd === p.costHighUsd) return `$${p.costLowUsd}/mo`;
  return `$${p.costLowUsd}–$${p.costHighUsd}/mo`;
}

/** 7-day mention count across alias keys in the curated story graph. */
export function harnessMentions7d(aliases: string[]): number {
  if (aliases.length === 0) return 0;
  const series = entityDailySeries(aliases, 7);
  let n = 0;
  const seen = new Set<string>();
  for (const alias of aliases) {
    const key = canonicalEntityKey(alias);
    if (seen.has(key)) continue;
    seen.add(key);
    const arr = series.get(key);
    if (!arr) continue;
    for (const v of arr) n += v;
  }
  return n;
}

export function landscapeWithMentions(rows: HarnessRow[] = HARNESS_LANDSCAPE): Array<HarnessRow & { mentions7d: number }> {
  return rows.map((h) => ({ ...h, mentions7d: harnessMentions7d(h.aliases) }));
}

/** Flattens editorial numbers + live mention heat into metric points. */
export function agentStackPoints(
  personas: AgentPersona[] = AGENT_PERSONAS,
  landscape: HarnessRow[] = HARNESS_LANDSCAPE,
): MetricInput[] {
  const points: MetricInput[] = [];
  for (const h of landscape) {
    if (h.lovedPct !== null) {
      points.push({
        source: AGENT_STACKS_SOURCE,
        entity: h.name,
        metric: 'loved_pct',
        value: h.lovedPct,
      });
    }
    points.push({
      source: AGENT_STACKS_SOURCE,
      entity: h.name,
      metric: 'mentions_7d',
      value: harnessMentions7d(h.aliases),
    });
  }
  for (const p of personas) {
    points.push({
      source: AGENT_STACKS_SOURCE,
      entity: p.slug,
      metric: 'typical_cost_usd',
      value: (p.costLowUsd + p.costHighUsd) / 2,
    });
  }
  return points;
}

/**
 * Weekly sync. Idempotent per day — recordMetrics upserts on
 * (source, entity, metric, date).
 */
export async function syncAgentStacks(): Promise<{ recorded: number }> {
  return { recorded: recordMetrics(agentStackPoints()) };
}
