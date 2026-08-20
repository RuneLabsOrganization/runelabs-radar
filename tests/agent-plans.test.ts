import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { AGENT_PLANS, planEntity, syncAgentPlans } from '@/lib/agent-plans';
import { metricPoints } from '@/lib/db/schema';
import { useTestDb } from './helpers/db';

let db: ReturnType<typeof useTestDb>;

const today = () => new Date().toISOString().slice(0, 10);

beforeEach(() => {
  db = useTestDb();
});

const agentPlanRows = () =>
  db.select().from(metricPoints).where(eq(metricPoints.source, 'agent-plans')).all();

describe('AGENT_PLANS', () => {
  it('covers the landscape — at least the big five vendors', () => {
    expect(AGENT_PLANS.length).toBeGreaterThanOrEqual(8);
    for (const vendor of ['Cursor', 'Anthropic', 'OpenAI', 'GitHub', 'Windsurf']) {
      expect(
        AGENT_PLANS.some((p) => p.vendor === vendor),
        vendor,
      ).toBe(true);
    }
  });

  it('every plan has vendor, name, price, limits and a verdict', () => {
    for (const p of AGENT_PLANS) {
      expect(p.vendor.trim().length, planEntity(p)).toBeGreaterThan(0);
      expect(p.name.trim().length, planEntity(p)).toBeGreaterThan(0);
      expect(Number.isFinite(p.priceUsdMo), planEntity(p)).toBe(true);
      expect(p.priceUsdMo, planEntity(p)).toBeGreaterThanOrEqual(0);
      expect(p.limits.trim().length, planEntity(p)).toBeGreaterThan(0);
      expect(p.verdict.trim().length, planEntity(p)).toBeGreaterThan(0);
    }
  });

  it('entity keys are unique — one row per plan tier', () => {
    const entities = AGENT_PLANS.map(planEntity);
    expect(new Set(entities).size).toBe(entities.length);
  });
});

describe('syncAgentPlans', () => {
  it('writes one price_usd_mo row per plan, dated today', async () => {
    const { recorded } = await syncAgentPlans();
    expect(recorded).toBe(AGENT_PLANS.length);

    const rows = agentPlanRows();
    expect(rows).toHaveLength(AGENT_PLANS.length);
    for (const p of AGENT_PLANS) {
      const row = rows.find((r) => r.entity === planEntity(p));
      expect(row, planEntity(p)).toBeDefined();
      expect(row!.metric).toBe('price_usd_mo');
      expect(row!.value).toBe(p.priceUsdMo);
      expect(row!.date).toBe(today());
    }
  });

  it('is same-day idempotent: a re-run updates in place, no duplicate rows', async () => {
    await syncAgentPlans();
    const again = await syncAgentPlans();
    expect(again.recorded).toBe(AGENT_PLANS.length);
    expect(agentPlanRows()).toHaveLength(AGENT_PLANS.length);
  });
});
