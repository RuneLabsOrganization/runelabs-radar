import { describe, expect, it } from 'vitest';
import { planFromWire, planToWire, sanitizePlan, type ExecutionPlan } from '@/lib/plans/schema';

function task(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    title: `Do ${id}`,
    detail: `Concrete instructions for ${id}, long enough to pass validation.`,
    depends_on: [],
    files_to_touch: ['src/index.ts'],
    tools: ['next'],
    acceptance: [`${id} works end to end`],
    verify: 'npm test',
    estimate_hours: 2,
    rollback: 'git revert',
    ...over,
  };
}

function validPlan() {
  return {
    title: 'Bulk background-removal API',
    overview: 'A focused API product selling bulk background removal to e-commerce sellers, riding the newly-cheap image models.',
    icp: 'E-commerce operators with 500+ SKUs who currently pay per-image editors',
    pricing: { model: 'usage credits', price_usd: 29, notes: 'undercut per-image editors by 10x' },
    stack_venture: 'ai-product',
    phases: [
      { phase: 'validation', goal: 'Prove sellers pay before building', tasks: [task('validation-1'), task('validation-2')] },
      { phase: 'build', goal: 'Ship the MVP loop', tasks: [task('build-1'), task('build-2'), task('build-3')] },
      { phase: 'launch', goal: 'Launch day execution', tasks: [task('launch-1'), task('launch-2')] },
      { phase: 'gtm', goal: 'First 100 customers', tasks: [task('gtm-1'), task('gtm-2')] },
      { phase: 'revenue', goal: 'Break even and expand', tasks: [task('revenue-1'), task('revenue-2')] },
    ],
  };
}

describe('sanitizePlan', () => {
  it('accepts a valid full-lifecycle plan', () => {
    const plan = sanitizePlan('bulk-bg-removal', ['opportunity dossier'], validPlan());
    expect(plan).not.toBeNull();
    expect(plan!.phases.map((p) => p.phase)).toEqual(['validation', 'build', 'launch', 'gtm', 'revenue']);
    expect(plan!.phases[1]!.tasks).toHaveLength(3);
    expect(plan!.totalEstimateHours).toBe(22); // 11 tasks × 2h
    expect(plan!.opportunity).toBe('bulk-bg-removal');
  });

  it('rejects when a lifecycle phase is missing', () => {
    const v = validPlan();
    v.phases = v.phases.filter((p) => p.phase !== 'gtm');
    expect(sanitizePlan('x', [], v)).toBeNull();
  });

  it('rejects when a phase keeps fewer than two valid tasks', () => {
    const v = validPlan();
    v.phases[0]!.tasks = [task('validation-1'), task('validation-2', { acceptance: [] })];
    expect(sanitizePlan('x', [], v)).toBeNull();
  });

  it('rejects degenerate overviews and icps', () => {
    const v = validPlan();
    v.overview = 'short';
    expect(sanitizePlan('x', [], v)).toBeNull();
  });

  it('strips control characters and caps list lengths', () => {
    const v = validPlan();
    v.phases[1]!.tasks[0] = task('build-1', {
      title: 'Evil\u0000 title\nwith newlines',
      files_to_touch: Array.from({ length: 30 }, (_, i) => `f${i}.ts`),
    });
    const plan = sanitizePlan('x', [], v);
    expect(plan).not.toBeNull();
    const t = plan!.phases[1]!.tasks[0]!;
    expect(t.title).not.toMatch(/[\u0000-\u001f]/);
    expect(t.filesToTouch.length).toBeLessThanOrEqual(8);
  });

  it('round-trips through the wire format', () => {
    const plan = sanitizePlan('bulk-bg-removal', ['dossier'], validPlan())!;
    const revived = planFromWire(JSON.parse(JSON.stringify(planToWire(plan))));
    expect(revived).not.toBeNull();
    expect(revived).toEqual(plan);
  });

  it('planFromWire rejects garbage', () => {
    expect(planFromWire(null)).toBeNull();
    expect(planFromWire({ nope: true })).toBeNull();
  });

  it('keeps the stored generatedAt across wire round-trips', () => {
    const plan: ExecutionPlan = sanitizePlan('s', [], validPlan())!;
    plan.generatedAt = '2026-01-02T03:04:05.000Z';
    const revived = planFromWire(planToWire(plan))!;
    expect(revived.generatedAt).toBe('2026-01-02T03:04:05.000Z');
  });

  it('tolerates LLM emitting a lone string where a list is expected', () => {
    const v = validPlan();
    v.phases[0]!.tasks[0] = task('validation-1', { acceptance: 'single criterion as a string' });
    const plan = sanitizePlan('x', [], v);
    expect(plan).not.toBeNull();
    expect(plan!.phases[0]!.tasks[0]!.acceptance).toEqual(['single criterion as a string']);
  });
});
