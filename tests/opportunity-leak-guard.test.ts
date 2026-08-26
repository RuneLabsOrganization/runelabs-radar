import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { opportunities } from '@/lib/db/schema';
import { GET as opportunitiesGet } from '@/app/api/v1/opportunities/route';
import { POST as briefPost } from '@/app/api/opportunities/[id]/brief/route';
import sitemap from '@/app/sitemap';
import { runWeeklyReport } from '@/lib/brief/weekly';
import { _setFetch } from '@/lib/llm/minimax';
import { _resetRateLimits } from '@/lib/api-limit';
import { seedUser, useTestDb } from './helpers/db';
import type { Db } from '@/lib/db';

vi.mock('@/lib/auth/user', () => ({
  getCurrentUser: async () => null,
}));

const PRIVATE_TITLE = 'PRIVATE-MUST-NOT-LEAK';
const PUBLIC_TITLE = 'PUBLIC-MUST-APPEAR';
const PRIVATE_SLUG = 'private-must-not-leak';
const PUBLIC_SLUG = 'public-must-appear';

const CACHED_BRIEF = JSON.stringify({
  icp: 'Small engineering teams shipping every week',
  mvp: ['Triage the review queue', 'Slack digest of blockers', 'Owner assignment'],
  gtm: ['Post in engineering Discords'],
  risks: ['Incumbent review tooling'],
});

function seedOpp(
  db: Db,
  opts: { slug: string; title: string; ownerUserId: number | null },
) {
  const now = new Date();
  return db
    .insert(opportunities)
    .values({
      slug: opts.slug,
      ownerUserId: opts.ownerUserId,
      title: opts.title,
      thesis: `${opts.title} is a sufficiently long thesis for downstream validation.`,
      sector: 'devtools',
      status: 'active',
      flipScore: 80,
      holdScore: 50,
      scores: '{}',
      evidence: '[]',
      verdict: 'pursue',
      confidence: 60,
      brief: CACHED_BRIEF,
      firstSeenAt: now,
      lastSeenAt: now,
    })
    .returning()
    .get()!;
}

describe('private openings must not leak onto public surfaces', () => {
  let db: Db;
  let publicId: number;
  let privateId: number;
  const savedEnv = {
    key: process.env.MINIMAX_API_KEY,
    publicMode: process.env.PUBLIC_MODE,
  };

  beforeEach(() => {
    db = useTestDb();
    seedUser(db, 1);
    _resetRateLimits();
    process.env.MINIMAX_API_KEY = 'test-key';
    process.env.PUBLIC_MODE = 'true';
    const pub = seedOpp(db, { slug: PUBLIC_SLUG, title: PUBLIC_TITLE, ownerUserId: null });
    const priv = seedOpp(db, { slug: PRIVATE_SLUG, title: PRIVATE_TITLE, ownerUserId: 1 });
    publicId = pub.id;
    privateId = priv.id;
  });

  afterEach(() => {
    _setFetch(globalThis.fetch);
    if (savedEnv.key === undefined) delete process.env.MINIMAX_API_KEY;
    else process.env.MINIMAX_API_KEY = savedEnv.key;
    if (savedEnv.publicMode === undefined) delete process.env.PUBLIC_MODE;
    else process.env.PUBLIC_MODE = savedEnv.publicMode;
  });

  it('keeps private slugs out of the sitemap', () => {
    const entries = sitemap();
    const urls = entries.map((e) => e.url);
    expect(urls.some((u) => u.includes(PUBLIC_SLUG))).toBe(true);
    expect(urls.some((u) => u.includes(PRIVATE_SLUG))).toBe(false);
  });

  it('keeps private openings out of the public JSON API', async () => {
    const res = await opportunitiesGet(new Request('http://localhost/api/v1/opportunities'));
    const body = JSON.stringify(await res.json());
    expect(body).toContain(PUBLIC_SLUG);
    expect(body).toContain(PUBLIC_TITLE);
    expect(body).not.toContain(PRIVATE_SLUG);
    expect(body).not.toContain(PRIVATE_TITLE);
  });

  it('keeps private titles out of the weekly report prompt', async () => {
    const capture: { user?: string } = {};
    _setFetch((async (_url: unknown, init: { body: string }) => {
      const parsed = JSON.parse(init.body) as { messages: { content: string }[] };
      capture.user = parsed.messages[1]!.content;
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: JSON.stringify({ markdown: '# week' }) } }],
          usage: { prompt_tokens: 10, completion_tokens: 10 },
        }),
      } as Response;
    }) as unknown as typeof fetch);

    await runWeeklyReport();
    expect(capture.user, 'weekly prompt was not captured').toBeDefined();
    expect(capture.user).toContain(PUBLIC_TITLE);
    expect(capture.user).not.toContain(PRIVATE_TITLE);
  });

  it('returns 404 for a private opportunity brief to an unauthenticated caller', async () => {
    const publicRes = await briefPost(new Request('http://localhost/api/opportunities/x/brief', { method: 'POST' }), {
      params: Promise.resolve({ id: String(publicId) }),
    });
    expect(publicRes.status).toBe(200);
    const publicBody = JSON.stringify(await publicRes.json());
    expect(publicBody).toContain('icp');

    const privateRes = await briefPost(new Request('http://localhost/api/opportunities/x/brief', { method: 'POST' }), {
      params: Promise.resolve({ id: String(privateId) }),
    });
    expect(privateRes.status).toBe(404);
    const privateBody = JSON.stringify(await privateRes.json());
    expect(privateBody).not.toContain(PRIVATE_TITLE);
  });
});
