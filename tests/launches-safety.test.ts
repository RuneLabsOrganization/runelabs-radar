import { beforeEach, describe, expect, it } from 'vitest';
import { launches } from '@/lib/db/schema';
import { upsertLaunches, type NewLaunch } from '@/lib/launches';
import { sweepUnsafeLaunchUrls } from '@/lib/sweep';
import { useTestDb } from './helpers/db';
import type { Db } from '@/lib/db';

let db: Db;

beforeEach(() => {
  db = useTestDb();
});

function launch(url: string, title = 'A launch'): NewLaunch {
  return { source: 'show-hn', title, url, points: 10, comments: 2, launchedAt: new Date() };
}

describe('upsertLaunches enforces the http(s)-only invariant', () => {
  it('drops javascript:/data: URLs and keeps http(s)', () => {
    const n = upsertLaunches([
      launch('javascript:alert(1)'),
      launch('data:text/html,<script>alert(1)</script>'),
      launch('https://example.com/product'),
      launch('http://example.com/other'),
    ]);

    expect(n).toBe(2);
    const urls = db.select().from(launches).all().map((l) => l.url);
    expect(urls).toEqual(['https://example.com/product', 'http://example.com/other']);
  });

  it('rejects scheme-less and protocol-relative URLs', () => {
    const n = upsertLaunches([launch('example.com/x'), launch('//evil.com/x')]);
    expect(n).toBe(0);
    expect(db.select().from(launches).all()).toHaveLength(0);
  });
});

describe('sweepUnsafeLaunchUrls', () => {
  it('removes legacy non-http rows and keeps http(s)', () => {
    const now = new Date();
    for (const url of ['javascript:alert(1)', 'https://ok.example.com', 'ftp://files.example.com']) {
      db.insert(launches)
        .values({ source: 'show-hn', title: 'legacy', url, points: 1, comments: 0, launchedAt: now, createdAt: now })
        .run();
    }

    const removed = sweepUnsafeLaunchUrls();

    expect(removed).toBe(2);
    expect(db.select().from(launches).all().map((l) => l.url)).toEqual(['https://ok.example.com']);
  });
});
