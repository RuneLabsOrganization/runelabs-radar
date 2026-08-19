import type { ExecutionPlan, PlanPhase } from './schema';

const PHASE_LABELS: Record<PlanPhase, string> = {
  validation: 'Phase 1 — Validation',
  build: 'Phase 2 — Build',
  launch: 'Phase 3 — Launch',
  gtm: 'Phase 4 — Go-to-market',
  revenue: 'Phase 5 — Revenue',
};

/** Render an execution plan as the human/agent-readable markdown document. */
export function renderPlanMarkdown(plan: ExecutionPlan): string {
  const lines: string[] = [];
  lines.push(`# ${plan.title}`);
  lines.push('');
  lines.push(`> ${plan.overview}`);
  lines.push('');
  lines.push(`- **Who pays (ICP):** ${plan.icp}`);
  lines.push(
    `- **Pricing:** ${plan.pricing.model}${plan.pricing.priceUsd !== null ? ` — $${plan.pricing.priceUsd}` : ''}${plan.pricing.notes ? ` (${plan.pricing.notes})` : ''}`,
  );
  if (plan.stackVenture) lines.push(`- **Stack playbook:** ${plan.stackVenture}`);
  if (plan.totalEstimateHours !== null) lines.push(`- **Total estimate:** ~${plan.totalEstimateHours}h`);
  lines.push(`- **Generated:** ${plan.generatedAt} · grounded in: ${plan.grounding.join(', ')}`);
  lines.push('');

  for (const phase of plan.phases) {
    lines.push(`## ${PHASE_LABELS[phase.phase]}`);
    lines.push('');
    lines.push(`*${phase.goal}*`);
    lines.push('');
    for (const task of phase.tasks) {
      const deps = task.dependsOn.length > 0 ? ` — after: ${task.dependsOn.join(', ')}` : '';
      const est = task.estimateHours !== null ? ` (~${task.estimateHours}h)` : '';
      lines.push(`### [ ] ${task.id}: ${task.title}${est}${deps}`);
      lines.push('');
      lines.push(task.detail);
      lines.push('');
      if (task.filesToTouch.length > 0) lines.push(`- Files: ${task.filesToTouch.map((f) => `\`${f}\``).join(', ')}`);
      if (task.tools.length > 0) lines.push(`- Tools: ${task.tools.join(', ')}`);
      lines.push('- Acceptance:');
      for (const a of task.acceptance) lines.push(`  - [ ] ${a}`);
      if (task.verify) lines.push(`- Verify: \`${task.verify}\``);
      if (task.rollback) lines.push(`- Rollback: ${task.rollback}`);
      lines.push('');
    }
  }
  return lines.join('\n');
}
