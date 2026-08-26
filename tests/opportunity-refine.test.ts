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
});
