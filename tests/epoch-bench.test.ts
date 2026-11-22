import { describe, expect, it } from 'vitest';
import { deflateRawSync } from 'node:zlib';
import { metricPoints } from '@/lib/db/schema';
import {
  benchKey,
  epochBaseSlug,
  epochDisplayName,
  EPOCH_SPECS,
  parseCsv,
  parseEpoch,
  runEpochBenchSync,
  unzipCsvs,
  type BenchSpec,
} from '@/lib/ingest/epoch-bench';
import { useTestDb } from './helpers/db';

/** Minimal zip writer (deflate or stored) so the parser is tested against real zip bytes. */
function makeZip(files: Record<string, string>, stored = false): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const raw = Buffer.from(text, 'utf8');
    const data = stored ? raw : deflateRawSync(raw);
    const nameBuf = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(stored ? 0 : 8, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    locals.push(local, nameBuf, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(stored ? 0 : 8, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(Object.keys(files).length, 8);
  eocd.writeUInt16LE(Object.keys(files).length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

const NOW = new Date('2026-11-22T12:00:00Z');

describe('parseCsv', () => {
  it('handles quoted commas, doubled quotes, embedded newlines, CRLF and a BOM', () => {
    const csv = '﻿a,b,c\r\n1,"x, y","say ""hi"""\r\n2,"line1\nline2",z\r\n';
    expect(parseCsv(csv)).toEqual([
      { a: '1', b: 'x, y', c: 'say "hi"' },
      { a: '2', b: 'line1\nline2', c: 'z' },
    ]);
  });

  it('returns [] for empty input and pads short rows', () => {
    expect(parseCsv('')).toEqual([]);
    expect(parseCsv('a,b\n1')).toEqual([{ a: '1', b: '' }]);
  });
});

describe('unzipCsvs', () => {
  it('reads deflated and stored entries, keeps only .csv, flattens paths', () => {
    for (const stored of [false, true]) {
      const zip = makeZip({ 'x/one.csv': 'a,b\n1,2\n', 'README.md': 'nope', 'two.csv': 'c\n3\n' }, stored);
      const files = unzipCsvs(zip);
      expect([...files.keys()].sort()).toEqual(['one', 'two']);
      expect(files.get('one')).toBe('a,b\n1,2\n');
    }
  });

  it('rejects non-zip input', () => {
    expect(() => unzipCsvs(Buffer.from('<html>not a zip</html>'))).toThrow(/not a zip/);
  });
});

describe('model identity', () => {
  it('splits the effort suffix and builds a readable name', () => {
    expect(epochBaseSlug('claude-opus-5-5_max')).toBe('claude-opus-5-5');
    expect(epochBaseSlug('gpt-5.5')).toBe('gpt-5.5');
    expect(epochDisplayName('claude-opus-5-5')).toBe('Claude Opus 5.5');
    expect(epochDisplayName('gpt-5-6-sol')).toBe('GPT 5.6 Sol');
  });

  it('joins spellings across sources: dots/hyphens, effort suffix, dated snapshots', () => {
    const k = benchKey('Claude Opus 5.5');
    expect(benchKey('claude-opus-5-5')).toBe(k);
    expect(benchKey('Claude Opus 5.5 (Max, Default Fallback)')).toBe(k);
    expect(benchKey('gpt-5.4-2026-03-05')).toBe(benchKey('GPT-5.4'));
    expect(benchKey('gpt-5-4-20260305')).toBe(benchKey('GPT-5.4'));
    expect(benchKey('Claude Opus 5')).not.toBe(k);
  });
});

describe('parseEpoch', () => {
  const spec: BenchSpec = { id: 't', file: 't', col: 'Score', label: 'T' };
  const csv = [
    'Model version,Score,Release date,Name',
    'claude-opus-5-5_max,0.80,2026-09-22,Claude Opus 5.5',
    'claude-opus-5-5_low,0.70,2026-09-22,Claude Opus 5.5',
    'gpt-5-5_xhigh,0.60,2026-04-23,',
    'old-model_x,0.99,2024-01-01,Old Model',
    'no-date_x,0.50,,No Date',
    'blank-score_x,,2026-10-01,Blank',
  ].join('\n');

  it('keeps the best row per model, only models inside the release window, no blank scores', () => {
    const res = parseEpoch(new Map([['t', csv]]), NOW, [spec]);
    expect(res.failed).toEqual([]);
    const byEntity = Object.fromEntries(res.points.map((p) => [p.entity, p.value]));
    expect(byEntity).toEqual({ 'Claude Opus 5.5': 0.8, 'GPT 5.5': 0.6 });
    expect(res.points.every((p) => p.source === 'epoch-bench' && p.metric === 't')).toBe(true);
    expect(res.models.t).toBe(2);
  });

  it('reports a missing file, a renamed column and an empty window — never silently', () => {
    const res = parseEpoch(
      new Map([
        ['renamed', 'Model version,Result,Release date\nm_x,1,2026-10-01'],
        ['ancient', 'Model version,Score,Release date\nm_x,1,2020-01-01'],
      ]),
      NOW,
      [
        { id: 'missing', file: 'nope', col: 'Score', label: 'M' },
        { id: 'renamed', file: 'renamed', col: 'Score', label: 'R' },
        { id: 'ancient', file: 'ancient', col: 'Score', label: 'A' },
      ],
    );
    expect(res.points).toEqual([]);
    expect(res.failed.map((f) => f.id)).toEqual(['missing', 'renamed', 'ancient']);
  });

  it('every shipped spec has a unique id and file', () => {
    expect(new Set(EPOCH_SPECS.map((s) => s.id)).size).toBe(EPOCH_SPECS.length);
  });
});

describe('runEpochBenchSync', () => {
  const rows = (n: number) =>
    ['Model version,Score,Release date', ...Array.from({ length: n }, (_, i) => `m${i}_max,${i / 10},2026-10-01`)].join('\n');

  it('records every benchmark that parsed, then FAILS the run when any benchmark broke', async () => {
    const db = useTestDb();
    // only one of the shipped specs has a file; the other 19 are "missing"
    const first = EPOCH_SPECS[0]!;
    const zip = makeZip({ [`${first.file}.csv`]: rows(3).replace('Score', first.col) });
    await expect(runEpochBenchSync(async () => zip)).rejects.toThrow(/benchmarks failed/);
    expect(db.select().from(metricPoints).all().length).toBe(3); // the good one still landed
  });

  it('fails when the download itself fails or is not a zip', async () => {
    useTestDb();
    await expect(runEpochBenchSync(async () => Buffer.from('<html>blocked</html>'))).rejects.toThrow(/not a zip/);
    await expect(
      runEpochBenchSync(async () => {
        throw new Error('HTTP 503');
      }),
    ).rejects.toThrow(/503/);
  });
});
