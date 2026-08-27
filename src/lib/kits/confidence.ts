/**
 * Confidence is computed, never asserted.
 *
 * Volume and source spread set the ceiling; age pulls it down. A cell nobody
 * re-verifies decays on its own, so staleness surfaces without anyone
 * remembering to audit — the failure mode AGENT_STACKS_REVIEWED_AT is exposed
 * to today.
 *
 * Ladder: high needs >=20 reports from >=3 distinct sources verified <=14d;
 * med needs >=5 reports verified <=45d; past 45d drop a tier; past 90d low.
 */

export type Confidence = 'high' | 'med' | 'low';

export interface ConfidenceInput {
  evidenceCount: number;
  distinctSources: number;
  verifiedAt: Date | null;
  /**
   * Distinct registrable domains from independent-role evidence
   * (src/lib/kits/provenance.ts). Undefined = caller has not computed it yet,
   * in which case the gate is skipped rather than silently failing everything.
   */
  independentDomains?: number;
  /** Injectable for deterministic tests. */
  now?: Date;
}

const DAY_MS = 86_400_000;

function demote(c: Confidence): Confidence {
  return c === 'high' ? 'med' : 'low';
}

export function gradeConfidence(input: ConfidenceInput): Confidence {
  const { evidenceCount, distinctSources, verifiedAt, independentDomains } = input;
  if (!verifiedAt) return 'low';

  // A verdict sourced entirely from the vendor cannot outrank 'low', however
  // much of it there is. Volume of first-party material is not corroboration.
  if (independentDomains !== undefined && independentDomains < 1) return 'low';

  const now = input.now ?? new Date();
  const ageDays = (now.getTime() - verifiedAt.getTime()) / DAY_MS;

  let tier: Confidence =
    evidenceCount >= 20 && distinctSources >= 3 ? 'high' : evidenceCount >= 5 ? 'med' : 'low';

  if (ageDays > 90) return 'low';
  if (ageDays > 45) return demote(tier);
  if (ageDays > 14 && tier === 'high') tier = 'med';
  return tier;
}
