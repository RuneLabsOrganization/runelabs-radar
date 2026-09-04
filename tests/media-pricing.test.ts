import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { useTestDb } from './helpers/db';
import { metricPoints } from '@/lib/db/schema';
import {
  MANUAL_MEDIA_FALLBACK,
  MEDIA_PRICING_SOURCE,
  parseMediaTable,
  runMediaPricingSync,
} from '@/lib/ingest/media-pricing';
import { matchPricedEntity } from '@/lib/kits/match-price';
import type { Db } from '@/lib/db';

const HTML = readFileSync(join(__dirname, 'fixtures/media-pricing/generic-table.html'), 'utf8');

describe('media pricing', () => {
  let db: Db;
  beforeEach(() => {
    db = useTestDb();
  });

  it('parses a price and its unit from a table', () => {
    const out = parseMediaTable(HTML, ['Kling 3.0', 'Seedream 5.0 Pro']);
    expect(out).toContainEqual({ tool: 'Kling 3.0', unit: 'per_second', amountUsd: 0.1 });
    expect(out).toContainEqual({ tool: 'Seedream 5.0 Pro', unit: 'per_image', amountUsd: 0.054 });
  });

  it('reads thousands-grouped prices in full — "$1,200/mo" is 1200, not 1', () => {
    // JUSTIFICATION (G2): the old [0-9]+ regex stopped at the comma and read
    // $1 — a seat price 1000× too low flowing into kit totals.
    const html = '<table><tr><td>HeyGen</td><td>$1,200/mo</td></tr></table>';
    expect(parseMediaTable(html, ['HeyGen'])).toEqual([{ tool: 'HeyGen', unit: 'per_month', amountUsd: 1200 }]);
  });

  it('expands a k/K suffix — "$20k" is 20000', () => {
    const html = '<table><tr><td>HeyGen</td><td>$20k per month</td></tr></table>';
    expect(parseMediaTable(html, ['HeyGen'])).toEqual([{ tool: 'HeyGen', unit: 'per_month', amountUsd: 20_000 }]);
  });

  it('pairs amount with the nearest unit after it — "$10/mo or $0.05/image" is (10, per_month)', () => {
    // JUSTIFICATION (G2): the old code took the first $ and the first unit
    // keyword anywhere in the joined row, mixing amounts and units.
    const html = '<table><tr><td>Ideogram 4</td><td>$10/mo or $0.05/image</td></tr></table>';
    expect(parseMediaTable(html, ['Ideogram 4'])).toEqual([
      { tool: 'Ideogram 4', unit: 'per_month', amountUsd: 10 },
    ]);
  });

  it('skips an amount with no unit inside the bounded window rather than guessing', () => {
    const html = '<table><tr><td>HeyGen</td><td>$29</td></tr></table>';
    expect(parseMediaTable(html, ['HeyGen'])).toEqual([]);
  });

  it('ignores models not asked for', () => {
    expect(parseMediaTable(HTML, ['Kling 3.0'])).toHaveLength(1);
  });

  it('records metric points for each parsed price', async () => {
    const stats = await runMediaPricingSync(async () => HTML);
    expect(stats.recorded).toBeGreaterThan(0);
    const rows = db.select().from(metricPoints).all();
    expect(rows.some((r) => r.source === MEDIA_PRICING_SOURCE && r.entity === 'Kling 3.0')).toBe(true);
  });

  it('falls back and flags when a page parses to nothing', async () => {
    const stats = await runMediaPricingSync(async () => '<html><body>no table</body></html>');
    expect(stats.fallback.length).toBeGreaterThan(0);
    expect(stats.recorded).toBeGreaterThan(0);
  });

  it('records a provider error without aborting the run', async () => {
    let n = 0;
    const stats = await runMediaPricingSync(async () => {
      if (n++ === 0) throw new Error('boom');
      return HTML;
    });
    expect(Object.keys(stats.errors)).toHaveLength(1);
    expect(stats.providers).toBeGreaterThan(0);
  });

  it('every fallback entry has a positive amount and a known unit', () => {
    for (const [key, prices] of Object.entries(MANUAL_MEDIA_FALLBACK)) {
      for (const p of prices) {
        expect(p.amountUsd, `${key}/${p.tool}`).toBeGreaterThan(0);
        expect(['per_image', 'per_second', 'per_month', 'per_1k_chars']).toContain(p.unit);
      }
    }
  });

  // Real production kit_picks names, verified against the fallback table so a
  // fallback entry can never silently drift out of stripQualifier-reachable
  // form again (the Wan 2.7 (Alibaba) mistake this test exists to catch).
  describe('fallback entries resolve against real production pick names', () => {
    const entities = Object.values(MANUAL_MEDIA_FALLBACK).flatMap((prices) => prices.map((p) => p.tool));

    it.each([
      ['Ideogram 4', 'Ideogram 4'],
      ['Veo 3.1 Preview (Google)', 'Veo 3.1 Preview'],
      ['Wan 2.7 (Alibaba)', 'Wan 2.7'],
    ])('%s -> %s', (pickName, expected) => {
      expect(matchPricedEntity(pickName, entities)).toBe(expected);
    });

    // The exact hazard this whole fallback was added to guard against.
    it('does not price the self-hosted Ideogram variant off the hosted entry', () => {
      expect(matchPricedEntity('Ideogram 4 (INT8 via ComfyUI)', entities)).toBeNull();
    });
  });
});
