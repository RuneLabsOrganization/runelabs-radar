import { describe, it, expect, beforeEach } from 'vitest';
import { useTestDb } from './helpers/db';
import type { Db } from '@/lib/db';
import { stories } from '@/lib/db/schema';
import {
  AGENT_STACKS_SOURCE,
  HARNESS_LANDSCAPE,
  agentStackPoints,
  closeLovedPie,
  harnessMentions7d,
  landscapeWithMentions,
} from '@/lib/agent-stacks';

let db: Db;
beforeEach(() => {
  db = useTestDb();
  const put = (title: string, entities: { name: string; kind: string }[], daysAgo = 0) =>
    db
      .insert(stories)
      .values({
        title,
        status: 'curated',
        topScore: 60,
        entities: JSON.stringify(entities),
        createdAt: new Date(Date.now() - daysAgo * 864e5),
      })
      .run();
  put('a', [{ name: 'Claude Code', kind: 'tool' }]);
  put('b', [{ name: 'claude code', kind: 'tool' }]);
  put('c', [{ name: 'Cursor', kind: 'tool' }]);
  put('old', [{ name: 'Claude Code', kind: 'tool' }], 20);
});

describe('agentStackPoints mention heat', () => {
  it('matches the per-harness counts exactly (prefetched single pass)', () => {
    const points = agentStackPoints();
    const mentions = new Map(
      points.filter((p) => p.metric === 'mentions_7d').map((p) => [p.entity, p.value]),
    );
    const landscape = landscapeWithMentions();

    for (const h of closeLovedPie(HARNESS_LANDSCAPE)) {
      // the prefetched count must equal both reference computations
      expect(mentions.get(h.name)).toBe(harnessMentions7d(h.aliases));
      expect(mentions.get(h.name)).toBe(landscape.find((l) => l.name === h.name)?.mentions7d);
    }
    expect(mentions.get('Claude Code')).toBe(2);
    expect(mentions.get('Cursor')).toBe(1);
  });

  it('still emits loved_pct and typical_cost_usd points for every row', () => {
    const points = agentStackPoints();
    const loved = points.filter((p) => p.metric === 'loved_pct');
    expect(loved).toHaveLength(HARNESS_LANDSCAPE.length);
    expect(loved.every((p) => p.source === AGENT_STACKS_SOURCE)).toBe(true);
    expect(loved.find((p) => p.entity === 'Claude Code')?.value).toBe(46);
    expect(points.some((p) => p.metric === 'typical_cost_usd' && p.entity === 'indie')).toBe(true);
  });
});
