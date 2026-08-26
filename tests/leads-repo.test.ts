import { beforeEach, describe, expect, it } from 'vitest';
import {
  dismissLead, expireLeads, getLead, insertLeads, listLeads, markRefined,
} from '@/lib/opportunities/leads';
import type { LeadDraft } from '@/lib/opportunities/compose';
import { useTestDb } from './helpers/db';

function draft(slug: string, score = 50): LeadDraft {
  return {
    slug,
    title: `Title for ${slug}`,
    thesisSkeleton: 'A composed skeleton awaiting refinement.',
    sector: 'devtools',
    primitiveRefs: ['P1'],
    primitiveType: 'pain',
    wedge: {
      business_model: 'subscription-saas', delivery_form: 'cli-tool',
      buyer: 'solo-builder', moat_play: 'workflow-lock-in',
    },
    heuristicScore: score,
    combinationIndex: 42,
  };
}

const ALICE = { ownerKey: 'user:1', userId: 1 };
const ANON = { ownerKey: 'ip:9.9.9.9', userId: null };

describe('lead repository', () => {
  beforeEach(() => {
    useTestDb();
  });

  it('inserts and lists a caller own leads', () => {
    insertLeads(ALICE, [draft('a'), draft('b')]);
    const page = listLeads(ALICE, { limit: 10 });
    expect(page.leads).toHaveLength(2);
  });

  it('never leaks leads across owners', () => {
    insertLeads(ALICE, [draft('mine')]);
    insertLeads({ ownerKey: 'user:2', userId: 2 }, [draft('theirs')]);
    expect(listLeads(ALICE, { limit: 10 }).leads.map((l) => l.slug)).toEqual(['mine']);
    expect(getLead(ALICE, 'theirs')).toBeNull();
  });

  it('is idempotent on re-insert of the same slug', () => {
    insertLeads(ALICE, [draft('dupe')]);
    insertLeads(ALICE, [draft('dupe')]);
    expect(listLeads(ALICE, { limit: 10 }).leads).toHaveLength(1);
  });

  it('orders by heuristic score descending', () => {
    insertLeads(ALICE, [draft('low', 10), draft('high', 90), draft('mid', 50)]);
    expect(listLeads(ALICE, { limit: 10 }).leads.map((l) => l.slug))
      .toEqual(['high', 'mid', 'low']);
  });

  it('paginates with a cursor', () => {
    insertLeads(ALICE, Array.from({ length: 7 }, (_, i) => draft(`s${i}`, 100 - i)));
    const first = listLeads(ALICE, { limit: 3 });
    expect(first.leads).toHaveLength(3);
    expect(first.nextCursor).toBe(3);
    const second = listLeads(ALICE, { limit: 3, cursor: first.nextCursor! });
    expect(second.leads.map((l) => l.slug))
      .not.toEqual(expect.arrayContaining(first.leads.map((l) => l.slug)));
  });

  it('hides dismissed leads and records the reason', () => {
    insertLeads(ALICE, [draft('nope')]);
    expect(dismissLead(ALICE, 'nope', 'too capital heavy')).toBe(true);
    expect(listLeads(ALICE, { limit: 10 }).leads).toHaveLength(0);
    expect(getLead(ALICE, 'nope')?.dismissReason).toBe('too capital heavy');
  });

  it('marks a lead refined and back-links the opportunity', () => {
    const [row] = insertLeads(ALICE, [draft('promote-me')]);
    markRefined(row.id, 555);
    const after = getLead(ALICE, 'promote-me');
    expect(after?.stage).toBe('refined');
    expect(after?.opportunityId).toBe(555);
  });

  it('expires anonymous leads but keeps signed-in ones', () => {
    insertLeads(ANON, [draft('ephemeral')]);
    insertLeads(ALICE, [draft('durable')]);
    const later = new Date(Date.now() + 8 * 864e5);
    expect(expireLeads(later)).toBe(1);
    expect(listLeads(ALICE, { limit: 10 }).leads.map((l) => l.slug)).toEqual(['durable']);
  });
});
