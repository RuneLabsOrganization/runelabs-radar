import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import CommercialResearch from '@/components/CommercialResearch';
import { commercialScore, compareOpportunities } from '@/lib/opportunities/ranking';
import type { OppKpis } from '@/lib/opportunities/engine';
import { businessModels } from '@/lib/opportunities/commercial';
import { commercialFixture as profile } from './fixtures/opportunity-commercial';

const kpis: OppKpis = {
  commercial: profile, priceUsd: 20, monthlyCostUsd: 100, initialCostUsd: null,
  timeToMvpDays: null, breakEvenCustomers: 50, competitorCount: null, competitionNote: null, regulatoryNote: null,
};
const rank = (k: OppKpis | null) => commercialScore(60, 60, k);

describe('commercial ranking', () => {
  it('uses identical evidence and economics across models and geographies', () => {
    for (const businessModel of businessModels) {
      expect(rank({ ...kpis, commercial: { ...profile, businessModel, geography: 'Japan' } })).toBe(rank(kpis));
    }
  });

  it('uses the adverse CAC and market scenarios, AI usage and pilot time', () => {
    const worse = [
      { ...profile, cac: { ...profile.cac!, usd: { low: 5, base: 10, high: 1000 } } },
      { ...profile, market: { ...profile.market!, buyerCounts: { low: 50, base: 3000, high: 4000 } } },
      { ...profile, execution: { ...profile.execution!, pilotDays: 90 } },
      { ...profile, execution: { ...profile.execution!, ai: { ...profile.execution!.ai!, tasksPerCustomerMonth: 200000 } } },
      { ...profile, competition: undefined },
    ];
    for (const commercial of worse) expect(rank({ ...kpis, commercial })).toBeLessThan(rank(kpis));
  });

  it('assigns only baseline points to unresearched rows and keeps a stable tie order', () => {
    expect(rank(null)).toBe(30);
    expect(rank({ ...kpis, commercial: undefined })).toBe(30);
    const a = { id: 1, commercialScore: 70, flipScore: 10, holdScore: 90, verdict: 'watch' };
    const b = { ...a, id: 2, flipScore: 90, holdScore: 10 };
    const rejected = { ...a, id: 3, commercialScore: 100, verdict: 'reject' };
    expect([rejected, b, a].sort(compareOpportunities)).toEqual([a, b, rejected]);
    expect(compareOpportunities(a, b, 'flip')).toBeGreaterThan(0);
    expect(compareOpportunities(a, b, 'hold')).toBeLessThan(0);
  });

  it('compares unit margins even while CAC is unknown', () => {
    const noCac = { ...profile, cac: undefined };
    const expensive = {
      ...noCac,
      execution: { ...profile.execution!, ai: { ...profile.execution!.ai!, tasksPerCustomerMonth: 200000 } },
    };
    expect(rank({ ...kpis, commercial: noCac })).toBeGreaterThan(rank({ ...kpis, commercial: expensive }));
  });
});

describe('commercial dossier', () => {
  it('keeps assumptions, provenance and geography with the scenarios', () => {
    const html = renderToStaticMarkup(React.createElement(CommercialResearch, { profile }));
    for (const expected of [
      'prosumer', 'Canada', 'Studio owners', '3,000 base', '$10 base',
      profile.market!.assumptions, profile.cac!.channel, profile.execution!.assumptions,
      'Example model', '$0.0002', '20 tasks per customer per month', 'Batch retouching',
      'href="https://example.org/studios"', '2026-08-20', 'publication date unknown', '2026-08-01',
    ]) expect(html).toContain(expected);
  });

  it('discloses missing research and partial estimates', () => {
    const legacy = renderToStaticMarkup(React.createElement(CommercialResearch));
    expect(legacy).toContain('provisional score');
    const partial = renderToStaticMarkup(React.createElement(CommercialResearch, {
      profile: { ...profile, market: undefined, cac: undefined },
    }));
    expect(partial).toContain('Reachable buyer count unknown');
    expect(partial).toContain('acquisition cost unknown');
  });

  it('prefers researched audience fields and fills only missing fields from the proposal', () => {
    const html = renderToStaticMarkup(React.createElement(CommercialResearch, {
      profile: { ...profile, user: undefined },
      audience: { businessModel: 'B2B', industry: 'Old industry', user: 'Working photographers', payer: 'Old payer' },
    }));
    expect(html).toContain('prosumer');
    expect(html).toContain('Working photographers');
    expect(html).toContain('Studio owners');
    expect(html).not.toContain('Old industry');
    expect(html).not.toContain('Old payer');
  });
});
