import { promptLine, stripCjkDeep } from '../prompt-hygiene';

/**
 * The execution plan — Radar's flagship artifact. One opportunity becomes a
 * full-lifecycle task graph (validation → build → launch → gtm → revenue)
 * that a coding agent can execute locally: every task carries dependencies,
 * files to touch, acceptance criteria, a verification step, a time estimate,
 * and a rollback note.
 */

export const PLAN_PHASES = ['validation', 'build', 'launch', 'gtm', 'revenue'] as const;
export type PlanPhase = (typeof PLAN_PHASES)[number];

export interface PlanTask {
  id: string;
  title: string;
  detail: string;
  dependsOn: string[];
  filesToTouch: string[];
  tools: string[];
  acceptance: string[];
  verify: string | null;
  estimateHours: number | null;
  rollback: string | null;
}

export interface PlanPhaseBlock {
  phase: PlanPhase;
  goal: string;
  tasks: PlanTask[];
}

export interface ExecutionPlan {
  version: 1;
  opportunity: string; // opportunity slug
  title: string;
  overview: string;
  icp: string;
  pricing: { model: string; priceUsd: number | null; notes: string };
  stackVenture: string | null;
  totalEstimateHours: number | null;
  phases: PlanPhaseBlock[];
  /** Human-readable list of the data inputs the plan was grounded in. */
  grounding: string[];
  generatedAt: string; // ISO
}

function strList(v: unknown, maxItems: number, maxLen: number): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((s): s is string => typeof s === 'string')
    .map((s) => promptLine(s, maxLen))
    .filter((s) => s.length > 0)
    .slice(0, maxItems);
}

function posNum(v: unknown, max = 1e4): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 && v < max ? Math.round(v * 10) / 10 : null;
}

// LLMs frequently emit a lone string where the schema asks for a list
function asArray(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  return typeof v === 'string' && v.trim() ? [v] : [];
}

function sanitizeTask(v: unknown, phase: PlanPhase, index: number): PlanTask | null {
  if (typeof v !== 'object' || v === null) return null;
  const rec = v as Record<string, unknown>;
  const title = typeof rec.title === 'string' ? promptLine(rec.title, 140) : '';
  const detail = typeof rec.detail === 'string' ? promptLine(rec.detail, 800) : '';
  const acceptance = strList(asArray(rec.acceptance ?? rec.acceptanceCriteria ?? rec.acceptance_criteria), 6, 240);
  if (title.length < 4 || detail.length < 10 || acceptance.length < 1) return null;
  const id =
    typeof rec.id === 'string' && /^[a-z0-9-]{2,40}$/i.test(rec.id.trim())
      ? rec.id.trim().toLowerCase()
      : `${phase}-${index + 1}`;
  const verify = typeof rec.verify === 'string' ? promptLine(rec.verify, 400) : '';
  const rollback = typeof rec.rollback === 'string' ? promptLine(rec.rollback, 300) : '';
  return {
    id,
    title,
    detail,
    dependsOn: strList(asArray(rec.dependsOn ?? rec.depends_on), 6, 40).map((s) => s.toLowerCase()),
    filesToTouch: strList(asArray(rec.filesToTouch ?? rec.files_to_touch), 8, 120),
    tools: strList(asArray(rec.tools), 6, 60),
    acceptance,
    verify: verify.length > 3 ? verify : null,
    estimateHours: posNum(rec.estimateHours ?? rec.estimate_hours),
    rollback: rollback.length > 3 ? rollback : null,
  };
}

/**
 * Validates the LLM's assembled plan. Returns null when any phase is missing
 * or degenerate — the caller retries once, then reports failure. Exported for
 * tests. `slug`/`grounding` come from the caller (never from the LLM).
 */
export function sanitizePlan(slug: string, grounding: string[], v: unknown): ExecutionPlan | null {
  v = stripCjkDeep(v); // output-side hygiene: plans are English by design
  if (typeof v !== 'object' || v === null) return null;
  const rec = v as Record<string, unknown>;
  const title = typeof rec.title === 'string' ? promptLine(rec.title, 140) : '';
  const overview = typeof rec.overview === 'string' ? promptLine(rec.overview, 800) : '';
  const icp = typeof rec.icp === 'string' ? promptLine(rec.icp, 400) : '';
  if (title.length < 8 || overview.length < 40 || icp.length < 15) return null;

  const pricingRec = (typeof rec.pricing === 'object' && rec.pricing !== null ? rec.pricing : {}) as Record<
    string,
    unknown
  >;
  const pricing = {
    model: typeof pricingRec.model === 'string' ? promptLine(pricingRec.model, 120) : '',
    priceUsd: posNum(pricingRec.priceUsd ?? pricingRec.price_usd, 1e6),
    notes: typeof pricingRec.notes === 'string' ? promptLine(pricingRec.notes, 300) : '',
  };

  if (!Array.isArray(rec.phases)) return null;
  const phases: PlanPhaseBlock[] = [];
  for (const phaseKey of PLAN_PHASES) {
    const block = rec.phases.find(
      (p): p is Record<string, unknown> =>
        typeof p === 'object' && p !== null && (p as Record<string, unknown>).phase === phaseKey,
    );
    if (!block) return null; // every lifecycle phase must be present
    const goal = typeof block.goal === 'string' ? promptLine(block.goal, 300) : '';
    const rawTasks = Array.isArray(block.tasks) ? block.tasks : [];
    const tasks = rawTasks
      .map((t, i) => sanitizeTask(t, phaseKey, i))
      .filter((t): t is PlanTask => t !== null)
      .slice(0, 8);
    if (goal.length < 10 || tasks.length < 2) return null;
    phases.push({ phase: phaseKey, goal, tasks });
  }

  const totalEstimateHours = phases
    .flatMap((p) => p.tasks)
    .reduce<number>((sum, t) => sum + (t.estimateHours ?? 0), 0);

  return {
    version: 1,
    opportunity: slug,
    title,
    overview,
    icp,
    pricing,
    stackVenture: typeof rec.stackVenture === 'string' ? promptLine(rec.stackVenture, 60) : null,
    totalEstimateHours: totalEstimateHours > 0 ? Math.round(totalEstimateHours * 10) / 10 : null,
    phases,
    grounding,
    generatedAt: new Date().toISOString(),
  };
}

/** Wire format (snake_case) used by the MCP tools and the radar://plan resource. */
export function planToWire(plan: ExecutionPlan): Record<string, unknown> {
  return {
    version: plan.version,
    opportunity: plan.opportunity,
    title: plan.title,
    overview: plan.overview,
    icp: plan.icp,
    pricing: { model: plan.pricing.model, price_usd: plan.pricing.priceUsd, notes: plan.pricing.notes },
    stack_venture: plan.stackVenture,
    total_estimate_hours: plan.totalEstimateHours,
    phases: plan.phases.map((p) => ({
      phase: p.phase,
      goal: p.goal,
      tasks: p.tasks.map((t) => ({
        id: t.id,
        title: t.title,
        detail: t.detail,
        depends_on: t.dependsOn,
        files_to_touch: t.filesToTouch,
        tools: t.tools,
        acceptance: t.acceptance,
        verify: t.verify,
        estimate_hours: t.estimateHours,
        rollback: t.rollback,
      })),
    })),
    grounding: plan.grounding,
    generated_at: plan.generatedAt,
  };
}

/** Wire format → typed plan (for the cached column). Null when the cache drifted. */
export function planFromWire(v: unknown): ExecutionPlan | null {
  if (typeof v !== 'object' || v === null) return null;
  const rec = v as Record<string, unknown>;
  if (typeof rec.opportunity !== 'string') return null;
  const grounding = Array.isArray(rec.grounding)
    ? rec.grounding.filter((g): g is string => typeof g === 'string')
    : [];
  // sanitizePlan accepts snake_case aliases for the task fields, so the wire
  // format round-trips through it; generatedAt is preserved afterwards.
  const plan = sanitizePlan(rec.opportunity, grounding, {
    title: rec.title,
    overview: rec.overview,
    icp: rec.icp,
    pricing: rec.pricing
      ? {
          model: (rec.pricing as Record<string, unknown>).model,
          priceUsd: (rec.pricing as Record<string, unknown>).price_usd,
          notes: (rec.pricing as Record<string, unknown>).notes,
        }
      : undefined,
    stackVenture: rec.stack_venture,
    phases: rec.phases,
  });
  if (plan && typeof rec.generated_at === 'string') plan.generatedAt = rec.generated_at;
  return plan;
}
