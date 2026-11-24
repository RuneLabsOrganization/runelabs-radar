import type { CommercialProfile } from '@/lib/opportunities/commercial';

export const commercialFixture: CommercialProfile = {
  businessModel: 'prosumer', geography: 'Canada', researchedAt: '2026-08-20T00:00:00Z',
  user: 'Contract photographers', payer: 'Studio owners', industry: 'Photography',
  sources: [
    { id: 'S1', title: 'Studio survey', url: 'https://example.org/studios', snippet: 'Survey of Canadian studios.', publishedAt: null },
    { id: 'S2', title: 'Model prices', url: 'https://example.org/pricing', snippet: 'Published token rates.', publishedAt: '2026-08-01T00:00:00Z' },
  ],
  market: {
    buyer: 'Canadian studios', buyerCounts: { low: 2400, base: 3000, high: 4000 },
    assumptions: 'Only studios offering digital retouching.', sourceIds: ['S1'],
  },
  cac: {
    channel: 'Studio referrals', usd: { low: 5, base: 10, high: 20 },
    assumptions: 'One paid referral per new customer.', sourceIds: ['S1'],
  },
  competition: [{ name: 'Studio suite', offering: 'Batch retouching', sourceIds: ['S1'] }],
  execution: {
    pilotDays: 14, assumptions: 'Two studios provide pilot images.',
    ai: {
      task: 'Label a photo', model: 'Example model', inputTokens: 100, outputTokens: 50,
      attemptsPerTask: 1, tasksPerCustomerMonth: 20, inputUsdPerMillion: 1,
      outputUsdPerMillion: 2, costPerTaskUsd: 0.0002, sourceIds: ['S2'],
    },
  },
};
