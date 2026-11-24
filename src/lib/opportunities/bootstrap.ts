import { weightedChannelCac, type CommercialProfile } from './commercial';
import type { OppKpis } from './engine';
import { matchedUsComparable } from './comparable-product';
import { soloValidationPilot } from './channel-cac';

type BootstrapKpis = Pick<OppKpis, 'initialCostUsd' | 'monthlyCostUsd' | 'timeToMvpDays'>;
const months = 3;
const budgetUsd = 5000;
const timeAnchorDays = 30;
const cents = (usd: number) => Math.round(usd * 100) / 100;

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

  const fixedCash = initialCostUsd !== null && monthlyCostUsd !== null ? initialCostUsd + months * monthlyCostUsd : null;
  const firstTenCashUsd = profile.channelMix && profile.cacChannels
    ? weightedChannelCac(profile.cacChannels, profile.channelMix.weights, 'cashUsd', 10) : null;
  const launchCashUsd = fixedCash !== null && firstTenCashUsd ? {
    low: cents(fixedCash + firstTenCashUsd.low),
    base: cents(fixedCash + firstTenCashUsd.base),
    high: cents(fixedCash + firstTenCashUsd.high),
  } : null;
  const scoredCash = launchCashUsd?.base ?? fixedCash;
  const cashPoints = scoredCash === null ? 0 : 5 / (1 + scoredCash / budgetUsd);
  const timePoints = days === null ? 0 : 5 / (1 + days / timeAnchorDays);
  const cashNote = fixedCash === null
    ? 'Cash component unknown; both build and monthly cost estimates are required for credit.'
    : `Estimated build outlay $${initialCostUsd} plus ${months} months at $${monthlyCostUsd}/month = $${Number(fixedCash.toFixed(2))}.`;
  const acquisitionNote = firstTenCashUsd
    ? 'First-ten acquisition cash weights each route’s launch-period cash by its expected payer share. Excludes founder pay, separate partner setup costs and later commissions.'
    : 'The cash proxy includes no separate allowance for customer acquisition, partner launch costs or founder pay.';
  const timeNote = daysBasis === null ? 'Timing unknown; no time credit.' :
    daysBasis === 'MVP' ? `${days} days to MVP as a proxy; paid-pilot timing unknown.` : `${days} days to first paid pilot.`;
  const product = matchedUsComparable(profile);
  const soloPilot = product && soloValidationPilot(product, profile);
  return {
    points: Math.round((cashPoints + timePoints) * 100) / 100,
    initialCostUsd, monthlyCostUsd, days, daysBasis,
    ...(firstTenCashUsd && { firstTenCashUsd }),
    ...(launchCashUsd && { launchCashUsd }),
    ...(soloPilot && { soloPilot }),
    assumptions: `${cashNote} Build excludes salaries. Monthly operations are modeled at a reference scale of 100 active payers. ` +
      `${acquisitionNote} ${timeNote} Cash and speed each contribute up to 5 points. $${budgetUsd} in modeled costs and ${timeAnchorDays} days each earn half their component.`,
  };
}
