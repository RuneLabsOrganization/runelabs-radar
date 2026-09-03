import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { useTestDb } from './helpers/db';
import { metricPoints } from '@/lib/db/schema';
import { GET } from '@/app/api/v1/metrics/route';
import { _resetRateLimits } from '@/lib/api-limit';

// The enumeration gate (SQL LIKE 'aa%') is ASCII case-insensitive; the direct
// fetch gate must match it or mixed-case AA series leak through one path
// while hidden from the other.

let db: ReturnType<typeof useTestDb>;
const savedAaPublic = process.env.AA_PUBLIC;

beforeEach(() => {
  db = useTestDb();
  _resetRateLimits();
  delete process.env.AA_PUBLIC; // aaPublic gate ON
  db.insert(metricPoints)
    .values({ source: 'AA-X', entity: 'model-a', metric: 'elo', value: 1200, date: '2026-08-01', createdAt: new Date() })
    .run();
});

afterEach(() => {
  if (savedAaPublic === undefined) delete process.env.AA_PUBLIC;
  else process.env.AA_PUBLIC = savedAaPublic;
});

describe('/api/v1/metrics AA gate case handling', () => {
  it('direct fetch of a mixed-case aa source is rejected like enumeration hides it', async () => {
    const res = await GET(new Request('http://localhost/api/v1/metrics?source=AA-X&entity=model-a&metric=elo'));
    expect(res.status).toBe(403);

    const enumRes = await GET(new Request('http://localhost/api/v1/metrics'));
    const body = (await enumRes.json()) as { count: number; metrics: { source: string }[] };
    expect(body.metrics.some((m) => m.source === 'AA-X')).toBe(false);
  });

  it('lowercase aa sources stay rejected too', async () => {
    const res = await GET(new Request('http://localhost/api/v1/metrics?source=aa&entity=model-a&metric=elo'));
    expect(res.status).toBe(403);
  });

  it('non-aa sources are unaffected', async () => {
    db.insert(metricPoints)
      .values({ source: 'github', entity: 'repo-a', metric: 'stars', value: 42, date: '2026-08-01', createdAt: new Date() })
      .run();
    const res = await GET(new Request('http://localhost/api/v1/metrics?source=github&entity=repo-a&metric=stars'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { found: boolean };
    expect(body.found).toBe(true);
  });
});
