// --- deterministic idea↔evidence matching: token overlap, no embeddings ---
// Shared by debate.ts (grounding/closest-opportunity scoring) and jobs.ts
// (whats_relevant/decide ranking) so the scoring rule can never drift
// between the two call sites.

const STOPWORDS = new Set(
  (
    'the a an and or of to in on for with that this it is are be was were i me my we our you your they them their ' +
    'as at by from so do does how what when where who why can could should would will not no new build make app ' +
    'tool tools platform product service ai saas software idea'
  ).split(' '),
);

export function tokenSet(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 2 && !STOPWORDS.has(t)),
  );
}

/** Normalized overlap: |a∩b| / sqrt(|a|·|b|) — 0..1, favors shared rare tokens. */
export function overlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let hit = 0;
  for (const t of a) if (b.has(t)) hit++;
  return hit / Math.sqrt(a.size * b.size);
}
