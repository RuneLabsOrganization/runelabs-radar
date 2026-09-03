import { beforeEach, describe, expect, it } from 'vitest';
import { briefs, stories } from '@/lib/db/schema';
import { GET as changelogFeed } from '@/app/changelog.xml/route';
import { GET as briefFeed } from '@/app/brief.xml/route';
import { stripLeadingH1 } from '@/lib/markdown';
import { config } from '@/lib/config';
import { useTestDb } from './helpers/db';
import type { Db } from '@/lib/db';

let db: Db;

beforeEach(() => {
  db = useTestDb();
});

function seedCurated(title: string, topScore: number, ageDays: number) {
  db.insert(stories)
    .values({
      title,
      status: 'curated',
      topScore,
      tldr: `${title} — tldr`,
      createdAt: new Date(Date.now() - ageDays * 24 * 36e5),
    })
    .run();
}

describe('stripLeadingH1', () => {
  it('strips a leading H1 plus following blank lines', () => {
    expect(stripLeadingH1('# Title\n\nBody copy.')).toBe('Body copy.');
    expect(stripLeadingH1('# Title\nBody copy.')).toBe('Body copy.');
  });

  it('leaves markdown without a leading H1 untouched', () => {
    expect(stripLeadingH1('No heading\nBody copy.')).toBe('No heading\nBody copy.');
    expect(stripLeadingH1('## Subheading\nBody copy.')).toBe('## Subheading\nBody copy.');
    expect(stripLeadingH1('#NoSpace\nBody copy.')).toBe('#NoSpace\nBody copy.');
  });
});

describe('/changelog.xml', () => {
  it('filters window and score in the feed and links canonical story paths', async () => {
    seedCurated('IN_WINDOW_HIGH', 80, 1);
    seedCurated('IN_WINDOW_LOW', 39, 1);
    seedCurated('OLD_HIGH', 90, 31);
    db.insert(stories)
      .values({ title: 'RAW_HIGH', status: 'raw', topScore: 90, createdAt: new Date() })
      .run();

    const res = await changelogFeed();
    const xml = await res.text();

    expect(xml).toContain('IN_WINDOW_HIGH');
    expect(xml).not.toContain('IN_WINDOW_LOW'); // below the score-40 floor
    expect(xml).not.toContain('OLD_HIGH'); // outside the 30-day window
    expect(xml).not.toContain('RAW_HIGH'); // never-display band

    // canonical /app/story links — the pre-consolidation /story path 301s
    expect(xml).toContain(`${config.siteUrl}/app/story/`);
    expect(xml).not.toContain(`${config.siteUrl}/story/`);
    expect(res.headers.get('cache-control')).toBe('public, max-age=300');
  });
});

describe('/brief.xml', () => {
  it('links canonical brief paths and strips the edition H1 from descriptions', async () => {
    db.insert(briefs)
      .values({
        date: '2026-08-12',
        markdown: '# INTERNAL H1 DUPLICATE\n\nBody copy here.',
        createdAt: new Date('2026-08-12T07:00:00Z'),
      })
      .run();

    const res = await briefFeed();
    const xml = await res.text();

    expect(xml).toContain(`${config.siteUrl}/app/brief?date=2026-08-12`);
    expect(xml).toContain(`<link>${config.siteUrl}/app/brief</link>`);
    expect(xml).not.toContain(`${config.siteUrl}/brief?date=`);
    expect(xml).toContain('Body copy here.');
    expect(xml).not.toContain('INTERNAL H1 DUPLICATE');
  });
});
