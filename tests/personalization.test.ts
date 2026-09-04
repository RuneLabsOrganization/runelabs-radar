import { describe, it, expect } from 'vitest';
import { tokenMatch, fitBonus, FIT_BONUS_MAX, type UserProfile, type AgentSessionMemory } from '@/lib/personalization';

const profile = (patch: Partial<UserProfile>): UserProfile => ({
  skills: [],
  interests: [],
  capitalBand: null,
  avoidedSectors: [],
  updatedAt: '2025-01-01T00:00:00.000Z',
  ...patch,
});

const session = (patch: Partial<AgentSessionMemory>): AgentSessionMemory => ({
  lastProject: null,
  lastOpportunity: null,
  watchTopics: [],
  updatedAt: '2025-01-01T00:00:00.000Z',
  ...patch,
});

const opp = {
  sector: 'coding',
  title: 'Rust agents toolkit',
  thesis: 'Build a Rust SDK for agent runtime orchestration.',
  slug: 'rust-agents-toolkit',
};

describe('tokenMatch — word-boundary matching', () => {
  it('rejects substring false positives', () => {
    expect(tokenMatch('governance tokens for daos', 'go')).toBe(false);
    expect(tokenMatch('a generator for images', 'gen')).toBe(false);
    expect(tokenMatch('a crusty prototype', 'rust')).toBe(false);
  });

  it('matches whole tokens', () => {
    expect(tokenMatch('build a rust sdk for agents', 'rust')).toBe(true);
    expect(tokenMatch('go routines in production', 'go')).toBe(true);
  });

  it('handles needles with non-word edges', () => {
    expect(tokenMatch('shipping c++ bindings', 'c++')).toBe(true);
    expect(tokenMatch('the node.js runtime', 'node.js')).toBe(true);
  });
});

describe('fitBonus', () => {
  it('"go" does not match "governance"', () => {
    const p = profile({ skills: ['go'] });
    expect(fitBonus(p, null, { ...opp, thesis: 'Governance tooling for DAO governance votes.' })).toBe(0);
  });

  it('"rust" matches "Rust SDK"', () => {
    const p = profile({ skills: ['rust'] });
    expect(fitBonus(p, null, opp)).toBe(3);
  });

  it('3-char skills no longer match inside unrelated words', () => {
    const p = profile({ skills: ['gen'] });
    expect(fitBonus(p, null, { ...opp, thesis: 'A generator for product images.' })).toBe(0);
  });

  it('interest in the sector boosts; avoided sector vetoes at −40', () => {
    expect(fitBonus(profile({ interests: ['coding'] }), null, opp)).toBe(12);
    expect(fitBonus(profile({ avoidedSectors: ['coding'] }), null, opp)).toBe(-40);
  });

  it('session signals stack: lastOpportunity + watch topic + project tokens', () => {
    const s = session({
      lastOpportunity: 'rust-agents-toolkit',
      watchTopics: ['orchestration'],
      lastProject: 'agent runtime',
    });
    // 4 (lastOpp) + 5 (watch topic token) + 4 (project tokens) — watch topic
    // "orchestration" matches the thesis as a whole token, not a substring
    expect(fitBonus(null, s, opp)).toBe(13);
  });

  it('caps at the reachable max (12+3+4+5+4), documented as [−40, FIT_BONUS_MAX]', () => {
    const p = profile({ interests: ['coding'], skills: ['rust'] });
    const s = session({
      lastOpportunity: 'rust-agents-toolkit',
      watchTopics: ['orchestration'],
      lastProject: 'agent runtime',
    });
    expect(FIT_BONUS_MAX).toBe(28);
    expect(fitBonus(p, s, opp)).toBe(FIT_BONUS_MAX);
  });

  it('returns 0 with no profile and no session', () => {
    expect(fitBonus(null, null, opp)).toBe(0);
  });
});
