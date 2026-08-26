import { beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { refineLeads } from '@/lib/opportunities/refine';
import type { LeadRow } from '@/lib/opportunities/leads';
import type { Primitive } from '@/lib/opportunities/primitives';
import { persistScoutDrafts } from '@/lib/opportunities/persist-scout';
import { SUB_KEYS } from '@/lib/opportunities/engine';
import { llmCalls, opportunities } from '@/lib/db/schema';
import { getDb } from '@/lib/db';
import { _setFetch } from '@/lib/llm/minimax';
import { seedUser, useTestDb } from './helpers/db';

function lead(slug: string, id = 1): LeadRow {
  return {
    id, slug, title: `Title for ${slug}`,
    thesisSkeleton: 'A composed skeleton awaiting refinement.',
    sector: 'devtools', primitiveRefs: ['P1'],
    wedge: {
      business_model: 'subscription-saas', delivery_form: 'cli-tool',
      buyer: 'solo-builder', moat_play: 'workflow-lock-in',
    },
    heuristicScore: 60, combinationIndex: 7, stage: 'composed',
    evidenceSnapshot: [],
    opportunityId: null, createdAt: new Date(), dismissedAt: null, dismissReason: null,
  };
}

const PRIMITIVES: Primitive[] = [
  { ref: 'P1', type: 'pain', label: 'Code review backlogs block small teams', sector: 'devtools', tags: ['devtools'], intensity: 70 },
];

/** Reply the model would send for one opening. */
function modelReply(slug: string) {
  // Loose value type so coercion/rejection tests can plant malformed LLM shapes.
  const subScores: Record<string, unknown> = Object.fromEntries(SUB_KEYS.map((k) => [k, 12]));
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
    const { drafts } = await refineLeads({
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
    const { drafts } = await refineLeads({
      leads: [lead('bogus-refs')], primitives: PRIMITIVES, userId: 1,
    });
    expect(drafts[0]?.evidenceRefs ?? []).not.toContain('Z99');
  });

  it('returns nothing rather than throwing when the model returns junk', async () => {
    stubLlm({ openings: 'not an array' });
    const { drafts } = await refineLeads({
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
    const { drafts } = await refineLeads({ leads: [], primitives: PRIMITIVES, userId: 1 });
    expect(drafts).toEqual([]);
    expect(called).toBe(false);
  });

  it('records a reject naming the missing sub-score key', async () => {
    const reply = modelReply('missing-quality-bar');
    const { qualityBar: _, ...rest } = reply.openings[0].subScores as Record<string, number>;
    reply.openings[0].subScores = rest;
    stubLlm(reply);
    const { drafts, rejects } = await refineLeads({
      leads: [lead('missing-quality-bar')], primitives: PRIMITIVES, userId: 1,
    });
    expect(drafts).toHaveLength(0);
    expect(rejects.some((r) => r.reason === 'missing-or-invalid-sub-score:qualityBar')).toBe(true);
  });

  it('records a thesis-too-short reject for a 20-character thesis', async () => {
    const reply = modelReply('short-thesis-lead');
    reply.openings[0].thesis = '12345678901234567890';
    stubLlm(reply);
    const { drafts, rejects } = await refineLeads({
      leads: [lead('short-thesis-lead')], primitives: PRIMITIVES, userId: 1,
    });
    expect(drafts).toHaveLength(0);
    expect(rejects.some((r) => r.reason === 'thesis-too-short')).toBe(true);
  });

  it('yields no rejects for a fully valid reply', async () => {
    stubLlm(modelReply('review-queue-triage'));
    const { drafts, rejects } = await refineLeads({
      leads: [lead('review-queue-triage')], primitives: PRIMITIVES, userId: 1,
    });
    expect(drafts).toHaveLength(1);
    expect(rejects).toEqual([]);
  });

  it('drops a rewritten slug as slug-not-in-candidates', async () => {
    stubLlm(modelReply('rewritten-by-the-model'));
    const { drafts, rejects } = await refineLeads({
      leads: [lead('original-candidate-slug')], primitives: PRIMITIVES, userId: 1,
    });
    expect(drafts).toHaveLength(0);
    expect(rejects.some((r) => r.reason === 'slug-not-in-candidates')).toBe(true);
  });

  it('records empty-array when openings is present but vacant', async () => {
    stubLlm({ openings: [] });
    const { drafts, rejects } = await refineLeads({
      leads: [lead('review-queue-triage')], primitives: PRIMITIVES, userId: 1,
    });
    expect(drafts).toHaveLength(0);
    expect(rejects).toEqual([{ slug: '(payload)', reason: 'empty-array' }]);
  });

  it('accepts a valid opening under the opportunities alias', async () => {
    const reply = modelReply('review-queue-triage');
    stubLlm({ opportunities: reply.openings });
    const { drafts, rejects } = await refineLeads({
      leads: [lead('review-queue-triage')], primitives: PRIMITIVES, userId: 1,
    });
    expect(drafts).toHaveLength(1);
    expect(drafts[0].slug).toBe('review-queue-triage');
    expect(rejects).toEqual([]);
  });

  it('accepts a bare top-level array of one valid opening', async () => {
    const reply = modelReply('review-queue-triage');
    stubLlm(reply.openings);
    const { drafts } = await refineLeads({
      leads: [lead('review-queue-triage')], primitives: PRIMITIVES, userId: 1,
    });
    expect(drafts).toHaveLength(1);
    expect(drafts[0].slug).toBe('review-queue-triage');
  });

  it('records not-an-array:undefined when no array payload is present', async () => {
    stubLlm({ result: 'no' });
    const { drafts, rejects } = await refineLeads({
      leads: [lead('review-queue-triage')], primitives: PRIMITIVES, userId: 1,
    });
    expect(drafts).toHaveLength(0);
    expect(rejects).toEqual([{ slug: '(payload)', reason: 'not-an-array:undefined' }]);
  });

  it('keeps a legitimate weak entry instead of dropping it', async () => {
    const reply = modelReply('weak-but-real');
    reply.openings[0].subScores = Object.fromEntries(SUB_KEYS.map((k) => [k, 6]));
    reply.openings[0].evidenceRefs = ['P1'];
    stubLlm(reply);
    const { drafts } = await refineLeads({
      leads: [lead('weak-but-real')], primitives: PRIMITIVES, userId: 1,
    });
    expect(drafts).toHaveLength(1);
    expect(drafts[0].slug).toBe('weak-but-real');
    expect(drafts[0].evidenceRefs).toEqual(['P1']);
    for (const k of SUB_KEYS) expect(drafts[0].sub[k]).toBe(6);
  });

  it('does not warn on a 1:1 low-score reply', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const a = modelReply('alpha-lead');
    const b = modelReply('beta-lead');
    a.openings[0].subScores = Object.fromEntries(SUB_KEYS.map((k) => [k, 5]));
    b.openings[0].subScores = Object.fromEntries(SUB_KEYS.map((k) => [k, 7]));
    stubLlm({ openings: [a.openings[0], b.openings[0]] });
    const { drafts } = await refineLeads({
      leads: [lead('alpha-lead', 1), lead('beta-lead', 2)],
      primitives: PRIMITIVES,
      userId: 1,
    });
    expect(drafts).toHaveLength(2);
    expect(warn.mock.calls.some(([msg]) => String(msg).includes('drafts from'))).toBe(false);
    warn.mockRestore();
  });

  it('warns on a shortfall in the 1:1 contract', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    stubLlm(modelReply('alpha-lead'));
    const { drafts } = await refineLeads({
      leads: [lead('alpha-lead', 1), lead('beta-lead', 2)],
      primitives: PRIMITIVES,
      userId: 1,
    });
    expect(drafts).toHaveLength(1);
    expect(warn.mock.calls.some(([msg]) =>
      String(msg).includes('1 drafts from 2 candidates'),
    )).toBe(true);
    warn.mockRestore();
  });

  it('lets the gate reject a weak single-source draft instead of dropping it', async () => {
    seedUser(getDb(), 1);
    const reply = modelReply('thin-evidence-lead');
    reply.openings[0].subScores = Object.fromEntries(SUB_KEYS.map((k) => [k, 6]));
    reply.openings[0].evidenceRefs = ['P1'];
    reply.openings[0].windowMonths = 2;
    reply.openings[0].window = '2 months';
    stubLlm(reply);
    const { drafts } = await refineLeads({
      leads: [lead('thin-evidence-lead')], primitives: PRIMITIVES, userId: 1,
    });
    expect(drafts).toHaveLength(1);

    const { persisted } = persistScoutDrafts(drafts, 1);
    expect(persisted).toHaveLength(1);
    const row = getDb()
      .select()
      .from(opportunities)
      .where(eq(opportunities.id, persisted[0]!.id))
      .get();
    expect(row?.confidence).toBeLessThanOrEqual(50);
    expect(row?.verdict).toBe('reject');
  });

  it('accepts string integer sub-scores as numbers', async () => {
    const reply = modelReply('string-scores');
    reply.openings[0].subScores = Object.fromEntries(SUB_KEYS.map((k) => [k, '12']));
    stubLlm(reply);
    const { drafts, rejects } = await refineLeads({
      leads: [lead('string-scores')], primitives: PRIMITIVES, userId: 1,
    });
    expect(drafts).toHaveLength(1);
    expect(rejects).toEqual([]);
    for (const k of SUB_KEYS) expect(drafts[0].sub[k]).toBe(12);
  });

  it('still rejects object-shaped sub-scores', async () => {
    const reply = modelReply('object-scores');
    reply.openings[0].subScores = { ...reply.openings[0].subScores, demand: { value: 12 } };
    stubLlm(reply);
    const { drafts, rejects } = await refineLeads({
      leads: [lead('object-scores')], primitives: PRIMITIVES, userId: 1,
    });
    expect(drafts).toHaveLength(0);
    expect(rejects.some((r) => r.reason === 'missing-or-invalid-sub-score:demand')).toBe(true);
  });

  it('still rejects non-numeric string sub-scores', async () => {
    const reply = modelReply('word-scores');
    reply.openings[0].subScores = { ...reply.openings[0].subScores, demand: 'twelve' };
    stubLlm(reply);
    const { drafts, rejects } = await refineLeads({
      leads: [lead('word-scores')], primitives: PRIMITIVES, userId: 1,
    });
    expect(drafts).toHaveLength(0);
    expect(rejects.some((r) => r.reason === 'missing-or-invalid-sub-score:demand')).toBe(true);
  });

  it('logs the raw sub-score shape on a mismatch', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const reply = modelReply('shape-mismatch');
    reply.openings[0].subScores = { ...reply.openings[0].subScores, demand: { value: 12 } };
    stubLlm(reply);
    await refineLeads({
      leads: [lead('shape-mismatch')], primitives: PRIMITIVES, userId: 1,
    });
    const shape = warn.mock.calls.map(([msg]) => String(msg)).find((m) => m.includes('sub-score shape mismatch'));
    expect(shape).toContain('shape-mismatch');
    expect(shape).toContain('"value":12');
    warn.mockRestore();
  });

  it('tags the llm_calls row with the requested feature', async () => {
    stubLlm(modelReply('review-queue-triage'));
    await refineLeads({
      leads: [lead('review-queue-triage')], primitives: PRIMITIVES, userId: 1, feature: 'scout',
    });
    const rows = getDb().select().from(llmCalls).all();
    expect(rows.some((r) => r.feature === 'scout')).toBe(true);
  });

  it('defaults the metering feature to lead_refine', async () => {
    stubLlm(modelReply('review-queue-triage'));
    await refineLeads({
      leads: [lead('review-queue-triage')], primitives: PRIMITIVES, userId: 1,
    });
    const rows = getDb().select().from(llmCalls).all();
    expect(rows.some((r) => r.feature === 'lead_refine')).toBe(true);
    expect(rows.some((r) => r.feature === 'scout')).toBe(false);
  });

  it('keeps a snapshot-backed lead pinned when a sibling legacy row has no snapshot', async () => {
    const pinned = lead('snap-lead', 1);
    pinned.evidenceSnapshot = [
      { ref: 'P1', type: 'pain', label: 'SNAPSHOT_PINNED_LABEL unique compose-time text' },
    ];
    const legacy = lead('legacy-lead', 2);
    legacy.primitiveRefs = ['P2'];
    legacy.evidenceSnapshot = [];

    const prims: Primitive[] = [
      {
        ref: 'P1', type: 'pain', label: 'LIVE_POOL_LABEL_FOR_P1 would steal the snapshot',
        sector: 'devtools', tags: ['devtools'], intensity: 70,
      },
      {
        ref: 'P2', type: 'pain', label: 'LIVE_POOL_LABEL_FOR_P2 legacy fallback',
        sector: 'devtools', tags: ['devtools'], intensity: 40,
      },
    ];

    const bodies: string[] = [];
    _setFetch(async (_url: unknown, init?: RequestInit) => {
      const parsed = JSON.parse(String(init?.body)) as { messages: { content: string }[] };
      bodies.push(parsed.messages.map((m) => m.content).join('\n'));
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify({ openings: [] }) } }],
          usage: { prompt_tokens: 10, completion_tokens: 10 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });

    await refineLeads({ leads: [pinned, legacy], primitives: prims, userId: 1 });
    const prompt = bodies.join('\n');
    expect(prompt).toContain('SNAPSHOT_PINNED_LABEL');
    expect(prompt).not.toContain('LIVE_POOL_LABEL_FOR_P1');
    expect(prompt).toContain('LIVE_POOL_LABEL_FOR_P2');
  });
});
