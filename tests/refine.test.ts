import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { _setFetch } from '@/lib/llm/minimax';
import type { LeadRow } from '@/lib/opportunities/leads';
import type { Primitive } from '@/lib/opportunities/primitives';
import { refineLeads } from '@/lib/opportunities/refine';
import { useTestDb } from './helpers/db';

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

describe('refineLeads LLM failure', () => {
  beforeEach(() => {
    useTestDb();
    vi.stubEnv('MINIMAX_API_KEY', 'test-key');
  });

  afterEach(() => {
    _setFetch(globalThis.fetch);
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('logs the error instead of silently returning empty drafts', async () => {
    // non-retryable provider failure — chatJSON throws without backoff
    _setFetch((async () => ({ ok: false, status: 400 }) as Response) as unknown as typeof fetch);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await refineLeads({ leads: [lead('review-queue-triage')], primitives: PRIMITIVES, userId: 1 });

    expect(res).toEqual({ drafts: [], rejects: [] });
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('[refine]'), expect.anything());
  });
});
