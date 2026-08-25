import { z } from 'zod';
import { urls } from '../../src/lib/urls';
import { getIdentity } from '../../src/lib/identity';
import {
  computeEconomy,
  recordEconomy,
  type DiyKind,
  type EconomyOpts,
  type EconomySnapshot,
} from '../../src/lib/mcp-economy';

/**
 * Footer appended to every payload. The MCP server is the product, but
 * attribution still points agents (and their humans) back at the hub.
 */
export function attribution(): string {
  const id = getIdentity();
  return `\n\n—\nSource: ${id.productName} · ${urls.home()}`;
}

/** Plain-text/markdown payload with the attribution footer. */
export function text(md: string) {
  return { content: [{ type: 'text' as const, text: md + attribution() }] };
}

/**
 * A suggested follow-up call, with prefilled arguments — agents chain
 * workflows by reading `next` instead of guessing tool names/arg shapes.
 */
export interface NextAction {
  tool: string;
  arguments: Record<string, unknown>;
  reason: string;
}

/** Shared detail knob for read tools — compact is the default. */
export const detailSchema = z
  .enum(['summary', 'compact', 'full'])
  .default('compact')
  .describe('summary = one-liner fields; compact = key fields (default); full = dossier dump');

export type DetailLevel = 'summary' | 'compact' | 'full';

const economySchema = z.object({
  returned: z.number().int().describe('approx tokens returned to the agent'),
  saved_vs_full: z.number().int().describe('tokens avoided vs a full dump of the same data'),
  saved_vs_diy: z.number().int().describe('tokens avoided vs the agent researching this itself'),
});

/** Zod raw shape for the envelope fields — spread into every outputSchema. */
export const envelopeSchema = {
  summary: z.string().describe('one-sentence natural-language summary of this result'),
  next: z
    .array(
      z.object({
        tool: z.string(),
        arguments: z.record(z.string(), z.unknown()),
        reason: z.string(),
      }),
    )
    .describe('suggested follow-up tool calls, with prefilled arguments'),
  economy: economySchema
    .optional()
    .describe('token-savings receipt — Radar researched so your coding agent did not'),
};

export interface RespondMeta {
  summary?: string;
  next?: NextAction[];
  /** Token-savings metering. When set, economy is attached and optionally persisted. */
  economy?: EconomyOpts;
  /**
   * When true, content mirrors structured JSON (legacy). Default false: content
   * is the one-line summary so clients that only render text blocks stay cheap.
   */
  mirrorJson?: boolean;
}

/**
 * JSON payload: structuredContent (validated against the tool's outputSchema)
 * plus a short text summary for clients that only render content blocks.
 * Every structured payload carries summary, next, and economy.
 */
export function respond(data: Record<string, unknown>, meta?: RespondMeta) {
  const summary = meta?.summary ?? '';
  const next = meta?.next ?? [];
  const structured: Record<string, unknown> = { summary, next, ...data };

  // Economy is computed against the structured payload the agent will parse.
  // fullTokens defaults to a JSON-pretty dump size (what we used to ship in content).
  const fullDumpTokens = Math.ceil(JSON.stringify(structured, null, 2).length / 4);
  const economyOpts: EconomyOpts = {
    diyKind: meta?.economy?.diyKind ?? 'read',
    fullTokens: meta?.economy?.fullTokens ?? fullDumpTokens,
    userId: meta?.economy?.userId,
  };
  const economy: EconomySnapshot = computeEconomy(structured, economyOpts, summary);
  structured.economy = economy;
  recordEconomy(economyOpts.userId, economy);

  const contentText = meta?.mirrorJson
    ? JSON.stringify(structured, null, 2) + attribution()
    : summary + attribution();

  return {
    structuredContent: structured,
    content: [{ type: 'text' as const, text: contentText }],
  };
}

/** Helper: attach auth userId into economy opts for tools that have AuthContext. */
export function withUserEconomy(
  userId: number | null | undefined,
  diyKind: DiyKind,
  extra?: Omit<EconomyOpts, 'diyKind' | 'userId'>,
): EconomyOpts {
  return { diyKind, userId: userId ?? null, ...extra };
}

/** Parse a JSON text column with a fallback; never throws. */
export function parseJsonColumn<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** ISO string for date columns, null-safe. */
export function iso(d: Date | null): string | null {
  return d ? d.toISOString() : null;
}

/** Cutoff date N hours ago. */
export function hoursAgo(hours: number): Date {
  return new Date(Date.now() - hours * 36e5);
}

/** Cutoff day string (YYYY-MM-DD UTC) N days ago. */
export function daysAgoDay(days: number): string {
  return new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
}

export type { DiyKind, EconomySnapshot };
