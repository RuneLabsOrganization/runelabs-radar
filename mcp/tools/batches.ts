import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  addToBatch,
  canModifyBatch,
  canViewBatch,
  createWorkspaceBatch,
  getBatchBySlug,
  getBatchItems,
  listBatchesForUser,
  runBatchOp,
} from '../../src/lib/batches';
import { getDb } from '../../src/lib/db';
import { batchRuns, batches } from '../../src/lib/db/schema';
import { can } from '../../src/lib/entitlements';
import { urls } from '../../src/lib/urls';
import { eq } from 'drizzle-orm';
import { envelopeSchema, respond } from '../lib/payload';
import { hasScope, type AuthContext } from '../lib/auth';

export function registerBatchTools(server: McpServer, auth: AuthContext): void {
  server.registerTool(
    'list_batches',
    {
      description:
        'List workspace batches for the caller plus recent weekly Radar Batch drops. Use before create_batch / run_batch.',
      inputSchema: {},
      outputSchema: {
        ...envelopeSchema,
        count: z.number(),
        batches: z.array(
          z.object({
            slug: z.string(),
            title: z.string(),
            kind: z.string(),
            cohort: z.string().nullable(),
            item_count: z.number(),
            url: z.string(),
          }),
        ),
      },
    },
    async () => {
      if (!hasScope(auth, 'read')) {
        return respond(
          { count: 0, batches: [] },
          { summary: "This token has no 'read' scope — re-authorize with the read scope." },
        );
      }
      if (!auth.userId) {
        return respond(
          { count: 0, batches: [] },
          {
            summary: 'Batches require an authenticated MCP user.',
            next: [{ tool: 'get_server_guide', arguments: {}, reason: 'auth setup' }],
          },
        );
      }
      const rows = listBatchesForUser(auth.userId);
      const payload = rows.map((b) => ({
        slug: b.slug,
        title: b.title,
        kind: b.kind,
        cohort: b.cohort ?? null,
        item_count: getBatchItems(b.id).length,
        url: urls.batch(b.slug),
      }));
      return respond(
        { count: payload.length, batches: payload },
        {
          summary: `${payload.length} batches available.`,
          next: payload[0]
            ? [{ tool: 'get_batch', arguments: { slug: payload[0].slug }, reason: 'inspect the first batch' }]
            : [{ tool: 'create_batch', arguments: { title: 'My first batch' }, reason: 'start a workspace batch' }],
        },
      );
    },
  );

  server.registerTool(
    'get_batch',
    {
      description: 'Full batch detail with items. Identify by slug.',
      inputSchema: { slug: z.string() },
      outputSchema: {
        ...envelopeSchema,
        found: z.boolean(),
        batch: z
          .object({
            slug: z.string(),
            title: z.string(),
            kind: z.string(),
            description: z.string().nullable(),
            items: z.array(
              z.object({
                id: z.number(),
                ref_type: z.string(),
                ref_id: z.number().nullable(),
                ref_key: z.string().nullable(),
                idea_text: z.string().nullable(),
              }),
            ),
            url: z.string(),
          })
          .optional(),
      },
    },
    async ({ slug }) => {
      if (!hasScope(auth, 'read')) {
        return respond(
          { found: false },
          { summary: "This token has no 'read' scope — re-authorize with the read scope." },
        );
      }
      const batch = getBatchBySlug(slug);
      if (!batch || !canViewBatch(batch, auth.userId)) {
        return respond(
          { found: false },
          {
            summary: `No batch "${slug}".`,
            next: [{ tool: 'list_batches', arguments: {}, reason: 'list valid slugs' }],
          },
        );
      }
      const items = getBatchItems(batch.id);
      return respond(
        {
          found: true,
          batch: {
            slug: batch.slug,
            title: batch.title,
            kind: batch.kind,
            description: batch.description ?? null,
            items: items.map((i) => ({
              id: i.id,
              ref_type: i.refType,
              ref_id: i.refId ?? null,
              ref_key: i.refKey ?? null,
              idea_text: i.ideaText ?? null,
            })),
            url: urls.batch(batch.slug),
          },
        },
        {
          summary: `"${batch.title}" — ${items.length} items.`,
          next: [
            { tool: 'run_batch', arguments: { slug, op: 'debate' }, reason: 'debate every item' },
            { tool: 'run_batch', arguments: { slug, op: 'plan' }, reason: 'generate plans for opportunity items' },
          ],
        },
      );
    },
  );

  server.registerTool(
    'create_batch',
    {
      description: 'Create a private workspace batch for the authenticated user.',
      inputSchema: {
        title: z.string().min(2).max(120),
        description: z.string().max(500).optional(),
      },
      outputSchema: {
        ...envelopeSchema,
        ok: z.boolean(),
        slug: z.string().optional(),
        url: z.string().optional(),
        error: z.string().optional(),
      },
    },
    async ({ title, description }) => {
      if (!auth.userId) {
        return respond({ ok: false, error: 'auth required' }, { summary: 'create_batch requires OAuth.' });
      }
      if (!hasScope(auth, 'batches')) {
        return respond(
          { ok: false, error: "this token lacks the 'batches' scope" },
          { summary: "This token has no 'batches' scope — re-authorize with the batches scope to create and run batches." },
        );
      }
      const gate = can({ id: auth.userId }, 'batch_create');
      if (!gate.ok) {
        return respond({ ok: false, error: gate.reason }, { summary: gate.reason ?? 'quota' });
      }
      try {
        const batch = createWorkspaceBatch(auth.userId, title, description);
        return respond(
          { ok: true, slug: batch.slug, url: urls.batch(batch.slug) },
          {
            summary: `Created batch "${batch.title}".`,
            next: [
              {
                tool: 'add_to_batch',
                arguments: { slug: batch.slug, ref_type: 'idea', idea_text: '…' },
                reason: 'add an idea',
              },
            ],
          },
        );
      } catch (e) {
        return respond({ ok: false, error: e instanceof Error ? e.message : 'failed' }, { summary: 'create failed' });
      }
    },
  );

  server.registerTool(
    'add_to_batch',
    {
      description: 'Add an opportunity, story, entity, or free-text idea to a batch.',
      inputSchema: {
        slug: z.string(),
        ref_type: z.enum(['opportunity', 'story', 'entity', 'idea']),
        ref_id: z.number().int().optional(),
        ref_key: z.string().optional(),
        idea_text: z.string().optional(),
      },
      outputSchema: {
        ...envelopeSchema,
        ok: z.boolean(),
        item_id: z.number().optional(),
        error: z.string().optional(),
      },
    },
    async ({ slug, ref_type, ref_id, ref_key, idea_text }) => {
      if (!auth.userId) {
        return respond({ ok: false, error: 'auth required' }, { summary: 'auth required' });
      }
      const batch = getBatchBySlug(slug);
      // System drops (ownerId null) are curated: read-only for everyone.
      if (!batch || !canModifyBatch(batch, auth.userId)) {
        return respond({ ok: false, error: 'batch not found or not owned' }, { summary: 'not found' });
      }
      if (!hasScope(auth, 'batches')) {
        return respond(
          { ok: false, error: "this token lacks the 'batches' scope" },
          { summary: "This token has no 'batches' scope — re-authorize with the batches scope to add items." },
        );
      }
      const item = addToBatch(batch.id, {
        refType: ref_type,
        refId: ref_id,
        refKey: ref_key,
        ideaText: idea_text,
      });
      return respond(
        { ok: true, item_id: item.id },
        {
          summary: `Added ${ref_type} to ${slug}.`,
          next: [{ tool: 'get_batch', arguments: { slug }, reason: 'confirm contents' }],
        },
      );
    },
  );

  server.registerTool(
    'run_batch',
    {
      description:
        'Run debate or plan across every item in a batch. Requires Builder+ for bulk runs.',
      inputSchema: {
        slug: z.string(),
        op: z.enum(['debate', 'plan', 'scout']),
      },
      outputSchema: {
        ...envelopeSchema,
        ok: z.boolean(),
        run_id: z.number().optional(),
        status: z.string().optional(),
        stats: z.string().nullable().optional(),
        error: z.string().optional(),
      },
    },
    async ({ slug, op }) => {
      if (!auth.userId) {
        return respond({ ok: false, error: 'auth required' }, { summary: 'auth required' });
      }
      const batch = getBatchBySlug(slug);
      if (!batch || !canModifyBatch(batch, auth.userId)) {
        return respond({ ok: false, error: 'not found' }, { summary: 'batch not found' });
      }
      if (!hasScope(auth, 'batches')) {
        return respond(
          { ok: false, error: "this token lacks the 'batches' scope" },
          { summary: "This token has no 'batches' scope — re-authorize with the batches scope to run batches." },
        );
      }
      try {
        const run = await runBatchOp(batch.id, op, auth.userId);
        return respond(
          { ok: true, run_id: run.id, status: run.status, stats: run.stats },
          {
            summary: `Batch run ${run.status}${run.stats ? ` (${run.stats})` : ''}.`,
            next: [{ tool: 'get_batch_run', arguments: { run_id: run.id }, reason: 'per-item results' }],
          },
        );
      } catch (e) {
        return respond({ ok: false, error: e instanceof Error ? e.message : 'failed' }, { summary: 'run failed' });
      }
    },
  );

  server.registerTool(
    'get_batch_run',
    {
      description: 'Status and per-item results for a batch run.',
      inputSchema: { run_id: z.number().int() },
      outputSchema: {
        ...envelopeSchema,
        found: z.boolean(),
        run: z
          .object({
            id: z.number(),
            op: z.string(),
            status: z.string(),
            stats: z.string().nullable(),
            error: z.string().nullable(),
          })
          .optional(),
      },
    },
    async ({ run_id }) => {
      if (!hasScope(auth, 'read')) {
        return respond(
          { found: false },
          { summary: "This token has no 'read' scope — re-authorize with the read scope." },
        );
      }
      const run = getDb().select().from(batchRuns).where(eq(batchRuns.id, run_id)).get();
      const batch = run
        ? getDb().select().from(batches).where(eq(batches.id, run.batchId)).get()
        : null;
      if (!run || !batch || !auth.userId || !canModifyBatch(batch, auth.userId)) {
        return respond({ found: false }, { summary: `No run ${run_id}.` });
      }
      return respond(
        {
          found: true,
          run: {
            id: run.id,
            op: run.op,
            status: run.status,
            stats: run.stats ?? null,
            error: run.error ?? null,
          },
        },
        { summary: `Run ${run.id}: ${run.status}.` },
      );
    },
  );
}
