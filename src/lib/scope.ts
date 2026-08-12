import { DOMAINS, type Domain } from './domains';

/**
 * Pure helpers for the ScopeHero radar — client-safe (no DB, no ONNX).
 * Angles in radians, radius as a fraction of the scope's max radius (0..1).
 */

const TWO_PI = Math.PI * 2;

/** Deterministic 0..1 hash from a story id (Knuth multiplicative). */
export function hash01(id: number, salt = 0): number {
  let h = (id * 2654435761 + salt * 40503) >>> 0;
  h = ((h ^ (h >>> 16)) * 2246822519) >>> 0;
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
}

export interface BlipPlacement {
  /** radians, 0 = 3 o'clock, counterclockwise */
  angle: number;
  /** 0..1 fraction of the scope radius */
  r: number;
}

/**
 * Where a story sits on the scope: its domain's wedge (60° per sector) plus a
 * deterministic per-id jitter that stays inside the wedge; radius grows with
 * score (score 100 → rim, ≤30 → near the hub). Domain-less stories scatter
 * across the whole scope at a fixed mid radius.
 */
export function blipPosition(domain: Domain | null, score: number, id: number): BlipPlacement {
  const wedge = TWO_PI / DOMAINS.length;
  let angle: number;
  if (domain === null) {
    angle = hash01(id) * TWO_PI;
  } else {
    const idx = DOMAINS.indexOf(domain);
    const center = (idx + 0.5) * wedge;
    // jitter within the middle 62% of the wedge — never crosses a spoke
    angle = center + (hash01(id, 1) - 0.5) * wedge * 0.62;
  }
  const base = 0.22 + 0.72 * Math.max(0, Math.min(1, (score - 30) / 70));
  const r = Math.max(0.1, Math.min(0.97, base + (hash01(id, 2) - 0.5) * 0.08));
  return { angle: ((angle % TWO_PI) + TWO_PI) % TWO_PI, r };
}

/** easeOutExpo — fast attack, soft landing; t in 0..1. */
export function easeOutExpo(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return 1 - Math.pow(2, -10 * t);
}

/** Linear interpolate with easing — the KPI counter tween. */
export function tweenNumber(from: number, to: number, t: number): number {
  return from + (to - from) * easeOutExpo(t);
}

/** Compact KPI numerals: 1234 -> "1.2k". */
export function kpiFormat(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return String(Math.round(n));
}
