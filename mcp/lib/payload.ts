import { z } from 'zod';
import { config } from '../../src/lib/config';
import { getIdentity } from '../../src/lib/identity';

/**
 * Footer appended to every payload. The MCP server is the product, but
 * attribution still points agents (and their humans) back at the hub.
 */
export function attribution(): string {
  const id = getIdentity();
  return `\n\n—\nSource: ${id.productName} · ${config.siteUrl}`;
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
};

/**
 * JSON payload: structuredContent (validated against the tool's outputSchema)
 * plus a text mirror for clients that only render content blocks. Every
 * structured payload carries the envelope: a one-sentence `summary` and the
 * suggested `next` actions.
 */
export function respond(data: Record<string, unknown>, meta?: { summary?: string; next?: NextAction[] }) {
  const structured = { summary: meta?.summary ?? '', next: meta?.next ?? [], ...data };
  return {
    structuredContent: structured,
    content: [{ type: 'text' as const, text: JSON.stringify(structured, null, 2) + attribution() }],
  };
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
