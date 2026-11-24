import { createElement, type ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import CommercialResearch from '@/components/CommercialResearch';
import { bootstrapAssessment } from '@/lib/opportunities/bootstrap';
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

it('places the sourced solo pilot before market research and keeps its budget distinct from launch costs', () => {
  const soloPilot = { acquisitionCashUsd: 0 as const, founderHours: 52.265, expectedPayers: 0.31300000000000006, days: 90 as const,
    assumptions: 'Offer a paid trial to studios using the existing mailing list.', sourceIds: ['S1'] };
  const html = render({ ...channels, cac: modeled, channelMix: mix, bootstrap: { ...bootstrap, soloPilot,
    firstTenCashUsd: { low: 125, base: 385, high: 687.5 } } });
  const panel = html.match(/<section aria-label="Solo founder pilot"[^>]*>[\s\S]*?<\/section>/)?.[0] ?? '';
  expect(panel).toBeTruthy();
  expect(html.indexOf(panel)).toBeLessThan(html.indexOf('Reachable buyers'));
  expect(html.indexOf(panel)).toBeLessThan(html.indexOf('<details'));
  for (const expected of ['Acquisition spend $0', 'Founder time about 52 h', 'Expected paying customers 0.31 Pilot duration',
    'Pilot duration 90 days', soloPilot.assumptions, 'existing tools', 'build and operate the product',
    'The pilot may finish with zero paying customers.']) expect(text(panel)).toContain(expected);
  expect(panel).toContain('href="https://example.org/studios"');
  expect(panel).not.toContain('href="https://example.org/pricing"');
  expect(text(html)).toContain('All-in CAC includes the modeled cost of acquisition work per new paying customer.');
  expect(text(html)).toContain('Acquisition cash for the first 10 paying customers $385.00 base');
  expect(text(html)).toContain('Business viability score and ranking');
  expect(text(html)).toContain('When business viability scores tie, lower base acquisition cash for the first 10 paying customers');
});

it('omits the solo plan on older dossiers, including those with a bootstrap score', () => {
  for (const profile of [undefined, commercialFixture, { ...commercialFixture, bootstrap }]) {
    expect(render(profile)).not.toContain('Solo founder pilot');
  }
});

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

it('distinguishes launch cash from full CAC and shows the base used for scoring alongside the stress case', () => {
  const cash = { low: 50, base: 75, high: 90 };
  const profile = { ...channels, cac: modeled, channelMix: mix, cacChannels: [
    { ...paid, cashUsd: cash }, { ...referral, cashUsd: { low: 0, base: 2, high: 5 } },
  ] };
  const assessment = bootstrapAssessment({ initialCostUsd: 0, monthlyCostUsd: 150, timeToMvpDays: 30 }, profile);
  const html = text(render({ ...profile, bootstrap: assessment }));
  for (const expected of [
    'Launch cash per new paying customer $75.00 base ($50.00 low · $90.00 high)',
    'Launch cash per new paying customer $2.00 base ($0.00 low · $5.00 high)',
    'Acquisition cash for the first 10 paying customers $385.00 base ($125.00 low · $687.50 high)',
    'Total launch cash $835.00 base ($575.00 low · $1,137.50 high)',
    'build costs, a three-month operating reserve and acquisition spending for the first 10 paying customers.',
    'Reaching 10 by day 90 is not guaranteed. Later operating months require additional cash.',
    'The cash score uses the base launch estimate.', 'Actual customer counts and spending can vary.',
    'Payback uses the high blended CAC of $175', 'Excludes founder pay',
  ]) expect(html).toContain(expected);
});

it('discloses omitted acquisition and incomplete launch budgets without displaying a zero range', () => {
  const legacy = text(render({ ...commercialFixture, bootstrap }));
  expect(legacy).toContain('Acquisition cash for the first 10 paying customers is unavailable');
  const partial = text(render({ ...commercialFixture, bootstrap: { ...bootstrap, monthlyCostUsd: null,
    firstTenCashUsd: { low: 0, base: 1, high: 2 } } }));
  expect(partial).toContain('Total launch cash is unknown');
  expect(partial).not.toContain('The cash score uses the base launch estimate.');
});
