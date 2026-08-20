import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { useTestDb } from './helpers/db';
import { upsertMetric } from '@/lib/metrics';
import { runDatasetDump, datasetPath, DATASET_FILENAME } from '@/lib/dump';

interface DumpRow {
  source: string;
  entity: string;
  metric: string;
  date: string;
  value: number;
}

let tmpDir: string;
let savedDbPath: string | undefined;
let savedAaPublic: string | undefined;

beforeEach(() => {
  useTestDb();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-dump-'));
  savedDbPath = process.env.DATABASE_PATH;
  savedAaPublic = process.env.AA_PUBLIC;
  // the dump lands next to the configured database file — point it at tmp
  process.env.DATABASE_PATH = path.join(tmpDir, 'radar.db');
  delete process.env.AA_PUBLIC;
});

afterEach(() => {
  if (savedDbPath === undefined) delete process.env.DATABASE_PATH;
  else process.env.DATABASE_PATH = savedDbPath;
  if (savedAaPublic === undefined) delete process.env.AA_PUBLIC;
  else process.env.AA_PUBLIC = savedAaPublic;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function readDump(): DumpRow[] {
  const raw = zlib.gunzipSync(fs.readFileSync(datasetPath())).toString('utf8');
  return raw
    .split('\n')
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l) as DumpRow);
}

function seedMixed(): void {
  // first-party
  upsertMetric({ source: 'provider-pricing', entity: 'openai/gpt-5', metric: 'price_in', value: 1.25, date: '2026-08-18' });
  upsertMetric({ source: 'provider-pricing', entity: 'openai/gpt-5', metric: 'price_in', value: 1.1, date: '2026-08-19' });
  upsertMetric({ source: 'open-bench', entity: 'openai/gpt-5', metric: 'intelligence', value: 68, date: '2026-08-19' });
  // AA-derived (redistribution-gated)
  upsertMetric({ source: 'aa', entity: 'openai/gpt-5', metric: 'intelligence', value: 69, date: '2026-08-19' });
  upsertMetric({ source: 'aa-media-image', entity: 'flux', metric: 'elo', value: 1100, date: '2026-08-19' });
}

describe('runDatasetDump', () => {
  it('dumps only first-party series by default (aa* excluded)', async () => {
    seedMixed();
    const result = await runDatasetDump();

    expect(result).toEqual({ series: 2, points: 3, bytes: expect.any(Number) });
    expect(path.basename(datasetPath())).toBe(DATASET_FILENAME);
    expect(path.dirname(datasetPath())).toBe(tmpDir);

    const rows = readDump();
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => !r.source.startsWith('aa'))).toBe(true);
    // sorted by source, entity, metric, date
    expect(rows.map((r) => `${r.source}/${r.metric}/${r.date}`)).toEqual([
      'open-bench/intelligence/2026-08-19',
      'provider-pricing/price_in/2026-08-18',
      'provider-pricing/price_in/2026-08-19',
    ]);
  });

  it('includes aa* series when AA_PUBLIC=true', async () => {
    process.env.AA_PUBLIC = 'true';
    seedMixed();
    const result = await runDatasetDump();

    expect(result.series).toBe(4);
    expect(result.points).toBe(5);
    const rows = readDump();
    expect(rows.some((r) => r.source === 'aa')).toBe(true);
    expect(rows.some((r) => r.source === 'aa-media-image')).toBe(true);
  });

  it('gzip round-trips back to the exact seeded rows', async () => {
    process.env.AA_PUBLIC = 'true';
    seedMixed();
    await runDatasetDump();

    const rows = readDump();
    expect(rows).toEqual([
      { source: 'aa', entity: 'openai/gpt-5', metric: 'intelligence', date: '2026-08-19', value: 69 },
      { source: 'aa-media-image', entity: 'flux', metric: 'elo', date: '2026-08-19', value: 1100 },
      { source: 'open-bench', entity: 'openai/gpt-5', metric: 'intelligence', date: '2026-08-19', value: 68 },
      { source: 'provider-pricing', entity: 'openai/gpt-5', metric: 'price_in', date: '2026-08-18', value: 1.25 },
      { source: 'provider-pricing', entity: 'openai/gpt-5', metric: 'price_in', date: '2026-08-19', value: 1.1 },
    ]);
  });

  it('is idempotent: re-running rewrites the same file, no tmp left behind', async () => {
    seedMixed();
    const first = await runDatasetDump();
    const firstBytes = fs.readFileSync(datasetPath());

    // a same-day re-run of an ingest job updates in place — dump is unchanged
    upsertMetric({ source: 'provider-pricing', entity: 'openai/gpt-5', metric: 'price_in', value: 1.1, date: '2026-08-19' });
    const second = await runDatasetDump();

    expect(second).toEqual(first);
    expect(fs.readFileSync(datasetPath())).toEqual(firstBytes);
    expect(fs.existsSync(`${datasetPath()}.tmp`)).toBe(false);
  });
});
