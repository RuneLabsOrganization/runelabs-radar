import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  AGENT_PERSONAS,
  AGENT_STACKS_SOURCE,
  HARNESS_LANDSCAPE,
  PE_LOVED_PUBLISHED,
  PERSONA_SLUGS,
  REST_OF_FIELD,
  agentStackPoints,
  closeLovedPie,
  costBand,
  harnessMentions7d,
  landscapeWithMentions,
  lovedPctSum,
  resolvePersona,
} from '@/lib/agent-stacks';
import { syncAgentStacks } from '@/lib/agent-stacks-sync';
import { metricPoints, stories } from '@/lib/db/schema';
import { useTestDb } from './helpers/db';

let db: ReturnType<typeof useTestDb>;

beforeEach(() => {
  db = useTestDb();
});

const stackRows = () =>
  db.select().from(metricPoints).where(eq(metricPoints.source, AGENT_STACKS_SOURCE)).all();

describe('AGENT_PERSONAS', () => {
  it('covers the six builder personas with unique slugs', () => {
    expect(AGENT_PERSONAS.map((p) => p.slug).sort()).toEqual([...PERSONA_SLUGS].sort());
    expect(new Set(AGENT_PERSONAS.map((p) => p.slug)).size).toBe(PERSONA_SLUGS.length);
  });

  it('every persona has a stack, cost band, why, and skip', () => {
    for (const p of AGENT_PERSONAS) {
      expect(p.stack.trim().length, p.slug).toBeGreaterThan(10);
      expect(p.costLowUsd, p.slug).toBeGreaterThan(0);
      expect(p.costHighUsd, p.slug).toBeGreaterThanOrEqual(p.costLowUsd);
      expect(p.why.trim().length, p.slug).toBeGreaterThan(20);
      expect(p.skip.trim().length, p.slug).toBeGreaterThan(10);
      expect(costBand(p)).toMatch(/^\$\d/);
    }
  });
});

describe('resolvePersona', () => {
  it('matches slug, label fragment, and returns null on a miss', () => {
    expect(resolvePersona('indie')?.slug).toBe('indie');
    expect(resolvePersona('non-coder')?.slug).toBe('nocoder');
    expect(resolvePersona('budget')?.slug).toBe('budget');
    expect(resolvePersona('  Enterprise  ')?.slug).toBe('enterprise');
    expect(resolvePersona('fortran')).toBeNull();
    expect(resolvePersona('')).toBeNull();
  });
});

describe('HARNESS_LANDSCAPE', () => {
  it('covers the big five plus OpenCode and the remainder bucket', () => {
    for (const name of ['Claude Code', 'Cursor', 'Codex', 'GitHub Copilot', 'Windsurf', 'OpenCode', REST_OF_FIELD]) {
      expect(
        HARNESS_LANDSCAPE.some((h) => h.name === name),
        name,
      ).toBe(true);
    }
    expect(HARNESS_LANDSCAPE.every((h) => h.aliases.length > 0)).toBe(true);
  });

  it('keeps PE headline numbers and closes the loved pie to 100', () => {
    const pie = closeLovedPie();
    expect(pie.find((h) => h.name === 'Claude Code')?.lovedPct).toBe(PE_LOVED_PUBLISHED['Claude Code']);
    expect(pie.find((h) => h.name === 'Cursor')?.lovedPct).toBe(PE_LOVED_PUBLISHED.Cursor);
    expect(pie.find((h) => h.name === 'GitHub Copilot')?.lovedPct).toBe(PE_LOVED_PUBLISHED['GitHub Copilot']);
    expect(lovedPctSum()).toBe(100);
    expect(pie.every((h) => h.lovedPct > 0)).toBe(true);
    expect(pie.filter((h) => h.lovedSource === 'pe-survey').reduce((s, h) => s + h.lovedPct, 0)).toBe(74);
  });

  it('scales remainder so the pie cannot exceed 100', () => {
    const bloated = HARNESS_LANDSCAPE.map((h) =>
      h.lovedSource === 'remainder' && h.name !== REST_OF_FIELD ? { ...h, lovedPct: 20 } : h,
    );
    const pie = closeLovedPie(bloated);
    expect(lovedPctSum(pie)).toBe(100);
    expect(pie.find((h) => h.name === 'Claude Code')?.lovedPct).toBe(46);
  });

  it('sorts the public landscape by loved %', () => {
    const rows = landscapeWithMentions();
    const pcts = rows.map((h) => h.lovedPct);
    expect(pcts).toEqual([...pcts].sort((a, b) => b - a));
    expect(rows[0]?.name).toBe('Claude Code');
  });
});

describe('harnessMentions7d', () => {
  it('counts distinct stories per alias key in the last 7 days', () => {
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

    expect(harnessMentions7d(['Claude Code'])).toBe(2);
    expect(harnessMentions7d(['Cursor'])).toBe(1);
    expect(harnessMentions7d(['Windsurf'])).toBe(0);
  });
});

describe('syncAgentStacks', () => {
  beforeEach(() => {
    vi.stubEnv('BRAVE_API_KEY', '');
    vi.stubEnv('MINIMAX_API_KEY', '');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('writes loved_pct, mentions_7d, and typical_cost_usd rows', async () => {
    db.insert(stories)
      .values({
        title: 'cursor ships',
        status: 'curated',
        topScore: 70,
        entities: JSON.stringify([{ name: 'Cursor', kind: 'tool' }]),
        createdAt: new Date(),
      })
      .run();

    const { recorded } = await syncAgentStacks();
    expect(recorded).toBe(agentStackPoints().length);

    const rows = stackRows();
    const claudeLoved = rows.find((r) => r.entity === 'Claude Code' && r.metric === 'loved_pct');
    expect(claudeLoved?.value).toBe(46);
    const codexLoved = rows.find((r) => r.entity === 'Codex' && r.metric === 'loved_pct');
    expect(codexLoved?.value).toBe(10);
    const restLoved = rows.find((r) => r.entity === REST_OF_FIELD && r.metric === 'loved_pct');
    expect(restLoved?.value).toBe(6);
    const cursorMentions = rows.find((r) => r.entity === 'Cursor' && r.metric === 'mentions_7d');
    expect(cursorMentions?.value).toBe(1);
    const indieCost = rows.find((r) => r.entity === 'indie' && r.metric === 'typical_cost_usd');
    expect(indieCost?.value).toBe(60);
  });

  it('is same-day idempotent', async () => {
    await syncAgentStacks();
    const again = await syncAgentStacks();
    expect(again.recorded).toBe(agentStackPoints().length);
    expect(stackRows()).toHaveLength(agentStackPoints().length);
  });
});
