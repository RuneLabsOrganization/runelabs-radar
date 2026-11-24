import Database from 'better-sqlite3';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { applyComparableEconomics } from '../src/lib/opportunities/comparable-economics';
import { commercialFixture } from './fixtures/opportunity-commercial';
import { applyRefresh, planRefresh, parseArgs } from '../scripts/refresh-finalist-economics';

vi.mock('../src/lib/opportunities/comparable-economics', () => ({ applyComparableEconomics: vi.fn() }));

let db: Database.Database;
const rawProfile = { ...commercialFixture, extra: 1, market: { ...commercialFixture.market!, legacy: true } };
const original = JSON.stringify({ commercial: rawProfile, priceUsd: 50, opaque: { flag: 42 } }, null, 2);
beforeEach(() => {
  db = new Database(':memory:');
  db.exec(`CREATE TABLE opportunities (
    id INTEGER PRIMARY KEY, owner_user_id INTEGER, status TEXT, verdict TEXT,
    flip_score INTEGER, hold_score INTEGER, kpis TEXT, untouched TEXT DEFAULT 'original'
  )`);
  const insert = db.prepare('INSERT INTO opportunities VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  for (const id of [1, 2, 3, 4, 5, 6]) {
    insert.run(id, id === 4 ? 77 : null, id === 5 ? 'closed' : 'active', id === 6 ? 'reject' : 'watch',
      55, 55, [4, 5].includes(id) ? 'sensitive sentinel' : original, 'original');
  }
  vi.mocked(applyComparableEconomics).mockReset().mockImplementation((profile, price) => {
    expect(price).toBe(50);
    return { ...profile, market: { ...profile.market!, assumptions: 'Matched buyer counts.' },
      cac: { ...profile.cac!, usd: { low: 1, base: 1, high: 1 } } };
  });
});
afterEach(() => db.close());

it('previews only requested finalists against the full public active ranking, then applies once', () => {
  const rows = () => db.prepare('SELECT * FROM opportunities ORDER BY id').all() as { kpis: string; untouched: string }[];
  const before = rows();
  const plan = planRefresh(db, [3]);
  expect(rows()).toEqual(before);
  expect(plan.report.activePublic).toBe(4);
  expect(plan.report.publicRanking.map(r => [r.id, r.beforeRank, r.afterRank])).toEqual([
    [1, 1, 2], [2, 2, 3], [3, 3, 1], [6, 4, 4],
  ]);
  expect(plan.report.finalists[0]).toMatchObject({ id: 3, before: { rank: 3 }, after: { rank: 1 } });
  expect(applyRefresh(db, plan)).toBe(1);
  const stored = rows();
  expect(stored.filter((_, i) => i !== 2)).toEqual(before.filter((_, i) => i !== 2));
  expect(stored[2].untouched).toBe('original');
  expect(JSON.parse(stored[2].kpis)).toMatchObject({ opaque: { flag: 42 }, commercial: {
    extra: 1, market: { legacy: true, assumptions: 'Matched buyer counts.' },
  } });
  const replay = planRefresh(db, [3]);
  expect(applyRefresh(db, replay)).toBe(0);
  expect(rows()).toEqual(stored);
});

it('reports unavailable IDs identically and refuses a partial batch', () => {
  const plan = planRefresh(db, [1, 4, 5, 99]);
  expect(plan.report.unavailableIds).toEqual([4, 5, 99]);
  expect(JSON.stringify(plan.report)).not.toContain('sensitive sentinel');
  expect(applyComparableEconomics).toHaveBeenCalledTimes(1);
  expect(() => applyRefresh(db, plan)).toThrow();
  expect(db.prepare('SELECT kpis FROM opportunities WHERE id=1').pluck().get()).toBe(original);
});

it('leaves an unmatched proposal byte-for-byte intact', () => {
  vi.mocked(applyComparableEconomics).mockImplementation(p => p);
  const plan = planRefresh(db, [2]);
  expect(plan.report.finalists[0].changedFields).toEqual([]);
  expect(applyRefresh(db, plan)).toBe(0);
  expect(db.prepare('SELECT kpis FROM opportunities WHERE id=2').pluck().get()).toBe(original);
});

it('reports malformed legacy KPIs and blocks the batch before writing', () => {
  db.prepare('UPDATE opportunities SET kpis=? WHERE id=2').run('{');
  const plan = planRefresh(db, [1, 2]);
  expect(plan.report.mismatches).toEqual(['ID 2: Missing or invalid stored commercial profile.']);
  expect(() => applyRefresh(db, plan)).toThrow();
  expect(db.prepare('SELECT kpis FROM opportunities WHERE id=1').pluck().get()).toBe(original);
});

it('detects stale ranking inputs and rolls back a batch when a stored result differs', () => {
  const stale = planRefresh(db, [1, 2]);
  db.exec('UPDATE opportunities SET hold_score=80 WHERE id=3');
  expect(() => applyRefresh(db, stale)).toThrow(/changed/i);
  const fresh = planRefresh(db, [1, 2]);
  db.exec(`CREATE TRIGGER interfere AFTER UPDATE OF kpis ON opportunities WHEN NEW.id=2
    BEGIN UPDATE opportunities SET kpis='{}' WHERE id=2; END`);
  expect(() => applyRefresh(db, fresh)).toThrow(/mismatch/i);
  expect(db.prepare('SELECT kpis FROM opportunities WHERE id IN (1,2)').pluck().all()).toEqual([original, original]);
});

it('requires explicit positive IDs and defaults to dry run', () => {
  expect(parseArgs(['578', '580', '579'])).toEqual({ ids: [578, 580, 579], apply: false });
  expect(parseArgs(['578', '--apply'])).toEqual({ ids: [578], apply: true });
  for (const argv of [[], ['--apply'], ['0'], ['1abc'], ['--all'], ['1', '1']]) {
    expect(() => parseArgs(argv)).toThrow();
  }
});

it('runs the real CLI on a temporary .env-selected database and preserves the preview on apply', () => {
  const dir = mkdtempSync(join(tmpdir(), 'finalist-economics-'));
  const path = join(dir, 'fixture.db');
  try {
    const profile = { ...rawProfile, geography: 'United States', industry: 'Shopify analytics',
      payer: 'Shopify merchant', competition: [{ name: 'Elevar', offering: 'Conversion tracking', sourceIds: ['V1'] }],
      sources: [...rawProfile.sources, { ...rawProfile.sources[0], id: 'V1', title: 'Elevar',
        url: 'https://apps.shopify.com/gtm-datalayer-by-elevar', legacyEvidence: true }] };
    db.prepare('UPDATE opportunities SET kpis=? WHERE id=1').run(JSON.stringify({ priceUsd: 99, commercial: profile }));
    db.prepare('VACUUM INTO ?').run(path);
    writeFileSync(join(dir, '.env'), 'DATABASE_PATH=fixture.db\n');
    const env = { ...process.env };
    delete env.DATABASE_PATH;
    const cli = (...args: string[]) => JSON.parse(execFileSync(process.execPath, [
      require.resolve('tsx/cli'), '--tsconfig', resolve('tsconfig.json'),
      resolve('scripts/refresh-finalist-economics.ts'), '1', '2', ...args,
    ], { cwd: dir, env, encoding: 'utf8', timeout: 15_000 }));

    const bytes = readFileSync(path);
    const preview = cli();
    expect(preview).toMatchObject({ mode: 'dry-run', activePublic: 4, updated: 0, changed: 1, mismatches: [] });
    expect(readFileSync(path).equals(bytes)).toBe(true);
    expect(preview.finalists[0].after.coverage.acquisitionChannels).toBeGreaterThan(0);
    expect(preview.finalists[0].after.market.buyerCounts).not.toEqual(rawProfile.market.buyerCounts);
    expect(preview.finalists[1].changedFields).toEqual([]);
    expect(cli('--apply')).toMatchObject({ updated: 1, finalists: preview.finalists });
    expect(cli('--apply')).toMatchObject({ updated: 0, changed: 0, mismatches: [] });
    const stored = new Database(path, { readonly: true });
    try {
      const kpis = JSON.parse(stored.prepare<[], string>('SELECT kpis FROM opportunities WHERE id=1').pluck().get()!);
      expect(kpis.commercial.sources.find((s: { id: string }) => s.id === 'V1').legacyEvidence).toBe(true);
      expect(kpis.commercial.market.legacy).toBe(true);
    } finally {
      stored.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 30_000);
