import { and, desc, eq, gte } from 'drizzle-orm';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getDb } from '../../src/lib/db';
import {
  boardHistory,
  opportunities,
  patterns,
  stories,
  userWatches,
} from '../../src/lib/db/schema';
import { urls } from '../../src/lib/urls';
import { envelopeSchema, hoursAgo, iso, respond, withUserEconomy } from '../lib/payload';
import type { AuthContext } from '../lib/auth';
import { visibleTo } from '../../src/lib/opportunities/scope';

const watchKind = z.enum(['entity', 'sector', 'opportunity', 'topic']);

function needAuth(auth: AuthContext) {
  if (auth.userId != null) return null;
  return respond(
    { ok: false, error: 'sign in required for watchlist tools' },
    {
      summary: 'Sign in required for watchlist tools.',
      economy: withUserEconomy(auth.userId, 'read'),
      next: [{ tool: 'get_server_guide', arguments: {}, reason: 'how to authenticate this MCP server' }],
    },
  );
}

type WatchRow = { kind: 'entity' | 'sector' | 'opportunity' | 'topic'; key: string };

function matchesWatch(
  watches: WatchRow[],
  hay: { title?: string; sector?: string | null; slug?: string; subject?: string | null },
): boolean {
  if (watches.length === 0) return true;
  const title = (hay.title ?? '').toLowerCase();
  const sector = (hay.sector ?? '').toLowerCase();
  const slug = (hay.slug ?? '').toLowerCase();
  const subject = (hay.subject ?? '').toLowerCase();
  for (const w of watches) {
    const key = w.key.toLowerCase();
    if (w.kind === 'sector' && (sector === key || sector.includes(key) || subject === key)) return true;
    if (w.kind === 'opportunity' && (slug === key || slug.includes(key))) return true;
    if (w.kind === 'entity' && (title.includes(key) || subject.includes(key))) return true;
    if (w.kind === 'topic' && (title.includes(key) || sector.includes(key) || subject.includes(key))) return true;
  }
  return false;
}

export function registerWatchTools(server: McpServer, auth: AuthContext): void {
  server.registerTool(
    'watch',
    {
      description: 'Subscribe to an entity, sector, opportunity slug, or topic. Pair with get_since for compact deltas.',
      inputSchema: {
        kind: watchKind,
        key: z.string().min(1).max(120).describe('entity name, sector slug, opportunity slug, or topic token'),
      },
      outputSchema: {
        ...envelopeSchema,
        ok: z.boolean(),
        error: z.string().optional(),
        watch: z.object({ kind: watchKind, key: z.string(), created_at: z.string() }).optional(),
      },
    },
    async ({ kind, key }) => {
      const denied = needAuth(auth);
      if (denied) return denied;
      const db = getDb();
      const now = new Date();
      try {
        db.insert(userWatches)
          .values({ userId: auth.userId!, kind, key: key.trim(), createdAt: now })
          .run();
      } catch {
        // unique index — already watching; treat as success
      }
      return respond(
        { ok: true, watch: { kind, key: key.trim(), created_at: now.toISOString() } },
        {
          summary: `Watching ${kind}:${key.trim()}.`,
          economy: withUserEconomy(auth.userId, 'read'),
          next: [{ tool: 'get_since', arguments: { hours: 24 }, reason: 'pull deltas for your watches' }],
        },
      );
    },
  );

  server.registerTool(
    'unwatch',
    {
      description: 'Remove a watch subscription.',
      inputSchema: { kind: watchKind, key: z.string().min(1).max(120) },
      outputSchema: {
        ...envelopeSchema,
        ok: z.boolean(),
        error: z.string().optional(),
        removed: z.boolean().optional(),
      },
    },
    async ({ kind, key }) => {
      const denied = needAuth(auth);
      if (denied) return denied;
      const result = getDb()
        .delete(userWatches)
        .where(
          and(
            eq(userWatches.userId, auth.userId!),
            eq(userWatches.kind, kind),
            eq(userWatches.key, key.trim()),
          ),
        )
        .run();
      const removed = (result.changes ?? 0) > 0;
      return respond(
        { ok: true, removed },
        {
          summary: removed ? `Unwatched ${kind}:${key.trim()}.` : `No watch matched ${kind}:${key.trim()}.`,
          economy: withUserEconomy(auth.userId, 'read'),
        },
      );
    },
  );

  server.registerTool(
    'list_watches',
    {
      description: 'List your watch subscriptions.',
      inputSchema: {},
      outputSchema: {
        ...envelopeSchema,
        ok: z.boolean(),
        error: z.string().optional(),
        count: z.number().optional(),
        watches: z
          .array(z.object({ kind: watchKind, key: z.string(), created_at: z.string() }))
          .optional(),
      },
    },
    async () => {
      const denied = needAuth(auth);
      if (denied) return denied;
      const rows = getDb()
        .select()
        .from(userWatches)
        .where(eq(userWatches.userId, auth.userId!))
        .orderBy(desc(userWatches.createdAt))
        .all();
      return respond(
        {
          ok: true,
          count: rows.length,
          watches: rows.map((r) => ({
            kind: r.kind,
            key: r.key,
            created_at: r.createdAt.toISOString(),
          })),
        },
        {
          summary: `${rows.length} watch${rows.length === 1 ? '' : 'es'}.`,
          economy: withUserEconomy(auth.userId, 'read'),
          next: [{ tool: 'get_since', arguments: { hours: 24 }, reason: 'deltas since yesterday' }],
        },
      );
    },
  );

  server.registerTool(
    'get_since',
    {
      description:
        'Compact deltas since a cursor (ISO) or lookback hours (default 24): new/updated curated stories, opportunities, patterns, board history. Filtered to your watches when any exist.',
      inputSchema: {
        cursor: z.string().min(10).max(40).optional().describe('ISO timestamp; items at/after this'),
        hours: z.number().int().min(1).max(168).default(24).describe('used when cursor omitted'),
      },
      outputSchema: {
        ...envelopeSchema,
        ok: z.boolean(),
        error: z.string().optional(),
        since: z.string().optional(),
        next_cursor: z.string().optional(),
        stories: z
          .array(z.object({ id: z.number(), title: z.string(), score: z.number(), url: z.string(), created_at: z.string() }))
          .optional(),
        opportunities: z
          .array(z.object({ slug: z.string(), title: z.string(), sector: z.string().nullable(), flip: z.number(), url: z.string() }))
          .optional(),
        patterns: z
          .array(z.object({ kind: z.string(), headline: z.string(), subject: z.string().nullable(), score: z.number() }))
          .optional(),
        board_history: z
          .array(z.object({ domain: z.string(), task: z.string(), change: z.string(), applied_at: z.string() }))
          .optional(),
      },
    },
    async ({ cursor, hours }) => {
      const denied = needAuth(auth);
      if (denied) return denied;
      const db = getDb();
      const since = cursor ? new Date(cursor) : hoursAgo(hours);
      if (Number.isNaN(since.getTime())) {
        return respond(
          { ok: false, error: 'invalid cursor — pass an ISO timestamp or omit and use hours' },
          { summary: 'Invalid get_since cursor.', economy: withUserEconomy(auth.userId, 'read') },
        );
      }
      const next_cursor = new Date().toISOString();

      const watches = db
        .select({ kind: userWatches.kind, key: userWatches.key })
        .from(userWatches)
        .where(eq(userWatches.userId, auth.userId!))
        .all() as WatchRow[];

      const storyRows = db
        .select()
        .from(stories)
        .where(and(eq(stories.status, 'curated'), gte(stories.createdAt, since)))
        .orderBy(desc(stories.createdAt))
        .limit(40)
        .all()
        .filter((s) => matchesWatch(watches, { title: s.title }))
        .slice(0, 15)
        .map((s) => ({
          id: s.id,
          title: s.title,
          score: s.topScore,
          url: urls.story(s.id),
          created_at: s.createdAt.toISOString(),
        }));

      const oppRows = db
        .select()
        .from(opportunities)
        .where(and(gte(opportunities.lastSeenAt, since), visibleTo(auth.userId)))
        .orderBy(desc(opportunities.lastSeenAt))
        .limit(40)
        .all()
        .filter((o) => matchesWatch(watches, { title: o.title, sector: o.sector, slug: o.slug }))
        .slice(0, 12)
        .map((o) => ({
          slug: o.slug,
          title: o.title,
          sector: o.sector ?? null,
          flip: o.flipScore,
          url: urls.opportunity(o.slug),
        }));

      const patternRows = db
        .select()
        .from(patterns)
        .where(gte(patterns.createdAt, since))
        .orderBy(desc(patterns.createdAt))
        .limit(40)
        .all()
        .filter((p) => matchesWatch(watches, { title: p.headline, subject: p.subject, sector: p.subject }))
        .slice(0, 12)
        .map((p) => ({
          kind: p.kind,
          headline: p.headline,
          subject: p.subject ?? null,
          score: p.score,
        }));

      const boardRows = db
        .select()
        .from(boardHistory)
        .where(gte(boardHistory.appliedAt, since))
        .orderBy(desc(boardHistory.appliedAt))
        .limit(20)
        .all()
        .map((b) => ({
          domain: b.domain,
          task: b.task,
          change: b.change,
          applied_at: b.appliedAt.toISOString(),
        }));

      return respond(
        {
          ok: true,
          since: since.toISOString(),
          next_cursor,
          stories: storyRows,
          opportunities: oppRows,
          patterns: patternRows,
          board_history: boardRows,
        },
        {
          summary:
            `Since ${iso(since)}: ${storyRows.length} stories, ${oppRows.length} openings, ` +
            `${patternRows.length} patterns, ${boardRows.length} board changes` +
            (watches.length ? ` (filtered to ${watches.length} watches)` : '') +
            '.',
          economy: withUserEconomy(auth.userId, 'read'),
          next: [{ tool: 'get_since', arguments: { cursor: next_cursor }, reason: 'poll again with next_cursor' }],
        },
      );
    },
  );
}
