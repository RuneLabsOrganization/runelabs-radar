import { createElement, type ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import CommercialResearch from '@/components/CommercialResearch';
import { commercialFixture } from './fixtures/opportunity-commercial';

const paid = { ...commercialFixture.cac!, channel: 'Paid search', usd: { low: 100, base: 150, high: 200 } };
const referral = { ...paid, channel: 'Referrals', usd: { low: 20, base: 50, high: 100 } };
const mix = {
  weights: [
    { channel: paid.channel, favorable: 25, base: 50, adverse: 75 },
    { channel: referral.channel, favorable: 75, base: 50, adverse: 25 },
  ],
  usd: { low: 40, base: 100, high: 175 },
  assumptions: 'Paid search supplies more customers in the adverse scenario.', sourceIds: ['S1'],
};
const modeled = { ...paid, kind: 'scenario' as const, channel: 'Blended CAC', usd: mix.usd };
const observed = { ...paid, kind: 'observed' as const, usd: { low: 82, base: 82, high: 82 } };
const bootstrap = { points: 6.5, initialCostUsd: 0, monthlyCostUsd: 150, days: 7,
  daysBasis: 'paid pilot' as const, assumptions: 'Cash covers setup and one month of operation.' };
const channels = { ...commercialFixture, cacChannels: [paid, referral] };
const render = (profile: ComponentProps<typeof CommercialResearch>['profile']) =>
  renderToStaticMarkup(createElement(CommercialResearch, { profile }));
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

it('shows the blended cost, every channel share, assumptions and the linked evidence together', () => {
  const html = render({ ...channels, cac: modeled, channelMix: mix });
  const table = text(html.match(/<table\b[^>]*>[\s\S]*?<\/table>/)?.[0] ?? '');
  expect(table).toContain('% of new paying customers acquired via modeled routes');
  expect(table).toContain('Channel Favorable Base Adverse');
  expect(table).toContain('Paid search 25% 50% 75%');
  expect(table).toContain('Referrals 75% 50% 25%');
  expect(text(html)).toContain('Blended CAC $100 base ($40 low · $175 high)');
  expect(html).toMatch(/adverse scenario\.\s*<a[^>]+href="https:\/\/example.org\/studios"/);
  expect(text(html)).toContain('Payback uses the high blended CAC of $175 per new paying customer.');
  expect(html).not.toContain('Primary channel for ranking');
});

it('shows a matched observation as evidence when a mix supplies the payback input', () => {
  const html = text(render({ ...channels, cac: observed, channelMix: mix }));
  expect(html).toContain('Observed CAC for the matched cohort · $82');
  expect(html).toContain('Cohort evidence only.');
  expect(html).toContain('Payback uses the high blended CAC of $175');
  expect(html).not.toContain('Payback uses the observed CAC');
});

it('identifies a matched benchmark beside a modeled canonical CAC', () => {
  const html = text(render({ ...channels, cac: modeled, channelMix: mix, cacReferences: [{
    publisher: 'Survey', geography: 'Canada', scope: 'matched', cohort: 'Studios', period: '2025',
    channel: 'Paid search', methodology: 'Median cost per new customer.', unit: 'paying customer', usd: 82, sourceIds: ['S1'],
  }] }));
  expect(html).toContain('Matched paying-customer CAC benchmark · $82 per paying customer');
  expect(html).toContain('Cohort evidence only.');
  expect(html).toContain('Payback uses the high blended CAC of $175');
});

it('preserves observed, primary-channel and standalone payback labels on older dossiers', () => {
  expect(text(render({ ...channels, cac: observed }))).toContain('Payback uses the observed CAC of $82');
  expect(text(render({ ...channels, cac: { ...paid, kind: 'scenario' } })))
    .toContain('Primary channel for ranking. Payback uses $200');
  const legacy = text(render(commercialFixture));
  expect(legacy).toContain('Payback uses the high CAC of $20');
  expect(legacy).toContain('Shorter pilots add up to 10');
  expect(legacy).not.toContain('Bootstrapping');
});

it('shows bootstrap points, zero cash, monthly cost, timing basis and the stored methodology', () => {
  const html = text(render({ ...commercialFixture, bootstrap }));
  for (const expected of ['Bootstrapping', '6.5/10 points', 'Initial cash estimate $0', 'Monthly cash estimate $150',
    'Time to paid pilot 7 days', bootstrap.assumptions, 'Bootstrapping adds up to 10']) expect(html).toContain(expected);
  expect(html).not.toContain('Shorter pilots add up to 10');
  expect(text(render({ ...commercialFixture, bootstrap: { ...bootstrap, days: 1, daysBasis: 'MVP' } })))
    .toContain('Time to MVP 1 day');
});

it('labels missing bootstrap estimates as unknown', () => {
  const html = text(render({ ...commercialFixture, bootstrap: { ...bootstrap, initialCostUsd: null,
    monthlyCostUsd: null, days: null, daysBasis: null, points: 0 } }));
  for (const expected of ['0/10 points', 'Initial cash estimate Unknown', 'Monthly cash estimate Unknown', 'Time estimate Unknown']) {
    expect(html).toContain(expected);
  }
});
