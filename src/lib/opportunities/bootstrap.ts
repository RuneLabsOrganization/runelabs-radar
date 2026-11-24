import type { CommercialProfile } from './commercial';
import type { OppKpis } from './engine';

type BootstrapKpis = Pick<OppKpis, 'initialCostUsd' | 'monthlyCostUsd' | 'timeToMvpDays'>;
const months = 3;
const budgetUsd = 5000;
const timeAnchorDays = 30;

function estimate(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

/** Replaces the old 10-point pilot term for updated profiles. Cash and speed each get five points. */
export function bootstrapAssessment(kpis: BootstrapKpis, profile: CommercialProfile) {
  const initialCostUsd = estimate(kpis.initialCostUsd);
  const monthlyCostUsd = estimate(kpis.monthlyCostUsd);
  const pilotDays = estimate(profile.execution?.pilotDays);
  const days = pilotDays ?? estimate(kpis.timeToMvpDays);
  const daysBasis: 'paid pilot' | 'MVP' | null = pilotDays !== null ? 'paid pilot' : days !== null ? 'MVP' : null;

  const cash = initialCostUsd !== null && monthlyCostUsd !== null ? initialCostUsd + months * monthlyCostUsd : null;
  const cashPoints = cash === null ? 0 : 5 / (1 + cash / budgetUsd);
  const timePoints = days === null ? 0 : 5 / (1 + days / timeAnchorDays);
  const cashNote = cash === null
    ? 'Cash component unknown; both build and monthly cost estimates are required for credit.'
    : `Estimated build outlay $${initialCostUsd} plus ${months} months at $${monthlyCostUsd}/month = $${Number(cash.toFixed(2))}.`;
  const timeNote = daysBasis === null ? 'Timing unknown; no time credit.' :
    daysBasis === 'MVP' ? `${days} days to MVP as a proxy; paid-pilot timing unknown.` : `${days} days to first paid pilot.`;
  return {
    points: Math.round((cashPoints + timePoints) * 100) / 100,
    initialCostUsd, monthlyCostUsd, days, daysBasis,
    assumptions: `${cashNote} Build excludes salaries. Monthly operations are modeled at a reference scale of 100 active payers. ` +
      'The cash proxy includes no separate allowance for customer acquisition, partner launch costs or founder pay. ' +
      `${timeNote} Cash and speed each contribute up to 5 points. $${budgetUsd} in modeled costs and ${timeAnchorDays} days each earn half their component.`,
  };
}
