/**
 * Deterministic per-caller enumeration of the composition space.
 *
 * Pure module: no DB, no LLM, no clock. Given a caller key and a day, it yields
 * a stable permutation of [0, spaceSize) that differs from every other caller's.
 * Paging forward through it never repeats a combination, so a caller can keep
 * asking for more openings until the space is genuinely exhausted.
 *
 * The permutation is an affine map i -> (a*i + b) mod n with gcd(a, n) = 1,
 * which is bijective by construction. Chosen over a shuffled array because the
 * space is ~10^5 entries and never needs materialising.
 */

/** FNV-1a 32-bit — the hash family already used for ordering salt in mcp/tools/opportunities.ts. */
function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Stable seed for one caller on one UTC day. */
export function seedFor(ownerKey: string, day: string): number {
  return fnv1a(`${ownerKey}:${day}`);
}

function gcd(a: number, b: number): number {
  while (b !== 0) [a, b] = [b, a % b];
  return a;
}

/** Smallest multiplier >= start that is coprime with n. Always terminates. */
function coprimeFor(start: number, n: number): number {
  if (n <= 1) return 1;
  let a = start % n || 1;
  for (let tries = 0; tries < n; tries++) {
    if (gcd(a, n) === 1) return a;
    a = (a % n) + 1;
  }
  return 1;
}

/**
 * Bijective index permutation over [0, n). Products stay well under 2^53 for
 * any realistic space size, so plain number arithmetic is exact.
 */
export function permuteIndex(i: number, n: number, seed: number): number {
  if (n <= 0) return 0;
  const a = coprimeFor(seed, n);
  const b = seed % n;
  return (a * (i % n) + b) % n;
}

/**
 * The caller's indices for one page. `cursor` is an offset into their personal
 * permutation, so consecutive pages are disjoint and order is stable all day.
 */
export function sliceFor(
  ownerKey: string,
  day: string,
  spaceSize: number,
  cursor: number,
  count: number,
): number[] {
  if (spaceSize <= 0 || count <= 0 || cursor >= spaceSize) return [];
  const seed = seedFor(ownerKey, day);
  const end = Math.min(cursor + count, spaceSize);
  const out: number[] = [];
  for (let i = cursor; i < end; i++) out.push(permuteIndex(i, spaceSize, seed));
  return out;
}

/** UTC day key — the unit a caller's ordering is stable for. */
export function dayKey(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}
