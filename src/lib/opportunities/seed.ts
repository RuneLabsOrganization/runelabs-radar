/**
 * Deterministic per-caller enumeration of the composition space.
 *
 * Pure module: no DB, no LLM, no clock. Given a caller key and a day, it yields
 * a stable permutation of [0, spaceSize) that differs from every other caller's.
 * Paging forward through it never repeats a combination, so a caller can keep
 * asking for more openings until the space is genuinely exhausted.
 *
 * Construction: TWO composed stages of prime-field permutation with
 * cycle-walking. Each stage picks the smallest prime p >= n and maps
 * x -> (a*x + b) mod p with a != 0 — a bijection over Z_p — then walks the
 * cycle forward until the result lands back in [0, n), the standard FPE
 * cycle-walking trick that restricts a permutation to a subset while keeping
 * it bijective. Two properties a plain affine map i -> (a*i + b) mod n does
 * NOT have (and why it was replaced):
 *   - fairness: affine permutations are a small family — two callers whose
 *     seeds yielded the same `a` got the SAME leads phase-shifted by b. Here
 *     the second stage is keyed by a remix of the caller seed, so even
 *     colliding first-stage parameters diverge (verified by test).
 *   - no structured stride: composing affine maps mod n is still affine mod
 *     n, so consecutive cursors landed a fixed stride apart. Cycle-walking
 *     past the mod-p/mod-n mismatch breaks that regularity.
 * Chosen over a shuffled array because the space is ~10^5 entries and never
 * needs materialising. Products stay under p^2 << 2^53 for any realistic
 * space size, so plain number arithmetic is exact.
 */

import { fnv1a } from '../hash';

/** Stable seed for one caller on one UTC day. */
export function seedFor(ownerKey: string, day: string): number {
  return fnv1a(`${ownerKey}:${day}`);
}

function isPrime(n: number): boolean {
  if (n < 2) return false;
  for (let f = 2; f * f <= n; f++) if (n % f === 0) return false;
  return true;
}

function primeAtLeast(n: number): number {
  let p = Math.max(2, n);
  while (!isPrime(p)) p++;
  return p;
}

// the prime depends only on n, and sliceFor hammers it once per index
let primeCache: { n: number; p: number } | null = null;
function primeFor(n: number): number {
  if (primeCache?.n !== n) primeCache = { n, p: primeAtLeast(n) };
  return primeCache.p;
}

/**
 * One stage: a bijection of Z_p restricted to [0, n) by cycle-walking.
 * Terminates because the walk follows x's own mod-p cycle, which contains x
 * itself (< n); bijective on the subset by the standard FPE argument.
 */
function fieldPermute(i: number, n: number, p: number, seed: number): number {
  const a = (seed % (p - 1)) + 1; // nonzero ⇒ multiplication is bijective mod p
  const b = seed % p;
  let x = i % n;
  do {
    x = (a * x + b) % p;
  } while (x >= n);
  return x;
}

/** Bijective index permutation over [0, n) — see the module doc. */
export function permuteIndex(i: number, n: number, seed: number): number {
  if (n <= 0) return 0;
  if (n === 1) return 0;
  const p = primeFor(n);
  const first = fieldPermute(i, n, p, seed);
  return fieldPermute(first, n, p, fnv1a(`${seed}:remix`));
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
