import { describe, it, expect, vi } from 'vitest';
import { useTestDb } from './helpers/db';
import { recordMetrics, seriesFor, upsertMetric, utcDay } from '@/lib/metrics';
import { metricsFromAaCompact, metricsFromMediaCompact } from '@/lib/snapshot';
import { compactAaMediaSnapshot, compactAaSnapshot } from '@/lib/board/sync';
import { parseGithubRepo } from '@/lib/velocity';
import { mapShowHn } from '@/lib/launches';
import { sanitizeComps, sanitizePains } from '@/lib/pain';

vi.mock('@huggingface/transformers', () => ({ env: {}, pipeline: vi.fn() }));
// eslint-disable-next-line import/first
import { bufferToVec, cosine, vecToBuffer } from '@/lib/embed';

describe('metrics store', () => {
  it('upserts are idempotent per (source, entity, metric, day)', () => {
    useTestDb();
    upsertMetric({ source: 'aa', entity: 'GPT-5.5', metric: 'price_blended', value: 11.25 });
    upsertMetric({ source: 'aa', entity: 'GPT-5.5', metric: 'price_blended', value: 11.0 });
    const series = seriesFor('aa', 'GPT-5.5', 'price_blended');
    expect(series).toEqual([{ date: utcDay(), value: 11.0 }]);
  });

  it('recordMetrics skips non-finite values and counts writes', () => {
    useTestDb();
    const n = recordMetrics([
      { source: 's', entity: 'e', metric: 'm', value: 1 },
      { source: 's', entity: 'e2', metric: 'm', value: NaN },
    ]);
    expect(n).toBe(1);
  });

  it('seriesFor returns oldest-first within the window only', () => {
    useTestDb();
    const old = utcDay(new Date(Date.now() - 100 * 864e5));
    const recent = utcDay(new Date(Date.now() - 2 * 864e5));
    upsertMetric({ source: 's', entity: 'e', metric: 'm', value: 1, date: old });
    upsertMetric({ source: 's', entity: 'e', metric: 'm', value: 2, date: recent });
    upsertMetric({ source: 's', entity: 'e', metric: 'm', value: 3 });
    expect(seriesFor('s', 'e', 'm', 90).map((p) => p.value)).toEqual([2, 3]);
  });
});

describe('snapshot metric extraction', () => {
  it('flattens compact AA snapshots into per-model metric points', () => {
    const compact = compactAaSnapshot(
      JSON.stringify({
        data: [
          {
            name: 'GPT-5.5',
            model_creator: { name: 'OpenAI' },
            evaluations: { artificial_analysis_intelligence_index: 35.4, artificial_analysis_coding_index: 56.5 },
            pricing: { price_1m_blended_3_to_1: 11.25 },
            median_output_tokens_per_second: 59.3,
          },
        ],
      }),
    );
    const points = metricsFromAaCompact(compact);
    const metrics = Object.fromEntries(points.map((p) => [p.metric, p.value]));
    expect(points.every((p) => p.source === 'aa' && p.entity === 'GPT-5.5')).toBe(true);
    expect(metrics).toEqual({ price_blended: 11.25, intelligence: 35.4, coding: 56.5, speed: 59.3 });
  });

  it('flattens media snapshots into elo points', () => {
    const compact = compactAaMediaSnapshot(
      JSON.stringify({ data: [{ name: 'HappyHorse-1.0', elo: 1286, rank: 1 }] }),
    );
    expect(metricsFromMediaCompact('aa-media-video', compact)).toEqual([
      { source: 'aa-media-video', entity: 'HappyHorse-1.0', metric: 'elo', value: 1286 },
    ]);
  });

  it('returns empty on unparseable snapshots', () => {
    expect(metricsFromAaCompact('garbage')).toEqual([]);
    expect(metricsFromMediaCompact('x', 'garbage')).toEqual([]);
  });
});

describe('velocity parsing', () => {
  it('parseGithubRepo extracts owner/repo and rejects non-repo urls', () => {
    expect(parseGithubRepo('https://github.com/obra/superpowers')).toBe('obra/superpowers');
    expect(parseGithubRepo('https://github.com/obra/superpowers/tree/main/src')).toBe('obra/superpowers');
    expect(parseGithubRepo('https://github.com/obra')).toBeNull();
    expect(parseGithubRepo('https://gitlab.com/a/b')).toBeNull();
    expect(parseGithubRepo('not a url')).toBeNull();
  });
});

describe('launch mapping', () => {
  it('mapShowHn strips the prefix, falls back to the HN url, keeps stats', () => {
    const out = mapShowHn([
      {
        objectID: '1',
        title: 'Show HN: RadarKit – tiny radar charts',
        url: 'https://radarkit.dev',
        points: 42,
        num_comments: 7,
        created_at: '2026-07-11T08:00:00Z',
      },
      { objectID: '2', title: 'Show HN: No-url launch', url: null, points: 1, created_at: '2026-07-11T09:00:00Z' },
      { title: 'no id, no url' },
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({
      title: 'RadarKit – tiny radar charts',
      url: 'https://radarkit.dev',
      points: 42,
      comments: 7,
      source: 'show-hn',
    });
    expect(out[1].url).toBe('https://news.ycombinator.com/item?id=2');
  });
});

describe('pain sanitizers', () => {
  it('sanitizePains dedups, validates sectors and bounds item indexes', () => {
    const out = sanitizePains(
      [
        { summary: 'Reliable bulk background removal for product photos', sector: 'image', itemIndexes: [0, 99, -1] },
        { summary: 'Reliable bulk background removal for product photos', sector: 'image' },
        { summary: 'short', sector: 'image' },
        { summary: 'Automate podcast clipping into vertical shorts', sector: 'nonsense' },
      ],
      3,
    );
    expect(out).toHaveLength(2);
    expect(out[0].itemIndexes).toEqual([0]);
    expect(out[1].sector).toBeNull();
  });

  it('sanitizeComps enforces kind, product and sane amounts', () => {
    const out = sanitizeComps([
      { kind: 'exit', product: 'TinyWrapper', amountUsd: 120000, note: 'sold on marketplace' },
      { kind: 'revenue', product: 'ClipBot', amountUsd: -5 },
      { kind: 'weird', product: 'X' },
      { kind: 'exit', product: '' },
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ kind: 'exit', amountUsd: 120000 });
    expect(out[1].amountUsd).toBeNull();
  });
});

describe('embedding helpers', () => {
  it('vec/buffer roundtrip preserves values; cosine of identical unit vectors is 1', () => {
    const v = new Float32Array([0.6, 0.8, 0]);
    const back = bufferToVec(vecToBuffer(v));
    expect([...back]).toEqual([...v]);
    expect(cosine(v, back)).toBeCloseTo(1.0, 5);
    expect(cosine(new Float32Array([1, 0]), new Float32Array([0, 1]))).toBe(0);
  });
});
